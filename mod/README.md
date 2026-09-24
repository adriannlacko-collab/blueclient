# mod/ — patching the in-game half without its source

The in-game half of BlueClient (Fabric mod `blueclient` 1.55.0) ships as ten
jars, one per Minecraft line, in the launcher bundle. Its source is not in
this repository. This folder fixes it anyway, one class at a time, without
rebuilding the mod from decompiled code.

* `AUDIT.md` — what was reviewed, every finding (fixed or not) with file,
  method, cost/bug and fix.
* `patches/<mc>/…java` — the patched classes, as full source files, for each
  Minecraft version. Only these classes are compiled.
* `baseline/<mc>/…java` — the same classes exactly as Vineflower 1.11.1
  decompiled them from the released jar, so `diff -ru baseline patches` is
  the patch, and the build can prove what changed.
* `build.py` / `build.sh` — reproduce the patched jars.
* `test/run_game.py` — start the real game headless on a patched jar.
* `tools/` — downloads/caching (`deps.py`), the jar rewriter (`jarpatch.py`),
  the javap comparison (`javapdiff.py`, `methoddiff.py`, `recompile_diff.py`),
  the JFR allocation summary (`jfr_alloc.py` → `JfrAlloc.java`), and
  `hotkeys_port.py`, which writes the Hotkeys module's sources for nine
  versions from the 26.3 ones (see "New classes: Hotkeys"), and
  `scoreboard_port.py`, the same for switching sidebar lines off (see
  "Scoreboard lines").

## Build

    ./mod/build.sh                          # all ten -> launcher/resources/mod/
    python3 mod/build.py --versions 26.3    # one version
    python3 mod/build.py --out /tmp/mods    # elsewhere

Needs Python 3.9+ and network access to GitHub (the v1.11.0 `bundle.tar.gz`
and Temurin 25), piston-meta/piston-data.mojang.com and
libraries.minecraft.net (client jars and libraries), and maven.fabricmc.net /
meta.fabricmc.net (Fabric Loader, Mixin, Fabric API, intermediary,
tiny-remapper). Everything is cached in `mod/.cache/` (≈1.5 GB for all ten).
`JDK25_HOME` may point at an existing JDK 25; otherwise Temurin 25 is fetched.
Nothing is ever uploaded and nothing talks to blueclient.net.

`launcher/resources/mod/` is gitignored; the build writes all ten jars there
(patched where `patches/<mc>/` exists, otherwise copied) plus
`blueclient-shared.zip` unchanged — the folder the launcher's
`companion.pick` and `mods.js` already read.

## How a jar is patched

For each version:

