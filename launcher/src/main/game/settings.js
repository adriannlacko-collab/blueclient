'use strict';

/**
 * A profile's settings are its own — unless it is synced with another profile.
 *
 * Until 2026-09-17 every profile borrowed one set (`<instances>/_shared`):
 * keybinds, video settings, the server list and the in-game half of this
 * client were the player's, not the profile's, and a second profile arrived
 * with the same list and the same mouse (Adrian, 2026-09-04). That evening he
 * asked for the other shape: "make a system that the ingame settings such as
 * keybinds etc is profile specific, and for every profile, you can choose to
 * sync settings with another profile" — take the other profile's settings as
 * the baseline, and from then on a change in either one shows up in both.
 *
 * So there are two kinds of profile now:
 *
 * - **On its own.** The game reads and writes the profile's folder, and
 *   nothing syncs. A profile that has never been played is *seeded* once at
 *   its first launch — from the set the player used most recently, or, on a
 *   PC with no BlueClient settings yet, from the other launchers on it — so
 *   the second profile still opens on a familiar Multiplayer screen; it is a
 *   copy, and after that the two go their own ways. The server list keeps
 *   taking new addresses from the other launchers on the PC, for every set.
 * - **Synced.** Two or more profiles share one *sync group*: a folder of
 *   their own, `<instances>/_sync-<id>`, that every member's launch borrows
 *   exactly the way `_shared` used to be borrowed by everyone — reconciled
 *   into the instance before the game starts, mirrored back while it runs,
 *   reconciled again when it exits. Joining a group *takes* the group's
 *   settings: the joiner's own are dropped and the group's copied in, which
 *   is the baseline Adrian asked for. Leaving keeps a copy of the group's
 *   settings as they stand and stops following them; a group left with one
 *   member is dissolved and that member simply owns what it has.
 *
 * Which profiles are in which group is `_shared/.groups.json`, main's own
 * record, read at every launch and answered to the renderer as a map.
 *
 * <h2>What `_shared` is now</h2>
 * The launcher-wide folder, holding what belongs to the player whichever
 * profile they play: the play record (`config/blueclient-stats.json` — one
 * ledger, one level, one set of capes, whatever profile the hours were
 * played on), the waypoints (`config/blueclient-waypoints.json` — a place you
 * marked is a place you went), the world backups and, since 2026-09-19, the
 * chat logs (`chatlogs/<day>.txt` — what was said is what you read, whichever
 * profile). The game writes the two records straight to those files — the
 * launcher tells it where in `blueclient.json` (`ledgerFile`, `waypointsFile`,
 * and `chatLogsDir` for the logs) — and they are `except`ed from the `config`
 * member so no sync carries a stale copy about. A launcher
 * from before this date kept everyone's settings in `_shared`; `migrate` moves
 * that set into a group of every profile that existed, so nobody's settings
 * split or change on the day this lands, and the two records into `_shared`.
 *
 * <h2>Two mirrors, not a master and a copy</h2>
 * A group's folder and a member's instance are two mirrors of one thing, and
 * a sync is a *reconcile* rather than an overwrite in one direction:
 *
 * - For an ordinary file — `options.txt`, the mod configs — the newer of the
 *   two wins. Every copy carries the original's modified time with it, so
 *   after a sync both sides read as the same age and the test stays stable.
 * - The **server list** is merged entry by entry, keyed on the address.
 * - Every sync records what each of the two sides was holding, and that record
 *   is what lets a **deletion** travel. Something on one side and missing from
 *   the other was *deleted* if the other side was last seen holding it, and is
 *   *new* if it was not. Without that record, deleting a server in one profile
 *   only had it handed straight back by the next profile that launched,
 *   forever.
 *
 * Copies rather than links because Minecraft saves `servers.dat` by writing a
 * temporary file and renaming it over the old one, which replaces a hard link
 * instead of writing through it. (Resource packs and shader packs are the
 * exception: nothing ever rewrites a pack in place, so those are hard-linked
 * where the filesystem allows it, and one copy on disk serves every profile.)
 *
 * <h2>The rest of the PC</h2>
 * An unclaimed set is filled in from whatever else is installed: the
 * `.minecraft` folder the official launcher, Lunar, Feather and Badlion all
 * share, and Prism/MultiMC/PolyMC, Modrinth, CurseForge, ATLauncher,
 * GDLauncher, Technic and XMCL instances. A game folder is recognised by what
 * is inside it — `options.txt`, `servers.dat`, `saves/` — rather than by
 * knowing each launcher's layout, so a launcher nobody here has heard of is
 * found too.
 *
 * - **Settings come over once**, and only while the set is *unclaimed*: the
 *   moment a BlueClient game writes to it, it is the player's, and no other
 *   launcher overwrites it again.
 * - **Servers keep coming.** Every launch re-reads those lists and folds in
 *   any address that was not there the last time we looked. A server added in
 *   the official launcher today is in BlueClient's list tonight — and a server
 *   the player deleted here does not come back, because it is on the watermark
 *   of things already taken.
 *
 * <h2>What it does not share</h2>
 * Worlds and mods stay with the profile, synced or not. That is the whole
 * point of profiles: a modded profile must not be able to break the one you
 * play on servers.
 *
 * <h2>Two games at once</h2>
 * Both borrow the same set and both write it back. The server list survives
 * both — it is merged, not copied — and for the rest the one that quits last
 * wins. Worth knowing, not worth locking: the alternative is a Play press that
 * waits on a game somebody is still playing.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const nbt = require('./nbt');
const { lane } = require('./lane');
const { writeFileAtomic } = require('./files');

/** The launcher-wide folder beside the profiles: the play record, the waypoints, the backups. */
const SHARED_DIR = '_shared';

/** A sync group's folder is `_sync-<id>`; the folder name is the group's id. */
const GROUP_PREFIX = '_sync-';

/** Which profile is in which group, inside `_shared`. */
const GROUPS_FILE = '.groups.json';

/** What the two mirrors know about each other, inside a set's folder. */
const STATE_FILE = '.sync.json';

/**
 * The two records that stay launcher-wide whatever the profile: the game
 * writes them where `blueclient.json` says (see `stampFlags`), and no set
 * carries a copy.
 */
const RECORDS = ['blueclient-stats.json', 'blueclient-waypoints.json'];

/** Two stamps this close together are the same file; see `stampsMatch`. */
const SLOP_MS = 1;

/**
 * How many paths of one member the record will hold.
 *
 * The record names every file the two sides agreed on, which is what lets a
 * deletion travel — and for `config`, or a folder of pack zips, that is a few
 * dozen names. An unzipped resource pack is thousands, and none of them is
 * worth a line in a JSON file that is read on every launch. Past the cap the
 * member simply goes unrecorded: it still syncs, deletions in it just do not
 * travel until it is under the cap again.
 */
const RECORD_CAP = 4000;

/**
 * What a set is made of.
 *
 * `options.txt` is the game's own settings — keys, sensitivity, video, sound.
 * `servers.dat` is the Multiplayer screen. `config` is where the mods keep
 * theirs, so Sodium's video settings, Iris's shader choice and the whole
 * in-game half of this client (`config/blueclient.json`: every module, the HUD
 * layout, the presets and the music) come with it — but not the play record
 * or the waypoints, which are the player's whichever profile they are on (see
 * RECORDS). `optionsshaders.txt` is OptiFine's shader choice, for a player who
 * brought one over.
 *
 * `resourcepacks` and `shaderpacks` are here because the settings that *name*
 * them already are: an `options.txt` asking for `bare-bones.zip` in a folder
 * that has not got it drops the pack — and then writes the shortened list back
 * over the set, losing it everywhere. A pack has to travel with the line that
 * asks for it. `.packs.json` is what the Mods page remembers about each pack
 * (name, author, icon), and belongs with the packs it describes.
 *
 * - `own` — never taken from another launcher. Somebody's packs folder can be
 *   gigabytes, and importing it uninvited is not a favour. (Import profiles,
 *   where the player asked for that launcher's settings by name, takes them —
 *   `takeFrom` with `packs`.)
 * - `link` — hard-linked into the profile where the filesystem allows it, so
 *   five profiles holding the same 400MB pack cost 400MB. Safe only because a
 *   pack is read, never rewritten in place.
 * - `except` — names at the top of the folder that must not travel: what the
 *   launcher itself writes into the profile (`shaderpack.js` puts Photon there
 *   on every launch), and the two launcher-wide records.
 */
