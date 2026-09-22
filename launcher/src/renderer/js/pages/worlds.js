/**
 * Worlds — every singleplayer save the launcher can see, and their backups
 * (2026-09-11).
 *
 * One centred column of three groups, in this order: the current profile's
 * worlds, then **Your other profiles** (every other profile's worlds, and
 * any world left behind by a profile that no longer exists — that one gets
 * only **Bring it here**, worlds.js's own rule, not this page's), then
 * **On this PC, in other launchers** — every `saves/` folder the settings
 * sync already knows how to find. The first and third groups always show,
 * even empty, and say the true thing when they are; the middle one is the
 * common case for a one-profile install and simply is not there when it has
 * nothing in it.
 *
 * A card never claims a fact main has not sent: a size reads "Measuring…"
 * until `worlds:size` answers (asked for on open, on every focus-refresh and
 * after every action — never in the background, per Size and speed in
 * CLAUDE.md), and the backup line says plainly when nothing has happened yet.
 * While a card's own profile is running, the line says so instead — main
 * would refuse Back up now, Restore and Delete anyway, and the reason is
 * always the same one line.
 *
 * <h2>Cards persist across a refresh, the Clips rule</h2>
 * `cards` is keyed by profile-and-folder (or, for another launcher's world,
 * by its folder under that launcher's root) and lives for as long as this
 * page's own root stays mounted. A refresh — the focus handler, or the
 * repaint after an action — only adds what is new and drops what is gone;
 * every other card keeps the node it already had, so a size that just
 * arrived is never blanked back to "Measuring…" by the next poll. Leaving
 * the tab and coming back rebuilds everything, the same as Clips.
 *
 * <h2>Play targets the world's own profile, not necessarily the active one</h2>
 * A card in "Your other profiles" still launches — its own profile, straight
 * into that world (`--quickPlaySingleplayer`), with the same duplicate- and
 * memory-warning dialogs Home's Play button uses. `allowDuplicate` and
 * `allowMemory` are copied here rather than imported: Home does not export
 * them. Lifting both into one module is a worthwhile follow-up, noted in the
 * report, not done here to keep this change to the files this page owns.
 */

