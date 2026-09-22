'use strict';

const crypto = require('node:crypto');
const { BrowserWindow, safeStorage } = require('electron');

/**
 * Signing in with a Microsoft account.
 *
 * Playing online is not one login but a chain of four, and every link has to
 * succeed before the game will accept the result:
 *
 *   Microsoft  ->  Xbox Live  ->  XSTS  ->  Minecraft
 *
 * Microsoft proves who the person is. Xbox Live turns that into a gamer
 * identity. XSTS authorises that identity against Minecraft specifically, and
 * is the step that refuses child accounts and regions where Xbox Live does not
 * operate. Only then does Minecraft hand back the token the game launches with.
 *
 * Each step's failure means something different to the player, which is why
 * they are reported separately rather than as one "login failed".
 *
 * The browser window belongs to Microsoft, not to us: the password is typed
 * into their page and this process never sees it. What comes back is a
 * short-lived code, exchanged here for tokens.
 */

/* Personal accounts live in the "consumers" tenant. Using "common" would also
   offer work and school accounts, which can never own Minecraft. */
const MSA_AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const MSA_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const XBL_AUTHENTICATE = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTHORIZE = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';

/* offline_access is what earns a refresh token; without it the player would be
   sent back to the browser every single launch. */
const SCOPE = 'XboxLive.signin offline_access';
const REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';

/**
 * The Azure application BlueClient signs in as.
 *
 * Registered once by whoever ships the launcher, not by the player: Microsoft
 * issues this to the app, and every copy of the app presents the same one. It
 * is public by nature — it travels in the query string of the sign-in page the
 * player can read in their own browser — and it is not a secret or a password.
 * What it cannot do on its own is prove anything: that is PKCE's job below.
 *
 * Its registration must match what this file asks for, or Microsoft refuses
 * before the player has typed anything: personal accounts only (the consumers
 * endpoint above), the redirect URI above listed under mobile and desktop, and
 * public client flows allowed, since a desktop app has no secret to offer.
 */
const CLIENT_ID = '0f56744d-4f29-4605-a49b-6d78ece02200';

/**
 * The application to sign in as: the shipped one unless a setting overrides it.
 *
 * The override exists because someone running their own build may have their
 * own registration, and because the id in a released launcher can be revoked
 * or replaced upstream — a field beats a reinstall. Blank means "use ours",
 * which is also what every settings file written before this id existed says.
 */
function appId(override) {
  return String(override || '').trim() || CLIENT_ID;
}

/** Minecraft tokens last a day. Refresh well before that rather than on error. */
const TOKEN_LIFETIME_MS = 20 * 60 * 60 * 1000;

class AuthError extends Error {
  /**
   * `message` is what the player is shown and stays short. `detail` is for the
   * log only: the status and answer the server actually gave, which is the
   * difference between a refusal we can fix and one only Mojang can.
   */
  constructor(message, code, detail) {
    super(message);
    this.name = 'AuthError';
    this.code = code || 'auth_failed';
    this.detail = detail || '';
  }
}

/** What a link answered, trimmed to something a log line can carry. */
function said(result) {
  const body = (result.text || '').replace(/\s+/g, ' ').trim();
  return `HTTP ${result.status}${body ? ` ${body.slice(0, 300)}` : ''}`;
}

/* --------------------------------------------------------------- helpers */

/**
 * Proof Key for Code Exchange.
 *
 * A desktop app cannot keep a client secret — anyone can read it out of the
 * files. PKCE replaces the secret with a one-time value proved at the end of
 * the exchange, so a stolen authorisation code is worthless on its own.
 */
function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * How long any one link in the chain may take before the sheet gives up
 * (2026-09-16). Every call below carries it: without a deadline a connection
 * that stalls after the handshake — a captive portal, a firewall that drops
 * rather than refuses — left the Add-account sheet waiting for ever, with no
 * error for the player to act on. Fifteen seconds is longer than any of these
 * services takes on a bad day and shorter than anyone waits on a sheet.
 */
const CALL_MS = 15_000;

async function postJson(url, body, headers) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_MS)
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* reported below */ }
  return { ok: response.ok, status: response.status, json, text };
}

async function postForm(url, fields) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(CALL_MS)
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* reported below */ }
  return { ok: response.ok, status: response.status, json, text };
}

/** Anything that stops the chain reaching Microsoft at all reads the same way. */
function offline(error) {
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(String(error));
}

/** The deadline above ran out: `AbortSignal.timeout` rejects with a TimeoutError. */
function timedOut(error) {
  return error?.name === 'TimeoutError' || /TimeoutError|operation was aborted/i.test(String(error));
}

