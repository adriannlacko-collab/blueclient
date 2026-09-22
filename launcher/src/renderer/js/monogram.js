/**
 * Monogram tiles.
 *
 * Used wherever something has no real icon yet — mods, partner servers, and
 * versions with no artwork. A generated pixel-art texture was the previous
 * answer and it read as noise: every tile looked like static, and nothing in
 * the app agreed with anything else. A letter on a flat tinted tile is
 * obviously a placeholder, which is the honest thing for it to look like, and
 * it sits quietly next to real artwork instead of competing with it.
 *
 * The hue is derived from the name, so a given item always gets the same tile.
 */

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

const cache = new Map();

export function monogram(name = '?', size = 48, options = {}) {
  const key = `${name}|${size}|${options.hue ?? ''}`;
  if (cache.has(key)) return cache.get(key);

  const seed = hash(String(name).toLowerCase());
  const hue = options.hue ?? seed % 360;
  const letter = String(name).trim().charAt(0).toUpperCase() || '?';
  const radius = Math.round(size * 0.26);

  // Muted, not candy — these sit beside photographic artwork.
  const top = `hsl(${hue} 44% 46%)`;
  const bottom = `hsl(${(hue + 18) % 360} 46% 32%)`;
  const id = `m${seed.toString(36)}`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${top}"/><stop offset="100%" stop-color="${bottom}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${size}" height="${size}" rx="${radius}" fill="url(#${id})"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${Math.round(size * 0.44)}" ` +
    `font-weight="700" fill="rgba(255,255,255,.92)">${letter}</text>` +
    `</svg>`;

  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

/**
 * Card art for a version with no official image. A flat plate with the version
 * number rather than a fake landscape — it reads as "no art yet", not as bad
 * art.
 */
export function versionPlate(version = '?', width = 320) {
  const key = `plate|${version}|${width}`;
  if (cache.has(key)) return cache.get(key);

  const height = width;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0%" stop-color="#2a3038"/><stop offset="100%" stop-color="#171b21"/>` +
    `</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#p)"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Inter, Segoe UI, Arial, sans-serif" font-size="${Math.round(width * 0.19)}" ` +
    `font-weight="800" fill="rgba(255,255,255,.28)" letter-spacing="-1">${version}</text>` +
    `</svg>`;

  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}
