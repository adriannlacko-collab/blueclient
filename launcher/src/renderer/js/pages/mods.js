/**
 * Mods — always the mod list of one profile — and, behind the same header,
 * resource packs.
 *
 * A profile is the preset: a game version, a loader, and the jars that run on
 * them. Those three only make sense together, so the mod list lives inside the
 * profile and this page is a view onto one of them. The scope bar at the top
 * says which, and switches without leaving the page.
 *
 * <h2>Resource packs (2026-09-09)</h2>
 * Adrian: "add a similar selection screen in mods between resource packs and
 * mods, so people can also add resource packs just as easily as mods." The
 * switch at the left of the header flips the page between the two. A pack
 * belongs to a profile's settings the way the options.txt line that names it
 * does (game/settings.js): since 2026-09-17 a profile's settings are its own,
 * or shared with the profiles it is synced with, so the packs view is the
 * scoped profile's packs — and the count line names every profile they are
 * on in ("3 of 4 on · Survival and Mainprofile"). The profile picker also
 * says which Minecraft version the Modrinth search offers packs for. Adding
 * a pack switches it on; a pack installed and off looks like a pack that
 * does not work.
 *
 * <h2>Every jar in the folder (2026-09-19)</h2>
 * The list was the profile's own — the entries with a Modrinth slug that the
 * launcher installs — and a jar that reached the folder any other way was
 * invisible: one the player dropped in by hand, or one Import profiles
 * copied over as it was because Modrinth did not know its hash. The empty
 * state even said so ("stays there, but is not listed"). A player told
 * Adrian "not all mods were seen after importing", and Adrian: "make so all
 * installed mods are seen and can be enabled/disabled, rather than just some
 * (the basic ones), easier to toggle rather than having to manually disable
 * in mod menu or having to delete the mods." So after the profile's own
 * cards come the local ones (`host.mods.local`): the same card, its name,
 * version and sentence read out of the jar's own fabric.mod.json, its own
 * icon where the jar carries one, "Added by hand" or "From Lunar Client"
 * where the author line goes, the same switch and the same quiet delete. Off
 * renames the file `.jar.disabled`, which Fabric skips; delete is the
 * Recycle Bin. No version picker and no Modrinth link: the jar is what it
 * is. The count line counts both kinds.
 */

