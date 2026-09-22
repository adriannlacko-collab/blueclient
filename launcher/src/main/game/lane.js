'use strict';

/**
 * One queue per shared resource.
 *
 * The launcher can run several games at once, and two launches of the same
 * version want exactly the same files: the same client jar, the same
 * libraries, the same asset objects, the same natives folder. Left alone they
 * would fetch and unpack them over each other — `download` writes to a single
 * `.part` file per target, and `extractNatives` writes into one shared
 * directory, so a second writer can pull the file out from under the first.
 *
 * A lane is a named queue: work handed to the same key runs one at a time, in
 * the order it arrived, while different keys run side by side. Two launches of
 * 1.21.4 therefore queue for its files and run their JVMs in parallel; a
 * launch of 1.21.4 and one of 1.20.1 never wait for each other at all.
 *
 * The second launch is normally the cheap one — by the time it reaches the
 * front of the queue everything is on disk with the right hash, so its install
 * stages sweep through in a moment. `onWait` exists so the wait can be said out
 * loud on a cold install, where the first launch may hold the lane for minutes.
 */

/** key -> { tail: Promise, holders: number } */
const lanes = new Map();

/**
 * Run `work` with nobody else holding `key`.
 *
 * @param {string} key       the shared thing being written
 * @param {() => Promise<T>} work
 * @param {() => void} [onWait] called before queueing, only when we must wait
 * @returns {Promise<T>} whatever `work` returned
 * @template T
 */
async function lane(key, work, onWait) {
  let entry = lanes.get(key);
  if (!entry) {
    entry = { tail: Promise.resolve(), holders: 0 };
    lanes.set(key, entry);
  }

  entry.holders += 1;
  const queued = entry.holders > 1;

  // Take the tail as our gate and put our own release in its place, so the
  // next caller waits on us rather than on whoever we waited for.
  const previous = entry.tail;
  let release;
  entry.tail = new Promise((resolve) => { release = resolve; });

  if (queued && onWait) onWait();

  // A failed launch must not block the ones behind it: the queue only ever
  // waits for the previous holder to be *finished*, not to have succeeded.
  await previous.catch(() => {});

  try {
    return await work();
  } finally {
    release();
    entry.holders -= 1;
    if (entry.holders === 0) lanes.delete(key);
  }
}

module.exports = { lane };
