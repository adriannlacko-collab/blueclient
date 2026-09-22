/**
 * Profiles — the presets, and an editor for whichever one is selected.
 *
 * A profile is a game version, a mod loader, the jars that run on them and the
 * memory to give them. Picking a card on the left puts its settings on the
 * right, so choosing and editing are the same gesture rather than a card, a
 * button and a dialog.
 */

import { segmented } from '../ui/segmented.js';
import { selectMenu } from '../ui/select.js';
import { tabStrip } from '../ui/tabstrip.js';
import { openVersionPicker } from '../ui/versionpicker.js';
import { openImporter } from '../ui/importer.js';
import { openFound } from '../ui/found.js';
import { familyArt, familyName } from '../art.js';
import { el, mount } from '../ui/dom.js';
import { icons } from '../icons.js';
import { confirmModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { blockIcon, blockIdFor, PICKER_IDS, BLOCK_NAMES } from '../blocks.js';
import { scopeTo } from './mods.js';
import { openAddMods } from './addmods.js';
import { host } from '../bridge.js';
import { modCounts, refreshAbsent } from '../absent.js';
import {
  state, addProfile, removeProfile, setActiveProfile, updateProfile,
  duplicateProfile, loaderLabel, setRoute, javaFor,
  syncedWith, linkSettings, unlinkSettings, sessionsFor, updateSettings
} from '../state.js';

/*
 * Only the loaders the launcher can actually install.
 *
 * Forge, NeoForge and Quilt were offered here while nothing behind them was
 * implemented, so choosing one produced a profile that looked ready and then
 * failed on Play. Listing a loader is a promise to launch it; these two are the
 * ones that keep it.
 */
const LOADERS = [
  { id: 'vanilla', label: 'Vanilla' },
  { id: 'fabric', label: 'Fabric' }
];

/* Only ever used when Mojang's list cannot be fetched. Newest first, and the
   first entries are ones the shipped jars cover, so an offline first run still
   makes a profile that carries BlueClient. */
const VERSIONS = ['1.21.8', '1.21.5', '1.21.4', '1.21.1', '1.20.6', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9'];

/**
 * The oldest release Fabric has ever supported.
 *
 * Fabric's mappings begin at 1.14 and no earlier version will ever gain them,
 * so the boundary is historical rather than a moving target. Offering Fabric
 * beside 1.8.9 built a profile that looked ready and then failed on Play — and
 * 1.8.9 is the first version a PvP player reaches for.
 */
const FABRIC_OLDEST = [1, 14];

const parts = (version) => String(version).split('.').map((n) => parseInt(n, 10) || 0);

/**
 * Turn mods on for a profile that has none, if the player wants that.
 *
 * A vanilla profile cannot hold a mod, and both places that add mods used to
 * end there: the Mods page with a toast telling the player to "give it a
 * loader first", the profile editor with a greyed-out Add button. Neither word
 * is one this audience uses and neither control did anything, so both now ask
 * the plain question and then do the job (2026-09-04). The one case that
 * cannot be fixed is a version Fabric never supported — 1.8.9 and older —
 * where saying yes would build a profile that looks ready and fails on Play.
 *
 * Answers true when the profile can take mods by the time it returns.
 */
export async function ensureModsOn(profile) {
  if (!profile) return false;
  if (profile.loader !== 'vanilla') return true;

  if (!runnable('fabric', profile.version)) {
    toast(`Mods need Minecraft 1.14 or newer — ${profile.name} is on ${profile.version}`, 'error', 4200);
    return false;
  }

  const ok = await confirmModal({
    title: `Turn mods on for ${profile.name}?`,
    lines: [
      'This profile plays plain Minecraft at the moment. Turning mods on adds Fabric, which is what mods run on.',
      'Your worlds, options and skin are untouched.'
    ],
    confirmLabel: 'Turn mods on',
    danger: false
  });
  if (!ok) return false;

  await updateProfile(profile.id, { loader: 'fabric' });
  return true;
}

/** Whether this loader can actually run this version. */
export function runnable(loader, version) {
  if (loader !== 'fabric') return true;

  const [major, minor] = parts(version);
  if (major !== FABRIC_OLDEST[0]) return major > FABRIC_OLDEST[0];
  return minor >= FABRIC_OLDEST[1];
}

/*
 * Which Minecraft versions the in-game half of BlueClient is built for.
 *
 * Asked once, of the shipped jars (main opens each one's fabric.mod.json), so
 * this cannot drift from what they actually declare. It is here because the
 * launcher used to keep the answer to itself until the launch: a PvP player
 * would pick 1.8.9 — the first version that audience reaches for — wait for a
 * download, press Play, and only then be told the companion mod had been left
 * out. The version list is where the question is being asked, so it is where
 * the answer belongs (2026-09-04).
 *
 * The whole release list goes over in one call and comes back filtered, rather
 * than asking about each row: the mod ships as several jars now, and a round
 * trip per version would be dozens of them for one dropdown.
 */
let companionPromise = null;

function companionVersions() {
  if (!companionPromise) {
    companionPromise = releaseVersions()
      .then((versions) => host.game.companion(versions))
      .then((result) => new Set(result?.versions || []))
      .catch(() => new Set());
  }
  return companionPromise;
}

/* Mojang's manifest, fetched once and shared by every editor: the releases
   are what the picker's posters offer (snapshots are hundreds, and a list of
   hundreds is worse than one of a hundred), and every id — snapshots too —
   is what its Custom card accepts (2026-09-14). */
let manifestPromise = null;

function manifest() {
  if (!manifestPromise) {
    manifestPromise = host.game.versions()
      .then((result) => {
        if (!result?.ok || !result.versions?.length) return { releases: VERSIONS, known: new Set(VERSIONS) };
        const releases = result.versions.filter((v) => v.type === 'release').map((v) => v.id);
        return { releases: releases.length ? releases : VERSIONS, known: new Set(result.versions.map((v) => v.id)) };
      })
      .catch(() => ({ releases: VERSIONS, known: new Set(VERSIONS) }));
  }
  return manifestPromise;
}

const releaseVersions = () => manifest().then((m) => m.releases);

let grid;
let editor;
/** Which profile the editor is showing — not necessarily the one that launches. */
let selectedId = null;
let nameTimer = null;
/* One observer for the loader control's thumb, re-pointed at each new panel.
   A fresh one per paintEditor() was never disconnected, so every click on a
   card kept another old panel alive (2026-09-06). */
let thumbObserver = null;

/**
 * The version a new profile is born on: the newest release the shipped jars
 * carry BlueClient for, or the newest release at all if the jars have not
 * answered. Never the hard-coded fallback while the real list is known —
 * that is how "New profile" stayed on 1.21.4 for four releases.
 */
/*
 * The first opening of Profiles offers the other launchers' profiles
 * (2026-09-18, ui/found.js). Adrian: "only popup first ever time you press
 * on profiles page." Once per copy of the launcher — `launcher.importOffered`
 * in the settings, written the moment the offer is decided, whatever is
 * pressed — and only when the scan finds something: a player with nothing
 * to bring never sees a popup, and the flag is written all the same, so the
 * Import profiles button is the way in from then on. Never for a copy that
 * has already brought profiles over (a profile carries `imported`), never
 * while this page is only being warmed for the graphics card (warmup.js
 * renders it at boot, off screen), and never if the player has moved on by
 * the time the scan answers. A scan that fails leaves the flag alone, so the
 * next opening asks again.
 */
let offering = false;

function offerImport(page) {
  if (offering || state.settings?.launcher?.importOffered) return;
  const decide = () => updateSettings({ launcher: { importOffered: true } }, { silent: true });
  if (state.profiles.some((p) => p.imported)) { decide(); return; }
  offering = true;
  /* After this render is on screen — or in the warm-up host, which is the
     case to walk away from. */
  setTimeout(async () => {
    if (!page.isConnected || page.closest('.warmup')) { offering = false; return; }
    let answer = null;
    try { answer = await host.game.importScan(); } catch { answer = null; }
    if (!answer?.ok) { offering = false; return; }
    const found = (answer.groups || []).some((g) => g.rows.length);
    await decide();
    if (found && page.isConnected && state.route === 'profiles') {
      openFound({ answer, onDone: (adopted) => { paint(); if (adopted[0]) select(adopted[0].id); } });
    }
  }, 0);
}

async function newestVersion() {
  const [known, blue] = await Promise.all([releaseVersions(), companionVersions()]);
  return known.find((v) => blue.has(v)) || known[0] || VERSIONS[0];
}

export function render() {
  /* The editor opens on the profile that launches. Picking a card here makes
     it the one that launches too (select() below), so the two only ever drift
     apart when the profile row on Home changes the choice — and then this page
     used to keep its old pick: the old card still lit as selected, the check
     mark on the new one (Adrian, 2026-09-09: "the old profile still is kind of
     selected and lighter but the new one has a check mark. its weird").
     Following the active profile on every arrival keeps them one thing. */
  selectedId = state.profiles.some((p) => p.id === state.activeProfileId)
    ? state.activeProfileId
    : state.profiles[0]?.id ?? null;

  grid = el('div', { class: 'profile-grid' });
  editor = el('aside', { class: 'profile-editor' });

  paint();
  paintEditor();

  const page = el('div', { class: 'page page--profiles' }, [
    el('div', { class: 'page__inner' }, [
      el('header', { class: 'page-actions' }, [
        /* Adrian, 2026-09-14: "a button that lets players migrate their
           profiles from other clients" — placed that day, real since
           2026-09-16 (ui/importer.js): Lunar, Dawn (Feather), FastClient, the
           Minecraft launcher, Prism, CurseForge, ATLauncher and any other
           game folder with mods in it. The page lands on the first profile
           brought over, the way New profile lands on the new one. */
        el('button', {
          class: 'btn btn--secondary btn--lg',
          onClick: () => openImporter({ onDone: (adopted) => { paint(); if (adopted[0]) select(adopted[0].id); } })
        }, [
          el('span', { html: icons.download, style: { display: 'contents' } }),
          el('span', { text: 'Import profiles' })
        ]),
        el('button', {
          class: 'btn btn--primary btn--add btn--lg',
          onClick: () => create()
        }, [
          el('span', { html: icons.plus, style: { display: 'contents' } }),
          el('span', { text: 'New profile' })
        ])
      ]),

      el('div', { class: 'profiles' }, [grid, editor])
    ])
  ]);

  offerImport(page);
  return page;
}

/* ------------------------------------------------------------------ grid */

/** Selection only swaps classes — rebuilding the grid killed hover mid-click. */
function select(id) {
  selectedId = id;
  setActiveProfile(id);
  for (const node of grid.querySelectorAll('.profile-card')) {
    const on = node.dataset.id === id;
    node.classList.toggle('is-selected', on);
    node.setAttribute('aria-pressed', String(on));
  }
  paintActiveMarks();
  paintEditor();
}

function paint() {
  if (!state.profiles.length) {
    grid.className = '';
    mount(grid, el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: icons.folderOpen }),
      el('p', { class: 'empty__title', text: 'No profiles yet' }),
      el('p', { class: 'empty__text', text: 'Create a profile to choose a version and start playing.' })
    ]));
    return;
  }

  grid.className = 'profile-grid';
  mount(grid, ...state.profiles.map(card));
}

