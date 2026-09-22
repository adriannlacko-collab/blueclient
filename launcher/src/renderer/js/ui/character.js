/**
 * The player model on the home card.
 *
 * A Minecraft skin is a 64x64 sheet of six-sided boxes, so the model is built
 * the same way: real CSS 3D boxes with each face cropped out of the sheet by
 * background-position. No WebGL and no library — the whole thing is six divs
 * per box and one rotateY, which is also why dragging it is free.
 *
 * Units are skin pixels. The model is 32 of them tall: head 8, body 12,
 * legs 12.
 *
 * It is handled rather than watched: drag to turn, let go to coast, scroll to
 * zoom, hold it and it walks on the spot, double-click and it settles back
 * where it started.
 */

/* Shipped fallback, used only when Mojang cannot be reached on first run. */
/*
 * Absolute, because this is handed to CSS as a custom property.
 * A relative url() inside a custom property resolves against the stylesheet
 * that reads it, not the document — so 'assets/...' was being looked for under
 * css/, and the default skin never loaded. Resolving against baseURI keeps it
 * right under both file:// in the packaged app and http:// in the preview.
 */
import { observeSize } from './dom.js';

const BUNDLED_SKIN = new URL('assets/art/steve.png', document.baseURI).href;

/* The slim ("Alex") model has 3px-wide arms, so those faces sit on a different
   part of the sheet. Everything else is identical.

   The narrowing comes off the *outside* of the arm. A shoulder is where it is
   whichever model you are on: the game hangs both arms off the same point and
   takes the missing column from the far edge, so the inner face stays flush
   against the torso at x = ±4. Keeping the wide model's centre and changing
   only the width left each arm floating half a pixel clear of the body — a
   slit of sky down both sides, which the walk then swung an arm across
   (Adrian, 2026-09-10: "if you pick slim arms for a skin, when you do the
   walking animation in the launcher, it glitches too as theres a gap"). */
const SLIM_ARMS = {
  'arm-right': {
    w: 3,
    x: -5.5,
    uv: { top: [44, 16], bottom: [47, 16], right: [40, 20], front: [44, 20], left: [47, 20], back: [51, 20] },
    over: { top: [44, 32], bottom: [47, 32], right: [40, 36], front: [44, 36], left: [47, 36], back: [51, 36] }
  },
  'arm-left': {
    w: 3,
    x: 5.5,
    uv: { top: [36, 48], bottom: [39, 48], right: [32, 52], front: [36, 52], left: [39, 52], back: [43, 52] },
    over: { top: [52, 48], bottom: [55, 48], right: [48, 52], front: [52, 52], left: [55, 52], back: [59, 52] }
  }
};

/** [u, v] of each face on the sheet, plus the box size in skin pixels. */
const PARTS = [
  {
    name: 'head', w: 8, h: 8, d: 8, x: 0, y: -12,
    uv: { top: [8, 0], bottom: [16, 0], right: [0, 8], front: [8, 8], left: [16, 8], back: [24, 8] },
    over: { top: [40, 0], bottom: [48, 0], right: [32, 8], front: [40, 8], left: [48, 8], back: [56, 8] }
  },
  {
    name: 'body', w: 8, h: 12, d: 4, x: 0, y: -2,
    uv: { top: [20, 16], bottom: [28, 16], right: [16, 20], front: [20, 20], left: [28, 20], back: [32, 20] },
    over: { top: [20, 32], bottom: [28, 32], right: [16, 36], front: [20, 36], left: [28, 36], back: [32, 36] }
  },
  {
    name: 'arm-right', w: 4, h: 12, d: 4, x: -6, y: -2,
    uv: { top: [44, 16], bottom: [48, 16], right: [40, 20], front: [44, 20], left: [48, 20], back: [52, 20] },
    over: { top: [44, 32], bottom: [48, 32], right: [40, 36], front: [44, 36], left: [48, 36], back: [52, 36] }
  },
  {
    name: 'arm-left', w: 4, h: 12, d: 4, x: 6, y: -2,
    uv: { top: [36, 48], bottom: [40, 48], right: [32, 52], front: [36, 52], left: [40, 52], back: [44, 52] },
    over: { top: [52, 48], bottom: [56, 48], right: [48, 52], front: [52, 52], left: [56, 52], back: [60, 52] }
  },
  {
    name: 'leg-right', w: 4, h: 12, d: 4, x: -2, y: 10,
    uv: { top: [4, 16], bottom: [8, 16], right: [0, 20], front: [4, 20], left: [8, 20], back: [12, 20] },
    over: { top: [4, 32], bottom: [8, 32], right: [0, 36], front: [4, 36], left: [8, 36], back: [12, 36] }
  },
  {
    name: 'leg-left', w: 4, h: 12, d: 4, x: 2, y: 10,
    uv: { top: [20, 48], bottom: [24, 48], right: [16, 52], front: [20, 52], left: [24, 52], back: [28, 52] },
    over: { top: [4, 48], bottom: [8, 48], right: [0, 52], front: [4, 52], left: [8, 52], back: [12, 52] }
  }
];

