'use strict';

/**
 * Browsing for a skin (2026-09-09).
 *
 * Adrian: "is it possible to add a browse skins button to the skins card,
 * where people can search for skins? like namemc has searching for skins."
 * What NameMC is actually used for is a name: you type someone's, you see the
 * skin they are wearing and the ones they wore before it, and you take one.
 * That is what this does, and it needs no account, no key and no scraping.
 *
 * Three sources. Mojang is the one that matters: a name resolves to the
 * skin that player wears now, fetched by hash from `textures.minecraft.net`
 * through the same content-addressed cache the home screen's model uses
 * (`skins.js`), so a skin browsed once is on disk and free from then on.
 * laby.net supplies the skins a player wore *before* this one (its textures
 * endpoint, public, by UUID — see `lookup`). Crafty (api.crafty.gg, a public
 * NameMC-style index) ranks which skins are being put on most this week —
 * the grid you see before typing anything — and BlueClient's own index
 * (`INDEX`) answers that grid when Crafty will not, and every category search.
 *
 * Crafty used to answer histories too, with the PNG in the same response,
 * until 2026-09-10: one burst of lookups from this PC and its Cloudflare rule
 * blocked the address outright — the API, the site, any user agent, still
 * blocked a day later — which is a rule any launcher trips just by someone
 * typing a name, so nothing here depends on Crafty any more. Down, it costs
 * the "this week" ranking and nothing else: the grid comes from the index,
 * a name still has its history, and the three slots work off disk.
 *
 * <h2>Search by what a skin looks like (2026-09-10)</h2>
 * "lava", "burger", "girl", "hoodie" — the search NameMC has and no public
 * index offers (Crafty's `search` is by player name, MineSkin's by upload
 * name; NameMC's tags have no API). So it is BlueClient's own: the Worker in
 * `../../../blueclient-skins` draws each popular skin, has a vision model
 * describe it and a text model turn that into the words players type, and
 * answers `/search?q=` with hashes. The pictures still come from Mojang by
 * hash through the same cache as every other card here. Adrian: "it is a
 * super important feature as a competitive advantage."
 *
 * The index fills from what launchers see: every popular grid and every
 * player history drawn here is offered to it (`contribute`, fire and forget,
 * hashes only), because Crafty answers each launcher from its own address
 * and rate-limits the Worker's shared one.
 */

/** The index. skins.blueclient.net once Adrian adds the CNAME; this works today. */
const INDEX = 'https://blueclient-skins.blueclient-relay.workers.dev';

const crypto = require('node:crypto');

const skins = require('./skins');
const skinSlots = require('./skinslots');
const { USER_AGENT: UA } = require('./version');

const API = 'https://api.crafty.gg/api/v2';
const TIMEOUT_MS = 9000;

/* laby.net, for the skins a player wore before this one (2026-09-10, night).
   `/user/<uuid>/textures` is public and answered Notch and Dream in about
   120 ms with every skin they were ever seen in: laby's own 32-hex image
   hash, slim or not, first and last seen, how many players. The picture is
   /texture/<image_hash>.png — re-encoded by laby, so neither the bytes nor
   the hash are Mojang's; laby's `file_hash` is the MD5 of Mojang's PNG, which
   is how the skin they wear now is recognised and not shown twice. A laby
   hash is 32 hex characters where Mojang's are 64: `keep` tells them apart. */
const LABY = 'https://laby.net/api/v3';
const LABY_TEXTURE = (hash) => `https://laby.net/texture/${hash}.png`;
const LABY_HASH = /^[0-9a-f]{32}$/;

/** How many to show: a grid to browse, and one player's history. */
const POPULAR = 24;
const HISTORY = 12;

/* Trending answers ten at a time whatever any size parameter says — measured,
   not assumed: limit, per_page, size and take all come back with limit 10 in
   the response's own meta. So the grid is paged, three requests deep. */
const PER_PAGE = 10;

/* Popular changes by the day, not the minute, and a name's history changes
   when that player changes their skin. Both are held for a while, so going
   back and forth costs nothing and Crafty is asked once. */
const POPULAR_TTL_MS = 15 * 60 * 1000;
const FIND_TTL_MS = 5 * 60 * 1000;

/** Mojang's own rule for a name, and the only thing that reaches the URL. */
const NAME = /^[A-Za-z0-9_]{1,16}$/;
/* A name is at least three characters, and the two before that are typing.
   Every pause under three used to cost Crafty a lookup — "D", "Dr" — and a
   burst of those from one address is what got this PC blocked (2026-09-10). */
const NAME_MIN = 3;

let popularCache = null;            // { at, answer }
const findCache = new Map();        // lowercase name -> { at, answer }

/* How many answers each of the two search caches holds at most — this one,
   and lookCache for the searches by look (2026-09-22). An entry was only
   ever read for FIND_TTL_MS and never taken out, and each answer carries its
   sheets as data URIs — up to 24 of them, tens of kilobytes a search — so
   every distinct name or phrase typed into Browse skins stayed in main's
   memory until the launcher closed. Expired answers now go as a new one is
   kept, and the oldest past this number. */
const HELD_MAX = 32;

