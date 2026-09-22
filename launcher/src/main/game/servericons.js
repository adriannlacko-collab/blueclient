'use strict';

/**
 * Server logos (2026-09-13).
 *
 * Adrian: "put logos on all places for servers like in the featured servers
 * list and in your play page, just pull it from their domains or something."
 * Every server row in the launcher — Featured servers, Where you left off,
 * Where you played on Stats — asks here for a picture of the server, by its
 * address, and gets a data URL or null.
 *
 * Two sources, in this order, and both are the server's own:
 *
 *   1. The icon the server sends in its Server List Ping — the 64x64 PNG the
 *      game shows beside it on the Multiplayer screen, which is the logo a
 *      player already knows. Main pings the featured servers every minute
 *      anyway for their player counts (src/main/game/ping.js), so those come
 *      for nothing (`remember`); a server from the play record is pinged once.
 *   2. The website's icon, off the server's own domain: the page at
 *      https://<domain>/ is read for its <link rel="icon"> (the largest one,
 *      an apple-touch-icon first), and /favicon.ico is tried when the page
 *      names none. Only the domain the player already connects to is ever
 *      contacted — no icon service, no third party, nothing about the player
 *      in the request.
 *
 * What is found is kept on disk, one small file per host under
 * `<userData>/server-icons/`, so a look at Stats costs no network after the
 * first. A server that answered with no icon anywhere is remembered as such
 * for a day; one that could not be reached at all (offline, a typo) is asked
 * again after ten minutes, because the player will be back on it. Nothing
 * here is ever the only copy of anything: a miss costs a ping, not a row.
 */

const fs = require('fs/promises');
const path = require('path');
const ping = require('./ping');

const FOLDER = 'server-icons';
const RETRY_NONE_MS = 24 * 3600000;
const RETRY_DOWN_MS = 10 * 60000;
const WEB_TIMEOUT_MS = 5000;
const PAGE_MAX = 256 * 1024;      // of the homepage, enough for any <head>
const ICON_MAX = 512 * 1024;      // an icon bigger than this is a photograph
const DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

let dir = null;
const inflight = new Map();       // host -> Promise<string|null>

function init(userDataDir) {
  dir = path.join(userDataDir, FOLDER);
}

/** 'Play.Example.net:25566' → 'play.example.net'; '' for nothing usable. */
function hostOf(address) {
  const host = String(address || '').trim().toLowerCase().split(':')[0].replace(/\.$/, '');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) ? host : '';
}

/** The domains worth a website look: the registrable one, then the host itself if it differs. */
function domainsOf(host) {
  const labels = host.split('.');
  const registrable = labels.slice(-2).join('.');
  return registrable === host ? [host] : [registrable, host];
}

const fileFor = (host, kind) => path.join(dir, `${host.replace(/[^a-z0-9.-]/g, '_')}.${kind}`);

/** What the disk says: { url } | { none: whenMs, reason } | null. */
async function cached(host) {
  try {
    const url = await fs.readFile(fileFor(host, 'icon'), 'utf8');
    if (DATA_URL.test(url)) return { url };
  } catch {
    /* no icon kept */
  }
  try {
    const marker = await fs.readFile(fileFor(host, 'none'), 'utf8');
    const stat = await fs.stat(fileFor(host, 'none'));
    return { none: stat.mtimeMs, reason: marker.trim() || 'none' };
  } catch {
    return null;
  }
}

async function keep(host, found) {
  try {
    await fs.mkdir(dir, { recursive: true });
    if (found.url) {
      await fs.writeFile(fileFor(host, 'icon'), found.url, 'utf8');
      await fs.rm(fileFor(host, 'none'), { force: true });
    } else {
      await fs.writeFile(fileFor(host, 'none'), found.reason || 'none', 'utf8');
    }
  } catch {
    /* A cache that cannot be written is a cache that is asked again. */
  }
}

/**
 * A picture out of a ping answer's `favicon`: the game's own field, a PNG as
 * a data URL. Some servers put line breaks in the base64; the game tolerates
 * that, so this does too. Anything else — an http URL, an SVG, a novel — is
 * not an icon.
 */
function fromFavicon(favicon) {
  if (typeof favicon !== 'string') return null;
  const url = favicon.replace(/\s+/g, '');
  return url.length <= ICON_MAX * 1.4 && DATA_URL.test(url) ? url : null;
}

