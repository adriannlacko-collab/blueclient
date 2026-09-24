'use strict';
// End-to-end check of launcher/src/main/update.js as a packaged Windows build
// would run it, against a local fake of GitHub. Runs under Electron's own node
// (ELECTRON_RUN_AS_NODE=1) so process.versions.electron is the real 44.4.3.
// Usage: run.js <scenario> <workdir> <currentVersion>
const Module = require('module');
const http = require('http');
const fs = require('fs');
const path = require('path');
const realCp = require('child_process');
const { EventEmitter } = require('events');

const [scenario, WORK, CUR] = process.argv.slice(2);
const UD = path.join(WORK, 'userData');
const INSTALL = path.join(WORK, 'install');
const EXE = path.join(INSTALL, 'BlueClient.exe');
const PORT = Number(process.env.PORT);
fs.mkdirSync(UD, { recursive: true });

Object.defineProperty(process, 'platform', { value: 'win32' });
Object.defineProperty(process, 'resourcesPath', { value: INSTALL, configurable: true });

const events = { quit: 0, hosts: [], installerChecks: 0, beforeQuit: [], publishes: [], exits: [], dialogs: [], opened: [] };
const app = {
  isPackaged: true,
  getPath: (k) => (k === 'userData' ? UD : k === 'exe' ? EXE : WORK),
  getVersion: () => CUR,
  on: (ev, fn) => { if (ev === 'before-quit') events.beforeQuit.push(fn); },
  quit: () => { events.quit++; },
  exit: (code) => { events.exits.push(code); },
  whenReady: () => Promise.resolve(),
  hasSingleInstanceLock: () => true,
  requestSingleInstanceLock: () => true
};
// DIALOG is the button the player presses in every dialog (0: the first).
const dialog = {
  showMessageBox: (options) => {
    events.dialogs.push({ message: options.message, detail: options.detail, buttons: options.buttons });
    return Promise.resolve({ response: Number(process.env.DIALOG || 0) });
  }
};
const shell = { openExternal: (url) => { events.opened.push(url); return Promise.resolve(); } };
const autoUpdater = Object.assign(new EventEmitter(), {
  checkForUpdates: () => { events.installerChecks++; return Promise.resolve(null); }
});
const httpsShim = {
  get(url, opts, cb) {
    const u = new URL(url);
    return http.get(`http://127.0.0.1:${PORT}/${u.host}${u.pathname}${u.search}`, opts, cb);
  }
};
const cpShim = {
  ...realCp,
  spawn(cmd, args, opts) {
    if (/tar\.exe$/i.test(cmd)) return realCp.spawn('tar', args, { stdio: 'ignore' });
    if (cmd === EXE) {
      events.hosts.push({ args, runAsNode: opts && opts.env && opts.env.ELECTRON_RUN_AS_NODE });
      // HOST_PID stands in for the swap host's process id: a live process
      // plays a script still at work, and none a spawn that reported no id.
      const child = new EventEmitter(); child.unref = () => {}; child.pid = Number(process.env.HOST_PID) || undefined; return child;
    }
    return realCp.spawn(cmd, args, opts);
  }
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app, dialog, shell };
  if (request === 'https') return httpsShim;
  if (request === 'electron-updater') return { autoUpdater };
  if (request === 'child_process') return cpShim;
  return load.apply(this, arguments);
};

