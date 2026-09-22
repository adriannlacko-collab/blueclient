'use strict';

/**
 * Keeping an installed BlueClient current, without asking the player.
 *
 * The first answer to this (2026-09-04) was a *check*: a small file on
 * blueclient.net named the newest version, Home said "Update to 0.3.0" and the
 * player was sent to a download page to fetch an installer and run it. That is
 * better than nothing — before it, whoever installed 0.2.4 stayed on 0.2.4 for
 * ever — but it still asks a thirteen-year-old to notice a grey line in a
 * corner, download an 85MB file and click through a Windows warning, and most
 * of them will not. A fix that only reaches the players who go looking for it
 * is not really shipped.
 *
 * So the launcher now updates itself (2026-09-04). electron-updater watches the
 * GitHub releases this project publishes, downloads a newer installer in the
 * background while the player is doing something else, and hands it to Windows
 * when the launcher next closes. The player sees two quiet lines in the corner
 * where the version already sits — "Updating… 42%", then "Restart to update" —
 * and can press the second one to have it now rather than later. Neither ever
 * stands between them and Play.
 *
 * What makes it work is the release, not this file: electron-builder writes a
 * `latest.yml` next to the installer naming the version, the file and its
 * sha512, and uploads all three (`npm run release`). electron-updater reads
 * that file, refuses anything whose hash does not match, and — because the
 * .blockmap is up there too — downloads only the parts of the installer that
 * actually changed, which for a typical release is a few MB rather than
 * eighty. The feed address is not written here: `publish` in package.json puts
 * it in `app-update.yml` inside the build.
 *
 * The old blueclient.net/latest.json check stays as the fallback, for two
 * reasons that both matter. Every copy already installed out there (0.2.15 and
 * older) has no auto-updater in it and reads that file and nothing else, so it
 * is how those players hear about this release at all. And if GitHub is
 * unreachable — blocked on a school network, say — the launcher can still say
 * a newer version exists even when it cannot fetch it.
 *
 *   https://blueclient.net/latest.json
 *   { "version": "0.3.0", "url": "https://…/releases/latest/download/…", "notes": "" }
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app } = require('electron');
const { USER_AGENT } = require('./version');

/* `https` is asked for at the first request rather than here (2026-09-22):
   main reads this file before Electron's ready, for applyStagedAtStart, and
   loading Node's TLS stack was the largest single require in that stretch —
   about 6 ms of a start that has nothing to fetch until the window is up. */
const https = () => require('https');

/**
 * What the updater did, on disk, because nothing else records it.
 *
 * electron-updater talks to a logger and this build never gave it one, so
 * every check, download and failed install went to a console nobody sees:
 * when Adrian said the update was "super glitched" (2026-09-09) there was not
 * one line anywhere on the machine saying what it had tried. The same shape as
 * noteAuthFailure in main.js — a timestamped line in userData, wrapped so
 * that diagnostics can never be the reason something fails.
 */
function note(level, message) {
  const line = `${new Date().toISOString()}  ${level}  ${message}
`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), line);
  } catch {
    /* Never worth throwing over. */
  }
}

const logger = {
  info: (m) => note('info ', m),
  warn: (m) => note('warn ', m),
  error: (m) => note('error', m && m.stack ? m.stack : m),
  debug: () => {}
};

/** The fallback feed, for when GitHub cannot be reached. */
const FEED = 'https://blueclient.net/latest.json';

/** Where the player is sent when the feed does not say. */
const FALLBACK_URL = 'https://blueclient.net/#install';

/*
 * How often a launcher that is already open looks again.
 *
 * This was three hours, on the reasoning that it is far below any plausible
 * release cadence. That reasoning was about *releases* and the number that
 * matters is about *players*: a launcher open when a release lands could sit
 * for three hours without even knowing, and the version only changes on the
 * close after the download, so the player who closed and reopened in that
 * window saw nothing happen and reasonably concluded that nothing does.
 * That is exactly what was reported on 2026-09-06, an hour after 0.5.0 went
 * out. Twenty minutes, and a look whenever the window is brought to the
 * front — which is the moment before somebody closes it — costs a request of
 * a few hundred bytes and buys the difference between "it updates itself" and
 * "it says it does".
 */
const RECHECK_MS = 20 * 60 * 1000;

/** The most often a window coming to the front may cause a look. */
const FOCUS_MS = 2 * 60 * 1000;

/**
 * What the corner of Home is currently saying.
 *
 *   idle         nothing to say — no newer version, offline, or still asking
 *   downloading  a newer version is coming down; `percent` is how far
 *   ready        it is on disk and goes in when the launcher next closes
 *   available    there is one, but this build cannot fetch it — `url` is where
 */
let state = { phase: 'idle', version: null, percent: 0, url: null, notes: '' };

/** Main's push channel to the renderer, set once by start(). */
let publish = null;

let started = false;
/** The check, once it exists, and when it last ran — both for poke(). */
let look = null;
let lastAsked = 0;
/** The look running right now, if one is (start, `ask`). */
let looking = null;

function set(patch) {
  const next = { ...state, ...patch };
  // Only when it would say something different (2026-09-22). The bundle
  // download called this on every HTTP chunk — about 1,300 of them on a
  // 20 MB bundle, for a hundred distinct percentages — and each one crossed
  // to the renderer, rebuilt two nodes in the corner of Home, re-fired the
  // version line's ResizeObserver and made placeNews read layout straight
  // after writing it. A player watching 'Restart to update' count up was
  // watching the launcher do that thirteen times a second.
  const changed = Object.keys(next).some((key) => next[key] !== state[key]);
  state = next;
  if (publish && changed) publish(state);
}

/* ------------------------------------------------------------- the feed */

/**
 * Fetch a small JSON document, with a short leash and no dependencies.
 *
 * `limit` is how large the body may be. A feed is a couple of hundred bytes
 * and anything larger is not the feed; the release list the beta channel
 * reads (2026-09-11) is ten releases with their assets and notes, which runs
 * to a hundred kilobytes, so that one call raises it.
 */
function fetchJson(url, { limit = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https().get(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      timeout: 6000
    }, (response) => {
      // One redirect is worth following: a host that moves the feed to a CDN
      // path is the ordinary case and costs nothing to handle.
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return fetchJson(new URL(response.headers.location, url).toString(), { limit }).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`feed answered ${response.statusCode}`));
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > limit) request.destroy(new Error('feed too large'));
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('timeout', () => request.destroy(new Error('feed timed out')));
    request.on('error', reject);
  });
}

