'use strict';

/**
 * Counting who plays, without knowing who anyone is.
 *
 * Adrian asked (2026-09-05) for a page of his own showing how many people
 * have the launcher open, how many are in a game, how many played this month
 * and how many downloaded it. Downloads GitHub already counts; the rest can
 * only be known if each launcher says "I am here" now and then. This is that.
 *
 * What is sent, and all that is sent: a random id made once per install (so
 * the same launcher is counted once, not once per heartbeat), the launcher
 * version, the platform, how many games it has open, on a launch which
 * Minecraft was started, and when a game ends (2026-09-22) the sitting's
 * frame record — its median frame rate, its 1% low, its longest frame, how
 * long it was — with the graphics card's model name, so the frame-rate work
 * can be seen across real machines and not only on this one. Never the
 * player's name, account, servers, worlds or anything typed. The server keeps the id, the times, the version and the
 * country Cloudflare reads off the connection; it does not keep the address.
 *
 * Sent on start, every five minutes while the launcher is open, on each
 * launch, and once more as it closes. All of it is best effort: a request
 * that fails is dropped and nothing is retried, because a launcher must never
 * wait on a statistics server. The switch is in Settings → About ("Count me
 * as a player"); off, nothing at all leaves the machine from here.
 *
 * The address is the admin project's API with the project's own Cloudflare
 * name behind it, so a missing custom domain still counts.
 *
 * OPT-IN CRASH REPORTS (2026-09-11), the same idea applied to one more thing:
 * Settings → General's "Send crash reports" is off by default, and on, sends
 * the nine fields `crashes.js`'s `reportShape` builds — the crash reason, the
 * suspected mod, and the two BlueClient version numbers plus Minecraft's —
 * to `/api/crash` beside `/api/ping`, same headers, same user agent, same
 * two addresses. `wireCrashReports` hooks `crashes.onCrash` the moment
 * `start` runs, so a crash is sent the instant `crashes.js` remembers it —
 * no polling, no new IPC. It is deliberately apart from the ping machinery
 * below: no timer, no `app.on('before-quit', …)`, so it needs no Electron to
 * prove — see `tools/check-crash-report.js`.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { app } = require('electron');
const { USER_AGENT, VERSION } = require('./version');
const crashes = require('./crashes');

const ENDPOINTS = [
  'https://api.blueclient.net/api/ping',
  'https://blueclient-admin.pages.dev/api/ping'
];

/** Same two hosts as the ping, `/api/crash` beside `/api/ping`. */
const CRASH_ENDPOINTS = [
  'https://api.blueclient.net/api/crash',
  'https://blueclient-admin.pages.dev/api/crash'
];

const BEAT_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 6000;

/* How long the launcher is allowed to hold its own quit for the closing
   beacon. Past this it closes anyway and the server ages the entry out. */
const CLOSE_WAIT_MS = 1500;

let store = null;
let launcher = null;
let started = false;
let closing = false;

function enabled() {
  // A launcher run from source is a launcher being worked on, not a player.
  // Every "npm start" used to be a new install with its own id, and a run of
  // install-and-quit testing put twenty-five of them on the page in one
  // afternoon (2026-09-08). Development counts nothing now.
  if (!app.isPackaged) return false;
  return Boolean(store) && store.get('stats.share') !== false;
}

/**
 * The install's id: kept in the settings file, and — if that file is gone —
 * worked out again from the machine rather than invented afresh.
 *
 * It was invented afresh until 2026-09-08, and the settings folder does not
 * always survive: a reinstall, a bad update, someone clearing it to test a
 * first run. Each of those made a new install and a new "player" out of the
 * same person. What is used now is a SHA-256 of the operating system's own
 * machine id under a fixed word — one number per machine, stable across
 * reinstalls, and no more telling than the random one it replaces: it never
 * leaves this function, only its hash does, and it says nothing about who is
 * at the keyboard. A machine that will not say (an unusual Linux, a locked
 * registry) falls back to a random id, as before.
 */
async function installId() {
  let id = store.get('stats.id');
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = (await fromMachine()) || crypto.randomUUID();
    store.set('stats.id', id);
  }
  return id;
}

/** A small command, its stdout, and never the thread it was asked on. */
function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 4000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/**
 * The machine's own id, hashed and shaped like a UUID; '' if it cannot be read.
 *
 * Asked WITHOUT blocking (2026-09-22). It used to be execFileSync — reg.exe on
 * Windows, ioreg on a Mac, with a four-second clock — on main's only thread,
 * and it runs exactly once in a copy's life: the first launch, in the seconds
 * the window is coming up, which is the one launch a player judges the
 * launcher by.
 */
