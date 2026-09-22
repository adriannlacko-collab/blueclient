'use strict';

/**
 * A read-only SQLite file reader — the little of the format an import needs
 * (2026-09-18).
 *
 * Lunar's launcher keeps its profiles in `~/.lunarclient/db/profiles.db`,
 * and the Electron this launcher runs on (32, node 20) has no `node:sqlite`;
 * a WASM build of SQLite is a megabyte and a half for reading one table of
 * one other launcher. The format is documented at sqlite.org/fileformat.html
 * and a table's rows take under two hundred lines to walk: the page size
 * from the header, `sqlite_master` for the table's root page and its CREATE
 * statement (the column names), the b-tree from that page down to its
 * leaves, each cell's record decoded by its serial types. Overflow pages are
 * followed. A `-wal` file beside the database is read too — a launcher that
 * is still open keeps its newest rows there until a checkpoint — and its
 * committed frames laid over the file's pages, salts and checksums checked
 * so a stale WAL from an earlier run is not believed.
 *
 * Nothing here writes, locks or opens anything but the two files, and every
 * fault is a thrown error the caller turns into "nothing found".
 *
 *   const db = await open(file);
 *   db.tables();            // ['profiles', 'modpack_version', …]
 *   db.rows('profiles');    // [{ id, name, path, … }, …]
 */

const fsp = require('fs/promises');

/** More than this and it is not the kind of file this is for. */
const MOST = 64 * 1024 * 1024;

async function open(file) {
  const main = await fsp.readFile(file);
  if (main.length > MOST) throw new Error('database too large');
  if (main.toString('latin1', 0, 16) !== 'SQLite format 3\0') throw new Error('not an SQLite database');

  let pageSize = main.readUInt16BE(16);
  if (pageSize === 1) pageSize = 65536;
  const reserved = main[20];
  const usable = pageSize - reserved;
  const encoding = main.readUInt32BE(56) || 1; // 1 utf8, 2 utf16le, 3 utf16be

  let wal = null;
  try { wal = await fsp.readFile(`${file}-wal`); } catch { /* no WAL: the file is the whole story */ }
  const overlay = wal && wal.length >= 32 ? readWal(wal, pageSize) : { pages: new Map(), size: 0 };
  const pageCount = overlay.size || Math.floor(main.length / pageSize);

  function page(n) {
    if (n < 1 || n > pageCount) throw new Error(`page ${n} out of range`);
    const fromWal = overlay.pages.get(n);
    if (fromWal) return fromWal;
    const at = (n - 1) * pageSize;
    if (at + pageSize > main.length) throw new Error(`page ${n} beyond the file`);
    return main.subarray(at, at + pageSize);
  }

  const text = (buf) => encoding === 2 ? buf.toString('utf16le')
    : encoding === 3 ? Buffer.from(buf).swap16().toString('utf16le')
      : buf.toString('utf8');

  /* ---- records and cells ---- */

  function varint(buf, at) {
    let value = 0n;
    for (let i = 0; i < 8; i++) {
      const b = buf[at + i];
      if (b === undefined) throw new Error('varint runs off the page');
      value = (value << 7n) | BigInt(b & 0x7f);
      if (!(b & 0x80)) return [value, i + 1];
    }
    const last = buf[at + 8];
    if (last === undefined) throw new Error('varint runs off the page');
    return [(value << 8n) | BigInt(last), 9];
  }

  /** The payload of a cell in full: the local part, then every overflow page it names. */
  function payload(buf, at, total, maxLocal, minLocal) {
    let local = total;
    if (total > maxLocal) {
      const k = minLocal + ((total - minLocal) % (usable - 4));
      local = k <= maxLocal ? k : minLocal;
    }
    if (at + local > buf.length) throw new Error('cell runs off the page');
    if (local === total) return buf.subarray(at, at + total);
    const parts = [buf.subarray(at, at + local)];
    let left = total - local;
    let next = buf.readUInt32BE(at + local);
    const seen = new Set();
    while (left > 0 && next) {
      if (seen.has(next)) throw new Error('overflow pages loop');
      seen.add(next);
      const p = page(next);
      const take = Math.min(left, usable - 4);
      parts.push(p.subarray(4, 4 + take));
      left -= take;
      next = p.readUInt32BE(0);
    }
    if (left > 0) throw new Error('overflow chain ends early');
    return Buffer.concat(parts);
  }

  function record(buf) {
    const [headerSize, n0] = varint(buf, 0);
    const end = Number(headerSize);
    const types = [];
    let at = n0;
    while (at < end) {
      const [t, n] = varint(buf, at);
      types.push(Number(t));
      at += n;
    }
    const values = [];
    for (const t of types) {
      let size = 0; let value = null;
      if (t === 0) value = null;
      else if (t >= 1 && t <= 6) {
        size = [1, 2, 3, 4, 6, 8][t - 1];
        let v = 0n;
        for (let i = 0; i < size; i++) v = (v << 8n) | BigInt(buf[at + i]);
        if (buf[at] & 0x80) v -= 1n << BigInt(size * 8);
        value = v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
      } else if (t === 7) { size = 8; value = buf.readDoubleBE(at); }
      else if (t === 8) value = 0;
      else if (t === 9) value = 1;
      else if (t >= 12 && t % 2 === 0) { size = (t - 12) / 2; value = Buffer.from(buf.subarray(at, at + size)); }
      else if (t >= 13) { size = (t - 13) / 2; value = text(buf.subarray(at, at + size)); }
      else throw new Error(`serial type ${t}`);
      values.push(value);
      at += size;
    }
    return values;
  }

  /* ---- the b-tree ---- */

  /** Every (rowid, values) in the table rooted at `root`, in rowid order. */
  function walk(root) {
    const out = [];
    const seen = new Set();
    const maxLeaf = usable - 35;
    const minLeaf = Math.floor(((usable - 12) * 32) / 255) - 23;
    (function visit(n) {
      if (seen.has(n)) throw new Error('b-tree loops');
      seen.add(n);
      const p = page(n);
      const head = n === 1 ? 100 : 0;
      const type = p[head];
      const cells = p.readUInt16BE(head + 3);
      if (type === 0x05) {
        for (let i = 0; i < cells; i++) {
          const at = p.readUInt16BE(head + 12 + i * 2);
          visit(p.readUInt32BE(at));
        }
        visit(p.readUInt32BE(head + 8));
      } else if (type === 0x0d) {
        for (let i = 0; i < cells; i++) {
          let at = p.readUInt16BE(head + 8 + i * 2);
          const [size, n1] = varint(p, at); at += n1;
          const [rowid, n2] = varint(p, at); at += n2;
          out.push([Number(rowid), record(payload(p, at, Number(size), maxLeaf, minLeaf))]);
        }
      } else {
        throw new Error(`page ${n} is not a table page (${type})`);
      }
    })(root);
    return out;
  }

  /* ---- the schema ---- */

  const master = new Map();
  for (const [, values] of walk(1)) {
    const [type, name, , rootpage, sql] = values;
    if (type === 'table' && typeof name === 'string') master.set(name, { root: Number(rootpage), sql: String(sql || '') });
  }

  return {
    tables: () => [...master.keys()],
    rows(table) {
      const entry = master.get(table);
      if (!entry) throw new Error(`no table ${table}`);
      if (/\bWITHOUT\s+ROWID\b/i.test(entry.sql)) throw new Error(`${table} is WITHOUT ROWID`);
      const columns = columnsOf(entry.sql);
      return walk(entry.root).map(([rowid, values]) => {
        const row = {};
        columns.forEach((c, i) => {
          const v = i < values.length ? values[i] : null;
          row[c.name] = v === null && c.rowid ? rowid : v;
        });
        return row;
      });
    }
  };
}

