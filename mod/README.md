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
  the javap comparison (`javapdiff.py`, `methoddiff.py`, `recompile_diff.py`).

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
     as `review:` (none are, for the patches here);
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

## Verification done (2026-09-22)

`python3 mod/build.py` built all ten jars. For every patched class, the
`recompile:` report showed that the released class and its decompiled source
recompiled differ only in branch layout and lambda numbering (no `review:`
lines). Every unpatched entry was byte-identical.

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

The other seven versions (1.20.6, 1.21.1, 1.21.4, 1.21.5, 1.21.8, 1.21.10,
26.1.2) were built and javap-verified, but not started. The error lines left
in the logs come from the sandbox: no asset index, no sound device, and no
network for Mojang services.
