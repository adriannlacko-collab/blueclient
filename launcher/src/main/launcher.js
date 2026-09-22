'use strict';

/**
 * Launch pipeline.
 *
 * A launch is a Session: it resolves the version, puts every file it needs on
 * disk, builds the command line, spawns the JVM and follows the process until
 * it exits. Several sessions run at once — up to MAX_SESSIONS games side by
 * side, which is the point of having more than one profile and more than one
 * account. The Launcher below is the register of them; every event it emits
 * carries the id of the session it belongs to, so the renderer can draw one
 * row per running game.
 *
 * Concurrency is handled in exactly one place. Every step that writes to a
 * shared directory runs inside a named lane (game/lane.js), so two launches of
 * the same version queue for its files instead of downloading over each other,
 * while two launches of different versions never wait at all. Nothing else in
 * the pipeline is shared: each session has its own progress, its own account
 * and its own child process.
 *
 * The stage list is weighted rather than timed. Each stage reports its own
 * fraction as it works, so the bar tracks real bytes — an install that is
 * already complete sweeps through in a moment, a cold one takes as long as the
 * download does.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

const install = require('./game/install');
const mods = require('./game/mods');
const companion = require('./game/companion');
const shaderpack = require('./game/shaderpack');
const remapped = require('./game/remapped');
const settings = require('./game/settings');
const worlds = require('./game/worlds');
const { lane } = require('./game/lane');
const gpu = require('./game/gpu');
const auth = require('./auth');
const crashes = require('./crashes');
const skinSlots = require('./skinslots');
const { VERSION } = require('./version');

/** Weights are rough shares of a cold install's wall time. */
const STAGES = [
  { id: 'resolve', label: 'Reading version data', weight: 4 },
  { id: 'java',    label: 'Preparing Java',       weight: 22 },
  { id: 'client',  label: 'Downloading client',   weight: 12 },
  { id: 'libs',    label: 'Resolving libraries',  weight: 22 },
  { id: 'assets',  label: 'Verifying assets',     weight: 32 },
  { id: 'mods',    label: 'Installing mods',      weight: 6 },
  { id: 'jvm',     label: 'Starting Minecraft',   weight: 4 }
];

const TOTAL_WEIGHT = STAGES.reduce((sum, stage) => sum + stage.weight, 0);
const SUPPORTED_LOADERS = new Set(['vanilla', 'fabric']);

/**
 * How many games may run at once.
 *
 * Not a technical limit — a floor under the absurd. Five copies of Minecraft
 * is already more memory than most machines have, and the rows have to fit on
 * Home beside the player.
 */
const MAX_SESSIONS = 5;

/**
 * How much of a game's own output is kept for the crash reader (2026-09-22).
 * The tail is read when a launch dies, and everything a crash says is in its
 * last few kilobytes; two megabytes is room for the longest report Minecraft
 * has ever written and a ceiling on what one chatty mod can park in memory
 * for a four-hour sitting.
 */
const TAIL_MAX_CHARS = 2 * 1024 * 1024;

/**
 * How the sign-in is kept fresh while the launcher is open (Launcher.prime):
 * looked at every ten minutes, renewed when it has less than half an hour
 * left. Microsoft's tokens last a day, so this is a handful of quiet requests
 * across a whole day at the desk, and never one between Play and the game.
 */
const RENEW_EVERY_MS = 10 * 60 * 1000;
const RENEW_AHEAD_MS = 30 * 60 * 1000;

class Cancelled extends Error {}

/* ========================================================================
   Session — one game, from Play to exit
   ======================================================================== */

class Session extends EventEmitter {
  constructor({ id, profile, options }) {
    super();
    this.id = id;
    this.profile = profile;
    this.options = options;
    this.status = 'working'; // working | playing
    this.percent = 0;
    this.stage = 'resolve';
    this.label = 'Preparing launch';
    this.startedAt = null;
    this.account = null;
    this.versionId = null;
    this._cancelled = false;
    this._child = null;
  }

  /** Everything the renderer needs to draw this session's row. */
  summary() {
    return {
      id: this.id,
      profileId: this.profile.id,
      name: this.profile.name,
      version: this.profile.version,
      loader: this.profile.loader || 'vanilla',
      memoryMb: this.profile.memoryMb || null,
      join: this.profile.join || null,
      world: this.profile.world || null,
      username: this.account ? this.account.username : null,
      status: this.status,
      percent: this.percent,
      stage: this.stage,
      label: this.label,
      startedAt: this.startedAt
    };
  }

  async start() {
    this._emit(0, 'resolve', 'Preparing launch');

    try {
      return await this._run();
    } catch (error) {
      if (error instanceof Cancelled) {
        this._finish({ reason: 'cancelled' });
        return { ok: false, cancelled: true };
      }
      // A JVM that died inside its first second carries what crashes.js made
      // of it (see _spawn), so its row on Home explains itself the same way a
      // game that crashed an hour in does — and the caller knows not to toast
      // what the row already says.
      const crash = error.crash ? { crashed: true, crash: error.crash } : {};
      const message = this._explain(error);
      this._finish({ error: message, ...crash });
      return { ok: false, error: message, crashed: Boolean(error.crash) };
    }
  }