import { el, mount } from '../ui/dom.js';
import { icons } from '../icons.js';
import { confirmModal, openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { launchMoment } from '../ui/burst.js';
import { host } from '../bridge.js';
import { openAccountModal } from './account.js';
import {
  state, activeAccount, setRoute, touchProfile,
  sessionsFor, reservedMemoryMb, formatBytes, relativeTime
} from '../state.js';

/* The page's own root, so a stale one (the tab was left) can be told apart
   from a live one (a refresh, or a focus event) — see the header. */
let root = null;
let countEyebrow = null;
let savesButton = null;
let currentSection = null;
let otherSection = null;
let elsewhereSection = null;

/** key -> card. See the header: kept for as long as `root` stays mounted. */
const cards = new Map();

let changedOff = null;

/* ------------------------------------------------------------------ page */

export function render() {
  if (root && !root.isConnected) cards.clear();

  countEyebrow = el('span', { class: 'eyebrow' });

  const profile = activeProfile();
  savesButton = el('button', {
    class: 'btn btn--confirm btn--lg',
    disabled: !profile,
    title: profile ? '' : 'Create a profile first',
    onClick: () => { if (profile) host.worlds.open(profile.id); }
  }, [
    el('span', { html: icons.folder, style: { display: 'contents' } }),
    el('span', { text: 'Saves folder' })
  ]);

  currentSection = groupSection();
  otherSection = groupSection();
  elsewhereSection = groupSection();

  root = el('div', { class: 'page page--worlds' }, [
    el('div', { class: 'page__inner' }, [
      el('header', { class: 'page-actions' }, [
        countEyebrow,
        el('span', { class: 'spacer' }),
        /* Grey: this only goes somewhere. The page is reached from a profile's
           editor (2026-09-11), so that is where Back goes. */
        el('button', { class: 'btn', onClick: () => setRoute('profiles') }, [
          el('span', { html: icons.chevronLeft, style: { display: 'contents' } }),
          el('span', { text: 'Back to Profiles' })
        ]),
        savesButton
      ]),
      currentSection.node,
      otherSection.node,
      elsewhereSection.node
    ])
  ]);

  refresh();
  return root;
}

/* The last subscription is dropped first (2026-09-22): the shell calls
   mounted() again when it repaints the page in place — any 'profiles' or
   'settings' notification on this route, a Play pressed here among them —
   without an unmounted() between, and each of those left one more
   worlds:changed listener on the IPC channel for the launcher's life. */
export function mounted() {
  if (changedOff) changedOff();
  changedOff = host.worlds.onChanged((payload) => onBackupLanded(payload));
}

export function unmounted() {
  if (changedOff) changedOff();
  changedOff = null;
}

/* Registered once, module-wide — the Clips page does the same. A stale
   listener is harmless: it checks the page is actually on screen before
   doing anything, and coming back to Worlds rebuilds it from scratch anyway.

   And not more than once every few seconds, Clips' rule (2026-09-22): a
   refresh lists every saves folder and measures every world's size — a
   walk of each world's files in main — and Windows sends a focus event for
   every alt-tab and every dialog that closes. */
const FOCUS_RESCAN_MS = 4000;
let lastRescan = 0;
window.addEventListener('focus', () => {
  if (!root?.isConnected) return;
  const now = Date.now();
  if (now - lastRescan < FOCUS_RESCAN_MS) return;
  lastRescan = now;
  refresh();
});

function activeProfile() {
  return state.profiles.find((p) => p.id === state.activeProfileId) || null;
}

function ownerProfile(world) {
  return state.profiles.find((p) => p.id === world.profileId) || null;
}

/* --------------------------------------------------------------- groups */

function groupSection() {
  const title = el('span', { class: 'worlds-group__title' });
  const note = el('span', { class: 'worlds-group__note' });
  const grid = el('div', { class: 'world-grid' });
  const node = el('section', { class: 'worlds-group' }, [
    el('div', { class: 'worlds-group__head' }, [title, el('span', { class: 'spacer' }), note]),
    grid
  ]);
  node.hidden = true;
  return { node, title, note, grid };
}

/* Only the newest list is painted (2026-09-22): a focus refresh and the one
   after an action can be in flight together, and an older answer landing
   last put a world just deleted back on the page until the next look. */
let refreshSeq = 0;

async function refresh() {
  const seq = ++refreshSeq;
  const result = await host.worlds.list().catch(() => null);
  if (!root?.isConnected) return;              // the tab was left while this was in flight
  if (seq !== refreshSeq) return;              // a newer list is on its way

  if (!result?.ok) {
    countEyebrow.textContent = '';
    currentSection.node.hidden = false;
    otherSection.node.hidden = true;
    elsewhereSection.node.hidden = true;
    mount(currentSection.grid, el('p', { class: 'muted', text: 'Could not read your worlds right now.' }));
    return;
  }

  const activeId = state.activeProfileId;
  const owned = result.worlds || [];
  const current = owned.filter((w) => w.profileId === activeId);
  const others = owned.filter((w) => w.profileId !== activeId);
  const elsewhere = result.elsewhere || [];

  countEyebrow.textContent = owned.length ? `${owned.length} world${owned.length === 1 ? '' : 's'}` : '';

  const profile = activeProfile();
  paintSection(currentSection, {
    title: profile ? profile.name : 'This profile',
    items: current,
    kind: 'own',
    alwaysShow: true,
    sameProfile: true,
    emptyIcon: icons.cube,
    emptyTitle: `No worlds in ${profile ? profile.name : 'this profile'} yet`,
    emptyText: 'Start a singleplayer game and it shows up here — or bring one over from below.'
  });
  paintSection(otherSection, {
    title: 'Your other profiles',
    items: others,
    kind: 'own',
    alwaysShow: false,
    sameProfile: false
  });
  paintSection(elsewhereSection, {
    title: 'On this PC, in other launchers',
    items: elsewhere,
    kind: 'foreign',
    alwaysShow: true,
    emptyIcon: icons.drive,
    emptyTitle: 'None found on this PC',
    emptyText: 'No worlds in the Minecraft launcher, Lunar, Prism or the other launchers this PC has.'
  });

  // Sizes are asked for here — open, every focus-refresh, after every action
  // — and nowhere in the background (CLAUDE.md, Size and speed).
  for (const world of [...current, ...others]) measureCard(cards.get(keyOf('own', world)));
}

function paintSection(section, { title, items, kind, alwaysShow, emptyIcon, emptyTitle, emptyText, sameProfile }) {
  const has = items.length > 0;
  section.node.hidden = !has && !alwaysShow;
  if (!has && !alwaysShow) return;

  section.title.textContent = title;
  section.note.textContent = has ? `${items.length} world${items.length === 1 ? '' : 's'}` : '';

  if (!has) {
    mount(section.grid, el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: emptyIcon }),
      el('p', { class: 'empty__title', text: emptyTitle }),
      el('p', { class: 'empty__text', text: emptyText })
    ]));
    return;
  }

  paintGrid(section.grid, items, kind, sameProfile);
}

