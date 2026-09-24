/**
 * BlueClient — application shell.
 *
 * Vanilla Minecraft, enhanced: one masthead with the wordmark left,
 * horizontal tabs across the middle, and the account and window controls on
 * the right — the way vanilla's settings screens are framed. Content sits in
 * one centred column over the world panorama.
 */

import { el, qs, mount } from './ui/dom.js';
import { icons } from './icons.js';
import { APP_NAME } from './config.js';
import { host, isPreview } from './bridge.js';
import { pictureUrl } from './backgrounds.js';
import { toast } from './ui/toast.js';
import { closeMenu } from './ui/menu.js';
import { tabStrip } from './ui/tabstrip.js';
import { warmGraphics } from './warmup.js';
import { avatarFor } from './avatar.js';
import { paintAccountHead } from './skin.js';
import { openAccountMenu, openAccountModal } from './pages/account.js';
import { offerImportOnce } from './ui/found.js';

import * as homePage from './pages/home.js';
import * as profilesPage from './pages/profiles.js';
import * as accountsPage from './pages/accounts.js';
import * as settingsPage from './pages/settings.js';
import * as worldsPage from './pages/worlds.js';
import * as modsPage from './pages/mods.js';
import * as clipsPage from './pages/clips.js';
import * as statsPage from './pages/stats.js';
import { loadBlockIcons } from './blocks.js';
import { capesAway, spell, levelLine } from './play.js';

import {
  state, subscribe, notify, initState, setRoute, applyWorldLook,
  activeAccount, updateSettings, setActiveProfile,
  upsertSession, patchSession, dropSession, gameStatus
} from './state.js';

const ROUTES = [
  { id: 'home', label: 'Play', icon: 'play', page: homePage },
  { id: 'profiles', label: 'Profiles', icon: 'folderOpen', page: profilesPage },
  { id: 'mods', label: 'Mods', icon: 'layers', page: modsPage },
  { id: 'clips', label: 'Clips', icon: 'clapper', page: clipsPage },
  { id: 'settings', label: 'Settings', icon: 'settings', page: settingsPage },
  /* Reached from the account menu, so it has no tab of its own. */
  { id: 'accounts', label: 'Accounts', icon: 'users', page: accountsPage, hidden: true },
  /* And this one from the Cosmetics card on Home (Your play until
     2026-09-17), for the same reason (2026-09-10). */
  { id: 'stats', label: 'Cosmetics', icon: 'gauge', page: statsPage, hidden: true },
  /* Worlds was a sixth tab for an afternoon (2026-09-11) and Adrian took it
     off the bar the same day — "too many categories … we need to keep it
     simple." It is reached from the Worlds button in a profile's editor, the
     way Stats is reached from Your play: a world belongs to a profile. */
  { id: 'worlds', label: 'Worlds', icon: 'globe', page: worldsPage, hidden: true }
];

/* The pages shown to the graphics card in the shell's first frame, so the
   first switch off Home compiles nothing (2026-09-15, warmup.js — which also
   says why the hidden pages are not on the list). Clips is warmed too, by
   its own hand, once its folder has answered (2026-09-17, pages/clips.js). */
const WARMED = new Set(['profiles', 'mods', 'settings']);

/** The tabs on the bar: every route that is not hidden. */
const tabs = () => ROUTES.filter((route) => !route.hidden);

const root = qs('#root');
let mainRegion;
let accountChip;
let maximizeButton;
let shellNode;
/** The one box the whole backdrop lives in — still, world, sky and sun. */
let backNode;
let navNode;
let navStrip = null;
/** The live world at the back of the shell — { api, canvas } while it is up. */
let world = null;

/* ------------------------------------------------------------------ boot */

