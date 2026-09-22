'use strict';

/**
 * Resolving and installing everything a launch needs.
 *
 * The shape of a launch is fixed by Mojang: a version manifest points at a
 * version JSON, which lists a client jar, a set of libraries filtered by
 * platform rules, an asset index, and the argument templates to fill in. This
 * module turns a profile's `{ version, loader }` into a concrete set of files
 * on disk plus the exact command line to run.
 *
 * Two layouts are in play, on purpose:
 *   - the shared root holds versions, libraries, assets and Java. It defaults
 *     to the existing `.minecraft`, so a gigabyte already downloaded is a
 *     gigabyte not downloaded again.
 *   - each profile gets its own game directory, because a profile owns its mod
 *     list and two Fabric profiles must not share one `mods` folder.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { ensureDir, isPresent, sha1, fetchJson, download, pool, extractNatives } = require('./files');
const memo = require('./memo');
const { lane } = require('./lane');
const { NAME: LAUNCHER_NAME, VERSION: LAUNCHER_VERSION } = require('../version');

const VERSION_MANIFEST =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_MANIFEST =
  'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const RESOURCES = 'https://resources.download.minecraft.net';
const FABRIC_META = 'https://meta.fabricmc.net/v2/versions';

const DOWNLOAD_LIMIT = 16;

/**
 * How long a Fabric loader answer is taken on trust.
 *
 * Fabric publishes a loader every few weeks, and the version it names decides
 * only which of two working loaders a profile runs. Asking their servers on
 * every Play press bought a fresher answer than anybody needs and put a
 * network round-trip in front of every launch, including the launches where
 * every file was already on disk.
 */
const FABRIC_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * How long Mojang's Java runtime index is taken on trust (2026-09-19).
 *
 * The index names, per platform and component, the manifest that lists every
 * file of the runtime with its hash and size. Mojang moves a component to a
 * new build about once a year, so asking on every Play press would be a
 * round trip in front of every launch for an answer that never changes; and
 * the remembered copy is what lets a launch with no network verify the
 * runtime at all (see `javaManifest`).
 */
const JAVA_INDEX_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * How long a press waits for a renewal before going with the answer it has
 * (2026-09-22). Long enough that a server answering normally still hands this
 * launch the fresh answer — Mojang and Fabric are both a fifth of a second
 * from here — and short enough that a server having a bad evening costs the
 * press this and no more. See memo.remember.
 */
const LOOKUP_GRACE_MS = 700;

/**
 * How many runtime files the sweep looks at at once.
 *
 * A stat is a syscall, not a download, so this can be well above the download
 * cap; and a full check reads every file, so it drops to a few at a time
 * there (`verifyRuntime`) — a hundred megabytes through sixty-four parallel
 * reads is a way to run out of memory, not a way to go faster.
 */
const SWEEP_LIMIT = 64;
const HASH_LIMIT = 6;

/**
 * How many objects the fast asset path spot-checks.
 *
 * Enough that a folder somebody has emptied, moved or half-deleted is caught
 * at once; few enough that the check is instant.
 */
const ASSET_SPOT_CHECK = 24;

/* ------------------------------------------------------------- platform */

const OS_NAME = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform] || 'linux';
const OS_ARCH = { x64: 'x86_64', ia32: 'x86', arm64: 'arm64' }[process.arch] || process.arch;
const CLASSPATH_SEPARATOR = process.platform === 'win32' ? ';' : ':';

const JAVA_PLATFORM = {
  win32: { x64: 'windows-x64', ia32: 'windows-x86', arm64: 'windows-arm64' },
  darwin: { x64: 'mac-os', arm64: 'mac-os-arm64' },
  linux: { x64: 'linux', ia32: 'linux-i386' }
}[process.platform]?.[process.arch];

/**
 * Mojang's rule format: rules are evaluated in order and the last one that
 * applies wins. No rules at all means allowed.
 */
function allowed(rules, features = {}) {
  if (!Array.isArray(rules) || rules.length === 0) return true;

  let verdict = false;
  for (const rule of rules) {
    let applies = true;

    if (rule.os) {
      if (rule.os.name && rule.os.name !== OS_NAME) applies = false;
      if (rule.os.arch && rule.os.arch !== OS_ARCH) applies = false;
      if (rule.os.version && !new RegExp(rule.os.version).test(os.release())) applies = false;
    }

    if (applies && rule.features) {
      for (const [key, wanted] of Object.entries(rule.features)) {
        if (Boolean(features[key]) !== Boolean(wanted)) applies = false;
      }
    }

    if (applies) verdict = rule.action === 'allow';
  }
  return verdict;
}

/** `group:artifact:version[:classifier]` to its path under `libraries/`. */
function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const file = classifier
    ? artifact + '-' + version + '-' + classifier + '.jar'
    : artifact + '-' + version + '.jar';
  return path.join(...group.split('.'), artifact, version, file);
}

/** The `group:artifact` half, used to keep one version of each library. */
function libraryKey(name) {
  const parts = name.split(':');
  return parts[0] + ':' + parts[1] + (parts[3] ? ':' + parts[3] : '');
}

/**
 * The UUID an offline account gets.
 *
 * The server derives it the same way — a version-3 UUID over the bytes of
 * "OfflinePlayer:<name>" — so a world remembers the same player between
 * launches, and between this launcher and any other.
 */
function offlineUuid(username) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + username, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // version 3
  hash[8] = (hash[8] & 0x3f) | 0x80; // IETF variant
  const hex = hash.toString('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)
  ].join('-');
}

