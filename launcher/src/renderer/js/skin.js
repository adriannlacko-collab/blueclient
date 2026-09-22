/**
 * Skin lookups, fetched once per account.
 *
 * Both the player model and the account button want the same texture, and the
 * fetch goes through the main process, so the promise is shared rather than
 * requested twice.
 */

import { host } from './bridge.js';

const cache = new Map();

/**
 * Forget one name, so the next ask goes back to Mojang.
 *
 * Used when the player changes their own skin: both this cache and the one in
 * main are keyed on the name, and neither would otherwise notice.
 */
export function forgetSkin(username) {
  cache.delete(String(username || ''));
}

/**
 * The skin a name wears from now on, put straight into the cache (2026-09-21).
 *
 * Wearing a skin used to *forget* the name here and in main, so the next
 * Home — the next page switch — asked Mojang again and drew Steve for the
 * half-second the answer took (Adrian: "a steve skin is shown a short
 * second before the real skin loads in"); and Mojang, which holds a profile
 * for a minute, could answer with the skin just taken off. The file the
 * player wore is the answer, so it is remembered as one.
 */
export function rememberSkin(username, skin) {
  if (!skin?.dataUri) return;
  cache.set(String(username || ''), Promise.resolve({ ok: true, ...skin }));
}

export function getSkin(username) {
  const key = String(username || '');
  if (!cache.has(key)) cache.set(key, host.skins.get(key).then(vet));
  return cache.get(key);
}

/**
 * Mojang validates a skin's dimensions but not its content, so a name can
 * resolve to a texture that is mostly transparent — which renders as a
 * near-invisible model with the slab artwork showing through it. A real skin
 * always has a fully opaque head, so that cell is the litmus test: too little
 * coverage and the texture is discarded in favour of the bundled Steve.
 */
async function vet(skin) {
  if (!skin?.ok || !skin.dataUri) return skin;
  try {
    if (await headCoverage(skin.dataUri) >= 0.7) return skin;
  } catch { /* undecodable is just as broken */ }
  return { ok: false };
}

/** Fraction of the head-front cell that is opaque, sampled at 64x64. */
function headCoverage(dataUri) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SHEET;
      canvas.height = SHEET;
      // Read back once, so kept in ordinary memory (see tile() in world.js).
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;   // HD sheets shrink without haze
      ctx.drawImage(img, 0, 0, SHEET, SHEET);
      const alpha = ctx.getImageData(CELL, CELL, CELL, CELL).data;
      let opaque = 0;
      for (let i = 3; i < alpha.length; i += 4) if (alpha[i] > 16) opaque++;
      resolve(opaque / (CELL * CELL));
    };
    img.onerror = reject;
    img.src = dataUri;
  });
}

/* A head is the 8x8 cell at (8,8) on the sheet, with the hat layer at (40,8)
   drawn over it. */
const CELL = 8;
const SHEET = 64;

/**
 * Percentage background-position is not an offset — it lines the same point up
 * on both image and box, so the travel available is (box - image), here
 * -(SHEET/CELL - 1) box widths. A texel therefore sits at u / (SHEET - CELL)
 * percent, not at -u/CELL * 100%.
 */
const cell = (u) => `${((u / (SHEET - CELL)) * 100).toFixed(4)}%`;

/** Paint an element as the head from a skin sheet. */
export function paintHead(node, dataUri) {
  if (!node || !dataUri) return;
  const url = `url("${dataUri}")`;
  node.style.backgroundImage = `${url}, ${url}`;   // hat first, then the face
  node.style.backgroundPosition = `${cell(40)} ${cell(8)}, ${cell(8)} ${cell(8)}`;
  node.style.backgroundSize = `${(SHEET / CELL) * 100}% ${(SHEET / CELL) * 100}%`;
  node.style.backgroundRepeat = 'no-repeat';
}

/** Convenience: look the account up and paint its head when it lands. */
export async function paintAccountHead(node, username) {
  const skin = await getSkin(username);
  if (skin?.ok && node?.isConnected) paintHead(node, skin.dataUri);
  return skin;
}

/* ---------------------------------------------------------- flat figure */

/**
 * A skin drawn flat, face on, the way a skin site shows one.
 *
 * The browse grid puts two dozen skins on screen at once and the real model
 * (`ui/character.js`) is seventy-two 3D boxes each — so the grid gets this
 * instead: one canvas, twelve `drawImage` calls, no layout and no transform.
 * The model is still what a slot shows, because there you are looking at one
 * skin and want to turn it.
 *
 * Units are skin pixels: 16 across (arms, body, arms) by 32 down, the same
 * geometry `ui/character.js` builds its boxes from — the front face of every
 * part, plus the second layer over it.
 */
