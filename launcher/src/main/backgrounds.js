'use strict';

/**
 * The launcher's background, chosen (2026-09-21, Adrian: "add a 'Background'
 * button in the bottom left corner, a small button, where people can click
 * it and switch background, upload their own background, etc.").
 *
 * The background has always been the world — the turning one drawn live by
 * world.js, or its still. It still is, by default. This is the other choice:
 * a picture of the player's own, kept under `<userData>/backgrounds/` as a
 * copy (never a path into their Pictures folder that a tidy-up would break),
 * chosen from the Background panel on Home. The choice is
 * `launcher.background` in the settings — `{ kind: 'world' }` or
 * `{ kind: 'image', file }` — and app.js draws it: the world's canvas and
 * still for the one, the picture fitted to the window for the other, both
 * under the same blur and brightness sliders.
 *
 * The renderer never sees a path. It asks for the list (names and sizes),
 * for a picture's bytes (handed over as a buffer and shown through a blob
 * URL — the renderer's content policy admits blob: pictures and refuses
 * file: ones), and to add or remove one; the file dialog and the copy are
 * main's. A picture over MAX_BYTES is refused with a plain sentence rather
 * than copied and drawn at a crawl.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { dialog, shell } = require('electron');

/** What the dialog offers and what the folder is read for. */
const KINDS = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/** The most a background may weigh: a 4K JPEG is a few megabytes; a RAW-sized PNG would stall the paint. */
const MAX_BYTES = 30 * 1024 * 1024;

let dir = null;

function init(userData) {
  dir = path.join(userData, 'backgrounds');
}

/** A file name the renderer handed back, made safe: a bare name in the folder or nothing. */
function safe(file) {
  const name = path.basename(String(file || ''));
  if (!name || name !== file || !KINDS[path.extname(name).toLowerCase()]) return null;
  return name;
}

/** Every picture in the folder, newest first. */
async function list() {
  if (!dir) return [];
  let names;
  try { names = await fsp.readdir(dir); } catch { return []; }
  const rows = [];
  for (const name of names) {
    if (!KINDS[path.extname(name).toLowerCase()]) continue;
    try {
      const stat = await fsp.stat(path.join(dir, name));
      if (stat.isFile()) rows.push({ file: name, name: name.replace(/^\d+-/, ''), size: stat.size, added: stat.mtimeMs });
    } catch { /* gone between readdir and stat */ }
  }
  return rows.sort((a, b) => b.added - a.added);
}

/** A picture's bytes and type, for the renderer to draw. */
async function read(file) {
  const name = safe(file);
  if (!name || !dir) return { ok: false };
  try {
    const bytes = await fsp.readFile(path.join(dir, name));
    return { ok: true, type: KINDS[path.extname(name).toLowerCase()], bytes };
  } catch {
    return { ok: false };
  }
}

/**
 * The file dialog, and the copy. The copy is named by the moment it was
 * added plus the file's own name, so two pictures called wallpaper.jpg
 * both fit and the list reads newest first by name alone.
 */
async function add(win) {
  if (!dir) return { ok: false, error: 'No folder for backgrounds.' };
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a background',
    properties: ['openFile'],
    filters: [{ name: 'Picture', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: true, cancelled: true };
  const source = result.filePaths[0];
  const ext = path.extname(source).toLowerCase();
  if (!KINDS[ext]) return { ok: false, error: 'That is not a PNG, JPEG or WebP picture.' };
  let stat;
  try { stat = await fsp.stat(source); } catch { return { ok: false, error: 'That file could not be read.' }; }
  if (stat.size > MAX_BYTES) return { ok: false, error: `That picture is ${Math.round(stat.size / 1048576)} MB — the most a background can be is ${MAX_BYTES / 1048576} MB.` };
  const name = `${Date.now()}-${path.basename(source).replace(/[^\w.\-() ]+/g, '_').slice(0, 80)}`;
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.copyFile(source, path.join(dir, name));
  } catch (error) {
    return { ok: false, error: `The picture could not be copied: ${error.message || error}` };
  }
  return { ok: true, file: name };
}

/** Into the Recycle Bin, never gone outright. */
async function remove(file) {
  const name = safe(file);
  if (!name || !dir) return { ok: false };
  try {
    await shell.trashItem(path.join(dir, name));
    return { ok: true };
  } catch {
    try { await fsp.unlink(path.join(dir, name)); return { ok: true }; } catch { return { ok: false }; }
  }
}

module.exports = { init, list, read, add, remove, MAX_BYTES };

/* Kept for a caller that wants to know a folder exists without listing it. */
module.exports.exists = () => Boolean(dir && fs.existsSync(dir));