import { el } from '../ui/dom.js';
import { icons } from '../icons.js';
import { confirmModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { segmented } from '../ui/segmented.js';
import { monogram } from '../monogram.js';
import { blockIcon, blockIdFor } from '../blocks.js';
import { paintModIcon } from '../modicon.js';
import { openMenu } from '../ui/menu.js';
import { openAddMods } from './addmods.js';
/* Turning mods on for a profile that has none. Shared with the profile
   editor, which offers the same thing from its own Add button, so the two can
   never ask it differently. */
import { ensureModsOn } from './profiles.js';
import { host } from '../bridge.js';
import { tooOld as olderThanSince, absentNow, leftOut, refreshAbsent } from '../absent.js';
import {
  state, toggleMod, removeMod, setModIcon, activeProfile,
  profileMods, modCount, loaderLabel, setActiveProfile, settingsScopeWords
} from '../state.js';

const VIEWS = [
  { id: 'mods', label: 'Mods' },
  { id: 'packs', label: 'Resource packs' }
];

let query = '';
/** Which profile the page is showing. */
let scopeId = null;
/** Set by scopeTo(): the next render honours it instead of the active profile. */
let pinned = null;
/** Mods or resource packs. Kept across visits: the page comes back as it was left. */
let view = 'mods';

let grid;
let count;
let picker;
let search;
let folderLabel;
let addLabel;

/** The shared packs, as main last listed them. */
let packs = [];
let packsSeq = 0;

/** The jars the launcher did not put there, as main last listed them (2026-09-19). */
let locals = [];
/** Whose folder that list is: a pick of another profile asks again. */
let localsOf = null;
let localsSeq = 0;

export function render() {
  /* Arriving from the nav shows whichever profile is set to launch — that is
     the one the user means by "my mods". Arriving from a profile card pins
     that profile instead. A chip only holds while the page stays mounted. */
  const wanted = pinned ?? activeProfile()?.id ?? state.profiles[0]?.id ?? null;
  pinned = null;
  scopeId = state.profiles.some((p) => p.id === wanted) ? wanted : state.profiles[0]?.id ?? null;

  grid = el('div', { class: 'mod-grid' });
  count = el('span', { class: 'eyebrow' });
  picker = el('button', {
    class: 'profile-picker',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onClick: (event) => openProfileMenu(event.currentTarget)
  });

  search = el('input', {
    class: 'input',
    placeholder: 'Search mods',
    value: query,
    onInput: (event) => { query = event.target.value; paint(); }
  });

  const views = segmented({
    options: VIEWS,
    value: view,
    label: 'Mods or resource packs',
    onChange: (id) => { view = id; paintChrome(); paint(); }
  });

  /* Both wordings live in each button, the longer one invisible, so the
     header keeps one width whichever view is showing. */
  folderLabel = el('span', { class: 'js-label' });
  addLabel = el('span', { class: 'js-label' });

  paintPicker();
  paintChrome();
  paint();

  return el('div', { class: 'page' }, [
    el('div', { class: 'page__inner' }, [
      /* One bar: what you are looking at on the left, what you can do on the
         right, and the count sitting with the buttons it belongs to. */
      /* The switch sits on a line of its own above the tools: the header
         already carries a search box, the profile picker, the count and two
         buttons, and a fifth thing squeezed the search box to a stub. */
      el('div', { class: 'page-tabs' }, [views]),
      el('header', { class: 'page-actions page-actions--tools' }, [
        el('div', { class: 'search' }, [
          el('span', { html: icons.search }),
          search
        ]),
        picker,
        el('span', { class: 'spacer' }),
        count,
        el('button', {
          class: 'btn btn--secondary btn--lg',
          /* The profile's own mods folder (2026-09-19) — where a jar goes by
             hand, now that one put there shows up on this page. It opened
             the instances root before, a list of ids with the folder two
             levels down. */
          onClick: () => (view === 'packs'
            ? host.packs.folder(scopeId)
            : host.mods.folder(scopeId))
        }, [
          el('span', { html: icons.folder, style: { display: 'contents' } }),
          el('span', { class: 'label-stack' }, [
            folderLabel,
            el('span', { class: 'label-stack__ghost', 'aria-hidden': 'true', text: 'Packs folder' })
          ])
        ]),
        el('button', {
          class: 'btn btn--primary btn--add btn--lg',
          /* A vanilla profile used to get a toast telling the player to "give
             it a loader first" — a word this audience does not use, for a job
             the launcher can simply do. It asks instead (2026-09-04). A pack
             needs no loader at all. */
          onClick: async () => {
            const profile = scoped();
            if (!profile) return toast('Create a profile first', 'error');

            if (view === 'packs') {
              openAddMods(profile, () => loadPacks(), { kind: 'pack' });
              return;
            }
            if (!(await ensureModsOn(profile))) return;

            paint();
            openAddMods(profile, () => { paint(); });
          }
        }, [
          el('span', { html: icons.plus, style: { display: 'contents' } }),
          el('span', { class: 'label-stack' }, [
            addLabel,
            el('span', { class: 'label-stack__ghost', 'aria-hidden': 'true', text: 'Add resource packs' })
          ])
        ])
      ]),

      grid
    ])
  ]);
}

/** The words that change with the view: the search box, the two buttons. */
function paintChrome() {
  const onPacks = view === 'packs';
  search.placeholder = onPacks ? 'Search resource packs' : 'Search mods';
  folderLabel.textContent = onPacks ? 'Packs folder' : 'Mods folder';
  addLabel.textContent = onPacks ? 'Add resource packs' : 'Add mods';
}

/* ------------------------------------------------------------ scope bar */

function scoped() {
  return state.profiles.find((p) => p.id === scopeId) || null;
}

/**
 * The pick is the launcher's, not this page's (Adrian, 2026-09-09): the
 * profile whose mods are on screen is the one Profiles opens on and the one
 * Play starts. Before this the page kept its own idea of the current profile,
 * and choosing one here changed nothing anywhere else.
 */
function selectScope(id) {
  scopeId = id;
  setActiveProfile(id);
  paintPicker();
  paint();
}

/** The dropdown label always names the profile whose list is on screen. */
function paintPicker() {
  const profile = scoped();
  picker.replaceChildren(
    profile
      ? el('img', { class: 'profile-picker__face', src: blockIcon(blockIdFor(profile)), alt: '' })
      : el('span', { class: 'profile-picker__dot' }),
    el('span', {
      class: 'profile-picker__name truncate',
      text: profile ? profile.name : 'Select profile'
    }),
    el('span', { class: 'profile-picker__caret', html: icons.chevronDown })
  );
}

function openProfileMenu(anchor) {
  openMenu(anchor, (close) => state.profiles.map((profile) => {
    const { total, enabled } = modCount(profile.id);
    return el('button', {
      class: `profile-option${profile.id === scopeId ? ' is-active' : ''}`,
      role: 'menuitem',
      onClick: () => { selectScope(profile.id); close(); }
    }, [
      el('img', { class: 'profile-picker__face', src: blockIcon(blockIdFor(profile)), alt: '' }),
      el('span', { class: 'stack truncate' }, [
        el('span', { class: 'profile-option__name truncate', text: profile.name }),
        el('span', {
          class: 'profile-option__meta',
          text: `${profile.version} · ${loaderLabel(profile.loader)}`
        })
      ]),
      el('span', {
        class: 'profile-option__count',
        text: profile.loader === 'vanilla' ? '—' : `${enabled}/${total}`
      })
    ]);
  }), { align: 'start', width: 280 });
}

/* ---------------------------------------------------------------- list */

/** Whose packs the list on screen belongs to: a pick of another profile asks again. */
let packsOf = null;

function paint() {
  if (view === 'packs') {
    paintPacks();
    // The packs are the scoped profile's (2026-09-17): a different profile
    // — or a first look — is a different list.
    if (!packs.length || packsOf !== scopeId) loadPacks();
    return;
  }
  paintMods();
  // Which of the listed mods this Minecraft has a build of (2026-09-21):
  // asked once per profile and version, the cards and the count repainted
  // only when the answer differs from what they were drawn with.
  const askedFor = scopeId;
  refreshAbsent(askedFor).then((moved) => {
    if (moved && askedFor === scopeId && view === 'mods' && grid?.isConnected) paintMods();
  });
  // The folder is asked again on every paint of the list (2026-09-19): a
  // jar dropped in by hand, or copied by an import, is on disk and nowhere
  // in the launcher's own state, so the disk is the only place to ask. The
  // last answer for this profile paints at once above, and the fresh one
  // repaints only if it differs.
  loadLocals();
}

function visibleMods() {
  const term = query.trim().toLowerCase();
  return profileMods(scopeId).filter((mod) =>
    !term ||
    mod.name.toLowerCase().includes(term) ||
    mod.author.toLowerCase().includes(term)
  );
}

/** The local cards for the profile on screen, through the same search box. */
function visibleLocals() {
  if (localsOf !== scopeId) return [];
  const term = query.trim().toLowerCase();
  return locals.filter((mod) =>
    !term ||
    mod.name.toLowerCase().includes(term) ||
    mod.author.toLowerCase().includes(term) ||
    mod.file.toLowerCase().includes(term)
  );
}

/** Just the counter — the only thing outside a card that enabling changes. */
function paintCount() {
  const mods = [...visibleMods(), ...visibleLocals()];
  const on = mods.filter((m) => m.enabled);
  // A switched-on mod this Minecraft has no build of is not in the game,
  // and the count says so rather than counting it (2026-09-21; absent.js).
  const absent = on.filter((m) => m.slug !== undefined && leftOut(m, scopeId)).length;
  const version = scoped()?.version;
  count.textContent = `${on.length - absent} of ${mods.length} enabled`
    + (absent ? ` · ${absent} without a build for ${version}` : '');
}

/** Ask main for the jars in the scoped profile's folder and repaint when they differ. */
async function loadLocals() {
  const seq = ++localsSeq;
  const asked = scopeId;
  if (!asked) return;
  const answer = await host.mods.local(asked);
  if (seq !== localsSeq || !grid?.isConnected) return;
  const next = answer?.ok ? answer.mods : [];
  // The same files in the same states is the same page; a repaint for that
  // would replace a switch mid-slide. And the list on screen is kept, not
  // just the picture of it: the cards hold its objects and flip them in
  // place, so a fresh copy under the same picture would leave the count
  // reading objects no card touches.
  // `fits` is in the key because it is the one field that changes without the
  // folder changing (2026-09-22): the profile's Minecraft decides it, so a
  // version switched on Profiles and a return to this page must repaint, or
  // the card keeps saying "this profile is 26.2" about a 1.21.8 one.
  const shape = (list) => list.map((m) => `${m.file}|${m.enabled}|${m.name}|${m.fits}`).join('\n');
  const changed = localsOf !== asked || shape(next) !== shape(locals);
  if (!changed) return;
  locals = next;
  localsOf = asked;
  if (view === 'mods') paintMods();
}

/* A jar dropped into the folder while the launcher sat behind Explorer is
   there when the window comes back (2026-09-19) — Worlds does the same for
   its saves. Registered once, module-wide; a stale listener checks the
   page is on screen before it asks. */
window.addEventListener('focus', () => {
  if (grid?.isConnected && view === 'mods') loadLocals();
});

function paintMods() {
  const profile = scoped();
  const term = query.trim().toLowerCase();
  const mods = visibleMods();
  const extra = visibleLocals();

  paintCount();

  /* Vanilla has no loader, so there is nowhere for a jar to go. Say that
     rather than showing an empty list that looks like a bug. */
  if (profile && profile.loader === 'vanilla') {
    count.textContent = '';
    grid.className = '';
    grid.replaceChildren(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: icons.puzzle }),
      el('p', { class: 'empty__title', text: `${profile.name} is vanilla` }),
      el('p', {
        class: 'empty__text',
        text: 'Mods need a loader. Give this profile Fabric and its mod list appears here.'
      })
    ]));
    return;
  }

  if (!mods.length && !extra.length) {
    grid.className = '';
    grid.replaceChildren(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: icons.puzzle }),
      el('p', { class: 'empty__title', text: term ? 'No matches' : 'No mods installed' }),
      el('p', {
        class: 'empty__text',
        text: term
          ? `Nothing matches “${query.trim()}”.`
          : 'Anything you add here is installed when the game starts. A jar you drop into the mods folder yourself shows up here too.'
      })
    ]));
    return;
  }

  // The profile's own list first, in its order; then what is in the folder
  // besides it, by name (2026-09-19).
  grid.className = 'mod-grid';
  grid.replaceChildren(...mods.map(card), ...extra.map(localCard));
}

