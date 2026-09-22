import { selectMenu } from '../ui/select.js';
import { el, mount } from '../ui/dom.js';
import { tabStrip } from '../ui/tabstrip.js';
import { icons } from '../icons.js';
import { confirmModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { host } from '../bridge.js';
import { APP_NAME } from '../config.js';
import { state, updateSettings, resetSettings, removeProfile, formatBytes, paintWorldBlur, paintWorldBrightness } from '../state.js';

/* Empty means the launcher's own flags for the game's Java (2026-09-22; they
   are picked per Java version in main's install.js, from the bench's tables).
   The field held the flags themselves as text until then, which is why a new
   default never reached anyone. */
const DEFAULT_JVM_ARGS = '';

/* Four names, no subtitles (2026-09-07, Adrian: "in settings remove the small
   text under each title … in the categories").

   They were added on 2026-09-04 to fix a real problem — the old names promised
   a Discord presence that had been removed and downloads that were never here
   — but the fix was the *names*, and the sentence under each one was the belt
   to that pair of braces. A tab is pressed and the page under it immediately
   shows exactly what the sentence claimed, so it was read once and never
   again, while costing every visit a second line of grey type across four
   tiles. The names still have to be honest on their own: if one ever needs a
   sentence to be understood, rename it rather than putting the sentence back. */
const SECTIONS = [
  { id: 'general', label: 'General', icon: 'home' },
  { id: 'game', label: 'Game', icon: 'gauge' },
  { id: 'storage', label: 'Storage', icon: 'drive' },
  { id: 'support', label: 'About', icon: 'lifebuoy' }
];

let current = 'general';
let body;
let nav;
let strip;

export function render() {
  body = el('div', { class: 'settings__body' });
  /* The masthead's tab strip, at this strip's own size (2026-09-14, Adrian:
     "the settings category bar should look and feel exactly the same as the
     main topbar … but it should keep the size it has currently"): the same
     glass, the same two-deck tabs, the same tint travelling behind them, the
     same drag. `.settings__nav` only sets the width and height. */
  nav = el('nav', { class: 'topnav settings__nav', 'aria-label': 'Settings sections' },
    SECTIONS.map((section) => el('button', {
      class: `nav-item settings-tab${section.id === current ? ' is-active' : ''}`,
      dataset: { tab: section.id },
      onClick: () => selectSection(section.id)
    }, [
      el('span', { class: 'nav-item__icon', html: icons[section.icon] }),
      el('span', { text: section.label })
    ]))
  );
  strip = tabStrip(nav, { current: () => current, select: selectSection });

  paintSection();

  return el('div', { class: 'page page--settings' }, [
    el('div', { class: 'page__inner' }, [
      el('div', { class: 'settings' }, [
        el('div', { class: 'settings__side' }, [
          nav,
          el('div', { class: 'settings__note' }, [
            el('span', { class: 'settings__note-dot' }),
            el('span', { text: 'Changes save automatically' })
          ])
        ]),
        body
      ])
    ])
  ]);
}

function selectSection(id) {
  current = id;
  for (const tab of nav.querySelectorAll('.nav-item')) tab.classList.toggle('is-active', tab.dataset.tab === id);
  strip.move();
  paintSection();
}

/**
 * Which section the page opens on next time it is rendered — so a control
 * elsewhere can land the player on a particular one. Home's crash row uses
 * it: "More memory" is Settings → Game, not Settings and a hunt (2026-09-11).
 */
export function openSection(id) {
  if (SECTIONS.some((section) => section.id === id)) current = id;
}

function paintSection() {
  const groups = {
    general: generalGroups,
    game: gameGroups,
    storage: storageGroups,
    support: supportGroups
  }[current]();

  mount(body, ...groups);
}

/* ---------------------------------------------------------- primitives */

/* Neither a group nor a row carries a glyph any more (2026-09-07). Every one
   of them wore a tinted accent tile, which put ten to fifteen cyan marks on a
   page where two of them — the switches — were the only things that said
   anything about state. Worse, the pictures repeated: General stacked a house
   on a house, Storage two identical drives, About three lifebuoys. A picture
   that is the same for every line on the page is not telling the lines apart,
   which is "Nothing decorative" and "Fewer things, not smaller ones" at once.
   The section glyph survives on the tab strip above, where it does help find a
   section; inside a section the name carries it.

   And `sub` is null on most groups (the same afternoon, and the same
   instruction that took the subtitles off the four category tiles). A header
   that repeated its own title in a second colour — "Launcher / Home screen
   preferences", "Logs / What the launcher writes down" — was a line of grey
   type per group saying nothing the group's name had not. Two are kept,
   because they are facts and not restatements: Memory says how much RAM the
   machine has, and Java carries the one plain line telling a player it is
   already set up. That is the rule for adding a third — a header takes a line
   when it has something to say, and otherwise the name carries it. */
function group(title, sub, rows) {
  return el('section', { class: 'group' }, [
    el('div', { class: 'group__head' }, [
      el('div', { class: 'stack' }, [
        el('span', { class: 'group__title', text: title }),
        sub && el('span', { class: 'group__sub', text: sub })
      ])
    ]),
    ...rows
  ]);
}

function row(name, desc, control) {
  return el('div', { class: 'setting-row' }, [
    el('div', { class: 'stack setting-row__text' }, [
      el('span', { class: 'setting-row__name', text: name }),
      desc && el('span', { class: 'setting-row__desc', text: desc })
    ]),
    control ? el('div', { class: 'setting-row__control' }, [].concat(control)) : null
  ]);
}

/** "a", "a and b", "a, b and c" — a list read out the way it is spoken. */
function listOf(names) {
  if (names.length < 2) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function toggle(checked, onChange, label) {
  const node = el('button', {
    class: 'switch', role: 'switch',
    'aria-checked': String(checked), 'aria-label': label,
    onClick: () => {
      const next = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(next));
      onChange(next);
    }
  });
  return node;
}

/* ------------------------------------------------------------- sections */

function generalGroups() {
  const launcher = state.settings.launcher;
  const stats = state.settings.stats || {};

  return [
    group('Launcher', null, [
      /* Said the positive way round (2026-09-04): the switch is on when the
         thing it names is on screen. "Hide 3D Character" was backwards and in
         title case, and "3D skin preview" is not what anybody calls the player
         standing on Home. The stored key stays hideCharacter, so an existing
         settings file is read unchanged. */
      row('Show your character',
        'Your skin stands on the world behind Home. Off leaves the world on its own',
        toggle(launcher.hideCharacter !== true,
          (next) => updateSettings({ launcher: { hideCharacter: !next } }), 'Show your character')),
      row('When the game starts', 'What the launcher window does once Minecraft opens',
        selectMenu({
          value: launcher.onLaunch || 'keep',
          width: 170,
          label: 'When the game starts',
          options: [
            { value: 'minimize', label: 'Minimise' },
            { value: 'close', label: 'Hide' },
            { value: 'keep', label: 'Keep open' }
          ],
          onChange: (value) => updateSettings({ launcher: { onLaunch: value } })
        })),
      /* The launcher switches this off by itself, once, on a machine that
         cannot hold the world at speed — so a laptop that was told no can
         say yes again here. */
      row('Live background',
        'The world behind the launcher turns slowly, like the title screen. Off keeps a still of the same world and spares the graphics card',
        toggle(launcher.liveWorld !== false,
          (next) => updateSettings({ launcher: { liveWorld: next } }), 'Live background')),
      blurRow(launcher),
      brightnessRow(launcher)
    ]),
    /* There was an Appearance group here with a Theme picker until 2026-09-09
       (Adrian: "remove light mode completely from the launcher"). Glass over
       the world is the one look now; the light tokens went with the control. */

    /* Opt-in crash reports (2026-09-11). Off by default — the opposite of
       Player count below, which counts every launcher unless it is turned
       off. The line under the switch is the contract: it must say exactly
       what src/main/crashes.js's reportShape sends and nothing else, so
       whoever changes that function changes this sentence in the same
       breath. */
    group('Crash reports', null, [
      row('Send crash reports',
        'The crash reason, the suspected mod, and the Minecraft and BlueClient versions. Nothing else.',
        toggle(stats.crashReports === true,
          (next) => updateSettings({ stats: { crashReports: next } }), 'Send crash reports'))
    ])
  ];
}

/**
 * Background blur (2026-09-15): the world behind everything, softened by
 * as much as the slider says, while it is dragged. Built the way the Memory
 * slider is — name and value on one line, the slider under them, a sentence
 * under that. Every input paints the root at once (paintWorldBlur), so the
 * world answers under the pointer; the setting is written when the handle
 * is let go. "Off" at zero rather than "0%": the number is not a strength
 * of anything, it is the world as it is drawn.
 */
function blurRow(launcher) {
  const amount = Math.max(0, Math.min(100, Math.round(Number(launcher.worldBlur) || 0)));
  const value = el('span', { class: 'mem-value' });
  const slider = el('input', {
    class: 'slider', type: 'range', min: '0', max: '100', step: '5',
    value: String(amount), 'aria-label': 'Background blur',
    onInput: (event) => paint(Number(event.target.value), true),
    onChange: (event) => updateSettings({ launcher: { worldBlur: Number(event.target.value) } })
  });

  function paint(n, live) {
    value.textContent = n ? `${n}%` : 'Off';
    slider.style.setProperty('--fill', `${n}%`);
    if (live) paintWorldBlur(n);
  }
  paint(amount, false);

  return el('div', { class: 'setting-row setting-row--stacked' }, [
    el('div', { class: 'row', style: { gap: 'var(--space-3)', width: '100%' } }, [
      el('span', { class: 'setting-row__name', text: 'Background blur' }),
      el('span', { class: 'spacer' }),
      value
    ]),
    slider,
    el('span', { class: 'setting-row__desc', text: 'Softens the world behind the launcher, as you drag. Off shows it as it is drawn' })
  ]);
}

/**
 * Background brightness (2026-09-15, 0.38.1): the same row as the blur's,
 * for how brightly the world is drawn. 100% is the top of the slider and
 * the world as it is — the launcher as it was before the setting existed —
 * and the handle only goes down from there, to 10 (Adrian: "the current one
 * should be max, and then you can drag it lower to decrease it"). Never to
 * 0: a black window behind glass is a window that looks broken, not dark.
 * The default was 80 from 0.38.2 (the same hour: "make default to
 * brightness as 80%") and is 70 since 0.45.0 (2026-09-17: "put default
 * brightness to 70%"); the top of the slider is still the untouched world.
 * paintWorldBrightness on every input; the setting written on release.
 */
function brightnessRow(launcher) {
  const raw = Number(launcher.worldBrightness);
  const amount = Math.max(10, Math.min(100, Math.round(Number.isFinite(raw) ? raw : 100)));
  const value = el('span', { class: 'mem-value' });
  const slider = el('input', {
    class: 'slider', type: 'range', min: '10', max: '100', step: '5',
    value: String(amount), 'aria-label': 'Background brightness',
    onInput: (event) => paint(Number(event.target.value), true),
    onChange: (event) => updateSettings({ launcher: { worldBrightness: Number(event.target.value) } })
  });

  function paint(n, live) {
    value.textContent = `${n}%`;
    slider.style.setProperty('--fill', `${((n - 10) / 90) * 100}%`);
    if (live) paintWorldBrightness(n);
  }
  paint(amount, false);

  return el('div', { class: 'setting-row setting-row--stacked' }, [
    el('div', { class: 'row', style: { gap: 'var(--space-3)', width: '100%' } }, [
      el('span', { class: 'setting-row__name', text: 'Background brightness' }),
      el('span', { class: 'spacer' }),
      value
    ]),
    slider,
    el('span', { class: 'setting-row__desc', text: 'Dims the world behind the launcher, as you drag. 100% shows it as it is drawn' })
  ]);
}

function gameGroups() {
  const game = state.settings.game;
  const totalMb = state.system?.totalMemoryMb || 16384;
  const maxMb = Math.min(Math.max(totalMb - 2048, 2048), 32768);

  const value = el('span', { class: 'mem-value', text: `${(game.memoryMb / 1024).toFixed(1)} GB` });
  const slider = el('input', {
    class: 'slider', type: 'range', min: '1024', max: String(maxMb), step: '512',
    value: String(game.memoryMb), 'aria-label': 'Memory allocation',
    onInput: (event) => paintMem(Number(event.target.value)),
    onChange: (event) => updateSettings({ game: { memoryMb: Number(event.target.value) } })
  });

  function paintMem(mb) {
    value.textContent = `${(mb / 1024).toFixed(1)} GB`;
    slider.style.setProperty('--fill', `${((mb - 1024) / (maxMb - 1024)) * 100}%`);
  }
  paintMem(game.memoryMb);

  const javaInput = el('input', {
    class: 'input', placeholder: `The one ${APP_NAME} installs`, value: game.javaPath || '', spellcheck: 'false',
    onChange: (event) => updateSettings({ game: { javaPath: event.target.value.trim() } })
  });

  const argsInput = el('input', {
    class: 'input mono', value: game.jvmArgs || '', spellcheck: 'false',
    placeholder: `${APP_NAME} picks these for the game's Java`,
    onChange: (event) => updateSettings({ game: { jvmArgs: event.target.value } })
  });

  return [
    group('Memory', `Of ${(totalMb / 1024).toFixed(0)} GB installed`, [
      el('div', { class: 'setting-row setting-row--stacked' }, [
        el('div', { class: 'row', style: { gap: 'var(--space-3)', width: '100%' } }, [
          el('span', { class: 'setting-row__name', text: 'Memory for the game' }),
          el('span', { class: 'spacer' }),
          value
        ]),
        slider,
        el('span', { class: 'setting-row__desc', text: 'Most setups run best between 4 and 8 GB — more is not faster.' })
      ])
    ]),

    /* One plain line at the head of the group, once, and then the two boxes
       (2026-09-04). Both stay: a support answer occasionally needs a different
       Java for an odd machine, or a flag somebody was told to paste, and
       cutting a feature that works to make a page look calm is the other way
       to fail the simple rule. What did go is the group that used to sit under
       this one — "Microsoft sign-in / Application ID", an Azure id that is
       empty for every player who will ever run BlueClient and was told, in its
       own help text, to stay that way. The setting is still read out of the
       settings file for a private build with its own registration; it is only
       the control that is gone. */
    group('Java', `The game runs on Java. ${APP_NAME} installs its own, so this is set up already.`, [
      row('Java', `Empty means the one that came with ${APP_NAME}`,
        el('button', {
          class: 'btn btn--secondary btn--sm', text: 'Browse',
          onClick: async () => {
            const picked = await host.shell.pickJava();
            if (!picked) return;
            javaInput.value = picked;
            await updateSettings({ game: { javaPath: picked } });
            toast('Java changed', 'success');
          }
        })),
      el('div', { class: 'setting-row setting-row--stacked' }, [javaInput]),
      row('Java options', 'Empty is the launcher\'s own; anything typed here replaces them',
        el('button', {
          class: 'btn btn--ghost btn--sm', text: 'Reset',
          onClick: async () => {
            argsInput.value = DEFAULT_JVM_ARGS;
            await updateSettings({ game: { jvmArgs: DEFAULT_JVM_ARGS } });
            toast('Java options reset', 'success');
          }
        })),
      el('div', { class: 'setting-row setting-row--stacked' }, [argsInput])
    ]),

    group('Window', null, [
      row('Fullscreen', 'Start the game in fullscreen',
        toggle(game.resolution.fullscreen,
          (next) => updateSettings({ game: { resolution: { fullscreen: next } } }), 'Fullscreen')),
      row('Window size', 'Size the game window opens at', [
        el('input', {
          class: 'input', type: 'number', min: '640', max: '7680', style: { width: '86px' },
          value: String(game.resolution.width), 'aria-label': 'Width',
          onChange: (event) => updateSettings({ game: { resolution: { width: clamp(event.target, 640, 7680) } } })
        }),
        el('span', { class: 'dim', text: '×' }),
        el('input', {
          class: 'input', type: 'number', min: '480', max: '4320', style: { width: '86px' },
          value: String(game.resolution.height), 'aria-label': 'Height',
          onChange: (event) => updateSettings({ game: { resolution: { height: clamp(event.target, 480, 4320) } } })
        })
      ])
    ])
  ];
}

function storageGroups() {
  const launcher = state.settings.launcher;

  const dirInput = el('input', {
    class: 'input', value: launcher.gameDirectory || '', spellcheck: 'false',
    onChange: (event) => updateSettings({ launcher: { gameDirectory: event.target.value.trim() } })
  });

  return [
    group('Game files', null, [
      row('Install location', 'All profiles are stored under this folder', [
        el('button', {
          class: 'btn btn--secondary btn--sm', text: 'Change',
          onClick: async () => {
            const picked = await host.shell.pickDirectory();
            if (!picked) return;
            dirInput.value = picked;
            await updateSettings({ launcher: { gameDirectory: picked } });
            toast('Install location updated', 'success');
          }
        }),
        el('button', {
          class: 'btn btn--ghost btn--sm btn--icon',
          'aria-label': 'Open folder', 'data-tip': 'Open folder', html: icons.folder,
          onClick: () => host.shell.openPath(dirInput.value)
        })
      ]),
      el('div', { class: 'setting-row setting-row--stacked' }, [dirInput])
    ]),

    diskGroup()
  ];
}

/**
 * What is on the disk, folder by folder, with a Delete that deletes
 * (2026-09-06). A player who made and deleted three profiles used to have
 * gigabytes they could neither see nor reclaim, because deleting a profile
 * never touched its folder. The rows are filled in once main has walked the
 * folders; until then the group says it is measuring rather than claiming a
 * number it has not got.
 */
function diskGroup() {
  const body = el('div', { class: 'rows' });
  const measuring = el('span', { class: 'setting-row__desc', text: 'Measuring…' });
  mount(body, el('div', { class: 'setting-row' }, [
    el('div', { class: 'stack setting-row__text' }, [measuring])
  ]));

  host.game.disk().then((disk) => {
    if (!body.isConnected || !disk) return;
    paintDisk(body, disk);
  }).catch(() => {
    measuring.textContent = 'Could not read the folders';
  });

  return group('On this disk', null, [body]);
}

function paintDisk(body, disk) {
  const rows = [];
  const known = new Set(state.profiles.map((profile) => profile.id));

  for (const profile of state.profiles) {
    const bytes = disk.profiles[profile.id] || 0;
    /* A profile that shares its settings keeps its copy in its own folder
       and the set itself in the group's (the row below the profiles). */
    const shared = disk.members && disk.members[profile.id];
    rows.push(row(profile.name,
      bytes ? `${formatBytes(bytes)} — mods, ${shared ? 'a copy of the shared settings' : 'settings'} and worlds` : 'Not installed yet',
      bytes ? deleteButton(`Delete ${profile.name}?`, async () => {
        const result = await removeProfile(profile.id);
        if (result?.running) toast(`${profile.name} is still running — close it first`, 'error', 5000);
        else toast(`${profile.name} deleted`, 'success');
        return result?.ok;
      }) : null));
  }

  /* Folders under the install location that no profile owns: what the old
     Delete left behind. Named for what they are, and deletable. */
  for (const [id, bytes] of Object.entries(disk.profiles)) {
    if (known.has(id)) continue;
    rows.push(row('Left over from a deleted profile', `${formatBytes(bytes)} — its worlds are still in here`,
      deleteButton('Delete this folder?', async () => {
        const result = await host.game.removeInstance(id).catch(() => null);
        if (result?.ok) toast('Folder deleted', 'success');
        else toast('Could not delete the folder', 'error');
        return result?.ok;
      })));
  }

  /* The settings two or more profiles share (2026-09-17): one row per group,
     saying what the folder is for and not only what it weighs — the count is
     the group's server list, and the launchers named after it are the ones
     it keeps taking new servers from. */
  for (const group of disk.groups || []) {
    const names = state.profiles.filter((p) => disk.members && disk.members[p.id] === group.id).map((p) => p.name);
    if (!names.length) continue;
    const set = group.set;
    const servers = set && set.servers ? `${set.servers} server${set.servers === 1 ? '' : 's'}` : 'servers';
    const alsoFrom = set && set.from.length
      ? `. Servers you add in ${listOf(set.from)} turn up here too`
      : '';
    rows.push(row(`Settings shared by ${listOf(names)}`,
      `${formatBytes(group.bytes)} — keys, video settings, ${servers}, packs and the in-game menu, the same in each${alsoFrom}`, null));
  }
  /* What is the player's whichever profile they play. */
  rows.push(row('Your play record',
    `${formatBytes(disk.shared)} — hours played, level and capes, waypoints, chat logs, and the backups of your worlds`, null));
  rows.push(row('Java', `${formatBytes(disk.java)} — the runtimes ${APP_NAME} installed for the game`, null));
  rows.push(row("Minecraft's own files",
    `${formatBytes(disk.mojang)} — versions, libraries and assets in ${disk.root}. Shared with the other launchers on this PC, so ${APP_NAME} never deletes them`, null));

  mount(body, ...rows);

  function deleteButton(title, act) {
    const button = el('button', {
      class: 'btn btn--ghost btn--sm btn--icon',
      'aria-label': 'Delete', 'data-tip': 'Delete', html: icons.trash,
      onClick: async () => {
        const ok = await confirmModal({
          title,
          lines: ['Its mods, settings and worlds go to the Recycle Bin.'],
          confirmLabel: 'Delete'
        });
        if (!ok) return;
        button.disabled = true;
        const done = await act();
        if (done) host.game.disk().then((fresh) => { if (body.isConnected && fresh) paintDisk(body, fresh); });
        else button.disabled = false;
      }
    });
    return button;
  }
}

function supportGroups() {
  const system = state.system || {};
  const launcher = state.settings.launcher;
  const stats = state.settings.stats || {};

  return [
    group('Logs', null, [
      row('Keep launch logs',
        'Every game that closes leaves its command line and output in the logs folder. Off writes no log files at all',
        toggle(launcher.keepLogs !== false,
          (next) => updateSettings({ launcher: { keepLogs: next } }), 'Keep launch logs')),
      /* The chat logs the game writes (2026-09-19): plain text, a file a day,
         in the launcher-wide folder main told the game about. The switch for
         them is the game's — Blue Settings → General → Chat, "Keep chat
         logs" — so this row only opens the folder. */
      row('Chat logs', 'Everything said in chat, one file a day',
        el('button', {
          class: 'btn btn--sm', text: 'Open',
          onClick: () => host.game.chatLogs()
        }))
    ]),

    /* The one thing the launcher sends about itself (src/main/stats.js), said
       in full where it is switched — every field `send` puts in the body, so
       whoever adds a field changes this sentence in the same breath
       (2026-09-16; it used to leave out the OS, the Minecraft version and
       the module list). Nothing that names the player. The row under it is
       the whole account, for anyone who wants more than a sentence. */
    group('Player count', null, [
      row('Count me as a player',
        'Every five minutes: an anonymous id, the launcher version, Windows or not, and whether a game is open; on a launch, the Minecraft version and which features are on; when a game ends, its frame rate (the median, the 1% low, the longest frame, how long you played) and your graphics card\'s model name. Never your name, your account or your servers',
        toggle(stats.share !== false,
          (next) => updateSettings({ stats: { share: next } }), 'Count me as a player')),
      row('What BlueClient sends',
        'Everything the launcher and the game ever send, and what stays on this PC — one page',
        el('button', {
          class: 'btn btn--sm', text: 'Open',
          onClick: () => host.shell.openExternal('https://blueclient.net/privacy')
        }))
    ]),

    /* Three rows that only report. They pass no control at all rather than an
       empty one, so nothing sits in the right-hand column looking like a
       button that lost its label (2026-09-04). */
    group('This PC', null, [
      row('Processor', system.cpu || '—', null),
      row('Memory', `${((system.totalMemoryMb || 0) / 1024).toFixed(0)} GB installed`, null),
      row('Version', `${APP_NAME} ${system.appVersion || ''} · Electron ${system.electron || ''}`, null)
    ]),

    /* The beta channel (2026-09-11), one switch. Off, the launcher only ever
       takes what GitHub calls Latest, which a pre-release never is. On, the
       next look reads the release list and takes the newest there, finished
       or not — and flipping it asks for that look at once, so the corner of
       Home answers within seconds rather than at the next twenty-minute
       check. The line under it says the one thing that matters: a test
       version can be rough. Nothing here undoes a download already made. */
    group('Updates', null, [
      row('Get updates early',
        'Test versions arrive before the finished release. They can have rough edges',
        toggle(launcher.earlyUpdates === true,
          async (next) => {
            await updateSettings({ launcher: { earlyUpdates: next } });
            host.update.recheck?.()?.catch(() => {});
          }, 'Get updates early'))
    ]),

    group('Reset', null, [
      row('Reset all settings', 'Every option returns to its default. Profiles, mods and accounts are kept.',
        el('button', {
          class: 'btn btn--danger btn--sm', text: 'Reset',
          onClick: async () => {
            const ok = await confirmModal({
              title: 'Reset settings?',
              message: 'Every option returns to its default value. Your profiles, mods and accounts are not affected.',
              confirmLabel: 'Reset settings'
            });
            if (!ok) return;
            await resetSettings();
            toast('Settings reset', 'success');
          }
        }))
    ])
  ];
}

function clamp(input, min, max) {
  const value = Math.min(Math.max(Number(input.value) || min, min), max);
  input.value = String(value);
  return value;
}