/* -------------------------------------------------------------- version */

let manifestCache = null;

async function versionManifest() {
  if (!manifestCache) manifestCache = await fetchJson(VERSION_MANIFEST);
  return manifestCache;
}

/** Every id the user could pick, newest first, with its release channel. */
async function listVersions() {
  const manifest = await versionManifest();
  return manifest.versions.map((entry) => ({
    id: entry.id,
    type: entry.type,
    released: entry.releaseTime
  }));
}

/**
 * The version JSON, from disk when it is already there.
 *
 * A version installed by another launcher is reused as-is: these files are
 * Mojang's own and identical whoever fetched them.
 */
async function versionJson(root, id) {
  const file = path.join(root, 'versions', id, id + '.json');
  try {
    const local = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (local.id && (local.downloads || local.inheritsFrom)) return local;
  } catch { /* fall through and fetch it */ }

  const manifest = await versionManifest();
  const entry = manifest.versions.find((v) => v.id === id);
  if (!entry) throw new Error('Unknown Minecraft version "' + id + '"');

  const json = await fetchJson(entry.url);
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(json, null, 2));
  return json;
}

/**
 * Fold a child version JSON (Fabric) onto the vanilla one it inherits from.
 *
 * Order matters on the classpath: the child's libraries go first so its ASM
 * and its logging back-end win over the ones vanilla ships.
 */
function mergeVersions(child, parent) {
  return {
    ...parent,
    ...child,
    id: child.id,
    mainClass: child.mainClass || parent.mainClass,
    assetIndex: child.assetIndex || parent.assetIndex,
    assets: child.assets || parent.assets,
    downloads: parent.downloads,
    javaVersion: child.javaVersion || parent.javaVersion,
    libraries: [...(child.libraries || []), ...(parent.libraries || [])],
    arguments: {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])]
    },
    minecraftArguments: child.minecraftArguments || parent.minecraftArguments
  };
}

/**
 * Latest stable Fabric loader for a game version.
 *
 * Remembered for half a day, and a remembered answer of any age is preferred
 * to a failure: a player with the files already downloaded gets to play with
 * the loader they played with last time rather than an error about a server
 * they did not know their launch depended on.
 *
 * **An expired answer is handed straight back and renewed behind the press**
 * (2026-09-22, `serveStale`). The loader this remembers is the one already
 * installed in the profile, so an answer half a day old launches exactly the
 * game the player had yesterday; asking meta.fabricmc.net first only ever put
 * a round trip — 0.2 s on a good line, twelve on a bad one — between the click
 * and the JVM, on the first press of every day. `prime()` renews it while the
 * launcher sits there, so the press usually finds it fresh anyway.
 */
async function latestFabricLoader(gameVersion) {
  return memo.remember('fabric:' + gameVersion, FABRIC_TTL_MS, fabricWork(gameVersion), { serveStale: true, graceMs: LOOKUP_GRACE_MS });
}

/** The ask itself, so `prime` can renew the same key without a press. */
function fabricWork(gameVersion) {
  return async () => {
    const entries = await fetchJson(FABRIC_META + '/loader/' + encodeURIComponent(gameVersion));
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('Fabric does not support Minecraft ' + gameVersion + ' yet');
    }
    const stable = entries.find((e) => e.loader && e.loader.stable) || entries[0];
    return stable.loader.version;
  };
}

/** Renew the Fabric answer for these versions in the background. Never throws. */
function warmFabric(gameVersions) {
  for (const version of new Set(gameVersions)) {
    if (!version) continue;
    memo.refresh('fabric:' + version, fabricWork(version));
  }
}

/**
 * Resolve a profile down to one version JSON.
 *
 * For vanilla that is just the version. For Fabric it is Fabric's profile JSON
 * merged onto the vanilla one it inherits from.
 */
async function resolve(root, { version, loader }) {
  const vanilla = await versionJson(root, version);
  if (loader !== 'fabric') return { json: vanilla, versionId: version, loaderVersion: null };

  const loaderVersion = await latestFabricLoader(version);
  const id = version + '-fabric-' + loaderVersion;
  const file = path.join(root, 'versions', id, id + '.json');

  let profile;
  try {
    profile = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    profile = await fetchJson(
      FABRIC_META + '/loader/' + encodeURIComponent(version) +
      '/' + encodeURIComponent(loaderVersion) + '/profile/json'
    );
    await ensureDir(path.dirname(file));
    await fsp.writeFile(file, JSON.stringify(profile, null, 2));
  }

  return { json: mergeVersions(profile, vanilla), versionId: id, loaderVersion };
}

/* ------------------------------------------------------------ downloads */

async function ensureClient(root, json, baseVersion, onProgress) {
  // Fabric ships no jar of its own; it runs the vanilla client jar.
  const file = path.join(root, 'versions', baseVersion, baseVersion + '.jar');
  const artifact = json.downloads && json.downloads.client;
  if (!artifact) throw new Error('Version JSON has no client download');
  // The one jar is thirty megabytes: the bar follows its bytes (2026-09-19),
  // not a single tick at the end that read as a stall on a slow connection.
  await download(artifact.url, file, artifact, {
    onBytes: onProgress ? (received, total) => onProgress(total ? received / total : 0) : null
  });
  return file;
}

/**
 * Download every library this platform needs.
 *
 * Returns the classpath in the order the version JSON listed them, with only
 * the first of each `group:artifact` kept — a later duplicate would shadow
 * Fabric's build of a shared library with vanilla's.
 */