const MEMBERS = [
  { name: 'options.txt', kind: 'file' },
  { name: 'servers.dat', kind: 'servers' },
  { name: 'optionsshaders.txt', kind: 'file' },
  { name: '.packs.json', kind: 'file', own: true },
  { name: 'config', kind: 'tree', except: RECORDS },
  { name: 'resourcepacks', kind: 'tree', own: true, link: true },
  { name: 'shaderpacks', kind: 'tree', own: true, link: true, except: ['BlueClient-Photon'] }
];

/* ---------------------------------------------------------------- basics */

async function exists(target) {
  try {
    await fsp.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function statOf(file) {
  return fsp.stat(file).catch(() => null);
}

/** A file as this module passes it around: where it is, how big, how old. */
function entryOf(full, stat) {
  return { full, size: stat.size, mtimeMs: stat.mtimeMs, atime: stat.atime, mtime: stat.mtime };
}

async function readIfPresent(file) {
  try {
    return await fsp.readFile(file);
  } catch {
    return null;
  }
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * True when two files are byte for byte the same thing.
 *
 * Every copy this module makes carries the original's modified time over with
 * it, and that is what makes the test exact rather than a guess: a destination
 * with the same size and the same stamp is what would be written, so writing
 * it is work with no outcome. Without this, borrowing the shared settings
 * copied the whole `config` tree into the instance on every launch, and the
 * mirror that runs while the game is up copied it back every time a slider
 * moved.
 */
function stampsMatch(a, b) {
  return Boolean(a && b) && a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < SLOP_MS;
}

/**
 * Put one file where the other one is, keeping its stamp.
 *
 * `link` asks for a hard link first: one copy on disk, seen from both places.
 * That fails across volumes and on filesystems without links, and a copy is
 * always a correct answer, so the failure is not worth reporting.
 */
async function place(from, to, { link = false } = {}) {
  await fsp.mkdir(path.dirname(to), { recursive: true });

  if (link) {
    await fsp.rm(to, { force: true }).catch(() => {});
    try {
      await fsp.link(from.full, to);
      return true;
    } catch {
      /* different volume, or a filesystem without links — copy instead */
    }
  }

  await fsp.copyFile(from.full, to);
  // Losing the stamp only costs one redundant copy next time, so a filesystem
  // that will not set it is not worth failing over.
  await fsp.utimes(to, from.atime, from.mtime).catch(() => {});
  return true;
}

/** Every file under a folder, keyed by its path inside it. */
async function scanTree(root, except = [], base = root, out = new Map()) {
  let children;
  try {
    children = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const child of children) {
    // `except` names things at the top of the folder, not everywhere in it.
    if (root === base && except.includes(child.name)) continue;

    const full = path.join(root, child.name);
    // readdir reports a symlink as a link, not as what it points at, so a link
    // to a folder would come through here as a file. Ask what it really is.
    let directory = child.isDirectory();
    if (!directory && child.isSymbolicLink()) {
      const real = await statOf(full);
      directory = Boolean(real && real.isDirectory());
    }
    if (directory) {
      await scanTree(full, except, base, out);
      continue;
    }

    const stat = await statOf(full);
    if (!stat) continue;
    out.set(path.relative(base, full).split(path.sep).join('/'), entryOf(full, stat));
  }
  return out;
}

/* ----------------------------------------------------------- the record */

/**
 * What each mirror was holding last time, and what has already been taken from
 * the other launchers on this PC.
 *
 * One small JSON file inside a set's folder — a group's, or a lone profile's
 * own. It is not a member, so it never travels.
 *
 * - `claimed` — has a BlueClient game ever written to this set? Until one has,
 *   the settings on the rest of the PC are still allowed to fill it in.
 * - `imports` — per foreign game folder, the stamp of the `servers.dat` we
 *   last read and every address we have taken from it. Both halves matter: the
 *   stamp makes the check free on a launch where nothing has changed, and the
 *   addresses are what stop a server the player deleted here from being
 *   imported all over again.
 * - `instances` — per member of a group, what that profile and the group were
 *   each holding at the end of the last sync, kept as two sides rather than
 *   one agreed list (see `baseFor`). This is the only reason a deletion can
 *   travel. A lone profile has no mirror and keeps none.
 */
function emptyState() {
  return { version: 1, claimed: false, imports: {}, instances: {} };
}

async function loadState(setDir) {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(setDir, STATE_FILE), 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('not a record');
    return {
      version: 1,
      claimed: Boolean(parsed.claimed),
      imports: parsed.imports && typeof parsed.imports === 'object' ? parsed.imports : {},
      instances: parsed.instances && typeof parsed.instances === 'object' ? parsed.instances : {}
    };
  } catch {
    const state = emptyState();
    /* No record, but settings already sitting there: a profile that has been
       played, or a set from before the record existed, and it is already the
       player's. Only a set with nothing in it is unclaimed. */
    state.claimed = (await exists(path.join(setDir, 'options.txt')))
      || (await exists(path.join(setDir, 'servers.dat')));
    return state;
  }
}

async function saveState(setDir, state) {
  const file = path.join(setDir, STATE_FILE);
  const temp = `${file}.part`;
  try {
    await fsp.mkdir(setDir, { recursive: true });
    await fsp.writeFile(temp, JSON.stringify(state, null, 2));
    await fsp.rename(temp, file);
  } catch {
    // A record that cannot be written costs deletions their ride, not the
    // launch: everything else behaves exactly as it did before it existed.
  }
}

/**
 * What each side held at the end of the last sync, for one profile.
 *
 * Two sides, not one agreed list, and the difference is the whole of how a
 * deletion is told from an addition. The mirror that runs during a session
 * writes the shared set without writing the profile, so the two are routinely
 * *not* the same — and with one list to compare against, a server added and
 * then deleted in the same session read as a server somebody else had just
 * added, and could never be got rid of. Each side is measured against what the
 * other one was last seen holding.
 *
 * A profile we have never synced has neither, so nothing counts as deleted and
 * the first sync is the plain union it always used to be.
 */
function sideSets(value) {
  return {
    local: new Set(Array.isArray(value?.local) ? value.local : []),
    shared: new Set(Array.isArray(value?.shared) ? value.shared : [])
  };
}

function baseFor(state, id) {
  const entry = state.instances[id];
  return {
    servers: sideSets(entry?.servers),
    files: new Map(Object.entries(entry?.files || {}).map(([name, sides]) => [name, sideSets(sides)]))
  };
}

/** The two sides of a member as they stand now, for the record. */
function bothSides(local, shared) {
  return { local: [...local], shared: [...shared] };
}

/* ----------------------------------------------------------- the groups */

/**
 * Which profiles are synced with which: `{ "<group>": ["<profileId>", …] }`,
 * the group named by its folder. Read at every launch, so a group nobody is
 * in any more is dropped as it is read.
 */
async function loadGroups(instances) {
  const file = path.join(instances, SHARED_DIR, GROUPS_FILE);
  let parsed = null;
  try {
    parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    parsed = null;
  }
  const groups = {};
  const seen = new Set();
  const table = parsed && parsed.groups && typeof parsed.groups === 'object' ? parsed.groups : {};
  for (const [id, members] of Object.entries(table)) {
    if (!isGroupId(id) || !Array.isArray(members)) continue;
    const list = members.filter((m) => typeof m === 'string' && /^[a-z0-9]+$/i.test(m) && !seen.has(m));
    for (const m of list) seen.add(m);
    if (list.length) groups[id] = list;
  }
  return { version: 1, migrated: Boolean(parsed && parsed.migrated), groups };
}

async function saveGroups(instances, record) {
  const dir = path.join(instances, SHARED_DIR);
  const file = path.join(dir, GROUPS_FILE);
  const temp = `${file}.part`;
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(temp, JSON.stringify({ version: 1, migrated: record.migrated, groups: record.groups }, null, 2));
  await fsp.rename(temp, file);
}

function isGroupId(id) {
  return typeof id === 'string' && id.startsWith(GROUP_PREFIX) && /^[a-z0-9_-]+$/i.test(id);
}

function groupIn(record, profileId) {
  for (const [id, members] of Object.entries(record.groups)) {
    if (members.includes(profileId)) return id;
  }
  return null;
}

/** The group this profile is in, or null when its settings are its own. */
async function groupOf(instances, profileId) {
  return groupIn(await loadGroups(instances), profileId);
}

/** Profile id → group id, for every profile that is in one. What the renderer shows. */
async function groups(instances) {
  const record = await loadGroups(instances);
  const out = {};
  for (const [id, members] of Object.entries(record.groups)) {
    for (const m of members) out[m] = id;
  }
  return out;
}

/** The folder a profile's settings live in: its own, or its group's. */
function homeFor(instances, profileId, group) {
  return path.join(instances, group || profileId);
}

async function homeOf(instances, profileId) {
  return homeFor(instances, profileId, await groupOf(instances, profileId));
}

/* ------------------------------------------------------- where to look */

/**
 * Every folder on this PC that might be the root of somebody's Minecraft.
 *
 * Ordered by how likely it is to hold the player's real list: `.minecraft`
 * first, because the official launcher and every client that borrows its
 * folder — Lunar, Feather, Badlion, SKLauncher — write there. Nothing here is
 * required to exist; the ones that do not are simply skipped.
 */
function roots() {
  const home = os.homedir();
  const appData = process.env.APPDATA
    || (process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : path.join(home, '.config'));
  // Where Linux keeps what Windows and macOS keep in appData.
  const share = process.platform === 'linux' ? path.join(home, '.local', 'share') : appData;

  const dotMinecraft = process.platform === 'win32'
    ? path.join(appData, '.minecraft')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'minecraft')
      : path.join(home, '.minecraft');

  const list = [
    dotMinecraft,
    path.join(home, '.lunarclient', 'profiles'),
    path.join(appData, 'PrismLauncher', 'instances'),
    path.join(share, 'PrismLauncher', 'instances'),
    path.join(appData, 'PolyMC', 'instances'),
    path.join(appData, 'MultiMC', 'instances'),
    path.join(home, 'MultiMC', 'instances'),
    path.join(appData, 'com.modrinth.theseus', 'profiles'),
    path.join(appData, 'ModrinthApp', 'profiles'),
    path.join(share, 'ModrinthApp', 'profiles'),
    path.join(home, 'curseforge', 'minecraft', 'Instances'),
    path.join(appData, '.technic', 'modpacks'),
    path.join(appData, 'ATLauncher', 'instances'),
    path.join(appData, 'gdlauncher_next', 'instances'),
    path.join(appData, 'gdlauncher_carbon', 'data', 'instances'),
    path.join(appData, 'xmcl', 'instances')
  ];

  // appData and share are the same folder off Linux, so the list doubles up.
  return [...new Set(list)];
}

/** What tells us a folder is a Minecraft, whoever put it there. */
const MARKS = ['options.txt', 'servers.dat', 'saves'];

async function looksLikeGame(dir) {
  for (const mark of MARKS) {
    if (await exists(path.join(dir, mark))) return true;
  }
  return false;
}

/**
 * The game folders under one root, found by looking rather than by knowing.
 *
 * Every launcher lays its instances out differently — Prism puts the game in
 * `<instance>/.minecraft`, CurseForge and ATLauncher use the instance folder
 * itself, Lunar keeps one per version under the profile — so instead of a rule
 * per launcher there is one rule: a folder holding `options.txt`,
 * `servers.dat` or `saves/` is a Minecraft, and we look two levels down for
 * one. The caps are there so that a launcher which keeps a hundred instances
 * cannot turn a Play press into a disk walk.
 */
async function gameFolders(root, depth = 2, out = []) {
  if (out.length >= 40) return out;
  if (await looksLikeGame(root)) {
    out.push(root);
    return out;
  }
  if (depth <= 0) return out;

  let children;
  try {
    children = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }

  let looked = 0;
  for (const child of children) {
    if (!child.isDirectory()) continue;
    if (++looked > 60) break;
    await gameFolders(path.join(root, child.name), depth - 1, out);
  }
  return out;
}

/**
 * How long the walk of the other launchers' folders is taken on trust
 * (2026-09-22). It is a disk walk — up to sixteen roots, two levels down,
 * sixty children a level — and it was done on every Play press, in front of
 * the player, to notice a `servers.dat` that had changed. Which launchers are
 * installed changes about never; five minutes is far shorter than the gap
 * between a player installing Prism and pressing Play, and `prime` refreshes
 * it while nobody is waiting anyway.
 */
const ELSEWHERE_TTL_MS = 5 * 60 * 1000;
let elsewhereFound = null;
let elsewhereAt = 0;
let elsewhereWalking = null;

/** Every game folder on this PC that is not one of ours, best first. */
async function elsewhere() {
  if (elsewhereFound && Date.now() - elsewhereAt < ELSEWHERE_TTL_MS) return elsewhereFound;
  // An answer past its keep-by is handed back and the walk started behind the
  // caller, exactly as memo.js serves a stale lookup: the press gets the set
  // of launchers this PC had five minutes ago, which is the set it has.
  if (elsewhereFound) { warmElsewhere(); return elsewhereFound; }
  return warmElsewhere();
}

/** Walk now, one walk however many ask. Never throws. */
function warmElsewhere() {
  if (elsewhereWalking) return elsewhereWalking;
  elsewhereWalking = (async () => {
    const found = [];
    for (const root of roots()) found.push(...await gameFolders(root));
    return [...new Set(found)];
  })()
    .then((found) => {
      elsewhereFound = found;
      elsewhereAt = Date.now();
      return found;
    })
    .catch(() => elsewhereFound || [])
    .finally(() => { elsewhereWalking = null; });
  return elsewhereWalking;
}

/**
 * Every set of settings this launcher already holds, newest first: the other
 * profiles' own folders and the sync groups' — never `_shared`, which holds no
 * settings, and never the set being filled.
 *
 * Newest first so that when nothing is merged — `options.txt`, say — the
 * settings the player was using most recently are the ones that carry over.
 */
async function ownSets(instances, except = []) {
  let names;
  try {
    names = await fsp.readdir(instances, { withFileTypes: true });
  } catch {
    return [];
  }

  const skip = new Set(except.map((dir) => path.resolve(dir)));
  const dirs = [];
  for (const child of names) {
    if (!child.isDirectory() || child.name === SHARED_DIR) continue;
    if (child.name.startsWith('_') && !isGroupId(child.name)) continue;
    const dir = path.join(instances, child.name);
    if (skip.has(path.resolve(dir))) continue;
    const stat = await statOf(path.join(dir, 'options.txt'));
    if (!stat) continue;
    dirs.push({ dir, when: stat.mtimeMs });
  }
  return dirs.sort((a, b) => b.when - a.when).map((entry) => entry.dir);
}

/** What to call a folder when telling the player where their servers came from. */
const LABELS = [
  [/[\\/]\.?minecraft$/i, 'the Minecraft launcher'],
  [/[\\/]\.lunarclient[\\/]/i, 'Lunar Client'],
  [/PrismLauncher/i, 'Prism Launcher'],
  [/PolyMC/i, 'PolyMC'],
  [/MultiMC/i, 'MultiMC'],
  [/modrinth/i, 'Modrinth'],
  [/curseforge/i, 'CurseForge'],
  [/technic/i, 'Technic'],
  [/ATLauncher/i, 'ATLauncher'],
  [/gdlauncher/i, 'GDLauncher'],
  [/xmcl/i, 'XMCL']
];

function labelFor(dir) {
  for (const [pattern, label] of LABELS) {
    if (pattern.test(dir)) return label;
  }
  return 'another launcher';
}

/* -------------------------------------------------------- the server list */

function indexByAddress(entries) {
  const map = new Map();
  for (const entry of entries) {
    const address = nbt.addressOf(entry);
    if (address && !map.has(address)) map.set(address, entry);
  }
  return map;
}

/**
 * One server list out of two, with the deletions on both sides honoured.
 *
 * An address on both sides is alive. An address on one side only is either new
 * — the *other* side has never been seen holding it, so this side has just
 * added it — or deleted, because the other side was holding it at the last
 * sync and is not holding it now. With nothing recorded (a profile we have
 * never synced) nothing counts as deleted and this is the plain union it used
 * to be.
 *
 * `live` is the side written most recently: it wins the entry itself, so the
 * name, the cached icon and the "I accept this server's resource pack" answer
 * come from the copy the player has actually been using, and it sets the order.
 */
function reconcileServers(live, other, wasLive, wasOther) {
  const mine = indexByAddress(live);
  const theirs = indexByAddress(other);
  const out = [];
  const seen = new Set();

  for (const address of [...mine.keys(), ...theirs.keys()]) {
    if (seen.has(address)) continue;
    seen.add(address);

    const onMine = mine.has(address);
    const onTheirs = theirs.has(address);
    if (!onMine && wasLive.has(address)) continue;    // we had it and dropped it
    if (!onTheirs && wasOther.has(address)) continue; // they had it and dropped it
    out.push(mine.get(address) || theirs.get(address));
  }
  return out;
}

/** The saved servers in a file, or null when there is no list there at all. */
async function readServerList(file) {
  const buffer = await readIfPresent(file);
  if (!buffer) return null;
  try {
    return nbt.readServers(buffer);
  } catch {
    // A truncated or unreadable list costs only itself.
    return null;
  }
}

async function writeServerList(file, entries) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  // Beside the target then renamed, the way the game writes it: an interrupted
  // write never leaves a half a server list where a whole one was.
  const temp = `${file}.part`;
  await fsp.writeFile(temp, nbt.writeServers(entries));
  await fsp.rename(temp, file);
}