/** The one sentence for a chain that broke for a reason that is not the account's. */
function plainFailure(error, fallback) {
  if (timedOut(error)) return new AuthError('Microsoft did not answer in time. Try again.', 'timeout');
  if (offline(error)) return new AuthError('No connection to Microsoft.', 'offline');
  return new AuthError(fallback, 'auth_failed');
}

/* ------------------------------------------------------------ the window */

/**
 * Show Microsoft's own sign-in page and wait for the code it redirects with.
 *
 * The window is closed the moment the redirect is seen, so the player never
 * watches a blank Microsoft page load after they are already done.
 */
function askMicrosoft(parent, clientId, challenge) {
  return new Promise((resolve, reject) => {
    const url = `${MSA_AUTHORIZE}?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // Always show the account chooser: a launcher is exactly the place
      // someone switches between their own and a sibling's account.
      prompt: 'select_account'
    })}`;

    const win = new BrowserWindow({
      parent: parent || undefined,
      modal: Boolean(parent),
      width: 520,
      height: 720,
      autoHideMenuBar: true,
      title: 'Sign in to Microsoft',
      webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:msa' }
    });

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      // Destroy rather than close: close can be vetoed by the page.
      if (!win.isDestroyed()) win.destroy();
      fn(value);
    };

    const inspect = (target) => {
      if (!target || !target.startsWith(REDIRECT)) return;
      const params = new URL(target).searchParams;
      const code = params.get('code');
      const error = params.get('error');

      if (code) return finish(resolve, code);
      if (error === 'access_denied') {
        return finish(reject, new AuthError('Sign-in was cancelled.', 'cancelled'));
      }
      if (error) {
        finish(reject, new AuthError(
          params.get('error_description') || 'Microsoft refused the sign-in.', 'msa_refused'));
      }
    };

    win.webContents.on('will-redirect', (_event, target) => inspect(target));
    win.webContents.on('will-navigate', (_event, target) => inspect(target));
    win.on('closed', () => finish(reject, new AuthError('Sign-in was cancelled.', 'cancelled')));

    win.loadURL(url).catch((error) => finish(reject, offline(error)
      ? new AuthError('No connection to Microsoft.', 'offline')
      : new AuthError('The sign-in page could not be opened.', 'window_failed')));
  });
}

/* ------------------------------------------------------------- the chain */

async function exchangeCode(clientId, code, verifier) {
  const result = await postForm(MSA_TOKEN, {
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    code_verifier: verifier
  });
  if (!result.ok) {
    throw new AuthError(result.json?.error_description || 'Microsoft rejected the sign-in.', 'msa_refused');
  }
  return result.json;
}

async function refreshMicrosoft(clientId, refreshToken) {
  const result = await postForm(MSA_TOKEN, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPE
  });
  if (!result.ok) {
    // A refresh token dies when the password changes or consent is withdrawn
    // (Microsoft says so with a 400 invalid_grant). That is not an error to
    // retry, it is a prompt to sign in again. Anything else from Microsoft —
    // a 5xx, a 429, a page instead of a token — is Microsoft's evening, not
    // the account's, and must not read as "expired" (2026-09-20): a launch
    // reads that word as "sign in again" and refuses to start.
    const code = String(result.json?.error || '');
    if (result.status === 400 || result.status === 401 || code === 'invalid_grant') {
      throw new AuthError('Your sign-in has expired. Please sign in again.', 'expired');
    }
    throw new AuthError('Microsoft could not renew the sign-in right now.', 'msa_unavailable', said(result));
  }
  return result.json;
}

async function xboxLive(msaToken) {
  const result = await postJson(XBL_AUTHENTICATE, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msaToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });
  if (!result.ok) {
    throw new AuthError('Xbox Live would not accept this account.', 'xbl_refused', said(result));
  }
  return result.json;
}

/**
 * The gate that actually decides whether this account may play.
 *
 * XSTS is where the specific refusals live, and they are worth naming: a
 * player told only "login failed" has no idea that what they need is to make
 * an Xbox profile, or that a parent has to approve them.
 */
async function xsts(xblToken) {
  const result = await postJson(XSTS_AUTHORIZE, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  });

  if (result.status === 401) {
    const reasons = {
      2148916233: 'This Microsoft account has no Xbox profile yet. Make one at xbox.com, then try again.',
      2148916235: 'Xbox Live is not available in this account’s country.',
      2148916236: 'This account needs adult verification before it can play.',
      2148916237: 'This account needs adult verification before it can play.',
      2148916238: 'This is a child account. An adult has to add it to a Microsoft family first.'
    };
    const code = Number(result.json?.XErr);
    throw new AuthError(reasons[code] || 'Xbox Live would not authorise this account.', 'xsts_refused');
  }
  if (!result.ok) {
    throw new AuthError('Xbox Live would not authorise this account.', 'xsts_refused', said(result));
  }
  return result.json;
}

