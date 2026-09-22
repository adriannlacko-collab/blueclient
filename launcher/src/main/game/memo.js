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

/** Beyond this the file is dropped rather than pruned: it is only a cache. */
const MAX_ENTRIES = 400;

let file = null;
let data = {};
let timer = null;

/** Point the cache at the launcher's own folder. Safe to call more than once. */
function init(userDataDir) {
  file = path.join(userDataDir, FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    data = {};
  }
  if (Object.keys(data).length > MAX_ENTRIES) data = {};
}

/** Debounced, and never allowed to throw: losing a cache is not an error. */
function save() {
  if (!file || timer) return;
  timer = setTimeout(() => {
    timer = null;
    const body = JSON.stringify(data);
    fsp.writeFile(file, body, 'utf8').catch(() => {});
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
      if (grace > 0 && await Promise.race([job.then(() => true), after(grace)])) {
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
  inFlight.set(key, promise);
  return promise;
}

module.exports = { init, get, set, stale, remember, refresh };