const addressesOf = (entries) => entries.map((entry) => nbt.addressOf(entry)).filter(Boolean);

/**
 * Fold in every server the rest of the PC has picked up since we last looked.
 *
 * This is the half that keeps running forever. The stamp on each foreign file
 * makes the usual launch — where nothing has changed anywhere — a handful of
 * `stat` calls; when one has changed it is read, and only the addresses that
 * are not already on that folder's watermark are taken. Which is what lets
 * both of these be true at once: a server added in the official launcher turns
 * up here, and a server deleted *here* stays deleted even though the official
 * launcher still lists it.
 *
 * @returns {Promise<number>} how many were added
 */
async function importServers(setDir, state, sources) {
  const file = path.join(setDir, 'servers.dat');
  const current = (await readServerList(file)) || [];
  const have = new Set(addressesOf(current));
  let added = 0;

  for (const dir of sources) {
    const from = path.join(dir, 'servers.dat');
    const stat = await statOf(from);
    if (!stat) continue;

    const mark = state.imports[dir];
    if (mark && stampsMatch(mark, stat)) continue;   // untouched since we read it

    const entries = await readServerList(from);
    if (!entries) continue;

    const taken = new Set(Array.isArray(mark?.seen) ? mark.seen : []);
    for (const entry of entries) {
      const address = nbt.addressOf(entry);
      if (!address) continue;
      if (!taken.has(address) && !have.has(address)) {
        current.push(entry);
        have.add(address);
        added += 1;
      }
      taken.add(address);
    }

    state.imports[dir] = { size: stat.size, mtimeMs: stat.mtimeMs, seen: [...taken] };
  }

  if (added) await writeServerList(file, current);
  return added;
}

