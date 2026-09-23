'use strict';

/**
 * Run a bench plan (2026-09-22). See README.md in this folder.
 *
 *   node tools/bench/run.js plan.json            # every variant, `reps` rounds
 *   node tools/bench/run.js plan.json --only a,b # a subset
 *
 * A plan:
 *   { "reps": 4, "warmup": 15, "measure": 45, "memoryMb": 4096,
 *     "out": "results/jvm-26.3.jsonl",
 *     "variants": [ { "id": "mojang", "profile": "base-26.3" },
 *                   { "id": "zgc", "profile": "base-26.3", "jvmArgs": "-XX:+UseZGC" }, ... ] }
 *
 * A variant: `profile` (a folder prepare.js made), `jvmArgs` (a string, what a
 * player would type in Settings → the launcher's jvmTuning then replaces its
 * own set with it; absent means the launcher's own default for this Java),
 * `xms` ("max" for -Xms equal to -Xmx), `extra` (flags put after the launcher's,
 * e.g. an AOT cache), `aot` ("use": a JDK 25 AOT cache trained by one run of
 * the same variant first, kept under aot/ by `aotKey`; `aotKind: "cds"` makes
 * it Java 21's dynamic CDS archive instead), `title` (true: stop at the title
 * screen, no world), `java` (another runtime of the same major, e.g. Adoptium's).
 *
 * Plan switches for a shared machine: `nice` (default -10), `env` (e.g.
 * LP_NUM_THREADS for llvmpipe), `noQuiet` or `quietCores`/`quietMaxS` (wait for
 * the rest of the machine to go quiet before a run), `foreignLimit` (a run
 * during which everything else used more cores than this is marked
 * contaminated and run again, twice at most), `reuseAot` (keep a trained cache
 * that is already on disk), `noWarm`.
 *
 * The argument list is the launcher's own: install.buildCommand, from the
 * inputs prepare.js saved, with an offline account. The bench only adds its
 * logging (-Xlog gc and safepoints, to files) and the probe's -D switches in
 * front. Rounds alternate direction (A B C, C B A, A B C …) so drift in the
 * machine does not line up with one variant. One untimed launch per profile
 * goes first, so every timed launch starts from a warm disk and a Fabric
 * cache that already exists — the launch a player has every day after the
 * first.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { spawn } = require('child_process');

const SRC = path.join(__dirname, '..', '..', 'src', 'main');
const install = require(path.join(SRC, 'game', 'install'));
const settings = require(path.join(SRC, 'game', 'settings'));

const BENCH_ROOT = path.resolve(process.env.BENCH_ROOT || 'bench-work');
const DISPLAY = process.env.BENCH_DISPLAY || ':77';

/** What the bench fixes in options.txt: the launcher's first-run file, then the bench's own. */
const BENCH_OPTIONS = [
  'renderDistance:4',
  'simulationDistance:5',
  'pauseOnLostFocus:false',
  'onboardAccessibility:false',
  'tutorialStep:none',
  'skipMultiplayerWarning:true',
  'joinedFirstServer:true',
  'narrator:0',
  'soundCategory_master:0.0'
];

function familyOf(mc) {
  return /^1\./.test(mc) ? 'int' : 'moj';
}

async function copyDir(from, to) {
  await fsp.rm(to, { recursive: true, force: true });
  await fsp.cp(from, to, { recursive: true });
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[at];
}

/** Unified-logging line decorated with [time][uptime]: wall ms and the text. */
function parseDecorated(line) {
  const m = /^\[([0-9T:.\-+]+)\]\[([0-9.]+)s\]\s*(.*)$/.exec(line);
  if (!m) return null;
  const iso = m[1].replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
  return { at: Date.parse(iso), uptime: Number(m[2]), text: m[3] };
}

async function readSafepoints(file) {
  const out = [];
  let text = '';
  try { text = await fsp.readFile(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    const d = parseDecorated(line);
    if (!d) continue;
    // JDK 21/25: Safepoint "G1CollectForAllocation", Time since last: …, Reaching safepoint: N ns, …, Total: N ns
    const m = /Safepoint "([^"]+)".*Total: (\d+) ns/.exec(d.text);
    if (m) out.push({ at: d.at, op: m[1], ms: Number(m[2]) / 1e6 });
  }
  return out;
}

