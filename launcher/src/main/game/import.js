'use strict';

/**
 * Import profiles — the other launchers on this PC, read and brought over
 * (2026-09-16).
 *
 * Adrian: "build it for lunar, feather/dawn client, fastclient, and the other
 * ones too." A player switching clients has a version they play, the mods
 * they added, and — in Lunar's case — a list of waypoints, and until this
 * date the button on Profiles said all of that was "on its way". Now
 * `scan()` reads every launcher it knows the shape of and answers with what
 * it found, grouped by launcher, and `bring(keys)` turns the rows the player
 * ticked into BlueClient profiles: the version and loader, the memory the
 * player gave it, the mods matched to Modrinth by the jar's own hash so the
 * launcher can keep them updated, the jars Modrinth does not know copied
 * into the profile's folder as they are, and Lunar's waypoints merged into
 * the shared waypoint file every profile reads.
 *
 * Two rules from the rest of main:
 * - **The renderer never hands this module a path.** A row is named by a key
 *   this module made up (`lunar:1.21/fabric-1.21.11`), and `bring` finds the
 *   row again by scanning, so nothing the page says can point at a folder.
 * - **Nothing is moved, only copied.** The other launcher keeps everything;
 *   the point is that the player can go back.
 *
 * What each launcher keeps, as found on this PC (Adrian has all four clients
 * installed) or in the launcher's own documentation:
 * - Lunar: `~/.lunarclient/db/profiles.db` — an SQLite database (read by
 *   `./sqlite`, since 2026-09-18), one row per profile with its kind, its
 *   Minecraft, its loader and its folder under `profiles/`; see `readLunar`
 *   for where each kind keeps its jars. Before the database (Lunar 3.6 and
 *   older, or one this cannot read) the folder shape alone:
 *   `profiles/<name>/mods/<loader>-<version>/*.jar`. `settings/game/
 *   waypoints.json` — every waypoint, keyed `mp:<server>` / `sp:<world>`.
 *   Lunar's "profiles" in its in-game menus are HUD layouts and are not
 *   profiles in this sense.
 * - Dawn (Feather until 2026 — same client, `~/.dawn` now, `~/.feather`
 *   before): `profiles/<id>/profile.json` (name, Minecraft version, loader
 *   and its version, the memory given), and the game folder beside it —
 *   `.minecraft/`, or `private-game-content/` for a profile in an auto-sync
 *   group — whose `mods/` holds the jars, `.jar.disabled` for one switched
 *   off. `dawn-client.jar` is the client itself and never comes.
 * - FastClient: `%APPDATA%/FastClient/profiles.json` (name, version, loader,
 *   memory) and `%APPDATA%/.fastclient/profiles/<id>/mods/`; the client's own
 *   `fastclient-hud-*.jar` never comes.
 * - The Minecraft launcher: `.minecraft/launcher_profiles.json`, every
 *   profile that is not one of the two built-in "Latest" ones; the version
 *   id says the loader (`fabric-loader-0.16.9-1.21.4`).
 * - Prism, MultiMC, PolyMC: `instances/<dir>/mmc-pack.json` (components
 *   name the game and the loader) and `instance.cfg` (the name).
 * - CurseForge: `Instances/<dir>/minecraftinstance.json`.
 * - ATLauncher: `instances/<dir>/instance.json`.
 * - The Modrinth App, and anything else: a folder that looks like a game
 *   (`game/settings.js`'s own rule) with jars in `mods/`, its version and
 *   loader read off the first line Fabric writes in `logs/latest.log`.
 *
 * A Forge, NeoForge or Quilt instance is offered too, as the version alone:
 * BlueClient runs Fabric and Vanilla and nothing else, and the row says so
 * rather than leaving the player to find out at Play.
 *
 * **Import settings (2026-09-17).** Every row knows the game folder its
 * launcher plays from (`game`), and with the panel's one switch on, `bring`
 * takes that folder's settings into the new profile as well — keybinds,
 * video settings, the server list, the mod configs, the resource and shader
 * packs (`settings.takeFrom`) — so a profile brought over from Lunar opens on
 * Lunar's keys and Lunar's servers. Off, the new profile is seeded at its
 * first launch like any other. Lunar plays its own profiles from `.minecraft`,
 * the folder the Minecraft launcher keeps, so those rows point there; a
 * modpack installed through Lunar from Modrinth or CurseForge keeps its mod
 * configs a level under its game folder, so a row may also name `config` —
 * where the mods' settings are when they are not at `<game>/config`.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const pairing = require('./pairing');
const sqlite = require('./sqlite');
const { elsewhere, labelFor, sharedDirIn, takeFrom } = require('./settings');

/* ------------------------------------------------------------- helpers */

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function home() { return os.homedir(); }
function appData() {
  return process.env.APPDATA || (process.platform === 'darwin'
    ? path.join(home(), 'Library', 'Application Support')
    : path.join(home(), '.config'));
}
function dotMinecraft() {
  if (process.platform === 'win32') return path.join(appData(), '.minecraft');
  if (process.platform === 'darwin') return path.join(home(), 'Library', 'Application Support', 'minecraft');
  return path.join(home(), '.minecraft');
}

