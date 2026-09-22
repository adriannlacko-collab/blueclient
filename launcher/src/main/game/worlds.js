'use strict';

/**
 * Worlds — every singleplayer save the launcher can see, and their backups
 * (2026-09-11).
 *
 * The Worlds tab draws three groups from `list()`: the current profile's
 * worlds, the other profiles', and every `saves/` folder the other launchers
 * on this PC keep — the same discovery the settings sync already uses to find
 * their server lists (`settings.elsewhere`). A card reads its name, the
 * Minecraft that last saved it, the game mode and when it was last played
 * out of the world's own `level.dat` (nbt.readLevel), and its `icon.png` when
 * the game has drawn one.
 *
 * <h2>Backups happen when the game closes, never at Play</h2>
 * `afterSession` is called from the session's exit handler (launcher.js) with
 * the moment the game reached 'playing'. Every world in that profile whose
 * `level.dat` is newer than that moment was played in that sitting, and each
 * one is zipped into
 * `<instances>/_shared/backups/<profile>/<world>/<yyyy-mm-dd_hh-mm>.zip`,
 * three kept per world (KEEP). A world is 48 MB in a jar's clothing —
 * BlueTest is 179 files — and a long survival one is gigabytes, so the zip is
 * streamed (jar.pack) at deflate level 1: measured on BlueTest, that halves
 * it, and level 6 finds nothing more worth its time. Nothing here runs at
 * Play: the launch pipeline reads no megabytes (CLAUDE.md, Size and speed),
 * and a backup on the way out costs a player nothing they can feel.
 *
 * <h2>Every write is guarded</h2>
 * A manual "Back up now" and the exit hook can arrive within the same second,
 * so every write to one world runs in a lane named for that world. Restore
 * makes a safety backup of the world as it is, unpacks the chosen zip beside
 * the live world (CRC-checked entry by entry — a bad zip fails before the
 * world is touched), and only then swaps the folders. Bring copies, never
 * moves: the other launcher keeps its world. Delete bins the world and its
 * backups together — keeping backups of deleted worlds for ever would eat
 * the disk in silence.
 *
 * Nothing the renderer says is trusted as a path: a profile is an id
 * (`/^[a-z0-9]+$/i`), a world is a folder name under that profile's `saves`,
 * a backup is a file name under that world's backup folder, and a world to
 * bring is only accepted if this module's own discovery finds it again.
 *
 * Pure Node: `tools/check-worlds.js` drives every function here without
 * Electron, over a scratch folder.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');

const nbt = require('./nbt');
const jar = require('./jar');
const settings = require('./settings');
const { lane } = require('./lane');

/** Backups kept per world. */
const KEEP = 3;
/** Deflate level for a backup — measured, see the header. */
const LEVEL = 1;
/** Under `_shared`: the one folder the settings sync does not mirror. */
const BACKUPS = 'backups';
/** The game holds this open with a range lock; it is recreated on load. */
const LOCK = 'session.lock';
const skipLock = (rel) => path.basename(rel) === LOCK;

/** `'backup'` → { profileId, folder, file, bytes, when, auto } after each one lands. */
const events = new EventEmitter();

/* ---------------------------------------------------------------- paths */

const ID = /^[a-z0-9]+$/i;

function profileDir(instances, profileId) {
  const id = String(profileId || '');
  if (!ID.test(id)) throw new Error('bad profile id');
  const root = path.resolve(instances);
  const dir = path.join(root, id);
  if (path.dirname(dir) !== root) throw new Error('bad profile id');
  return dir;
}

/** A world's folder name: one path segment, nothing that walks. */
function plainName(name) {
  const folder = String(name || '');
  if (!folder || folder === '.' || folder === '..' || folder !== path.basename(folder) || /[\\/]/.test(folder)) {
    throw new Error('bad folder name');
  }
  return folder;
}

function savesDir(instances, profileId) {
  return path.join(profileDir(instances, profileId), 'saves');
}

function worldDir(instances, profileId, folder) {
  const saves = savesDir(instances, profileId);
  const dir = path.join(saves, plainName(folder));
  if (path.dirname(dir) !== saves) throw new Error('bad folder name');
  return dir;
}

function backupsDir(instances, profileId, folder) {
  const id = String(profileId || '');
  if (!ID.test(id)) throw new Error('bad profile id');
  return path.join(settings.sharedDirIn(path.resolve(instances)), BACKUPS, id, plainName(folder));
}

/* --------------------------------------------------------------- basics */

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function statOf(target) {
  try {
    return await fsp.stat(target);
  } catch {
    return null;
  }
}

