/**
 * Bridge to the host.
 *
 * In the packaged app this is `window.beam`, exposed by the preload script.
 * Opened in a plain browser there is no preload, so we fall back to an
 * equivalent in-memory/localStorage implementation. That keeps the entire UI
 * — including launch progress and settings persistence — runnable and
 * inspectable in a browser, which is where most of the design work happens.
 */

const isElectron = typeof window !== 'undefined' && !!window.beam;

/* ------------------------------------------------------------------ mock */

const MOCK_KEY = 'beam.settings';

const mockDefaults = () => ({
  schemaVersion: 1,
  window: { width: 1180, height: 730, maximized: false },
  accounts: { active: null, list: [] },
  game: {
    lastProfile: null,
    memoryMb: 4096,
    resolution: { width: 1280, height: 720, fullscreen: false },
    javaPath: '',
    jvmArgs: '-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:G1HeapRegionSize=32M -XX:MaxGCPauseMillis=50'
  },
  launcher: {
    onLaunch: 'keep',
    keepLogs: true,
    hardwareAcceleration: true,
    gameDirectory: 'C:\\Users\\You\\AppData\\Roaming\\BlueClient\\instances'
  }
});

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(out[key], value)
      : value;
  }
  return out;
}

function createMock() {
  let settings;
  /* Which profiles are synced (settings.link / leave below), for the dev server. */
  const groups = {};
  try {
    settings = deepMerge(mockDefaults(), JSON.parse(localStorage.getItem(MOCK_KEY) || '{}'));
  } catch {
    settings = mockDefaults();
  }

  const persist = () => {
    try { localStorage.setItem(MOCK_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  };

  /* A few clips and screenshots for the Clips page in a browser (2026-09-19;
     it listed nothing until the favourites work needed a star to press). The
     pictures are the version wall's posters, and a clip's video is a file
     the browser will not find — a hover shows nothing over the still, which
     is fine for looking at the page. The stars are kept in localStorage the
     way the settings are, and a fresh browser starts with one of each kind
     starred so the Favourites view has something in it. */
  const hour = 3600e3;
  const media = {
    clips: [
      { name: '2026-09-18 21-14-05.mp4', url: '/mock/2026-09-18 21-14-05.mp4', still: '/assets/art/versions/1.21.jpg', size: 24.6 * 1024 * 1024, duration: 30, modified: Date.now() - 2 * hour },
      { name: '2026-09-18 19-40-52.mp4', url: '/mock/2026-09-18 19-40-52.mp4', still: '/assets/art/versions/1.20.jpg', size: 23.9 * 1024 * 1024, duration: 30, modified: Date.now() - 27 * hour },
      { name: '2026-09-16 22-03-17.mp4', url: '/mock/2026-09-16 22-03-17.mp4', still: '/assets/art/versions/1.18.jpg', size: 12.1 * 1024 * 1024, duration: 15, modified: Date.now() - 71 * hour }
    ],
    shots: [
      { id: 'Main/2026-09-18_20.02.41.png', name: '2026-09-18_20.02.41.png', profile: 'Main', url: '/assets/art/versions/1.19.jpg', size: 1.8 * 1024 * 1024, modified: Date.now() - 3 * hour },
      { id: 'Main/2026-09-17_18.31.09.png', name: '2026-09-17_18.31.09.png', profile: 'Main', url: '/assets/art/versions/1.17.jpg', size: 2.2 * 1024 * 1024, modified: Date.now() - 30 * hour },
      { id: 'Survival/2026-09-15_23.10.55.png', name: '2026-09-15_23.10.55.png', profile: 'Survival', url: '/assets/art/versions/1.16.jpg', size: 1.5 * 1024 * 1024, modified: Date.now() - 95 * hour }
    ]
  };
  let favourites;
  try {
    favourites = JSON.parse(localStorage.getItem('beam.favourites')) || null;
  } catch { favourites = null; }
  if (!favourites || !Array.isArray(favourites.clips) || !Array.isArray(favourites.shots)) {
    favourites = { clips: [media.clips[0].name], shots: [media.shots[0].id] };
  }
  const favourite = (kind, id, on) => {
    const list = favourites[kind].filter((one) => one !== id);
    if (on) list.push(id);
    favourites[kind] = list;
    try { localStorage.setItem('beam.favourites', JSON.stringify(favourites)); } catch { /* private mode */ }
    return true;
  };

  const listeners = { progress: new Set(), warning: new Set(), state: new Set(), window: new Set() };
  const emit = (kind, payload) => listeners[kind].forEach((fn) => fn(payload));
  const on = (kind) => (handler) => {
    listeners[kind].add(handler);
    return () => listeners[kind].delete(handler);
  };

  const STAGES = [
    ['Authenticating', 8, 500],
    ['Fetching version data', 10, 620],
    ['Resolving libraries', 22, 950],
    ['Verifying assets', 40, 1600],
    ['Extracting natives', 12, 620],
    ['Starting Java', 8, 700]
  ];

  /* Preview runs the same session model as the real launcher: a map of them,
     each with its own id, progress and clock, so the running rows on Home can
     be designed with two or three games up. A mock session runs until it is
     stopped — nothing here is a real process to exit on its own. */
  const sessions = new Map();
  let seq = 0;
  const timers = new Set();
  const sleep = (ms) => new Promise((res) => timers.add(setTimeout(res, ms)));

  /* The crashes the rows on Home are still showing, in the shape
     src/main/crashes.js hands over (summary()): no paths, only whether there
     is something to open. `game.__crash(id, kind)` below ends a mock session
     the way a real one dies, so every row variant can be designed here. */
  const crashes = new Map();
  const CRASH_KINDS = {
    mod: { headline: 'Crashed — Simple Voice Chat is the likely cause', detail: 'Simple Voice Chat was added to this profile. Removing it is the quickest test.',
      suspect: { id: 'voicechat', name: 'Simple Voice Chat', bundled: false, modId: 'mock-voicechat' } },
    bundled: { headline: 'Crashed — Sodium is the likely cause', detail: 'Sodium comes with BlueClient — nothing to remove. Retry, or open the log.',
      suspect: { id: 'sodium', name: 'Sodium', bundled: true, modId: null } },
    companion: { headline: "Crashed — BlueClient's in-game mod is the likely cause", detail: "BlueClient's own mod, not one you added. Retry, or open the log.",
      suspect: { id: 'blueclient', name: "BlueClient's in-game mod", bundled: true, modId: null } },
    dropped: { headline: 'Crashed — Create is the likely cause', detail: "Create is in the mods folder but not in BlueClient's list. Take it out by hand.",
      suspect: { id: 'create', name: 'Create', bundled: false, modId: null } },
    memory: { headline: 'Crashed — out of memory', detail: 'Minecraft used up the 4.0 GB it was given.' },
    heap: { headline: 'Crashed — this PC could not give Minecraft 8.0 GB', detail: 'Windows needs some of the memory too. Give Minecraft less.' },
    java: { headline: "Crashed — Minecraft's Java crashed", detail: 'Java fell over in the NVIDIA graphics driver (nvoglv64.dll). NVIDIA driver 531.41 is installed and is 3 years old — a current driver ends most of these.',
      driver: { vendor: 'nvidia', version: '531.41', page: 'https://www.nvidia.com/en-us/drivers/' } },
    hang: { headline: 'Crashed — Minecraft stopped responding', detail: 'It stopped answering for more than ten seconds while closing.' },
    // Closed as "not responding" (2026-09-20): Windows' word, no report; the
    // heap line and its Less memory button when the heap was most of the PC.
    killed: { headline: 'Closed — Minecraft stopped responding', detail: 'It froze for so long that Windows offered to close it, and it was closed. With 190 added mods, the first minute in a world is the heaviest; if it keeps happening, fewer mods is the test.' },
    killedMemory: { headline: 'Closed — Minecraft stopped responding', detail: "It froze for so long that Windows offered to close it, and it was closed. Minecraft was given 7.0 GB of this PC's 8.0 GB — Windows had little left, and a PC out of memory freezes. Give Minecraft less.", memoryHigh: true },
    // The same, with the companion's stall note read (2026-09-21): where it
    // stood — an added mod (with its Remove, like a crash inside it), or a
    // driver call (with the driver line and its button).
    frozen: { headline: 'Closed — Minecraft stopped responding', detail: 'It froze inside Simple Voice Chat (ClientVoicechat.tick) for so long that Windows offered to close it, and it was closed. Removing Simple Voice Chat is the quickest test.',
      suspect: { id: 'voicechat', name: 'Simple Voice Chat', bundled: false, modId: 'mock-voicechat' } },
    frozenDriver: { headline: 'Closed — Minecraft stopped responding', detail: 'It froze inside the graphics driver (GL32C.glClientWaitSync, asked by Sodium) for so long that Windows offered to close it, and it was closed. NVIDIA driver 531.41 is installed and is 3 years old — a current driver ends most of these.',
      driver: { vendor: 'nvidia', version: '531.41', page: 'https://www.nvidia.com/en-us/drivers/' } },
    fault: { headline: "Crashed — Minecraft's Java crashed", detail: 'Java fell over outside its own code, with no report — nearly always the NVIDIA graphics driver. NVIDIA driver 531.41 is installed and is 3 years old — a current driver ends most of these.',
      driver: { vendor: 'nvidia', version: '531.41', page: 'https://www.nvidia.com/en-us/drivers/' } },
    files: { headline: 'Crashed — a game file was missing', detail: 'Retry downloads it again.' },
    javaVersion: { headline: 'Crashed — this Minecraft needs a newer Java', detail: 'The Java set in Settings → Game is too old for it.', customJava: true },
    runtime: { headline: "Crashed — Java's files were incomplete", detail: 'Retry repairs Java and tries again.' },
    unknown: { headline: 'Crashed — see the log', detail: 'java.lang.NullPointerException: Cannot invoke "net.minecraft.class_1937.method_8320(net.minecraft.class_2338)" because "world" is null' }
  };

  /* The admin site's list, in the shape api.blueclient.net/api/servers answers
     (read on 2026-09-11), so Home draws the real rows here. Set
     `host.servers.list` and `.refresh` to `async () => null` from the console
     to see the typed fallback stand in. */
  const LISTING = {
    categories: ['Economy', 'PvP', 'Survival', 'Lifesteal', 'Skyblock'],
    servers: [
      { name: 'BlueMC', address: 'bluemc.org', category: 'Economy', about: 'Economy SMP' },
      { name: 'MCPvP', address: 'mcpvp.com', category: 'PvP', about: 'PvP' },
      { name: 'DonutSMP', address: 'donutsmp.net', category: 'Economy', about: 'Lifesteal SMP' },
      { name: 'BananaSMP', address: 'bananasmp.net', category: 'Lifesteal', about: 'Lifesteal SMP' },
      { name: 'Hypixel', address: 'hypixel.net', category: 'Skyblock', about: 'Hypixel SkyBlock and minigames' },
      { name: 'BreezeVanilla', address: 'breezevanilla.eu', category: 'Economy', about: '' },
      { name: 'Straindez', address: 'straindez.net', category: 'Lifesteal', about: '' },
      { name: 'OPBlocks', address: 'opblocks.com', category: 'Skyblock', about: '' },
      { name: 'CrystalChaos', address: 'crystalchaos.net', category: 'Economy', about: '' },
      { name: 'BagelSMP', address: 'bagelsmp.com', category: 'Survival', about: '' },
      { name: 'EvokeSMP', address: 'evokesmp.net', category: 'Economy', about: '' }
    ],
    at: Date.now()
  };
  const serversOffline = () => {
    try { return localStorage.getItem('beam.servers') === 'offline'; } catch { return false; }
  };

  return {
    __mock: true,

    window: {
      minimize: () => {},
      toggleMaximize: () => {},
      close: () => {},
      isMaximized: async () => false,
      onStateChange: on('window')
    },

    settings: {
      get: async () => structuredClone(settings),
      merge: async (patch) => { settings = deepMerge(settings, patch); persist(); return structuredClone(settings); },
      reset: async () => { settings = mockDefaults(); persist(); return structuredClone(settings); },
      /* Settings sync between profiles (2026-09-17): the map, kept here for
         the dev server the way everything else is. */
      groups: async () => ({ ...groups }),
      link: async (profileId, targetId) => {
        const group = groups[targetId] || `_sync-${targetId}`;
        groups[targetId] = group;
        groups[profileId] = group;
        return { ok: true, group, groups: { ...groups } };
      },
      leave: async (profileId) => {
        const group = groups[profileId];
        delete groups[profileId];
        const left = Object.keys(groups).filter((id) => groups[id] === group);
        if (left.length < 2) for (const id of left) delete groups[id];
        return { ok: true, groups: { ...groups } };
      }
    },

    system: {
      info: async () => ({
        platform: 'win32',
        arch: 'x64',
        totalMemoryMb: 16384,
        suggestedMemoryMb: 4096,
        cpu: 'Preview (browser)',
        // No package.json to read out here, and a number invented in the
        // browser is a number that will one day disagree with the real one.
        appVersion: 'preview',
        electron: 'preview',
        defaultGameDirectory: 'C:\\Users\\You\\AppData\\Roaming\\.minecraft'
      })
    },

    shell: {
      pickDirectory: async () => 'C:\\Users\\You\\BlueClient\\instances',
      pickJava: async () => 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe',
      openPath: async () => true,
      openExternal: async (url) => { window.open(url, '_blank', 'noopener'); return true; }
    },

    /* No game has saved a clip into a browser tab; the page shows its empty state. */
    /* Two places, so the Continue control on Home can be designed in a
       browser. A server first, because that is the branch with a button. */
    ledger: {
      /* Seven places in the proportions of Adrian's own ledger (2026-09-10),
         so the preview draws Your play the way his launcher does — one place
         with nearly all the hours, a "more" row, and the card at its limit. */
      recent: async () => [
        ['server', 'bluemc.org', 1543.5, 920, 24],
        ['server', 'donutsmp.net', 27.3, 55, 3],
        ['world', 'New World', 1.1, 2, 9],
        ['world', 'New World', 0.1, 0, 1],
        ['server', 'mcpvp.club', 0.07, 0, 3],
        ['server', 'breezevanilla.eu', 0.02, 0, 2],
        ['server', '7adrian.crystalchaos.net', 0.01, 0, 1]
      ].map(([kind, name, hours, deaths, sessions], i) => ({
        id: `${kind}:${name}:${i}`, kind, name, sessions, deaths,
        playedMs: Math.round(hours * 3600e3),
        lastSeen: Date.now() - (i + 1) * 3600e3, firstSeen: Date.now() - 40 * 86400e3,
        stats: { mobKills: 252, playerKills: 109, damageDealt: 94663, damageTaken: 256604,
                 jumps: 249007, walkCm: 14649033, sprintCm: 21140147 }
      })),

      /* The last seven days with a couple of empty ones and one long evening,
         each day carrying its places and sittings, so the chart, the day
         detail, the streak and the records can all be designed against
         something other than a flat row. Today is the last bucket and moves
         with the clock the way the real one does. */
      summary: async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const at = (i) => { const d = new Date(today); d.setDate(d.getDate() + i - 6); return d.getTime(); };
        const PLACES = {
          blue: { id: 'server:bluemc.org', kind: 'server', name: 'bluemc.org' },
          donut: { id: 'server:donutsmp.net', kind: 'server', name: 'donutsmp.net' },
          world: { id: 'world:New World:250310b', kind: 'world', name: 'New World' },
          pvp: { id: 'server:mcpvp.club', kind: 'server', name: 'mcpvp.club' }
        };
        /* [hour of day, minutes, place, gained] per sitting, per day. */
        const plan = [
          [[19.5, 84, 'blue', { mobKills: 4, walkCm: 41729, sprintCm: 40228, jumps: 909 }], [21, 54, 'donut', { damageTaken: 300 }]],
          [],
          [[16, 27, 'world', { jumps: 112, walkCm: 4896, sprintCm: 6697 }], [17, 60, 'blue', { mobKills: 9, playerKills: 3, damageDealt: 1110, damageTaken: 1408 }]],
          [[15.25, 15, 'pvp', { playerKills: 6 }], [15.5, 122, 'blue', { mobKills: 21, walkCm: 302118, sprintCm: 51000 }], [18, 115, 'blue', { mobKills: 7 }]],
          [[20, 36, 'donut', { jumps: 33 }]],
          [],
          [[9, 47, 'blue', { mobKills: 2, walkCm: 2541 }], [10.5, 12, 'world', { jumps: 4 }]]
        ];
        const days = plan.map((sittings, i) => {
          const start = at(i);
          const rows = sittings.map(([hour, mins, key, gained]) => ({
            start: start + hour * 3600e3, ms: mins * 60e3, place: PLACES[key], gained
          }));
          const places = new Map();
          const gained = {};
          for (const row of rows) {
            const slot = places.get(row.place.id) || { ...row.place, ms: 0 };
            slot.ms += row.ms;
            places.set(row.place.id, slot);
            for (const [k, v] of Object.entries(row.gained)) gained[k] = (gained[k] || 0) + v;
          }
          return {
            start,
            ms: rows.reduce((sum, row) => sum + row.ms, 0),
            places: [...places.values()].sort((x, y) => y.ms - x.ms),
            sittings: rows,
            gained
          };
        });
        return {
          from: at(0), to: at(7), today: today.getTime(), days,
          playedMs: days.reduce((sum, d) => sum + d.ms, 0),
          previousMs: 6.4 * 3600e3,
          streak: { days: 3, best: 5, alive: true },
          records: {
            longestDay: { start: at(3), ms: days[3].ms },
            longestSitting: { start: at(3) + 15.5 * 3600e3, ms: 122 * 60e3, place: PLACES.blue },
            activeDays: 23
          }
        };
      },
      /* A browser tab cannot photograph itself onto the clipboard. */
      snapshot: async () => false
    },

    clips: {
      list: async () => ({
        folder: 'C:\\Users\\You\\Videos\\BlueClient Clips',
        clips: media.clips.map((clip) => ({ ...clip, favourite: favourites.clips.includes(clip.name) }))
      }),
      open: async () => true,
      reveal: async () => true,
      folder: async () => true,
      copy: async () => false,
      remove: async (name) => { media.clips = media.clips.filter((clip) => clip.name !== name); return true; },
      favourite: async (name, on) => favourite('clips', name, on),
      onStill: () => () => {}
    },

    shots: {
      list: async () => ({
        shots: media.shots.map((shot) => ({ ...shot, favourite: favourites.shots.includes(shot.id) }))
      }),
      open: async () => true,
      reveal: async () => true,
      folder: async () => true,
      copy: async () => false,
      remove: async (id) => { media.shots = media.shots.filter((shot) => shot.id !== id); return true; },
      favourite: async (id, on) => favourite('shots', id, on)
    },

    /* Outside Electron there is no main process to proxy the request, and
       the page CSP blocks a direct call, so preview mode says so plainly
       rather than failing with a console error. */
    modrinth: {
      search: async () => ({ ok: false, error: 'Mod search needs the desktop app.' }),
      icon: async () => ({ ok: false }),
      project: async () => ({ ok: false })
    },
    packs: {
      list: async () => ({ ok: true, folder: 'C:\Users\You\AppData\Roaming\BlueClient\instances\profile\resourcepacks', packs: [] }),
      add: async () => ({ ok: false, error: 'Adding a pack needs the desktop app.' }),
      remove: async () => ({ ok: true }),
      toggle: async (_file, on) => ({ ok: true, enabled: on }),
      folder: async () => true
    },

    /* The jars the launcher did not put there (2026-09-19): two per profile
       — one on, one already off by its `.jar.disabled` name — so the Mods
       page's local cards can be designed without Electron. Toggle renames
       within this list and remove takes from it, answering the shape main
       would, so the page can be driven from here as it would be for real. */
    mods: (() => {
      const byProfile = new Map();
      const seeded = (profileId) => {
        if (!byProfile.has(profileId)) {
          byProfile.set(profileId, [
            {
              file: 'modmenu-11.0.3+1.21.4.jar', name: 'Mod Menu', version: '11.0.3+1.21.4',
              description: 'Adds a mod menu to view the list of mods you have installed.',
              author: 'Prospector, TerraformersMC', icon: '', read: true, enabled: true, size: 655 * 1024
            },
            {
              file: 'malilib-fabric-1.21.4-0.23.1.jar.disabled', name: 'MaLiLib', version: '0.23.1',
              description: 'A library mod required by masa\'s client-side mods.',
              author: 'masa', icon: '', read: true, enabled: false, size: 1360 * 1024
            }
          ]);
        }
        return byProfile.get(profileId);
      };
      const running = (profileId) => [...sessions.values()].some((s) => s.profileId === profileId);
      return {
        local: async (profileId) => ({ ok: true, mods: seeded(profileId).map((m) => ({ ...m })) }),
        // In the browser every mod has a build; Krypton stands in for the one
        // that has none on a year-numbered game, so the card's note can be seen.
        availability: async (profileId) => ({ ok: true, version: 'mock', none: ['krypton'], unknown: [] }),
        localToggle: async (profileId, file, on) => {
          if (running(profileId)) return { ok: false, running: true };
          const mod = seeded(profileId).find((m) => m.file === file);
          if (!mod) return { ok: false, error: 'bad name' };
          const base = mod.file.replace(/\.disabled$/, '');
          mod.file = on ? base : `${base}.disabled`;
          mod.enabled = Boolean(on);
          return { ok: true, file: mod.file, enabled: mod.enabled };
        },
        localRemove: async (profileId, file) => {
          if (running(profileId)) return { ok: false, running: true };
          byProfile.set(profileId, seeded(profileId).filter((m) => m.file !== file));
          return { ok: true };
        },
        folder: async () => ({ ok: true })
      };
    })(),
    servers: {
      /* The preview cannot open sockets, so every row keeps its dash. */
      status: async () => ({}),
      /* `localStorage.setItem('beam.servers', 'offline')` and reload: a first
         run with no network and nothing cached — the typed list stands in. */
      list: async () => (serversOffline() ? null : { ...LISTING, source: 'cache' }),
      refresh: async () => (serversOffline() ? null : { ...LISTING, source: 'live' }),
      /* No socket and no fetch from a browser tab: every row keeps its stand-in. */
      icon: async () => null
    },

    /* Worlds (2026-09-11): three fixed worlds and two "elsewhere" ones, so
       every group on the page — current profile, other profiles (one of them
       a leftover from a profile that no longer exists, on purpose), and other
       launchers — can be designed without Electron. `firstId` is read at CALL
       time rather than baked in at mock creation, because state.js has not
       seeded a profile yet when this file first runs; by the time the Worlds
       page asks, it has. Backup, restore, remove and bring all edit this same
       list and answer the shape main would, so the page can be driven from
       here exactly as it would be for real. */
    worlds: (() => {
      let data = null;
      const GONE_ID = 'previewgone1';

      const seeded = () => {
        if (data) return data;
        const now = Date.now();
        const day = 86400e3;
        const firstId = settings.profiles?.[0]?.id || 'preview';
        data = {
          worlds: [
            {
              profileId: firstId, folder: 'New World', path: 'C:\\instances\\' + firstId + '\\saves\\New World',
              name: 'New World', version: '1.21.8', lastPlayed: now - 3 * 3600e3,
              gameMode: 'survival', hardcore: false, icon: 'assets/art/backdrop.jpg',
              backup: { when: now - 3 * 3600e3, bytes: 118 * 1024 * 1024, count: 3 }
            },
            {
              profileId: firstId, folder: 'Creative Flat', path: 'C:\\instances\\' + firstId + '\\saves\\Creative Flat',
              name: 'Creative Flat', version: '1.21.8', lastPlayed: now - 6 * day,
              gameMode: 'creative', hardcore: false, icon: null, backup: null
            },
            {
              // A world under a profile id nothing in `settings.profiles` owns —
              // exactly what a profile deleted while its game was running
              // leaves behind. Exercises "Your other profiles" with only
              // Bring it here on it, with no console override needed.
              profileId: GONE_ID, folder: 'Old Base', path: 'C:\\instances\\' + GONE_ID + '\\saves\\Old Base',
              name: 'Old Base', version: '1.21.4', lastPlayed: now - 40 * day,
              gameMode: 'survival', hardcore: true, icon: null,
              backup: { when: now - 40 * day, bytes: 640 * 1024 * 1024, count: 1 }
            }
          ],
          elsewhere: [
            {
              source: 'Lunar Client', dir: 'C:\\Users\\You\\.lunarclient\\offline\\multiver',
              folder: 'Skyblock', path: 'C:\\Users\\You\\.lunarclient\\offline\\multiver\\saves\\Skyblock',
              name: 'Skyblock', version: '1.8.9', lastPlayed: now - 9 * day,
              gameMode: 'survival', hardcore: false, icon: null
            },
            {
              source: 'the Minecraft launcher', dir: 'C:\\Users\\You\\AppData\\Roaming\\.minecraft',
              folder: 'Hardcore World', path: 'C:\\Users\\You\\AppData\\Roaming\\.minecraft\\saves\\Hardcore World',
              name: 'Hardcore World', version: '1.21.1', lastPlayed: now - 70 * day,
              gameMode: 'survival', hardcore: true, icon: null
            }
          ]
        };
        return data;
      };

      const find = (profileId, folder) => seeded().worlds.find((w) => w.profileId === profileId && w.folder === folder) || null;
      const running = (profileId) => [...sessions.values()].some((s) => s.profileId === profileId);

      return {
        list: async () => {
          const s = seeded();
          return { ok: true, worlds: s.worlds.map((w) => ({ ...w })), elsewhere: s.elsewhere.map((e) => ({ ...e })) };
        },
        size: async (profileId, folder) => {
          await sleep(450);
          const seed = [...`${profileId}${folder}`].reduce((n, c) => n + c.charCodeAt(0), 0);
          return { ok: true, bytes: 24 * 1024 * 1024 + (seed % 40) * 3 * 1024 * 1024, files: 140 + (seed % 60) };
        },
        backup: async (profileId, folder) => {
          if (running(profileId)) return { ok: false, running: true };
          const world = find(profileId, folder);
          if (!world) return { ok: false, error: 'not a world' };
          await sleep(650);
          const when = Date.now();
          const bytes = 20 * 1024 * 1024 + Math.round(Math.random() * 40 * 1024 * 1024);
          world.backup = { when, bytes, count: Math.min(3, (world.backup?.count || 0) + 1) };
          return { ok: true, file: `${world.path}.zip`, name: 'backup.zip', bytes, when, kept: world.backup.count };
        },
        backups: async (profileId, folder) => {
          const world = find(profileId, folder);
          if (!world?.backup) return { ok: true, backups: [] };
          const rows = [];
          for (let i = 0; i < world.backup.count; i++) {
            rows.push({
              name: `backup-${i}.zip`,
              bytes: Math.max(1024 * 1024, world.backup.bytes - i * 2 * 1024 * 1024),
              when: world.backup.when - i * 6 * 3600e3
            });
          }
          return { ok: true, backups: rows };
        },
        restore: async (profileId, folder, name) => {
          if (running(profileId)) return { ok: false, running: true };
          if (!find(profileId, folder)) return { ok: false, error: 'not a world' };
          await sleep(500);
          return { ok: true, safety: 'safety.zip' };
        },
        remove: async (profileId, folder) => {
          if (running(profileId)) return { ok: false, running: true };
          const s = seeded();
          const before = s.worlds.length;
          s.worlds = s.worlds.filter((w) => !(w.profileId === profileId && w.folder === folder));
          return { ok: s.worlds.length < before };
        },
        open: async () => true,
        bring: async (profileId, path) => {
          const s = seeded();
          const source = s.elsewhere.find((e) => e.path === path) || s.worlds.find((w) => w.path === path);
          if (!source) return { ok: false, error: 'not a world the launcher knows' };
          let folder = source.folder;
          let n = 2;
          while (s.worlds.some((w) => w.profileId === profileId && w.folder === folder)) folder = `${source.folder} (${n++})`;
          s.worlds.unshift({
            profileId, folder, path: `C:\\instances\\${profileId}\\saves\\${folder}`,
            name: source.name, version: source.version, lastPlayed: Date.now(),
            gameMode: source.gameMode, hardcore: source.hardcore, icon: source.icon, backup: null
          });
          return { ok: true, folder, name: source.name };
        },
        onChanged: () => () => {}
      };
    })(),

    /* Preview mode falls back to the bundled skin. */
    /* Skins need Mojang and a file the browser cannot open, so the mock says
       so plainly rather than pretending three empty slots work. */
    skins: {
      get: async () => ({ ok: false }),
      slots: async () => [null, null, null],
      pick: async () => ({ ok: false, reason: 'Choosing a skin needs the desktop app.' }),
      wear: async () => ({ ok: false, reason: 'Changing your skin needs the desktop app.' }),
      variant: async () => ({ ok: true, slots: [null, null, null] }),
      clear: async () => ({ ok: true, slots: [null, null, null] }),
      find: async (query, mode) => ({ ok: false, kind: mode === 'look' ? 'look' : 'popular', results: [], reason: 'Browsing skins needs the desktop app.' }),
      keep: async () => ({ ok: false, reason: 'Keeping a skin needs the desktop app.' })
    },

    auth: {
      async signIn() {
        return { ok: false, error: 'Sign-in needs the desktop app.', code: 'no_host' };
      },
      async refresh() {
        return { ok: false, error: 'Sign-in needs the desktop app.', code: 'no_host' };
      },
      async configured() { return false; },
      onAccountsChanged: () => () => {}
    },

    /* Nothing to update in a browser tab. The shape is the real one so Home
       takes the same path it takes in the launcher — it just never leaves the
       state where there is nothing to say. */
    update: {
      async check() { return { phase: 'idle', version: null, percent: 0, url: null, notes: '' }; },
      async install() { return { ok: false }; },
      onState: () => () => {},
      async recheck() { return { ok: false }; },
      /* The What's-new capsule, drivable from the pane's console:
         `localStorage.setItem('beam.news', 'New in 0.18 — …')` and reload;
         pressing it, or leaving Home, clears the key the way the real one
         writes the line down as seen. */
      async news() {
        let line = '';
        let privacy = '';
        try {
          line = localStorage.getItem('beam.news') || '';
          privacy = localStorage.getItem('beam.privacySeen') || '';
        } catch { /* private mode */ }
        /* The player-count line first, once, as main does (2026-09-16);
           `localStorage.removeItem('beam.privacySeen')` brings it back. */
        if (!privacy) {
          return {
            line: 'BlueClient counts you as a player — an anonymous ping, nothing about you. Settings › About switches it off',
            route: 'settings',
            section: 'support'
          };
        }
        return line ? { line } : null;
      },
      async newsSeen() {
        try {
          if (!localStorage.getItem('beam.privacySeen')) localStorage.setItem('beam.privacySeen', '1');
          else localStorage.removeItem('beam.news');
        } catch { /* private mode */ }
        return { ok: true };
      }
    },

    game: {
      async launch(profile) {
        if (sessions.size >= 5) {
          return { ok: false, error: 'BlueClient runs up to 5 games at once. Close one to start another.' };
        }

        const id = `s${++seq}`;
        const account = settings.accounts?.list?.find((a) => a.id === settings.accounts.active);
        const session = {
          id,
          profileId: profile.id,
          name: profile.name,
          version: profile.version,
          loader: profile.loader,
          memoryMb: profile.memoryMb || null,
          join: profile.join || null,
          username: account?.username || 'Player',
          status: 'working',
          percent: 0,
          label: 'Preparing launch',
          startedAt: null,
          cancelled: false
        };
        sessions.set(id, session);

        const tag = { id, profile: { id: profile.id, name: profile.name } };
        emit('state', { ...tag, state: 'working', running: sessions.size });

        const total = STAGES.reduce((sum, s) => sum + s[1], 0);
        let done = 0;

        for (const [label, weight, ms] of STAGES) {
          const steps = Math.max(4, Math.round(weight / 4));
          for (let i = 1; i <= steps; i++) {
            if (session.cancelled) {
              sessions.delete(id);
              emit('state', { ...tag, state: 'idle', reason: 'cancelled', running: sessions.size });
              return { ok: false, cancelled: true };
            }
            await sleep(ms / steps);
            session.percent = Math.round(((done + (weight * i) / steps) / total) * 1000) / 10;
            session.label = label;
            emit('progress', { ...tag, percent: session.percent, label });
          }
          done += weight;
        }

        session.status = 'playing';
        session.startedAt = Date.now();
        session.percent = 100;
        session.label = 'Launched';
        emit('state', { ...tag, state: 'playing', startedAt: session.startedAt, running: sessions.size });
        emit('progress', { ...tag, percent: 100, label: 'Launched' });
        return { ok: true, sessionId: id };
      },
      cancel: async (id) => {
        const session = sessions.get(id);
        if (session) session.cancelled = true;
        return { ok: Boolean(session) };
      },
      stop: async (id) => {
        const session = sessions.get(id);
        if (!session) return { ok: false };
        if (session.status === 'working') { session.cancelled = true; return { ok: true }; }
        sessions.delete(id);
        emit('state', {
          id,
          profile: { id: session.profileId, name: session.name },
          state: 'idle',
          running: sessions.size
        });
        return { ok: true };
      },
      sessions: async () => [...sessions.values()].map(({ cancelled, ...rest }) => rest),
      /* The crashes still on their rows; see CRASH_KINDS above. */
      crashes: async () => [...crashes.values()],
      crashDismiss: async (id) => crashes.delete(id),
      crashOpen: async () => true,
      /* The chat logs' folder; a browser tab has none to open. */
      chatLogs: async () => true,
      /* Design-time only: end a mock session the way a crashed game does.
         `host.game.__crash('s1', 'mod')` from the pane's console. */
      __crash: async (id, kind = 'mod') => {
        const session = sessions.get(id);
        const shape = CRASH_KINDS[kind] || CRASH_KINDS.unknown;
        /* Main names the profile's own entry for a removable suspect; here it
           is the first mod on the profile that is not the bundled stack — add
           one on the Mods page (or state.addMod from the console) to see the
           Remove button. Without one the row says the honest thing: nothing
           on the list to remove. */
        let suspect = shape.suspect || null;
        let { headline, detail } = shape;
        if (suspect && !suspect.bundled && suspect.modId) {
          const stack = ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'krypton', 'dynamic-fps', 'iris', 'lambdynamiclights', 'no-chat-reports', 'mcpvp.com-tier-tagger', 'moreculling', 'badoptimizations'];
          const own = (settings.profiles || []).find((p) => p.id === session?.profileId)?.mods?.find((m) => !stack.includes(m.slug));
          suspect = own ? { ...suspect, name: own.name, modId: own.id } : { ...suspect, modId: null };
          if (kind === 'frozen') {
            detail = own
              ? `It froze inside ${own.name} (ClientVoicechat.tick) for so long that Windows offered to close it, and it was closed. Removing ${own.name} is the quickest test.`
              : `It froze inside ${suspect.name} (ClientVoicechat.tick) for so long that Windows offered to close it, and it was closed. ${suspect.name} is in the mods folder but not in BlueClient's list. Take it out by hand.`;
          } else {
            headline = `Crashed — ${suspect.name} is the likely cause`;
            detail = own
              ? `${own.name} was added to this profile. Removing it is the quickest test.`
              : `${suspect.name} is in the mods folder but not in BlueClient's list. Take it out by hand.`;
          }
        }
        const record = {
          id,
          profileId: session?.profileId || null,
          name: session?.name || 'Profile',
          // Real crashes carry this from the account that ran the game, not
          // from the session row — see crashes.js's summary(), 2026-09-11.
          username: session?.username || null,
          join: session?.join || null,
          kind: kind === 'bundled' || kind === 'companion' || kind === 'dropped' ? 'mod'
            : kind === 'killed' || kind === 'killedMemory' || kind === 'frozen' || kind === 'frozenDriver' ? 'hang'
            : kind === 'fault' ? 'java' : kind,
          headline,
          detail,
          suspect,
          hasLog: true,
          hasReport: kind !== 'files' && kind !== 'javaVersion' && kind !== 'runtime'
            && kind !== 'killed' && kind !== 'killedMemory' && kind !== 'frozen' && kind !== 'frozenDriver' && kind !== 'fault',
          customJava: Boolean(shape.customJava),
          driver: shape.driver || null,
          memoryHigh: Boolean(shape.memoryHigh),
          ranMs: session?.startedAt ? Date.now() - session.startedAt : 0,
          code: -1,
          at: Date.now()
        };
        crashes.set(id, record);
        sessions.delete(id);
        emit('state', {
          id,
          profile: { id: record.profileId, name: record.name },
          state: 'idle',
          crashed: true,
          crash: record,
          error: record.headline,
          running: sessions.size
        });
        return record;
      },
      versions: async () => ({ ok: false, error: 'No launcher process in the browser.' }),
      // The design copy runs on the version the mod is actually built for.
      /* What the shipped jars cover today, so the wall's "plain Minecraft"
         line can be seen in a browser tab (2026-09-16); it claimed every
         version before, which hid the line. Widen when a jar is added. */
      companion: async (versions) => ({
        ranges: [],
        versions: (versions || []).filter((v) => /^1\.(20\.([5-9]|\d\d)|21(\.\d+)?)$/.test(v))
      }),
      newest: async () => null,
      /* Import profiles in a browser tab: three launchers' worth of rows, so
         the panel can be designed against a full list (2026-09-16). */
      importScan: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { ok: true, groups: [
          { launcher: 'lunar', label: 'Lunar Client', rows: [
            { key: 'lunar:1.21/fabric-1.21.11', kind: 'profile', name: '1.21 (Lunar)', version: '1.21.11', loader: 'fabric', imports: 'fabric', mods: 6, disabled: 0, leftBehind: 0, memoryMb: null, note: '' },
            { key: 'lunar:waypoints', kind: 'waypoints', name: 'Waypoints', count: 12, note: '12 waypoints across 3 worlds — into BlueClient’s own list' }
          ] },
          { launcher: 'dawn', label: 'Dawn (Feather)', rows: [
            { key: 'dawn:feather-default--1-21-11', kind: 'profile', name: 'Feather Default (1.21.11)', version: '1.21.11', loader: 'fabric', imports: 'fabric', mods: 9, disabled: 3, leftBehind: 0, memoryMb: 4096, note: '' },
            { key: 'dawn:dawn-performance', kind: 'profile', name: 'Dawn', version: '26.1.2', loader: 'fabric', imports: 'fabric', mods: 2, disabled: 0, leftBehind: 0, memoryMb: 4096, note: '' }
          ] },
          { launcher: 'curseforge', label: 'CurseForge', rows: [
            { key: 'curseforge:All the Mods 10', kind: 'profile', name: 'All the Mods 10', version: '1.21.1', loader: 'neoforge', imports: 'vanilla', mods: 0, disabled: 0, leftBehind: 412, memoryMb: 8192, note: 'Neoforge — BlueClient runs Fabric, so this comes over as plain Minecraft 1.21.1' }
          ] }
        ] };
      },
      importBring: async (keys, _options) => {
        await new Promise((r) => setTimeout(r, 900));
        const profiles = keys.filter((k) => k !== 'lunar:waypoints').map((k, i) => ({
          id: 'imp' + Date.now().toString(36) + i, name: k.split(':')[1].split('/')[0], icon: 'grass',
          version: /26/.test(k) ? '26.1.2' : '1.21.11', loader: /curseforge/.test(k) ? 'vanilla' : 'fabric', loaderVersion: '',
          memoryMb: null, lastPlayed: null, installed: false,
          mods: /curseforge/.test(k) ? [] : [{ id: 'm' + i, enabled: true, version: 'latest', source: 'modrinth', slug: 'modmenu', name: 'Mod Menu', author: '', description: '', iconUrl: '' }],
          imported: { from: k.split(':')[0], at: Date.now() }
        }));
        return { ok: true, profiles, matched: profiles.length, copied: 1, waypoints: keys.includes('lunar:waypoints') ? 12 : 0, leftBehind: keys.some((k) => /curseforge/.test(k)) ? 412 : 0 };
      },
      /* No disk in a browser tab: the folders are made-up sizes so the
         Storage page can be designed with something in its rows. */
      removeInstance: async () => ({ ok: true }),
      disk: async () => ({
        instances: settings.launcher.gameDirectory,
        root: 'C:\\Users\\You\\AppData\\Roaming\\.minecraft',
        profiles: Object.fromEntries((settings.profiles || []).map((p, i) => [p.id, (i + 1) * 213 * 1024 * 1024])),
        shared: 2.4 * 1024 * 1024,
        sharedSet: { servers: 27, from: ['the Minecraft launcher', 'Lunar Client'] },
        java: 312 * 1024 * 1024,
        mojang: 1.7 * 1024 ** 3
      }),
      onProgress: on('progress'),
      onWarning: on('warning'),
      onStateChange: on('state')
    }
  };
}

/* ---------------------------------------------------------------- export */

export const host = isElectron ? window.beam : createMock();
export const isPreview = !isElectron;