async function isDir(p) { try { return (await fsp.stat(p)).isDirectory(); } catch { return false; } }
async function isFile(p) { try { return (await fsp.stat(p)).isFile(); } catch { return false; } }
async function readJson(p) { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return null; } }
async function readText(p) { try { return await fsp.readFile(p, 'utf8'); } catch { return ''; } }
async function dirs(p) {
  try { return (await fsp.readdir(p, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
}

/** The jars in a mods folder: `{ file, disabled }`, the client's own jars left out. */
async function jarsIn(folder, ownJars = []) {
  let names;
  try { names = await fsp.readdir(folder); } catch { return []; }
  const out = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    const disabled = lower.endsWith('.jar.disabled');
    if (!lower.endsWith('.jar') && !disabled) continue;
    if (ownJars.some((own) => lower.startsWith(own))) continue;
    out.push({ file: path.join(folder, name), name, disabled });
  }
  return out;
}

/** Which of the two loaders BlueClient runs, or the one it does not. */
function loaderOf(word) {
  const w = String(word || '').toLowerCase();
  if (!w || w === 'vanilla' || w === 'none') return 'vanilla';
  if (w.includes('fabric')) return 'fabric';
  if (w.includes('neoforge')) return 'neoforge';
  if (w.includes('forge')) return 'forge';
  if (w.includes('quilt')) return 'quilt';
  return 'vanilla';
}

const RELEASE = /^(\d+\.\d+(?:\.\d+)?)$/;

/** A row of the scan: one thing the player can tick. */
function row(launcher, key, fields) {
  const loader = fields.loader || 'vanilla';
  const runs = loader === 'vanilla' || loader === 'fabric';
  return {
    key: `${launcher.id}:${key}`,
    launcher: launcher.id,
    launcherLabel: launcher.label,
    kind: 'profile',
    name: fields.name,
    version: fields.version,
    loader,
    /* What the row becomes here: a loader BlueClient does not run comes over
       as the version alone, and the row says so. */
    imports: runs ? loader : 'vanilla',
    loaderVersion: runs ? (fields.loaderVersion || '') : '',
    memoryMb: fields.memoryMb || null,
    /* The folder that launcher plays this profile from: where its options.txt
       and servers.dat are. Never handed to the renderer. */
    game: fields.game || '',
    /* The mods' own settings, when they are not at `<game>/config`. */
    config: fields.config || '',
    jars: runs ? (fields.jars || []) : [],
    leftBehind: runs ? 0 : (fields.jars || []).length,
    note: runs ? '' : `${capitalise(loader)} — BlueClient runs Fabric, so this comes over as plain Minecraft ${fields.version}`
  };
}

function capitalise(word) { return word ? word[0].toUpperCase() + word.slice(1) : ''; }

/* -------------------------------------------------------------- readers */

const LUNAR = { id: 'lunar', label: 'Lunar Client' };
const DAWN = { id: 'dawn', label: 'Dawn (Feather)' };
const FAST = { id: 'fastclient', label: 'FastClient' };
const VANILLA = { id: 'minecraft', label: 'the Minecraft launcher' };
const PRISM = { id: 'prism', label: 'Prism Launcher' };
const CURSE = { id: 'curseforge', label: 'CurseForge' };
const AT = { id: 'atlauncher', label: 'ATLauncher' };

/**
 * Lunar's profiles, from its database (2026-09-18). Adrian: "many people use
 * a profile as a 'modpack' which doesn't register in blueclient import atm."
 * Until this date the reader knew one shape — `profiles/<name>/mods/<loader>-
 * <version>/` — which is only how Lunar's own built-in profiles keep their
 * jars; a profile the player made, or a modpack installed through Lunar's
 * Explore tab, keeps them elsewhere and was invisible. Lunar 3.7 writes every
 * profile as a row of `db/profiles.db`, and its own launcher code (read out
 * of its app.asar on this date) says where each kind's files are:
 *
 * - The game folder is `game_directory` when set, else `profiles/<path>`.
 *   Lunar's built-ins (`lunar`, `badlion`) set it to `.minecraft`; every
 *   other kind is a self-contained folder like a Prism instance.
 * - The mods are `mods_directory` when set, else `<game>/mods` — and **only
 *   the `lunar` kind adds the `<loader>-<version>` folder under that**.
 * - A `modrinth` or `curseforge` modpack keeps the installed version's mods
 *   and config one level down, `profiles/<path>/versions/<v>/` — `v` the
 *   Modrinth version number or the CurseForge file id, made safe for a
 *   folder name the way Lunar does it (`lunarVersionFolder`) — while its
 *   `options.txt`, `servers.dat` and packs stay in the game folder.
 * - A `user-modpack` — the row Adrian means — is the plain case: its name,
 *   its version, its loader, the jars in `<game>/mods`.
 * - `lunar_module` names the loader (`fabric`, `vanilla-fabric`, `forge`,
 *   `vanilla`…); `allocated_memory` and `loader_version` are per-profile
 *   overrides, null unless the player set one — Lunar's launcher-wide memory
 *   figure is its default, not a choice, and is not carried.
 *
 * A row whose folder never appeared (a version clicked past in Lunar's own
 * menu, saved but never played) is nothing to bring, and neither is one of
 * Lunar's own cards with no jars and no settings in it. A Lunar with no
 * database, or one this cannot read, falls back to the folder scan.
 */
async function readLunar() {
  const root = path.join(home(), '.lunarclient');
  if (!await isDir(root)) return [];
  let out = null;
  try { out = await lunarFromDatabase(root); } catch { out = null; }
  if (!out) out = await lunarFromFolders(root);
  const points = await lunarWaypoints(root);
  if (points.length) {
    const worlds = new Set(points.map((p) => p.world)).size;
    out.push({
      key: 'lunar:waypoints', launcher: LUNAR.id, launcherLabel: LUNAR.label, kind: 'waypoints',
      name: 'Waypoints', count: points.length,
      note: `${points.length} waypoint${points.length === 1 ? '' : 's'} across ${worlds} world${worlds === 1 ? '' : 's'} — into BlueClient's own list`
    });
  }
  return out;
}

/** The kinds Lunar's database knows that are a modpack in the player's sense. */
const LUNAR_MODPACK = new Set(['user-modpack', 'modrinth', 'curseforge']);

async function lunarFromDatabase(root) {
  const file = path.join(root, 'db', 'profiles.db');
  if (!await isFile(file)) return null;
  const db = await sqlite.open(file);
  const profiles = db.rows('profiles');
  let versions = [];
  try { versions = db.rows('modpack_version'); } catch { /* an older database without the table */ }
  const out = [];
  for (const p of profiles) {
    if (!p || !p.id || !p.path || !p.game_version) continue;
    const slug = String(p.path);
    const folder = path.join(root, 'profiles', slug);
    if (!await isDir(folder)) continue;
    const version = String(p.game_version);
    if (!RELEASE.test(version)) continue;
    const type = String(p.type || 'lunar');
    const game = p.game_directory ? String(p.game_directory) : folder;
    let mods = p.mods_directory ? String(p.mods_directory) : path.join(game, 'mods');
    let config = '';
    let loaders = [];
    try { loaders = JSON.parse(p.loaders || '[]'); } catch { loaders = []; }
    const word = p.lunar_module ? String(p.lunar_module) : (Array.isArray(loaders) ? loaders.find((l) => l !== 'ichor') : '') || '';
    const loader = loaderOf(word);
    if (type === 'lunar') {
      mods = path.join(mods, `${['fabric', 'forge', 'neoforge', 'quilt'].includes(loader) ? loader : 'ichor'}-${version}`);
    } else if (type === 'modrinth' || type === 'curseforge') {
      const label = lunarSelectedVersion(p, type, versions);
      if (label) {
        const vdir = path.join(folder, 'versions', lunarVersionFolder(label));
        if (await isDir(vdir)) {
          mods = path.join(vdir, 'mods');
          config = path.join(vdir, 'config');
        }
      }
    }
    const modpack = LUNAR_MODPACK.has(type);
    const jars = loader === 'vanilla' ? [] : await jarsIn(mods);
    // Lunar makes a card of its own for every version the player clicks; one
    // with no jars and no settings brings nothing and takes no switch. A
    // modpack the player named is theirs, however empty.
    if (!modpack && !jars.length && !(await hasSettings(game, config))) continue;
    const name = modpack
      ? String(p.name || slug).trim().slice(0, 40) || slug
      : type === 'vanilla' ? `Vanilla ${version} (Lunar)` : `Lunar ${version}`;
    out.push(row(LUNAR, String(p.id), {
      name, version, loader,
      loaderVersion: p.loader_version ? String(p.loader_version) : '',
      memoryMb: Number(p.allocated_memory) > 0 ? Number(p.allocated_memory) : null,
      jars, game, config
    }));
  }
  return out;
}

/**
 * Which version of a Modrinth or CurseForge modpack is installed: the one the
 * profile's own JSON column names (`selectedVersion`), else the row marked
 * selected in `modpack_version`. Modrinth's folder is the version number,
 * CurseForge's the file id — as Lunar's `by()` builds the path.
 */
function lunarSelectedVersion(p, type, versions) {
  let json = null;
  try { json = JSON.parse(p[type] || 'null'); } catch { json = null; }
  const selected = json && json.selectedVersion;
  if (type === 'modrinth' && selected && selected.versionNumber) return String(selected.versionNumber);
  if (type === 'curseforge' && selected && selected.fileId != null) return String(selected.fileId);
  const row = versions.find((v) => v && v.profile_id === p.id && v.is_selected);
  if (!row) return '';
  return String(type === 'modrinth' ? row.version_label : row.version_id);
}

/**
 * Lunar's own folder name for a modpack version (its `zde`): the characters a
 * folder cannot carry replaced, a Windows-reserved or dotted name prefixed,
 * and a name that changed tagged with the original's hash.
 */
function lunarVersionFolder(label) {
  const t = String(label).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(t.split('.')[0] || '');
  const r = !t || t.startsWith('.') || reserved ? `_${t}` : t;
  return r === label ? label : `${r}-${crypto.createHash('sha1').update(String(label)).digest('hex').slice(0, 8)}`;
}

/** The reader as it was before the database: one row per `profiles/<name>/mods/<loader>-<version>`. */
async function lunarFromFolders(root) {
  const out = [];
  for (const name of await dirs(path.join(root, 'profiles'))) {
    const mods = path.join(root, 'profiles', name, 'mods');
    for (const sub of await dirs(mods)) {
      // fabric-1.21.11, forge-1.8.9, vanilla-1.21.4
      const m = /^([a-z]+)-(\d+\.\d+(?:\.\d+)?)$/i.exec(sub);
      if (!m) continue;
      const jars = await jarsIn(path.join(mods, sub));
      out.push(row(LUNAR, `${name}/${sub}`, {
        name: name.toLowerCase() === 'default' ? `Lunar ${m[2]}` : `${name} (Lunar)`,
        version: m[2],
        loader: loaderOf(m[1]),
        jars,
        game: dotMinecraft()
      }));
    }
  }
  return out;
}

/** The 16 dye colours, in the id order the mod's waypoint file uses. */
const DYES = [
  [0xf9, 0xff, 0xfe], [0xf9, 0x80, 0x1d], [0xc7, 0x4e, 0xbd], [0x3a, 0xb3, 0xda],
  [0xfe, 0xd8, 0x3d], [0x80, 0xc7, 0x1f], [0xf3, 0x8b, 0xaa], [0x47, 0x4f, 0x52],
  [0x9d, 0x9d, 0x97], [0x16, 0x9c, 0x9c], [0x89, 0x32, 0xb8], [0x3c, 0x44, 0xaa],
  [0x83, 0x54, 0x32], [0x5e, 0x7c, 0x16], [0xb0, 0x2e, 0x26], [0x1d, 0x1d, 0x21]
];
function nearestDye(rgb) {
  const r = (rgb >> 16) & 255; const g = (rgb >> 8) & 255; const b = rgb & 255;
  let best = 3; let score = Infinity;
  DYES.forEach(([dr, dg, db], i) => {
    const d = (dr - r) ** 2 + (dg - g) ** 2 + (db - b) ** 2;
    if (d < score) { score = d; best = i; }
  });
  return best;
}

/**
 * Lunar's waypoints as the mod's own records. `mp:<address>` is a server and
 * `sp:<name>` a singleplayer save, which is exactly the split the mod keys
 * its file by; a death marker Lunar drops by itself is left out, and a
 * dimension Lunar names by a number is the overworld unless it is the two
 * classic ids. The colour is the nearest of the sixteen dyes.
 */
async function lunarWaypoints(root) {
  const json = await readJson(path.join(root, 'settings', 'game', 'waypoints.json'));
  const table = json && json.waypoints && typeof json.waypoints === 'object' ? json.waypoints : null;
  if (!table) return [];
  const out = [];
  for (const [where, groups] of Object.entries(table)) {
    const m = /^(mp|sp):(.+)$/.exec(where);
    if (!m || !groups || typeof groups !== 'object') continue;
    const world = m[1] === 'mp' ? `server:${m[2]}` : `world:${m[2]}`;
    for (const named of Object.values(groups)) {
      if (!named || typeof named !== 'object') continue;
      for (const [name, wp] of Object.entries(named)) {
        const loc = wp && wp.location;
        if (!loc || typeof loc.x !== 'number' || wp.isDeathWaypoint) continue;
        const dim = wp.dimension === -1 ? 'minecraft:the_nether' : wp.dimension === 1 ? 'minecraft:the_end' : 'minecraft:overworld';
        const rgb = Number(wp.renderConfig && wp.renderConfig.color && wp.renderConfig.color.value);
        out.push({
          world,
          point: {
            name: String(name).slice(0, 48) || 'Waypoint',
            x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z),
            color: Number.isFinite(rgb) ? nearestDye(rgb) : 3,
            dimension: dim,
            visible: wp.visible !== false,
            style: wp.renderConfig && wp.renderConfig.highlightBlock && !wp.renderConfig.showBeam ? 'block' : 'beam',
            highlight: Boolean(wp.renderConfig && wp.renderConfig.highlightBlock && !wp.renderConfig.showBeam)
          }
        });
      }
    }
  }
  return out;
}

async function readDawn() {
  const out = [];
  for (const root of [path.join(appData(), '.dawn'), path.join(appData(), '.feather')]) {
    const profiles = path.join(root, 'profiles');
    if (!await isDir(profiles)) continue;
    for (const id of await dirs(profiles)) {
      const dir = path.join(profiles, id);
      const json = await readJson(path.join(dir, 'profile.json'));
      const p = json && json.profile;
      if (!p || !p.minecraftVersion) continue;
      // The game folder: its own, or the private half of an auto-sync group.
      let game = path.join(dir, '.minecraft');
      if (!await isDir(game)) game = path.join(dir, 'private-game-content');
      const jars = await jarsIn(path.join(game, 'mods'), ['dawn-client', 'feather-client']);
      const mem = p.settings && p.settings.javaOverrides && p.settings.javaOverrides.memoryAllocationMiB;
      out.push(row(DAWN, id, {
        name: String(p.name || id).slice(0, 40),
        version: String(p.minecraftVersion),
        loader: loaderOf(p.loader && p.loader.kind),
        loaderVersion: p.loader && p.loader.version ? String(p.loader.version) : '',
        memoryMb: mem && mem.enabled && Number(mem.value) > 0 ? Number(mem.value) : null,
        jars,
        game
      }));
    }
  }
  return out;
}

async function readFastClient() {
  const json = await readJson(path.join(appData(), 'FastClient', 'profiles.json'));
  const list = json && Array.isArray(json.profiles) ? json.profiles : [];
  const out = [];
  for (const p of list) {
    if (!p || !p.id || !p.version) continue;
    const game = path.join(appData(), '.fastclient', 'profiles', String(p.id));
    const jars = await jarsIn(path.join(game, 'mods'), ['fastclient-hud', 'fastclient-']);
    out.push(row(FAST, String(p.id), {
      name: String(p.name || p.id).slice(0, 40),
      version: String(p.version),
      loader: loaderOf(p.modLoader),
      loaderVersion: p.loaderVersion ? String(p.loaderVersion) : '',
      memoryMb: Number(p.memory) > 0 ? Number(p.memory) : null,
      jars,
      game
    }));
  }
  return out;
}

async function readVanilla() {
  const root = dotMinecraft();
  const json = await readJson(path.join(root, 'launcher_profiles.json'));
  const table = json && json.profiles && typeof json.profiles === 'object' ? json.profiles : null;
  if (!table) return [];
  const out = [];
  for (const [id, p] of Object.entries(table)) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'latest-release' || p.type === 'latest-snapshot') continue;
    const versionId = String(p.lastVersionId || '');
    // "1.21.4", "fabric-loader-0.16.9-1.21.4", "1.21.4-forge-…", "neoforge-…"
    let loader = 'vanilla'; let version = ''; let loaderVersion = '';
    let m;
    if ((m = /^fabric-loader-([\d.]+)-(.+)$/.exec(versionId))) { loader = 'fabric'; loaderVersion = m[1]; version = m[2]; }
    else if ((m = /^quilt-loader-([\d.]+)-(.+)$/.exec(versionId))) { loader = 'quilt'; version = m[2]; }
    else if ((m = /^(.+?)-forge-/.exec(versionId))) { loader = 'forge'; version = m[1]; }
    else if (/neoforge/i.test(versionId)) { loader = 'neoforge'; version = versionId.replace(/^neoforge-/, '').split('-')[0]; }
    else version = versionId;
    if (!RELEASE.test(version)) continue;
    const game = p.gameDir ? String(p.gameDir) : root;
    const jars = loader === 'vanilla' ? [] : await jarsIn(path.join(game, 'mods'));
    const xmx = /-Xmx(\d+)([mMgG])/.exec(String(p.javaArgs || ''));
    out.push(row(VANILLA, id, {
      name: String(p.name || version).slice(0, 40) || version,
      version, loader, loaderVersion, jars, game,
      memoryMb: xmx ? Number(xmx[1]) * (/g/i.test(xmx[2]) ? 1024 : 1) : null
    }));
  }
  return out;
}