/* The cape (2026-09-12, evening): the game's own 10x16x1 box hung from the
   shoulders behind the body, on a 64x32 cape sheet of its own — the outer
   face at (1,1), the inner at (12,1), the edges and the top and bottom
   around them. It leans back a little the way the game's does at rest, and
   it is built like every other box so the pixel rules below hold for it. */
const CAPE = {
  name: 'cape', w: 10, h: 16, d: 1, x: 0, y: 0,
  uv: { top: [1, 0], bottom: [11, 0], right: [0, 1], front: [12, 1], left: [11, 1], back: [1, 1] }
};
const CAPE_LEAN = 7;       // degrees back from the shoulders
const CAPE_BEHIND = 1.0;   // skin pixels between the body's back and the cape's inner face, clear of the jacket layer
/* The cape flows with the walk (2026-09-18, evening; Adrian: "when you have a
   cape equipped in the launcher, and hold for the walking animation, the cape
   is stationary, make it flow like its supposed to do when walking"). The
   game's cape hangs at 6° and, walking, is lifted by the player's speed and
   bobbed by the stride — CapeFeatureRenderer's `6 + r/2 + q`, r the forward
   speed, q a sine of the distance walked times the stride. Here: lifted by
   CAPE_LIFT and swayed by CAPE_FLAP once a step, both scaled by how hard the
   model is walking, so the cape rises as it sets off and settles as it
   stops. Read from `--swing-cape` on the model the way a limb reads its
   swing, so it survives a rebuild too.
   The sway was nine degrees for three days and read as bobbing (2026-09-21,
   Adrian: "the cape animation in the launcher when the walking animation
   starts is bobbing up and down, but in minecraft the cape is ALMOST still
   just like its flying a bit higher"): at a walk the game's q is small next
   to its lift, so the lift is the whole of it now and the sway is a trace. */
const CAPE_LIFT = 14;      // degrees the walk lifts it, at a full stride
const CAPE_FLAP = 1.5;     // degrees it sways either side of that, once a step — a trace, not a bob

/* How much bigger the second layer sits, in skin pixels. Enough to clear the
   base without floating off it. Applied as a transform, never by resizing the
   face — see buildBox. */
const OVER_INFLATE = 0.6;

/* Faces that meet exactly still crack open on a fractional device pixel, and
   the dark background shows through as a hairline. Each face is scaled in its
   own plane so it laps over the cube edge onto its neighbour.
   
   This is a transform, applied after the sheet has been sampled at whole-pixel
   alignment, so it cannot drag in the neighbouring texture cell — and it is on
   the face rather than the box, so the torso does not grow into the arms that
   sit flush against it. */
const FACE_LAP = 1.025;

/* A little more than the hint of three-quarter view it stood at until
   2026-09-17 (-14): Adrian, off the round-two mockups, "turning the skin
   slightly around but not too much, it should still face forward as it does
   right now, maybe just slightly more turned". -48 was the mockup; this is
   the amount that still reads as facing you. */
