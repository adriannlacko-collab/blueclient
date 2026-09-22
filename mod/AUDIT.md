# BlueClient in-game mod 1.55.0 — audit

Scope: the ten companion jars of launcher bundle v1.11.0 (`blueclient-<mc>.jar`
for 1.20.6, 1.21.1, 1.21.4, 1.21.5, 1.21.8, 1.21.10, 1.21.11, 26.1.2, 26.2,
26.3). Read from Vineflower 1.11.1 decompiles; 26.3 in full (264 classes,
~29.5k lines), the other nine compared file by file against it (identical
source is noted as "all 10"). Minecraft code referred to was read with `javap`
from the Mojang 26.3 client jar and the intermediary-mapped 1.20.6/1.21.11 jars.

What is on with a fresh `blueclient.json` (constructor `onByDefault`):
FPS, Ping, Coordinates, Armour, Scoreboard, Boss bar, Chat, Waypoints (incl.
"Waypoint on death", which makes a *Last death* beam the first time you die),
Shulker preview, Toggle Sprint, Zoom, Freelook, BlueClient badge, and the
Shaders-category parts (Lighting, Shadows, Clouds, Sky, Water, Air, Wind,
Blocks, Camera, Colour), which only act while the *Shaders* master switch
(off by default) is on. Everything else is off.

Overall: the render path is already in good shape. Chip text, widths,
effects, armour labels, waypoint labels, coordinates and hearts are all
cached against what they depend on; lists are reused; disk writes go through
one background thread (`Disk`, atomic move); network work is on executors
and comes back through `client.execute`. The findings below are what is
left. **F** = fixed by a patch in `mod/patches/`, **U** = not fixed (with the
reason and a concrete fix).

Severity: **High** can stop the game or lose user data; **Medium** visible
misbehaviour or a measurable per-frame cost in a common case; **Low** small
or rare.

---

## Fixed

### F1 — High — bug — a wrong-shaped value in `blueclient.json` crashes the game at start, or wipes the file (all 10)
`com.blueclient.Config` (`register`, `applyFrom`, `enabledIn`, `adopt`, the
five `fold*` migrations, `readSwitchedOn`, `block`, `forget`, `moveBlock`),
`com.blueclient.Presets.adopt`.

* `Config.register` → `Setting.load` runs inside every `Module` constructor,
  i.e. inside `Hud.register()` in `onInitializeClient`, **outside** the
  try/catch in `Config.load`. `Position.load` calls `getAsFloat()` on the
  array members and `Scale.load` on the primitive without checking they are
  numbers, so `"coords.pos": ["x", 0.1]`, `[null, 1]` or `"fps.scale": "big"`
  throws `NumberFormatException`/`UnsupportedOperationException` out of the
  client entrypoint and the game does not start.
* `applyFrom` (preset switch/delete) and `enabledIn` (called by
  `Presets.enabledCount`, i.e. the Presets screen every frame) call
  `getAsBoolean()` on any module value — a `null` there throws on the render
  thread.
* Any type mismatch in the migrations (`getAsJsonObject` on a non-object,
  `getAsBoolean` on `null`, `getAsInt` on a non-number) is caught by `load()`,
  which then sets `root = new JsonObject()`. The next `save()` (any toggle,
  the menu hint, a key rebind) writes that empty root over the user's file:
  every preset, position and setting is gone.

Fix: type-checked accessors (`child`, `isTrue`, `isNumber`), module flags
accepted only as booleans (as `adopt()` already did), every `Setting.load`
wrapped so a bad value keeps the setting's default and logs the key, and an
unreadable file is copied to `blueclient.json.unreadable` before defaults are
used. Nothing about the file format changes; the launcher
(`launcher/src/main/game/settings.js stampKeys/stampFlags`,
`launcher/src/main/stats.js modulesOn`) reads and writes the same keys.

### F2 — Medium — bug — a moved or scaled scoreboard is drawn above its box (all 10)
`ScoreboardModule.vanillaPlace`. The module is drawn by the game itself
inside `ScoreboardMixin` → `Placed.begin`, which maps the game's own position
(`vanillaPlace`) onto the module's position. `vanillaPlace` says the plate's
top is `h/2 - rows*9/2 - 10`, but the game draws it from
`h/2 + rows*9/3 - rows*9 - 10` (checked in `Hud.displayScoreboardSidebar`
26.3 and `class_329` 1.20.6/1.21.11). So once the board is dragged in HUD
Layout (or stacked, or scaled) it is drawn `rows*9/6` px higher than its
outline — 22 px for a 15-line board — and at the top edge its title is cut
off; at the default place the keep-out box other top-right modules stack
against is also off by that much. Fix: the game's formula.