/**
 * "0.19.0-beta.1" → its numbers and its pre-release identifiers. A leading
 * "v" (a release tag) and anything after a "+" (build metadata) are dropped.
 */
function parseVersion(text) {
  const clean = String(text || '').trim().replace(/^v/i, '').split('+')[0];
  const dash = clean.indexOf('-');
  const numbers = (dash < 0 ? clean : clean.slice(0, dash)).split('.').map((n) => parseInt(n, 10) || 0);
  const pre = dash < 0 ? null : clean.slice(dash + 1).split('.').filter(Boolean);
  return { numbers, pre };
}

/**
 * Pre-release identifiers, the way semver ranks them: a release outranks any
 * pre-release of the same numbers, a number ranks below a word, numbers
 * compare as numbers, words as words, and the shorter of two otherwise-equal
 * lists is the lower one (beta < beta.1).
 */
function comparePre(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const x = /^\d+$/.test(a[i]) ? Number(a[i]) : null;
    const y = /^\d+$/.test(b[i]) ? Number(b[i]) : null;
    if (x !== null && y !== null) {
      if (x !== y) return x > y ? 1 : -1;
      continue;
    }
    if (x !== null) return -1;
    if (y !== null) return 1;
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

/** -1, 0 or 1: how `candidate` stands against `current`. */
function compareVersions(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i++) {
    const left = a.numbers[i] || 0;
    const right = b.numbers[i] || 0;
    if (left !== right) return left > right ? 1 : -1;
  }
  return comparePre(a.pre, b.pre);
}

/**
 * Is `candidate` a newer version than `current`?
 *
 * Numeric, part by part: a string compare would put 0.2.9 ahead of 0.2.13,
 * which is exactly the pair this launcher was at when the first check
 * shipped. And pre-release aware since the beta channel (2026-09-11): the
 * numeric compare alone read 0.19.0-beta.1 as newer than 0.19.0, so a copy
 * that had taken a beta would never have taken the release that followed it.
 * Now 0.19.0 is newer than 0.19.0-beta.1, beta.2 is newer than beta.1, and
 * a beta of the next version is newer than the release of this one.
 */
function newer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

/**
 * The fallback: ask blueclient.net, and offer a link if it names a newer one.
 *
 * Never throws and never reports an update it is not sure about: an
 * unreachable feed, a malformed one, or one naming a version this launcher is
 * already at or past all leave the corner exactly as it was.
 */
async function checkFeed(currentVersion) {
  try {
    const feed = await fetchJson(FEED);
    const version = String(feed?.version || '').trim();
    if (!version || !newer(version, currentVersion)) return;

    // Only ever an https link to somewhere, and only ever opened by the
    // player pressing the line that says so.
    const raw = String(feed?.url || FALLBACK_URL);
    const url = raw.startsWith('https://') ? raw : FALLBACK_URL;

    set({ phase: 'available', version, url, notes: String(feed?.notes || '').slice(0, 200) });
  } catch {
    // Offline, or no feed deployed. Say nothing, and let the next check ask
    // again.
  }
}

/* ------------------------------------------------------ the auto-update */

let autoUpdater = null;

/**
 * electron-updater, wired to this launcher's own corner of Home.
 *
 * Loaded lazily and inside a try: it is the launcher's only runtime
 * dependency, and a launcher that would not start because its updater failed
 * to load is a poor trade for what the updater buys.
 */
function attach() {
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return false;
  }

  autoUpdater.logger = logger;

  // Fetch it as soon as we know about it, and put it in when the player is
  // finished with the launcher rather than interrupting them to ask. Both are
  // electron-updater's defaults; they are written down because between them
  // they *are* the behaviour, and a default is a poor place to keep a
  // decision this size.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    set({ phase: 'downloading', version: info?.version || null, percent: 0 });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress?.percent || 0);
    set({ phase: 'downloading', percent: Math.max(0, Math.min(100, percent)) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    set({ phase: 'ready', version: info?.version || state.version, percent: 100 });
  });

  // A failed update is the player's problem only if we make it one. GitHub
  // down, a school network blocking it, a half-written download: the corner
  // falls back to the link, and the next check starts again from the top.
  autoUpdater.on('error', () => {
    if (state.phase === 'ready') return;
    set({ phase: 'idle', percent: 0 });
    checkFeed(app.getVersion());
  });

  return true;
}

/* ------------------------------------------------------------ the bundle
   The update that does not run a new executable.

   Windows Smart App Control blocks unsigned binaries its intelligence service
   has never heard of, and BlueClient is unsigned. On 2026-09-09 it blocked the
   0.11.2 installer eighteen times on Adrian's own machine — the CodeIntegrity
   log, policy VerifiedAndReputableDesktop, from Chrome and from Explorer. It
   has no "Run anyway" the way SmartScreen does, and turning it off cannot be
   undone without reinstalling Windows. So for every player whose machine has
   it on, the installer route is simply shut.

   But almost nothing we ship is a binary. A release changes app.asar, the mod
   jars and the shaderpack, and those are DATA sitting beside BlueClient.exe in
   resources/. Replacing them runs nothing. BlueClient.exe never changes, so
   whatever standing it has it keeps, and Smart App Control is never asked a
   question it can answer with no.

   So this is the normal channel and the installer is the fallback, rather than
   the other way round. The installer is still needed when Electron itself
   moves, because then the exe genuinely does change — twice a year, against a
   release most weeks.

   What this trades away: electron-updater checked the installer's signature
   for us, and here we are the ones checking. The sha512 in bundle.json is that
   check, it is compared before anything is unpacked, and a mismatch stops the
   update dead and leaves the installed copy exactly as it was. */

const BUNDLE_BASE = 'https://github.com/adriannlacko-collab/blueclient/releases/latest/download';

