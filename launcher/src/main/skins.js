'use strict';

/**
 * Player skins, from Mojang.
 *
 * Username -> UUID -> session profile -> texture URL -> PNG. All three are
 * public read-only Mojang endpoints, the same chain every launcher and skin
 * viewer uses. The renderer runs under `img-src 'self' data:` so the PNG comes
 * back as a data URI rather than a URL it could not load anyway.
 *
 * Textures are content-addressed, so once a hash is on disk it never needs
 * refetching and the launcher renders the right skin offline.
 */

const fs = require('fs');
const path = require('path');

const { USER_AGENT: UA } = require('./version');

const TIMEOUT_MS = 8000;
const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;

/** The classic Steve sheet the launcher ships; see fallback(). */
const BUNDLED_STEVE = path.join(__dirname, '..', 'renderer', 'assets', 'art', 'steve.png');

let cacheDir = null;
let index = {};          // username -> { uuid, hash, slim, ts }

function init(dir) {
  cacheDir = path.join(dir, 'skins');
  fs.mkdirSync(cacheDir, { recursive: true });
  try {
    index = JSON.parse(fs.readFileSync(path.join(cacheDir, 'index.json'), 'utf8'));
  } catch {
    index = {};
  }
}

/**
 * Beside the file and renamed over it (2026-09-22), the way store.js writes
 * the settings: an index cut short by a closed launcher read as no index,
 * and every name it held — the skin just worn among them (`remember`) — was
 * asked of Mojang all over again, and drawn as Steve offline.
 */
function saveIndex() {
  const file = path.join(cacheDir, 'index.json');
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    /* cache is best-effort */
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to tidy */ }
  }
}

async function get(url, json = true) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) return null;
    return json ? await res.json() : Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** username -> { uuid, hash, slim } straight from Mojang. */
async function resolve(username) {
  const profile = await get(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`);
  if (!profile?.id) return null;

  const session = await get(`https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}`);
  const property = session?.properties?.find((p) => p.name === 'textures');
  if (!property) return null;

  let textures;
  try {
    textures = JSON.parse(Buffer.from(property.value, 'base64').toString('utf8'));
  } catch {
    return null;
  }

  const skin = textures?.textures?.SKIN;
  if (!skin?.url) return null;

  return {
    uuid: profile.id,
    // The URL is content-addressed; the last segment is the texture hash.
    hash: skin.url.split('/').pop(),
    // Mojang reports "slim" for its own MHF_* heads even though the texture is
    // the classic model, so the stock skin is pinned to classic below.
    slim: skin.metadata?.model === 'slim'
  };
}

/** Fetch a texture by hash, or read it back off disk. */
async function texture(hash) {
  if (!/^[0-9a-f]{16,128}$/i.test(String(hash || ''))) return null;

  const file = path.join(cacheDir, `${hash}.png`);
  try {
    return fs.readFileSync(file);
  } catch { /* not cached yet */ }

  const bytes = await get(`https://textures.minecraft.net/texture/${hash}`, false);
  if (!bytes) return null;

  try { fs.writeFileSync(file, bytes); } catch { /* cache is best-effort */ }
  return bytes;
}

/**
 * Put a sheet somebody else already fetched into the cache under its hash.
 *
 * Browsing skins (`skinfind.js`) gets the PNG itself back with each search
 * result, and every one of those is a sheet this cache would otherwise fetch
 * again the moment the player kept it. Content-addressed, so writing one is
 * only ever writing the file that hash already means.
 */
/** The sheet if it is already on disk under this hash, else null; nothing is fetched. */
function cached(hash) {
  if (!cacheDir || !/^[0-9a-f]{16,128}$/i.test(String(hash || ''))) return null;
  try { return fs.readFileSync(path.join(cacheDir, `${hash}.png`)); } catch { return null; }
}

function keepTexture(hash, bytes) {
  if (!cacheDir || !bytes?.length) return;
  if (!/^[0-9a-f]{16,128}$/i.test(String(hash || ''))) return;
  const file = path.join(cacheDir, `${hash}.png`);
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  } catch { /* cache is best-effort */ }
}

const asDataUri = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;