  /**
   * The one line a failed launch is toasted as (2026-09-19).
   *
   * An error this pipeline threw on purpose is its own sentence. A fault in
   * the launcher's own code — a TypeError out of `path.join` handed an
   * undefined, the kind of thing a player reported as `The "path" argument
   * must be of type string. Received undefined` with no way for anyone to
   * tell which of the seven stages it came from — is written to
   * launcher-errors.log with its stack and the stage, and said with the
   * stage's name, so the next such report can be read.
   */
  _explain(error) {
    const text = String((error && error.message) || error || 'Unknown error');
    // A file that stopped arriving (game/files.js): what was fetched is kept
    // and the next press resumes it, which is the one thing worth saying.
    if (/^The download of .+ stalled$/.test(text)) {
      return `${text} — check the connection and press Play again; it carries on from where it stopped.`;
    }
    const fault = error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError
      || /^The "\w+" argument must be/.test(text) || /ERR_INVALID_ARG/.test(String(error && error.code || ''));
    if (!fault) return text;

    const stage = String(this.label || 'Preparing launch');
    const line = `${new Date().toISOString()}  launch  [${this.stage} — ${stage}] profile ${this.profile.id} ${this.profile.version}/${this.profile.loader || 'vanilla'}\n${error && error.stack || text}\n`;
    console.error('[launch] ' + line.trim());
    if (this.options.errorLog) {
      // Diagnostics must never be the reason something else fails.
      fs.appendFile(this.options.errorLog, line, () => {});
    }
    return `Something went wrong while ${stage.toLowerCase()} — ${text}. It is written to launcher-errors.log in the BlueClient folder under AppData.`;
  }

