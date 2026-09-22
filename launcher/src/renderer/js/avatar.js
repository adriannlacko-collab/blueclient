/**
 * Deterministic avatar generator.
 *
 * Draws a symmetric 8×8 pixel face seeded from the username, returned as an
 * SVG data URI. Generated locally rather than fetched so the launcher renders
 * identically offline and on first paint — no layout shift, no network wait.
 * Swapping in a real skin renderer later only means changing `avatarFor`.
 */

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Small xorshift so successive pixels don't correlate. */
function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Palette derived from the name, so a player always looks like themselves. */
function paletteFor(username) {
  const seed = hash(String(username).toLowerCase() || 'beam');
  const hue = seed % 360;
  return {
    seed,
    skin: `hsl(${(hue + 24) % 360} 44% 66%)`,
    skinShade: `hsl(${(hue + 24) % 360} 40% 54%)`,
    hair: `hsl(${(hue + 205) % 360} 38% 24%)`,
    shirt: `hsl(${hue} 58% 52%)`,
    shirtShade: `hsl(${hue} 58% 42%)`,
    // Arms are deliberately a shade darker than the torso. Same colour reads
    // as one wide slab rather than a body with limbs.
    sleeve: `hsl(${hue} 56% 44%)`,
    sleeveShade: `hsl(${hue} 56% 36%)`,
    trousers: `hsl(${(hue + 40) % 360} 34% 34%)`,
    shoes: `hsl(${(hue + 40) % 360} 28% 22%)`
  };
}

/**
 * Full-body character, Minecraft skin proportions on a 16x32 grid:
 * 8x8 head, 8x12 torso, 4x12 arms either side, two 4x12 legs.
 * Used on the play screen, standing in the hero scene.
 */
export function characterFor(username = '?', height = 220) {
  const p = paletteFor(username);
  const next = rng(p.seed);
  const W = 16;
  const H = 32;
  const parts = [];

  const box = (x, y, w, h, fill) => parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`);
  const speckle = (x, y, w, h, base, shade) => {
    box(x, y, w, h, base);
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (next() > 0.86) box(px, py, 1, 1, shade);
      }
    }
  };

  // Arms (drawn first so the torso overlaps them cleanly)
  speckle(0, 8, 4, 12, p.sleeve, p.sleeveShade);
  speckle(12, 8, 4, 12, p.sleeve, p.sleeveShade);
  box(0, 17, 4, 3, p.skinShade);
  box(12, 17, 4, 3, p.skinShade);

  // Torso
  speckle(4, 8, 8, 12, p.shirt, p.shirtShade);

  // Legs
  speckle(4, 20, 4, 12, p.trousers, p.shoes);
  speckle(8, 20, 4, 12, p.trousers, p.shoes);
  box(4, 30, 4, 2, p.shoes);
  box(8, 30, 4, 2, p.shoes);

  // Head
  speckle(4, 0, 8, 8, p.skin, p.skinShade);
  box(4, 0, 8, 2, p.hair);
  box(4, 2, 1, 2, p.hair);
  box(11, 2, 1, 2, p.hair);
  box(6, 3, 1, 2, '#1b1b22');
  box(9, 3, 1, 2, '#1b1b22');
  box(7, 6, 2, 1, p.skinShade);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round((height / H) * W)}" height="${height}" ` +
    `viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${parts.join('')}</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function avatarFor(username = '?', size = 64) {
  const seed = hash(String(username).toLowerCase() || 'beam');
  const next = rng(seed);

  const hue = seed % 360;
  const skin = `hsl(${hue} 52% 62%)`;
  const shade = `hsl(${hue} 46% 48%)`;
  const hair = `hsl(${(hue + 205) % 360} 40% 26%)`;
  const back = `hsl(${(hue + 180) % 360} 30% 20%)`;

  const grid = 8;
  const cells = [];

  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid / 2; x++) {
      let colour = skin;

      if (y <= 1) colour = hair;                       // hair line
      else if (y === 2) colour = next() > 0.45 ? hair : skin;
      else if (y === 3 && x >= 2) colour = '#1b1b22';  // eyes
      else if (y === 6 && x >= 1) colour = next() > 0.5 ? shade : skin;
      else if (next() > 0.86) colour = shade;

      cells.push([x, y, colour]);
      cells.push([grid - 1 - x, y, colour]);           // mirror
    }
  }

  const rects = cells
    .map(([x, y, colour]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${colour}"/>`)
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges">` +
    `<rect width="${grid}" height="${grid}" fill="${back}"/>${rects}</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
