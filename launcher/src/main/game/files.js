'use strict';

/**
 * Download and archive plumbing for the install pipeline.
 *
 * Everything the game needs is content-addressed by SHA-1, so a file that is
 * already on disk with the right hash is never fetched again — which is what
 * makes a second launch instant and lets an interrupted install resume.
 *
 * The ZIP reader is deliberately hand-rolled. The only archives opened here are
 * Mojang's native jars: stored or deflated, no encryption, no zip64. Reading
 * them directly keeps the runtime dependency list empty.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const { USER_AGENT: UA } = require('../version');

const RETRIES = 3;

/**
 * How long a download may go without a single byte arriving before the
 * attempt is given up and tried again (2026-09-19).
 *
 * Until this date every fetch had one clock: sixty seconds for the whole
 * file, however big. The runtime's `lib/modules` is 66 MB and its `jvm.dll`
 * 15, so on any connection under about a megabyte a second they were cut off
 * at the minute, tried again from the first byte, and cut off again — and the
 * player's launch ended in "This operation was aborted" three minutes in,
 * with the rest of the runtime already on disk. The launch after found
 * `javaw.exe` and ran the half-runtime ("Failed setting boot class path",
 * exit 0xC0000135), which is what two players' logs said. A clock on the
 * whole file cannot be right for a file this size on a connection that slow;
 * the clock is on the silence now, and a download that is still moving is
 * left to finish at its own pace.
 */
const STALL_MS = 30000;

/** A server that has not started answering at all. */
const CONNECT_MS = 30000;

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

/** True when the file exists and, if a hash was given, matches it. */
async function isPresent(file, expectedSha1, expectedSize) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size === 0) return false;
    if (expectedSize && stat.size !== expectedSize) return false;
    if (!expectedSha1) return true;
    return sha1(await fsp.readFile(file)) === expectedSha1;
  } catch {
    return false;
  }
}