  async _run() {
    const { store, javaDir, logDir } = this.options;

    // Read per launch, not captured at boot: changing the install location in
    // Settings takes effect on the next Play, not after a restart.
    const root = store.get('launcher.rootDirectory') || this.options.root;
    const instances = store.get('launcher.gameDirectory') || this.options.instances;

    const profile = this.profile;
    const loader = profile.loader || 'vanilla';
    // What every path below is built from, checked before one is (2026-09-19):
    // a profile record missing its id or its version would otherwise reach
    // `path.join` as undefined and fail as a sentence about a "path" argument.
    if (!/^[a-z0-9]+$/i.test(String(profile.id || ''))) {
      throw new Error('This profile has no id the launcher can use — open Profiles, pick or create one, and press Play again.');
    }
    if (!String(profile.version || '').trim()) {
      throw new Error(`${profile.name || 'This profile'} has no Minecraft version — open Profiles and pick one.`);
    }
    if (typeof root !== 'string' || !root.trim() || typeof instances !== 'string' || !instances.trim()) {
      throw new Error('The install location in Settings → Storage is empty — set it, or reset the settings, and press Play again.');
    }
    if (!SUPPORTED_LOADERS.has(loader)) {
      throw new Error(
        `${loader[0].toUpperCase()}${loader.slice(1)} profiles cannot be launched yet — ` +
        'BlueClient supports Vanilla and Fabric.'
      );
    }

    // Every remembered answer this press is about to read, renewed now if it
    // is due, and all at once (2026-09-22). Each stage below renews its own
    // expired answer behind a grace of its own (memo.remember), which is
    // right, but they did it in turn: the Fabric loader in resolve, Mojang's
    // runtime index in the Java stage, each wave of Modrinth lookups in
    // mods — measured with every answer aged past its keep-by, 1.1 s from
    // the press to the JVM against 40 ms fresh, three round trips end to
    // end. Started here, each stage finds its renewal already on the way
    // (one request per key, memo.refresh) and the three overlap. On a press
    // whose answers are fresh this is a few lookups in memory.
    this._prefetch(store, profile, loader);

    // A renewal rotates the Microsoft refresh token on disk, so two launches
    // starting together must not both attempt one — the second would present a
    // token the first has already spent. One lane, one renewal.
    const renewal = await lane('auth', () => renewIfStale(store));
    if (renewal.list) {
      this.emit('accounts', { list: renewal.list, active: (store.get('accounts') || {}).active });
    }
    // A Microsoft token that could not be renewed used to be launched with
    // anyway, and the game then wore the name and refused every server —
    // "Invalid session" on join, and nothing in the launcher saying why
    // (2026-09-20; the "signed in but can't join servers" reports). A dead
    // refresh token is the player's to fix, and the one place to say so is
    // the Play press. Microsoft unreachable is different: the game starts
    // with the token in hand — singleplayer works, and a token a few hours
    // over is often still good — and the row is told once what may happen.
    if (renewal.error) {
      if (renewal.error.code === 'expired') {
        throw new Error('Your sign-in has expired — sign in again from the account menu at the top right, then press Play.');
      }
      this.emit('warning', {
        message: 'Your sign-in could not be renewed',
        details: [renewal.error.message, 'Servers may refuse you until the launcher can reach Microsoft']
      });
    }
    const account = resolveAccount(store);
    this.account = account;
    const memoryMb = profile.memoryMb || store.get('game.memoryMb') || 4096;

    // Each profile keeps its own mods, saves and options; the heavy shared
    // files live once under the root. Two sessions of the same profile share
    // this directory on purpose — the player was told so before they pressed
    // Play a second time.
    const gameDir = path.join(instances, profile.id);
    await fsp.mkdir(path.join(gameDir, 'mods'), { recursive: true });

    // Keys, video settings, the server list and the whole in-game half of
    // BlueClient are the profile's own — or, for a profile synced with
    // others, its group's, borrowed for the launch and given back after
    // (game/settings.js, 2026-09-17). A profile that has never been played is
    // seeded here from the set the player used last. It takes its own lane —
    // two Play presses in the same moment must not both decide a set is
    // empty, and must not write the record over each other — so there is
    // none to take out here.
    await settings.adopt(instances, gameDir).catch(() => {});
    // An offline account's own skin, for the game to draw on the player
    // (2026-09-21, skinslots.ownFor): the file and its arms, or the keys
    // taken out when this launch's account has none.
    {
      const own = account && account.type !== 'microsoft' ? skinSlots.ownFor(account.username) : null;
      await settings.stampKeys(path.join(gameDir, 'config'), {
        ownSkin: own ? own.file : null,
        ownSkinModel: own ? own.variant : null
      }).catch(() => {});
    }

    /* --- resolve ------------------------------------------------------- */
    const stage = this._stager();

    stage.begin('resolve');
    const { json, versionId, loaderVersion } = await this._shared(
      `${root}|version:${profile.version}:${loader}`,
      () => install.resolve(root, { version: profile.version, loader }),
      stage.waiting
    );
    this.versionId = versionId;
    this._check();
    stage.done();

    const nativesDir = path.join(root, 'natives', versionId);
    const javaMajor = (json.javaVersion && json.javaVersion.majorVersion) || 8;

    /* --- java ---------------------------------------------------------- */
    stage.begin('java');
    const java = await this._shared(
      `java:${javaMajor}`,
      () => this._java(javaDir, json, stage.fraction),
      stage.waiting
    );
    this._check();
    stage.done();

    /* --- client jar ---------------------------------------------------- */
    stage.begin('client');
    const clientJar = await this._shared(
      `${root}|client:${profile.version}`,
      () => install.ensureClient(root, json, profile.version, stage.fraction),
      stage.waiting
    );
    this._check();
    stage.done();

    /* --- libraries ----------------------------------------------------- */
    // The natives folder is unpacked in here and is shared by every session on
    // this version, so this lane is the one that matters most.
    stage.begin('libs');
    const classpath = await this._shared(
      `${root}|libs:${versionId}`,
      () => install.ensureLibraries(root, json, nativesDir, stage.fraction),
      stage.waiting
    );
    this._check();
    stage.done();

    /* --- assets -------------------------------------------------------- */
    stage.begin('assets');
    const assets = await this._shared(
      `${root}|assets:${(json.assetIndex && json.assetIndex.id) || json.assets || 'legacy'}`,
      () => install.ensureAssets(root, json, gameDir, stage.fraction),
      stage.waiting
    );
    this._check();
    stage.done();

    /* --- mods ---------------------------------------------------------- */
    // Keyed on the profile, not the version: this writes the instance's own
    // mods folder, and only a second copy of the same profile can collide.
    stage.begin('mods');
    const modResult = await this._shared(`mods:${profile.id}`, () => mods.sync({
      instanceDir: gameDir,
      mods: profileMods(store, profile.id),
      version: profile.version,
      loader,
      companionDir: this.options.companionDir,
      onProgress: stage.fraction
    }), stage.waiting);
    this._check();

    // The stack's own settings the launcher has a say in (game/mods.js,
    // `tune`): Entity Culling's tick culling off, so a mob nobody is looking
    // at keeps moving where the server put it.
    await mods.tune(gameDir, modResult.installed).catch(() => false);

    // The shaderpack beside the mods (2026-09-06): one copy under the
    // launcher's resources, written into this profile's shaderpacks/ when it
    // differs. Only where the in-game half is going to be — on any other
    // profile there is nothing to drive it.
    if (loader === 'fabric' && !modResult.companionSkipped) {
      await shaderpack.install(this.options.packDir, gameDir).catch(() => 'absent');
    }

    // Fabric's remapped game jar, copied from a sibling profile that already
    // has it, so a new profile's first launch is not forty seconds of
    // "preparing JARs" (game/remapped.js, 2026-09-10). Nothing to do on every
    // launch after the first.
    if (loader === 'fabric') {
      await remapped.seed(instances, gameDir, profile.version, loaderVersion).catch(() => 'none');
    }
    stage.done();

    // A mod that has no build for this version is worth saying out loud, but
    // it is not worth refusing to start the game over.
    if (modResult.unsupported) {
      this.emit('warning', {
        message: 'This profile is set to Vanilla, so its mods will not load',
        details: ['Switch the profile to Fabric to use them']
      });
    }
    if (modResult.failed.length) {
      this.emit('warning', { message: 'Some mods were left out, the game starts without them', details: modResult.failed });
    }
    // The in-game half could not be replaced because a game is still running
    // with the old one open; this launch gets the old one too. The one line
    // the player can act on (game/mods.js, place).
    if (modResult.companionLocked) {
      this.emit('warning', {
        message: 'This game has the previous in-game features',
        details: ['Another Minecraft is still running — close every game window and press Play again to get the new ones']
      });
    }
    // Two jars whose own rules refuse each other, with no build of either
    // that would end it (game/pairing.js, 2026-09-11). The game is started
    // anyway — Fabric's own screen says the same thing in more words — but
    // the one line here is the one the player can act on from the Mods page.
    if (modResult.conflicts && modResult.conflicts.length) {
      this.emit('warning', { message: 'Two of this profile\'s mods refuse to load together', details: [...modResult.conflicts, 'Switch one of them off on the Mods page'] });
    }

    // Worth saying every time: the game will start and look ordinary, and the
    // menu, the HUD and the music will simply not be there. `carries` is read
    // from the shipped jars rather than written down, so it stays true as the
    // port reaches more versions.
    if (modResult.companionSkipped) {
      const { version: on } = modResult.companionSkipped;
      const carries = modResult.companionCarries;
      this.emit('warning', {
        message: `BlueClient's in-game features are off on ${on}`,
        details: [carries
          ? `The in-game half is built for Minecraft ${carries}`
          : 'The in-game half is not built for this Minecraft',
          'The game will start without the in-game menu, HUD and music']
      });
    }

    /* --- spawn --------------------------------------------------------- */
    // Nothing shared is left: from here every session is on its own.
    stage.begin('jvm');
    const args = install.buildCommand({
      json,
      classpath,
      clientJar,
      nativesDir,
      gameDir,
      assets,
      account,
      memoryMb,
      versionId,
      librariesDir: path.join(root, 'libraries'),
      jvmArgs: store.get('game.jvmArgs'),
      // The flags are picked per Java major: the version JSON's for the
      // launcher's own runtime, the runtime's own release file for a Java the
      // player pointed Settings at (a flag one Java has and another refuses is
      // a game that does not start).
      javaMajor: java.system ? (java.major || 0) : javaMajor,
      resolution: store.get('game.resolution'),
      // A partner row pressed instead of Play: the game goes straight to
      // the server (its own --quickPlayMultiplayer, 1.20 and later).
      join: profile.join || null,
      // A world card pressed on Worlds (2026-09-11): straight into that save
      // (--quickPlaySingleplayer, the same family, 1.20 and later).
      world: profile.world || null
    });

    // Not here, and measured out rather than left untried (2026-09-10): a
    // dynamic class archive of the game's own classes
    // (-XX:+AutoCreateSharedArchive) took this same launch from nine seconds
    // to the window to three and a half minutes, twice, on Mojang's Java 21
    // with Fabric's class loader in the way. The runtime's base archive
    // (install.archiveClasses) stays; it measured neutral on the game and
    // costs nothing at the press.
    // The card Windows will draw this Java on, settled before it starts
    // (game/gpu.js, 2026-09-20): one registry read per runtime per launcher
    // run, and a write only the first time a runtime is ever launched.
    const card = await gpu.prefer(java.binary);

    // Once more before the JVM (2026-09-22): the last look was after the
    // mods stage, and the tune, the shaderpack, the remapped jar's copy and
    // the card all come after it — a second or more on a new profile — so a
    // Cancel pressed in that stretch was answered "ok" and the game started
    // anyway.
    this._check();

    await this._spawn(java.binary, args, gameDir, logDir, {
      profile, account, versionId, instances,
      card,
      // For the crash reader (crashes.js): which mods the player added, so a
      // row may offer to remove the one it blames; the heap, so "out of
      // memory" can say how much; whether the Java is their own.
      memoryMb,
      mods: profileMods(store, profile.id),
      customJava: Boolean(String(store.get('game.javaPath') || '').trim()),
      // For the launch log: a build the launcher held back so the folder
      // would load, and the pair it could not settle — the two facts a
      // crash in a mod has to be read against.
      held: modResult.held || [],
      conflicts: modResult.conflicts || [],
      missing: modResult.missing || [],
      // And the runtime files the Java stage put back (2026-09-19): a launch
      // that had to repair Java says so in its own log, which is where a
      // second "Java's files were incomplete" would be read against.
      repaired: java.repaired || [],
      javaInstalled: Boolean(java.installed)
    });
    stage.done();

    return {
      ok: true,
      sessionId: this.id,
      versionId,
      username: account.username,
      offline: account.type !== 'microsoft',
      skippedMods: modResult.failed
    };
  }