(async function boot() {
  /* The profile icons are cut from block textures; every page that shows one
     asks for it synchronously, so the textures are in hand before anything
     paints (2026-09-09). After the settings, not beside them (2026-09-23):
     read while main was still answering, they looked free against a mock
     bridge, but in Electron the thirty-seven file loads held up the answers
     themselves — Home painted at about 1010 ms instead of 720 (median of
     eight cold starts each under Xvfb, initState's own questions asked at
     once in both). */
  await initState();
  await loadBlockIcons();

  mainRegion = el('main', { class: 'main' });
  /* The evening light over the world (2026-09-17): the sky multiplied and the
     sun screened, both in shell.css. They go inside the backdrop box so that
     syncWorld's prepend puts the canvas under them.

     The box itself (2026-09-22) is what flattens the four backdrop layers into
     one surface before any pane of glass blurs them — without it Chromium's
     split of the shared backdrop pass shows as a hairline seam inside every
     pane on the page; shell.css's comment has the whole finding. */
  backNode = el('div', { class: 'shell__back', 'aria-hidden': 'true' }, [
    el('div', { class: 'shell__sky' }),
    el('div', { class: 'shell__sun' })
  ]);
  shellNode = el('div', { class: 'shell' }, [
    backNode,
    masthead(),
    mainRegion
  ]);
  mount(root, shellNode);
  syncWorld();
  renderRoute();
  /* In this same task, so the host rides in the commit that carries the
     shell: the card meets every page's paint while it is making the first
     frame, and nobody has seen anything yet. */
  warmGraphics(ROUTES.filter((route) => route.id !== state.route && WARMED.has(route.id)));
  /* Clips lists its folder first, so its cards land in a later commit —
     still in the launch's first second, while the card is compiling the
     shell's own paint and nobody is looking for a smooth frame yet. */
  clipsPage.warm();
  wireHost();
  wireShortcuts();

  subscribe(onStateChange);
  paintNews();

  if (!activeAccount()) {
    signingInFirst = true;
    setTimeout(() => openAccountModal(), 450);
  }
  if (isPreview) {
    setTimeout(() => toast('Preview mode — running outside Electron', 'info', 4200), 900);
  }
})();

/* ------------------------------------------------------ first sign-in */

/** True from a boot with no account until the first one is added. */
let signingInFirst = false;

/**
 * The other launchers' profiles, offered the moment a first-time player has
 * an account (2026-09-24, ui/found.js has why it is here and not only on
 * Profiles). It waits for the account sheet and the "Signed in" toast's
 * moment to pass — never a dialog on top of a dialog — and only on Home,
 * where the player is standing. What comes over becomes the profile Play
 * starts, so their first press here is the setup they already know.
 */
function offerAfterSignIn() {
  let waited = 0;
  const clear = () => state.route === 'home' && !document.querySelector('.scrim');
  const tick = () => {
    if (state.route !== 'home') return;             // gone elsewhere: Profiles asks there
    if (!clear()) {
      waited += 300;
      if (waited < 15000) setTimeout(tick, 300);
      return;
    }
    offerImportOnce({
      ready: clear,
      onDone: (adopted) => { if (adopted?.[0]) setActiveProfile(adopted[0].id); }
    });
  };
  setTimeout(tick, 900);
}

/* ----------------------------------------------------------- what's new */

/** The capsule beside the version line while it is up, and what places it. */
let news = null;

/**
 * "New in 0.18 — …", once (2026-09-11).
 *
 * An update goes in while the launcher is closed, and the next morning the
 * corner says a new number and nothing else — a player who did not read the
 * release page has no idea what changed. So main hands over the one sentence
 * the build stamped into resources/notes.txt (src/main/update.js, news), and
 * it sits in a capsule beside the version line until it is pressed or the
 * player leaves the page. Either way it is then written down as read and does
 * not come back for that sentence. Nothing shows on a first install, and
 * nothing shows the first time a copy that has never seen one updates —
 * there is nothing to catch up on. Nothing here is on the road to Play.
 */
