'use strict';

/**
 * Fabric's first-launch work, shared between profiles (2026-09-10).
 *
 * The first launch of a Fabric profile is slow twice over, and both halves
 * are kept per profile folder under `<profile>/.fabric/`:
 *
 *   - `remappedJars/minecraft-<version>-<loader>/client-intermediary.jar` —
 *     "Fabric is preparing JARs on first launch": the client jar rewritten
 *     into intermediary names, 29 MB. A function of the client jar, the
 *     intermediary mappings and the loader, all shared under the root, so it
 *     is byte for byte the same in every profile on that version.
 *   - `processedMods/<mod>-<version>-<hash>.jar` — the jars mods nest inside
 *     their own (Fabric API is sixty of them, Iris a few more), unpacked on
 *     the first launch that sees them and named for a hash of their bytes.
 *
 * Measured on Adrian's PC against a fresh profile with his eight mods: the
 * window came at 24 s cold, at 19 s with the remapped jar in place, and at
 * 8.9 s with both — the same as a profile that had been launched a hundred
 * times. Unpacking fifty small jars costs ten seconds here, not the one it
 * should, and the likeliest reason is the real-time scan every new file gets
 * on Windows; either way it is paid once per version by the first profile
 * and never again by the rest. He had twelve profile folders, every one of
 * them holding the same remapped jar.
 *
 * So a profile that has neither takes copies from a sibling that has, before
 * the game starts. Copies, never links: Fabric owns these files and rewrites
 * them when it decides to, and a hard link would let one profile's rewrite
 * reach every other. A sibling's first launch may be running this moment and
 * still writing, so nothing is taken unless its tail carries a zip's
 * end-of-directory record — a whole file, or not that file. The processed
 * jars are copied one by one on the same test, so a half-written one is
 * simply left for Fabric to unpack again, which is what it does for any it
 * cannot find. Everything lands under a `.part` name and is renamed, so two
 * launches of one new profile cannot leave a torn folder between them.
 *
 * On every launch after the first it is one `stat` each.
 */

const path = require('path');
const fsp = require('fs/promises');
const jar = require('./jar');
const { SHARED_DIR } = require('./settings');

const FABRIC = '.fabric';
const REMAPPED = 'remappedJars';
const PROCESSED = 'processedMods';
const JAR = 'client-intermediary.jar';

async function exists(file) {
  try { await fsp.stat(file); return true; } catch { return false; }
}

/** A file that is a whole zip: readable tail with the end record in place. */
async function wholeZip(file) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat || !stat.isFile() || stat.size < 22) return false;
  return (await jar.readComment(file)) !== null;
}

/** The other profiles under `instances`, newest launch first. */
async function siblings(instances, gameDir) {
  let entries;
  try {
    entries = await fsp.readdir(instances, { withFileTypes: true });
  } catch {
    return [];
  }
  const mine = path.resolve(gameDir);
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;   // _shared, the sync groups
    const dir = path.join(instances, entry.name);
    if (path.resolve(dir) === mine) continue;
    const stat = await fsp.stat(path.join(dir, FABRIC)).catch(() => null);
    if (stat && stat.isDirectory()) out.push({ dir, when: stat.mtimeMs });
  }
  return out.sort((a, b) => b.when - a.when).map((entry) => entry.dir);
}

/** Put `build()`'s output at `target` through a `.part` name; false if someone else did. */
async function place(target, build) {
  const part = `${target}.part-${process.pid}-${Date.now()}`;
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await build(part);
    await fsp.rename(part, target);
    return true;
  } catch {
    await fsp.rm(part, { recursive: true, force: true }).catch(() => {});
    return false;
  }
}

/**
 * The remapped game jar for this version and loader, from a sibling.
 * @returns {Promise<'kept'|'copied'|'none'>}
 */
async function seedRemapped(instances, gameDir, version, loaderVersion) {
  if (!version || !loaderVersion) return 'none';
  const name = `minecraft-${version}-${loaderVersion}`;
  const target = path.join(gameDir, FABRIC, REMAPPED, name);
  if (await exists(path.join(target, JAR))) return 'kept';

  for (const sibling of await siblings(instances, gameDir)) {
    const source = path.join(sibling, FABRIC, REMAPPED, name);
    if (!(await wholeZip(path.join(source, JAR)))) continue;
    if (await place(target, (part) => fsp.cp(source, part, { recursive: true }))) return 'copied';
    if (await exists(path.join(target, JAR))) return 'kept';
  }
  return 'none';
}

/**
 * The unpacked nested jars, from the sibling that has the most of them.
 * Only for a profile with no folder at all: once Fabric has written one, what
 * it holds and what it lacks are Fabric's business.
 * @returns {Promise<'kept'|'copied'|'none'>}
 */
async function seedProcessed(instances, gameDir) {
  const target = path.join(gameDir, FABRIC, PROCESSED);
  if (await exists(target)) return 'kept';

  let best = null;
  for (const sibling of await siblings(instances, gameDir)) {
    const source = path.join(sibling, FABRIC, PROCESSED);
    const names = (await fsp.readdir(source).catch(() => []))
      .filter((name) => name.toLowerCase().endsWith('.jar'));
    if (names.length && (!best || names.length > best.names.length)) best = { source, names };
  }
  if (!best) return 'none';

  const copied = await place(target, async (part) => {
    await fsp.mkdir(part, { recursive: true });
    for (const name of best.names) {
      const file = path.join(best.source, name);
      if (await wholeZip(file)) await fsp.copyFile(file, path.join(part, name));
    }
  });
  return copied ? 'copied' : ((await exists(target)) ? 'kept' : 'none');
}

/**
 * Both halves, for the launch. Never throws.
 * @returns {Promise<{ remapped: string, processed: string }>}
 */
async function seed(instances, gameDir, version, loaderVersion) {
  const remapped = await seedRemapped(instances, gameDir, version, loaderVersion).catch(() => 'none');
  const processed = await seedProcessed(instances, gameDir).catch(() => 'none');
  return { remapped, processed };
}

module.exports = { seed, seedRemapped, seedProcessed };