/* --------------------------------------------------------------- seeding */

/**
 * The game's own settings, for a player who has none yet (2026-09-06).
 *
 * Minecraft's defaults are `enableVsync:true` and `maxFps:120`. VSync holds
 * the frame rate to the monitor's and adds a frame of input lag, and 120 is a
 * ceiling under most gaming monitors — so a fresh install ran Sodium, Lithium
 * and the rest of the stack and then capped the number they were there to
 * raise. Every PvP client switches VSync off first; this one now ships it off.
 * 260 is what the game's own slider calls "Unlimited".
 *
 * **And the idle limit (2026-09-22, Adrian's word).** 26.x ships
 * `inactivityFpsLimit:"afk"`, which pins a window nobody has *typed in* — not
 * a window that has lost focus — to 30 frames a second after a minute and a
 * hard 10 after that; measured on the bench as every frame exactly 100 ms
 * long. It fires on a player watching their own farm run, or reading Discord
 * on the other monitor, and it quietly undercuts the Dynamic FPS tune this
 * launcher already writes (60 unfocused, 30 idle — see `tuneDynamicFps`),
 * because the lower of the two caps is the one that wins. `"minimized"` is
 * the game's own other setting: it limits itself only when actually
 * minimised, which is the case the limit was for.
 *
 * Only these three, and only when no options.txt exists anywhere on the
 * machine: a player's own file is theirs, VSync and all. Written without a
 * `version` line on purpose — the game fills in every other option from its
 * defaults, and none of these keys has ever been renamed. A game older than
 * 26.x does not know `inactivityFpsLimit` and drops the line it does not
 * recognise, which is what every unknown key in that file gets.
 */
const FIRST_OPTIONS = [
  'enableVsync:false',
  'maxFps:260',
  'inactivityFpsLimit:"minimized"',
  ''
].join('\n');

/**
 * Fill the settings half of a set from what is already on the PC.
 *
 * Runs on every launch for as long as the set is *unclaimed* — which is until
 * the first BlueClient game writes to it, and never again after that. That is
 * what covers the player who installs this before they have played anything
 * else, and it is also what stops another launcher from overwriting settings
 * the player has since made their own.
 *
 * The player's own sets come first, newest first: those settings are the ones
 * they chose inside this launcher, and the second profile opens on the first
 * one's keys and servers. Other clients fill in what is missing.
 */
async function seedSettings(setDir, mine, theirs) {
  for (const member of MEMBERS) {
    if (member.kind === 'servers') continue;      // its own pass, and it never stops
    const target = path.join(setDir, member.name);

    for (const dir of (member.own ? mine : [...mine, ...theirs])) {
      const from = path.join(dir, member.name);
      if (!(await exists(from))) continue;

      if (member.kind === 'tree') {
        await pushTree(from, target, member);
      } else {
        const stat = await statOf(from);
        if (stat && !stampsMatch(await statOf(target), stat)) {
          await place(entryOf(from, stat), target, {});
          // Another launcher's options.txt comes with that launcher's frame
          // cap; BlueClient's copy of it does not. See uncapOptions.
          if (member.name === 'options.txt' && !mine.includes(dir)) await uncapOptions(target, stat);
        }
      }
      break;
    }
  }

  // Nothing on this PC had an options.txt — a new machine, or a first
  // Minecraft. The game would write its own defaults, and two of them undo
  // what the performance stack is for. See FIRST_OPTIONS.
  if (!(await exists(path.join(setDir, 'options.txt')))) {
    await fsp.writeFile(path.join(setDir, 'options.txt'), FIRST_OPTIONS, 'utf8');
  }
}

/**
 * The two keys of FIRST_OPTIONS, written over a copy of another launcher's
 * options.txt (2026-09-19).
 *
 * The seed above copies the vanilla launcher's file (or Lunar's, or Prism's)
 * into a new profile so a player opens BlueClient on their own keys and
 * servers — and until this date it copied the cap in that file too. The
 * vanilla launcher's file is `enableVsync:true` and `maxFps:120` unless the
 * player has been into Video Settings, and a player coming from a client
 * that keeps its own settings folder (FastClient does) has never touched
 * it: "it got my fps from 200 to 60" (a 60 Hz screen, VSync on) was the
 * first report after 1.0. So a copy taken from another launcher gets what
 * a clean machine gets: VSync off and the cap at the game's "Unlimited".
 * Every other line is theirs. The other launcher's own file is never
 * touched; a set the player's BlueClient game has written to is never
 * seeded again; and a copy taken from one of the player's *own* BlueClient
 * sets is left exactly as it is — that one is a choice.
 *
 * Import profiles' `takeFrom` does the same to the file it copies: that is
 * another launcher's file too, and the one most players arrive by.
 *
 * The stamp the copy carries is put back after the write, so the next
 * unclaimed launch reads the copy as current and does not fetch it again.
 */
