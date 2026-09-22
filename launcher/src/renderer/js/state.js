/**
 * Application state.
 *
 * A single observable object with a flat set of actions. There is no framework
 * here on purpose: the launcher has one window, a handful of screens and a
 * small amount of data, so a store plus targeted re-renders is both smaller and
 * faster than shipping a UI library.
 */

import { host } from './bridge.js';
import { APP_NAME } from './config.js';

const listeners = new Set();

export const state = {
  ready: false,
  route: 'home',
  settings: null,
  system: null,
  profiles: [],
  accounts: [],
  activeAccountId: null,
  activeProfileId: null,
  /* Which profiles share their in-game settings (2026-09-17): profile id to
     sync-group id, for the ones in a group. Main keeps the record beside the
     profiles; this is its answer, refreshed by every link and leave. A
     profile not in it has settings of its own. */
  settingsGroups: {},
  /* Every game currently starting or running, oldest first — one entry per
     press of Play. The launcher runs several at once, so there is no single
     "the game": Home draws one row per session and each carries its own
     progress, account and clock. */
  sessions: []
};

/* ------------------------------------------------------------ pub / sub */

export function subscribe(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export function notify(reason = 'update') {
  for (const handler of listeners) handler(reason, state);
}

/* ---------------------------------------------------------------- seeds */

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Shipped on first run so the launcher is never an empty shell.
 *
 * One profile, not a shelf of samples. The three that used to be here claimed
 * play times and disk sizes that had never happened, and two of them sat on
 * loaders this launcher cannot start — a first impression that lies and then
 * fails when pressed. A single Fabric profile on the current version, already
 * carrying the performance stack, is the one a new player wants to press Play
 * on, and everything it says about itself is true.
 *
 * On the newest Minecraft the shipped jars carry BlueClient for — main asks
 * Mojang's list and the jars (2026-09-06). It was a typed-in 1.21.4, which
 * stayed there for four releases; the fallback below is only for a first run
 * with no network.
 */
function seedProfiles(version) {
  return [{
    id: uid(),
    name: `${APP_NAME} ${version}`,
    icon: 'grass',
    version,
    loader: 'fabric',
    // Empty means "resolve the newest loader at install time", which is how the
    // pinned 0.16.9 here came to be three releases behind what actually ran.
    loaderVersion: '',
    memoryMb: null,
    lastPlayed: null,
    installed: false,
    mods: performanceStack()
  }];
}

const SEED_VERSION = '1.21.8';

/**
 * The thirteen jars every new Fabric profile is born with.
 *
 * Chosen for one player: someone on an SMP or a PvP server who wants more
 * frames and no setup. Everything here either raises the frame rate, lowers
 * the memory, or smooths the connection to a server — nothing changes how the
 * game looks or plays, so a profile can carry all of it without surprising
 * anyone. The ninth, since 2026-09-11, is the one exception, and it is inert
 * until a switch in the game's own menu is thrown: see its line below. The
 * tenth and eleventh (2026-09-20) are not about frames at all — see theirs.
 *
 * ModernFix was dropped on 2026-09-03. It shortens a modpack's load time,
 * which is real work on a hundred jars and nothing measurable on this handful,
 * and it was the mod in the stack most likely to hold a profile back on the
 * day a new Minecraft release lands.
 */
function performanceStack() {
  return [
    { slug: 'sodium', name: 'Sodium', author: 'CaffeineMC', description: 'Redraws the world far faster. The single biggest frame-rate gain.' },
    { slug: 'lithium', name: 'Lithium', author: 'CaffeineMC', description: 'Makes mobs, chunks and physics run faster.' },
    { slug: 'ferrite-core', name: 'FerriteCore', author: 'malte0811', description: 'Uses less memory, so the game stutters less.' },
    { slug: 'entityculling', name: 'Entity Culling', author: 'tr7zw', description: 'Skips drawing mobs you cannot actually see.' },
    { slug: 'immediatelyfast', name: 'ImmediatelyFast', author: 'RaphiMC', description: 'Speeds up the on-screen bars, text and menus.' },
    // Two more of the same kind since 2026-09-20 — the ones the big
    // optimisation packs (Fabulously Optimized, Simply Optimized) ship
    // beside Sodium and that change nothing a player can see: faces of
    // blocks hidden behind other blocks, item frames, signs and paintings
    // nobody can see are not drawn; and the client stops recomputing what
    // has not changed (the sky's angle, the light engine's idle ticks,
    // the tick counter). Adrian: "improve FPS drastically without
    // affecting gameplay … the quality hasnt been compromised". More
    // Culling's defaults leave leaves alone (DEFAULT, the game's own).
    { slug: 'moreculling', name: 'More Culling', author: 'FX - PR0CESS', since: '1.21', description: 'Skips drawing block faces, item frames, signs and paintings that cannot be seen.' },
    { slug: 'badoptimizations', name: 'BadOptimizations', author: 'Thosea', since: '1.21.1', description: 'Stops the game recomputing things that have not changed, frame after frame.' },
    { slug: 'krypton', name: 'Krypton', author: 'astei', description: 'Tidies up the code that talks to servers.' },
    { slug: 'dynamic-fps', name: 'Dynamic FPS', author: 'juliand665', description: 'Winds the game down while it sits behind something else. Kinder to a laptop.' },
    { slug: 'iris', name: 'Iris Shaders', author: 'IrisShaders', description: 'Lets you turn on shader packs. Works with Sodium.' },
    // The one that changes how the game looks — but only when its switch in
    // Blue Settings (Visual → Dynamic lights) is on, which it is not until
    // the player says so; the mod itself is held off by the companion
    // otherwise. `since` is the first Minecraft it exists for: there is no
    // build for 1.20.5 or 1.20.6, and game/mods.js leaves it out of such a
    // profile quietly rather than warning on every launch (2026-09-11).
    { slug: 'lambdynamiclights', name: 'LambDynamicLights', author: 'LambdAurora', since: '1.21', description: 'A torch in your hand lights the blocks around you. Switched on under Visual in Blue Settings.' },
    // Adrian, 2026-09-20: "ppl have a bug since months ago where without
    // this kind of mod, they cant open chat, when i first launched on
    // blueclient, i had too till i installed it back". On, like the stack.
    { slug: 'no-chat-reports', name: 'No Chat Reports', author: 'Aizistral', description: 'Keeps the chat working on servers where message signing would lock it, and makes your messages unreportable.' },
    // In the list, off: there so a PvP player finds it on the Mods page
    // with one switch, and nobody else sees a tier beside a name they did
    // not ask for. Fabric only, and no build past 26.1.2 as of 2026-09-20.
    { slug: 'mcpvp.com-tier-tagger', name: 'McPvP.com Tier Tagger', author: 'chickenmcpickle', enabled: false, description: 'Shows PvP tiers from mcpvp.com beside player names. Off until you switch it on.' }
  ].map((mod) => ({
    id: uid(),
    enabled: true,
    version: 'latest',
    source: 'modrinth',
    iconUrl: '',
    ...mod
  }));
}

/* ------------------------------------------------------------------ init */

export async function initState() {
  /* Every question the first paint needs goes to main at once (2026-09-22).
     The running games and the sync groups were asked one after the other,
     after the settings and after every write below — two more round trips
     in a row before Home could paint, on a main process that is at its
     busiest while the window opens. Neither depends on anything here. A
     failed answer is an empty one: a window that cannot list its games
     still has to open. */
  const running = Promise.resolve().then(() => host.game.sessions()).catch(() => []);
  const groups = Promise.resolve().then(() => host.settings.groups()).catch(() => null);
  const [settings, system] = await Promise.all([host.settings.get(), host.system.info()]);

  state.settings = settings;
  state.system = system;

  // Collections live in the same settings file; seed them once.
  if (Array.isArray(settings.profiles) && settings.profiles.length) {
    state.profiles = settings.profiles;
  } else {
    const newest = await host.game.newest().catch(() => null);
    state.profiles = seedProfiles(newest?.version || SEED_VERSION);
  }
  state.accounts = settings.accounts?.list ?? [];
  state.activeAccountId = settings.accounts?.active ?? state.accounts[0]?.id ?? null;

  const lastProfile = settings.game?.lastProfile;
  state.activeProfileId = state.profiles.some((p) => p.id === lastProfile)
    ? lastProfile
    : mostRecentProfile()?.id ?? null;

  // Runs after activeProfileId is known — the migration needs it.
  const migrated = adoptLooseMods(settings.mods);

  if (!Array.isArray(settings.profiles) || migrated) {
    await persist({ profiles: state.profiles, mods: null });
  }

  if (healAccountTypes()) {
    await persist({ accounts: { list: state.accounts, active: state.activeAccountId } });
  }

  if (topUpStack()) {
    await persist({ profiles: state.profiles });
  }

  applyTheme(settings.launcher?.theme || 'dark');

  // Games survive a reload of this window, so the rows are rebuilt from what
  // the host says is actually running rather than assumed to be nothing.
  state.sessions = (await running) || [];
  state.settingsGroups = (await groups) || {};

  state.ready = true;
  notify('ready');
}

/* ------------------------------------------------------------ selectors */

export const activeAccount = () => state.accounts.find((a) => a.id === state.activeAccountId) || null;
export const activeProfile = () => state.profiles.find((p) => p.id === state.activeProfileId) || null;

export function mostRecentProfile() {
  return [...state.profiles].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0] || null;
}

