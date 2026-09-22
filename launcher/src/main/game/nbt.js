'use strict';

/**
 * Just enough NBT to read and rewrite a server list — and, since 2026-09-11,
 * to read what a world says about itself.
 *
 * `servers.dat` is the one Minecraft file the launcher has to understand
 * rather than copy: merging the lists a player already has — from the official
 * launcher, from whatever client they used before, from their other BlueClient
 * profiles — means opening three files and writing a fourth. Copying the
 * biggest one and throwing the rest away would lose servers, which is the exact
 * thing this is meant to stop.
 *
 * Hand-rolled, like the zip reader in `companion.js`, because the launcher has
 * no runtime dependencies and this is the only binary format it ever opens. It
 * is a complete reader — every tag type — but a deliberately small one: tags
 * are kept as `{ type, value }` so anything read can be written back byte for
 * byte, and nothing tries to be clever about what a tag means. A server entry
 * carries its icon and its "I accept this server's resource pack" answer along
 * with its address, and all of that survives the trip.
 *
 * Note the file is *not* gzipped. Almost every other .dat Minecraft writes is,
 * which is why every first attempt at reading this one fails — a world's
 * `level.dat` is one of the gzipped ones, and `readLevel` below gunzips it
 * before reading. The Worlds tab (game/worlds.js) reads five things out of it:
 * the name the player typed, the Minecraft that last saved it, when that was,
 * the game mode and whether it is hardcore. Nothing is ever written back.
 */

const zlib = require('zlib');

const BYTE = 1;
const SHORT = 2;
const INT = 3;
const LONG = 4;
const FLOAT = 5;
const DOUBLE = 6;
const BYTE_ARRAY = 7;
const STRING = 8;
const LIST = 9;
const COMPOUND = 10;
const INT_ARRAY = 11;
const LONG_ARRAY = 12;

/* ------------------------------------------------------------------ read */

class Reader {
  constructor(buffer) {
    this.buf = buffer;
    this.at = 0;
  }

  take(n) {
    if (this.at + n > this.buf.length) throw new Error('nbt: ran off the end');
    const from = this.at;
    this.at += n;
    return from;
  }

  byte() { return this.buf.readInt8(this.take(1)); }
  short() { return this.buf.readInt16BE(this.take(2)); }
  int() { return this.buf.readInt32BE(this.take(4)); }
  long() { return this.buf.readBigInt64BE(this.take(8)); }
  float() { return this.buf.readFloatBE(this.take(4)); }
  double() { return this.buf.readDoubleBE(this.take(8)); }

  /** Modified UTF-8 in the specification; plain UTF-8 in every file we meet. */
  string() {
    const length = this.buf.readUInt16BE(this.take(2));
    const from = this.take(length);
    return this.buf.toString('utf8', from, from + length);
  }

  payload(type) {
    switch (type) {
      case BYTE: return this.byte();
      case SHORT: return this.short();
      case INT: return this.int();
      case LONG: return this.long();
      case FLOAT: return this.float();
      case DOUBLE: return this.double();
      case BYTE_ARRAY: {
        const length = this.int();
        const from = this.take(length);
        return Buffer.from(this.buf.subarray(from, from + length));
      }
      case STRING: return this.string();
      case LIST: {
        const of = this.byte();
        const length = this.int();
        const items = [];
        for (let i = 0; i < length; i++) items.push(this.payload(of));
        return { of, items };
      }
      case COMPOUND: {
        const entries = [];
        for (;;) {
          const kind = this.byte();
          if (kind === 0) break;
          const name = this.string();
          entries.push({ name, tag: { type: kind, value: this.payload(kind) } });
        }
        return entries;
      }
      case INT_ARRAY: {
        const length = this.int();
        const out = [];
        for (let i = 0; i < length; i++) out.push(this.int());
        return out;
      }
      case LONG_ARRAY: {
        const length = this.int();
        const out = [];
        for (let i = 0; i < length; i++) out.push(this.long());
        return out;
      }
      default: throw new Error('nbt: unknown tag ' + type);
    }
  }
}

/** @returns {{ name: string, tag: { type: number, value: * } }} the root tag */
function read(buffer) {
  const reader = new Reader(buffer);
  const type = reader.byte();
  if (type !== COMPOUND) throw new Error('nbt: root is not a compound');
  const name = reader.string();
  return { name, tag: { type, value: reader.payload(type) } };
}

/* ----------------------------------------------------------------- write */

class Writer {
  constructor() {
    this.parts = [];
  }

  push(buffer) { this.parts.push(buffer); }