/**
 * The column names out of a CREATE TABLE, in order, and which one (if any)
 * is the rowid under another name (`INTEGER PRIMARY KEY` — stored as NULL
 * in the record). Table constraints between the columns are skipped.
 */
function columnsOf(sql) {
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close < open) throw new Error('unreadable CREATE TABLE');
  const body = sql.slice(open + 1, close);
  const defs = [];
  let depth = 0; let start = 0; let quote = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { defs.push(body.slice(start, i)); start = i + 1; }
  }
  defs.push(body.slice(start));
  const out = [];
  for (const raw of defs) {
    const def = raw.trim();
    if (!def || /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i.test(def)) continue;
    const m = /^("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|'([^']+)'|(\S+))/.exec(def);
    if (!m) continue;
    const name = m[2] || m[3] || m[4] || m[5] || m[6];
    out.push({ name, rowid: /^\S+\s+INTEGER\s+PRIMARY\s+KEY\b/i.test(def) && !/\bDESC\b/i.test(def) });
  }
  return out;
}

/**
 * The committed frames of a WAL, newest wins, as page number → page. A frame
 * counts only while its salts are the header's and the running checksum
 * still adds up; frames after the last commit are a transaction in flight
 * and are left out. `size` is the database's page count as of that commit.
 */
function readWal(wal, pageSize) {
  const magic = wal.readUInt32BE(0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) throw new Error('not a WAL');
  const bigEndian = magic === 0x377f0683;
  if (wal.readUInt32BE(8) !== pageSize) throw new Error('WAL page size differs');
  const salt1 = wal.readUInt32BE(16);
  const salt2 = wal.readUInt32BE(20);
  const word = bigEndian ? (b, at) => b.readUInt32BE(at) : (b, at) => b.readUInt32LE(at);

  let s0 = 0; let s1 = 0;
  const sum = (buf, from, to) => {
    for (let i = from; i < to; i += 8) {
      s0 = (s0 + word(buf, i) + s1) >>> 0;
      s1 = (s1 + word(buf, i + 4) + s0) >>> 0;
    }
  };
  sum(wal, 0, 24);
  if (wal.readUInt32BE(24) !== s0 || wal.readUInt32BE(28) !== s1) throw new Error('WAL header checksum');

  const pages = new Map();
  const pending = new Map();
  let size = 0;
  const frame = 24 + pageSize;
  for (let at = 32; at + frame <= wal.length; at += frame) {
    if (wal.readUInt32BE(at + 8) !== salt1 || wal.readUInt32BE(at + 12) !== salt2) break;
    sum(wal, at, at + 8);
    sum(wal, at + 24, at + frame);
    if (wal.readUInt32BE(at + 16) !== s0 || wal.readUInt32BE(at + 20) !== s1) break;
    pending.set(wal.readUInt32BE(at), wal.subarray(at + 24, at + frame));
    const commit = wal.readUInt32BE(at + 4);
    if (commit) {
      for (const [n, p] of pending) pages.set(n, p);
      pending.clear();
      size = commit;
    }
  }
  return { pages, size };
}

module.exports = { open, columnsOf };
