/**
 * Modrinth project icons.
 *
 * The renderer runs under `img-src 'self' data:`, so a cdn.modrinth.com URL
 * cannot be put in a src attribute. Main fetches it and hands back a data URI;
 * this caches the promise so the same icon is fetched once no matter how many
 * lists it appears in.
 *
 * A mod that arrived without an icon address — the bundled performance stack,
 * or one added before addresses were kept — is looked up by its Modrinth slug
 * instead, so every card wears the artwork Modrinth shows for it.
 */

import { host } from './bridge.js';

const cache = new Map();
const bySlug = new Map();

/* Data URIs run to a quarter megabyte each, so the cache is capped: past the
   cap the oldest entries fall out, which is fine — an icon scrolled far out
   of view is cheap to fetch again if it ever comes back. */
const CACHE_MAX = 200;

/** The icon address Modrinth lists for a project, fetched once per slug. */
export function iconUrlFor(slug) {
  if (!slug) return Promise.resolve('');
  if (!bySlug.has(slug)) {
    bySlug.set(slug, host.modrinth.project(slug).then((result) => (result?.ok ? result.iconUrl || '' : '')));
  }
  return bySlug.get(slug);
}

/**
 * Swap an element's placeholder for the real artwork, once it arrives.
 * Resolves to the address that was used, so a caller can remember it.
 *
 * Never gated on the element being in the document: a cached icon resolves
 * in a microtask, before the card it belongs to has been appended, and
 * checking `isConnected` there is how every re-paint of the list used to
 * drop back to monograms (fixed 2026-09-02).
 */
export async function paintModIcon(img, url, slug) {
  if (!img) return '';
  if (!url) url = await iconUrlFor(slug);
  if (!url) return '';

  if (!cache.has(url)) {
    if (cache.size >= CACHE_MAX) {
      for (const key of cache.keys()) {
        if (cache.size < CACHE_MAX) break;
        cache.delete(key);
      }
    }
    cache.set(url, host.modrinth.icon(url));
  }

  const result = await cache.get(url);
  if (!result?.ok) return '';
  img.src = result.dataUri;
  return url;
}
