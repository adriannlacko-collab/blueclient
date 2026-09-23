# Launch and frame-rate bench

The bench that `install.js` (`jvmBase`), `state.js` (`performanceStack`) and
`mods.js` refer to when they say "measured". Everything here runs the real
game, under the launcher's own code, on Linux with software OpenGL; the
tables are at the bottom, and every choice in the source that cites the bench
cites a row here.

## What it does

* `prepare.js` puts a profile on disk with the launcher's own modules, in the
  order `launcher.js` `_run` uses them: `install.resolve`, `ensureJava`
  (Mojang's runtime from its manifest, and the base class archive
  `archiveClasses` writes behind it), `ensureClient`, `ensureLibraries`,
  `ensureAssets`, `mods.sync` with the companion jars from the release bundle,
  `mods.tune`, the shaderpack, `settings.adopt`. The mod list is evaluated out
  of `src/renderer/js/state.js` itself; `--add slug` and `--drop slug` make
  the variants.
* `world.py` makes one template world per version with Mojang's dedicated
  server (normal world, fixed seed) and a data pack that puts the player in
  spectator mode at y=110 and moves them +X a quarter block a tick (5
  blocks/s, a walk), facing along the path, at noon in clear weather. The
  world is copied fresh before every run, so every run generates the same new
  chunks on the integrated server — the singleplayer workload C2ME and the
  lighting mods are for.