const update = require(process.env.UPDATE_JS);
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
};
const logTail = () => { try { return fs.readFileSync(path.join(UD, 'update.log'), 'utf8').trim().split('\n').map((l) => l.replace(/^\S+\s+/, '')); } catch { return []; } };
const out = (o) => console.log('RESULT ' + JSON.stringify(o));
// Whether the script written for this run brings the launcher back: it
// starts the exe only when the relaunch file beside the mark exists.
const relaunches = (script) => {
  const m = /if exist "([^"]+)" start "" /.exec(script);
  return Boolean(m && fs.existsSync(m[1]));
};
const marksNow = () => {
  const root = path.join(UD, 'update-bundle');
  const dirs = fs.existsSync(root) ? fs.readdirSync(root) : [];
  return dirs.map((d) => { try { return JSON.parse(fs.readFileSync(path.join(root, d, 'staged.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
};

(async () => {
  if (scenario.startsWith('rescue-')) {
    // rescue.js, the second way to the newest version (boot.js).
    const rescue = require(path.join(path.dirname(process.env.UPDATE_JS), 'rescue.js'));
    rescue.hooks.exit = (code) => events.exits.push(code);
    const state = () => { try { return JSON.parse(fs.readFileSync(path.join(UD, 'rescue.json'), 'utf8')); } catch { return {}; } };
    const report = (extra) => {
      const script = events.hosts.length ? fs.readFileSync(events.hosts[0].args[0].replace(/\.js$/, '.cmd'), 'utf8') : '';
      let record = null;
      try { record = JSON.parse(fs.readFileSync(path.join(UD, 'swap-running.json'), 'utf8')); } catch { /* none */ }
      const s0 = state();
      out({
        ...extra, exits: events.exits, hosts: events.hosts.length, relaunch: script ? relaunches(script) : false,
        copiesAsar: script ? script.includes(path.join(INSTALL, 'app.asar')) : false, recorded: Boolean(record && record.pid),
        dialogs: events.dialogs.map((d) => `${d.message} [${d.buttons.join('|')}]`), opened: events.opened,
        state: { pending: s0.pending, streak: s0.streak, seen: s0.seen && s0.seen.starts, failed: s0.failed }
      });
    };
    if (scenario === 'rescue-start') {
      rescue.begin();
      await new Promise((r) => setImmediate(r));
      const streak = state().streak || 0;
      const outcome = await rescue.look({ urgent: streak > 0 });
      report({ outcome, streak });
    } else if (scenario === 'rescue-healthy') {
      rescue.begin();
      await new Promise((r) => setImmediate(r));
      rescue.healthy();
      report({});
    } else if (scenario === 'rescue-failed') {
      rescue.mainFailed(new Error('Cannot find module ./launcher'));
      await until(() => events.exits.length > 0, 20000);
      report({});
    } else if (scenario === 'rescue-join') {
      report({ joined: rescue.joinRunningSwap() });
    } else if (scenario === 'rescue-versions') {
      // Its newer() must agree with update.js's, written separately on purpose.
      const update = require(process.env.UPDATE_JS);
      const list = ['0.2.9', '0.2.13', '1.0.0', '1.0', 'v1.0.1', '1.10.0', '1.9.9', '1.12.0-beta', '1.12.0-beta.1', '1.12.0-beta.2', '1.12.0-beta.10', '1.12.0-rc.1', '1.12.0', '1.12.0+build.7', '2.0.0-alpha', '2.0.0-alpha.beta', '2.0.0-1', '2.0.0'];
      let disagree = 0;
      for (const a of list) for (const b of list) if (rescue.newer(a, b) !== update.newer(a, b)) { disagree++; console.log(`DISAGREE ${a} vs ${b}`); }
      out({ pairs: list.length * list.length, disagree });
    }
    return process.exit(0);
  }
  if (scenario === 'start-applies') {
    const going = update.applyStagedAtStart(CUR);
    const script = events.hosts.length ? fs.readFileSync(events.hosts[0].args[0].replace(/\.js$/, '.cmd'), 'utf8') : '';
    const root = path.join(UD, 'update-bundle');
    const asked = (fs.existsSync(root) ? fs.readdirSync(root) : []).some((d) => fs.existsSync(path.join(root, d, update.RELAUNCH_FLAG)));
    out({ going, hosts: events.hosts.length, relaunch: script ? relaunches(script) : false, relaunchAsked: asked, log: logTail() });
    return process.exit(0);
  }
  if (scenario === 'close') {
    // Staged, then closed with the window's X: before-quit and nothing else.
    update.start(() => {}, CUR);
    await until(() => update.get().phase === 'ready', Number(process.env.WAIT_MS || 4000));
    for (const fn of events.beforeQuit) fn();
    const script = events.hosts.length ? fs.readFileSync(events.hosts[0].args[0].replace(/\.js$/, '.cmd'), 'utf8') : '';
    out({ phase: update.get().phase, hosts: events.hosts.length, relaunch: script ? relaunches(script) : false, swap: (marksNow()[0] || {}).swap || null });
    return process.exit(0);
  }
  update.start((s) => events.publishes.push(s.phase + ':' + s.percent), CUR);
  update.poke();
  await until(() => update.get().phase === 'ready' || events.installerChecks > 0, Number(process.env.WAIT_MS || 4000));
  await new Promise((r) => setTimeout(r, 300));
  const state = update.get();
  const root = path.join(UD, 'update-bundle');
  const staged = fs.existsSync(root) ? fs.readdirSync(root) : [];
  const marks = staged.map((d) => { try { return JSON.parse(fs.readFileSync(path.join(root, d, 'staged.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
  const result = { phase: state.phase, version: state.version, installerChecks: events.installerChecks, marks, publishes: events.publishes.length, log: logTail() };
  if (scenario === 'install' && state.phase === 'ready') {
    const answer = await update.install();
    await new Promise((r) => setTimeout(r, 50));
    for (const fn of events.beforeQuit) fn();
    const script = fs.readFileSync(events.hosts[0].args[0].replace(/\.js$/, '.cmd'), 'utf8');
    Object.assign(result, {
      install: answer, quit: events.quit, hosts: events.hosts.length, runAsNode: events.hosts[0].runAsNode,
      copiesAsar: script.includes(`${path.join(INSTALL, 'app.asar')}`), robocopy: /robocopy .*\/mir/.test(script), relaunch: relaunches(script),
      attempts: JSON.parse(fs.readFileSync(path.join(UD, 'update-attempts.json'), 'utf8')),
      stagedDir: marks.length ? path.join(root, staged[0], 'new') : null, resultFile: JSON.parse(fs.readFileSync(path.join(UD, 'update-attempts.json'), 'utf8')).last.result
    });
  }
  if (scenario === 'recheck-race') {
    // handled by server counters
  }
  out(result);
  process.exit(0);
})().catch((e) => { console.log('CRASH ' + (e && e.stack)); process.exit(1); });