/** Bytes and files under a folder; follows no links. */
async function measure(dir) {
  let bytes = 0;
  let files = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes, files };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = await measure(full);
      bytes += inner.bytes;
      files += inner.files;
    } else if (entry.isFile()) {
      const stat = await statOf(full);
      if (stat) { bytes += stat.size; files += 1; }
    }
  }
  return { bytes, files };
}

/** "2026-09-11_14-05" — local time, to the minute, sorts as it reads. */
function stamp(when = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}` +
    `_${two(when.getHours())}-${two(when.getMinutes())}`;
}

/**
 * True while a running game has the world open: it holds `session.lock`
 * with a range lock, and on Windows even reading it is refused. A world that
 * is not there, or has no lock file, is simply not open.
 */
async function isOpen(dir) {
  let handle;
  try {
    handle = await fsp.open(path.join(dir, LOCK), 'r');
    await handle.read(Buffer.alloc(1), 0, 1, 0);
    return false;
  } catch (error) {
    return error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES';
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/* -------------------------------------------------------------- reading */

/**
 * What one world folder says about itself, or null when it is not a world
 * (no `level.dat`). A `level.dat` that will not parse — the game may be
 * writing it this instant — still gets a card, named after its folder.
 */
async function describe(dir) {
  const folder = path.basename(dir);
  const levelFile = path.join(dir, 'level.dat');
  const stat = await statOf(levelFile);
  if (!stat || !stat.isFile()) return null;

  let level = null;
  try {
    level = nbt.readLevel(await fsp.readFile(levelFile));
  } catch {
    level = null;
  }

  const iconStat = await statOf(path.join(dir, 'icon.png'));
  const icon = iconStat && iconStat.isFile()
    ? `${pathToFileURL(path.join(dir, 'icon.png')).href}?t=${Math.round(iconStat.mtimeMs)}`
    : null;

  return {
    folder,
    path: dir,
    name: (level && level.name) || folder,
    version: level ? level.version : null,
    lastPlayed: level && level.lastPlayed ? level.lastPlayed : Math.round(stat.mtimeMs),
    gameMode: level ? level.gameMode : null,
    hardcore: Boolean(level && level.hardcore),
    icon
  };
}

/** Every world under a `saves` folder, most recently played first. */
async function worldsIn(saves) {
  let entries;
  try {
    entries = await fsp.readdir(saves, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const world = await describe(path.join(saves, entry.name));
    if (world) out.push(world);
  }
  return out.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}

/** The zips in a world's backup folder, newest first. */
async function zipsIn(dir) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => /\.zip$/i.test(n)).sort().reverse()) {
    const stat = await statOf(path.join(dir, name));
    if (stat && stat.isFile()) out.push({ name, bytes: stat.size, when: Math.round(stat.mtimeMs) });
  }
  return out;
}

async function latestBackup(instances, profileId, folder) {
  const zips = await zipsIn(backupsDir(instances, profileId, folder));
  if (!zips.length) return null;
  return { when: zips[0].when, bytes: zips[0].bytes, count: zips.length };
}

/**
 * Every world the launcher can see.
 *
 * `worlds` is every `saves/*` under every profile folder (a profile that no
 * longer exists still has a folder until the Bin takes it — the renderer
 * shows those under "Your other profiles" with only Bring it here on them).
 * `elsewhere` is every world in the other launchers' game folders, found the
 * way the settings sync finds their server lists; `foreign` is that finder,
 * injected so the check script can hand over its own.
 *
 * Sizes are not here: a card asks for its own (`size`) after it is on
 * screen, so listing forty worlds never walks forty folders.
 */
async function list({ instances, foreign = settings.elsewhere } = {}) {
  const worlds = [];
  let profiles = [];
  try {
    profiles = (await fsp.readdir(instances, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== settings.SHARED_DIR && ID.test(entry.name))
      .map((entry) => entry.name);
  } catch { /* no profiles yet */ }

  for (const profileId of profiles) {
    for (const world of await worldsIn(savesDir(instances, profileId))) {
      worlds.push({ profileId, ...world, backup: await latestBackup(instances, profileId, world.folder) });
    }
  }
  worlds.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));

  const elsewhere = [];
  let dirs = [];
  try { dirs = await foreign(); } catch { dirs = []; }
  for (const dir of dirs) {
    for (const world of await worldsIn(path.join(dir, 'saves'))) {
      elsewhere.push({ source: settings.labelFor(dir), dir, ...world });
    }
  }
  elsewhere.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));

  return { worlds, elsewhere };
}

/** What one world weighs — walked when a card asks, never in the background. */
async function size({ instances, profileId, folder }) {
  return measure(worldDir(instances, profileId, folder));
}

/* -------------------------------------------------------------- backups */