async function uncapOptions(file, stamp, { idle = true } = {}) {
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return false;
  }
  const lines = text.split(/\r?\n/);
  let vsync = false;
  let cap = false;
  let hasIdle = false;
  const out = lines.map((line) => {
    if (/^enableVsync:/.test(line)) { vsync = true; return 'enableVsync:false'; }
    if (/^maxFps:/.test(line)) { cap = true; return 'maxFps:260'; }
    // The third key of FIRST_OPTIONS (2026-09-22): another launcher's 26.x
    // file carries the game's own "afk" for the same reason it carries the
    // 120 cap — nobody has been into Video Settings.
    if (idle && /^inactivityFpsLimit:/.test(line)) { hasIdle = true; return 'inactivityFpsLimit:"minimized"'; }
    return line;
  });
  if (!vsync) out.unshift('enableVsync:false');
  if (!cap) out.unshift('maxFps:260');
  if (idle && !hasIdle) out.unshift('inactivityFpsLimit:"minimized"');
  const next = out.join('\n');
  if (next === text) return false;
  await fsp.writeFile(file, next, 'utf8');
  if (stamp) await fsp.utimes(file, stamp.atime, stamp.mtime).catch(() => {});
  return true;
}

/**
 * Copy one set wholesale into another folder, and mark the copy as the
 * player's own.
 *
 * Two callers: Import profiles, bringing another launcher's settings into the
 * new profile the player asked for (`packs` then, because the packs its
 * options.txt names have to come with it or the list is shortened on the first
 * launch); and `link`, founding a group from the profile being synced with.
 * Nothing at the target is removed — a caller that wants a clean copy clears
 * it first (`clearSet`).
 *
 * The record it writes says the set is claimed (no other launcher may fill it
 * in again) and, when the source was a game folder with a server list, that
 * every address in it has been taken from there — so a server the player
 * later deletes is not imported back from the folder it came from.
 *
 * `config` names where the mods' settings are when they are not at
 * `<sourceDir>/config` — a modpack installed through Lunar keeps them a level
 * down (2026-09-18); everything else is still read from `sourceDir`.
 */
async function takeFrom(sourceDir, targetDir, { packs = true, config = null } = {}) {
  await fsp.mkdir(targetDir, { recursive: true });
  for (const member of MEMBERS) {
    if (member.own && !packs) continue;
    const from = member.name === 'config' && config ? config : path.join(sourceDir, member.name);
    const to = path.join(targetDir, member.name);
    if (!(await exists(from))) continue;
    if (member.kind === 'tree') {
      await pushTree(from, to, member);
    } else {
      const stat = await statOf(from);
      if (stat && !stampsMatch(await statOf(to), stat)) {
        await place(entryOf(from, stat), to, {});
        // The other launcher's frame cap stays with the other launcher — the
        // same rule as the first-launch seed (uncapOptions): FastClient's own
        // file on this PC says enableVsync:true, and a profile brought over
        // from it opened at the screen's 60 (2026-09-20).
        if (member.name === 'options.txt') await uncapOptions(to, stat);
      }
    }
  }

  const state = emptyState();
  // A source with nothing in it — a profile never played — makes an unclaimed
  // copy, which the first launch fills in the way it fills in any new set.
  state.claimed = (await exists(path.join(targetDir, 'options.txt')))
    || (await exists(path.join(targetDir, 'servers.dat')));
  const sourceState = await loadState(sourceDir);
  state.imports = { ...sourceState.imports };
  const servers = path.join(sourceDir, 'servers.dat');
  const stat = await statOf(servers);
  if (stat) {
    const entries = (await readServerList(servers)) || [];
    state.imports[sourceDir] = { size: stat.size, mtimeMs: stat.mtimeMs, seen: addressesOf(entries) };
  }
  await saveState(targetDir, state);
}

/**
 * The same two keys, once, over every set already on the disk whose file
 * still carries vanilla's untouched pair (2026-09-20; main.js schema 6).
 *
 * Every copy installed from 1.0.0 to 1.3.0 seeded its first profile from the
 * vanilla launcher's file with the cap in it, and a set the player's game has
 * written to is never seeded again — so the fix above would reach nobody
 * already playing. Only a file that says exactly `enableVsync:true` and
 * `maxFps:120` is turned: that pair is the vanilla default nobody has been
 * into Video Settings for, and a player who chose VSync on a 60 Hz screen and
 * left the cap alone gets it back with one click there. Anything else is
 * theirs and is left. Profiles' own folders and the sync groups' both; the
 * shared folder holds no settings.
 *
 * @returns {Promise<number>} how many files were turned
 */
async function uncapUntouched(instances) {
  let names;
  try {
    names = await fsp.readdir(instances, { withFileTypes: true });
  } catch {
    return 0;
  }
  let turned = 0;
  for (const child of names) {
    if (!child.isDirectory() || child.name === SHARED_DIR) continue;
    if (child.name.startsWith('_') && !isGroupId(child.name)) continue;
    const file = path.join(instances, child.name, 'options.txt');
    let text;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    if (!lines.includes('enableVsync:true') || !lines.includes('maxFps:120')) continue;
    // The two keys only: this is a one-time move over sets the player has
    // already been playing on, not a new set and not another launcher's copy,
    // and its promise (the comment above) is exactly that pair (2026-09-22).
    if (await uncapOptions(file, null, { idle: false })) turned += 1;
  }
  return turned;
}

/** Take every member and the record out of a folder; the mods, worlds and everything else stay. */
async function clearSet(dir) {
  for (const member of MEMBERS) {
    await fsp.rm(path.join(dir, member.name), { recursive: true, force: true }).catch(() => {});
  }
  await fsp.rm(path.join(dir, STATE_FILE), { force: true }).catch(() => {});
}

/* ------------------------------------------------------------ the members */

/**
 * Copy anything newer in the profile's folder out to the shared one. Nothing
 * is ever removed — this is the pass that runs while the game is up, and the
 * two sides are still moving.
 *
 * `seedSettings` uses it the same way with another launcher's folder in the
 * first argument's place; taking, never giving, is what that wants too.
 *
 * @returns {Promise<{local: Set<string>, shared: Set<string>}>} what each holds after
 */
async function pushTree(localDir, sharedDir, member) {
  const source = await scanTree(localDir, member.except || []);
  const target = await scanTree(sharedDir, member.except || []);

  for (const [name, entry] of source) {
    if (stampsMatch(target.get(name), entry)) continue;
    await place(entry, path.join(sharedDir, ...name.split('/')), { link: member.link });
    target.set(name, entry);
  }
  return { local: new Set(source.keys()), shared: new Set(target.keys()) };
}

/**
 * Make two folders the same, in both directions, with deletions honoured.
 *
 * A file on both sides: the newer one wins. On one side only: it is new and
 * gets copied across — unless the last sync had it, in which case somebody has
 * deleted it and it goes from the other side too.
 *
 * A folder that is not there at all says nothing: a profile whose files have
 * been deleted from under us, or one that has never been launched, must not be
 * read as a player emptying the shared set.
 *
 * @returns {Promise<Set<string>>} what the two now both hold
 */
async function reconcileTree(sharedDir, localDir, base, member) {
  const except = member.except || [];
  const shared = await scanTree(sharedDir, except);
  const local = await scanTree(localDir, except);
  const agreed = new Set();

  const both = (await exists(sharedDir)) && (await exists(localDir));
  const wasShared = both ? base.shared : new Set();
  const wasLocal = both ? base.local : new Set();

  for (const name of new Set([...shared.keys(), ...local.keys()])) {
    const here = shared.get(name);
    const there = local.get(name);
    const sharedFile = path.join(sharedDir, ...name.split('/'));
    const localFile = path.join(localDir, ...name.split('/'));

    if (here && there) {
      if (!stampsMatch(here, there)) {
        const newerIsShared = here.mtimeMs >= there.mtimeMs;
        await place(newerIsShared ? here : there, newerIsShared ? localFile : sharedFile,
          { link: member.link });
      }
      agreed.add(name);
      continue;
    }

    // On one side only: deleted if the other side was last seen holding it,
    // new if it was not.
    if (here ? wasLocal.has(name) : wasShared.has(name)) {
      await fsp.rm(here ? sharedFile : localFile, { force: true }).catch(() => {});
      continue;
    }

    await place(here || there, here ? localFile : sharedFile, { link: member.link });
    agreed.add(name);
  }

  // A reconcile leaves the two the same, so both sides of the record are this.
  return { local: agreed, shared: agreed };
}

