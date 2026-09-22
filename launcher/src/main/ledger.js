'use strict';

/**
 * The play ledger — the read side, and only the read side.
 *
 * The companion mod keeps a record of every server and world this install has
 * played: `mod/src/main/java/com/blueclient/stats/Ledger.java` owns the file
 * and is the only thing that writes it. It lands in the shared config tree
 * rather than one profile's, because a server you played is a place you went,
 * not a property of the modpack you went there with — so the record survives
 * you switching profiles, which is the whole reason it is useful on Home.
 *
 * Nothing in the launcher read it until 2026-09-07. It had been written for a
 * year with no screen on the other end.
 *
 * Everything here treats the file as untrusted input. It is written by another
 * process on its own schedule (every 60s and at session end), so a read can
 * land mid-rename or on a file from a newer mod than this launcher; a missing
 * file is the normal state for someone who has not played yet, not an error.
 * Every failure returns an empty answer and the screen falls back to the line
 * it drew before.
 *
 * <h2>Two lists, and they answer different questions (2026-09-10)</h2>
 * The file holds a map of PLACES and a list of SESSIONS. The places answer
 * "how much, here" and carry no dates at all; the sessions answer "when" —
 * one entry per sitting, with the moment it started and how long it ran, kept
 * for two years.
 *
 * Until this date the module read the places and dropped the sessions on the
 * floor, which is why Home could only draw places, and why the comment over
 * its bars said seven day-bars "would be an invention". That was true of the
 * places map and false of the file: the sittings were there the whole time.
 * `summary()` reads them, so the graph is populated out of a record the mod
 * has been keeping all along rather than starting empty — and since
 * 2026-09-12 it hands each day its own places and sittings, so a day on the
 * Stats page can be opened and read.
 *
 * Not to be confused with `./stats.js`, which is anonymous install telemetry
 * and has nothing to do with playtime.
 */

const path = require('path');
const fsp = require('fs').promises;

const gameSettings = require('./game/settings');

/** Never hand the renderer more than this, whatever the file claims. */
const MAX = 24;
/** Nor walk more than this many entries looking for them. */
const CEILING = 2000;
/**
 * Sessions are one per sitting rather than one per place, so two years of
 * daily play is a few thousand of them and the ceiling has to be roomier. It
 * is here to bound a corrupt file, not to trim an honest one.
 */
const SESSION_CEILING = 50000;

/**
 * The game's own counters the mod tracks, in the order a screen shows them.
 * The mod's TRACKED map is the source; playTicks and deaths are left out
 * because both are already spent above, inside playedMs() and deaths().
 */
const TRACKED = [
  'mobKills', 'playerKills', 'damageDealt', 'damageTaken',
  'jumps', 'walkCm', 'sprintCm'
];

/**
 * What a sitting is allowed to say it gained. TRACKED, plus the server's own
 * death count (2026-09-12, evening): `gained.deaths` is the difference in the
 * game's statistic, not the client-witnessed `session.deaths` that reads zero
 * across every sitting — see the note on deaths in pages/home.js. A day can
 * say "9 deaths" out of it the way it says "11 mobs killed".
 */
const GAINED = [...TRACKED, 'deaths'];

function file(instances) {
  return path.join(gameSettings.sharedDirIn(instances), 'config', 'blueclient-stats.json');
}

const num = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/* The mod's own Place.playedMs() and Place.deaths(). Both take the larger of
   two counts on purpose: the launcher-side counter misses a session the game
   never closed cleanly, and the game's own statistics miss nothing but only
   move in whole ticks. Reading one alone under-reports. Neither is ever a
   server's own total (2026-09-19): `stats` is what moved since the first
   read of the place, and `seen` — the server's running count, the one
   number in the file that reaches back before BlueClient — is not read
   here or anywhere in the launcher. */
const playedMs = (place) => Math.max(num(place.msPlayed), num(place.stats?.playTicks) * 50);
const deaths = (place) => Math.max(num(place.ownDeaths), num(place.stats?.deaths));

/**
 * The reads in flight, by file (2026-09-22). Home asks for `recent` and
 * `summary` together as it opens, and each read and parsed the whole file —
 * two years of sittings — for itself: two parses of one file on the main
 * process, a moment apart. A read asked for while one of the same file is
 * still going shares it; once it lands, the next ask reads afresh, so
 * nothing is kept and no answer is older than a read already under way when
 * it was asked for. The parsed object is only ever read from, never
 * changed, by both.
 */
