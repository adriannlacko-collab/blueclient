'use strict';

/**
 * Answers that were true a moment ago and will do again.
 *
 * Pressing Play on a profile whose files are all already on disk still asked
 * the network three questions before the JVM could start: which Fabric loader
 * is current, and — for the companion mod, Fabric API and every mod in the
 * list — which jar Modrinth would hand over. None of those answers changes
 * from one minute to the next, and every one of them sat between the player's
 * click and the game. On a slow connection they were most of the wait; on a
 * dropped one they failed a launch whose files were all present.
 *
 * So they are remembered here, in one small JSON file beside the settings, and
 * a remembered answer is used until it is older than its keeper thinks
 * sensible. Two rules keep that honest:
 *
 *   - Nothing here is ever the only copy of anything. Every value is something
 *     that can be fetched again; a miss costs a request, not correctness.
 *   - A stale answer beats no answer when the network is down. `stale` hands
 *     back an expired value on purpose, for the caller that has just failed to
 *     reach the real thing and would otherwise have to give up on the launch.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const FILE = 'lookups.json';

/**
 * Beyond this the oldest answers are let go (2026-09-22).
 *
 * The file used to be dropped whole past this — "it is only a cache" — but
 * nothing in it ever expires on its own: a pairing is kept per set of mods,
 * so every set a player has switched to adds one, and every mod on every
 * Minecraft the Mods page has been asked about adds another. A launcher that
 * crossed the line lost the lot at its next start, the Java manifest the
 * offline check needs included, and the first press after paid every lookup
 * live — the wait this file exists to keep off the press. Now the newest
 * answers stay and the rest go.
 */
const MAX_ENTRIES = 400;

let file = null;
let data = {};
let timer = null;

/** Point the cache at the launcher's own folder. Safe to call more than once. */
function init(userDataDir) {
  file = path.join(userDataDir, FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    data = {};
  }
  const keys = Object.keys(data);
  if (keys.length > MAX_ENTRIES) {
    const age = (key) => (data[key] && typeof data[key].at === 'number' ? data[key].at : 0);
    const kept = {};
    for (const key of keys.sort((a, b) => age(b) - age(a)).slice(0, MAX_ENTRIES)) kept[key] = data[key];
    data = kept;
    save();
  }
}

/** The write in hand, so two never run over one file at once. */
let writing = Promise.resolve();

/**
 * Debounced, and never allowed to throw: losing a cache is not an error.
 *
 * Beside the file and renamed over it (2026-09-22), the way store.js writes
 * the settings: a launcher closed in the middle of a plain write can leave
 * half a JSON file, which the next start reads as nothing — every remembered
 * answer gone for the price of one bad moment. And one write at a time: the
 * debounce spaces them, but a write slower than the debounce (a busy disk,
 * a scanner holding the file) used to let the next one start over it.
 */
function save() {
  if (!file || timer) return;
  timer = setTimeout(() => {
    timer = null;
    const target = file;
    const body = JSON.stringify(data);
    writing = writing.then(async () => {
      const temp = `${target}.tmp`;
      await fsp.writeFile(temp, body, 'utf8');
      await fsp.rename(temp, target);
    }).catch(() => {});
  }, 400);
  if (timer.unref) timer.unref();
}

/** The value stored for `key` if it is younger than `maxAgeMs`, else undefined. */
function get(key, maxAgeMs) {
  const entry = data[key];
  if (!entry || typeof entry.at !== 'number') return undefined;
  if (Date.now() - entry.at > maxAgeMs) return undefined;
  return entry.value;
}

/** The value stored for `key` whatever its age — for when the live answer failed. */
function stale(key) {
  const entry = data[key];
  return entry ? entry.value : undefined;
}

/**
 * How long before its keep-by an answer is worth renewing behind the press
 * (2026-09-22): three of `Launcher.prime`'s ten-minute beats, so a launcher
 * left open renews each answer before it runs out rather than up to ten
 * minutes after, when a press may already have met it expired.
 */
const DUE_AHEAD_MS = 30 * 60 * 1000;

