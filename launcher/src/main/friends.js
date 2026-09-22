'use strict';

/**
 * The friends list, read by the launcher (2026-09-21, the Friends card on
 * Home: "Build C").
 *
 * Until this day only the game spoke to the friends backend, and it proved
 * who it was with two Mojang-signed documents it already held — the profile
 * key certificate and the signed textures property — because every Mojang
 * host refuses a Cloudflare Worker and the site can never look a player up
 * itself (blueclient-admin/lib/friends.js says the whole of it). The
 * launcher holds the same Minecraft token the game is started with, and
 * Mojang answers this PC, so it can fetch the very same two documents and
 * sign in the very same way: a nonce from the site, the certificate from
 * api.minecraftservices.com, the signed profile from the session server, the
 * nonce signed with the certificate's private key. Nothing new was added to
 * the backend for this; the site cannot tell a launcher from a game.
 *
 * What it is used for is one GET: the list the Friends screen in the game
 * shows — who is a friend, who is online, and where — and, since the same
 * evening, one POST: asking someone to be friends by name, the way the
 * game's Add friend does (Adrian: "make a 'add friends' button for the
 * friends card"). Answering and messaging stay in the game, where they
 * were; the card on Home reads, starts the game on a friend's server, and
 * sends a request.
 *
 * <h2>The token is kept in memory and never written</h2>
 * The same rule as the game's (ui/Friends.java): a bearer good for two days,
 * held here for the launcher's life, asked for again when the site says it
 * has run out. Nothing about Friends touches settings.json.
 *
 * <h2>Signing in must not make the player look online</h2>
 * The site stamps a fresh sign-in "menu, seen now", which is right for a
 * game — it is at the title screen — and wrong for a launcher, whose player
 * may be at dinner. So when no BlueClient game is running on this PC — this
 * launcher's own, or one it was closed and reopened under — the sign-in is
 * followed at once by a heartbeat that says `offline`, the same beat the
 * game sends as it closes; a running game keeps beating on its own and is
 * left alone. A friend's list therefore never shows "Online" for
 * somebody who only opened the launcher.
 *
 * <h2>An offline account has nothing to prove</h2>
 * No certificate, no signed profile — the card says "sign in with a
 * Microsoft account", as the game's screen does, and nothing is asked.
 */

const crypto = require('crypto');
const { execFile } = require('child_process');
const auth = require('./auth');
const { USER_AGENT } = require('./version');

/** The same two doors the game knocks on, in the same order (ui/Friends.java). */
const BASES = [
  'https://api.blueclient.net/api/friends',
  'https://blueclient-admin.pages.dev/api/friends'
];

const CERTIFICATES = 'https://api.minecraftservices.com/player/certificates';
const PROFILE = 'https://sessionserver.mojang.com/session/minecraft/profile/';

const CALL_MS = 12_000;
/** A list answered this recently is handed back again: Home asks on every visit and once a minute. */
const FRESH_MS = 20_000;
/** A failed ask is not repeated sooner than this: a sign-in costs Mojang two calls, and the session server answers a profile once a minute. */
const RETRY_MS = 60_000;

let store = null;
let launcher = null;

/* One signed-in token per account, for the launcher's life. */
const tokens = new Map();     // uuid -> { token, until }
/* The last list per account, for FRESH_MS. */
const lists = new Map();      // uuid -> { at, answer }
/* One sign-in or list at a time per account; a second ask joins the first. */
const inFlight = new Map();   // uuid -> Promise

function init(options) {
  store = options.store;
  launcher = options.launcher;
}

/* ------------------------------------------------------------- account */

/** The active account, its token renewed under the launcher's own lane if it had aged out. */
async function activeAccount() {
  if (launcher && typeof launcher._renew === 'function') {
    try { await launcher._renew(0); } catch { /* the launch decides what a failed renewal means; here it only means "try with what there is" */ }
  }
  const accounts = store?.get('accounts') || {};
  const list = accounts.list || [];
  return list.find((a) => a.id === accounts.active) || list[0] || null;
}

