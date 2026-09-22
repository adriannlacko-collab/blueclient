'use strict';

/**
 * Three skins of your own, and the one you are wearing.
 *
 * Changing a skin has always meant leaving the game: minecraft.net, upload,
 * wait, restart. Every client the audience has used puts it behind a button
 * instead, and keeps a few so switching back is one click rather than another
 * upload. Three is the number: enough for the skin you wear, the one you had
 * before it and one you are trying, and few enough that the row of them fits
 * beside the player without becoming a library to manage.
 *
 * The files are kept as the player's own PNGs under `skins/slots`, so a slot
 * survives being worn, taken off and worn again with no second download and
 * nothing lost if Mojang is unreachable. Wearing one is a real upload to the
 * player's own Minecraft account through Mojang's own endpoint — the same
 * request minecraft.net makes — so the skin is theirs everywhere, not a
 * picture this launcher draws over the model.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { USER_AGENT: UA } = require('./version');
const auth = require('./auth');
const skins = require('./skins');
const { offlineUuid } = require('./game/install');

/**
 * Where an offline account's skin goes (2026-09-21; Adrian: "make it so
 * cracked accounts can have skins"). A Microsoft account wears a skin by
 * uploading it to Mojang; an offline account has no Mojang profile, so the
 * launcher keeps its choice itself — the PNG under `skins/own/<uuid>.png`,
 * the uuid being the offline hash of the name, which is what an offline-mode
 * server names the player by — and puts a copy on BlueClient's skin index
 * under that uuid (the same Worker Browse skins searches, `PUT /own/<uuid>`),
 * where every other BlueClient game asks for it the way it asks the friends
 * backend who wears which cape. The game reads the player's own off the
 * file (`ownSkin` / `ownSkinModel` in the profile's blueclient.json, stamped
 * at launch) and needs no network to see itself; the index is for everyone
 * else. An upload that failed is `pending` and tried again at the next
 * launcher start and the next Wear.
 */
const INDEX = 'https://blueclient-skins.blueclient-relay.workers.dev';

const SLOTS = 3;
const TIMEOUT_MS = 15000;

/** Mojang's own limit, and the only two shapes a skin sheet comes in. */
const SHEET_WIDTH = 64;
const SHEET_HEIGHTS = [64, 32];
const MAX_BYTES = 24 * 1024;

let dir = null;
let ownDir = null;
let store = null;

function init(userData, settings) {
  dir = path.join(userData, 'skins', 'slots');
  ownDir = path.join(userData, 'skins', 'own');
  store = settings;
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(ownDir, { recursive: true });
}

const file = (index) => path.join(dir, `${index}.png`);
const ownFile = (uuid) => path.join(ownDir, `${uuid}.png`);

/** The stored metadata, always exactly three entries long. */
function meta() {
  const kept = store.get('skins')?.slots;
  const out = Array.isArray(kept) ? kept.slice(0, SLOTS) : [];
  while (out.length < SLOTS) out.push(null);
  return out;
}

function writeMeta(slots) {
  store.set('skins', { ...(store.get('skins') || {}), slots });
}

/**
 * Width, height and the PNG signature, straight out of the header.
 *
 * Mojang rejects anything that is not a skin sheet, and it does so with a
 * bare 400 — so the check happens here, where the answer can be a sentence
 * about what is wrong with the file the player just picked.
 */