/** Fetch with a deadline and a size ceiling; null on anything but success. */
async function fetchBytes(url, max, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept, 'user-agent': 'BlueClient (blueclient.net)' }
    });
    if (!response.ok || !response.body) return null;
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const length = Number(response.headers.get('content-length'));
    if (length > max) return null;
    const chunks = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), type, url: response.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The image type by its first bytes; the header is not always right and a data URL has to be. */
function sniff(bytes, type) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'x-icon';
  if (type === 'image/svg+xml' || /^\s*(<\?xml|<svg)/i.test(bytes.subarray(0, 256).toString('utf8'))) return 'svg+xml';
  return null;
}

/**
 * The icons a page names, best first: an apple-touch-icon (180px, drawn for
 * a tile) over a plain icon, a bigger declared size over a smaller, a PNG
 * over an ICO. Only the <head> matters and only <link> tags; a full HTML
 * parser is not worth its weight for six attributes.
 */
function iconLinks(html, base) {
  const out = [];
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attr = (name) => {
      const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
    };
    const rel = attr('rel').toLowerCase().split(/\s+/);
    const href = attr('href');
    if (!href) continue;
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!touch && !rel.includes('icon')) continue;
    const sizes = attr('sizes').toLowerCase();
    const size = sizes === 'any' ? 512 : Number((sizes.match(/(\d+)x\d+/) || [])[1]) || (touch ? 180 : 0);
    let url;
    try {
      url = new URL(href, base).href;
    } catch {
      continue;
    }
    if (!/^https?:/.test(url)) continue;
    const png = /\.png(\?|$)/i.test(url) || /png/i.test(attr('type'));
    out.push({ url, score: (touch ? 1000 : 0) + Math.min(size, 512) + (png ? 1 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).map((link) => link.url);
}

async function fromWebsite(host) {
  for (const domain of domainsOf(host)) {
    const page = await fetchBytes(`https://${domain}/`, PAGE_MAX, 'text/html');
    const candidates = [];
    let base = `https://${domain}/`;
    if (page && page.type.includes('html')) {
      base = page.url;
      candidates.push(...iconLinks(page.bytes.toString('utf8'), base));
    }
    try {
      candidates.push(new URL('/favicon.ico', base).href);
    } catch {
      /* an unusable base; the plain address below still gets its try */
    }
    candidates.push(`https://${domain}/favicon.ico`);
    for (const url of [...new Set(candidates)].slice(0, 4)) {
      const got = await fetchBytes(url, ICON_MAX, 'image/*');
      if (!got || !got.bytes.length) continue;
      const kind = sniff(got.bytes, got.type);
      if (!kind) continue;
      return `data:image/${kind};base64,${got.bytes.toString('base64')}`;
    }
  }
  return null;
}

/** Look the server up, both ways. { url } or { reason: 'none' | 'down' }. */
async function find(address, host) {
  const answer = await ping.status(address).catch(() => ({ ok: false }));
  const own = answer.ok ? fromFavicon(answer.favicon) : null;
  if (own) return { url: own };
  const web = await fromWebsite(host);
  if (web) return { url: web };
  return { reason: answer.ok ? 'none' : 'down' };
}

/**
 * The picture for this address: a data URL, or null. Answers from disk when
 * it can; otherwise asks the server, then its website, and keeps what it
 * finds. One lookup per host at a time, however many rows ask.
 */
function icon(address) {
  const host = hostOf(address);
  if (!host || !dir) return Promise.resolve(null);
  if (inflight.has(host)) return inflight.get(host);

  const work = (async () => {
    const known = await cached(host);
    if (known?.url) return known.url;
    if (known?.none) {
      const wait = known.reason === 'down' ? RETRY_DOWN_MS : RETRY_NONE_MS;
      if (Date.now() - known.none < wait) return null;
    }
    const found = await find(address, host);
    await keep(host, found);
    return found.url || null;
  })().catch(() => null).finally(() => inflight.delete(host));

  inflight.set(host, work);
  return work;
}

/**
 * A ping that came back with an icon, from wherever the ping was made — the
 * featured rows' minute-by-minute status check hands its favicons here so
 * those servers never need a lookup of their own. Only fills a gap: an icon
 * on disk is not rewritten on every ping.
 */
function remember(address, favicon) {
  const host = hostOf(address);
  const url = fromFavicon(favicon);
  if (!host || !dir || !url) return;
  cached(host).then((known) => {
    if (known?.url === url) return;
    return keep(host, { url });
  }).catch(() => {});
}

module.exports = { init, icon, remember, hostOf, iconLinks, sniff };
