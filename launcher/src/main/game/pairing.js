'use strict';

/**
 * Do these jars agree to load together? (2026-09-11)
 *
 * Modrinth answers "which is the newest build of this project for this
 * Minecraft", one project at a time, and that is all the resolver in mods.js
 * ever asked. It is not enough. Every Fabric jar carries its own word on the
 * matter in `fabric.mod.json` — `depends`, a version range it needs of each
 * mod it leans on, and `breaks`, the versions of other mods it refuses to sit
 * beside — and Fabric Loader reads exactly those before the game starts. The
 * newest of each project is not always a set those rules accept: on 1.21.11
 * the newest Sodium (0.8.14) says `breaks: iris <= 1.10.7`, and the newest
 * Iris there *is* 1.10.7, so the pair the launcher put in the folder was one
 * the loader refused with "Incompatible mods found", and the profile never
 * started.
 *
 * This module reads those rules out of the jars on disk and finds the pairs
 * that disagree, applying the loader's own grammar for version ranges so the
 * answer here is the answer the loader would give. `settle` then moves one
 * jar at a time to a build the other side accepts — the one the other side's
 * author pinned on Modrinth first, an older build after that — and asks again,
 * until the set is one the loader will load or the budget is spent. What it
 * knows about Modrinth and the disk comes in as functions, so
 * `tools/check-mod-pairing.js` can run the whole of it with the real
 * fabric.mod.json texts and no network.
 *
 * Only what is in the set is checked. A rule about a mod that is not in the
 * folder — `minecraft`, `fabricloader`, a module nested inside Fabric API —
 * is not a disagreement the launcher can see or settle, and is left to the
 * loader as before.
 */

const jar = require('./jar');

