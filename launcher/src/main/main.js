'use strict';

const { VERSION } = require('./version');

const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

/* Node's compile cache, before the thirty-odd modules below are read
   (2026-09-22). Every start compiled the whole of main's JavaScript again
   from source — Chromium keeps a code cache for the page, and nothing kept
   one for main — and all of it happens before Electron's ready, so before
   the window can even be asked for. With the cache, V8 is handed the code it
   made last time: measured under Xvfb, the requires below went from about
   40 ms to about 25. It is keyed on each file's own contents, so a new
   app.asar simply compiles once and is cached again; a folder that cannot be
   written leaves it off and changes nothing else. Beside the settings, where
   an update's swap never reaches. */
try {
  require('module').enableCompileCache?.(path.join(app.getPath('userData'), 'compile-cache'));
} catch {
  /* A start without a cache is only a slower start. */
}

const { Store, defaults, suggestedMemory, migrateToSeven } = require('./store');
const { Launcher } = require('./launcher');
const install = require('./game/install');
const companion = require('./game/companion');
const memo = require('./game/memo');
const update = require('./update');
const stats = require('./stats');
const ledger = require('./ledger');
const presence = require('./presence');
const modrinth = require('./modrinth');
const importer = require('./game/import');
const packs = require('./game/packs');
const ping = require('./game/ping');
const serverIcons = require('./game/servericons');
const skins = require('./skins');
const skinSlots = require('./skinslots');
const skinFind = require('./skinfind');
const auth = require('./auth');
const gameSettings = require('./game/settings');
const crashes = require('./crashes');
const servers = require('./game/servers');
const favourites = require('./favourites');
const friends = require('./friends');
const backgrounds = require('./backgrounds');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const isDev = process.argv.includes('--dev');

// How long the launcher stays put after a game opens, so the row on Home can
// play its payoff wipe before the window gets out of the way. Matches
// --dur-live-flash in tokens.css with a couple of frames to spare; if that
// token moves, move this with it.
const LAUNCH_PAYOFF_MS = 340;

let win = null;
let store = null;
let launcher = null;

// Single instance — clicking the desktop shortcut twice should focus the
// existing window, not spawn a second launcher.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    // A window that never came forward comes forward now: the click on the
    // shortcut is the player asking for it (2026-09-22 — 1.9.0's hidden
    // window took the click and focus()ed a window nobody could see).
    if (revealWindow) revealWindow();
    // And one put away by "When the game starts: Hide" comes back too
    // (2026-09-22): Electron's focus() does nothing to a hidden window, so
    // with a game running the shortcut was the one way back to the launcher
    // and it did nothing at all.
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // Settings are read before the ready event on purpose: hardware
  // acceleration can only be disabled before ready — called any later,
  // Electron silently ignores it and the setting does nothing.
  adoptLegacyData();
  store = new Store(path.join(app.getPath('userData'), 'settings.json'), defaults());
  /* The migrations (2026-09-15). 0.38.0 shipped Background blur at 0 and,
     for the hour it was out, wrote that 0 into every settings file it
     touched — the window's bounds go through the same file — so the new
     default of 15 would never reach those copies on its own: a key the file
     has beats the default it is merged over. A file below schema 2 that
     still says 0 is moved to 15 once. 0.38.1 did the same with Background
     brightness at 100 for the hour before 80 became the default (schema 3),
     and 0.45.0 (2026-09-17, "put default brightness to 70%") moves a file
     still at 80 to 70 (schema 4). Then the file is stamped, and a player who
     sets either value after this keeps it. Each step tests the number the
     old default was, so a file that never had the key (merged, so already at
     the new default) is untouched. 1.2.0 (2026-09-18, evening; Adrian: "make
     it by default so the launcher doesnt minimise after the game has been
     launched") does the same with "When the game starts": a file below
     schema 5 still on Minimise — the default every copy was written with —
     is moved to Keep open; Hide is a choice nobody was given by default and
     is left alone. */
  const schema = store.get('schemaVersion') || 1;
  if (schema < 2 && store.get('launcher.worldBlur') === 0) store.set('launcher.worldBlur', 15);
  if (schema < 3 && store.get('launcher.worldBrightness') === 100) store.set('launcher.worldBrightness', 80);
  if (schema < 4 && store.get('launcher.worldBrightness') === 80) store.set('launcher.worldBrightness', 70);
  if (schema < 5 && store.get('launcher.onLaunch') === 'minimize') store.set('launcher.onLaunch', 'keep');
  if (schema < 5) store.set('schemaVersion', 5);
  /* Home's layout changed shape on 2026-09-21 (1.7.0: three columns — the
     four cards in two card columns, { skin, columns }); a file from before
     says { skin, side }. Keyed on the shape rather than a schema number, because
     the merge that writes a layout keeps the old keys beside the new ones
     and the 6 stamp below is written later and asynchronously — this must
     not jump it. An old layout is dropped, so the player gets the default
     and the next change writes the new shape whole. */
  const oldLayout = store.get('launcher.layout');
  if (oldLayout && typeof oldLayout === 'object' && !Array.isArray(oldLayout.columns)) {
    store.set('launcher.layout', null);
  }
  /* 6 (2026-09-20, 1.3.1): every set on the disk whose options.txt still
     carries vanilla's untouched cap — enableVsync:true with maxFps:120, the
     pair the first-launch seed copied in from the vanilla launcher's file for
     every copy from 1.0.0 to 1.3.0 — is uncapped once (game/settings.js,
     uncapUntouched; the "it got my fps from 200 to 60" reports). Run after
     the folders are known, below in whenReady; the stamp is written there. */
  // The answers the launch pipeline would otherwise fetch again every time.
  // Opened here, before anything can press Play.
  memo.init(app.getPath('userData'));
  serverIcons.init(app.getPath('userData'));
  backgrounds.init(app.getPath('userData'));
  // The starred clips and screenshots (2026-09-19) — see ./favourites.js.
  favourites.init(app.getPath('userData'));

  if (!store.get('launcher.gameDirectory')) {
    store.set('launcher.gameDirectory', path.join(app.getPath('userData'), 'instances'));
  }
  // Versions, libraries and assets are Mojang's own files and identical
  // whoever fetched them, so they live in the shared .minecraft rather than
  // being downloaded a second time under our own name.
  if (!store.get('launcher.rootDirectory')) {
    store.set('launcher.rootDirectory', defaultGameDirectory());
  }

  if (store.get('launcher.hardwareAcceleration') === false) {
    app.disableHardwareAcceleration();
  }

  // What the game is told about the launcher — see game/settings.js.
  syncFlags();
}

/**
 * Where the game puts a clip and where the Clips tab looks for one: a single
 * folder decided here and told to the game, so the two cannot disagree. It is
 * the Videos folder Windows keeps for exactly this, under the client's name.
 */
function clipsFolder() {
  return path.join(app.getPath('videos'), 'BlueClient Clips');
}

/**
 * The launcher's word to the in-game half: where clips go, and since
 * 2026-09-12 (evening) which cape to wear — a cape's word, "none", or empty
 * for the best one earned (the game checks the word against the level, so
 * the flag can only ever pick among what the record has earned). Since
 * 2026-09-13 the word for Yours carries the colours picked on Stats:
 * "yours:RRGGBB-RRGGBB-RRGGBB-B" — top, bottom, sparkles, and whether the B
 * is on it — spelled here exactly as play.js's capeWord spells it and the
 * mod's Capes.Colours reads it. Stamped into the profile's blueclient.json
 * as the game is about to open, and re-read here whenever the settings
 * change, so the Stats page's choice is what the next launch carries.
 */
function syncFlags() {
  gameSettings.setFlags({
    clipsFolder: clipsFolder(),
    cape: capeWord(),
    // The play record and the waypoints are the player's whichever profile
    // they play (game/settings.js, 2026-09-17): the game writes them here.
    ...gameSettings.recordFlags(store.get('launcher.gameDirectory'))
  });
}

function capeWord() {
  /* Declared here and not at module level: syncFlags() runs while this file
     is still loading (the settings block above), so a const further down the
     file is in its temporal dead zone at that moment — and a settings file
     whose cape was 'yours' threw "Cannot access 'HEX_COLOUR' before
     initialization" and the launcher never started (found 2026-09-17,
     present since 0.22.0; nobody had reached Level 100 to hit it). */
  const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
  const cape = store.get('play.cape');
  if (typeof cape !== 'string') return '';
  if (cape !== 'yours') return cape;
  const colours = store.get('play.colours') || {};
  const pick = (key, fallback) => (HEX_COLOUR.test(colours[key] || '') ? colours[key].slice(1).toLowerCase() : fallback);
  return `yours:${pick('top', '7c5cff')}-${pick('bottom', 'f9a8d4')}-${pick('spark', 'ffffff')}-${colours.letter === false ? 0 : 1}`;
}

/**
 * The app was called Beam until it was renamed, and productName is what
 * decides where Electron puts userData — so on the first run after the rename
 * the profiles, accounts and skin cache would all appear to have vanished.
 * Copy them across once, then never again.
 */