/** The same, for a member that is one file: the newer of the two wins. */
async function reconcileFile(sharedFile, localFile, member) {
  const here = await statOf(sharedFile);
  const there = await statOf(localFile);

  if (here && there) {
    if (stampsMatch(here, there)) return;
    const newerIsShared = here.mtimeMs >= there.mtimeMs;
    await place(
      newerIsShared ? entryOf(sharedFile, here) : entryOf(localFile, there),
      newerIsShared ? localFile : sharedFile,
      { link: member.link }
    );
    return;
  }

  if (here) await place(entryOf(sharedFile, here), localFile, { link: member.link });
  else if (there) await place(entryOf(localFile, there), sharedFile, { link: member.link });
}

/**
 * The group's folder and a member's instance made the same, both ways, with
 * the record of what each held last time deciding what a one-sided file
 * means. What `adopt` does for a synced profile, and what a profile leaving
 * a group does one last time on the way out.
 *
 * @returns the record to keep for this member
 */
async function reconcileSet(groupDir, instanceDir, base) {
  const record = { servers: [], files: {} };

  for (const member of MEMBERS) {
    const shared = path.join(groupDir, member.name);
    const local = path.join(instanceDir, member.name);

    if (member.kind === 'servers') {
      const here = await readServerList(shared);
      const there = await readServerList(local);
      // The group's list leads: it is the one another profile wrote last.
      const merged = here && there
        ? reconcileServers(here, there, base.servers.shared, base.servers.local)
        : (here || there || []);
      const addresses = addressesOf(merged);
      let wroteShared = !(here || there);
      let wroteLocal = wroteShared;
      if (here || there) {
        wroteShared = await writeServerList(shared, merged).then(() => true, () => false);
        wroteLocal = await writeServerList(local, merged).then(() => true, () => false);
      }
      // A write that failed is not recorded as having happened (2026-09-22).
      // This record is what the NEXT reconcile measures a one-sided server
      // against: claiming a file holds a server it never received made that
      // server read as a deletion on the following press, and it was then
      // taken off the other side too — a file the player never touched
      // quietly losing servers because a disk was busy for a moment.
      record.servers = bothSides(
        wroteLocal ? addresses : base.servers.local,
        wroteShared ? addresses : base.servers.shared
      );
      continue;
    }

    if (member.kind === 'tree') {
      const sides = await reconcileTree(
        shared, local, base.files.get(member.name) || sideSets(null), member
      ).catch(() => null);
      if (sides && sides.local.size <= RECORD_CAP) {
        record.files[member.name] = bothSides(sides.local, sides.shared);
      }
      continue;
    }

    await reconcileFile(shared, local, member).catch(() => {});
  }

  return record;
}

/* ---------------------------------------------------------------- public */

function sharedDirIn(instances) {
  return path.join(instances, SHARED_DIR);
}

/**
 * One queue per instances folder.
 *
 * Two games starting at once must not both decide a set is empty and fill it
 * in, a game exiting while another one starts must not write the record over
 * a copy of it that was read a moment earlier, and a profile must not join a
 * group while a launch is halfway through reading it. Every entry point below
 * goes through here, so that no caller has to remember to.
 */
function serialise(instances, work) {
  return lane(`settings:${instances}`, work);
}

/**
 * Put the profile's settings in place, ready for the game to open them.
 *
 * Everything the sync knows how to do happens here, in this order: fill the
 * set in from the rest of the PC while it is still unclaimed, take any servers
 * the other launchers have picked up since the last look, then — for a synced
 * profile — reconcile the group's folder and this profile in both directions.
 * A profile on its own has nothing to reconcile: the set *is* its folder.
 */
async function adopt(instances, instanceDir) {
  return serialise(instances, async () => {
    const id = path.basename(instanceDir);
    const group = await groupOf(instances, id);
    const setDir = homeFor(instances, id, group);
    await fsp.mkdir(setDir, { recursive: true });

    const state = await loadState(setDir);
    const mine = await ownSets(instances, [setDir, instanceDir]);
    const theirs = await elsewhere();

    if (!state.claimed) {
      await seedSettings(setDir, mine, theirs).catch(() => {});
      /* A new set starts as a copy of the one the player used last, and that
         includes what that set has already taken from the other launchers on
         this PC: without its watermark, a server the player deleted from
         their list would be imported all over again from the launcher it
         came from, into every new profile, forever. */
      if (mine.length) {
        const seed = await loadState(mine[0]);
        state.imports = { ...seed.imports, ...state.imports };
      }
    }
    /* On the very first run of a set its own list is empty, so the newest of
       the player's own sets is read as a source once — the copy — and it is
       the only time one of our own sets is read this way. After that a set
       takes new servers from the other launchers only: importing is additive
       by design, so a profile still holding a server the player deleted
       somewhere else would hand it straight back. */
    const sources = state.claimed ? theirs : [...mine.slice(0, 1), ...theirs];
    await importServers(setDir, state, sources).catch(() => 0);

    if (group) {
      state.instances[id] = await reconcileSet(setDir, instanceDir, baseFor(state, id));
      await prune(instances, state);
    }
    await saveState(setDir, state);

    // Whatever the launcher has to tell the game, in the copy it is about to
    // open. After the sync, so the sync can never undo it.
    await stampFlags(path.join(instanceDir, 'config')).catch(() => false);
  });
}

/** Forget profiles that are no longer on the disk. */
async function prune(instances, state) {
  let names;
  try {
    names = await fsp.readdir(instances, { withFileTypes: true });
  } catch {
    return;
  }
  const live = new Set(names.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  for (const id of Object.keys(state.instances)) {
    if (!live.has(id)) delete state.instances[id];
  }
}

/**
 * Take whatever the game left in the instance back into the group's folder.
 *
 * `final` is the pass made once the game has exited, and it is the only one
 * that reconciles: with nothing running there is no risk in writing into the
 * profile, so the two sides end up the same — and that agreement is the record
 * the next sync measures deletions against.
 *
 * The mirror that runs *during* a session only pushes outward — the server
 * list merged, so a server added or removed in this game reaches the next one
 * within the second, everything else copied when it is newer — and it leaves
 * the record alone, because the two sides are still moving.
 *
 * A profile on its own has nowhere to push to: the game wrote the set itself.
 * All that is left to say is that the set is the player's now.
 */
async function keep(instances, instanceDir, { final = false } = {}) {
  return serialise(instances, async () => {
    const id = path.basename(instanceDir);
    const group = await groupOf(instances, id);
    const setDir = homeFor(instances, id, group);
    await fsp.mkdir(setDir, { recursive: true });

    const state = await loadState(setDir);
    // The game has written to this set, so it is the player's now: no other
    // launcher on this PC gets to fill it in again.
    state.claimed = true;

    if (!group) {
      await saveState(setDir, state);
      return;
    }

    const base = baseFor(state, id);
    const record = { servers: [], files: {} };

    for (const member of MEMBERS) {
      const shared = path.join(setDir, member.name);
      const local = path.join(instanceDir, member.name);

      if (member.kind === 'servers') {
        const there = await readServerList(local);
        const here = await readServerList(shared);
        // The game's copy leads: it is the one that has just been edited.
        const merged = here && there
          ? reconcileServers(there, here, base.servers.local, base.servers.shared)
          : (there || here || []);
        let wroteShared = !there;
        let wroteLocal = !there;
        if (there) {
          wroteShared = await writeServerList(shared, merged).then(() => true, () => false);
          wroteLocal = final ? await writeServerList(local, merged).then(() => true, () => false) : false;
        }
        const mergedAddresses = addressesOf(merged);
        // Only a final pass writes the profile, so only there do the two
        // match — and a write that failed is recorded as not having happened,
        // for the reason `reconcileSet` gives above.
        const localSide = final
          ? (wroteLocal ? mergedAddresses : base.servers.local)
          : addressesOf(there || []);
        record.servers = bothSides(localSide, wroteShared ? mergedAddresses : base.servers.shared);
        continue;
      }

      if (member.kind === 'tree') {
        const sides = final
          ? await reconcileTree(
            shared, local, base.files.get(member.name) || sideSets(null), member
          ).catch(() => null)
          : await pushTree(local, shared, member).catch(() => null);
        if (sides && sides.local.size <= RECORD_CAP) {
          record.files[member.name] = bothSides(sides.local, sides.shared);
        }
        continue;
      }

      if (final) {
        await reconcileFile(shared, local, member).catch(() => {});
      } else {
        const stat = await statOf(local);
        if (stat && !stampsMatch(await statOf(shared), stat)) {
          await place(entryOf(local, stat), shared, {}).catch(() => {});
        }
      }
    }

    // The record says what each side is holding, not what they agreed on, so
    // the mirror keeps it up to date too — that is what makes a server added
    // and then deleted inside one session actually go.
    state.instances[id] = record;
    await saveState(setDir, state);
  });
}

/**
 * Mirror changes back for as long as the game is running.
 *
 * Without this, adding a server in one game would not reach a second game
 * launched a minute later, and a launcher closed or a machine shut down with
 * Minecraft still up would lose the lot. The exit hook still runs — this is
 * the one that makes it timely, that one is the one that makes it certain.
 *
 * Debounced, because the game rewrites `options.txt` on every slider drag.
 * A profile on its own is not watched: there is nothing to mirror to.
 *
 * @returns {() => void} stop watching
 */
function watch(instances, instanceDir) {
  const watchers = [];
  let timer = null;
  let stopped = false;

  const flush = () => {
    timer = null;
    keep(instances, instanceDir).catch(() => {});
  };

  const touched = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 800);
  };

  const start = (target, recursive) => {
    try {
      watchers.push(fs.watch(target, { recursive, persistent: false }, touched));
    } catch {
      // A folder that is not there yet, or a platform without recursive
      // watching: the exit hook covers it.
    }
  };

  // Whether there is anything to mirror is a read of the groups file, so the
  // watchers go up once it has answered; a game never lives long enough for
  // the gap to matter, and the exit hook covers it anyway.
  groupOf(instances, path.basename(instanceDir)).then((group) => {
    if (stopped || !group) return;
    start(instanceDir, false);
    start(path.join(instanceDir, 'config'), true);
  }).catch(() => {});

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        /* already gone */
      }
    }
  };
}