### F3 — Low — bug — width measured on the wrong 15 lines (all 10)
`ScoreboardModule.measure` measured the first 15 non-hidden entries in the
scoreboard's hash order. The game shows the top 15 by
`SCORE_DISPLAY_ORDER` (score descending, then name, case-insensitive). With
more than 15 lines the measured width can belong to lines that are not shown
(box too wide or too narrow → placement off). Fix: sort with the same
comparator when there are more than 15.

### F4 — Low/Medium — perf — scoreboard re-listed and re-measured every frame (all 10)
`ScoreboardModule.nowDrawing` marked the measurement stale on every frame the
sidebar is drawn, so each frame did a second `Scoreboard.listPlayerScores`
(a scan over every score holder on the server), `PlayerTeam.formatNameForTeam`
and two `Font.width` per row, on top of the game's own pass. It is now marked
stale once per client tick (`tick`), and still re-measured at once when the
objective or the level changes. Sidebars are on by default and on most
servers.

### F5 — Low (Medium with shaders on) — perf — `glGetUniformLocation` per uniform per frame (all 10)
`shade.Gl.set/sampler/sampler3D/matrix`. Every uniform set asked the driver
for its location by name: ~45 calls a frame with the cloud/compose/bloom/
finish passes of `Shade`, plus `Saturate` (Colour Saturation) and the clip
recorder's NV12 pack pass. Locations of a linked program never change; they
are now cached per program id and name (fastutil maps, no boxing) and the
entry is dropped in `Gl.delete` and when `Gl.program` receives a recycled id.

### F6 — Low/Medium — perf — a lambda allocated per vertex attribute in the world pass (26.2, 26.3)
`ui.Frames.Recording` (the `Frame.Buffers` 26.2+ hands to modules drawing in
`LevelRenderEvents.COLLECT_SUBMITS`) stored one capturing lambda per
`VertexConsumer` call — six or seven per vertex. A waypoint beam is 32
vertices (~200 objects a frame; the *Last death* beam is on by default after
the first death); the light-level overlay is 24 vertices × 4 calls per dark
block (tens of thousands of objects a frame in a cave); the fallback cloud
mesh the same. Now: opcodes + raw float bits in one `int[]` per layer, reused
two frames later (two alternating sets, so a replay that ran a frame late
still sees its own data), replayed in the same order with the same values.
1.20.6–26.1.2 draw straight into the game's buffers and never had this.

---

## Not fixed

### U1 — Medium (when shaders, Colour Saturation or clipping are on) — perf — synchronous GL state queries every frame (all 10)
`shade.Gl.Saved.save()` (used by `Shade.compose`, `Saturate.apply`,
`clips.Recorder.takeFrame`) reads ~12 + 3×units values with
`glGetInteger/glIsEnabled/glGetBoolean` before each pass;
`Recorder.takeFrame`/`holdPackBuffer` add 5 more. On drivers that run GL on a
worker thread (NVIDIA "threaded optimization", Mesa glthread) each `glGet`
waits for the driver thread to drain: this is a stall, not a lookup, and it
happens every frame. Fix: take the state from the game's own cache
(`GlStateManager` on 1.2x, the renderpearl GL backend on 26.x) instead of the
driver, or set a known state after the pass and invalidate the game's cache.
Not done here: it needs different code per version and would have to be
proven against each version's state tracking.

### U2 — Low/Medium — perf — every particle created boxes its arguments (all 10)
`mixin.ParticleManagerMixin.blueclient$copies` is a `@WrapMethod` on
`ParticleEngine.createParticle`, so every particle (rain splashes, block
breaking, crits…) allocates an `Object[]` and six `Double`s for
`Operation.call`, even with *Custom particles* off (`copies == 1`). Fix: an
`@Inject(at = HEAD, cancellable = true)` that returns `null` for
`copies == 0`, and a separate loop only when `copies > 1`. Needs a mixin
change (kept out of this pass on purpose; see README).

### U3 — Low — perf — every packet allocates in the decoder (all 10, Netty thread)
`mixin.DecoderHandlerMixin` wraps `PacketDecoder.decode` with `@WrapMethod`
(an `Object[3]` + operation per packet) to catch unreadable cosmetic menus.
Off the render thread, but on every packet. Fix: `@WrapOperation` around the
one call that throws, or a try/catch injected at the call site.

### U4 — Low — perf — badge re-wraps the name tag per player per frame (all 10)
`ui.Badges.overHead` / `inTab` build `Component.empty().append(glyph).append(name)`
for every BlueClient player on every frame (and per tab row). Fix: cache the
badged component per UUID keyed on the identity of the incoming name.