function card(profile) {
  const isActive = profile.id === state.activeProfileId;
  const isSelected = profile.id === selectedId;

  return el('article', {
    class: `profile-card${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`,
    dataset: { id: profile.id },
    tabindex: '0',
    role: 'button',
    'aria-pressed': String(isSelected),
    onClick: () => select(profile.id),
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(profile.id); }
    }
  }, [
    el('div', { class: 'profile-card__top' }, [
      el('img', { class: 'profile-card__face', src: blockIcon(blockIdFor(profile)), alt: '' }),
      el('div', { class: 'stack truncate' }, [
        el('h3', { class: 'profile-card__name truncate', text: profile.name }),
        el('span', {
          class: 'profile-card__meta',
          text: `${profile.version} · ${loaderLabel(profile.loader)}`
        })
      ])
    ]),

    /* Java and memory — the two facts the card does not say anywhere else —
       as one quiet line (2026-09-15), at the row's right since the card became
       a row (2026-09-17). Home's specTags draws the same two as chips; here
       they were two dark chips on a card the size of a business card. */
    el('div', { class: 'profile-card__line' }, [
      el('span', { text: javaFor(profile.version) }),
      el('span', { text: `${((profile.memoryMb || state.settings?.game?.memoryMb || 0) / 1024).toFixed(1)} GB` })
    ]),
    el('span', {
      class: 'profile-card__check',
      html: icons.check,
      style: { display: isActive ? '' : 'none' },
      'aria-label': 'Launches this profile'
    })
  ]);
}

