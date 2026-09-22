/**
 * The words for the play record — shared by Your play on Home and the Stats
 * page behind it (2026-09-12, evening), so a level, a milestone or a
 * duration is spelled one way wherever it appears.
 *
 * The figures come from `src/main/ledger.js`; everything here is how they
 * are said. Nothing in this file measures anything.
 */

import { icons } from './icons.js';
import { toast } from './ui/toast.js';
import { gameStatus } from './state.js';

const HOUR = 3600000;

/** The ledger's track order, which is the order the medals are listed in. */
const ORDER = ['hours', 'days', 'streak', 'mobs', 'players', 'distance'];

/**
 * "12h 40m", "48m", "under a minute". The launcher has no other duration
 * format.
 *
 * The unit sits against its number rather than a space away (Adrian,
 * 2026-09-09, evening: "make it for example 384h 50m instead of 384 h 50 m").
 * Two numbers with spaces on both sides of both units read as four things;
 * closed up, "384h 50m" reads as one figure with two parts, which is what it
 * is — and the big number on Your play is a figure before it is a sentence.
 */
export function spell(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "427h" — the hours alone, for a figure that has no room for minutes. */
export const hours = (ms) => `${Math.floor(ms / HOUR).toLocaleString()}h`;

/** The game turns its centimetres into metres, or kilometres past a thousand of them. */
export const distance = (cm) => (cm >= 100000
  ? `${(cm / 100000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`
  : `${Math.round(cm / 100).toLocaleString()} m`);

export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * The six milestone tracks, in words. `step` names a step ("250 hours",
 * "7 day streak"), `toGo` says how far the next one is, `figure` is the
 * running total as a short figure. The steps themselves — and which are
 * earned — come from the ledger; see TRACKS in src/main/ledger.js.
 */
export const TRACKS = {
  hours: {
    name: 'Hours played',
    icon: icons.clock,
    step: (ms) => plural(ms / HOUR, 'hour'),
    toGo: (ms) => `${spell(ms)} to go`,
    figure: (ms) => hours(ms)
  },
  days: {
    name: 'Days played',
    icon: icons.calendar,
    step: (n) => `${plural(n, 'day')} played`,
    toGo: (n) => plural(n, 'more day'),
    figure: (n) => n.toLocaleString()
  },
  streak: {
    name: 'Streak',
    icon: icons.flame,
    step: (n) => `${n} day streak`,
    toGo: (n) => `${plural(n, 'more day')} in a row`,
    figure: (n) => n.toLocaleString()
  },
  mobs: {
    name: 'Mobs killed',
    icon: icons.skull,
    step: (n) => `${plural(n, 'mob')} killed`,
    toGo: (n) => `${n.toLocaleString()} to go`,
    figure: (n) => n.toLocaleString()
  },
  players: {
    name: 'Players killed',
    icon: icons.sword,
    step: (n) => `${plural(n, 'player')} killed`,
    toGo: (n) => `${n.toLocaleString()} to go`,
    figure: (n) => n.toLocaleString()
  },
  distance: {
    name: 'Distance',
    icon: icons.compass,
    step: (cm) => `${distance(cm)} travelled`,
    toGo: (cm) => `${distance(cm)} to go`,
    figure: (cm) => distance(cm)
  }
};

/** "13h 6m to Level 43" */
export const levelLine = (level) => `${spell(level.next)} to Level ${level.level + 1}`;

/* ----------------------------------------------------------------- capes */

/**
 * The two capes a level earns (2026-09-13; Aurora, the middle one at level
 * 25, was taken out on 2026-09-14), in the order they are earned
 * — the same list as `capes.Capes` in the mod and `CAPES` in
 * scripts/make-capes.mjs, which paints them. Every cape moves: thirty
 * pictures, a six-second loop, the frame on screen picked off the wall clock
 * here and in the game alike (`capeFrameNow`), so it moves the same on the
 * Home model, on Stats and on the player. Signature is a finished picture
 * under assets/art/capes/signature/NN.png; Yours is thirty RECIPES cooked
 * in the player's own colours (`cookCape`, the same formula as `cook` in
 * make-capes.mjs and `Capes.cook` in the mod).
 */
export const CAPES = [
  { id: 'signature', level: 3, name: 'Signature', about: 'The logo as a cape' },
  { id: 'yours', level: 100, name: 'Yours', about: 'Your own colours' }
];

export const CAPE_FRAMES = 30;
export const CAPE_FRAME_MS = 200;
/* The sheet the painter writes: 64x32 at six pixels a unit, the outer face
   at (1,1) 10x16, the wings in the right half since 2026-09-22, and a
   recipe's stars in the spare corner past them at (47,1). */
const SHEET_W = 384;
const SHEET_H = 192;
const FACE = { x: 6, y: 6, w: 60, h: 96 };
const STARS_X = 47 * 6;

export const capeFrameUrl = (id, n) => `assets/art/capes/${id}/${String(n).padStart(2, '0')}.png`;

/** Yours' colours as first suggested, and the starting points Stats offers. */
export const CAPE_COLOURS = { top: '#7c5cff', bottom: '#f9a8d4', spark: '#ffffff', letter: true };
export const CAPE_STARTS = [
  ['#7c5cff', '#f9a8d4', '#ffffff'],
  ['#0f1b3d', '#ff6b5a', '#ffd9a8'],
  ['#00c7ff', '#8eebff', '#ffffff'],
  ['#8a1030', '#ff8a5c', '#ffe0c8'],
  ['#10b981', '#a7f3d0', '#ffffff'],
  ['#111318', '#4b5563', '#e5e7eb'],
  ['#1e3a8a', '#22d3ee', '#cffafe'],
  ['#f59e0b', '#fde68a', '#ffffff']
];

const HEX = /^#[0-9a-f]{6}$/i;

/** The colours a settings tree carries, made safe: every field a colour, or the first suggestion. */
export function capeColours(play) {
  const c = play?.colours || {};
  const pick = (key) => (HEX.test(c[key] || '') ? c[key].toLowerCase() : CAPE_COLOURS[key]);
  return { top: pick('top'), bottom: pick('bottom'), spark: pick('spark'), letter: c.letter !== false };
}

/** The word the game and the backend know a worn cape by: its id, or Yours with its colours. */
export const capeWord = (cape, colours) => (cape.id === 'yours'
  ? `yours:${colours.top.slice(1)}-${colours.bottom.slice(1)}-${colours.spark.slice(1)}-${colours.letter ? 1 : 0}`
  : cape.id);

export const capeById = (id) => CAPES.find((cape) => cape.id === id) || null;

/** The best cape a level has earned, or null. */
export function capeEarned(level) {
  let best = null;
  for (const cape of CAPES) if (cape.level <= level) best = cape;
  return best;
}

/**
 * The cape worn, given the level and the player's choice — the same rule
 * the mod applies to the flag the launcher stamps: a chosen cape if it is
 * earned, the best earned when nothing is chosen, nothing for "none".
 */
export function capeWorn(level, choice) {
  if (choice === 'none') return null;
  const chosen = capeById(choice);
  const best = capeEarned(level);
  if (chosen && best && chosen.level <= best.level) return chosen;
  return best;
}

/* --- the clock every cape on screen runs on --- */

/** The frame on screen now — the same one the game shows. */
export const capeFrameNow = () => Math.floor(Date.now() / CAPE_FRAME_MS) % CAPE_FRAMES;

const faces = new Set();      // the face canvases alive, repainted on every frame
const boxes = new Set();      // the Home model's cape boxes alive, handed every frame
let clock = 0;
let lastFrame = -1;

/* One interval for every cape on the page: each face canvas is repainted,
   and each cape box on a model is handed the frame number as --cape-frame,
   which its six faces read. On the box, never on the root (2026-09-15): a
   custom property changed on <html> is inherited by every element, so the
   whole document's style was recalculated five times a second — 16 to 29 ms
   each, measured, and the hitch on every page; Adrian felt it on Clips. On
   the box it is seven elements. A canvas or box that has left the page is
   let go, and the clock stops when nothing is left for it to drive.

   And it stands down while the game has the screen (2026-09-20, stopped
   outright since 2026-09-22): the same
   rule the world keeps (app.js, paceWorld) — hidden, or a game playing and
   this window not the one in front — so a launcher left open beside a
   windowed game is not repainting capes and recompositing its glass five
   times a second on the card the game is drawing with. The frame catches
   up the moment the launcher is looked at again. */
/** Hidden, or a game playing and this window not the one in front. */
function resting() {
  return document.hidden || (gameStatus() === 'playing' && !document.hasFocus());
}

/* While it is resting the clock is STOPPED, not merely quiet (2026-09-22).
   Returning early from the tick still woke the page twenty times a second
   for the whole of a four-hour session — enough to keep the renderer out of
   the idle state it should be in behind a game. It is started again the
   moment the launcher is looked at, which is the only moment a cape can be
   seen. */
/* Guarded because this file is imported under plain node by
   tools/check-ledger-repair.js, which fakes a document and no window: a module
   that reaches for the browser as it loads is a module that cannot be proved. */
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('focus', () => { if (faces.size || boxes.size) startClock(); });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => { if (faces.size || boxes.size) startClock(); });
}

