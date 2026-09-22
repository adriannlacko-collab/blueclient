/**
 * The launch moment (2026-09-18: the mark, built from blocks).
 *
 * Nothing darkens. Over the launcher as it stands, a hundred and twenty small
 * cubes of cyan glass gather from a hand's width around and become the B of
 * the mark, in the gap between the two columns, at about a third of the
 * window's height. They arrive in a wave that runs from the button's side up
 * and across the letter, each on a damped spring — a few percent past its
 * place and back — leaving a short ghost behind it while it moves, with a
 * soft cyan light breathing behind the letter. When the last cube lands the
 * whole mark takes a breath, and a fifth of a second later it pops: a soft
 * light expands from the letter with one thin ring — no white frame — and
 * every cube is a block from the game, thrown outward with drag, falling,
 * dissolving as it grows a little toward you. The Play button carries the
 * words: "Launching…" from the press, "Have fun" at the pop, crossfading
 * with a small slide. Three seconds.
 *
 * It replaced the rocket of 2026-09-09 after eight rounds of mockups in one
 * afternoon (journal, *The launch moment is the mark, built from blocks*):
 * the rocket was a pixel sprite and square confetti on a liquid-glass
 * launcher, standing in the gap with nothing tying it to the button. What
 * survived the rounds: blocks flowing in to build something, no stage, the
 * explosion into real blocks, and the motion rules of the last round —
 * springs not slides, an order of arrival, a settle, trails on anything fast,
 * light not flash, one clock.
 *
 * Kept from before, all of it: nothing here delays the launch (the install
 * is running before the first frame draws); pressing Play again starts it
 * over rather than stacking two; reduced motion skips it; any key or a press
 * anywhere ends it — a launcher is opened ten times a day, and the tenth
 * time a moment is a wait. The key that skips is spent on skipping (its
 * keydown and its keyup both, since Play keeps the focus after a click and
 * Space presses a focused button on the way up); a pointer press is not
 * swallowed, so a second press on Play restarts and a press elsewhere does
 * what it was aimed at; a held key's repeats do not count.
 *
 * The blocks are the picker's eight, from blocks.js's own sheet; the glass
 * cubes are drawn here, three flat faces in the game's three shades. The
 * mark is sampled on a grid, once: the B from the launcher's own type until
 * 2026-09-21 evening, and since then the bolt — the mark's own outline
 * (logo-mockups/vector-bolt.js, the shape Adrian chose that afternoon),
 * drawn at the size the letter had, so the cubes build what the corner and
 * the desktop now show.
 */

import { blockSheet, SPRITE, PICKER_IDS } from '../blocks.js';

/* ---------------------------------------------------------------- clock */

/* The fill runs from FILL_FROM; the wave and each cube's own spring put the
   last landing near 1.4 s. The pop follows the settle by POP_AFTER, and the
   blocks are gone FADE_TO after it. */
const FILL_FROM = 150;
const WAVE_MS = 620;
const FLY_MS = 560;
const POP_AFTER = 220;
const FADE_FROM = 500;
const FADE_TO = 1150;
const TAIL = 80;

/* The mark: sampled from a 400-space at this grid, drawn at this scale. */
const GRID = 20;
const SCALE = 0.5;
const CUBE = 17;
const CENTRE_Y = 380 / 814;

const GLASS = ['rgba(230, 250, 255, 0.92)', 'rgba(120, 225, 255, 0.90)', 'rgba(34, 204, 255, 0.90)'];

/* The shade over each of a glass cube's three faces, lit top to shadowed
   right — made once rather than as a new string for every face drawn. */
const SHADE = [1, 0.78, 0.6].map((shade) => `rgba(0, 0, 0, ${(1 - shade) * 0.9})`);

let active = null;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const phase = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** A damped spring: a few percent past the target once, then home. */
const spring = (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.2 * t) * (Math.cos(8.5 * t) + (6.2 / 8.5) * Math.sin(8.5 * t)));
/** The settle: one breath in and out, as a scale offset. */
const breath = (t) => (t <= 0 || t >= 1 ? 0 : Math.sin(t * Math.PI) * Math.exp(-2.2 * t));

/**
 * @param {{ name?: string }} spec — what is launching (unused now; the words are the button's).
 */
