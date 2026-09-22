'use strict';

/**
 * Putting a profile's mods on disk.
 *
 * The launcher's mod list is metadata — a name, a Modrinth slug, a switch. This
 * turns that list into actual jars in the profile's own `mods` folder just
 * before the game starts, so switching a mod off in the launcher is enough to
 * make it gone from the next launch.
 *
 * Only jars this module put there are ever removed. A jar the player dropped in
 * by hand is left alone, which is why the manifest exists at all.
 */

const path = require('path');
const fsp = require('fs/promises');

const { ensureDir, download, writeFileAtomic } = require('./files');
const companion = require('./companion');
const jar = require('./jar');
const memo = require('./memo');
const pairing = require('./pairing');
const modrinth = require('../modrinth');
const { BUNDLED } = require('../crashes');

const MANIFEST = '.blueclient-mods.json';

/**
 * The half of the companion every version shares, beside the jars (2026-09-10).
 *
 * `scripts/split-mod-jars.mjs` takes it out of the shipped jars and
 * `placeCompanion` below puts it back before the game starts; see game/jar.js
 * for why. Must match SHARED_NAME in that script.
 */
const SHARED_ZIP = 'blueclient-shared.zip';

/**
 * How long Modrinth's answer about a mod is taken on trust.
 *
 * Which jar a project offers for one Minecraft on one loader changes when the
 * author publishes, which is weeks apart; asking again on every Play press
 * put a round-trip per mod — always at least two, for the companion's Fabric
 * API — between the click and the game, on launches where every one of those
 * jars was already sitting in the folder.
 */
const LOOKUP_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long a press waits for a stale lookup to be renewed before going with
 * the jar it already knows (2026-09-22). See memo.remember, and resolveFile.
 */
const LOOKUP_GRACE_MS = 700;

/**
 * How long a settled pairing is kept (2026-09-11).
 *
 * The set of jars the launcher chose for one profile was checked against
 * each jar's own rules once (game/pairing.js), and what it found — which
 * build had to be held back, or that none did — is remembered against the
 * newest builds it was found for. It stays true until one of those newest
 * builds changes, which is the only thing that could change the answer, so
 * the age here is only a backstop; the ids are the real test.
 */
const PAIRING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Which reading of the jars' rules a remembered pairing was found under
 * (2026-09-20). game/pairing.js read `<0.8.7-` — MaLiLib's spelling of
 * "anything under 0.8.7", an empty pre-release the loader accepts — as a
 * plain string until that day, and took a `breaks` it could not read for a
 * conflict; every launcher from 1.0.0 to 1.3.2 that met one remembered
 * three false quarrels as "no way out" for thirty days, and launched a
 * Sodium the real quarrel should have moved. A record found under the old
 * reading is not read: bump this whenever the grammar changes what a set
 * of jars is found to say.
 */
const PAIRING_GRAMMAR = 2;

/**
 * Which jar to install, from memory where it can be.
 *
 * Only an answer is remembered, never a failure: a Modrinth that is briefly
 * unreachable must not have that fact cached for six hours. And when the live
 * ask fails with something remembered from before, the remembered one wins —
 * that jar is on disk already, so the launch goes ahead offline instead of
 * reporting a mod it cannot install.
 */
async function resolveFile(slug, name, version, loader) {
  const key = `mod:${slug}:${version}:${loader}`;
  // An answer remembered before 2026-09-11 has no build id and names its
  // dependencies as bare strings; it is asked again rather than read.
  const cached = memo.get(key, LOOKUP_TTL_MS);
  if (cached && cached.id) return cached;

  // An expired answer is handed back at once and asked again behind the press
  // (2026-09-22). The jar it names is the one already in the profile's folder,
  // so a lookup six hours past its keep-by launches the set the player played
  // with last time; asking Modrinth first cost a wave of round trips — twelve
  // seconds each on a bad line — in front of the game, for an answer that in
  // the ordinary case comes back identical. The renewal lands before the next
  // press, which is when a genuinely newer build should arrive anyway.
  const old = memo.stale(key);
  if (old && old.id) {
    const job = memo.refresh(key, async () => {
      const fresh = await modrinth.file({ slug, version, loader });
      if (!fresh || !fresh.ok) throw new Error('not now');
      return fresh;
    });
    // A Modrinth answering at its usual speed still decides this launch, so
    // a newer build lands on the press after it is published, as it always
    // did; one that is slow tonight finishes behind the player.
    // The grace runs from when the renewal started (memo.within), which for
    // a press is the moment it began (Session._run's prefetch).
    const raced = await memo.within(job, LOOKUP_GRACE_MS);
    const now = raced ? memo.stale(key) : null;
    return shaped(now && now.id ? now : old);
  }

  const live = await modrinth.file({ slug, version, loader });
  if (live && live.ok) return memo.set(key, live);

  // Modrinth answering "there is no build of this for Minecraft X" is an
  // answer, not a failure (2026-09-22): falling back to a remembered one here
  // re-installed a build the author has since withdrawn, and the game then
  // refused to start with a jar the launcher had just put back. Only an
  // unreachable Modrinth reads from memory.
  if (live && live.noBuild) return live;

  const remembered = memo.stale(key);
  return remembered ? shaped(remembered) : live;
}

/**
 * Renew every lookup a press on these profiles would need (2026-09-22).
 *
 * `Launcher.prime` calls this once the window is up and every ten minutes
 * after, so the answers `resolveFile` reads are fresh by the time anybody
 * presses Play. One ask per project per version-and-loader, whatever it is
 * called on the Mods page; Fabric API is in the list because every Fabric
 * launch needs it and nothing on the page names it. A key still well inside
 * its keep-by is left alone (memo.due), so this costs nothing on a launcher
 * opened twice in an hour. Never throws.
 *
 * Since the same day it is also what a press calls first, for its own
 * profile (Session._run), so the asks it would otherwise make one wave at a
 * time — and after the Fabric and Java stages — all leave at once. For that
 * the asks run side by side rather than one after another, and the projects
 * the remembered answers name as required come too: those are the press's
 * second wave, which nothing renewed before, and which paid its own round
 * trip once they had aged out.
 *
 * @param {{ version: string, loader: string, mods: object[] }[]} profiles
 */
