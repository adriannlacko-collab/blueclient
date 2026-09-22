'use strict';

/**
 * Jars taken apart and put back together, without inflating a byte (2026-09-10).
 *
 * The in-game half ships as one jar per Minecraft — five of them — and 5.4 of
 * each one's 5.7 megabytes is the same in every one: the title-screen
 * panorama, the two cloud pictures, two weights of Inter, the icon. None of
 * it is compiled and none of it differs between versions. The installer's
 * solid compression already noticed and shipped those bytes once; the folder
 * on disk and the update bundle did not, and paid for them five times over —
 * 24 MB of jars on disk that are 6 MB of different content.
 *
 * So `scripts/build-mod.mjs` splits what Gradle built. Every entry that is
 * byte-for-byte the same in all the jars goes once into
 * `blueclient-shared.zip`, and each jar keeps only what is its own: its
 * classes, its `fabric.mod.json`, its `pack.mcmeta`. `mods.js` puts the two
 * back together into the profile's `blueclient.jar` before the game starts,
 * and that is what Fabric loads — the same entries with the same compressed
 * bytes, under a fresh set of headers.
 *
 * A zip is a run of local headers each followed by its data, then a central
 * directory naming every entry and where its local header sits, then one
 * record saying where the directory starts. Moving an entry between files is
 * therefore copying its compressed bytes and writing new headers round them.
 * Nothing is decompressed, so nothing can come back compressed differently.
 * Local headers are written from the directory's own numbers with the
 * data-descriptor bit cleared: Gradle writes zeros there and a descriptor
 * after the data, which is legal and no longer needed once the sizes are
 * known. The entry a jar puts first — `META-INF/MANIFEST.MF`, which some
 * readers expect first — stays first, because a jar's own entries keep their
 * order and go in ahead of the shared ones.
 *
 * No zip64 (these are megabytes with a few hundred entries) and nothing
 * encrypted; a file that needs either is refused rather than mangled.
 *
 * <h2>Worlds' backups: the same format, streamed (2026-09-11)</h2>
 * The Worlds tab zips a world when the game closes (game/worlds.js), and a
 * world is not a jar: BlueTest is 179 files and 48 MB, a long survival world
 * is gigabytes. So `pack`, `open` and `unpack` below are the same zip written
 * and read a file at a time — a read stream through `zlib.createDeflateRaw`
 * into the target, the CRC taken on the way past, never a whole world in
 * memory and never a byte of deflate on the main thread (zlib streams work on
 * the thread pool). Measured on BlueTest: deflate level 1 halves it, 47.7 →
 * 25.2 MB in 450 ms, and level 6 buys 0.1 MB more for 170 ms more — region
 * files carry zlib-compressed chunks but pad them to 4 KB sectors, which is
 * what deflate finds. So level 1, and three backups of a world cost a
 * world-and-a-half of disk rather than three.
 *
 * Only this streamed pair speaks zip64: a world past 4 GB gets 8-byte sizes
 * and offsets in its central directory (and, for that entry, in its local
 * header), the way Java's ZipOutputStream writes them, and `open` reads them
 * back. A world that big is exactly the one whose backup must not be refused.
 * The in-memory `read` and `write` above stay as they were. The local headers
 * `pack` writes carry the data-descriptor bit with the sizes after the data —
 * what Gradle does, what `write()` already tolerates — and the central
 * directory carries the truth; `open` reads only that.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { Readable, Transform, Writable } = require('stream');
const { pipeline } = require('stream/promises');

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const DESCRIPTOR_SIG = 0x08074b50;
const ZIP64_END_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const DESCRIPTOR_BIT = 0x0008;
const END_SCAN = 65557; // 22-byte record plus the longest comment a zip allows
const FOUR_GB = 0xffffffff;

/* ------------------------------------------------------------------ read */

/**
 * The central directory of a zip held in memory.
 *
 * @returns {{ entries: Entry[], comment: Buffer }}
 */