/**
 * True when a BlueClient game is up on this PC, which is then the one
 * keeping the presence. This launcher's own sessions first; then any
 * `javaw.exe` whose command line names BlueClient — a game the launcher
 * was closed and reopened under (Keep open is the default, and a game
 * outlives its launcher), which `launcher.list()` cannot see. Asked once
 * per sign-in, never on a render path; a PowerShell that fails or takes too
 * long answers false, and the worst that does is the three-minute beat.
 */
async function playing(account) {
  const name = String(account.username || '').toLowerCase();
  try {
    /* A game still starting counts: it signs in itself within the minute,
       and an offline beat landing after its login would undo that. */
    if (launcher?.list().some((session) => String(session.username || '').toLowerCase() === name)) return true;
  } catch { /* no register */ }
  if (process.platform !== 'win32') return false;
  return new Promise((resolve) => {
    const script = "Get-CimInstance Win32_Process -Filter \"name='javaw.exe'\" | ForEach-Object { $_.CommandLine }";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 5000, windowsHide: true }, (error, stdout) => {
        resolve(!error && /blueclient/i.test(String(stdout || '')));
      });
  });
}

/* --------------------------------------------------------------- calls */

async function call(method, path, { body = null, token = null } = {}) {
  let last = null;
  for (const base of BASES) {
    try {
      const response = await fetch(base + path, {
        method,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(CALL_MS)
      });
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* a page, not an answer */ }
      /* An answer of any kind is this door's; only a door that cannot be
         reached at all sends us to the next (the site's "fallback address"
         in the game reads the same way). */
      return { status: response.status, json };
    } catch (error) {
      last = error;
    }
  }
  return { status: 0, json: null, error: last };
}

async function mojang(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(CALL_MS) });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* reported by the caller */ }
  return { ok: response.ok, status: response.status, json };
}

/* ------------------------------------------------------------- sign in */