function hold(cache, key, answer) {
  const now = Date.now();
  for (const [held, entry] of cache) if (now - entry.at >= FIND_TTL_MS) cache.delete(held);
  cache.delete(key);
  cache.set(key, { at: now, answer });
  while (cache.size > HELD_MAX) cache.delete(cache.keys().next().value);
}

async function get(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.success ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Any URL, as JSON or bytes, in TIMEOUT_MS or null. */
async function fetchFrom(url, { json = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'image/png' },
      signal: controller.signal
    });
    if (!res.ok) return null;
    return json ? await res.json() : Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A sheet becomes a card only if a slot would take it.
 *
 * `skinslots.check` is the same test the file picker runs, so nothing in the
 * grid can be clicked into a slot and refused there: an HD sheet or a 64x16
 * avatar never appears in the first place.
 */
function card(bytes, { hash, slim, name, players = 0, current = false, changed = null }) {
  if (!bytes) return null;
  const fit = skinSlots.check(bytes);
  if (!fit.ok) return null;

  return {
    hash,
    slim: Boolean(slim),
    height: fit.height,
    dataUri: skins.asDataUri(bytes),
    name: name || '',
    // How many players wear it, where the source knows: the card's caption.
    players: Number(players) || 0,
    current,
    changed
  };
}

/** One GET against the index, JSON or null; the index answers in milliseconds or not at all. */
async function fromIndex(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${INDEX}${path}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal
    });
    const body = res.ok ? await res.json() : null;
    return body?.ok ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Run `work` over `items` a few at a time, keeping their order. */