async function readGc(file) {
  const out = [];
  let text = '';
  try { text = await fsp.readFile(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    const d = parseDecorated(line);
    if (!d) continue;
    // G1: "GC(12) Pause Young (Normal) (G1 Evacuation Pause) 500M->200M(2048M) 12.345ms"
    // ZGC/Shenandoah: "GC(3) Garbage Collection (…) …" / "GC(3) Concurrent …" — counted, pauses via safepoints
    const m = /GC\((\d+)\) (Pause [^0-9]*|Garbage Collection \([^)]*\)|Minor Collection \([^)]*\)|Major Collection \([^)]*\)|Concurrent reset|Trigger).*?(?:([\d.]+)ms)?$/.exec(d.text);
    if (m) out.push({ at: d.at, id: Number(m[1]), kind: m[2].trim(), ms: m[3] ? Number(m[3]) : null, text: d.text });
  }
  return out;
}

function frameStats(frames) {
  if (!frames.length) return null;
  const ms = frames.map((us) => us / 1000);
  const total = ms.reduce((a, b) => a + b, 0);
  const sorted = [...ms].sort((a, b) => a - b);
  const worst1 = sorted.slice(Math.floor(sorted.length * 0.99));
  const worst01 = sorted.slice(Math.floor(sorted.length * 0.999));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    frames: ms.length,
    avgFps: (ms.length / total) * 1000,
    p50Ms: pct(sorted, 50),
    p99Ms: pct(sorted, 99),
    low1Fps: 1000 / mean(worst1),     // mean of the slowest 1% of frames, as FPS
    low01Fps: 1000 / mean(worst01),   // the slowest 0.1%
    maxMs: sorted[sorted.length - 1],
    over50: ms.filter((x) => x > 50).length,
    over100: ms.filter((x) => x > 100).length
  };
}

function loadAvg() {
  return os.loadavg()[0];
}

/** Busy jiffies of the whole machine (all CPUs), from /proc/stat. */
function machineBusy() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal
  return line[0] + line[1] + line[2] + line[5] + line[6] + (line[7] || 0);
}

/** utime + stime of one process (all its threads), in jiffies; null when gone. */
function processBusy(pid) {
  try {
    const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return Number(fields[11]) + Number(fields[12]);
  } catch {
    return null;
  }
}

const XVFB_PID = (() => {
  try {
    for (const name of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      const cmd = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8');
      if (cmd.startsWith('Xvfb\0' + DISPLAY + '\0')) return Number(name);
    }
  } catch { /* none */ }
  return null;
})();

/**
 * The machine is shared (2026-09-22: other sessions ran their own games and
 * browsers on the same four cores). Before a run, wait until the rest of the
 * machine has used under `limit` cores' worth for five seconds, up to `maxS`;
 * each run records what it waited and what everything else used while it
 * ran (foreignCores), so a contaminated run can be seen and set aside.
 */
async function waitQuiet(limit = 0.5, maxS = 900) {
  const started = Date.now();
  for (;;) {
    const a = machineBusy();
    await new Promise((r) => setTimeout(r, 5000));
    const b = machineBusy();
    const cores = (b - a) / 100 / 5;
    if (cores < limit || Date.now() - started > maxS * 1000) {
      return { waitedS: (Date.now() - started) / 1000, busyCores: +cores.toFixed(2) };
    }
  }
}