function measure(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const asDataUri = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;

/**
 * Whether a sheet can go in a slot, and what is wrong with it if it cannot.
 *
 * The one definition of what this launcher accepts as a skin, so the file
 * picker and the browse grid (`skinfind.js`) can never disagree about it —
 * a card you can click has already passed the test the save will run.
 */
function check(bytes) {
  if (!bytes || bytes.length > MAX_BYTES) return { ok: false, reason: 'That file is too large for a skin.' };

  const size = measure(bytes);
  if (!size) return { ok: false, reason: 'That is not a PNG image.' };
  if (size.width !== SHEET_WIDTH || !SHEET_HEIGHTS.includes(size.height)) {
    return {
      ok: false,
      reason: `A skin is 64 by 64 pixels. That one is ${size.width} by ${size.height}.`
    };
  }
  return { ok: true, height: size.height };
}

/** Every slot, with its picture, for the renderer to draw. */
function list() {
  return meta().map((entry, index) => {
    if (!entry) return null;
    try {
      return { ...entry, index, dataUri: asDataUri(fs.readFileSync(file(index))) };
    } catch {
      // The file went missing under us; the slot is empty rather than broken.
      return null;
    }
  });
}

/**
 * Put a PNG the player picked into one slot.
 *
 * The variant is asked for rather than guessed: the two models differ by one
 * column of pixels in the arms and no reliable test tells them apart, so
 * guessing gets it wrong for every slim skin that fills its sheet.
 */
function put(index, sourcePath, variant, name) {
  if (!Number.isInteger(index) || index < 0 || index >= SLOTS) {
    return { ok: false, reason: 'That slot does not exist.' };
  }

  let bytes;
  try {
    bytes = fs.readFileSync(sourcePath);
  } catch {
    return { ok: false, reason: 'That file could not be read.' };
  }

  return putBytes(index, bytes, variant, name || path.basename(sourcePath, path.extname(sourcePath)));
}

/**
 * The same, for a sheet that never was a file on this PC — one browsed and
 * kept (`skinfind.js`). Everything after the read is identical, which is why
 * `put` is now four lines and this is the saver.
 */
function putBytes(index, bytes, variant, name) {
  if (!Number.isInteger(index) || index < 0 || index >= SLOTS) {
    return { ok: false, reason: 'That slot does not exist.' };
  }

  const fit = check(bytes);
  if (!fit.ok) return fit;

  try {
    fs.writeFileSync(file(index), bytes);
  } catch {
    return { ok: false, reason: 'The skin could not be saved.' };
  }

  const slots = meta();
  slots[index] = {
    name: name || 'Skin',
    variant: variant === 'slim' ? 'slim' : 'classic',
    height: fit.height,
    added: Date.now()
  };
  writeMeta(slots);
  return { ok: true, slots: list() };
}

/**
 * The two arm widths, corrected after the fact rather than asked for first.
 *
 * On the skin being worn, the correction is re-sent to Mojang with the other
 * arms — the variant is part of the upload, so the game and everyone else's
 * screen would keep the wrong arms until the next Wear (2026-09-10, night;
 * Adrian: "when selecting classic/slim arms in the skin selector, it doesn't
 * change in the skin on the play screen if the skin you changed the arms for
 * is selected"). The answer then carries `username`, as wear's does, so the
 * home screen's model is refreshed the same way.
 */
async function setVariant(index, variant) {
  const slots = meta();
  if (!slots[index]) return { ok: true, slots: list() };

  slots[index] = { ...slots[index], variant: variant === 'slim' ? 'slim' : 'classic' };
  writeMeta(slots);
  if (slots[index].worn) return wear(index);
  return { ok: true, slots: list() };
}

function clear(index) {
  const slots = meta();
  if (!slots[index]) return { ok: true, slots: list() };

  // The worn slot of an offline account taken out is its skin taken off:
  // the file, the record and the copy on the index go with it.
  const worn = slots[index].worn;
  slots[index] = null;
  writeMeta(slots);
  try { fs.unlinkSync(file(index)); } catch { /* already gone */ }
  if (worn) {
    const account = activeAccount();
    if (account && account.type !== 'microsoft') dropOwn(account).catch(() => {});
  }
  return { ok: true, slots: list() };
}

/* ------------------------------------------------------------ own skins */

/** The active account as the settings hold it, of either kind, or null. */
function activeAccount() {
  const accounts = store.get('accounts') || {};
  const kept = accounts.list || [];
  const index = kept.findIndex((a) => a.id === accounts.active);
  return index >= 0 ? kept[index] : kept[0] || null;
}

/** The record of every offline account's own skin, by lower-cased name. */
function ownMeta() {
  const kept = store.get('skins')?.own;
  return kept && typeof kept === 'object' && !Array.isArray(kept) ? { ...kept } : {};
}

function writeOwn(own) {
  store.set('skins', { ...(store.get('skins') || {}), own });
}

/**
 * An offline account's own skin, for the home screen's model and the launch:
 * the file, its arms and the uuid it is kept under — or null when the
 * account has none, or is not an offline one.
 */
function ownFor(username) {
  const name = String(username || '').trim().toLowerCase();
  if (!name) return null;
  const entry = ownMeta()[name];
  if (!entry || !entry.uuid) return null;
  const png = ownFile(entry.uuid);
  if (!fs.existsSync(png)) return null;
  return { file: png, variant: entry.variant === 'slim' ? 'slim' : 'classic', uuid: entry.uuid, hash: entry.hash || '' };
}

/** Wear a slot as an offline account: the file kept as the account's own, and offered to the index. */
async function wearOwn(index, entry, account) {
  let bytes;
  try {
    bytes = fs.readFileSync(file(index));
  } catch {
    return { ok: false, reason: 'That skin has gone missing.' };
  }
  const uuid = offlineUuid(account.username);
  try {
    fs.writeFileSync(ownFile(uuid), bytes);
  } catch {
    return { ok: false, reason: 'The skin could not be saved.' };
  }
  const own = ownMeta();
  own[account.username.toLowerCase()] = {
    uuid,
    variant: entry.variant === 'slim' ? 'slim' : 'classic',
    hash: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32),
    at: Date.now(),
    pending: true
  };
  writeOwn(own);
  const slots = meta();
  writeMeta(slots.map((slot, i) => (slot ? { ...slot, worn: i === index } : null)));

  const shared = await putOwn(uuid, bytes, entry.variant);
  if (shared) {
    const now = ownMeta();
    if (now[account.username.toLowerCase()]) {
      now[account.username.toLowerCase()].pending = false;
      writeOwn(now);
    }
  }
  return { ok: true, username: account.username, slots: list(), own: true, shared };
}