const keyOf = (kind, item) => kind === 'own' ? `own:${item.profileId}/${item.folder}` : `else:${item.dir}|${item.folder}`;

/** Add what is new, drop what is gone, reorder if it changed — never rebuild
    a card that is already on screen (see the header). `sameProfile` drops
    the profile name off a card's meta line in the current-profile group,
    where the section heading already says it — CLAUDE.md's own rule against
    a card restating what sits directly over it (the profile editor's specTags). */
function paintGrid(grid, items, kind, sameProfile) {
  const wanted = new Set(items.map((item) => keyOf(kind, item)));
  for (const [key, card] of cards) {
    if (card.grid !== grid || wanted.has(key)) continue;
    card.node.remove();
    cards.delete(key);
  }

  for (const item of items) {
    const key = keyOf(kind, item);
    const existing = cards.get(key);
    if (existing) {
      existing.item = item;
      existing.sameProfile = sameProfile;
      if (kind === 'own') updateOwnText(existing, item);
      else updateForeignText(existing, item);
      continue;
    }
    const card = kind === 'own' ? ownCard(item, sameProfile) : foreignCard(item);
    card.grid = grid;
    cards.set(key, card);
  }

  const nodes = items.map((item) => cards.get(keyOf(kind, item)).node);
  const same = grid.children.length === nodes.length && nodes.every((node, i) => grid.children[i] === node);
  if (!same) grid.replaceChildren(...nodes);
}

/* ------------------------------------------------------------ own cards */

function ownCard(world, sameProfile) {
  const card = { item: world, sameProfile };

  card.iconEl = buildIcon(world.icon);
  card.name = el('span', { class: 'world-card__name truncate' });
  card.meta = el('span', { class: 'world-card__meta truncate' });
  card.facts = el('span', { class: 'world-card__facts' });
  card.line = el('span', { class: 'world-card__line' });

  const gone = !ownerProfile(world);
  card.actions = gone ? goneActions(card) : ownActions(card);

  card.node = el('article', { class: 'world-card' }, [
    el('div', { class: 'world-card__top' }, [
      card.iconEl,
      el('div', { class: 'stack truncate' }, [card.name, card.meta])
    ]),
    card.facts,
    card.line,
    card.actions
  ]);

  updateOwnText(card, world);
  return card;
}

function updateOwnText(card, world) {
  card.item = world;
  const owner = ownerProfile(world);
  const gone = !owner;
  card.node.classList.toggle('world-card--gone', gone);

  card.name.textContent = world.name;

  // The current-profile group's own heading already names the profile —
  // repeating it on every card under it said nothing a second time.
  const modeLabel = world.hardcore ? 'Hardcore' : capitalize(world.gameMode || 'survival');
  const profileLabel = card.sameProfile ? null : (owner ? owner.name : 'A deleted profile');
  card.meta.textContent = [profileLabel, world.version, modeLabel].filter(Boolean).join(' · ');

  const played = `Last played ${lower(relativeTime(world.lastPlayed))}`;
  card.facts.textContent = `${played} · ${card.sizeText || 'Measuring…'}`;

  const running = sessionsFor(world.profileId).length > 0;
  card.line.textContent = running
    ? 'Playing now — it is backed up by itself when you close the game.'
    : world.backup
      ? `Backed up ${lower(relativeTime(world.backup.when))}`
      : 'Not backed up yet';

  paintIcon(card, world.icon);
}