function read(buf) {
  const end = findEnd(buf);
  const count = buf.readUInt16LE(end + 10);
  const total = buf.readUInt16LE(end + 8);
  if (count !== total || buf.readUInt16LE(end + 4) !== 0) throw new Error('multi-part zip');
  const directoryStart = buf.readUInt32LE(end + 16);
  if (count === 0xffff || directoryStart === FOUR_GB || buf.readUInt32LE(end + 12) === FOUR_GB) {
    throw new Error('zip64 archive');
  }

  const commentLength = buf.readUInt16LE(end + 20);
  const comment = buf.subarray(end + 22, end + 22 + commentLength);

  const entries = parseDirectory(buf, directoryStart, count, false);
  return { entries, comment };
}

/**
 * `count` central-directory records starting at `at` in `buf` — the one
 * parser both readers use: `read` hands it the whole zip, `open` hands it the
 * directory it read off the disk on its own.
 *
 * With `zip64` off a record carrying 0xffffffff is refused, as it always was
 * on the in-memory path. With it on, the real size, compressed size and
 * offset are taken from the record's zip64 extra field (id 1: eight-byte
 * values, present only for the fields that overflowed, in that order).
 */
function parseDirectory(buf, at, count, zip64) {
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== CENTRAL_SIG) throw new Error('bad central directory');
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const entryCommentLength = buf.readUInt16LE(at + 32);
    const entry = {
      versionMade: buf.readUInt16LE(at + 4),
      versionNeeded: buf.readUInt16LE(at + 6),
      flags: buf.readUInt16LE(at + 8),
      method: buf.readUInt16LE(at + 10),
      time: buf.readUInt16LE(at + 12),
      date: buf.readUInt16LE(at + 14),
      crc: buf.readUInt32LE(at + 16),
      csize: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      internal: buf.readUInt16LE(at + 36),
      external: buf.readUInt32LE(at + 38),
      localOffset: buf.readUInt32LE(at + 42),
      nameBytes: buf.subarray(at + 46, at + 46 + nameLength),
      extra: buf.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength),
      comment: buf.subarray(at + 46 + nameLength + extraLength,
        at + 46 + nameLength + extraLength + entryCommentLength)
    };
    entry.name = entry.nameBytes.toString('utf8');
    if (entry.csize === FOUR_GB || entry.size === FOUR_GB || entry.localOffset === FOUR_GB) {
      if (!zip64) throw new Error('zip64 entry: ' + entry.name);
      readZip64Extra(entry);
    }
    if (entry.flags & 0x0001) throw new Error('encrypted entry: ' + entry.name);
    entries.push(entry);
    at += 46 + nameLength + extraLength + entryCommentLength;
  }
  return entries;
}

/** Fill an entry's overflowed fields from its zip64 extra field, in place. */
function readZip64Extra(entry) {
  const extra = entry.extra;
  for (let p = 0; p + 4 <= extra.length;) {
    const id = extra.readUInt16LE(p);
    const length = extra.readUInt16LE(p + 2);
    if (id === ZIP64_EXTRA_ID) {
      let q = p + 4;
      const next = () => { const v = Number(extra.readBigUInt64LE(q)); q += 8; return v; };
      if (entry.size === FOUR_GB) entry.size = next();
      if (entry.csize === FOUR_GB) entry.csize = next();
      if (entry.localOffset === FOUR_GB) entry.localOffset = next();
      return;
    }
    p += 4 + length;
  }
  throw new Error('zip64 entry without its sizes: ' + entry.name);
}

/** The end-of-central-directory record sits in the last 64KB; scan back for it. */
function findEnd(buf) {
  const floor = Math.max(0, buf.length - END_SCAN);
  for (let at = buf.length - 22; at >= floor; at--) {
    if (buf.readUInt32LE(at) === END_SIG && at + 22 + buf.readUInt16LE(at + 20) === buf.length) return at;
  }
  throw new Error('not a zip');
}

/** An entry's compressed bytes, exactly as stored. */
function dataOf(buf, entry) {
  const at = entry.localOffset;
  if (buf.readUInt32LE(at) !== LOCAL_SIG) throw new Error('bad local header: ' + entry.name);
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  return buf.subarray(start, start + entry.csize);
}

/** Every entry with its bytes, in the order the file holds them. */
function items(buf) {
  const { entries, comment } = read(buf);
  return { items: entries.map((entry) => ({ entry, data: dataOf(buf, entry) })), comment };
}

