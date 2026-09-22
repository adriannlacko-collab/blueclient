/**
 * Block icons — the block a profile wears.
 *
 * Drawn as a block (2026-09-09, Adrian: "make new icons for the profiles which
 * actually look good and make sense"): an isometric cube with a lit top, a
 * mid left face and a shaded right face, cut from the game's own block
 * textures in `assets/mc/block/` — the same files the world behind the
 * launcher is built from, used on the same footing. Until that day the icons
 * were flat 16x16 squares of noise painted here, one per colour family, which
 * read as swatches rather than as anything from the game.
 *
 * The set is what a player names a profile after: a grass block for survival,
 * diamond for PvP, TNT for Bedwars, a crafting table for building, gold and
 * emerald for the rich, netherrack and end stone for the other two
 * dimensions. Every block a profile has ever been able to wear is still drawn
 * — the sixteen from before this date included — so no saved profile loses
 * its face; the picker shows one row of eight.
 *
 * The textures are loaded once at boot (`loadBlockIcons()`, awaited by app.js
 * before the first paint) and every icon is rendered once into a canvas and
 * kept as a data URI, so `blockIcon()` stays synchronous for the dozens of
 * places that put it straight into an `<img>`.
 */

const TEXTURES = 'assets/mc/block/';

/** Minecraft's plains grass tint; the grass textures are greyscale without it. */
const GRASS_TINT = '#91bd59';

/**
 * Faces: `all` for a block that is the same all round; else `top`, `side`,
 * and an optional `front` drawn on the left face (the one that faces the
 * viewer most). `tint` colours a greyscale texture; `overlay` is a tinted
 * transparency laid over the side, which is how the game draws grass.
 */
const BLOCKS = {
  grass:      { name: 'Grass block',    top: 'grass_block_top', tintTop: GRASS_TINT, side: 'grass_block_side', overlay: 'grass_block_side_overlay' },
  diamond:    { name: 'Diamond',        all: 'diamond_block' },
  tnt:        { name: 'TNT',            top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' },
  crafting:   { name: 'Crafting table', top: 'crafting_table_top', side: 'crafting_table_side', front: 'crafting_table_front' },
  emerald:    { name: 'Emerald',        all: 'emerald_block' },
  gold:       { name: 'Gold',           all: 'gold_block' },
  netherrack: { name: 'Netherrack',     all: 'netherrack' },
  endstone:   { name: 'End stone',      all: 'end_stone' },

  /* Still drawn for profiles that wear them; no longer offered. */
  stone:      { name: 'Stone',          all: 'stone' },
  deepslate:  { name: 'Deepslate',      top: 'deepslate_top', side: 'deepslate' },
  dirt:       { name: 'Dirt',           all: 'dirt' },
  planks:     { name: 'Oak planks',     all: 'oak_planks' },
  cobble:     { name: 'Cobblestone',    all: 'cobblestone' },
  sand:       { name: 'Sand',           all: 'sand' },
  obsidian:   { name: 'Obsidian',       all: 'obsidian' },
  amethyst:   { name: 'Amethyst',       all: 'amethyst_block' },
  ice:        { name: 'Ice',            all: 'ice' },
  copper:     { name: 'Copper',         all: 'copper_block' },
  iron:       { name: 'Iron',           all: 'iron_block' },
  redstone:   { name: 'Redstone',       all: 'redstone_block' },
  lapis:      { name: 'Lapis',          all: 'lapis_block' },
  bookshelf:  { name: 'Bookshelf',      top: 'oak_planks', side: 'bookshelf' },
  furnace:    { name: 'Furnace',        top: 'furnace_top', side: 'furnace_side', front: 'furnace_front' },
  bricks:     { name: 'Bricks',         all: 'bricks' },
  log:        { name: 'Oak log',        top: 'oak_log_top', side: 'oak_log' },
  hay:        { name: 'Hay bale',       top: 'hay_block_top', side: 'hay_block_side' }
};

export const BLOCK_IDS = Object.keys(BLOCKS);

/* What the profile editor offers: one row of eight (2026-09-08, Adrian:
   "reduce the amount of icons you can choose from in profiles from 2 rows to
   1 row"), each one a thing a profile gets named after. */
export const PICKER_IDS = ['grass', 'diamond', 'tnt', 'crafting', 'emerald', 'gold', 'netherrack', 'endstone'];

/** What each block is called, for the picker and for screen readers. */
export const BLOCK_NAMES = Object.fromEntries(BLOCK_IDS.map((id) => [id, BLOCKS[id].name]));

/* Deterministic hash, so a given profile always draws the same block. */
function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/* ------------------------------------------------------------ textures */

const images = new Map();
let loaded = null;

function textureNames() {
  const names = new Set();
  for (const spec of Object.values(BLOCKS)) {
    for (const key of ['all', 'top', 'side', 'front', 'bottom', 'overlay']) {
      if (spec[key]) names.add(spec[key]);
    }
  }
  return [...names];
}

function loadImage(name) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // A missing texture must not take the launcher down: the face is left
    // unpainted and the block still draws.
    img.onerror = () => resolve(null);
    img.src = new URL(`${TEXTURES}${name}.png`, document.baseURI).href;
  });
}

