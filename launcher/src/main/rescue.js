'use strict';

/**
 * The way out when update.js cannot get a player to the next version
 * (2026-09-24).
 *
 * update.js is the updater, and it is good at it — but every time players
 * have been left behind on an old version it was because something in the
 * launcher itself stood in the updater's way, and a copy that cannot update
 * cannot be sent the fix for what stops it updating. The record, from
 * update.js's own comments: 0.13.2 and 0.13.3's swap closed the launcher and
 * never came back; 1.3 in Program Files closed and never came back; 1.9.0
 * ran with no window, so nobody ever closed it and nothing went in; and a
 * close followed by a quick reopen cost five minutes of nothing. Each was
 * fixed in the release after — which reached only the players it could.
 *
 * So this file is a second, independent way to the newest version, with
 * three jobs, and it shares no code with update.js on purpose: a mistake
 * there must not be a mistake here.
 *
 *   A start that never got going. Every start is counted until Home has
 *   painted (healthy(), from the IPC Home paints its version line with); a
 *   start that ended before that — crashed, hung, closed on a window with
 *   nothing in it — makes the next one look for a newer version at once,
 *   before whatever broke can break again. And when main.js will not even
 *   load (boot.js), this is all that runs: it looks, and puts the newer
 *   version in or says where to get it, instead of the launcher doing
 *   nothing at all.
 *
 *   An updater that has fallen behind. Every start looks, half a minute in,
 *   quietly. A newer version it has seen for a day, across three starts, is
 *   one update.js has had every chance to deliver and has not — whatever the
 *   reason — and from then on this puts it in itself.
 *
 *   A swap already running when the launcher is opened. boot.js asks
 *   joinRunningSwap() before anything else: a start that lands on a swap
 *   script still at work asks it to relaunch and gets out of its way,
 *   whichever updater started it. Two scripts would wait on each other.
 *
 * When the version truly cannot go in from here — the release moves
 * Electron, the install is for everyone on the PC, GitHub cannot be reached,
 * or swaps of it have failed twice — the player is told so, with the
 * download one click away, rather than left on an old version with nothing
 * said. That last step is the one that cannot fail silently: it needs
 * nothing but a dialog.
 *
 * Keep this file small and slow to change. It is the part that has to work
 * in the release where everything else does not.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app, dialog, shell } = require('electron');

const BASE = 'https://github.com/adriannlacko-collab/blueclient/releases/latest/download';
const FEED = 'https://blueclient.net/latest.json';
const DOWNLOAD_PAGE = 'https://blueclient.net/#install';

/** How long, and over how many starts, update.js gets before this steps in. */
const OVERDUE_MS = 24 * 60 * 60 * 1000;
const OVERDUE_STARTS = 3;
/** The most often a player who said "Later" is asked again. */
const ASK_AGAIN_MS = 12 * 60 * 60 * 1000;
/** Failed swaps of one version before only the download is offered. */
const GIVE_UP = 2;
/** The look on an ordinary start waits for the launcher to settle. */
const LOOK_DELAY_MS = 30 * 1000;
const URGENT_DELAY_MS = 3 * 1000;
/** The longest a swap script can still be at work (see update.js, SWAP_LIFE_MS). */
const SWAP_LIFE_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------ the record */

function userData(...parts) {
  return path.join(app.getPath('userData'), ...parts);
}

function note(level, message) {
  try {
    fs.appendFileSync(userData('update.log'), `${new Date().toISOString()}  ${level}  rescue: ${message}\n`);
  } catch {
    /* Never worth throwing over. */
  }
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Beside the file and renamed over it: a record cut short reads as none. */
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } catch {
    try { fs.writeFileSync(file, JSON.stringify(value)); } catch { /* the next start tries again */ }
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to tidy */ }
  }
}

const stateFile = () => userData('rescue.json');
const read = () => readJson(stateFile());
const change = (patch) => writeJson(stateFile(), { ...read(), ...patch });

/* ------------------------------------------------------------- versions */

function parse(text) {
  const clean = String(text || '').trim().replace(/^v/i, '').split('+')[0];
  const dash = clean.indexOf('-');
  return {
    numbers: (dash < 0 ? clean : clean.slice(0, dash)).split('.').map((n) => parseInt(n, 10) || 0),
    pre: dash < 0 ? null : clean.slice(dash + 1).split('.').filter(Boolean)
  };
}