/* ------------------------------------------------------- early updates
   "Get updates early", under Settings → About (2026-09-11).

   GitHub's `releases/latest` alias never points at a pre-release, which is
   what makes it safe for everybody: a release published with --prerelease is
   invisible to the address above. A player who wants what is coming before
   it is finished flips the switch, and from then on each look reads the
   release list itself, takes the newest version in it — pre-release or not —
   and fetches that release's own copies of the two bundle files.

   Newest by VERSION, not by date: a hotfix published after a beta (0.18.1
   after 0.19.0-beta.1) must not pull a beta copy back to it, and newer()
   knows that 0.19.0-beta.1 is behind 0.19.0, so a beta copy takes the
   release that follows it.

   The list is an API call, unauthenticated and rate-limited to sixty an hour
   per address — a school's whole network shares one. When it cannot be read,
   for that reason or any other, the look falls back to Latest and says so in
   the log. Off is the ordinary case, and off costs no API call at all. */

const RELEASES_API = 'https://api.github.com/repos/adriannlacko-collab/blueclient/releases?per_page=10';

/** The two files a release must carry to be an update this channel can take. */
const BUNDLE_FILES = ['bundle.json', 'bundle.tar.gz'];

/** Whether the player asked for updates early. Wired by setEarly(). */
let early = () => false;

function setEarly(getter) {
  early = typeof getter === 'function' ? getter : () => false;
}

function earlyWanted() {
  try {
    return Boolean(early());
  } catch {
    return false;
  }
}

/**
 * The newest release in a list that can actually be applied: not a draft,
 * carrying both bundle files, the highest version by newer(). Null when none
 * qualifies.
 */
function pickRelease(list) {
  let best = null;
  for (const release of Array.isArray(list) ? list : []) {
    if (!release || release.draft) continue;
    const files = {};
    for (const asset of Array.isArray(release.assets) ? release.assets : []) {
      if (asset && BUNDLE_FILES.includes(asset.name) && asset.browser_download_url) {
        files[asset.name] = asset.browser_download_url;
      }
    }
    if (!files['bundle.json'] || !files['bundle.tar.gz']) continue;
    const version = String(release.tag_name || '').trim().replace(/^v/i, '');
    if (!version) continue;
    if (!best || newer(version, best.version)) {
      best = {
        version,
        prerelease: Boolean(release.prerelease),
        manifest: files['bundle.json'],
        archive: files['bundle.tar.gz']
      };
    }
  }
  return best;
}

/**
 * Where this look reads the bundle from.
 *
 *   { manifest, archive, channel, version, prerelease }
 *
 * `channel` is 'latest' (the alias — the switch is off, or the list could
 * not be read), 'beta' (a pre-release chosen from the list) or 'release' (the
 * list's newest is a full release). `fetch` and `log` are injectable so
 * tools/check-beta-channel.js can run it over made-up lists.
 */
async function bundleSource(wantEarly, { fetch = fetchJson, log = note } = {}) {
  const latest = {
    manifest: `${BUNDLE_BASE}/bundle.json`,
    archive: `${BUNDLE_BASE}/bundle.tar.gz`,
    channel: 'latest',
    version: null,
    prerelease: false
  };
  if (!wantEarly) return latest;

  let list;
  try {
    list = await fetch(RELEASES_API, { limit: 512 * 1024 });
  } catch (error) {
    log('warn ', `early updates: the release list could not be read (${error && error.message}), taking Latest`);
    return latest;
  }

  const pick = pickRelease(list);
  if (!pick) {
    log('warn ', 'early updates: no release in the list carries a bundle, taking Latest');
    return latest;
  }
  return {
    manifest: pick.manifest,
    archive: pick.archive,
    channel: pick.prerelease ? 'beta' : 'release',
    version: pick.version,
    prerelease: pick.prerelease
  };
}

/** Where a downloaded bundle is unpacked before it is put in. */
function stagingDir() {
  return path.join(app.getPath('userData'), 'update-bundle');
}

/** Two Microsoft-signed tools in System32 do all the work this channel needs. */
function systemTool(name) {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);
}

/** Staged and verified, waiting for the launcher to close. Null until then. */
let staged = null;

/**
 * What the last swap was asked to do, and what its script said about it
 * (2026-09-20). The script used to leave no trace: a copy that did not take
 * — a file held open, a folder the account may not write, robocopy refused
 * — came back as a launcher on the old version, which found the same bundle
 * newer than itself, staged it, and offered "Restart to update" again, for
 * ever (a player's report, the day 1.3.2 went out: "it just opens the same
 * update and it goes on and on in a loop"). So the script writes its outcome
 * (`swap-<stamp>.result`: `ok`, or the step it failed at and cmd's error
 * level), `applyBundle` writes what it attempted here, and `start` reads
 * both on the next run: a version still older than the one attempted is a
 * failed swap, said in the log with the step, and counted. After two, the
 * bundle channel stands aside for that version and the installer channel is
 * asked instead — a different mechanism, which is the point.
 */
const ATTEMPTS_FILE = 'update-attempts.json';
const SWAP_GIVE_UP = 2;

function attemptsFile() {
  return path.join(app.getPath('userData'), ATTEMPTS_FILE);
}