/** Run `work` with nobody else writing this world or its backups. */
function guarded(dir, work) {
  return lane(`worlds:${dir}`, work);
}

/**
 * Zip a world into its backup folder and prune to KEEP.
 *
 * `auto` marks the exit hook's backups in the event. `keepAlso` names a zip
 * the pruning must not take — the one a restore is about to read.
 */
async function backup({ instances, profileId, folder, auto = false, keepAlso = null }) {
  const dir = worldDir(instances, profileId, folder);
  const into = backupsDir(instances, profileId, folder);

  return guarded(dir, async () => {
    if (!(await exists(path.join(dir, 'level.dat')))) return { ok: false, error: 'not a world' };
    await fsp.mkdir(into, { recursive: true });

    // A manual press and the exit hook inside one minute: _2, _3.
    const base = stamp();
    let name = `${base}.zip`;
    for (let n = 2; await exists(path.join(into, name)); n++) name = `${base}_${n}.zip`;
    const file = path.join(into, name);

    const world = await describe(dir);
    const comment = `BlueClient backup of ${world ? world.name : folder} (${profileId}/${folder}) at ${new Date().toISOString()}`;
    const packed = await jar.pack(dir, file, { skip: skipLock, level: LEVEL, comment });

    // Oldest first out, until KEEP are left. The pruning stops at a zip it
    // must not take — the one just written, or the one a restore is about to
    // read — rather than reaching past it for a newer one: a fourth backup
    // sits there until the next one lands, and nothing newer is lost.
    const zips = await zipsIn(into);
    let excess = zips.length - KEEP;
    for (const zip of [...zips].reverse()) {
      if (excess <= 0 || zip.name === name || zip.name === keepAlso) break;
      await fsp.rm(path.join(into, zip.name), { force: true }).catch(() => {});
      excess--;
    }
    const kept = (await zipsIn(into)).map((zip) => zip.name);

    const when = Date.now();
    const answer = { ok: true, file, name, bytes: packed.bytes, raw: packed.raw, when, kept: kept.length };
    events.emit('backup', { profileId, folder, file, name, bytes: packed.bytes, when, auto });
    return answer;
  });
}

/** A world's backups, newest first. */
async function backups({ instances, profileId, folder }) {
  return { backups: await zipsIn(backupsDir(instances, profileId, folder)) };
}

/**
 * Put a backup back.
 *
 * The world as it is now is backed up first (so a restore is never a loss),
 * the zip is unpacked beside the live world with every entry CRC-checked,
 * and only then are the folders swapped. A zip that fails its check leaves
 * the live world exactly as it was.
 */
async function restore({ instances, profileId, folder, name }) {
  const dir = worldDir(instances, profileId, folder);
  const into = backupsDir(instances, profileId, folder);
  const zipName = plainName(name);
  if (!/\.zip$/i.test(zipName)) throw new Error('bad backup name');
  const zip = path.join(into, zipName);
  if (path.dirname(zip) !== into) throw new Error('bad backup name');

  if (!(await exists(zip))) return { ok: false, error: 'That backup is no longer there' };
  if (await isOpen(dir)) return { ok: false, running: true };

  // The safety backup takes the same lane, so it is made outside this one.
  let safety = null;
  if (await exists(path.join(dir, 'level.dat'))) {
    safety = await backup({ instances, profileId, folder, keepAlso: zipName });
    if (!safety.ok) return { ok: false, error: safety.error || 'Could not back the world up first' };
  }

  return guarded(dir, async () => {
    const staging = `${dir}.restoring`;
    const retired = `${dir}.replaced`;
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.rm(retired, { recursive: true, force: true });
    try {
      await jar.unpack(zip, staging);
    } catch (error) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: `The backup could not be read: ${error.message}` };
    }

    try {
      if (await exists(dir)) await fsp.rename(dir, retired);
      await fsp.rename(staging, dir);
    } catch (error) {
      // The live folder would not move — something has it open. Put things
      // back exactly as they were.
      if (!(await exists(dir)) && await exists(retired)) await fsp.rename(retired, dir).catch(() => {});
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: `The world could not be replaced: ${error.message}` };
    }
    await fsp.rm(retired, { recursive: true, force: true }).catch(() => {});
    return { ok: true, safety: safety ? safety.name : null };
  });
}

/**
 * A world and its backups, to the Recycle Bin.
 *
 * `trash` is `shell.trashItem` in the launcher; without one, or when the
 * shell refuses, the folders are removed for good and the answer says so.
 */