/** A PEM's body as bytes, whatever its header calls itself — Mojang's say RSA and carry SPKI/PKCS#8. */
function pemBody(pem) {
  return Buffer.from(String(pem || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
}

/**
 * The proof, built exactly as the game builds it (ui/Friends.java, login):
 * the certificate from Mojang for this token, the signed textures off the
 * session server, a nonce from the site signed with the certificate's key.
 *
 * @returns {Promise<{ token: string, name: string } | { error: string }>}
 */
async function signIn(account) {
  const uuid = String(account.uuid || '').toLowerCase();
  const raw = uuid.replace(/-/g, '');

  let certificate;
  try {
    certificate = await mojang(CERTIFICATES, {
      method: 'POST',
      headers: { authorization: `Bearer ${account.accessToken}`, 'content-length': '0', accept: 'application/json' }
    });
  } catch (error) {
    return { error: 'unreachable', detail: String(error) };
  }
  const pair = certificate.json?.keyPair;
  if (!certificate.ok || !pair?.publicKey || !pair?.privateKey || !certificate.json?.publicKeySignatureV2) {
    /* 401 is a token Mojang no longer honours; the next launch renews it. */
    return { error: certificate.status === 401 ? 'not-signed-in' : 'unreachable' };
  }

  let profile;
  try {
    profile = await mojang(`${PROFILE}${raw}?unsigned=false`, { headers: { accept: 'application/json' } });
  } catch (error) {
    return { error: 'unreachable', detail: String(error) };
  }
  const textures = (profile.json?.properties || []).find((p) => p?.name === 'textures' && p.signature);
  if (!profile.ok || !textures) return { error: 'not-signed-in' };

  const handshake = await call('GET', '/login');
  const nonce = handshake.json?.nonce;
  if (handshake.status !== 200 || typeof nonce !== 'string' || !nonce) return { error: 'unreachable' };

  let signature;
  try {
    const key = crypto.createPrivateKey({ key: pemBody(pair.privateKey), format: 'der', type: 'pkcs8' });
    signature = crypto.sign('sha256', Buffer.from(nonce, 'utf8'), key).toString('base64');
  } catch (error) {
    return { error: 'not-signed-in', detail: String(error) };
  }

  const proof = {
    nonce,
    uuid,
    expiresAt: Date.parse(certificate.json.expiresAt),
    publicKey: pemBody(pair.publicKey).toString('base64'),
    keySignature: certificate.json.publicKeySignatureV2,
    signature,
    textures: { value: textures.value, signature: textures.signature },
    mc: 'launcher'
  };
  const answer = await call('POST', '/login', { body: proof });
  if (answer.status === 200 && typeof answer.json?.token === 'string') {
    return { token: answer.json.token, name: String(answer.json.name || account.username || '') };
  }
  return { error: answer.status === 401 ? 'not-signed-in' : 'unreachable' };
}

/** A token for this account — the one in hand, or a fresh sign-in. */
async function tokenFor(account) {
  const uuid = String(account.uuid || '').toLowerCase();
  const held = tokens.get(uuid);
  if (held && held.until > Date.now()) return { token: held.token };

  const signed = await signIn(account);
  if (signed.error) return signed;
  /* Two days on the site; asked for again a little before that. */
  tokens.set(uuid, { token: signed.token, until: Date.now() + 40 * 3600 * 1000 });

  /* The sign-in stamped this player "at the menu, seen now". Only a game
     may say that; when none is up on this PC, take it back at once — in the
     background, since the question costs a PowerShell (two seconds) and the
     list need not wait for it. */
  playing(account).then((up) => {
    if (!up) call('POST', '/heartbeat', { body: { state: 'offline' }, token: signed.token }).catch(() => {});
  }).catch(() => {});
  return { token: signed.token };
}

/* ---------------------------------------------------------------- list */

/**
 * The list, as the site answers it — `me`, `friends`, `incoming`,
 * `outgoing`, `now` — or `{ ok: false, reason }`:
 *   'offline-account'  the active account cannot sign in to Friends
 *   'not-signed-in'    a Microsoft account whose proof the site or Mojang refused
 *   'unreachable'      nobody could be reached
 *   'no-account'       nothing is signed in at all
 */
async function list() {
  const account = await activeAccount();
  if (!account) return { ok: false, reason: 'no-account' };
  if (account.type !== 'microsoft' || !account.accessToken) return { ok: false, reason: 'offline-account' };
  const uuid = String(account.uuid || '').toLowerCase();

  const fresh = lists.get(uuid);
  if (fresh && Date.now() - fresh.at < (fresh.answer.ok ? FRESH_MS : RETRY_MS)) return fresh.answer;
  if (inFlight.has(uuid)) return inFlight.get(uuid);

  const failed = (reason) => {
    const answer = { ok: false, reason };
    lists.set(uuid, { at: Date.now(), answer });
    return answer;
  };
  const work = (async () => {
    const got = await tokenFor(account);
    if (got.error) return failed(got.error);

    let answer = await call('GET', '', { token: got.token });
    if (answer.status === 401) {
      /* Run out on the site's side: sign in once more and ask again. */
      tokens.delete(uuid);
      const again = await tokenFor(account);
      if (again.error) return failed(again.error);
      answer = await call('GET', '', { token: again.token });
    }
    if (answer.status !== 200 || !answer.json?.ok) return failed('unreachable');

    const shaped = {
      ok: true,
      now: Number(answer.json.now) || Date.now(),
      me: answer.json.me || { uuid, name: account.username },
      friends: Array.isArray(answer.json.friends) ? answer.json.friends.map(friend) : [],
      incoming: Array.isArray(answer.json.incoming) ? answer.json.incoming.length : 0,
      outgoing: Array.isArray(answer.json.outgoing) ? answer.json.outgoing.length : 0
    };
    lists.set(uuid, { at: Date.now(), answer: shaped });
    return shaped;
  })().finally(() => inFlight.delete(uuid));
  inFlight.set(uuid, work);
  return work;
}

/** One friend, only the fields the card draws, each of a known shape. */
function friend(row) {
  return {
    uuid: String(row.uuid || ''),
    name: String(row.name || ''),
    online: row.online === true,
    state: String(row.state || 'offline'),
    detail: String(row.detail || ''),
    mc: String(row.mc || ''),
    open: row.open === true,
    lastSeen: Number(row.lastSeen) || 0
  };
}

/** Forget the last answer, so the next ask goes to the site — the account was switched. */
function forget() {
  lists.clear();
}

/* ----------------------------------------------------------------- add */

const MOJANG_NAME = 'https://api.mojang.com/users/profiles/minecraft/';
const NAME = /^[A-Za-z0-9_]{3,16}$/;

/** Mojang's 32 hex characters as the dashed form the site wants, or null. */
function dashed(id) {
  const raw = String(id || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(raw)) return null;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

/**
 * Ask someone to be friends, by Minecraft name — the game's own add
 * (ui/Friends.java, add): Mojang turns the name into a uuid from this PC
 * (the site cannot ask Mojang), then POST /request with the site's token.
 *
 * Answers the site's own — { ok: true, status: 'sent' | 'friends' |
 * 'already', name, known } (known false: they have never opened
 * BlueClient, so nothing of theirs will show the request) — or
 * { ok: false, reason, line }, the line being what the game's screen says.
 * A friendship made here drops the remembered list, so the card's next ask
 * sees it.
 */
async function add(name) {
  const typed = String(name || '').trim();
  if (!NAME.test(typed)) return { ok: false, reason: 'bad-name', line: 'A Minecraft name is 3 to 16 letters, numbers or _' };

  const account = await activeAccount();
  if (!account) return { ok: false, reason: 'no-account', line: 'Add an account to use Friends' };
  if (account.type !== 'microsoft' || !account.accessToken) {
    return { ok: false, reason: 'offline-account', line: 'Sign in with a Microsoft account to use Friends' };
  }
  const uuid = String(account.uuid || '').toLowerCase();

  let looked;
  try {
    looked = await mojang(MOJANG_NAME + encodeURIComponent(typed), { headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
  } catch {
    return { ok: false, reason: 'mojang', line: 'Mojang is not answering right now, try again in a moment' };
  }
  if (looked.status === 204 || looked.status === 404) return { ok: false, reason: 'unknown', line: 'No Minecraft player has that name' };
  const them = looked.ok ? dashed(looked.json?.id) : null;
  if (!them) return { ok: false, reason: 'mojang', line: 'Mojang is not answering right now, try again in a moment' };
  const theirName = String(looked.json?.name || typed);

  const got = await tokenFor(account);
  if (got.error) return { ok: false, reason: got.error, line: got.error === 'not-signed-in' ? 'Sign in with a Microsoft account to use Friends' : "Can't reach BlueClient right now" };

  let answer = await call('POST', '/request', { body: { uuid: them, name: theirName }, token: got.token });
  if (answer.status === 401) {
    tokens.delete(uuid);
    const again = await tokenFor(account);
    if (again.error) return { ok: false, reason: again.error, line: "Can't reach BlueClient right now" };
    answer = await call('POST', '/request', { body: { uuid: them, name: theirName }, token: again.token });
  }
  if (answer.status === 200 && answer.json?.ok) {
    lists.delete(uuid);
    return {
      ok: true,
      status: String(answer.json.status || 'sent'),
      name: String(answer.json.name || theirName),
      known: answer.json.known !== false
    };
  }
  /* The site's refusals are lines written to be shown as they are. */
  const line = answer.status === 0 ? "Can't reach BlueClient right now"
    : answer.status === 401 ? 'Sign in with a Microsoft account to use Friends'
    : String(answer.json?.error || `Something went wrong (${answer.status})`);
  return { ok: false, reason: answer.status === 0 ? 'unreachable' : 'refused', line };
}

/**
 * The invitation the game copies for a friend who has not got BlueClient
 * yet (ui/Friends.java, copyInvite) — the same words, with this account's
 * name in them.
 */
async function inviteText() {
  const account = await activeAccount();
  const me = String(account?.username || '').trim() || 'me';
  return `Get BlueClient at blueclient.net, then add ${me} under Friends`;
}

module.exports = { init, list, forget, add, inviteText };
