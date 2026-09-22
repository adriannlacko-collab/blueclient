'use strict';

/**
 * Discord presence: "Playing BlueClient — Minecraft 1.21.8" under the
 * player's name, for everyone in their Discord servers to see.
 *
 * The audience lives in Discord and picks a client by what their friends use,
 * which makes this line the cheapest advertising a client can have. Lunar,
 * Dawn and Badlion all carry it. BlueClient had a Discord button until
 * 2026-09-02 that led nowhere and was rightly cut; this is the thing the
 * button should have been (2026-09-06).
 *
 * <h2>How it talks to Discord</h2>
 * Discord listens on a named pipe on this machine — `discord-ipc-0` through
 * `-9` — and speaks a small framed protocol: an opcode and a length, then
 * JSON. A handshake names the application; from then on SET_ACTIVITY carries
 * what is shown. No library, no network: nothing leaves the PC, and a machine
 * without Discord simply has no pipe to open, which this module tries again
 * every half minute in case Discord starts later.
 *
 * <h2>What is shown</h2>
 * In the launcher with nothing running: "In the launcher". With a game up:
 * the Minecraft version, the profile's name, and how long it has been open.
 * Nothing that names the player, their account or their servers.
 *
 * <h2>The one thing it needs</h2>
 * {@link APP_ID}: the id of a Discord application, which is how Discord
 * learns the name to show and where to find the artwork. Made once at
 * discord.com/developers/applications — an application called BlueClient,
 * with the logo uploaded under Rich Presence → Art Assets as `blueclient`.
 * Empty, this module does nothing at all.
 */

const net = require('net');
const crypto = require('crypto');

/** The Discord application this launcher shows up as. Empty means off. */
const APP_ID = '';

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const RETRY_MS = 30 * 1000;

let launcher = null;
let socket = null;
let ready = false;
let buffer = Buffer.alloc(0);
let retryTimer = null;
let stopped = false;

/* ---------------------------------------------------------------- pipes */

function pipePaths() {
  const paths = [];
  if (process.platform === 'win32') {
    for (let i = 0; i < 10; i++) paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    return paths;
  }
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  for (let i = 0; i < 10; i++) paths.push(`${base.replace(/\/$/, '')}/discord-ipc-${i}`);
  return paths;
}

/** Try each pipe in turn; the first that answers is Discord. */
function connect(paths = pipePaths()) {
  if (stopped || socket || !paths.length) {
    if (!socket && !stopped) scheduleRetry();
    return;
  }
  const [first, ...rest] = paths;
  const candidate = net.connect(first);

  candidate.once('connect', () => {
    socket = candidate;
    buffer = Buffer.alloc(0);
    ready = false;
    candidate.on('data', onData);
    candidate.on('close', onClose);
    candidate.on('error', () => {});
    write(OP_HANDSHAKE, { v: 1, client_id: APP_ID });
  });
  candidate.once('error', () => {
    candidate.destroy();
    connect(rest);
  });
}

function onClose() {
  socket = null;
  ready = false;
  scheduleRetry();
}

function scheduleRetry() {
  if (stopped || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, RETRY_MS);
  retryTimer.unref();
}

/* --------------------------------------------------------------- frames */

function write(op, payload) {
  if (!socket || socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0);
  head.writeUInt32LE(body.length, 4);
  try {
    socket.write(Buffer.concat([head, body]));
  } catch {
    // The pipe went as we wrote; close follows.
  }
}

function onData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 8) {
    const op = buffer.readUInt32LE(0);
    const length = buffer.readUInt32LE(4);
    if (buffer.length < 8 + length) return;
    const body = buffer.subarray(8, 8 + length).toString('utf8');
    buffer = buffer.subarray(8 + length);

    let message = null;
    try { message = JSON.parse(body); } catch { message = null; }

    if (op === OP_PING) { write(OP_PONG, message || {}); continue; }
    if (op === OP_CLOSE) { if (socket) socket.destroy(); continue; }
    if (op !== OP_FRAME || !message) continue;

    if (message.cmd === 'DISPATCH' && message.evt === 'READY') {
      ready = true;
      show();
    }
  }
}

/* ------------------------------------------------------------- activity */

/** What Discord shows right now, from the games the launcher has open. */
function activity() {
  const sessions = launcher ? launcher.list().filter((s) => s.status === 'playing') : [];
  const assets = { large_image: 'blueclient', large_text: 'BlueClient' };

  if (!sessions.length) {
    return { details: 'In the launcher', assets };
  }

  // The first game started is the one that has been open longest, which is
  // the one the clock should belong to.
  const first = sessions.reduce((a, b) => ((a.startedAt || 0) <= (b.startedAt || 0) ? a : b));
  return {
    details: `Minecraft ${first.version || ''}`.trim(),
    state: sessions.length > 1 ? `${first.name} and ${sessions.length - 1} more` : first.name,
    timestamps: { start: Math.floor((first.startedAt || Date.now()) / 1000) },
    assets
  };
}

function show() {
  if (!ready) return;
  write(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    nonce: crypto.randomUUID(),
    args: { pid: process.pid, activity: activity() }
  });
}

/* --------------------------------------------------------------- public */

/**
 * Start, if there is an application id to start as. The launcher is where
 * the running games are read from; every change in them repaints the line.
 */
function start(theLauncher) {
  if (!APP_ID) return;
  launcher = theLauncher;
  launcher.on('state', () => show());
  connect();
}

/** As the launcher quits: take the line down rather than leave it to time out. */
function stop() {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  if (socket && ready) {
    write(OP_FRAME, { cmd: 'SET_ACTIVITY', nonce: crypto.randomUUID(), args: { pid: process.pid } });
  }
  if (socket) socket.destroy();
  socket = null;
}

module.exports = { start, stop, APP_ID };
