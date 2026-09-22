'use strict';

/**
 * Why a game died, in the launcher's own words (2026-09-11).
 *
 * Until this file a game that crashed was announced as "Minecraft exited
 * before starting (code 1). See the log for details." — true, and no use to
 * anyone: the log is forty kilobytes of Java, and the one thing a player wants
 * to know is whether it was a mod, and which. So when a session ends badly the
 * launcher reads what the game itself wrote down — the newest crash report in
 * the profile's `crash-reports/`, an `hs_err_pid*.log` if Java itself fell
 * over, the tail of the JVM's own output — and turns it into one line the row
 * on Home can carry ("Crashed — Sodium is the likely cause") with the actions
 * that follow from it (Retry, Remove that mod, More memory, Open log).
 *
 * WHAT FABRIC ACTUALLY WRITES. Forge's reports carry a "Suspected Mods" block
 * (its CrashReportAnalyser); Fabric's do not, and BlueClient launches Vanilla
 * and Fabric only — none of the eight real reports on the machine this was
 * built on has one. So the culprit is read from what a Fabric report does
 * say, in this order of confidence:
 *
 *   1. a mixin that failed to apply — `Mixin [x.mixins.json:Foo from mod iris]
 *      … FAILED during APPLY`, and the *last* such line, because the deepest
 *      "Caused by" is the root cause (an entrypoint error names the mod whose
 *      start-up tripped over it, which is often the wrong one);
 *   2. an entrypoint that threw — `provided by 'sodium'`;
 *   3. a mixin-injected frame in the stack — Mixin names its handlers
 *      `handler$zoc000$blueclient$clipFrame`, mod id in the middle;
 *   4. the package of a stack frame, against a short table of the mods that
 *      ship with BlueClient and, for anything else, the ids in the report's
 *      own "Fabric Mods:" list (`voicechat` is in `de.maxhenkel.voicechat`).
 *
 * A `Suspected Mods:` block is read too, should a loader ever start writing
 * one, but nothing depends on it. The game, the runtime, Fabric Loader, Fabric
 * API's modules and the mixin library are never blamed: a frame in
 * `net.minecraft` is where the crash surfaced, not where it came from.
 *
 * WHICH MODS CAN BE REMOVED. The performance stack every Fabric profile is
 * born with (state.js, `performanceStack`) and the in-game half of BlueClient
 * come with the launcher; a row can say so but must not offer to take them
 * out. Anything else in the profile's list was added by the player, and the
 * quickest test of a crash is a launch without it — that is the Remove button.
 * The set is written here once, by Fabric mod id and by Modrinth slug, because
 * the report speaks the first and the profile the second, and main decides;
 * the renderer only reads `suspect.bundled` and `suspect.modId`.
 *
 * Nothing in here throws to a caller and nothing in here waits on the
 * network, or ever will — it runs on the exit path, after the game is gone,
 * so a directory listing and one small file read cost the player nothing,
 * but the reads are still capped, because a crash report can be a megabyte
 * of thread dump.
 *
 * OPT-IN CRASH REPORTS (2026-09-11). `reportShape` turns a record into the
 * nine fields Settings → General's "Send crash reports" promises the admin
 * — see that switch's own line for the exact words, which this shape must
 * never promise more or less than. `onCrash` is how stats.js hears about a
 * crash the moment `remember` below keeps one: this file still makes no
 * network call and reads no setting — it only offers the hook and the
 * shape, and stats.js decides, with the switch, whether either is used.
 */

const os = require('os');
const path = require('path');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { VERSION } = require('./version');

/**
 * What comes with BlueClient — the companion mod, and the eight-mod stack in
 * state.js's `performanceStack()` — as the ids Fabric prints and the slugs the
 * profile stores. Keep in step with that list.
 */
const BUNDLED = new Set([
  'blueclient',
  'sodium', 'lithium',
  'ferritecore', 'ferrite-core',
  'entityculling',
  'immediatelyfast',
  'krypton',
  'dynamic_fps', 'dynamic-fps', 'dynamicfps',
  'iris',
  'moreculling', 'badoptimizations',
  // Not a performance mod, but the launcher's own line since 2026-09-20:
  // "comes with BlueClient — nothing to remove", and no red toast on a
  // Minecraft it has no build for yet.
  'nochatreports', 'no-chat-reports',
  // In the stack since 2026-09-11 and 2026-09-20 and never listed here until
  // 2026-09-22: a crash inside either offered Remove on a bundled mod.
  'lambdynlights', 'lambdynamiclights',
  'mcpvp-tier-tagger', 'mcpvp.com-tier-tagger', 'tiertagger'
]);

/** Ids that are never the culprit: the game, the runtime, the loader, its API. */
const NOBODY = /^(?:minecraft|java|fabricloader|fabric|fabric-api|fabric-.*|mixinextras|lwjgl.*)$/;

/**
 * The packages of the bundled mods, so a frame names them without a lookup.
 * Anything else is matched by the ids in the report's own mod list.
 */
const PACKAGES = [
  ['com.blueclient.', 'blueclient'],
  ['net.caffeinemc.mods.sodium.', 'sodium'],
  ['me.jellysquid.mods.sodium.', 'sodium'],
  ['net.caffeinemc.mods.lithium.', 'lithium'],
  ['me.jellysquid.mods.lithium.', 'lithium'],
  ['malte0811.ferritecore.', 'ferritecore'],
  ['dev.tr7zw.entityculling.', 'entityculling'],
  ['net.raphimc.immediatelyfast.', 'immediatelyfast'],
  ['me.steinborn.krypton.', 'krypton'],
  ['dynamic_fps.', 'dynamic_fps'],
  ['net.irisshaders.iris.', 'iris'],
  ['net.coderbot.iris.', 'iris'],
  ['ca.fxco.moreculling.', 'moreculling'],
  ['me.thosea.badoptimizations.', 'badoptimizations']
];

/** How the row names the companion: "BlueClient is the likely cause" reads as the launcher. */
const COMPANION_NAME = "BlueClient's in-game mod";

/** Native libraries a JVM crash usually lands in, named for the player. */
const NATIVES = [
  [/^nvoglv|^nvwgf2|^nvcuda/i, 'the NVIDIA graphics driver', 'nvidia'],
  [/^atio6axx|^amdvlk|^atiumd/i, 'the AMD graphics driver', 'amd'],
  [/^ig\d+icd|^igxelpicd|^igd/i, 'the Intel graphics driver', 'intel'],
  [/^lwjgl|^glfw/i, "the game's window library"],
  [/^jvm\.dll$/i, 'Java itself']
];

/**
 * Where a graphics driver is fetched from, by vendor (2026-09-20). A crash
 * inside the driver is the one kind the row can do nothing about from here
 * except say which driver is installed and where the current one is: a
 * player wrote "it crashes every minute" under a row that said only
 * "nvoglv64.dll", and the row now says the driver's version and age beside
 * an Update driver button. Nothing here is downloaded or run by the launcher.
 */
const DRIVER_PAGES = {
  nvidia: 'https://www.nvidia.com/en-us/drivers/',
  amd: 'https://www.amd.com/en/support/download/drivers.html',
  intel: 'https://www.intel.com/content/www/us/en/download-center/home.html'
};