/** Fetch every texture the icons draw with. Awaited once, before the first paint. */
export function loadBlockIcons() {
  if (!loaded) {
    loaded = Promise.all(textureNames().map(async (name) => {
      images.set(name, await loadImage(name));
    })).then(() => { cache.clear(); });
  }
  return loaded;
}

/** A texture recoloured through a tint, the way the game colours grass. */
const tints = new Map();
function tinted(name, colour) {
  const key = `${name}|${colour}`;
  if (tints.has(key)) return tints.get(key);
  const source = images.get(name);
  if (!source) return null;

  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth || 16;
  canvas.height = source.naturalHeight || 16;
  /* Every canvas in this file is read back — into a data URI or a palette —
     so each is kept in ordinary memory: read from a canvas the graphics card
     holds, and the read waits for the card (2026-09-15; see tile() in
     world.js). This one is drawn into render()'s canvas, which is the same
     kind of read. */
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(source, 0, 0);
  tints.set(key, canvas);
  return canvas;
}

/* ------------------------------------------------------------- drawing */

/** The rendered size. Everything that shows an icon scales this down. */
const RENDER = 128;

/**
 * Draw one 16x16 texture onto a face of the cube.
 *
 * `origin` is the face's texture corner (0,0) on the canvas; `ex` and `ey`
 * are where one texel step goes along the texture's u and v. Set as the
 * canvas transform, the texture's own pixel grid becomes the parallelogram —
 * with smoothing off, so every texel stays a crisp lozenge.
 */
function face(ctx, texture, origin, ex, ey, shade, w, h) {
  if (!texture) return;
  const su = w / 16;
  const sv = h / 16;
  ctx.setTransform(ex[0] / su, ex[1] / su, ey[0] / sv, ey[1] / sv, origin[0], origin[1]);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(texture, 0, 0, w, h, 0, 0, w, h);
  if (shade > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${shade})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function render(id) {
  const spec = BLOCKS[id] || BLOCKS.grass;
  const canvas = document.createElement('canvas');
  canvas.width = RENDER;
  canvas.height = RENDER;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });   // toDataURL, see tinted()

  /* A cube in true isometric projection: the top is a rhombus 2·0.866u wide
     and u tall, the vertical edges are u, so the whole block is 1.732u by 2u.
     u = 52 leaves a margin in the 128 square on every side. */
  const u = 52;
  const cx = RENDER / 2;
  const cy = RENDER / 2;
  const hw = 0.866 * u;

  const T = [cx, cy - u];
  const R = [cx + hw, cy - u / 2];
  const B = [cx, cy];
  const L = [cx - hw, cy - u / 2];
  const B2 = [cx, cy + u];

  const step = (from, to) => [(to[0] - from[0]) / 16, (to[1] - from[1]) / 16];

  const tex = (key) => (spec[key] ? images.get(spec[key]) : null);
  const size = (img) => [img?.naturalWidth || img?.width || 16, img?.naturalHeight || img?.height || 16];

  // Top: lit.
  let top = tex('top') || tex('all');
  if (top && spec.tintTop) top = tinted(spec.top, spec.tintTop);
  const [tw, th] = size(top);
  face(ctx, top, T, step(T, R), step(T, L), 0, tw, th);

  // Left: the front where a block has one, else its side. Medium light.
  const left = tex('front') || tex('side') || tex('all');
  const [lw, lh] = size(left);
  face(ctx, left, L, step(L, B), step(B, B2), 0.2, lw, lh);
  if (spec.overlay) {
    const over = tinted(spec.overlay, GRASS_TINT);
    face(ctx, over, L, step(L, B), step(B, B2), 0.2, lw, lh);
  }

  // Right: the side, in shadow.
  const right = tex('side') || tex('all');
  const [rw, rh] = size(right);
  face(ctx, right, B, step(B, R), step(B, B2), 0.42, rw, rh);
  if (spec.overlay) {
    const over = tinted(spec.overlay, GRASS_TINT);
    face(ctx, over, B, step(B, R), step(B, B2), 0.42, rw, rh);
  }

  return canvas;
}