async function fromMachine() {
  let machine = '';
  try {
    if (process.platform === 'win32') {
      const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
      const found = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]{36})/i);
      machine = found ? found[1] : '';
    } else if (process.platform === 'linux') {
      machine = (await fs.promises.readFile('/etc/machine-id', 'utf8')).trim();
    } else if (process.platform === 'darwin') {
      const out = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
      const found = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      machine = found ? found[1] : '';
    }
  } catch {
    machine = '';
  }
  if (!machine) return '';

  const hex = crypto.createHash('sha256').update(`blueclient-install:${machine}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function gamesOpen() {
  if (!launcher) return 0;
  return launcher.list().filter((session) => session.status === 'playing').length;
}

/**
 * Which in-game modules the game that just started has switched on — their
 * ids, nothing else (2026-09-06). Read from the profile's own copy of the
 * game's config, which was borrowed from the shared set a moment before the
 * JVM started, so it is exactly what that game will run with.
 *
 * This is what lets a module be cut on evidence rather than by guess: three
 * modules went in September as "chips nobody turns on", and nobody could
 * have known whether that was true. It is a list of switch names; it cannot
 * say who the player is or where they play.
 */
async function modulesOn(profileId) {
  try {
    const instances = store.get('launcher.gameDirectory');
    const file = path.join(instances, String(profileId), 'config', 'blueclient.json');
    const root = JSON.parse(await fsp.readFile(file, 'utf8'));
    const active = typeof root.activeProfile === 'string' ? root.activeProfile : 'Default';
    const block = root.profiles && (root.profiles[active] || Object.values(root.profiles)[0]);
    const modules = block && block.modules;
    if (!modules || typeof modules !== 'object') return undefined;
    return Object.keys(modules).filter((id) => modules[id] === true).sort();
  } catch {
    // A profile that has never run the in-game half has no file; nothing to say.
    return undefined;
  }
}

/**
 * POST a small JSON body; true if the server took it. Never throws.
 *
 * `https:` for the two real addresses, always; `http:` only so
 * `tools/check-crash-report.js` can point this at a plain
 * `http.createServer` on localhost without a certificate to fake — a real
 * address is never anything but https.
 */
function post(url, body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    try {
      const client = /^https:/i.test(url) ? https : http;
      const request = client.request(url, {
        method: 'POST',
        headers: {
          'user-agent': USER_AGENT,
          'content-type': 'application/json',
          'content-length': data.length
        },
        timeout: TIMEOUT_MS
      }, (response) => {
        response.resume();
        finish(response.statusCode >= 200 && response.statusCode < 300);
      });
      request.on('timeout', () => request.destroy(new Error('timed out')));
      request.on('error', () => finish(false));
      request.end(data);
    } catch {
      finish(false);
    }
  });
}

async function send(event, extra = {}) {
  if (!enabled()) return;
  const body = {
    id: await installId(),
    event,
    version: VERSION,
    os: process.platform,
    playing: gamesOpen(),
    ...extra
  };
  for (const url of ENDPOINTS) {
    if (await post(url, body)) return;
  }
}

/**
 * One crash, shaped by `crashes.js`'s `reportShape` and sent if Settings →
 * General's "Send crash reports" is on. Fire and forget, like `send` above:
 * a session's exit path must never wait on this, and a failure that reaches
 * neither address is one debug line, never a retry. `endpoints` defaults to
 * the real two addresses and is only ever overridden by a test.
 */
async function sendCrash(record, theStore, endpoints = CRASH_ENDPOINTS) {
  if (!theStore || theStore.get('stats.crashReports') !== true) return false;
  const body = crashes.reportShape(record);
  if (!body) return false;
  for (const url of endpoints) {
    if (await post(url, body)) return true;
  }
  console.debug('[stats] crash report reached neither address');
  return false;
}

/**
 * Hooks `crashes.js`'s register to `sendCrash` above — the whole of "the
 * send happens in main when a session ends" (2026-09-11). Apart from
 * `start`'s ping machinery on purpose: no timer, no Electron `app`, so it
 * can be wired and proven under plain node with a fake store — see
 * `tools/check-crash-report.js`.
 */
function wireCrashReports(theStore) {
  crashes.onCrash((record) => { sendCrash(record, theStore).catch(() => {}); });
}

/**
 * Begin counting. Called once from main after the window exists; the
 * launcher is where the running games are read from.
 */
function start(theStore, theLauncher) {
  store = theStore;
  launcher = theLauncher;
  // Rewired every call, same as store/launcher above — cheap, and correct if
  // this is ever called again with a fresh store.
  wireCrashReports(theStore);
  if (started) return;
  started = true;

  send('open');
  setInterval(() => send('beat'), BEAT_MS).unref();

  /* Wrapped, because this is an async listener on an EventEmitter: nothing
     awaits it, so a throw inside it is an unhandled rejection and takes the
     whole main process's error handler with it for a statistic nobody asked
     for (2026-09-22). */
  launcher.on('state', (payload) => { onLauncherState(payload).catch(() => {}); });

  async function onLauncherState(payload) {
    if (payload.state === 'idle' && payload.frames) {
      // The sitting that just ended, as the companion measured it (the
      // `frames` block of the launch log), with the card's name. The
      // sentence under Settings › About names every field here.
      const record = payload.frames;
      send('frames', {
        mc: payload.mc || undefined,
        fps: record.median,
        low1: record.low1,
        longest: record.longestMs,
        seconds: record.seconds,
        gpu: await crashes.gpuName().catch(() => null)
      });
      return;
    }
    if (payload.state !== 'playing') return;
    const session = launcher.list().find((entry) => entry.id === payload.id);
    send('launch', {
      mc: session ? session.version : undefined,
      modules: session ? await modulesOn(session.profileId) : undefined
    });
  }

  // The closing beacon. Quitting is held for at most a moment and a half so
  // the request can leave; a launcher that is asked to close should close.
  app.on('before-quit', (event) => {
    if (closing || !enabled()) return;
    closing = true;
    event.preventDefault();
    Promise.race([
      send('close'),
      new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS))
    ]).finally(() => app.quit());
  });
}

module.exports = { start, sendCrash, wireCrashReports, CRASH_ENDPOINTS };