async function readPrism() {
  const out = [];
  const roots = [
    [path.join(appData(), 'PrismLauncher', 'instances'), PRISM],
    [path.join(home(), '.local', 'share', 'PrismLauncher', 'instances'), PRISM],
    [path.join(appData(), 'PolyMC', 'instances'), { id: 'polymc', label: 'PolyMC' }],
    [path.join(appData(), 'MultiMC', 'instances'), { id: 'multimc', label: 'MultiMC' }],
    [path.join(home(), 'MultiMC', 'instances'), { id: 'multimc', label: 'MultiMC' }]
  ];
  for (const [instances, launcher] of roots) {
    if (!await isDir(instances)) continue;
    for (const dir of await dirs(instances)) {
      const base = path.join(instances, dir);
      const pack = await readJson(path.join(base, 'mmc-pack.json'));
      const components = pack && Array.isArray(pack.components) ? pack.components : null;
      if (!components) continue;
      const find = (uid) => components.find((c) => c && c.uid === uid);
      const mc = find('net.minecraft');
      if (!mc || !mc.version) continue;
      const fabric = find('net.fabricmc.fabric-loader');
      const loader = fabric ? 'fabric' : find('net.minecraftforge') ? 'forge' : find('net.neoforged') ? 'neoforge' : find('org.quiltmc.quilt-loader') ? 'quilt' : 'vanilla';
      const cfg = await readText(path.join(base, 'instance.cfg'));
      const name = (/^name=(.*)$/m.exec(cfg) || [])[1] || dir;
      let game = path.join(base, '.minecraft');
      if (!await isDir(game)) game = path.join(base, 'minecraft');
      out.push(row(launcher, dir, {
        name: name.trim().slice(0, 40), version: String(mc.version), loader,
        loaderVersion: fabric && fabric.version ? String(fabric.version) : '',
        jars: loader === 'vanilla' ? [] : await jarsIn(path.join(game, 'mods')),
        game
      }));
    }
  }
  return out;
}