/** Play, Back up now, and the quiet row: Restore…, Open folder, Delete. */
function ownActions(card) {
  const playBtn = el('button', { class: 'btn btn--primary', onClick: () => playWorld(card) }, [
    el('span', { html: icons.play, style: { display: 'contents' } }),
    el('span', { text: 'Play' })
  ]);
  const backupBtn = el('button', { class: 'btn btn--confirm', onClick: () => backUpNow(card, backupBtn) }, [
    el('span', { html: icons.download, style: { display: 'contents' } }),
    el('span', { text: 'Back up now' })
  ]);

  return el('div', { class: 'world-card__actions' }, [
    el('div', { class: 'row', style: { gap: 'var(--space-2)' } }, [playBtn, backupBtn]),
    el('div', { class: 'world-card__foot' }, [
      el('button', { class: 'quiet-action', onClick: () => openRestore(card) }, [
        el('span', { html: icons.refresh, style: { display: 'contents' } }),
        el('span', { text: 'Restore…' })
      ]),
      el('button', {
        class: 'quiet-action quiet-action--icon',
        'aria-label': 'Open folder', 'data-tip': 'Open folder',
        html: icons.folder,
        onClick: () => host.worlds.open(card.item.profileId, card.item.folder)
      }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'quiet-action quiet-action--danger', onClick: () => deleteWorld(card) }, [
        el('span', { html: icons.trash, style: { display: 'contents' } }),
        el('span', { text: 'Delete' })
      ])
    ])
  ]);
}

/** A leftover profile's world: only Bring it here (worlds.js's own rule —
    there is no profile left for Play to start, and nothing here retries the
    profile deletion that left it behind). */
function goneActions(card) {
  return el('div', { class: 'world-card__actions' }, [
    el('div', { class: 'row' }, [
      el('button', { class: 'btn btn--confirm', onClick: () => bringHere(card) }, [
        el('span', { html: icons.download, style: { display: 'contents' } }),
        el('span', { text: 'Bring it here' })
      ])
    ])
  ]);
}

/* -------------------------------------------------------- foreign cards */

function foreignCard(item) {
  const card = { item };

  card.iconEl = buildIcon(item.icon);
  card.name = el('span', { class: 'world-card__name truncate' });
  card.meta = el('span', { class: 'world-card__meta truncate' });
  card.facts = el('span', { class: 'world-card__facts' });

  card.node = el('article', { class: 'world-card world-card--foreign' }, [
    el('div', { class: 'world-card__top' }, [
      card.iconEl,
      el('div', { class: 'stack truncate' }, [card.name, card.meta])
    ]),
    card.facts,
    el('div', { class: 'world-card__actions' }, [
      el('div', { class: 'row', style: { gap: 'var(--space-2)' } }, [
        el('button', { class: 'btn btn--confirm', onClick: () => bringHere(card) }, [
          el('span', { html: icons.download, style: { display: 'contents' } }),
          el('span', { text: 'Bring it here' })
        ]),
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'quiet-action quiet-action--icon',
          'aria-label': 'Open folder', 'data-tip': 'Open folder',
          html: icons.folder,
          onClick: () => host.shell.openPath(card.item.path)
        })
      ])
    ])
  ]);

  updateForeignText(card, item);
  return card;
}

function updateForeignText(card, item) {
  card.item = item;
  card.name.textContent = item.name;
  const modeLabel = item.hardcore ? 'Hardcore' : capitalize(item.gameMode || 'survival');
  card.meta.textContent = [item.source, item.version, modeLabel].filter(Boolean).join(' · ');
  card.facts.textContent = `Last played ${lower(relativeTime(item.lastPlayed))}`;
  paintIcon(card, item.icon);
}

/* ------------------------------------------------------------- the icon */

function buildIcon(iconUrl) {
  return iconUrl
    ? el('img', { class: 'world-card__icon', src: iconUrl, alt: '' })
    : el('span', { class: 'world-card__icon world-card__icon--placeholder', html: icons.cube });
}

/** Swaps the element itself if a world gained (or, in principle, lost) an
    icon between refreshes — rare, but a card is reused rather than rebuilt,
    so nothing else here would ever catch it. */
function paintIcon(card, iconUrl) {
  const isImg = card.iconEl.tagName === 'IMG';
  if (iconUrl && isImg) {
    if (card.iconEl.src !== iconUrl) card.iconEl.src = iconUrl;
    return;
  }
  if (Boolean(iconUrl) === isImg) return;
  const next = buildIcon(iconUrl);
  card.iconEl.replaceWith(next);
  card.iconEl = next;
}

/* -------------------------------------------------------------- sizing */

function measureCard(card) {
  if (!card) return;
  const { profileId, folder } = card.item;
  host.worlds.size(profileId, folder).then((result) => {
    if (cards.get(keyOf('own', card.item)) !== card || !card.node.isConnected) return;
    card.sizeText = result?.ok ? formatBytes(result.bytes) : '—';
    updateOwnText(card, card.item);
  }).catch(() => {
    card.sizeText = '—';
    if (card.node.isConnected) updateOwnText(card, card.item);
  });
}