/* ---- sessions ---------------------------------------------------------
   The host owns them: it hands over a summary per running game and this is
   only a mirror of that, kept current by the progress and state events. */

export const sessionsFor = (profileId) => state.sessions.filter((s) => s.profileId === profileId);

/** One word for the whole launcher — playing beats working beats idle. */
export function gameStatus() {
  if (state.sessions.some((s) => s.status === 'playing')) return 'playing';
  if (state.sessions.length) return 'working';
  return 'idle';
}

/** Memory the running games have already reserved, in MB. */
export function reservedMemoryMb() {
  const fallback = state.settings?.game?.memoryMb || 4096;
  return state.sessions.reduce((sum, s) => sum + (s.memoryMb || fallback), 0);
}

/** A launch has started, or one already running changed. */
export function upsertSession(entry) {
  const index = state.sessions.findIndex((s) => s.id === entry.id);
  if (index >= 0) state.sessions[index] = { ...state.sessions[index], ...entry };
  else state.sessions.push(entry);
  notify('sessions');
}

export function patchSession(id, patch) {
  const session = state.sessions.find((s) => s.id === id);
  if (!session) return;
  Object.assign(session, patch);
  notify('sessions');
}

export function dropSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  notify('sessions');
}

/* -------------------------------------------------------------- actions */