function startClock() {
  if (clock || resting()) return;
  clock = setInterval(() => {
    if (resting()) { clearInterval(clock); clock = 0; return; }
    const n = capeFrameNow();
    if (n === lastFrame) return;
    lastFrame = n;
    const now = Date.now();
    for (const face of faces) {
      if (!face.isConnected && now - face.born > 5000) { faces.delete(face); continue; }
      face.paint(n);
    }
    for (const box of boxes) {
      if (!box.isConnected && now - box.born > 5000) { boxes.delete(box); continue; }
      box.style.setProperty('--cape-frame', n);
    }
    if (!faces.size && !boxes.size) { clearInterval(clock); clock = 0; lastFrame = -1; }
  }, 50);
}

/** A model's cape box, handed to the clock: it shows the frame on screen now. */
function drive(box) {
  box.born = Date.now();
  box.style.setProperty('--cape-frame', capeFrameNow());
  boxes.add(box);
  startClock();
}

/* --- the pictures --- */

/* A picture that failed is not kept (2026-09-22): every cache below held
   the promise, rejection and all, so one frame that did not load the first
   time left that cape blank — and every set cooked from it — until the
   launcher was restarted. What failed is dropped and asked for again by
   the next look; what loaded is kept as before. */
function keep(map, key, job) {
  map.set(key, job);
  job.catch(() => { if (map.get(key) === job) map.delete(key); });
  return job;
}