async function warmLookups(profiles, aheadMs) {
  const keys = new Map();
  for (const profile of profiles || []) {
    const { version, loader } = profile || {};
    if (!version || loader !== 'fabric') continue;
    const slugs = ['fabric-api'];
    for (const mod of profile.mods || []) {
      if (!mod || !mod.slug || mod.enabled === false) continue;
      if (mod.since && !companion.atLeast(version, mod.since)) continue;
      slugs.push(mod.slug);
    }
    const listed = slugs.map((slug) => memo.stale(`mod:${slug}:${version}:${loader}`));
    const have = new Set(listed.filter((answer) => answer && answer.projectId).map((answer) => answer.projectId));
    for (const slug of slugs) keys.set(`mod:${slug}:${version}:${loader}`, { slug, version, loader });
    // The required projects the list does not already name, as sync's second
    // wave would ask for them (by id).
    for (const answer of listed) {
      for (const dep of (answer && Array.isArray(answer.dependencies) ? answer.dependencies : [])) {
        if (!dep || dep.type !== 'required' || !dep.projectId || have.has(dep.projectId)) continue;
        keys.set(`mod:${dep.projectId}:${version}:${loader}`, { slug: dep.projectId, version, loader });
      }
    }
  }

  await Promise.all([...keys].map(([key, { slug, version, loader }]) => {
    const known = memo.stale(key);
    if (known && known.id && !memo.due(key, LOOKUP_TTL_MS, aheadMs)) return null;
    return memo.refresh(key, async () => {
      const answer = await modrinth.file({ slug, version, loader });
      // A failure is never remembered, and neither is "no build for this
      // Minecraft": the first is Modrinth's evening, the second is an answer
      // `resolveFile` has to hear live so it can refuse to put a withdrawn
      // jar back (see there).
      if (!answer || !answer.ok) throw new Error('not now');
      return answer;
    }).catch(() => {});
  }));
}

/** A remembered answer in today's shape, whatever launcher wrote it. */
function shaped(resolved) {
  if (!resolved || !resolved.ok || !Array.isArray(resolved.dependencies)) return resolved;
  return {
    ...resolved,
    dependencies: resolved.dependencies.map((d) => (
      typeof d === 'string' ? { projectId: d, versionId: null, type: 'required' } : d
    ))
  };
}

async function exists(file) {
  try { await fsp.stat(file); return true; } catch { return false; }
}

/**
 * The companion's own half and the shared half, joined into the profile's
 * jar — once per change of either, because the join reads and writes five
 * megabytes. The jar carries a note of what it was made from in its zip
 * comment: the two files' sizes and times, the same test `differs` makes for
 * a plain copy. A jar whose note says the same two files is the one that
 * would be written again, so it is left alone; a jar with no note is a whole
 * copy an older launcher made, and is replaced once.
 *
 * @returns {Promise<boolean>} true when the jar was written
 */
async function placeCompanion(ownFile, sharedFile, target) {
  const [own, shared] = await Promise.all([fsp.stat(ownFile), fsp.stat(sharedFile)]);
  const note = `blueclient:${own.size}:${Math.round(own.mtimeMs)}:${shared.size}:${Math.round(shared.mtimeMs)}`;
  if ((await jar.readComment(target)) === note) return false;
  await jar.assemble(ownFile, sharedFile, target, note);
  return true;
}

/** True when `to` is missing, or is not the same file `from` now is. */
async function differs(from, to) {
  try {
    const [source, existing] = await Promise.all([fsp.stat(from), fsp.stat(to)]);
    return source.size !== existing.size || source.mtimeMs > existing.mtimeMs;
  } catch {
    return true;
  }
}