/** The vendor of the native a frame names, or null. */
function driverVendor(frame) {
  const inside = (/\[([^\]+]+)/.exec(frame || '') || [])[1] || '';
  const named = NATIVES.find(([test]) => test.test(inside));
  return named && named[2] ? named[2] : null;
}

let driverAsked = null;

/**
 * The installed graphics drivers, once per launcher run: name, version and
 * date per adapter, from Windows' own table (Win32_VideoController). The
 * version Windows keeps for an NVIDIA card is the driver store's
 * (`32.0.15.8115`), not the one on NVIDIA's page; `nvidia-smi`, which every
 * NVIDIA driver installs beside System32, says `581.15`, so it is asked as
 * well when it is there. Never throws; an empty list when nothing answers
 * in four seconds.
 */
function graphicsDrivers() {
  if (driverAsked) return driverAsked;
  driverAsked = (async () => {
    if (process.platform !== 'win32') return [];
    const run = (exe, args) => new Promise((resolve) => {
      try {
        execFile(exe, args, { timeout: 4000, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => resolve(error ? '' : String(stdout || '')));
      } catch {
        resolve('');
      }
    });
    const out = [];
    const json = await run('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      "Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name = $_.Name; version = $_.DriverVersion; date = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' } } } | ConvertTo-Json -Compress"]);
    try {
      const parsed = JSON.parse(json.trim());
      for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!row || typeof row.name !== 'string') continue;
        const name = row.name;
        const vendor = /nvidia|geforce|quadro|rtx/i.test(name) ? 'nvidia' : /amd|radeon|ati /i.test(name) ? 'amd' : /intel/i.test(name) ? 'intel' : null;
        out.push({ name, vendor, version: String(row.version || ''), date: String(row.date || '') });
      }
    } catch { /* no table, no driver line on the row */ }
    const nvidia = out.find((d) => d.vendor === 'nvidia');
    if (nvidia) {
      const smi = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
      const said = (await run(smi, ['--query-gpu=driver_version', '--format=csv,noheader'])).trim().split(/\r?\n/)[0];
      if (/^\d{3}\.\d{2}/.test(said || '')) nvidia.version = said;
      else {
        // 32.0.15.8115 -> 581.15: the last five digits of the last two groups.
        const digits = nvidia.version.split('.').slice(-2).join('').replace(/\D/g, '');
        if (digits.length >= 5) nvidia.version = `${digits.slice(-5, -2)}.${digits.slice(-2)}`;
      }
    }
    return out;
  })();
  return driverAsked;
}

/** The driver line for a crash whose frame is inside one: vendor, version, date, page. */
async function driverOf(frame) {
  const vendor = driverVendor(frame);
  if (!vendor) return null;
  const drivers = await graphicsDrivers();
  const found = drivers.find((d) => d.vendor === vendor) || null;
  return { vendor, version: found ? found.version : '', date: found ? found.date : '', page: DRIVER_PAGES[vendor] };
}

/**
 * The driver of the card this PC plays on, for a fault with no frame to
 * name (2026-09-20): the one NVIDIA or AMD driver installed — the game is
 * put on the high-performance card (game/gpu.js), so on a laptop with an
 * Intel chip beside it the Intel one is not the answer — or the Intel one
 * when it is the only one. Null when there are two to choose from, or none:
 * a wrong Update driver button is worse than no button.
 */
async function mainDriver() {
  const drivers = (await graphicsDrivers()).filter((d) => d.vendor);
  const discrete = drivers.filter((d) => d.vendor !== 'intel');
  const vendors = new Set(discrete.map((d) => d.vendor));
  let found = null;
  if (vendors.size === 1) found = discrete[0];
  else if (vendors.size === 0 && drivers.length) found = drivers[0];
  if (!found) return null;
  return { vendor: found.vendor, version: found.version, date: found.date, page: DRIVER_PAGES[found.vendor], name: found.name };
}

/**
 * The card's name for the frame record's ping (2026-09-22): the discrete
 * card where the PC has one vendor of them, the only card otherwise, and
 * nothing where two discrete vendors leave it unclear. Never an address,
 * never a serial — the model name as Windows lists it.
 */
async function gpuName() {
  const main = await mainDriver();
  return main && main.name ? String(main.name).slice(0, 64) : null;
}

/** How much of a report or an hs_err file is worth reading. */
const READ_CAP = 512 * 1024;
/** How many lines of the report go into the session's own log. */
const LOG_LINES = 40;
/** How many crash records the register keeps; MAX_SESSIONS is five as well. */
const KEEP = 5;

/* ===================================================================== */
/* The exit path                                                          */
/* ===================================================================== */

/**
 * Read a session's ending and say what it was, or null for a clean exit.
 *
 * @param {object} opts
 * @param {number|null} opts.code    the JVM's exit code; null when the launcher killed it
 * @param {string[]}    opts.tail    the last lines of the JVM's own output
 * @param {string}      [opts.notes] the companion's stall notes, kept whole whatever the tail holds (2026-09-21)
 * @param {string}      opts.gameDir the profile's folder — crash-reports/ and hs_err live here
 * @param {number}      opts.since   when the JVM was spawned; older files are someone else's crash
 * @param {object[]}    [opts.mods]  the profile's mod list (id, name, slug), for Remove
 * @param {number}      [opts.memoryMb]
 * @param {boolean}     [opts.customJava] a Java path is set in Settings
 */
async function explain(opts) {
  const { code = null, tail = [], gameDir = '', since = 0 } = opts || {};
  try {
    const report = gameDir ? await newest(path.join(gameDir, 'crash-reports'), /^crash-.*\.txt$/i, since) : null;
    const hsErr = gameDir ? await newest(gameDir, /^hs_err_pid.*\.log$/i, since) : null;

    // The launcher's own X arrives as a signal (code null); a player closing
    // the window is code 0. Neither is a crash unless the game wrote one down.
    const bad = typeof code === 'number' && code !== 0;
    if (!bad && !report && !hsErr) return null;

    const text = Array.isArray(tail) ? tail.join('') : String(tail || '');
    const record = analyse(report ? report.text : '', {
      hsErr: hsErr ? hsErr.text : '',
      tail: text,
      notes: typeof opts.notes === 'string' ? opts.notes : '',
      code,
      mods: opts.mods,
      memoryMb: opts.memoryMb,
      customJava: opts.customJava
    });
    record.report = report ? report.file : null;
    record.hsErr = hsErr ? hsErr.file : null;
    record.gameDir = gameDir;
    // A fault inside a graphics driver: which driver, how old, and where the
    // current one is (2026-09-20). Asked only now, only for this kind — and
    // for a fault Windows reported with no frame to name (WINDOWS_EXITS),
    // the driver of the card this PC plays on, when there is one to name.
    if (record.kind === 'java' && driverVendor(record.frame)) {
      const driver = await driverOf(record.frame).catch(() => null);
      if (driver) Object.assign(record, driverWords(record, driver));
    } else if (record.kind === 'java' && record.fault) {
      const driver = await mainDriver().catch(() => null);
      if (driver) Object.assign(record, driverWords(record, driver));
    } else if (record.kind === 'hang' && record.stall && record.stall.place && record.stall.place.kind === 'driver') {
      // A freeze inside a call into the driver (2026-09-21): the same line
      // and the same Update driver button a fault in it gets, after the
      // sentence that says where it stood.
      const driver = await mainDriver().catch(() => null);
      if (driver) {
        const words = driverWords(record, driver);
        record.detail = record.detail.replace(/ A current graphics driver ends most of these\.$/, '') + ' ' + words.driverLine;
        record.driver = words.driver;
      }
    }
    return record;
  } catch {
    // Diagnostics must never be the reason the exit path fails.
    return fallback(code);
  }
}