/** PUT the PNG on the index; true when it took it. Never throws. */
async function putOwn(uuid, bytes, variant) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${INDEX}/own/${uuid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', 'X-Variant': variant === 'slim' ? 'slim' : 'classic', 'User-Agent': UA },
      body: bytes,
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The account's own skin taken off: the file, the record, and the index's copy. */
async function dropOwn(account) {
  const own = ownMeta();
  const entry = own[account.username.toLowerCase()];
  if (!entry) return;
  delete own[account.username.toLowerCase()];
  writeOwn(own);
  try { fs.unlinkSync(ownFile(entry.uuid)); } catch { /* already gone */ }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(`${INDEX}/own/${entry.uuid}`, { method: 'DELETE', headers: { 'User-Agent': UA }, signal: controller.signal });
  } catch {
    // The index keeps a skin nobody wears; the next Wear replaces it.
  } finally {
    clearTimeout(timer);
  }
}

/** Every own skin the index has not taken yet, offered again — at the launcher's start. Never throws. */
async function syncOwn() {
  const own = ownMeta();
  let changed = false;
  for (const [name, entry] of Object.entries(own)) {
    if (!entry || !entry.pending || !entry.uuid) continue;
    let bytes;
    try {
      bytes = fs.readFileSync(ownFile(entry.uuid));
    } catch {
      continue;
    }
    if (await putOwn(entry.uuid, bytes, entry.variant)) {
      own[name] = { ...entry, pending: false };
      changed = true;
    }
  }
  if (changed) writeOwn(own);
}

/**
 * The signed-in account, with a token good enough to speak to Mojang with.
 *
 * The same renewal the launch does, for the same reason: a token lasts a day
 * and the launcher is usually opened on the next one.
 */
async function currentAccount() {
  const accounts = store.get('accounts') || {};
  const kept = accounts.list || [];
  const index = kept.findIndex((a) => a.id === accounts.active);
  const account = index >= 0 ? kept[index] : kept[0];
  if (!account?.accessToken) return null;

  if (!auth.stale(account)) return account;

  const clientId = auth.appId(store.get('auth.clientId'));
  if (!clientId) return account;

  try {
    const renewed = { ...account, ...await auth.refresh({ clientId, account }) };
    kept[kept.indexOf(account)] = renewed;
    store.set('accounts', { ...accounts, list: kept });
    return renewed;
  } catch {
    return account;
  }
}

/**
 * Wear one slot: upload it to the player's own Minecraft account.
 *
 * Mojang answers with the updated profile, which is what the skin cache is
 * keyed on, so the model on the home screen changes as soon as this returns
 * rather than at the next launch.
 */
async function wear(index) {
  const entry = meta()[index];
  if (!entry) return { ok: false, reason: 'That slot is empty.' };

  // An offline account wears it the launcher's way (2026-09-21, above);
  // a Microsoft one through Mojang, as always.
  const active = activeAccount();
  if (!active) return { ok: false, reason: 'Add an account first.' };
  if (active.type !== 'microsoft') return wearOwn(index, entry, active);

  const account = await currentAccount();
  if (!account) {
    return { ok: false, reason: 'Your sign-in has expired. Sign in again and try once more.' };
  }

  let bytes;
  try {
    bytes = fs.readFileSync(file(index));
  } catch {
    return { ok: false, reason: 'That skin has gone missing.' };
  }

  const body = new FormData();
  body.append('variant', entry.variant);
  body.append('file', new Blob([bytes], { type: 'image/png' }), 'skin.png');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.accessToken}`, 'User-Agent': UA },
      body,
      signal: controller.signal
    });

    if (response.status === 401) {
      return { ok: false, reason: 'Your sign-in has expired. Sign in again and try once more.' };
    }
    if (!response.ok) {
      return { ok: false, reason: 'Mojang refused the skin. Try again in a moment.' };
    }

    const slots = meta();
    writeMeta(slots.map((slot, i) => (slot ? { ...slot, worn: i === index } : null)));

    /* The answer is the profile as it now is: the new texture's url and its
       model. That goes into the skin cache as the name's entry, with these
       bytes kept under the texture's hash, so the next Home reads it off the
       disk instead of asking Mojang and drawing Steve until it answers
       (2026-09-21). An answer that cannot be read leaves the old way: the
       name forgotten (main.js), the next ask a lookup. */
    let remembered = false;
    try {
      const profile = await response.json();
      const active = profile?.skins?.find((skin) => skin?.state === 'ACTIVE') || profile?.skins?.[0];
      const hash = active?.url ? String(active.url).split('/').pop() : '';
      if (profile?.id && hash) {
        skins.keepTexture(hash, bytes);
        remembered = skins.remember(account.username, {
          uuid: profile.id,
          hash,
          slim: String(active.variant || entry.variant).toLowerCase() === 'slim'
        });
      }
    } catch { /* the upload took; only the cache's shortcut is lost */ }
    return { ok: true, username: account.username, remembered, slots: list() };
  } catch {
    return { ok: false, reason: 'Could not reach Mojang. Check your connection.' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { init, list, put, putBytes, check, setVariant, clear, wear, ownFor, syncOwn, SLOTS };