const REST_YAW = -24;
const DRAG_PER_PX = 0.55;    // degrees of yaw per pixel dragged

/* An arm and a leg swing about the shoulder and the hip — the top of the box,
   never its middle — so each limb's transform is written as "go to the pivot,
   turn, come back". The angle is read from a custom property the walk sets on
   the model, which is why the gait survives a rebuild: changing skin or window
   size throws every box away and builds new ones, and they come back mid-stride
   rather than snapping to attention. */
const PIVOTED = /^(arm|leg)-/;

const UNIT = 10;             // px per skin pixel before fitting
const MODEL_PX = 32 * UNIT;  // head 8 + body 12 + legs 12

/* The model is allowed to be taller than its row — the legs are meant to run
   behind the Play button, the way the reference has it. */
const OVERFLOW = 1.22;

/**
 * @param {{unit?: number}} options px per skin pixel — the model is 32 tall.
 * @returns {HTMLElement} the stage; append it wherever the model should sit.
 */
/**
 * @param {number} [overflow] how much taller than the stage the model may run.
 *   OVERFLOW lets a slab crop the legs; 1 keeps the whole model on stage, for
 *   a stage with nothing below it to hide the feet.
 * @param {number} [clearance] px the model is nudged down inside its stage,
 *   so its head is not against whatever sits above. Home wants it — the model
 *   is taller than its box there and the drop is what puts every spare pixel
 *   below, under Play. A stage with a caption right under it wants none: in
 *   the skins slots the 16 walked the model's feet 6px through the words
 *   "Classic arms" (2026-09-10).
 * @param {number} [rest] the yaw the model stands at and returns to, in
 *   degrees. Home's is REST_YAW, facing you. The Level card on Stats stands him
 *   at 152 — from behind, a little turned — because the cape is the point of
 *   that card and a cape cannot show from the front (2026-09-17).
 */