  /** See the call in _run. Never throws, never waited for. */
  _prefetch(store, profile, loader) {
    const quietly = (promise) => Promise.resolve(promise).catch(() => {});
    try {
      if (loader === 'fabric') install.warmFabric([profile.version]);
      if (!String(store.get('game.javaPath') || '').trim()) quietly(install.warmJavaIndex());
      quietly(mods.warmLookups([{ version: profile.version, loader, mods: profileMods(store, profile.id) }]));
    } catch {
      /* a head start, nothing more */
    }
  }

  /**
   * The Java to run with.
   *
   * A path set in settings wins over the downloaded runtime, and is accepted
   * either as the executable or as the JDK folder holding it — pointing at the
   * folder is the more natural thing to pick in a file dialog.
   *
   * The downloaded runtime is checked against Mojang's manifest on every
   * launch (install.ensureJava, 2026-09-19); `repairJava` on the profile —
   * the Retry of a "Java's files were incomplete" row sets it, nothing else
   * does — asks for every file to be hashed rather than only sized.
   */
  async _java(javaDir, json, onProgress) {
    const configured = String(this.options.store.get('game.javaPath') || '').trim();
    if (!configured) {
      return install.ensureJava(javaDir, json, onProgress, { repair: Boolean(this.profile.repairJava) });
    }

    const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
    const candidates = [configured, path.join(configured, exe), path.join(configured, 'bin', exe)];

    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        const major = await install.runtimeMajor(path.dirname(path.dirname(candidate)));
        return { binary: candidate, system: true, major };
      }
    }
    throw new Error('No Java runtime at the path set in Settings: ' + configured);
  }

  _spawn(binary, args, gameDir, logDir, context) {
    return new Promise((resolve, reject) => {
      let child;
      // When the JVM was started: a crash report or an hs_err file older than
      // this is some earlier game's, not this one's.
      const spawnedAt = Date.now();
      try {
        // detached puts the game in its own process group, so closing the
        // launcher mid-session no longer takes Minecraft down with it. A
        // launcher that cannot be closed while you play is a launcher that
        // sits in the way, and losing a session to it is worse still.
        child = spawn(binary, args, { cwd: gameDir, windowsHide: false, detached: true });
      } catch (error) {
        reject(new Error(`Could not start Java: ${error.message}`));
        return;
      }

      // unref lets this process exit without waiting on the game. The exit and
      // output listeners below keep working for as long as the launcher is
      // open, so nothing is given up by doing this.
      child.unref();

      // A step above normal, so a busy desktop yields the cores to the
      // frame rather than the other way round (game/gpu.js).
      gpu.raise(child.pid);

      this._child = child;

      // Settings the game writes go back to the group the profile shares
      // them with as it writes them, so a server added in this game is in
      // the next one's list even if this one is still open — or if the
      // machine is turned off with it running. A profile on its own has
      // nothing to mirror, and this watches nothing.
      const mirroring = settings.watch(context.instances, gameDir);

      // Keep the tail of the game's own output. When a launch dies on a
      // missing library or a bad argument, the reason is in here and nowhere
      // else — the JVM exits before any window appears.
      const tail = [];
      // And the companion's stall notes, kept apart from it (2026-09-21):
      // a freeze the game came back from leaves its note hours before the
      // exit, long out of the four hundred chunks, and it is the one thing
      // the log has to say about a game that "froze for 15 seconds". A
      // chunk can end mid-stack, so a note is the chunk it starts in and
      // the three after it; ten notes at most, a session that freezes more
      // than that has said enough.
      const notes = [];
      let noteLeft = 0;
      // Four hundred chunks, and never more than this many bytes of them
      // (2026-09-22): a chunk is whatever the pipe handed over, so a mod
      // that logs a megabyte on one line parked a megabyte here for the
      // length of the session, four hundred times over in the worst case.
      // The cap is far above any crash report the reader needs.
      let tailBytes = 0;
      const keep = (chunk) => {
        const text = chunk.toString();
        tail.push(text);
        tailBytes += text.length;
        while (tail.length > 400 || (tailBytes > TAIL_MAX_CHARS && tail.length > 1)) {
          tailBytes -= tail.shift().length;
        }
        if (noteLeft > 0) {
          notes.push(text);
          noteLeft--;
        } else if (notes.length < 40 && /The game (?:has not drawn a frame|is still not drawing|is drawing again)/.test(text)) {
          notes.push(text);
          noteLeft = 3;
        } else if (notes.length < 60 && /Slow frames: |Frames: \d+ over /.test(text)) {
          // The sampler's patch of slow frames and the sitting's frame
          // record (2026-09-22): one line each, nothing after it to keep.
          notes.push(text);
        }
      };
      child.stdout?.on('data', keep);
      child.stderr?.on('data', keep);

      let settled = false;

      child.on('error', (error) => {
        this._child = null;
        // A process that never started writes nothing worth mirroring, and
        // 'exit' does not always follow 'error'.
        mirroring();
        if (settled) return;
        settled = true;
        reject(new Error(`Could not start Java: ${error.message}`));
      });

      /* Everything the exit does, so the handler itself can catch (below). */
      const exited = async (code) => {
        // The last save the game makes is on its way out, and the watcher is
        // debounced, so this is the copy that is certain to be complete.
        mirroring();
        await settings.keep(context.instances, gameDir, { final: true }).catch(() => {});
        // Every world played this sitting is zipped into its backups now that
        // the game has let go of it (game/worlds.js, 2026-09-11) — not
        // awaited, so a gigabyte world never holds the row's close or the
        // window's return; startedAt is null when the game never reached
        // 'playing', and then there is nothing to back up.
        worlds.afterSession(context.instances, gameDir, this.startedAt).catch(() => {});

        // Stopped by the player's Cancel before it reached 'playing': not a
        // crash and not a failure, and nothing to read or log.
        if (!settled && this._cancelled) {
          settled = true;
          reject(new Cancelled());
          return;
        }

        // What went wrong, if anything did (crashes.js, 2026-09-11): the
        // game's own crash report, an hs_err file, or the JVM's last words,
        // read into one line the row on Home can carry. Null for a clean
        // close — and for the launcher's own X, which arrives as a signal
        // with no code. Read before the log is written so the log can say it.
        // The sitting's frame record, said by the companion at the disconnect
        // and the stop (2026-09-22): the last one is the session's, and it
        // rides the idle event to the ping (stats.js) and the launch log.
        const drawn = crashes.readFrameRecords(notes.join(''));
        const crash = await crashes.explain({
          code, tail, notes: notes.join(''), gameDir, since: spawnedAt,
          mods: context.mods, memoryMb: context.memoryMb, customJava: context.customJava
        });
        if (crash) {
          // What the report could not say, the launch knows (2026-09-18): five
          // of the first six crash reports players sent were a game that died
          // without writing a report — no Minecraft version, no loader, no
          // mod, "see the log" — and told the admin nothing. The version and
          // loader are what this session launched, not a guess; the mod's
          // version is read off the jar that was in the profile's folder.
          if (!crash.minecraftVersion) crash.minecraftVersion = String(context.profile.version || '');
          if (!crash.loader) crash.loader = String(context.profile.loader || 'vanilla');
          if (!crash.modVersion && crash.loader === 'fabric') {
            crash.modVersion = await companion.versionOf(path.join(gameDir, 'mods', 'blueclient.jar'));
          }
          Object.assign(crash, {
            profileId: context.profile.id,
            name: context.profile.name,
            // Who it ran as (2026-09-11): a crash can land before the game
            // ever reaches 'playing' — a missing file, a Java too old, a heap
            // Windows would not give it — so the row cannot count on the
            // session that was showing it; the record carries it instead.
            username: context.account ? context.account.username : null,
            join: context.profile.join || null,
            ranMs: Date.now() - spawnedAt,
            log: null
          });
        }

        // Settings › Keep launch logs. Read at the moment the game exits
        // rather than captured at boot, like every other setting the pipeline
        // reads, so switching it off takes effect on the next game that ends.
        if (this.options.store.get('launcher.keepLogs') !== false) {
          const written = await writeLog(logDir, this.id, context, binary, args, tail, crash, crashes.readFreezes(notes.join(''), context.mods), drawn).catch(() => null);
          if (crash) crash.log = written;
        }

        // The row keeps the crash until the player closes it, and Open log /
        // Retry find it here by the session's id.
        const told = crash ? crashes.summary(crashes.remember(this.id, crash)) : null;

        // A crash before the window opens is a failed launch, not a session
        // that ended. Anything after that is the player quitting — or the
        // game dying, which the row says in so many words.
        if (!settled) {
          settled = true;
          const failure = new Error(told ? told.headline : `Minecraft exited before starting (code ${code}).`);
          failure.crash = told;
          reject(failure);
          return;
        }
        this._finish({
          ...(told ? { crashed: true, crash: told, error: told.headline } : {}),
          mc: this.versionId || null,
          frames: drawn.length ? drawn[drawn.length - 1] : null
        });
      };

      /* Nothing in the exit path may be allowed to leave the row running
         (2026-09-22). It reads a crash report the game wrote, an hs_err file
         and the launch log, any of which can be unreadable, and it was an
         async listener: a throw anywhere in it became an unhandled rejection
         — the session never finished, the row on Home said 'Playing' for
         ever, the window never came back to the front, and 'Launch another'
         was the only word Play had left. Now a failure ends the session the
         way a failure should. */
      child.on('exit', (code) => {
        this._child = null;
        exited(code).catch((error) => {
          const reason = error && error.message ? error.message : String(error);
          if (settled) { this._finish({ mc: this.versionId || null, error: `The game closed and BlueClient could not read why — ${reason}` }); return; }
          settled = true;
          reject(error instanceof Error ? error : new Error(reason));
        });
      });

      // The JVM is up. Give it a moment to fall over on a bad command line
      // before calling the launch a success.
      setTimeout(() => {
        if (settled || child.exitCode !== null || this._cancelled) return;
        settled = true;
        this.status = 'playing';
        this.startedAt = Date.now();
        this.emit('state', { state: 'playing', startedAt: this.startedAt });
        this._emit(100, 'done', 'Launched');
        resolve();
      }, 1200);
    });
  }

  /** Progress helper: converts per-stage fractions into an overall percent. */
  _stager() {
    let completed = 0;
    let current = STAGES[0];

    const self = this;
    return {
      begin(id) {
        current = STAGES.find((s) => s.id === id) || current;
        self._emit((completed / TOTAL_WEIGHT) * 100, current.id, current.label);
      },
      /* Another session is already fetching what this stage needs. Say so,
         rather than leaving the row on a label claiming work nobody in this
         session is doing. */
      waiting() {
        self._emit((completed / TOTAL_WEIGHT) * 100, current.id, 'Waiting for another launch');
      },
      fraction(value) {
        // Cancel lands here, mid-stage, not just between stages: the asset
        // stage alone can run for minutes cold, and a Cancel press that does
        // nothing until it finishes reads as a Cancel that does not work.
        self._check();
        const percent = ((completed + current.weight * Math.min(1, value)) / TOTAL_WEIGHT) * 100;
        self._emit(percent, current.id, current.label);
      },
      done() {
        completed += current.weight;
        self._emit((completed / TOTAL_WEIGHT) * 100, current.id, current.label);
      }
    };
  }

  /**
   * Run one shared install step inside its lane.
   *
   * The cancel check is the first thing inside the lane, not after it: a
   * player who pressed Cancel while this session sat in the queue must not
   * then watch it download everything anyway when its turn arrives.
   */
  _shared(key, work, onWait) {
    return lane(key, () => {
      this._check();
      return work();
    }, onWait);
  }

  /**
   * Stop a launch that has not reached 'playing' yet.
   *
   * Including the second after the JVM is started and before the row says
   * so (2026-09-22): the row still offers Cancel then, and a Cancel that
   * answered "ok" while the game window went on to open was the one case it
   * did nothing. The JVM is stopped and the session ends as cancelled, not
   * as a game that exited before starting (see _spawn).
   */
  cancel() {
    if (this.status !== 'working') return { ok: false };
    this._cancelled = true;
    if (this._child) this._child.kill();
    return { ok: true };
  }

  /** Close a running game, or give up on one that is still preparing. */
  close() {
    if (this.status === 'working') return this.cancel();
    if (this._child) {
      this._child.kill();
      this._child = null;
      return { ok: true };
    }
    return this.cancel();
  }

  _finish(payload) {
    this.emit('state', { state: 'idle', ...payload });
  }

  _check() {
    if (this._cancelled) throw new Cancelled();
  }

  _emit(percent, stage, label) {
    this.percent = Math.min(100, Math.round(percent * 10) / 10);
    this.stage = stage;
    this.label = label;
    this.emit('progress', { percent: this.percent, stage, label });
  }
}