function adoptLegacyData() {
  const current = app.getPath('userData');
  if (fs.existsSync(path.join(current, 'settings.json'))) return;

  const legacy = path.join(path.dirname(current), 'Beam');
  if (legacy === current) return;
  if (!fs.existsSync(path.join(legacy, 'settings.json'))) return;

  try {
    fs.cpSync(legacy, current, { recursive: true });
  } catch (error) {
    console.warn('Could not carry over the previous data directory:', error.message);
  }
}

/**
 * Write a failed sign-in down where it can be read afterwards.
 *
 * The toast the player sees is short and fades, and console output disappears
 * with the terminal that launched the app. Which of the four links in the chain
 * broke is the only thing worth knowing later, so it goes to a file the player
 * can send on.
 */
function noteAuthFailure(error) {
  const detail = error.detail ? `  ${error.detail}` : '';
  const line = `${new Date().toISOString()}  ${error.code || 'auth_failed'}  ${error.message}${detail}
`;
  console.error('[auth] ' + line.trim());
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'auth-errors.log'), line);
  } catch {
    // Diagnostics must never be the reason something fails.
  }
}

/* =========================================================================
   One composition, drawn at whatever size the window is (2026-09-09)

   Adrian, with a screenshot of Home maximised: "I need this layout to be used
   in all sizes … on a large screen, everything just become larger and expands.
   on a small screen, everything become smaller. and it always maintains the
   kind of proportions I sent in the screenshot."

   The launcher is a composition, not a document — Home is a fixed 1041x670
   block of world with a player standing in it, and every metric on the page is
   a share of that. Reflowing it is what breaks the picture, so the window does
   not reflow it: it scales it. The zoom factor is the window's content size
   over the size the screen was designed at, taking the SMALLER of the two
   ratios so the block fits rather than crops, and Chromium re-lays out and
   re-rasterises at that scale — type, radii, hairlines, blur and the world's
   own canvas all move together, and every one of them stays crisp. A CSS
   transform would have scaled a bitmap; `zoom` in the sheets would have left
   position:fixed popovers and viewport units behind.

   What this does to the renderer is nothing at all, which is the point: at any
   window bigger than the floor below, the CSS viewport it sees is the design
   size, so no media query fires and no layout ever moves. The breakpoints in
   pages.css are what happens UNDER the floor, where the block would be too
   small to read if it kept shrinking, and they are still the right answer
   there.

   DESIGN is the window Adrian photographed: 1917x1017 device pixels at the
   125% Windows scaling he runs, which is 1533x814 of the DIPs
   getContentBounds reports. Change it only with a new screenshot to match.  */
const DESIGN = { width: 1533, height: 814 };

/* Rails, not policy. Past 2x a launcher is a museum piece; under 0.72 the
   14px type is going illegible, and the app can be dragged down to 1000x560.
   Below the floor the window narrows the CSS viewport instead, which is what
   the breakpoints are for. */
const ZOOM_MIN = 0.72;
const ZOOM_MAX = 2;

/* The zoom for a window this size — rounded to the hundredth so a one-pixel
   drag does not re-rasterise the whole window. */
function zoomFor(width, height) {
  const fit = Math.min(width / DESIGN.width, height / DESIGN.height);
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit)) * 100) / 100;
}

/* Set only once the window has been shown (2026-09-22, 1.9.1). Under
   Electron 44 a setZoomFactor call that lands before the page's first paint —
   any value, even the one it already has — leaves the renderer without a
   first frame: no paint, no requestAnimationFrame, and so no ready-to-show,
   and a window created hidden stays hidden for ever. That was 1.9.0 on every
   machine: the launcher ran, the title changed, nothing appeared. Electron 32
   took the same call in its stride. The first load's zoom now goes in through
   webPreferences.zoomFactor (createWindow), which Chromium applies before it
   paints, and this corrects it once the frame exists. */
let shown = false;
/** Brings the window forward once, whoever asks. Set by createWindow. */
let revealWindow = null;

function fitZoom() {
  if (!win || win.isDestroyed() || !shown) return;
  const { width, height } = win.getContentBounds();
  if (!width || !height) return;
  const stepped = zoomFor(width, height);
  // Compared against what the page actually has, not a note of what was last
  // sent: Chromium keeps a zoom level per host across sessions, and a saved
  // level from a different screen is what the page comes up at whatever the
  // constructor asked for. setZoomFactor resizes the CSS viewport rather than
  // the window — the renderer's resize, not this one — so there is no loop.
  if (stepped === Math.round(win.webContents.getZoomFactor() * 100) / 100) return;
  win.webContents.setZoomFactor(stepped);
}

/**
 * Whether a window put back where it last was could be reached there
 * (2026-09-22). The position is saved as the window moves and handed back
 * to the constructor as it is, and neither Electron nor Windows moves a
 * window that lands outside every screen — so a launcher last closed on a
 * second monitor, opened on the laptop alone, came up at x 2400 of a
 * 1920-wide desktop: running, on the taskbar, and nowhere to be seen, the
 * one failure a player cannot get past. The window is frameless and is
 * dragged by its own top edge, so what has to be on a screen is that: a
 * strip along the top at least 120 pixels wide and 20 deep inside some
 * display's work area. Otherwise the saved position is left out and the
 * window opens centred on the primary display, at its saved size.
 */
function reachable({ x, y, width }) {
  const strip = { x, y, width: Math.max(1000, width), height: 40 };
  return screen.getAllDisplays().some(({ workArea: area }) => {
    const across = Math.min(strip.x + strip.width, area.x + area.width) - Math.max(strip.x, area.x);
    const down = Math.min(strip.y + strip.height, area.y + area.height) - Math.max(strip.y, area.y);
    return across >= 120 && down >= 20;
  });
}

function createWindow() {
  const saved = store.get('window') || {};
  const bounds = {
    width: saved.width || 1180,
    height: saved.height || 608
  };
  if (Number.isInteger(saved.x) && Number.isInteger(saved.y) && reachable({ x: saved.x, y: saved.y, width: bounds.width })) {
    bounds.x = saved.x;
    bounds.y = saved.y;
  }

  // The zoom the first frame is painted at, worked out from the size the
  // window is about to be: the saved bounds held to the floor below, or the
  // work area of the screen a maximised window is about to fill. The frame is
  // the window, so the content size is the window size. See fitZoom for why
  // this cannot be a setZoomFactor call after the load.
  let first = { width: Math.max(1000, bounds.width), height: Math.max(560, bounds.height) };
  if (saved.maximized) {
    const display = bounds.x !== undefined ? screen.getDisplayMatching({ ...bounds }) : screen.getPrimaryDisplay();
    first = display.workAreaSize;
  }

  win = new BrowserWindow({
    ...bounds,
    minWidth: 1000,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#0a0e13',
    title: 'BlueClient',
    // The .ico rather than the .png: it carries the mark cut at seven sizes,
    // and the taskbar button is 24 device pixels. Handed a 256px PNG, Windows
    // scaled it down itself and the bevel went to mush.
    // blueclient-bolt.ico since 2026-09-21 evening: the mark changed to the bolt,
    // and the file's name changes with the mark (the icon-cache trap below).
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'blueclient-bolt.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // On since 2026-09-16: the preload reaches for contextBridge and
      // ipcRenderer and nothing else, which is exactly what a sandboxed
      // preload is allowed, and a renderer that draws only its own files
      // has no reason to stand outside Chromium's sandbox.
      sandbox: true,
      spellcheck: false,
      // The launcher minimises itself while the game downloads, and Chromium
      // freezes timers and animations in a background window. Without this the
      // progress bar stops moving exactly when nobody can see it recover.
      backgroundThrottling: false,
      zoomFactor: zoomFor(first.width, first.height)
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // The window comes forward once, from ready-to-show — or, if that never
  // comes, from a timer started at the end of the load. A launcher that runs
  // and shows nothing is the one failure a player cannot get past, and
  // Electron 44 found a way to it (fitZoom); whatever the next way is, this
  // brings the window up a few seconds late with a note in the error log
  // rather than never. Showing the window is also what starts the renderer
  // painting again, so nothing about the page is lost by it.
  let reveal = () => {
    reveal = () => {};
    revealWindow = null;
    shown = true;
    if (!win || win.isDestroyed()) return;
    if (saved.maximized) win.maximize();
    fitZoom();
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  };
  revealWindow = () => reveal();
  win.once('ready-to-show', () => reveal());
  // The work that waits for Home (startBackground): a moment after the page
  // has loaded, or at the latest a few seconds from now.
  win.webContents.once('did-finish-load', () => setTimeout(startBackground, SETTLE_MS));
  setTimeout(startBackground, SETTLE_CAP_MS);
  win.webContents.on('did-finish-load', () => {
    if (shown) { fitZoom(); return; }
    setTimeout(() => {
      if (shown || !win || win.isDestroyed()) return;
      noteCrash('no-first-paint', new Error('ready-to-show never came; the window was shown on the timer'));
      reveal();
    }, 3000);
  });
  // And from the window's creation, for a page that never finishes loading:
  // the timer above never starts then. A window with nothing on it can at
  // least be closed, and closing is what lets a staged update in.
  setTimeout(() => {
    if (shown || !win || win.isDestroyed()) return;
    noteCrash('no-load', new Error('the page never finished loading; the window was shown on the timer'));
    reveal();
  }, 15000);
  // A renderer that dies before the window is up is given one more go.
  let reloaded = false;
  win.webContents.on('render-process-gone', (event, details) => {
    noteCrash('renderer-gone', new Error(`the renderer went (${details?.reason}); ${reloaded || shown ? 'left as it is' : 'reloading once'}`));
    if (reloaded || shown || !win || win.isDestroyed()) return;
    reloaded = true;
    win.webContents.reload();
  });

  const persistBounds = debounce(() => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const isMax = win.isMaximized();
    store.merge({ window: { maximized: isMax, ...(isMax ? {} : normalize(win.getBounds())) } });
  }, 400);

  win.on('resize', persistBounds);
  win.on('resize', fitZoom);
  win.on('move', persistBounds);
  win.on('maximize', () => { fitZoom(); send('window:state', { maximized: true }); });
  win.on('unmaximize', () => { fitZoom(); send('window:state', { maximized: false }); });
  win.on('enter-full-screen', fitZoom);
  win.on('leave-full-screen', fitZoom);
  win.on('closed', () => { win = null; });

  // External links open in the real browser, never inside the launcher.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Bytes under a folder, zero for one that is not there. Follows no links. */
async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) {
      try { total += (await fs.promises.stat(full)).size; } catch { /* gone */ }
    }
  }
  return total;
}

