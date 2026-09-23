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
  the JFR allocation summary (`jfr_alloc.py` → `JfrAlloc.java`).

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
so BlueClient's frame clock logs `Frames: … median … fps, 1% low …`), and
`--jfr N` (below).

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