/* --------------------------------------------------------- backup landed */

/** worlds:changed — an auto backup at exit, or someone's Back up now.
    Repaints that one card's line; anything not on screen yet is picked up
    by the next refresh instead of being fetched again here. */
function onBackupLanded({ profileId, folder, bytes, when }) {
  const card = cards.get(`own:${profileId}/${folder}`);
  if (!card) return;
  card.item.backup = { ...card.item.backup, when, bytes };
  updateOwnText(card, card.item);
}

/* ------------------------------------------------------------------ play */

/* A double-click on Play is one press (2026-09-22) — Home's rule, for the
   same reason: the session is up the moment main has the launch, so the
   second click found it and asked "Start anyway?". A press while the first
   is still being checked, or within a second of its launch going out, is
   the same press. */
const PRESS_SETTLE_MS = 1000;
let pressing = false;
let launchedAt = 0;

async function playWorld(card) {
  if (pressing || Date.now() - launchedAt < PRESS_SETTLE_MS) return;
  const world = card.item;
  const profile = ownerProfile(world);
  if (!profile) return;

  if (!activeAccount()) { openAccountModal(); return; }

  const memoryMb = profile.memoryMb || state.settings?.game?.memoryMb || 4096;
  pressing = true;
  let go;
  try {
    go = await allowDuplicate(profile) && await allowMemory(profile, memoryMb);
  } finally {
    pressing = false;
  }
  if (!go) return;

  launchedAt = Date.now();
  const result = await host.game.launch({
    id: profile.id, name: profile.name, version: profile.version,
    loader: profile.loader, memoryMb, world: world.folder
  });

  if (result?.ok) {
    touchProfile(profile.id);
    launchMoment({ name: profile.name });
    toast(`${profile.name} will open ${world.name} as soon as it is up`, 'info', 4000);
    return;
  }
  if (result?.cancelled) return;
  if (result?.error) toast(result.error, 'error', 6000);
}

/**
 * A second copy of a profile that is already running. Copied from Home
 * verbatim (see the header) — Home does not export it.
 */
async function allowDuplicate(profile) {
  const already = sessionsFor(profile.id);
  if (!already.length) return true;

  return confirmModal({
    title: `${profile.name} is already running`,
    lines: [
      'Both copies share the same saves, options and mods folder.',
      'A world open in one cannot be opened in the other.'
    ],
    confirmLabel: 'Start anyway',
    danger: false
  });
}

/**
 * The memory the running games have already claimed, plus this one. Copied
 * from Home verbatim (see the header).
 */
async function allowMemory(profile, memoryMb) {
  const totalMb = state.system?.totalMemoryMb || 0;
  const reserved = reservedMemoryMb();
  if (!totalMb || !reserved || reserved + memoryMb <= totalMb * 0.75) return true;

  const gb = (mb) => `${(mb / 1024).toFixed(1)} GB`;
  const fallback = state.settings?.game?.memoryMb || 4096;

  return confirmModal({
    title: 'Not much memory left',
    lines: [
      `Running: ${state.sessions.map((s) => gb(s.memoryMb || fallback)).join(' + ')}.` +
      ` This one wants ${gb(memoryMb)}.`,
      `This machine has ${gb(totalMb)} — Windows needs some of it too.`
    ],
    confirmLabel: 'Start anyway',
    danger: false
  });
}

/* --------------------------------------------------------------- backup */

async function backUpNow(card, button) {
  const label = button.querySelector('span:last-child');
  const original = label ? label.textContent : '';
  button.disabled = true;
  if (label) label.textContent = 'Backing up…';

  const world = card.item;
  // A call that throws is a failed backup, not a button left on "Backing up…".
  const result = await host.worlds.backup(world.profileId, world.folder).catch(() => null);

  button.disabled = false;
  if (label) label.textContent = original;

  if (result?.ok) {
    toast(`${world.name} backed up — ${formatBytes(result.bytes)}`, 'success');
    card.item.backup = { ...card.item.backup, when: result.when, bytes: result.bytes };
    updateOwnText(card, card.item);
    return;
  }
  if (result?.running) { runningToast(); return; }
  toast(result?.error || 'Could not back that world up', 'error', 6000);
}

function runningToast() {
  toast("It's open in the game right now — it is backed up by itself when you close the game.", 'info', 5500);
}

/* -------------------------------------------------------------- restore */