  byte(v) { const b = Buffer.alloc(1); b.writeInt8(v); this.push(b); }
  short(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); this.push(b); }
  int(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.push(b); }
  long(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); this.push(b); }
  float(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); this.push(b); }
  double(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); this.push(b); }

  string(text) {
    const bytes = Buffer.from(String(text), 'utf8');
    this.short(bytes.length);
    this.push(bytes);
  }

  payload(type, value) {
    switch (type) {
      case BYTE: return this.byte(value);
      case SHORT: return this.short(value);
      case INT: return this.int(value);
      case LONG: return this.long(value);
      case FLOAT: return this.float(value);
      case DOUBLE: return this.double(value);
      case BYTE_ARRAY: this.int(value.length); return this.push(Buffer.from(value));
      case STRING: return this.string(value);
      case LIST: {
        // An empty list still has to declare a type; the game writes 0 (END)
        // and reads it back as an empty list of anything.
        this.byte(value.items.length ? value.of : 0);
        this.int(value.items.length);
        for (const item of value.items) this.payload(value.of, item);
        return undefined;
      }
      case COMPOUND: {
        for (const { name, tag } of value) {
          this.byte(tag.type);
          this.string(name);
          this.payload(tag.type, tag.value);
        }
        return this.byte(0);
      }
      case INT_ARRAY: {
        this.int(value.length);
        for (const n of value) this.int(n);
        return undefined;
      }
      case LONG_ARRAY: {
        this.int(value.length);
        for (const n of value) this.long(n);
        return undefined;
      }
      default: throw new Error('nbt: unknown tag ' + type);
    }
  }

  done() { return Buffer.concat(this.parts); }
}

function write(root) {
  const writer = new Writer();
  writer.byte(root.tag.type);
  writer.string(root.name || '');
  writer.payload(root.tag.type, root.tag.value);
  return writer.done();
}

/* ------------------------------------------------------- the server list */

/** The value of one named tag inside a compound, or undefined. */
function field(entries, name) {
  const hit = entries.find((entry) => entry.name === name);
  return hit ? hit.tag.value : undefined;
}

/**
 * The saved servers in a `servers.dat`, as whole compounds.
 *
 * Each one is handed back untouched so it can be written straight into another
 * file with its name, its cached icon and its resource-pack answer intact.
 *
 * @returns {Array<Array<{name: string, tag: object}>>}
 */
function readServers(buffer) {
  const root = read(buffer);
  const list = field(root.tag.value, 'servers');
  if (!list || !Array.isArray(list.items)) return [];
  return list.items.filter((entry) => Array.isArray(entry));
}

/** The address a server entry dials, lower-cased, or '' when it has none. */
function addressOf(entry) {
  return String(field(entry, 'ip') || '').trim().toLowerCase();
}

/** The name a server entry shows, or ''. */
function nameOf(entry) {
  return String(field(entry, 'name') || '');
}

/** A `servers.dat` holding exactly these entries. */
function writeServers(entries) {
  return write({
    name: '',
    tag: {
      type: COMPOUND,
      value: [{
        name: 'servers',
        tag: { type: LIST, value: { of: COMPOUND, items: entries } }
      }]
    }
  });
}

/* ------------------------------------------------------------- a world */

/** What the game calls each `GameType` number in `level.dat`. */
const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator'];

/**
 * What a world's `level.dat` says about itself (2026-09-11).
 *
 * The file is gzipped NBT — `1f 8b` at the front — with everything under one
 * `Data` compound: `LevelName` is the name the player typed, `LastPlayed` a
 * long of milliseconds, `GameType` an int (0 survival, 1 creative, 2 adventure,
 * 3 spectator), `hardcore` a byte, and `Version.Name` the Minecraft that last
 * saved it ("1.21.8"). Verified on a real save. A buffer that is not gzipped
 * is read as it is, which is what a test can hand over.
 *
 * Every field is optional: a world from an old enough game has no `Version`
 * at all, and the launcher would rather show a card with a dash on it than no
 * card. Throws only when the bytes are not NBT.
 *
 * @returns {{ name: string, version: string|null, lastPlayed: number|null,
 *             gameMode: string, hardcore: boolean }}
 */
function readLevel(buffer) {
  const raw = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
    ? zlib.gunzipSync(buffer)
    : buffer;
  const root = read(raw);
  const data = field(root.tag.value, 'Data');
  if (!Array.isArray(data)) throw new Error('nbt: level.dat has no Data compound');

  const version = field(data, 'Version');
  const lastPlayed = field(data, 'LastPlayed');
  const gameType = field(data, 'GameType');

  return {
    // The name as the game shows it: a world named on a server, or by a map
    // maker, can carry § colour codes (§6§lDesolate §e§lDesert), and the
    // Worlds page showed them raw while Home stripped its own copy
    // (2026-09-21). Stripped once here so every reader gets the same word.
    name: String(field(data, 'LevelName') ?? '').replace(/§./g, ''),
    version: Array.isArray(version) ? String(field(version, 'Name') ?? '') || null : null,
    lastPlayed: typeof lastPlayed === 'bigint' ? Number(lastPlayed) : (Number(lastPlayed) || null),
    gameMode: GAME_MODES[Number(gameType)] || 'survival',
    hardcore: Number(field(data, 'hardcore') ?? 0) === 1
  };
}

module.exports = { read, write, readLevel, readServers, writeServers, addressOf, nameOf, field };