async function oneRun(plan, variant, round, index) {
  const inputs = JSON.parse(await fsp.readFile(path.join(BENCH_ROOT, 'inst', variant.profile, 'bench-launch.json'), 'utf8'));
  const gameDir = inputs.gameDir;
  const runId = `${variant.id}-r${round}-${Date.now()}`;
  const runDir = path.join(BENCH_ROOT, 'runs', path.basename(plan.out || 'plan', '.jsonl'), runId);
  await fsp.mkdir(runDir, { recursive: true });

  // A fresh world, the probe, the bench's options.
  const world = !variant.title;
  if (world) {
    await copyDir(path.join(BENCH_ROOT, 'worlds', inputs.mc), path.join(gameDir, 'saves', 'bench'));
  }
  await fsp.copyFile(path.join(BENCH_ROOT, 'probe', `benchprobe-${familyOf(inputs.mc)}.jar`),
    path.join(gameDir, 'mods', 'benchprobe.jar'));
  await fsp.writeFile(path.join(gameDir, 'options.txt'),
    settings.FIRST_OPTIONS + BENCH_OPTIONS.join('\n') + '\n', 'utf8');
  if (variant.config) {
    for (const [rel, body] of Object.entries(variant.config)) {
      const file = path.join(gameDir, rel);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    }
  }
  await fsp.rm(path.join(gameDir, 'logs', 'latest.log'), { force: true });

  const memoryMb = variant.memoryMb || plan.memoryMb || 4096;
  const account = { username: 'Bench', uuid: install.offlineUuid('Bench'), accessToken: '0', type: 'offline' };
  const args = install.buildCommand({
    json: inputs.json,
    classpath: inputs.classpath,
    clientJar: inputs.clientJar,
    nativesDir: inputs.nativesDir,
    gameDir,
    assets: inputs.assets,
    account,
    memoryMb,
    versionId: inputs.versionId,
    librariesDir: inputs.librariesDir,
    jvmArgs: variant.jvmArgs || '',
    resolution: { width: 854, height: 480, fullscreen: false },
    world: world ? 'bench' : null,
    javaMajor: inputs.javaMajor
  });
  if (variant.xms === 'max') {
    const at = args.findIndex((a) => a.startsWith('-Xms'));
    args[at] = '-Xms' + memoryMb + 'M';
  }
  const mainAt = args.indexOf(inputs.json.mainClass);
  const extra = [...(variant.extra || [])];
  const aotFile = path.join(BENCH_ROOT, 'aot', `${variant.profile}-${variant.aotKey || variant.id}.aot`);
  // `aotKind: "cds"` is Java 21's nearest thing: a dynamic CDS archive
  // (-XX:ArchiveClassesAtExit, then -XX:SharedArchiveFile) over the base one.
  const cds = variant.aotKind === 'cds';
  if (variant.aot === 'train') {
    await fsp.mkdir(path.dirname(aotFile), { recursive: true });
    await fsp.rm(aotFile, { force: true });
    extra.push(cds ? '-XX:ArchiveClassesAtExit=' + aotFile : '-XX:AOTCacheOutput=' + aotFile);
  } else if (variant.aot === 'use') {
    extra.push(cds ? '-XX:SharedArchiveFile=' + aotFile : '-XX:AOTCache=' + aotFile);
  }
  const bench = [
    `-Xlog:gc:file=${path.join(runDir, 'gc.log')}:time,uptime`,
    `-Xlog:safepoint:file=${path.join(runDir, 'safepoint.log')}:time,uptime`,
    `-Dbench.warmup=${plan.warmup || 15}`,
    `-Dbench.measure=${plan.measure || 45}`,
    `-Dbench.out=${path.join(runDir, 'frames.txt')}`,
    `-Dbench.titleOnly=${Boolean(variant.title)}`,
    ...(familyOf(inputs.mc) === 'int' ? ['-Dbench.levelField=field_1687', '-Dbench.screenField=field_1755'] : ['-Dbench.screenField=gui.screen'])
  ];
  const full = [...bench, ...args.slice(0, mainAt), ...extra, ...args.slice(mainAt)];
  await fsp.writeFile(path.join(runDir, 'args.json'), JSON.stringify(full, null, 1));

  const env = { ...process.env, DISPLAY, LIBGL_ALWAYS_SOFTWARE: '1' };
  delete env.JAVA_TOOL_OPTIONS;
  delete env.JDK_JAVA_OPTIONS;
  // 26.x opens its window through SDL3 and asks for an sRGB framebuffer that
  // Xvfb's GLX does not offer (srgbshim.c); 1.21.x (GLFW) runs without it.
  const shim = path.join(BENCH_ROOT, 'srgbshim.so');
  if (familyOf(inputs.mc) === 'moj' && fs.existsSync(shim)) env.LD_PRELOAD = shim;
  if (plan.env) Object.assign(env, plan.env);
  const quiet = plan.noQuiet ? null : await waitQuiet(plan.quietCores || 0.5, plan.quietMaxS || 900);
  const load = loadAvg();
  const markers = {};
  const spawnedAt = Date.now();
  // The launcher starts the game a step above normal priority on Windows
  // (game/gpu.js, raise); the bench does the same here, and harder (nice -10,
  // plan.nice), because this machine is shared with other tenants. Linux nice
  // is per thread and inherited at thread creation, so it is set at the exec
  // (nice keeps the pid), not afterwards.
  const niceness = plan.nice === undefined ? -10 : plan.nice;
  // `java`: another runtime of the same major (an Adoptium build, say), for
  // checking that a flag set starts on more than Mojang's.
  const javaBinary = variant.java || inputs.javaBinary;
  const child = niceness
    ? spawn('nice', ['-n', String(niceness), javaBinary, ...full], { cwd: gameDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(javaBinary, full, { cwd: gameDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // [ms, machine busy, ours (game + Xvfb)] once a second: foreign CPU per phase.
  const samples = [];
  const sample = () => {
    const ours = processBusy(child.pid);
    if (ours === null) return;
    samples.push([Date.now(), machineBusy(), ours + (XVFB_PID ? processBusy(XVFB_PID) || 0 : 0)]);
  };
  sample();
  const cpuTimer = setInterval(sample, 1000);
  const stdout = fs.createWriteStream(path.join(runDir, 'stdout.log'));
  let peakRssKb = 0;
  const rssTimer = setInterval(() => {
    try {
      const status = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8');
      const m = /VmHWM:\s+(\d+)/.exec(status);
      if (m) peakRssKb = Math.max(peakRssKb, Number(m[1]));
    } catch { /* gone */ }
  }, 1000);
  let buffer = '';
  const onData = (chunk) => {
    stdout.write(chunk);
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const m = /BENCHPROBE (\S+) (\d+)/.exec(line);
      if (m && !markers[m[1]]) markers[m[1]] = Number(m[2]);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const timeoutMs = (plan.timeoutS || 600) * 1000;
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, timeoutMs);
    child.on('exit', (c, s) => { clearTimeout(timer); resolve(c === null ? s : c); });
  });
  clearInterval(rssTimer);
  clearInterval(cpuTimer);
  stdout.end();
  /** Cores' worth of CPU used by everything that is not this game, between two wall times. */
  const foreign = (from, to) => {
    if (!from || !to) return null;
    const inside = samples.filter((x) => x[0] >= from - 1000 && x[0] <= to + 1000);
    if (inside.length < 2) return null;
    const a = inside[0];
    const b = inside[inside.length - 1];
    const secs = (b[0] - a[0]) / 1000;
    return secs > 0 ? +(((b[1] - a[1]) - (b[2] - a[2])) / 100 / secs).toFixed(2) : null;
  };

  let frames = [];
  try {
    frames = (await fsp.readFile(path.join(runDir, 'frames.txt'), 'utf8')).split('\n').filter(Boolean).map(Number);
  } catch { /* no frames */ }
  const safepoints = await readSafepoints(path.join(runDir, 'safepoint.log'));
  const gcs = await readGc(path.join(runDir, 'gc.log'));
  const windowFrom = markers.inworld ? markers.inworld + (plan.warmup || 15) * 1000 : null;
  const windowTo = markers.measured || null;
  const inWindow = (e) => windowFrom && windowTo && e.at >= windowFrom && e.at <= windowTo;
  const beforeLoaded = (e) => markers.loaded && e.at <= markers.loaded;
  const spW = safepoints.filter(inWindow).map((e) => e.ms).sort((a, b) => a - b);
  const gcW = gcs.filter(inWindow);
  const spStart = safepoints.filter(beforeLoaded).map((e) => e.ms);
  const rel = (t) => (t ? (t - spawnedAt) / 1000 : null);

  const result = {
    plan: plan.out, variant: variant.id, profile: variant.profile, mc: inputs.mc, round, index,
    ok: Boolean(world ? markers.done : markers.loaded), exit: code, load1: load,
    firstFrameS: rel(markers.firstframe),
    titleS: rel(markers.loaded),
    worldS: rel(markers.inworld),
    worldAfterTitleS: markers.inworld && markers.loaded ? (markers.inworld - markers.loaded) / 1000 : null,
    fps: frameStats(frames),
    pauses: {
      window: { count: spW.length, totalMs: spW.reduce((a, b) => a + b, 0), p99Ms: pct(spW, 99), maxMs: spW.length ? spW[spW.length - 1] : 0 },
      gcInWindow: gcW.filter((g) => /Pause|Garbage|Minor|Major/.test(g.kind)).length,
      startup: { count: spStart.length, totalMs: spStart.reduce((a, b) => a + b, 0), maxMs: spStart.length ? Math.max(...spStart) : 0 }
    },
    peakRssMb: Math.round(peakRssKb / 1024),
    quiet,
    foreignCores: { startup: foreign(spawnedAt, markers.loaded), window: foreign(windowFrom, windowTo) },
    runDir
  };
  return result;
}

async function main() {
  const planFile = process.argv[2];
  const plan = JSON.parse(await fsp.readFile(planFile, 'utf8'));
  const onlyAt = process.argv.indexOf('--only');
  const only = onlyAt > 0 ? new Set(process.argv[onlyAt + 1].split(',')) : null;
  const variants = plan.variants.filter((v) => !only || only.has(v.id));
  const out = path.resolve(BENCH_ROOT, plan.out || 'results.jsonl');
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const write = (r) => fs.appendFileSync(out, JSON.stringify(r) + '\n');

  // One untimed launch per profile (and the AOT training runs): warm disk, Fabric's caches made.
  if (!plan.noWarm) {
    const seen = new Set();
    for (const v of variants) {
      if (seen.has(v.profile)) continue;
      seen.add(v.profile);
      const r = await oneRun(plan, { id: 'warm', profile: v.profile, title: true }, 0, 0);
      console.log(`[warm] ${v.profile} ok=${r.ok} title=${r.titleS}`);
    }
  }
  for (const v of variants.filter((v) => v.aot === 'use')) {
    const cached = path.join(BENCH_ROOT, 'aot', `${v.profile}-${v.aotKey || v.id}.aot`);
    if (plan.reuseAot && fs.existsSync(cached)) {
      console.log(`[train] ${v.id} reusing ${cached}`);
      continue;
    }
    const r = await oneRun(plan, { ...v, aot: 'train', id: v.id + '-train', aotKey: v.aotKey || v.id }, 0, 0);
    r.training = true;
    write(r);
    console.log(`[train] ${v.id} ok=${r.ok} title=${r.titleS} world=${r.worldS} exit=${r.exit}`);
  }

  for (let round = 1; round <= (plan.reps || 3); round++) {
    const order = round % 2 ? variants : [...variants].reverse();
    let index = 0;
    for (const v of order) {
      // A run during which the rest of the machine used more than
      // `foreignLimit` cores (startup or the measured window) is kept, marked,
      // and run again, up to twice; the summary leaves marked runs out.
      let r;
      for (let attempt = 0; attempt < 3; attempt++) {
        r = await oneRun(plan, v, round, index);
        const f = r.foreignCores || {};
        const limit = plan.foreignLimit || 1.0;
        r.contaminated = (f.startup || 0) > limit || (f.window || 0) > limit;
        if (!r.contaminated || attempt === 2) break;
        write(r);
        console.log(`[r${round}] ${v.id} contaminated ${JSON.stringify(f)}, again`);
      }
      index++;
      write(r);
      const f = r.fps || {};
      console.log(`[r${round}] ${v.id.padEnd(18)} ok=${r.ok} title=${r.titleS && r.titleS.toFixed(1)}s world=${r.worldS && r.worldS.toFixed(1)}s ` +
        `fps=${f.avgFps && f.avgFps.toFixed(1)} low1=${f.low1Fps && f.low1Fps.toFixed(1)} sp.max=${r.pauses.window.maxMs.toFixed(1)}ms foreign=${JSON.stringify(r.foreignCores)} waited=${r.quiet && r.quiet.waitedS}`);
    }
  }
  console.log('results in', out);
  console.log(JSON.stringify(summarise(fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))), null, 1));
}

