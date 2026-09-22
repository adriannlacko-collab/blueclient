'use strict';

/**
 * Server List Ping.
 *
 * The same handshake the game sends to fill its Multiplayer screen: connect,
 * say who we are, ask for status, read one JSON back. No library and no
 * third-party status site — the numbers on Home come from the servers
 * themselves, or they are not shown (2026-09-02: they used to be typed in).
 *
 * Runs in main, like every other bit of network. The renderer asks for a set
 * of addresses and gets a map back; a server that is down or slow costs only
 * its own entry.
 */

const net = require('net');
const dns = require('dns/promises');

/* 1.21.4. Servers answer a status request whatever this says, but the game
   sends its own number, so the launcher sends the version it launches. */
const PROTOCOL = 769;
const TIMEOUT_MS = 4000;
const DEFAULT_PORT = 25565;

function varint(value) {
  const out = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return Buffer.from(out);
}

function string(text) {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([varint(bytes.length), bytes]);
}

/** A packet is its own length, then an id, then the fields. */
function packet(id, ...fields) {
  const body = Buffer.concat([varint(id), ...fields]);
  return Buffer.concat([varint(body.length), body]);
}

/** [value, bytesUsed], or null while the buffer is still incomplete. */
function readVarint(buf, offset) {
  let value = 0;
  let shift = 0;
  let i = offset;
  while (i < buf.length) {
    const byte = buf[i++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value >>> 0, i - offset];
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

/**
 * The SRV record the game consults first, or the host as given.
 *
 * Only when no port was written down. That is the game's own rule, and it
 * matters: a partner who publishes "play.example.net:25566" means that port,
 * and an SRV record on the bare domain — which is usually there, pointing at
 * the main lobby — would have quietly sent the ping somewhere else and put the
 * wrong player count on their row.
 */
async function resolve(host, port, explicitPort) {
  if (explicitPort) return { host, port };
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (records.length) return { host: records[0].name, port: records[0].port };
  } catch {
    /* No SRV record: the plain host it is. */
  }
  return { host, port };
}

/**
 * @param {string} address  "host" or "host:port"
 * @returns {Promise<{ok: boolean, online?: number, max?: number, latency?: number, favicon?: string, error?: string}>}
 */
async function status(address) {
  const [name, portText] = String(address || '').trim().split(':');
  if (!name) return { ok: false, error: 'no address' };
  const given = Number(portText);
  const target = await resolve(name, given || DEFAULT_PORT, Number.isInteger(given) && given > 0);
  const started = Date.now();

  return new Promise((done) => {
    const chunks = [];
    let settled = false;
    let socket = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) socket.destroy();
      done(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), TIMEOUT_MS);

    socket = net.createConnection({ host: target.host, port: target.port });
    socket.setNoDelay(true);

    socket.on('connect', () => {
      socket.write(Buffer.concat([
        // Handshake: protocol, the name as typed (SRV or not, the game sends
        // what the player typed), the port, and "next state: status".
        packet(0x00, varint(PROTOCOL), string(name), Buffer.from([target.port >> 8, target.port & 0xff]), varint(1)),
        // Status request: empty.
        packet(0x00)
      ]));
    });

    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const length = readVarint(buf, 0);
      if (!length) return;
      if (buf.length < length[1] + length[0]) return;

      const id = readVarint(buf, length[1]);
      if (!id || id[0] !== 0x00) { finish({ ok: false, error: 'unexpected reply' }); return; }
      const text = readVarint(buf, length[1] + id[1]);
      if (!text) { finish({ ok: false, error: 'bad reply' }); return; }

      const start = length[1] + id[1] + text[1];
      try {
        const body = JSON.parse(buf.subarray(start, start + text[0]).toString('utf8'));
        finish({
          ok: true,
          online: Number(body.players?.online) || 0,
          max: Number(body.players?.max) || 0,
          latency: Date.now() - started,
          /* The server's own icon, the game's own field — a 64x64 PNG as a
             data URL, absent on a server that set none. Kept by
             servericons.js (2026-09-13); the numbers above are what the
             rows read. */
          favicon: typeof body.favicon === 'string' ? body.favicon : undefined
        });
      } catch {
        finish({ ok: false, error: 'bad json' });
      }
    });

    socket.on('error', (error) => finish({ ok: false, error: error.code || error.message }));
    socket.on('close', () => finish({ ok: false, error: 'closed' }));
  });
}

/** Status for several servers at once, keyed by address. */
async function statuses(addresses) {
  const list = Array.isArray(addresses) ? addresses.map(String).slice(0, 20) : [];
  const results = await Promise.all(list.map((address) =>
    status(address).catch((error) => ({ ok: false, error: String(error?.message || error) }))));
  const out = {};
  list.forEach((address, i) => { out[address] = results[i]; });
  return out;
}

module.exports = { status, statuses };
