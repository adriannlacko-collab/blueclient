'use strict';

/**
 * Put one bench profile on disk the way the launcher would, with the
 * launcher's own code (2026-09-22).
 *
 *   node tools/bench/prepare.js --mc 26.3 --name base-26.3 [--add modernfix,c2me] [--drop krypton]
 *
 * Everything under BENCH_ROOT (default ./bench-work): `root/` is the shared
 * versions/libraries/assets folder, `java/` the Mojang runtimes, `inst/<name>`
 * the profile. The steps are launcher.js `_run` in order — resolve, Java,
 * client, libraries, assets, mods.sync with the companion, mods.tune, the
 * shaderpack, settings.adopt — and the inputs `install.buildCommand` needs
 * are written to `<profile>/bench-launch.json` for run.js, which builds the
 * argument list through the launcher's own buildCommand on every run.
 *
 * The mod list is read out of src/renderer/js/state.js (performanceStack), so
 * a change to the defaults is what the bench measures, not a copy of them.
 * The companion jars and shaderpack come from the release bundle
 * (BENCH_BUNDLE, the unpacked bundle.tar.gz: resources/mod, resources/shaderpack).
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const SRC = path.join(__dirname, '..', '..', 'src', 'main');
const install = require(path.join(SRC, 'game', 'install'));
const mods = require(path.join(SRC, 'game', 'mods'));
const memo = require(path.join(SRC, 'game', 'memo'));
const settings = require(path.join(SRC, 'game', 'settings'));
const shaderpack = require(path.join(SRC, 'game', 'shaderpack'));

const BENCH_ROOT = path.resolve(process.env.BENCH_ROOT || 'bench-work');
const BUNDLE = path.resolve(process.env.BENCH_BUNDLE || path.join(BENCH_ROOT, 'bundle'));

function arg(name, fallback = null) {
  const at = process.argv.indexOf('--' + name);
  return at > 0 ? process.argv[at + 1] : fallback;
}

/** The launcher's default stack, evaluated out of state.js itself. */
function defaultStack() {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'state.js'), 'utf8');
  const start = text.indexOf('function performanceStack()');
  if (start < 0) throw new Error('performanceStack not found in state.js');
  const open = text.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < text.length; end++) {
    if (text[end] === '{') depth++;
    else if (text[end] === '}' && --depth === 0) break;
  }
  const body = text.slice(open + 1, end);
  let n = 0;
  // eslint-disable-next-line no-new-func
  return new Function('uid', body)(() => 'bench' + (n++));
}

/** Extra mods by Modrinth slug, as the Mods page would add them. */
function extra(slug) {
  return { id: 'x-' + slug, slug, name: slug, enabled: true, version: 'latest', source: 'modrinth' };
}

async function main() {
  const mc = arg('mc');
  const name = arg('name') || mc;
  if (!mc) throw new Error('--mc is required');
  const loader = arg('loader', 'fabric');
  const add = (arg('add', '') || '').split(',').filter(Boolean);
  const drop = new Set((arg('drop', '') || '').split(',').filter(Boolean));

  const root = path.join(BENCH_ROOT, 'root');
  const javaDir = path.join(BENCH_ROOT, 'java');
  const instances = path.join(BENCH_ROOT, 'inst');
  const gameDir = path.join(instances, name);
  await fsp.mkdir(path.join(gameDir, 'mods'), { recursive: true });
  await fsp.mkdir(path.join(BENCH_ROOT, 'userdata'), { recursive: true });
  memo.init(path.join(BENCH_ROOT, 'userdata'));

  const t0 = Date.now();
  const log = (what) => console.log(`[prepare ${name}] ${what} (+${Date.now() - t0} ms)`);

  await settings.adopt(instances, gameDir).catch((e) => log('adopt failed: ' + e.message));

  const { json, versionId, loaderVersion } = await install.resolve(root, { version: mc, loader });
  log(`resolved ${versionId}`);
  const javaMajor = (json.javaVersion && json.javaVersion.majorVersion) || 8;
  const java = await install.ensureJava(javaDir, json, null, {});
  log(`java ${java.binary} (major ${javaMajor}, system ${java.system})`);
  const clientJar = await install.ensureClient(root, json, mc, null);
  const nativesDir = path.join(root, 'natives', versionId);
  const classpath = await install.ensureLibraries(root, json, nativesDir, null);
  log(`libraries ${classpath.length}`);
  const assets = await install.ensureAssets(root, json, gameDir, null);
  log('assets');

  const list = defaultStack().filter((mod) => !drop.has(mod.slug));
  for (const slug of add) list.push(extra(slug));
  const result = await mods.sync({
    instanceDir: gameDir,
    mods: list,
    version: mc,
    loader,
    companionDir: path.join(BUNDLE, 'resources', 'mod')
  });
  log(`mods installed ${result.installed.length}: ${result.installed.join(' ')}`);
  if (result.failed.length) log('mods failed: ' + result.failed.join(' | '));
  if (result.missing.length) log('mods missing (no build): ' + result.missing.join(' | '));
  if (result.held.length) log('held: ' + JSON.stringify(result.held));
  if (result.conflicts.length) log('conflicts: ' + JSON.stringify(result.conflicts));
  await mods.tune(gameDir, result.installed).catch(() => false);
  await shaderpack.install(path.join(BUNDLE, 'resources', 'shaderpack'), gameDir).catch(() => 'absent');

  const inputs = {
    mc, name, loader, loaderVersion, versionId, javaMajor,
    javaBinary: java.binary,
    json, classpath, clientJar, nativesDir, gameDir, assets,
    librariesDir: path.join(root, 'libraries'),
    mods: result.installed, modsMissing: result.missing, modsFailed: result.failed,
    list: list.map((m) => m.slug)
  };
  await fsp.writeFile(path.join(gameDir, 'bench-launch.json'), JSON.stringify(inputs));
  // Let memo's debounced write land before exiting.
  await new Promise((r) => setTimeout(r, 600));
  log('done');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