async function ensureLibraries(root, json, nativesDir, onProgress) {
  const libraries = (json.libraries || []).filter((lib) => allowed(lib.rules));

  const jobs = [];
  const classpath = [];
  const seen = new Set();

  for (const lib of libraries) {
    const downloads = lib.downloads || {};

    // Classic layout (up to ~1.18): natives live in a classifier jar that is
    // unpacked beside the game rather than put on the classpath.
    const nativeName = lib.natives && lib.natives[OS_NAME];
    const nativeKey = nativeName
      ? nativeName.replace('${arch}', process.arch === 'ia32' ? '32' : '64')
      : null;

    // A version JSON written by another launcher into the shared .minecraft
    // (versionJson reuses one it finds there) does not always spell a
    // library's `path`; Mojang's always does. The Maven coordinate says the
    // same thing, so it stands in — and a library with neither is skipped
    // rather than handed to path.join as undefined (2026-09-19).
    const placeOf = (artifact, classifier) => {
      if (artifact.path) return path.join(root, 'libraries', artifact.path);
      if (!lib.name) return null;
      const coordinate = classifier ? `${lib.name}:${classifier}` : lib.name;
      return path.join(root, 'libraries', mavenPath(coordinate));
    };

    if (nativeKey) {
      const artifact = downloads.classifiers && downloads.classifiers[nativeKey];
      const file = artifact && placeOf(artifact, nativeKey);
      if (artifact && file) {
        jobs.push({
          url: artifact.url,
          file,
          meta: artifact,
          extract: (lib.extract && lib.extract.exclude) || []
        });
      }
      if (!downloads.artifact) continue;
    }

    if (downloads.artifact) {
      const artifact = downloads.artifact;
      const file = placeOf(artifact, null);
      if (!file) continue;
      jobs.push({ url: artifact.url, file, meta: artifact });

      // Modern natives ship as ordinary `:natives-windows` artifacts and are
      // expected on the classpath; LWJGL unpacks them itself at runtime.
      if (!nativeKey && !seen.has(libraryKey(lib.name))) {
        seen.add(libraryKey(lib.name));
        classpath.push(file);
      }
      continue;
    }

    // Fabric's meta lists libraries as a Maven coordinate plus a repository.
    if (lib.name && lib.url) {
      const relative = mavenPath(lib.name);
      const file = path.join(root, 'libraries', relative);
      const url = lib.url.replace(/\/?$/, '/') + relative.split(path.sep).join('/');
      jobs.push({ url, file, meta: { sha1: lib.sha1, size: lib.size } });
      if (!seen.has(libraryKey(lib.name))) {
        seen.add(libraryKey(lib.name));
        classpath.push(file);
      }
    }
  }

  let done = 0;
  await pool(jobs, DOWNLOAD_LIMIT, async (job) => {
    await download(job.url, job.file, job.meta);
    if (job.extract) await extractNatives(job.file, nativesDir, job.extract);
    done += 1;
    if (onProgress) onProgress(done / jobs.length);
  });

  return classpath;
}

/**
 * Download the asset index and every object it names.
 *
 * Objects are content-addressed, so an index shared between two versions costs
 * nothing the second time.
 *
 * <h2>The stamp</h2>
 * An index names four to eight thousand objects, and walking all of them to
 * ask the filesystem whether each is there was — on a install where every one
 * of them was — by a wide margin the longest thing between pressing Play and
 * the game starting. Thousands of `stat` calls is a slow thing to do on
 * Windows, and slower still with an antivirus watching the folder.
 *
 * So a pass that finds nothing to fetch leaves a stamp beside the index
 * naming the index it verified and how many objects were in it. A later
 * launch that finds a matching stamp spot-checks a couple of dozen objects
 * and, if they are all there, skips the walk entirely. The stamp can only
 * ever be wrong in one direction — files removed behind the launcher's back —
 * and the spot check is what catches that; anything subtler than an emptied
 * folder is caught by the game itself, which re-downloads what it is missing.
 */
async function ensureAssets(root, json, gameDir, onProgress) {
  const assetsDir = path.join(root, 'assets');
  const index = json.assetIndex;
  if (!index) return { assetsDir, indexId: json.assets || 'legacy', legacyDir: null };

  const indexFile = path.join(assetsDir, 'indexes', index.id + '.json');
  await download(index.url, indexFile, index);
  const parsed = JSON.parse(await fsp.readFile(indexFile, 'utf8'));

  const entries = Object.entries(parsed.objects || {});
  const result = {
    assetsDir,
    indexId: index.id,
    legacyDir: parsed.virtual ? path.join(assetsDir, 'virtual', 'legacy') : null
  };

  // Versions before 1.7 need every object copied out by name as well, so the
  // walk is the only thing that puts them there and the stamp is no use.
  const copiesOut = Boolean(parsed.virtual || parsed.map_to_resources);
  // Kept out of `indexes/`: that folder is Mojang's and other launchers read
  // it, and a file of ours in it is a file of ours in their way.
  const stampFile = path.join(assetsDir, '.blueclient', index.id + '.verified.json');

  if (!copiesOut && await stampHolds(stampFile, index, entries, assetsDir)) {
    if (onProgress) onProgress(1);
    return result;
  }

  let done = 0;

  await pool(entries, DOWNLOAD_LIMIT, async ([name, object]) => {
    const prefix = object.hash.slice(0, 2);
    const file = path.join(assetsDir, 'objects', prefix, object.hash);
    await download(RESOURCES + '/' + prefix + '/' + object.hash, file, {
      sha1: object.hash,
      size: object.size
    });

    // Versions older than 1.7 read assets by name rather than by hash.
    if (parsed.virtual || parsed.map_to_resources) {
      const target = parsed.map_to_resources
        ? path.join(gameDir, 'resources', name)
        : path.join(assetsDir, 'virtual', 'legacy', name);
      if (!(await isPresent(target, null, object.size))) {
        await ensureDir(path.dirname(target));
        await fsp.copyFile(file, target);
      }
    }

    done += 1;
    if (onProgress) onProgress(done / entries.length);
  });

  // Only a pass that got all the way here: anything that threw took the whole
  // stage with it and left no stamp behind.
  if (!copiesOut) {
    await ensureDir(path.dirname(stampFile));
    await fsp.writeFile(stampFile, JSON.stringify({
      sha1: index.sha1 || null,
      count: entries.length,
      at: Date.now()
    }), 'utf8').catch(() => {});
  }

  return result;
}

