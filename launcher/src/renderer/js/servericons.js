/**
 * Server logos, wherever a server is a row (2026-09-13).
 *
 * Adrian: "put logos on all places for servers like in the featured servers
 * list and in your play page, just pull it from their domains or something."
 * Featured servers on Home, Where you left off, and Where you played on Stats
 * all draw a server the same way now: the picture the server itself sends
 * with its status — the icon the game shows beside it on the Multiplayer
 * screen — or, failing that, the icon off its website. Main finds and keeps
 * them (src/main/game/servericons.js); this file asks once per server per
 * session and hands the answer to whichever rows are waiting.
 *
 * A row never waits for the picture. It paints its stand-in — the bundled
 * art a featured partner has, the generated initial tile, the server glyph
 * in the place's colour — and the logo replaces it when it lands: at once
 * from disk after the first look, a second or so the first time. A server
 * with no logo anywhere keeps its stand-in, which is a picture too.
 */

import { el } from './ui/dom.js';
import { host } from './bridge.js';

/** A server that answered with nothing is asked again after this — main retries a down one on the same clock. */
const RETRY_MS = 10 * 60000;

const asked = new Map();   // host -> { promise, at, url }

const keyOf = (address) => String(address || '').trim().toLowerCase().split(':')[0].replace(/\.$/, '');

/** The server's logo as a data URL, or null. Memoised per session; a miss is asked again later. */
export function serverIcon(address) {
  const key = keyOf(address);
  if (!key) return Promise.resolve(null);
  const known = asked.get(key);
  if (known && (known.url || Date.now() - known.at < RETRY_MS)) return known.promise;

  const entry = { at: Date.now(), url: null, promise: null };
  entry.promise = Promise.resolve()
    .then(() => host.servers?.icon?.(address))
    .then((url) => {
      entry.url = typeof url === 'string' && url.startsWith('data:image/') ? url : null;
      entry.at = Date.now();
      return entry.url;
    })
    .catch(() => null);
  asked.set(key, entry);
  return entry.promise;
}

/**
 * Put the server's logo into `img` when there is one. The element keeps
 * whatever `src` it was given until then, so a row's stand-in is never a
 * blank; `onLogo` runs once the picture is in, for a box that wants to
 * change shape around it.
 */
export function fillLogo(img, address, onLogo = null) {
  serverIcon(address).then((url) => {
    if (!url || !img.isConnected) return;
    img.src = url;
    if (onLogo) onLogo();
  });
}

/**
 * A box that starts as a glyph and becomes the logo: `box` holds the glyph;
 * when the picture lands the glyph is replaced by an <img> and the box wears
 * `has-logo`, which is what its stylesheet reads to drop the glyph's tint.
 */
export function logoInto(box, address, className) {
  serverIcon(address).then((url) => {
    if (!url || !box.isConnected) return;
    box.classList.add('has-logo');
    box.replaceChildren(el('img', { class: className, src: url, alt: '', draggable: 'false' }));
  });
}