const images = new Map();     // url -> Promise<Image>
function loadImage(url) {
  if (!images.has(url)) {
    keep(images, url, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`${url} did not load`));
      img.src = url;
    }));
  }
  return images.get(url);
}

const sheets = new Map();     // id -> Promise<Image[]>, the thirty frames
function frames(id) {
  if (!sheets.has(id)) keep(sheets, id, Promise.all(Array.from({ length: CAPE_FRAMES }, (_, n) => loadImage(capeFrameUrl(id, n)))));
  return sheets.get(id);
}

/** A sheet's pixels, read once. */
const pixels = new Map();     // url -> Promise<Uint8ClampedArray>
function readPixels(url) {
  if (!pixels.has(url)) {
    keep(pixels, url, loadImage(url).then((img) => {
      const canvas = document.createElement('canvas');
      canvas.width = SHEET_W;
      canvas.height = SHEET_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, SHEET_W, SHEET_H).data;
    }));
  }
  return pixels.get(url);
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * The one formula (see make-capes.mjs, `cook`): the two colours mixed by
 * red, darkened by green, lit by blue, the star screened on in the third
 * colour, and the letter's three bands if it is kept. Channels 0..255,
 * colours 0..1; returns 0..255.
 */
function cookPixel(out, o, r, g, b, star, shadow, lit, main, top, bottom, spark, letter) {
  const t = r / 255;
  const shade = g / 200;
  const light = b / 255;
  const s = star / 255;
  for (let ch = 0; ch < 3; ch++) {
    let v = (top[ch] + (bottom[ch] - top[ch]) * t) * shade;
    v = v + (1 - v) * light;
    v = 1 - (1 - v) * (1 - spark[ch] * s);
    if (letter) {
      v *= 1 - 0.28 * (shadow / 255);
      v += (1 - v) * 0.16 * (lit / 255);
      v += (1 - v) * 0.10 * (main / 255);
    }
    out[o + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  out[o + 3] = 255;
}

/**
 * Yours in these colours: the thirty sheets, or the thirty outer faces alone
 * (what a tile shows), cooked once per set of colours and kept.
 */
const cooked = new Map();     // word + '/face' or '/sheet' -> Promise<HTMLCanvasElement[]>

/**
 * How many sets of colours are kept cooked (2026-09-22).
 *
 * One set is thirty canvases — thirty 384x192 sheets is nearly nine megabytes
 * of pixels, and a strip on top of that is another nine and a PNG blob — and
 * the colour picker on Cosmetics makes a NEW set on every move of the pointer
 * that lands: dragging a hue for ten seconds walked through a hundred sets
 * and kept every one of them, canvases, strips and blob URLs alike, for the
 * launcher's life. Four is the picker's own history (the colour being
 * dragged, the two before it and the one worn) and the mod keeps eight for
 * the same reason. Evicting a strip revokes its URL; evicting a cooked set
 * only drops the reference, which is all the canvases need.
 */
const COOKED_KEPT = 4;

/** Keep only the newest `limit` entries of an insertion-ordered Map. */
function trim(map, limit, letGo) {
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    const value = map.get(oldest);
    map.delete(oldest);
    if (letGo) letGo(value);
  }
}
export function cookCape(colours, faceOnly = true) {
  const word = capeWord(capeById('yours'), colours);
  const key = `${word}/${faceOnly ? 'face' : 'sheet'}`;
  if (cooked.has(key)) return cooked.get(key);
  const job = (async () => {
    const letter = await readPixels('assets/art/capes/yours/b.png');
    const top = hexRgb(colours.top);
    const bottom = hexRgb(colours.bottom);
    const spark = hexRgb(colours.spark);
    const out = [];
    for (let n = 0; n < CAPE_FRAMES; n++) {
      const rec = await readPixels(capeFrameUrl('yours', n));
      const canvas = document.createElement('canvas');
      const w = faceOnly ? FACE.w : SHEET_W;
      const h = faceOnly ? FACE.h : SHEET_H;
      canvas.width = w;
      canvas.height = h;
      /* Pixels put in, and read out again into the strip and the tiles: a
         canvas the CPU holds, or the first read waits on the graphics card
         (see tile() in world.js, 2026-09-15). */
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const image = ctx.createImageData(w, h);
      const data = image.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = faceOnly ? x + FACE.x : x;
          const sy = faceOnly ? y + FACE.y : y;
          const o = (y * w + x) * 4;
          /* Nothing hangs beyond the cape's own 22x17 units of the sheet. */
          if (sx >= 132 || sy >= 102) { data[o + 3] = 0; continue; }
          const i = (sy * SHEET_W + sx) * 4;
          const face = sx >= FACE.x && sx < FACE.x + FACE.w && sy >= FACE.y && sy < FACE.y + FACE.h;
          const star = face ? rec[(sy * SHEET_W + (sx - FACE.x + STARS_X)) * 4] : 0;
          cookPixel(data, o, rec[i], rec[i + 1], rec[i + 2], star,
            face ? letter[i] : 0, face ? letter[i + 1] : 0, face ? letter[i + 2] : 0,
            top, bottom, spark, face && colours.letter);
        }
      }
      ctx.putImageData(image, 0, 0);
      out.push(canvas);
    }
    return out;
  })();
  keep(cooked, key, job);
  trim(cooked, COOKED_KEPT * 2);
  return job;
}