/** The newest file in `dir` whose name fits, written after `since`, with its head read. */
async function newest(dir, pattern, since) {
  let names;
  try {
    names = (await fsp.readdir(dir)).filter((name) => pattern.test(name));
  } catch {
    return null;
  }
  // Crash reports carry their time in the name, so the newest sorts last.
  // An hs_err file does not: it is named by the dead JVM's process id, and
  // "hs_err_pid12345" sorts before "hs_err_pid6000" — so taking the last few
  // by name, as this did until 2026-09-22, missed a fresh JVM crash in any
  // profile that had kept four older ones with larger-sorting ids, and the
  // row said "see the log" for a crash Java had written down. The files are
  // ordered by their own time instead (the last 256 by name, a bound on a
  // folder nobody tidies), and only those written since the launch are read.
  names.sort();
  const found = [];
  for (const name of names.slice(-256)) {
    try {
      const stat = await fsp.stat(path.join(dir, name));
      // A second of slack: the JVM's clock and the file's are not the same one.
      if (stat.isFile() && stat.mtimeMs >= since - 1000) found.push({ name, stat });
    } catch {
      /* gone between the listing and the look */
    }
  }
  found.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  for (const { name, stat } of found.slice(0, 4)) {
    const file = path.join(dir, name);
    try {
      const handle = await fsp.open(file, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(READ_CAP, stat.size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return { file, text: buffer.toString('utf8', 0, bytesRead), at: stat.mtimeMs };
      } finally {
        await handle.close();
      }
    } catch {
      /* gone, or unreadable: the next one */
    }
  }
  return null;
}

/* ===================================================================== */
/* Reading                                                                */
/* ===================================================================== */

/**
 * Turn a crash report (or none) plus what else is known into a record.
 * Pure: the tool under tools/ runs it over a folder of reports.
 *
 * @param {string} reportText  the crash report, or '' when the game wrote none
 * @param {object} extra       { hsErr, tail, code, mods, memoryMb, customJava }
 */
function analyse(reportText, extra = {}) {
  const report = reportText ? readReport(reportText) : null;
  const tail = String(extra.tail || '');
  const code = typeof extra.code === 'number' ? extra.code : null;
  const base = {
    kind: 'unknown',
    headline: '',
    detail: '',
    suspect: null,
    description: report ? report.description : '',
    exception: report ? report.exception : firstError(tail),
    code: signed(code),
    reportHead: report ? report.head.split('\n').slice(0, LOG_LINES).join('\n') : '',
    // For the admin report only (2026-09-11, see reportShape below) — never
    // read by the row on Home, which keeps naming things the way it always
    // has. Blank on an hs_err-only crash: a native JVM crash carries nothing
    // Minecraft-specific to read.
    minecraftVersion: report ? report.minecraftVersion : '',
    loader: report ? report.loader : '',
    // The companion's own version, when the report lists it — the same
    // "Fabric Mods:" entry findSuspect reads, looked up by id directly so
    // it is there whether or not blueclient itself is the suspect.
    modVersion: (report && report.mods.get('blueclient') && report.mods.get('blueclient').version) || ''
  };

  // Java itself fell over. Read before the report, because a native crash
  // sometimes leaves a half-written report behind it and the hs_err is the
  // one that says what happened.
  if (extra.hsErr) {
    const err = readHsErr(String(extra.hsErr));
    if (err.memory) return finish({ ...base, kind: 'heap', gb: null }, extra);
    // The VM fell over in its own code before it had finished starting
    // (2026-09-19): its files, not a driver — see brokenRuntime.
    if (err.unstarted) return finish({ ...base, kind: 'runtime' }, extra);
    return finish({ ...base, kind: 'java', frame: err.frame }, extra);
  }

  const everything = (report ? report.head : '') + '\n' + tail;

  if (/java\.lang\.OutOfMemoryError/.test(everything)) {
    return finish({ ...base, kind: 'memory' }, extra);
  }
  const heap = /Could not reserve enough space for (\d+)KB object heap|insufficient memory for the Java Runtime Environment|Initial heap size set to a larger value than the maximum/i.exec(everything);
  if (heap) {
    const gb = heap[1] ? (Number(heap[1]) / 1024 / 1024).toFixed(1) : null;
    return finish({ ...base, kind: 'heap', gb }, extra);
  }

  if (report) {
    if (/java\.lang\.Error: Watchdog/.test(report.exception)) {
      return finish({ ...base, kind: 'hang', closing: /shutdown/i.test(report.description) }, extra);
    }
    const suspect = findSuspect(report, extra.mods);
    if (suspect) return finish({ ...base, kind: 'mod', suspect }, extra);
    return finish(base, extra);
  }

  // No report: the JVM died before the game could write one. The two cases
  // explainExit used to know, a runtime with files missing (2026-09-19),
  // and the first error line for anything else.
  if (/UnsupportedClassVersionError/.test(tail)) return finish({ ...base, kind: 'javaVersion' }, extra);
  if (/Could not find or load main class/.test(tail)) return finish({ ...base, kind: 'files' }, extra);
  if (brokenRuntime(tail, code)) return finish({ ...base, kind: 'runtime' }, extra);
  // Windows' own word for how the process ended, when the game left none
  // (2026-09-20): closed as "not responding", or a fault outside Java's
  // own handler. See WINDOWS_EXITS.
  const windows = WINDOWS_EXITS.get(signed(code));
  if (windows === 'hang') {
    // Where it stood (2026-09-21): the render thread's stack the companion
    // wrote ten seconds into the freeze, when there is one — the row names
    // the place, the report carries the frame, and a mod the player added
    // gets its Remove button the way a crash inside it would.
    const stall = readStall(extra.notes || tail, extra.mods);
    return finish({
      ...base,
      kind: 'hang',
      killed: true,
      stall,
      exception: stall ? stallLine(stall) : base.exception,
      suspect: stall && stall.place ? stall.place.suspect : null
    }, extra);
  }
  if (windows) return finish({ ...base, kind: 'java', frame: '', fault: windows }, extra);
  return finish(base, extra);
}

/**
 * What Windows says when a process dies without a word of its own
 * (2026-09-20), by the exit code it hands the launcher — signed, the way the
 * log prints it. None of these leaves a crash report or an hs_err file,
 * which is why until today every one of them read "Minecraft exited with
 * code -805306369" and nothing else.
 *
 * `hang` is STATUS_APPLICATION_HANG (0xCFFFFFFF): the game stopped answering
 * Windows for long enough that Windows offered to close it, and it was
 * closed — by the player on that dialog, or by End task in Task Manager,
 * which ends a "not responding" process with the same code. Not a crash in
 * the game's own code at all; a freeze, which is a different conversation.
 * The first log to carry it (a player's, 1.21.11, 196 mods, 7 GB heap) had
 * the game up for forty seconds, in a lobby, and no error anywhere in it.
 *
 * The others are faults outside the JVM's own handler — HotSpot writes an
 * hs_err for a fault it catches, so one that reached Windows happened on a
 * thread it does not own, which on a gaming PC is the graphics driver's:
 * an access violation (0xC0000005) or an illegal instruction (0xC000001D)
 * are `fault`; a stack overflow (0xC00000FD) is `stack`; a fail-fast
 * (0xC0000409, "stack buffer overrun") or a heap corruption (0xC0000374)
 * are `corrupt`. All four are told as Java falling over outside its own
 * code, with the driver line and its Update driver button when this PC has
 * one card's driver to name (explain, `mainDriver`).
 */
const WINDOWS_EXITS = new Map([
  [-805306369, 'hang'],
  [-1073741819, 'fault'],
  [-1073741795, 'fault'],
  [-1073741571, 'stack'],
  [-1073740791, 'corrupt'],
  [-1073740940, 'corrupt']
]);

/** The line under a fault Windows reported and Java did not, by kind. */
const FAULT_WORDS = {
  fault: 'Java fell over outside its own code, with no report — which is nearly always the graphics driver. A current driver ends most of these.',
  stack: 'Java ran out of stack outside its own code — usually a shaderpack or the graphics driver. Shaders off first, then a fresh driver.',
  corrupt: "Something outside Java corrupted its memory — a driver, or a mod's native library. A current graphics driver ends most of these."
};

/**
 * The JVM's own files were not all there (2026-09-19).
 *
 * Two shapes, from two players' launch logs on the same day. HotSpot that
 * starts but cannot find its module image (`lib/modules`) prints "Error
 * occurred during initialization of VM / Failed setting boot class path" and
 * exits — the first line is also the heap messages' opener, which is why the
 * heap checks in analyse() run before this one. And a javaw.exe missing one
 * of the DLLs beside it never runs a line of Java at all: Windows refuses to
 * start the process, the exit code is STATUS_DLL_NOT_FOUND (0xC0000135,
 * -1073741515 signed, 4294967295-style unsigned as Node hands it over) and
 * the output is empty. Only an empty output makes that code a broken
 * runtime: a game that printed its way to the title screen and then died
 * with it is something else. The third shape — the module image present at
 * the right size with the wrong bytes — is an hs_err in the VM's own code
 * before it has started, read in readHsErr (`unstarted`).
 *
 * The kind is what makes the row say "Retry repairs Java": the Retry then
 * hashes every file of the runtime (launcher.js `_java`, install.ensureJava
 * with `repair`), which is what catches the third shape.
 */
function brokenRuntime(tail, code) {
  if (/Error occurred during initialization of VM|Failed setting boot class path/.test(tail)) return true;
  const dllNotFound = signed(code) === -1073741515;
  return dllNotFound && tail.trim().length < 200 && !/\[[^\]]*\/(?:INFO|WARN|ERROR)\]/.test(tail);
}