/** Semver order, the same as update.js's newer(), written again on purpose. */
function newer(candidate, current) {
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i++) {
    const x = a.numbers[i] || 0;
    const y = b.numbers[i] || 0;
    if (x !== y) return x > y;
  }
  if (!a.pre || !b.pre) return !a.pre && Boolean(b.pre);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return false;
    if (b.pre[i] === undefined) return true;
    const x = /^\d+$/.test(a.pre[i]) ? Number(a.pre[i]) : null;
    const y = /^\d+$/.test(b.pre[i]) ? Number(b.pre[i]) : null;
    if (x !== null && y !== null) {
      if (x !== y) return x > y;
    } else if (x !== null || y !== null) {
      return y !== null;
    } else if (a.pre[i] !== b.pre[i]) {
      return a.pre[i] > b.pre[i];
    }
  }
  return false;
}

/* -------------------------------------------------------------- network */

const agent = () => `BlueClient/${app.getVersion()} (blueclient.net)`;

function get(url, onResponse, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    const request = require('https').get(url, { headers: { 'user-agent': agent() }, timeout: 20000 }, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return get(new URL(response.headers.location, url).toString(), onResponse, depth + 1).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`${url} answered ${response.statusCode}`));
      }
      onResponse(response, resolve, reject, request);
    });
    request.on('timeout', () => request.destroy(new Error(`${url} went quiet`)));
    request.on('error', reject);
  });
}

function fetchJson(url) {
  return get(url, (response, resolve, reject, request) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) request.destroy(new Error('too large'));
    });
    response.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
    response.on('error', reject);
  });
}

/** To disk, hashed on the way past; resolves with the sha512, base64. */
function fetchFile(url, dest) {
  return get(url, (response, resolve, reject, request) => {
    const hash = require('crypto').createHash('sha512');
    const file = fs.createWriteStream(dest);
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      request.destroy();
      file.destroy();
      file.once('close', () => reject(error));
    };
    response.on('data', (chunk) => hash.update(chunk));
    response.on('error', fail);
    request.on('error', fail);
    file.on('error', fail);
    file.on('finish', () => file.close(() => resolve(hash.digest('base64'))));
    response.pipe(file);
  });
}

/** The newest release: its bundle manifest if GitHub answers, the feed if not. */
async function latest() {
  let manifest = null;
  try {
    manifest = await fetchJson(`${BASE}/bundle.json`);
  } catch (error) {
    note('warn ', `no bundle manifest: ${error && error.message}`);
  }
  let feed = null;
  if (!manifest || !manifest.version) {
    try { feed = await fetchJson(FEED); } catch { /* neither answered */ }
  }
  const version = String((manifest && manifest.version) || (feed && feed.version) || '').trim();
  return version ? { version, manifest: manifest && manifest.version ? manifest : null, feed } : null;
}

/** Where a player is sent to fetch the installer by hand. */
async function downloadUrl(found) {
  let feed = found && found.feed;
  if (!feed) {
    try { feed = await fetchJson(FEED); } catch { /* the page, then */ }
  }
  return (feed && typeof feed.url === 'string' && /^https:\/\//.test(feed.url)) ? feed.url : DOWNLOAD_PAGE;
}

/* ------------------------------------------------------------ the swap */

const packagedWindows = () => app.isPackaged && process.platform === 'win32';

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

const swapFile = () => userData('swap-running.json');

/** The swap script running now, by either updater, or null. */
function runningSwap() {
  const swap = readJson(swapFile());
  if (!swap.pid || !swap.at) return null;
  if (swap.result && fs.existsSync(swap.result)) return null;
  const bootedAt = Date.now() - require('os').uptime() * 1000;
  if (swap.at < bootedAt || Date.now() - swap.at > SWAP_LIFE_MS) return null;
  return alive(swap.pid) ? swap : null;
}

/**
 * Written by whichever updater starts a swap script: its host's process id,
 * its result file, when it began and the file that, found after its copy,
 * makes it start the launcher again.
 */
function recordSwap({ pid, at, result, relaunch }) {
  if (!pid) return;
  writeJson(swapFile(), { pid, at, result, relaunch });
}

/**
 * A swap script still waiting for BlueClient.exe to be gone — and this start
 * IS BlueClient.exe. True when it has been asked to relaunch and the caller
 * should exit at once; false to start as usual. Never throws.
 */
function joinRunningSwap() {
  try {
    if (!packagedWindows()) return false;
    const swap = runningSwap();
    if (!swap || !swap.relaunch) return false;
    fs.writeFileSync(swap.relaunch, '');
    // Finished between the look and the write: nobody is coming back for
    // this start, so it goes on. At worst the script saw the file too, and
    // its launcher only focuses this one.
    if (swap.result && fs.existsSync(swap.result)) return false;
    note('info ', 'a swap is still running — asked it to relaunch, getting out of its way');
    return true;
  } catch (error) {
    note('warn ', `could not join a running swap: ${error && error.message}`);
    return false;
  }
}

function tool(name) {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);
}