async function remove({ instances, profileId, folder, trash = null }) {
  const dir = worldDir(instances, profileId, folder);
  const into = backupsDir(instances, profileId, folder);
  if (await isOpen(dir)) return { ok: false, running: true };

  return guarded(dir, async () => {
    let unrecoverable = false;
    for (const target of [dir, into]) {
      if (!(await exists(target))) continue;
      let binned = false;
      if (trash) {
        try { await trash(target); binned = true; } catch { binned = false; }
      }
      if (!binned) {
        try {
          await fsp.rm(target, { recursive: true, force: true });
          unrecoverable = true;
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }
    }
    // A profile's backup folder with nothing left in it is not worth keeping.
    await fsp.rmdir(path.dirname(into)).catch(() => {});
    return unrecoverable ? { ok: true, unrecoverable: true } : { ok: true };
  });
}

/* ------------------------------------------------------------- bringing */

/** Copy a tree, `level.dat` last so the game never lists a half-copied world. */
async function copyTree(from, to) {
  const later = [];
  const visit = async (src, dst) => {
    await fsp.mkdir(dst, { recursive: true });
    for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
      const a = path.join(src, entry.name);
      const b = path.join(dst, entry.name);
      if (entry.isDirectory()) await visit(a, b);
      else if (!entry.isFile() || entry.name === LOCK) continue;
      else if (src === from && entry.name === 'level.dat') later.push([a, b]);
      else await fsp.copyFile(a, b);
    }
  };
  await visit(from, to);
  for (const [a, b] of later) await fsp.copyFile(a, b);
}

/**
 * Copy a world into a profile — from another launcher, or from the folder a
 * deleted profile left behind. Never a move: whatever had it keeps it.
 *
 * The source is accepted only if the discovery finds it again itself: a
 * `saves/<folder>` under one of the other launchers' game folders, or under
 * one of our own profile folders. On a name already taken the copy is
 * "<name> (2)", then "(3)".
 */
async function bring({ instances, profileId, path: source, foreign = settings.elsewhere }) {
  const from = path.resolve(String(source || ''));
  const folder = path.basename(from);
  const parent = path.dirname(from);
  if (path.basename(parent) !== 'saves') return { ok: false, error: 'not a world' };
  const gameDir = path.dirname(parent);

  const root = path.resolve(instances);
  const ours = path.dirname(gameDir) === root && ID.test(path.basename(gameDir));
  let known = ours;
  if (!known) {
    let dirs = [];
    try { dirs = await foreign(); } catch { dirs = []; }
    known = dirs.some((dir) => path.resolve(dir) === gameDir);
  }
  if (!known) return { ok: false, error: 'not a world the launcher knows' };
  if (!(await exists(path.join(from, 'level.dat')))) return { ok: false, error: 'not a world' };

  const saves = savesDir(instances, profileId);
  await fsp.mkdir(saves, { recursive: true });
  let target = plainName(folder);
  for (let n = 2; await exists(path.join(saves, target)); n++) target = `${folder} (${n})`;
  const to = path.join(saves, target);
  if (path.resolve(to) === from) return { ok: false, error: 'that world is already here' };

  return guarded(to, async () => {
    try {
      await copyTree(from, to);
    } catch (error) {
      await fsp.rm(to, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: error.message };
    }
    const world = await describe(to);
    return { ok: true, folder: target, name: world ? world.name : target };
  });
}

/* ------------------------------------------------------------ at exit */

/**
 * Back up every world played in the sitting that just ended.
 *
 * Called from the session's exit handler with the moment the game reached
 * 'playing'; a launch that never got there (`since` null) played nothing. A
 * world whose `level.dat` is newer than that moment was saved during the
 * sitting; one that is still open — a second copy of the same profile has it
 * — is left for that copy's exit. Every failure is swallowed: a backup that
 * cannot be made is not a reason to bother a player who has just closed the
 * game.
 *
 * @returns {Promise<Array<{ folder: string, ok: boolean, name?: string, skipped?: string }>>}
 */
async function afterSession(instances, gameDir, since) {
  if (!since) return [];
  const profileId = path.basename(gameDir);
  if (!ID.test(profileId)) return [];

  const done = [];
  for (const world of await worldsIn(path.join(gameDir, 'saves'))) {
    const stat = await statOf(path.join(world.path, 'level.dat'));
    if (!stat || stat.mtimeMs <= since) continue;
    if (await isOpen(world.path)) {
      done.push({ folder: world.folder, ok: false, skipped: 'open in another game' });
      continue;
    }
    try {
      const made = await backup({ instances, profileId, folder: world.folder, auto: true });
      done.push({ folder: world.folder, ok: made.ok, name: made.name });
    } catch (error) {
      done.push({ folder: world.folder, ok: false, error: error.message });
    }
  }
  return done;
}

module.exports = {
  events, list, size, backup, backups, restore, remove, bring, afterSession,
  KEEP, LEVEL, backupsDir, savesDir, worldDir
};