export function createCharacter({ unit = UNIT, overflow = OVERFLOW, clearance = 16, rest = REST_YAW } = {}) {
  const model = document.createElement('div');
  model.className = 'mc-model';
  model.style.setProperty('--skin', `url("${BUNDLED_SKIN}")`);

  let current = unit;              // px per skin pixel, always a whole number
  let slim = false;
  let layered = true;              // 64x64 sheets carry a second layer
  let cape = null;                 // the cape: { url, frames } of its strip, or none

  /* The pose, written whole onto the element that wears it (2026-09-22).
     The drag, the zoom and the drop were custom properties on the model that
     its own transform read, and the walk's swings were more of them that the
     limbs read — and a custom property is inherited, so every one of those
     writes, once a frame, restyled the model and all eighty-four boxes and
     faces under it, measured at 1-1.5 ms a frame while the model was dragged.
     The transforms are the same ones, value for value; each is now set on
     the one element it moves, and nothing under it is restyled. The swings
     survive a rebuild the way they always did: a new box takes the one on
     record. */
  const pose = { drop: '0px', zoom: '1', yaw: `${rest.toFixed(1)}deg`, swing: {} };
  let swingers = [];
  const place = () => {
    model.style.transform = `translateY(${pose.drop}) scale3d(${pose.zoom}, ${pose.zoom}, ${pose.zoom})`
      + ` rotateX(-4deg) rotateY(${pose.yaw})`;
  };
  const swingAll = () => {
    for (const box of swingers) box.swing(pose.swing[box.part] || '0deg');
  };

  const rebuild = () => {
    const boxes = [];
    if (cape) boxes.push(buildCape(current, cape));
    // A pre-1.8 sheet is 64x32 — the same layout as the top half of a modern
    // one, and nothing below it. Sampled as if it were 64x64 it stretches to
    // double height and every face lands on the wrong art, which is what a
    // "glitched" model was: an old account wearing an old-format skin.
    const legacy = !layered;
    for (const part of PARTS) {
      const shaped = shape(part, slim, legacy);
      boxes.push(buildBox(shaped, current, shaped.uv, false, legacy));
      // The overlay is where crowns, hoods and hair sit. A legacy sheet only
      // carries the head's (the hat) — the rest exists on 64x64 alone.
      if (layered) boxes.push(buildBox(shaped, current, shaped.over, true, false));
      else if (part.name === 'head') boxes.push(buildBox(shaped, current, shaped.over, true, true));
    }
    model.replaceChildren(...boxes);
    swingers = boxes.filter((box) => box.swing);
    swingAll();
  };
  rebuild();

  const stage = document.createElement('div');
  stage.className = 'mc-stage';
  stage.append(model);

  /**
   * Swap in a real texture once it has been fetched.
   * @param {{dataUri: string, slim?: boolean}} skin
   */
  stage.setSkin = ({ dataUri, slim: isSlim = false, height = 64 } = {}) => {
    if (!dataUri) return;
    model.style.setProperty('--skin', `url("${dataUri}")`);
    const hasLayers = height >= 64;
    if (isSlim !== slim || hasLayers !== layered) {
      slim = isSlim;
      layered = hasLayers;
      rebuild();
    }
  };

  /**
   * Hang a cape on the model — a strip from capeStrip in play.js, its
   * thirty sheets stacked, as { url, frames } — or take it off with nothing.
   */
  stage.setCape = (strip = null) => {
    const next = strip && strip.url ? strip : null;
    if ((next && next.url) === (cape && cape.url)) return;
    cape = next;
    rebuild();
  };

  /* Card height varies with the window. Rather than scale a finished model —
     which lands every face edge on a fractional device pixel and cracks the
     seams open — pick a whole-number unit and rebuild at that size. */
  const fit = () => {
    const h = stage.clientHeight;
    if (!h) return;
    const next = Math.max(4, Math.min(18, Math.round((h * overflow) / 32)));
    /* All the spill belongs below the row, never above it, plus whatever
       clearance the stage asked for, so the head is not touching what sits
       above it. */
    const spill = Math.max(0, (32 * next - h) / 2);
    pose.drop = `${(spill + clearance).toFixed(1)}px`;
    place();
    if (next === current) return;
    current = next;
    rebuild();
  };

  // Through observeSize, which lets go of a stage that has left the page:
  // Home and Cosmetics each build a model on every visit, and an observer
  // left holding one pins its seventy-two boxes for the launcher's life
  // (2026-09-22).
  observeSize(stage, fit);
  requestAnimationFrame(fit);
  fit();

  let yaw = rest;
  let dragging = false;
  let lastX = 0;
  let pointer = null;

  const apply = () => { pose.yaw = `${yaw.toFixed(1)}deg`; place(); };
  apply();

  /* Scroll zooms the model in and out, between hard bounds so it can neither
     vanish nor fill the slab. The easing runs here, frame by frame, gliding
     the value toward its target — never a CSS transition on the transform.
     Spin writes the same transform every frame, so a transition would fight
     it: each frame restarts the glide, and the model visibly snaps in size
     the moment the transition is taken away mid-flight. */
  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 1.15;
  const ZOOM_PER_PX = 0.0016;
  const ZOOM_TAU = 110;      // ms for the remaining distance to fall to ~37%
  let zoom = 1;
  let zoomTarget = 1;
  let zoomFrame = 0;

  /* Its own name, and written from the start. It used to be --zoom, set only
     on the first wheel or double-click — so until then the model inherited
     whatever --zoom meant further up, and once tokens.css gave every hovered
     picture a --zoom of 1.06 (0.32.0) the model stood at 106% at launch until
     a double-click wrote its own (Adrian, 2026-09-14: "the skin on the home
     screen is too big, and when you double click it goes back to normal"). */
  const applyZoom = () => { pose.zoom = zoom.toFixed(4); place(); };
  applyZoom();

  const glideZoom = (prev) => {
    zoomFrame = 0;
    if (!stage.isConnected) return;
    const now = performance.now();
    const dt = Math.min(48, now - prev);
    zoom += (zoomTarget - zoom) * (1 - Math.exp(-dt / ZOOM_TAU));
    if (Math.abs(zoomTarget - zoom) < 0.001) { zoom = zoomTarget; applyZoom(); return; }
    applyZoom();
    zoomFrame = requestAnimationFrame(() => glideZoom(now));
  };

  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    // A wheel tick during the double-click return takes over from it cleanly.
    stopReset();
    zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTarget - event.deltaY * ZOOM_PER_PX));
    if (reduced) { zoom = zoomTarget; applyZoom(); return; }
    if (!zoomFrame) zoomFrame = requestAnimationFrame(() => glideZoom(performance.now()));
  }, { passive: false });

  /* Let go mid-drag and the model keeps turning, bleeding the spin off
     exponentially — a hard flick visibly coasts longer than a nudge, and a
     plain click does not move it at all. The velocity is smoothed across the
     last few pointer moves so one jittery event cannot launch it. */
  const SPIN_TAU = 325;      // ms for the spin to fall to ~37% of itself
  const SPIN_STOP = 0.003;   // deg per ms under which the coast ends
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let spinV = 0;             // deg per ms, signed
  let spinFrame = 0;
  let lastMoveAt = 0;

  const stopCoast = () => {
    cancelAnimationFrame(spinFrame);
    spinFrame = 0;
    spinV = 0;
  };

  const coast = (prev) => {
    spinFrame = 0;
    if (!stage.isConnected) return;
    const now = performance.now();
    const dt = Math.min(48, now - prev);
    yaw += spinV * dt;
    spinV *= Math.exp(-dt / SPIN_TAU);
    apply();
    if (Math.abs(spinV) < SPIN_STOP) { spinV = 0; return; }
    spinFrame = requestAnimationFrame(() => coast(now));
  };

  /* ------------------------------------------------------------ the walk */

  /* Hold the model and it walks on the spot; let go and it finishes the step
     it is in and stands still (Adrian, 2026-09-09: "if you press and hold on
     the skin as if youre about to rotate it, it starts walking … and when you
     let go, it finishes its current step and returns to standing still").

     The gait is the game's own: one cosine drives every limb, each arm swinging
     against the leg on its own side. Vanilla's stride is 1.4 radians at the leg
     and 1.0 at the arm times how hard the player is moving; these are those,
     taken at the amount a walking player carries rather than a sprinting one.

     Stopping is the half worth the care. Standing still is both feet together,
     which is exactly where the cosine crosses zero — so the release glides the
     phase on to the next crossing and bleeds the stride away over the same
     span. The model arrives at rest instead of stopping mid-air, and the last
     step is visibly shorter than the one before it. */
  const WALK_MS = 900;       // one full cycle — a step on each foot
  const WALK_HOLD = 120;     // ms held before it sets off, so a click is a click
  const WALK_IN = 170;       // ms to reach a full stride
  const ARM_DEG = 36;
  const LEG_DEG = 50;
  const SWING = {
    'arm-right': -ARM_DEG,
    'arm-left': ARM_DEG,
    'leg-right': LEG_DEG,
    'leg-left': -LEG_DEG
  };

  let walkPhase = 0;
  let walkAmount = 0;
  let walkFrame = 0;
  let walkTimer = 0;
  let walkHeld = false;
  let stopFrom = 0;          // where the last step starts, ends and how long it has
  let stopTo = 0;
  let stopAmount = 0;
  let stopAt = 0;
  let stopMs = 0;

  const applyWalk = () => {
    for (const name of Object.keys(SWING)) {
      const deg = Math.cos(walkPhase) * SWING[name] * walkAmount;
      pose.swing[name] = `${deg.toFixed(2)}deg`;
    }
    // The cape: lifted by the walk and flapping once a step (twice a cycle),
    // a quarter turn behind the legs so it trails the stride.
    const cape = (CAPE_LIFT + CAPE_FLAP * Math.sin(2 * walkPhase - Math.PI / 2)) * walkAmount;
    pose.swing.cape = `${cape.toFixed(2)}deg`;
    swingAll();
  };

  const standStill = () => {
    cancelAnimationFrame(walkFrame);
    walkFrame = 0;
    walkAmount = 0;
    applyWalk();
  };

  const walkTick = (prev) => {
    walkFrame = 0;
    if (!stage.isConnected) return;
    const now = performance.now();
    const dt = Math.min(48, now - prev);

    if (walkHeld) {
      walkPhase += (dt / WALK_MS) * Math.PI * 2;
      walkAmount = Math.min(1, walkAmount + dt / WALK_IN);
    } else {
      const t = stopMs <= 0 ? 1 : Math.min(1, (now - stopAt) / stopMs);
      const k = 1 - Math.pow(1 - t, 3);
      walkPhase = stopFrom + (stopTo - stopFrom) * k;
      walkAmount = stopAmount * (1 - k);
      if (t >= 1) { walkPhase = stopTo; standStill(); return; }
    }

    applyWalk();
    walkFrame = requestAnimationFrame(() => walkTick(now));
  };

  const startWalking = () => {
    walkTimer = 0;
    if (reduced) return;
    walkHeld = true;
    if (!walkFrame) walkFrame = requestAnimationFrame(() => walkTick(performance.now()));
  };

  const stopWalking = () => {
    clearTimeout(walkTimer);
    walkTimer = 0;
    if (!walkHeld) return;
    walkHeld = false;
    if (reduced || !walkFrame) { standStill(); return; }

    // The next phase at which the cosine is zero: feet together, one step on.
    const step = Math.PI;
    const next = Math.ceil((walkPhase - Math.PI / 2) / step) * step + Math.PI / 2;
    stopFrom = walkPhase;
    stopTo = next > walkPhase + 0.05 ? next : next + step;
    stopAmount = walkAmount;
    stopAt = performance.now();
    // A shade slower than walking, so the last step reads as slowing down.
    stopMs = ((stopTo - stopFrom) / (Math.PI * 2)) * WALK_MS * 1.4;
  };

  /* ---------------------------------------------------------- the return */

  /* Double-click puts it back where it started — easier than dragging your way
     out of a full spin, and it undoes the zoom in the same gesture. */
  const RESET_MS = 460;
  let resetFrame = 0;
  const stopReset = () => { cancelAnimationFrame(resetFrame); resetFrame = 0; };

  const resetView = () => {
    stopCoast();
    cancelAnimationFrame(zoomFrame);
    zoomFrame = 0;
    stopReset();

    /* The short way round. `yaw` is unbounded — turn the model five times and
       it stands eighteen hundred degrees from home — and it used to be set
       straight back to REST_YAW under a CSS transition, which unwound every one
       of those degrees inside three hundred milliseconds: the more it had been
       spun, the more violent the snap back (Adrian, 2026-09-09: "if you rotate
       alot, the reverse rotation is super quick and weird"). The target is the
       turn of REST_YAW nearest where the model actually stands, so the way home
       is never more than half a turn however long it was spun. */
    const target = rest + 360 * Math.round((yaw - rest) / 360);
    const fromYaw = yaw;
    const fromZoom = zoom;
    zoomTarget = 1;

    if (reduced) { yaw = target; zoom = 1; apply(); applyZoom(); return; }

    const start = performance.now();
    const step = (now) => {
      resetFrame = 0;
      if (!stage.isConnected) return;
      const t = Math.min(1, (now - start) / RESET_MS);
      const k = 1 - Math.pow(1 - t, 3);
      yaw = fromYaw + (target - fromYaw) * k;
      zoom = fromZoom + (1 - fromZoom) * k;
      apply();
      applyZoom();
      if (t < 1) resetFrame = requestAnimationFrame(step);
    };
    resetFrame = requestAnimationFrame(step);
  };

  /* --------------------------------------------------------- the pointer */

  stage.addEventListener('pointerdown', (event) => {
    stopCoast();
    // Grabbing the model mid-return ends it: the drag owns the transform now.
    stopReset();
    dragging = true;
    pointer = event.pointerId;
    lastX = event.clientX;
    lastMoveAt = performance.now();
    // Capture keeps the drag alive past the edge of the model. It throws for
    // a pointer id the element never saw, which is harmless.
    try { stage.setPointerCapture(pointer); } catch { /* not capturable */ }
    stage.classList.add('is-dragging');
    // Held, not clicked: a press that is over inside WALK_HOLD never sets off,
    // so a plain click and either half of a double-click leave it standing.
    clearTimeout(walkTimer);
    walkTimer = setTimeout(startWalking, WALK_HOLD);
    event.preventDefault();
  });

  stage.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointer) return;
    const now = performance.now();
    const dx = event.clientX - lastX;
    yaw += dx * DRAG_PER_PX;
    lastX = event.clientX;
    spinV = 0.7 * spinV + 0.3 * ((dx * DRAG_PER_PX) / Math.max(1, now - lastMoveAt));
    lastMoveAt = now;
    apply();
  });

  const release = (event) => {
    if (!dragging || (event && event.pointerId !== pointer)) return;
    dragging = false;
    stopWalking();
    stage.classList.remove('is-dragging');
    try {
      if (pointer !== null && stage.hasPointerCapture(pointer)) stage.releasePointerCapture(pointer);
    } catch { /* already released */ }
    pointer = null;

    // Holding still before letting go means the spin was already over.
    if (performance.now() - lastMoveAt > 90) spinV = 0;
    if (!reduced && Math.abs(spinV) >= SPIN_STOP) {
      spinFrame = requestAnimationFrame(() => coast(performance.now()));
    } else {
      spinV = 0;
    }
  };

  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  stage.addEventListener('dblclick', resetView);

  return stage;
}