/** The head of a report — everything before the walkthrough — and its mod list. */
function readReport(text) {
  const cut = text.indexOf('A detailed walkthrough');
  const head = cut > 0 ? text.slice(0, cut) : text.slice(0, 12000);
  const description = (/^Description: (.*)$/m.exec(head) || [, ''])[1].trim();

  // The exception is the first non-blank line after the Description line.
  let exception = '';
  const lines = head.split('\n');
  const at = lines.findIndex((line) => line.startsWith('Description:'));
  for (let i = at + 1; i >= 0 && i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) { exception = line; break; }
  }

  const mods = readModList(text);
  return {
    head, description, exception, mods, text,
    // For the admin report only (2026-09-11, see reportShape below): the
    // game's own "Minecraft Version:" line out of the System Details
    // section, which — like "Fabric Mods:" — sits after the walkthrough cut
    // and so is read from the full text, not head. Not the profile's
    // declared version: what the report itself says actually ran.
    minecraftVersion: (/^[ \t]*Minecraft Version:\s*(\S+)/m.exec(text) || [, ''])[1],
    // A vanilla crash carries no "Fabric Mods:" section at all — Fabric adds
    // it — so an empty mod list is the honest signal that this was vanilla.
    loader: mods.size ? 'fabric' : 'vanilla'
  };
}

/**
 * Fabric API's "Fabric Mods:" section — `\t\tid: Name version` per mod, with
 * the mods a jar carries inside it one tab deeper. Only the top level is a
 * mod the player could have added.
 */
function readModList(text) {
  const mods = new Map();
  const start = text.indexOf('Fabric Mods:');
  if (start >= 0) {
    for (const line of text.slice(start).split('\n').slice(1)) {
      if (!line.startsWith('\t\t')) break;           // the section ended
      if (line.startsWith('\t\t\t')) continue;        // a jar inside a jar
      const match = /^\t\t([^:\s]+): (.*)$/.exec(line);
      if (!match) continue;
      const words = match[2].trim().split(' ');
      const name = words.length > 1 ? words.slice(0, -1).join(' ') : words[0];
      mods.set(match[1], { id: match[1], name, version: words.length > 1 ? words[words.length - 1] : '' });
    }
  }
  return mods;
}

/**
 * Which mod to name. See the file comment for the order and why.
 * @returns {{ id, name, bundled, modId } | null}
 */
function findSuspect(report, mods) {
  const { head } = report;
  const listed = report.mods;
  const blame = (id) => (id && !NOBODY.test(id) && !library(id)) ? id : null;

  let id = null;

  // A Forge-style block, if one ever appears: "Suspected Mods:" then
  // "\tName (id)" lines.
  const block = /Suspected Mods:\s*\n((?:\t[^\n]*\n?)+)/.exec(head);
  if (block && !/NONE/.test(block[1])) {
    const first = /\(([a-z0-9_\-]+)\)/.exec(block[1]);
    if (first) id = blame(first[1]);
  }

  // 1. The last mixin that failed to apply — the root cause.
  if (!id) {
    let last = null;
    const applied = /from mod ([a-z0-9_\-]+)\]?[^\n]*(?:FAILED during|Critical injection failure|failed injection check|Invalid descriptor|No candidates were found)/g;
    let match;
    while ((match = applied.exec(head))) if (blame(match[1])) last = match[1];
    id = last;
  }

  // 2. An entrypoint that threw.
  if (!id) {
    const entry = /provided by '([^']+)'/.exec(head);
    if (entry) id = blame(entry[1]);
  }

  // 3 and 4. The frames, nearest the fault first.
  if (!id) {
    const frames = head.match(/^\s*at [^\n]+/gm) || [];
    for (const frame of frames) {
      const injected = /\$[a-z]{3}\d{3}\$([a-z0-9_\-]+)\$/.exec(frame);
      if (injected && blame(injected[1])) { id = injected[1]; break; }

      const where = (/at (?:[a-z]+\/\/|[A-Za-z]+\/)?([\w.$\-]+)\(/.exec(frame) || [])[1] || '';
      if (!where) continue;
      const known = PACKAGES.find(([prefix]) => where.startsWith(prefix));
      if (known && blame(known[1])) { id = known[1]; break; }

      const packed = where.toLowerCase().replace(/[^a-z0-9.]/g, '');
      for (const candidate of listed.keys()) {
        if (!blame(candidate)) continue;
        const bare = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (bare.length >= 4 && packed.includes(bare)) { id = candidate; break; }
      }
      if (id) break;
    }
  }

  if (!id) return null;

  const entry = matchProfileMod(id, listed.get(id), mods);
  const bundled = id === 'blueclient' || BUNDLED.has(id) || Boolean(entry && BUNDLED.has(String(entry.slug || '').toLowerCase()));
  const name = id === 'blueclient' ? COMPANION_NAME
    : (entry && entry.name) || (listed.get(id) && listed.get(id).name) || id;
  // The version the crash report's own "Fabric Mods:" line gives this mod —
  // for the admin report only (2026-09-11, see reportShape). Never shown on
  // the row, which names who and what, not which build.
  const version = (listed.get(id) && listed.get(id).version) || '';
  return { id, name, bundled, modId: bundled ? null : (entry ? entry.id : null), version };
}

