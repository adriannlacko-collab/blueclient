/**
 * Featured servers — one list, one source (2026-09-11).
 *
 * The rows on Home are the admin site's list: the same
 * `api.blueclient.net/api/servers` the game's own Find Servers screen reads
 * (`mod/…/ui/Discover.java`), in the same order, so a server added, moved or
 * taken out on admin.blueclient.net is on Home the next time it is shown.
 * Main fetches and keeps it (`src/main/game/servers.js`); this file only says
 * which rows Home draws and what each one looks like.
 *
 * The numbers are still not the list's. Player counts, capacity and whether a
 * server is up come from the servers themselves at the moment Home is shown
 * (main pings them the way the game's Multiplayer screen does,
 * src/main/game/ping.js). Until 2026-09-02 the counts here were typed in and
 * one of them was wrong by a factor of eight; nothing on Home may claim a
 * number it did not measure.
 *
 * Clicking a row starts the active profile and joins the server.
 *
 * HOW MANY. Three (2026-09-08, Adrian): it was five, and CrystalChaos and
 * BananaSMP came off so the rows could be taller and the card shorter, which
 * is what gives Where you left off and Your play either side of it real
 * height — the side column has no room left in it at the design size. So Home
 * shows the list's first `HOME_ROWS`, and the list's order decides which.
 * Adding a fourth means checking Home still fits.
 *
 * THE TYPED LIST BELOW STANDS IN when there is nothing on disk and the site
 * cannot be reached — a first run offline. It is kept short and true for that
 * case and for nothing else.
 *
 * THE LOGO IS THE SERVER'S OWN (2026-09-13). Every row asks servericons.js for
 * the icon the server sends with its status — the one the game shows on the
 * Multiplayer screen — or its website's, and wears it the moment it lands.
 * What is drawn until then is the stand-in: the bundled art matched by the
 * server's domain (`iconFor`, five partners' logos as they were in August)
 * or a generated initial tile, never a broken image. The bundled files are
 * a first paint now, not the picture; a partner added on the site gets its
 * real logo without a file being added here.
 */

import { host } from './bridge.js';

/** How many of the list Home shows. See HOW MANY above before changing it. */
export const HOME_ROWS = 3;

/** What stands in offline with nothing cached. Same shape as the site's rows. */
export const FALLBACK = [
  { name: 'BlueMC', address: 'bluemc.org', category: 'Economy', about: 'BlueMC.org - economy SMP' },
  { name: 'Hypixel', address: 'mc.hypixel.net', category: 'Skyblock', about: 'Hypixel Network - Bed Wars, SkyBlock and more', account: true },
  { name: 'DonutSMP', address: 'donutsmp.net', category: 'Lifesteal', about: 'DonutSMP - Lifesteal', account: true }
];

/**
 * Servers that check accounts with Mojang, by host (2026-09-21). An offline
 * account is refused by these after the whole launch — "Invalid session" at
 * the end of a minute of loading — so a row for one says so before Play
 * rather than after. The admin list carries the same word as `account` on a
 * row when Adrian has set it; this set covers the well-known ones until then.
 */
const ACCOUNT_HOSTS = ['hypixel.net', 'donutsmp.net', '2b2t.org', 'mineplex.com', 'cubecraft.net', 'wynncraft.com', 'hivemc.com', 'mcc.gg'];

/** Whether this server turns an offline account away. */
export function needsAccount(server) {
  if (!server) return false;
  if (server.account === true) return true;
  // `\d`, not `d` (2026-09-22): the port never came off, so an address
  // written with one — mc.hypixel.net:25565 — matched no host here.
  const host = String(server.address || '').toLowerCase().replace(/:\d+$/, '');
  return ACCOUNT_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

/**
 * Bundled artwork, by the registrable domain of the address: `hypixel.net`
 * and `mc.hypixel.net` are the same server and wear the same icon, and
 * `play.crystalchaos.gg` was the address a partner published before its own.
 */
const ICONS = {
  'bluemc.org': 'bluemc.png',
  'hypixel.net': 'hypixel.png',
  'donutsmp.net': 'donutsmp.png',
  'bananasmp.net': 'bananasmp.png',
  'crystalchaos.net': 'crystalchaos.png',
  'crystalchaos.gg': 'crystalchaos.png'
};

/* The list in hand: the site's, or the cache of it, or nothing yet. */
let listing = null;

/**
 * Ask main for the copy on disk, once, at module load — the answer is back
 * long before Home's first paint (one IPC round trip against the whole of
 * initState), so the first picture is the real list and nothing swaps under
 * the player's eyes. If it is not back in time the typed list paints and the
 * real one replaces it in place; Home never waits.
 */
export function primeServers() {
  return Promise.resolve()
    .then(() => host.servers?.list?.())
    .then((got) => { if (got) adopt(got); })
    .catch(() => {});
}

/** Take a listing from main. Returns true when the rows Home shows changed. */
export function adopt(got) {
  if (!got || !Array.isArray(got.servers) || !got.servers.length) return false;
  const before = key(servers());
  listing = got;
  return key(servers()) !== before;
}

/** The rows Home draws, in the list's own order. */
export function servers() {
  const rows = listing && listing.servers && listing.servers.length ? listing.servers : FALLBACK;
  return rows.slice(0, HOME_ROWS);
}

/** True when the rows come from the site rather than the typed list. */
export const isLive = () => Boolean(listing);

const key = (rows) => rows.map((row) => row.address.toLowerCase()).join('|');

/**
 * The stand-in for a row until its own logo lands (see the note above):
 * bundled artwork by domain, else a generated initial tile keyed off the
 * name so the list reads as a set rather than as noise.
 */
export function partnerLogo(server, size = 44) {
  const icon = iconFor(server.address);
  if (icon) return `assets/art/partners/${icon}`;
  return initialTile(server, size);
}

/** `play.mccentral.org:25565` → `mccentral.org` → the file, or null. */
export function iconFor(address) {
  const host = String(address || '').toLowerCase().split(':')[0].replace(/\.$/, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  return ICONS[labels.slice(-2).join('.')] || null;
}

/** A steady hue per name, so the same server gets the same tile every time. */
function hueOf(name) {
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/**
 * Square logo tile: a two-tone diagonal gradient with the server's initial.
 * Artwork standing in for a picture, not a control — the no-gradient rule is
 * about controls.
 */
function initialTile(server, size) {
  const hue = Number.isFinite(server.hue) ? server.hue : hueOf(server.name);
  const initial = String(server.name || '?').charAt(0).toUpperCase();
  const id = `g${hue}`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 44 44">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue} 78% 62%)"/>` +
    `<stop offset="100%" stop-color="hsl(${(hue + 28) % 360} 72% 42%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="44" height="44" rx="12" fill="url(#${id})"/>` +
    `<text x="22" y="23" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Segoe UI, Arial, sans-serif" font-size="21" font-weight="700" fill="rgba(255,255,255,.95)">${initial}</text>` +
    `</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const formatPlayers = (n) => Number(n || 0).toLocaleString('en-US');