/**
 * Whether a previous pass's stamp still stands.
 *
 * It has to name this exact index and the same number of objects, and a
 * scattered sample of those objects has to still be on disk at the right size.
 */
async function stampHolds(stampFile, index, entries, assetsDir) {
  let stamp;
  try {
    stamp = JSON.parse(await fsp.readFile(stampFile, 'utf8'));
  } catch {
    return false;
  }
  if (!stamp || stamp.count !== entries.length) return false;
  if ((stamp.sha1 || null) !== (index.sha1 || null)) return false;
  if (entries.length === 0) return true;

  // Spread the sample across the whole index rather than taking the first
  // few: a half-copied assets folder usually has a contiguous piece of one.
  const step = Math.max(1, Math.floor(entries.length / ASSET_SPOT_CHECK));
  const checks = [];
  for (let i = 0; i < entries.length; i += step) checks.push(entries[i]);

  const found = await Promise.all(checks.map(([, object]) => {
    const prefix = object.hash.slice(0, 2);
    return isPresent(path.join(assetsDir, 'objects', prefix, object.hash), null, object.size);
  }));
  return found.every(Boolean);
}

/**
 * Put the Java runtime this version asks for on disk — whole.
 *
 * The version JSON names an exact component, so rather than guess whether some
 * system JDK is close enough, fetch the one Mojang ships for it. A system Java
 * is only used when this platform has no Mojang build.
 *
 * <h2>Verified on every launch, not just the first (2026-09-19)</h2>
 * Until this date the runtime was taken as installed the moment `bin/javaw.exe`
 * existed. Two players' launch logs showed what that costs: one runtime
 * missing its `lib/modules` (HotSpot: "Failed setting boot class path"), one
 * missing a DLL under `bin/` (the process dies with STATUS_DLL_NOT_FOUND
 * before Java prints a word) — a download that stopped halfway, or a file an
 * antivirus took — and every Play press after failed the same way for ever,
 * because javaw.exe was there and nothing looked further. So every launch
 * now checks the whole folder against Mojang's own manifest (`verifyRuntime`
 * — existence and size of every file, four hundred stats, a few
 * milliseconds) and fetches what is missing or wrong; the Retry on a
 * "Java's files were incomplete" row asks for the full hash check
 * (`options.repair`), which catches a file of the right size with the wrong
 * bytes. Nothing the manifest does not name is touched, with one exception
 * that is ours and not Mojang's: the class archive `archiveClasses` writes
 * beside the VM, dropped when the VM it was dumped from is replaced (below).
 *
 * With no network and nothing remembered, a runtime that has its launcher,
 * its module image and its VM library is launched as before: a check that
 * cannot run must not be the thing that stops a game whose files are all
 * there.
 *
 * @param {object} [options]
 * @param {boolean}  [options.repair]   hash every file, not just the ones whose size is off
 * @param {Function} [options.fetchJson] and
 * @param {Function} [options.download]  stand-ins for the check under tools/
 */