/* ========================================================================
   Launcher — the register of running sessions
   ======================================================================== */

class Launcher extends EventEmitter {
  /**
   * @param {object} options
   * @param {import('./store')} options.store  read the active account from here
   * @param {string} options.root       shared versions/libraries/assets/natives
   * @param {string} options.instances  per-profile game directories
   * @param {string} options.javaDir    downloaded Java runtimes
   * @param {string} options.logDir     where the game's own output is kept
   * @param {string} [options.companionDir] the folder of in-game menu jars, one
   *                                       per Minecraft, for Fabric profiles
   * @param {string} [options.packDir]  the shaderpack, one copy, written into
   *                                    each Fabric profile's shaderpacks/
   * @param {string} [options.errorLog] where a fault in the pipeline's own code
   *                                    is written (main's launcher-errors.log)
   */
  constructor(options = {}) {
    super();
    this.options = options;
    this.sessions = new Map();
    this._seq = 0;
  }

  get busy() {
    return this.sessions.size > 0;
  }

  /**
   * Everything the first Play press would otherwise do at the press (2026-09-10).
   *
   * Measured on a warm install, the launcher spent about 200 ms between the
   * press and the JVM starting, and 140 of them were the shaderpack being
   * read and stamped — once per launcher process, on the first press. A
   * Microsoft sign-in that had aged out overnight was worse: four round trips
   * to Microsoft, Xbox and Mojang, two to four seconds, every one of them
   * between the click and the game. None of it needs the press to have
   * happened, so it is all done here, once the window is up, and the press
   * finds it done. The launch pipeline still does each of these itself when
   * it has to — this only makes that the rare case.
   *
   * The sign-in keeps being renewed while the launcher stays open: a token
   * checked at nine and pressed at four would otherwise be stale again.
   * Nothing here can fail a launch, and nothing here throws.
   */
  prime() {
    const { store, packDir, companionDir, javaDir } = this.options;
    const quietly = (promise) => Promise.resolve(promise).catch(() => {});

    quietly(shaderpack.prime(packDir));
    if (companionDir) quietly(companion.coverage(companionDir));
    quietly(this._renew(0));
    quietly(this._warmLookups());

    // The class archives (install.archiveClasses) are a JVM run each, a few
    // seconds of CPU, so they go last and one at a time.
    if (javaDir) quietly(install.warmJava(javaDir).then(() => this._warmGpu()));

    const timer = setInterval(() => {
      quietly(this._renew(RENEW_AHEAD_MS));
      quietly(this._warmLookups());
    }, RENEW_EVERY_MS);
    if (timer.unref) timer.unref();
  }