async function paintNews() {
  let note = null;
  try {
    note = await host.update.news?.();
  } catch {
    note = null;
  }
  if (!note?.line || news || !shellNode) return;

  const capsule = el('button', {
    class: 'whats-new',
    'aria-label': note.route ? `${note.line}. Open settings` : `${note.line}. Dismiss`,
    /* The player-count line (2026-09-16) names the page with the switch, so
       pressing it goes there; the What's new line only dismisses. */
    onClick: () => {
      dismissNews();
      if (note.route) {
        if (note.section) settingsPage.openSection(note.section);
        setRoute(note.route);
      }
    }
  }, [
    el('span', { class: 'whats-new__text', text: note.line }),
    el('span', { class: 'whats-new__close', html: note.route ? icons.chevronRight : icons.close, 'aria-hidden': 'true' })
  ]);
  shellNode.append(capsule);

  news = { capsule, observer: new ResizeObserver(() => placeNews()), watched: null };
  placeNews();
}

/**
 * Beside the version line: to its right, centred on it. The line is Home's,
 * rebuilt on every visit and widened by the update line ("· Updating… 42%")
 * whenever main says the update moved on, so the capsule is placed again on
 * every route paint and on resize, and a ResizeObserver on the line itself
 * catches the update line arriving. Off Home there is no line — the capsule
 * takes the same corner on its own (the stylesheet's position).
 */