const reading = new Map();

/** The file, parsed, or null. Never throws; never creates it. */
function read(instances) {
  if (!instances) return Promise.resolve(null);
  const target = file(instances);
  const running = reading.get(target);
  if (running) return running;
  const job = readFresh(target).finally(() => {
    if (reading.get(target) === job) reading.delete(target);
  });
  reading.set(target, job);
  return job;
}

async function readFresh(target) {
  let raw;
  try {
    raw = await fsp.readFile(target, 'utf8');
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** The game's own counters for one place, every tracked key present. */
function tracked(stats) {
  const out = {};
  for (const key of TRACKED) out[key] = num(stats?.[key]);
  return out;
}

/**
 * One entry, sanitised. Returns null for anything that cannot be drawn — a
 * place with no name, no kind or no timestamp is not a place we can offer.
 */
function clean(place) {
  if (!place || typeof place !== 'object') return null;
  const kind = place.kind === 'server' || place.kind === 'world' ? place.kind : null;
  const name = text(place.name);
  const lastSeen = num(place.lastSeen);
  if (!kind || !name || !lastSeen) return null;
  return {
    id: text(place.id) || `${kind}:${name}`,
    kind,
    name,
    lastSeen,
    firstSeen: num(place.firstSeen),
    sessions: num(place.sessions),
    playedMs: playedMs(place),
    deaths: deaths(place),
    /* Carried since 2026-09-10 for the Stats page. The mod has kept these for
       a year and nothing had ever shown them. Home ignores the field. */
    stats: tracked(place.stats)
  };
}

/**
 * The places this install has played, most recent first.
 * Always resolves; never throws, never creates the file.
 */
async function recent(instances, limit = 8) {
  const parsed = await read(instances);
  const places = parsed?.places;
  if (!places || typeof places !== 'object' || Array.isArray(places)) return [];

  return Object.values(places)
    .slice(0, CEILING)
    .map(clean)
    .filter(Boolean)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, Math.max(1, Math.min(limit, MAX)));
}

/**
 * Local midnight of the day `at` falls in. Day boundaries are always walked
 * with setDate()/setHours() rather than by adding 86,400,000: the day a clock
 * goes forward is twenty-three hours long, and the arithmetic would put every
 * boundary after it an hour into the wrong day.
 */
function dayStart(at) {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** The same, `n` days later (or earlier, for a negative n). */
function shiftDays(start, n) {
  const day = new Date(start);
  day.setDate(day.getDate() + n);
  return day.getTime();
}

/**
 * A session's place, as something a screen can name. The session carries the
 * place's id and nothing else; the places map has the kind and the name. A
 * session whose place has since vanished from the map (the mod never drops
 * one, but the file is untrusted) is named out of its id, which is
 * `server:<address>` or `world:<name>:<hash>`.
 */
function namePlace(id, places) {
  const known = places?.[id];
  if (known && typeof known === 'object') {
    const kind = known.kind === 'world' ? 'world' : 'server';
    const name = text(known.name);
    if (name) return { id, kind, name };
  }
  const parts = id.split(':');
  if (parts[0] === 'world' && parts.length >= 2) {
    return { id, kind: 'world', name: parts.slice(1, -1).join(':') || 'World' };
  }
  return { id, kind: 'server', name: parts.slice(1).join(':') || id };
}

/**
 * The game's own counters a sitting gained, tidied: only the keys a screen
 * shows, only positive whole numbers. playTicks is left out because the
 * sitting's `ms` already says how long it was, and the per-sitting deaths are
 * not in here either — see the note on deaths in pages/home.js.
 */
function gainedOf(session) {
  const out = {};
  const gained = session.gained;
  if (!gained || typeof gained !== 'object') return out;
  for (const key of GAINED) {
    const value = num(gained[key]);
    if (value) out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------ the record
   as something you build (2026-09-12, evening). Adrian: the page should "hit
   dopamine … like Spotify Wrapped … make the client stickier". The everyday
   ledger stays the source; these are the three things read out of it that
   move every time you play — a level, a set of milestones and the totals
   behind them. Every one is a function of measured figures and nothing else. */

const HOUR = 3600000;
const KM = 100000;   // the game counts distance in centimetres

/**
 * The level: hours played, on a ladder that climbs fast at first and slows
 * without ever stopping. Level L needs (L-1)^2 / 4 hours — level 2 after a
 * quarter of an hour, 3 after one, 5 after four, 11 at twenty-five, 21 at a
 * hundred, 43 at four hundred and forty-one, 101 at two and a half thousand.
 * A first evening climbs four levels; a heavy player sees the next one every
 * couple of weeks. Hours are the all-time total across every place, and
 * since 2026-09-19 only the hours played on BlueClient: a server's own count
 * of the years before is no longer taken in on the first visit (it was until
 * this date — someone installing with four hundred hours on their main
 * server was level 41 the first time they looked), so everyone starts at
 * level 1 and climbs. Adrian: "playtime should only be counted AFTER they
 * installed blueclient, not before." The mod's Ledger.java took the old
 * history back out of existing records the same day, so a level can have
 * gone DOWN once; `announce()` in play.js says nothing about a drop.
 */
function levelOf(playedMs) {
  const hours = Math.max(0, playedMs) / HOUR;
  const level = Math.max(1, Math.floor(1 + 2 * Math.sqrt(hours) + 1e-9));
  const floor = (((level - 1) ** 2) / 4) * HOUR;
  const ceiling = ((level ** 2) / 4) * HOUR;
  return {
    level,
    into: Math.max(0, playedMs - floor),
    span: ceiling - floor,
    next: Math.max(0, ceiling - playedMs)
  };
}

/**
 * The milestone tracks, and the steps on each. The figures are the game's
 * own counters and the ledger's own days; a step is earned the moment the
 * running figure reaches it. The words for each are the screen's business.
 * Days played and the streak are calendar days, so a run survives a clock
 * change the way the streak does.
 */
const TRACKS = [
  { id: 'hours', steps: [1, 10, 25, 50, 100, 250, 500, 1000, 2500].map((h) => h * HOUR) },
  { id: 'days', steps: [7, 30, 100, 365] },
  { id: 'streak', steps: [3, 7, 14, 30, 60, 100] },
  { id: 'mobs', steps: [10, 100, 500, 1000, 5000, 10000] },
  { id: 'players', steps: [1, 10, 50, 100, 500, 1000] },
  { id: 'distance', steps: [10, 50, 100, 500, 1000].map((km) => km * KM) }
];

const distanceOf = (stats) => num(stats?.walkCm) + num(stats?.sprintCm);

/**
 * All-time totals across every place in the file — not the 24 `recent()`
 * hands the screen. `since` is the earliest day the record knows.
 */
function totalsOf(places) {
  const totals = {
    playedMs: 0, deaths: 0, mobKills: 0, playerKills: 0, distanceCm: 0,
    jumps: 0, damageDealt: 0, damageTaken: 0, walkCm: 0, sprintCm: 0,
    places: 0, since: 0
  };
  for (const raw of Object.values(places).slice(0, CEILING)) {
    const place = clean(raw);
    if (!place) continue;
    totals.places++;
    totals.playedMs += place.playedMs;
    totals.deaths += place.deaths;
    for (const key of ['mobKills', 'playerKills', 'jumps', 'damageDealt', 'damageTaken', 'walkCm', 'sprintCm']) {
      totals[key] += place.stats[key];
    }
    if (place.firstSeen && (!totals.since || place.firstSeen < totals.since)) totals.since = place.firstSeen;
  }
  totals.distanceCm = totals.walkCm + totals.sprintCm;
  return totals;
}

/**
 * When each milestone was earned, by walking the sittings in the order they
 * happened. A place's total can be more than its sittings add up to — the
 * mod's wall clock counts a sitting a killed game never closed, sittings
 * under thirty seconds are never listed, and the list keeps two years where
 * the place keeps everything (until 2026-09-19 the bulk of the difference
 * was the server's own history, adopted on the first visit; it is not taken
 * any more, and Ledger.java took it back out of the records that had it) —
 * so the remainder is credited at the place's FIRST sitting: the day the
 * record first knew it. A step crossed by that remainder is dated to that
 * day, which is the honest date — it is when BlueClient first saw the
 * figure.
 *
 * Returns every step on every track, earned ones with the day they were
 * reached, plus the running figure per track for the screen's "to go".
 */
function milestonesOf(sessions, places, byDay) {
  const running = { hours: 0, mobs: 0, players: 0, distance: 0, days: 0, streak: 0 };
  const earned = new Map();          // 'hours:360000000' -> day start

  const note = (track, value, at) => {
    for (const step of TRACKS.find((t) => t.id === track).steps) {
      const key = `${track}:${step}`;
      if (value >= step && !earned.has(key)) earned.set(key, at);
    }
  };

  /* What the sittings account for, per place, so the remainder the place
     alone knows about can be credited once. */
  const seenMs = new Map();
  const seenGained = new Map();
  for (const session of sessions) {
    const id = session.place;
    seenMs.set(id, (seenMs.get(id) || 0) + session.ms);
    const g = seenGained.get(id) || { mobs: 0, players: 0, distance: 0 };
    g.mobs += num(session.gained.mobKills);
    g.players += num(session.gained.playerKills);
    g.distance += num(session.gained.walkCm) + num(session.gained.sprintCm);
    seenGained.set(id, g);
  }
  const baselineOf = (id) => {
    const place = clean(places[id]);
    const g = seenGained.get(id) || { mobs: 0, players: 0, distance: 0 };
    return {
      hours: Math.max(0, (place?.playedMs || 0) - (seenMs.get(id) || 0)),
      mobs: Math.max(0, (place?.stats.mobKills || 0) - g.mobs),
      players: Math.max(0, (place?.stats.playerKills || 0) - g.players),
      distance: Math.max(0, distanceOf(place?.stats) - g.distance)
    };
  };

  const credit = (delta, at) => {
    running.hours += delta.hours;
    running.mobs += delta.mobs;
    running.players += delta.players;
    running.distance += delta.distance;
    note('hours', running.hours, at);
    note('mobs', running.mobs, at);
    note('players', running.players, at);
    note('distance', running.distance, at);
  };

  const seen = new Set();
  for (const session of sessions) {
    const at = dayStart(session.start);
    if (!seen.has(session.place)) {
      seen.add(session.place);
      credit(baselineOf(session.place), at);
    }
    credit({
      hours: session.ms,
      mobs: num(session.gained.mobKills),
      players: num(session.gained.playerKills),
      distance: num(session.gained.walkCm) + num(session.gained.sprintCm)
    }, at);
  }
  /* A place with no sitting in the list at all (the file is untrusted)
     still counts, dated to the last day it was seen. */
  for (const id of Object.keys(places)) {
    if (seen.has(id)) continue;
    const place = clean(places[id]);
    if (place) credit(baselineOf(id), dayStart(place.lastSeen));
  }

  /* Days played and the streak, out of the calendar. */
  let count = 0;
  let run = 0;
  let best = 0;
  let previous = null;
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    count++;
    run = previous !== null && shiftDays(previous, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
    note('days', count, day);
    note('streak', run, day);
  }
  running.days = count;
  running.streak = best;

  const list = [];
  for (const track of TRACKS) {
    for (const step of track.steps) {
      const key = `${track.id}:${step}`;
      list.push({ id: key, track: track.id, step, earnedAt: earned.get(key) || 0 });
    }
  }
  return { list, running };
}

/**
 * The play record as the screens want it (2026-09-12): the last SEVEN DAYS
 * ending today, each day carrying its own places and sittings, plus the
 * things a player can only learn from the whole run of sittings — the streak,
 * the records, and the seven days before for comparison.
 *
 * Rolling rather than Monday-first: Adrian, 2026-09-12, "it should be rolling
 * 7 days". A Monday-first week is empty on a Monday morning and says nothing
 * about the weekend just played; the last seven days always hold a week.
 *
 * Every figure is summed out of the sittings the mod recorded. Nothing is
 * interpolated, averaged or carried across, except the one average the screen
 * names as one. A day with no sitting is a day with no bar. Two limits of the
 * record, stated rather than hidden: a sitting that runs past midnight counts
 * entirely to the day it BEGAN, because the start is the only moment the
 * record keeps — play from 23:40 to 00:40 is an hour on the earlier day; and
 * the sitting in progress is flushed to disk once a minute, so today can sit
 * up to a minute behind the clock.
 *
 * The streak counts calendar days with any play at all, back from today — or
 * from yesterday when today has none yet, because a run is alive until
 * midnight. `alive` says which. The records are over every sitting in the
 * file, not the seven days.
 */
async function summary(instances, now = Date.now()) {
  const today = dayStart(now);
  const from = shiftDays(today, -6);
  const to = shiftDays(today, 1);
  const before = shiftDays(from, -7);

  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push({ start: shiftDays(from, i), ms: 0, places: [], sittings: [], gained: {} });
  }

  const answer = () => ({
    from,
    to,
    today,
    days,
    playedMs: days.reduce((sum, day) => sum + day.ms, 0),
    previousMs: 0,
    streak: { days: 0, best: 0, alive: false },
    records: { longestDay: null, longestSitting: null, activeDays: 0 },
    /* The record as something you build (2026-09-12, evening). */
    totals: totalsOf({}),
    level: levelOf(0),
    milestones: { list: milestonesOf([], {}, new Map()).list, running: { hours: 0, mobs: 0, players: 0, distance: 0, days: 0, streak: 0 } }
  });

  const parsed = await read(instances);
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  const places = parsed?.places && typeof parsed.places === 'object' && !Array.isArray(parsed.places)
    ? parsed.places
    : {};
  if (!sessions.length && !Object.keys(places).length) return answer();

  const result = answer();
  result.totals = totalsOf(places);
  result.level = levelOf(result.totals.playedMs);

  const byDay = new Map();          // local midnight -> ms, for the streak and the records
  const perDayPlaces = days.map(() => new Map());
  const walked = [];                // every sitting that counts, in the order it happened
  let longestSitting = null;

  for (const session of sessions.slice(0, SESSION_CEILING)) {
    if (!session || typeof session !== 'object') continue;
    const start = num(session.start);
    const ms = num(session.ms);
    /* A start in the future is a clock disagreeing with itself — dropped,
       rather than pinned to today. */
    if (!start || !ms || start >= to) continue;
    const id = text(session.place);
    if (!id) continue;

    const day = dayStart(start);
    byDay.set(day, (byDay.get(day) || 0) + ms);
    if (!longestSitting || ms > longestSitting.ms) {
      longestSitting = { start, ms, place: namePlace(id, places) };
    }
    const gained = gainedOf(session);
    walked.push({ place: id, start, ms, gained });

    if (start >= before && start < from) {
      result.previousMs += ms;
      continue;
    }
    if (start < from) continue;

    let i = 6;
    while (i > 0 && start < days[i].start) i--;
    const bucket = days[i];
    const place = namePlace(id, places);

    bucket.ms += ms;
    bucket.sittings.push({ start, ms, place, gained });
    for (const [key, value] of Object.entries(gained)) {
      bucket.gained[key] = (bucket.gained[key] || 0) + value;
    }
    const slot = perDayPlaces[i].get(id) || { ...place, ms: 0 };
    slot.ms += ms;
    perDayPlaces[i].set(id, slot);
  }

  for (let i = 0; i < 7; i++) {
    days[i].places = [...perDayPlaces[i].values()].sort((a, b) => b.ms - a.ms);
    days[i].sittings.sort((a, b) => a.start - b.start);
  }
  result.playedMs = days.reduce((sum, day) => sum + day.ms, 0);

  /* The streak: walk back a day at a time from today (or yesterday) while
     each day had play. The best run is the longest such walk anywhere in the
     record. Both in calendar days, so a run survives a clock change. */
  const alive = byDay.has(today);
  let cursor = alive ? today : shiftDays(today, -1);
  let current = 0;
  while (byDay.has(cursor)) {
    current++;
    cursor = shiftDays(cursor, -1);
  }
  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    run = previous !== null && shiftDays(previous, 1) === day ? run + 1 : 1;
    previous = day;
    if (run > best) best = run;
  }
  result.streak = { days: current, best, alive };

  let longestDay = null;
  for (const [start, ms] of byDay) {
    if (!longestDay || ms > longestDay.ms) longestDay = { start, ms };
  }
  result.records = { longestDay, longestSitting, activeDays: byDay.size };

  walked.sort((a, b) => a.start - b.start);
  result.milestones = milestonesOf(walked, places, byDay);
  /* "2 of 3" on the streak goal is the run in progress — the best run decides
     what is earned, the current one decides how far the next step is. */
  result.milestones.running.streak = current;

  return result;
}

module.exports = { recent, summary, file, levelOf, TRACKS };
