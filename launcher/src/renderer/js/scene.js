/**
 * Generated pixel-art scenery.
 *
 * Two uses:
 *   heroScene()          — the wide banner behind the launch button
 *   versionPoster(id)    — the portrait card art in the versions grid
 *
 * Both come out of the same generator with a different palette and aspect.
 * Generating them means the grid gets distinctive art per version without
 * shipping any of the game's own images, and it costs no network.
 *
 * These are large strings (tens of KB of <rect>), so every result is memoised.
 */

const BLOCK = 16;

/** Biome palettes. `sky` runs top -> horizon. */
const PALETTES = {
  day: {
    sky: ['#2a6f9e', '#57a8d8', '#9bd3ef', '#d8eefb'],
    sun: '#fdfbe8', glow: '#bfe6fb', cloud: '#eaf6ff',
    ridge: ['#4d7f95', '#3f6b80'],
    grass: ['#7cbd56', '#6fae4b', '#63a043'],
    dirt: ['#8b6141', '#7a5439', '#6b4a32'],
    stone: ['#6f7278', '#63666b', '#585b60'],
    trunk: ['#6b4a2f', '#5c3f28'],
    leaves: ['#4f9c3f', '#458a37', '#3c7a30']
  },
  sunset: {
    sky: ['#3b2d63', '#8a4f72', '#e08a63', '#f7c98b'],
    sun: '#fff0c4', glow: '#f7a866', cloud: '#f0b48c',
    ridge: ['#6b4668', '#4e3350'],
    grass: ['#6e9e4c', '#628f43', '#57803b'],
    dirt: ['#7d573b', '#6d4c33', '#5f422c'],
    stone: ['#5f5a60', '#544f55', '#49454a'],
    trunk: ['#5c4029', '#4d3522'],
    leaves: ['#4a8438', '#417531', '#38662a']
  },
  ocean: {
    sky: ['#1d5f88', '#3f92bd', '#7ec4e2', '#c7e9f5'],
    sun: '#f4fbff', glow: '#a8ddf2', cloud: '#dff2fb',
    ridge: ['#2f6f88', '#255a70'],
    grass: ['#5fb0a0', '#54a191', '#4a9283'],
    dirt: ['#c9b98d', '#b9a97e', '#a99a71'],
    stone: ['#5e6b72', '#536067', '#48545a'],
    trunk: ['#6b4a2f', '#5c3f28'],
    leaves: ['#3f9c7f', '#378a70', '#2f7a62']
  },
  nether: {
    sky: ['#2a0d0d', '#5c1a16', '#8f2c1e', '#c0522c'],
    sun: '#ffd8a0', glow: '#e8783c', cloud: '#7a2a1e',
    ridge: ['#5f231c', '#471a15'],
    grass: ['#7c3a3a', '#6d3333', '#5f2c2c'],
    dirt: ['#66302c', '#592a26', '#4c2421'],
    stone: ['#43302e', '#3a2a28', '#312422'],
    trunk: ['#4a2b2b', '#3d2323'],
    leaves: ['#9c4a2c', '#8a4127', '#7a3922']
  },
  end: {
    sky: ['#100c1c', '#241a3a', '#3a2a56', '#5a4478'],
    sun: '#f2e6ff', glow: '#9a7fd0', cloud: '#2e2447',
    ridge: ['#3b2f57', '#2d2444'],
    grass: ['#ddd9a8', '#d2ce9b', '#c6c28d'],
    dirt: ['#c2be8f', '#b4b083', '#a6a277'],
    stone: ['#4a4466', '#403b59', '#36324c'],
    trunk: ['#4a4466', '#3d3855'],
    leaves: ['#7f6bb0', '#715f9e', '#63538c']
  },
  snow: {
    sky: ['#3a5f80', '#6f9ec2', '#a9cde4', '#e3f2fa'],
    sun: '#ffffff', glow: '#cfe8f7', cloud: '#f4fbff',
    ridge: ['#5d7c92', '#4a677b'],
    grass: ['#e8f2f7', '#d9e7ee', '#c9dae4'],
    dirt: ['#8b6141', '#7a5439', '#6b4a32'],
    stone: ['#6f7278', '#63666b', '#585b60'],
    trunk: ['#5c4029', '#4d3522'],
    leaves: ['#3f6f52', '#376248', '#2f553e']
  }
};

/* Auto-assigned biomes. Nether and End are available for a deliberate choice
   but stay out of the rotation — at this fidelity they render as muddy flat
   fields rather than as readable scenery. */