function writable() {
  const probe = path.join(process.resourcesPath, `.rescue-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'probe');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Why the bundle cannot go in from here, or '' when it can. */
function cannotSwap(found) {
  if (!packagedWindows()) return 'this is not an installed Windows copy';
  if (!found.manifest) return 'GitHub could not be reached from this network';
  if (String(found.manifest.electron || '') !== process.versions.electron) return 'this update replaces BlueClient itself, so it needs the installer';
  if (!found.manifest.sha512) return 'the update carries no checksum';
  const failed = (read().failed || {})[found.version] || 0;
  if (failed >= GIVE_UP) return 'updating in place has not worked on this PC';
  if (!writable()) return 'BlueClient is installed for everyone on this PC, so the update needs the installer';
  if (runningSwap()) return 'another update is going in right now';
  return '';
}

function wipe(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the next look tries again */ }
}

/** Download, verify and unpack the bundle; resolves with the unpacked folder. */
async function fetchBundle(found) {
  const root = userData('update-rescue');
  try { for (const entry of fs.readdirSync(root)) wipe(path.join(root, entry)); } catch { /* first time */ }
  const dir = path.join(root, String(Date.now()));
  const out = path.join(dir, 'new');
  fs.mkdirSync(out, { recursive: true });
  const archive = path.join(dir, 'bundle.tar.gz');
  try {
    const got = await fetchFile(`${BASE}/bundle.tar.gz`, archive);
    if (got !== found.manifest.sha512) throw new Error('sha512 mismatch');
    await new Promise((resolve, reject) => {
      const tar = spawn(tool('tar.exe'), ['-xzf', archive, '-C', out], { stdio: 'ignore' });
      tar.on('error', reject);
      tar.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
    });
    if (!fs.existsSync(path.join(out, 'app.asar'))) throw new Error('bundle carries no app.asar');
    return out;
  } catch (error) {
    wipe(dir);
    throw error;
  }
}

/**
 * The same swap update.js runs, written out again: wait for every
 * BlueClient.exe but this script's host to be gone, copy app.asar, mirror
 * resources, write the result, then start the launcher if the relaunch file
 * is there. Always asked to relaunch — the player just said "Update now".
 */
function startSwap(dir, version) {
  const exe = app.getPath('exe');
  const name = path.basename(exe);
  const resources = process.resourcesPath;
  const stamp = Date.now();
  const script = path.join(path.dirname(dir), `swap-${stamp}.cmd`);
  const host = path.join(path.dirname(dir), `swap-${stamp}.js`);
  const relaunch = path.join(path.dirname(dir), 'relaunch');
  const result = userData(`swap-${stamp}.result`);
  const said = (what) => `echo ${what}> "${result}"`;
  const lines = [
    '@echo off',
    'set ELECTRON_RUN_AS_NODE=',
    'set hostpid=%~1',
    'if not defined hostpid set hostpid=0',
    'set tries=0',
    'set waited=0',
    ':wait',
    `tasklist /fi "imagename eq ${name}" /fi "pid ne %hostpid%" | find /i "${name}" >nul`,
    'if errorlevel 1 goto copy',
    'set /a waited+=1',
    `if %waited% geq 300 ${said('failed-wait: the launcher never closed')}`,
    'if %waited% geq 300 exit /b 1',
    'ping -n 2 127.0.0.1 >nul',
    'goto wait',
    ':copy',
    `copy /y "${path.join(dir, 'app.asar')}" "${path.join(resources, 'app.asar')}" >nul`,
    'if not errorlevel 1 goto copied',
    'set /a tries+=1',
    `if %tries% geq 30 ${said('failed-copy: app.asar could not be written after 30 tries')}`,
    'if %tries% geq 30 exit /b 1',
    'ping -n 2 127.0.0.1 >nul',
    'goto copy',
    ':copied',
    `robocopy "${path.join(dir, 'resources')}" "${path.join(resources, 'resources')}" /mir /njh /njs /ndl /nc /ns /np >nul`,
    `if errorlevel 8 ${said('failed-resources: robocopy failed (errorlevel %errorlevel%)')}`,
    'if errorlevel 8 exit /b 1',
    said('ok'),
    `if exist "${relaunch}" start "" "${exe}"`
  ];
  const hostLines = [
    "const { spawn } = require('child_process');",
    `const child = spawn(${JSON.stringify(tool('cmd.exe'))}, ['/c', ${JSON.stringify(script)}, String(process.pid)], { windowsHide: true, stdio: 'ignore' });`,
    "child.on('exit', (code) => process.exit(code === null ? 1 : code));",
    "child.on('error', () => process.exit(1));",
    ''
  ];
  try {
    fs.writeFileSync(relaunch, '');
    fs.writeFileSync(script, lines.join('\r\n') + '\r\n');
    fs.writeFileSync(host, hostLines.join('\n'));
    const child = spawn(exe, [host], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    child.unref();
    recordSwap({ pid: child.pid, at: stamp, result, relaunch });
    change({ attempt: { version, result, at: stamp } });
    note('info ', `${version}: swap running, exiting into it`);
    return true;
  } catch (error) {
    note('error', `${version}: swap would not start: ${error && error.message}`);
    return false;
  }
}

/** On start: did this file's last swap take? A failed one is counted. */
function settleAttempt() {
  const state = read();
  const attempt = state.attempt;
  if (!attempt || !attempt.version) return;
  if (!newer(attempt.version, app.getVersion())) {
    note('info ', `${attempt.version}: the swap took`);
    change({ attempt: null });
    return;
  }
  const failed = { ...(state.failed || {}) };
  failed[attempt.version] = (failed[attempt.version] || 0) + 1;
  note('warn ', `${attempt.version}: the swap did not take (failure ${failed[attempt.version]} of ${GIVE_UP})`);
  change({ attempt: null, failed });
}

/* ------------------------------------------------------------- the look */

let looking = false;
/** Hooks for tools/update-flow; the real thing in the launcher. */
const hooks = { exit: (code) => app.exit(code) };

function ask(options) {
  return dialog.showMessageBox({ type: 'info', title: 'BlueClient', noLink: true, ...options })
    .then((answer) => answer.response)
    .catch(() => 1);
}

/**
 * Look for a newer version and, when this start has reason to, put it in.
 *
 *   urgent   the last start never got going (or main.js would not load):
 *            act now rather than wait for update.js to have its turn
 *   failed   main.js did not load; there is no launcher behind this
 *
 * Resolves 'swapping' (the caller must not go on), 'asked' or 'nothing'.
 * Never throws.
 */
async function look({ urgent = false, failed = null } = {}) {
  if (looking) return 'nothing';
  looking = true;
  try {
    const found = await latest();
    const current = app.getVersion();
    if (!found || !newer(found.version, current)) {
      if (read().seen) change({ seen: null });
      return 'nothing';
    }

    const state = read();
    const seen = state.seen && state.seen.version === found.version
      ? { ...state.seen, starts: (state.seen.starts || 0) + 1 }
      : { version: found.version, at: Date.now(), starts: 1 };
    change({ seen });
    const overdue = Date.now() - seen.at >= OVERDUE_MS && seen.starts >= OVERDUE_STARTS;
    if (!urgent && !failed && !overdue) return 'nothing';
    if (!urgent && !failed && state.asked && Date.now() - state.asked < ASK_AGAIN_MS) return 'nothing';
    change({ asked: Date.now() });
    note('info ', `${found.version} is out and this is ${current} — ${failed ? 'the launcher did not load' : urgent ? 'the last start never got going' : 'update.js has not delivered it'}`);

    let why = cannotSwap(found);
    if (!why) {
      try {
        const dir = await fetchBundle(found);
        const answer = await ask({
          message: failed
            ? `BlueClient ${current} could not start. BlueClient ${found.version} is ready to fix that.`
            : `BlueClient ${found.version} is ready to install.`,
          detail: failed || urgent
            ? 'It takes a few seconds, and BlueClient opens again by itself.'
            : 'This copy has not been able to update itself, so it is doing it now. It takes a few seconds, and BlueClient opens again by itself.',
          buttons: ['Update now', 'Later'],
          defaultId: 0,
          cancelId: 1
        });
        if (answer !== 0) return 'asked';
        if (startSwap(dir, found.version)) {
          hooks.exit(0);
          return 'swapping';
        }
        why = 'the update could not be started';
      } catch (error) {
        note('warn ', `${found.version}: could not fetch it: ${error && error.message}`);
        why = 'the download did not finish';
      }
    }

    // The last resort, and the one that cannot fail silently.
    note('info ', `${found.version}: cannot go in from here (${why}); offering the download`);
    const answer = await ask({
      message: `BlueClient ${found.version} is out, and this copy (${current}) can't update itself.`,
      detail: `${why[0].toUpperCase()}${why.slice(1)}. Download the latest version to update — your settings and worlds stay as they are.`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (answer === 0) await shell.openExternal(await downloadUrl(found)).catch(() => {});
    return 'asked';
  } catch (error) {
    note('error', `the look failed: ${error && error.message}`);
    return 'nothing';
  } finally {
    looking = false;
  }
}

