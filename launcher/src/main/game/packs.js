'use strict';

/**
 * Resource packs — the set of whichever profile the Mods page is showing.
 *
 * Adrian, 2026-09-09: "add a similar selection screen in mods between resource
 * packs and mods, so people can also add resource packs just as easily as
 * mods." A pack is part of a profile's settings the way the options.txt line
 * that names it is (`settings.js`: `resourcepacks` is a member of a set,
 * precisely so a pack travels with the line that asks for it). So every
 * function here takes the folder a profile's settings live in — its own, or
 * its sync group's, `settings.homeOf` — and works on `resourcepacks/`,
 * `options.txt` and `.packs.json` there. Until 2026-09-17 that folder was
 * `_shared`, one set for every profile; now it is the profile's, and two
 * profiles that are synced see one list.
 *
 * "On" is the game's own record: the `resourcePacks` line of that
 * options.txt, in the game's own order (last is top). Adding a pack switches
 * it on, because a pack that is installed and not enabled looks exactly like a
 * pack that does not work. Removing one takes the file and the line together.
 *
 * On is two lines, not one. At startup the game drops every enabled pack whose
 * `pack_format` is not the one it expects — silently, to the log — unless the
 * pack is also named in `incompatibleResourcePacks`, which is what pressing Yes
 * on its "made for a different version" warning writes. Modrinth lists a pack
 * for a version and the file inside says another all the time (Adrian's two on
 * 2026-09-09: formats 75 and 9, on a 1.21.4 that wants 46), and a pack that is
 * on in the launcher and off in the game is the launcher lying. So a pack the
 * launcher switches on goes on both lines; the game takes it off the second
 * one itself when the formats do agree.
 *
 * `.packs.json` beside the folder — a member of the set since 2026-09-17, so
 * it stays with the packs it describes when a profile joins or leaves a group
 * — remembers what Modrinth said about each pack
 * (name, author, icon) so a card can say more than a file name. A pack the
 * player dropped in by hand has no entry, shows its own pack.mcmeta line and
 * pack.png instead, and is never touched except by the player's own Remove.
 *
 * One honest limit: options.txt is the game's file. A pack added while a game
 * is open is on disk at once, but that game rewrites options.txt when it
 * closes and its copy wins the next sync, so the switch lands on the launch
 * after that one. Added with no game open, it is on at the next Play.
 */

const path = require('path');
const fsp = require('fs/promises');
const zlib = require('zlib');
const { shell } = require('electron');

const { ensureDir, download } = require('./files');
const settings = require('./settings');   // FIRST_OPTIONS
const modrinth = require('../modrinth');

const MANIFEST = '.packs.json';
/** The start of every pack file the in-game half fetches for itself (mod: Faithful.PREFIX). */
const MOD_OWN = 'BlueClient Faithful ';
const ICON_MAX_BYTES = 256 * 1024;

const dirOf = (home) => path.join(home, 'resourcepacks');
const manifestOf = (home) => path.join(home, MANIFEST);
const optionsOf = (home) => path.join(home, 'options.txt');

/** A name the renderer may hand back: one path segment, not hidden. */
function safeName(file) {
  const name = String(file || '');
  if (!name || name !== path.basename(name) || name.startsWith('.')) return null;
  return name;
}

/* ------------------------------------------------------------ manifest */

async function readManifest(home) {
  try {
    const parsed = JSON.parse(await fsp.readFile(manifestOf(home), 'utf8'));
    return parsed && parsed.packs && typeof parsed.packs === 'object' ? parsed.packs : {};
  } catch {
    return {};
  }
}

async function writeManifest(home, packs) {
  await ensureDir(home);
  await fsp.writeFile(manifestOf(home), JSON.stringify({ packs }, null, 2), 'utf8');
}

/* ---------------------------------------------- options.txt: what is on */

async function readOptions(home) {
  try {
    return (await fsp.readFile(optionsOf(home), 'utf8')).split(/\r?\n/);
  } catch {
    return null;
  }
}