/**
 * A cape's outer face as the game shows it from behind, moving: a canvas at
 * `unit` px per cape unit that the clock repaints. Yours needs its colours.
 */
export function capeFace(cape, colours, unit = 6) {
  const canvas = document.createElement('canvas');
  canvas.className = 'cape-face';
  canvas.width = FACE.w;
  canvas.height = FACE.h;
  canvas.style.width = `${10 * unit}px`;
  canvas.style.height = `${16 * unit}px`;
  canvas.born = Date.now();
  const ctx = canvas.getContext('2d');
  let source = null;
  canvas.paint = (n) => {
    if (!source) return;
    const s = source[n];
    if (s instanceof HTMLCanvasElement) ctx.drawImage(s, 0, 0);
    else ctx.drawImage(s, FACE.x, FACE.y, FACE.w, FACE.h, 0, 0, FACE.w, FACE.h);
  };
  (cape.id === 'yours' ? cookCape(colours, true) : frames(cape.id)).then((s) => {
    source = s;
    canvas.paint(capeFrameNow());
  }).catch(() => {});
  faces.add(canvas);
  startClock();
  return canvas;
}

/**
 * The whole cape for the Home model: the thirty sheets stacked into one tall
 * picture, as a url, so a face of the model can show frame n by sliding its
 * background — see buildCape in ui/character.js, which hands its box to
 * `drive` so the clock here keeps the box's --cape-frame. Made once per cape
 * (per set of colours for Yours) and kept.
 */