async function persist(patch) {
  state.settings = await host.settings.merge(patch);
  return state.settings;
}

export function setRoute(route) {
  if (state.route === route) return;
  state.route = route;
  notify('route');
}

/**
 * There is one theme (2026-09-09, Adrian: "remove light mode completely").
 * The argument is ignored rather than removed so a settings file that still
 * carries `launcher.theme: "light"` from before that day is read unchanged and
 * simply lands on the glass like everyone else.
 */
export function applyTheme() {
  document.documentElement.dataset.theme = 'dark';
}

/**
 * Background blur (2026-09-15): Settings › General › Background blur, a
 * slider from 0 to 100 that softens the world behind everything, live as it
 * is dragged. The number lands on the document root as `--world-blur` and
 * the shell's stylesheet turns it into a filter on the world and the still
 * under it. At 0 the property and the attribute come off the root
 * altogether, so a launcher at 0 draws the world exactly the way it did
 * before the setting existed — no filter, no layer, nothing. (The default
 * is 15 since 0.38.1 the same afternoon, so most launchers carry the
 * filter; 0 is still the way out of it.) The slider calls this on every
 * input; applyWorldLook() below is what the saved settings call at boot
 * and after a change.
 */
export function paintWorldBlur(value) {
  const amount = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const node = backdropBox();
  if (!node) return;
  if (amount > 0) {
    node.style.setProperty('--world-blur', String(amount));
    node.dataset.worldBlur = String(amount);
  } else {
    node.style.removeProperty('--world-blur');
    delete node.dataset.worldBlur;
  }
}