/* -------------------------------------------------------------- health */

let counted = false;
let fine = false;

/**
 * Count this start, and look — soon if the last one never got going, a
 * little later if it did. Called once, from boot.js, before main.js loads.
 */
function begin() {
  app.whenReady().then(() => {
    // The second instance quits at once and is nobody's start.
    if (!app.hasSingleInstanceLock() || !app.isPackaged) return;
    const state = read();
    const streak = state.pending ? (state.streak || 0) + 1 : 0;
    if (streak) note('warn ', `the last start never reached Home (${streak} in a row)`);
    settleAttempt();
    change({ pending: true, streak });
    counted = true;
    setTimeout(() => { look({ urgent: streak > 0 }); }, streak > 0 ? URGENT_DELAY_MS : LOOK_DELAY_MS);
  }).catch(() => {});
}

/** Home has painted: this start got going. */
function healthy() {
  if (!counted || fine) return;
  fine = true;
  change({ pending: false, streak: 0 });
}

/** A quit the launcher meant before Home (a swap at start): not a failed start. */
function expectedExit() {
  healthy();
}

/**
 * main.js would not load. Nothing else is running, so this is the launcher
 * now: look for the fix, and failing that say what happened and where the
 * installer is — a launcher that does nothing at all when clicked is the
 * worst thing a player can meet.
 */
function mainFailed(error) {
  note('error', `main.js did not load: ${error && error.stack ? error.stack : error}`);
  if (!app.isPackaged) throw error;
  if (!app.hasSingleInstanceLock() && !app.requestSingleInstanceLock()) {
    hooks.exit(0);
    return;
  }
  app.whenReady().then(async () => {
    const outcome = await look({ urgent: true, failed: error });
    if (outcome === 'swapping') return;
    if (outcome === 'nothing') {
      const answer = await ask({
        type: 'error',
        message: 'BlueClient could not start.',
        detail: `Reinstalling the latest version from blueclient.net fixes this — your settings and worlds stay as they are.\n\n${String(error && error.message || error).slice(0, 300)}`,
        buttons: ['Download', 'Close'],
        defaultId: 0,
        cancelId: 1
      });
      if (answer === 0) await shell.openExternal(await downloadUrl(null)).catch(() => {});
    }
    hooks.exit(0);
  }).catch(() => hooks.exit(1));
}

module.exports = {
  begin, healthy, expectedExit, mainFailed, joinRunningSwap, recordSwap,
  /* For tools/update-flow. */
  look, newer, hooks, OVERDUE_MS, OVERDUE_STARTS
};
