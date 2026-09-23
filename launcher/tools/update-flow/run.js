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

const events = { quit: 0, hosts: [], installerChecks: 0, beforeQuit: [], publishes: [] };
const app = {
  isPackaged: true,
  getPath: (k) => (k === 'userData' ? UD : k === 'exe' ? EXE : WORK),
  getVersion: () => CUR,
  on: (ev, fn) => { if (ev === 'before-quit') events.beforeQuit.push(fn); },
  quit: () => { events.quit++; }
};
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
      const child = new EventEmitter(); child.unref = () => {}; return child;
    }
    return realCp.spawn(cmd, args, opts);
  }
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app };
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

(async () => {
  if (scenario === 'start-applies') {
    const going = update.applyStagedAtStart(CUR);
    const script = events.hosts.length ? fs.readFileSync(events.hosts[0].args[0].replace(/\.js$/, '.cmd'), 'utf8') : '';
    out({ going, hosts: events.hosts.length, relaunch: /start "" /.test(script), log: logTail() });
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
      copiesAsar: script.includes(`${path.join(INSTALL, 'app.asar')}`), robocopy: /robocopy .*\/mir/.test(script), relaunch: /start "" /.test(script),
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