/* ------------------------------------------------- linking and leaving */

/**
 * Sync one profile's settings with another's.
 *
 * The profile joins the other's group — founding one from the other's own
 * settings if it is not in one yet — and *takes* that group's settings: its
 * own are dropped and the group's copied in, so the two are the same from
 * this moment and stay that way through the ordinary sync. A profile already
 * synced with a third one leaves that group first; a group that then has one
 * member left is dissolved, and that member keeps what it had.
 *
 * Refused while a game is running on either profile: the game has its files
 * open and would write them back over the copy.
 *
 * @returns {Promise<{ group: string }>} the group both are now in
 */
async function link(instances, profileId, targetId) {
  return serialise(instances, async () => {
    if (profileId === targetId) throw new Error('a profile cannot sync with itself');
    const record = await loadGroups(instances);
    const current = groupIn(record, profileId);
    let group = groupIn(record, targetId);
    if (current && current === group) return { group };

    if (current) await leaveInner(instances, record, profileId, { pull: false });

    const groupDir = path.join(instances, group || `${GROUP_PREFIX}${uid()}`);
    if (!group) {
      // Founded from the other profile's own set — and that profile's record
      // is written now, so that the first deletion the joiner makes is read
      // as a deletion and not as something the founder has just added.
      group = path.basename(groupDir);
      await fsp.mkdir(groupDir, { recursive: true });
      const targetDir = path.join(instances, targetId);
      await takeFrom(targetDir, groupDir);
      const founded = await loadState(groupDir);
      founded.instances[targetId] = await reconcileSet(groupDir, targetDir, baseFor(founded, targetId));
      await saveState(groupDir, founded);
      record.groups[group] = [targetId];
    }

    const instanceDir = path.join(instances, profileId);
    await clearSet(instanceDir);
    const state = await loadState(groupDir);
    state.instances[profileId] = await reconcileSet(groupDir, instanceDir, baseFor(state, profileId));
    await saveState(groupDir, state);

    record.groups[group].push(profileId);
    await saveGroups(instances, record);
    return { group };
  });
}

/**
 * Stop syncing a profile's settings with the others in its group.
 *
 * The profile keeps a copy of the group's settings as they stand — one last
 * reconcile, so a change another member made an hour ago is in it — and from
 * then on its folder is its own set. A group left with one member is
 * dissolved the same way: that member takes its copy and the group's folder
 * goes.
 */
async function leave(instances, profileId) {
  return serialise(instances, async () => {
    const record = await loadGroups(instances);
    if (!groupIn(record, profileId)) return { ok: true };
    await leaveInner(instances, record, profileId, { pull: true });
    await saveGroups(instances, record);
    return { ok: true };
  });
}

/**
 * A profile is gone (deleted, or its folder with it): take it out of its
 * group, and dissolve the group if that leaves one member.
 */
async function forget(instances, profileId) {
  return serialise(instances, async () => {
    const record = await loadGroups(instances);
    if (!groupIn(record, profileId)) return;
    await leaveInner(instances, record, profileId, { pull: false });
    await saveGroups(instances, record);
  });
}