/** Whether `key` wants asking again: nothing stored, or near its `maxAgeMs`. */
function due(key, maxAgeMs, aheadMs = DUE_AHEAD_MS) {
  const entry = data[key];
  if (!entry || typeof entry.at !== 'number') return true;
  return Date.now() - entry.at > maxAgeMs - aheadMs;
}

function set(key, value) {
  if (value === undefined) return value;
  data[key] = { at: Date.now(), value };
  save();
  return value;
}

/** Keys whose refresh is already running, so a wave of asks costs one request. */
const inFlight = new Map();

/** False after `ms`, and never holding the process open. */
function after(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    if (timer.unref) timer.unref();
  });
}

/**
 * The whole shape in one call: the remembered answer, or `work()` remembered.
 *
 * A `work()` that throws falls back to a stale answer if there is one, so a
 * launch whose files are already on disk survives Modrinth being unreachable;
 * with nothing remembered the error is the caller's to handle as before.
 *
 * **`{ serveStale: true, graceMs }` puts a ceiling on what an expired answer
 * costs** (2026-09-22). Every key kept here names a file already on this PC —
 * which Fabric loader was current, which jar Modrinth handed over, which Java
 * the index pointed at — so an answer a few hours past its keep-by is the
 * launch the player had yesterday. Without this the first press of each day
 * paid the whole network round trip in front of the player, at a 60-second
 * clock and three retries, for an answer that in the ordinary case comes back
 * identical: a TTL is how often to ASK, not how long the answer is usable.
 *
 * So the renewal is started and raced against `graceMs`. A Modrinth that
 * answers in its usual quarter-second still hands the press the fresh answer,
 * which is what keeps "a newer build arrives on the next press" true; a
 * Modrinth having a bad evening is left to finish behind the player, who gets
 * yesterday's answer now and today's on their next press. The renewal is
 * single-flight per key and can never reject — losing a cache is not an error.
 */
async function remember(key, maxAgeMs, work, options) {
  const hit = get(key, maxAgeMs);
  if (hit !== undefined) return hit;
  if (options && options.serveStale) {
    const old = stale(key);
    if (old !== undefined) {
      const job = refresh(key, work);
      const grace = Number(options.graceMs) || 0;
      if (grace > 0 && await within(job, grace)) {
        const now = stale(key);
        if (now !== undefined) return now;
      }
      return old;
    }
  }
  try {
    return set(key, await work());
  } catch (error) {
    const old = stale(key);
    if (old !== undefined) return old;
    throw error;
  }
}

/**
 * Renew `key` in the background: one request per key however many ask, the
 * answer kept, a failure dropped. Returns the promise for a caller that wants
 * to wait for it (prime does; a press never does).
 */
function refresh(key, work) {
  const running = inFlight.get(key);
  if (running) return running;
  const promise = (async () => {
    try { set(key, await work()); } catch { /* the remembered answer stands */ }
  })().finally(() => { inFlight.delete(key); });
  promise.startedAt = Date.now();
  inFlight.set(key, promise);
  return promise;
}

/**
 * True when a renewal from `refresh` lands within `graceMs` of when it
 * STARTED, false as soon as that has passed (2026-09-22).
 *
 * The grace used to run from each caller's own ask: a press that set its
 * renewals going at the start (Session._run) and then met them one stage
 * at a time waited the whole grace at every stage that found its renewal
 * still out — offline, where a failed fetch retries for a second and a
 * half, that was the Fabric stage's 0.7 s and then the Java stage's 0.7 s
 * again (1.4 s measured, press to JVM). Counted from the start, every
 * renewal a press waits on runs out at the same moment, and one that has
 * been out since a `prime` beat minutes ago is not waited for at all.
 */
async function within(job, graceMs) {
  const left = Number(graceMs) - (Date.now() - (job.startedAt || Date.now()));
  if (!(left > 0)) return false;
  return Promise.race([job.then(() => true), after(left)]);
}

module.exports = { init, get, set, stale, due, remember, refresh, within };