async function ensureJava(javaRoot, json, onProgress, options = {}) {
  const component = (json.javaVersion && json.javaVersion.component) || 'jre-legacy';
  const major = (json.javaVersion && json.javaVersion.majorVersion) || 8;
  const home = path.join(javaRoot, component);
  const binary = path.join(home, 'bin', process.platform === 'win32' ? 'javaw.exe' : 'java');
  // `installed` is for the launch log's one line: a folder that had no
  // launcher at all is being installed, not repaired.
  const own = { binary, component, major, system: false, repaired: [], installed: !(await isPresent(binary)) };

  const whole = await runtimeLooksWhole(home);
  if (!JAVA_PLATFORM) {
    return whole ? own : { binary: await systemJava(major), component, major, system: true, repaired: [] };
  }

  const manifest = await javaManifest(component, options.fetchJson);
  if (manifest === 'none') {
    // Mojang lists no build of this component for this platform — or the
    // only index reachable is one that predates it. A whole runtime already
    // in the folder is still the one to run; failing that, the machine's.
    return whole ? own : { binary: await systemJava(major), component, major, system: true, repaired: [] };
  }
  if (!manifest) {
    if (whole) return own;
    throw new Error(
      "Java's files are incomplete and Mojang could not be reached to repair them. " +
      'Check the connection and press Play again.'
    );
  }

  let outcome;
  try {
    outcome = await verifyRuntime(home, manifest.files, {
      full: Boolean(options.repair),
      onProgress,
      download: options.download
    });
  } catch (error) {
    // A file that could not be fetched. What did arrive is kept as a `.part`
    // beside its place and the next press picks it up where it stopped
    // (files.js, download), so the one useful thing to say is that — not
    // "This operation was aborted" (2026-09-19).
    const busy = error && /EBUSY|EPERM|EACCES/.test(String(error.code || ''));
    // `abandons` is a throw out of the caller's own progress hook — a launch
    // cancelled mid-download — and is the caller's to recognise.
    if (busy || (error && error.abandons)) throw error;
    const reason = String(error && error.message || error).replace(/\.$/, '');
    throw new Error(
      `Java could not be downloaded in full — ${reason}. ` +
      'Check the connection and press Play again; the download carries on from where it stopped.'
    );
  }
  own.repaired = outcome.repaired;

  // The class archive beside the VM is the launcher's own file, not Mojang's
  // (archiveClasses), and it is only good for the VM build it was dumped
  // from: a newer build of the component (`upgraded`), or the VM library
  // itself put back, leaves an archive the new VM ignores in silence and
  // never rebuilds, because it exists. Ours to drop, so the dump below
  // writes a fresh one. A re-downloaded module image does not need this —
  // checked on 2026-09-19: `-Xshare:on -version` still says "sharing" with
  // a newer lib/modules of the same bytes.
  const vmReplaced = outcome.repaired.some((relative) => relative.endsWith('/' + VM_LIBRARY));
  if (manifest.upgraded || vmReplaced) {
    const server = serverDir(home);
    if (server) await fsp.rm(path.join(server, 'classes.jsa'), { force: true }).catch(() => {});
  }

  // The class archive is written behind the press, never in front of it
  // (2026-09-22). It is a whole second JVM run — `-Xshare:dump`, a few
  // seconds of one core, a 180-second clock — and until today it was awaited
  // here on EVERY press, returning at once only because the archive was
  // usually already there: the press after a runtime upgrade, or after the
  // dump above dropped a stale archive, stood and watched it. Nothing about
  // this launch needs it — the JVM runs without one, as it always has — and
  // the archive is in place for the next launch. `archiveClasses` holds its
  // own lane, so this can never race prime()'s warmJava over the same
  // `.part` file.
  archiveClasses(home).catch(() => false);

  return own;
}

const VM_LIBRARY = { win32: 'jvm.dll', darwin: 'libjvm.dylib' }[process.platform] || 'libjvm.so';

/**
 * Whether a runtime folder has the three files a JVM cannot start without —
 * the launcher, the module image and the VM library. What the offline path
 * checks, and the least a folder can have and still be worth launching.
 */
async function runtimeLooksWhole(home) {
  const binary = path.join(home, 'bin', process.platform === 'win32' ? 'javaw.exe' : 'java');
  if (!(await isPresent(binary))) return false;
  if (!(await isPresent(path.join(home, 'lib', 'modules')))) return false;
  const server = serverDir(home);
  return Boolean(server) && await isPresent(path.join(server, VM_LIBRARY));
}

/** Where the VM library lives: `bin/server` on Windows, `lib/server` elsewhere. */
function serverDir(home) {
  return ['bin', 'lib']
    .map((dir) => path.join(home, dir, 'server'))
    .find((dir) => fs.existsSync(dir)) || null;
}

/**
 * Mojang's file list for a runtime component, remembered on disk.
 *
 * Two answers are kept in the lookup cache (game/memo.js): the index — which
 * manifest each component is at, per platform, taken on trust for half a
 * day — and, per component, the manifest itself, cut down to the fields the
 * verifier reads (`slimManifest`). The manifest is fetched again only when
 * the index points somewhere new, which is Mojang moving the component to a
 * newer build; the copy then says so (`upgraded`) so the caller can drop the
 * class archive of the old one. Stale beats none, both ways: with the index
 * unreachable its last copy is used, and with the manifest unreachable
 * whatever was kept for the component — which is the manifest the files on
 * disk were downloaded against, the one that matters.
 *
 * @returns {Promise<{ files: object, url: string, upgraded: boolean } | 'none' | null>}
 *   the manifest; 'none' when Mojang builds no such component for this
 *   platform (the caller falls back to a Java on the machine); null when
 *   nothing could be fetched and nothing was remembered.
 */