function parseList(lines, key) {
  const line = (lines || []).find((l) => l.startsWith(`${key}:`));
  if (!line) return [];
  try {
    const value = JSON.parse(line.slice(key.length + 1));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** How the game names a pack file in that list. */
const entryFor = (file) => `file/${file}`;

async function enabledSet(home) {
  return new Set(parseList(await readOptions(home), 'resourcePacks'));
}

/**
 * Switch one pack on or off in the shared options.txt.
 *
 * On goes to the end of the list, which is the top of the game's Selected
 * column, above everything the player had, and onto the game's list of packs
 * to run despite a version mismatch. Off drops it from both, so a re-add
 * starts clean. With no options.txt yet — no game has
 * run — the file starts from the same two lines the first launch would seed.
 */
async function setEnabled(home, file, on) {
  await ensureDir(home);
  let lines = await readOptions(home);
  if (!lines) lines = settings.FIRST_OPTIONS.split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  const entry = entryFor(file);
  const put = (key, next) => {
    const text = `${key}:${JSON.stringify(next)}`;
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (at >= 0) lines[at] = text;
    else lines.push(text);
  };

  const enabled = parseList(lines, 'resourcePacks').filter((v) => v !== entry);
  if (!enabled.includes('vanilla')) enabled.unshift('vanilla');
  put('resourcePacks', on ? [...enabled, entry] : enabled);

  // The game's own "load anyway" list, kept in step with the first (see top).
  const agreed = parseList(lines, 'incompatibleResourcePacks').filter((v) => v !== entry);
  put('incompatibleResourcePacks', on ? [...agreed, entry] : agreed);

  await fsp.writeFile(optionsOf(home), `${lines.join('\n')}\n`, 'utf8');
}

/* -------------------------------------------- what a pack says of itself */

/** The central directory of a zip, read from its tail — never the whole file. */
async function zipEntries(fh, size) {
  const tail = Math.min(size, 65558 + 22);
  const buf = Buffer.alloc(tail);
  await fh.read(buf, 0, tail, size - tail);

  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip archive');

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cd = Buffer.alloc(cdSize);
  await fh.read(cd, 0, cdSize, cdOffset);

  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const nameLength = cd.readUInt16LE(p + 28);
    const extraLength = cd.readUInt16LE(p + 30);
    const commentLength = cd.readUInt16LE(p + 32);
    entries.push({
      method: cd.readUInt16LE(p + 10),
      compressedSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      localOffset: cd.readUInt32LE(p + 42),
      name: cd.toString('utf8', p + 46, p + 46 + nameLength)
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function zipRead(fh, entry) {
  const head = Buffer.alloc(30);
  await fh.read(head, 0, 30, entry.localOffset);
  const nameLength = head.readUInt16LE(26);
  const extraLength = head.readUInt16LE(28);
  const data = Buffer.alloc(entry.compressedSize);
  await fh.read(data, 0, entry.compressedSize, entry.localOffset + 30 + nameLength + extraLength);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported zip compression (${entry.method})`);
}

/** pack.mcmeta's description as one plain line: a string, a text component, or a list of them. */
function flatten(part) {
  if (part == null) return '';
  if (typeof part === 'string') return part;
  if (Array.isArray(part)) return part.map(flatten).join('');
  if (typeof part === 'object') return `${part.text || part.translate || ''}${flatten(part.extra)}`;
  return String(part);
}

function mcmetaText(text) {
  try {
    return flatten(JSON.parse(text)?.pack?.description).replace(/§./g, '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

const pngUri = (bytes) =>
  bytes && bytes.length && bytes.length <= ICON_MAX_BYTES ? `data:image/png;base64,${bytes.toString('base64')}` : '';

/** Remembered per file and stamp: a pack's own line and picture do not change under us. */
const described = new Map();

async function describe(full, stat) {
  const key = `${full}|${stat.size}|${stat.mtimeMs}`;
  if (described.has(key)) return described.get(key);

  const out = { description: '', icon: '' };
  try {
    if (stat.isDirectory()) {
      out.description = mcmetaText(await fsp.readFile(path.join(full, 'pack.mcmeta'), 'utf8'));
      out.icon = pngUri(await fsp.readFile(path.join(full, 'pack.png')).catch(() => null));
    } else {
      const fh = await fsp.open(full, 'r');
      try {
        const entries = await zipEntries(fh, stat.size);
        const meta = entries.find((e) => e.name === 'pack.mcmeta');
        const png = entries.find((e) => e.name === 'pack.png');
        if (meta) out.description = mcmetaText((await zipRead(fh, meta)).toString('utf8'));
        if (png && png.size <= ICON_MAX_BYTES) out.icon = pngUri(await zipRead(fh, png));
      } finally {
        await fh.close();
      }
    }
  } catch {
    /* a pack that cannot be read still lists by its name */
  }
  described.set(key, out);
  return out;
}

/* ----------------------------------------------------------- the calls */

/**
 * Every pack in the shared folder, newest first, with whether it is on.
 * @returns {Promise<{ok: boolean, folder: string, packs: object[]}>}
 */
async function list(home) {
  const dir = dirOf(home);
  await ensureDir(dir);
  const [manifest, enabled] = await Promise.all([readManifest(home), enabledSet(home)]);

  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    // The in-game half's own: Faithful, fetched by the Detailed textures
    // row for one Minecraft and switched on and off from that row. Not a
    // card here — a Remove would only make the game fetch it again — but
    // the file is carried like any other, so a second profile on the same
    // Minecraft has it.
    if (entry.name.startsWith(MOD_OWN)) continue;
    const zip = entry.isFile() && /\.zip$/i.test(entry.name);
    if (!zip && !entry.isDirectory()) continue;

    const full = path.join(dir, entry.name);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) continue;

    const known = manifest[entry.name] || null;
    const info = await describe(full, stat);
    out.push({
      file: entry.name,
      name: known?.name || entry.name.replace(/\.zip$/i, ''),
      author: known?.author || '',
      description: known?.description || info.description,
      iconUrl: known?.iconUrl || '',
      icon: info.icon,
      slug: known?.slug || '',
      source: known ? 'modrinth' : 'file',
      size: stat.isDirectory() ? 0 : stat.size,
      enabled: enabled.has(entryFor(entry.name)),
      added: known?.added || stat.mtimeMs
    });
  }
  out.sort((a, b) => b.added - a.added);
  return { ok: true, folder: dir, packs: out };
}

/**
 * Fetch one Modrinth pack for one Minecraft version into the shared folder
 * and switch it on. No loader in the ask: a pack is for the game itself.
 */
async function add(home, { slug, name, author, description, iconUrl, version } = {}) {
  if (!slug) return { ok: false, error: 'That pack has no Modrinth project attached.' };

  const found = await modrinth.file({ slug, version });
  if (!found.ok) return { ok: false, error: found.error };

  const filename = safeName(found.file.filename);
  if (!filename) return { ok: false, error: 'That pack has a file name the launcher will not use.' };

  const dir = dirOf(home);
  await ensureDir(dir);
  try {
    await download(found.file.url, path.join(dir, filename), found.file);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const manifest = await readManifest(home);
  manifest[filename] = { slug, name, author, description, iconUrl, added: Date.now() };
  await writeManifest(home, manifest);
  await setEnabled(home, filename, true);
  return { ok: true, file: filename };
}

/** The file and its line, both gone. */
async function remove(home, file) {
  const name = safeName(file);
  if (!name) return { ok: false, error: 'bad name' };

  await fsp.rm(path.join(dirOf(home), name), { recursive: true, force: true }).catch(() => {});

  const manifest = await readManifest(home);
  if (manifest[name]) {
    delete manifest[name];
    await writeManifest(home, manifest);
  }
  await setEnabled(home, name, false);
  return { ok: true };
}

async function toggle(home, file, on) {
  const name = safeName(file);
  if (!name) return { ok: false, error: 'bad name' };
  await setEnabled(home, name, Boolean(on));
  return { ok: true, enabled: Boolean(on) };
}

async function folder(home) {
  const dir = dirOf(home);
  await ensureDir(dir);
  const failure = await shell.openPath(dir);
  return failure === '';
}

module.exports = { list, add, remove, toggle, folder };