async function readCurseForge() {
  const instances = path.join(home(), 'curseforge', 'minecraft', 'Instances');
  if (!await isDir(instances)) return [];
  const out = [];
  for (const dir of await dirs(instances)) {
    const base = path.join(instances, dir);
    const json = await readJson(path.join(base, 'minecraftinstance.json'));
    if (!json || !json.gameVersion) continue;
    const loaderName = json.baseModLoader && json.baseModLoader.name ? String(json.baseModLoader.name) : '';
    const loader = loaderOf(loaderName);
    out.push(row(CURSE, dir, {
      name: String(json.name || dir).slice(0, 40), version: String(json.gameVersion), loader,
      loaderVersion: loader === 'fabric' ? loaderName.replace(/^fabric-/, '') : '',
      memoryMb: Number(json.allocatedMemory) > 0 ? Number(json.allocatedMemory) : null,
      jars: loader === 'vanilla' ? [] : await jarsIn(path.join(base, 'mods')),
      game: base
    }));
  }
  return out;
}

async function readATLauncher() {
  const instances = path.join(appData(), 'ATLauncher', 'instances');
  if (!await isDir(instances)) return [];
  const out = [];
  for (const dir of await dirs(instances)) {
    const base = path.join(instances, dir);
    const json = await readJson(path.join(base, 'instance.json'));
    if (!json || !json.id) continue;
    const lv = json.launcher && json.launcher.loaderVersion;
    const loader = loaderOf(lv && lv.type);
    out.push(row(AT, dir, {
      name: String((json.launcher && json.launcher.name) || dir).slice(0, 40), version: String(json.id), loader,
      loaderVersion: loader === 'fabric' && lv && lv.version ? String(lv.version) : '',
      jars: loader === 'vanilla' ? [] : await jarsIn(path.join(base, 'mods')),
      game: base
    }));
  }
  return out;
}