/** True for a mod with a `since` floor on a profile whose Minecraft is under it. */
function tooOld(mod) {
  return olderThanSince(mod, scoped()?.version);
}

/**
 * A jar's own Minecraft rule in plain words (2026-09-22): "1.21.11",
 * "1.21.10 and newer", "1.21.x". Anything with more than one term in it is
 * left exactly as its author wrote it rather than paraphrased wrongly.
 */
function saysVersions(needs) {
  const rules = (Array.isArray(needs) ? needs : []).map((rule) => {
    const term = String(rule || '').trim();
    if (/^\d+(\.\d+)*$/.test(term)) return term;
    const one = /^(>=|<=|>|<|~|\^|=)\s*(\d+(?:\.\d+)*)$/.exec(term);
    if (!one) return term;
    const [, op, version] = one;
    if (op === '>=') return `${version} and newer`;
    if (op === '>') return `after ${version}`;
    if (op === '<=') return `${version} and older`;
    if (op === '<') return `before ${version}`;
    if (op === '=') return version;
    return `${version.split('.').slice(0, 2).join('.')}.x`;
  });
  return rules.filter(Boolean).join(' or ');
}

/** No build on Modrinth for this profile's Minecraft — the launch leaves it out. */
function noBuild(mod) {
  return Boolean(mod.slug) && !tooOld(mod) && absentNow(scopeId).has(String(mod.slug).toLowerCase());
}