/** Active state lives on every card, so it repaints in place too. */
function paintActiveMarks() {
  for (const node of grid.querySelectorAll('.profile-card')) {
    const on = node.dataset.id === state.activeProfileId;
    node.classList.toggle('is-active', on);
    node.querySelector('.profile-card__check').style.display = on ? '' : 'none';
  }
}

/* ---------------------------------------------------------------- editor */

function selected() {
  return state.profiles.find((p) => p.id === selectedId) || null;
}

function paintEditor() {
  const profile = selected();

  if (!profile) {
    mount(editor, el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: icons.settings }),
      el('p', { class: 'empty__title', text: 'Nothing selected' }),
      el('p', { class: 'empty__text', text: 'Pick a profile to edit it here.' })
    ]));
    return;
  }

  const globalMb = state.settings?.game?.memoryMb || 4096;
  const maxMb = Math.min(Math.max((state.system?.totalMemoryMb || 16384) - 2048, 2048), 32768);

  /* Every control writes through on change — there is no Save button because
     there is nothing to cancel back to. */
  const nameInput = el('input', {
    class: 'input profile-editor__name',
    value: profile.name,
    maxlength: '40',
    'aria-label': 'Profile name',
    onInput: (event) => {
      const value = event.target.value;
      clearTimeout(nameTimer);
      nameTimer = setTimeout(async () => {
        await updateProfile(profile.id, { name: value.trim() || suggestName(profile) });
        paint();
        paintActiveMarks();
      }, 400);
    }
  });

  /* The field wears the version's poster and Mojang's name for it, and a
     press opens the picker — the wall of posters (ui/versionpicker.js,
     2026-09-14). It was the launcher's own dropdown of every release from
     2026-09-09, and a <select> before that. */
  const versionThumb = el('span', { class: 'version-btn__thumb' });
  const versionLabel = el('span', { class: 'select-btn__label truncate' });
  /* The field's own small label. It reads "Game version" — and, for a version
     no jar covers, "Game version · plain Minecraft" (2026-09-16): the one
     place in the editor that says so, chosen because it costs no height —
     the line under the box came off on 2026-09-15 so the two boxes stay one
     height, and the hover that replaced it is only there for a pointer that
     stops. */
  const versionFieldLabel = el('label', { class: 'field__label', text: 'Game version' });
  const versionSelect = el('button', {
    class: 'select select-btn version-btn',
    type: 'button',
    'aria-haspopup': 'dialog',
    'aria-label': 'Game version',
    onClick: () => openVersionPicker({
      versions: versionIds(),
      known: new Set([...knownIds, profile.version]),
      current: profile.version,
      covered: blueVersions,
      /* The picker says nothing about loaders (Adrian: "no need to show the
         vanilla or blueclient"), so a version Fabric cannot run arrives here
         as a plain choice, and the loader follows it to Vanilla — said once,
         rather than a profile that looks ready and fails on Play. */
      onPick: async (value) => {
        const patch = { version: value };
        if (!runnable(profile.loader, value)) {
          patch.loader = 'vanilla';
          toast(`${value} runs as Vanilla — Fabric starts at 1.14`, 'info', 4200);
        }
        await updateProfile(profile.id, patch);
        paint();
        paintActiveMarks();
        paintEditor();
      }
    })
  }, [
    versionThumb,
    versionLabel,
    el('span', { class: 'select-btn__caret', html: icons.chevronDown })
  ]);

  // The newest list seen, so switching loader can re-filter without refetching.
  let known = VERSIONS;
  let knownIds = new Set(VERSIONS);

  /* The versions the in-game half runs on, once the jars have answered. A set
     rather than one version since the multi-version port (2026-09-04): every
     row it holds gets the suffix, and the line under the control names the
     span. Empty until the answer arrives, so nothing is claimed early. */
  let blueVersions = new Set();

  /** "1.20.5 to 1.21.8", from whichever of the known releases are covered. */
  function blueSpan() {
    const covered = known.filter((v) => blueVersions.has(v));
    if (!covered.length) return null;
    const last = covered[0];
    const first = covered[covered.length - 1];
    return first === last ? first : `${first} to ${last}`;
  }

  /**
   * What the picker offers: every known release. The profile's own version
   * is always in the list, even when the loader cannot run it — dropping it
   * would silently change which version the profile is on. (The list used
   * to be filtered by loader here, which hid 1.8 from a Fabric profile; now
   * the choice stands and the loader follows it — see onPick.)
   */
  const versionIds = () => (known.includes(profile.version) ? known : [profile.version, ...known]);

  /** The field: the poster, "1.21.11 · Tricky Trials", and the BlueClient note. */
  function paintVersions() {
    const version = profile.version;
    const name = familyName(version);
    const art = familyArt(version);
    versionThumb.replaceChildren(art ? el('img', { src: art, alt: '', draggable: 'false' }) : el('span', { html: icons.cube }));
    versionLabel.textContent = name ? `${version} · ${name}` : version;
    /* The line that sat under the box until 2026-09-15 ("BlueClient in game
       needs Fabric, on 1.20.5 to 1.21.11.") is the box's hover now — Adrian:
       "remove the small text under the selection". Repainted when the loader
       changes as well as when the jars first answer. */
    const span = blueSpan();
    versionSelect.title = !span ? ''
      : profile.loader === 'vanilla' ? `BlueClient in game needs Fabric, on ${span}`
      : blueVersions.has(version) ? 'Runs BlueClient in game'
      : `BlueClient runs in game on ${span}; this version launches plain`;
    const plain = Boolean(span) && !blueVersions.has(version);
    versionFieldLabel.textContent = plain ? 'Game version · plain Minecraft' : 'Game version';
  }
  paintVersions();

  companionVersions().then((versions) => {
    if (!versionSelect.isConnected) return;
    blueVersions = versions;
    paintVersions();
  });

  // Swap in the live list once it arrives. Built from the fallback first so the
  // control is never empty while the manifest is in flight.
  manifest().then((m) => {
    if (!versionSelect.isConnected) return;
    known = m.releases;
    knownIds = m.known;
    paintVersions();
  });

  /* The pieces the loader changes, held so they can be repainted without
     rebuilding the panel — a rebuild would give the thumb nowhere to slide
     from. */
  const editorMeta = el('span', { class: 'profile-editor__meta' });
  const modsLabel = el('span');
  let addModsBtn;

  /* The launcher's own segmented control, as a tint rather than glass —
     inside a glass panel a second sheet of glass only stacks darkness, which
     is what made this row read as a dark slot (Adrian, 2026-09-09: "it just
     looks dark and doesnt fit in"). The builder parks the thumb without a
     slide on open; the slide belongs to the player's own click. */
  const loaderRow = segmented({
    options: LOADERS.map((option) => ({ id: option.id, label: option.label })),
    value: profile.loader,
    label: 'Mod loader',
    tint: true,
    onChange: async (id) => {
      await updateProfile(profile.id, { loader: id });
      paintLoaderBits();
      paint();
      paintActiveMarks();
    }
  });

  function paintLoaderBits() {
    const vanilla = profile.loader === 'vanilla';
    // The count the Mods page shows: what reaches the game, not what is
    // switched on — a mod this Minecraft has no build of is said in the
    // tooltip and left out of the number (2026-09-21, absent.js).
    const counts = modCounts(profile.id);
    paintVersions();
    editorMeta.textContent = `${profile.version} · ${loaderLabel(profile.loader)}`;
    modsLabel.textContent = vanilla ? 'No mods' : `${counts.inGame} of ${counts.total} mods`;
    const note = !vanilla && counts.absent
      ? `${counts.absent} switched on but without a build for ${profile.version} yet — the game starts without ${counts.absent === 1 ? 'it' : 'them'}`
      : '';
    if (note) modsLabel.parentElement?.setAttribute('data-tip', note);
    else modsLabel.parentElement?.removeAttribute('data-tip');
    refreshAbsent(profile.id).then((moved) => { if (moved && modsLabel.isConnected) paintLoaderBits(); });
    /* Add stays live on a vanilla profile (2026-09-04). It used to grey out
       with a tooltip saying vanilla profiles cannot load mods, which is true
       and useless: the player wanted mods, and the launcher knew how to give
       them. Pressing it now offers to turn mods on and then opens the picker. */
  }

  const memValue = el('span', { class: 'profile-editor__memval' });
  /* Painted as it is dragged, written when it is let go — the way Settings'
     own Memory slider is (2026-09-22). Every pointer move used to write the
     whole profile list to main and rebuild every card in the grid when the
     write came back, a dozen times a second for as long as the handle was
     held. The keyboard's arrows fire both events, so they still save. */
  const memSlider = el('input', {
    class: 'slider', type: 'range', min: '1024', max: String(maxMb), step: '512',
    value: String(profile.memoryMb ?? globalMb),
    'aria-label': 'Memory for this profile',
    onInput: (event) => paintMemory(Number(event.target.value), true),
    onChange: (event) => {
      updateProfile(profile.id, { memoryMb: Number(event.target.value) }).then(paint);
    }
  });

  const memToggle = el('button', {
    class: 'switch', role: 'switch',
    'aria-checked': String(profile.memoryMb !== null && profile.memoryMb !== undefined),
    'aria-label': 'Override memory for this profile',
    onClick: async () => {
      const next = profile.memoryMb == null ? Number(memSlider.value) : null;
      memToggle.setAttribute('aria-checked', String(next !== null));
      await updateProfile(profile.id, { memoryMb: next });
      paintMemory(next ?? globalMb, next !== null);
      paint();
    }
  });

  function paintMemory(mb, active) {
    // The slider keeps whatever the user dragged it to unless it is told
    // otherwise, so switching the override off left the thumb stranded.
    memSlider.value = String(mb);
    // The value line is the old hint folded in (2026-09-15): what this profile
    // gets, and where the figure comes from while the override is off.
    memValue.textContent = active
      ? `${(mb / 1024).toFixed(1)} GB`
      : `Off · follows the global ${(globalMb / 1024).toFixed(1)} GB`;
    memSlider.disabled = !active;
    memSlider.style.opacity = active ? '1' : '0.4';
    memSlider.style.setProperty('--fill', `${((mb - 1024) / (maxMb - 1024)) * 100}%`);
  }
  paintMemory(profile.memoryMb ?? globalMb, profile.memoryMb != null);

  /* The block this profile wears, and the row of blocks to change it to.
     Picking one writes it through and repaints the card in the grid, without
     rebuilding the panel out from under the cursor. */
  const editorFace = el('img', {
    class: 'profile-editor__face',
    src: blockIcon(blockIdFor(profile)),
    alt: ''
  });

  /* The row is a strip like the masthead's (2026-09-15): the cyan line under
     the pick glides to whichever block is chosen, and a press-and-drag along
     the row carries it, choosing each block as it passes — the same
     `tabStrip`, told the swatches are its items. A click still goes through
     the swatch itself; both roads end in choose(). On a profile switch the
     row is built new and its line is simply under the new profile's block:
     it neither slides in nor glides over from the old profile's (that glide
     was built and taken out the same day — see ui/tabstrip.js). */
  let chosen = blockIdFor(profile);
  const choose = async (id) => {
    if (id === chosen) return;
    chosen = id;
    editorFace.src = blockIcon(id);
    swatches.forEach((swatch, index) => {
      const on = PICKER_IDS[index] === id;
      swatch.classList.toggle('is-selected', on);
      swatch.setAttribute('aria-pressed', String(on));
    });
    picker.move();
    await updateProfile(profile.id, { icon: id });
    paint();
    paintActiveMarks();
  };

  const swatches = PICKER_IDS.map((id) => el('button', {
    class: `block-swatch${id === chosen ? ' is-selected' : ''}`,
    dataset: { icon: id },
    'data-tip': BLOCK_NAMES[id],
    'aria-label': BLOCK_NAMES[id],
    'aria-pressed': String(id === chosen),
    onClick: () => choose(id)
  /* draggable=false, or a press-and-move on the picture starts the browser's
     own picture-drag and the strip's drag is cancelled under it — the drag
     never worked for a real hand in 0.37.2 (the poster thumb learned the same
     on 2026-09-14). */
  }, [el('img', { src: blockIcon(id), alt: '', draggable: 'false' })]));

  const pickerRow = el('div', { class: 'block-picker' }, swatches);
  const picker = tabStrip(pickerRow, { current: () => chosen, select: choose }, { item: '.block-swatch', key: 'icon' });

  const settingsSelect = settingsField(profile);

  mount(editor,
    el('header', { class: 'profile-editor__head' }, [
      editorFace,
      el('div', { class: 'stack truncate' }, [
        el('h2', { class: 'profile-editor__title truncate', text: profile.name }),
        editorMeta
      ])
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Name' }),
      nameInput
    ]),

    el('div', { class: 'field profile-editor__icon' }, [
      el('label', { class: 'field__label', text: 'Icon' }),
      pickerRow
    ]),

    /* Version and loader side by side: they are one decision. They shared a
       wrapper of their own from 2026-09-09 (the two fields that pushed the
       panel off the bottom of the window — Adrian: "I have to scroll down as
       of now"); since 2026-09-17 the whole editor is two columns and they are
       simply its second row. */
    el('div', { class: 'field' }, [
      versionFieldLabel,
      versionSelect
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Mod loader' }),
      loaderRow
    ]),

    el('div', { class: 'field' }, [
      el('div', { class: 'profile-editor__mem' }, [
        el('div', { class: 'stack' }, [
          el('label', { class: 'field__label', text: 'Custom memory' }),
          memValue
        ]),
        el('span', { class: 'spacer' }),
        memToggle
      ]),
      memSlider
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Content' }),
      el('div', { class: 'profile-editor__row' }, [
        /* A plain slab, not the green tint: this one only goes to the Mods
           page, and it sits against the green Add beside it, which is the
           button that actually does something here. */
        el('button', {
          class: 'btn',
          onClick: () => { scopeTo(profile.id); setRoute('mods'); }
        }, [
          el('span', { html: icons.layers, style: { display: 'contents' } }),
          modsLabel
        ]),
        addModsBtn = el('button', {
          class: 'btn btn--confirm',
          onClick: async () => {
            const wasVanilla = profile.loader === 'vanilla';
            if (!(await ensureModsOn(profile))) return;
            // Saying yes moved the loader, so the whole panel is repainted —
            // the segmented thumb has to be parked on Fabric, not left behind
            // on Vanilla with the profile already switched under it.
            if (wasVanilla) { paint(); paintEditor(); }
            openAddMods(profile, () => paintLoaderBits());
          }
        }, [
          el('span', { html: icons.plus, style: { display: 'contents' } }),
          el('span', { text: 'Add' })
        ])
      ])
    ]),

    /* Game settings (2026-09-17): whose keybinds, video settings, server
       list, packs and mod settings this profile plays with — its own, or one
       other profile's, shared both ways. Across both columns: it is one
       choice, and the names in it can be long. */
    el('div', { class: 'field profile-editor__wide' }, [
      el('label', { class: 'field__label', text: 'Game settings' }),
      settingsSelect
    ]),

    el('div', { class: 'profile-editor__foot' }, [
      el('button', {
        class: 'quiet-action',
        onClick: () => host.shell.openPath(state.settings?.launcher?.gameDirectory)
      }, [
        el('span', { html: icons.folder, style: { display: 'contents' } }),
        el('span', { text: 'Folder' })
      ]),
      /* The door to Worlds (2026-09-11): the worlds of this profile, the other
         profiles' below them, and the ones in other launchers on this PC, with
         backups and Restore. It sat on the top bar for an afternoon; Adrian
         took it off — a world belongs to a profile, so this is where it is
         looked for. The editor's profile is the active one, which is what the
         page groups by. */
      el('button', {
        class: 'quiet-action',
        onClick: () => setRoute('worlds')
      }, [
        el('span', { html: icons.globe, style: { display: 'contents' } }),
        el('span', { text: 'Worlds' })
      ]),
      el('button', {
        class: 'quiet-action',
        onClick: async (event) => {
          /* One copy per press: a double-click made "(copy)" and "(copy 2)". */
          const button = event.currentTarget;
          if (button.disabled) return;
          button.disabled = true;
          const copy = await duplicateProfile(profile.id).finally(() => { button.disabled = false; });
          if (!copy) return;
          selectedId = copy.id;
          paint();
          paintEditor();
          toast(`${copy.name} created`, 'success');
        }
      }, [
        el('span', { html: icons.copy || icons.wrench, style: { display: 'contents' } }),
        el('span', { text: 'Duplicate' })
      ]),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'quiet-action quiet-action--danger',
        onClick: () => remove(profile)
      }, [
        el('span', { html: icons.trash, style: { display: 'contents' } }),
        el('span', { text: 'Delete' })
      ])
    ])
  );

  paintLoaderBits();
  // The thumb is measured once layout has run (the builder does that), and
  // again whenever the panel resizes: the column it shares with the version
  // changes width with the window.
  if (typeof ResizeObserver === 'function') {
    if (thumbObserver) thumbObserver.disconnect();
    thumbObserver = new ResizeObserver(() => loaderRow.remeasure());
    thumbObserver.observe(loaderRow);
  }
}