/**
 * Background brightness (2026-09-15, 0.38.1): Settings › General ›
 * Background brightness, a slider from 10 to 100 that dims the world behind
 * everything, live as it is dragged — the same shape as the blur, the same
 * filter in shell.css. 100 is the world as it is drawn, and the top of the
 * slider: it only goes down from there (Adrian: "the current one should be
 * max, and then you can drag it lower to decrease it"). At 100 the property
 * and the attribute come off the root, the way blur's do at 0, so a
 * launcher at 100 adds nothing. (The default is 80 since 0.38.2, the same
 * hour — "make default to brightness as 80%" — so most launchers carry the
 * filter; 100 is still the top and the way out of it.)
 */
export function paintWorldBrightness(value) {
  const amount = Math.max(10, Math.min(100, Math.round(Number(value) || 100)));
  const node = backdropBox();
  if (!node) return;
  if (amount < 100) {
    node.style.setProperty('--world-brightness', String(amount));
    node.dataset.worldDim = String(amount);
  } else {
    node.style.removeProperty('--world-brightness');
    delete node.dataset.worldDim;
  }
}

/**
 * The backdrop box the two numbers go on (2026-09-22).
 *
 * They were set on <html> until today, and a custom property on the document
 * root is inherited by every element in it: Chromium marks the whole document
 * for a style recalc on each change, so ONE pointer move on either slider
 * restyled every node on the page — the exact failure CLAUDE.md's
 * root-property rule was written about after the cape clock cost Clips 16-29
 * ms five times a second. Only the backdrop box's own subtree reads them
 * (shell.css), so that is where they belong, and a drag now recalculates four
 * elements. The sliders are painted live, so this is per pointer move.
 */
let backdrop = null;
function backdropBox() {
  if (!backdrop || !backdrop.isConnected) backdrop = document.querySelector('.shell__back');
  return backdrop;
}

export function applyWorldLook() {
  paintWorldBlur(state.settings?.launcher?.worldBlur);
  paintWorldBrightness(state.settings?.launcher?.worldBrightness);
}

/**
 * `silent` writes the patch without telling the pages (2026-09-17): Home's
 * arrange mode saves the layout on every drag and is itself the screen that
 * shows it, and a 'settings' notification rebuilds Home whole — overlays,
 * drag and all — under the hand that is still moving a card.
 */
export async function updateSettings(patch, { silent = false } = {}) {
  await persist(patch);
  if (!silent) notify('settings');
}

export async function resetSettings() {
  const fresh = await host.settings.reset();
  state.settings = fresh;
  applyTheme('dark');
  /* The accounts go back in with the profiles (2026-09-22). Main's reset is
     the whole file back to its defaults — `accounts` included — and only the
     profiles were written back, so the list stayed in this window's memory
     and was gone from the disk: the next start opened on "Add account", with
     the Microsoft sign-in to do again, under a button that says "Profiles,
     mods and accounts are kept". Which profile launches is kept with them. */
  await persist({
    profiles: state.profiles,
    accounts: { list: state.accounts, active: state.activeAccountId },
    game: { lastProfile: state.activeProfileId }
  });
  // A distinct reason: the settings page skips plain 'settings' notifications
  // (its own controls are already up to date), but a reset changes every
  // value at once and does need a full rebuild.
  notify('settings:reset');
}

/* ---- accounts ---- */

export async function addAccount(username) {
  const name = String(username || '').trim();
  if (!name) return null;

  const account = {
    id: uid(),
    username: name,
    // Deterministic stand-in. The launcher derives the real offline UUID the
    // same way a server would, from the name.
    uuid: `offline-${name.toLowerCase()}`,
    // These accounts were being labelled 'microsoft', which is what made every
    // account in the list claim an ownership check that had never happened.
    type: 'offline',
    addedAt: Date.now()
  };

  state.accounts.push(account);
  state.activeAccountId = account.id;
  await persist({ accounts: { list: state.accounts, active: account.id } });
  notify('accounts');
  return account;
}

/**
 * Sign in with a real Microsoft account.
 *
 * The whole exchange happens in the main process — the renderer never sees a
 * password, and the refresh token arrives already encrypted. Signing in again
 * as someone already added replaces that entry rather than duplicating it,
 * which is also how an expired account is repaired.
 */