function card(mod) {
  /* Flipping the switch used to repaint the whole grid, which replaced the
     switch mid-animation so it jumped instead of sliding. Enabling is not a
     structural change, so it updates this one card and the counter in place. */
  /** The whole card is the hit target; the switch just shows the state. */
  async function flip() {
    await toggleMod(scopeId, mod.id);
    toggle.setAttribute('aria-checked', String(mod.enabled));
    toggle.setAttribute('aria-label', `${mod.enabled ? 'Disable' : 'Enable'} ${mod.name}`);
    stateLabel.textContent = mod.enabled ? 'On' : 'Off';
    article.setAttribute('aria-checked', String(mod.enabled));
    article.setAttribute('aria-label', `${mod.name} — ${mod.enabled ? 'enabled' : 'disabled'}`);
    article.classList.toggle('is-off', !mod.enabled);
    paintCount();
  }

  const toggle = el('button', {
    class: 'switch',
    role: 'switch',
    tabindex: '-1',
    'aria-checked': String(mod.enabled),
    'aria-label': `${mod.enabled ? 'Disable' : 'Enable'} ${mod.name}`,
    // The card already handles the click; stop it here so one press does not
    // toggle twice.
    onClick: (event) => event.stopPropagation()
  });

  /* The switch says it in a word as well as in colour (2026-09-07). Forty
     pixels of two-tone bar, unlabelled, across a grid of eight cards is a
     colour swatch rather than a state — and this is the control the page
     exists for, so it has to be readable at a glance. Vanilla says it out
     loud too ("Fullscreen: ON"); this is that, beside the switch. */
  const stateLabel = el('span', {
    class: 'mod-card__state',
    'aria-hidden': 'true',
    text: mod.enabled ? 'On' : 'Off'
  });

  // Monogram first so the row has something immediately; the real artwork
  // arrives once main has fetched and re-encoded it. A mod that came without
  // an address is looked up by its slug, and the answer is kept.
  const icon = el('img', { class: 'mod-card__block', src: monogram(mod.name, 48), alt: '' });
  paintModIcon(icon, mod.iconUrl, mod.slug).then((url) => {
    if (url && url !== mod.iconUrl) setModIcon(scopeId, mod.id, url);
  });

  const article = el('article', {
    class: `mod-card${mod.enabled ? '' : ' is-off'}${mod.enabled && (tooOld(mod) || noBuild(mod)) ? ' is-absent' : ''}`,
    role: 'switch',
    tabindex: '0',
    'aria-checked': String(mod.enabled),
    'aria-label': `${mod.name} — ${mod.enabled ? 'enabled' : 'disabled'}`,
    onClick: flip,
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flip();
      }
    }
  }, [
    icon,

    el('div', { class: 'mod-card__body' }, [
      el('div', { class: 'mod-card__head' }, [
        el('h3', { class: 'mod-card__name truncate', text: mod.name }),
        // The bundled stack carries no number — it installs whatever build
        // fits the profile at launch — and "vlatest" is not a version.
        /^d/.test(String(mod.version)) && el('span', { class: 'badge', text: `v${mod.version}` })
      ]),
      el('p', { class: 'mod-card__author truncate', text: mod.author }),
      // A mod that only exists from some Minecraft on says so in place of
      // its description on a profile older than that: the launch leaves it
      // out quietly (game/mods.js, `since`, 2026-09-11), and a card saying
      // On over a jar that never lands would be a lie.
      // And one Modrinth has no build of for this Minecraft yet says that
      // (2026-09-21): No Chat Reports and Krypton on 26.3 sat as On over a
      // game that ran without them.
      el('p', {
        class: 'mod-card__desc',
        text: tooOld(mod)
          ? `Needs Minecraft ${mod.since} or newer — left out of this profile`
          : noBuild(mod)
            ? `No build for Minecraft ${scoped()?.version} yet — the game starts without it`
            : mod.description
      })
    ]),

    el('div', { class: 'mod-card__foot' }, [
      toggle,
      stateLabel,
      el('span', { class: 'spacer' }),
      /* The same quiet glyph the Clips page uses for the same job (2026-09-07).
         It was a filled red button with the word Delete, repeated once per
         card — eight of them made the loudest thing on the page the one action
         you cannot undo, louder than the switch you came here to use. It goes
         red on hover, where it is about to be pressed. */
      el('button', {
        class: 'btn btn--ghost btn--sm btn--icon btn--danger-hover',
        'aria-label': `Delete ${mod.name}`,
        'data-tip': 'Delete',
        html: icons.trash,
        onClick: async (event) => {
          event.stopPropagation();
          const ok = await confirmModal({
            title: `Remove ${mod.name}?`,
            message: `The mod file is deleted from ${scoped()?.name || 'this profile'}. Other profiles keep their copy.`,
            confirmLabel: 'Remove'
          });
          if (!ok) return;
          await removeMod(scopeId, mod.id);
          paint();
          toast(`${mod.name} removed`, 'success');
        }
      })
    ])
  ]);

  return article;
}