/** The one entry that matters, read through the streamed reader in jar.js. */
async function read(file) {
  let zip;
  try {
    zip = await jar.open(file);
  } catch {
    return null;
  }
  try {
    const entry = zip.entries.find((e) => e.name === 'fabric.mod.json');
    if (!entry) return null;
    const chunks = [];
    for await (const chunk of zip.stream(entry)) chunks.push(chunk);
    return describe(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    return null;
  } finally {
    await zip.close();
  }
}

/**
 * The part of a fabric.mod.json the check needs, from the parsed text.
 *
 * `provides` is the other names a mod answers to — Sodium says it provides
 * `indium` — and the loader treats a rule about one of those as a rule about
 * the mod itself, so they are kept.
 */
function describe(json) {
  if (!json || typeof json !== 'object' || typeof json.id !== 'string') return null;
  const rules = (table) => {
    const out = {};
    if (!table || typeof table !== 'object' || Array.isArray(table)) return out;
    for (const [id, rule] of Object.entries(table)) {
      if (typeof rule === 'string') out[id] = [rule];
      else if (Array.isArray(rule)) out[id] = rule.filter((r) => typeof r === 'string');
    }
    return out;
  };
  return {
    id: json.id,
    name: typeof json.name === 'string' ? json.name : '',
    version: typeof json.version === 'string' ? json.version : '',
    provides: Array.isArray(json.provides) ? json.provides.filter((p) => typeof p === 'string') : [],
    depends: rules(json.depends),
    breaks: rules(json.breaks)
  };
}

/* ------------------------------------------------------- version grammar */

/**
 * Fabric's dot-separated identifier — a pre-release or build string — and
 * its unsigned integer. Copied from SemanticVersionImpl: the first pattern
 * begins with `|`, so **an empty identifier is legal**, and that is what
 * MaLiLib's `<0.8.7-` and Litematica's `>=0.27.19- <0.28.0-` lean on (below).
 */
const DOT_SEPARATED_ID = /^(?:[-0-9A-Za-z]+(?:\.[-0-9A-Za-z]+)*)?$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/;

/**
 * A version the way Fabric Loader reads one (SemanticVersionImpl, read again
 * on 2026-09-20 after two of its rules were missed).
 *
 * `1.10.7+mc1.21.11` is semantic: numbers separated by dots, an optional
 * pre-release after the first dash, and anything after a plus is build
 * metadata that never takes part in a comparison. The pre-release may be
 * **empty** — `0.8.7-` is 0.8.7 with a pre-release of "", which sorts under
 * `0.8.7-beta.1` and under `0.8.7` itself, so `<0.8.7-` is "anything below
 * 0.8.7, its own pre-releases included". That spelling is all over MaLiLib
 * and Litematica, and until this was read the launcher took it for a plain
 * string, took a `breaks` it could not read for a conflict, and told a
 * player on 1.21.11 that MaLiLib refused to load beside Sodium — three
 * false quarrels that spent the settle's budget before the one real one.
 *
 * A component of `x`, `X` or `*` is a wildcard, allowed in a rule (`0.8.x`)
 * and never in a mod's own version; wildcards after the first are dropped
 * (`1.x.x` is `1.x`), a number after one (`1.x.2`) is an error, and so is a
 * bare `x`. Anything the loader would throw on — `1.21-4.5!`, `.1`, `1.` —
 * is a plain string that only ever equals itself, which is what the loader
 * falls back to as well (VersionParser.parse).
 */
function parseVersion(text, allowWildcard = false) {
  let s = String(text || '').trim();
  const plus = s.indexOf('+');
  let build = null;
  if (plus >= 0) {
    build = s.slice(plus + 1);
    s = s.slice(0, plus);
  }
  let pre = null;
  const dash = s.indexOf('-');
  if (dash >= 0) {
    pre = s.slice(dash + 1);
    s = s.slice(0, dash);
  }
  if (pre !== null && !DOT_SEPARATED_ID.test(pre)) return { text };
  if (build !== null && !DOT_SEPARATED_ID.test(build)) return { text };
  if (!s || s.endsWith('.') || s.startsWith('.')) return { text };

  const parts = [];
  let wildcard = false;
  for (const piece of s.split('.')) {
    if (allowWildcard && (piece === 'x' || piece === 'X' || piece === '*')) {
      // A pre-release makes no sense beside a wildcard; a second wildcard
      // is dropped (1.x.x -> 1.x).
      if (pre !== null) return { text };
      wildcard = true;
      continue;
    }
    if (wildcard) return { text }; // 1.x.2
    if (!/^\d+$/.test(piece)) return { text };
    parts.push(Number(piece));
  }
  if (!parts.length) return { text }; // a bare `x`, or nothing at all
  return { parts, wildcard, pre, text };
}

function component(v, i) {
  if (i < v.parts.length) return v.parts[i];
  return v.wildcard ? null : 0;
}

/** Java's String.compareTo: by code unit, never by locale. */
function order(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Fabric's ordering: components first, missing ones as zero, then the
 * pre-release — token by token on the dots, a number below a word, two
 * numbers by their length and then their digits, the longer list the higher,
 * and an empty pre-release (no tokens at all) under every other.
 */
function compare(a, b) {
  if (!a.parts || !b.parts) return order(String(a.text ?? ''), String(b.text ?? ''));
  const n = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < n; i++) {
    const x = component(a, i);
    const y = component(b, i);
    if (x === null || y === null) continue; // a wildcard matches whatever is there
    if (x !== y) return x < y ? -1 : 1;
  }
  if (a.pre === null && b.pre === null) return 0;
  // A pre-release sits below the release it precedes (0.8.14-beta.2 < 0.8.14),
  // unless the other side is a wildcard, which takes either.
  if (a.pre === null) return b.wildcard ? 0 : 1;
  if (b.pre === null) return a.wildcard ? 0 : -1;
  const pa = a.pre.split('.').filter(Boolean);
  const pb = b.pre.split('.').filter(Boolean);
  for (let i = 0; i < pa.length; i++) {
    if (i >= pb.length) return 1;
    const x = pa[i];
    const y = pb[i];
    const xNum = UNSIGNED_INTEGER.test(x);
    const yNum = UNSIGNED_INTEGER.test(y);
    if (xNum) {
      if (!yNum) return -1;
      if (x.length !== y.length) return x.length < y.length ? -1 : 1;
    } else if (yNum) {
      return 1;
    }
    const c = order(x, y);
    if (c !== 0) return c;
  }
  return pb.length > pa.length ? -1 : 0;
}

const OPERATORS = ['>=', '<=', '>', '<', '=', '~', '^'];

/**
 * One rule string, as Fabric parses it (VersionPredicateParser): terms
 * separated by spaces that must all hold, `*` or nothing at all meaning any
 * version. A wildcard takes no operator but `=`, and is rewritten the way
 * the loader rewrites it — with an **empty pre-release** on the bound, so
 * the pre-releases of the first version in the range are inside it:
 * `1.x` is `^1-`, `0.8.x` is `~0.8-`, and `1.2.3.x` is `>=1.2.3- <1.2.4-`.
 * A plain string takes only an inclusive operator, and then only equality.
 * Returns null for a rule the loader itself would throw on, which the
 * caller reads as "no opinion".
 */
function parseRule(rule) {
  const terms = [];
  for (let term of String(rule || '').split(' ')) {
    term = term.trim();
    if (!term || term === '*') continue;
    let op = '=';
    let explicit = false;
    for (const candidate of OPERATORS) {
      if (term.startsWith(candidate)) {
        op = candidate;
        explicit = true;
        term = term.slice(candidate.length);
        break;
      }
    }
    const version = parseVersion(term, true);
    if (version.parts) {
      if (version.wildcard) {
        if (explicit && op !== '=') return null;
        const count = version.parts.length + 1;
        const bound = { parts: version.parts, wildcard: false, pre: '', text: term };
        if (count <= 3) {
          terms.push({ op: count === 2 ? '^' : '~', ref: bound });
        } else {
          const next = [...version.parts];
          next[next.length - 1] += 1;
          terms.push({ op: '>=', ref: bound });
          terms.push({ op: '<', ref: { parts: next, wildcard: false, pre: '', text: term } });
        }
        continue;
      }
    } else if (op !== '>=' && op !== '<=' && op !== '=') {
      // A range needs numbers; a plain string only ever equals itself.
      return null;
    } else {
      op = '=';
    }
    terms.push({ op, ref: version });
  }
  return terms;
}

function holds(version, { op, ref }) {
  if (!version.parts || !ref.parts) {
    if (op === '=' || op === '>=' || op === '<=') return String(version.text ?? '') === String(ref.text ?? '');
    return false;
  }
  const c = compare(version, ref);
  switch (op) {
    case '>=': return c >= 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '<': return c < 0;
    case '=': return c === 0;
    case '~': return c >= 0 && component(version, 0) === component(ref, 0) && component(version, 1) === component(ref, 1);
    case '^': return c >= 0 && component(version, 0) === component(ref, 0);
    default: return false;
  }
}

/**
 * Does `version` satisfy `rules` — a list of rule strings, any one of which
 * is enough, exactly as an array in fabric.mod.json is read? True, false,
 * or **null when the loader could not read the rule at all** (2026-09-20):
 * a mod whose metadata the loader throws on never loads, whatever else is
 * in the folder, and that is not a quarrel between two jars the launcher
 * can settle — so a `breaks` that cannot be read is not a break, and a
 * `depends` that cannot be read is not a missing dependency. Before this,
 * "could not read" was taken as "satisfied", which for a `breaks` meant
 * "in conflict", the wrong way round.
 */
function verdict(version, rules) {
  const v = parseVersion(version);
  const list = Array.isArray(rules) ? rules : [rules];
  if (!list.length) return true;
  let unread = false;
  for (const rule of list) {
    const terms = parseRule(rule);
    if (terms === null) {
      unread = true;
      continue;
    }
    if (terms.every((term) => holds(v, term))) return true;
  }
  return unread ? null : false;
}

/** `verdict` as a plain yes or no, an unreadable rule counting as satisfied. */
function satisfies(version, rules) {
  return verdict(version, rules) !== false;
}

/** True when the rules name every version there is (`*`, or nothing). */
function anyVersion(rules) {
  const list = Array.isArray(rules) ? rules : [rules];
  if (!list.length) return true;
  return list.some((rule) => {
    const terms = parseRule(rule);
    return terms !== null && terms.length === 0;
  });
}

/* ------------------------------------------------------------ the check */

/**
 * The pairs in `set` that Fabric would refuse to load together.
 *
 * `set` is a list of `{ meta }` (whatever else each entry carries is handed
 * back untouched), `meta` being what `read` returned. Each finding names the
 * entry whose rule it is (`by`), the entry the rule is about (`on`), which
 * rule, and the range it quoted — enough for a message a player can read.
 */
function conflicts(set) {
  // One jar per id, as the loader keeps one: where two top-level jars carry
  // the same id — a copy the player dropped in beside the one the launcher
  // installed — the higher version is the one it loads, and the other is
  // not in the set at all (ModPrioSorter, 2026-09-20).
  const byId = new Map();
  const claim = (id, entry) => {
    const prev = byId.get(id);
    if (!prev || compare(parseVersion(entry.meta.version), parseVersion(prev.meta.version)) > 0) byId.set(id, entry);
  };
  for (const entry of set) {
    if (!entry.meta) continue;
    claim(entry.meta.id, entry);
    for (const alias of entry.meta.provides) claim(alias, entry);
  }
  const live = set.filter((entry) => entry.meta && byId.get(entry.meta.id) === entry);

  const found = [];
  for (const by of live) {
    for (const [id, rules] of Object.entries(by.meta.breaks)) {
      const on = byId.get(id);
      if (!on || on === by) continue;
      if (verdict(on.meta.version, rules) === true) found.push({ kind: 'breaks', by, on, rules });
    }
    for (const [id, rules] of Object.entries(by.meta.depends)) {
      const on = byId.get(id);
      if (!on || on === by) continue;
      if (verdict(on.meta.version, rules) === false) found.push({ kind: 'depends', by, on, rules });
    }
  }
  return found;
}

/**
 * One line a player can read: "Sodium 0.8.14 refuses to load beside Iris
 * 1.10.7". The jar's own name, not the launcher's: a dependency the waves
 * pulled in is only known there by its Modrinth id.
 */
function explain({ kind, by, on }) {
  return kind === 'breaks'
    ? `${label(by)} refuses to load beside ${label(on)}`
    : `${label(by)} needs a different ${title(on)} than ${shortVersion(on.meta.version)}`;
}

function title(entry) {
  return (entry.meta && (entry.meta.name || entry.meta.id)) || entry.name || entry.key || 'a mod';
}

function label(entry) {
  return `${title(entry)} ${shortVersion(entry.meta.version)}`;
}

function shortVersion(version) {
  const plus = String(version || '').indexOf('+');
  return plus > 0 ? version.slice(0, plus) : String(version || '');
}

/* ----------------------------------------------------------- settling */

/** How many times one project may be moved, and how many builds one move may try. */
const MOVES_PER_PROJECT = 2;
const STEPS_PER_MOVE = 5;
const ROUNDS = 8;

/**
 * Move jars until the set agrees, or say which pair never did.
 *
 * `set` is the list of jars on disk, each `{ key, name, meta, fixed?, build?
 * }`: `key` names the project (the launcher's own jar has none and is
 * `fixed` — it is never the one that moves), `build` is what Modrinth said
 * about the jar (its id, and the dependencies its author declared, pinned
 * builds included). The rest is the world, handed in:
 *
 *   pinned(build)      -> the build another mod's author pinned, or null
 *   older(entry)       -> that project's builds newest first, or null
 *   place(entry, build)-> puts that build on disk, returns the new entry
 *                         (with `meta` read from the jar) or throws
 *   discard(entry)     -> takes a jar that did not help back off the disk
 *
 * Which side moves: for `breaks` the mod that declared it — it is the newer
 * one, the other side has nothing newer to go to; for `depends` the mod the
 * rule is about. Where to: the build the *other* side's author pinned on
 * Modrinth, the one they say they built against, if it is a different one;
 * failing that, older builds of the mover one at a time. If neither side can
 * be moved to a build that ends the disagreement, it is reported and the set
 * is left as it stands — the loader will say the rest.
 *
 * Every candidate is downloaded and read before it is believed: a Modrinth
 * version number (`mc1.21.11-0.8.7-fabric`) is not the version in the jar
 * (`0.8.7+mc1.21.11`), and only the jar's own rules count.
 *
 * `incomplete` in the answer says a candidate could not be fetched or the
 * list of older builds could not be had at all — Modrinth or the connection,
 * not the jars — so an "unsettled" beside it is not the jars' last word and
 * must not be remembered as one (2026-09-20).
 *
 * @returns {Promise<{ set: object[], moved: object[], unsettled: object[], incomplete: boolean }>}
 */
async function settle(set, { pinned, older, place, discard, log = () => {} }) {
  let current = [...set];
  const moved = [];
  const moves = new Map();
  let incomplete = false;

  for (let round = 0; round < ROUNDS; round++) {
    const found = conflicts(current);
    if (!found.length) return { set: current, moved, unsettled: [], incomplete };

    const first = found[0];
    const movers = first.kind === 'breaks' ? [first.by, first.on] : [first.on, first.by];
    let settled = false;

    for (const mover of movers) {
      if (settled) break;
      if (mover.fixed || !mover.key) continue;
      // `breaks: x: "*"` is every version of x; no build of x gets out of it.
      if (first.kind === 'breaks' && mover === first.on && anyVersion(first.rules)) continue;
      if ((moves.get(mover.key) || 0) >= MOVES_PER_PROJECT) continue;
      const other = mover === first.by ? first.on : first.by;
      const now = mover.build && mover.build.id;

      // The candidates, in the order they are worth trying — and the list
      // of older builds is only asked for when the pin was not enough.
      const pin = other.build ? await pinned(other.build, mover) : null;
      const tried = new Set();
      const candidates = async function* () {
        if (pin && pin.id !== now) {
          tried.add(pin.id);
          yield pin;
        }
        const list = await older(mover);
        if (!list) incomplete = true;
        const builds = list || [];
        const at = builds.findIndex((b) => b.id === now);
        for (const build of builds.slice(at + 1)) {
          if (tried.size >= STEPS_PER_MOVE) return;
          if (build.id === now || tried.has(build.id)) continue;
          tried.add(build.id);
          yield build;
        }
      };
      moves.set(mover.key, (moves.get(mover.key) || 0) + 1);

      for await (const candidate of candidates()) {
        let placed;
        try {
          placed = await place(mover, candidate);
        } catch (error) {
          log(`${title(mover)}: could not fetch ${candidate.number || candidate.id}: ${error.message}`);
          incomplete = true;
          continue;
        }
        if (!placed || !placed.meta) {
          if (placed) await discard(placed);
          continue;
        }
        // Does the pair agree now? The whole set is asked again on the next
        // round; here only the quarrel being settled has to be over.
        const pair = conflicts([placed, other]);
        if (pair.length) {
          await discard(placed);
          continue;
        }
        await discard(mover);
        current = current.map((entry) => (entry === mover ? placed : entry));
        moved.push({ key: mover.key, name: title(mover), from: shortVersion(mover.meta.version), to: shortVersion(placed.meta.version), because: explain(first) });
        log(`${title(mover)}: ${shortVersion(mover.meta.version)} -> ${shortVersion(placed.meta.version)}, because ${explain(first)}`);
        settled = true;
        break;
      }
    }

    if (!settled) return { set: current, moved, unsettled: found, incomplete };
  }
  return { set: current, moved, unsettled: conflicts(current), incomplete };
}

module.exports = { read, describe, parseVersion, compare, parseRule, satisfies, verdict, conflicts, explain, title, settle, shortVersion };