export async function signInWithMicrosoft() {
  const result = await host.auth.signIn();
  if (!result.ok) return result;

  const signed = {
    id: uid(),
    type: 'microsoft',
    addedAt: Date.now(),
    ...result.account
  };

  const existing = state.accounts.findIndex(
    (a) => a.type === 'microsoft' && a.uuid === signed.uuid);

  if (existing >= 0) signed.id = state.accounts[existing].id;
  if (existing >= 0) state.accounts[existing] = signed;
  else state.accounts.push(signed);

  state.activeAccountId = signed.id;
  await persist({ accounts: { list: state.accounts, active: signed.id } });
  notify('accounts');
  return { ok: true, account: signed };
}

export async function setActiveAccount(id) {
  if (!state.accounts.some((a) => a.id === id)) return;
  state.activeAccountId = id;
  await persist({ accounts: { list: state.accounts, active: id } });
  notify('accounts');
}

export async function removeAccount(id) {
  state.accounts = state.accounts.filter((a) => a.id !== id);
  if (state.activeAccountId === id) state.activeAccountId = state.accounts[0]?.id ?? null;
  await persist({ accounts: { list: state.accounts, active: state.activeAccountId } });
  notify('accounts');
}

/* ---- profiles ---- */

export async function setActiveProfile(id) {
  if (!state.profiles.some((p) => p.id === id)) return;
  state.activeProfileId = id;
  await persist({ game: { lastProfile: id } });
  notify('profiles');
}

export async function addProfile({ name, version, loader, loaderVersion, icon }) {
  const profile = {
    id: uid(),
    name: name?.trim() || ownName(loader, version),
    icon: icon || 'grass',
    version,
    loader,
    loaderVersion: loaderVersion || '',
    // null means "use the global setting"; a number overrides it for this
    // profile only, which is the whole point of having profiles.
    memoryMb: null,
    lastPlayed: null,
    installed: false,
    // A new Fabric profile is born fast rather than being left to the player
    // to discover that it should have been.
    mods: loader === 'fabric' ? performanceStack() : []
  };
  state.profiles.unshift(profile);
  state.activeProfileId = profile.id;
  await persist({ profiles: state.profiles, game: { lastProfile: profile.id } });
  notify('profiles');
  return profile;
}

/**
 * Profiles brought over from another launcher (2026-09-16), as main shaped
 * them: the jars are already in the profile's folder, the record only has
 * to be kept. A Fabric profile gets the performance stack the way a new one
 * does, under whatever it brought — a mod the other launcher had (Sodium,
 * Iris) is that launcher's copy of the same thing, and the player's own
 * enabled/disabled choice on it stands. The first one brought becomes the
 * current profile, so the Profiles page lands on it.
 */
export async function adoptProfiles(records) {
  const list = (Array.isArray(records) ? records : []).filter((r) => r && r.id && r.version);
  if (!list.length) return [];
  const taken = new Set(state.profiles.map((p) => p.name));
  const adopted = list.map((r) => {
    let name = String(r.name || `${loaderLabel(r.loader)} ${r.version}`).trim() || r.version;
    let n = 2;
    const base = name;
    while (taken.has(name)) name = `${base} (${n++})`;
    taken.add(name);
    const theirs = Array.isArray(r.mods) ? r.mods : [];
    const have = new Set(theirs.map((m) => m.slug));
    const mods = r.loader === 'fabric'
      ? [...theirs, ...performanceStack().filter((m) => !have.has(m.slug))]
      : [];
    return {
      id: r.id, name, icon: r.icon || 'grass', version: r.version, loader: r.loader === 'fabric' ? 'fabric' : 'vanilla',
      loaderVersion: r.loaderVersion || '', memoryMb: Number(r.memoryMb) > 0 ? Number(r.memoryMb) : null,
      lastPlayed: null, installed: false, mods, imported: r.imported || null
    };
  });
  state.profiles.unshift(...adopted);
  state.activeProfileId = adopted[0].id;
  await persist({ profiles: state.profiles, game: { lastProfile: adopted[0].id } });
  notify('profiles');
  return adopted;
}

/** Copy a profile, including its overrides, with a distinct name. */
export async function duplicateProfile(id) {
  const source = state.profiles.find((p) => p.id === id);
  if (!source) return null;

  const base = source.name.replace(/\s+\(copy(?: \d+)?\)$/i, '');
  let name = `${base} (copy)`;
  let n = 2;
  while (state.profiles.some((p) => p.name === name)) name = `${base} (copy ${n++})`;

  const copy = {
    ...source,
    id: uid(),
    name,
    lastPlayed: null,
    installed: false,
    mods: profileMods(id).map((m) => ({ ...m, id: uid() }))
  };
  const index = state.profiles.findIndex((p) => p.id === id);
  state.profiles.splice(index + 1, 0, copy);
  await persist({ profiles: state.profiles });
  notify('profiles');
  return copy;
}