* `probe/` is a two-class Fabric mod (built by `probe/build.py` with plain
  javac; the mixin names its targets as strings, intermediary for 1.21.x and
  Mojang's own names for 26.x). At the head of `Minecraft.onGameLoadFinished`
  it prints the wall time — the moment the first resource load is done and
  the title screen opens (with `--quickPlaySingleplayer`, the moment the world
  starts loading instead: the same instant, the same code path up to it). At
  the head of `Minecraft.runTick` it records every frame's start; it prints
  "in world" the first frame a level is loaded with no screen open, records
  frame times from `warmup` seconds after that for `measure` seconds, writes
  them out and halts the VM.
* `run.js` runs a plan. The argument list is the launcher's: `install.buildCommand`
  from the inputs prepare.js saved, an offline account, 4096 MB (so -Xms is
  2048 MB, the launcher's rule), 854×480 windowed, `--quickPlaySingleplayer`.
  The bench adds only `-Xlog:gc` and `-Xlog:safepoint` to files and the probe's
  `-D` switches. A variant's JVM flags go in as `jvmArgs` — the Settings field
  — so they pass through `jvmTuning` exactly as a player's would. Rounds
  alternate direction (A B C, C B A …); one untimed launch per profile goes
  first so every timed launch has a warm disk and Fabric's caches made.
* `table.js` prints the tables below from the result files; `availability.py`
  asks Modrinth which candidate mods have a Fabric build for each supported
  Minecraft.

What is measured, per run:

* **title** — spawn of the JVM to `onGameLoadFinished` (the probe's wall
  clock against the spawn time). Chosen over log lines: "Sound engine
  started" never appears without a sound device, the atlas lines are printed
  in the middle of the load, and 26.x's log changed wording; the probe's hook
  is the method that opens the title screen.
* **in world** — spawn to the first frame with a level and no screen.
* **avg FPS / 1% low** over the measured window: frames ÷ time, and the mean
  of the slowest 1% of frame times as a rate.
* **pause p99 / max** — every safepoint in the window from `-Xlog:safepoint`
  (every stop-the-world pause, whichever collector: G1's evacuations,
  ZGC's and Shenandoah's short pauses, and the non-GC ones alike). A window
  holds 5–50 safepoints, so its p99 is its largest; the columns agree.
* **pause before title** — the sum of every safepoint between spawn and the
  title screen.
* **foreign cores** — CPU used by everything that is *not* this game and its
  X server, from /proc, during startup and during the window. See Caveats.

## Running it

```
BENCH_ROOT=/path/work BENCH_BUNDLE=/path/unpacked-bundle.tar.gz \
  node tools/bench/prepare.js --mc 26.3 --name base-26.3
python3 tools/bench/world.py /path/work 26.3 /path/work/java/java-runtime-epsilon/bin/java
python3 tools/bench/probe/build.py <javac> <sponge-mixin.jar> /path/work/probe
gcc -shared -fPIC -O2 -o /path/work/srgbshim.so tools/bench/srgbshim.c -ldl
Xvfb :77 -screen 0 1920x1080x24 &
BENCH_ROOT=/path/work node tools/bench/run.js plan.json
node tools/bench/table.js /path/work/results/*.jsonl
```

`srgbshim.c` exists because 26.x opens its window through SDL3 and asks GLX
for an sRGB-capable framebuffer, which Xvfb does not list ("Couldn't find
matching GLX visual" — the game does not start). It drops that one attribute;
a real driver always has one. 1.21.x (GLFW) does not need it.

## The runs of 2026-09-22/23

Machine: 4 cores (Xeon @ 2.8 GHz), 15 GB, Linux, Xvfb + Mesa 25.2 llvmpipe
(software OpenGL 4.5), `LP_NUM_THREADS=2` so the rasteriser leaves two cores
to the JVM. Mojang's own runtimes as `ensureJava` fetched them: Java 21.0.7
(Microsoft build, `java-runtime-delta`) for 1.21.11 and 25.0.1
(`java-runtime-epsilon`) for 26.3. Fabric Loader 0.19.5, the default stack as
`mods.sync` resolved it on the day (26.3 has no Krypton or No Chat Reports
build; on 1.21.11 the pairing check holds Sodium at 0.8.7 for Iris 1.10.7),
the companion 1.55.0 from the v1.11.0 bundle. Render distance 4, simulation
distance 5, 854×480, 4096 MB unless the table says 8192. Median [min–max]
over the clean runs; the paired table under each is the one to judge a
variant by.

**The machine was shared.** Other sessions ran their own Minecraft instances
and browsers on the same four cores for the first hours (load average 6–22).
From the first plan on, every game ran at `nice -10`, the Linux counterpart
of the priority the launcher itself gives the game on Windows (`gpu.raise`);
a warm 26.3 launch went from 43 s before it to 20 s after, in the same busy
hour. Rounds 1–3 of the 26.3
JVM plan still ran beside 1.3–2.3 cores of other load, rounds 4–5 beside
0.1–1.1 — which is why that plan's spread is wide, and why every conclusion
drawn from it was checked again on a quiet machine (the 8 GB plan, and every
later plan, ran beside under 0.1 core). `foreignCores` is in every result row.

### JVM flags — 26.3, Java 25

`results/jvm-26.3.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| mojang | 5/5 | 26.8 [18.1–27.2] | 43.4 [28.9–43.8] | 10.9 [10.0–15.9] | 3.8 [3.2–7.5] | 99.1 [62.5–136.1] | 99.1 [62.5–136.1] | 989 [597–1244] | 2481 [2311–2571] |
| xms=xmx | 5/5 | 27.8 [18.2–30.6] | 39.7 [28.3–49.8] | 13.4 [10.8–15.9] | 4.5 [3.4–7.4] | 93.3 [65.2–139.6] | 93.3 [65.2–139.6] | 832 [472–1245] | 2530 [2512–2580] |
| aikar | 5/5 | 22.2 [16.8–29.6] | 35.6 [26.6–45.5] | 12.5 [10.2–15.7] | 4.4 [3.2–7.6] | 67.5 [59.3–143.0] | 67.5 [59.3–143.0] | 589 [392–1283] | 3363 [3321–3391] |
| mojang+coh | 5/5 | 23.1 [18.6–32.6] | 37.8 [29.9–49.0] | 13.1 [10.6–15.5] | 4.9 [2.8–6.9] | 73.7 [69.5–169.8] | 73.7 [69.5–169.8] | 948 [484–1611] | 2604 [2431–2818] |
| zgc | 5/5 | 23.5 [18.1–29.9] | 38.1 [28.9–46.1] | 13.0 [10.0–16.2] | 4.3 [3.7–7.8] | 3.5 [0.2–7.9] | 3.5 [0.2–7.9] | 21 [7–44] | 4317 [4212–4529] |
| shenandoah | 5/5 | 23.8 [18.4–31.9] | 38.9 [30.5–50.3] | 12.0 [9.0–15.0] | 3.1 [2.6–6.7] | 6.6 [3.3–8.9] | 6.6 [3.3–8.9] | 50 [19–118] | 4448 [4381–4490] |
| mojang+aot | 5/5 | 19.2 [14.3–22.6] | 31.2 [23.4–37.1] | 14.9 [10.8–16.2] | 6.0 [3.6–8.9] | 62.1 [52.5–115.2] | 62.1 [52.5–115.2] | 819 [539–960] | 2583 [2378–2773] |

Paired against **mojang** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| xms=xmx | 5 | +3% [-0%…+13%] | -2% [-9%…+15%] | +8% [-0%…+23%] | +12% [-1%…+22%] | +4% [-46%…+41%] |
| aikar | 5 | -7% [-17%…+10%] | -8% [-19%…+4%] | +2% [-2%…+15%] | +1% [-2%…+16%] | -5% [-52%…+31%] |
| mojang+coh | 5 | +3% [-14%…+20%] | +3% [-14%…+13%] | +6% [-2%…+21%] | -9% [-20%…+27%] | +18% [-49%…+51%] |
| zgc | 5 | +0% [-12%…+11%] | +0% [-13%…+5%] | +2% [-0%…+19%] | +9% [-1%…+15%] | -95% [-100%…-92%] |
| shenandoah | 5 | +1% [-11%…+17%] | +5% [-15%…+16%] | -1% [-13%…+10%] | -10% [-30%…+18%] | -93% [-95%…-90%] |
| mojang+aot | 5 | -27% [-31%…-16%] | -21% [-35%…-15%] | +13% [+2%…+37%] | +19% [+12%…+86%] | -23% [-54%…+16%] |

Quiet machine, 8192 MB heap (the launcher's own figure on a 16 GB PC), 60 s
windows; the AOT cache is the one trained at 4096 MB:

`results/gc2-26.3.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| mojang | 4/4 | 17.5 [17.2–18.6] | 28.6 [27.4–29.3] | 16.6 [16.1–17.0] | 7.7 [7.3–8.2] | 55.3 [46.6–75.6] | 55.3 [46.6–75.6] | 539 [531–584] | 2960 [2917–3014] |
| zgc | 4/4 | 18.6 [18.3–19.0] | 29.6 [29.0–30.0] | 16.4 [15.9–16.5] | 7.7 [7.0–7.8] | 1.0 [0.6–3.2] | 1.0 [0.6–3.2] | 24 [19–30] | 6090 [5902–6119] |
| zgc+soft2g | 4/4 | 18.6 [18.3–19.0] | 29.5 [28.9–29.8] | 16.6 [16.2–16.9] | 7.7 [6.8–7.8] | 0.5 [0.2–6.0] | 0.5 [0.2–6.0] | 44 [13–73] | 3622 [3538–3636] |
| mojang+aot | 4/4 | 14.1 [13.8–14.3] | 23.4 [23.3–23.9] | 16.9 [16.5–17.0] | 8.6 [7.8–9.1] | 65.3 [57.5–71.5] | 65.3 [57.5–71.5] | 532 [469–578] | 2763 [2544–2948] |

Paired against **mojang** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| zgc | 4 | +6% [-2%…+10%] | +3% [-0%…+9%] | -2% [-3%…-1%] | -2% [-5%…+1%] | -98% [-99%…-93%] |
| zgc+soft2g | 4 | +5% [-0%…+10%] | +3% [-1%…+8%] | -2% [-2%…+5%] | -1% [-12%…+3%] | -99% [-100%…-87%] |
| mojang+aot | 4 | -21% [-23%…-17%] | -18% [-20%…-13%] | +1% [-1%…+5%] | +10% [-0%…+25%] | +12% [-6%…+40%] |

### JVM flags — 1.21.11, Java 21

`results/jvm-1.21.11.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| mojang | 5/5 | 16.2 [15.9–16.9] | 29.2 [28.5–29.7] | 15.4 [15.0–16.0] | 6.7 [6.2–8.1] | 44.4 [35.2–48.1] | 44.4 [35.2–48.1] | 567 [560–627] | 2708 [2670–2768] |
| xms=xmx | 5/5 | 16.1 [15.9–16.8] | 28.5 [28.4–29.6] | 15.1 [14.7–15.5] | 6.9 [6.4–7.4] | 57.0 [36.1–81.8] | 57.0 [36.1–81.8] | 510 [487–598] | 2357 [2300–2403] |
| aikar | 5/5 | 16.0 [15.6–16.6] | 28.4 [28.1–29.5] | 15.4 [14.8–15.8] | 7.4 [6.7–7.6] | 32.2 [26.9–41.1] | 32.2 [26.9–41.1] | 423 [394–565] | 3104 [3071–3140] |
| zgc-gen | 5/5 | 16.8 [16.3–17.2] | 29.6 [29.0–31.0] | 15.3 [14.8–15.7] | 7.3 [7.0–8.2] | 8.3 [4.8–13.3] | 8.3 [4.8–13.3] | 61 [43–86] | 4398 [4356–4440] |
| shenandoah | 5/5 | 16.9 [16.4–17.8] | 30.3 [29.9–32.3] | 15.0 [14.6–15.3] | 6.0 [5.8–6.2] | 5.8 [4.0–8.2] | 5.8 [4.0–8.2] | 64 [41–89] | 4477 [4334–4783] |
| mojang+dyncds | 5/5 | 14.2 [13.8–15.2] | 25.8 [25.2–27.7] | 15.0 [14.8–15.5] | 7.2 [6.8–7.4] | 41.4 [36.4–54.0] | 41.4 [36.4–54.0] | 514 [438–569] | 2695 [2619–2763] |

Paired against **mojang** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| xms=xmx | 5 | -0% [-2%…+0%] | -0% [-4%…-0%] | -2% [-3%…+1%] | -4% [-9%…+11%] | +48% [-25%…+116%] |
| aikar | 5 | -2% [-4%…+1%] | -1% [-5%…-0%] | +0% [-4%…+3%] | +9% [-7%…+14%] | -23% [-34%…+1%] |
| zgc-gen | 5 | +3% [+0%…+6%] | +3% [-2%…+5%] | -2% [-4%…+5%] | +14% [-14%…+18%] | -78% [-88%…-72%] |
| shenandoah | 5 | +5% [+1%…+6%] | +5% [+1%…+9%] | -4% [-6%…-0%] | -13% [-26%…-5%] | -85% [-91%…-79%] |
| mojang+dyncds | 5 | -13% [-14%…-10%] | -11% [-12%…-7%] | -3% [-3%…+0%] | +2% [-10%…+12%] | +6% [-8%…+12%] |

(mojang+dyncds-train: training run, title 218.3 s, world 231.8 s, exit 0, foreign cores {"startup":0.06,"window":0.07})

`results/gc2-1.21.11.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| mojang | 4/4 | 16.2 [15.7–16.5] | 28.9 [28.7–29.6] | 16.2 [16.2–16.3] | 7.4 [6.9–7.8] | 39.6 [37.7–45.2] | 39.6 [37.7–45.2] | 580 [507–643] | 2738 [2690–2762] |
| zgc-gen | 4/4 | 16.2 [15.8–16.5] | 29.2 [28.7–30.0] | 16.4 [16.2–16.6] | 7.2 [6.8–7.4] | 5.1 [4.0–5.9] | 5.1 [4.0–5.9] | 50 [24–58] | 7090 [7006–7351] |
| zgc-gen+soft2g | 4/4 | 16.5 [16.0–16.7] | 29.0 [28.7–29.5] | 16.5 [16.3–16.8] | 6.9 [6.7–7.2] | 11.5 [4.6–43.0] | 11.5 [4.6–43.0] | 57 [48–59] | 3102 [3066–3131] |

Paired against **mojang** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| zgc-gen | 4 | -1% [-3%…+5%] | +0% [-0%…+4%] | +1% [-0%…+2%] | -3% [-12%…+7%] | -88% [-90%…-84%] |
| zgc-gen+soft2g | 4 | +1% [-1%…+5%] | +1% [-3%…+3%] | +1% [+0%…+4%] | -6% [-14%…+1%] | -72% [-88%…+11%] |

What the pause columns count: in a 45 s window G1 collected 3–6 times,
stopping the game for 30–75 ms each; ZGC's longest stop was 0.2–13 ms. The slowest 1% of
frames did not follow: they are frames spent building chunk meshes and
generating chunks, and ZGC's concurrent threads take CPU from exactly that.
On this machine a frame is ~60 ms, so a 40 ms stop is not invisible to the
1% low — it is simply not what the slowest frames are made of.

**Kept: Mojang's six on every major.** ZGC and Shenandoah win only the pause
columns; they lose up to 6% of launch, gain nothing on FPS or 1% low, and double
the memory the game holds at 8 GB (ZGC collects when the heap is ~70% full,
so it fills whatever -Xmx allows; `-XX:SoftMaxHeapSize=2048M` holds it to
+13–22% over G1 and still gains no frame). ZGC also refuses to start on
Windows 10 before 1803 and under a GraalVM (JVMCI) compiler a player may
point Settings at. Aikar's set, `-Xms` = `-Xmx` and compact object headers
are inside the noise; `ParallelRefProcEnabled` is already on by default in
both runtimes (`-XX:+PrintFlagsFinal`).

Checked for the day one is adopted — every flag in these plans starts on
both vendors: `-XX:+UseZGC`, `-XX:+ZGenerational` (21; 25 warns and ignores
it), `-XX:+UseShenandoahGC`, on Mojang 21.0.7 / 25.0.1 and Adoptium 21.0.12 /
25.0.4; `-XX:+UseCompactObjectHeaders` on both 25s, "Unrecognized VM option"
(the JVM exits) on both 21s.

### AOT cache (Java 25) and dynamic CDS (Java 21)

Launch with a cache, from the plans above: 26.3 **−27%** to the title
(paired median, 5 rounds, contaminated) and **−21%** (4 rounds, quiet, 8 GB,
with a cache trained at 4 GB), −18 to −21% into the world; 1.21.11's dynamic
archive (`-XX:ArchiveClassesAtExit` then `-XX:SharedArchiveFile`) −13%. The
cost of getting one:

`results/aotrec-26.3.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| title | 2/2 | 17.8 [17.4–18.2] | — | — | — | — | — | 534 [467–600] | 1888 [1847–1929] |
| record | 2/2 | 183.5 [182.9–184.2] | — | — | — | — | — | 531 [471–591] | 2068 [2037–2098] |
| record-notraining | 2/2 | 182.5 [182.0–183.0] | — | — | — | — | — | 577 [568–586] | 2073 [2065–2081] |

Paired against **title** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| record | 2 | +932% [+906%…+957%] | — | — | — | — |
| record-notraining | 2 | +926% [+902%…+950%] | — | — | — | — |

`results/aotrec-temurin.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| title-temurin25 | 1/1 | 18.1 [18.1–18.1] | — | — | — | — | — | 549 [549–549] | 1629 [1629–1629] |
| record-temurin25 | 1/1 | 183.9 [183.9–183.9] | — | — | — | — | — | 552 [552–552] | 2062 [2062–2062] |

Paired against **title-temurin25** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| record-temurin25 | 1 | +919% [+919%…+919%] | — | — | — | — |

* Recording is ten times slower than playing: 183 s to the title instead of
  18 (`-XX:AOTMode=record`), 204 s with the one-step
  `-XX:AOTCacheOutput`, on Mojang's 25.0.1 and Adoptium's 25.0.4 alike.
  Turning off the training-data half (`-XX:-AOTRecordTraining`, diagnostic)
  changes nothing. Java 21's dynamic archive: 218 s. This is the 3.5 minutes
  `launcher.js` recorded for `-XX:+AutoCreateSharedArchive` on 2026-09-10.
* Assembling the cache after the recording (`-XX:AOTMode=create`, or the
  child the one-step run forks at exit) is another ~170–180 s of one core,
  and the cache is 200 MB per Minecraft version.
* The cache holds only what the built-in loaders define (the JDK and the
  libraries on `-cp`); Fabric's Knot defines the game and the mods itself.
  So a windowless training — load the ~8,500 library classes a real launch
  loads, nothing else, `BlueAotTrainer` in `probe/trainer` — was tried. It
  recorded just as slowly (172 s) and the cache it made saved 1%:

`results/aotsyn.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| title | 4/4 | 17.4 [17.3–17.7] | — | — | — | — | — | 589 [573–611] | 1619 [1589–1643] |
| title+syn-cache | 4/4 | 17.1 [17.1–17.2] | — | — | — | — | — | 608 [584–634] | 1686 [1663–1699] |
| title+game-cache | 4/4 | 14.0 [13.8–14.2] | — | — | — | — | — | 540 [520–562] | 1675 [1661–1713] |

Paired against **title** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| title+syn-cache | 4 | -1% [-4%…-1%] | — | — | — | — |
| title+game-cache | 4 | -20% [-22%…-18%] | — | — | — | — |

* **25.0.1 does not validate the cache against the classpath.** A cache
  trained with `v.jar` ran `v.jar`'s old classes after the jar was rebuilt at
  the same path, and after `-cp` named a different jar entirely — silently,
  exit 0. Adoptium 25.0.1 does the same; Adoptium 25.0.4 refuses the cache
  ("shared class paths mismatch") and runs the new classes, as does Java 21
  with a dynamic archive. Every other broken cache — truncated, garbage,
  missing, trained under another GC (compressed oops differ) or with compact
  headers on one side only — is refused with an `[aot]` error line and the
  JVM carries on (exit 0). (`-XX:AOTMode=on` is documented to make an
  unusable cache fatal; with 25.0.1 and a mismatched classpath it did not
  even notice.)

**Not adopted.** A cache must be retrained whenever a library changes (every
Fabric Loader release, every Minecraft version), and each retraining is a
launch three minutes longer plus three minutes of a core — the thing this
bench exists to remove. If a later JDK records in seconds, the design that
holds up against everything above:

1. Java 25+ only, and only the launcher's own runtime.
2. Key the cache by a hash of: the runtime's `release` file and the size and
   mtime of `lib/server/libjvm` (or `bin/server/jvm.dll`); every classpath
   entry's path, size and mtime, in order; and the tuning flags that change
   heap layout (collector, compact headers, heaps of 32 GB and over, which
   turn compressed oops off). Never trust the JVM to notice a change (25.0.1
   does not).
3. No cache for the key: add `-XX:AOTMode=record -XX:AOTConfiguration=<key>.aotconf`
   to that launch only when recording is cheap enough to hide; after the game
   exits with code 0, run `-XX:AOTMode=create` with the same `-cp` and flags in
   the background lane `archiveClasses` uses, to a `.part` name, then rename
   (never the one-step `-XX:AOTCacheOutput`: it forks the assembler at the
   game's exit and hands it the classpath in `JAVA_TOOL_OPTIONS`, which Windows
   caps at 32,767 characters).
4. Cache for the key: `-XX:AOTCache=<key>.aot`, never `-XX:AOTMode=on`, so a
   bad cache is a warning and never a game that does not start. Drop caches
   for keys no longer in use.

### Mods

Modrinth, Fabric, on 2026-09-23 (`availability.py`):

| mod | 1.20.6 | 1.21.1 | 1.21.4 | 1.21.5 | 1.21.8 | 1.21.10 | 1.21.11 | 26.1.2 | 26.2 | 26.3 |
|---|---|---|---|---|---|---|---|---|---|---|
| modernfix | 5.18.0+mc1.20.6 | 5.25.1+mc1.21.1 | 5.20.3+mc1.21.4 | — | — | — | — | — | — | — |
| scalablelux | — | 0.3.0-alpha.0.7+1. | 0.1.2+fabric.87468 | 0.1.3.1+fabric.ce1 | 0.1.5.1+fabric.abd | 0.1.6+fabric.c2551 | 0.3.0-alpha.0.3+1. | 0.3.0-alpha.0.2+26 | 0.3.0-alpha.0.3+26 | 0.3.0-alpha.0.6+26 |
| c2me-fabric | 0.2.0+alpha.11.100 | 0.4.0-alpha.0.29+1 | 0.3.2+alpha.0.45+1 | 0.3.4+alpha.0.21+1 | 0.3.5+alpha.0.9+1. | 0.3.6+alpha.0.11+1 | 0.4.0-alpha.0.27+1 | 0.4.0-alpha.0.62+2 | 0.4.2-alpha.0.52+2 | 0.4.2-alpha.0.87+2 |
| noisium | 2.3.0+mc1.20.5-1.2 | 2.3.0+mc1.21-1.21. | 2.5.0+mc1.21.4 | 2.6.0+mc1.21.5 | — | — | — | — | — | — |
| ebe | 0.10.1+1.20.6 | 0.10.2+1.21 | 0.11.3+1.21.4 | — | — | — | — | — | — | — |
| fastquit | 3.0.0+1.20.6 | 3.0.0+1.20.6 | 3.0.0+1.21.4 | 3.0.0+1.21.4 | 3.1.1+mc1.21.6 | 3.1.2+mc1.21.10 | 3.1.3+mc1.21.11 | 3.1.4+mc26.1.x | 3.1.5+mc26.2 | 3.1.5+mc26.2 |
| threadtweak | 0.1.3+mc1.20.6 | 0.1.5 | 0.1.7 | 0.1.7 | 0.1.7 | 0.1.8 | 0.1.8 | — | — | — |
| clumps | 17.0.0.1 | 19.0.0.1 | 22.0.0.1 | 23.0.0.1 | 26.0.0.1 | 28.0.0.1 | 29.0.0.1 | 26.1.2.1 | 26.2.1 | 26.3.2 |
| debugify | 1.20.6+1.0 | 1.21.1+1.0 | 1.21.4+1.1 | 1.21.5+1.0 | 1.21.8+1.0 | 1.21.10+1.1 | 1.21.11+1.1 | 26.1.2.2 | 26.2.0.0 | — |
| memoryleakfix | — | — | — | — | — | — | — | — | — | — |
| krypton | 0.2.7 | 0.2.8 | 0.2.8 | 0.2.9 | 0.2.9 | 0.2.10 | 0.2.10 | 0.3.0 | 0.3.1 | — |
| no-chat-reports | Fabric-1.20.6-v2.7 | Fabric-1.21.1-v2.9 | Fabric-1.21.4-v2.1 | Fabric-1.21.5-v2.1 | Fabric-1.21.8-v2.1 | Fabric-1.21.10-v2. | Fabric-1.21.11-v2. | Fabric-26.1-v2.19. | Fabric-26.2-v2.20. | — |

ModernFix, Noisium and Enhanced Block Entities stop at 1.21.4/1.21.5, so they
cannot help either version the launcher leads with. The rest, added one at a
time to the default stack, in the builds `mods.sync` itself chose (the table
above lists the first build Modrinth returns for each version): ScalableLux
0.3.0-alpha.0.6 on 26.3 and 0.1.6 on 1.21.11, C2ME 0.4.2-alpha.0.87 and
0.3.6.0.0, ThreadTweak 0.1.8:

`results/mods-26.3.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| stack | 5/5 | 17.4 [17.1–18.4] | 28.3 [27.5–29.1] | 15.8 [15.3–16.2] | 7.7 [7.1–8.4] | 59.0 [42.2–72.4] | 59.0 [42.2–72.4] | 567 [512–598] | 2773 [2617–2916] |
| +scalablelux | 5/5 | 17.9 [17.6–18.7] | 28.8 [28.4–30.0] | 15.6 [15.0–16.1] | 7.1 [6.4–7.8] | 59.5 [57.9–84.0] | 59.5 [57.9–84.0] | 568 [548–593] | 2575 [2531–2600] |
| +c2me | 5/5 | 18.4 [17.7–19.4] | 31.7 [30.9–33.7] | 16.1 [15.4–16.2] | 7.8 [7.4–8.5] | 54.9 [43.0–74.0] | 54.9 [43.0–74.0] | 582 [561–606] | 2931 [2804–2941] |
| -lambdynlights | 5/5 | 17.4 [17.2–18.2] | 28.4 [27.1–29.3] | 15.9 [15.3–16.2] | 8.1 [7.8–8.5] | 76.2 [59.7–85.6] | 76.2 [59.7–85.6] | 594 [530–614] | 2579 [2468–2934] |
| bare | 5/5 | 16.1 [16.0–16.7] | 26.5 [25.9–27.4] | 12.0 [11.9–12.3] | 5.9 [5.3–6.3] | 37.8 [25.7–39.6] | 37.8 [25.7–39.6] | 492 [477–592] | 3176 [3013–3217] |

Paired against **stack** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| +scalablelux | 5 | +3% [+1%…+3%] | +3% [+1%…+4%] | -2% [-4%…+2%] | -9% [-15%…+4%] | +23% [-18%…+37%] |
| +c2me | 5 | +5% [+2%…+6%] | +13% [+12%…+16%] | +1% [+0%…+2%] | +1% [-3%…+12%] | +12% [-41%…+54%] |
| -lambdynlights | 5 | -1% [-2%…+1%] | -1% [-2%…+3%] | +1% [-1%…+1%] | +4% [-4%…+16%] | +29% [+3%…+60%] |
| bare | 5 | -8% [-9%…-6%] | -6% [-8%…-5%] | -24% [-25%…-21%] | -20% [-36%…-16%] | -45% [-48%…-33%] |

`results/mods-1.21.11.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| stack | 5/5 | 16.3 [16.2–16.6] | 29.0 [28.6–29.5] | 15.2 [14.9–15.7] | 7.2 [6.7–7.7] | 40.0 [34.9–44.1] | 40.0 [34.9–44.1] | 564 [547–606] | 2718 [2677–2740] |
| +scalablelux | 5/5 | 16.4 [16.3–16.6] | 28.8 [28.6–29.1] | 15.0 [14.7–15.3] | 6.8 [6.7–7.8] | 38.9 [30.7–50.6] | 38.9 [30.7–50.6] | 607 [565–657] | 2699 [2639–2726] |
| +c2me | 5/5 | 16.8 [16.6–17.0] | 29.8 [29.3–30.4] | 14.6 [14.3–14.8] | 5.6 [4.8–5.7] | 52.8 [42.2–60.3] | 52.8 [42.2–60.3] | 609 [539–638] | 2468 [2381–2763] |
| +threadtweak | 5/5 | 15.9 [15.6–16.7] | 28.5 [27.4–29.9] | 15.2 [15.1–15.7] | 7.1 [6.2–7.5] | 41.3 [36.0–67.4] | 41.3 [36.0–67.4] | 533 [504–680] | 2725 [2660–2730] |
| -lambdynlights | 5/5 | 16.2 [15.9–16.3] | 28.6 [28.1–29.4] | 15.0 [14.6–15.4] | 6.9 [6.3–7.7] | 39.0 [38.2–47.8] | 39.0 [38.2–47.8] | 589 [534–608] | 2708 [2643–2733] |
| bare | 5/5 | 14.5 [13.9–14.8] | 26.7 [25.8–26.9] | 11.1 [10.4–11.2] | 5.4 [5.3–5.6] | 47.7 [32.1–58.3] | 47.7 [32.1–58.3] | 479 [441–531] | 2531 [2505–2558] |

Paired against **stack** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| +scalablelux | 5 | +1% [-1%…+2%] | -0% [-2%…+0%] | -2% [-4%…+1%] | +1% [-12%…+17%] | +7% [-23%…+15%] |
| +c2me | 5 | +2% [+0%…+5%] | +4% [+0%…+6%] | -5% [-6%…-3%] | -21% [-33%…-16%] | +25% [+7%…+73%] |
| +threadtweak | 5 | -2% [-5%…+3%] | -3% [-5%…+4%] | +0% [-1%…+1%] | -4% [-14%…+6%] | +9% [-11%…+69%] |
| -lambdynlights | 5 | -0% [-4%…+0%] | -2% [-3%…+2%] | -2% [-3%…-0%] | -7% [-12%…+15%] | -2% [-3%…+18%] |
| bare | 5 | -11% [-15%…-10%] | -8% [-13%…-7%] | -29% [-31%…-26%] | -22% [-29%…-19%] | +26% [-27%…+44%] |

No mixin error, crash or loader complaint in any log of these runs (the
only ERROR lines are this machine's: no sound device, no narrator library,
no route to Mojang's services). **None added**: ScalableLux is neutral to
slightly worse; C2ME made the walk into new chunks slower on 26.3 (+13% into
the world) and cost 21% of the 1% low on 1.21.11 — on four cores its
generation threads compete with the frame; ThreadTweak is inside the noise.

And the current stack, one mod taken out at a time — does anything in it
cost launch time for nothing?

`results/drop-26.3.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| stack | 3/3 | 17.1 [17.0–17.7] | 27.6 [27.4–28.2] | 16.0 [15.8–16.3] | 7.2 [7.1–7.5] | 64.2 [60.3–76.2] | 64.2 [60.3–76.2] | 497 [431–507] | 2720 [2533–2891] |
| -moreculling | 3/3 | 17.3 [17.2–17.9] | 28.0 [27.6–29.3] | 16.3 [15.9–16.5] | 7.7 [7.4–8.0] | 67.1 [54.4–69.5] | 67.1 [54.4–69.5] | 597 [542–632] | 2717 [2603–2838] |
| -badoptimizations | 3/3 | 17.1 [17.1–17.3] | 27.9 [27.5–28.4] | 15.9 [15.7–16.0] | 7.9 [7.4–8.0] | 48.0 [38.9–48.6] | 48.0 [38.9–48.6] | 564 [455–567] | 2592 [2505–2709] |
| -immediatelyfast | 3/3 | 17.4 [17.1–17.8] | 28.3 [28.0–28.3] | 15.9 [15.8–16.0] | 7.6 [6.8–7.9] | 72.3 [44.3–73.7] | 72.3 [44.3–73.7] | 539 [538–633] | 2480 [2450–2708] |
| -entityculling | 3/3 | 17.2 [17.1–17.5] | 27.8 [27.3–28.5] | 15.8 [15.5–16.0] | 7.5 [7.2–8.3] | 64.7 [47.3–69.3] | 64.7 [47.3–69.3] | 578 [512–660] | 2767 [2586–2891] |
| -ferritecore | 3/3 | 17.6 [17.5–18.2] | 28.6 [28.0–29.5] | 15.9 [15.4–16.0] | 7.3 [7.1–7.7] | 61.6 [56.3–76.1] | 61.6 [56.3–76.1] | 585 [567–585] | 2695 [2628–2829] |
| -lithium | 3/3 | 17.4 [17.0–17.6] | 27.8 [27.7–28.0] | 15.8 [15.6–15.8] | 7.8 [7.0–8.8] | 53.7 [49.7–66.1] | 53.7 [49.7–66.1] | 613 [552–649] | 2647 [2521–2858] |

Paired against **stack** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| -moreculling | 3 | +1% [+1%…+2%] | +2% [-0%…+4%] | +1% [+1%…+2%] | +4% [+3%…+13%] | -12% [-15%…+15%] |
| -badoptimizations | 3 | -0% [-4%…+2%] | +2% [-3%…+3%] | -1% [-3%…-0%] | +5% [+3%…+14%] | -36% [-36%…-25%] |
| -immediatelyfast | 3 | +2% [-3%…+4%] | +2% [-1%…+3%] | -0% [-2%…+0%] | +8% [-9%…+10%] | +15% [-42%…+20%] |
| -entityculling | 3 | +1% [-4%…+2%] | +1% [-0%…+1%] | -2% [-2%…-1%] | +1% [+1%…+18%] | -15% [-22%…+8%] |
| -ferritecore | 3 | +3% [+3%…+3%] | +3% [+2%…+4%] | -0% [-6%…+1%] | +2% [+1%…+3%] | -0% [-12%…+2%] |
| -lithium | 3 | +2% [-4%…+4%] | +1% [-2%…+2%] | -1% [-4%…-0%] | +10% [-2%…+18%] | -18% [-30%…+3%] |

`results/drop-1.21.11.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| stack | 3/3 | 16.0 [15.9–16.1] | 28.4 [28.4–28.8] | 15.2 [15.1–15.4] | 7.3 [7.1–8.1] | 35.1 [30.4–40.1] | 35.1 [30.4–40.1] | 560 [534–561] | 2703 [2696–2748] |
| -krypton | 3/3 | 15.8 [15.8–16.8] | 28.5 [28.3–29.5] | 15.0 [15.0–15.5] | 7.2 [7.1–7.4] | 52.0 [41.4–52.9] | 52.0 [41.4–52.9] | 566 [531–588] | 2724 [2721–2733] |
| -no-chat-reports | 3/3 | 16.0 [16.0–16.1] | 28.5 [28.4–28.8] | 15.3 [15.2–15.5] | 7.0 [6.8–7.1] | 55.8 [39.8–56.0] | 55.8 [39.8–56.0] | 596 [587–651] | 2710 [2703–2712] |

Paired against **stack** in the same round — median change [min–max] over rounds:

| config | rounds | title | in world | avg FPS | 1% low | pause max |
|---|---|---|---|---|---|---|
| -krypton | 3 | -1% [-2%…+6%] | +0% [-2%…+4%] | -1% [-3%…+3%] | -1% [-8%…+0%] | +36% [+32%…+48%] |
| -no-chat-reports | 3 | -0% [-1%…+1%] | +0% [-1%…+1%] | -0% [-0%…+3%] | -4% [-15%…+1%] | +59% [-1%…+84%] |

No: no single mod's removal made the launch faster (FerriteCore's removal
made it 3% *slower*), and the whole stack costs 1.3–1.8 s against the
companion alone while drawing 31–41% more frames even on a software
renderer (the `bare` rows: 24–29% fewer frames without it). What the culling mods save is GPU work, which
llvmpipe cannot show; nothing here argues for removing any of them.
**Kept as it is.**

### options.txt and mod configs

Not changed. What `settings.js` already writes for a new install (VSync
off, the "Unlimited" cap, `inactivityFpsLimit:"minimized"`) and what
`mods.js` tunes are the settings that cap a frame rate; every remaining
candidate that raises FPS without a visible change is GPU-side (mipmaps,
biome blend, cloud and entity-shadow rendering are all visible anyway), and
a software renderer cannot measure GPU-side work honestly. Sodium's defaults
already defer chunk builds (`chunk_build_defer_mode: ALWAYS`) and animate only
visible textures.

### Final check

The argument list `install.buildCommand` produces after these commits (the
defaults unchanged: Mojang's six, -Xmx4096M -Xms2048M, plus 26.3's own
`-XX:StackShadowPages=32` from its version JSON), started on each Java major
in use and on both vendors:

`results/final.jsonl`

| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |
|---|---|---|---|---|---|---|---|---|---|
| 26.3 mojang-25.0.1 | 1/1 | 17.4 [17.4–17.4] | 27.7 [27.7–27.7] | 14.1 [14.1–14.1] | 7.1 [7.1–7.1] | 71.4 [71.4–71.4] | 71.4 [71.4–71.4] | 574 [574–574] | 2252 [2252–2252] |
| 1.21.11 mojang-21.0.7 | 1/1 | 15.8 [15.8–15.8] | 27.9 [27.9–27.9] | 12.8 [12.8–12.8] | 6.9 [6.9–6.9] | 56.0 [56.0–56.0] | 56.0 [56.0–56.0] | 613 [613–613] | 2712 [2712–2712] |
| 26.3 adoptium-25.0.4 (title) | 1/1 | 17.2 [17.2–17.2] | — | — | — | — | — | 438 [438–438] | 1949 [1949–1949] |
| 1.21.11 adoptium-21.0.12 (title) | 1/1 | 15.7 [15.7–15.7] | — | — | — | — | — | 538 [538–538] | 1436 [1436–1436] |

## Caveats

* Software rendering: absolute FPS (15–16) says nothing about a real GPU.
  What transfers is CPU-side: launch time, time into a world, GC pauses and
  memory, and relative frame-time changes caused by CPU work.
* Linux, not Windows: Windows' own file system and antivirus costs at launch
  are not here, and neither is a real driver's shader compilation.
* Four shared cores: a many-core desktop gives C2ME and the concurrent
  collectors room this machine did not.
* The probe adds one mixin to two methods (a clock read per frame); the same
  jar is in every variant.