  /**
   * The network answers a press used to wait for, fetched while nobody is
   * waiting (2026-09-22).
   *
   * `prime` warmed the shaderpack stamp, the jar ranges and the sign-in from
   * the day it was written, and left the three questions that actually reach
   * the internet on the press: which Fabric loader is current, which jar
   * Modrinth hands over for each mod in the list, and which Java Mojang points
   * at. Every one of those is remembered (game/memo.js) with a TTL measured in
   * hours, so the FIRST press of each day paid all three in front of the
   * player — a launcher opened at nine and pressed at nine had a stale
   * `fabric:26.3` and a stale `mod:*` for every mod in the profile. Renewed
   * here, on the same ten-minute beat as the token, they are fresh when the
   * press comes; and `serveStale` means even a press that beats this one is
   * answered from memory rather than from the network.
   *
   * Only the profiles the player actually has, and only the versions among
   * them: a launcher with eight profiles on three Minecrafts asks three times,
   * not eight. Nothing here can fail a launch and nothing here throws.
   */
  async _warmLookups() {
    const { store, instances } = this.options;
    const profiles = (store.get('profiles') || []).filter((p) => p && p.version);
    if (!profiles.length) return;

    install.warmFabric(profiles.filter((p) => p.loader === 'fabric').map((p) => p.version));
    // Mojang's runtime index too (2026-09-22): the one lookup the press
    // still met expired, once every half day.
    if (!String(store.get('game.javaPath') || '').trim()) await install.warmJavaIndex();
    await mods.warmLookups(profiles.map((p) => ({
      version: p.version,
      loader: p.loader === 'fabric' ? 'fabric' : 'vanilla',
      mods: profileMods(store, p.id)
    })));
    // The walk of every other launcher's folders that `settings.adopt` does
    // on the press, done here instead so the press reads it out of memory.
    if (instances) await settings.warmElsewhere();
  }

