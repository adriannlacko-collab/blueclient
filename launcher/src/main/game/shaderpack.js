'use strict';

/**
 * The shaderpack, into a profile's `shaderpacks/` folder before the game starts.
 *
 * Until 2026-09-06 the pack — Photon, six megabytes — travelled inside the
 * companion jar and the mod wrote it out to `shaderpacks/BlueClient-Photon`
 * on every start. The mod ships as five jars, one per Minecraft, and every one
 * carried the same six megabytes: a third of the installer was that pack five
 * times over. Now the launcher keeps one copy under `resources/shaderpack/`
 * (put there by `scripts/build-mod.mjs`) and does the writing itself, the way
 * `mods.js` already copies the jar.
 *
 * The folder carries the same `.blueclient` stamp file the mod writes, holding
 * a checksum of the files, so the copy happens once per pack change and is a
 * single small read every other launch. The same two rules the mod keeps:
 * only ever a folder carrying our stamp, or an empty one, is wiped — a player
 * who put a pack of their own under this name keeps it — and the mod
 * (`graphics/Pack.java`) reads the stamp to know the pack is ours.
 */

const path = require('path');
const fsp = require('fs/promises');
const zlib = require('zlib');

/** What Iris calls the pack. Must match Pack.NAME in the mod. */
const NAME = 'BlueClient-Photon';
const STAMP = '.blueclient';

/** Remembered per source folder: the stamp is a read of six megabytes. */
const stamps = new Map();

async function walk(dir, out = [], base = dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out, base);
    else if (entry.isFile()) out.push({ full, relative: path.relative(base, full).split(path.sep).join('/') });
  }
  return out;
}

/**
 * A checksum of the pack as shipped: every file's path and bytes, in path
 * order. Prefixed so a stamp the mod wrote (its own version string) is never
 * mistaken for one of ours, and rewritten either way.
 */
async function stampFor(source) {
  const cached = stamps.get(source);
  if (cached) return cached;

  const files = (await walk(source)).sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  let crc = 0;
  for (const file of files) {
    crc = zlib.crc32(Buffer.from(file.relative), crc);
    crc = zlib.crc32(await fsp.readFile(file.full), crc);
  }
  const result = { files, stamp: `launcher:${crc.toString(16)}:${files.length}` };
  stamps.set(source, result);
  return result;
}

async function exists(target) {
  try { await fsp.stat(target); return true; } catch { return false; }
}

/**
 * Make sure `<instanceDir>/shaderpacks/BlueClient-Photon` is this launcher's
 * copy. Never throws: a profile without the pack starts, with the Graphics
 * modules standing down in the game.
 *
 * @returns {Promise<'written'|'kept'|'theirs'|'absent'>}
 */
async function install(packDir, instanceDir) {
  if (!packDir || !(await exists(packDir))) return 'absent';

  const { files, stamp } = await stampFor(packDir);
  if (!files.length) return 'absent';

  const target = path.join(instanceDir, 'shaderpacks', NAME);
  const stampFile = path.join(target, STAMP);

  const existing = await fsp.readFile(stampFile, 'utf8').then((s) => s.trim()).catch(() => null);
  if (existing === stamp) return 'kept';

  if (await exists(target)) {
    const ours = existing !== null;
    const empty = (await fsp.readdir(target)).length === 0;
    if (!ours && !empty) return 'theirs';
    await fsp.rm(target, { recursive: true, force: true });
  }

  for (const file of files) {
    const out = path.join(target, ...file.relative.split('/'));
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.copyFile(file.full, out);
  }
  await fsp.writeFile(stampFile, stamp, 'utf8');
  return 'written';
}

/**
 * Read and stamp the pack before anybody presses Play (2026-09-10).
 *
 * The stamp is a read of six megabytes and, measured, was 140 of the 200 ms
 * the launcher spent between the press and the JVM on a warm install — all of
 * it on the first press of a launcher process, because the result is kept.
 * Done here from main at start-up instead, so the press finds it done. Never
 * throws: a pack that cannot be read is `install`'s problem at the launch,
 * exactly as before.
 */
async function prime(packDir) {
  if (!packDir || !(await exists(packDir))) return;
  await stampFor(packDir).catch(() => {});
}

module.exports = { install, prime, NAME };