function openRestore(card) {
  const world = card.item;
  const list = el('div', { class: 'backup-list' }, [el('p', { class: 'muted', text: 'Loading…' })]);

  const closeModal = openModal({
    title: `Restore ${world.name}`,
    subtitle: 'Backs up the world as it is now first.',
    build: () => [list],
    actions: (close) => [el('button', { class: 'btn btn--ghost', text: 'Close', onClick: () => close() })]
  });

  host.worlds.backups(world.profileId, world.folder).then((result) => {
    const rows = result?.backups || [];
    if (!rows.length) {
      mount(list, el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon', html: icons.clock }),
        el('p', { class: 'empty__title', text: 'No backups yet' }),
        el('p', {
          class: 'empty__text',
          text: 'One is made when you close the game after playing here, or press Back up now.'
        })
      ]));
      return;
    }
    mount(list, ...rows.map((backup) => backupRow(card, backup, closeModal)));
  }).catch(() => {
    mount(list, el('p', { class: 'muted', text: 'Could not read the backups.' }));
  });
}

function backupRow(card, backup, closeModal) {
  const restoreBtn = el('button', { class: 'btn btn--primary btn--sm', text: 'Restore' });
  restoreBtn.addEventListener('click', async () => {
    restoreBtn.disabled = true;
    const world = card.item;
    const result = await host.worlds.restore(world.profileId, world.folder, backup.name);
    if (result?.ok) {
      toast(`${world.name} restored — the world it replaced is in its backups.`, 'success');
      closeModal();
      refresh();
      return;
    }
    restoreBtn.disabled = false;
    if (result?.running) { runningToast(); return; }
    toast(result?.error || 'Could not restore that backup', 'error', 6000);
  });

  return el('div', { class: 'backup-row' }, [
    el('div', { class: 'stack' }, [
      el('span', { class: 'backup-row__date', text: backupDate(backup.when) }),
      el('span', { class: 'backup-row__size', text: formatBytes(backup.bytes) })
    ]),
    restoreBtn
  ]);
}

/* ---------------------------------------------------------------- delete */

async function deleteWorld(card) {
  const world = card.item;

  if (sessionsFor(world.profileId).length > 0) {
    openModal({
      title: `${world.name} is open`,
      build: () => [el('p', { class: 'muted', text: 'Close the game before this world can be deleted.' })],
      actions: (close) => [el('button', { class: 'btn btn--primary', text: 'Got it', onClick: () => close() })]
    });
    return;
  }

  const ok = await confirmModal({
    title: `Delete ${world.name}?`,
    message: `${world.name} and its backups go to the Recycle Bin, where they can be brought back from.`,
    confirmLabel: 'Delete'
  });
  if (!ok) return;

  const result = await host.worlds.remove(world.profileId, world.folder);
  if (result?.ok) {
    toast(`${world.name} deleted`, 'success');
    refresh();
    return;
  }
  if (result?.running) {
    toast('It started running — close the game, then it can be deleted.', 'error', 6000);
    return;
  }
  toast(result?.error || 'Could not delete that world', 'error', 6000);
}

/* ----------------------------------------------------------- bring it here */

/* One copy per world at a time (2026-09-22): the copy is a whole world
   folder and takes a while, and a second press in that time brought it
   over twice — "New World" and "New World (2)". */
const bringing = new Set();

async function bringHere(card) {
  const item = card.item;
  const profile = activeProfile();
  if (!profile) {
    toast('Create a profile first', 'error');
    setRoute('profiles');
    return;
  }
  if (bringing.has(item.path)) return;

  bringing.add(item.path);
  const result = await host.worlds.bring(profile.id, item.path).catch(() => null);
  bringing.delete(item.path);
  if (result?.ok) {
    toast(`${result.name || item.name} brought into ${profile.name}`, 'success');
    refresh();
    return;
  }
  toast(result?.error || 'Could not bring that world over', 'error', 6000);
}

/* --------------------------------------------------------------- wording */

const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const capitalize = (word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : '';

/** "Today · 14:05", "Yesterday · 09:12", "6 Sep · 14:05" — a backup's own
    stamp, to the minute (worlds.js names the file the same way). */
function backupDate(ms) {
  const date = new Date(ms);
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a, b) => a.toDateString() === b.toDateString();

  if (sameDay(date, now)) return `Today · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday · ${time}`;

  const day = date.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  });
  return `${day} · ${time}`;
}