  /**
   * Which card Windows will draw on, settled for every runtime on disk rather
   * than for the one this press needs (2026-09-22). `gpu.prefer` is a
   * `reg.exe` subprocess with a four-second clock, memoised per executable, so
   * it was the first press of each launcher run that paid it.
   */
  async _warmGpu() {
    const { javaDir } = this.options;
    if (!javaDir || process.platform !== 'win32') return;
    let names;
    try { names = await fsp.readdir(javaDir); } catch { return; }
    for (const name of names) {
      await gpu.prefer(path.join(javaDir, name, 'bin', 'javaw.exe')).catch(() => 'none');
    }
  }

  /** A renewal under the same lane the launch uses, so the two never race. */
  async _renew(horizonMs) {
    const { list } = await lane('auth', () => renewIfStale(this.options.store, horizonMs));
    if (list) {
      this.emit('accounts', { list, active: (this.options.store.get('accounts') || {}).active });
    }
  }

  /** The running games, oldest first — the order the rows are drawn in. */
  list() {
    return [...this.sessions.values()].map((session) => session.summary());
  }

  async launch(profile) {
    if (this.sessions.size >= MAX_SESSIONS) {
      return {
        ok: false,
        error: `BlueClient runs up to ${MAX_SESSIONS} games at once. Close one to start another.`
      };
    }

    const session = new Session({
      id: `s${++this._seq}`,
      profile,
      options: this.options
    });
    this.sessions.set(session.id, session);

    const tag = { id: session.id, profile: { id: profile.id, name: profile.name } };

    session.on('progress', (payload) => this.emit('progress', { ...tag, ...payload }));
    session.on('warning', (payload) => this.emit('warning', { ...tag, ...payload }));
    session.on('accounts', (payload) => this.emit('accounts', payload));
    session.on('state', (payload) => {
      // Drop it from the register *before* announcing, so the count that goes
      // out with the event is the count actually left running — main restores
      // the window on the last one.
      if (payload.state === 'idle') this.sessions.delete(session.id);
      this.emit('state', { ...tag, running: this.sessions.size, ...payload });
    });

    // Announced before the first await, so the row appears on the press rather
    // than after the first network round trip.
    this.emit('state', { ...tag, running: this.sessions.size, state: 'working' });

    return session.start();
  }

  cancel(id) {
    const session = this.sessions.get(id);
    return session ? session.cancel() : { ok: false };
  }

  stop(id) {
    const session = this.sessions.get(id);
    return session ? session.close() : { ok: false };
  }
}