function normalize({ x, y, width, height }) {
  return { x, y, width, height };
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * The folder of in-game mod jars that ships with the launcher.
 *
 * One per Minecraft generation (`mod/versions.json` there, `resources/mod/`
 * here), because the in-game half is built for each of them separately.
 * Nothing outside `game/companion.js` counts them or names them: it opens each
 * jar and asks what it runs on.
 *
 * Packaged builds put the folder beside the app under resources/; in
 * development it sits in the repo where `npm run mod:build` drops it.
 */
function companionDir() {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(base, 'resources', 'mod');
}

/** The shaderpack, once, beside the jars — see game/shaderpack.js. */
function packDir() {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(base, 'resources', 'shaderpack');
}

/**
 * The shortcuts on the desktop and in the Start menu take their icon from
 * BlueClient.exe, and a data-only update (src/main/update.js) never replaces
 * the exe — so when the mark changed on 2026-09-14, Adrian's desktop kept the
 * icon of the 0.11.2 installer he had last run, with 0.35.0 inside it. This
 * repoints every shortcut of ours at the .ico that rides in resources/
 * (scripts/make-icon.mjs writes it), which is a new path each time the mark
 * changes and so a guaranteed miss in Windows' icon cache. Once per shortcut:
 * a shortcut already on the file is left alone, and one that is not ours
 * (a different target) is never touched.
 */
const SHORTCUT_ICON = 'icon-bolt.ico';   // the bolt, since 2026-09-21 evening; icon-white-b.ico before
function refreshShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const icon = path.join(process.resourcesPath, 'resources', SHORTCUT_ICON);
  if (!fs.existsSync(icon)) return;
  const exe = process.execPath.toLowerCase();
  const home = app.getPath('home');
  const places = [
    app.getPath('desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
  ];
  for (const dir of places) {
    const lnk = path.join(dir, 'BlueClient.lnk');
    try {
      if (!fs.existsSync(lnk)) continue;
      const link = shell.readShortcutLink(lnk);
      if ((link.target || '').toLowerCase() !== exe) continue;
      if ((link.icon || '').toLowerCase() === icon.toLowerCase()) continue;
      shell.writeShortcutLink(lnk, 'update', { icon, iconIndex: 0 });
    } catch (err) {
      console.warn('[shortcuts] could not update', lnk, err.message);
    }
  }
}

function defaultGameDirectory() {
  if (process.platform === 'win32') return path.join(app.getPath('appData'), '.minecraft');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft');
  return path.join(os.homedir(), '.minecraft');
}

/**
 * The launcher's own crash net (2026-09-16). An exception nobody caught in
 * main used to bring up Electron's raw "A JavaScript error occurred in the
 * main process" box with a stack trace in it, and take the launcher down
 * with a game possibly still running. Now it is written to
 * launcher-errors.log beside the settings, said once in the launcher's own
 * words, and the launcher stays up — the game is a separate process and
 * nothing about an error here should cost it. A rejection nobody handled is
 * only written down; there is no player to tell about a promise.
 */
function noteCrash(kind, error) {
  const line = `${new Date().toISOString()}  ${kind}  ${error?.stack || error}
`;
  console.error('[main] ' + line.trim());
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'launcher-errors.log'), line);
  } catch {
    // Diagnostics must never be the reason something fails.
  }
}

let crashSaid = false;
process.on('uncaughtException', (error) => {
  noteCrash('uncaught', error);
  if (crashSaid || !app.isReady()) return;
  crashSaid = true;
  dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: 'error',
    title: 'BlueClient',
    message: 'Something went wrong in the launcher.',
    detail: `It is written down in launcher-errors.log, in the BlueClient folder under AppData. A running game is not affected. If it keeps happening, send that file to hello@blueclient.net.

${String(error?.message || error).slice(0, 300)}`,
    buttons: ['OK']
  }).catch(() => {}).finally(() => { crashSaid = false; });
});
process.on('unhandledRejection', (reason) => noteCrash('unhandled', reason));