export async function updateProfile(id, patch) {
  const profile = state.profiles.find((p) => p.id === id);
  if (!profile) return;
  // A name the launcher wrote follows the version and the loader until the
  // player types one of their own (2026-09-21): New profile makes
  // "Fabric 26.3", and a pick of 1.21.8 off the wall used to leave a card
  // reading "Fabric 26.3 — 1.21.8 · Fabric". The launcher's own name is
  // recognised by its shape, so nothing new is stored and a name the player
  // typed — even one that happens to look like ours for another version —
  // is never touched.
  const wasOurs = profile.name === ownName(profile.loader, profile.version);
  Object.assign(profile, patch);
  if (wasOurs && (patch.version !== undefined || patch.loader !== undefined) && patch.name === undefined) {
    profile.name = ownName(profile.loader, profile.version);
  }
  await persist({ profiles: state.profiles });
  notify('profiles');
}

/** The name a profile is born with when the player gives it none. */
export function ownName(loader, version) {
  return `${loader === 'vanilla' ? 'Minecraft' : loaderLabel(loader)} ${version}`;
}

/**
 * Take a profile off the list and its folder off the disk.
 *
 * The folder goes to the Recycle Bin (main, `game:remove-instance`), because a
 * world is the one thing in it a player cannot make again. A profile with a
 * game still running on it keeps its folder — the game has the files open —
 * and the answer says so, so the page can. The list entry goes either way.
 */
export async function removeProfile(id) {
  const result = await host.game.removeInstance(id).catch(() => ({ ok: false }));
  state.profiles = state.profiles.filter((p) => p.id !== id);
  // Main took it out of its sync group (and dissolved a group of one); the
  // editor of whichever profile is shown next reads the map, so ask again.
  state.settingsGroups = (await host.settings.groups().catch(() => null)) || state.settingsGroups;
  if (state.activeProfileId === id) state.activeProfileId = mostRecentProfile()?.id ?? null;
  await persist({ profiles: state.profiles, game: { lastProfile: state.activeProfileId } });
  notify('profiles');
  return result;
}

export async function touchProfile(id) {
  await updateProfile(id, { lastPlayed: Date.now(), installed: true });
}

/* ---- settings sync (2026-09-17) ---- */

/** The profiles whose in-game settings this one shares, other than itself. */
export function syncedWith(id) {
  const group = state.settingsGroups[id];
  if (!group) return [];
  return state.profiles.filter((p) => p.id !== id && state.settingsGroups[p.id] === group);
}

/**
 * Sync one profile's settings with another's: it takes the other's
 * keybinds, video settings, server list, packs and mod settings now and
 * follows them from then on, both ways. Main does the copying and answers
 * the fresh map; `ok: false, running: true` means a game has one of them
 * open and the page says so.
 */
export async function linkSettings(id, targetId) {
  const answer = await host.settings.link(id, targetId).catch((error) => ({ ok: false, error: String(error?.message || error) }));
  if (answer?.ok) {
    state.settingsGroups = answer.groups || {};
    notify('profiles');
  }
  return answer;
}

/**
 * The profiles a setting made on this one reaches, as words: the profile's
 * own name alone, or "Survival and Mainprofile" — for the lines on the
 * packs view that used to say "every profile".
 */
