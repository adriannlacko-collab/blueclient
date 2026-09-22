/**
 * The mods a profile lists that its Minecraft cannot have (2026-09-21).
 *
 * Two reasons a switched-on mod never reaches the game: it only exists from
 * some Minecraft on (`since` — LambDynamicLights has no 1.20.6 build, said on
 * the card since 2026-09-11), or Modrinth has no build of it for this version
 * yet — No Chat Reports and Krypton on 26.3, the version every new install
 * starts on. The launch left those out quietly by design (game/mods.js,
 * `missing`), and the Mods page went on showing them as On and counting them
 * in "12 of 13 enabled" while the game loaded ten. The second reason is only
 * known by asking, so main is asked once per profile and version
 * (`mods:availability`, the launch's own lookup) and the answer kept here for
 * every page that counts mods: the Mods page's cards and its count, the
 * profile editor's pill.
 *
 * `absentNow` answers from what is already known, at once, so a paint never
 * waits on Modrinth; `refreshAbsent` asks when the profile's version, loader
 * or list has changed since the last answer and says whether anything moved,
 * so the caller repaints only then.
 */
import { host } from './bridge.js';
import { state, profileMods } from './state.js';

/** profileId → { key, none: Set, unknown: Set, pending: Promise|null } */
const known = new Map();

function profileOf(id) {
  return state.profiles.find((p) => p.id === id) || null;
}

const versionNumbers = (version) => {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(version || '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null;
};

/** A mod that only exists from `since` on, on a profile older than that. */
export function tooOld(mod, version) {
  if (!mod || !mod.since) return false;
  const have = versionNumbers(version);
  const floor = versionNumbers(mod.since);
  if (!have || !floor) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== floor[i]) return have[i] < floor[i];
  }
  return false;
}

/** What the answer is for: a change in any of these is a new question. */
function keyOf(profile) {
  const slugs = (profile.mods || [])
    .filter((m) => m && m.enabled !== false && m.slug)
    .map((m) => String(m.slug).toLowerCase())
    .sort();
  return `${profile.version}|${profile.loader}|${slugs.join(',')}`;
}

/**
 * The slugs (lower-case) of this profile's switched-on mods that Modrinth has
 * no build of for its version — from the last answer, or an empty set when
 * nothing is known yet. A `since` case is not in here; ask `tooOld`.
 */
export function absentNow(profileId) {
  const profile = profileOf(profileId);
  const entry = known.get(profileId);
  if (!profile || !entry || entry.key !== keyOf(profile)) return new Set();
  return entry.none;
}

/** Whether `mod` (a profile's list entry) will be left out of the game. */
export function leftOut(mod, profileId) {
  const profile = profileOf(profileId);
  if (!profile || !mod) return false;
  if (tooOld(mod, profile.version)) return true;
  return Boolean(mod.slug) && absentNow(profileId).has(String(mod.slug).toLowerCase());
}

/**
 * The count the pages agree on: the list's length, how many are switched on,
 * and how many of those actually reach the game.
 */
export function modCounts(profileId) {
  const mods = profileMods(profileId);
  const enabled = mods.filter((m) => m.enabled);
  const absent = enabled.filter((m) => leftOut(m, profileId));
  return { total: mods.length, enabled: enabled.length, absent: absent.length, inGame: enabled.length - absent.length };
}

/**
 * Ask main, when the question has changed, and resolve to true if the answer
 * differs from what `absentNow` was saying — the caller's cue to repaint.
 * Never throws; an unreachable Modrinth leaves the last answer standing.
 */
export async function refreshAbsent(profileId) {
  const profile = profileOf(profileId);
  if (!profile || profile.loader !== 'fabric') return false;
  const key = keyOf(profile);
  const entry = known.get(profileId);
  if (entry && entry.key === key) {
    if (entry.pending) return entry.pending;
    return false;
  }
  const before = absentNow(profileId);
  const next = { key, none: before, unknown: new Set(), pending: null };
  known.set(profileId, next);
  next.pending = (async () => {
    let answer = null;
    try {
      answer = await host.mods?.availability?.(profileId);
    } catch {
      answer = null;
    }
    next.pending = null;
    if (!answer || !answer.ok) return false;
    next.none = new Set((answer.none || []).map((s) => String(s).toLowerCase()));
    next.unknown = new Set((answer.unknown || []).map((s) => String(s).toLowerCase()));
    const same = next.none.size === before.size && [...next.none].every((s) => before.has(s));
    return !same;
  })();
  return next.pending;
}
