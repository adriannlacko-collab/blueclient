'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only surface the UI can reach. Context isolation is on and node
 * integration is off, so the renderer gets this explicit list of calls and
 * nothing else — no `require`, no filesystem, no process.
 */
const api = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onStateChange: (handler) => subscribe('window:state', handler)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    merge: (patch) => ipcRenderer.invoke('settings:merge', patch),
    reset: () => ipcRenderer.invoke('settings:reset'),
    /* Which profiles share their in-game settings (2026-09-17): profile id
       to group, for the ones in a group. `link` syncs a profile with
       another — it takes the other's settings and follows them from then
       on — and `leave` stops that. Both answer the fresh map. */
    groups: () => ipcRenderer.invoke('settings:groups'),
    link: (profileId, targetId) => ipcRenderer.invoke('settings:link', profileId, targetId),
    leave: (profileId) => ipcRenderer.invoke('settings:leave', profileId)
  },

  system: {
    info: () => ipcRenderer.invoke('system:info')
  },

  /* The launcher updates itself; `check` is only the corner of Home asking
     what stage that is at, and `install` is the player saying "now" rather
     than waiting for the next time they close it. */
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (handler) => subscribe('update:state', handler),
    /* "Get updates early" was flipped: look now. And the one sentence about
       this release, shown once beside the version line (2026-09-11). */
    recheck: () => ipcRenderer.invoke('update:recheck'),
    news: () => ipcRenderer.invoke('update:news'),
    newsSeen: () => ipcRenderer.invoke('update:news-seen')
  },

  shell: {
    pickDirectory: () => ipcRenderer.invoke('shell:pick-directory'),
    pickJava: () => ipcRenderer.invoke('shell:pick-java'),
    openPath: (target) => ipcRenderer.invoke('shell:open-path', target),
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url)
  },

  /* What the game saved: clips on F8 and screenshots on F2. List them, open
     one, show it in its folder, copy it for a paste into Discord, or bin it. */
  ledger: {
    recent: (limit) => ipcRenderer.invoke('ledger:recent', limit),
    summary: () => ipcRenderer.invoke('ledger:summary'),
    snapshot: (rect) => ipcRenderer.invoke('ledger:snapshot', rect)
  },

  clips: {
    list: () => ipcRenderer.invoke('clips:list'),
    open: (file) => ipcRenderer.invoke('clips:open', file),
    reveal: (file) => ipcRenderer.invoke('clips:reveal', file),
    folder: () => ipcRenderer.invoke('clips:folder'),
    copy: (file) => ipcRenderer.invoke('clips:copy', file),
    remove: (file) => ipcRenderer.invoke('clips:remove', file),
    /* The star on the card, on or off (2026-09-19); the list says
       `favourite` on each clip. */
    favourite: (file, on) => ipcRenderer.invoke('clips:favourite', file, on),
    /* A clip's still, made after the list answered — { name, still }. */
    onStill: (handler) => subscribe('clips:still', handler)
  },

  /* The pictures the game saved on F2, from every profile's own screenshots
     folder. A picture is named "<profile>/<file>" and never by a path. */
  shots: {
    list: () => ipcRenderer.invoke('shots:list'),
    open: (id) => ipcRenderer.invoke('shots:open', id),
    reveal: (id) => ipcRenderer.invoke('shots:reveal', id),
    folder: () => ipcRenderer.invoke('shots:folder'),
    copy: (id) => ipcRenderer.invoke('shots:copy', id),
    remove: (id) => ipcRenderer.invoke('shots:remove', id),
    favourite: (id, on) => ipcRenderer.invoke('shots:favourite', id, on)
  },

  modrinth: {
    search: (opts) => ipcRenderer.invoke('modrinth:search', opts),
    icon: (url) => ipcRenderer.invoke('modrinth:icon', url),
    project: (slug) => ipcRenderer.invoke('modrinth:project', slug)
  },

  /* Resource packs (2026-09-09): the set of one profile — its own, or its
     sync group's (2026-09-17) — so every call names the profile. A pack is
     named by its file name and never by a path. */
  packs: {
    list: (profileId) => ipcRenderer.invoke('packs:list', profileId),
    add: (profileId, pack) => ipcRenderer.invoke('packs:add', profileId, pack),
    remove: (profileId, file) => ipcRenderer.invoke('packs:remove', profileId, file),
    toggle: (profileId, file, on) => ipcRenderer.invoke('packs:toggle', profileId, file, on),
    folder: (profileId) => ipcRenderer.invoke('packs:folder', profileId)
  },

  /* The jars in a profile's mods folder that the launcher did not put there
     (2026-09-19): dropped in by hand, or copied by Import profiles. Every
     call names the profile; a jar is named by its file name and never by a
     path. Off is the `.jar.disabled` rename, so `localToggle` answers the
     new file name. `folder` opens the profile's own mods folder. */
  mods: {
    local: (profileId) => ipcRenderer.invoke('mods:local', profileId),
    availability: (profileId) => ipcRenderer.invoke('mods:availability', profileId),
    localToggle: (profileId, file, on) => ipcRenderer.invoke('mods:localToggle', profileId, file, on),
    localRemove: (profileId, file) => ipcRenderer.invoke('mods:localRemove', profileId, file),
    folder: (profileId) => ipcRenderer.invoke('mods:folder', profileId)
  },
  servers: {
    status: (addresses) => ipcRenderer.invoke('servers:status', addresses),
    /* The admin site's list — Home's Featured servers (2026-09-11). `list` is
       the copy on disk, at once; `refresh` asks the site when it is stale. */
    list: () => ipcRenderer.invoke('servers:list'),
    refresh: () => ipcRenderer.invoke('servers:refresh'),
    /* The server's logo as a data URL, or null (2026-09-13). */
    icon: (address) => ipcRenderer.invoke('servers:icon', address)
  },

  /* Home's Friends card (2026-09-21): the friends list as the game's own
     screen has it — who, online or not, and where; `add` asks someone to
     be friends by name, as the game's Add friend does; `invite` puts the
     game's invitation on the clipboard for someone without BlueClient. */
  friends: {
    list: () => ipcRenderer.invoke('friends:list'),
    add: (name) => ipcRenderer.invoke('friends:add', name),
    invite: () => ipcRenderer.invoke('friends:invite')
  },

  /* The launcher's background (2026-09-21): the player's own pictures. A
     picture's bytes come back as a buffer for a blob URL; `add` opens the
     file dialog and copies the pick into the launcher's own folder. */
  backgrounds: {
    list: () => ipcRenderer.invoke('backgrounds:list'),
    read: (file) => ipcRenderer.invoke('backgrounds:read', file),
    add: () => ipcRenderer.invoke('backgrounds:add'),
    remove: (file) => ipcRenderer.invoke('backgrounds:remove', file)
  },

  skins: {
    get: (username) => ipcRenderer.invoke('skin:get', username),
    /* The player's own three: read them, put a PNG in one, wear one, empty one. */
    slots: () => ipcRenderer.invoke('skins:slots'),
    pick: (index, variant) => ipcRenderer.invoke('skins:pick', { index, variant }),
    wear: (index) => ipcRenderer.invoke('skins:wear', index),
    variant: (index, variant) => ipcRenderer.invoke('skins:variant', { index, variant }),
    clear: (index) => ipcRenderer.invoke('skins:clear', index),
    /* Browsing: a player's name, or nothing for the popular grid. */
    find: (query, mode) => ipcRenderer.invoke('skins:find', query, mode),
    keep: (index, skin) => ipcRenderer.invoke('skins:keep', { index, skin })
  },

  auth: {
    signIn: () => ipcRenderer.invoke('auth:sign-in'),
    refresh: (account) => ipcRenderer.invoke('auth:refresh', account),
    configured: () => ipcRenderer.invoke('auth:configured'),
    onAccountsChanged: (handler) => subscribe('accounts:changed', handler)
  },

  /* Worlds (2026-09-11): every singleplayer save the launcher can see, and
     their backups. A world is named by its profile id and folder, never a
     path — main checks both against the folders it owns. `onChanged` fires
     when a backup lands (the exit hook's, or a press of Back up now) so a
     card can say so without asking again. */
  worlds: {
    list: () => ipcRenderer.invoke('worlds:list'),
    size: (profileId, folder) => ipcRenderer.invoke('worlds:size', { profileId, folder }),
    backup: (profileId, folder) => ipcRenderer.invoke('worlds:backup', { profileId, folder }),
    backups: (profileId, folder) => ipcRenderer.invoke('worlds:backups', { profileId, folder }),
    restore: (profileId, folder, name) => ipcRenderer.invoke('worlds:restore', { profileId, folder, name }),
    remove: (profileId, folder) => ipcRenderer.invoke('worlds:remove', { profileId, folder }),
    open: (profileId, folder) => ipcRenderer.invoke('worlds:open', { profileId, folder }),
    bring: (profileId, path) => ipcRenderer.invoke('worlds:bring', { profileId, path }),
    onChanged: (handler) => subscribe('worlds:changed', handler)
  },

  /* Several games run at once, so cancel and stop name the session they mean
     and `sessions` is the list of what is running right now. */
  game: {
    launch: (profile) => ipcRenderer.invoke('game:launch', profile),
    cancel: (id) => ipcRenderer.invoke('game:cancel', id),
    stop: (id) => ipcRenderer.invoke('game:stop', id),
    sessions: () => ipcRenderer.invoke('game:sessions'),
    versions: () => ipcRenderer.invoke('game:versions'),
    /* Which Minecraft the in-game half of BlueClient is built for, read from
       the shipped jar so the answer cannot drift from the jar itself. */
    companion: (versions) => ipcRenderer.invoke('game:companion', versions),
    /* The newest release those jars cover — what a first profile is born on. */
    newest: () => ipcRenderer.invoke('game:newest'),
    /* Import profiles: what the other launchers here hold, and bringing the
       ticked rows over (2026-09-16). Rows are keys, never paths. */
    importScan: () => ipcRenderer.invoke('game:import-scan'),
    importBring: (keys, options) => ipcRenderer.invoke('game:import-bring', keys, options || {}),
    /* A deleted profile's folder, to the Recycle Bin; and what every folder
       the launcher owns weighs, for the Storage page. */
    removeInstance: (id) => ipcRenderer.invoke('game:remove-instance', id),
    disk: () => ipcRenderer.invoke('game:disk'),
    /* A crash keeps its row on Home until it is closed (2026-09-11). The list
       of them, closing one, and opening its log, the game's own report or the
       profile's mods folder — by session id, never by path. */
    crashes: () => ipcRenderer.invoke('game:crashes'),
    crashDismiss: (id) => ipcRenderer.invoke('game:crash-dismiss', id),
    crashOpen: (id, which) => ipcRenderer.invoke('game:crash-open', id, which),
    /* The chat logs' folder, opened in Explorer (2026-09-19): a file a day
       the game writes, for Settings → Logs. Main knows the path; none crosses. */
    chatLogs: () => ipcRenderer.invoke('game:chat-logs'),
    onProgress: (handler) => subscribe('game:progress', handler),
    onWarning: (handler) => subscribe('game:warning', handler),
    onStateChange: (handler) => subscribe('game:state-changed', handler)
  }
};

/** Wrap the raw IpcRendererEvent away and hand back an unsubscribe function. */
function subscribe(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('beam', api);