const FRONT = [
  { u: 8, v: 8, w: 8, h: 8, x: 4, y: 0, over: [40, 8], head: true },
  { u: 20, v: 20, w: 8, h: 12, x: 4, y: 8, over: [20, 36] },      // body
  { u: 44, v: 20, w: 4, h: 12, x: 0, y: 8, over: [44, 36], arm: 'right' },
  { u: 36, v: 52, w: 4, h: 12, x: 12, y: 8, over: [52, 52], arm: 'left', new: true },
  { u: 4, v: 20, w: 4, h: 12, x: 4, y: 20, over: [4, 36] },       // right leg
  { u: 20, v: 52, w: 4, h: 12, x: 8, y: 20, over: [4, 52], new: true }
];

/**
 * How big a flat skin is drawn, so that every skin pixel is a whole number of
 * DEVICE pixels (2026-09-10, evening).
 *
 * It used to be drawn at eight CSS px per skin pixel and scaled to whatever
 * column the grid gave it — 128 canvas pixels into about 104 — and a
 * pixelated downscale drops columns to get there, so one skin pixel came
 * out six wide and the next seven: Dream's outline was visibly thicker down
 * one side than the other. `size` is the intended CSS px per skin pixel; it
 * is rounded to whole device pixels at the current zoom, and the canvas is
 * given exactly that size in CSS px, so nothing is resampled on the way to
 * the screen. (The window zooms the renderer — see main.js fitZoom — which
 * is why the device ratio is read rather than assumed.)
 *
 * @param {number} size CSS px per skin pixel, roughly
 * @returns {{ S: number, width: number, height: number }} device px per skin px, and the CSS size
 */
export function flatSize(size) {
  const dpr = window.devicePixelRatio || 1;
  const S = Math.max(1, Math.round(size * dpr));
  return { S, width: (16 * S) / dpr, height: (32 * S) / dpr };
}

/**
 * @param {{dataUri: string, slim?: boolean}} skin
 * @param {{size?: number}} opts CSS px per skin pixel, see flatSize
 * @returns {HTMLCanvasElement} empty until the sheet decodes, then drawn
 */
export function frontView(skin, { size = 5 } = {}) {
  const { S, width, height } = flatSize(size);
  const canvas = document.createElement('canvas');
  canvas.className = 'skin-flat';
  canvas.width = 16 * S;
  canvas.height = 32 * S;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const image = new Image();
  image.onload = () => paintFront(canvas, image, skin, S);
  image.src = skin?.dataUri || '';
  return canvas;
}

function paintFront(canvas, image, { slim = false } = {}, px) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;          // an HD sheet shrinks without haze

  /* An HD skin is the same layout at 2x or 4x, so every coordinate below is
     multiplied rather than special-cased. A pre-1.8 sheet is half as tall and
     carries no left arm, no left leg and no layer but the hat — those are the
     right-hand ones, mirrored, which is what the game itself did. */
  const k = (image.naturalWidth || 64) / 64;
  const legacy = image.naturalHeight * 2 <= image.naturalWidth;
  const arm = slim ? 3 : 4;

  const cut = (u, v, w, h, x, y, flip) => {
    ctx.save();
    if (flip) {
      ctx.translate((2 * x + w) * px, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(image, u * k, v * k, w * k, h * k, x * px, y * px, w * px, h * px);
    ctx.restore();
  };

  for (const part of FRONT) {
    // The arms narrow on the slim model, and the left one keeps its right edge
    // against the body rather than its left edge where the wide one sat.
    const w = part.arm ? arm : part.w;
    const x = part.arm === 'right' ? 4 - w : part.x;
    const mirror = legacy && part.new;
    const from = mirror ? mirrorOf(part) : part;

    cut(from.u, from.v, w, part.h, x, part.y, mirror);
    if (legacy && !part.head) continue;       // only the hat exists on a 64x32
    const [ou, ov] = mirror ? mirrorOf(part).over : part.over;
    cut(ou, ov, w, part.h, x, part.y, mirror);
  }
}

/** The right-hand twin of a part that a 64x32 sheet does not carry. */
function mirrorOf(part) {
  return part.arm === 'left'
    ? { u: 44, v: 20, over: [44, 36] }
    : { u: 4, v: 20, over: [4, 36] };
}