export const PALETTE_IDS = Object.keys(PALETTES);
const ROTATION = ['day', 'sunset', 'ocean', 'snow'];

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const rect = (x, y, w, h, fill, opacity) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${opacity ? ` opacity="${opacity}"` : ''}/>`;

/** One 16x16 block, speckled from its palette so it reads as texture. */
function block(col, row, palette, next) {
  const x = col * BLOCK;
  const y = row * BLOCK;
  let out = rect(x, y, BLOCK, BLOCK, palette[0]);

  for (let py = 0; py < BLOCK; py += 4) {
    for (let px = 0; px < BLOCK; px += 4) {
      const r = next();
      if (r > 0.62) out += rect(x + px, y + py, 4, 4, palette[r > 0.85 ? 2 : 1]);
    }
  }
  return out;
}

/**
 * Build a scene. `cols`/`rows` set the aspect; `surfaceAt` is where the ground
 * sits as a fraction of height (lower value = more ground visible).
 */
function build({ seed, palette, cols, rows, surfaceAt }) {
  const p = PALETTES[palette] || PALETTES.day;
  const next = rng(seed >>> 0 || 1);
  const W = cols * BLOCK;
  const H = rows * BLOCK;
  const gid = `sky${seed.toString(36)}`;
  let out = '';

  /* ---- sky ---- */
  out += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${p.sky[0]}"/>
    <stop offset="42%" stop-color="${p.sky[1]}"/>
    <stop offset="74%" stop-color="${p.sky[2]}"/>
    <stop offset="100%" stop-color="${p.sky[3]}"/>
  </linearGradient></defs>`;
  out += rect(0, 0, W, H, `url(#${gid})`);

  /* ---- sun: concentric squares, brightest in the middle ---- */
  const sx = Math.round(W * (0.2 + next() * 0.5));
  const sy = Math.round(H * 0.22);
  out += rect(sx - 48, sy - 48, 96, 96, p.glow, '0.16');
  out += rect(sx - 32, sy - 32, 64, 64, p.glow, '0.28');
  out += rect(sx - 20, sy - 20, 40, 40, p.sun, '0.8');
  out += rect(sx - 12, sy - 12, 24, 24, p.sun);

  /* ---- clouds: flat slabs, the way the game draws them ---- */
  const clouds = Math.max(3, Math.round(cols / 5));
  for (let i = 0; i < clouds; i++) {
    const cw = (2 + Math.floor(next() * 4)) * BLOCK;
    const cx = Math.floor(next() * Math.max(1, W - cw));
    const cy = Math.floor(next() * (H * 0.4));
    out += rect(cx, cy, cw, BLOCK, p.cloud, '0.45');
    if (next() > 0.45) out += rect(cx + BLOCK, cy - BLOCK, Math.max(BLOCK, cw - BLOCK * 2), BLOCK, p.cloud, '0.3');
  }

  /* ---- far ridge: a thin stepped silhouette on the horizon ---- */
  let ridge = Math.floor(rows * (surfaceAt - 0.12));
  for (let col = 0; col < cols; col++) {
    ridge += next() > 0.5 ? 1 : -1;
    ridge = Math.max(Math.floor(rows * (surfaceAt - 0.2)), Math.min(Math.floor(rows * (surfaceAt - 0.04)), ridge));
    out += rect(col * BLOCK, ridge * BLOCK, BLOCK, BLOCK * 2, p.ridge[0], '0.42');
    out += rect(col * BLOCK, (ridge + 2) * BLOCK, BLOCK, BLOCK * 2, p.ridge[1], '0.3');
  }

  /* ---- terrain ---- */
  const surface = [];
  let height = Math.floor(rows * surfaceAt);
  for (let col = 0; col < cols; col++) {
    if (next() > 0.72) height += next() > 0.5 ? 1 : -1;
    height = Math.max(Math.floor(rows * (surfaceAt - 0.08)), Math.min(rows - 2, height));
    surface.push(height);
  }

  for (let col = 0; col < cols; col++) {
    const top = surface[col];
    out += block(col, top, p.grass, next);
    for (let row = top + 1; row < rows; row++) {
      out += block(col, row, row - top <= 2 ? p.dirt : p.stone, next);
    }
  }

  /* ---- trees ---- */
  for (let col = 1; col < cols - 1; col++) {
    if (next() > 0.86) {
      const groundRow = surface[col];
      const trunk = 2 + Math.floor(next() * 2);
      const canopyTop = groundRow - trunk - 2;
      if (canopyTop < 1) continue;

      for (let t = 1; t <= trunk; t++) out += block(col, groundRow - t, p.trunk, next);
      for (let ry = canopyTop; ry < canopyTop + 2; ry++) {
        for (let rx = col - 1; rx <= col + 1; rx++) {
          if (rx >= 0 && rx < cols && ry >= 0) out += block(rx, ry, p.leaves, next);
        }
      }
      out += block(col, canopyTop - 1, p.leaves, next);
      col += 3;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `shape-rendering="crispEdges" preserveAspectRatio="xMidYMax slice">${out}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const cache = new Map();

function memo(key, make) {
  if (cache.has(key)) return cache.get(key);
  const value = make();
  cache.set(key, value);
  return value;
}

/** Wide banner behind the launch button. */
export function heroScene(palette = 'day', seed = 20260826) {
  return memo(`hero:${palette}:${seed}`, () =>
    build({ seed, palette, cols: 48, rows: 14, surfaceAt: 0.72 }));
}

/** Which biome a version is drawn in — stable, and varied across the grid. */
export function paletteForVersion(version = '') {
  return ROTATION[hash(String(version)) % ROTATION.length];
}

/** Portrait card art for the versions grid. */
export function versionPoster(version = '1.0', palette) {
  const chosen = palette || paletteForVersion(version);
  return memo(`poster:${chosen}:${version}`, () =>
    build({ seed: hash(version), palette: chosen, cols: 16, rows: 22, surfaceAt: 0.58 }));
}