/* ------------------------------------------------------------------ box */

/* A 64x32 sheet has no left-limb art; the game mirrors the right limb onto
   the left, and so does this. */
const LEGACY_DONOR = { 'arm-left': 'arm-right', 'leg-left': 'leg-right' };

/** Narrow the arms when the skin uses the slim model; borrow limbs on legacy. */
function shape(part, slim, legacy = false) {
  let out = part;
  const override = slim ? SLIM_ARMS[part.name] : null;
  if (override) out = { ...out, w: override.w, x: override.x, uv: override.uv, over: override.over };
  if (legacy && LEGACY_DONOR[part.name]) {
    const donor = PARTS.find((p) => p.name === LEGACY_DONOR[part.name]);
    out = { ...out, uv: donor.uv, over: donor.over };
  }
  return out;
}

/**
 * Build one cuboid.
 *
 * Every face is laid out at exactly its cell size with a whole-pixel
 * background-size, because `image-rendering: pixelated` samples the sheet at
 * layout time: a fractional texels-per-pixel ratio makes the sampler round
 * across the cell boundary and drag in the neighbouring body part as a thin
 * line. Any inflation therefore happens as a transform on the finished box,
 * after sampling, where it cannot affect which texels are read.
 *
 * @param {object} part  the sized part
 * @param {number} u     px per skin pixel (always a whole number)
 * @param {object} faces the UV set to sample — base layer or overlay
 * @param {boolean} overlay whether this is the second layer
 * @param {boolean} legacy whether the sheet is the old 64x32 format
 */