/* ------------------------------------------ the jars in the folder besides */

/** Where the jar came from, for the line under its name. */
function localOrigin() {
  const from = scoped()?.imported?.from;
  return from ? `From ${from}` : 'Added by hand';
}

/**
 * One jar the launcher did not put there, drawn as a mod card (2026-09-19):
 * the same switch and the same quiet delete, and no version picker, because
 * the jar is the one file it is. The switch renames the file on disk —
 * `.jar.disabled` off, the plain name on — so the card is named by the file
 * main answers with from then on. Both moves are refused while a game on
 * this profile is running (Java holds every loaded jar open), and the card
 * says so rather than lying about a rename that did not happen.
 */
function localCard(mod) {
  async function flip() {
    const answer = await host.mods.localToggle(scopeId, mod.file, !mod.enabled);
    if (!answer?.ok) {
      return toast(answer?.running
        ? `Close the game on ${scoped()?.name || 'this profile'} first`
        : 'That mod could not be switched', 'error');
    }
    mod.file = answer.file;
    mod.enabled = answer.enabled;
    toggle.setAttribute('aria-checked', String(mod.enabled));
    toggle.setAttribute('aria-label', `${mod.enabled ? 'Disable' : 'Enable'} ${mod.name}`);
    stateLabel.textContent = mod.enabled ? 'On' : 'Off';
    article.setAttribute('aria-checked', String(mod.enabled));
    article.setAttribute('aria-label', `${mod.name} — ${mod.enabled ? 'enabled' : 'disabled'}`);
    article.classList.toggle('is-off', !mod.enabled);
    paintCount();
  }

  const toggle = el('button', {
    class: 'switch',
    role: 'switch',
    tabindex: '-1',
    'aria-checked': String(mod.enabled),
    'aria-label': `${mod.enabled ? 'Disable' : 'Enable'} ${mod.name}`,
    onClick: (event) => event.stopPropagation()
  });

  const stateLabel = el('span', {
    class: 'mod-card__state',
    'aria-hidden': 'true',
    text: mod.enabled ? 'On' : 'Off'
  });

  /* The jar's own icon where it carries one, else the monogram every mod
     without artwork wears. Nothing is asked of Modrinth: it did not know
     this jar, or the card would not be here. */
  const icon = el('img', { class: 'mod-card__block', src: mod.icon || monogram(mod.name, 48), alt: '' });

  const line = mod.author ? `${localOrigin()} · by ${mod.author}` : localOrigin();

  /* A jar whose own fabric.mod.json does not cover this profile's Minecraft
     (2026-09-22). Fabric Loader refuses to start the game on it, and until
     this line the card said On over a jar that was never going to load —
     "some mods aren't working", with nothing anywhere saying why. Only a
     plain no is shown: `fits` is null wherever the launcher will not say. */
  const wrongGame = mod.fits === false;
  const asks = saysVersions(mod.needs);

  const article = el('article', {
    class: `mod-card${mod.enabled ? '' : ' is-off'}${mod.enabled && wrongGame ? ' is-absent' : ''}`,
    role: 'switch',
    tabindex: '0',
    'aria-checked': String(mod.enabled),
    'aria-label': `${mod.name} — ${mod.enabled ? 'enabled' : 'disabled'}`,
    onClick: flip,
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flip();
      }
    }
  }, [
    icon,

    el('div', { class: 'mod-card__body' }, [
      el('div', { class: 'mod-card__head' }, [
        el('h3', { class: 'mod-card__name truncate', text: mod.name }),
        // The jar's own number, as fabric.mod.json spells it.
        mod.version && el('span', { class: 'badge', text: `v${mod.version}` })
      ]),
      el('p', { class: 'mod-card__author truncate', text: line }),
      // A jar with no fabric.mod.json the launcher could read has only its
      // file name to show; that is said, rather than an empty line. And a
      // jar built for another Minecraft says that instead of its sentence,
      // the way a stack mod with no build for this version does.
      el('p', {
        class: 'mod-card__desc',
        text: wrongGame
          ? `Built for Minecraft ${asks} — this profile is ${scoped()?.version}. The game will not start with it on.`
          : mod.description || (mod.read ? '' : 'The launcher could not read what this jar says about itself.')
      })
    ]),

    el('div', { class: 'mod-card__foot' }, [
      toggle,
      stateLabel,
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn--ghost btn--sm btn--icon btn--danger-hover',
        'aria-label': `Delete ${mod.name}`,
        'data-tip': 'Delete',
        html: icons.trash,
        onClick: async (event) => {
          event.stopPropagation();
          const ok = await confirmModal({
            title: `Remove ${mod.name}?`,
            message: `${mod.file} goes from ${scoped()?.name || 'this profile'}'s mods folder to the Recycle Bin.`,
            confirmLabel: 'Remove'
          });
          if (!ok) return;
          const answer = await host.mods.localRemove(scopeId, mod.file);
          if (!answer?.ok) {
            return toast(answer?.running
              ? `Close the game on ${scoped()?.name || 'this profile'} first`
              : 'That mod could not be removed', 'error');
          }
          locals = locals.filter((m) => m.file !== mod.file);
          paintMods();
          toast(`${mod.name} removed`, 'success');
        }
      })
    ])
  ]);

  return article;
}