/** A maven-style id (`org_antlr_antlr4-runtime`) is a library a mod carries, not a mod. */
function library(id) {
  return (id.match(/_/g) || []).length >= 2;
}

/**
 * The profile's own entry for a mod id: the same name, then the same slug,
 * then one inside the other (`voicechat` is Modrinth's `simple-voice-chat`).
 */
function matchProfileMod(id, listed, mods) {
  if (!Array.isArray(mods) || !mods.length) return null;
  const bare = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wantId = bare(id);
  const wantName = listed ? bare(listed.name) : '';

  const byName = wantName && mods.find((mod) => bare(mod.name) === wantName);
  if (byName) return byName;
  const bySlug = mods.find((mod) => bare(mod.slug) === wantId || bare(mod.name) === wantId);
  if (bySlug) return bySlug;
  if (wantId.length >= 4) {
    const inside = mods.find((mod) => {
      const slug = bare(mod.slug);
      const name = bare(mod.name);
      return (slug && (slug.includes(wantId) || wantId.includes(slug)))
        || (name && (name.includes(wantId) || wantId.includes(name)))
        || (wantName && name && (name.includes(wantName) || wantName.includes(name)));
    });
    if (inside) return inside;
  }
  return null;
}

/**
 * The lines of an hs_err file worth having: whether it was memory, where
 * the fault was, and — since 2026-09-19 — whether the VM had even started.
 * `unstarted` is a fault in the VM's own code (`V [jvm.dll+…]`, not a `C`
 * frame in a driver or a native library) under two seconds after the
 * process began: a module image with the wrong bytes at the right size does
 * exactly this, 27 ms in, with no build string on the "JRE version" line
 * because there was no VM yet to say one. Nothing the player added runs in
 * that time; a fault there is the runtime's files.
 */