async function fetchBuffer(url, { timeout = 60000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      lastError = error;
      // Back off a little before trying again; most failures here are transient.
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  return JSON.parse((await fetchBuffer(url)).toString('utf8'));
}

/**
 * Fetch to disk unless an identical file is already there.
 *
 * A file this module wrote was hash-checked before the rename that put it in
 * place, so on later launches existence at the right size is proof enough —
 * re-reading and re-hashing hundreds of megabytes of assets on every Play
 * press was most of the "verifying" wall time. The full hash check still runs
 * whenever no size is known to compare against.
 *
 * <h2>Streamed, resumed, and never timed as a whole (2026-09-19)</h2>
 * The body goes to the `.part` file as it arrives rather than into memory
 * first, so a 66 MB runtime image is never 66 MB of heap, and the hash is
 * taken as it streams. An attempt is only given up when nothing has arrived
 * for {@link STALL_MS}; a slow connection is left to finish. A `.part` an
 * earlier attempt (or an earlier launch — a closed launcher, a lost
 * connection) left behind is picked up where it stopped with a Range
 * request when the size is known; a server that answers with the whole file
 * instead starts the part over. What was already on disk is hashed first so
 * the check at the end still covers every byte.
 *
 * @param {object}   [meta]    `sha1` and `size` where the manifest knows them
 * @param {object}   [options]
 * @param {Function} [options.onBytes] `(received, total)` as the body arrives —
 *   `total` is the known size, else the Content-Length, else 0
 * @param {number}   [options.stallMs] the silence allowed, for the check under tools/
 * @returns {Promise<boolean>} true when it actually downloaded
 */
async function download(url, file, meta = {}, options = {}) {
  const { sha1: expected, size } = meta || {};
  if (await isPresent(file, size ? null : expected, size)) return false;

  // Somebody in this process is already fetching this very file (see
  // `fetching`): wait for them, then look again — their copy is almost
  // always the answer, and if theirs failed this one tries on its own.
  const key = targetKey(file);
  const running = fetching.get(key);
  if (running) {
    await running.catch(() => {});
    return download(url, file, meta, options);
  }

  const job = fetchInto(url, file, expected, size, options || {});
  fetching.set(key, job);
  try {
    return await job;
  } finally {
    if (fetching.get(key) === job) fetching.delete(key);
  }
}

/**
 * The files being fetched right now, by target (2026-09-22).
 *
 * Lanes (game/lane.js) keep two launches of one *version* off each other's
 * files, but the files themselves are shared wider than that: every Fabric
 * profile runs the same loader and ASM jars whatever its Minecraft, a vanilla
 * and a Fabric profile on one Minecraft are two version ids over one set of
 * libraries, and two asset indexes share most of their objects. Two such
 * launches pressed together each wrote the same `.part` — the second
 * resumed onto the first one's half-written file, or truncated it, and the
 * first one's rename then took the part out from under the second: three
 * attempts later a launch could end on "ENOENT … lib.jar.part" (measured
 * against a local server that honours ranges the way Mojang's does: one
 * launch in ten, and 47 requests for 20 files). One fetch per file now,
 * whoever asks; the second caller waits and finds the file in place.
 */
const fetching = new Map();

/** One spelling per file: Windows' paths are the same file in any case. */
function targetKey(file) {
  const full = path.resolve(file);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

async function fetchInto(url, file, expected, size, { onBytes, stallMs = STALL_MS }) {
  await ensureDir(path.dirname(file));
  // Write beside the target then rename, so an interrupted run never leaves a
  // half-written file that looks complete.
  const temp = `${file}.part`;

  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const digest = await fetchToFile(url, temp, { expected, size, onBytes, stallMs });
      if (expected && digest !== expected) {
        // The bytes are wrong, whole or resumed: the next attempt starts over.
        await fsp.rm(temp, { force: true }).catch(() => {});
        throw new Error(`Checksum mismatch for ${path.basename(file)}`);
      }
      if (size && (await fsp.stat(temp)).size !== size) {
        await fsp.rm(temp, { force: true }).catch(() => {});
        throw new Error(`Wrong size for ${path.basename(file)}`);
      }
      await fsp.rename(temp, file);
      return true;
    } catch (error) {
      // The caller's own progress hook threw — a launch cancelled mid-file
      // (Session's stager) — and that is not a failure to try again.
      if (error && error.abandons) throw error;
      lastError = error;
      // Back off a little before trying again; most failures here are transient.
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * One attempt: the body onto `temp`, appended to whatever a previous attempt
 * left there when the server allows it, hashed on the way.
 *
 * @returns {Promise<string|null>} the sha1 of the whole file on disk, or null
 *   when no hash was asked for
 */
async function fetchToFile(url, temp, { expected, size, onBytes, stallMs }) {
  // What an earlier attempt left. Only worth resuming when the size is known
  // — a part with no size to measure against could be all of it or a byte.
  let have = 0;
  if (size) {
    try {
      const stat = await fsp.stat(temp);
      if (stat.isFile() && stat.size > 0 && stat.size < size) have = stat.size;
      else if (stat.isFile() && stat.size >= size) await fsp.rm(temp, { force: true });
    } catch { /* nothing left behind */ }
  }

  const controller = new AbortController();
  let timer = null;
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), ms);
  };

  let handle = null;
  try {
    arm(CONNECT_MS);
    const headers = { 'User-Agent': UA };
    if (have) headers.Range = `bytes=${have}-`;
    const res = await fetch(url, { headers, signal: controller.signal });

    // 206 is the rest of the file; 200 is the whole of it whatever was asked
    // for, so the part starts again. Anything else is a failure.
    if (res.status === 206 && have) {
      handle = await fsp.open(temp, 'a');
    } else if (res.ok) {
      have = 0;
      handle = await fsp.open(temp, 'w');
    } else {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    const hash = expected ? crypto.createHash('sha1') : null;
    if (hash && have) {
      // The bytes already on disk are part of the file the hash has to cover.
      for await (const kept of fs.createReadStream(temp)) hash.update(kept);
    }

    const length = Number(res.headers.get('content-length')) || 0;
    const total = size || (have + length) || 0;
    let received = have;
    // A throw out of the hook is the caller's, and ends the download for
    // good rather than costing two more attempts (see `download`).
    const tell = () => {
      if (!onBytes) return;
      try { onBytes(received, total); } catch (error) { if (error) error.abandons = true; throw error; }
    };
    tell();

    if (res.body) {
      arm(stallMs);
      for await (const chunk of res.body) {
        arm(stallMs);
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        await handle.write(bytes);
        if (hash) hash.update(bytes);
        received += bytes.length;
        tell();
      }
    }
    return hash ? hash.digest('hex') : null;
  } catch (error) {
    // The abort is ours: say what it was, in words a launch can repeat.
    // (undici reports it as an AbortError before the body and as a
    // "terminated" TypeError during it; the signal says which it was.)
    if (controller.signal.aborted) {
      throw new Error(`The download of ${path.basename(temp, '.part')} stalled`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Run tasks with a cap on how many are in flight.
 *
 * Assets are thousands of tiny files; without a cap the process opens
 * thousands of sockets and Windows starts refusing them.
 *
 * Each runner takes the next index rather than shifting the front off a copy
 * of the list: shifting an eight-thousand-entry array eight thousand times is
 * a hidden quadratic in the middle of the asset stage. And the first failure
 * stops the rest — the caller is about to give up on the whole stage anyway,
 * and runners left draining a queue nobody is waiting for went on to reject
 * into nothing.
 */
async function pool(items, limit, worker, onEach) {
  const list = Array.isArray(items) ? items : [...items];
  let next = 0;
  let done = 0;
  let failure = null;

  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length && !failure) {
      const item = list[next++];
      try {
        await worker(item);
      } catch (error) {
        if (!failure) failure = error;
        return;
      }
      done += 1;
      onEach?.(done);
    }
  });

  await Promise.all(runners);
  if (failure) throw failure;
}

/* ------------------------------------------------------------------- zip */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/** Entries from a zip's central directory: { name, method, offset, size }. */
function readCentralDirectory(buf) {
  // The end-of-central-directory record lives in the last 64KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip archive');

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CEN_SIG) break;
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);

    entries.push({
      method: buf.readUInt16LE(offset + 10),
      compressedSize: buf.readUInt32LE(offset + 20),
      size: buf.readUInt32LE(offset + 24),
      localOffset: buf.readUInt32LE(offset + 42),
      name: buf.toString('utf8', offset + 46, offset + 46 + nameLength)
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntry(buf, entry) {
  // The local header repeats the name and extra fields, at its own lengths.
  const start = entry.localOffset;
  const nameLength = buf.readUInt16LE(start + 26);
  const extraLength = buf.readUInt16LE(start + 28);
  const dataStart = start + 30 + nameLength + extraLength;
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return data;                 // stored
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported zip compression (${entry.method}) in ${entry.name}`);
}

/**
 * Extract a native jar into a directory.
 *
 * Only the files the JVM will actually load are written: metadata, signatures
 * and nested directories are skipped, matching what the vanilla launcher does
 * with its `extract.exclude` rules.
 */
async function extractNatives(jarFile, targetDir, exclude = []) {
  const buf = await fsp.readFile(jarFile);
  await ensureDir(targetDir);

  for (const entry of readCentralDirectory(buf)) {
    if (entry.name.endsWith('/')) continue;
    if (entry.name.startsWith('META-INF/')) continue;
    if (exclude.some((prefix) => entry.name.startsWith(prefix))) continue;

    // Native loading is flat; a jar that nests them still yields a flat dir.
    const out = path.join(targetDir, path.basename(entry.name));
    if (fs.existsSync(out)) continue;
    await fsp.writeFile(out, readEntry(buf, entry));
  }
}

module.exports = {
  ensureDir,
  sha1,
  isPresent,
  fetchBuffer,
  fetchJson,
  download,
  pool,
  extractNatives
};