/**
 * The Game settings dropdown (2026-09-17). Adrian: "make a system that the
 * ingame settings such as keybinds etc is profile specific, and for every
 * profile, you can choose to sync settings with another profile (steal the
 * other profile's settings … and from that on both switch settings no
 * matter in which of them you are changing it in)."
 *
 * One row per choice: this profile's own, or "Shared with <profile>" for
 * every other profile — a profile already sharing with others is one row
 * naming them all, because joining it is joining them all. Picking one asks
 * once, in plain words, because the profile's own settings are replaced;
 * picking "own" asks too, since it is the end of the sharing. A game running
 * on either profile refuses the change, and the row springs back.
 */
function settingsField(profile) {
  const build = () => {
    const mine = state.settingsGroups[profile.id] || null;
    const options = [{ value: '', label: "This profile's own" }];
    const seen = new Set();
    for (const other of state.profiles) {
      if (other.id === profile.id) continue;
      const group = state.settingsGroups[other.id] || null;
      if (group && seen.has(group)) continue;
      if (group) seen.add(group);
      const names = group
        ? state.profiles.filter((p) => p.id !== profile.id && state.settingsGroups[p.id] === group).map((p) => p.name)
        : [other.name];
      options.push({ value: group || other.id, label: `Shared with ${listOf(names)}` });
    }
    return { value: mine || '', options };
  };

  const first = build();
  const select = selectMenu({
    value: first.value,
    options: first.options,
    label: 'Whose game settings this profile uses',
    onChange: async (value) => {
      const wasSynced = state.settingsGroups[profile.id] || '';
      const back = () => select.setValue(wasSynced);
      if (sessionsFor(profile.id).length) {
        toast(`Close the game running on ${profile.name} first`, 'error', 4200);
        return back();
      }

      if (!value) {
        const others = syncedWith(profile.id).map((p) => p.name);
        const ok = await confirmModal({
          title: `Keep ${profile.name}'s settings separate?`,
          lines: [
            `It keeps a copy of the settings it shares with ${listOf(others)} as they are today.`,
            `From now on a change in ${profile.name} stays in ${profile.name}, and a change in ${listOf(others)} stays there.`
          ],
          confirmLabel: 'Keep separate',
          danger: false
        });
        if (!ok) return back();
        const answer = await unlinkSettings(profile.id);
        if (!answer?.ok) {
          toast(answer?.running ? `Close the game running on ${profile.name} first` : (answer?.error || 'Could not change the settings'), 'error', 4200);
          return back();
        }
        toast(`${profile.name} keeps its own settings now`, 'success');
        refresh();
        return;
      }

      // A group's id or a profile's: the profile to sync with is any member.
      const target = state.profiles.find((p) => p.id === value)
        || state.profiles.find((p) => state.settingsGroups[p.id] === value);
      if (!target) return back();
      const names = [target, ...syncedWith(target.id)].map((p) => p.name);
      if (sessionsFor(target.id).length) {
        toast(`Close the game running on ${target.name} first`, 'error', 4200);
        return back();
      }
      const ok = await confirmModal({
        title: `Share settings with ${listOf(names)}?`,
        lines: [
          `${profile.name} takes ${target.name}'s keybinds, video settings, server list, resource packs and mod settings now — its own are replaced.`,
          'From then on a change in either one shows up in both. Mods and worlds stay with each profile.'
        ],
        confirmLabel: 'Share settings',
        danger: false
      });
      if (!ok) return back();
      const answer = await linkSettings(profile.id, target.id);
      if (!answer?.ok) {
        toast(answer?.running ? 'Close the running game first' : (answer?.error || 'Could not share the settings'), 'error', 4200);
        return back();
      }
      toast(`${profile.name} now shares its settings with ${listOf(names)}`, 'success');
      refresh();
    }
  });

  function refresh() {
    const next = build();
    select.setOptions(next.options);
    select.setValue(next.value);
  }

  return select;
}