/**
 * Everything else that looks like a game and holds mods — the Modrinth App,
 * whose newer versions keep their list in a database this does not read, and
 * any launcher not named above. Fabric writes its first line into the log
 * ("Loading Minecraft 1.21.11 with Fabric Loader 0.16.14"), which is the
 * version and the loader in one place. A folder a reader above already
 * claimed is skipped, and so is `.minecraft` itself (the vanilla reader's).
 */
async function readOthers(claimed) {
  const out = [];
  let folders;
  try { folders = await elsewhere(); } catch { folders = []; }
  for (const folder of folders) {
    const norm = path.resolve(folder).toLowerCase();
    if (claimed.has(norm) || norm === path.resolve(dotMinecraft()).toLowerCase()) continue;
    if (/[\\/]\.lunarclient[\\/]|[\\/]\.dawn[\\/]|[\\/]\.feather[\\/]|[\\/]\.fastclient[\\/]|PrismLauncher|PolyMC|MultiMC|curseforge|ATLauncher/i.test(folder)) continue;
    const jars = await jarsIn(path.join(folder, 'mods'));
    if (!jars.length) continue;
    const log = await readText(path.join(folder, 'logs', 'latest.log'));
    const m = /Loading Minecraft (\S+) with Fabric Loader (\S+)/.exec(log.slice(0, 20000));
    if (!m || !RELEASE.test(m[1])) continue;
    const label = labelFor(folder);
    out.push(row({ id: 'other', label: label === 'another launcher' ? 'Another launcher' : label }, crypto.createHash('sha1').update(norm).digest('hex').slice(0, 12), {
      name: `${path.basename(path.dirname(folder)) === 'profiles' || path.basename(folder) === '.minecraft' ? path.basename(path.dirname(folder)) : path.basename(folder)}`.slice(0, 40),
      version: m[1], loader: 'fabric', loaderVersion: m[2], jars, game: folder
    }));
  }
  return out;
}