async function pool(items, width, work) {
  const queue = items.map((item, at) => [item, at]);
  const out = new Array(items.length).fill(null);
  const runners = Array.from({ length: Math.min(width, queue.length) }, async () => {
    while (queue.length) {
      const [item, at] = queue.shift();
      out[at] = await work(item);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * The grid before anything is typed: the skins most players changed into this
 * week. Crafty ranks them; the PNGs come from Mojang, by hash.
 */
async function popular() {
  if (popularCache && Date.now() - popularCache.at < POPULAR_TTL_MS) return popularCache.answer;

  const pages = await Promise.all(
    Array.from({ length: Math.ceil(POPULAR / PER_PAGE) }, (_, at) => get(`/skins/trending?page=${at + 1}&days=7`)));

  let rows;
  if (pages[0]) {
    // The first page is the one that decides whether Crafty answered at all;
    // a later page that fails just makes the grid shorter.
    const seen = new Set();
    rows = pages
      .flatMap((page) => page?.data || [])
      .filter((row) => row?.hash && !row.banned && !seen.has(row.hash) && seen.add(row.hash))
      .slice(0, POPULAR)
      .map((row) => ({
        hash: row.hash,
        slim: row.slim,
        players: Number(row.players_count) || 0,
        name: row.first_player?.username || ''
      }));
    contribute(rows);
  } else {
    /* Crafty would not answer — it blocks an address after a burst, and it
       blocked this one — so the index says what it knows most players wear.
       Slower to change than Crafty's week, and never empty once it has
       learned anything. */
    const body = await fromIndex(`/popular?limit=${POPULAR}`);
    rows = (body?.results || []).filter((row) => row?.hash);
    if (!rows.length) {
      return {
        ok: false,
        kind: 'popular',
        results: [],
        reason: 'Popular skins are not available right now. Search a player’s name, or a category.'
      };
    }
  }

  const cards = await pool(rows, 6, async (row) => card(await skins.texture(row.hash), row));

  // `source` so the panel can say "this week" only when it is Crafty's week.
  const answer = { ok: true, kind: 'popular', source: pages[0] ? 'crafty' : 'index', results: cards.filter(Boolean) };
  // Only a good answer is kept: one failed fetch must not pin an empty grid in
  // place for a quarter of an hour.
  if (answer.results.length) popularCache = { at: Date.now(), answer };
  return answer;
}

/**
 * One name: the skin they are wearing, then the ones they wore before.
 *
 * Mojang answers the first — every real name, always — and laby.net the
 * rest. A history sheet is laby's re-encoding, kept in the texture cache
 * under laby's hash so keeping it later is a file copy like any other card;
 * the current skin is Mojang's bytes under Mojang's hash, and is the one
 * entry of laby's list left out (matched by MD5, not by laby's "active"
 * flag, which can lag a change by a day). laby down or challenging: the
 * player still has the skin they are wearing, which is the one that matters
 * most anyway.
 */
async function lookup(name) {
  const resolved = await skins.resolve(name);
  if (!resolved?.hash) return { ok: true, kind: 'player', player: name, results: [] };

  const cards = [];
  const bytes = await skins.texture(resolved.hash);
  const current = card(bytes, { hash: resolved.hash, slim: resolved.slim, name, current: true });
  if (current) {
    cards.push(current);
    // A real player's real skin: the index should know it too.
    contribute([{ hash: resolved.hash, slim: resolved.slim, players: 1 }]);
  }
  const wearing = bytes ? crypto.createHash('md5').update(bytes).digest('hex') : '';

  const body = await fetchFrom(`${LABY}/user/${resolved.uuid}/textures`);
  const history = Array.isArray(body?.SKIN) ? body.SKIN : [];
  for (const entry of history) {
    if (cards.length >= HISTORY) break;
    const hash = String(entry?.image_hash || '').toLowerCase();
    if (!LABY_HASH.test(hash) || entry.file_hash === wearing) continue;

    let png = skins.cached(hash);
    if (!png) {
      png = await fetchFrom(LABY_TEXTURE(hash), { json: false });
      if (png) skins.keepTexture(hash, png);
    }
    if (!png) continue;

    const made = card(png, {
      hash,
      slim: Boolean(entry.slim_skin),
      name,
      players: entry.use_count,
      changed: entry.first_seen_at || null
    });
    if (made) cards.push(made);
  }

  return { ok: true, kind: 'player', player: name, results: cards };
}

/* -------------------------------------------------------- by what it looks like */

const lookCache = new Map();        // lowercase words -> { at, answer }

/**
 * Words to the index, hashes back, cards from Mojang by hash.
 *
 * The index answers in a few milliseconds and never with a picture; the
 * cost here is the sheets, fetched six at a time through the texture cache,
 * so a skin already browsed once costs nothing again.
 */
async function browse(words) {
  const q = String(words || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
  if (!q) return popular();

  const held = lookCache.get(q);
  if (held && Date.now() - held.at < FIND_TTL_MS) return held.answer;

  const body = await fromIndex(`/search?q=${encodeURIComponent(q)}&limit=${POPULAR}`);
  if (!body) return { ok: false, kind: 'look', query: q, results: [], reason: 'Could not reach the skin index.' };

  const rows = (body.results || []).filter((row) => row?.hash);
  const cards = await pool(rows, 6, async (row) =>
    card(await skins.texture(row.hash).catch(() => null), {
      hash: row.hash,
      slim: row.slim,
      players: row.players,
      name: row.caption || ''
    }));

  const answer = { ok: true, kind: 'look', query: q, results: cards.filter(Boolean) };
  if (answer.results.length) hold(lookCache, q, answer);
  return answer;
}

/**
 * Offer what this launcher has just seen to the index's queue. Hashes and
 * the player counts Crafty reported, nothing else; nothing waits on it.
 */
function contribute(rows) {
  const skinsSeen = rows
    .filter((row) => row?.hash)
    .slice(0, 40)
    .map((row) => ({
      hash: row.hash,
      slim: Boolean(row.slim),
      players: Number(row.players ?? row.players_count) || 0
    }));
  if (!skinsSeen.length) return;
  fetch(`${INDEX}/contribute`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ skins: skinsSeen })
  }).catch(() => {});
}

/**
 * A launcher's small share of filling the index (2026-09-10).
 *
 * The index has to see a skin before it can describe it, and Crafty — where
 * the popular skins are listed — rate-limits Cloudflare's addresses while
 * answering every home connection freely. So each launcher, once per run and
 * a couple of minutes after it opens, reads two pages of the month's trending
 * list it picks at random and offers the hashes to the index. Two requests a
 * day from an install that already makes three every time Browse skins opens;
 * across every install it is the crawl no single address could run.
 */
function seedIndex() {
  setTimeout(async () => {
    for (let i = 0; i < 2; i++) {
      const page = 1 + Math.floor(Math.random() * 200);
      const body = await get(`/skins/trending?page=${page}&days=30`);
      const rows = (body?.data || []).filter((row) => row?.hash && !row.banned);
      if (!rows.length) return;
      contribute(rows);
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }, 90 * 1000 + Math.floor(Math.random() * 120 * 1000)).unref();
}

/**
 * @param {string} query a Minecraft name — or, in `look` mode, words
 * @param {'player'|'look'} [mode]
 */
async function find(query, mode = 'player') {
  if (mode === 'look') return browse(query);

  const name = String(query || '').trim();
  if (!name) return popular();
  if (!NAME.test(name)) {
    return { ok: true, kind: 'player', player: name, results: [], invalid: true };
  }
  if (name.length < NAME_MIN) {
    return { ok: true, kind: 'player', player: name, results: [], short: true };
  }

  const key = name.toLowerCase();
  const held = findCache.get(key);
  if (held && Date.now() - held.at < FIND_TTL_MS) return held.answer;

  const answer = await lookup(name);
  if (answer.results.length) hold(findCache, key, answer);
  return answer;
}

/**
 * Keep a browsed skin in one of the three slots.
 *
 * The hash travels, not the picture: the sheet is already on disk under it
 * from the search that drew the card, so this is a file copy. From there it is
 * an ordinary slot — the same Wear button, the same arms.
 */
async function keep(index, { hash, slim, name } = {}) {
  const bytes = LABY_HASH.test(String(hash || ''))
    ? (skins.cached(hash) || await fetchFrom(LABY_TEXTURE(hash), { json: false }))
    : await skins.texture(hash);
  if (!bytes) return { ok: false, reason: 'That skin could not be downloaded.' };
  return skinSlots.putBytes(index, bytes, slim ? 'slim' : 'classic', name || 'Browsed skin');
}

module.exports = { find, keep, seedIndex };