/* ------------------------------------------------------- resource packs */

/** Ask main for the shared set and repaint when it answers. */
async function loadPacks() {
  const seq = ++packsSeq;
  const asked = scopeId;
  const answer = await host.packs.list(asked);
  if (seq !== packsSeq || !grid?.isConnected) return;
  packs = answer?.ok ? answer.packs : [];
  packsOf = asked;
  if (view === 'packs') paintPacks();
}

function visiblePacks() {
  const term = query.trim().toLowerCase();
  return packs.filter((pack) =>
    !term ||
    pack.name.toLowerCase().includes(term) ||
    pack.author.toLowerCase().includes(term) ||
    pack.description.toLowerCase().includes(term)
  );
}

function paintPackCount() {
  const shown = visiblePacks();
  count.textContent = shown.length
    ? `${shown.filter((p) => p.enabled).length} of ${shown.length} on · ${settingsScopeWords(scopeId)}`
    : '';
}

function paintPacks() {
  const term = query.trim().toLowerCase();
  const shown = visiblePacks();
  paintPackCount();

  if (!shown.length) {
    grid.className = '';
    grid.replaceChildren(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: icons.palette }),
      el('p', { class: 'empty__title', text: term ? 'No matches' : 'No resource packs yet' }),
      el('p', {
        class: 'empty__text',
        text: term
          ? `Nothing matches “${query.trim()}”.`
          : `Add one from Modrinth and it is on in ${settingsScopeWords(scopeId)} the next time you press Play. A pack you drop into the folder yourself shows up here too.`
      }),
      /* The thing the sentence says to do, right under it (2026-09-14) — the
         same drawer the button in the top corner opens, so an empty page does
         not send the eye across the window to act on what it just read. */
      term ? null : el('button', {
        class: 'btn btn--primary btn--add empty__action',
        onClick: () => {
          const profile = scoped();
          if (!profile) return toast('Create a profile first', 'error');
          openAddMods(profile, () => loadPacks(), { kind: 'pack' });
        }
      }, [
        el('span', { html: icons.plus, style: { display: 'contents' } }),
        el('span', { text: 'Add resource packs' })
      ])
    ]));
    return;
  }

  grid.className = 'mod-grid';
  grid.replaceChildren(...shown.map(packCard));
}