async function minecraftToken(userHash, xstsToken) {
  const result = await postJson(MC_LOGIN, {
    identityToken: `XBL3.0 x=${userHash};${xstsToken}`
  });
  // The one refusal that is about the launcher rather than the player: an
  // Azure application Mojang has not approved is turned away here with a 403,
  // no matter how correctly the three links before it went. The status is
  // written down because that is the only thing that tells the two apart.
  if (!result.ok) {
    throw new AuthError(
      'Minecraft’s servers turned BlueClient away, not your account. Try again in a minute; if it keeps happening, it is ours to fix.',
      'mc_refused', said(result));
  }
  return result.json;
}

/**
 * Who this account actually is in game.
 *
 * A 404 here is the one failure that is not a fault: the sign-in worked
 * perfectly and the account simply does not own the game.
 */
async function minecraftProfile(token) {
  const response = await fetch(MC_PROFILE, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(CALL_MS)
  });

  // Game Pass owns the game without a profile until the official launcher
  // has been opened once, and reads exactly the same as not owning it.
  if (response.status === 404) {
    throw new AuthError(
      'This account doesn’t own Minecraft: Java Edition. On Game Pass? Open the official Minecraft Launcher once to create your profile, then try again.',
      'not_owned');
  }
  if (!response.ok) throw new AuthError('Could not read the Minecraft profile.', 'profile_failed');

  return response.json();
}

/** Everything after Microsoft, shared by a fresh sign-in and a refresh. */
async function chainToMinecraft(msa) {
  const xbl = await xboxLive(msa.access_token);
  const userHash = xbl.DisplayClaims?.xui?.[0]?.uhs;
  if (!userHash) throw new AuthError('Xbox Live returned an unexpected answer.', 'xbl_refused');

  const secure = await xsts(xbl.Token);
  const minecraft = await minecraftToken(userHash, secure.Token);
  const profile = await minecraftProfile(minecraft.access_token);

  return {
    username: profile.name,
    uuid: dashed(profile.id),
    accessToken: minecraft.access_token,
    xuid: secure.DisplayClaims?.xui?.[0]?.xid || '',
    refreshToken: seal(msa.refresh_token),
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    skins: profile.skins || []
  };
}

/** Minecraft returns a bare hex id; every launch argument wants it dashed. */
function dashed(id) {
  if (!id || id.includes('-')) return id;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

/* -------------------------------------------------------------- storage */

/**
 * The refresh token is the one lasting secret here, so it is encrypted with a
 * key held by the operating system rather than written next to the settings.
 *
 * Where the OS offers no keychain, it is stored plainly and marked as such —
 * silently pretending it was protected would be worse than saying so.
 */
function seal(token) {
  if (!token) return '';
  if (!safeStorage.isEncryptionAvailable()) return `plain:${token}`;
  return `enc:${safeStorage.encryptString(token).toString('base64')}`;
}

function unseal(stored) {
  if (!stored) return '';
  if (stored.startsWith('plain:')) return stored.slice(6);
  if (!stored.startsWith('enc:')) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  } catch {
    // A machine change or a new OS user makes the ciphertext unreadable.
    return '';
  }
}

/* ---------------------------------------------------------------- public */

/**
 * Sign in from scratch, showing Microsoft's page.
 *
 * @returns {Promise<object>} the account, ready to be stored
 */
async function signIn({ clientId, parent } = {}) {
  clientId = appId(clientId);

  const { verifier, challenge } = pkce();
  const code = await askMicrosoft(parent, clientId, challenge);

  try {
    const msa = await exchangeCode(clientId, code, verifier);
    return await chainToMinecraft(msa);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw plainFailure(error, 'Sign-in failed.');
  }
}

/**
 * Renew an account's token without showing anything to the player.
 *
 * Called before launching rather than on a timer, because a launcher spends
 * most of its life closed and a token that expired overnight should cost the
 * player nothing.
 */
async function refresh({ clientId, account } = {}) {
  clientId = appId(clientId);

  const token = unseal(account?.refreshToken);
  if (!token) throw new AuthError('Your sign-in has expired. Please sign in again.', 'expired');

  try {
    const msa = await refreshMicrosoft(clientId, token);
    return await chainToMinecraft(msa);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw plainFailure(error, 'Could not renew the sign-in.');
  }
}

/** True when the stored token is old enough that launching should renew it. */
function stale(account) {
  if (!account || account.type !== 'microsoft') return false;
  if (!account.refreshToken) return false;
  return !account.expiresAt || account.expiresAt <= Date.now();
}

module.exports = { signIn, refresh, stale, appId, CLIENT_ID, AuthError };