/* ----------------------------------------------------------------- write */

/**
 * A zip made of the given items, in order, with a comment.
 *
 * @param {{ entry: Entry, data: Buffer }[]} list
 * @param {string} [comment]
 */
function write(list, comment = '') {
  const commentBytes = Buffer.from(comment, 'utf8');
  if (commentBytes.length > 0xffff) throw new Error('comment too long');
  if (list.length >= 0xffff) throw new Error('too many entries for a plain zip');

  const parts = [];
  const offsets = [];
  let at = 0;

  for (const { entry, data } of list) {
    if (data.length !== entry.csize) throw new Error('size mismatch: ' + entry.name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_SIG, 0);
    header.writeUInt16LE(entry.versionNeeded, 4);
    header.writeUInt16LE(entry.flags & ~DESCRIPTOR_BIT, 6);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(entry.time, 10);
    header.writeUInt16LE(entry.date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.csize, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(entry.nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    offsets.push(at);
    parts.push(header, entry.nameBytes, data);
    at += header.length + entry.nameBytes.length + data.length;
  }

  const directoryStart = at;
  list.forEach(({ entry }, i) => {
    const record = Buffer.alloc(46);
    record.writeUInt32LE(CENTRAL_SIG, 0);
    record.writeUInt16LE(entry.versionMade, 4);
    record.writeUInt16LE(entry.versionNeeded, 6);
    record.writeUInt16LE(entry.flags & ~DESCRIPTOR_BIT, 8);
    record.writeUInt16LE(entry.method, 10);
    record.writeUInt16LE(entry.time, 12);
    record.writeUInt16LE(entry.date, 14);
    record.writeUInt32LE(entry.crc, 16);
    record.writeUInt32LE(entry.csize, 20);
    record.writeUInt32LE(entry.size, 24);
    record.writeUInt16LE(entry.nameBytes.length, 28);
    record.writeUInt16LE(entry.extra.length, 30);
    record.writeUInt16LE(entry.comment.length, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt16LE(entry.internal, 36);
    record.writeUInt32LE(entry.external, 38);
    record.writeUInt32LE(offsets[i], 42);
    parts.push(record, entry.nameBytes, entry.extra, entry.comment);
    at += record.length + entry.nameBytes.length + entry.extra.length + entry.comment.length;
  });

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(list.length, 8);
  end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(at - directoryStart, 12);
  end.writeUInt32LE(directoryStart, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  parts.push(end, commentBytes);

  return Buffer.concat(parts);
}

/* ------------------------------------------------------------- split/join */

/** True when two items are the same entry with the same bytes. */
function same(a, b) {
  return a.entry.name === b.entry.name
    && a.entry.method === b.entry.method
    && a.entry.crc === b.entry.crc
    && a.entry.size === b.entry.size
    && a.entry.csize === b.entry.csize
    && a.data.equals(b.data);
}

/**
 * What several jars have in common, and what each keeps for itself.
 *
 * An entry is shared only when every jar holds it with identical bytes. The
 * shared list keeps the first jar's order; each jar's own list keeps that
 * jar's order, so its manifest stays at the front.
 *
 * @param {Buffer[]} jars
 * @returns {{ shared: Item[], own: Item[][] }}
 */
function split(jars) {
  const all = jars.map((buf) => items(buf).items);
  if (all.length < 2) return { shared: [], own: all };

  const byName = all.map((list) => new Map(list.map((item) => [item.entry.name, item])));
  const shared = [];
  const sharedNames = new Set();
  for (const item of all[0]) {
    const everywhere = byName.every((map) => {
      const other = map.get(item.entry.name);
      return other && same(item, other);
    });
    if (everywhere) {
      shared.push(item);
      sharedNames.add(item.entry.name);
    }
  }
  const own = all.map((list) => list.filter((item) => !sharedNames.has(item.entry.name)));
  return { shared, own };
}

/**
 * A jar's own entries followed by the shared ones, as one jar.
 *
 * An entry present in both is taken from the jar — its own copy is the one
 * built for that version — so a shared file that later becomes version-
 * specific cannot shadow the right one.
 */
function join(ownBuf, sharedBuf, comment = '') {
  const own = items(ownBuf).items;
  const names = new Set(own.map((item) => item.entry.name));
  const shared = items(sharedBuf).items.filter((item) => !names.has(item.entry.name));
  return write([...own, ...shared], comment);
}

/* ----------------------------------------------------------------- files */

/**
 * The comment a zip on disk carries, read from its tail without loading the
 * rest, or null when there is no readable zip there.
 */
async function readComment(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, END_SCAN);
    const tail = Buffer.alloc(length);
    await handle.read(tail, 0, length, size - length);
    const end = findEnd(tail);
    return tail.subarray(end + 22, end + 22 + tail.readUInt16LE(end + 20)).toString('utf8');
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Write `own` + `shared` to `target`, stamped with `comment`, beside-and-rename
 * so a game starting mid-write never opens half a jar.
 */
async function assemble(ownFile, sharedFile, target, comment) {
  const [own, shared] = await Promise.all([fsp.readFile(ownFile), fsp.readFile(sharedFile)]);
  const out = join(own, shared, comment);
  const temp = `${target}.part`;
  await fsp.writeFile(temp, out);
  await fsp.rename(temp, target);
  return out.length;
}

/* -------------------------------------------------------------- streamed */
/* A folder to a zip on disk and back, one file at a time (2026-09-11). See
   the header: this is the worlds' backup format, and the only place zip64
   is spoken. */

/** CRC-32 as zlib computes it; Node 20.15 (Electron 32) has it built in. */
const crc32 = typeof zlib.crc32 === 'function'
  ? (chunk, previous = 0) => zlib.crc32(chunk, previous)
  : (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return (chunk, previous = 0) => {
      let c = (previous ^ 0xffffffff) >>> 0;
      for (let i = 0; i < chunk.length; i++) c = table[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
  })();

/** A date as the two 16-bit MS-DOS numbers a zip header carries (local time, 2 s). */
function dosStamp(when) {
  const d = new Date(when);
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/** The Date those two numbers meant. */
function dosDate(time, date) {
  return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31,
    time >> 11, (time >> 5) & 63, (time & 31) * 2);
}

/** Eight-byte little-endian numbers, for the zip64 records. */
function u64(...values) {
  const out = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => out.writeBigUInt64LE(BigInt(v), i * 8));
  return out;
}

/**
 * Every file and empty folder under `dir`, as `{ rel, full, size, mtime,
 * dir }`, in a fixed order (folders walked sorted), relative paths with
 * forward slashes. `skip(rel)` leaves a file out — the game's `session.lock`,
 * which Windows will not let anyone else read while the game holds it.
 */
async function walk(dir, skip) {
  const out = [];
  const visit = async (folder, rel) => {
    const children = (await fsp.readdir(folder, { withFileTypes: true }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let kept = 0;
    for (const child of children) {
      const full = path.join(folder, child.name);
      const childRel = rel ? `${rel}/${child.name}` : child.name;
      if (child.isDirectory()) {
        await visit(full, childRel);
        kept++;
      } else if (child.isFile()) {
        if (skip && skip(childRel)) continue;
        const stat = await fsp.stat(full);
        out.push({ rel: childRel, full, size: stat.size, mtime: stat.mtimeMs, dir: false });
        kept++;
      }
    }
    // An empty folder gets an entry of its own, so the tree comes back whole.
    if (rel && kept === 0) out.push({ rel: `${rel}/`, full: folder, size: 0, mtime: Date.now(), dir: true });
  };
  await visit(dir, '');
  return out;
}

/**
 * Zip a folder to `target`, streamed.
 *
 * Written to `<target>.part` and renamed at the end, so a half-written backup
 * never carries the name of a whole one. `level` is the deflate level (0
 * stores); `comment` is the zip's comment; `skip(rel)` leaves files out;
 * `zip64From` is the byte count past which sizes and offsets take the zip64
 * form — 4 GB by nature, lowered by the check script so a small world walks
 * the same path a huge one would.
 *
 * @returns {Promise<{ bytes: number, files: number, entries: number, raw: number }>}
 *   the zip's size, its files, its entries (files plus empty folders), and
 *   the bytes those files were before compression
 */
async function pack(dir, target, { skip, level = 1, comment = '', zip64From = FOUR_GB } = {}) {
  const commentBytes = Buffer.from(comment, 'utf8');
  if (commentBytes.length > 0xffff) throw new Error('comment too long');

  const list = await walk(dir, skip);
  const temp = `${target}.part`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const out = fs.createWriteStream(temp);
  let failed = null;
  let waiting = null;
  const wake = () => { const w = waiting; waiting = null; if (w) w(); };
  out.on('error', (error) => { failed = failed || error; wake(); });
  out.on('drain', wake);

  /* `at` is the position in the file — every byte goes through here, so it
     is always the offset the next header will sit at. Writes are handed to
     the stream and only waited on when it asks (a false return, then
     'drain'), so deflate and the disk overlap rather than take turns. */
  let at = 0;
  const write = (buf) => new Promise((resolve, reject) => {
    if (failed) { reject(failed); return; }
    at += buf.length;
    if (out.write(buf)) { resolve(); return; }
    waiting = () => (failed ? reject(failed) : resolve());
  });

  const records = [];
  let raw = 0;

  try {
    for (const item of list) {
      const nameBytes = Buffer.from(item.rel, 'utf8');
      const method = item.dir || level === 0 ? 0 : 8;
      const { time, date } = dosStamp(item.mtime);
      const localOffset = at;

      // Decided before the data is written, because the local header comes
      // first: an entry whose sizes may not fit 32 bits gets the zip64 form
      // there too, with a margin for deflate's worst case (five bytes per
      // stored 64 KB block) on data it cannot shrink.
      const worst = item.size + Math.ceil(item.size / 65535) * 5 + 32;
      const wide = worst >= zip64From || localOffset >= zip64From;

      const local = Buffer.alloc(30);
      local.writeUInt32LE(LOCAL_SIG, 0);
      local.writeUInt16LE(wide ? 45 : 20, 4);
      local.writeUInt16LE(DESCRIPTOR_BIT, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      // CRC and both sizes follow the data (the descriptor bit); a zip64 local
      // header says so with 0xffffffff and an extra field of placeholders.
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(wide ? FOUR_GB : 0, 18);
      local.writeUInt32LE(wide ? FOUR_GB : 0, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      local.writeUInt16LE(wide ? 20 : 0, 28);
      await write(local);
      await write(nameBytes);
      if (wide) {
        const extra = Buffer.alloc(20);
        extra.writeUInt16LE(ZIP64_EXTRA_ID, 0);
        extra.writeUInt16LE(16, 2);
        await write(extra);
      }

      let crc = 0;
      let size = 0;
      let csize = 0;
      if (!item.dir) {
        const tap = new Transform({
          transform(chunk, _encoding, callback) {
            crc = crc32(chunk, crc);
            size += chunk.length;
            callback(null, chunk);
          }
        });
        const sink = new Writable({
          write(chunk, _encoding, callback) {
            csize += chunk.length;
            write(chunk).then(() => callback(), callback);
          }
        });
        const stages = [fs.createReadStream(item.full), tap];
        if (method === 8) stages.push(zlib.createDeflateRaw({ level }));
        stages.push(sink);
        await pipeline(stages);
      }

      const descriptor = Buffer.alloc(wide ? 24 : 16);
      descriptor.writeUInt32LE(DESCRIPTOR_SIG, 0);
      descriptor.writeUInt32LE(crc, 4);
      if (wide) u64(csize, size).copy(descriptor, 8);
      else { descriptor.writeUInt32LE(csize, 8); descriptor.writeUInt32LE(size, 12); }
      await write(descriptor);

      raw += size;
      records.push({ nameBytes, method, time, date, crc, csize, size, localOffset, dir: item.dir, wide });
    }

    /* The central directory: the truth about every entry, sizes and offsets
       widened to eight bytes where they overflow. */
    const directoryStart = at;
    for (const r of records) {
      const over = [];
      if (r.size >= zip64From) over.push(r.size);
      if (r.csize >= zip64From) over.push(r.csize);
      if (r.localOffset >= zip64From) over.push(r.localOffset);
      const extra = over.length ? Buffer.concat([Buffer.alloc(4), u64(...over)]) : Buffer.alloc(0);
      if (over.length) { extra.writeUInt16LE(ZIP64_EXTRA_ID, 0); extra.writeUInt16LE(over.length * 8, 2); }

      const record = Buffer.alloc(46);
      record.writeUInt32LE(CENTRAL_SIG, 0);
      record.writeUInt16LE(over.length || r.wide ? 45 : 20, 4);
      record.writeUInt16LE(over.length || r.wide ? 45 : 20, 6);
      record.writeUInt16LE(DESCRIPTOR_BIT, 8);
      record.writeUInt16LE(r.method, 10);
      record.writeUInt16LE(r.time, 12);
      record.writeUInt16LE(r.date, 14);
      record.writeUInt32LE(r.crc, 16);
      record.writeUInt32LE(r.csize >= zip64From ? FOUR_GB : r.csize, 20);
      record.writeUInt32LE(r.size >= zip64From ? FOUR_GB : r.size, 24);
      record.writeUInt16LE(r.nameBytes.length, 28);
      record.writeUInt16LE(extra.length, 30);
      record.writeUInt16LE(0, 32);
      record.writeUInt16LE(0, 34);
      record.writeUInt16LE(0, 36);
      record.writeUInt32LE(r.dir ? 0x10 : 0, 38);
      record.writeUInt32LE(r.localOffset >= zip64From ? FOUR_GB : r.localOffset, 42);
      await write(record);
      await write(r.nameBytes);
      if (extra.length) await write(extra);
    }
    const directorySize = at - directoryStart;

    /* Past the 32-bit edge the end record points at a zip64 end record, and
       a locator between the two says where that is. */
    const wideEnd = records.length >= 0xffff || directoryStart >= zip64From || directorySize >= zip64From;
    if (wideEnd) {
      const zip64End = Buffer.alloc(56);
      zip64End.writeUInt32LE(ZIP64_END_SIG, 0);
      u64(44).copy(zip64End, 4);
      zip64End.writeUInt16LE(45, 12);
      zip64End.writeUInt16LE(45, 14);
      zip64End.writeUInt32LE(0, 16);
      zip64End.writeUInt32LE(0, 20);
      u64(records.length, records.length, directorySize, directoryStart).copy(zip64End, 24);
      const zip64EndAt = at;
      await write(zip64End);

      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(ZIP64_LOCATOR_SIG, 0);
      locator.writeUInt32LE(0, 4);
      u64(zip64EndAt).copy(locator, 8);
      locator.writeUInt32LE(1, 16);
      await write(locator);
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_SIG, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(Math.min(records.length, 0xffff), 8);
    end.writeUInt16LE(Math.min(records.length, 0xffff), 10);
    end.writeUInt32LE(directorySize >= zip64From ? FOUR_GB : directorySize, 12);
    end.writeUInt32LE(directoryStart >= zip64From ? FOUR_GB : directoryStart, 16);
    end.writeUInt16LE(commentBytes.length, 20);
    await write(end);
    await write(commentBytes);

    await new Promise((resolve, reject) => out.end((error) => (error || failed ? reject(error || failed) : resolve())));
    await fsp.rename(temp, target);
    return { bytes: at, files: records.filter((r) => !r.dir).length, entries: records.length, raw };
  } catch (error) {
    out.destroy();
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * A zip on disk, opened for reading entry by entry.
 *
 * Reads the tail and the central directory and nothing else; `stream(entry)`
 * hands back that entry's bytes inflated and CRC-checked (the stream errors
 * if the check fails, before anyone has trusted the data). `close()` lets go
 * of the file.
 *
 * @returns {Promise<{ entries: Entry[], comment: string, stream(entry): Readable, close(): Promise }>}
 */
async function open(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    const tailLength = Math.min(fileSize, END_SCAN + 20);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, fileSize - tailLength);
    const end = findEnd(tail);
    if (tail.readUInt16LE(end + 4) !== 0) throw new Error('multi-part zip');
    const comment = tail.subarray(end + 22, end + 22 + tail.readUInt16LE(end + 20)).toString('utf8');

    let count = tail.readUInt16LE(end + 10);
    let directorySize = tail.readUInt32LE(end + 12);
    let directoryStart = tail.readUInt32LE(end + 16);
    if (count === 0xffff || directorySize === FOUR_GB || directoryStart === FOUR_GB) {
      if (end < 20 || tail.readUInt32LE(end - 20) !== ZIP64_LOCATOR_SIG) throw new Error('zip64 archive without a locator');
      const zip64EndAt = Number(tail.readBigUInt64LE(end - 20 + 8));
      const zip64End = Buffer.alloc(56);
      await handle.read(zip64End, 0, 56, zip64EndAt);
      if (zip64End.readUInt32LE(0) !== ZIP64_END_SIG) throw new Error('bad zip64 end record');
      count = Number(zip64End.readBigUInt64LE(32));
      directorySize = Number(zip64End.readBigUInt64LE(40));
      directoryStart = Number(zip64End.readBigUInt64LE(48));
    }

    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryStart);
    const entries = parseDirectory(directory, 0, count, true);

    const stream = (entry) => {
      let crc = 0;
      let seen = 0;
      /* The entry's bytes come out of this, and so does any failure on the
         way: pipeline destroys it with the error, so whoever is reading it
         sees the failure rather than a short file. */
      const check = new Transform({
        transform(chunk, _encoding, callback) {
          crc = crc32(chunk, crc);
          seen += chunk.length;
          callback(null, chunk);
        },
        flush(callback) {
          if (seen !== entry.size) callback(new Error(`size mismatch in ${entry.name}`));
          else if (crc !== entry.crc) callback(new Error(`CRC mismatch in ${entry.name}`));
          else callback();
        }
      });

      (async () => {
        if (entry.method !== 0 && entry.method !== 8) throw new Error(`unsupported method ${entry.method} in ${entry.name}`);
        const stages = [];
        if (entry.csize === 0) {
          stages.push(Readable.from([]));
        } else {
          // The local header's own name and extra lengths, not the
          // directory's: the two are allowed to differ, and here they do
          // (the zip64 extra).
          const head = Buffer.alloc(30);
          await handle.read(head, 0, 30, entry.localOffset);
          if (head.readUInt32LE(0) !== LOCAL_SIG) throw new Error('bad local header: ' + entry.name);
          const start = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
          // The numeric fd, not the handle: a stream made from the handle
          // hangs a close listener on it for good, one per entry read.
          stages.push(fs.createReadStream(null, { fd: handle.fd, start, end: start + entry.csize - 1, autoClose: false }));
          if (entry.method === 8) stages.push(zlib.createInflateRaw());
        }
        stages.push(check);
        await pipeline(stages);
      })().catch((error) => check.destroy(error));

      return check;
    };

    return {
      entries,
      comment,
      stream,
      close: () => handle.close().catch(() => {})
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

/**
 * Unpack a zip made by `pack` (or anyone) into `dir`, every file CRC-checked
 * as it lands; a failed check throws with the folder half-written, which is
 * why worlds.js unpacks beside the live world and only then swaps. Entry
 * names that would leave `dir` are refused.
 *
 * @returns {Promise<{ files: number, bytes: number }>}
 */
async function unpack(file, dir) {
  const zip = await open(file);
  const root = path.resolve(dir);
  let files = 0;
  let bytes = 0;
  try {
    await fsp.mkdir(root, { recursive: true });
    for (const entry of zip.entries) {
      const target = path.resolve(root, entry.name);
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error('entry escapes the folder: ' + entry.name);
      if (entry.name.endsWith('/')) {
        await fsp.mkdir(target, { recursive: true });
        continue;
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await pipeline(zip.stream(entry), fs.createWriteStream(target));
      const when = dosDate(entry.time, entry.date);
      await fsp.utimes(target, when, when).catch(() => {});
      files++;
      bytes += entry.size;
    }
  } finally {
    await zip.close();
  }
  return { files, bytes };
}

module.exports = { read, items, write, split, join, assemble, readComment, pack, open, unpack, crc32 };
