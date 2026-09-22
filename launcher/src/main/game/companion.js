'use strict';

/**
 * Which companion jar fits the Minecraft version this profile runs?
 *
 * The mod ships as one jar per Minecraft generation — `resources/mod/` holds
 * all of them — and each says in its own `fabric.mod.json` what it runs on.
 * Fabric Loader treats an unmet requirement as fatal, so a jar dropped into a
 * profile it does not fit does not cost the player the in-game menu — it costs
 * them the launch, with a wall of loader text and no mention of BlueClient
 * anywhere near the top of it.
 *
 * So the ranges are read out of the jars rather than written down here. The
 * mod and the launcher are built and shipped together, and one of them
 * declaring the versions twice is how they drift apart — which is also why
 * this is the only place that knows how many jars there are.
 */

const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const inflateRaw = promisify(zlib.inflateRaw);

/** Parsed ranges, keyed by jar path, thrown away when the jar changes. */
const cache = new Map();

/* --------------------------------------------------------------- the jar */

/**
 * One named file out of a zip, without a zip library.
 *
 * The launcher has no runtime dependencies and this is the only archive it
 * ever has to open, so it reads the two headers it needs by hand. A jar is a
 * zip: a directory at the end lists every entry and where its data starts.
 */
async function readEntry(jarPath, wanted) {
  const buffer = await fsp.readFile(jarPath);

  // The end-of-directory record sits within the last 64KB, after a comment
  // nobody writes. Scan back for its signature.
  const floor = Math.max(0, buffer.length - 66560);
  let end = -1;
  for (let at = buffer.length - 22; at >= floor; at--) {
    if (buffer.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip');

  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('bad directory');

    const method = buffer.readUInt16LE(at + 10);
    const packed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

    if (name === wanted) {
      if (buffer.readUInt32LE(localAt) !== 0x04034b50) throw new Error('bad entry');
      // The local header repeats the name and carries its own extra field,
      // which is rarely the same length as the one in the directory.
      const localName = buffer.readUInt16LE(localAt + 26);
      const localExtra = buffer.readUInt16LE(localAt + 28);
      const from = localAt + 30 + localName + localExtra;
      const data = buffer.subarray(from, from + packed);
      return method === 0 ? data : await inflateRaw(data);
    }

    at += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`${wanted} not in the jar`);
}

/* ------------------------------------------------------------- versions */

/** "1.21.4" as three numbers, or null for anything else — a snapshot, say. */
function parse(version) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(version || '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

function compare(left, right) {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

/**
 * One of Fabric's version predicates against one version.
 *
 * Enough of the syntax to cover what a mod like this one ever declares:
 * anything, an exact version, a comparison, a tilde (same minor) or a caret
 * (same major). Anything unrecognised is treated as "does not fit", because
 * guessing yes is how the unlaunchable profile happens.
 */
function satisfies(version, predicate) {
  const text = String(predicate || '').trim();
  if (!text || text === '*') return true;

  const wildcard = /^(\d+)\.(\d+)\.[xX*]$/.exec(text);
  if (wildcard) {
    return version[0] === Number(wildcard[1]) && version[1] === Number(wildcard[2]);
  }

  const parts = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(text);
  if (!parts) return false;

  const bound = parse(parts[2]);
  if (!bound) return false;

  const order = compare(version, bound);
  switch (parts[1]) {
    case '>=': return order >= 0;
    case '>': return order > 0;
    case '<=': return order <= 0;
    case '<': return order < 0;
    // Same major and minor, at or above the given patch.
    case '~': return order >= 0 && version[0] === bound[0] && version[1] === bound[1];
    // Same major, at or above the whole given version.
    case '^': return order >= 0 && version[0] === bound[0];
    default: return order === 0;
  }
}

/** A declaration: a string of AND-ed predicates, or an array of OR-ed ones. */
function matches(version, declared) {
  if (Array.isArray(declared)) return declared.some((entry) => matches(version, entry));

  const clauses = String(declared || '').trim().split(/\s+/).filter(Boolean);
  if (!clauses.length) return true;
  return clauses.every((clause) => satisfies(version, clause));
}

/* ---------------------------------------------------------------- public */

/**
 * What the jar says it needs, cached until the jar itself changes.
 *
 * A jar that cannot be read at all reports no range, and the caller then
 * installs it as before — a launcher that silently stopped shipping its own
 * mod because of an unreadable byte would be worse than the crash this avoids.
 */
async function declaredRange(jarPath) {
  const stamp = await fsp.stat(jarPath).then((s) => `${s.mtimeMs}:${s.size}`).catch(() => null);
  if (!stamp) return null;

  const hit = cache.get(jarPath);
  if (hit && hit.stamp === stamp) return hit.range;

  let range = null;
  try {
    const raw = await readEntry(jarPath, 'fabric.mod.json');
    const parsed = JSON.parse(raw.toString('utf8'));
    const declared = parsed?.depends?.minecraft;
    if (declared) range = declared;
  } catch {
    // Unreadable, or a jar that declares nothing. Either way there is no
    // reason to keep it out.
  }

  cache.set(jarPath, { stamp, range });
  return range;
}

/**
 * The version a companion jar says it is — the `version` in its own
 * `fabric.mod.json` — or '' for a jar that is missing or unreadable. Read
 * off a profile's installed `mods/blueclient.jar` after a crash (2026-09-18),
 * so a report about a game that died before it wrote anything down still
 * names the mod that was in it. Cheap enough to read every time: it is one
 * read of one jar, on the exit path only.
 */
async function versionOf(jarPath) {
  try {
    const raw = await readEntry(jarPath, 'fabric.mod.json');
    const parsed = JSON.parse(raw.toString('utf8'));
    return typeof parsed?.version === 'string' ? parsed.version : '';
  } catch {
    return '';
  }
}

/**
 * Whether the companion belongs in a profile on this version.
 *
 * @returns {Promise<{ ok: boolean, range: string|null }>}
 */
async function fits(jarPath, version) {
  const range = await declaredRange(jarPath);
  if (!range) return { ok: true, range: null };

  const parsed = parse(version);
  // A snapshot cannot be checked, and Fabric will reject the mod on one
  // anyway, so it is left out rather than gambled with.
  if (!parsed) return { ok: false, range: describe(range) };

  return { ok: matches(parsed, range), range: describe(range) };
}

/** The range as something to show a player: "~1.21.4" reads as "1.21.4 or newer". */
function describe(range) {
  const text = Array.isArray(range) ? range.join(' or ') : String(range);
  const tilde = /^~\s*(\d+\.\d+(?:\.\d+)?)$/.exec(text.trim());
  if (tilde) {
    const bound = parse(tilde[1]);
    return bound ? `${tilde[1]} to ${bound[0]}.${bound[1]}.x` : text;
  }
  return text;
}

/* ------------------------------------------------------ a folder of jars */

/** Every jar in the folder, sorted so the answer never depends on the disk. */
async function jarsIn(dir) {
  const names = await fsp.readdir(dir).catch(() => []);
  return names
    .filter((name) => name.toLowerCase().endsWith('.jar'))
    .sort()
    .map((name) => path.join(dir, name));
}

/**
 * The one jar built for this Minecraft, or null.
 *
 * The ranges in `versions.json` are written not to overlap, so at most one can
 * answer. If two ever did — a bad edit there — the first by name wins and the
 * launch still works, which is the failure worth having.
 */
async function pick(dir, version) {
  for (const jar of await jarsIn(dir)) {
    const fit = await fits(jar, version);
    if (fit.ok) return { jar, range: fit.range };
  }
  return null;
}

/**
 * What the shipped jars cover, for the version list to say so.
 *
 * @returns {Promise<{ ranges: string[], covers: (v: string) => boolean }>}
 */
async function coverage(dir) {
  const ranges = [];
  for (const jar of await jarsIn(dir)) {
    const range = await declaredRange(jar);
    if (range) ranges.push(range);
  }

  return {
    ranges: ranges.map(describe),
    covers(version) {
      const parsed = parse(version);
      if (!parsed) return false;
      return ranges.some((range) => matches(parsed, range));
    }
  };
}

/**
 * Whether one release is at or past another — "1.21.4" against "1.21".
 *
 * For a mod that only exists from some Minecraft on (game/mods.js, `since`,
 * 2026-09-11). A snapshot answers false: it cannot be placed, and the mod
 * would be refused on it anyway.
 */
function atLeast(version, floor) {
  const parsed = parse(version);
  const bound = parse(floor);
  if (!parsed || !bound) return false;
  return compare(parsed, bound) >= 0;
}

module.exports = { fits, declaredRange, describe, pick, coverage, jarsIn, atLeast, versionOf };