const strips = new Map();
export function capeStrip(cape, colours) {
  const key = capeWord(cape, colours);
  if (strips.has(key)) return strips.get(key);
  const job = (async () => {
    const source = cape.id === 'yours' ? await cookCape(colours, false) : await frames(cape.id);
    const strip = document.createElement('canvas');
    strip.width = SHEET_W;
    strip.height = SHEET_H * CAPE_FRAMES;
    /* Drawn once and encoded once: on the CPU, or toBlob's read-back is the
       first thing to wait for the graphics card in the launcher's first
       second — 490 ms, measured, on 2026-09-15, in the very frame Home came
       up. See tile() in world.js. */
    const ctx = strip.getContext('2d', { willReadFrequently: true });
    source.forEach((s, n) => ctx.drawImage(s, 0, n * SHEET_H));
    const blob = await new Promise((resolve) => strip.toBlob(resolve, 'image/png'));
    return { url: URL.createObjectURL(blob), frames: CAPE_FRAMES, drive };
  })();
  keep(strips, key, job);
  trim(strips, COOKED_KEPT, (old) => {
    Promise.resolve(old).then((made) => { if (made && made.url) URL.revokeObjectURL(made.url); }, () => {});
  });
  return job;
}

/**
 * The milestones as the screens want them: the next step on every track,
 * closest first, and the earned ones, newest first.
 */
export function milestones(summary) {
  const list = summary?.milestones?.list || [];
  const running = summary?.milestones?.running || {};
  const next = [];
  const earned = [];
  for (const id of Object.keys(TRACKS)) {
    const steps = list.filter((m) => m.track === id);
    const coming = steps.find((m) => !m.earnedAt);
    if (coming) {
      const have = running[id] || 0;
      next.push({ ...coming, have, share: Math.min(1, have / coming.step) });
    }
    for (const m of steps) if (m.earnedAt) earned.push(m);
  }
  next.sort((a, b) => b.share - a.share);
  /* Newest day first; within a day the tracks in their own order, the
     bigger step first — a step is only comparable to steps on its track. */
  earned.sort((a, b) => b.earnedAt - a.earnedAt
    || ORDER.indexOf(a.track) - ORDER.indexOf(b.track)
    || b.step - a.step);
  return { next, earned, total: list.length };
}

/* ------------------------------------------------------------------ news */

const SEEN = 'bc.play.seen';
const NEWS = 'bc.play.news';
const NEWS_FOR = 24 * 3600000;