/* ----------------------------------------------------------------- scan */

/**
 * Everything on this PC that could become a profile, grouped by launcher.
 * Quick — a few folder listings — and read again by `bring`, so a row is
 * only ever a key and never a path in the renderer's hands.
 */
async function scan() {
  const rows = [];
  const claimed = new Set();
  for (const read of [readLunar, readDawn, readFastClient, readVanilla, readPrism, readCurseForge, readATLauncher]) {
    try {
      for (const r of await read()) {
        rows.push(r);
        for (const j of r.jars || []) claimed.add(path.resolve(path.dirname(path.dirname(j.file))).toLowerCase());
      }
    } catch {
      // One launcher's folder in an unexpected shape must not hide the others.
    }
  }
  try { rows.push(...await readOthers(claimed)); } catch { /* same */ }
  for (const r of rows) r.settings = await hasSettings(r.game, r.config);

  const groups = [];
  for (const r of rows) {
    let g = groups.find((x) => x.launcher === r.launcher && x.label === r.launcherLabel);
    if (!g) groups.push(g = { launcher: r.launcher, label: r.launcherLabel, rows: [] });
    g.rows.push(publicRow(r));
  }
  return { groups };
}

/**
 * Whether a game folder holds settings worth bringing: the game's own file, a
 * server list, or mod settings — `<game>/config`, or the folder a row names
 * as `config` — with anything in it (a modpack the player never launched in
 * Lunar still has its pack's configs, and they are what makes it the pack).
 */