export function launchMoment({ name = '' } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  stop();

  const canvas = document.createElement('canvas');
  canvas.className = 'burst';
  document.body.append(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  // The backing store is in device pixels; the box has to be pinned to CSS
  // pixels or the element falls back to its intrinsic (backing) size.
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = w / 2;
  const cy = h * CENTRE_Y;
  const sheet = blockSheet();
  const words = buttonWords();

  const cubes = letter().map(([px, py]) => {
    const tx = cx + px * SCALE;
    const ty = cy + py * SCALE;
    // From a hand's width around its own place, in any direction.
    const a = Math.random() * Math.PI * 2;
    const d = 160 + Math.random() * 160;
    // The wave: the button is below and to the left, so the letter fills
    // from its lower left up and across.
    const delay = FILL_FROM + ((px + 200) / 400 * 0.55 + (200 - py) / 400 * 0.25) * WAVE_MS + Math.random() * 90;
    const shade = Math.random();
    return {
      tx, ty,
      fx: tx + Math.cos(a) * d,
      fy: ty + Math.sin(a) * d,
      delay,
      dur: FLY_MS + Math.random() * 90,
      s: CUBE * SCALE * (1 + Math.random() * 0.2),
      glass: GLASS[shade < 0.3 ? 0 : shade < 0.7 ? 1 : 2],
      block: -1,
      hist: [],
      x: tx, y: ty, vx: 0, vy: 0
    };
  });
  // Drawn top to bottom, so the overlaps read as one relief.
  cubes.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  const last = Math.max(...cubes.map((c) => c.delay + c.dur));
  const pop = last + POP_AFTER;
  const duration = pop + FADE_TO + TAIL;

  let popped = false;
  const start = performance.now();
  let previous = start;
  let frame = 0;

  function tick(now) {
    const t = now - start;
    if (t >= duration) { stop(); return; }
    // Per-frame physics stepped in sixtieths, whatever the refresh rate.
    const dt = Math.min(64, now - previous) / 16.7;
    previous = now;

    ctx.clearRect(0, 0, w, h);

    // The light behind the letter, brighter as it fills, breathing slowly.
    const fill = phase(t, 300, last);
    const glow = fill * (1 - phase(t, pop + 250, pop + 800)) * (0.85 + 0.15 * Math.sin(t / 420));
    light(ctx, cx, cy, 360, w, h, [[0, `rgba(34, 204, 255, ${0.32 * glow})`], [1, 'rgba(34, 204, 255, 0)']]);

    const settle = 1 + 0.03 * breath(phase(t, last, last + 520));

    if (!popped && t >= pop) {
      popped = true;
      words.classList.add('is-fun');
      for (const c of cubes) {
        c.block = (Math.random() * PICKER_IDS.length) | 0;
        c.x = c.tx; c.y = c.ty;
        c.s *= 1.5;
        const a = Math.atan2(c.ty - cy, c.tx - cx) + (Math.random() - 0.5) * 0.5;
        const sp = 4 + Math.random() * 7;
        c.vx = Math.cos(a) * sp;
        c.vy = Math.sin(a) * sp - 2.5;
        c.hist.length = 0;
      }
    }

    for (const c of cubes) {
      let x, y, alpha = 1, size = c.s;
      if (popped) {
        const age = t - pop;
        // Thrown, then drag and a little gravity.
        c.vy += 0.05 * dt;
        c.vx *= Math.pow(0.955, dt);
        c.vy *= Math.pow(0.955, dt);
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        x = c.x; y = c.y;
        const fade = phase(age, FADE_FROM, FADE_TO);
        alpha = 1 - fade;
        size = c.s * (1 + 0.2 * fade);
        if (alpha <= 0.003) continue;
      } else {
        const k = phase(t, c.delay, c.delay + c.dur);
        if (k <= 0) continue;
        const e = spring(k);
        x = lerp(c.fx, c.tx, e);
        y = lerp(c.fy, c.ty, e);
        alpha = clamp01(k * 2);
        x = cx + (x - cx) * settle;
        y = cy + (y - cy) * settle;
      }

      // The trail: a short ghost behind anything moving fast. The last four
      // places, x and y in turn, kept in one array per cube and rolled.
      const hist = c.hist;
      if (hist.length === 8) hist.copyWithin(0, 2);
      else hist.length += 2;
      hist[hist.length - 2] = x;
      hist[hist.length - 1] = y;
      const kept = hist.length / 2;
      if (kept > 2 && Math.hypot(x - hist[0], y - hist[1]) > 6) {
        for (let i = 0; i < kept - 1; i++) {
          drawCube(ctx, sheet, c, hist[i * 2], hist[i * 2 + 1], size, alpha * 0.09 * (i + 1) / kept);
        }
      }
      drawCube(ctx, sheet, c, x, y, size, alpha);
    }

    // The pop's light and ring: soft, from the letter, no white frame.
    const pk = phase(t, pop, pop + 90) * (1 - easeOut(phase(t, pop + 90, pop + 650)));
    if (pk > 0.002) {
      light(ctx, cx, cy, 140 + easeOutQuint(phase(t, pop, pop + 650)) * 620, w, h,
        [[0, `rgba(235, 250, 255, ${0.5 * pk})`], [0.35, `rgba(34, 204, 255, ${0.35 * pk})`], [1, 'rgba(34, 204, 255, 0)']]);
    }
    ring(ctx, cx, cy, phase(t, pop + 40, pop + 800), w, h);

    frame = requestAnimationFrame(tick);
  }

  /* The skip. Capture phase on the window, so it hears the key or the press
     before anything on the page does, whatever has the focus. */
  const skip = (event) => {
    if (event.type === 'keydown') {
      if (event.repeat) return;
      event.preventDefault();
      // The matching keyup would otherwise press whatever has the focus —
      // Play, after a click — so it is spent too, once.
      window.addEventListener('keyup', (up) => up.preventDefault(), { capture: true, once: true });
    }
    stop();
  };
  window.addEventListener('keydown', skip, true);
  window.addEventListener('pointerdown', skip, true);

  frame = requestAnimationFrame(tick);
  active = { canvas, words, skip, cancel: () => cancelAnimationFrame(frame) };
}

/* ------------------------------------------------------------- drawing */

/** A glass cube (three flat faces) before the pop; a block off the sheet after. */
function drawCube(ctx, sheet, c, x, y, s, alpha) {
  if (alpha <= 0.003) return;
  if (c.block >= 0) {
    if (!sheet) return;
    // The sheet's cube is 1.732u by 2u in a 128 square with u = 52, centred
    // on its middle vertex; the glass cube's (x, y) is its top vertex, one
    // unit above that. Drawn with the unit matched and the centres aligned.
    const scale = s / 52;
    const box = SPRITE * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sheet, c.block * SPRITE, 0, SPRITE, SPRITE, x - box / 2, y + s - box / 2, box, box);
    ctx.globalAlpha = 1;
    return;
  }
  const w = s * 0.866;
  const hh = s * 0.5;
  glassFace(ctx, c.glass, alpha, w, hh, -w, hh, x, y, SHADE[0]);            // top, lit
  glassFace(ctx, c.glass, alpha, w, hh, 0, s, x - w, y + hh, SHADE[1]);     // left
  glassFace(ctx, c.glass, alpha, w, -hh, 0, s, x, y + 2 * hh, SHADE[2]);    // right, in shadow
}