/**
 * What changed since the player last looked (2026-09-12, evening). Home
 * calls this when the record lands: a level reached or a milestone earned
 * since the last look is said once, as a toast, and then remembered. The
 * very first look — before any game has been played — is remembered without
 * a word, so the first game ever played is what gets announced when it ends:
 * "Level 3" and the Signature cape after a first hour, and no more (until
 * 2026-09-19 a player installing with four hundred hours on their main
 * server heard "Level 41" here, because the record took the server's own
 * history in; it does not any more — see levelOf in ledger.js). The level is
 * marked New on Stats for a day (since 2026-09-13 it is the one thing that
 * is: the medal wall and the Records panel the other marks sat on are gone).
 *
 * Every comparison is "more than last time", never "different from last
 * time", and that is load-bearing since 2026-09-19: the mod took the old
 * history back out of every record that day, so a level, a cape and the
 * earned list can all be LOWER than the last look, once. A drop is said
 * nowhere — no toast, no New mark (Stats marks the level only when the news
 * names the level it shows), and the lower figure is simply what the next
 * look is measured from, so the first level climbed after it is announced
 * like any other.
 *
 * Only the browser's own storage, and only these facts; the ledger itself
 * is never written from the launcher.
 */
export function announce(summary) {
  if (!summary?.level || !summary?.milestones) return;
  let seen = null;
  try {
    seen = JSON.parse(localStorage.getItem(SEEN) || 'null');
  } catch {
    seen = null;
  }
  const now = {
    level: summary.level.level,
    earned: summary.milestones.list.filter((m) => m.earnedAt).map((m) => m.id),
    /* The best streak as a figure, so "beaten since the last look" is a
       comparison and not a date. The longest day and the longest sitting
       were beside it until 2026-09-13, when the Records panel came off Stats
       — a toast about a record no page shows points at nothing, and the
       two of them were taking the slots the milestones needed. The streak
       is on the player card, so it stays. An older `seen` still carries
       `day` and `sitting`; they are simply never read. */
    records: {
      streak: summary.streak?.best || 0
    }
  };
  try {
    localStorage.setItem(SEEN, JSON.stringify(now));
  } catch {
    /* storage refused; the news is simply not remembered */
  }
  if (!seen || typeof seen.level !== 'number' || !Array.isArray(seen.earned)) return;

  /* Strictly more than last time: a level that went down is not news. */
  const levelled = now.level > seen.level;
  const fresh = now.earned.filter((id) => !seen.earned.includes(id));
  const was = seen.records || {};
  const beaten = Object.keys(now.records).filter((key) => (was[key] || 0) > 0 && now.records[key] > was[key]);

  /* Three toasts is the layer's ceiling, and a return from one game says
     at most three things: a cape earned first — the thing the page is about
     since 2026-09-17 — then the level, then the streak if it is the longest
     yet. Milestones were said here until that day and are not any more:
     Next up came off Stats with the week chart, and a toast about something
     no page shows points at nothing (the 2026-09-13 rule, applied again).
     The level is marked New on Stats for a day; the rest is said here or
     not at all. */
  const lines = [];
  for (const cape of CAPES) {
    if (cape.level > seen.level && cape.level <= now.level) lines.push(`${cape.name} cape earned — it is yours to wear`);
  }
  if (levelled) lines.push(`Level ${now.level} — ${levelLine(summary.level)}`);
  if (beaten.includes('streak')) lines.push(`${now.records.streak} day streak — your longest yet`);
  for (const line of lines.slice(0, 3)) toast(line, 'level', 6000);

  /* What Stats marks New, for a day: the news is kept only when there is
     some, so a look at Home between the game and Stats does not clear it. */
  if (lines.length) {
    try {
      localStorage.setItem(NEWS, JSON.stringify({
        at: Date.now(), earned: fresh, level: levelled ? now.level : 0, records: beaten
      }));
    } catch {
      /* not remembered; Stats simply marks nothing */
    }
  }
}

/**
 * The news Stats marks: the milestones earned and the level reached since
 * the player last came back to Home with something to say, for a day.
 */
export function news() {
  const none = { earned: [], level: 0, records: [] };
  try {
    const kept = JSON.parse(localStorage.getItem(NEWS) || 'null');
    if (!kept || typeof kept.at !== 'number' || Date.now() - kept.at > NEWS_FOR) return none;
    return {
      earned: Array.isArray(kept.earned) ? kept.earned : [],
      level: kept.level || 0,
      records: Array.isArray(kept.records) ? kept.records : []
    };
  } catch {
    return none;
  }
}