/** "A", "A and B", "A, B and C". */
function listOf(names) {
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Deleting a profile deletes its folder — mods, settings and worlds — to the
 * Recycle Bin, where a world can be brought back from. Until 2026-09-06 the
 * dialog said the files were removed and nothing on disk was touched: every
 * deleted profile left its folder behind for ever, and nothing in the
 * launcher could ever have shown it.
 */
async function remove(profile) {
  const ok = await confirmModal({
    title: `Delete ${profile.name}?`,
    lines: [
      'Its mods, settings and worlds go to the Recycle Bin.',
      'Your other profiles, your keys and your server list are not affected.'
    ],
    confirmLabel: 'Delete profile'
  });
  if (!ok) return;

  const result = await removeProfile(profile.id);
  /* The editor follows the tick (2026-09-16): removeProfile moves the active
     profile to the most recently played one, and the editor used to jump to
     the first card instead — two different profiles, one marked, one open
     (Adrian: "the checkmark drops on something other than the selected box").
     One current profile, so the card that is active is the card that opens. */
  selectedId = state.profiles.some((p) => p.id === state.activeProfileId)
    ? state.activeProfileId
    : (state.profiles[0]?.id ?? null);
  if (selectedId && state.activeProfileId !== selectedId) await setActiveProfile(selectedId);
  paint();
  paintActiveMarks();
  paintEditor();
  if (result?.running) toast(`${profile.name} is still running — close it, then its files can go`, 'error', 5000);
  else toast(`${profile.name} deleted`, 'success');
}

/* One profile per press (2026-09-22). The version is asked of Mojang's list
   first, which on a slow or absent network takes seconds — long enough for
   a second press of New profile to make a second profile. */
let creating = false;

async function create() {
  if (creating) return;
  creating = true;
  let created;
  try {
    created = await addProfile({ name: '', version: await newestVersion(), loader: 'fabric' });
  } finally {
    creating = false;
  }
  selectedId = created.id;
  paint();
  paintActiveMarks();
  paintEditor();
  toast(`${created.name} created`, 'success');
}

function suggestName(profile) {
  return `${profile.version}-${loaderLabel(profile.loader)}`;
}