async function hasSettings(game, config = '') {
  if (!game) return false;
  if ((await isFile(path.join(game, 'options.txt'))) || (await isFile(path.join(game, 'servers.dat')))) return true;
  const dir = config || path.join(game, 'config');
  try { return (await fsp.readdir(dir)).length > 0; } catch { return false; }
}

/** What the renderer is told about a row: no path in it. */
function publicRow(r) {
  if (r.kind === 'waypoints') return { key: r.key, launcher: r.launcher, kind: 'waypoints', name: r.name, note: r.note, count: r.count };
  return {
    key: r.key, launcher: r.launcher, kind: 'profile', name: r.name, version: r.version, loader: r.loader, imports: r.imports,
    mods: r.jars.length, disabled: r.jars.filter((j) => j.disabled).length, leftBehind: r.leftBehind,
    memoryMb: r.memoryMb, note: r.note, settings: Boolean(r.settings)
  };
}

/* ---------------------------------------------------------------- bring */

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

/**
 * The rows named by `keys`, brought over. Answers the profile records for the
 * renderer to adopt (the jars already copied into `instances/<id>/mods`) and
 * a count of what happened, in the words the toast uses.
 *
 * `modrinth` is handed in — `byHashes` and `projects` — so the matching can
 * be driven under plain node in tools/check-import.js. `settings` is the
 * panel's switch: with it on, each profile also takes its launcher's
 * settings (see the header), and `settings` in the answer counts how many did.
 */
