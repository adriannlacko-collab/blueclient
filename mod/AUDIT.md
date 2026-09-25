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
left. **F** = fixed by a patch in `mod/patches/`, **U** = found in the first
pass and not fixed then; a second pass fixed U1, U4, U5, U8, U12 and part of
U6 (marked "(fixed)" and moved up) and added F7, F8; F9 came from a player report, F10 from a
player's crash log. The rest are listed
under "Not fixed" with the reason and a concrete fix.

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

### U1 (fixed) — Medium (when shaders, Colour Saturation or clipping are on) — perf — synchronous GL state queries every frame (all 10)
Was: `shade.Gl.Saved.save()` (used by `Shade.compose`, `Saturate.apply`,
`clips.Recorder.takeFrame`) read ~12 + 3×units values with
`glGetInteger/glIsEnabled/glGetBoolean` before each pass, and
`Recorder.takeFrame`/`holdPackBuffer` 5 more. On drivers that run GL on a
worker thread (NVIDIA "threaded optimization", Mesa glthread) each `glGet`
waits for that thread to drain: a stall every frame, not a lookup.

Now (`shade.Gl`, `clips.Recorder`, same source on all 10):
* The passes bind their textures on the **last four units** the driver
  offers (`GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS - 4`, at least 16 units, else
  as before) and select a scratch unit while they run. Neither the game (its
  samplers sit on the first dozen or so units) nor a shader pack reaches
  those (units 188–191 on a typical desktop GPU), so none of the
  game's texture bindings is touched and none has to be read or restored.
* `plain()` no longer sets the depth mask and blend equation (they do not
  matter with depth test and blending off), so they need no restoring.
* Afterwards the state is put back from the game's **own record**
  (`GlStateManager`, found reflectively under the Mojang name on 26.x and the
  intermediary names on 1.2x), in four shapes: 1.20.6/1.21.1 (platform
  `GlStateManager`, the main target's framebuffer id, the `Viewport` record,
  `ShaderInstance.lastProgramId`, `BufferUploader.invalidate`); 1.21.4 (read/
  draw framebuffer records); 1.21.5–1.21.11 (`readFbo`/`writeFbo`); 26.x
  (renderpearl `GlStateManager`, `BLEND_ENABLE[]` on 26.3, the per-buffer
  `BlendState[]` on 26.2). Program and vertex array are unbound and the
  game's memory of them cleared where it keeps one.
* It is **proven before it is trusted**: each call site (class) reads the
  state back the old way on its first 8 passes and then once every 1024 and
  compares with what the record says. A mismatch logs once
  (`GL state for … will keep being read back`) and that site stays on the
  old glGet path for the session; a missing field logs what was missing and
  everything stays on the old path.
* The GPU timer query result is read one frame in sixteen.
* The recorder's five pixel-pack reads are proven and trusted the same way
  (`Gl.Packing`).

Verified in game on all 10 versions: every site that ran logged
`GL state for com.blueclient.shade.Saturate is now restored from the game's
own copy, without reading it back` (and `…shade.Shade` where the shader stage
runs, see U13), none logged a mismatch, and the screenshots show the passes'
output and the HUD drawn as usual (llvmpipe runs GL on the calling thread, so
the stall itself cannot be measured there).

### U4 (fixed) — Low — perf — badge re-wrapped the name tag per player per frame (all 10)
`ui.Badges.mark` built `Component.empty().append(glyph).append(name)` (a
component and its sibling list) for every BlueClient player on every frame
and every tab row. It now keeps one badged component per UUID and reuses it
while the incoming name is the same (identity, then `equals`); the table is
cleared past 512 players.

### U5 (fixed) — Low — perf — waypoint labels re-measured every frame (all 10)
`WaypointsModule.label` called `Font.width` on the cached label every frame
per waypoint. The width is now kept with the label (transient
`labelWidth`/`labelFont`, reset wherever the label is rebuilt, re-measured if
the font object changes).

### U6 (partly fixed) — Low — perf — small per-frame allocations in hot vanilla hooks (all 10)
Fixed: `BossBarModule.vanillaPlace` returned a `new int[2]` per call (several
per frame while a boss bar shows); it now fills one array the module owns
(every caller reads it at once).

Not fixed, and not fixable under the rule that injection annotations stay
as they are: the `CallbackInfoReturnable` that Mixin creates for the
cancellable RETURN hooks (`CameraMixin`/`GameRendererMixin.blueclient$zoomFov`,
`DimensionTypeMixin`, `ClientWorldMixin`, `WorldWeatherMixin`) and the boxed
return value in it are made by the injected call, not by the handler. The
handlers themselves only box when they change the value (zooming). Fix, if
the mixins may change: `@ModifyReturnValue` (MixinExtras, already present).