/** One pack, drawn as a mod card: the same switch, the same quiet delete. */
function packCard(pack) {
  async function flip() {
    const answer = await host.packs.toggle(scopeId, pack.file, !pack.enabled);
    if (!answer?.ok) return toast('That pack could not be switched', 'error');
    pack.enabled = answer.enabled;
    toggle.setAttribute('aria-checked', String(pack.enabled));
    toggle.setAttribute('aria-label', `${pack.enabled ? 'Turn off' : 'Turn on'} ${pack.name}`);
    stateLabel.textContent = pack.enabled ? 'On' : 'Off';
    article.setAttribute('aria-checked', String(pack.enabled));
    article.setAttribute('aria-label', `${pack.name} — ${pack.enabled ? 'on' : 'off'}`);
    article.classList.toggle('is-off', !pack.enabled);
    paintPackCount();
  }

  const toggle = el('button', {
    class: 'switch',
    role: 'switch',
    tabindex: '-1',
    'aria-checked': String(pack.enabled),
    'aria-label': `${pack.enabled ? 'Turn off' : 'Turn on'} ${pack.name}`,
    onClick: (event) => event.stopPropagation()
  });

  const stateLabel = el('span', {
    class: 'mod-card__state',
    'aria-hidden': 'true',
    text: pack.enabled ? 'On' : 'Off'
  });

  /* The pack's own pack.png where it has one, else Modrinth's picture, else
     the monogram every mod without artwork wears. */
  const icon = el('img', { class: 'mod-card__block', src: pack.icon || monogram(pack.name, 48), alt: '' });
  if (!pack.icon && pack.iconUrl) paintModIcon(icon, pack.iconUrl, pack.slug);

  const line = pack.author
    ? `by ${pack.author}`
    : pack.source === 'file' ? 'In your packs folder' : '';

  const article = el('article', {
    class: `mod-card${pack.enabled ? '' : ' is-off'}`,
    role: 'switch',
    tabindex: '0',
    'aria-checked': String(pack.enabled),
    'aria-label': `${pack.name} — ${pack.enabled ? 'on' : 'off'}`,
    onClick: flip,
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flip();
      }
    }
  }, [
    icon,
    el('div', { class: 'mod-card__body' }, [
      el('div', { class: 'mod-card__head' }, [
        el('h3', { class: 'mod-card__name truncate', text: pack.name })
      ]),
      el('p', { class: 'mod-card__author truncate', text: line }),
      el('p', { class: 'mod-card__desc', text: pack.description })
    ]),
    el('div', { class: 'mod-card__foot' }, [
      toggle,
      stateLabel,
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn--ghost btn--sm btn--icon btn--danger-hover',
        'aria-label': `Delete ${pack.name}`,
        'data-tip': 'Delete',
        html: icons.trash,
        onClick: async (event) => {
          event.stopPropagation();
          const ok = await confirmModal({
            title: `Remove ${pack.name}?`,
            message: `The pack is deleted from the packs folder of ${settingsScopeWords(scopeId)}.`,
            confirmLabel: 'Remove'
          });
          if (!ok) return;
          const answer = await host.packs.remove(scopeId, pack.file);
          if (!answer?.ok) return toast('That pack could not be removed', 'error');
          packs = packs.filter((p) => p.file !== pack.file);
          paintPacks();
          toast(`${pack.name} removed`, 'success');
        }
      })
    ])
  ]);

  return article;
}

/** Opening the page from a profile card scopes it to that profile. */
export function scopeTo(id) {
  pinned = id;
}