### U5 — Low — perf — waypoint labels re-measured every frame (all 10)
`WaypointsModule.label` reuses the cached `MutableComponent` but still calls
`Font.width(line)` every frame per waypoint. Fix: keep the width next to
`Waypoint.label` (transient field) and recompute only when the label is
rebuilt.

### U6 — Low — perf — small per-frame allocations in hot vanilla hooks (all 10)
`BossBarModule.vanillaPlace` allocates `new int[2]` per call (several per
frame while a boss bar shows); `CameraMixin.blueclient$zoomFov` /
`GameRendererMixin.blueclient$zoomFov` box the FOV twice per call;
`DimensionTypeMixin` (RETURN of `getDefaultClockTime`) boxes a `Long`,
`ClientWorldMixin` (RETURN of `EnvironmentAttributeProbe.getValue`, 26.x) and
`WorldWeatherMixin` (`getRainLevel`/`getThunderLevel`) allocate a cancellable
`CallbackInfoReturnable` per call. C2 usually scalar-replaces these, but not
across every call site. Fix: `@ModifyReturnValue` (MixinExtras, already a
dependency) for the RETURN hooks, which needs no `CallbackInfoReturnable`;
return a primitive from `vanillaPlace` callers' own array.

### U7 — Low — hitch — one-time synchronous work on the render thread
`shade.Noise.ensure` builds a 64³ RGBA volume and a 512² map on the render
thread the first frame realistic clouds are drawn (it logs the ms);
`WaypointsModule.ensureLoaded` reads `blueclient-waypoints.json` on the render
thread on first use; `Config.load` / `Ledger.load` read at init (fine). Fix:
build the noise on a worker and upload when ready; read waypoints at join on
the disk thread.

### U8 — Low — leak — textures never released
`skins.OwnSkins.register` registers one `DynamicTexture` per distinct own-skin
hash and never releases it (bounded by the skins seen in a session).
`capes.CapeFrames.cook`: when cooking fails the `Cooked` entry stays in the
LRU with `ready == false`, so that colour set is never retried until it is
evicted. `MinimapModule` keeps its 128² texture for the session (by design).

### U9 — Low — threads — fields shared with worker threads without a happens-before
`ui.Friends.beat` writes the static `waiting` from the friends worker;
`Friends.pull` reads `Play.session()` and `lastMessage` on the worker. Values
are small and eventually consistent, so nothing visible breaks today; making
them `volatile` (or passing them in, as `pull` already does for `near`/`tell`)
would make it correct by construction.

### U10 — Low — stall watcher pauses a slow frame further
`Stall.Patch.sample` calls `Thread.getStackTrace()` on the render thread
every 100 ms while a frame is over 300 ms. Each call is a handshake that
stops the render thread briefly. Bounded (10 reports a session, only on
already-slow frames), so left as is.

### U11 — Low — dead code in the jars
Every jar carries `mixin/ChatHudInvoker`, `mixin/LineWidthMixin` and
`mixin/ServerMessageWrapMixin`, but 1.21.11 and 26.x list none of the three in
`blueclient.mixins.json` and 1.21.10 does not list `ServerMessageWrapMixin`;
the unlisted ones never load. Harmless, a few KB.

### U12 — Low — `Lines.box` allocations (26.2, 26.3; light-level overlay and block waypoints)
Six `float[]` loop arrays and twelve `Vector3f` per box. Unroll the loops and
use the axis-aligned unit normal with `setNormal(Pose, x, y, z)`.

---

## Checked and fine

* Chip modules (FPS, Ping, Coordinates, Clock, Day…): text rebuilt only when
  its inputs change; widths measured only for new strings (`ChipModule`).
* `Hud.render`/`stackDefaults`: reused lists and arrays, no per-frame
  allocation; everything short-circuits without a player.
* Hearts (`Hearts.read`) and health indicators: early-out when the module is
  off; sprites cached.
* Armour/effects/minimap/waypoint text: cached per slot/effect/point.
* Disk: config/stats/waypoints written on one daemon thread with an atomic
  move; flushed on `CLIENT_STOPPING`.
* Network (friends, capes, skins, discover, faithful): HTTP on executors,
  results applied through `client.execute`; `Capes.known` is a
  `ConcurrentHashMap`.
* Clip capture: PBO ring with fences, no `glFinish`/blocking readback.
* Title screen / disconnect: `Hud.render`, `Hud.tick` and the world-pass
  handlers all check `client.player`/`client.level`; the screens that preview
  modules check `level` first. No NPE path found.
* `ZoomModule` FOV: `Camera.calculateFov` is called once a frame on 26.x;
  on 1.2x the hook only acts for `changingFov == true`.