/* One face of a glass cube: the unit square carried onto the face by the
   transform, its glass, then its shade over it. */
function glassFace(ctx, glass, alpha, a, b, cc, d, e, f, shade) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.transform(a, b, cc, d, e, f);
  ctx.fillStyle = glass;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1, 1);
  ctx.restore();
}

function light(ctx, x, y, r, w, h, stops) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [k, colour] of stops) g.addColorStop(k, colour);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = g;
  fillAround(ctx, x, y, r, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

/* Fill only the square round a radial light, not the whole window
   (2026-09-22). Past its radius every light here is its last stop, which is
   always fully transparent, and screening nothing over the canvas leaves it
   as it was — so the pixels are the same, and the two or three full-window
   gradient fills a frame the moment used to make become as small as the
   light is. */
function fillAround(ctx, x, y, r, w, h) {
  const x0 = Math.max(0, Math.floor(x - r)), y0 = Math.max(0, Math.floor(y - r));
  const x1 = Math.min(w, Math.ceil(x + r)), y1 = Math.min(h, Math.ceil(y + r));
  if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** One thin ring rolling out from the letter — the glass's specular, moving. */
function ring(ctx, x, y, p, w, h) {
  if (p <= 0 || p >= 1) return;
  const r = 20 + easeOutQuint(p) * 720;
  const R = r + 60;
  const s = 0.8 * (1 - p) * (1 - p);
  const g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(Math.max(0, (r - 24) / R), 'rgba(34, 204, 255, 0)');
  g.addColorStop(Math.max(0, (r - 2) / R), `rgba(200, 244, 255, ${s * 0.6})`);
  g.addColorStop(r / R, `rgba(255, 255, 255, ${s})`);
  g.addColorStop(Math.min(1, (r + 24) / R), 'rgba(34, 204, 255, 0)');
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = g;
  fillAround(ctx, x, y, R, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------------------------------------------------- the letter */

let points = null;

/* The bolt's outline in the mark's own 512-space (vector-bolt.js prints it:
   eight corners, arcs of 3 and 4 at each), point-symmetric about (256,256).
   The B it replaced was drawn from the launcher's type at 330px — a letter
   about 240 tall and fat, some 120 cubes; a bolt is slim, so it is drawn
   taller (280 in its space × BOLT_SCALE = 350 of the 400) to carry a
   comparable weight — about 80 cubes, a mark 175px tall on screen. */
const BOLT = 'M278.8 117.38 A4 4 0 0 1 281.83 116 L300.81 116 A4 4 0 0 1 304.68 121.02 L276.99 226.24 A3 3 0 0 0 279.89 230 L367.23 230 A4 4 0 0 1 370.26 236.62 L233.2 394.62 A4 4 0 0 1 230.17 396 L211.19 396 A4 4 0 0 1 207.32 390.98 L235.01 285.76 A3 3 0 0 0 232.11 282 L144.77 282 A4 4 0 0 1 141.74 275.38 Z';
const BOLT_SCALE = 1.25;

/**
 * The mark on a grid: the bolt drawn once into a 400-space and sampled every
 * GRID pixels, as offsets from its centre. Read back once and kept.
 */
function letter() {
  if (points) return points;
  const size = 400;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.translate(size / 2, size / 2);
  g.scale(BOLT_SCALE, BOLT_SCALE);
  g.translate(-256, -256);
  g.fill(new Path2D(BOLT));
  g.setTransform(1, 0, 0, 1, 0, 0);
  const data = g.getImageData(0, 0, size, size).data;
  const out = [];
  for (let y = 8; y < size; y += GRID) {
    for (let x = 8; x < size; x += GRID) {
      if (data[(y * size + x) * 4 + 3] > 120) out.push([x - size / 2, y - size / 2]);
    }
  }
  points = out;
  return out;
}

/* ------------------------------------------------------------ the words */

/**
 * The button's words, on a capsule laid exactly over Play and drawn from the
 * button's own tokens, so it is the button for the moment's length: it says
 * "Launching…" from the press and "Have fun" at the pop, the two crossfading
 * with a small slide. Play itself says "Launch another" underneath by then, as
 * it does whenever a game is up; that is what shows again when this goes.
 */
function buttonWords() {
  const node = document.createElement('div');
  node.className = 'burst-words';
  node.setAttribute('aria-hidden', 'true');
  const launch = document.querySelector('.launch');
  if (launch) {
    const r = launch.getBoundingClientRect();
    node.style.left = `${r.left}px`;
    node.style.top = `${r.top}px`;
    node.style.width = `${r.width}px`;
    node.style.height = `${r.height}px`;
  } else {
    node.hidden = true;
  }
  const a = document.createElement('span');
  a.className = 'burst-words__a';
  a.textContent = 'Launching…';
  const b = document.createElement('span');
  b.className = 'burst-words__b';
  b.textContent = 'Have fun';
  node.append(a, b);
  document.body.append(node);
  return node;
}

/**
 * End the moment now: the frame loop cancelled, the canvas and the words
 * gone, the skip listeners off. Called when the last block has faded, when a
 * key or a press skips it, and first thing by a second Play press starting
 * it over.
 */
export function stop() {
  if (!active) return;
  active.cancel();
  window.removeEventListener('keydown', active.skip, true);
  window.removeEventListener('pointerdown', active.skip, true);
  active.canvas.remove();
  active.words.remove();
  active = null;
}