const cache = new Map();

/**
 * Data URI for a block icon. Cached — the same icon is drawn many times.
 * Rendered at 128px whatever `size` asks; the element scales it.
 */
export function blockIcon(id = 'grass', size = 48) {
  const key = BLOCKS[id] ? id : 'grass';
  if (cache.has(key)) return cache.get(key);
  if (!images.size) return '';   // before loadBlockIcons() — nothing to draw with yet
  const uri = render(key).toDataURL('image/png');
  cache.set(key, uri);
  return uri;
}

/**
 * The picker's eight blocks on one sheet, for something that draws many of
 * them a frame — the launch moment throws a hundred and twenty (2026-09-18).
 * Each is `render()`'s 128px cube in its own cell, left to right in
 * PICKER_IDS order. The sheet is an ordinary canvas, not a read-back one:
 * `render()` keeps its canvases in main memory so they can be read into data
 * URIs, and copying a hundred of those onto the card every frame is a hundred
 * uploads a frame. Copied here once, the sheet lives on the card and each
 * cube is a card-to-card draw. Null before `loadBlockIcons()` has resolved.
 */
let sheet = null;
export const SPRITE = 128;
export function blockSheet() {
  if (sheet) return sheet;
  if (!images.size) return null;
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE * PICKER_IDS.length;
  canvas.height = SPRITE;
  const ctx = canvas.getContext('2d');
  PICKER_IDS.forEach((id, i) => ctx.drawImage(render(id), i * SPRITE, 0));
  sheet = canvas;
  return sheet;
}

/* ------------------------------------------------------------- palette */

const palettes = new Map();

/**
 * The colours a block is made of, lightest first — read off its textures.
 *
 * The launch moment throws these: a grass profile throws greens and dirt
 * browns, a nether one throws reds. Every profile launches slightly
 * differently, which is the part that survives the hundredth press.
 */
export function blockPalette(id = 'grass') {
  const key = BLOCKS[id] ? id : 'grass';
  if (palettes.has(key)) return palettes.get(key);

  const spec = BLOCKS[key];
  const sources = [];
  const top = spec.tintTop && spec.top ? tinted(spec.top, spec.tintTop) : images.get(spec.top || spec.all);
  const side = images.get(spec.side || spec.all);
  if (top) sources.push(top);
  if (side && side !== top) sources.push(side);

  const colours = [];
  for (const source of sources) {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });   // getImageData, see tinted()
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    // Sixteen samples on a diagonal lattice: enough to catch the texture's
    // range without reading every texel.
    for (let i = 0; i < 16; i++) {
      const x = (i * 5 + 3) % 16;
      const y = (i * 3 + 2) % 16;
      const o = (y * 16 + x) * 4;
      if (data[o + 3] < 128) continue;
      colours.push([data[o], data[o + 1], data[o + 2]]);
    }
  }

  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const lum = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  const palette = colours.length
    ? [...new Set(colours.sort((a, b) => lum(b) - lum(a)).map(hex))]
    : ['#8eebff', '#22ccff', '#ffffff'];
  palettes.set(key, palette);
  return palette;
}

/** Stable block choice for things that have no icon set yet. */
export function blockForSeed(seed = '') {
  return PICKER_IDS[hash(String(seed)) % PICKER_IDS.length];
}

/**
 * The block a profile wears - the one it was given, or a stable one picked
 * for it. Seeded from the id rather than the name, so renaming a profile
 * does not silently change the block it has always shown.
 */
export function blockIdFor(profile) {
  if (profile && profile.icon && BLOCKS[profile.icon]) return profile.icon;
  return blockForSeed(String((profile && (profile.id || profile.name)) || ''));
}