function buildBox({ name, w, h, d, x, y }, u, faces, overlay, legacy = false) {
  const box = document.createElement('div');
  box.className = `mc-box mc-box--${name}${overlay ? ' mc-box--over' : ''}`;

  // The overlay is a shell around the base, so it scales out per axis.
  const scale = overlay
    ? ` scale3d(${(w + OVER_INFLATE) / w}, ${(h + OVER_INFLATE) / h}, ${(d + OVER_INFLATE) / d})`
    : '';
  // A limb hangs from its pivot; everything else sits where it is put. At zero
  // degrees the two are the same transform, so a still model is unchanged.
  // A limb's swing is handed to it by the walk (createCharacter's pose).
  if (PIVOTED.test(name)) {
    box.part = name;
    box.swing = (deg) => {
      box.style.transform = `translate3d(${x * u}px, ${(y - h / 2) * u}px, 0)`
        + ` rotateX(${deg})`
        + ` translate3d(0, ${(h / 2) * u}px, 0)${scale}`;
    };
    box.swing('0deg');
  } else {
    box.style.transform = `translate3d(${x * u}px, ${y * u}px, 0)${scale}`;
  }

  // face: [name, width in skin px, height in skin px, transform]
  const layout = [
    ['front', w, h, `translateZ(${(d / 2) * u}px)`],
    ['back', w, h, `rotateY(180deg) translateZ(${(d / 2) * u}px)`],
    ['right', d, h, `rotateY(-90deg) translateZ(${(w / 2) * u}px)`],
    ['left', d, h, `rotateY(90deg) translateZ(${(w / 2) * u}px)`],
    ['top', w, d, `rotateX(90deg) translateZ(${(h / 2) * u}px)`],
    ['bottom', w, d, `rotateX(-90deg) translateZ(${(h / 2) * u}px)`]
  ];

  // Whole pixels per texel, so no boundary rounding. The sheet's stated
  // height must match the real image — a 64x32 sheet told it is 64x64 gets
  // stretched to double height and every face samples the wrong art.
  const sheetW = 64 * u;
  const sheetH = (legacy ? 32 : 64) * u;

  for (const [face, fw, fh, transform] of layout) {
    const [ux, uy] = faces[face];
    const el = document.createElement('i');
    el.className = 'mc-face';
    el.style.width = `${fw * u}px`;
    el.style.height = `${fh * u}px`;
    el.style.marginLeft = `${(-fw * u) / 2}px`;
    el.style.marginTop = `${(-fh * u) / 2}px`;
    // The lap goes last so it scales within the face's own plane.
    el.style.transform = `${transform} scale(${FACE_LAP})`;
    el.style.backgroundSize = `${sheetW}px ${sheetH}px`;
    el.style.backgroundPosition = `${-ux * u}px ${-uy * u}px`;
    box.append(el);
  }

  return box;
}