export function settingsScopeWords(id) {
  const own = state.profiles.find((p) => p.id === id);
  const names = [own, ...syncedWith(id)].filter(Boolean).map((p) => p.name);
  if (!names.length) return 'this profile';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Stop syncing: the profile keeps a copy of the settings as they stand. */
export async function unlinkSettings(id) {
  const answer = await host.settings.leave(id).catch((error) => ({ ok: false, error: String(error?.message || error) }));
  if (answer?.ok) {
    state.settingsGroups = answer.groups || {};
    notify('profiles');
  }
  return answer;
}

/* ---- mods -------------------------------------------------------------
   A mod list is part of a profile, not of the launcher: the same jar cannot
   serve a Fabric 1.21 profile and a Forge 1.20 one, so there is no coherent
   launcher-wide list to keep. Every profile owns its own. */

export function profileMods(id) {
  const profile = state.profiles.find((p) => p.id === id);
  if (!profile) return [];
  if (!Array.isArray(profile.mods)) profile.mods = [];
  return profile.mods;
}

export function modCount(id) {
  const mods = profileMods(id);
  return { total: mods.length, enabled: mods.filter((m) => m.enabled).length };
}

export async function addMod(profileId, mod) {
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile) return null;

  const entry = {
    id: uid(),
    name: mod.name,
    author: mod.author || 'Unknown',
    version: mod.version || '1.0.0',
    description: mod.description || '',
    enabled: true,
    source: mod.source || 'local',
    slug: mod.slug || '',
    iconUrl: mod.iconUrl || ''
  };

  profileMods(profileId).push(entry);
  await persist({ profiles: state.profiles });
  notify('mods');
  return entry;
}

export async function toggleMod(profileId, modId) {
  const mod = profileMods(profileId).find((m) => m.id === modId);
  if (!mod) return;
  mod.enabled = !mod.enabled;
  await persist({ profiles: state.profiles });
  notify('mods');
}

export async function removeMod(profileId, modId) {
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile) return;
  profile.mods = profileMods(profileId).filter((m) => m.id !== modId);
  await persist({ profiles: state.profiles });
  notify('mods');
}

/** Keep a mod's Modrinth artwork address once it has been looked up, so the
    next paint has it without asking again. Quiet: nothing needs repainting. */
export async function setModIcon(profileId, modId, iconUrl) {
  const mod = profileMods(profileId).find((m) => m.id === modId);
  if (!mod || !iconUrl || mod.iconUrl === iconUrl) return;
  mod.iconUrl = iconUrl;
  await persist({ profiles: state.profiles });
}

/**
 * One-time repair: offline accounts wearing the Microsoft label (2026-09-04).
 *
 * Builds before addAccount() was fixed stamped `type: 'microsoft'` on every
 * account, offline ones included, and the record outlives the bug — Adrian's
 * own launcher still holds one from 27 August. It matters because the type is
 * a claim: the account chip says Microsoft, so the player believes they are
 * signed in, and then `launcher.js` quite correctly launches them offline
 * (that check is `type === 'microsoft' && accessToken`, and there is no token),
 * and the first premium server they try turns them away with no explanation
 * anywhere in the launcher.
 *
 * The test is deliberately narrow — Microsoft in name, no token of either
 * kind, and a UUID that is one of ours rather than Mojang's — so it can only
 * ever catch a record the old bug wrote. A real account that has merely
 * expired keeps its refresh token and is left alone.
 */
function healAccountTypes() {
  let changed = false;

  for (const account of state.accounts) {
    if (account.type !== 'microsoft') continue;
    if (account.accessToken || account.refreshToken) continue;
    if (!String(account.uuid || '').startsWith('offline-')) continue;

    account.type = 'offline';
    changed = true;
  }

  return changed;
}

/**
 * One-time migration. Earlier builds kept a single launcher-wide mod list;
 * hand it to the profiles that can actually load it (any non-vanilla one) so
 * nothing the user had disappears.
 */
function adoptLooseMods(loose) {
  const needsMods = state.profiles.filter((p) => !Array.isArray(p.mods));
  if (!needsMods.length) return false;

  /* The old page showed one list under the heading of whichever profile was
     active, so that profile is the only plausible owner. The rest start
     empty rather than each claiming a copy of jars they never loaded. */
  const owner = state.profiles.find((p) => p.id === state.activeProfileId && p.loader !== 'vanilla')
    || state.profiles.find((p) => p.loader !== 'vanilla');

  for (const profile of needsMods) {
    profile.mods = profile === owner && Array.isArray(loose)
      ? loose.map((m) => ({ ...m, id: uid() }))
      : [];
  }
  return true;
}