### U8 (fixed) — Low — leak — textures never released, a failed cape set never retried
* `skins.OwnSkins` registered a `DynamicTexture` for every distinct own-skin
  of another player and never released it. They are now released on
  disconnect (`ClientPlayConnectionEvents.DISCONNECT` → render thread →
  the texture manager's release), and the answers are forgotten so the next
  server's players are asked afresh (the files stay on disk). Your own skin
  is kept. `forPlayer` also reuses one `Skin` record per texture instead of
  making one per call.
* `capes.CapeFrames`: a colour set whose cooking failed stayed in the table,
  never ready, for the session. `Cooked.failedAt` now records the failure and
  the set is cooked again when asked for more than 60 s later.
* `MinimapModule` keeps its 128² texture for the session (by design).

### U12 (fixed) — Low — perf — box outline allocations (26.2, 26.3; 1.21.11, 26.1.2)
26.2/26.3 `Lines.box` made six `float[]` loop arrays, a `Vector3f` per edge
and, through `VertexConsumer`'s default methods, two per vertex: ~66 objects
per box per frame (block waypoints, the light-level overlay). It now emits
the same vertices in the same order with the edge normals transformed once
per box and the positions transformed into one reused vector. 1.21.11 and
26.1.2 made a `VoxelShape` from the box every frame; it is kept by the box's
identity (≤ 256, render thread only).

### F7 — Low — perf — fog lookup every fog setup while *Fog distance* is off (all 10)
`BackgroundRendererMixin.blueclient$thinFog` (RETURN of every fog setup)
called `Fogs.where(camera)` → `Camera.getFluidInCamera()` and only then
`NoFogModule.keep(…)`, which is `1` (nothing to do) whenever the module is
off, as it is by default. `Fogs.where` now answers `NONE` without the lookup
while the module is off (`NoFogModule.on()`, new); with it on, nothing
changes. The mixin is untouched.

### F8 — Low — perf — a `ByteBuffer` per key check (26.3)
`ui.input.Inputs.keyDown` → `InputConstants.isKeyDown` →
`SDL_GetKeyboardState()`, which LWJGL wraps in a new `ByteBuffer` on every
call. Module key bindings (`Setting.Key.isDown`: two checks per bound key,
polled every frame for Zoom, Freelook and the like), the HUD layout screen's
modifier checks and the shulker preview all come through here.
SDL documents the returned array as valid for the life of the application;
the first non-null wrapper is kept and read with the same index. 26.2 and
older use GLFW's `glfwGetKey`, which does not allocate.

### F9 — Medium — bug — the totem counter is left behind when the armour strip shortens (all 10)
With Armour and Totem counter both in their default places, `Hud.stackDefaults`
puts the armour strip in the bottom-right corner and the totem slot 2 px to
its left, so the slot follows the strip as pieces come and go. But the first
drag or arrow-nudge in the layout screen (`HudLayoutScreen.freeze`) writes
every auto-placed module's current pixel position into the config, the totem
counter included. From then on the totem is "moved" and stays where the strip
ended on that day: take off a piece and the strip shrinks to the right,
leaving a 20 px gap per missing piece. The fix:

* `freeze` leaves the totem counter alone while it sits beside the armour
  (`Hud.followsArmour`, new), so only a drag or nudge of the counter itself
  pins it;
* a totem counter still in its default place follows the armour strip even
  when the armour has been placed by hand: 2 px to its left, bottoms lined
  up, or 2 px to its right when there is no room on the left
  (`Hud.stackDefaults`).

A totem counter pinned by `freeze` in an earlier version stays pinned: "Reset
to default" in the layout screen puts it back.

The layout screen is also renamed "Layout" (its title, the tile that opens
it in `VanillaModsScreen`, and "their options and the layout" in
`PresetEditScreen`).

### F10 — High — crash — a firework crashes the game while *Custom particles* thins particles (all 10)
`hud.modules.ParticlesModule` (`copies`, `keeps`, `naming`).

From a player's crash log (26.2, 1.55.0): a server set off fireworks
for a match winner and the game crashed one tick later with *Ticking
Particle*, `NullPointerException: Cannot invoke
"FireworkParticles$SparkParticle.setTrail(boolean)" because "sparkParticle"
is null`, in `FireworkParticles$Starter.createParticle`.

`mixin.ParticleManagerMixin.blueclient$copies` (a `@WrapMethod` on
`ParticleEngine.createParticle`, `method_3056` on 1.2x) returns `null`
without calling the game when `ParticlesModule.copies` is 0. `copies` is
`share(1, others)` for any particle that is not a crit, sharpness hit or
explosion, and `min(1, share(1, explosion))` for an explosion that is not
from an emitter. With *Custom particles* on and *Other particles* (or
*Explosion particles*) at any value below 100%, some particles, or all of
them at 0%, come back as `null`. The game's own callers use what
`createParticle` returns. A firework's `Starter` casts each spark and calls
`setTrail`, `setTwinkle`, `setAlpha` and `setColor` on it, so the first
skipped spark throws. The game itself returns `null` only for a particle type
with no provider. The same code is in all ten jars.

The mixin is not patched (see README), so the fix is in `ParticlesModule`:

* `copies` never returns 0. When it would have, it returns 1 and sets
  `skipNext`.
* `naming(true)`, which the mixin calls straight after `copies` returns 1,
  turns `skipNext` into a bit for the current depth (`skipped`), and
  `naming(false)`, which the mixin calls in a `finally`, clears that bit.
* `keeps()`, the `@Inject` at the head of `ParticleEngine.add`, returns
  `false` while the current depth's bit is set, so the game's own
  `createParticle` (`makeParticle`, then `add`, then return) makes the
  particle and hands it back but never adds it. The caller gets a real
  particle, and nothing is ticked or drawn.

The bit is per depth, so a particle made while another is being made (a
provider that makes particles) is judged on its own, and a type with no
provider (no `add`) leaves nothing behind. The visible amounts are the same
as before, with one difference: a skipped particle is now constructed before
it is dropped. A skipped particle that is a `NoRenderParticle` (an emitter)
is now added, because the mixin never asks `keeps()` about those. Its
children are then thinned one by one at the same rate, where before the
whole emitter was dropped or kept. At 0% the result is the same: nothing is
drawn.

---

## Not fixed

### U2 — Low/Medium — perf — every particle created boxes its arguments (all 10)
`mixin.ParticleManagerMixin.blueclient$copies` is a `@WrapMethod` on
`ParticleEngine.createParticle`, so every particle (rain splashes, block
breaking, crits…) allocates an `Object[]` and six `Double`s for
`Operation.call`, plus the `Operation` MixinExtras creates, even with
*Custom particles* off (`copies == 1`). The handler must call the original
through `Operation.call(Object...)`, so no change to the handler body alone
can remove this; with *Custom particles* off it already does no other work
(one static check, a counter up and down). Fix, if the mixin may change: a
separate loop only when `copies > 1`, and no path that returns `null` from
`createParticle`. The game's callers use the particle it returns (see F10),
so a particle to skip must still be made and only kept out of
`ParticleEngine.add`. In the measured
scene (singleplayer, no weather) no allocation from it was sampled.

### U3 — Low — perf — every packet allocates in the decoder (all 10, Netty thread)
`mixin.DecoderHandlerMixin` wraps `PacketDecoder.decode` with `@WrapMethod`
(an `Object[3]` + operation per packet) to catch unreadable cosmetic menus.
Off the render thread, but on every packet. Same constraint as U2: only a
different injector (`@WrapOperation` around the one call that throws) removes
it. Singleplayer has no packet decoder, so the measurement cannot show it.

### U7 — Low — hitch — one-time synchronous work on the render thread
`shade.Noise.ensure` builds a 64³ RGBA volume and a 512² map on the render
thread the first frame realistic clouds are drawn (it logs the ms);
`WaypointsModule.ensureLoaded` reads `blueclient-waypoints.json` on the render
thread on first use; `Config.load` / `Ledger.load` read at init (fine). Fix:
build the noise on a worker and upload when ready; read waypoints at join on
the disk thread.

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

### U13 — Low/unknown — the BlueClient shader stage does not run on 26.2/26.3 in the test harness (pre-existing)
With the *Shaders* switch on, `Shade.compose` runs (and its GL-state proof
line is logged) on 1.20.6–1.21.11 and 26.1.2, but never on 26.2 or 26.3,
with the released jar as with the patched one; Colour Saturation runs on
all ten. `Shade.wanted()` needs the cloud look or cinematic lighting and
`View.capture` a usable world frame; which of these fails on 26.2+ was not
established (it may be specific to llvmpipe under Xvfb). Nothing in the
patches touches this path; noted so it is checked on real hardware.

### U14 — Low — perf — what still allocates on the render thread (measured, see README)
In the JFR scene (default modules, 26.3), after the fixes the largest
BlueClient-attributed render-thread allocation is `ChipModule.render`'s text
draw, i.e. the game's own `GuiGraphics.drawString` building its render state
(vanilla, per string per frame); then `ScoreboardModule.measure` (once per
tick at most, F4 — at the harness's ~9 fps that is still every frame) and
`Beams.vertex` (the waypoint beam's vertices through `VertexConsumer`'s
default methods). None is large; none has a clear, cheap fix left.

### Withdrawn: U9 — threads — fields shared with worker threads
Listed in the first pass as written without a happens-before. On re-reading
all ten jars, `Friends.waiting`, `Friends.lastMessage` and `Play.session` are
already `volatile`. Nothing to fix.

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