async function bring(keys, { instances, modrinth, settings = false }) {
  const wanted = new Set(Array.isArray(keys) ? keys.map(String) : []);
  const rows = [];
  for (const read of [readLunar, readDawn, readFastClient, readVanilla, readPrism, readCurseForge, readATLauncher]) {
    try { rows.push(...await read()); } catch { /* as in scan */ }
  }
  try {
    const claimed = new Set(rows.flatMap((r) => (r.jars || []).map((j) => path.resolve(path.dirname(path.dirname(j.file))).toLowerCase())));
    rows.push(...await readOthers(claimed));
  } catch { /* as in scan */ }

  const picked = rows.filter((r) => wanted.has(r.key));
  const profiles = [];
  let matched = 0; let copied = 0; let waypoints = 0; let leftBehind = 0; let took = 0;

  for (const r of picked) {
    if (r.kind === 'waypoints') {
      waypoints += await mergeWaypoints(instances, await lunarWaypoints(path.join(home(), '.lunarclient')));
      continue;
    }
    const id = uid();
    const mods = [];
    leftBehind += r.leftBehind;
    if (settings && await hasSettings(r.game, r.config)) {
      try {
        await takeFrom(r.game, path.join(instances, id), { packs: true, config: r.config || null });
        took++;
      } catch { /* a folder that cannot be read: the profile still comes, seeded at its first launch */ }
    }
    if (r.jars.length) {
      const hashes = new Map();
      for (const j of r.jars) {
        try { hashes.set(j, await sha1File(j.file)); } catch { /* unreadable: copied as-is below */ }
      }
      const known = await lookUp(modrinth, [...hashes.values()]);
      const seen = new Set();
      for (const j of r.jars) {
        const hit = known.get(hashes.get(j));
        if (hit && hit.slug && !seen.has(hit.slug)) {
          seen.add(hit.slug);
          mods.push({
            id: uid(), enabled: !j.disabled, version: 'latest', source: 'modrinth',
            slug: hit.slug, name: hit.name || hit.slug, author: '', description: '', iconUrl: ''
          });
          matched++;
        } else if (!hit) {
          // Not on Modrinth: the jar itself, as it is, into the profile's own
          // folder. A launch leaves a jar it did not put there alone, and
          // since 2026-09-19 the Mods page lists it as a card of its own —
          // "From Lunar Client", off if it came over as `.jar.disabled` —
          // with the same switch as the rest (game/mods.js, `local`).
          const folder = path.join(instances, id, 'mods');
          await fsp.mkdir(folder, { recursive: true });
          try {
            await fsp.copyFile(j.file, path.join(folder, j.name));
            copied++;
          } catch { /* a jar that cannot be read is a jar that stays behind */ }
        }
      }
    }
    profiles.push({
      id, name: r.name, icon: 'grass', version: r.version, loader: r.imports, loaderVersion: r.loaderVersion,
      memoryMb: r.memoryMb, lastPlayed: null, installed: false, mods,
      imported: { from: r.launcherLabel, at: Date.now() }
    });
  }
  return { profiles, matched, copied, waypoints, leftBehind, settings: took };
}

/** Modrinth's answer for a set of sha1s: hash → { slug, name }. Empty when it cannot be asked. */
async function lookUp(modrinth, hashes) {
  const out = new Map();
  if (!modrinth || !hashes.length) return out;
  let byHash;
  try { byHash = await modrinth.byHashes(hashes); } catch { return out; }
  if (!byHash || !byHash.ok) return out;
  const ids = [...new Set(Object.values(byHash.versions).map((v) => v.projectId).filter(Boolean))];
  let projects = {};
  try {
    const answer = await modrinth.projects(ids);
    if (answer && answer.ok) projects = answer.projects;
  } catch { /* the slug is what the launcher keeps; without it a match is no match */ }
  for (const [hash, v] of Object.entries(byHash.versions)) {
    const p = projects[v.projectId];
    if (p && p.slug) out.set(hash, { slug: p.slug, name: p.name });
  }
  return out;
}

/**
 * Lunar's waypoints into the shared waypoint file the mod reads
 * (`_shared/config/blueclient-waypoints.json`, which the settings sync
 * carries into every profile). A point already there — same world, same
 * name, same block — is not added twice, so importing twice is harmless.
 */
async function mergeWaypoints(instances, points) {
  if (!points.length) return 0;
  const dir = path.join(sharedDirIn(instances), 'config');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'blueclient-waypoints.json');
  const root = (await readJson(file)) || {};
  let added = 0;
  for (const { world, point } of points) {
    if (!Array.isArray(root[world])) root[world] = [];
    const twin = root[world].some((p) => p && p.name === point.name && p.x === point.x && p.y === point.y && p.z === point.z);
    if (twin) continue;
    root[world].push(point);
    added++;
  }
  if (added) {
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(root, null, 2));
    await fsp.rename(tmp, file);
  }
  return added;
}

module.exports = { scan, bring, lunarWaypoints, nearestDye, loaderOf };