async function javaManifest(component, fetchIndex = fetchJson) {
  const indexKey = 'java:index:' + JAVA_PLATFORM;
  const manifestKey = 'java:manifest:' + component;

  const readIndex = async () => {
    const all = await fetchIndex(JAVA_MANIFEST);
    const platform = (all && all[JAVA_PLATFORM]) || {};
    // Only the pointer per component; the index carries every platform.
    const slim = {};
    for (const [name, builds] of Object.entries(platform)) {
      const entry = Array.isArray(builds) ? builds[0] : null;
      if (entry && entry.manifest && entry.manifest.url) {
        slim[name] = { url: entry.manifest.url, sha1: entry.manifest.sha1 || null, version: (entry.version && entry.version.name) || '' };
      }
    }
    return slim;
  };

  let index;
  try {
    // Stale-served for the same reason as the Fabric answer: the pointer it
    // holds names the runtime already unpacked in `java/`, so an index a day
    // old launches the Java the player has while the fresh copy is fetched
    // behind them (2026-09-22).
    index = await memo.remember(indexKey, JAVA_INDEX_TTL_MS, readIndex, { serveStale: true, graceMs: LOOKUP_GRACE_MS });
    // A component the remembered index has never heard of — Mojang adds one
    // with each new Java (epsilon for 25, in the winter of 2025) — is asked
    // about afresh before the answer is "none": a copy of the index a few
    // hours old must not send a new Minecraft looking for a Java on the PC.
    if (!index[component]) index = memo.set(indexKey, await readIndex());
  } catch {
    index = memo.stale(indexKey) || null;
  }

  const kept = memo.stale(manifestKey);
  if (!index) return kept ? { files: kept.files, url: kept.url, upgraded: false } : null;

  const pointer = index[component];
  if (!pointer) return 'none';
  if (kept && kept.url === pointer.url) return { files: kept.files, url: kept.url, upgraded: false };

  try {
    const fetched = await fetchIndex(pointer.url);
    const files = slimManifest((fetched && fetched.files) || {});
    // An answer with no files is not a manifest; remembering one would have
    // every launch after find nothing to check.
    if (!Object.keys(files).length) throw new Error('empty runtime manifest');
    memo.set(manifestKey, { url: pointer.url, files });
    return { files, url: pointer.url, upgraded: Boolean(kept) };
  } catch {
    return kept ? { files: kept.files, url: kept.url, upgraded: false } : null;
  }
}

/**
 * A manifest cut to what the verifier reads: per path, the type, and for a
 * file its hash, size, address and whether it is executable; for a link its
 * target. Mojang's copy carries an lzma variant of every file as well, which
 * this launcher has never used — leaving it out keeps the cached copy at
 * about half the size.
 */
function slimManifest(files) {
  const slim = {};
  for (const [relative, spec] of Object.entries(files)) {
    if (!spec || typeof spec !== 'object') continue;
    if (spec.type === 'directory') {
      slim[relative] = { type: 'directory' };
    } else if (spec.type === 'link' && spec.target) {
      slim[relative] = { type: 'link', target: String(spec.target) };
    } else if (spec.type === 'file' && spec.downloads && spec.downloads.raw && spec.downloads.raw.url) {
      const raw = spec.downloads.raw;
      slim[relative] = {
        type: 'file', sha1: raw.sha1 || null, size: Number(raw.size) || 0, url: raw.url,
        executable: Boolean(spec.executable)
      };
    }
  }
  return slim;
}

/**
 * Check a runtime folder against its manifest and put back what is not there.
 *
 * The sweep: every directory is made if missing, every link is looked for,
 * and every file is stat'ed for existence and size — the check that catches
 * a download that stopped halfway and a file an antivirus removed, and costs
 * a few milliseconds for the four hundred files of a runtime. With `full`
 * every file is read and hashed as well (a hundred megabytes, under a
 * second on an SSD), which is what a Retry after a runtime crash asks for:
 * a file of the right length with the wrong bytes is the one case the
 * sweep cannot see.
 *
 * What fails is fetched again through `download()`, which hashes what it
 * fetched before the rename that puts it in place. A file that is present
 * but wrong is removed first — `download()` takes a file at the right size
 * as done, which is exactly the check that failed. A file that cannot be
 * replaced because a running game has it open is left as it is: that game
 * is running on it, so it is whole, and a newer build of it can wait for
 * the launch after that game closes.
 *
 * Progress is the downloads, not the sweep — the sweep is over before a
 * bar could move.
 *
 * @param {string} home     the runtime folder
 * @param {object} files    a manifest as `slimManifest` shapes it
 * @param {object} [options]
 * @param {boolean}  [options.full]      hash every file
 * @param {Function} [options.onProgress]
 * @param {Function} [options.download]  a stand-in for `download()` (tools/check-java-repair.js)
 * @returns {Promise<{ checked: number, repaired: string[], sweepMs: number, ms: number }>}
 */