/** Median and range per variant, over the timed runs. */
function summarise(rows) {
  const by = {};
  for (const r of rows) {
    if (r.training || !r.ok || r.contaminated) continue;
    (by[r.variant] = by[r.variant] || []).push(r);
  }
  const out = {};
  for (const [id, rs] of Object.entries(by)) {
    const col = (f) => rs.map(f).filter((x) => x !== null && x !== undefined);
    const stat = (xs) => (xs.length ? { med: +median(xs).toFixed(2), min: +Math.min(...xs).toFixed(2), max: +Math.max(...xs).toFixed(2) } : null);
    out[id] = {
      n: rs.length,
      titleS: stat(col((r) => r.titleS)),
      worldS: stat(col((r) => r.worldS)),
      avgFps: stat(col((r) => r.fps && r.fps.avgFps)),
      low1Fps: stat(col((r) => r.fps && r.fps.low1Fps)),
      pauseP99Ms: stat(col((r) => r.pauses.window.p99Ms)),
      pauseMaxMs: stat(col((r) => r.pauses.window.maxMs)),
      startupPauseMs: stat(col((r) => r.pauses.startup.totalMs)),
      peakRssMb: stat(col((r) => r.peakRssMb))
    };
  }
  return out;
}

module.exports = { summarise, frameStats };

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
}