/**
 * A profile still carrying the launcher's own stack, untouched, gets what
 * the stack has gained since (2026-09-11).
 *
 * A profile owns its mod list, and a list the player has edited — one of the
 * eight taken out — is theirs and is left alone. A list that is exactly what
 * the launcher put there is the launcher's defaults, and the day a default
 * gains a jar those profiles should gain it too, or the one feature this
 * client is most asked for would need a visit to the Mods page that nobody
 * on the road to Play would know to make. The game installs it on the next
 * launch, as it does every other line in the list.
 */
function topUpStack() {
  const stack = performanceStack();
  // The lines a profile was born with before the stack grew: the eight of
  // 2026-09-02. Everything after them is "newer" and is what an untouched
  // list gains — LambDynamicLights (2026-09-11), No Chat Reports and the
  // Tier Tagger (2026-09-20).
  const NEWER = new Set(['lambdynamiclights', 'no-chat-reports', 'mcpvp.com-tier-tagger', 'moreculling', 'badoptimizations']);
  const older = stack.filter((mod) => !NEWER.has(mod.slug));
  const newer = stack.filter((mod) => NEWER.has(mod.slug));
  let changed = false;

  for (const profile of state.profiles) {
    if (profile.loader !== 'fabric' || !Array.isArray(profile.mods)) continue;
    const has = (slug) => profile.mods.some((mod) => mod.slug === slug);
    // Untouched means every older line is still there. One gone and the
    // player has been in here, and the list is theirs.
    if (!older.every((mod) => has(mod.slug))) continue;
    const missing = newer.filter((mod) => !has(mod.slug));
    if (!missing.length) continue;
    profile.mods.push(...missing);
    changed = true;
  }

  return changed;
}

/* -------------------------------------------------------------- helpers */

function capitalise(word) {
  return String(word || '').charAt(0).toUpperCase() + String(word || '').slice(1);
}

/**
 * Loader names are brands, so they are spelled out rather than capitalised.
 *
 * Only the two the launcher can install. Forge, NeoForge and Quilt had labels
 * and colours here long after the profile editor stopped offering them, so
 * nothing could ever reach them; a profile saved by one of those older builds
 * still falls through to the capitalised slug and a neutral dot.
 */
const LOADER_LABELS = {
  vanilla: 'Vanilla',
  fabric: 'Fabric'
};

export function loaderLabel(loader) {
  return LOADER_LABELS[loader] || capitalise(loader);
}

/* Each loader owns a colour so its tag pill reads at a glance. */
const LOADER_COLOURS = {
  vanilla: '#9aa0a8',
  fabric: '#d4b06a'
};

export function loaderColour(loader) {
  return LOADER_COLOURS[loader] || '#9aa0a8';
}

/** Rough Java requirement per version — real launchers read the manifest. */
/**
 * Which Java a Minecraft needs.
 *
 * Minecraft has been numbered two ways and the answer has to read both
 * (2026-09-07). The old scheme is `1.<major>.<patch>` — 1.21.4, 1.8.9 — where
 * the number that matters is the *second* segment. The new one, from 26.1, is
 * `<year>.<release>`, where it is the first. Reading the second segment
 * regardless meant "26.2" was taken as major 2 and every profile on the
 * current Minecraft was labelled **Java 8+** on Home and on its own card —
 * wrong, and wrong on the version this client leads with.
 */
export function javaFor(version) {
  const parts = String(version).split('.');
  const first = Number(parts[0]) || 0;
  /* A leading 1 is the old scheme and is not the version; anything else is a
     year, and every one of those is far past the last Java bump. */
  const major = first === 1 ? Number(parts[1]) || 0 : first;
  /* The year-numbered games run on Java 25 (26.1 was the bump; the runtime
     Mojang names for them is java-runtime-epsilon) — "Java 21+" on a 26.x
     card was a lower bound a Java 21 cannot meet (2026-09-21). */
  if (first !== 1 && major >= 26) return 'Java 25';
  if (major >= 21) return 'Java 21+';
  if (major >= 18) return 'Java 17+';
  return 'Java 8+';
}

export function relativeTime(timestamp) {
  if (!timestamp) return 'Never played';
  const diff = Date.now() - timestamp;
  const minute = 6e4, hour = 36e5, day = 864e5;
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < day * 7) return `${Math.floor(diff / day)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "1.2 GB", "340 MB", "12 KB" — for the Storage page's folders. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