function readAttempts() {
  try {
    const parsed = JSON.parse(fs.readFileSync(attemptsFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAttempts(record) {
  try {
    fs.writeFileSync(attemptsFile(), JSON.stringify(record, null, 2));
  } catch {
    /* Diagnostics never fail a swap. */
  }
}

/** The outcome the last swap script wrote, if it wrote one. */
function readSwapResult(resultFile) {
  try {
    return fs.readFileSync(resultFile, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * On start: did the last swap take? Called once with the running version.
 * A failed one is written down against its version; a successful one, or
 * any start on a version at or past the attempted one, clears the record.
 */
let settled = false;

function settleLastAttempt(currentVersion) {
  // Once per run: applyStagedAtStart asks before the window, start() after.
  if (settled) return;
  settled = true;
  const record = readAttempts();
  const last = record.last;
  if (!last || !last.version) return;
  const took = !newer(last.version, currentVersion);
  const result = last.result ? readSwapResult(last.result) : '';
  if (took) {
    note('info ', `bundle ${last.version}: the swap took (this is ${currentVersion}${result ? `, script said "${result}"` : ''})`);
    writeAttempts({});
    return;
  }
  const failures = (record.failed && record.failed[last.version] || 0) + 1;
  note('warn ', `bundle ${last.version}: the swap did not take — this is still ${currentVersion}; the script ${result ? `said "${result}"` : 'left no result'} (failure ${failures} of ${SWAP_GIVE_UP} before the installer is asked instead)`);
  writeAttempts({ failed: { ...(record.failed || {}), [last.version]: failures } });
}

/** True when the bundle channel has given up on this version. */
function swapGivenUp(version) {
  const record = readAttempts();
  return Boolean(record.failed && record.failed[version] >= SWAP_GIVE_UP);
}

/**
 * Can this user write beside app.asar at all? (2026-09-20)
 *
 * The installer offers "Install for anyone using this computer", which puts
 * BlueClient under Program Files, and the swap script runs as the plain user
 * on purpose (no prompt, nothing to judge) — so there its copy is refused
 * thirty times over, it exits before its relaunch line, and the launcher is
 * gone until the player opens it by hand, still on the old version, staging
 * the same bundle again. That was one player's whole experience of 1.3:
 * "every time they pressed restart to update, the launcher closed, and it
 * didn't open again … it was still on 1.3 and started saying updating again".
 * The installer channel can update such a copy — the installer asks for
 * elevation itself — so a folder this user cannot write sends the update
 * that way. Asked by trying: a temp file beside app.asar, made and removed;
 * fs.access on Windows only reads the read-only flag and says nothing about
 * who may write. Once per launcher run.
 */
let writableAnswer = null;

function installWritable() {
  if (writableAnswer !== null) return writableAnswer;
  const probe = path.join(process.resourcesPath, `.swap-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'probe');
    fs.unlinkSync(probe);
    writableAnswer = true;
  } catch (error) {
    note('warn ', `the install folder is not writable by this user (${error && error.code}); updates go through the installer`);
    writableAnswer = false;
  }
  return writableAnswer;
}

/**
 * The swap script already running for this exit, if one is. One per exit,
 * whatever asks: "Restart to update" quits the launcher, the quit fires
 * before-quit, and before-quit used to write a second script over the first
 * while cmd.exe was still reading it — two copies of app.asar racing, two
 * robocopies, and a relaunch that came up on the old files (2026-09-09, the
 * first bundle to reach a real machine: Adrian's own, which got the new
 * app.asar and kept the old mod jars).
 */
let swapScheduled = null;

/**
 * True when the resources beside app.asar are not this launcher's own.
 *
 * scripts/stamp-resources.mjs writes resources/bundle.version at build time,
 * so it rides in the installer and in the bundle alike. When it does not match
 * the launcher, the last swap only half landed — app.asar in, resources not —
 * and the bundle for this very version is taken again to finish the job.
 */
function resourcesStale(version) {
  try {
    const stamp = fs.readFileSync(path.join(process.resourcesPath, 'resources', 'bundle.version'), 'utf8').trim();
    return stamp !== version;
  } catch {
    return true;
  }
}

/* ------------------------------------------- a staged bundle, next start
   The update that went in on the close never came, because the close never
   came (2026-09-22, 1.9.1).

   1.9.0 ran on every machine and showed no window. Each copy still checked
   for updates, downloaded 1.9.1's bundle and staged it, verified, beside the
   settings — and there it sat: the swap goes in from before-quit, and a
   launcher nobody can see is never closed, only ended from Task Manager or
   taken down with Windows, and neither is a quit. Every one of those copies
   was one "open it again" away from being fixed, with the fix already on its
   disk, and nothing in it looked. Adrian: "they have to be able to just open
   their launcher and it works."

   So a start looks. Every staged bundle now carries a mark (STAGED_MARK, in
   its attempt folder: the version, the Electron it wants, whether it was a
   pre-release); the first thing a packaged launcher does, before its window,
   is read the newest mark, and a bundle that is still newer than this
   launcher, built for this Electron, not given up on and going into a folder
   this user can write, goes in right then — the same script as a close, told
   to relaunch, because the player just asked for the launcher and is about
   to get it. They see a pause of a few seconds and then the new version. A
   mark that no longer applies — the ordinary case after a close that swapped,
   where the launcher now IS that version — is wiped with its folder.

   The mark is taken (unlinked) before the script is started, so a second
   instance started in those seconds finds nothing to apply; the failure
   count that settleLastAttempt keeps still ends a swap that will not take
   after two tries, the same as from a close. */

const STAGED_MARK = 'staged.json';

/**
 * The newest staged bundle under the staging root, by its mark, or null.
 * Pure of Electron: the root is handed in, for tools/check-staged-start.js.
 */
function stagedOnDisk(root) {
  let best = null;
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const mark = path.join(root, entry, STAGED_MARK);
    try {
      const info = JSON.parse(fs.readFileSync(mark, 'utf8'));
      const dir = path.join(root, entry, 'new');
      if (!fs.existsSync(path.join(dir, 'app.asar'))) continue;
      const at = Number(entry) || 0;
      if (!best || at > best.at) {
        best = {
          at, dir, mark, folder: path.join(root, entry),
          version: String(info?.version || '').trim(),
          electron: String(info?.electron || '').trim(),
          prerelease: Boolean(info?.prerelease)
        };
      }
    } catch {
      /* Not a staged attempt, or half of one. */
    }
  }
  return best;
}

/**
 * Why a staged bundle found at start is NOT going in — or '' when it is.
 * The same gates checkBundle applies when it stages, asked again because
 * the launcher may have moved on since (an installer ran, the exe changed).
 */
function stagedStaleReason(found, currentVersion, electron, givenUp, writable) {
  if (!found.version) return 'its mark names no version';
  if (!newer(found.version, currentVersion)) return `this launcher is already ${currentVersion}`;
  if (found.electron !== electron) return `it wants electron ${found.electron}, this is ${electron}`;
  if (givenUp) return `${SWAP_GIVE_UP} swaps of it did not take on this machine`;
  if (!writable) return 'the install folder is not writable by this user';
  return '';
}

/**
 * Put in a bundle an earlier run staged and never applied. True when the
 * swap is running and the caller should quit at once, before any window.
 */
function applyStagedAtStart(currentVersion) {
  if (!(app.isPackaged && process.platform === 'win32')) return false;
  settleLastAttempt(currentVersion);
  const found = stagedOnDisk(stagingDir());
  if (!found) return false;
  const why = stagedStaleReason(found, currentVersion, process.versions.electron, swapGivenUp(found.version), installWritable());
  if (why) {
    note('info ', `bundle ${found.version} staged by an earlier run is not going in: ${why}`);
    wipe(found.folder);
    return false;
  }
  try {
    fs.unlinkSync(found.mark);
  } catch {
    return false;
  }
  staged = { dir: found.dir, version: found.version, prerelease: found.prerelease };
  const running = applyBundle(true);
  staged = null;
  if (!running) return false;
  note('info ', `bundle ${found.version}: staged by an earlier run that was never closed — going in now, before the window`);
  return true;
}

/**
 * Fetch a file to disk, following GitHub's redirect to its asset host.
 *
 * Progress is reported the same way electron-updater reports it, so the corner
 * of Home cannot tell which of the two channels it is watching.
 *
 * @returns {Promise<string>} the bundle's sha512, base64 — taken from the
 *   bytes as they go past, so checking the manifest costs no second read.
 */
function download(url, dest, onProgress, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));

    // Until the file is open a failure is only a rejection; after, it is
    // `fail` below, which closes the file first.
    let onFailure = reject;

    // A socket that goes quiet mid-download used to hold the corner at the same
    // percent for ever (2026-09-16): no bytes for a minute is a dead download,
    // and the next 20-minute check starts it again from nothing.
    const request = https().get(url, { headers: { 'user-agent': USER_AGENT }, timeout: 60_000 }, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return download(new URL(response.headers.location, url).toString(), dest, onProgress, depth + 1)
          .then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`bundle answered ${response.statusCode}`));
      }

      const total = parseInt(response.headers['content-length'] || '0', 10);
      let done = 0;
      const file = fs.createWriteStream(dest);
      // Hashed on the way past (2026-09-22): the bytes are already in hand, so
      // the manifest's sha512 costs nothing extra here — where it used to be a
      // second pass that read the whole 20 MB bundle back off the disk and
      // hashed it on main's only thread, with the window live in front of it.
      const hash = require('crypto').createHash('sha512');

      response.on('data', (chunk) => {
        done += chunk.length;
        hash.update(chunk);
        if (total) onProgress(Math.round((done / total) * 100));
      });
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(hash.digest('base64'))));

      /* A download that dies part-way closes its file before it says so
         (2026-09-22). A stalled or dropped socket unpipes the response and
         leaves the write stream open — nothing ends it — so every failed
         download kept a handle on its bundle.tar.gz for the life of the
         launcher, and checkBundle's wipe of the attempt folder, which runs the
         moment this rejects, could not take a folder with an open file in it
         on Windows. Measured with a server that goes quiet after the first
         kilobyte: one handle left open per failure before, none after. */
      let failed = false;
      const fail = (error) => {
        if (failed) return;
        failed = true;
        request.destroy();
        if (file.closed) {
          reject(error);
          return;
        }
        file.once('close', () => reject(error));
        file.destroy();
      };
      onFailure = fail;
      file.on('error', fail);
      response.on('error', fail);
    });

    request.on('error', (error) => onFailure(error));
    request.on('timeout', () => request.destroy(new Error('bundle download stalled')));
  });
}

/** Remove a directory and all of it, without caring whether it was there. */
function wipe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* The next run tries again. */
  }
}

/**
 * Look for a bundle, and stage it if it is one that can actually be applied.
 *
 * True when it has taken responsibility for this check — it staged something,
 * or there is nothing newer — and false when the caller should fall back to
 * the installer channel.
 */
async function checkBundle(currentVersion) {
  // Latest, or — with "Get updates early" on — the newest release there is.
  const source = await bundleSource(earlyWanted());

  let manifest;
  try {
    manifest = await fetchJson(source.manifest);
  } catch (error) {
    note('warn ', `no bundle manifest: ${error && error.message}`);
    return false;
  }

  const version = String(manifest?.version || '').trim();
  if (!version) return true;
  if (!newer(version, currentVersion)) {
    // Nothing newer — unless this very version is only half here.
    if (version !== currentVersion || !resourcesStale(currentVersion)) return true;
    note('info ', `bundle ${version}: the resources beside this launcher are not its own, taking it again`);
  }

  // A folder this user cannot write — an install for everyone on the PC —
  // is the installer's, which elevates; the swap never could.
  if (!installWritable()) return false;

  // Two swaps of this very version that came back on the old files: the
  // installer channel takes it from here (see settleLastAttempt).
  if (swapGivenUp(version)) {
    note('warn ', `bundle ${version}: ${SWAP_GIVE_UP} swaps did not take on this machine, leaving it to the installer`);
    return false;
  }

  // The one thing a file swap cannot do. Electron IS BlueClient.exe, so a
  // release that moves it has to go through the installer however painful that
  // is, and the corner falls back to saying so.
  if (String(manifest?.electron || '') !== process.versions.electron) {
    note('info ', `bundle ${version} wants electron ${manifest?.electron}, this is ${process.versions.electron} — installer instead`);
    return false;
  }
  if (!manifest?.sha512) {
    note('warn ', 'bundle manifest carries no sha512, refusing it');
    return false;
  }

  // A folder of its own per attempt. Wiping one shared folder failed whenever a
  // finished swap script was still open in cmd.exe, and the next tar then ran
  // into the leftovers; old attempts are cleared as far as they will go.
  const root = stagingDir();
  try {
    for (const entry of fs.readdirSync(root)) wipe(path.join(root, entry));
  } catch { /* nothing staged before */ }
  const dir = path.join(root, String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, 'bundle.tar.gz');

  set({ phase: 'downloading', version, percent: 0 });
  note('info ', `bundle ${version}: downloading${source.channel === 'beta' ? ' (a pre-release, asked for early)' : ''}`);

  try {
    const got = await download(source.archive, archive, (percent) => {
      set({ phase: 'downloading', percent });
    });

    if (got !== manifest.sha512) {
      throw new Error(`sha512 mismatch: wanted ${manifest.sha512.slice(0, 16)}…, got ${got.slice(0, 16)}…`);
    }

    // bsdtar, in System32 since Windows 10 1803 and signed by Microsoft, so
    // unpacking costs neither a dependency nor a binary of our own.
    const out = path.join(dir, 'new');
    fs.mkdirSync(out, { recursive: true });
    await new Promise((resolve, reject) => {
      const tar = spawn(systemTool('tar.exe'), ['-xzf', archive, '-C', out], { stdio: 'ignore' });
      tar.on('error', reject);
      tar.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
    });

    if (!fs.existsSync(path.join(out, 'app.asar'))) throw new Error('bundle carries no app.asar');

    staged = { dir: out, version, prerelease: source.prerelease };
    // Written down for a later start to find (applyStagedAtStart): a launcher
    // that is killed, crashes, or goes down with Windows never reaches
    // before-quit, and until 1.9.1 the bundle it had staged simply sat here.
    fs.writeFileSync(path.join(dir, STAGED_MARK), JSON.stringify({
      version, electron: String(manifest.electron), prerelease: Boolean(source.prerelease), at: Date.now()
    }));
    set({ phase: 'ready', version, percent: 100 });
    note('info ', `bundle ${version}: staged and verified`);
  } catch (error) {
    note('error', `bundle ${version} failed: ${error && error.message}`);
    wipe(dir);
    staged = null;
    set({ phase: 'idle', percent: 0 });
    return false;
  }

  return true;
}

/**
 * Put a staged bundle in, and say whether that started.
 *
 * The files being replaced belong to a running process — Windows holds
 * app.asar open for as long as the launcher is up — so the copy cannot happen
 * here. A short script waits for this process to exit and then does it, which
 * is the same shape electron-updater and Squirrel both use.
 *
 * Everything that executes is a Microsoft-signed tool already on the machine:
 * cmd.exe reads the script, tasklist watches for the exit, robocopy moves the
 * files. The script is data and the files it copies are data, so Smart App
 * Control has nothing to judge — which is the entire point of this channel.
 *
 * robocopy /MIR on resources rather than a plain copy, so a mod jar that a
 * release drops actually goes away instead of lingering for mods.js to find.
 *
 * `relaunch` is the difference between the two ways in. "Restart to update" is
 * a player asking for it now and expecting the launcher back; a swap that goes
 * in because they closed the launcher must not reopen it under them.
 */
function applyBundle(relaunch) {
  if (swapScheduled) return true;
  if (!staged) return false;

  const exe = app.getPath('exe');
  const name = path.basename(exe);
  const resources = process.resourcesPath;
  const stamp = Date.now();
  const script = path.join(stagingDir(), `swap-${stamp}.cmd`);
  const host = path.join(stagingDir(), `swap-${stamp}.js`);
  // Where the script says how it went — outside the staging folder, which the
  // next check wipes before this launcher has read it.
  const result = path.join(app.getPath('userData'), `swap-${stamp}.result`);
  const said = (what) => `echo ${what}> "${result}"`;

  /* Written without parenthesised blocks on purpose: cmd expands %tries%
     when it parses a block, not when it runs it, and a retry loop inside one
     never counts. The copy is retried for half a minute — the launcher's exit
     is waited for, but a virus scanner can hold a fresh file a moment longer —
     and the relaunch happens only after both copies succeeded, so a launcher
     that comes back is always the new one. robocopy counts 8 and up as failure.

     `ping` and not `timeout` for the waits: timeout reads the console, and
     dies at once with "Input redirection is not supported" whenever stdin is
     not one — which it never is here, since stdio is ignored. It had been
     failing instantly and turning both waits into hot loops that spun a core
     until the launcher closed. A ping to the loopback of n+1 packets waits n
     seconds and needs no console at all. */
  const lines = [
    '@echo off',
    /* The host above runs this launcher's exe as node, and everything under it
       inherits that — including the relaunch, which would come back as a node
       process with no window instead of as the launcher. Cleared here, in the
       one place every path to the relaunch passes through. */
    'set ELECTRON_RUN_AS_NODE=',
    /* The host's own process id, handed down as the first argument, and left
       out of the wait below — because the host IS BlueClient.exe, and the wait
       is for BlueClient.exe to be gone.

       Without this the script waits for the process it is running inside,
       which is never going to exit, because that process is waiting for this
       script. 0.13.2 and 0.13.3 both shipped it: the launcher closed on
       "Restart to update" and never came back, and a hidden pair of processes
       polled the machine for ever after (Adrian, 2026-09-09, on his laptop:
       "it just closes the program and nothing else happens"). It is the exact
       cost of the fix above — nothing was named BlueClient.exe in the old
       detached-cmd version, so the loop had nothing of its own to see.

       `pid ne` is a real tasklist filter and stacks with the image name;
       measured against the stuck pair on his laptop before it was written. */
    'set hostpid=%~1',
    'if not defined hostpid set hostpid=0',
    'set tries=0',
    'set waited=0',
    ':wait',
    `tasklist /fi "imagename eq ${name}" /fi "pid ne %hostpid%" | find /i "${name}" >nul`,
    'if errorlevel 1 goto copy',
    /* And five minutes is the end of it whatever happens. A launcher that
       somehow does not exit should leave a staged bundle for the next close,
       not a pair of processes polling a laptop's battery until it reboots. */
    'set /a waited+=1',
    `if %waited% geq 300 ${said('failed-wait: the launcher never closed')}`,
    'if %waited% geq 300 exit /b 1',
    'ping -n 2 127.0.0.1 >nul',
    'goto wait',
    ':copy',
    `copy /y "${path.join(staged.dir, 'app.asar')}" "${path.join(resources, 'app.asar')}" >nul`,
    'if not errorlevel 1 goto copied',
    'set /a tries+=1',
    `if %tries% geq 30 ${said('failed-copy: app.asar could not be written after 30 tries')}`,
    'if %tries% geq 30 exit /b 1',
    'ping -n 2 127.0.0.1 >nul',
    'goto copy',
    ':copied',
    `robocopy "${path.join(staged.dir, 'resources')}" "${path.join(resources, 'resources')}" /mir /njh /njs /ndl /nc /ns /np >nul`,
    `if errorlevel 8 ${said('failed-resources: robocopy failed (errorlevel %errorlevel%)')}`,
    'if errorlevel 8 exit /b 1',
    said('ok')
  ];
  if (relaunch) lines.push(`start "" "${exe}"`);

  /* Started through this launcher's own exe, running as plain node, and the
     batch hidden underneath it — because a black command prompt used to open
     over the desktop for the whole swap (Adrian, 2026-09-09: "command prompt
     opens whenever I click restart to update").

     The window is not incidental. `cmd.exe` is a console program, and the swap
     has to outlive the launcher, so it was spawned `detached` — which on
     Windows gives a child its own console window, and Node's documentation is
     explicit that once detached "it cannot be disabled". `windowsHide` there is
     ignored, and dropping `detached` kills the script the moment the launcher
     quits, which is the one thing it must survive. Both measured rather than
     assumed, with `tools/probe-spawn.js`.

     What breaks the deadlock is that only a *console* program needs a console:
     a GUI subsystem executable spawned detached shows nothing, and BlueClient.exe
     is one. With ELECTRON_RUN_AS_NODE it runs this little host script instead of
     the app — loading no app.asar, so locking nothing it is about to replace —
     and the batch is an ordinary hidden child of a parent that stays alive until
     it finishes. No window at any point, and the swap still outlives the
     launcher.

     It hands the script its own pid, because a host named BlueClient.exe is
     exactly what the script's wait loop is watching for — see there. */
  const hostLines = [
    "const { spawn } = require('child_process');",
    `const child = spawn(${JSON.stringify(systemTool('cmd.exe'))}, ['/c', ${JSON.stringify(script)}, String(process.pid)], { windowsHide: true, stdio: 'ignore' });`,
    "child.on('exit', (code) => process.exit(code === null ? 1 : code));",
    "child.on('error', () => process.exit(1));",
    ''
  ];

  try {
    fs.writeFileSync(script, lines.join('\r\n') + '\r\n');
    fs.writeFileSync(host, hostLines.join('\n'));
    const child = spawn(exe, [host], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    child.unref();
    swapScheduled = script;
    // What was attempted, for the next start to judge (settleLastAttempt).
    // The failure counts already held are kept.
    writeAttempts({ ...readAttempts(), last: { version: staged.version, at: Date.now(), result } });
    note('info ', `bundle ${staged.version}: swap running, quitting into it`);
    return true;
  } catch (error) {
    note('error', `bundle swap would not start: ${error && error.message}`);
    return false;
  }
}

/* -------------------------------------------------------------- the API */

/**
 * Begin watching for a newer BlueClient. Called once, from main, once the
 * window exists.
 *
 * `onState` is how the corner of Home hears about it. Home also asks with
 * get() every time it is painted, so a player who opens the launcher on
 * Settings and comes back to Home is not shown a stale corner.
 */
function start(onState, currentVersion) {
  publish = onState;
  if (started) return;
  started = true;

  // Only a packaged Windows build has an installer to replace itself with. A
  // dev run (`npm start`) has no app-update.yml and electron-updater rightly
  // refuses; it still gets the feed check, which is what every released 0.2.x
  // copy uses anyway and is worth being able to see while working on it.
  const canSelfUpdate = app.isPackaged && process.platform === 'win32' && attach();

  // Did the last "Restart to update" take? Judged before the first look, so
  // a swap that keeps coming back on the old files is seen and, after two,
  // routed round (see settleLastAttempt).
  if (canSelfUpdate) settleLastAttempt(currentVersion);

  if (!canSelfUpdate) {
    checkFeed(currentVersion);
    setInterval(() => {
      if (state.phase === 'idle') checkFeed(currentVersion);
    }, RECHECK_MS).unref();
    return;
  }

  const lookOnce = async () => {
    // Nothing to ask once one is on disk waiting, or already coming down.
    if (state.phase === 'ready' || state.phase === 'downloading') return;
    lastAsked = Date.now();
    // The bundle first. It is the channel that reaches a machine with Smart
    // App Control on, and the installer is what that machine refuses to run —
    // so the fallback order is the opposite of what it looks like it should be.
    if (await checkBundle(currentVersion)) return;
    // The installer channel follows the same switch: electron-updater reads
    // a pre-release's latest.yml only when the player asked for it.
    autoUpdater.allowPrerelease = earlyWanted();
    autoUpdater.checkForUpdates().catch(() => {});
  };

  /* One look at a time (2026-09-22). The phase guard above only holds once
     a download has begun, and before that a look spends up to twelve
     seconds reading the release list and the manifest — so "Get updates
     early" flipped in those seconds (recheck, which ignores the focus
     throttle) started a second checkBundle beside the first. The second
     wiped the staging folder the first was downloading into, both fetched
     the same bundle, and whichever failed last set `staged` back to null
     and the corner to idle over the other's staged copy. A look asked for
     while one is running now waits for it; recheck looks again after it,
     so the switch still decides the next look. And a look that throws —
     the staging folder refused, say — is written to update.log rather than
     left as an unhandled rejection. */
  const ask = () => {
    if (!looking) {
      looking = lookOnce().finally(() => { looking = null; });
      looking.catch((error) => note('error', `the look failed: ${error && error.message}`));
    }
    return looking;
  };

  // A staged bundle goes in when the player is finished with the launcher,
  // which is what autoInstallOnAppQuit does for the installer. No relaunch:
  // they closed it.
  app.on('before-quit', () => {
    if (staged) applyBundle(false);
  });

  look = ask;
  ask();
  setInterval(ask, RECHECK_MS).unref();
}

/**
 * Look now, if it has not been looked at very recently.
 *
 * Called when the launcher's window comes to the front. A player alt-tabbing
 * back to it is usually about to do one of two things — press Play, or close
 * it — and the second of those is when an update goes in, so it is worth
 * having asked by then. Throttled, because a window can be focused a great
 * many times in a minute and none of those are new information.
 */
function poke() {
  if (!look) return;
  if (Date.now() - lastAsked < FOCUS_MS) return;
  look();
}

/**
 * "Get updates early" was flipped: look now, whatever the focus throttle says.
 *
 * The switch decides what the NEXT look asks for and nothing more. A bundle
 * already staged stays staged — a beta on disk goes in on the next close, as
 * it would have — and an installer already coming down cannot be called back.
 * Both were considered and left alone (2026-09-11): undoing a staged
 * download is a second mechanism for a case that resolves itself on the next
 * release either way.
 */
function recheck() {
  if (!look) return Promise.resolve({ ok: false });
  lastAsked = 0;
  // A bundle coming down or on disk: nothing a look would do, as before.
  if (state.phase === 'ready' || state.phase === 'downloading') return Promise.resolve({ ok: true });
  // A look already under way read the switch before it was flipped: this
  // one follows it rather than joining it (see `ask` in start).
  const before = looking ? looking.catch(() => {}) : Promise.resolve();
  return before.then(() => look()).then(() => ({ ok: true }), () => ({ ok: false }));
}

/* ---------------------------------------------------------- what's new
   One sentence about the release, shown once (2026-09-11).

   The build writes the first line of NOTES.md into resources/notes.txt
   (scripts/stamp-resources.mjs), so it rides in the installer and in the
   bundle beside the jars, and after an update the launcher's own resources
   carry the sentence for the version they belong to. Home shows it in a
   capsule beside the version line until the player presses it or leaves the
   page; then it is written down as seen and never shown again.

   Seen is keyed on the SENTENCE, not the version. A hotfix that keeps the
   line (0.18.1 after 0.18.0 — the stamp only insists the line names the
   major.minor) shows nothing, because the player has read it; a release that
   rewrites the line shows the new one once. A copy with nothing written down
   yet — a first install, or the first update to carry this — stamps what it
   finds and says nothing: there is no "what's new" to catch up on. */

const NEWS_KEY = 'launcher.newsSeen';

/**
 * The one line about the player count, once per copy (2026-09-16). The ping
 * is on by default, and until this date nothing on screen said so: a player
 * found out by reading Settings › About, or never. So the first time a copy
 * paints Home — a fresh install, or the first start after this arrived — the
 * capsule beside the version line says it, in the same place and the same
 * way What's new does, and pressing it opens Settings › About where the
 * switch is. Dismissed, it is written down and never comes back; the What's
 * new line, if there is one, follows on the next paint.
 */
const PRIVACY_KEY = 'launcher.privacySeen';
const PRIVACY_LINE = 'BlueClient counts you as a player — an anonymous ping, nothing about you. Settings › About switches it off';

/** Where the stamped line sits: beside the jars, packaged or not. */
function notesFile() {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(base, 'resources', 'notes.txt');
}

function newsLine() {
  try {
    return fs.readFileSync(notesFile(), 'utf8').split(/\r?\n/)[0].trim();
  } catch {
    return '';
  }
}

/** `{ line, route? }` to show, or null for nothing. */
function news(store) {
  const line = newsLine();
  const seen = store.get(NEWS_KEY);
  // A copy with nothing written down stamps what it finds and says nothing
  // about the release — there is no "what's new" to catch up on.
  if (line && !seen) store.set(NEWS_KEY, line);
  if (!store.get(PRIVACY_KEY)) return { line: PRIVACY_LINE, route: 'settings', section: 'support' };
  if (!line || !seen) return null;
  return seen === line ? null : { line };
}

/** The capsule was pressed, or the page left: whatever it said is read. */
function newsSeen(store) {
  if (!store.get(PRIVACY_KEY)) {
    store.set(PRIVACY_KEY, true);
    return { ok: true };
  }
  const line = newsLine();
  if (line) store.set(NEWS_KEY, line);
  return { ok: true };
}

/** What the corner should be saying right now. */
function get() {
  return state;
}

/**
 * "Restart to update", pressed.
 *
 * Runs the installer over this copy with no wizard and starts the new one.
 *
 * <h2>Why this does not call quitAndInstall (2026-09-09)</h2>
 * It used to, and Adrian's report was "restart to update doesn't work".
 * electron-updater's quitAndInstall spawns the installer and quits the app in
 * the same tick — `doInstall` returns true the moment it has *called* spawn,
 * and `setImmediate(() => app.quit())` runs from there. A spawn that fails
 * reports asynchronously, by which time the launcher has already gone. From
 * the player's side the window vanishes, nothing installs, and they open the
 * old version again.
 *
 * That is not a hypothetical on this machine: `spawn UNKNOWN` is a standing
 * fault here — it takes out electron-builder's own NSIS step often enough
 * that the release ritual budgets for a retry — and it is exactly the error
 * class quitAndInstall cannot survive.
 *
 * So the launcher starts the installer itself and waits for Node to say the
 * process actually exists before quitting. Windows tells us within a
 * millisecond either way. If it started, we quit into it; if it did not, the
 * window is still there and the corner can say so instead of the launcher
 * disappearing.
 *
 * `autoInstallOnAppQuit` is switched off before quitting on purpose:
 * electron-updater's own quit handler would otherwise run a *second* copy of
 * the installer behind the one already going.
 *
 * The arguments are electron-updater's own (NsisUpdater.doInstall): --updated
 * tells the NSIS script this is an update rather than a first install, /S
 * keeps the wizard shut, --force-run starts the new launcher afterwards.
 */
function install() {
  if (state.phase !== 'ready') return Promise.resolve({ ok: false });

  // A staged bundle is the ordinary case and the cheap one: no executable
  // runs, so nothing can refuse it.
  if (staged) {
    if (!applyBundle(true)) return Promise.resolve({ ok: false });
    // Spent now, not after the quit: before-quit reads it and would otherwise
    // schedule the swap a second time on the way out.
    staged = null;
    setImmediate(() => app.quit());
    return Promise.resolve({ ok: true });
  }

  if (!autoUpdater) return Promise.resolve({ ok: false });

  const installer = autoUpdater.installerPath;
  if (!installer || !fs.existsSync(installer)) {
    note('error', `nothing to install: installerPath=${installer}`);
    return Promise.resolve({ ok: false });
  }

  return new Promise((resolve) => {
    let answered = false;
    const answer = (ok) => {
      if (answered) return;
      answered = true;
      resolve({ ok });
    };

    let child;
    try {
      child = spawn(installer, ['--updated', '/S', '--force-run'], {
        detached: true,
        stdio: 'ignore'
      });
    } catch (error) {
      note('error', `installer would not start: ${error && error.message}`);
      return answer(false);
    }

    child.once('error', (error) => {
      // The launcher is still up, which is the whole point of waiting.
      note('error', `installer would not start: ${error && error.code} ${error && error.message}`);
      answer(false);
    });

    child.once('spawn', () => {
      note('info ', `installer running: ${installer}`);
      child.unref();
      answer(true);
      // Let the IPC reply reach the renderer before the window goes.
      setImmediate(() => {
        autoUpdater.autoInstallOnAppQuit = false;
        app.quit();
      });
    });
  });
}

module.exports = {
  start, get, install, poke, newer, applyStagedAtStart,
  setEarly, recheck, news, newsSeen,
  /* For tools/check-beta-channel.js. */
  bundleSource, pickRelease, compareVersions, RELEASES_API, BUNDLE_BASE,
  /* For tools/check-staged-start.js (2026-09-22). */
  stagedOnDisk, stagedStaleReason, STAGED_MARK,
  /* For the swap-attempt check in the same tool (2026-09-20). */
  settleLastAttempt, swapGivenUp, SWAP_GIVE_UP, installWritable
};
