'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Tiny JSON-file store. Atomic writes, debounced, never throws on read.
 * Kept dependency-free on purpose — the launcher must start even if the
 * config file is missing, empty, or corrupted by a bad shutdown.
 */
class Store {
  constructor(filePath, defaults) {
    this.path = filePath;
    this.defaults = defaults;
    this.data = this._read();
    this._timer = null;
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      return deepMerge(structuredClone(this.defaults), parsed);
    } catch {
      return structuredClone(this.defaults);
    }
  }

  get all() {
    return this.data;
  }

  get(key) {
    return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), this.data);
  }

  set(key, value) {
    const parts = key.split('.');
    const last = parts.pop();
    let target = this.data;
    for (const part of parts) {
      if (typeof target[part] !== 'object' || target[part] === null) target[part] = {};
      target = target[part];
    }
    target[last] = value;
    this.save();
    return value;
  }

  merge(patch) {
    this.data = deepMerge(this.data, patch);
    this.save();
    return this.data;
  }

  reset() {
    this.data = structuredClone(this.defaults);
    this.save();
    return this.data;
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 120);
  }

  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.path);
    } catch (err) {
      console.error('[store] failed to persist settings:', err.message);
    }
  }
}

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = typeof base === 'object' && base !== null && !Array.isArray(base) ? base : {};
  for (const [key, value] of Object.entries(patch)) {
    // A patch arrives from the renderer (settings:set) and from a file on
    // disk; an own `__proto__` key in either — JSON.parse makes one — would
    // be merged into Object.prototype itself (2026-09-22). No setting is
    // called that.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(out[key], value)
      : value;
  }
  return out;
}

/**
 * Half of system RAM, clamped to a sane launcher range, rounded to 512MB —
 * except on a machine with 8 GB or less, which gets 3 GB (2026-09-22): half
 * of 8 was 4, and Windows, the game's own native side (the driver, the
 * natives, the code cache) and the launcher take the other four, so the game
 * paged. Sodium runs in three. The old answer is kept below for the one-time
 * move in main.js (schema 7), which only touches a file still on it.
 */
function suggestedMemory() {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  if (totalMb <= SMALL_MACHINE_MB) return 3072;
  return legacySuggestedMemory();
}

/* Windows reports a little under the sticker: an 8 GB laptop says ~7.9. */
const SMALL_MACHINE_MB = 8192 + 512;

function legacySuggestedMemory() {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const half = Math.floor(totalMb / 2);
  const clamped = Math.min(Math.max(half, 2048), 8192);
  return Math.round(clamped / 512) * 512;
}