app.whenReady().then(() => {
  // The second instance quits without ever building a store.
  if (!store) return;

  // A bundle an earlier run staged and never applied — a launcher ended from
  // Task Manager, crashed, or taken down with Windows never reaches the
  // close that puts it in — goes in now, before anything else, and the
  // launcher comes back on it (update.js, applyStagedAtStart). This is what
  // makes "close it and open it again" the way out of a launcher that runs
  // and shows nothing (2026-09-22).
  if (update.applyStagedAtStart(VERSION)) {
    app.quit();
    return;
  }

  // Windows groups taskbar buttons, jump lists and pinned shortcuts by this
  // id. Without it a launcher started from a shortcut is a different app to
  // Windows than the shortcut is, which is how a window ends up wearing the
  // icon of whatever executable happened to start it (2026-09-03: Adrian was
  // still seeing the old mark on the desktop and in the taskbar). It has to
  // match the appId electron-builder stamps into the installer.
  if (process.platform === 'win32') app.setAppUserModelId('net.blueclient.launcher');

  launcher = new Launcher({
    store,
    root: store.get('launcher.rootDirectory'),
    instances: store.get('launcher.gameDirectory'),
    javaDir: path.join(app.getPath('userData'), 'java'),
    logDir: path.join(app.getPath('userData'), 'logs'),
    companionDir: companionDir(),
    packDir: packDir(),
    errorLog: path.join(app.getPath('userData'), 'launcher-errors.log')
  });

  registerIpc();
  createWindow();

  // Bringing the launcher to the front is the moment before a player presses
  // Play or closes it, and closing it is when an update goes in. Throttled in
  // update.js, so this cannot become a request per focus event — and a no-op
  // until the watching below has started.
  if (win) win.on('focus', () => update.poke());

  // The friends list for Home's Friends card (src/main/friends.js): the
  // launcher signs in to the friends backend the way the game does, with
  // the account's own Mojang-signed documents, and only ever reads. Wired
  // now, not with the rest below: the card asks in Home's first second.
  friends.init({ store, launcher });

  /* A launcher from before sync groups kept every profile's settings in one
     folder (game/settings.js, 2026-09-17): that set becomes a group of every
     profile that existed, once, so nobody's settings change on the day this
     lands. It takes the same lane the launch does, so a Play press waits for
     it rather than reading a set halfway through its move. */
  gameSettings.migrate(
    store.get('launcher.gameDirectory'),
    (store.get('profiles') || []).map((p) => p && p.id).filter(Boolean)
  ).catch(() => {}).then(async () => {
    // Schema 6: the one-time uncap (see the migrations beside the store).
    let schema = store.get('schemaVersion') || 1;
    if (schema < 6) {
      const turned = await gameSettings.uncapUntouched(store.get('launcher.gameDirectory')).catch(() => 0);
      if (turned) console.log(`[settings] uncapped ${turned} options.txt still on vanilla's VSync and 120`);
      store.set('schemaVersion', 6);
      schema = 6;
    }
    /* 7 (2026-09-22): the Java options field held the default flags as text
       from the first day, so a new default reached nobody — a file still
       saying exactly that string is moved to empty, which install.js reads
       as "the launcher's own flags for this Java"; anything else typed there
       is the player's and stays. And the memory default on a machine with 8 GB
       or less is 3 GB now (store.js, suggestedMemory): a file still on the
       old formula's answer for this PC moves with it, a number the player
       set stays. After the 6 stamp, in the same chain, so neither jumps the
       other. */
    const moved = migrateToSeven(store, install.OLD_DEFAULT_JVM_ARGS);
    if (moved.length) console.log('[settings] schema 7: ' + moved.join(', ') + ' moved to the new default');
  });

  // This launcher's two pages of the skin crawl, a couple of minutes from
  // now (src/main/skinfind.js, seedIndex).
  skinFind.seedIndex();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* =========================================================================
   What waits for Home (2026-09-22)

   Everything main started in the same breath as the window used to run on
   the one thread the window's own loading needs: Electron's UI thread is
   main's JavaScript thread, and the navigation, the renderer's start and
   every IPC answer Home's first paint waits on are tasks queued behind it.
   Measured under Xvfb, the whenReady callback held that thread for about a
   hundred milliseconds after createWindow — launcher.prime() alone was 27
   ms of synchronous work before its first await — and on a packaged Windows
   build update.start() also requires electron-updater, which took about 110
   ms to load on the machine this was measured on. None of it is needed for
   the first frame. Moved here, the page's dom-ready came about 60 ms sooner
   and Home was painted about 50–100 ms sooner (median of ten runs each).

   So it starts once the page has loaded and Home has had a moment to draw
   itself from what it asked for, and never later than a few seconds after
   the window was made — a page that never finishes loading (the case
   createWindow's own timers are for) must not also stop the updater, which
   is the way out of a broken release (update.js, applyStagedAtStart). The
   order inside is the order it always had. */
const SETTLE_MS = 1500;
const SETTLE_CAP_MS = 6000;
let settled = false;

function startBackground() {
  if (settled || !launcher) return;
  settled = true;

  // The shortcuts' icon (refreshShortcuts): a handful of synchronous shell
  // calls on Windows, and nothing a first frame needs. Caught, because
  // whatever a shell folder does must not keep the updater below from
  // starting.
  try {
    refreshShortcuts();
  } catch (error) {
    noteCrash('shortcuts', error);
  }

  // Watch for a newer BlueClient and fetch it in the background (src/main/
  // update.js). After createWindow because the first thing it can report —
  // "already downloaded, restart to update", from a check that ran last
  // session — would otherwise be sent at nothing; Home also asks with get()
  // whenever it paints the corner, so a late start loses no state.
  update.start((payload) => send('update:state', payload), VERSION);

  // Count this launcher, anonymously, for the admin site (src/main/stats.js).
  // After the launcher exists because the games it has open are read off it.
  stats.start(store, launcher);

  // "Playing BlueClient" under the player's name in Discord (src/main/
  // presence.js). Nothing leaves the machine; it is a pipe to the Discord
  // already running here, and does nothing on a PC without one.
  presence.start(launcher);

  // The offline accounts' own skins the index has not taken yet, offered
  // again (skinslots.js, syncOwn). Here rather than beside skins.init: the
  // first fetch() in a run loads Node's HTTP client, some 35 ms on this
  // thread, and that was landing before the window was even asked for.
  skinSlots.syncOwn().catch(() => {});

  // What the first Play press would otherwise have to do at the press —
  // stamping the shaderpack, reading the jars, renewing an aged sign-in,
  // giving Mojang's Java the class archive it ships without — done now,
  // while the player is still looking at Home (launcher.js, 2026-09-10). A
  // press that beats it does each of these itself, as it always could.
  launcher.prime();
}

app.on('window-all-closed', () => {
  if (store) store.flush();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (store) store.flush();
  presence.stop();
});

function registerIpc() {
  // ---- window controls -------------------------------------------------
  ipcMain.on('window:minimize', () => win && win.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => win && win.close());
  ipcMain.handle('window:is-maximized', () => (win ? win.isMaximized() : false));

  // ---- settings --------------------------------------------------------
  ipcMain.handle('settings:get', () => store.all);
  ipcMain.handle('settings:merge', (_e, patch) => {
    const merged = store.merge(patch);
    syncFlags();
    return merged;
  });
  ipcMain.handle('settings:reset', () => {
    const fresh = store.reset();
    store.set('launcher.gameDirectory', path.join(app.getPath('userData'), 'instances'));
    return fresh;
  });

  // ---- system info -----------------------------------------------------
  ipcMain.handle('system:info', () => ({
    platform: process.platform,
    arch: process.arch,
    totalMemoryMb: Math.floor(os.totalmem() / (1024 * 1024)),
    suggestedMemoryMb: suggestedMemory(),
    cpu: (os.cpus()[0] || {}).model || 'Unknown CPU',
    appVersion: VERSION,   // package.json, not app.getVersion(): under a bare electron binary that is Electron's own number
    electron: process.versions.electron,
    defaultGameDirectory: defaultGameDirectory()
  }));

  // ---- shell helpers ---------------------------------------------------
  ipcMain.handle('shell:pick-directory', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('shell:pick-java', async () => {
    const filters = process.platform === 'win32'
      ? [{ name: 'Java executable', extensions: ['exe'] }]
      : [{ name: 'All files', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('shell:open-path', async (_e, target) => {
    if (!target || typeof target !== 'string') return false;
    // A folder, only ever (2026-09-16): every caller is a "Folder" button,
    // and shell.openPath handed an executable would run it. The folder is
    // made if it is not there yet — a profile's mods folder before the
    // first launch — and anything that turns out to be a file is refused.
    try { fs.mkdirSync(target, { recursive: true }); } catch { /* exists, or a file */ }
    try {
      if (!fs.statSync(target).isDirectory()) return false;
    } catch {
      return false;
    }
    await shell.openPath(target);
    return true;
  });
  ipcMain.handle('shell:open-external', async (_e, url) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
    return true;
  });

  // ---- clips -----------------------------------------------------------
  // The videos the game saved on its clip key. The renderer
  // only ever names a clip, never a path: every name is resolved against the
  // one folder they live in and refused if it lands anywhere else.
  const clipFile = (name) => {
    const folder = clipsFolder();
    const target = path.resolve(folder, path.basename(String(name || '')));
    if (!target.toLowerCase().endsWith('.mp4')) return null;
    if (path.dirname(target) !== folder) return null;
    return target;
  };
  /* The play ledger the companion mod keeps — see ./ledger.js. Read-only, and
     an empty list is the ordinary answer for anyone who has not played yet. */
  ipcMain.handle('ledger:recent', (_event, limit) =>
    ledger.recent(store.get('launcher.gameDirectory'), limit));

  /* The same record as the last seven days, each with its places and
     sittings, plus the streak and the records — what Your play and Stats
     draw. Sessions, not places: see ./ledger.js. */
  ipcMain.handle('ledger:summary', () =>
    ledger.summary(store.get('launcher.gameDirectory')));

  /* The week as a picture on the clipboard (2026-09-12): the Stats page asks
     for its own card's rectangle, in CSS pixels, and gets it photographed out
     of the live page — glass, world and all — so what is pasted into Discord
     is exactly what was on screen. The renderer sees a 1533-wide viewport
     whatever the window is (fitZoom), so its pixels are scaled by the zoom
     before they mean anything to capturePage. Nothing is written anywhere. */
  ipcMain.handle('ledger:snapshot', async (event, rect) => {
    const contents = event.sender;
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false;
    const zoom = contents.getZoomFactor();
    const box = {
      x: Math.max(0, Math.floor(rect.x * zoom)),
      y: Math.max(0, Math.floor(rect.y * zoom)),
      width: Math.ceil(rect.width * zoom),
      height: Math.ceil(rect.height * zoom)
    };
    try {
      const image = await contents.capturePage(box);
      if (image.isEmpty()) return false;
      clipboard.writeImage(image);
      return true;
    } catch (error) {
      console.warn('stats snapshot failed:', error?.message || error);
      return false;
    }
  });

  // ---- clip stills (2026-09-15) ----------------------------------------
  // A clip card is dark until its video has decoded a frame, and the Clips
  // tab builds its cards afresh on every visit, so the grid went black for a
  // moment on every switch to it (Adrian: "the clips lagg like they are
  // black for a tiny second"). Each clip now has a still — one frame, taken
  // once by the same ffmpeg the game recorded it with, kept here under the
  // clip's name, size and date — and the list hands it to the card as the
  // video's poster, so the picture is on screen before the decoder is. A
  // still that is missing is made in the background after the list answers,
  // newest clip first, and announced to the page as it lands; a machine with
  // no encoder has no stills and the cards behave as they did.
  const stillsDir = path.join(app.getPath('userData'), 'clip-stills');
  const encoderExe = path.join(app.getPath('appData'), 'BlueClient', 'ffmpeg', 'ffmpeg.exe');
  const stillFor = (name, stat) => path.join(stillsDir,
    crypto.createHash('sha1').update(`${name}|${stat.size}|${Math.floor(stat.mtimeMs)}`).digest('hex') + '.jpg');
  const stillsPending = new Map();       // still path -> { file, name }, in the order asked
  let stillRunning = false;
  function makeStills() {
    if (stillRunning) return;
    const next = stillsPending.entries().next();
    if (next.done) return;
    const [still, { file, name }] = next.value;
    stillsPending.delete(still);
    if (!fs.existsSync(encoderExe)) { stillsPending.clear(); return; }
    const part = `${still}.part.jpg`;
    try { fs.mkdirSync(stillsDir, { recursive: true }); } catch { return; }
    stillRunning = true;
    execFile(encoderExe, [
      '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-ss', '0.05', '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', part
    ], { timeout: 20000, windowsHide: true }, (error) => {
      stillRunning = false;
      try {
        if (!error && fs.existsSync(part)) {
          fs.renameSync(part, still);
          send('clips:still', { name, still: pathToFileURL(still).href });
        } else {
          fs.rmSync(part, { force: true });
        }
      } catch { /* the folder went; the next list asks again */ }
      makeStills();
    });
  }
  /* Stills of clips that are gone go with them; a still is only ever
     reached through the list, so nothing else can be holding one. */
  function sweepStills(keep) {
    let names = [];
    try { names = fs.readdirSync(stillsDir); } catch { return; }
    for (const name of names) {
      if (name.endsWith('.part.jpg')) continue;
      const still = path.join(stillsDir, name);
      if (!keep.has(still) && !stillsPending.has(still)) fs.rm(still, { force: true }, () => {});
    }
  }

  /* How long a clip is, read from the file's own header so the page can say
     so without opening a decoder (2026-09-15, evening). A card at rest is a
     still now, not a video, and the length used to come from the video's
     metadata. An MP4's moov box holds an mvhd with a timescale and a
     duration in it; ffmpeg writes the moov after the mdat, so this walks the
     top-level boxes by their sizes — three or four small reads, never the
     picture data. Remembered by name, size and date, the still's own key,
     so a list costs nothing for a clip it has seen. */
  const lengths = new Map();             // still path -> seconds, or null
  async function clipLength(file) {
    let handle;
    try {
      handle = await fs.promises.open(file, 'r');
      const read = async (at, n) => {
        const buffer = Buffer.alloc(n);
        const { bytesRead } = await handle.read(buffer, 0, n, at);
        return bytesRead === n ? buffer : null;
      };
      const { size: end } = await handle.stat();
      let at = 0;
      while (at + 8 <= end) {
        const head = await read(at, 16);
        if (!head) return null;
        let size = head.readUInt32BE(0);
        let body = 8;
        if (size === 1) { size = Number(head.readBigUInt64BE(8)); body = 16; }
        else if (size === 0) size = end - at;
        if (size < body) return null;
        if (head.toString('latin1', 4, 8) === 'moov') {
          let inner = at + body;
          const stop = Math.min(at + size, end);
          while (inner + 8 <= stop) {
            const child = await read(inner, 8);
            if (!child) return null;
            const childSize = child.readUInt32BE(0);
            if (childSize < 8) return null;
            if (child.toString('latin1', 4, 8) === 'mvhd') {
              const box = await read(inner + 8, Math.min(childSize - 8, 32));
              if (!box || box.length < 20) return null;
              const version = box[0];
              if (version === 1 && box.length < 32) return null;
              const scale = version === 1 ? box.readUInt32BE(20) : box.readUInt32BE(12);
              const units = version === 1 ? Number(box.readBigUInt64BE(24)) : box.readUInt32BE(16);
              return scale > 0 ? units / scale : null;
            }
            inner += childSize;
          }
          return null;
        }
        at += size;
      }
      return null;
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  ipcMain.handle('clips:list', async () => {
    const folder = clipsFolder();
    let names = [];
    try { names = await fs.promises.readdir(folder); } catch { return { folder, clips: [] }; }
    const found = [];
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.mp4')) continue;
      const file = path.join(folder, name);
      try {
        const stat = await fs.promises.stat(file);
        if (!stat.isFile()) continue;
        found.push({ name, file, stat });
      } catch { /* gone between the listing and the look */ }
    }
    found.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    const clips = [];
    const keep = new Set();
    for (const { name, file, stat } of found) {
      const clip = {
        name,
        url: pathToFileURL(file).href,
        size: stat.size,
        modified: stat.mtimeMs,
        // The star on the card (2026-09-19) — see ./favourites.js.
        favourite: favourites.has('clips', name)
      };
      const still = stillFor(name, stat);
      keep.add(still);
      if (!lengths.has(still)) lengths.set(still, await clipLength(file));
      if (lengths.get(still) !== null) clip.duration = lengths.get(still);
      if (fs.existsSync(still)) clip.still = pathToFileURL(still).href;
      else if (!stillsPending.has(still)) stillsPending.set(still, { file, name });
      clips.push(clip);
    }
    for (const still of lengths.keys()) if (!keep.has(still)) lengths.delete(still);
    sweepStills(keep);
    makeStills();
    return { folder, clips };
  });
  ipcMain.handle('clips:open', async (_e, name) => {
    const file = clipFile(name);
    if (!file) return false;
    return (await shell.openPath(file)) === '';
  });
  ipcMain.handle('clips:reveal', (_e, name) => {
    const file = clipFile(name);
    if (file) shell.showItemInFolder(file);
    return Boolean(file);
  });
  ipcMain.handle('clips:folder', async () => {
    const folder = clipsFolder();
    try { fs.mkdirSync(folder, { recursive: true }); } catch { /* exists */ }
    return (await shell.openPath(folder)) === '';
  });
  // To the Recycle Bin, never gone for good: a clip is the one thing here a
  // player cannot make again.
  //
  // Tried more than once (2026-09-07). Windows refuses to bin a file anything
  // still has open, and the renderer has just this moment let go of the card's
  // video — closing a media resource is not synchronous, so the first attempt
  // can lose the race with it by a few tens of milliseconds. A second of
  // patience turns a "Could not delete the clip" into a deleted clip; a file
  // genuinely held by something else (a video player the clip was opened in)
  // still fails, and the renderer says so.
  ipcMain.handle('clips:remove', async (_e, name) => {
    const file = clipFile(name);
    if (!file) return false;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await shell.trashItem(file);
        favourites.drop('clips', path.basename(file));
        return true;
      } catch {
        // Somebody else got there first — that is the outcome asked for.
        if (!fs.existsSync(file)) {
          favourites.drop('clips', path.basename(file));
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 125));
      }
    }
    return false;
  });
  // The star on a clip's card (2026-09-19): on or off, kept in
  // favourites.json beside the settings and read back onto the list. Only a
  // clip the folder holds can be marked — a name that resolves nowhere, or
  // to a file that is not there, is refused the way every other call here
  // refuses it, so the file never fills with names the folder never offered.
  ipcMain.handle('clips:favourite', (_e, name, on) => {
    const file = clipFile(name);
    if (!file || !fs.existsSync(file)) return false;
    return favourites.mark('clips', path.basename(file), Boolean(on));
  });
  // On the clipboard as a file, the way Explorer's Copy puts it, so a paste
  // into Discord attaches it. Electron's clipboard has no file list on
  // Windows; PowerShell's does. The same route the game itself takes.
  ipcMain.handle('clips:copy', (_e, name) => new Promise((resolve) => {
    const file = clipFile(name);
    if (!file || process.platform !== 'win32') { resolve(false); return; }
    const quoted = `'${file.replace(/'/g, "''")}'`;
    execFile('powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Set-Clipboard -LiteralPath ${quoted}`],
      { timeout: 15000, windowsHide: true },
      (error) => resolve(!error));
  }));

  // ---- screenshots -----------------------------------------------------
  // The pictures the game saved on F2. Unlike clips these are not written to a
  // folder of the launcher's choosing: they go where Minecraft has always put
  // them, inside the profile that took them, and moving them would be moving a
  // player's files around for our own convenience. So the Clips tab reads every
  // profile's own screenshots folder and shows the lot in one place — which
  // also means it finds pictures taken before BlueClient existed.
  const shotDirs = async () => {
    const instances = store.get('launcher.gameDirectory');
    const out = [];
    try {
      for (const entry of await fs.promises.readdir(instances, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(instances, entry.name, 'screenshots');
        try {
          if ((await fs.promises.stat(dir)).isDirectory()) out.push(dir);
        } catch { /* that profile has taken none */ }
      }
    } catch { /* no profiles yet */ }
    return out;
  };

  // A picture is named by the profile it belongs to and its file name, and the
  // pair is resolved back against that profile's own folder — so the renderer
  // can never name a path, only a picture the listing already offered.
  const shotFile = async (id) => {
    const raw = String(id || '');
    const cut = raw.indexOf('/');
    if (cut < 1) return null;

    const instances = path.resolve(store.get('launcher.gameDirectory'));
    const profile = path.basename(raw.slice(0, cut));
    const name = path.basename(raw.slice(cut + 1));
    if (!name.toLowerCase().endsWith('.png')) return null;

    const dir = path.join(instances, profile, 'screenshots');
    if (path.dirname(dir) !== path.join(instances, profile)) return null;

    const target = path.resolve(dir, name);
    if (path.dirname(target) !== dir) return null;
    return target;
  };
  /* The id as the listing spells it, from a file shotFile has resolved —
     what the favourites file keys a screenshot by (2026-09-19). */
  const shotId = (file) => `${path.basename(path.dirname(path.dirname(file)))}/${path.basename(file)}`;

  ipcMain.handle('shots:list', async () => {
    const shots = [];
    for (const dir of await shotDirs()) {
      const profile = path.basename(path.dirname(dir));
      let names = [];
      try { names = await fs.promises.readdir(dir); } catch { continue; }
      for (const name of names) {
        if (!name.toLowerCase().endsWith('.png')) continue;
        const file = path.join(dir, name);
        try {
          const stat = await fs.promises.stat(file);
          if (!stat.isFile()) continue;
          shots.push({
            id: profile + '/' + name,
            name,
            profile,
            url: pathToFileURL(file).href,
            size: stat.size,
            modified: stat.mtimeMs,
            // The star on the card (2026-09-19) — see ./favourites.js.
            favourite: favourites.has('shots', profile + '/' + name)
          });
        } catch { /* gone between the listing and the look */ }
      }
    }
    shots.sort((a, b) => b.modified - a.modified);
    return { shots };
  });
  ipcMain.handle('shots:open', async (_e, id) => {
    const file = await shotFile(id);
    if (!file) return false;
    return (await shell.openPath(file)) === '';
  });
  ipcMain.handle('shots:reveal', async (_e, id) => {
    const file = await shotFile(id);
    if (file) shell.showItemInFolder(file);
    return Boolean(file);
  });
  // The folder button opens the newest profile's, since there is one per
  // profile and no single place they all live.
  ipcMain.handle('shots:folder', async () => {
    const dirs = await shotDirs();
    if (dirs.length === 0) return false;
    return (await shell.openPath(dirs[0])) === '';
  });
  ipcMain.handle('shots:remove', async (_e, id) => {
    const file = await shotFile(id);
    if (!file) return false;
    let gone;
    try {
      await shell.trashItem(file);
      gone = true;
    } catch {
      gone = !fs.existsSync(file);
    }
    if (gone) favourites.drop('shots', shotId(file));
    return gone;
  });
  // The star on a screenshot's card (2026-09-19): the clip's twin, keyed by
  // the id the listing hands out and refused for a picture that is not
  // there. See clips:favourite above.
  ipcMain.handle('shots:favourite', async (_e, id, on) => {
    const file = await shotFile(id);
    if (!file || !fs.existsSync(file)) return false;
    return favourites.mark('shots', shotId(file), Boolean(on));
  });
  // The same route a clip takes: on the clipboard as a file, so a paste into
  // Discord attaches the picture rather than its name.
  ipcMain.handle('shots:copy', async (_e, id) => {
    const file = await shotFile(id);
    if (!file || process.platform !== 'win32') return false;
    const quoted = `'${file.replace(/'/g, "''")}'`;
    return new Promise((resolve) => {
      execFile('powershell',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Set-Clipboard -LiteralPath ${quoted}`],
        { timeout: 15000, windowsHide: true },
        (error) => resolve(!error));
    });
  });

  // ---- mod catalogue ---------------------------------------------------
  // Lives in main so the renderer keeps connect-src 'self'.
  ipcMain.handle('modrinth:search', (_e, opts) => modrinth.search(opts || {}));
  ipcMain.handle('modrinth:icon', (_e, url) => modrinth.icon(url));
  ipcMain.handle('modrinth:project', (_e, slug) => modrinth.project(slug));

  // ---- resource packs (2026-09-09) --------------------------------------
  // The set of the profile the Mods page is showing — its own folder, or its
  // sync group's (game/settings.js, 2026-09-17); see game/packs.js.
  const packsHome = async (profileId) => {
    const safe = String(profileId || '');
    if (!/^[a-z0-9]+$/i.test(safe)) throw new Error('bad id');
    return gameSettings.homeOf(store.get('launcher.gameDirectory'), safe);
  };
  const withHome = (work) => async (_e, profileId, ...rest) => {
    try {
      return await work(await packsHome(profileId), ...rest);
    } catch (error) {
      return { ok: false, error: String(error.message || error), packs: [] };
    }
  };
  ipcMain.handle('packs:list', withHome((home) => packs.list(home)));
  ipcMain.handle('packs:add', withHome((home, pack) => packs.add(home, pack || {})));
  ipcMain.handle('packs:remove', withHome((home, file) => packs.remove(home, file)));
  ipcMain.handle('packs:toggle', withHome((home, file, on) => packs.toggle(home, file, on)));
  ipcMain.handle('packs:folder', withHome((home) => packs.folder(home)));

  // ---- the jars the launcher did not put there (2026-09-19) -------------
  // The Mods page's local cards: every jar in a profile's own mods folder
  // that the launcher's manifest does not own — dropped in by hand, or
  // copied over by Import profiles when Modrinth did not know it. Listed,
  // switched off and on by the `.jar.disabled` rename, and binned; see
  // game/mods.js, `local`. The renderer names the profile by id and the jar
  // by its file name, never a path — mods.js checks the name against the
  // folder and the manifest before it makes a path from it. A rename or a
  // delete is refused while a game on that profile is running: Java holds
  // every loaded jar open, and Windows will not move one.
  // (Required here rather than at the top so this feature is one block.)
  {
    const mods = require('./game/mods');
    const modsDirOf = (profileId) => {
      const id = String(profileId || '');
      if (!/^[a-z0-9]+$/i.test(id)) throw new Error('bad id');
      return path.join(store.get('launcher.gameDirectory'), id, 'mods');
    };
    const running = (profileId) => launcher.list().some((session) => session.profileId === profileId);
    const answer = async (work) => {
      try {
        return await work();
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    };
    const guardedWrite = (profileId, work) => answer(async () => {
      if (running(profileId)) return { ok: false, running: true };
      return work();
    });

    // Which of the profile's mods this Minecraft has a build of (2026-09-21):
    // the Mods page marks the rest "No build for 26.3 yet" and counts only
    // what will launch. The record is read here so the renderer names an id,
    // never a list of its own.
    ipcMain.handle('mods:availability', (_e, profileId) => answer(async () => {
      const profile = (store.get('profiles') || []).find((p) => p && p.id === profileId);
      if (!profile) return { ok: false, error: 'no such profile' };
      return mods.availability({ mods: profile.mods || [], version: profile.version, loader: profile.loader });
    }));
    // The profile's Minecraft goes with it (2026-09-22), so a jar whose own
    // fabric.mod.json does not cover this version says so on its card rather
    // than after the game has refused to start.
    ipcMain.handle('mods:local', (_e, profileId) => answer(() => {
      const profile = (store.get('profiles') || []).find((p) => p && p.id === profileId);
      return mods.local(modsDirOf(profileId), (profile && profile.version) || '');
    }));
    ipcMain.handle('mods:localToggle', (_e, profileId, file, on) =>
      guardedWrite(profileId, () => mods.localToggle(modsDirOf(profileId), file, Boolean(on))));
    ipcMain.handle('mods:localRemove', (_e, profileId, file) =>
      guardedWrite(profileId, () => mods.localRemove(modsDirOf(profileId), file, (target) => shell.trashItem(target))));
    // The profile's own mods folder in Explorer — where a jar goes by hand.
    // The page's Mods folder button opened the instances root until now,
    // a list of ids with the folder two levels down.
    ipcMain.handle('mods:folder', (_e, profileId) => answer(async () => {
      const dir = modsDirOf(profileId);
      fs.mkdirSync(dir, { recursive: true });
      return { ok: (await shell.openPath(dir)) === '' };
    }));
  }

  // ---- settings sync between profiles (2026-09-17) ----------------------
  // Which profiles share their in-game settings, and the two moves: sync
  // one profile with another (it takes the other's settings and follows
  // them from then on), and stop. Refused while a game is running on a
  // profile involved: the game has the files open. See game/settings.js.
  const settingsRoot = () => store.get('launcher.gameDirectory');
  const running = (id) => launcher.list().some((session) => session.profileId === id);
  ipcMain.handle('settings:groups', () => gameSettings.groups(settingsRoot()).catch(() => ({})));
  ipcMain.handle('settings:link', async (_e, profileId, targetId) => {
    const a = String(profileId || '');
    const b = String(targetId || '');
    if (!/^[a-z0-9]+$/i.test(a) || !/^[a-z0-9]+$/i.test(b) || a === b) return { ok: false, error: 'bad id' };
    if (running(a) || running(b)) return { ok: false, running: true };
    try {
      const { group } = await gameSettings.link(settingsRoot(), a, b);
      return { ok: true, group, groups: await gameSettings.groups(settingsRoot()) };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });
  ipcMain.handle('settings:leave', async (_e, profileId) => {
    const a = String(profileId || '');
    if (!/^[a-z0-9]+$/i.test(a)) return { ok: false, error: 'bad id' };
    if (running(a)) return { ok: false, running: true };
    try {
      await gameSettings.leave(settingsRoot(), a);
      return { ok: true, groups: await gameSettings.groups(settingsRoot()) };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });
  ipcMain.handle('servers:status', async (_e, addresses) => {
    const out = await ping.statuses(addresses);
    /* The icon a server sent with its status is kept for the rows that draw
       logos (servericons.js) and taken off the answer: the rows here want
       the numbers, and a picture on every minute's reply is weight. */
    for (const [address, result] of Object.entries(out)) {
      if (result && result.favicon) {
        serverIcons.remember(address, result.favicon);
        delete result.favicon;
      }
    }
    return out;
  });
  /* A server's logo by address — its own ping icon, else its website's,
     kept on disk (2026-09-13). null when it has none anywhere. */
  ipcMain.handle('servers:icon', (_e, address) => serverIcons.icon(address));

  // ---- friends ---------------------------------------------------------
  // Who is a friend, who is online and where — the game's own list, read by
  // the launcher (2026-09-21). { ok: false, reason } for an account that
  // cannot sign in or a site that cannot be reached; never a fake row.
  ipcMain.handle('friends:list', () => friends.list());
  // Ask someone to be friends by name, the game's own Add friend (the same
  // evening): Mojang from this PC for the uuid, then the site. And the
  // invitation the game puts on the clipboard for someone without
  // BlueClient — written there by main, the renderer only asks.
  ipcMain.handle('friends:add', (_e, name) => friends.add(name));
  ipcMain.handle('friends:invite', async () => {
    const text = await friends.inviteText();
    clipboard.writeText(text);
    return { ok: true, text };
  });

  // ---- backgrounds -----------------------------------------------------
  // The player's own pictures for the launcher's background (2026-09-21,
  // src/main/backgrounds.js): a list, a picture's bytes for a blob URL, the
  // file dialog and the copy, the Recycle Bin. Never a path to the renderer.
  ipcMain.handle('backgrounds:list', () => backgrounds.list());
  ipcMain.handle('backgrounds:read', (_e, file) => backgrounds.read(file));
  ipcMain.handle('backgrounds:add', () => backgrounds.add(win));
  ipcMain.handle('backgrounds:remove', (_e, file) => backgrounds.remove(file));

  // ---- skins -----------------------------------------------------------
  skins.init(app.getPath('userData'));
  ipcMain.handle('skin:get', (_e, username) => skins.skinFor(username));

  // The player's own three, and the one they are wearing. Picking the file
  // happens here as well: the renderer has no filesystem to reach into.
  // A Wear renews an aged sign-in through the launcher's own renewal, under
  // the lane the launch uses, which tells the renderer what it wrote.
  skinSlots.init(app.getPath('userData'), store, { renew: () => launcher._renew(0) });
  // An offline account's own skin answers for its name (2026-09-21); any
  // upload the index has not taken yet is offered again once Home is up
  // (startBackground).
  skins.ownSkins(skinSlots.ownFor);
  ipcMain.handle('skins:slots', () => skinSlots.list());
  ipcMain.handle('skins:pick', async (_e, { index, variant } = {}) => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a skin',
      properties: ['openFile'],
      filters: [{ name: 'Skin image', extensions: ['png'] }]
    });
    if (result.canceled) return { ok: true, cancelled: true, slots: skinSlots.list() };
    return skinSlots.put(index, result.filePaths[0], variant);
  });
  ipcMain.handle('skins:variant', async (_e, { index, variant } = {}) => {
    const result = await skinSlots.setVariant(index, variant);
    // Flipped on the worn skin, it was re-sent to Mojang: same as a Wear.
    if (result.ok && result.username && !result.remembered) skins.forget(result.username);
    return result;
  });
  ipcMain.handle('skins:wear', async (_e, index) => {
    const result = await skinSlots.wear(index);
    // The texture behind a name is content-addressed and cached on disk, so
    // the old one would go on being drawn until the profile lookup expired.
    // Mojang's answer usually names the new one and wear() has written it
    // into the cache already (remembered); only an unreadable answer forgets.
    if (result.ok && result.username && !result.remembered) skins.forget(result.username);
    return result;
  });
  ipcMain.handle('skins:clear', (_e, index) => skinSlots.clear(index));

  // Browsing for one (2026-09-09): a name, or the week's popular grid, and
  // keeping what was found. Mojang's textures either way; see skinfind.js.
  ipcMain.handle('skins:find', (_e, query, mode) => skinFind.find(query, mode));
  ipcMain.handle('skins:keep', (_e, { index, skin } = {}) => skinFind.keep(index, skin || {}));

  // ---- signing in ------------------------------------------------------
  // Both answer with { ok } rather than throwing: a refused sign-in is an
  // ordinary outcome the accounts screen shows, not an exception.
  ipcMain.handle('auth:sign-in', async () => {
    try {
      return { ok: true, account: await auth.signIn({ clientId: auth.appId(store.get('auth.clientId')), parent: win }) };
    } catch (error) {
      // The toast the player sees is deliberately short and fades. Which of the
      // four links actually broke is the only thing worth knowing afterwards,
      // so the code is written down even though the message is not.
      if (error.code !== 'cancelled') noteAuthFailure(error);
      return { ok: false, error: error.message, code: error.code || 'auth_failed' };
    }
  });

  ipcMain.handle('auth:refresh', async (_e, account) => {
    try {
      return { ok: true, account: await auth.refresh({ clientId: auth.appId(store.get('auth.clientId')), account }) };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code || 'auth_failed' };
    }
  });

  // True since the launcher ships its own application id; the setting only
  // ever overrides it, so this can no longer be the reason sign-in is refused.
  ipcMain.handle('auth:configured', () => Boolean(auth.appId(store.get('auth.clientId'))));

  // ---- worlds (2026-09-11) ---------------------------------------------
  // The Worlds tab: every singleplayer save under every profile, the other
  // launchers' saves, and the backups made when a game closes (game/worlds.js
  // does the work; launcher.js calls its exit hook). The renderer names a
  // profile by id, a world by its folder name and a backup by its file name,
  // never a path — worlds.js checks every one against the folders it owns.
  // Anything that writes a world is refused while a game on that profile is
  // running: the game has it open, and it is backed up by itself on exit.
  // (Required here rather than at the top so this feature is one block.)
  {
    const worlds = require('./game/worlds');
    const instancesDir = () => store.get('launcher.gameDirectory');
    const running = (profileId) => launcher.list().some((session) => session.profileId === profileId);
    const answer = async (work) => {
      try {
        return await work();
      } catch (error) {
        return { ok: false, error: error.message };
      }
    };
    const guardedWrite = (profileId, work) => answer(async () => {
      if (running(profileId)) return { ok: false, running: true };
      return work();
    });

    ipcMain.handle('worlds:list', () => answer(async () => ({ ok: true, ...await worlds.list({ instances: instancesDir() }) })));
    ipcMain.handle('worlds:size', (_e, { profileId, folder } = {}) =>
      answer(async () => ({ ok: true, ...await worlds.size({ instances: instancesDir(), profileId, folder }) })));
    ipcMain.handle('worlds:backup', (_e, { profileId, folder } = {}) =>
      guardedWrite(profileId, () => worlds.backup({ instances: instancesDir(), profileId, folder })));
    ipcMain.handle('worlds:backups', (_e, { profileId, folder } = {}) =>
      answer(async () => ({ ok: true, ...await worlds.backups({ instances: instancesDir(), profileId, folder }) })));
    ipcMain.handle('worlds:restore', (_e, { profileId, folder, name } = {}) =>
      guardedWrite(profileId, () => worlds.restore({ instances: instancesDir(), profileId, folder, name })));
    ipcMain.handle('worlds:remove', (_e, { profileId, folder } = {}) =>
      guardedWrite(profileId, () => worlds.remove({
        instances: instancesDir(), profileId, folder, trash: (target) => shell.trashItem(target)
      })));
    // Bring it here copies a world in; the source is only ever one the
    // discovery finds again (another launcher's saves, or a folder a deleted
    // profile left behind), and the copy lands in the profile named.
    ipcMain.handle('worlds:bring', (_e, { profileId, path: source } = {}) =>
      answer(() => worlds.bring({ instances: instancesDir(), profileId, path: source })));
    // The world's own folder in Explorer, or the profile's saves folder when
    // no world is named (the page's "Saves folder" button).
    ipcMain.handle('worlds:open', (_e, { profileId, folder } = {}) => answer(async () => {
      const target = folder
        ? worlds.worldDir(instancesDir(), profileId, folder)
        : worlds.savesDir(instancesDir(), profileId);
      fs.mkdirSync(target, { recursive: true });
      return { ok: (await shell.openPath(target)) === '' };
    }));

    // A backup landed — the exit hook's, or a press of Back up now — so the
    // card can say so without the page asking again.
    worlds.events.on('backup', (payload) => send('worlds:changed', payload));
  }

  // ---- launching -------------------------------------------------------
  // Several games can be in flight at once, so every call names the session it
  // means and `game:sessions` is how the renderer redraws the running rows
  // after a reload.
  ipcMain.handle('game:launch', (_e, profile) => launcher.launch(profile));
  ipcMain.handle('game:cancel', (_e, id) => launcher.cancel(id));
  ipcMain.handle('game:stop', (_e, id) => launcher.stop(id));
  ipcMain.handle('game:sessions', () => launcher.list());
  ipcMain.handle('game:versions', async () => {
    try {
      return { ok: true, versions: await install.listVersions() };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  /* Which Minecraft versions carry the in-game half of BlueClient, read out of
     the shipped jars rather than written down anywhere (2026-09-04). The
     launcher already refused to install the mod on a version it does not fit,
     but it said so at the launch — after the player had chosen 1.8.9, waited
     for the download and pressed Play. Profiles asks the same question of the
     same files at the moment the version is being picked.

     It takes the whole list at once rather than one version at a time: the
     mod ships as several jars now (2026-09-04, the multi-version port), and a
     round trip per row of a version dropdown would be dozens of them. */
  ipcMain.handle('game:companion', async (_e, versions) => {
    const carried = await companion.coverage(companionDir());
    const list = Array.isArray(versions) ? versions : [];
    return { ranges: carried.ranges, versions: list.filter((v) => carried.covers(v)) };
  });

  ipcMain.handle('game:fits-companion', async (_e, version) => {
    const hit = await companion.pick(companionDir(), version);
    return hit ? { ok: true, range: hit.range } : { ok: false, range: null };
  });

  /* The newest Minecraft release the shipped jars carry BlueClient for — what
     the first profile is born on, and what "New profile" picks (2026-09-06).
     Bounded, because it runs before the first window has anything to show: a
     first run with no network gets null and the renderer's own fallback. */
  /* Import profiles (2026-09-16): what the other launchers on this PC hold,
     and the rows the player ticked brought over as profile records — the
     jars already in place under instances/<id>/mods, Lunar's waypoints in
     the shared list. The renderer adopts the records into its own profile
     list; nothing it says is a path. */
  ipcMain.handle('game:import-scan', async () => {
    try {
      return { ok: true, ...await importer.scan() };
    } catch (error) {
      return { ok: false, error: String(error.message || error), groups: [] };
    }
  });
  ipcMain.handle('game:import-bring', async (_e, keys, options) => {
    try {
      const list = Array.isArray(keys) ? keys.filter((k) => typeof k === 'string').slice(0, 64) : [];
      const settings = Boolean(options && options.settings);
      return { ok: true, ...await importer.bring(list, { instances: store.get('launcher.gameDirectory'), modrinth, settings }) };
    } catch (error) {
      return { ok: false, error: String(error.message || error), profiles: [] };
    }
  });

  ipcMain.handle('game:newest', async () => {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
    const ask = (async () => {
      const [carried, versions] = await Promise.all([companion.coverage(companionDir()), install.listVersions()]);
      const releases = versions.filter((v) => v.type === 'release').map((v) => v.id);
      const version = releases.find((id) => carried.covers(id)) || releases[0] || null;
      return version ? { version } : null;
    })().catch(() => null);
    return Promise.race([ask, timeout]);
  });

  /* A deleted profile's folder goes to the Recycle Bin (2026-09-06). Until
     then "Delete profile" only took the entry off the list, while its dialog
     said the files and worlds were gone. The Bin rather than rm: a world is
     the one thing in there a player cannot make again. A profile with a game
     still running keeps its folder — the game has it open — and says so. */
  ipcMain.handle('game:remove-instance', async (_e, id) => {
    const safe = String(id || '');
    if (!/^[a-z0-9]+$/i.test(safe)) return { ok: false, error: 'bad id' };
    if (launcher.list().some((session) => session.profileId === safe)) return { ok: false, running: true };

    const instances = path.resolve(store.get('launcher.gameDirectory'));
    const target = path.join(instances, safe);
    if (path.dirname(target) !== instances) return { ok: false, error: 'bad id' };
    // Out of its sync group first, whether or not the folder is there: a
    // group left with one member is dissolved and that member keeps its copy.
    await gameSettings.forget(instances, safe).catch(() => {});
    if (!fs.existsSync(target)) return { ok: true, absent: true };

    try {
      await shell.trashItem(target);
      return { ok: true };
    } catch {
      // A drive without a bin, or a path the shell refuses: gone for good is
      // still what the player asked for.
      try {
        await fs.promises.rm(target, { recursive: true, force: true });
        return { ok: true, unrecoverable: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
  });

  /* What the launcher's folders weigh, for Settings → Storage: each profile,
     the shared settings, the Java runtimes and the Mojang files under the
     root. Walked on request, never in the background. */
  ipcMain.handle('game:disk', async () => {
    const instances = store.get('launcher.gameDirectory');
    const root = store.get('launcher.rootDirectory');
    const javaDir = path.join(app.getPath('userData'), 'java');

    const profiles = {};
    const groups = [];
    try {
      for (const entry of await fs.promises.readdir(instances, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === gameSettings.SHARED_DIR) continue;
        if (entry.name.startsWith(gameSettings.GROUP_PREFIX)) {
          /* A sync group's folder: the settings two or more profiles share
             (game/settings.js, 2026-09-17). How many servers are in its list
             and which other launchers it keeps taking new ones from, so the
             row can say what the folder is for rather than only what it
             weighs. */
          groups.push({
            id: entry.name,
            bytes: await dirSize(path.join(instances, entry.name)),
            set: await gameSettings.summary(instances, entry.name).catch(() => null)
          });
          continue;
        }
        if (entry.name.startsWith('_')) continue;
        profiles[entry.name] = await dirSize(path.join(instances, entry.name));
      }
    } catch { /* no profiles yet */ }

    return {
      instances,
      root,
      profiles,
      groups,
      members: await gameSettings.groups(instances).catch(() => ({})),
      // The play record, the waypoints and the world backups: the player's
      // whichever profile they play.
      shared: await dirSize(path.join(instances, gameSettings.SHARED_DIR)),
      java: await dirSize(javaDir),
      mojang: (await Promise.all(['versions', 'libraries', 'assets', 'natives']
        .map((name) => dirSize(path.join(root, name))))).reduce((sum, n) => sum + n, 0)
    };
  });

  // ---- a crash that explains itself, and one server list (2026-09-11) --------
  // The crash a session ended in stays on its row until the player closes it
  // (src/main/crashes.js keeps the record; the exit path in launcher.js writes
  // it). The row asks main to open the session's log, the game's own report or
  // the profile's mods folder by the session's id — no path ever crosses the
  // bridge in either direction.
  ipcMain.handle('game:crashes', () => crashes.list());
  ipcMain.handle('game:crash-dismiss', (_e, id) => crashes.forget(String(id || '')));
  ipcMain.handle('game:crash-open', async (_e, id, which) => {
    const target = crashes.pathOf(String(id || ''), String(which || 'log'));
    if (!target) return false;
    if (which === 'report' || which === 'log') return (await shell.openPath(target)) === '';
    try { fs.mkdirSync(target, { recursive: true }); } catch { /* exists */ }
    return (await shell.openPath(target)) === '';
  });
  // The chat logs' folder (2026-09-19): a file a day the game writes, where
  // recordFlags told it to (`chatLogsDir`, inside `_shared`). Made if it is
  // not there yet — a player who opens it before their first chat line sees
  // an empty folder rather than an error — and opened, like clips:folder.
  ipcMain.handle('game:chat-logs', async () => {
    const folder = gameSettings.chatLogsDirIn(store.get('launcher.gameDirectory'));
    try { fs.mkdirSync(folder, { recursive: true }); } catch { /* exists */ }
    return (await shell.openPath(folder)) === '';
  });
  // Home's Featured servers are the admin site's list, the same one the game's
  // Find Servers reads (src/main/game/servers.js): `list` is what is on disk
  // and answers at once, `refresh` asks the site when that copy is stale.
  ipcMain.handle('servers:list', () => servers.cached());
  ipcMain.handle('servers:refresh', () => servers.refresh());

  // The update. Main does the watching, fetching and installing; the renderer
  // is handed a state to paint and one button that says go.
  ipcMain.handle('update:check', () => update.get());
  ipcMain.handle('update:install', () => update.install());

  // ---- Updates early, and What's new (2026-09-11) ------------------------
  // "Get updates early" under Settings → About decides what the next look
  // asks for (update.js, bundleSource) — the getter is read at each look, so
  // the switch needs no restart; flipping it asks for a look now. The capsule
  // beside the version line on Home reads the sentence the build stamped
  // into resources/notes.txt, once per sentence.
  update.setEarly(() => store.get('launcher.earlyUpdates') === true);
  ipcMain.handle('update:recheck', () => update.recheck());
  ipcMain.handle('update:news', () => update.news(store));
  ipcMain.handle('update:news-seen', () => update.newsSeen(store));

  launcher.on('progress', (payload) => send('game:progress', payload));
  launcher.on('warning', (payload) => send('game:warning', payload));
  // A pre-launch token renewal rewrote the stored accounts; the renderer's
  // copy has to follow or its next write puts the dead token back.
  launcher.on('accounts', (payload) => send('accounts:changed', payload));
  launcher.on('state', (payload) => {
    send('game:state-changed', payload);
    if (!win) return;
    const behaviour = store.get('launcher.onLaunch');
    // Held for the length of the row's payoff wipe (--dur-live-flash, plus a
    // frame or two). Getting out of the way is right, but not before the one
    // moment that tells the player the wait is over — and against a launch
    // that took twenty seconds, a third of one costs nothing.
    if (payload.state === 'playing' && behaviour === 'minimize') {
      setTimeout(() => { if (win && !win.isDestroyed()) win.minimize(); }, LAUNCH_PAYOFF_MS);
    }
    if (payload.state === 'playing' && behaviour === 'close') {
      setTimeout(() => { if (win && !win.isDestroyed()) win.hide(); }, LAUNCH_PAYOFF_MS);
    }
    // Only the last game to end brings the launcher back. Coming forward while
    // two others are still running would throw the window over whichever one
    // the player is actually looking at. And only a launcher that put itself
    // away: with Keep open (the default since 1.2.0) the window stayed where
    // the player left it, and a window they minimised by hand during a
    // four-hour session is theirs to bring back.
    if (payload.state === 'idle' && payload.running === 0 && behaviour !== 'keep') {
      if (!win.isVisible()) win.show();
      if (win.isMinimized()) win.restore();
    }
  });
}
