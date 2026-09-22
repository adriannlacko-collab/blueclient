'use strict';

/**
 * The server list, from the one place it is edited (2026-09-11).
 *
 * Home's Featured servers used to be typed into `js/partners.js`; the game's
 * own Find Servers screen reads Adrian's list from admin.blueclient.net
 * (`mod/…/ui/Discover.java`). Two lists, one of them a jar and a launcher
 * release behind the other. This is Home reading the same list from the same
 * two addresses, in the same order — so a server added, moved or taken out on
 * the admin site is on Home the next time it is shown.
 *
 * Stale-while-revalidate, and never in front of a paint. The last answer is
 * kept in the launcher's own lookup cache on disk (game/memo.js, beside the
 * settings), and `cached()` hands it back without touching the network — that
 * is what Home draws first. `refresh()` asks the site only when the copy is
 * older than the edge's own cache (five minutes), and Home repaints if the
 * answer differs. With nothing on disk and no network, Home keeps the short
 * list typed into partners.js, which is kept true for exactly that case.
 *
 * Read forgivingly, the way Discover.parse does: a row without a name or an
 * address is skipped, two spellings of one address count once, long strings
 * are cut rather than refused. The fields are the endpoint's — name, address,
 * category, about — and nothing here invents one it did not get.
 */

const memo = require('./memo');
const { VERSION } = require('../version');

/** The site first; the project's own Cloudflare address if the domain is missing. Same as the game. */
const SOURCES = [
  'https://api.blueclient.net/api/servers',
  'https://blueclient-admin.pages.dev/api/servers'
];

const KEY = 'servers:list';
/** The edge caches the answer this long, so asking sooner only gets the same one back. */
const FRESH_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 6000;
/** Longer than the in-game list will ever be; a cap against a bad answer, not a design. */
const MAX_ROWS = 60;

let inFlight = null;

/** The last list this launcher saw, whatever its age, or null. Never asks the network. */
function cached() {
  const kept = memo.stale(KEY);
  return kept ? { ...kept, source: 'cache' } : null;
}

/**
 * A fresh list: the cached one if it is under five minutes old, otherwise the
 * site's. Null when there is nothing cached and the site cannot be reached —
 * the caller keeps what it has. Several callers at once share one request.
 */
function refresh() {
  const fresh = memo.get(KEY, FRESH_MS);
  if (fresh) return Promise.resolve({ ...fresh, source: 'cache' });
  if (inFlight) return inFlight;

  inFlight = (async () => {
    for (const source of SOURCES) {
      const listing = await fetchListing(source);
      if (listing) {
        memo.set(KEY, listing);
        return { ...listing, source: 'live' };
      }
    }
    const old = memo.stale(KEY);
    return old ? { ...old, source: 'cache' } : null;
  })().finally(() => { inFlight = null; });

  return inFlight;
}

async function fetchListing(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `BlueClient/${VERSION} (blueclient.net)`, Accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Discover.parse, in JavaScript: the same cuts, the same skips, the same order. */
function parse(root) {
  if (!root || typeof root !== 'object') return null;
  const cut = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

  const categories = [];
  for (const entry of Array.isArray(root.categories) ? root.categories : []) {
    const category = cut(entry, 24);
    if (category && !categories.includes(category)) categories.push(category);
  }

  const servers = [];
  const seen = new Set();
  for (const row of Array.isArray(root.servers) ? root.servers : []) {
    if (!row || typeof row !== 'object') continue;
    const name = cut(row.name, 32);
    const address = cut(row.address, 128);
    const category = cut(row.category, 24);
    const about = cut(row.about, 96);
    if (!name || !address) continue;
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    if (category && !categories.includes(category)) categories.push(category);
    // Whether the server checks accounts with Mojang (2026-09-21): the admin
    // site's word when it has one (`account`, 1 or true), nothing otherwise —
    // the renderer knows the well-known ones itself (partners.js).
    const account = row.account === true || row.account === 1 || row.account === '1';
    servers.push(account ? { name, address, category, about, account } : { name, address, category, about });
    if (servers.length >= MAX_ROWS) break;
  }

  // An answer with no rows is not a list; keep whatever was there before.
  if (!servers.length) return null;
  return { categories, servers, at: Date.now() };
}

module.exports = { cached, refresh, parse, SOURCES };