const defaults = () => ({
  // 2 since 0.38.1 (2026-09-15): a file below it is given the Background
  // blur default it missed; 3 since 0.38.2 the same hour, the brightness
  // default likewise; 4 since 0.45.0 (2026-09-17), the brightness default
  // again (80 → 70); 5 since 1.2.0 (2026-09-18, evening), "When the game
  // starts" from Minimise to Keep open; 6 since 1.3.1 (2026-09-20), the
  // one-time uncap of an options.txt still on vanilla's VSync and 120 — see
  // the migrations in main.js, beside the store. Nothing else reads this
  // number. 7 since 2026-09-22: game.jvmArgs still saying the old default
  // string becomes '' (the launcher's own flags, per Java), and the memory
  // default on an 8 GB machine moves from 4 GB to 3.
  schemaVersion: 7,
  window: { width: 1180, height: 608, x: null, y: null, maximized: false },
  accounts: { active: null, list: [] },
  // An override for the Azure application this launcher signs in as. Empty is
  // the ordinary case and means the one shipped in auth.js — see CLIENT_ID
  // there. Kept empty here on purpose: a settings file written by an older
  // build wins over these defaults, so the shipped id has to be the fallback
  // rather than the default, or nobody who already ran the launcher would get
  // it.
  auth: { clientId: '' },
  game: {
    lastProfile: null,
    memoryMb: suggestedMemory(),
    resolution: { width: 1280, height: 720, fullscreen: false },
    javaPath: '',
    // Empty is the launcher's own flags for the game's Java (install.js,
    // jvmTuning); anything typed replaces them whole. Every file before
    // schema 7 carried the flags themselves here.
    jvmArgs: ''
  },
  launcher: {
    // Settings → General → "When the game starts": Keep open since 1.2.0
    // (2026-09-18, Adrian: "make it by default so the launcher doesnt
    // minimise after the game has been launched"). It was Minimise from the
    // first day; main.js moves a file still saying so to Keep open once
    // (schema 5). 'close' hides the window instead; see launcher.on('state')
    // in main.js.
    onLaunch: 'keep',
    keepLogs: true,
    hardwareAcceleration: true,
    gameDirectory: '',
    rootDirectory: '',
    // Settings → About → "Get updates early" (2026-09-11). Off: only ever
    // GitHub's Latest, which a pre-release never is. See src/main/update.js,
    // bundleSource.
    earlyUpdates: false,
    // Settings → General → "Background blur" (2026-09-15): 0 to 100, how
    // softly the world behind the launcher is drawn. 0 is the world as it
    // is; 15 since 0.38.1 the same afternoon (Adrian: "set default blur to
    // 15%" — 0.38.0 shipped it at 0, and main.js moves a file that still
    // says 0 from that hour). Painted by paintWorldBlur in the renderer's
    // state.js.
    worldBlur: 15,
    // Settings → General → "Background brightness" (2026-09-15, 0.38.1):
    // 10 to 100, how brightly the world is drawn. 100 is the world as it is
    // — the top of the slider is the launcher as it was before the setting
    // existed, and it only goes down from there (Adrian: "the current one
    // should be max, and then you can drag it lower to decrease it"). 80 by
    // default since 0.38.2 the same hour (Adrian: "make default to
    // brightness as 80%"); 0.38.1 shipped it at 100, and main.js moves a
    // file that still says 100 from then. 70 since 0.45.0 (2026-09-17,
    // Adrian: "put default brightness to 70%"), with the same migration
    // (schema 4) for a file that still says 80. Painted by
    // paintWorldBrightness in the renderer's state.js.
    worldBrightness: 70,
    // Home's four blocks and where they stand (2026-09-17, the Layout
    // button): which side the player's block is on, and the order of the
    // three cards in the other column, top to bottom. Written by Home's
    // arrange mode (src/renderer/js/pages/layout.js) on every change;
    // anything unreadable falls back to this.
    layout: { skin: 'left', side: ['servers', 'play', 'continue'] },
    // Whether the first opening of Profiles has had its say (2026-09-18):
    // the "We found your profiles" offer, once per copy, written whatever
    // the player pressed — or when the scan found nothing to offer. See
    // offerImport in the renderer's pages/profiles.js.
    importOffered: false
  },
  // The anonymous count of players (src/main/stats.js): on unless the player
  // switches it off under Settings → About, and an id made on first use.
  // crashReports (2026-09-11) is the opposite default: off until the player
  // switches it on under Settings → General ("Send crash reports") — see
  // reportShape in crashes.js for exactly what a crash then sends.
  stats: { share: true, id: '', crashReports: false },
  // The cape worn in the game (2026-09-12, evening): a cape's id, 'none', or
  // empty for the best one the record has earned, and since 2026-09-13 the
  // colours of Yours — top, bottom, sparkles, and whether the B is on it.
  // Chosen on Stats; stamped into blueclient.json as the game opens (main.js
  // syncFlags, as one word).
  play: { cape: '', colours: { top: '#7c5cff', bottom: '#f9a8d4', spark: '#ffffff', letter: true } }
});

/**
 * Schema 7 (2026-09-22), run from main.js after the 6 stamp: the Java options
 * field still saying the old default string becomes '' (the launcher's own
 * flags for the game's Java, install.js jvmTuning); the memory on a machine
 * whose default moved (8 GB and under: 4 GB → 3) follows only while the file
 * still says the old formula's answer for this PC. Anything the player typed
 * or set stays. Answers what it changed, for the log and for the check.
 */
function migrateToSeven(store, oldDefaultJvmArgs) {
  const changed = [];
  if ((store.get('schemaVersion') || 1) >= 7) return changed;
  if (store.get('game.jvmArgs') === oldDefaultJvmArgs) {
    store.set('game.jvmArgs', '');
    changed.push('jvmArgs');
  }
  const legacy = legacySuggestedMemory();
  const now = suggestedMemory();
  if (legacy !== now && store.get('game.memoryMb') === legacy) {
    store.set('game.memoryMb', now);
    changed.push('memoryMb');
  }
  store.set('schemaVersion', 7);
  return changed;
}

module.exports = { Store, defaults, suggestedMemory, legacySuggestedMemory, migrateToSeven };