/**
 * Height straight out of the PNG header. Pre-1.8 skins are 64x32 and have no
 * second layer below the hat, so the renderer needs to know which it has.
 */
function pngHeight(bytes) {
  // 8-byte signature, 4 length, 4 type, then width and height.
  return bytes.length > 24 ? bytes.readUInt32BE(20) : 64;
}

/**
 * Drop what is remembered about one name.
 *
 * Called after the player changes their own skin: the profile lookup is
 * cached for six hours, so without this the launcher would go on drawing the
 * skin they just took off.
 */
function forget(username) {
  delete index[String(username || '').trim()];
  saveIndex();
}

/**
 * What a name wears from now on, written into the index (2026-09-21).
 *
 * Mojang answers a skin upload with the profile as it now is — the new
 * texture's url, its model — which is everything the index keeps, so a
 * Wear no longer forgets the name and asks again: that ask was a round trip
 * to Mojang on the next Home, drawn as Steve while it took, and Mojang holds
 * a profile for a minute, so it could even answer with the skin just taken
 * off. Returns true when the entry was taken.
 */
function remember(username, { uuid, hash, slim } = {}) {
  const name = String(username || '').trim();
  if (!name || !uuid || !/^[0-9a-f]{16,128}$/i.test(String(hash || ''))) return false;
  index[name] = { uuid, hash, slim: Boolean(slim), ts: Date.now() };
  saveIndex();
  return true;
}

/**
 * @param {string} username
 * @returns {Promise<{ok: boolean, dataUri?: string, slim?: boolean, source?: string}>}
 */
/** Who answers for an offline account's own skin (skinslots.ownFor), set by main. */
let ownSource = () => null;
function ownSkins(lookup) {
  ownSource = typeof lookup === 'function' ? lookup : () => null;
}

async function skinFor(username) {
  const name = String(username || '').trim();

  // An offline account wearing a skin of the launcher's own (2026-09-21):
  // its file, before any lookup by name — a name Mojang also knows would
  // otherwise dress the model as that player.
  const own = name ? ownSource(name) : null;
  if (own) {
    try {
      const bytes = fs.readFileSync(own.file);
      return { ok: true, dataUri: asDataUri(bytes), slim: own.variant === 'slim', height: pngHeight(bytes), source: 'own' };
    } catch {
      // The file went; the account is looked up like any other.
    }
  }
  const cached = name ? index[name] : null;
  const fresh = cached && Date.now() - cached.ts < PROFILE_TTL_MS;

  if (name && !fresh) {
    const resolved = await resolve(name);
    // A miss is remembered too. Most accounts here are offline-only names
    // Mojang has never heard of; without a negative entry every render of the
    // home screen re-asked twice with an 8-second timeout each.
    index[name] = resolved ? { ...resolved, ts: Date.now() } : { miss: true, ts: Date.now() };
    saveIndex();
  }

  const entry = index[name];
  if (entry && !entry.miss) {
    const bytes = await texture(entry.hash);
    if (bytes) {
      return {
        ok: true,
        dataUri: asDataUri(bytes),
        slim: entry.slim,
        height: pngHeight(bytes),
        source: 'account'
      };
    }
  }

  return fallback();
}

/**
 * The stock Steve: the classic-arm sheet the launcher ships, read off disk.
 *
 * It used to be fetched from Mojang's MHF_Steve account and pinned to the
 * classic model. Mojang has since redrawn that account's texture on the slim
 * layout — three-pixel arms — so drawing it on the wide model put the back of
 * each sleeve a column off (Adrian, 2026-09-09: "if steve is the selected
 * skin, it looks like this glitchy on the backside"). The bundled sheet is the
 * one the world behind Home already wears, it is classic by construction, and
 * it needs no network at all.
 */
function fallback() {
  try {
    const bytes = fs.readFileSync(BUNDLED_STEVE);
    return { ok: true, dataUri: asDataUri(bytes), slim: false, height: pngHeight(bytes), source: 'default' };
  } catch {
    return { ok: false };
  }
}

module.exports = { init, skinFor, forget, remember, resolve, texture, cached, keepTexture, pngHeight, asDataUri, ownSkins };