async function readManifest(modsDir) {
  try {
    const raw = await fsp.readFile(path.join(modsDir, MANIFEST), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch {
    return [];
  }
}

async function writeManifest(modsDir, files) {
  // Only when it would say something different (2026-09-22). This is the one
  // file in the mods folder rewritten on a press where nothing changed, and
  // a write into the profile's mods folder is a change Windows' own indexer
  // and every file watcher on the PC then follows.
  const body = JSON.stringify({ files }, null, 2);
  const file = path.join(modsDir, MANIFEST);
  try { if (await fsp.readFile(file, 'utf8') === body) return; } catch { /* write it */ }
  // Whole or not at all (2026-09-22, files.writeFileAtomic): a manifest cut
  // short reads as an empty one, and an empty one owns no jar — every mod
  // the launcher installed would be left in the folder for good, unretired.
  await writeFileAtomic(file, body, 'utf8');
}

/**
 * Bring `<instance>/mods` in line with the profile.
 *
 * Never throws for a single mod that cannot be resolved: one mod without a
 * build for this version should cost that mod, not the launch. The names come
 * back in `failed` so the caller can say so.
 */
async function sync({ instanceDir, mods = [], version, loader, companionDir, onProgress }) {
  const modsDir = path.join(instanceDir, 'mods');
  await ensureDir(modsDir);

  const previous = await readManifest(modsDir);
  const wanted = [];
  const failed = [];
  // The launcher's own performance stack, where this Minecraft has no build
  // of it yet — left out without a word to the player (below), named here
  // for the launch log.
  const missing = [];

  // The companion mod is what draws the in-game menu, so a Fabric profile gets
  // it whether or not the player added anything else — but only the one jar
  // built for the version this profile runs. Fabric Loader treats a mod it
  // cannot satisfy as fatal, so shipping the wrong one would mean the profile
  // refuses to start at all (fixed 2026-09-02; one jar became several on
  // 2026-09-04, and picking between them is companion.pick).
  //
  // It always lands as `blueclient.jar` whatever it was called in the folder,
  // so switching a profile from 1.21.1 to 1.21.4 replaces the jar rather than
  // leaving two of them for Fabric to argue about.
  let companionSkipped = null;
  let companionCarries = null;
  if (loader === 'fabric' && companionDir) {
    const hit = await companion.pick(companionDir, version);
    if (hit) {
      // Since 2026-09-10 the jar in the folder is only this version's own
      // half, and the rest sits once in the shared zip beside it. A folder
      // without one — an older build's resources, or the half-applied update
      // that leaves a new launcher over old jars — holds whole jars, and
      // those are copied as they always were.
      const shared = path.join(companionDir, SHARED_ZIP);
      wanted.push({
        kind: 'local',
        filename: 'blueclient.jar',
        from: hit.jar,
        shared: (await exists(shared)) ? shared : null
      });
    } else {
      companionSkipped = { version };
      companionCarries = (await companion.coverage(companionDir)).ranges.join(', ') || null;
    }
  }

  // A mod that only exists from some Minecraft on — LambDynamicLights has no
  // build for 1.20.5 or 1.20.6 — says so with `since`, and on an older
  // profile is left out without a word (2026-09-11). Anything else that has
  // no build is still reported below: a mod the player added and cannot
  // have is worth a warning; one the launcher put there and knows about is
  // not, and the game's own page for it explains itself.
  const switchedOn = mods
    .filter((mod) => mod.enabled !== false)
    .filter((mod) => !mod.since || companion.atLeast(version, mod.since));
  const enabled = switchedOn.filter((mod) => mod.slug);

  // A mod with no slug cannot be looked up, so it can never be installed.
  // Dropping it quietly is worse than failing: the launcher would keep listing
  // it as on while the game ran without it.
  for (const mod of switchedOn) {
    if (!mod.slug) failed.push(`${mod.name || 'Unnamed mod'}: no Modrinth id, cannot install`);
  }

  // Vanilla has no loader, so a jar in its mods folder does nothing at all.
  // The folder is still reconciled below, which is what clears out the jars a
  // profile picked up while it was on Fabric.
  const unsupported = loader !== 'fabric' && enabled.length > 0;

  const slugs = [];
  if (loader === 'fabric') {
    slugs.push({ slug: 'fabric-api', name: 'Fabric API' });
    for (const mod of enabled) {
      if (slugs.some((entry) => entry.slug === mod.slug)) continue;
      slugs.push({ slug: mod.slug, name: mod.name });
    }
  }

  // Resolve in waves rather than one at a time: everything in a wave is
  // looked up in parallel, and required dependencies join the next wave —
  // Iris without Sodium does not start the game, it stops it. Waves keep a
  // launch from spending seconds in sequential round-trips to Modrinth.
  let wave = [...slugs];
  const seen = new Set(slugs.map((entry) => entry.slug));
  let done = 0;
  let unresolved = false;

  while (wave.length) {
    const results = await Promise.all(wave.map(async (entry) => ({
      entry,
      resolved: await resolveFile(entry.slug, entry.name, version, loader)
    })));

    const next = [];
    for (const { entry, resolved } of results) {
      done += 1;
      if (!resolved.ok) {
        // "No build for Minecraft 26.3 on fabric" is Modrinth's answer, not
        // Modrinth unreachable (2026-09-19): it must not hold the folder's
        // old jars in place the way a dropped connection does — a build for
        // the version before is exactly what Fabric refuses to start with —
        // and for a mod the launcher itself put on the list (the performance
        // stack, crashes.js's BUNDLED) it is not worth a red toast on every
        // press of Play for the first weeks of a new Minecraft. A mod the
        // player added and cannot have is still said.
        const none = /^No build for Minecraft/.test(String(resolved.error || ''));
        const ours = none && BUNDLED.has(String(entry.slug || '').toLowerCase());
        if (ours) missing.push(`${entry.name}: ${resolved.error}`);
        else failed.push(`${entry.name}: ${resolved.error}`);
        if (!none) unresolved = true;
        continue;
      }
      // The player's list names a project by its slug and a dependency
      // names it by its id — Sodium is `sodium` on the Mods page and
      // `AANobbMI` in Iris's list — so a project already resolved this wave
      // is marked under both before any dependency is read, or the same jar
      // would be resolved, fetched and checked twice (2026-09-11).
      seen.add(resolved.projectId);
      if (wanted.some((item) => item.kind === 'remote' && item.build.projectId === resolved.projectId)) continue;
      wanted.push(remote(entry, resolved));
    }
    for (const { entry, resolved } of results) {
      if (!resolved.ok) continue;
      for (const dep of resolved.dependencies || []) {
        if (dep.type !== 'required' || seen.has(dep.projectId)) continue;
        seen.add(dep.projectId);
        next.push({ slug: dep.projectId, name: `${entry.name} needs ${dep.projectId}` });
      }
    }

    wave = next;
    if (onProgress) onProgress(done / (done + wave.length));
  }

  // The newest of each project is not always a set Fabric will load
  // (game/pairing.js). What the last check of this same set decided is
  // applied before anything is fetched, so a build held back last time is
  // not downloaded, refused and fetched again on every press.
  const pairKey = `pairing:${version}:${loader}:${wanted.filter((w) => w.kind === 'remote').map((w) => w.key).sort().join(',')}`;
  const remembered = loader === 'fabric' ? recall(pairKey, wanted) : null;
  if (remembered) {
    for (const item of wanted) {
      const pick = item.kind === 'remote' && remembered.picks[item.key];
      if (pick) Object.assign(item, remote(item, pick));
    }
    // A build that was held back may need a project its newer self did not;
    // the waves above resolved the newer self, so those come from memory too.
    for (const extra of remembered.added || []) wanted.push(remote(extra, extra.build));
  }

  // Fetch anything not already sitting there with the right hash. Only what
  // actually lands on disk goes into the manifest — a failed download must
  // not be recorded as installed.
  const installed = new Set();
  let companionLocked = false;
  // A download that fell over is not "this mod is no longer wanted"
  // (2026-09-22). Until today only a failed *lookup* set `unresolved`, so a
  // jar whose fetch timed out was absent from `installed`, fell out of
  // `keep`, and the retire loop below deleted the copy that had been working
  // since the last launch — a dropped connection mid-download turned a mod
  // the player had into a mod they no longer have. A failed place holds the
  // folder exactly as a failed lookup does; the next press fetches it again.
  let unplaced = false;
  for (const item of wanted) {
    if (await place(modsDir, item)) installed.add(item.filename);
    else if (item.locked) companionLocked = true;
    else { unplaced = true; failed.push(...item.failed.splice(0)); }
  }

  // Do the jars in the folder agree to load together? Asked of the jars
  // themselves, and only when the answer is not already known for exactly
  // these files. Nothing to read on a second press: the remembered answer
  // names the files it cleared.
  //
  // The player's own jars — dropped in by hand, or brought over by Import
  // profiles — are in the folder Fabric reads too (2026-09-20). They join
  // the check as fixed entries: never moved, never taken off the disk, but
  // a jar the launcher installed that refuses to load beside one is moved
  // the same as beside any other, and two of the player's own that refuse
  // each other are named on the toast instead of on Fabric's own screen.
  // Their names are part of what the remembered answer was found for, so a
  // jar added or switched off since reopens the question.
  const held = [];
  const conflicts = [];
  const onDisk = wanted.filter((item) => installed.has(item.filename));
  const theirs = loader === 'fabric' ? await playersJars(modsDir, previous, installed) : [];
  const filenames = [...onDisk.map((item) => item.filename), ...theirs.map((item) => item.filename)].sort();
  const cleared = remembered && remembered.cleared && sameList(remembered.cleared, filenames);
  const known = remembered && remembered.unsettled && sameList(remembered.files, filenames);
  if (loader === 'fabric' && onDisk.length && !cleared && !known) {
    const outcome = await settle({ modsDir, items: [...onDisk, ...theirs], version, loader, seen });
    held.push(...outcome.held);
    conflicts.push(...outcome.conflicts);
    // What is on disk now is what the settle left there.
    for (const item of wanted) {
      if (item.kind !== 'remote' || !installed.has(item.filename)) continue;
      const now = outcome.items.find((entry) => entry.key === item.key);
      if (!now) continue;
      installed.delete(item.filename);
      Object.assign(item, now);
      installed.add(item.filename);
    }
    const newest = {};
    for (const item of wanted) if (item.kind === 'remote' && item.newest) newest[item.key] = item.newest;
    for (const added of outcome.added) {
      wanted.push(added);
      installed.add(added.filename);
    }
    const picks = {};
    for (const item of outcome.items) if (item.moved) picks[item.key] = item.build;
    const settledNames = [
      ...wanted.filter((item) => installed.has(item.filename)).map((item) => item.filename),
      ...theirs.map((item) => item.filename)
    ].sort();
    // A quarrel still open because a build could not be fetched is Modrinth's
    // evening, not the jars' last word: the next press asks again. Only an
    // answer is remembered, never a failure — the rule resolveFile keeps.
    if (!conflicts.length || !outcome.incomplete) {
      memo.set(pairKey, {
        grammar: PAIRING_GRAMMAR,
        newest,
        picks,
        added: outcome.added.map((item) => ({ key: item.key, name: item.name, build: item.build })),
        held: outcome.held,
        cleared: conflicts.length ? null : settledNames,
        files: settledNames,
        unsettled: conflicts.length ? conflicts : null
      });
    }
  } else if (cleared || known) {
    // The remembered answer stands: say again what it held back and what
    // it could not settle, so this launch's log reads like the first one's.
    held.push(...(remembered.held || []));
    if (known) conflicts.push(...remembered.unsettled);
  }

  // Retire jars we installed on an earlier launch and no longer want — but
  // only when every lookup AND every download succeeded. With Modrinth
  // unreachable nothing resolves, so "no longer wanted" would mean every mod
  // on disk: launching offline must not empty the mods folder.
  const keep = new Set(installed);
  if (unresolved || unplaced) {
    // Held — except a build this same press has just put a newer one of in
    // the folder (2026-09-22). Sodium updated while Lithium's download
    // stalled kept the old Sodium beside the new one, and Fabric refuses to
    // start on two jars of one mod: the hold meant to keep the game working
    // offline was what stopped it (reproduced against a stand-in Modrinth: a
    // press with one update and one failed fetch left sodium-0.6.0.jar and
    // sodium-0.7.0.jar side by side).
    const replaced = await replacedBy(modsDir, previous, installed);
    for (const filename of previous) {
      if (!replaced.has(filename)) { keep.add(filename); continue; }
      await fsp.rm(path.join(modsDir, filename), { force: true }).catch(() => {});
    }
  } else {
    for (const filename of previous) {
      if (keep.has(filename)) continue;
      await fsp.rm(path.join(modsDir, filename), { force: true }).catch(() => {});
    }
  }

  // A jar left over from a launch on a version it did fit would be just as
  // fatal as one installed now, so it goes whether or not the rest of this
  // launch could reach Modrinth. Only ever the copy this launcher installed:
  // one dropped in by hand is the player's business.
  if (companionSkipped && previous.includes('blueclient.jar')) {
    keep.delete('blueclient.jar');
    await fsp.rm(path.join(modsDir, 'blueclient.jar'), { force: true }).catch(() => {});
  }

  await writeManifest(modsDir, [...keep]);
  return { installed: [...keep], failed, missing, held, conflicts, unsupported, companionSkipped, companionCarries, companionLocked };
}

/**
 * The jars an earlier press installed that a jar of this press now stands in
 * for (2026-09-22): the same mod, by the id in its own `fabric.mod.json` —
 * the name Fabric refuses a second copy of — under an older file name. Read
 * only on a press that holds the folder, which is the rare one, and only the
 * launcher's own jars; one that cannot be read is not called a copy of
 * anything and stays held.
 *
 * @returns {Promise<Set<string>>} file names from `previous`
 */
async function replacedBy(modsDir, previous, installed) {
  const out = new Set();
  const left = previous.filter((filename) => !installed.has(filename) && filename !== COMPANION);
  if (!left.length) return out;
  const ids = new Set();
  for (const filename of installed) {
    if (filename === COMPANION) continue;
    const meta = await pairing.read(path.join(modsDir, filename));
    if (meta) ids.add(meta.id);
  }
  for (const filename of left) {
    const meta = await pairing.read(path.join(modsDir, filename));
    if (meta && ids.has(meta.id)) out.add(filename);
  }
  return out;
}

/**
 * The stack's own settings, where the launcher has a say (2026-09-20).
 *
 * Entity Culling's tick culling: an entity it has decided is behind a wall,
 * or out of the camera, is not ticked on the client — and the game's own
 * interpolation of where the server says it is stops with the tick. A mob
 * falling down a farm's shaft hangs in the air where it was last seen and
 * snaps to the floor when it is looked at again; on the 26.x builds it
 * caught entities near the edge of the view as well (tr7zw/EntityCulling
 * #326, #327, #328, the week of 2026-09-20), and Victorian12 saw a room of
 * them "flying" with the window unfocused, until the mouse came back over
 * it. The rendering half of the mod is where the frame rate comes from;
 * the ticking half saves a little on entities nobody is looking at and is
 * what does this. So it is off, in the file the mod reads
 * (`config/entityculling.json`), on every launch that puts the jar in the
 * folder: the file's other keys are kept as they are, a missing file is
 * made with this one key and the mod fills in its own defaults, and a file
 * that already says so is left alone.
 */
async function tune(instanceDir, installed) {
  const culling = installed.some((file) => /^entityculling/i.test(file)) && await tuneEntityCulling(instanceDir);
  const dynamic = installed.some((file) => /^dynamic-fps/i.test(file)) && await tuneDynamicFps(instanceDir);
  return Boolean(culling || dynamic);
}

/** One JSON config file, read forgivingly: an object, or nothing. */
async function readConfig(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* missing, or not ours to read */
  }
  return {};
}

async function tuneEntityCulling(instanceDir) {
  const file = path.join(instanceDir, 'config', 'entityculling.json');
  const root = await readConfig(file);
  if (root.tickCulling === false) return false;
  root.tickCulling = false;
  await ensureDir(path.dirname(file));
  // The mod's own file, whole or not at all (2026-09-22): one cut short is
  // one the mod cannot read, with the player's other keys in it.
  await writeFileAtomic(file, JSON.stringify(root, null, 2));
  return true;
}

/**
 * Dynamic FPS, and the two of its defaults that read as a slow client
 * (2026-09-22). Measured on the benchmark that put our stack beside
 * FastClient's (journal, *Where the frames went*): the mods are not slower —
 * ours drew a quarter more frames than theirs on the same world — and the
 * frame rate players compared was Dynamic FPS's, not the game's. Its own
 * defaults, read out of the jar's default_config.json:
 *
 *   unfocused  → 1 FPS the instant the window loses focus. A Discord popup,
 *                a second monitor, an overlay, and the game stands still:
 *                "30 fps to 1 for 1–2 seconds at the farm", "entities fly
 *                until I focus it again" (Victorian12, 2026-09-20).
 *   abandoned  → 10 FPS after five minutes without input, which is the
 *                player standing at a farm watching it work.
 *
 * So unfocused draws 60 (still a fifteenth of an uncapped game — the mod's
 * gift to a laptop behind Discord is kept) and idle draws 30. The volume dip
 * and the rest are the mod's own and stay. The file is the mod's diff
 * against its defaults (it writes only what differs), so a missing key is
 * the default and gets ours; a value the player set to anything else is
 * theirs and is left alone; a file that already says so is not touched.
 */
const DFPS = [
  { state: 'unfocused', key: 'frame_rate_target', theirs: 1, ours: 60 },
  { state: 'abandoned', key: 'frame_rate_target', theirs: 10, ours: 30 }
];
async function tuneDynamicFps(instanceDir) {
  const file = path.join(instanceDir, 'config', 'dynamic_fps.json');
  const root = await readConfig(file);
  if (!root.states || typeof root.states !== 'object' || Array.isArray(root.states)) root.states = {};
  let changed = false;
  for (const { state, key, theirs, ours } of DFPS) {
    if (!root.states[state] || typeof root.states[state] !== 'object') root.states[state] = {};
    const have = root.states[state][key];
    if (have !== undefined && have !== theirs) continue;      // the player's own number
    if (have === ours) continue;
    root.states[state][key] = ours;
    changed = true;
  }
  if (!changed) return false;
  await ensureDir(path.dirname(file));
  // The mod's own file, whole or not at all (2026-09-22): one cut short is
  // one the mod cannot read, with the player's other keys in it.
  await writeFileAtomic(file, JSON.stringify(root, null, 2));
  return true;
}

/** A wave's answer as an item of the folder: the file, and what Modrinth said of the build. */
function remote(entry, resolved) {
  const { ok, error, ...build } = resolved;
  return {
    kind: 'remote',
    key: entry.key || entry.slug,
    name: entry.name,
    build,
    // The newest build for this project, kept even after a settle moves the
    // item off it: it is what the remembered pairing is checked against.
    newest: entry.newest || build.id,
    filename: build.file ? build.file.filename : undefined,
    file: build.file,
    failed: []
  };
}

/**
 * Put one item on disk. False, with the reason on the item, when it could
 * not be.
 */
async function place(modsDir, item) {
  // An item with no file name — a remembered answer from a launcher that
  // shaped it differently — is a mod that could not be placed, not a launch
  // that fails on a sentence about a "path" argument (2026-09-19).
  if (typeof item.filename !== 'string' || !item.filename) {
    item.failed = [`${item.name || 'A mod'}: no file to install`];
    return false;
  }
  const target = path.join(modsDir, item.filename);
  try {
    if (item.kind === 'local') {
      // The companion is rebuilt between releases, so the name is no proof
      // the jar in the folder is the current one. Its size and the time it
      // was written are: a launcher that has just updated brings a jar that
      // differs in both, and one that has not saves copying several
      // megabytes into every profile on every launch.
      if (item.shared) await placeCompanion(item.from, item.shared, target);
      else if (await differs(item.from, target)) await fsp.copyFile(item.from, target);
    } else {
      await download(item.file.url, target, item.file);
    }
    return true;
  } catch (error) {
    // The companion jar is open in a game that is still running — Windows
    // will not let the new one be renamed over it — so the game about to
    // start loads the old one, menu and all (2026-09-13: a launcher that had
    // just updated itself, a second Play while the first game was still up,
    // and the new Textures button did nothing because the jar was the old
    // release's). Named for what it is rather than as "a mod was skipped",
    // because the fix is the player's — close the other game — and the
    // symptom is every new in-game feature quietly missing.
    if (item.kind === 'local' && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
      item.locked = true;
      item.failed = [];
      return false;
    }
    item.failed = [`${item.filename}: ${error.message}`];
    return false;
  }
}

/**
 * The pairing remembered for this set, if it was found against the same
 * newest builds the waves just resolved. A different newest for any one
 * project means the question is open again.
 */
function recall(pairKey, wanted) {
  const remembered = memo.get(pairKey, PAIRING_TTL_MS);
  if (!remembered || !remembered.newest || !remembered.picks) return null;
  if (remembered.grammar !== PAIRING_GRAMMAR) return null;
  for (const item of wanted) {
    if (item.kind !== 'remote') continue;
    if (remembered.newest[item.key] !== item.newest) return null;
  }
  return remembered;
}

function sameList(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Ask the jars in the folder whether they agree, and move the ones that do
 * not (game/pairing.js does the asking and the deciding; this is what the
 * disk and Modrinth look like to it). A build that moves may need something
 * its newer self did not — a required project not yet in the folder — and
 * that is fetched afterwards, then the set is asked once more.
 *
 * @returns {Promise<{ items: object[], added: object[], held: object[], conflicts: string[] }>}
 */
async function settle({ modsDir, items, version, loader, seen }) {
  const entries = [];
  for (const item of items) {
    const meta = item.meta !== undefined ? item.meta : await pairing.read(path.join(modsDir, item.filename));
    entries.push({ ...item, meta, fixed: item.kind !== 'remote', moved: false });
  }

  const world = {
    // The build the other side's author pinned for the mover's project, if
    // it is one that fits this profile at all.
    pinned: async (other, mover) => {
      const dep = (other.dependencies || []).find((d) => d.versionId && d.projectId === mover.build.projectId);
      if (!dep) return null;
      const found = await modrinth.build(dep.versionId);
      if (!found.ok) return null;
      if (!found.gameVersions.includes(version)) return null;
      if (found.loaders.length && !found.loaders.includes(loader)) return null;
      return found;
    },
    older: async (mover) => {
      const found = await modrinth.builds({ slug: mover.key, version, loader });
      return found.ok ? found.builds : null;
    },
    place: async (mover, candidate) => {
      if (candidate.file.filename === mover.filename) throw new Error('same file name as the build it would replace');
      const target = path.join(modsDir, candidate.file.filename);
      await download(candidate.file.url, target, candidate.file);
      const { ok, error, ...build } = candidate;
      return { ...mover, build, filename: build.file.filename, file: build.file, meta: await pairing.read(target), moved: true };
    },
    discard: async (entry) => {
      if (entry.fixed) return;
      await fsp.rm(path.join(modsDir, entry.filename), { force: true }).catch(() => {});
    }
  };

  const held = [];
  const added = [];
  let current = entries;
  let unsettled = [];
  let incomplete = false;
  for (let pass = 0; pass < 2; pass++) {
    const outcome = await pairing.settle(current, world);
    current = outcome.set;
    unsettled = outcome.unsettled;
    incomplete = incomplete || Boolean(outcome.incomplete);
    held.push(...outcome.moved);
    if (!outcome.moved.length) break;

    // The moved builds' own required projects, where the folder lacks them.
    const have = new Set(current.map((entry) => entry.build && entry.build.projectId).filter(Boolean));
    let grew = false;
    for (const entry of current) {
      if (!entry.moved) continue;
      for (const dep of entry.build.dependencies || []) {
        if (dep.type !== 'required' || have.has(dep.projectId) || seen.has(dep.projectId)) continue;
        seen.add(dep.projectId);
        const resolved = await resolveFile(dep.projectId, dep.projectId, version, loader);
        if (!resolved.ok) continue;
        const item = remote({ slug: dep.projectId, name: `${entry.name} needs ${dep.projectId}` }, resolved);
        if (!(await place(modsDir, item))) continue;
        have.add(item.build.projectId);
        const fresh = { ...item, meta: await pairing.read(path.join(modsDir, item.filename)), fixed: false, moved: false };
        current.push(fresh);
        added.push(item);
        grew = true;
      }
    }
    if (!grew) break;
  }

  return {
    items: current.filter((entry) => entry.kind === 'remote'),
    added,
    held,
    conflicts: unsettled.map(pairing.explain),
    incomplete
  };
}

/**
 * The player's own jars, as the pairing check sees them (2026-09-20): every
 * `.jar` in the folder that is not the manifest's, not this launch's, and
 * not the companion — the same set `local` lists, switched-off ones left
 * out since Fabric leaves them out. Each is read for its rules and marked
 * fixed; one that cannot be read still stands in the set, by name, so a
 * quarrel with it is at least named. The rules are remembered per file, size
 * and time, so a second press opens no jar the way it opened none before.
 */
const rulesRead = new Map();

async function playersJars(modsDir, previous, installed) {
  let names;
  try {
    names = await fsp.readdir(modsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const owned = new Set([...previous, ...installed].map((f) => String(f).toLowerCase()));
  const out = [];
  for (const entry of names) {
    if (!entry.isFile() || entry.name.startsWith('.') || !/.jar$/i.test(entry.name)) continue;
    const lower = entry.name.toLowerCase();
    if (owned.has(lower) || lower === COMPANION) continue;
    const full = path.join(modsDir, entry.name);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) continue;
    const key = `${full}|${stat.size}|${stat.mtimeMs}`;
    if (!rulesRead.has(key)) rulesRead.set(key, await pairing.read(full));
    out.push({
      kind: 'player',
      filename: entry.name,
      name: entry.name.replace(/.jar$/i, ''),
      meta: rulesRead.get(key),
      fixed: true,
      moved: false
    });
  }
  return out;
}

/* ------------------------------- the jars the launcher did not put there */

/**
 * Every jar in the folder that is the player's rather than the manifest's
 * (2026-09-19).
 *
 * The Mods page listed only the profile's own list — the entries with a
 * Modrinth slug that `sync` installs — and a jar that reached the folder any
 * other way was invisible: one dropped in by hand, or one Import profiles
 * copied over because Modrinth did not know its hash (game/import.js,
 * `bring`). A player told Adrian "not all mods were seen after importing",
 * and Adrian: "make so all installed mods are seen and can be
 * enabled/disabled, rather than just some (the basic ones), easier to toggle
 * rather than having to manually disable in mod menu or having to delete the
 * mods." So the three calls below list those jars, switch one off and on,
 * and bin one — and nothing else in this module changes: `sync` still
 * retires only what its manifest names, and the pairing check still reads
 * only the jars it installed itself, so a local jar is never moved, deleted
 * or re-enabled by a launch.
 *
 * Off is the file renamed `<name>.jar.disabled` — Fabric Loader loads only
 * `*.jar`, Lunar and Prism switch a mod off the same way, and `import.js`
 * already reads a jar so named as disabled — and on is the rename back.
 * What a card says is read out of the jar's own `fabric.mod.json`: name,
 * version, description, authors, and the icon the file names, as a data URI
 * when it is one the page can carry. A jar that cannot be opened, or has no
 * `fabric.mod.json`, still lists — by its file name, with nothing under it —
 * because a file the page cannot see is exactly the complaint.
 *
 * Hidden, as before: everything in the manifest (Fabric API, the mods the
 * launcher installs) and `blueclient.jar` under any name, since `sync`
 * replaces that one with the companion on the next launch whatever is there.
 */

const DISABLED = '.disabled';
/** The companion's file name in every profile's folder — never a card. */
const COMPANION = 'blueclient.jar';
/** The largest icon a card carries as a data URI (the same cap packs.js keeps). */
const ICON_MAX_BYTES = 256 * 1024;

/** `x.jar.disabled` → `x.jar`; `x.jar` → itself. */
const baseName = (file) => (file.toLowerCase().endsWith(`.jar${DISABLED}`) ? file.slice(0, -DISABLED.length) : file);
const isDisabled = (file) => file.toLowerCase().endsWith(`.jar${DISABLED}`);
const isJarName = (file) => /\.jar(\.disabled)?$/i.test(file);

/**
 * A file name the renderer may hand back: one path segment, not hidden, a
 * jar on or off, not the companion, and not one the manifest owns. Anything
 * else is refused before a path is made from it.
 */
async function localName(modsDir, file) {
  const name = String(file || '');
  if (!name || name !== path.basename(name) || /[\\/]/.test(name) || name.startsWith('.')) throw new Error('bad name');
  if (!isJarName(name)) throw new Error('not a jar');
  if (baseName(name).toLowerCase() === COMPANION) throw new Error('the companion is not a local mod');
  const owned = new Set((await readManifest(modsDir)).map((f) => String(f).toLowerCase()));
  if (owned.has(name.toLowerCase())) throw new Error('the launcher owns that jar');
  return name;
}

/** Fabric's `authors`: strings, or objects with a `name`, as one line. */
function authorsLine(authors) {
  if (!Array.isArray(authors)) return '';
  return authors
    .map((a) => (typeof a === 'string' ? a : a && typeof a.name === 'string' ? a.name : ''))
    .filter(Boolean)
    .join(', ');
}

/** Fabric's `icon`: a path, or a table of them by size — the largest is taken. */
function iconPath(icon) {
  if (typeof icon === 'string') return icon;
  if (!icon || typeof icon !== 'object') return null;
  const sizes = Object.keys(icon).filter((k) => /^\d+$/.test(k) && typeof icon[k] === 'string').map(Number);
  return sizes.length ? icon[String(Math.max(...sizes))] : null;
}

/**
 * A jar's `depends.minecraft`, as the list of rules pairing.js reads (or null).
 * Fabric spells it as one string or an array of them, and either means "any
 * one of these"; anything else is no rule at all.
 */
function mcRules(depends) {
  if (!depends || typeof depends !== 'object' || Array.isArray(depends)) return null;
  const rule = depends.minecraft;
  if (typeof rule === 'string') return [rule];
  if (Array.isArray(rule)) {
    const list = rule.filter((r) => typeof r === 'string');
    return list.length ? list : null;
  }
  return null;
}

/**
 * Whether this Minecraft satisfies a jar's own rule about it (2026-09-22).
 *
 * True, false, or **null for "the launcher is not going to say"** — no rule, no
 * version to test, a rule the loader itself could not read, or a Minecraft that
 * is not a version number at all (a snapshot id like `26w03a`, which Fabric
 * normalises and we do not). Only a plain false is ever shown to the player:
 * a card must never accuse a jar that would have loaded.
 */
function fitsVersion(needs, version) {
  if (!needs || !needs.length || !version) return null;
  if (!/^\d+(\.\d+)+$/.test(String(version))) return null;
  if (!needs.every(readableRule)) return null;
  const verdict = pairing.verdict(version, needs);
  return verdict === false ? false : verdict === true ? true : null;
}

/* One term of a rule: an optional comparison and a version number, a
 * wildcard, or `*`. A rule with anything else in it — `whenever`, a name, a
 * shape Fabric's own parser would throw on — is one the launcher says
 * nothing about: it could neither judge it nor write it in words. */
const RULE_TERM = /^(?:>=|<=|>|<|\^|~|=)?(?:\d+(?:\.\d+)*(?:\.[xX*])?|\*)$/;

function readableRule(rule) {
  const terms = String(rule || '').trim().replace(/([><=^~]+)\s+/g, '$1').split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every((term) => RULE_TERM.test(term));
}

/** Remembered per file and stamp: a jar's own words do not change under us. */
const described = new Map();

/**
 * What one jar says of itself, read the way pairing.js reads its rules —
 * the central directory and two entries, never the whole file.
 */
async function describeJar(file, stat) {
  const key = `${file}|${stat.size}|${stat.mtimeMs}`;
  if (described.has(key)) return described.get(key);

  const out = { read: false, name: '', version: '', description: '', author: '', icon: '', needs: null };
  let zip = null;
  try {
    zip = await jar.open(file);
    const entry = zip.entries.find((e) => e.name === 'fabric.mod.json');
    if (entry) {
      const chunks = [];
      for await (const chunk of zip.stream(entry)) chunks.push(chunk);
      const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (json && typeof json === 'object') {
        out.read = true;
        out.name = typeof json.name === 'string' ? json.name : '';
        out.version = typeof json.version === 'string' ? json.version : '';
        out.description = typeof json.description === 'string' ? json.description.replace(/\s+/g, ' ').trim() : '';
        out.author = authorsLine(json.authors);
        // Which Minecraft the jar's own author says it needs — the rule Fabric
        // Loader refuses to start on (2026-09-22). Read the way pairing.js
        // reads any rule, so a string and a list both come back as a list.
        out.needs = mcRules(json.depends);
        const wanted = iconPath(json.icon);
        const png = wanted && zip.entries.find((e) => e.name === wanted.replace(/^\//, ''));
        if (png && png.size > 0 && png.size <= ICON_MAX_BYTES) {
          const bytes = [];
          for await (const chunk of zip.stream(png)) bytes.push(chunk);
          out.icon = `data:image/png;base64,${Buffer.concat(bytes).toString('base64')}`;
        }
      }
    }
  } catch {
    /* a jar that cannot be read still lists by its name */
  } finally {
    if (zip) await zip.close().catch(() => {});
  }
  described.set(key, out);
  return out;
}

/**
 * The player's own jars in one profile's folder, by name.
 *
 * `version` is the Minecraft the profile launches, when the caller knows it:
 * each jar then also says whether its own `depends.minecraft` covers it
 * (`fits`, with `needs` as the rule in the author's words), which is the one
 * thing a hand-dropped jar never tells the player until the game refuses to
 * start (2026-09-22).
 *
 * @returns {Promise<{ok: boolean, mods: object[]}>}
 */
async function local(modsDir, version = '') {
  let names;
  try {
    names = await fsp.readdir(modsDir, { withFileTypes: true });
  } catch {
    // A profile that has never launched has no folder yet, and no jars.
    return { ok: true, mods: [] };
  }
  const owned = new Set((await readManifest(modsDir)).map((f) => String(f).toLowerCase()));

  const out = [];
  for (const entry of names) {
    if (!entry.isFile() || entry.name.startsWith('.') || !isJarName(entry.name)) continue;
    const lower = entry.name.toLowerCase();
    if (owned.has(lower) || baseName(lower) === COMPANION) continue;

    const full = path.join(modsDir, entry.name);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) continue;
    const info = await describeJar(full, stat);
    out.push({
      file: entry.name,
      name: info.name || baseName(entry.name).replace(/\.jar$/i, ''),
      version: info.version,
      description: info.description,
      author: info.author,
      icon: info.icon,
      // False for a jar with no fabric.mod.json the launcher could open:
      // the card then says so in place of a sentence.
      read: info.read,
      // What its author says about Minecraft, and whether this profile's
      // Minecraft is inside it — null wherever the launcher will not say.
      needs: info.needs,
      fits: fitsVersion(info.needs, version),
      enabled: !isDisabled(entry.name),
      size: stat.size
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { ok: true, mods: out };
}

/**
 * Switch one local jar on or off: the rename, and the new file name back,
 * because the card is named by its file from then on.
 *
 * A folder that already holds both spellings — `x.jar` beside
 * `x.jar.disabled` — is left as it is rather than one written over the other:
 * that is the player's doing, and the answer says so.
 */
async function localToggle(modsDir, file, on) {
  const name = await localName(modsDir, file);
  const base = baseName(name);
  const target = on ? base : `${base}${DISABLED}`;
  if (target === name) return { ok: true, file: name, enabled: Boolean(on) };
  if (await exists(path.join(modsDir, target))) {
    return { ok: false, error: `${target} is already in the folder` };
  }
  await fsp.rename(path.join(modsDir, name), path.join(modsDir, target));
  return { ok: true, file: target, enabled: Boolean(on) };
}

/**
 * One local jar to the Recycle Bin. `trash` is `shell.trashItem` in the
 * launcher; without one, or when the shell refuses, the file is removed for
 * good and the answer says so — the same terms worlds.js sets.
 */
async function localRemove(modsDir, file, trash = null) {
  const name = await localName(modsDir, file);
  const target = path.join(modsDir, name);
  if (!(await exists(target))) return { ok: true };
  if (trash) {
    try {
      await trash(target);
      return { ok: true };
    } catch { /* falls through to the plain delete */ }
  }
  try {
    await fsp.rm(target, { force: true });
    return { ok: true, unrecoverable: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Which of a profile's switched-on mods this Minecraft actually has a build
 * of (2026-09-21) — the question the Mods page asks so that a card says "No
 * build for 26.3 yet" instead of On over a jar the launch leaves out.
 *
 * The lookup is the launch's own (resolveFile), so the page and the game
 * agree; an answer of "no build" is remembered for an hour under its own key
 * (the launch never reads it — a build that appears is installed on the next
 * Play whatever this says), and Modrinth being unreachable answers nothing
 * about that mod rather than a wrong word. A mod older than its `since` is
 * the card's own case and is not asked.
 *
 * @returns {Promise<{ok: true, version: string, none: string[], unknown: string[]}>}
 *   `none` — slugs with no build for this version and loader;
 *   `unknown` — slugs Modrinth could not be asked about.
 */
const NONE_TTL_MS = 60 * 60 * 1000;
async function availability({ mods, version, loader }) {
  const none = [];
  const unknown = [];
  if (loader !== 'fabric') return { ok: true, version, none, unknown };
  const asked = (mods || [])
    .filter((mod) => mod && mod.enabled !== false && mod.slug)
    .filter((mod) => !mod.since || companion.atLeast(version, mod.since));
  await Promise.all(asked.map(async (mod) => {
    const slug = String(mod.slug).toLowerCase();
    const key = `mod:none:${slug}:${version}:${loader}`;
    if (memo.get(key, NONE_TTL_MS)) { none.push(slug); return; }
    let resolved;
    try {
      resolved = await resolveFile(slug, mod.name, version, loader);
    } catch {
      resolved = { ok: false, error: 'unreachable' };
    }
    if (resolved && resolved.ok) return;
    if (/^No build for Minecraft/.test(String(resolved && resolved.error || ''))) {
      memo.set(key, true);
      none.push(slug);
    } else {
      unknown.push(slug);
    }
  }));
  return { ok: true, version, none, unknown };
}

module.exports = { sync, local, localToggle, localRemove, tune, availability, warmLookups };