/**
 * The cape box: the same builder, then its own sheet on every face — the
 * skin is a custom property on the model and the cape is not the skin — and
 * its own transform: hung from the top edge, a little behind the body,
 * leaning back. The lean pivots at the shoulders the way a limb pivots at
 * its joint, so the top stays against the back.
 *
 * A cape moves (2026-09-13): the picture is every frame's sheet stacked
 * into one strip, and each face shows frame n by sliding its background up
 * n sheets — `--cape-frame` on the box, kept by the clock in play.js (the
 * box is handed to the strip's `drive`), the same frame the game shows. On
 * the box and not the root: a property changed on the root restyles the
 * whole document, five times a second (2026-09-15). The sheets are six times
 * the game's size and smooth, so the cape is not sampled pixel-for-pixel the
 * way the skin is.
 */
const FACE_ORDER = ['front', 'back', 'right', 'left', 'top', 'bottom'];   // buildBox's own order
function buildCape(u, { url, frames = 1, drive }) {
  const box = buildBox(CAPE, u, CAPE.uv, false, true);
  [...box.children].forEach((face, i) => {
    face.style.backgroundImage = `url("${url}")`;
    face.style.imageRendering = 'auto';
    face.style.backgroundSize = `${64 * u}px ${32 * u * frames}px`;
    const [ux, uy] = CAPE.uv[FACE_ORDER[i]];
    face.style.backgroundPosition = `${-ux * u}px calc(${-uy * u}px - var(--cape-frame, 0) * ${32 * u}px)`;
  });
  const top = -8;                    // the body's top edge, in skin pixels
  // The rest lean, and the walk's lift and flap on top of it (handed over by
  // applyWalk through the pose; 0 while standing).
  box.part = 'cape';
  box.swing = (deg) => {
    box.style.transform = `translate3d(0, ${top * u}px, ${-(2 + CAPE_BEHIND) * u}px)`
      + ` rotateX(calc(${-CAPE_LEAN}deg - ${deg}))`
      + ` translate3d(0, ${(CAPE.h / 2) * u}px, 0)`;
  };
  box.swing('0deg');
  if (drive) drive(box);
  return box;
}

export { BUNDLED_SKIN };