async function verifyRuntime(home, files, options = {}) {
  const full = Boolean(options.full);
  const fetchFile = options.download || download;
  const onProgress = options.onProgress || null;
  const started = Date.now();

  const entries = Object.entries(files || {});
  const wrong = [];   // [relative, spec, present]

  await pool(entries, full ? HASH_LIMIT : SWEEP_LIMIT, async ([relative, spec]) => {
    const target = path.join(home, relative);
    if (spec.type === 'directory') {
      await ensureDir(target);
      return;
    }
    if (spec.type === 'link') {
      try { await fsp.lstat(target); } catch { wrong.push([relative, spec, false]); }
      return;
    }
    if (spec.type !== 'file') return;

    let stat;
    try {
      stat = await fsp.stat(target);
    } catch {
      wrong.push([relative, spec, false]);
      return;
    }
    if (!stat.isFile() || stat.size !== spec.size) {
      wrong.push([relative, spec, true]);
      return;
    }
    if (full && spec.sha1 && sha1(await fsp.readFile(target)) !== spec.sha1) {
      wrong.push([relative, spec, true]);
    }
  });
  const sweepMs = Date.now() - started;

  const repaired = [];
  if (!wrong.length) {
    if (onProgress) onProgress(1);
    return { checked: entries.length, repaired, sweepMs, ms: Date.now() - started };
  }

  // Deterministic order, for the log line and the check under tools/.
  wrong.sort((a, b) => a[0].localeCompare(b[0]));

  // The bar follows bytes, not files (2026-09-19): a whole runtime is four
  // hundred files, and two of them — the module image and the VM — are most
  // of the megabytes. Counted per file it sat at "Preparing Java 4%" for the
  // whole of a slow connection's minutes and read as a launcher that had
  // stopped. Every file's bytes so far, over the bytes to fetch; a link or a
  // file the manifest gives no size for counts as one byte, so the sum can
  // never be zero.
  const bytesOf = (spec) => (spec.type === 'file' && spec.size > 0 ? spec.size : 1);
  const totalBytes = wrong.reduce((sum, [, spec]) => sum + bytesOf(spec), 0);
  const soFar = new Map();
  const report = () => {
    if (!onProgress) return;
    let got = 0;
    for (const bytes of soFar.values()) got += bytes;
    onProgress(Math.min(1, got / totalBytes));
  };

  await pool(wrong, DOWNLOAD_LIMIT, async ([relative, spec, present]) => {
    const target = path.join(home, relative);
    if (spec.type === 'link') {
      await ensureDir(path.dirname(target));
      await fsp.symlink(spec.target, target).catch(() => {});
      repaired.push(relative);
    } else {
      try {
        if (present) await fsp.rm(target, { force: true });
        await fetchFile(spec.url, target, { sha1: spec.sha1, size: spec.size }, {
          onBytes: (received) => { soFar.set(relative, Math.min(received, bytesOf(spec))); report(); }
        });
        if (spec.executable && process.platform !== 'win32') {
          await fsp.chmod(target, 0o755).catch(() => {});
        }
        repaired.push(relative);
      } catch (error) {
        const busy = error && /EBUSY|EPERM|EACCES/.test(String(error.code || ''));
        if (!(busy && present)) throw error;
      }
    }
    soFar.set(relative, bytesOf(spec));
    report();
  });

  repaired.sort();
  return { checked: entries.length, repaired, sweepMs, ms: Date.now() - started };
}

/* --------------------------------------------------- class data sharing */

/**
 * Give a runtime the class archive Mojang's builds leave out (2026-09-10).
 *
 * A stock JDK ships `classes.jsa` — the JDK's own classes, parsed, verified
 * and laid out once, mapped straight into every JVM that starts. Mojang's
 * runtimes do not carry it: `java -version` on the one the launcher downloads
 * says "mixed mode" and not "mixed mode, sharing", so every Play press had
 * the JVM read and verify the platform's classes from jar files first. The
 * JVM makes its own archive in a few seconds with `-Xshare:dump`, and finds
 * it thereafter at the default place beside the VM library without a flag.
 *
 * Written to a `.part` name and renamed, so a game that starts while this
 * runs never maps a half-written file. Only for runtimes this launcher put on
 * disk (a Java the player pointed Settings at is theirs, and may not be
 * writable), and only from 17 up — the older runtimes' archives cover the
 * client VM alone, which is not the one the game runs on.
 *
 * @returns {Promise<boolean>} true when an archive was written just now
 */
function archiveClasses(home) {
  // One dump per runtime at a time, whoever asked: the press fires this and
  // walks away, and prime()'s warmJava walks the same folder a moment later.
  // Both wrote to the same `${archive}.part` before this lane (2026-09-22),
  // so the second `-Xshare:dump` could rename a file the first was still
  // writing — an archive the VM then refuses in silence, for ever, because
  // it exists.
  return lane('archive:' + home, () => dumpArchive(home));
}

async function dumpArchive(home) {
  if ((await runtimeMajor(home)) < 17) return false;

  const java = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!(await isPresent(java))) return false;

  // Windows keeps the VM under bin/server, everything else under lib/server;
  // the archive lives beside it.
  const server = serverDir(home);
  if (!server) return false;

  const archive = path.join(server, 'classes.jsa');
  if (await isPresent(archive)) return false;

  const part = `${archive}.part`;
  await fsp.rm(part, { force: true }).catch(() => {});
  await new Promise((resolve, reject) => {
    execFile(java, [`-XX:SharedArchiveFile=${part}`, '-Xshare:dump'],
      { windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
      (error) => (error ? reject(error) : resolve()));
  });
  await fsp.rename(part, archive);
  return true;
}

/** The major Java version a runtime folder holds, from its `release` file. */
async function runtimeMajor(home) {
  try {
    const text = await fsp.readFile(path.join(home, 'release'), 'utf8');
    const match = /JAVA_VERSION="(\d+)(?:\.(\d+))?/.exec(text);
    if (!match) return 0;
    // "1.8.0" is Java 8; anything from 9 on leads with the major.
    return Number(match[1]) === 1 ? Number(match[2] || 0) : Number(match[1]);
  } catch {
    return 0;
  }
}

/**
 * Archive the classes of every runtime already on disk.
 *
 * For launchers that downloaded their Java before archives existed — every
 * install in the wild on 2026-09-10 — run from main once the window is up,
 * so the runtime the player already has is fast from the next Play press.
 * One runtime at a time: each dump is a JVM of its own for a few seconds.
 */
async function warmJava(javaRoot) {
  let names;
  try {
    names = await fsp.readdir(javaRoot);
  } catch {
    return 0;
  }
  let written = 0;
  for (const name of names) {
    if (await archiveClasses(path.join(javaRoot, name)).catch(() => false)) written += 1;
  }
  return written;
}