function placeNews() {
  if (!news || !shellNode) return;
  const { capsule } = news;
  const line = document.querySelector('.home__version');
  if (line !== news.watched) {
    news.observer.disconnect();
    if (line) news.observer.observe(line);
    news.watched = line;
  }
  if (!line) {
    capsule.style.left = '';
    capsule.style.top = '';
    capsule.style.bottom = '';
    return;
  }
  /* Layout offsets, not the bounding box: a page arriving slides in on a
     transform for the first frames, and a box measured then would put the
     capsule thirty pixels off where the line settles. The offset chain from
     the line to the shell ignores transforms. */
  let x = 0;
  let y = 0;
  for (let node = line; node && node !== shellNode; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  capsule.style.left = `${x + line.offsetWidth + 12}px`;
  capsule.style.top = `${Math.round(y + line.offsetHeight / 2 - capsule.offsetHeight / 2)}px`;
  capsule.style.bottom = 'auto';
}

/** Pressed, or the page left: gone, and written down as read. */
function dismissNews() {
  if (!news) return;
  news.observer.disconnect();
  news.capsule.remove();
  news = null;
  Promise.resolve(host.update.newsSeen?.()).catch(() => {});
}

window.addEventListener('resize', () => placeNews());

/* ------------------------------------------------------------- the world */

/**
 * The world behind everything (2026-09-02): the same one blueclient.net draws
 * and the game's title screen turns, drawn live by js/world.js on a canvas
 * at the back of the shell. The stylesheet paints a still of its first frame
 * under it, so nothing changes on screen when it comes up — it only starts
 * to turn.
 *
 * Thirty frames a second at up to one and a half device pixels per CSS pixel
 * (2026-09-03: a 1x canvas upscaled by a 125% display went soft and crawled;
 * 1.5x costs nothing measurable), paused while the
 * window is hidden or minimised — and, since 2026-09-11, whenever a game is
 * playing and the window is not the one in front (see paceWorld). It times
 * its own first seconds: a machine that cannot hold it switches the setting
 * off for good and keeps the still. Settings › Live background is the way
 * back.
 */
function syncWorld() {
  // The blur belongs to the world and the still alike, so it is painted
  // here, whether or not the world is turning.
  applyWorldLook();
  /* A picture of the player's own instead of the world (2026-09-21, the
     Background button): the world is put away and the shell wears the
     picture — see syncPicture. */
  const picture = state.settings?.launcher?.background;
  if (picture?.kind === 'image' && picture.file) { unmountWorld(); syncPicture(picture.file); return; }
  syncPicture(null);
  const wanted = state.settings?.launcher?.liveWorld !== false;
  if (!wanted || !window.BlueWorld) { unmountWorld(); return; }
  if (world || !shellNode) return;

  const canvas = el('canvas', { class: 'world', 'aria-hidden': 'true' });
  backNode.prepend(canvas);
  const api = window.BlueWorld.mount(canvas, {
    yaw: 0, pitch: -4, camY: 6, spin: 360 / 210, hand: false, dpr: 1.5, fps: 30,
    assets: 'assets/mc/',
    onSlow: () => {
      unmountWorld();
      updateSettings({ launcher: { liveWorld: false } });
    }
  });
  if (!api) { canvas.remove(); return; }
  world = { api, canvas };
  worldSleeping = false;
  paceWorld();
}

function unmountWorld() {
  if (worldSleepTimer) { clearTimeout(worldSleepTimer); worldSleepTimer = null; }
  worldSleeping = false;
  if (!world) return;
  world.api.destroy();
  world.canvas.remove();
  world = null;
}

/* The picture on the shell, or none. */
let pictureUp = null;

/**
 * The player's own picture as the background (2026-09-21). The bytes come
 * from main and are shown through a blob URL — the renderer's content policy
 * admits blob: pictures and refuses file: ones — set on the shell as
 * `--backdrop-image`; shell.css draws it in the still's place, covering the
 * window, under the same blur and brightness as the world, and puts the
 * evening light away: the light is the world's, and a photograph shows as
 * the player chose it. A picture that cannot be read leaves the world up,
 * so the launcher never shows a blank wall.
 */
async function syncPicture(file) {
  if (!shellNode) return;
  if (!file) {
    if (pictureUp) {
      shellNode.classList.remove('shell--picture');
      shellNode.style.removeProperty('--backdrop-image');
      pictureUp = null;
    }
    return;
  }
  if (pictureUp === file) return;
  pictureUp = file;
  const url = await pictureUrl(file);
  if (pictureUp !== file) return;                 // changed while the file was read
  if (!url) {
    /* The picture is gone (removed from the folder by hand): the choice
       goes back to the world, and the settings change mounts it again. */
    pictureUp = null;
    shellNode.classList.remove('shell--picture');
    shellNode.style.removeProperty('--backdrop-image');
    updateSettings({ launcher: { background: { kind: 'world', file: null } } }).catch(() => {});
    return;
  }
  shellNode.style.setProperty('--backdrop-image', `url("${url}")`);
  shellNode.classList.add('shell--picture');
}

/** Whether this window is the one in front. Kept by the two listeners below. */
let focused = document.hasFocus();

/**
 * The launcher yields to the game (2026-09-11).
 *
 * The world turns at thirty frames on the GPU, and the launcher is usually
 * still open behind Minecraft — "Keep open" is a setting, "Minimise" only
 * puts the window away, and either way the window is up while a game runs
 * for four hours. The game is what those frames are for. So while any
 * session is playing and this window is not the one in front, the world
 * pauses on its last frame, exactly as it does when the window is hidden;
 * it resumes the moment the launcher is brought back, or the last game ends
 * (a session event runs this too). A launcher with no game up keeps turning
 * unfocused, because then the world is what the player left on screen.
 *
 * Nothing in world.js changes for this — pause() and resume() are the same
 * two calls visibility has always made, and both are idempotent — so the
 * site's copy of the world needs no change either.
 *
 * And after twenty seconds of yielding, the world goes to sleep (2026-09-22):
 * a paused world still held its multisampled drawing buffer on the card —
 * the largest thing it owns, and on a laptop's built-in graphics the game's
 * own memory — so the buffer is let go (world.js sleep(): one pixel) while
 * the geometry, textures and programs stay, and the canvas is hidden so the
 * still under it shows. Measured with tools/probe-idle.js: the GPU process
 * held 309 MB with the world paused, 110 with it unmounted — and a remount
 * cost a second of the page's main thread on every alt-tab back, which is
 * why the world is not unmounted but put to sleep. The wake, on focus or on
 * the last game ending, is one resize. Only yielding sleeps: a minimised
 * launcher with no game up keeps its world, and comes back the instant it
 * is restored.
 */
const WORLD_SLEEP_MS = 20000;
let worldSleepTimer = null;
let worldSleeping = false;

/* Minimised or hidden, as main reports it (2026-09-22): document.hidden
   cannot say so in this window — backgroundThrottling is off, and that
   holds the page's visibility at "visible" — so a minimised launcher's
   world kept turning for nobody. Paused, like hidden; never asleep, so a
   restore is instant. */
let away = false;

function paceWorld() {
  const yielding = gameStatus() === 'playing' && !focused;
  const resting = document.hidden || away || yielding;
  if (!resting) {
    if (worldSleepTimer) { clearTimeout(worldSleepTimer); worldSleepTimer = null; }
    if (worldSleeping) { wakeWorld(); return; }
    if (world) world.api.resume();
    return;
  }
  if (!world) return;
  world.api.pause();
  if (yielding && !worldSleepTimer) worldSleepTimer = setTimeout(sleepWorld, WORLD_SLEEP_MS);
}

function sleepWorld() {
  worldSleepTimer = null;
  if (!world || !(gameStatus() === 'playing' && !focused)) return;
  if (typeof world.api.sleep !== 'function') return;
  world.api.sleep();
  world.canvas.classList.add('is-asleep');
  worldSleeping = true;
}

function wakeWorld() {
  worldSleeping = false;
  if (!world) { syncWorld(); return; }
  world.api.wake();
  world.canvas.classList.remove('is-asleep');
  world.api.resume();
}

/** For the idle probe (tools/probe-idle.js): whether the world is asleep. */
window.__worldSleeping = () => worldSleeping;

document.addEventListener('visibilitychange', paceWorld);
window.addEventListener('focus', () => { focused = true; paceWorld(); });
window.addEventListener('blur', () => { focused = false; paceWorld(); });

/* ------------------------------------------------------- window controls */

function windowControls() {
  maximizeButton = el('button', {
    class: 'window-btn',
    'aria-label': 'Maximise',
    html: icons.maximize,
    onClick: () => host.window.toggleMaximize()
  });

  return el('div', { class: 'window-controls' }, [
    el('button', {
      class: 'window-btn',
      'aria-label': 'Minimise',
      html: icons.minimize,
      onClick: () => host.window.minimize()
    }),
    maximizeButton,
    el('button', {
      class: 'window-btn window-btn--close',
      'aria-label': 'Close',
      html: icons.close,
      onClick: () => host.window.close()
    })
  ]);
}

/* -------------------------------------------------------------- masthead */

/**
 * One bar: wordmark, the four tabs, then the account and the window
 * controls. (Discord was removed 2026-09-02 — it went nowhere. The language
 * menu followed it the same evening: nine languages on offer and every one
 * of them a toast saying only English ships. It comes back with the strings.)
 *
 * Settings is a tab like the others — with no sidebar there is exactly one
 * place a section can live, which is the point of the layout.
 */
function masthead() {
  accountChip = el('button', {
    class: 'account-chip',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onClick: (event) => openAccountMenu(event.currentTarget)
  });
  paintAccountChip();

  navNode = el('nav', { class: 'topnav', 'aria-label': 'Sections' });
  paintTabs();

  return el('header', { class: 'masthead' }, [
    /* A button, and it goes home (2026-09-10, night; Adrian: "pressing the
       logo in the top left of the launcher should always bring you to the
       home page") — what a wordmark does on every site. */
    el('button', { class: 'brand', title: 'Home', onClick: () => setRoute('home') }, [
      /* The disc mark, not the square cropped to one (2026-09-21, Adrian: "put
         this circle logo in the launcher top left thing too") — the letter is
         drawn for the disc there, a fifth larger than the tile's. Written by
         logo-mockups/vector-b.js --round; the square logo.png stays everywhere
         else. */
      el('span', { class: 'brand__mark' }, [
        el('img', { src: 'assets/art/logo-round.png', alt: '', draggable: 'false' })
      ]),
      el('span', { class: 'brand__name', text: APP_NAME })
    ]),

    navNode,

    el('div', { class: 'masthead__right' }, [
      accountChip,
      windowControls()
    ])
  ]);
}

/** The tab buttons, painted once: the set of them never changes. */
function paintTabs() {
  mount(navNode,
    ...tabs().map((route) => el('button', {
      class: `nav-item${route.id === state.route ? ' is-active' : ''}`,
      dataset: { tab: route.id },
      'aria-current': route.id === state.route ? 'page' : null,
      onClick: () => setRoute(route.id)
    }, [
      el('span', { class: 'nav-item__icon', html: icons[route.icon] }),
      el('span', { text: route.label })
    ])));

  /* The travelling tint and the drag are the strip's own, shared with
     Settings' section bar since 2026-09-14 — see ui/tabstrip.js. */
  navStrip = tabStrip(navNode, { current: () => state.route, select: setRoute });
}

function paintAccountChip() {
  const account = activeAccount();

  accountChip.setAttribute('aria-label', account ? `Account: ${account.username}` : 'Sign in');

  // The generated face shows immediately; the real skin head replaces it
  // once main has fetched the texture.
  const face = el('span', {
    class: 'account-chip__face',
    style: { backgroundImage: `url("${avatarFor(account?.username || 'guest')}")`, backgroundSize: 'cover' }
  });

  mount(accountChip,
    face,
    el('span', { class: 'account-chip__name truncate', text: account?.username || 'Sign in' }),
    el('span', { class: 'account-chip__caret', html: icons.chevronDown }));

  if (account) paintAccountHead(face, account.username);
}

/* --------------------------------------------------------------- routing */

let renderedRoute = null;

/* Where a route sits along the bar. ROUTES order is the bar's order, and the
   one hidden route (Accounts) is last in it — which is also where the account
   menu that opens it sits, so it slides in from the right like a tab past
   Settings would. */
const routeOrder = (id) => Math.max(0, ROUTES.findIndex((entry) => entry.id === id));

function renderRoute() {
  const route = ROUTES.find((entry) => entry.id === state.route) || ROUTES[0];
  const changed = renderedRoute !== route.id;
  const from = renderedRoute;
  /* The page on its way out is told so, before its nodes go: Home has clocks
     ticking that would otherwise go on writing into rows nobody can see. */
  if (changed && renderedRoute) ROUTES.find((entry) => entry.id === renderedRoute)?.page.unmounted?.();
  /* Leaving a page is the other way of saying the What's-new line was read;
     the first paint is not a page change and leaves it up. */
  if (changed && from) dismissNews();
  renderedRoute = route.id;

  const node = route.page.render();
  if (changed) {
    // Moving left along the bar brings the page in from the left.
    if (from && routeOrder(route.id) < routeOrder(from)) node.dataset.enter = 'back';
    node.classList.add('page--enter');
    const clear = () => node.classList.remove('page--enter');
    node.addEventListener('animationend', clear, { once: true });
    setTimeout(clear, 600);
  }
  mount(mainRegion, node);

  for (const item of navNode.querySelectorAll('.nav-item')) {
    const isActive = item.dataset.tab === route.id;
    item.classList.toggle('is-active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  navStrip?.move();

  /* The shell reads this: Home softens the panorama, the rest show it sharp. */
  document.documentElement.dataset.route = route.id;
  route.page.mounted?.();
  document.title = `${APP_NAME} — ${route.label}`;
  /* Home's version line is a new node on every paint; the capsule follows it. */
  placeNews();
}

function onStateChange(reason) {
  if (reason === 'settings' || reason === 'settings:reset') {
    syncWorld();
  }
  if (reason === 'route') {
    closeMenu();
    renderRoute();
    return;
  }

  if (reason === 'accounts') {
    paintAccountChip();
    if (signingInFirst && activeAccount()) {
      signingInFirst = false;
      offerAfterSignIn();
    }
    if (state.route === 'home' || state.route === 'accounts') renderRoute();
    return;
  }

  /* One row per running game, repainted in place — this arrives ten times a
     second while an install runs, so it must never rebuild the page. */
  if (reason === 'sessions') {
    document.documentElement.dataset.gameState = gameStatus();
    // A game starting or ending is what decides whether the world may turn
    // behind an unfocused launcher.
    paceWorld();
    if (state.route === 'home') homePage.syncSessions();
    return;
  }

  /* Pages that own a list repaint it themselves in the click handler.
     Rebuilding on top of that threw away scroll position and focus. */
  if (reason === 'profiles') {
    if (state.route === 'home') { homePage.syncLaunchButton(); homePage.syncProfile(); return; }
    if (state.route === 'profiles') return;
    // Its picker makes the profile active now (2026-09-09), and repaints itself.
    if (state.route === 'mods') return;
  }

  if (reason === 'mods' && state.route === 'mods') return;
  if (reason === 'settings' && state.route === 'settings') return;
  // Stats' only settings are the cape and its colours, and it repaints those
  // itself (paintCapes, 2026-09-13); a rebuild here threw the scroll away on
  // every colour picked.
  if (reason === 'settings' && state.route === 'stats') return;

  renderRoute();
}

/* ----------------------------------------------------------- host events */

function wireHost() {
  /**
   * A launch has begun. The host names the session and the profile; the rest
   * of the row — version, loader, heap, who it signed in as — is read from
   * the copy of the profile this window already holds, because the account
   * that will run it is the one that is active at this moment.
   */
  const adoptSession = (id, profile) => {
    const known = state.profiles.find((entry) => entry.id === profile.id);
    upsertSession({
      id,
      profileId: profile.id,
      name: profile.name,
      version: known?.version || '',
      loader: known?.loader || 'vanilla',
      memoryMb: known?.memoryMb || state.settings?.game?.memoryMb || 4096,
      username: activeAccount()?.username || null,
      status: 'working',
      percent: 0,
      label: 'Preparing launch',
      startedAt: null
    });
  };

  host.game.onProgress(({ id, percent, label, stage }) => {
    const session = state.sessions.find((entry) => entry.id === id);
    // The pipeline emits a final 100% tick *after* announcing 'playing'.
    if (!session || session.status === 'playing') return;
    patchSession(id, { percent, label, stage });
  });

  host.game.onStateChange(({ id, state: next, profile, startedAt, reason, error, crashed, crash, running }) => {
    if (next === 'working') {
      adoptSession(id, profile);
      return;
    }

    if (next === 'playing') {
      patchSession(id, { status: 'playing', percent: 100, startedAt: startedAt || Date.now() });
      noteLevelAtStart(id);
      // With one game up it is simply Minecraft; with two it matters which.
      toast(running > 1 ? `${profile.name} is starting` : 'Minecraft is starting', 'success');
      return;
    }

    const ending = state.sessions.find((entry) => entry.id === id);
    // A crash keeps its row (2026-09-11): Home turns the running row into one
    // that says why and what to do, before the session is dropped from the
    // list — so the row is already spoken for when syncSessions prunes.
    if (crashed && crash) homePage.noteCrash(id, crash);

    dropSession(id);
    if (reason === 'cancelled') return;

    if (crashed && crash) {
      // The row is the message. Off Home, one line says where it is.
      if (state.route !== 'home') toast(`${profile.name} crashed — the reason is on Play`, 'error', 7000);
      return;
    }

    // A launch that never got a window reports through the launch call itself;
    // only a session that died after starting is announced here.
    if (crashed && error) toast(error, 'error', 7000);
    else if (!error) recap(id, ending, running ? `${profile.name} closed` : 'Minecraft closed');
  });

  host.game.onWarning(({ profile, message, details }) => {
    // With one game starting the warning is obviously about it; with two the
    // toast has to say which profile it came from.
    const whose = state.sessions.length > 1 && profile ? `${profile.name}: ` : '';
    toast(`${whose}${message}: ${(details || []).join(', ')}`, 'error', 7000);
  });

  // Main renewed a Microsoft token before launching. Adopt its list so the
  // next account action persists the fresh token, not the stale copy.
  host.auth.onAccountsChanged?.(({ list }) => {
    if (!Array.isArray(list)) return;
    state.accounts = list;
    notify('accounts');
  });

  const paintMaximize = (maximized) => {
    maximizeButton.innerHTML = maximized ? icons.restore : icons.maximize;
    maximizeButton.setAttribute('aria-label', maximized ? 'Restore' : 'Maximise');
  };

  host.window.onStateChange(({ maximized, away: gone } = {}) => {
    if (typeof maximized === 'boolean') paintMaximize(maximized);
    if (typeof gone === 'boolean') { away = gone; paceWorld(); capesAway(gone); }
  });
  host.window.isMaximized().then(paintMaximize);

}

/* ---------------------------------------------------------------- recap */

/* The level each running game started at, by session, for the recap. */
const levelAtStart = new Map();

async function readLevel() {
  try {
    return (await host.ledger?.summary?.())?.level || null;
  } catch {
    return null;
  }
}

async function noteLevelAtStart(id) {
  const level = await readLevel();
  if (level) levelAtStart.set(id, level.level);
}

/**
 * What a game that just closed was worth (2026-09-24). "Minecraft closed"
 * told a player who had just played for two hours nothing they did not know;
 * the moment the game hands back is the one to say what the time bought —
 * "Minecraft closed · 1h 12m played · 2h 5m to Level 8". The time is the
 * launcher's own clock on the row; the level is the ledger's, read a moment
 * after the exit the way Home reads it (the mod writes on its way out). A
 * level reached in that game is left to play.js's announce, which says it
 * with the cape; the recap then says only the time. A sitting under a
 * minute, or a ledger that does not answer, is the plain line it always was.
 */
function recap(id, session, plain) {
  const began = levelAtStart.get(id);
  levelAtStart.delete(id);
  const playedMs = session?.startedAt ? Date.now() - session.startedAt : 0;
  if (playedMs < 60000) { toast(plain, 'info'); return; }
  setTimeout(async () => {
    const level = await readLevel();
    const parts = [plain, `${spell(playedMs)} played`];
    if (level && began && level.level === began) parts.push(levelLine(level));
    toast(parts.join(' · '), 'info', 5200);
  }, 1600);
}

/* ------------------------------------------------------------- shortcuts */

/**
 * Ctrl+1–5 for the tabs and Ctrl+, for Settings, and nothing else. The
 * Ctrl+K command palette went on 2026-09-06: reachable only by a shortcut
 * nothing on screen mentioned, every item on it a tab that already had a tab,
 * and the one hidden thing in a launcher whose rule is that nothing is.
 * (It read [1-6] for the afternoon Worlds was a tab, 2026-09-11.)
 */
function wireShortcuts() {
  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);

    if (mod && /^[1-5]$/.test(event.key)) {
      event.preventDefault();
      const target = tabs()[Number(event.key) - 1];
      if (target) setRoute(target.id);
      return;
    }

    if (typing) return;

    if (mod && event.key === ',') {
      event.preventDefault();
      setRoute('settings');
    }
  });

  document.addEventListener('contextmenu', (event) => {
    if (!/^(INPUT|TEXTAREA)$/.test(event.target.tagName)) event.preventDefault();
  });
}