/** Take a profile out of its group in the record handed in, and dissolve a group of one. */
async function leaveInner(instances, record, profileId, { pull }) {
  const group = groupIn(record, profileId);
  if (!group) return;
  const groupDir = path.join(instances, group);

  if (pull) await settle(groupDir, path.join(instances, profileId), profileId);
  else {
    const state = await loadState(groupDir);
    delete state.instances[profileId];
    await saveState(groupDir, state);
  }

  record.groups[group] = record.groups[group].filter((m) => m !== profileId);
  if (record.groups[group].length <= 1) {
    for (const last of record.groups[group]) {
      await settle(groupDir, path.join(instances, last), last);
    }
    delete record.groups[group];
    await fsp.rm(groupDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * One last reconcile into a member's own folder, and a record of its own that
 * says the set is claimed and remembers which servers were already taken from
 * the launchers on this PC — so leaving a group imports nothing twice.
 */
async function settle(groupDir, instanceDir, profileId) {
  const state = await loadState(groupDir);
  await reconcileSet(groupDir, instanceDir, baseFor(state, profileId)).catch(() => {});
  delete state.instances[profileId];
  await saveState(groupDir, state);
  if (!(await exists(instanceDir))) return;
  const own = emptyState();
  own.claimed = true;
  own.imports = { ...state.imports };
  await saveState(instanceDir, own);
}

/* ------------------------------------------------------------ migration */

/**
 * A launcher from before sync groups kept one set for everyone in `_shared`.
 * Run once at start-up: that set becomes a group of every profile that
 * existed — the ones with a folder, and the ones in the launcher's list that
 * had never been played — so the day this lands nobody's settings split or
 * change; and the two launcher-wide records are gathered into `_shared`
 * (the newest copy of each wins, and every other copy goes).
 *
 * Idempotent: `migrated` in the groups file says it has run, and a run that
 * was interrupted moves whatever is still in `_shared` on the next start.
 *
 * @param {string[]} profileIds every profile the launcher's list holds
 */
async function migrate(instances, profileIds = []) {
  return serialise(instances, async () => {
    const record = await loadGroups(instances);
    if (record.migrated) return { migrated: false };
    const sharedDir = sharedDirIn(instances);

    let legacy = false;
    for (const member of MEMBERS) {
      if (await exists(path.join(sharedDir, member.name))) legacy = true;
    }

    if (legacy) {
      const onDisk = await ownSets(instances);
      const members = [...new Set([
        ...onDisk.map((dir) => path.basename(dir)).filter((name) => !isGroupId(name)),
        ...profileIds.filter((id) => typeof id === 'string' && /^[a-z0-9]+$/i.test(id))
      ])];
      const group = `${GROUP_PREFIX}${uid()}`;
      const groupDir = path.join(instances, group);
      await fsp.mkdir(groupDir, { recursive: true });

      for (const name of [...MEMBERS.map((m) => m.name), STATE_FILE]) {
        await moveInto(path.join(sharedDir, name), path.join(groupDir, name));
      }
      record.groups[group] = members;
      if (members.length <= 1) {
        for (const last of members) await settle(groupDir, path.join(instances, last), last);
        delete record.groups[group];
        await fsp.rm(groupDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    await gatherRecords(instances);
    record.migrated = true;
    await saveGroups(instances, record);
    return { migrated: true };
  });
}

/** Move a file or a whole folder, merging into what is already at the target. */
async function moveInto(from, to) {
  const stat = await statOf(from);
  if (!stat) return;
  if (!stat.isDirectory()) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rm(to, { force: true }).catch(() => {});
    await fsp.rename(from, to).catch(async () => {
      await fsp.copyFile(from, to);
      await fsp.rm(from, { force: true });
    });
    return;
  }
  if (!(await exists(to))) {
    try {
      await fsp.rename(from, to);
      return;
    } catch {
      /* across volumes, or something inside is open — file by file */
    }
  }
  const files = await scanTree(from);
  for (const [name, entry] of files) {
    await moveInto(entry.full, path.join(to, ...name.split('/')));
  }
  await fsp.rm(from, { recursive: true, force: true }).catch(() => {});
}

/**
 * Put the newest copy of each launcher-wide record in `_shared/config` and
 * take every other copy off the disk — out of the group folders, whose sync
 * would otherwise carry a stale one about, and out of the instances, where a
 * game from before this date wrote it.
 */
async function gatherRecords(instances) {
  const sharedConfig = path.join(sharedDirIn(instances), 'config');
  let names;
  try {
    names = await fsp.readdir(instances, { withFileTypes: true });
  } catch {
    return;
  }
  const folders = names.filter((e) => e.isDirectory() && e.name !== SHARED_DIR).map((e) => path.join(instances, e.name));

  for (const name of RECORDS) {
    const target = path.join(sharedConfig, name);
    let best = await statOf(target);
    let bestDir = null;
    for (const dir of folders) {
      const stat = await statOf(path.join(dir, 'config', name));
      if (stat && (!best || stat.mtimeMs > best.mtimeMs)) {
        best = stat;
        bestDir = dir;
      }
    }
    if (bestDir) {
      await place(entryOf(path.join(bestDir, 'config', name), best), target, {}).catch(() => {});
    }
    for (const dir of folders) {
      await fsp.rm(path.join(dir, 'config', name), { force: true }).catch(() => {});
    }
  }
}

/* -------------------------------------------------------------- summary */

/**
 * What to tell the player about a set: how many servers are in it, and which
 * launchers on this PC it is keeping up with. Read on request, for Settings ›
 * Storage — nothing here runs on its own.
 *
 * @param {string} setName a group's folder name, or a profile's id
 */
async function summary(instances, setName) {
  if (!instances || !setName) return { servers: 0, from: [] };
  const setDir = path.join(instances, setName);
  const state = await loadState(setDir);
  const list = await readServerList(path.join(setDir, 'servers.dat'));

  const from = [];
  for (const dir of Object.keys(state.imports)) {
    if (dir.startsWith(instances)) continue;      // our own profiles are not news
    const label = labelFor(dir);
    if (!from.includes(label)) from.push(label);
  }

  return { servers: list ? list.length : 0, from };
}

/* ----------------------------------------------------------------- flags */

/**
 * What the launcher tells the in-game half (2026-09-06): where clips go, which
 * cape to wear, and since 2026-09-17 where the play record and the waypoints
 * live. It rides at the top of blueclient.json beside the presets, which the
 * game writes back whole on every save, so a key it does not know survives
 * untouched. Stamped into the profile's copy as the game is about to open.
 */
let flags = {};

function setFlags(values) {
  flags = { ...values };
}

/**
 * Where the game is told to keep the launcher-wide records: the play record
 * and the waypoints, and since 2026-09-19 the chat logs — a file a day the
 * game's ChatLog writes and Settings → Logs opens (`chatLogsDir`). Inside
 * `_shared` like the other two, because what is said in chat is the
 * player's whichever profile they play — and because a folder directly
 * under the profiles would be counted as a profile by the Storage page.
 */
function recordFlags(instances) {
  const config = path.join(sharedDirIn(instances), 'config');
  return {
    ledgerFile: path.join(config, 'blueclient-stats.json'),
    waypointsFile: path.join(config, 'blueclient-waypoints.json'),
    chatLogsDir: chatLogsDirIn(instances)
  };
}

/** The chat logs' folder, for the flag and for the Open button. */
function chatLogsDirIn(instances) {
  return path.join(sharedDirIn(instances), 'chatlogs');
}

/**
 * One config folder's blueclient.json, read for a stamp (2026-09-22): the
 * object in it, an empty one when there is no file yet, and null when there
 * is a file and it cannot be read as one.
 *
 * Null is the whole point. Both stamps below used to take anything they
 * could not parse for an empty file and write it back with nothing in it but
 * their own keys — and the file is the in-game half's whole config, every
 * preset and switch the player has set in the mod. A file caught while the
 * game was writing it, held open by a scanner, or cut short by a game that
 * was killed was not a file with nothing in it; it was the player's settings
 * one read away from being readable again, and the stamp wiped them. A
 * stamp that cannot read the file now leaves it exactly as it is: a flag
 * missed for one launch costs a clips folder, not a config.
 */
async function readForStamp(file) {
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (error) {
    return error && error.code === 'ENOENT' ? {} : null;
  }
  try {
    const root = JSON.parse(raw);
    return root !== null && typeof root === 'object' && !Array.isArray(root) ? root : null;
  } catch {
    return null;
  }
}

/**
 * One stamp at a time per blueclient.json (2026-09-22). `stampFlags` runs
 * inside `adopt`'s lane and `stampKeys` after it, outside any: two Play
 * presses of one profile could each read the file, add their own keys and
 * write it — and the second write took the first one's keys back out. A
 * lane of the file's own, so the two queue for it without either taking the
 * other's; one spelling of the path, the way files.js keys its fetches.
 */
function stampLane(file, work) {
  const full = path.resolve(file);
  return lane(`stamp:${process.platform === 'win32' ? full.toLowerCase() : full}`, work);
}

/**
 * Keys of the launch's own into one config folder's blueclient.json
 * (2026-09-21): a value writes the key, null takes it out. For what is per
 * account rather than launcher-wide — an offline account's own skin — and so
 * not a flag every launch carries.
 */
async function stampKeys(configDir, values) {
  const file = path.join(configDir, 'blueclient.json');
  return stampLane(file, async () => {
    const root = await readForStamp(file);
    if (!root) return false;
    let changed = false;
    for (const [key, value] of Object.entries(values || {})) {
      if (value === null || value === undefined) {
        if (key in root) { delete root[key]; changed = true; }
      } else if (root[key] !== value) {
        root[key] = value;
        changed = true;
      }
    }
    if (!changed) return false;
    await fsp.mkdir(configDir, { recursive: true });
    // Whole or not at all (files.writeFileAtomic): the game reads this file
    // the moment it starts, and half of one is no config at all.
    await writeFileAtomic(file, JSON.stringify(root, null, 2));
    return true;
  });
}

/** Write the flags into one config folder's blueclient.json; true if anything changed. */
async function stampFlags(configDir) {
  const file = path.join(configDir, 'blueclient.json');
  return stampLane(file, async () => {
    const root = await readForStamp(file);
    if (!root) return false;

    let changed = false;
    for (const [key, value] of Object.entries(flags)) {
      if (root[key] !== value) {
        root[key] = value;
        changed = true;
      }
    }
    if (!changed) return false;

    await fsp.mkdir(configDir, { recursive: true });
    await writeFileAtomic(file, JSON.stringify(root, null, 2));
    return true;
  });
}

module.exports = {
  adopt, keep, watch, setFlags, stampKeys, recordFlags, chatLogsDirIn, sharedDirIn, summary, elsewhere, warmElsewhere, labelFor,
  groups, groupOf, homeOf, link, leave, forget, migrate, takeFrom, uncapUntouched,
  SHARED_DIR, GROUP_PREFIX, FIRST_OPTIONS
};