async function fileExists(file) {
  try {
    return (await fsp.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** A profile's own mod list; profiles never share one. */
function profileMods(store, profileId) {
  const profiles = store.get('profiles') || [];
  const profile = profiles.find((p) => p.id === profileId);
  return (profile && profile.mods) || [];
}

/**
 * Renew a Microsoft token that has aged out, before the game asks for it.
 *
 * A launcher spends most of its life closed, so the common case is a token
 * that quietly expired overnight. Renewing here costs the player nothing and
 * happens without a window. What it could not do is answered too
 * (2026-09-20): `error` is the AuthError — code `expired` for a refresh
 * token Microsoft no longer honours, `offline`/`timeout`/`msa_unavailable`
 * for a Microsoft that could not be reached — and the launch decides what
 * that means for the press (Session._run); the timer in prime() only reads
 * the list.
 *
 * @returns {Promise<{ list: object[] | null, error: Error | null }>}
 */
async function renewIfStale(store, horizonMs = 0) {
  const clientId = auth.appId(store.get('auth.clientId'));
  const accounts = store.get('accounts') || {};
  const list = accounts.list || [];
  const index = list.findIndex((a) => a.id === accounts.active);
  const account = index >= 0 ? list[index] : list[0];

  // `horizonMs` lets the timer in Launcher.prime renew a token that is about
  // to expire rather than one that has; a launch itself asks with zero.
  const stale = auth.stale(account)
    || (horizonMs > 0 && auth.stale({ ...account, expiresAt: (account?.expiresAt || 0) - horizonMs }));
  if (!account || !stale || !clientId) return { list: null, error: null };

  try {
    const renewed = await auth.refresh({ clientId, account });
    list[list.indexOf(account)] = { ...account, ...renewed };
    store.set('accounts', { ...accounts, list });
    return { list, error: null };
  } catch (error) {
    // Left as it was; the caller says what that means.
    return { list: null, error };
  }
}

/**
 * The account the game will run as.
 *
 * Read at the moment Play is pressed, which is what lets two sessions run as
 * two different people: switch account between presses and the second game
 * signs in as whoever is active then.
 *
 * An account only counts as online when it actually carries a token. Anything
 * else — an offline account, or one added before sign-in existed — launches
 * offline, with the same UUID the server would derive from the name.
 */
function resolveAccount(store) {
  const accounts = store.get('accounts') || {};
  const list = accounts.list || [];
  const account = list.find((a) => a.id === accounts.active) || list[0];

  if (!account) throw new Error('Add an account before launching.');

  const online = account.type === 'microsoft' && Boolean(account.accessToken);
  return {
    username: account.username,
    uuid: online ? account.uuid : install.offlineUuid(account.username),
    accessToken: online ? account.accessToken : '0',
    type: online ? 'microsoft' : 'offline',
    xuid: account.xuid || '',
    clientId: account.clientId || ''
  };
}

/* `explainExit` lived here until 2026-09-11 — the first error line, a missing
   main class, a Java too old. Those cases are `crashes.js`'s now, beside the
   crash report it reads, so a game that dies has one reader whatever it left
   behind. */

/**
 * Keep each session's command line and output next to the settings.
 *
 * One file per session rather than one for the launcher: with several games
 * running, a single `latest-launch.log` would be overwritten by whichever
 * happened to exit last, which is rarely the one that went wrong. It is still
 * written too, so anything that goes looking for "the last launch" finds it.
 *
 * Not called at all when Settings › Keep launch logs is off — that switch
 * means no log files, not smaller ones.
 *
 * A crash goes in at the end (2026-09-11): the line the row on Home shows,
 * where the game's own report is, and that report's first forty lines — so
 * "Open log" opens one file that says what happened and where to read more.
 *
 * @returns {Promise<string|null>} the session's own log file
 */
async function writeLog(logDir, sessionId, context, binary, args, tail, crash = null, freezes = [], frames = []) {
  if (!logDir) return null;
  await fsp.mkdir(logDir, { recursive: true });

  const header = [
    `session   ${sessionId}`,
    // Which launcher wrote it (2026-09-21): the one number a pasted log
    // needs that nothing else in it says — the mod list scrolls out of the
    // tail in a long session, and the profile's version is Minecraft's.
    `launcher  ${VERSION}`,
    `profile   ${context.profile.name} (${context.profile.id})`,
    `version   ${context.versionId}`,
    `account   ${context.account.username} [${context.account.type}]`,
    `java      ${binary}`,
    // Which card Windows was told to draw it on (game/gpu.js): "set" the
    // first time this runtime was ever launched, "kept" when a line for it
    // was already there — the player's own, or ours from an earlier day.
    ...(context.card && context.card !== 'none' ? [`gpu       high performance (${context.card})`] : []),
    // The runtime files the Java stage found missing or wrong and put back
    // (install.verifyRuntime, 2026-09-19) — one line, only on the launch
    // that did it; a runtime found whole says nothing, and a runtime that
    // was not there at all was installed, not repaired.
    ...(context.repaired && context.repaired.length
      ? [`java      ${context.javaInstalled ? 'installed' : 'repaired'} ${context.repaired.length} file${context.repaired.length === 1 ? '' : 's'}: ${context.repaired.slice(0, 12).join(', ')}${context.repaired.length > 12 ? ', …' : ''}`]
      : []),
    // Which builds the mods folder was talked out of, and why, so a crash
    // in Sodium is read against the Sodium that was actually there.
    ...(context.held || []).map((h) => `mods      ${h.name} held at ${h.to} instead of ${h.from}: ${h.because}`),
    ...(context.conflicts || []).map((c) => `mods      unsettled: ${c}`),
    // The stack mods this Minecraft has no build of yet, left out quietly
    // (game/mods.js, 2026-09-19) — said here so "why is Sodium not in the
    // list" has an answer.
    ...(context.missing || []).map((m) => `mods      left out: ${m}`),
    '',
    'arguments',
    ...withoutSecrets(args).map((a) => '  ' + a),
    '',
    'output',
    ''
  ].join('\n');

  // Every freeze the companion noted, whatever the tail still holds
  // (2026-09-21): how long, where it stood, and whether it came back.
  const froze = freezes.length
    ? ['', 'freezes', ...freezes.map((f) => '  ' + crashes.freezeLine(f)), ''].join('\n')
    : '';
  // And the frame record of every sitting (2026-09-22): what the companion
  // said at each disconnect and at the stop.
  const drawn = frames.length
    ? ['', 'frames', ...frames.map((f) => '  ' + crashes.frameLine(f)), ''].join('\n')
    : '';
  const body = header + tail.join('') + froze + drawn + crashes.forLog(crash);
  const slug = String(context.profile.name || 'profile')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'profile';

  const own = path.join(logDir, `${slug}-${sessionId}.log`);
  await fsp.writeFile(own, body, 'utf8');
  await fsp.writeFile(path.join(logDir, 'latest-launch.log'), body, 'utf8');
  return own;
}

/**
 * The command line with the Microsoft token taken out (2026-09-20).
 *
 * "Open log" is the file a player pastes into the Discord when a game will
 * not start, and the game's own command line — which this log keeps so a
 * bad argument can be read — carries `--accessToken` with a token that is
 * good for a day on the player's account. The first log a player sent had
 * the value blanked by hand; the next one may not. The argument stays and
 * its value reads `(hidden)`, so the shape of the command is still there to
 * read. `--xuid` and `--clientId` are identifiers, not secrets, and stay.
 */
function withoutSecrets(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    out.push(arg);
    if (arg === '--accessToken' && i + 1 < args.length) {
      out.push(String(args[i + 1]) === '0' ? '0' : '(hidden)');
      i++;
    }
  }
  return out;
}

module.exports = { Launcher, STAGES, MAX_SESSIONS, withoutSecrets };