1. **Classpath.** The released `blueclient-<mc>.jar` itself; the Minecraft
   client — for 26.x the plain Mojang jar (unobfuscated), for 1.20.6–1.21.11
   the jar remapped official→intermediary with tiny-remapper 0.14.1 and
   `net.fabricmc:intermediary:<mc>:v2` (the 1.2x jars were built with Loom's
   *static* mixin remap and reference `class_…`/`method_…` names directly);
   every library in the version JSON; Fabric Loader 0.19.5 with the Mixin and
   MixinExtras it brings (what the jars' MANIFEST says they were built with);
   and the module jars nested in the newest Fabric API build for that version.
2. **Compile** `patches/<mc>/**/*.java` with JDK 25 `javac --release 25` (26.x)
   or `--release 21` (1.2x), `-proc:none -g`. Nothing else is compiled.
3. **Swap** the resulting `.class` entries into a copy of the jar
   (`tools/jarpatch.py`): every other entry keeps its compressed bytes and
   position, replaced entries keep their position, nested classes of a
   patched outer class that the new compile no longer produces are dropped,
   new ones go right after their outer class. No mixin class is patched, so
   `blueclient.mixins.json`, the refmap-less static remap and every injection
   target string are untouched.
4. **Verify** (skip with `--no-verify`), printed per class:
   * `patch:` javap -c -p of `baseline/` recompiled vs `patches/` compiled —
     the members the patch changes, with the same compiler on both sides;
   * `recompile:` the released class vs `baseline/` recompiled — how much
     decompiling and recompiling alone moves. The report classifies each
     member as *branch layout only* (same instruction multiset, jumps and
     locals renumbered) or *lambda only renumbered*; anything else is listed
     as `review:`. The ones the current patches show were each read and are
     compiler/decompiler artifacts, not behaviour:
     - `Objects.requireNonNull(font)` + constant `9`: the original source read
       the compile-time constant `Font.lineHeight` through `client.font`, which
       javac compiles to a null check and the constant; the decompile has the
       constant only (`BossBarModule.height/drawnBars`,
       `WaypointsModule.label`), and folds `-(9/2) - 7`-style expressions;
     - string `switch` with one more temporary local
       (`WaypointsModule.dimension*`), several `return`s merged into one or
       split (`NoFogModule.keep`, `WaypointsModule.label`);
     - `try`-with-resources rebuilt as explicit `try/catch/close`
       (`CapeFrames.pixels`);
     - 1.2x only: an enum `switch`'s synthetic `$SwitchMap$…` field is named
       after the class name the original was compiled against
       (`…$world$level$material$FogType`) and after the intermediary name when
       recompiled (`…$class_5636`); the field is private to `Fogs$1`, which is
       replaced together with `Fogs`, so both sides agree.
     `tools/methoddiff.py A.class B.class [member]` shows any one of them;
   * every entry that was not patched is byte-for-byte identical, or the build
     fails.

A decompiled class is only used where the whole class is replaced, and the
`recompile:` line is the evidence that doing so changes nothing but layout.
Patches are kept to classes that are not mixins and whose decompiled source
is identical across the versions they are applied to (`stage` step when they
were written checked the md5 of each version's decompile).

## Adding a patch

1. Decompile: `java -jar vineflower-1.11.1.jar blueclient-<mc>.jar out/`.
2. Copy the class to `baseline/<mc>/<path>.java` untouched and to
   `patches/<mc>/<path>.java`, edit the latter. Repeat per version (the
   decompiles differ between versions; compare them first).
3. `python3 mod/build.py --versions <mc>` and read the report.
4. `python3 mod/test/run_game.py <mc>` to see it load and draw.

## New classes: Hotkeys

Not every change here is a fix to a decompiled class. The **Hotkeys** module
(Blue Settings → General → Hotkeys, gear) is new code: four new classes, and
two patched ones that list it (`Hud.register`) and open its page from its
gear (`VanillaScreen.pageFor`).

* `hud/modules/HotkeysModule` — the store (`config/blueclient-hotkeys.json`,
  beside `blueclient.json`, written through `Disk`), the trigger, the player
  and the recorder. A hotkey is a name, a key, a mode — *Once* (per press),
  *Loop* (press to start, press again to stop; optionally N runs) or *While
  held* — a pause between runs, and a list of actions: a chat line or a
  command (a line starting with `/`), a press of one of the game's own key
  mappings (tapped or held for a time), a wait, or recorded movement.
* `screen/HotkeysScreen` — the page, laid out like Waypoints: a row per
  hotkey (on/off, ▶/■ to run or stop it now, gear, X), then **Add Hotkey** and
  **Settings** (the module's switch, a stop-all key, stop on damage, the
  gap between chat lines, and whether starts and stops are said on screen).
* `screen/HotkeyEditScreen` — one hotkey: name, key (click, then press a key
  or mouse button; Esc clears), mode, runs, pause, its actions in order (edit,
  move up, remove), **+ Chat / command**, **+ Key press**, **+ Wait** and
  **● Record movement**. It warns when the key is also bound in Controls.
* `screen/HotkeyStepScreen` — one action.

What it does in the game, and why it is built that way:

* **Only the game's own inputs.** A key press is `KeyMapping.setDown` plus
  `KeyMapping.click` on the key the mapping is bound to, exactly what the
  keyboard handler does; chat and commands go through
  `ClientPacketListener.sendChat` / `sendCommand`, as if typed (so commands are
  signed the same way). Nothing is sent that a player could not send by hand.
* **Recording** watches forward/back/left/right, jump, sneak, sprint, attack
  and use (one bit each), the hotbar slot and the camera turn, once a tick,
  from the moment the menu closes until any screen opens (Esc). Idle ticks at
  either end are cut (sprint alone counts as idle: Toggle Sprint holds it
  down). Stored run-length encoded, `mask,slot,yaw,pitch[,repeat]` per tick.
  Playback sets the same keys, clicks on each key's first tick down (so an
  attack or use lands), selects the slot, and spreads each tick's turn over
  that tick's frames (`Module.frame`) so the camera moves as smoothly as it
  was moved. Ten minutes at most.
* **The trigger** is a `KeyMapping` of the hotkey's own, made at run time and
  never registered with Fabric, so it is not in Controls or `options.txt` but
  the game's key events still reach it: a tap too short for any tick to see
  the key down (a slow frame) still counts. Its auto-repeat clicks while the
  key stays down are ignored. Before 1.21.9 a key has one mapping, so there
  the hotkey's own steps aside while Controls has the same key bound, and
  the key is read by polling, once a tick and once a frame
  (`HotkeysModule.SHARED_KEYS`).
* **Pausing.** Any screen (chat, inventory, pause menu) pauses every run and
  lets go of its keys; closing it resumes. Taking damage stops them all (a
  setting), as do the stop-all key, the hotkey's own key, switching the module
  off, and leaving the world. A server that speaks BlueClient's server
  protocol can turn the module off like any other (`"off": ["hotkeys"]`);
  the page then says so.
* **Chat gap.** Chat lines and commands from hotkeys are at least this far
  apart (1 s by default), whatever the loop does: the vanilla server kicks a
  client that sends chat much faster than one line a second for long.

The four files are written once, for 26.3, and `tools/hotkeys_port.py`
writes the other nine versions from them: 26.1.2 and 26.2 read keys through
GLFW (Escape 256, no key −1, rather than SDL's 41 and 0); 1.20.6–1.21.11 get
the intermediary names, from a table looked up in Mojang's client mappings
joined with Fabric intermediary (the same for all seven); up to 1.21.4 the
hotbar slot is the field `Inventory.selected`. Edit the 26.3 files and run
it, then build. `tools/jarpatch.py` now also places brand-new top-level
classes (after the last class of their package); the verify step lists them
as `new class (no baseline)`.

## Scoreboard lines

The Scoreboard module's gear (Blue Settings → Visual → Scoreboard) opens a
page listing the sidebar on screen: its title and each of its lines, each a
button that switches it ON or OFF, then **Numbers** (the numbers on the
right), **Show all** and **Board** (the module's own switch). It is all
client-side, so it works on any server. The page follows the board while it
is open: rows are relabelled every half second (timers, coin counts) and laid
out again when lines come or go.

* **What is kept.** `config/blueclient-scoreboard.json`, written through
  `Disk`: per server (the address as typed in the server list, lower-cased;
  `singleplayer` for any local world) and per board (the objective's name),
  the lines switched off, and whether the title and the numbers are. A line
  is known by its score holder's name, not its text. Servers keep the holder
  and change the text through a team prefix/suffix or a display name, so a
  line stays off while what it says changes.
* **How it is drawn.** A board with nothing switched off is still the game's
  own, moved by `ScoreboardMixin` exactly as before. A board with something
  switched off is drawn by `ScoreboardModule.render`, with the game's
  geometry, colours and order (`Hud.displayScoreboardSidebar`), minus those
  lines. No mixin changes: the mixin calls `nowDrawing(objective)` and then
  cancels the game's drawing when `isEnabled()` is false, so `nowDrawing`
  sets a one-shot flag that the very next `isEnabled()` consumes. The box is
  measured without the hidden lines (and without the title band when the
  title is off), so Layout (F9), dragging, scaling and the other top-right
  modules' stacking all use the smaller board. The fifteen-line limit is the
  game's: lines are switched off among the fifteen it would show.
* **F3.** The game draws its sidebar under the debug screen and BlueClient's
  HUD modules are not drawn there, so `Hud.render` draws a self-drawn board
  there too.

New: `hud/modules/ScoreboardLines` (the store), `screen/ScoreboardLinesScreen`
(the page). Patched: `ScoreboardModule`, `VanillaScreen.pageFor` and
`addModuleRow` (the gear is active: the module has no visible settings, so it
was greyed out before), `Hud.render` (F3). The three Scoreboard files are
written for 26.3; `tools/scoreboard_port.py` copies them to 26.1.2/26.2 and
renames them to intermediary for 1.20.6–1.21.11 (names checked with
`tools/inter.py` on 1.20.6 and 1.21.11). The `VanillaScreen` and `Hud` edits
are made by hand in each version.

## Testing in the real game

    python3 mod/test/run_game.py 26.3 --scoreboard-pos "[0.0, 0.0]" --keep
    python3 mod/test/run_game.py 26.3 --original ...        # the released jar

Makes (once) a world with that version's dedicated server, with a 20-line
sidebar scoreboard; lays out a game folder the way the launcher does
(`mods/blueclient.jar` = the version's jar with the shared zip merged in, plus
Fabric API); writes a `blueclient.json` turning on FPS, Ping, Coordinates,
Armour, Scoreboard, Waypoints, Keystrokes, Clock and Light level, and one
waypoint beam; then runs Xvfb + Mesa llvmpipe, offline,
`--quickPlaySingleplayer`, screenshots the world and the tab list
(`test/Shot.java`, java.awt.Robot), stops the game and writes
`run/<mc>-<label>/summary.json` (joined?, mixin/linkage errors, error lines,
BlueClient lines). The game's DNS is pinned to a localhost-only hosts file and
the sandbox proxy settings are not passed, so it can reach nothing on the
network. 26.x needs `test/glxshim.c` (built automatically) under Xvfb: SDL3
asks GLX for an sRGB visual Xvfb does not have.

Options: `--jars DIR` (jars to test; default `launcher/resources/mod`),
`--original` (the released jars), `--label` (run folder name), `--seconds`
(time in the world), `--modules '{"shaders": true, …}'` (module switches on
top of the test config), `--defaults` (no module switched on or off: what a
fresh install runs; the waypoint is still there), `--scoreboard-pos`,
`--config` (extra `blueclient.json` keys), `--keep` (leave the game folder),
`--quit-at X,Y` (click *Save and Quit to Title* on the pause menu at the end,
so BlueClient's frame clock logs `Frames: … median … fps, 1% low …`),
`--file DEST=SRC` (copy a file into the game folder, e.g. a
`config/blueclient-hotkeys.json`), `--shot "NAME=STEPS"` (after the world
screenshot: `Shot.java` steps separated by spaces — a key, `hold:KEY:ms`,
`click:x,y`, `wait:ms` — then `screen-NAME.png`; repeatable, run in order),
and `--jfr N` (below).

### Allocation measurement (JFR)

    python3 mod/test/run_game.py 26.3 --original --label ab-original --defaults --seconds 60 --jfr 60 --quit-at 640,455
    python3 mod/test/run_game.py 26.3 --jars <patched> --label ab-patched --defaults --seconds 60 --jfr 60 --quit-at 640,455
    python3 mod/tools/jfr_alloc.py mod/run/26.3-ab-original/alloc.jfr

`--jfr N` starts the game with 16 KB fixed-size TLABs
(`-XX:TLABSize=16k -XX:-ResizeTLAB`), waits until it has rendered the world
for `--seconds`, and records N seconds with `jcmd JFR.start` using JDK 25's
*profile* settings with every `ObjectAllocationInNewTLAB`/`OutsideTLAB` event
kept (so one event with a stack per 16 KB a thread allocates, not a few
samples a second). `tools/jfr_alloc.py` (→ `tools/JfrAlloc.java`, streamed)
prints the render thread's exact allocation rate (from
`jdk.ThreadAllocationStatistics` at the start and end) and the share of the
TLAB events whose stack has a `com.blueclient` frame, grouped by the innermost
one. The scene is fixed (same world, spawn, view, one waypoint beam, 20-line
sidebar), but llvmpipe renders it at ~5–10 fps, so per-frame costs weigh less
than on real hardware and per-tick ones (20 a second) weigh more.

## Verification done (2026-09-22/23)

`python3 mod/build.py` built all ten jars (24–30 classes replaced per jar,
`Gl$Game` and `Gl$Packing` added). Every unpatched entry was byte-identical;
every `recompile:` difference is branch layout, lambda numbering or one of
the artifacts listed above. The build into `launcher/resources/mod` is
byte-identical to the scratch build the runs below used (sha1 of
`blueclient-26.3.jar`: `cf51f5e270902742785098f27a72be5f874ab432`).

### Hotkeys (new module)

`python3 mod/build.py` builds all ten with the four Hotkeys classes (14 new
class files per jar with their nested classes) and `Hud` and `VanillaScreen`
patched. `patch:` shows `Hud.register` and `VanillaScreen.pageFor` as the
only changed members. The `recompile:` report for `VanillaScreen` has two
decompiler artifacts. On 26.3 `scrolled` lists the same four arrow and page
keys in a different case order; the tableswitch maps 75→−rows, 78→+rows,
81→+1, 82→−1 and everything else to `false`, in both. On 1.20.6–1.21.11 one
private lambda has a different name: `lambda$init$0` in the released jar,
built with Mojang names and remapped statically, and `lambda$method_25426$0`
when recompiled from intermediary.

In the game (`--file config/blueclient-hotkeys.json=mod/test/hotkeys.json`
and `--shot` steps; the fixture has a chat hotkey on H, a looped recording
on J that walks and turns 90°, two jumps on K and a command on N):

| version | chat line on H | loop on J, started by a quick tap | pages (pause menu → BlueClient → search → Hotkeys → Edit), key rebound by a key press |
|---|---|---|---|
| 26.3 | sent | walks, turns, switches slot | all drawn; Settings, the action editor, "+ Chat / command" and a live recording checked too |
| 26.2 | sent | walks, turns 90°, selects the recorded slot | Hotkeys page drawn |
| 26.1.2 | sent | runs | all drawn, key rebound |
| 1.21.11 | sent | runs | all drawn, key rebound |
| 1.21.5 | sent | runs (the first with `getSelectedSlot`) | Hotkeys page drawn |
| 1.20.6 | sent | runs | all drawn, key rebound |

Each joined with 0 mixin or linkage errors. 1.21.1, 1.21.4, 1.21.8 and
1.21.10 were built from the same sources as their neighbours (1.20.6's
`Inventory.selected` for 1.21.1 and 1.21.4, 1.21.5's for 1.21.8, 1.21.11's
shared keys for 1.21.10) and compiled against their own jars. They were not
started.

On 26.3 a hotkey was also made from scratch through the pages: Add Hotkey,
key set by pressing R, **● Record movement**, W held for 1.5 s then A,
Esc. The Edit page came back with "Movement: … with camera", and pressing R
in the world played it (▶, and the player walked the recorded path, about
9 blocks). The first pass found two bugs, both fixed:

* a quick tap was missed at the sandbox's 8–12 fps, because SDL saw the
  press and the release in the same event pump, so no poll of the key ever
  saw it down. The fix is the event-driven trigger described above.
* Toggle Sprint held the sprint bit down, so idle time before and after a
  recording was never cut.

The `/time set noon` hotkey was sent, and refused because the test world
has cheats off. Stop on damage fired when the loop walked the player off a
ledge. The error lines in the logs are the sandbox's (no Mojang services,
no sound device, no narrator).

### Scoreboard lines

`python3 mod/build.py` built all ten (32–38 classes replaced, 19 added per
jar). `patch:` shows only the members meant to change (`ScoreboardModule`:
`measure`, `isVisible`, `height`, `vanillaPlace`, `nowDrawing`, `render`, plus
the new members; `VanillaScreen.addModuleRow`/`pageFor`; `Hud.render`). No
new `recompile:` review lines. In the game, with a
`config/blueclient-scoreboard.json` switching off Bravo, Delta and Golf and
the numbers on the test world's board (`--file`), then pause menu →
BlueClient → search "score" → gear → click "Alpha" → back to the world:

| version | board drawn without the hidden lines | page drawn, a line switched off by a click | saved |
|---|---|---|---|
| 26.3 | yes, same look as the game's own | yes | yes |
| 26.1.2 | yes | yes | yes |
| 1.21.11 | yes | yes | yes |
| 1.20.6 | yes | yes | yes |

Each joined with 0 mixin or linkage errors. 26.2, 1.21.1, 1.21.4, 1.21.5,
1.21.8 and 1.21.10 were built from the same sources and compiled against
their own jars. They were not started.

### Totem counter beside the armour, and "Layout" (F9)

`Hud`, `HudLayoutScreen`, `VanillaModsScreen` and `PresetEditScreen` added
on all ten (31–37 classes replaced per jar). Their `recompile:` report flags
three members the patch does not touch, on every version, all
decompiler artifacts: `Hud.layOutDefaults` (a `continue` rebuilt as an
`if`), `HudLayoutScreen.onKey` (the four arrow cases in a different order,
same `nudge` arguments per key) and `PresetEditScreen.content` (a local
assigned before rather than after a field store). The placement was checked
by driving the patched 26.3 `Hud.stackDefaults` with stand-in Armour
(1–4 pieces) and Totem counter modules, both in default places, with the
armour pinned where the layout screen's freeze would pin it, with the armour
dragged to the left edge, and with the totem moved by hand. 26.3 and 1.20.6
started in the game with the new jars: joined, 0 mixin/linkage errors.

### Second pass: all ten versions in the game

Each version with the final jars, the test config plus Colour Saturation,
the Shaders switch and Fog distance on, 45 s in the world, then the tab list
and the pause menu:

| version | joined | mixin / linkage errors | HUD (FPS, ping, coords, clock, keystrokes, sidebar, beam) | GL state proof (U1) |
|---|---|---|---|---|
| 1.20.6 | yes | 0 | drawn | Saturate, Shade |
| 1.21.1 | yes | 0 | drawn | Saturate, Shade |
| 1.21.4 | yes | 0 | drawn | Saturate, Shade |
| 1.21.5 | yes | 0 | drawn | Saturate, Shade |
| 1.21.8 | yes | 0 | drawn | Saturate, Shade |
| 1.21.10 | yes | 0 | drawn | Saturate, Shade |
| 1.21.11 | yes | 0 | drawn | Saturate, Shade |
| 26.1.2 | yes | 0 | drawn | Saturate, Shade |
| 26.2 | yes | 0 | drawn | Saturate (Shade does not run, U13) |
| 26.3 | yes | 0 | drawn | Saturate (Shade does not run, U13) |

"GL state proof" = the log line `GL state for com.blueclient.shade.<pass> is
now restored from the game's own copy, without reading it back`, i.e. 8
passes read back from the driver matched the game's record; no version
logged a mismatch or a missing field. Where it runs (1.20.6–26.1.2) the
shader stage then turns itself off after ~20 s because llvmpipe needs >100 ms a frame for
it (its own rule, as in the released jar). The error lines in the logs
(13–27 per run) are all from the sandbox: no Mojang services or Realms (no
network), no OpenAL device, no narrator library, no window icon.

The seven versions not started in the first pass (1.20.6, 1.21.1, 1.21.4,
1.21.5, 1.21.8, 1.21.10, 26.1.2) were also started early in the second
pass, before its changes: all joined with 0 mixin/linkage errors and drew
the HUD.

### Allocation A/B (JFR)

Released jar vs final jar, same scene, fresh-install module defaults, 60 s
in the world then 60 s recorded (see "Allocation measurement" above). Render
thread only; "BlueClient" = allocation whose stack has a `com.blueclient`
frame (including game code it calls):

| version | jar | render thread MB/s | BlueClient MB/s | BlueClient share | median fps (session) |
|---|---|---|---|---|---|
| 26.3 | released | 5.82 | 0.183 | 3.0 % | 6.3 |
| 26.3 | patched | 6.04 | 0.115 | 1.8 % | 7.0 |
| 1.20.6 | released | 4.01 | 0.166 | 4.0 % | 7.8 |
| 1.20.6 | patched | 3.79 | 0.124 | 3.2 % | 7.8 |
| 1.21.11 | released | 6.08 | 0.101 | 1.6 % | 4.8 |
| 1.21.11 | patched | 6.77 | 0.114 | 1.6 % | 6.0 |

* 26.3: −37 % BlueClient allocation. Gone from the profile: the world-pass
  recording lambdas (`Frames$Recording`, F6), `Inputs.keyDown` (F8),
  `Fogs.where` (F7).
* 1.20.6: −25 % at the same frame rate. Gone: `Fogs.where` (0.74 MB of 9.9),
  `WaypointsModule.label`'s width (U5).
* 1.21.11: no drop per second (0.21 MB of `Fogs.where` gone, but the patched
  run drew 25 % more frames and most of what is left is per frame);
  per frame (by the session's median fps) it is roughly 21 KB → 19 KB.
* The total render-thread rate is the game's and moves with the frame rate;
  BlueClient is 2–4 % of it. What is left is mostly the game's own text
  drawing for the HUD chips and `ScoreboardModule.measure` (once a tick at
  most, which at these frame rates is every frame) — see U14.
* The fixes for the badge (U4), boss bar (U6), box outlines (U12) and
  skins/capes (U8) act on things this scene does not have (other BlueClient
  players, a boss, block waypoints, other players' skins), so the table
  does not show them. The GL-state fix (U1) removes driver round trips, not
  allocation; llvmpipe runs GL on the calling thread, so it cannot show the
  stall either.

### First pass

In the real game (Xvfb + llvmpipe, Fabric Loader 0.19.5, the newest Fabric
API for each version, offline, `--quickPlaySingleplayer`):

| version | jar | result |
|---|---|---|
| 26.3 | patched | joined; 0 mixin/linkage errors; FPS, ping, coords, clock, keystrokes, scoreboard, waypoint beam drawn |
| 26.3 | released | joined; same modules drawn; with the board moved to `[0, 0]` its title and first line are cut off at the top, and it sits ~120 gui px right of its box (F2, F3) |
| 26.2 | patched | joined; 0 mixin/linkage errors |
| 1.21.11 | patched | joined; 0 mixin/linkage errors; same modules drawn; board flush at `[0, 0]` |
| 26.3 | released + `"fps.pos": ["x", 0.1]`, `"coords.scale": "big"` | does not start: `Could not execute entrypoint stage 'client'` … `NumberFormatException: For input string: "x"` at `Position.load` ← `Config.register` ← `FpsModule.<init>` (F1) |
| 26.3 | patched + the same file | joined; logs `blueclient.json: ignoring the unreadable value of fps.pos` and `… coords.scale` |

At the end of the first pass the other seven versions had been built and
javap-verified but not started; the second pass started all ten (above).
The error lines left in the logs come from the sandbox: no asset index, no
sound device, and no network for Mojang services.