function readHsErr(text) {
  const head = text.split('\n').slice(0, 60).join('\n');
  const memory = /insufficient memory for the Java Runtime Environment/i.test(head);
  const frame = (/# Problematic frame:\s*\n# (.*)/.exec(head) || [, ''])[1].trim();
  const elapsed = /elapsed time: (\d+(?:\.\d+)?) seconds/.exec(head);
  const unstarted = /^V\s+\[(?:jvm\.dll|libjvm\.(?:so|dylib))/.test(frame)
    && Boolean(elapsed) && Number(elapsed[1]) < 2;
  return { memory, frame, unstarted };
}

/** The first line of the JVM's own output that looks like an error. */
function firstError(tail) {
  const match = /^(?:Error|Exception in thread .*|java\.lang\.\w+(?:Error|Exception)).*$/m.exec(tail);
  return match ? match[0].trim() : '';
}

/* ===================================================================== */
/* Where a frozen game stood (2026-09-21)                                 */
/* ===================================================================== */

/**
 * The note the companion's `Stall` writes ten seconds into a freeze (mod
 * 1.50.0): "The game has not drawn a frame for 11 seconds — the render
 * thread is timed_waiting at:" and the thread's frames under it, top first.
 * The last such note in the output is the one the closing followed — a game
 * that froze, recovered and froze again was closed on the second. Nothing
 * before that mod version wrote one, and a freeze under ten seconds writes
 * none; then this is null and the row says what it always said.
 *
 * The dash and the prefix log4j puts on the first line are matched loosely:
 * the game's output reaches the launcher in whatever encoding Java chose
 * for its console, and the dash has come through as three other bytes.
 */
const STALL = /The game (has not drawn a frame for|is still not drawing, after|is drawing again, after) (\d+) seconds(?:[^\r\n]*?the render thread is (\w+) at:\r?\n((?:[ \t]*at [^\r\n]*\r?\n?)+))?/g;

function readStall(text, mods) {
  const all = readFreezes(text, mods).filter((f) => f.kind !== 'slow');
  return all.length ? all[all.length - 1] : null;
}

/**
 * Every freeze the notes describe, in order (2026-09-21, later): a note at
 * ten seconds opens one, "is still not drawing" at thirty belongs to the
 * same, and "is drawing again, after N seconds" closes it with how long it
 * was — `back` true, `seconds` the whole of it. A freeze the game never
 * came back from is the last one, still open. The stack read for the place
 * is the first one written, at ten seconds: the second, at thirty, is the
 * same stall a moment later and only replaces it when the first had no
 * frames worth reading.
 */
function readFreezes(text, mods) {
  const out = [];
  let match;
  STALL.lastIndex = 0;
  while ((match = STALL.exec(String(text || '')))) {
    const [, words, seconds, state, block] = match;
    const open = out.length && !out[out.length - 1].back ? out[out.length - 1] : null;
    if (words.startsWith('is drawing again')) {
      if (open) { open.back = true; open.seconds = Number(seconds); }
      continue;
    }
    const frames = String(block || '').split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('at '))
      // "knot//com.blueclient.Probe.tick(Probe.java:43)" — the loader's name
      // in front, or a module's ("java.base/…"); neither is part of where.
      .map((line) => line.slice(3).replace(/^[^(]*\//, ''));
    if (!frames.length) continue;
    const place = stallPlace(frames, mods);
    if (words.startsWith('is still') && open) {
      open.seconds = Number(seconds);
      if (!open.place && place) Object.assign(open, { state, frames, place });
      continue;
    }
    out.push({ seconds: Number(seconds), state, frames, place, back: false, at: match.index });
  }
  /* The slow patches join the list where their line actually stands in the
     same text (2026-09-22), so the launch log's freezes block reads in the
     order the game said them rather than every stall and then every patch. */
  for (const slow of readSlowPatches(text, mods)) out.push(slow);
  out.sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const entry of out) delete entry.at;
  return out;
}

/* The companion's two other lines about time (2026-09-22): a patch of slow
 * frames the sampler in Stall.java summed up, and the sitting's frame record
 * FrameClock says at every disconnect and at the stop. */
const SLOW = /Slow frames: ([\d.]+) s over (\d+) frames past (\d+) ms — mostly in ([^;\r\n]+); GC ([\d.]+) s over the patch/g;
const FRAMES = /Frames: (\d+) over (\d+) s — median ([\d.]+) fps, 1% low ([\d.]+), longest (\d+) ms, GC ([\d.]+) s in (\d+) pauses/g;

/**
 * Every patch of slow frames the notes describe, in order, in the shape of a
 * freeze (`kind: 'slow'`): the seconds it lasted, how many frames ran past the
 * mark, where the render thread mostly stood (the first place, named the way a
 * stall's is) and the collector's time over it.
 */
function readSlowPatches(text, mods) {
  const out = [];
  let match;
  SLOW.lastIndex = 0;
  while ((match = SLOW.exec(String(text || '')))) {
    const [, seconds, frames, past, placesText, gc] = match;
    const places = placesText.split(', ').map((p) => {
      const m = /^(.+?) \((\d+)%\)$/.exec(p.trim());
      return m ? { where: m[1], share: Number(m[2]) } : { where: p.trim(), share: 0 };
    });
    const first = places[0] ? places[0].where : '';
    const place = first && !first.startsWith('(') ? stallPlace([first + '(sampled)'], mods) : null;
    out.push({ kind: 'slow', seconds: Number(seconds), frames: Number(frames), pastMs: Number(past), places, place, gcSeconds: Number(gc), back: true, at: match.index });
  }
  return out;
}

/**
 * The sittings' frame records, in order: what FrameClock said at each
 * disconnect and at the stop. The last one is the sitting that ended the
 * session, which is what the ping carries.
 */
function readFrameRecords(text) {
  const out = [];
  let match;
  FRAMES.lastIndex = 0;
  while ((match = FRAMES.exec(String(text || '')))) {
    const [, frames, seconds, median, low1, longest, gc, pauses] = match;
    out.push({ frames: Number(frames), seconds: Number(seconds), median: Number(median), low1: Number(low1),
      longestMs: Number(longest), gcSeconds: Number(gc), gcPauses: Number(pauses) });
  }
  return out;
}

/** One frame record as the launch log's `frames` block says it. */
function frameLine(record) {
  return `${record.frames} frames over ${record.seconds} s · median ${record.median} fps · 1% low ${record.low1} · longest ${record.longestMs} ms · GC ${record.gcSeconds} s in ${record.gcPauses} pauses`;
}

/** One freeze as the launch log's `freezes` block says it. */
function freezeLine(freeze) {
  if (freeze.kind === 'slow') {
    const where = freeze.place ? freeze.place.name + (freeze.place.short ? ` (${freeze.place.short})` : '') : (freeze.places[0] ? freeze.places[0].where : 'somewhere the stack does not say');
    const share = freeze.places[0] && freeze.places[0].share ? ` ${freeze.places[0].share}% of the time` : '';
    return `${freeze.seconds} s of slow frames (${freeze.frames} past ${freeze.pastMs} ms), mostly in ${where}${share}, GC ${freeze.gcSeconds} s over it`;
  }
  const where = freeze.place ? stallWords(freeze).replace(/^It froze /, '') : 'somewhere the stack does not say';
  return `${freeze.seconds} s ${where}${freeze.back ? ', and came back' : ' — never came back'} · ${stallLine(freeze)}`;
}

/** What a frame's class belongs to: the JDK, a library, the game, the driver, or a mod. */
const JDK = /^(?:java|javax|jdk|sun|com\.sun)\./;
const DRIVER = /^org\.lwjgl\.(?:opengl|glfw|openal|vulkan|sdl)\./;
const LIBRARY = /^(?:org\.lwjgl|io\.netty|com\.google|it\.unimi|org\.apache|org\.joml|org\.slf4j|org\.spongepowered|com\.llamalad7|net\.fabricmc)\./;
const GAME = /^(?:net\.minecraft|com\.mojang)\./;
/** A package segment that names no mod: the shape every mod's packages share. */
const GENERIC = new Set(['com', 'net', 'org', 'io', 'de', 'me', 'dev', 'github', 'gitlab', 'mods', 'mod', 'client',
  'common', 'impl', 'api', 'util', 'utils', 'mixin', 'mixins', 'core', 'main', 'minecraft', 'fabric', 'render',
  'renderer', 'gui', 'screen', 'world', 'entity', 'block', 'item', 'event', 'events', 'config', 'internal']);

/**
 * Whose code the render thread was in, read the way findSuspect reads a
 * crash's frames — nearest the top first — but with the two places a crash
 * never lands in named too: the game's own code, and a call into the
 * graphics driver that never came back. The JDK's own frames are skipped
 * (a stuck thread is nearly always parked in java.* on top of what it is
 * waiting for), and so are the libraries every mod shares. A mod is named
 * by its injected handler, by a bundled package, or by a package segment
 * that is in the profile's own list; a package none of that knows is
 * named as the package.
 */
function stallPlace(frames, mods) {
  const blame = (id) => (id && !NOBODY.test(id) && !library(id)) ? id : null;
  let place = null;
  let via = null;
  for (const frame of frames) {
    const where = frame.split('(')[0];
    if (!where || JDK.test(where)) continue;

    let kind = null;
    let id = null;
    const injected = /\$[a-z]{3}\d{3}\$([a-z0-9_\-]+)\$/.exec(where);
    if (injected && blame(injected[1])) {
      kind = 'mod'; id = injected[1];
    } else if (DRIVER.test(where)) {
      kind = 'driver';
    } else if (LIBRARY.test(where)) {
      continue;
    } else if (GAME.test(where)) {
      kind = 'game';
    } else {
      kind = 'mod';
      const known = PACKAGES.find(([prefix]) => where.startsWith(prefix));
      id = known ? known[1] : null;
    }

    const found = { kind, id, frame, where };
    if (!place) {
      place = found;
      if (kind !== 'driver') break;
    } else if (kind !== 'driver') {
      via = found;
      break;
    }
  }
  if (!place) return null;
  return { ...describe(place, mods), via: via ? describe(via, mods) : null };
}

/** The place as the row and the report say it: a name, and the mod's entry when it is one. */
function describe(found, mods) {
  const short = found.where.split('.').slice(-2).join('.');
  const out = { kind: found.kind, frame: found.frame, short, name: '', suspect: null };
  if (found.kind === 'game') { out.name = "Minecraft's own code"; return out; }
  if (found.kind === 'driver') { out.name = 'the graphics driver'; return out; }

  let id = found.id;
  let entry = id ? matchProfileMod(id, null, mods) : null;
  if (!id) {
    // A package the launcher does not know: the profile's own list, by any
    // segment of it that is inside a mod's slug or name — voicechat in
    // simple-voice-chat, litematica in litematica.
    const segments = found.where.toLowerCase().split('.').filter((s) => s.length >= 4 && !GENERIC.has(s));
    const bare = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const segment of segments) {
      entry = (Array.isArray(mods) ? mods : []).find((mod) => mod && (bare(mod.slug).includes(segment) || bare(mod.name).includes(segment)));
      if (entry) { id = String(entry.slug || entry.id || segment); break; }
    }
  }
  if (!id) {
    out.name = found.where.split('.').slice(0, 3).join('.');
    return out;
  }
  const bundled = id === 'blueclient' || BUNDLED.has(id) || Boolean(entry && BUNDLED.has(String(entry.slug || '').toLowerCase()));
  out.name = id === 'blueclient' ? COMPANION_NAME : (entry && entry.name) || id;
  out.suspect = { id, name: out.name, bundled, modId: bundled ? null : (entry ? entry.id : null), version: '' };
  return out;
}

/** The first sentence of a frozen-and-closed row that knows where it stood. */
function stallWords(stall) {
  const place = stall.place;
  const readable = !/(?:^|\.)(?:class|method|field)_\d+/.test(place.short);
  const at = readable ? ` (${place.short})` : '';
  switch (place.kind) {
    case 'driver': {
      // The call that never came back, and who made it when that was a mod.
      const asked = place.via && place.via.suspect ? `, asked by ${place.via.name}` : '';
      return `It froze inside the graphics driver (${place.short}${asked})`;
    }
    case 'game':
      return `It froze inside Minecraft's own code${at}`;
    default:
      return place.suspect ? `It froze inside ${place.name}${at}` : `It froze inside ${place.name} (not a mod BlueClient knows)`;
  }
}

/** The one line the admin report and the launch log carry for a freeze: the top frame, and the place under it. */
function stallLine(stall) {
  const top = stall.frames[0];
  const place = stall.place && stall.place.frame !== top ? ` in ${stall.place.frame}` : '';
  // "15s" when the game came back and the number is the whole of it; "10s+" for
  // a freeze still going when the note was written.
  return `Froze ${stall.seconds}s${stall.back ? "" : "+"} ${stall.state} at ${top}${place}`;
}

/** Windows hands -1 back as 4294967295; the log reads better signed. */
function signed(code) {
  if (typeof code !== 'number') return code;
  return code > 0x7fffffff ? code - 0x100000000 : code;
}

/**
 * How many mods the player added to the profile — enabled, and not the
 * stack or the companion — from the list the launch handed over; 0 when it
 * handed none. For the frozen-and-closed row's one honest guess.
 */
function addedMods(mods) {
  if (!Array.isArray(mods)) return 0;
  return mods.filter((mod) => mod && mod.enabled !== false
    && !BUNDLED.has(String(mod.slug || mod.id || '').toLowerCase())).length;
}

/**
 * The PC's memory in MB when the heap the game was given is more than three
 * fifths of it, else 0. The launcher's own default is half of the PC's, so a
 * heap this high was set by hand or came in with an imported profile — and
 * on a PC of eight gigabytes it is the reason the whole machine freezes.
 */
function heapTooHigh(memoryMb) {
  const total = Math.floor(os.totalmem() / (1024 * 1024));
  if (!memoryMb || !total) return 0;
  return memoryMb >= total * 0.6 ? total : 0;
}

/**
 * The line under a driver crash, with the driver on it (2026-09-20): its
 * version and how old it is, and the one thing that usually ends these —
 * a current driver. A driver under half a year old is named without the
 * advice, because then it is not the age.
 */
function driverWords(record, driver) {
  const names = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' };
  const brand = names[driver.vendor] || 'graphics';
  const inside = (/\[([^\]+]+)/.exec(record.frame || '') || [])[1] || '';
  let months = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(driver.date)) {
    months = Math.max(0, Math.round((Date.now() - Date.parse(driver.date)) / (30.44 * 24 * 3600 * 1000)));
  }
  const age = months === null ? '' : months >= 24 ? `${Math.floor(months / 12)} years old` : months >= 2 ? `${months} months old` : 'from this month';
  const which = driver.version ? `${brand} driver ${driver.version}` : `The ${brand} driver`;
  const old = months !== null && months >= 6;
  // A fault Windows reported with no frame (WINDOWS_EXITS): the driver is
  // the likeliest place, not the known one, and the line says so.
  const where = inside
    ? `Java fell over in the ${brand} graphics driver (${inside}).`
    : `Java fell over outside its own code, with no report — nearly always the ${brand} graphics driver.`;
  // The driver's own sentence, on its own too, for a row whose first
  // sentence is not "Java fell over" — a freeze inside a driver call.
  const driverLine = !driver.version
    ? 'A current driver ends most of these.'
    : old
    ? `${which} is installed and is ${age} — a current driver ends most of these.`
    : `${which} is installed${age ? ` (${age})` : ''}. If it keeps happening, try Shaders off, then a fresh driver.`;
  const detail = `${where} ${driverLine}`;
  return { detail, driverLine, driver: { vendor: driver.vendor, version: driver.version, date: driver.date, page: driver.page } };
}

/** The headline and the line under it, from the kind. */
function finish(record, extra = {}) {
  const out = { ...record };
  const gb = (mb) => `${(Number(mb) / 1024).toFixed(1)} GB`;

  switch (out.kind) {
    case 'mod': {
      const { name, bundled, modId, id } = out.suspect;
      out.headline = `Crashed — ${name} is the likely cause`;
      if (id === 'blueclient') out.detail = "BlueClient's own mod, not one you added. Retry, or open the log.";
      else if (bundled) out.detail = `${name} comes with BlueClient — nothing to remove. Retry, or open the log.`;
      else if (modId) out.detail = `${name} was added to this profile. Removing it is the quickest test.`;
      else out.detail = `${name} is in the mods folder but not in BlueClient's list. Take it out by hand.`;
      break;
    }
    case 'memory':
      out.headline = 'Crashed — out of memory';
      out.detail = extra.memoryMb ? `Minecraft used up the ${gb(extra.memoryMb)} it was given.` : 'Minecraft used up the memory it was given.';
      break;
    case 'heap':
      out.headline = out.gb ? `Crashed — this PC could not give Minecraft ${out.gb} GB`
        : 'Crashed — this PC could not give Minecraft its memory';
      out.detail = 'Windows needs some of the memory too. Give Minecraft less.';
      break;
    case 'java': {
      out.headline = "Crashed — Minecraft's Java crashed";
      // A fault Windows reported and Java did not (WINDOWS_EXITS): no frame
      // to name, so the words are the code's; the driver line, when this PC
      // has one to name, is put on afterwards by explain.
      if (out.fault) {
        out.detail = FAULT_WORDS[out.fault];
        break;
      }
      const inside = (/\[([^\]+]+)/.exec(out.frame || '') || [])[1] || '';
      const named = NATIVES.find(([test]) => test.test(inside));
      out.detail = inside
        ? (named ? `Java fell over in ${named[1]} (${inside}).` : `Java fell over in ${inside}.`)
        : (out.frame ? `Java fell over at ${out.frame.slice(0, 100)}.` : 'Java itself fell over. The report says where.');
      break;
    }
    case 'hang':
      if (out.killed) {
        // Closed by Windows, or by the player on Windows' word, after a
        // freeze (2026-09-20). Not the game giving up on itself: the two
        // things a freeze that long usually is are named when the launch
        // knows them — a profile carrying a crowd of added mods, and a heap
        // that left Windows too little of the PC's memory to stand on.
        out.headline = 'Closed — Minecraft stopped responding';
        const added = addedMods(extra.mods);
        const high = heapTooHigh(extra.memoryMb);
        // Since 2026-09-21 the first sentence names where it stood when the
        // companion's stall note is in the output (readStall); a game that
        // wrote none — an older mod, a freeze under ten seconds — gets the
        // sentence it always did.
        const place = out.stall && out.stall.place;
        out.detail = place
          ? `${stallWords(out.stall)} for so long that Windows offered to close it, and it was closed.`
          : 'It froze for so long that Windows offered to close it, and it was closed.';
        if (high) {
          out.detail += ` Minecraft was given ${gb(extra.memoryMb)} of this PC's ${gb(high)} — Windows had little left, and a PC out of memory freezes. Give Minecraft less.`;
          out.memoryHigh = true;
        } else if (place && place.suspect && place.suspect.id === 'blueclient') {
          out.detail += " BlueClient's own mod, not one you added. Retry, or open the log.";
        } else if (place && place.suspect && place.suspect.bundled) {
          out.detail += ` ${place.name} comes with BlueClient — nothing to remove. If it keeps happening: Shaders off, then fewer mods.`;
        } else if (place && place.suspect && place.suspect.modId) {
          out.detail += ` Removing ${place.name} is the quickest test.`;
        } else if (place && place.suspect) {
          out.detail += ` ${place.name} is in the mods folder but not in BlueClient's list. Take it out by hand.`;
        } else if (place && place.kind === 'driver') {
          // The driver's own line — its version and age — goes on in explain,
          // when this PC has one card's driver to name.
          out.detail += ' A current graphics driver ends most of these.';
        } else if (added >= 30) {
          out.detail += ` With ${added} added mods, the first minute in a world is the heaviest; if it keeps happening, fewer mods is the test.`;
        } else {
          out.detail += ' If it keeps happening: Shaders off, then fewer mods.';
        }
        break;
      }
      out.headline = 'Crashed — Minecraft stopped responding';
      out.detail = out.closing
        ? 'It stopped answering for more than ten seconds while closing.'
        : 'It stopped answering for too long and the game gave up on itself.';
      break;
    case 'files':
      out.headline = 'Crashed — a game file was missing';
      out.detail = 'Retry downloads it again.';
      break;
    case 'javaVersion':
      out.headline = 'Crashed — this Minecraft needs a newer Java';
      out.detail = extra.customJava
        ? 'The Java set in Settings → Game is too old for it.'
        : 'Retry fetches the right one.';
      break;
    case 'runtime':
      out.headline = "Crashed — Java's files were incomplete";
      out.detail = extra.customJava
        ? 'The Java set in Settings → Game is missing some of its files.'
        : 'Retry repairs Java and tries again.';
      break;
    default:
      out.headline = 'Crashed — see the log';
      out.detail = out.exception
        ? out.exception.slice(0, 140)
        : (typeof out.code === 'number' ? `Minecraft exited with code ${out.code}.` : 'Minecraft closed without saying why.');
  }
  out.customJava = Boolean(extra.customJava);
  return out;
}

/** When even reading the folder failed: the honest minimum. */
function fallback(code) {
  return finish({
    kind: 'unknown', headline: '', detail: '', suspect: null,
    description: '', exception: '', code: signed(code), reportHead: ''
  });
}

/* ===================================================================== */
/* The admin report — nine fields, and no more (2026-09-11)               */
/* ===================================================================== */

/**
 * What crosses the network when Settings → General's "Send crash reports"
 * is on — word for word what the line under that switch promises: the
 * crash reason (kind, headline), the suspected mod (its id and its own
 * version, read the same place findSuspect reads it), and the Minecraft and
 * BlueClient versions — both BlueClient numbers, the launcher's own and the
 * companion mod's, because they can differ (a hotfix jar has shipped
 * between launcher releases before — see "Discover Servers, and a count of
 * who plays" in the journal). Never a path, a log, a username, an account
 * or an install id. Pure, and safe to call on a `fallback()` record too;
 * `stats.js` sends exactly this object and nothing it adds to it.
 */
function reportShape(record) {
  if (!record) return null;
  const suspect = record.suspect || null;
  return {
    launcher: VERSION,
    mod: String(record.modVersion || ''),
    minecraft: String(record.minecraftVersion || ''),
    loader: String(record.loader || ''),
    kind: String(record.kind || 'unknown'),
    headline: String(record.headline || ''),
    suspect: suspect ? String(suspect.id || '') : '',
    suspectVersion: suspect ? String(suspect.version || '') : '',
    // The error line — or, for a game that died without writing one, its exit
    // code (2026-09-18), which is the only thing such a crash has to say and
    // the difference between an access violation and a JVM that was killed.
    exception: String(record.exception || (typeof record.code === 'number' ? `Minecraft exited with code ${record.code}.` : '')).slice(0, 200)
  };
}

/** stats.js's one listener, told about every crash the moment it is kept. */
let onRemember = null;

/**
 * stats.js calls this once, from main, to hear about every crash as it
 * happens — which is every call to `remember` below, including the ones a
 * launch in its first 1200ms takes on the reject path in launcher.js rather
 * than `_finish`. One callback: this file has exactly one real listener.
 * `tools/check-crash-report.js` supplies its own to prove the wiring
 * without Electron or a running session.
 */
function onCrash(callback) {
  onRemember = typeof callback === 'function' ? callback : null;
}

/* ===================================================================== */
/* The register — crashes the rows on Home are still showing              */
/* ===================================================================== */

const records = new Map();

/** Keep a session's crash until the player closes its row, and say so. */
function remember(id, record) {
  const full = { ...record, id, at: Date.now() };
  records.set(id, full);
  while (records.size > KEEP) records.delete(records.keys().next().value);
  if (onRemember) {
    // Whatever stats.js does with this must never be the reason a session's
    // exit path fails — it already promises to be fire-and-forget itself,
    // this is only the backstop.
    try { onRemember(full); } catch { /* not this file's problem */ }
  }
  return records.get(id);
}

function get(id) {
  return records.get(id) || null;
}

function forget(id) {
  return records.delete(id);
}

/** Every remembered crash, oldest first, as the renderer may see it. */
function list() {
  return [...records.values()].map(summary);
}

/** A file the row can ask main to open. Never a path the renderer named. */
function pathOf(id, which) {
  const record = records.get(id);
  if (!record) return null;
  if (which === 'log') return record.log || null;
  if (which === 'report') return record.report || record.hsErr || null;
  if (which === 'mods') return record.gameDir ? path.join(record.gameDir, 'mods') : null;
  return null;
}

/** What crosses the bridge: the words, the kind, the actions that apply. No paths. */
function summary(record) {
  return {
    id: record.id,
    profileId: record.profileId || null,
    name: record.name || '',
    username: record.username || null,
    join: record.join || null,
    kind: record.kind,
    headline: record.headline,
    detail: record.detail,
    suspect: record.suspect ? {
      id: record.suspect.id, name: record.suspect.name,
      bundled: Boolean(record.suspect.bundled), modId: record.suspect.modId || null
    } : null,
    hasLog: Boolean(record.log),
    hasReport: Boolean(record.report || record.hsErr),
    customJava: Boolean(record.customJava),
    // A freeze closed by Windows under a heap that left it too little of the
    // PC's memory (2026-09-20): the row offers Less memory, as a heap crash does.
    memoryHigh: Boolean(record.memoryHigh),
    // A crash inside a graphics driver carries the driver and its vendor's
    // page, for the row's Update driver button (2026-09-20).
    driver: record.driver ? { vendor: record.driver.vendor, version: record.driver.version, page: record.driver.page } : null,
    ranMs: record.ranMs || 0,
    code: record.code,
    at: record.at || 0
  };
}

/** The lines the session's own log carries under `crash`. */
function forLog(record) {
  if (!record) return '';
  const lines = [
    '',
    'crash',
    `  ${record.headline}`,
    `  kind      ${record.kind}${record.suspect ? ` (${record.suspect.id}${record.suspect.bundled ? ', bundled' : ''})` : ''}`
  ];
  if (record.detail) lines.push(`  ${record.detail}`);
  if (record.stall) lines.push(`  froze     ${stallLine(record.stall)}`);
  if (record.report) lines.push(`  report    ${record.report}`);
  if (record.hsErr) lines.push(`  hs_err    ${record.hsErr}`);
  if (record.reportHead) lines.push('', ...record.reportHead.split('\n').map((line) => '  ' + line));
  return lines.join('\n') + '\n';
}

module.exports = { explain, analyse, remember, get, forget, list, pathOf, summary, forLog, BUNDLED, reportShape, onCrash, driverWords, driverVendor, graphicsDrivers, readFreezes, freezeLine, readFrameRecords, frameLine, gpuName };