/** Last resort: whatever Java the machine already has. */
async function systemJava(major) {
  const candidates = [];
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'javaw.exe'));
  }

  const roots = [
    path.join(os.homedir(), '.jdks'),
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft\\jdk'
  ];
  for (const root of roots) {
    let names = [];
    try { names = await fsp.readdir(root); } catch { continue; }
    for (const name of names) candidates.push(path.join(root, name, 'bin', 'javaw.exe'));
  }

  for (const candidate of candidates) {
    if (await isPresent(candidate)) return candidate;
  }
  throw new Error('No Java ' + major + ' runtime could be downloaded or found on this machine.');
}

/* ------------------------------------------------------------ arguments */

function fill(template, values) {
  return template.replace(/\$\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

/** Flatten one of the `arguments` arrays, applying rules and substitutions. */
function expand(list, values, features) {
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') {
      out.push(fill(item, values));
      continue;
    }
    if (!allowed(item.rules, features)) continue;
    const value = Array.isArray(item.value) ? item.value : [item.value];
    for (const entry of value) out.push(fill(entry, values));
  }
  return out;
}

/**
 * The full argument list for the JVM.
 *
 * Memory and the natives path are ours; everything else comes out of the
 * version JSON, so a version that changes its own arguments keeps working
 * without a change here.
 */
/**
 * The launcher's own tuning flags, per Java major (2026-09-22).
 *
 * Mojang's six are the base every game had from the first day; what a major
 * gets beyond them is decided by the bench in tools/bench (its README has the
 * tables) and nowhere else. A flag the JVM does not know is a game that never
 * starts, so every addition is gated on the major it was measured on — Java 8
 * runs the old vanilla profiles and keeps exactly Mojang's set.
 */
const MOJANG_FLAGS = ['-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20',
  '-XX:G1ReservePercent=20', '-XX:G1HeapRegionSize=32M', '-XX:MaxGCPauseMillis=50'];

/* The string every settings file from 0.1.0 to 1.9.1 carried as game.jvmArgs:
 * the defaults, written into the field. A file still saying it means the
 * player never typed anything, and it is read as empty (main.js moves it to
 * '' once, schema 7). */
const OLD_DEFAULT_JVM_ARGS = MOJANG_FLAGS.join(' ');

function jvmBase(major) {
  return MOJANG_FLAGS;
}

/**
 * What goes between the heap and Mojang's own arguments: the launcher's set
 * for this Java, unless the player typed a set of their own, which replaces
 * it whole — appending would pass two garbage collectors and refuse to start.
 */
function jvmTuning(jvmArgs, major) {
  const typed = String(jvmArgs || '').trim();
  if (!typed || typed === OLD_DEFAULT_JVM_ARGS) return jvmBase(major || 0);
  return typed.split(/\s+/);
}

function buildCommand(options) {
  const {
    json, classpath, clientJar, nativesDir, gameDir, assets,
    account, memoryMb, versionId, librariesDir, jvmArgs, resolution, join, world, javaMajor
  } = options;

  // A size is only passed when the player asked for a windowed one; in
  // fullscreen the game picks the display's own resolution.
  const sized = Boolean(
    resolution && !resolution.fullscreen && resolution.width && resolution.height
  );

  const features = {
    is_demo_user: false,
    has_custom_resolution: sized,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  };

  const full = [...classpath, clientJar].join(CLASSPATH_SEPARATOR);

  const values = {
    auth_player_name: account.username,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    auth_session: 'token:' + account.accessToken + ':' + account.uuid.replace(/-/g, ''),
    auth_xuid: account.xuid || '',
    clientid: account.clientId || '',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_name: versionId,
    version_type: json.type || 'release',
    game_directory: gameDir,
    assets_root: assets.assetsDir,
    game_assets: assets.legacyDir || assets.assetsDir,
    assets_index_name: assets.indexId,
    natives_directory: nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    resolution_width: sized ? resolution.width : 854,
    resolution_height: sized ? resolution.height : 480,
    library_directory: librariesDir,
    classpath: full,
    classpath_separator: CLASSPATH_SEPARATOR
  };

  const jvm = json.arguments && json.arguments.jvm
    ? expand(json.arguments.jvm, values, features)
    : ['-Djava.library.path=' + nativesDir, '-cp', full];

  const game = json.arguments && json.arguments.game
    ? expand(json.arguments.game, values, features)
    : fill(json.minecraftArguments || '', values).split(' ').filter(Boolean);

  const tuning = jvmTuning(jvmArgs, javaMajor);

  return [
    '-Xmx' + memoryMb + 'M',
    '-Xms' + Math.min(memoryMb, memoryMb >= 4096 ? 2048 : 512) + 'M',
    ...tuning,
    ...jvm,
    json.mainClass,
    ...game,
    ...(resolution && resolution.fullscreen ? ['--fullscreen'] : []),
    // Straight to a server (a partner row was pressed). The game's own
    // switch since 1.20; older versions ignore an option they do not know.
    ...(join ? ['--quickPlayMultiplayer', String(join)] : []),
    // Straight into a world (a card on Worlds was pressed, 2026-09-11): the
    // save folder's name under this profile's saves/, same switch family.
    ...(world ? ['--quickPlaySingleplayer', String(world)] : [])
  ];
}

module.exports = {
  CLASSPATH_SEPARATOR,
  OLD_DEFAULT_JVM_ARGS,
  jvmTuning,
  runtimeMajor,
  allowed,
  mavenPath,
  offlineUuid,
  listVersions,
  latestFabricLoader,
  warmFabric,
  resolve,
  ensureClient,
  ensureLibraries,
  ensureAssets,
  ensureJava,
  verifyRuntime,
  javaManifest,
  slimManifest,
  warmJava,
  buildCommand
};
