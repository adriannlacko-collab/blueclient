/* =========================================================================
   blueclient.net — the world

   The first screen is not a picture of the game; it is a small world of the
   game's own blocks, built and drawn here. Every face is cut from the block
   textures in assets/mc/block (the same files the game reads), lit the way
   the game lights a face — top brightest, bottom darkest, the two side pairs
   between — with smooth lighting in the corners, sky light dimming under the
   trees, the game's sun, its clouds, and its fog closing the distance; a
   plains village on the rise, its well, farm and pond; the water moving
   through the game's own frames. Then the player's own arm from the skin,
   the way first person draws it.

   It is a small renderer on purpose: one texture array, three shaders, no
   library. The world is generated from noise on every load, so it is owned
   outright — nothing here is a shader render pulled off the internet.

   BlueWorld.mount(canvas, options) -> { pause, resume, redraw, destroy, snapshot, ... }
   The launcher carries an identical copy at src/renderer/js/world.js — change both.
   ========================================================================= */
(function () {
  'use strict';

  var MC = 'assets/mc/';

  /* --------------------------------------------------------------- noise */

  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* Smooth value noise on a wrapping lattice. */
  function noise2(seed, size) {
    var rnd = mulberry(seed), grid = new Float32Array(size * size);
    for (var i = 0; i < grid.length; i++) grid[i] = rnd();
    function at(ix, iy) { return grid[((iy % size + size) % size) * size + ((ix % size + size) % size)]; }
    return function (x, y) {
      var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      var a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
  }

  /* --------------------------------------------------------------- blocks */

  var AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WATER = 5, LOG = 6, LEAVES = 7,
      SNOW = 8, TUFT = 9, POPPY = 10, DANDELION = 11, BLUET = 12, CORNFLOWER = 13, WHEAT = 14,
      GRAVEL = 15, COBBLE = 16, COARSE = 17, SPRUCE_LOG = 18, SPRUCE_LEAVES = 19,
      BIRCH_LOG = 20, BIRCH_LEAVES = 21, PLANKS = 22, GLASS = 23, PATH = 24, HAY = 25,
      FARMLAND = 26, TERRACOTTA = 27,
      /* A cell holding something smaller than a block — a stair, a slab, a
         door, a fence post — listed in world.shapes and drawn from there. It
         shuts out the sky like a block, so a roof keeps its house dim, and
         hides nothing, so the blocks around it keep their faces. */
      SHAPE = 28,
      /* One thread of it, down a flank of the mountain. Drawn as an ordinary
         opaque block: the game's lava is a fluid with its own pass, but a
         still surface seen from sixty blocks away is a cube with a bright
         face, and pretending otherwise costs a pass for nothing. */
      LAVA = 29;

  /* Texture layers, in the order they go into the array. The water's 32
     frames come last, in a run, so the water pass can step through them. */
  var LAYER = {
    grass_top: 0, grass_side: 1, dirt: 2, stone: 3, sand: 4, log: 5, log_top: 6,
    leaves: 7, snow: 8, tuft: 9, poppy: 10, dandelion: 11, bluet: 12, cornflower: 13,
    gravel: 14, cobble: 15, coarse: 16, spruce_log: 17, spruce_log_top: 18, spruce_leaves: 19,
    birch_log: 20, birch_log_top: 21, birch_leaves: 22,
    planks: 23, glass: 24, path_top: 25, path_side: 26, hay_top: 27, hay_side: 28,
    farmland: 29, wheat: 30, terracotta: 31, door_bottom: 32, door_top: 33,
    arm_front: 34, arm_back: 35, arm_outer: 36, arm_inner: 37, arm_top: 38, arm_hand: 39,
    water: 40,
    /* After the water's run, so the water pass can still step through its
       frames by adding to LAYER.water. */
    lava: 72
  };
  var WATER_FRAMES = 32;

  /* How much of the slight grade to apply, 0 to 1. Half since 2026-09-10. */
  var GRADE = 0.5;

  /* How tall a still water block is drawn: the game's own 14 pixels of 16. */
  var SURFACE = 14 / 16;
  var LAYERS = LAYER.lava + 1;

  /* Plains grass and oak foliage, as the colour maps give them; the game's
     water tint; birch and spruce have fixed colours of their own. */
  var TINT_GRASS = [0x91, 0xBD, 0x59];
  var TINT_LEAF = [0x77, 0xAB, 0x2F];
  var TINT_SPRUCE = [0x61, 0x99, 0x61];
  var TINT_BIRCH = [0x80, 0xA7, 0x55];
  var TINT_WATER = [0x3F, 0x76, 0xE4];

  /* Which layer each face of each block wears: [top, bottom, side]. */
  var FACES = {};
  FACES[GRASS] = [LAYER.grass_top, LAYER.dirt, LAYER.grass_side];
  FACES[DIRT] = [LAYER.dirt, LAYER.dirt, LAYER.dirt];
  FACES[STONE] = [LAYER.stone, LAYER.stone, LAYER.stone];
  FACES[SAND] = [LAYER.sand, LAYER.sand, LAYER.sand];
  FACES[WATER] = [LAYER.water, LAYER.water, LAYER.water];
  FACES[LOG] = [LAYER.log_top, LAYER.log_top, LAYER.log];
  FACES[LEAVES] = [LAYER.leaves, LAYER.leaves, LAYER.leaves];
  FACES[SNOW] = [LAYER.snow, LAYER.snow, LAYER.snow];
  FACES[GRAVEL] = [LAYER.gravel, LAYER.gravel, LAYER.gravel];
  FACES[COBBLE] = [LAYER.cobble, LAYER.cobble, LAYER.cobble];
  FACES[COARSE] = [LAYER.coarse, LAYER.coarse, LAYER.coarse];
  FACES[SPRUCE_LOG] = [LAYER.spruce_log_top, LAYER.spruce_log_top, LAYER.spruce_log];
  FACES[SPRUCE_LEAVES] = [LAYER.spruce_leaves, LAYER.spruce_leaves, LAYER.spruce_leaves];
  FACES[BIRCH_LOG] = [LAYER.birch_log_top, LAYER.birch_log_top, LAYER.birch_log];
  FACES[BIRCH_LEAVES] = [LAYER.birch_leaves, LAYER.birch_leaves, LAYER.birch_leaves];
  FACES[PLANKS] = [LAYER.planks, LAYER.planks, LAYER.planks];
  FACES[GLASS] = [LAYER.glass, LAYER.glass, LAYER.glass];
  FACES[PATH] = [LAYER.path_top, LAYER.dirt, LAYER.path_side];
  FACES[HAY] = [LAYER.hay_top, LAYER.hay_top, LAYER.hay_side];
  FACES[FARMLAND] = [LAYER.farmland, LAYER.dirt, LAYER.dirt];
  FACES[TERRACOTTA] = [LAYER.terracotta, LAYER.terracotta, LAYER.terracotta];
  FACES[LAVA] = [LAYER.lava, LAYER.lava, LAYER.lava];

  var PLANT = {};
  PLANT[TUFT] = LAYER.tuft; PLANT[POPPY] = LAYER.poppy; PLANT[DANDELION] = LAYER.dandelion;
  PLANT[BLUET] = LAYER.bluet; PLANT[CORNFLOWER] = LAYER.cornflower; PLANT[WHEAT] = LAYER.wheat;

  function isLeaves(b) { return b === LEAVES || b === SPRUCE_LEAVES || b === BIRCH_LEAVES; }
  function isPlant(b) { return b >= TUFT && b <= WHEAT; }
  /* Drawn with holes: leaves and glass. */
  function isCutout(b) { return isLeaves(b) || b === GLASS; }
  /* A full cube: hides the faces behind it and everything under it from the sky. */
  function isOpaque(b) { return b !== AIR && b !== WATER && b !== SHAPE && !isCutout(b) && !isPlant(b); }
  function blocksSky(b) { return isOpaque(b) || b === SHAPE; }
  function occludes(b) { return b !== AIR && b !== WATER && !isPlant(b); }

  /* ---------------------------------------------------------------- world */

  /* 68 rather than 52 since 2026-09-10: the column height is clamped to
     H - 8, so at 52 every mountain worth the name was flattened against 44.
     The extra sixteen layers cost about 0.7MB in the block array. */
  var W = 176, H = 68, D = 176, SEA = 9;

  function idx(x, y, z) { return (y * D + z) * W + x; }

  /* ------------------------------------------------------------ the village */

  /* Buildings are written the way the game's own structure files read: one
     string per north-to-south row, one grid per level from the ground up, so
     a house can be read straight off the page. Level `from` sits at the
     ground's height and stands in for its top block — a footing replaces
     the grass it is set on, a stack of hay (from 1) sits on it. */
  var CHARS = {
    '#': COBBLE, 'P': PLANKS, 'L': LOG, 'G': GLASS, 'T': TERRACOTTA, 'H': HAY,
    'F': FARMLAND, '~': WATER, 'Y': PATH, 'w': WHEAT, '.': AIR
  };

  /* A plains house the way the game builds them: a cobblestone footing with
     a plank floor, oak logs at the corners, a cobblestone band under plank
     (or white terracotta) walls with a window every other block, the door
     in the south wall, and a roof of oak stairs stepping up from eaves that
     overhang the walls by a block to a slab along the ridge. w and d are the
     walls' footprint; d must be odd so the ridge gets a row of its own. */
  function house(w, d, style) {
    var gw = w + 2, gd = d + 2, mid = (gd - 1) / 2, levels = [];
    var wall = style === 1 ? 'T' : 'P';
    var door = 1 + Math.floor(w / 2);
    function grid() { var rows = []; for (var r = 0; r < gd; r++) rows.push(new Array(gw).fill(' ')); return rows; }
    var r, c;

    var floor = grid(), low = grid(), high = grid();
    for (r = 1; r <= d; r++) {
      for (c = 1; c <= w; c++) {
        var edge = r === 1 || r === d || c === 1 || c === w;
        var corner = (r === 1 || r === d) && (c === 1 || c === w);
        floor[r][c] = edge ? '#' : 'P';
        if (!edge) { low[r][c] = '.'; high[r][c] = '.'; continue; }
        var window = !corner && ((r === 1 || r === d) ? c % 2 === 0 : r % 2 === 0);
        low[r][c] = corner ? 'L' : '#';
        high[r][c] = corner ? 'L' : window ? 'G' : wall;
      }
    }
    low[d][door] = 'D'; high[d][door] = 'd';
    levels.push(floor, low, high);

    // The roof: at each level one more row in from each eave becomes a
    // stair, and the rows inside are filled so the roof has no holes.
    for (var k = 0; k <= mid; k++) {
      var roof = grid();
      for (r = 0; r < gd; r++) {
        var step = Math.min(r, gd - 1 - r);
        var ch = step < k ? ' ' : step > k ? 'P' : r < mid ? 'v' : r > mid ? '^' : 'p';
        for (c = 0; c < gw; c++) roof[r][c] = ch;
      }
      levels.push(roof);
    }
    return { w: gw, d: gd, levels: levels, from: 0 };
  }

  /* The well: cobblestone sunk three blocks around a square of water, a rim,
     four posts and a slab roof. */
  var WELL = {
    w: 4, d: 4, from: -3,
    levels: [
      ['####', '#~~#', '#~~#', '####'],
      ['####', '#~~#', '#~~#', '####'],
      ['####', '#~~#', '#~~#', '####'],
      ['####', '#~~#', '#~~#', '####'],
      ['####', '#..#', '#..#', '####'],
      ['f..f', '....', '....', 'f..f'],
      ['f..f', '....', '....', 'f..f'],
      ['ssss', 'ssss', 'ssss', 'ssss'],
      ['....', '.ss.', '.ss.', '....']
    ]
  };

  /* Two beds of wheat either side of a channel, in a frame of logs. */
  var FARM = {
    w: 9, d: 7, from: 0,
    levels: [
      ['LLLLLLLLL', 'LFFF~FFFL', 'LFFF~FFFL', 'LFFF~FFFL', 'LFFF~FFFL', 'LFFF~FFFL', 'LLLLLLLLL'],
      ['.........', '.www.www.', '.www.www.', '.www.www.', '.www.www.', '.www.www.', '.........']
    ]
  };

  var HAY_STACK = { w: 3, d: 2, from: 1, levels: [['HH.', 'H..'], ['H..', '...']] };

  /* Where everything stands, relative to the camera: the well twenty-two
     blocks north and a little east, houses around it with their doors to
     the south, the farm off to the east, a pond in the near left with the
     fourth house on its shore, and lanes of packed dirt between them — one
     running down to the camera's feet. The first frame is flowers, then
     roofs, then the mountain. */
  function villagePlan(camX, camZ) {
    var wx = camX + 8, wz = camZ - 22;
    return {
      pieces: [
        { s: WELL, x: wx, z: wz, pad: 1 },
        { s: house(5, 5, 0), x: wx - 11, z: wz - 4, pad: 0 },
        { s: house(7, 7, 1), x: wx - 4, z: wz - 13, pad: 0 },
        { s: house(5, 5, 0), x: wx + 6, z: wz - 6, pad: 0 },
        { s: house(5, 5, 1), x: wx - 22, z: wz, pad: 0 },
        { s: FARM, x: wx + 8, z: wz + 2, pad: 1 },
        { s: HAY_STACK, x: wx + 18, z: wz + 4, pad: 0 }
      ],
      plaza: { x0: wx - 2, z0: wz - 2, x1: wx + 5, z1: wz + 5 },
      lanes: [
        [wx - 8, wz + 2, wx - 3, wz + 2],
        [wx, wz - 5, wx, wz - 3],
        [wx + 6, wz, wx + 9, wz],
        [wx + 5, wz + 5, wx + 7, wz + 5],
        [wx - 18, wz + 7, wx - 3, wz + 5],
        [wx + 1, wz + 6, wx - 5, wz + 17]
      ],
      pond: { x: camX - 9, z: camZ - 12, rx: 6, rz: 3.6, level: 14 }
    };
  }

  /* Sets a structure into the world, its level `from` at height base. */
  function stamp(world, s, x0, z0, base) {
    var blocks = world.blocks, shapes = world.shapes;
    for (var i = 0; i < s.levels.length; i++) {
      var y = base + s.from + i;
      if (y < 0 || y >= H) continue;
      var rows = s.levels[i];
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        for (var c = 0; c < row.length; c++) {
          var ch = row[c], x = x0 + c, z = z0 + r;
          if (ch === ' ' || x < 0 || z < 0 || x >= W || z >= D) continue;
          var at = idx(x, y, z);
          if (ch in CHARS) { blocks[at] = CHARS[ch]; continue; }
          var shape = null;
          if (ch === 'v' || ch === '^' || ch === '<' || ch === '>') shape = { kind: 'stair', back: ch, mat: PLANKS };
          else if (ch === 'p') shape = { kind: 'slab', mat: PLANKS };
          else if (ch === 's') shape = { kind: 'slab', mat: COBBLE };
          else if (ch === 'f') shape = { kind: 'post', mat: PLANKS };
          else if (ch === 'D') shape = { kind: 'door', part: 0 };
          else if (ch === 'd') shape = { kind: 'door', part: 1 };
          if (!shape) continue;
          shape.x = x; shape.y = y; shape.z = z;
          blocks[at] = SHAPE;
          shapes.push(shape);
        }
      }
    }
  }

  /**
   * Rolling ground with one mountain to the north, lakes where the ground
   * dips under the sea line, three kinds of wood, flowers in the open, a
   * village on the meadow's rise with a pond below it, and a clearing where
   * the camera stands so nothing grows through it.
   */
  function generate(camX, camZ) {
    var steps = generating(camX, camZ), step;
    while (!(step = steps.next()).done) { /* to the end */ }
    return step.value;
  }

  /* The same, a piece at a time (2026-09-22): each `yield` is a place the
     launcher's build (mount, buildStep) may stop and let the page have its
     turn — it was one task of 130 to 270 ms, the longest the world took,
     and a click that landed in it waited that long. The work and its order
     are exactly generate()'s, so the world is the same block for block. */
  function* generating(camX, camZ) {
    var blocks = new Uint8Array(W * H * D);
    var height = new Int16Array(W * D);
    var waterAt = new Int16Array(W * D).fill(SEA);
    var reserved = new Uint8Array(W * D);
    var trunks = new Uint8Array(W * D);
    var shapes = [];
    var big = noise2(11, 64), mid = noise2(23, 64), fine = noise2(37, 64);
    var wood = noise2(41, 64), kind = noise2(59, 64), flowers = noise2(67, 64);
    var ridgeA = noise2(83, 64), ridgeB = noise2(97, 64), ridgeC = noise2(113, 64);
    var snowN = noise2(127, 64), warpA = noise2(149, 64), warpB = noise2(163, 64);
    var rnd = mulberry(7);
    var x, z, y, i, col;

    /* THE RANGE (2026-09-10). It was a gaussian, which is the one shape the
       game never grows - a bell turned about a point, smooth in every
       direction. Four things make it a range instead: its centre is measured
       from a point noise pushes around, so the outline is not an ellipse; the
       falloff leans and stretches along its own axis; a second, lower massif
       puts a saddle in the skyline; and above the rock line the height is
       nudged toward shelves, three parts stepped to one part smooth. */
    var mx = W * 0.5, mz = 28;
    var PEAK = 44, PEAK_R = 21, SHOULDER = 5;
    var LONG = 2.0, WIDE = 0.82, LEAN = 0.5, WARP = 26, RIDGE = 0.42, STEEP = 1.05;
    var PEAK2 = 30, PEAK2_R = 16, MX2 = W * 0.18, MZ2 = 24;
    var TERRACE = 2, TERRACE_FROM = 30;

    var raw = new Float32Array(W * D);
    for (z = 0; z < D; z++) {
      for (x = 0; x < W; x++) {
        var e = big(x / 46, z / 46) * 0.62 + mid(x / 17, z / 17) * 0.26 + fine(x / 6, z / 6) * 0.12;
        var h = 6 + e * 15;
        var dx = x - mx, dz = z - mz, dm = Math.sqrt(dx * dx + dz * dz);

        // Warped, leaning, ridged.
        var wx = dx + (warpA(x / 31, z / 31) - 0.5) * WARP;
        var wz = dz + (warpB(x / 31, z / 31) - 0.5) * WARP;
        var ca = Math.cos(LEAN), sa = Math.sin(LEAN);
        var ax = (wx * ca + wz * sa) / (PEAK_R * LONG);
        var az = (-wx * sa + wz * ca) / (PEAK_R * WIDE);
        var m = Math.exp(-(ax * ax + az * az) / 2);
        // 1 - |2n - 1| puts a crest wherever the field crosses its middle.
        var r1 = 1 - Math.abs(ridgeA(x / 27, z / 27) * 2 - 1);
        var r2 = 1 - Math.abs(ridgeB(x / 12, z / 12) * 2 - 1);
        var r3 = 1 - Math.abs(ridgeC(x / 5.5, z / 5.5) * 2 - 1);
        var rg = r1 * 0.58 + r2 * 0.29 + r3 * 0.13;
        rg = rg * rg * (3 - 2 * rg);
        m *= (1 - RIDGE) + RIDGE * rg;
        m = Math.pow(m, STEEP);
        h += PEAK * m + SHOULDER * Math.exp(-(dm * dm) / (2 * 34 * 34));

        // The second massif, lower and off to one side.
        var bx = x - MX2 + (warpA(x / 24, z / 24) - 0.5) * WARP * 0.8;
        var bz = z - MZ2 + (warpB(x / 24, z / 24) - 0.5) * WARP * 0.8;
        var b2 = Math.exp(-((bx * bx) / (2 * PEAK2_R * 1.9 * PEAK2_R * 1.9)
                          + (bz * bz) / (2 * PEAK2_R * PEAK2_R)));
        var q1 = 1 - Math.abs(ridgeB(x / 23, z / 23) * 2 - 1);
        var q2 = 1 - Math.abs(ridgeC(x / 10, z / 10) * 2 - 1);
        var qg = q1 * 0.66 + q2 * 0.34;
        h += PEAK2 * b2 * ((1 - RIDGE) + RIDGE * qg * qg * (3 - 2 * qg));

        // Shelves, above the rock line only, so the meadow keeps its roll.
        if (h > TERRACE_FROM) {
          var over = h - TERRACE_FROM;
          h = TERRACE_FROM + (Math.round(over / TERRACE) * TERRACE) * 0.75 + over * 0.25;
        }
        raw[z * W + x] = h;
      }
      if (z % 22 === 21) yield;
    }
    // The clearing: the ground around the camera eases to the camera's own
    // level, so it stands on a flat rather than in a pit or on a mound.
    var h0 = raw[camZ * W + camX];
    for (z = 0; z < D; z++) {
      for (x = 0; x < W; x++) {
        var cx = x - camX, cz = z - camZ, dc = Math.sqrt(cx * cx + cz * cz);
        var hh = raw[z * W + x];
        if (dc < 8) { var k = Math.min(1, dc / 8); k = k * k * (3 - 2 * k); hh = hh * k + h0 * (1 - k); }
        height[z * W + x] = Math.max(2, Math.min(H - 8, Math.round(hh)));
      }
    }
    var camY = height[camZ * W + camX];
    yield;

    // The village: every piece gets a level plot at the median height of
    // the ground it covers, the way the game cuts a plot for each building,
    // and the ring around a plot steps at most one block to meet it.
    var village = villagePlan(camX, camZ);
    var plots = [], box = { x0: W, z0: D, x1: 0, z1: 0 };
    village.pieces.forEach(function (p) {
      var q = { x0: p.x - p.pad, z0: p.z - p.pad, x1: p.x + p.s.w - 1 + p.pad, z1: p.z + p.s.d - 1 + p.pad };
      var hs = [];
      for (z = q.z0; z <= q.z1; z++) for (x = q.x0; x <= q.x1; x++) hs.push(height[z * W + x]);
      hs.sort(function (a, b) { return a - b; });
      p.base = q.base = hs[hs.length >> 1];
      plots.push(q);
      box.x0 = Math.min(box.x0, q.x0 - 2); box.z0 = Math.min(box.z0, q.z0 - 2);
      box.x1 = Math.max(box.x1, q.x1 + 2); box.z1 = Math.max(box.z1, q.z1 + 2);
    });
    plots.forEach(function (q) {
      for (z = q.z0; z <= q.z1; z++) for (x = q.x0; x <= q.x1; x++) { height[z * W + x] = q.base; reserved[z * W + x] = 1; }
    });
    plots.forEach(function (q) {
      for (z = q.z0 - 1; z <= q.z1 + 1; z++) for (x = q.x0 - 1; x <= q.x1 + 1; x++) {
        col = z * W + x;
        if (!reserved[col]) height[col] = Math.max(q.base - 1, Math.min(q.base + 1, height[col]));
      }
    });

    // The pond: a basin dug below its own water line, three deep in the
    // middle, with a shore around it brought up to that same line.
    //
    // The shore is what was missing until 2026-09-04. The pond is an ellipse
    // stamped onto a meadow that knows nothing about it, so wherever the
    // meadow fell away under the water line the pond stood proud of the
    // grass: a wall of water blocks with the bank below it, which is the one
    // thing water never does in Minecraft, because it would run out. Lifting
    // the ring to the water line is how the game's own ponds sit — held in a
    // hollow — and it earns the sandy edge for free, since a column at the
    // water line is exactly what the beach rule below is looking for.
    var pond = village.pond;
    var SHORE = 1.15;   // a block of sand at the water's edge
    var BANK = 2.0;     // and a few more easing back down to the meadow
    for (z = 0; z < D; z++) {
      for (x = 0; x < W; x++) {
        var px = (x + 0.5 - pond.x) / pond.rx, pz = (z + 0.5 - pond.z) / pond.rz, pd = Math.sqrt(px * px + pz * pz);
        if (pd >= BANK) continue;
        col = z * W + x;
        reserved[col] = 1;

        if (pd < 1) {
          waterAt[col] = pond.level;
          height[col] = Math.min(height[col], pond.level - 1 - Math.floor(2.5 * (1 - pd * pd)));
        } else if (pd < SHORE) {
          // The rim itself, level with the water. Marking the water line here
          // as well is what earns the sandy edge from the beach rule below.
          waterAt[col] = pond.level;
          // The rim may lift the ground it finds by ONE block and no more
          // (2026-09-10). Unbounded, it built a wall all the way up to the
          // water line wherever the meadow sat lower, and the pond ended up
          // standing ON the field behind a sand lip - a swimming pool, as
          // Adrian put it. Held to a block it can only sit where the ground
          // already dips, and the settle pass below still cannot drain it.
          height[col] = Math.max(height[col], Math.min(pond.level, height[col] + 1));
        } else {
          // And back down to the meadow over a few blocks rather than in one
          // step, or the shore stands on the grass like a plinth.
          var t = (pd - SHORE) / (BANK - SHORE);
          height[col] = Math.max(height[col],
            Math.round(pond.level + (height[col] - pond.level) * t));
        }
      }
    }

    // And then the water settles, everywhere, as a guarantee rather than a
    // repair: any column of water with a lower dry neighbour drops to that
    // neighbour's level, over and over until nothing moves. The shore above
    // means the pond has nowhere to go, so it keeps its size; anything the
    // terrain does elsewhere — the sea line cutting a slope, a future pool —
    // cannot leave a face of water standing in the air.
    var NEIGHBOURS = [-1, 1, -W, W];
    for (var settle = 0; settle < 16; settle++) {
      var moved = 0;
      for (z = 1; z < D - 1; z++) {
        for (x = 1; x < W - 1; x++) {
          col = z * W + x;
          if (waterAt[col] <= height[col]) continue;

          var held = waterAt[col];
          for (var n = 0; n < 4; n++) {
            var nc = col + NEIGHBOURS[n];
            var wall = Math.max(height[nc], waterAt[nc]);
            if (wall < held) held = wall;
          }
          if (held < waterAt[col]) { waterAt[col] = held; moved++; }
        }
      }
      if (!moved) break;
    }
    yield;

    for (z = 0; z < D; z++) {
      for (x = 0; x < W; x++) {
        col = z * W + x;
        var top = height[col], wl = waterAt[col];
        var steep = Math.max(
          Math.abs(top - height[z * W + Math.max(0, x - 1)]),
          Math.abs(top - height[z * W + Math.min(W - 1, x + 1)]),
          Math.abs(top - height[Math.max(0, z - 1) * W + x]),
          Math.abs(top - height[Math.min(D - 1, z + 1) * W + x]));
        var inVillage = x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1;
        for (y = 0; y <= top; y++) {
          var b;
          if (y < top - 3) b = STONE;
          else if (y < top) b = top >= 29 ? STONE : DIRT;
          else if (top <= wl + 1) b = SAND;
          // The snow line wanders a few blocks instead of following a
          // contour, and snow will not lie on a cliff - which is what gives
          // a peak its grey streaks rather than a clean white cap.
          else if (top >= 36 + (snowN(x / 8, z / 8) - 0.5) * 6 && steep < 3) b = SNOW;
          else if (top >= 28 || (steep >= 3 && !inVillage)) b = STONE;
          else b = GRASS;
          blocks[idx(x, y, z)] = b;
        }
        for (y = top + 1; y <= wl; y++) blocks[idx(x, y, z)] = WATER;
      }
      if (z % 44 === 43) yield;
    }

    /* One thread of lava down a flank (2026-09-10). It starts high on the
       slope, under the snow, at the steepest spot facing the camera, then
       walks downhill a block at a time to whichever neighbour is lowest -
       so it follows a gully the terrain already has rather than being drawn
       on top of it. It stops when it reaches the meadow, because lava
       running into the village is a different kind of picture. */
    (function lava() {
      var from = null;
      for (var sx = 58; sx < 122; sx += 2) {
        for (var sz = 12; sz < 48; sz += 2) {
          var hh = height[sz * W + sx];
          if (hh < 30 || hh > 38) continue;
          var drop = hh - height[(sz + 1) * W + sx];
          if (!from || drop > from.drop) from = { x: sx, z: sz, drop: drop };
        }
      }
      if (!from) return;
      var STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var lx = from.x, lz = from.z;
      for (var step = 0; step < 54; step++) {
        var col = lz * W + lx, top = height[col];
        if (top < 24) break;

        var next = null;
        for (var n = 0; n < 4; n++) {
          var nx = lx + STEPS[n][0], nz = lz + STEPS[n][1];
          if (nx < 1 || nz < 1 || nx >= W - 1 || nz >= D - 1) continue;
          var nh = height[nz * W + nx];
          if (nh >= top) continue;
          if (!next || nh < next.h) next = { x: nx, z: nz, h: nh };
        }

        /* A fluid is not a stack of cubes, and the game draws it as two
           different things (Adrian, 2026-09-10: "the lava is only the blocks
           at the moment, not the half blocks").

           WHERE IT RUNS ACROSS THE GROUND it is a thin skin ON TOP of the
           block, and that skin gets shallower the further it is from its
           source - the game's own levels, (8 - level) / 9 of a block. Drawn
           as a shape, which is what world.shapes is for, so the stone it
           runs over keeps its own face underneath.

           WHERE IT FALLS DOWN A WALL it is a full column, so those blocks
           stay whole. Filling from just above the next column's top up to
           this one's own top is what paints the face you see from the
           meadow; six blocks at a time, or one long drop becomes a sheet. */
        var level = 1 + Math.floor(step * 6 / 54);        // 1 at the head, 7 at the tail
        if (blocks[idx(lx, top + 1, lz)] === AIR) {
          shapes.push({ kind: 'fluid', mat: LAVA, h: (8 - level) / 9, x: lx, y: top + 1, z: lz });
          blocks[idx(lx, top + 1, lz)] = SHAPE;
        }
        if (next && next.h < top) {
          for (var fy = Math.max(next.h + 1, top - 6); fy <= top; fy++) blocks[idx(lx, fy, lz)] = LAVA;
        }

        if (!next) break;
        lx = next.x; lz = next.z;
      }
    })();

    // Lanes of packed dirt, two blocks wide, and a plaza around the well
    // with cobblestone worked into it.
    function pave(px, pz, cobble) {
      if (px < 0 || pz < 0 || px >= W || pz >= D) return;
      var c = pz * W + px, t = height[c], a = idx(px, t, pz);
      if (t <= waterAt[c]) return;
      if (blocks[a] !== GRASS && blocks[a] !== DIRT && blocks[a] !== COARSE) return;
      blocks[a] = cobble ? COBBLE : PATH;
      reserved[c] = 1;
    }
    village.lanes.forEach(function (l) {
      var ldx = l[2] - l[0], ldz = l[3] - l[1], n = Math.max(Math.abs(ldx), Math.abs(ldz), 1);
      var eastWest = Math.abs(ldx) >= Math.abs(ldz);
      for (i = 0; i <= n; i++) {
        var lx = Math.round(l[0] + ldx * i / n), lz = Math.round(l[1] + ldz * i / n);
        pave(lx, lz, false);
        if (eastWest) pave(lx, lz + 1, false); else pave(lx + 1, lz, false);
      }
    });
    var plaza = village.plaza;
    for (z = plaza.z0; z <= plaza.z1; z++) for (x = plaza.x0; x <= plaza.x1; x++) pave(x, z, rnd() < 0.3);

    // A tree needs room: no other trunk and nothing built within two blocks,
    // so crowns meet without one tree's trunk standing in another's crown.
    function room(px, pz) {
      for (var j = -2; j <= 2; j++) for (var k2 = -2; k2 <= 2; k2++) {
        var c = (pz + j) * W + px + k2;
        if (trunks[c] || reserved[c]) return false;
      }
      return true;
    }

    yield;

    // Plants and trees on the grass.
    for (z = 2; z < D - 2; z++) {
      for (x = 2; x < W - 2; x++) {
        var t = height[z * W + x];
        if (blocks[idx(x, t, z)] !== GRASS) continue;
        var cx2 = x - camX, cz2 = z - camZ, near = Math.sqrt(cx2 * cx2 + cz2 * cz2);
        var w = wood(x / 21, z / 21), r = rnd();

        // A meadow opens northward from the camera, so the first view is
        // flowers, then the village, then the mountain standing in the
        // fog — not a wall of leaves with a button stack on it.
        var meadow = cz2 < 0 && near < 54 && Math.abs(cx2) < -cz2 * 0.88 + 4;

        if (w > 0.56 && r < 0.07 && near > 13 && t < 24 && !meadow && room(x, z)) {
          var species = kind(x / 30, z / 30);
          // Oak and birch only (Adrian, 2026-09-10). The spruce came out of
          // the mix; birch takes a little over half of what is left.
          tree(blocks, x, t + 1, z, species > 0.45 ? 2 : 0, rnd);
          trunks[z * W + x] = 1;
          continue;
        }
        if (near < 3) continue;
        // Grass thins with distance: far off it is only shimmer.
        if (r < (near < 34 ? 0.28 : 0.13)) blocks[idx(x, t + 1, z)] = TUFT;
        // Half as many flowers as of 2026-09-10 (Adrian: "reduce the amount
        // of flowers by roughly 50%"). The band is halved rather than the
        // noise gate raised, so they thin out evenly instead of the patches
        // they grow in getting smaller: r already runs past the tuft test
        // above, so the flower band is [tuft, 0.62) and this halves it.
        else if (flowers(x / 9, z / 9) > 0.24 && r < (near < 34 ? 0.45 : 0.375)) {
          var f = rnd();
          blocks[idx(x, t + 1, z)] = f < 0.35 ? DANDELION : f < 0.7 ? POPPY : f < 0.85 ? BLUET : CORNFLOWER;
        }
      }
      if (z % 44 === 43) yield;
    }

    var world = { blocks: blocks, height: height, camY: camY, shapes: shapes };
    village.pieces.forEach(function (p) { stamp(world, p.s, p.x, p.z, p.base); });
    return world;
  }

  /* Oak (0), spruce (1) and birch (2) — the shapes the game grows. The trunk
     is set through anything but ground and other trunks, leaves only into
     open air, so where two crowns meet each trunk still runs unbroken from
     the ground to its own top. */
  function tree(blocks, x, y, z, species, rnd) {
    var log = species === 1 ? SPRUCE_LOG : species === 2 ? BIRCH_LOG : LOG;
    var leaf = species === 1 ? SPRUCE_LEAVES : species === 2 ? BIRCH_LEAVES : LEAVES;
    var trunk = species === 1 ? 6 + Math.floor(rnd() * 3)
              : species === 2 ? 5 + Math.floor(rnd() * 3)   // a birch stands taller
              : 4 + Math.floor(rnd() * 3);
    if (y + trunk + 3 >= H) return;
    var i, j, k;

    function put(px, py, pz, b, through) {
      if (px < 0 || pz < 0 || px >= W || pz >= D || py < 0 || py >= H) return;
      var at = idx(px, py, pz), cur = blocks[at];
      if (cur === AIR || isPlant(cur) || (through && isLeaves(cur))) blocks[at] = b;
    }

    if (species === 1) {
      // A spruce: a cone of leaves, narrow at the top.
      for (i = 0; i < trunk; i++) put(x, y + i, z, log, true);
      var levels = [1, 2, 1, 2, 1, 1, 0];
      for (k = 0; k < levels.length; k++) {
        var ly = y + trunk - 1 - k, rad = levels[k] + (k > 2 && k < 6 ? 1 : 0);
        for (i = -rad; i <= rad; i++) for (j = -rad; j <= rad; j++) {
          if (Math.abs(i) === rad && Math.abs(j) === rad && rad > 1) continue;
          put(x + i, ly, z + j, leaf);
        }
      }
      put(x, y + trunk, z, leaf);
      return;
    }

    for (i = 0; i < trunk; i++) put(x, y + i, z, log, true);
    /* The crown the game builds: two rows five across at the bottom, two rows
       three across above them, corners cut from the wide rows. Corrected
       2026-09-10 against the game's own blob - two things were wrong. The
       three-wide rows were losing all four corners, which left a plus where
       there should be a crown; and a single leaf was being set one block
       above the top row, giving every tree a nub the game never grows. */
    for (k = 0; k < 4; k++) {
      var yy = y + trunk - 3 + k, rr = k < 2 ? 2 : 1;
      for (i = -rr; i <= rr; i++) for (j = -rr; j <= rr; j++) {
        if (i === 0 && j === 0 && k < 3) continue;
        var corner = Math.abs(i) === rr && Math.abs(j) === rr;
        // The wide rows always lose their corners; the top row loses them
        // about half the time, so no two trees finish the same way.
        if (corner && (rr === 2 || (k === 3 && rnd() < 0.5))) continue;
        put(x + i, yy, z + j, leaf);
      }
    }
  }

  /* Sky light down each column: full in the open, a step dimmer under each
     layer of leaves, and none at all under anything solid. Then it spreads
     sideways a few blocks, the way the game's does, so a wall under an eave
     and a room behind a window are dim rather than black. */
  function skylight(blocks) {
    var steps = lighting(blocks), step;
    while (!(step = steps.next()).done) { /* to the end */ }
    return step.value;
  }

  /* The same in four pieces, for the launcher's build (see generating). */
  function* lighting(blocks) {
    var sky = new Uint8Array(W * H * D);
    var x, y, z, at;
    for (z = 0; z < D; z++) {
      for (x = 0; x < W; x++) {
        var light = 15;
        for (y = H - 1; y >= 0; y--) {
          var b = blocks[idx(x, y, z)];
          sky[idx(x, y, z)] = light;
          if (blocksSky(b)) light = 0;
          else if (isLeaves(b)) light = Math.max(0, light - 2);
          else if (b === WATER) light = Math.max(0, light - 1);
        }
      }
    }
    yield;
    var up = W * D;
    for (var pass = 0; pass < 3; pass++) {
      for (y = 1; y < H - 1; y++) {
        for (z = 1; z < D - 1; z++) {
          for (x = 1; x < W - 1; x++) {
            at = idx(x, y, z);
            if (sky[at] === 15 || isOpaque(blocks[at])) continue;
            var m = sky[at];
            if (sky[at - 1] - 1 > m) m = sky[at - 1] - 1;
            if (sky[at + 1] - 1 > m) m = sky[at + 1] - 1;
            if (sky[at - W] - 1 > m) m = sky[at - W] - 1;
            if (sky[at + W] - 1 > m) m = sky[at + W] - 1;
            if (sky[at - up] - 1 > m) m = sky[at - up] - 1;
            if (sky[at + up] - 1 > m) m = sky[at + up] - 1;
            sky[at] = m;
          }
        }
      }
      if (pass < 2) yield;
    }
    return sky;
  }

  /* ---------------------------------------------------------------- mesh */

  /* The six directions: normal, the four corners of the face in winding
     order, and the two tangent axes used for the corner shading. */
  var DIRS = [
    { n: [0, 1, 0], side: 0, shade: 1.0,
      c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    { n: [0, -1, 0], side: 1, shade: 0.5,
      c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { n: [0, 0, 1], side: 2, shade: 0.8,
      c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    { n: [0, 0, -1], side: 2, shade: 0.8,
      c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    { n: [1, 0, 0], side: 2, shade: 0.6,
      c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    { n: [-1, 0, 0], side: 2, shade: 0.6,
      c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]] }
  ];

  var AO = [1.0, 0.82, 0.66, 0.52];

  function brightness(sky) {
    var f = sky / 15;
    return 0.16 + 0.84 * Math.pow(f, 1.35);
  }

  /* A list of floats written straight into typed arrays (2026-09-22). The
     mesh used to be pushed onto plain arrays — six and a half million
     numbers, each face first built as four small arrays of its own — and
     copied into a Float32Array at the end: most of the half-second the world
     took to build went there, not into the world. The numbers stored are the
     same expressions, rounded to a float the same way, so the mesh comes out
     bit for bit what it was.

     It fills fixed chunks rather than one array that doubles, so nothing is
     copied until the end and then only once. Every write is a whole quad or
     a few (42 floats a quad) and never straddles two chunks. */
  var CHUNK = 42 * 8192;
  function Floats() { this.chunks = []; this.used = []; this.a = null; this.n = 0; }
  Floats.prototype.room = function (k) {
    if (this.a && this.n + k <= CHUNK) return;
    if (this.a) this.used.push(this.n);
    this.a = new Float32Array(CHUNK);
    this.chunks.push(this.a);
    this.n = 0;
  };
  /* Every float written, in the order written, in one array. */
  Floats.prototype.done = function () {
    var used = this.used.concat(this.a ? [this.n] : []), total = 0, i;
    for (i = 0; i < used.length; i++) total += used[i];
    var out = new Float32Array(total), at = 0;
    for (i = 0; i < used.length; i++) { out.set(this.chunks[i].subarray(0, used[i]), at); at += used[i]; }
    return out;
  };

  var ORDER = [0, 1, 2, 0, 2, 3], FLIPPED = [1, 2, 3, 1, 3, 0];
  var PLANT_QUADS = [
    [[0, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 0]],
    [[1, 0, 1], [0, 0, 0], [0, 1, 0], [1, 1, 1]],
    [[0, 0, 1], [1, 0, 0], [1, 1, 0], [0, 1, 1]],
    [[1, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 0]]
  ];
  var PLANT_UV = [[0, 1], [1, 1], [1, 0], [0, 0]];

  /**
   * The mesh, a band of layers at a time: rows(y0, y1) meshes the blocks in
   * those layers, finish() adds the shapes and hands back the three lists.
   * Meshing every layer in order and then finishing is the whole mesh, in
   * the order it has always been built — see mesh() below.
   */
  function mesher(world) {
    var blocks = world.blocks, sky = world.sky;
    var opaque = new Floats(), cutout = new Floats(), water = new Floats();
    var ao = [0, 0, 0, 0];

    function at(px, py, pz) {
      if (px < 0 || py < 0 || pz < 0 || px >= W || py >= H || pz >= D) return AIR;
      return blocks[idx(px, py, pz)];
    }
    function lightAt(px, py, pz) {
      if (px < 0 || py < 0 || pz < 0 || px >= W || py >= H || pz >= D) return 15;
      return sky[idx(px, py, pz)];
    }

    /* Smooth lighting: a corner is darker for each of the two edge blocks
       and the diagonal block beside it that occlude. */
    function corner(px, py, pz, n, cx, cy, cz) {
      // The three cells around this corner, on the lit side of the face.
      var ax = px + n[0], ay = py + n[1], az = pz + n[2];
      var ex = cx * 2 - 1, ey = cy * 2 - 1, ez = cz * 2 - 1;
      var s1, s2, c;
      if (n[1] !== 0) {
        s1 = occludes(at(ax + ex, ay, az)); s2 = occludes(at(ax, ay, az + ez)); c = occludes(at(ax + ex, ay, az + ez));
      } else if (n[0] !== 0) {
        s1 = occludes(at(ax, ay + ey, az)); s2 = occludes(at(ax, ay, az + ez)); c = occludes(at(ax, ay + ey, az + ez));
      } else {
        s1 = occludes(at(ax + ex, ay, az)); s2 = occludes(at(ax, ay + ey, az)); c = occludes(at(ax + ex, ay + ey, az));
      }
      return (s1 && s2) ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0);
    }

    /**
     * One quad. `top` is how tall the block is drawn, for water: the game
     * draws a still surface two pixels down from the top of its block, which
     * is what stops a pond reading as a stack of blue cubes — the bank's lip
     * stands above it and the shore stays visible.
     */
    function face(list, px, py, pz, dir, layer, light, shade, top) {
      var tall = top === undefined ? 1 : top;
      // Flip the quad's diagonal when the darker corners sit across it, so
      // the shading does not streak — the same trick the game uses.
      var order = shade && (shade[0] + shade[2] > shade[1] + shade[3]) ? FLIPPED : ORDER;
      list.room(42);
      var a = list.a, n = list.n;
      for (var i = 0; i < 6; i++) {
        var k = order[i], c = dir.c[k], t = dir.uv[k];
        a[n++] = px + c[0]; a[n++] = py + c[1] * tall; a[n++] = pz + c[2];
        a[n++] = t[0]; a[n++] = t[1]; a[n++] = layer;
        a[n++] = light * (shade ? AO[shade[k]] : 1);
      }
      list.n = n;
    }

    function plant(px, py, pz, layer, light) {
      // Two crossed quads, both sides.
      cutout.room(168);
      var a = cutout.a, n = cutout.n;
      for (var q = 0; q < 4; q++) {
        for (var i = 0; i < 6; i++) {
          var c = PLANT_QUADS[q][ORDER[i]], t = PLANT_UV[ORDER[i]];
          a[n++] = px + c[0]; a[n++] = py + c[1]; a[n++] = pz + c[2];
          a[n++] = t[0]; a[n++] = t[1]; a[n++] = layer; a[n++] = light;
        }
      }
      cutout.n = n;
    }

    function rows(y0, y1) {
      for (var y = y0; y < y1; y++) {
        for (var z = 0; z < D; z++) {
          for (var x = 0; x < W; x++) {
            var b = blocks[idx(x, y, z)];
            if (b === AIR || b === SHAPE) continue;

            if (isPlant(b)) {
              plant(x, y, z, PLANT[b], brightness(lightAt(x, y, z)) * 0.92);
              continue;
            }

            for (var d = 0; d < 6; d++) {
              var dir = DIRS[d];
              var nx = x + dir.n[0], ny = y + dir.n[1], nz = z + dir.n[2];
              var nb = at(nx, ny, nz);

              if (b === WATER) {
                if (nb === WATER) continue;
                if (d === 1) continue;
                if (nb !== AIR && !isPlant(nb)) continue;
                var wl = brightness(lightAt(nx, ny, nz)) * dir.shade;
                // Only the surface is cut down; water with water above it is a
                // full block, or the body would be sliced at every level.
                face(water, x, y, z, dir, LAYER.water, wl, null,
                     at(x, y + 1, z) === WATER ? 1 : SURFACE);
                continue;
              }

              if (isCutout(b)) {
                if (nb === b || isOpaque(nb)) continue;
              } else if (isOpaque(nb)) {
                continue;
              }
              var light = brightness(lightAt(nx, ny, nz)) * dir.shade;
              ao[0] = corner(x, y, z, dir.n, dir.c[0][0], dir.c[0][1], dir.c[0][2]);
              ao[1] = corner(x, y, z, dir.n, dir.c[1][0], dir.c[1][1], dir.c[1][2]);
              ao[2] = corner(x, y, z, dir.n, dir.c[2][0], dir.c[2][1], dir.c[2][2]);
              ao[3] = corner(x, y, z, dir.n, dir.c[3][0], dir.c[3][1], dir.c[3][2]);
              var layer = FACES[b][dir.side];
              face(isCutout(b) ? cutout : opaque, x, y, z, dir, layer, light, ao);
            }
          }
        }
      }
    }

    /* Stairs, slabs, doors and posts: boxes inside their cell, every face
       drawn, lit by the cell's own light, cut from the block's texture the
       way the game cuts a slab's — a half block shows half the tile. */
    function uvOf(dir, lx, ly, lz) {
      if (dir.n[1] !== 0) return [lx, lz];
      if (dir.n[2] > 0) return [lx, 1 - ly];
      if (dir.n[2] < 0) return [1 - lx, 1 - ly];
      if (dir.n[0] > 0) return [1 - lz, 1 - ly];
      return [lz, 1 - ly];
    }
    function box(list, px, py, pz, b0, b1, faces, light) {
      for (var d = 0; d < 6; d++) {
        var dir = DIRS[d], layer = faces[dir.side], l = light * dir.shade, v = [], i;
        for (i = 0; i < 4; i++) {
          var c = dir.c[i];
          var lx = b0[0] + c[0] * (b1[0] - b0[0]), ly = b0[1] + c[1] * (b1[1] - b0[1]), lz = b0[2] + c[2] * (b1[2] - b0[2]);
          var uv = uvOf(dir, lx, ly, lz);
          v.push([px + lx, py + ly, pz + lz, uv[0], uv[1], layer, l]);
        }
        list.room(42);
        for (i = 0; i < 6; i++) {
          var q = v[ORDER[i]];
          for (var k = 0; k < 7; k++) list.a[list.n++] = q[k];
        }
      }
    }
    function finish() {
      (world.shapes || []).forEach(function (s) {
        var light = brightness(lightAt(s.x, s.y, s.z));
        var faces = FACES[s.mat] || FACES[PLANKS];
        if (s.kind === 'stair') {
          box(opaque, s.x, s.y, s.z, [0, 0, 0], [1, 0.5, 1], faces, light);
          var b0 = [0, 0.5, 0], b1 = [1, 1, 1];
          if (s.back === 'v') b0[2] = 0.5; else if (s.back === '^') b1[2] = 0.5;
          else if (s.back === '>') b0[0] = 0.5; else b1[0] = 0.5;
          box(opaque, s.x, s.y, s.z, b0, b1, faces, light);
        } else if (s.kind === 'fluid') {
          // A running fluid: full across, and only as deep as its level.
          box(opaque, s.x, s.y, s.z, [0, 0, 0], [1, s.h, 1], faces, light);
        } else if (s.kind === 'slab') {
          box(opaque, s.x, s.y, s.z, [0, 0, 0], [1, 0.5, 1], faces, light);
        } else if (s.kind === 'post') {
          box(opaque, s.x, s.y, s.z, [6 / 16, 0, 6 / 16], [10 / 16, 1, 10 / 16], faces, light);
        } else if (s.kind === 'door') {
          var tile = s.part ? LAYER.door_top : LAYER.door_bottom;
          box(cutout, s.x, s.y, s.z, [0, 0, 13 / 16], [1, 1, 1], [tile, tile, tile], light);
        }
      });
      return { opaque: opaque.done(), cutout: cutout.done(), water: water.done() };
    }

    return { rows: rows, finish: finish };
  }

  /* The whole mesh in one go. */
  function mesh(world) {
    var m = mesher(world);
    m.rows(0, H);
    return m.finish();
  }

  /* Slices of the world around the eye (2026-09-22). The camera stands in
     one place and only turns, so the mesh is cut once into wedges about the
     eye — SECTORS of them, plus the few blocks round its feet — and a frame
     draws only the wedges its view can reach. Until today every frame drew
     all of it, the two thirds behind the camera included, and each wedge is
     laid out nearest first so a face in front is drawn before the faces it
     hides and the card can skip them. Nothing else moves: the same quads,
     byte for byte, only in another order, and a wedge is left out only when
     its whole box lies outside the view — the picture is the same one. */
  var SECTORS = 32, RING = 8, RINGS = 16, NEAR = 12;

  function arrange(data, ex, ez) {
    var quads = data.length / 42, groups = 1 + SECTORS * RINGS;
    var key = new Uint16Array(quads), start = new Uint32Array(groups + 1);
    var q, i, o;
    for (q = 0; q < quads; q++) {
      o = q * 42;
      var cx = 0, cz = 0;
      for (i = 0; i < 6; i++) { cx += data[o + i * 7]; cz += data[o + i * 7 + 2]; }
      var dx = cx / 6 - ex, dz = cz / 6 - ez, dist = Math.sqrt(dx * dx + dz * dz);
      var k = 0;
      if (dist >= NEAR) {
        var sector = Math.floor((Math.atan2(dx, dz) / (2 * Math.PI) + 0.5) * SECTORS) % SECTORS;
        k = 1 + sector * RINGS + Math.min(RINGS - 1, Math.floor(dist / RING));
      }
      key[q] = k;
      start[k + 1]++;
    }
    for (i = 0; i < groups; i++) start[i + 1] += start[i];

    // The near group, then each wedge from the eye outward.
    var out = new Float32Array(data.length), next = start.slice(0, groups);
    for (q = 0; q < quads; q++) {
      out.set(data.subarray(q * 42, q * 42 + 42), next[key[q]]++ * 42);
    }

    // Each slice's run of vertices and the box round them, a block larger
    // all round so the test never trims a face at its edge.
    function slice(from, to) {
      var box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (var v = from * 6; v < to * 6; v++) {
        for (var a = 0; a < 3; a++) {
          var c = out[v * 7 + a];
          if (c < box[a]) box[a] = c;
          if (c > box[a + 3]) box[a + 3] = c;
        }
      }
      for (var b = 0; b < 3; b++) { box[b] -= 1; box[b + 3] += 1; }
      return { first: from * 6, count: (to - from) * 6, box: box };
    }
    var sectors = [];
    for (var s = 0; s < SECTORS; s++) sectors.push(slice(start[1 + s * RINGS], start[1 + (s + 1) * RINGS]));
    return { data: out, near: slice(0, start[1]), sectors: sectors };
  }

  /* ------------------------------------------------------------- textures */

  function load(src) {
    return new Promise(function (ok, no) {
      var image = new Image();
      image.onload = function () { ok(image); };
      image.onerror = function () { no(new Error('missing ' + src)); };
      image.src = src;
    });
  }

  /* A tile is a 16x16 canvas, and it must be a canvas the CPU holds
     (2026-09-15). Left to itself the browser puts even a canvas this small
     on the graphics card, and the first texSubImage3D that reads one back
     into the texture array then waits for the card to finish everything it
     has been handed since the page opened: 575 ms, measured, in one call,
     in the very second the launcher's window comes up — Adrian: "the first 1
     or 2 page switches or button clicks is laggy". willReadFrequently keeps
     the tile in ordinary memory, where a 16x16 read is a copy of a kilobyte;
     the same seventy-three uploads then take five milliseconds between them.
     A canvas keeps the context it was first asked for, so this is the one
     place the flag has to be said. */
  function tile() {
    var c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    c.getContext('2d', { willReadFrequently: true });
    return c;
  }

  /* An image multiplied by a colour, its own alpha kept. */
  function tinted(image, rgb, sx, sy) {
    var c = tile(), ctx = c.getContext('2d');
    ctx.drawImage(image, sx || 0, sy || 0, 16, 16, 0, 0, 16, 16);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(' + rgb.join(',') + ')';
    ctx.fillRect(0, 0, 16, 16);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(image, sx || 0, sy || 0, 16, 16, 0, 0, 16, 16);
    return c;
  }

  function plain(image) {
    var c = tile(), ctx = c.getContext('2d');
    ctx.drawImage(image, 0, 0, 16, 16, 0, 0, 16, 16);
    return c;
  }

  /* One image laid over another. */
  function over(under, top) {
    var c = plain(under), ctx = c.getContext('2d');
    ctx.drawImage(top, 0, 0, 16, 16, 0, 0, 16, 16);
    return c;
  }

  /* The grass block's side: dirt with the grass overlay tinted over it. */
  function grassSide(side, overlay) {
    var c = plain(side), ctx = c.getContext('2d');
    ctx.drawImage(tinted(overlay, TINT_GRASS), 0, 0);
    return c;
  }

  /* One face of the right arm, cut from the skin with its sleeve over it. */
  function armFace(skin, u, v, w, h) {
    var c = tile(), ctx = c.getContext('2d');
    ctx.drawImage(skin, u, v, w, h, 0, 0, w, h);
    ctx.drawImage(skin, u, v + 16, w, h, 0, 0, w, h);
    return c;
  }

  function buildLayers(img) {
    var out = [];
    out[LAYER.grass_top] = tinted(img.grass_top, TINT_GRASS);
    out[LAYER.grass_side] = grassSide(img.grass_side, img.grass_overlay);
    out[LAYER.dirt] = plain(img.dirt);
    out[LAYER.stone] = plain(img.stone);
    out[LAYER.sand] = plain(img.sand);
    out[LAYER.log] = plain(img.log);
    out[LAYER.log_top] = plain(img.log_top);
    out[LAYER.leaves] = tinted(img.leaves, TINT_LEAF);
    out[LAYER.snow] = plain(img.snow);
    out[LAYER.tuft] = tinted(img.tuft, TINT_GRASS);
    out[LAYER.poppy] = plain(img.poppy);
    out[LAYER.dandelion] = plain(img.dandelion);
    out[LAYER.bluet] = plain(img.bluet);
    out[LAYER.cornflower] = plain(img.cornflower);
    out[LAYER.gravel] = plain(img.gravel);
    out[LAYER.cobble] = plain(img.cobble);
    out[LAYER.coarse] = plain(img.coarse);
    out[LAYER.spruce_log] = plain(img.spruce_log);
    out[LAYER.spruce_log_top] = plain(img.log_top);
    out[LAYER.spruce_leaves] = tinted(img.spruce_leaves, TINT_SPRUCE);
    out[LAYER.birch_log] = plain(img.birch_log);
    out[LAYER.birch_log_top] = plain(img.log_top);
    out[LAYER.birch_leaves] = tinted(img.birch_leaves, TINT_BIRCH);
    out[LAYER.planks] = plain(img.planks);
    out[LAYER.glass] = plain(img.glass);
    out[LAYER.path_top] = plain(img.path_top);
    out[LAYER.path_side] = over(img.dirt, img.path_side);
    out[LAYER.hay_top] = plain(img.hay_top);
    out[LAYER.hay_side] = plain(img.hay_side);
    out[LAYER.farmland] = plain(img.farmland);
    out[LAYER.wheat] = plain(img.wheat);
    out[LAYER.terracotta] = plain(img.terracotta);
    // The lava sheet is twenty frames tall; the first is the one we want.
    out[LAYER.lava] = plain(img.lava);
    out[LAYER.door_bottom] = plain(img.door_bottom);
    out[LAYER.door_top] = plain(img.door_top);
    // The water's frames, one under the other in the game's strip.
    for (var f = 0; f < WATER_FRAMES; f++) out[LAYER.water + f] = tinted(img.water, TINT_WATER, 0, f * 16);
    // The classic right arm on the skin sheet: 4 wide, 12 tall, 4 deep.
    out[LAYER.arm_front] = armFace(img.skin, 44, 20, 4, 12);
    out[LAYER.arm_back] = armFace(img.skin, 52, 20, 4, 12);
    out[LAYER.arm_outer] = armFace(img.skin, 40, 20, 4, 12);
    out[LAYER.arm_inner] = armFace(img.skin, 48, 20, 4, 12);
    out[LAYER.arm_top] = armFace(img.skin, 44, 16, 4, 4);
    out[LAYER.arm_hand] = armFace(img.skin, 48, 16, 4, 4);
    return out;
  }

  /* ------------------------------------------------------------------ gl */

  var WORLD_VS = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'layout(location=1) in vec3 aUV;',
    'layout(location=2) in float aLight;',
    'uniform mat4 uProj, uView, uModel;',
    'out vec3 vUV; out float vLight; out float vDist;',
    'void main() {',
    '  vec4 p = uView * uModel * vec4(aPos, 1.0);',
    '  vDist = length(p.xyz);',
    '  gl_Position = uProj * p;',
    '  vUV = aUV; vLight = aLight;',
    '}'
  ].join('\n');

  var WORLD_FS = [
    '#version 300 es',
    'precision highp float; precision highp sampler2DArray;',
    'in vec3 vUV; in float vLight; in float vDist;',
    'uniform sampler2DArray uTex;',
    'uniform vec3 uFog; uniform vec2 uFogRange; uniform float uAlpha; uniform float uCut; uniform float uLayerShift;',
    'uniform float uGrade;',
    'out vec4 o;',
    'void main() {',
    '  vec4 t = texture(uTex, vec3(vUV.xy, vUV.z + uLayerShift));',
    '  if (t.a < uCut) discard;',
    /* A slight grade, and slight is the whole point (2026-09-10). Not a
       shaderpack: no shadow map, no reflection, no bloom, no second pass.
       The contact shadows curve a little deeper, a lit face takes a hair of
       sun while a shaded one takes a hair of sky, then a touch of saturation
       and a gentle S-curve. At uGrade 0 every line collapses back to the
       vanilla c = t.rgb * vLight, which is what GRADE is a dial for. */
    '  float L = mix(vLight, pow(vLight, 1.12), uGrade);',
    '  vec3 warm = vec3(1.035, 1.005, 0.955);',
    '  vec3 cool = vec3(0.930, 0.965, 1.045);',
    '  vec3 tint = mix(cool, warm, smoothstep(0.34, 0.94, vLight));',
    '  vec3 c = t.rgb * L * mix(vec3(1.0), tint, uGrade);',
    '  float lum = dot(c, vec3(0.299, 0.587, 0.114));',
    '  c = mix(c, mix(vec3(lum), c, 1.09), uGrade);',
    '  vec3 cc = clamp(c, 0.0, 1.0);',
    '  c = mix(c, cc * cc * (3.0 - 2.0 * cc), uGrade * 0.15);',
    '  float f = smoothstep(uFogRange.x, uFogRange.y, vDist);',
    '  o = vec4(mix(c, uFog, f), t.a * uAlpha);',
    '}'
  ].join('\n');

  /* The world shader without its cut-out test, for the solid blocks
     (2026-09-22). Every texel a solid block wears is opaque, so the test
     never cut one of them; but a shader that may discard makes the card
     shade each fragment before it can keep or drop it by depth, and with
     the test gone the faces hidden behind nearer ones are dropped unshaded. */
  var SOLID_FS = WORLD_FS.replace("\n  if (t.a < uCut) discard;", '');

  var FLAT_VS = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'layout(location=1) in vec2 aUV;',
    'uniform mat4 uProj, uView, uModel; uniform vec2 uShift;',
    'out vec2 vUV; out vec3 vPos;',
    'void main() {',
    '  vec4 p = uView * uModel * vec4(aPos, 1.0);',
    '  vPos = p.xyz;',
    '  gl_Position = uProj * p;',
    '  vUV = aUV + uShift;',
    '}'
  ].join('\n');

  var FLAT_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV; in vec3 vPos;',
    'uniform sampler2D uTex; uniform vec4 uColor; uniform vec3 uFog; uniform vec2 uFogRange;',
    'out vec4 o;',
    'void main() {',
    '  vec4 t = texture(uTex, vUV) * uColor;',
    '  if (t.a < 0.02) discard;',
    // Distance per fragment, never per vertex: the cloud sheet is 1280 blocks
    // across, so a distance interpolated from its corners put the sky straight
    // overhead 900 blocks away and fogged every cloud to nothing (2026-09-02).
    '  float f = smoothstep(uFogRange.x, uFogRange.y, length(vPos));',
    '  o = vec4(mix(t.rgb, uFog, f), t.a * (1.0 - f));',
    '}'
  ].join('\n');

  var SKY_VS = [
    '#version 300 es',
    'layout(location=0) in vec2 aPos;',
    'out vec2 vNdc;',
    'void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var SKY_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vNdc;',
    'uniform vec3 uRight, uUp, uFwd; uniform vec2 uTan;',
    'uniform vec3 uSky, uFog, uVoid;',
    'out vec4 o;',
    'void main() {',
    '  vec3 d = normalize(uFwd + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y);',
    '  vec3 c = mix(uFog, uSky, smoothstep(0.0, 0.34, d.y));',
    '  c = mix(c, uVoid, smoothstep(0.0, -0.25, d.y));',
    '  o = vec4(c, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, source) {
    var s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  /* -------------------------------------------------------------- matrices */

  /* Each takes an optional matrix to write into (2026-09-22), so a frame
     reuses the same few arrays instead of making a dozen new ones thirty
     times a second. `o` must not be one of the inputs. */
  function identity(o) {
    o = o || new Float32Array(16);
    o.fill(0);
    o[0] = 1; o[5] = 1; o[10] = 1; o[15] = 1;
    return o;
  }

  /* Never written: the model matrix of everything that is not moved. */
  var IDENTITY = identity();

  function multiply(a, b, o) {
    o = o || new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    var o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  }

  function translation(x, y, z, o) {
    o = identity(o);
    o[12] = x; o[13] = y; o[14] = z;
    return o;
  }

  function scaling(x, y, z) {
    var o = identity();
    o[0] = x; o[5] = y; o[10] = z;
    return o;
  }

  function rotationX(a, o) {
    var c = Math.cos(a), s = Math.sin(a);
    o = identity(o);
    o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
    return o;
  }

  function rotationY(a, o) {
    var c = Math.cos(a), s = Math.sin(a);
    o = identity(o);
    o[0] = c; o[2] = -s; o[8] = s; o[10] = c;
    return o;
  }

  function rotationZ(a) {
    var c = Math.cos(a), s = Math.sin(a), o = identity();
    o[0] = c; o[1] = s; o[4] = -s; o[5] = c;
    return o;
  }

  /* --------------------------------------------------------------- the arm */

  /* The right arm exactly as first person draws it. The model's own cuboid
     (-3,-2,-2 to 1,10,2 sixteenths about a pivot at -5,2,0 — the game's
     models run y-down), its own texture layout, and the transform chain
     HeldItemRenderer applies to an empty hand at rest, so the arm sits in
     view space where the game puts it: reaching forward out of the bottom
     right, the outer side of the forearm toward you, the hand end pointing
     away. Lit as the entity shader lights it — two fixed lights, 0.4 ambient
     — so the faces fall off the way they do in the game. */
  function armMesh() {
    var d = Math.PI / 180;
    var M = translation(0.64, -0.6, -0.72);
    M = multiply(M, rotationY(45 * d));
    M = multiply(M, translation(-1.0, 3.6, 3.5));
    M = multiply(M, rotationZ(120 * d));
    M = multiply(M, rotationX(200 * d));
    M = multiply(M, rotationY(-135 * d));
    M = multiply(M, translation(5.6, 0, 0));
    M = multiply(M, translation(-5 / 16, 2 / 16, 0));

    var x1 = -3 / 16, y1 = -2 / 16, z1 = -2 / 16, x2 = 1 / 16, y2 = 10 / 16, z2 = 2 / 16;
    // The eight corners, numbered as ModelPart.Cuboid numbers them.
    var corner = [null,
      [x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1],
      [x1, y1, z2], [x2, y1, z2], [x2, y2, z2], [x1, y2, z2]];
    // Each face: its corners in the game's order, the tile it wears, the
    // texture rectangle (u1, v1, u2, v2) within that tile, and its normal.
    var L = LAYER;
    var faces = [
      { c: [6, 5, 1, 2], layer: L.arm_top, uv: [0, 0, 4, 4], n: [0, -1, 0] },
      { c: [3, 4, 8, 7], layer: L.arm_hand, uv: [0, 4, 4, 0], n: [0, 1, 0] },
      { c: [1, 5, 8, 4], layer: L.arm_outer, uv: [0, 0, 4, 12], n: [-1, 0, 0] },
      { c: [2, 1, 4, 3], layer: L.arm_front, uv: [0, 0, 4, 12], n: [0, 0, -1] },
      { c: [6, 2, 3, 7], layer: L.arm_inner, uv: [0, 0, 4, 12], n: [1, 0, 0] },
      { c: [5, 6, 7, 8], layer: L.arm_back, uv: [0, 0, 4, 12], n: [0, 0, 1] }
    ];

    function unit(v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
    var light0 = unit([0.2, 1.0, -0.7]), light1 = unit([-0.2, 1.0, 0.7]);
    function apply(p) {
      return [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12],
              M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13],
              M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
    }
    function turn(n) {
      return [M[0] * n[0] + M[4] * n[1] + M[8] * n[2],
              M[1] * n[0] + M[5] * n[1] + M[9] * n[2],
              M[2] * n[0] + M[6] * n[1] + M[10] * n[2]];
    }
    function lit(n) {
      var a = Math.max(0, n[0] * light0[0] + n[1] * light0[1] + n[2] * light0[2]);
      var b = Math.max(0, n[0] * light1[0] + n[1] * light1[1] + n[2] * light1[2]);
      return Math.min(1, 0.4 + 0.6 * (a + b));
    }

    var out = [];
    faces.forEach(function (f) {
      var light = lit(turn(f.n));
      // The game hands the four corners the texture's (u2,v1) (u1,v1) (u1,v2) (u2,v2).
      var u1 = f.uv[0] / 16, v1 = f.uv[1] / 16, u2 = f.uv[2] / 16, v2 = f.uv[3] / 16;
      var uvs = [[u2, v1], [u1, v1], [u1, v2], [u2, v2]];
      var order = [0, 1, 2, 0, 2, 3];
      for (var i = 0; i < 6; i++) {
        var p = apply(corner[f.c[order[i]]]), t = uvs[order[i]];
        out.push(p[0], p[1], p[2], t[0], t[1], f.layer, light);
      }
    });
    return new Float32Array(out);
  }

  /* The cloud texture's scale: a texel of the 256-wide sheet is twelve blocks. */
  var CLOUD_SCALE = 12 * 256;

  /* --------------------------------------------------------------- mount */

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  function mount(canvas, options) {
    options = options || {};
    // Where the game's textures are; the launcher mounts this from its own tree.
    var MC = options.assets || 'assets/mc/';
    // Multisampled, so the cut-out edges of leaves and plants can resolve
    // through alpha-to-coverage instead of snapping — a field of grass at a
    // distance otherwise crawls and flickers as the camera turns.
    var gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: !!options.capture, powerPreference: 'high-performance' });
    if (!gl) return null;

    var camX = options.camX || Math.floor(W / 2), camZ = options.camZ || Math.floor(D * 0.58);

    // camY lifts the camera off the ground: the title screen looks out from a
    // rise. The height is the ground's, so it is filled in once the world is.
    var eye = [camX + 0.5, 0, camZ + 0.5];
    var yaw = (options.yaw !== undefined ? options.yaw : 180) * Math.PI / 180;
    var pitch = (options.pitch !== undefined ? options.pitch : -4) * Math.PI / 180;
    var spin = reduced.matches ? 0 : (options.spin !== undefined ? options.spin : 360 / 210) * Math.PI / 180;
    var fov = (options.fov || 70) * Math.PI / 180;
    var showHand = options.hand !== false;
    var beams = options.beams || [];
    var labels = options.labels || [];

    var SKY = [0.47, 0.66, 1.0], FOG = [0.76, 0.86, 1.0], VOID = [0.42, 0.55, 0.78];
    var fogRange = options.fog || [52, 92];

    var worldProg = program(gl, WORLD_VS, WORLD_FS);
    var solidProg = program(gl, WORLD_VS, SOLID_FS);
    var flatProg = program(gl, FLAT_VS, FLAT_FS);
    var skyProg = program(gl, SKY_VS, SKY_FS);

    function buffer(data) {
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return { b: b, n: data.length / 7 };
    }
    var armBuf = buffer(armMesh());

    var skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    var flatBuf = gl.createBuffer();

    var tex = null, sunTex = null, cloudTex = null, beamTex = null, smooth = null;
    var ready = false, running = false, destroyed = false, frame = 0, last = 0;

    /* ------------------------------------------------------------ build */

    /* The world is built after the page's first frame, a piece at a time
       (2026-09-22). It was built right here, in the mount — generated, lit
       and meshed in one go, 1.2 s of the main thread measured in the
       preview — and the launcher mounts the world while it is putting up
       its shell, so the first frame of Home waited for all of it, and the
       window with it. Nothing is lost by waiting: the canvas shows nothing
       until it is ready, and what is under it until then is the still of
       this same first frame. Each piece is a task of its own, so a click
       that lands while the world is being built is answered between two.
       A caller that needs the ground before then — beams and labels stand
       on it — gets the rest built on the spot, the way it always was. */
    var world = null, meshing = null, band = 0, built = false, uploads = null;
    var opaqueBuf = null, cutoutBuf = null, waterBuf = null, sunBuf = null, cloudBuf = null;
    var BAND = 4;

    /* And handed to the card a megabyte at a time, a frame apart. The mesh
       is 27 MB, and sent in one go it has to wait for the card to take all
       of it; at mount the card had nothing else to do, but a second in it
       is compiling and rasterising the launcher's first frames, and the one
       call held the main thread until the card was through with those —
       5.8 s, measured, on the software renderer the preview runs on. A
       frame apart, each piece goes over while the card gets on with the
       rest. */
    var PIECE = 1 << 18;

    var growing = null, lit = null, geometry = null, opaqueSlices = null;
    function buildStep() {
      if (uploads) {
        var next = uploads[0];
        gl.bindBuffer(gl.ARRAY_BUFFER, next.buf.b);
        gl.bufferSubData(gl.ARRAY_BUFFER, next.at * 4, next.data.subarray(next.at, next.at + PIECE));
        next.at += PIECE;
        if (next.at >= next.data.length) uploads.shift();
        if (!uploads.length) { uploads = null; built = true; }
        return;
      }
      if (!world) {
        if (!growing) growing = generating(camX, camZ);
        var grown = growing.next();
        if (grown.done) { world = grown.value; growing = null; }
        return;
      }
      if (!geometry && !world.sky) {
        if (!lit) lit = lighting(world.blocks);
        var shone = lit.next();
        if (shone.done) {
          world.sky = shone.value;
          lit = null;
          eye[1] = world.camY + 1 + 1.62 + (options.camY || 0);
        }
        return;
      }
      if (!geometry) {
        if (!meshing) meshing = mesher(world);
        if (band < H) { meshing.rows(band, Math.min(H, band + BAND)); band += BAND; return; }
        geometry = meshing.finish();
        meshing = null;
        // Only the ground's height is asked for after this; the blocks and
        // their light were for the mesh, and are four megabytes.
        world.blocks = null;
        world.sky = null;
        world.shapes = null;
        return;
      }
      if (!opaqueSlices) { opaqueSlices = arrange(geometry.opaque, eye[0], eye[2]); return; }
      uploads = upload(geometry, opaqueSlices, arrange(geometry.cutout, eye[0], eye[2]));
      geometry = null;
      opaqueSlices = null;
    }

    /* Whether the next step is a piece for the card. */
    function uploading() { return !!uploads; }

    function build() {
      if (built) return;
      while (!built) buildStep();
      whenReady();
    }

    function buildLater() {
      if (built || destroyed) return;
      buildStep();
      if (built) { whenReady(); return; }
      if (!uploading()) { setTimeout(buildLater, 0); return; }
      // A piece a frame; the timer covers a page that is drawing none.
      var gone = false;
      var go = function () { if (!gone) { gone = true; buildLater(); } };
      requestAnimationFrame(go);
      setTimeout(go, 100);
    }

    function upload(geometry, opaque, cutout) {
      // Room on the card now; the contents follow a piece at a time.
      function room(data) {
        var b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.STATIC_DRAW);
        return { b: b, n: data.length / 7 };
      }
      opaqueBuf = room(opaque.data); opaqueBuf.near = opaque.near; opaqueBuf.sectors = opaque.sectors;
      cutoutBuf = room(cutout.data); cutoutBuf.near = cutout.near; cutoutBuf.sectors = cutout.sectors;
      waterBuf = buffer(geometry.water);

      /* The sun and the cloud sheet stand where they stand: made once, not
         every frame. The clouds drift by their texture, not their corners. */
      var sd = 100, ss = 30, el = 22 * Math.PI / 180, az = 62 * Math.PI / 180;
      var sx = Math.cos(el) * Math.sin(az) * sd, sy = Math.sin(el) * sd, sz = -Math.cos(el) * Math.cos(az) * sd;
      // A quad facing the camera, spanned by world up and the sun's sideways.
      var rx = Math.cos(az), rz = Math.sin(az);
      var ux = -Math.sin(el) * Math.sin(az), uy = Math.cos(el), uz = Math.sin(el) * Math.cos(az);
      sunBuf = flatBuffer(quad(
        [sx - rx * ss - ux * ss, sy - uy * ss, sz - rz * ss - uz * ss],
        [sx + rx * ss - ux * ss, sy - uy * ss, sz + rz * ss - uz * ss],
        [sx + rx * ss + ux * ss, sy + uy * ss, sz + rz * ss + uz * ss],
        [sx - rx * ss + ux * ss, sy + uy * ss, sz - rz * ss + uz * ss]));

      // The clouds, a sheet high over everything.
      var ch = eye[1] + 74, cr = 640;
      var cloudQuad = quad(
        [eye[0] - cr, ch, eye[2] + cr], [eye[0] + cr, ch, eye[2] + cr],
        [eye[0] + cr, ch, eye[2] - cr], [eye[0] - cr, ch, eye[2] - cr]);
      for (var i = 0; i < 6; i++) {
        cloudQuad[i * 5 + 3] = cloudQuad[i * 5] / CLOUD_SCALE;
        cloudQuad[i * 5 + 4] = cloudQuad[i * 5 + 2] / CLOUD_SCALE;
      }
      cloudBuf = flatBuffer(cloudQuad);
      return [{ buf: opaqueBuf, data: opaque.data, at: 0 }, { buf: cutoutBuf, data: cutout.data, at: 0 }];
    }

    // Anything standing in the world stands on the ground it finds there.
    function ground(x, z) {
      build();
      x = Math.max(0, Math.min(W - 1, x)); z = Math.max(0, Math.min(D - 1, z));
      return world.height[z * W + x] + 1;
    }
    if (beams.length || labels.length) {
      beams.forEach(function (b) { if (b.y == null) b.y = ground(b.x, b.z); });
      labels.forEach(function (l) { if (l.y == null) l.y = ground(l.x, l.z) + 1.6; });
    }

    /* After the first frame: a rAF runs before the frame is drawn, and the
       task it queues after it. The timer is for a page that is not drawing
       frames at all, which would otherwise never build its world. */
    var begun = false;
    function begin() { if (!begun) { begun = true; setTimeout(buildLater, 0); } }
    requestAnimationFrame(begin);
    setTimeout(begin, 1000);

    function texture2D(image, repeat) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      return t;
    }

    var wants = {
      grass_top: 'block/grass_block_top.png', grass_side: 'block/grass_block_side.png',
      grass_overlay: 'block/grass_block_side_overlay.png', dirt: 'block/dirt.png',
      stone: 'block/stone.png', sand: 'block/sand.png', water: 'block/water_still.png',
      lava: 'block/lava_still.png',
      log: 'block/oak_log.png', log_top: 'block/oak_log_top.png', leaves: 'block/oak_leaves.png',
      snow: 'block/snow.png', tuft: 'block/short_grass.png', poppy: 'block/poppy.png',
      dandelion: 'block/dandelion.png', bluet: 'block/azure_bluet.png', cornflower: 'block/cornflower.png',
      gravel: 'block/gravel.png', cobble: 'block/cobblestone.png', coarse: 'block/coarse_dirt.png',
      spruce_log: 'block/spruce_log.png', spruce_leaves: 'block/spruce_leaves.png',
      birch_log: 'block/birch_log.png', birch_leaves: 'block/birch_leaves.png',
      planks: 'block/oak_planks.png', glass: 'block/glass.png', path_top: 'block/dirt_path_top.png',
      path_side: 'block/dirt_path_side.png', hay_top: 'block/hay_block_top.png', hay_side: 'block/hay_block_side.png',
      farmland: 'block/farmland_moist.png', wheat: 'block/wheat_stage7.png', terracotta: 'block/white_terracotta.png',
      door_bottom: 'block/oak_door_bottom.png', door_top: 'block/oak_door_top.png',
      skin: 'skin/steve.png', sun: 'env/sun.png', clouds: 'env/clouds.png', beam: 'beacon_beam.png'
    };

    var names = Object.keys(wants);
    Promise.all(names.map(function (n) { return load(MC + wants[n]); })).then(function (images) {
      if (destroyed) return;
      var img = {};
      names.forEach(function (n, i) { img[n] = images[i]; });

      var layers = buildLayers(img);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, 16, 16, LAYERS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (var i = 0; i < LAYERS; i++) {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 16, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, layers[i] || tile());
      }
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      // Solid blocks are sampled smoothly once a texel is smaller than a
      // pixel (close up they stay square). With nearest sampling far off,
      // a turn of a fraction of a pixel flipped every far texel to its
      // neighbour and the whole meadow sparkled — the shimmer Adrian saw in
      // the launcher (2026-09-03). The game's own title screen turns a
      // picture sampled smoothly; this is the same thing. Leaves and plants
      // keep the hard cut-out sampling the game gives them: smoothed, a
      // tuft seen edge-on smears into a streak.
      smooth = gl.createSampler();
      gl.samplerParameteri(smooth, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.samplerParameteri(smooth, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.samplerParameteri(smooth, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(smooth, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      sunTex = texture2D(img.sun, false);
      cloudTex = texture2D(img.clouds, true);
      beamTex = texture2D(img.beam, true);

      whenReady();
    }).catch(function (error) {
      if (window.console) console.error('world could not load', error);
    });

    /* Ready once both halves are in: the textures, and the world they are
       drawn on. Whichever lands second calls it. */
    function whenReady() {
      if (ready || destroyed || !built || !tex) return;
      ready = true;
      canvas.classList.add('is-ready');
      if (running) schedule();
      else draw(0);
      if (options.onReady) options.onReady(api);
    }

    /* ------------------------------------------------------------ frame */

    var proj = null, width = 0, height = 0;
    // The frame's matrices, written in place every frame rather than made anew.
    var rot = new Float32Array(16), view = new Float32Array(16), sunView = new Float32Array(16);
    var vp = new Float32Array(16), turnX = new Float32Array(16), turnY = new Float32Array(16);
    var shiftBy = new Float32Array(16), armAt = new Float32Array(16), planes = new Float32Array(24);

    /* Asleep, the drawing buffer is one pixel (2026-09-22): a paused world
       still held its multisampled buffer on the card — the largest thing it
       owns, and on built-in graphics the game's own memory — and the
       launcher lets it go while a game has the screen. The geometry, the
       textures and the programs stay, so waking is one resize, not a
       rebuild (a remount measured a second of the launcher's main thread). */
    var asleep = false;

    /* The canvas's size in CSS pixels, read when it can change rather than
       on every frame (2026-09-22). Read inside a frame, it made the browser
       lay the page out there and then if anything had moved since the last
       one — a page arriving, a slider being dragged — thirty times a second.
       A ResizeObserver says when the box changes, after the browser has laid
       it out anyway; the window's resize still covers a change of zoom. */
    var cssWidth = 0, cssHeight = 0;
    function measure() {
      cssWidth = canvas.clientWidth;
      cssHeight = canvas.clientHeight;
    }

    function resize() {
      if (!observer) measure();
      var dpr = Math.min(window.devicePixelRatio || 1, options.dpr || 1.5);
      var w = asleep ? 1 : Math.max(1, Math.round(cssWidth * dpr));
      var h = asleep ? 1 : Math.max(1, Math.round(cssHeight * dpr));
      if (w !== width || h !== height) {
        width = w; height = h;
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
        proj = perspective(fov, w / h, 0.05, 400);
      }
    }

    function camera() {
      multiply(rotationX(-pitch, turnX), rotationY(yaw, turnY), rot);
      multiply(rot, translation(-eye[0], -eye[1], -eye[2], shiftBy), view);
    }

    /* The six planes of the view, from its matrix, to test a slice's box
       against: a box wholly outside any one of them cannot be seen. */
    function frustum() {
      multiply(proj, view, vp);
      for (var p = 0; p < 6; p++) {
        var row = p >> 1, sign = p & 1 ? -1 : 1;
        for (var c = 0; c < 4; c++) planes[p * 4 + c] = vp[c * 4 + 3] + sign * vp[c * 4 + row];
      }
    }
    function inView(box) {
      for (var p = 0; p < 6; p++) {
        var a = planes[p * 4], b = planes[p * 4 + 1], c = planes[p * 4 + 2], d = planes[p * 4 + 3];
        if (a * (a > 0 ? box[3] : box[0]) + b * (b > 0 ? box[4] : box[1]) + c * (c > 0 ? box[5] : box[2]) + d < 0) return false;
      }
      return true;
    }

    function bindWorld(buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.b);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    }

    function drawWorldPass(buf, prog, model, alpha, cut, fog, layerShift) {
      if (!buf.n) return;
      bindWorld(buf);
      gl.uniformMatrix4fv(prog.u.uModel, false, model);
      gl.uniform1f(prog.u.uLayerShift, layerShift || 0);
      gl.uniform1f(prog.u.uAlpha, alpha);
      gl.uniform1f(prog.u.uCut, cut);
      gl.uniform2f(prog.u.uFogRange, fog[0], fog[1]);
      gl.uniform1f(prog.u.uGrade, GRADE);
      if (!buf.sectors) { gl.drawArrays(gl.TRIANGLES, 0, buf.n); return; }
      // The feet first, then every wedge the view reaches, neighbours in one call.
      if (buf.near.count) gl.drawArrays(gl.TRIANGLES, buf.near.first, buf.near.count);
      var from = -1, to = -1;
      for (var s = 0; s <= SECTORS; s++) {
        var slice = s < SECTORS ? buf.sectors[s] : null;
        if (slice && slice.count && inView(slice.box)) {
          if (from < 0) from = slice.first;
          to = slice.first + slice.count;
        } else if (slice && !slice.count) {
          continue;
        } else if (from >= 0) {
          gl.drawArrays(gl.TRIANGLES, from, to - from);
          from = -1;
        }
      }
    }

    function flatBuffer(data) {
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return { b: b, n: data.length / 5 };
    }

    /* `data` is a buffer made once (flatBuffer), or a Float32Array sent this frame. */
    function flat(data, texture, model, color, shift, fog) {
      gl.useProgram(flatProg.p);
      if (data instanceof Float32Array) {
        gl.bindBuffer(gl.ARRAY_BUFFER, flatBuf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, data.b);
      }
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(flatProg.u.uTex, 0);
      gl.uniformMatrix4fv(flatProg.u.uProj, false, proj);
      gl.uniformMatrix4fv(flatProg.u.uView, false, view);
      gl.uniformMatrix4fv(flatProg.u.uModel, false, model);
      gl.uniform4f(flatProg.u.uColor, color[0], color[1], color[2], color[3]);
      gl.uniform2f(flatProg.u.uShift, shift[0], shift[1]);
      gl.uniform3f(flatProg.u.uFog, FOG[0], FOG[1], FOG[2]);
      gl.uniform2f(flatProg.u.uFogRange, fog[0], fog[1]);
      gl.drawArrays(gl.TRIANGLES, 0, data instanceof Float32Array ? data.length / 5 : data.n);
    }

    function quad(a, b, c, d) {
      return new Float32Array([
        a[0], a[1], a[2], 0, 1, b[0], b[1], b[2], 1, 1, c[0], c[1], c[2], 1, 0,
        a[0], a[1], a[2], 0, 1, c[0], c[1], c[2], 1, 0, d[0], d[1], d[2], 0, 0
      ]);
    }

    /* A beacon beam: the game's core at 0.2 wide, its glass at 0.5 and an
       eighth of the opacity, both scrolling up, both in the colour. */
    function beam(b, t) {
      var x = b.x + 0.5, z = b.z + 0.5, y0 = b.y, y1 = y0 + 160;
      var col = b.colour, shift = [0, -t * 0.55];
      function column(hw, alpha) {
        var reps = 8;
        var faces = [
          [[x - hw, y0, z - hw], [x + hw, y0, z - hw], [x + hw, y1, z - hw], [x - hw, y1, z - hw]],
          [[x + hw, y0, z + hw], [x - hw, y0, z + hw], [x - hw, y1, z + hw], [x + hw, y1, z + hw]],
          [[x - hw, y0, z + hw], [x - hw, y0, z - hw], [x - hw, y1, z - hw], [x - hw, y1, z + hw]],
          [[x + hw, y0, z - hw], [x + hw, y0, z + hw], [x + hw, y1, z + hw], [x + hw, y1, z - hw]]
        ];
        faces.forEach(function (f) {
          var data = quad(f[0], f[1], f[2], f[3]);
          for (var i = 0; i < 6; i++) data[i * 5 + 4] *= reps;
          flat(data, beamTex, IDENTITY, [col[0], col[1], col[2], alpha], shift, [220, 320]);
        });
      }
      column(0.14, 0.96);
      column(0.32, 0.2);
    }

    function draw(now) {
      if (!ready || destroyed) return;
      var t = now / 1000;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      yaw += spin * dt;

      resize();
      camera();

      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // The sky, from the camera's own axes.
      gl.useProgram(skyProg.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
      gl.enableVertexAttribArray(0);
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      var tanY = Math.tan(fov / 2), tanX = tanY * (width / height);
      gl.uniform3f(skyProg.u.uRight, rot[0], rot[4], rot[8]);
      gl.uniform3f(skyProg.u.uUp, rot[1], rot[5], rot[9]);
      gl.uniform3f(skyProg.u.uFwd, -rot[2], -rot[6], -rot[10]);
      gl.uniform2f(skyProg.u.uTan, tanX, tanY);
      gl.uniform3f(skyProg.u.uSky, SKY[0], SKY[1], SKY[2]);
      gl.uniform3f(skyProg.u.uFog, FOG[0], FOG[1], FOG[2]);
      gl.uniform3f(skyProg.u.uVoid, VOID[0], VOID[1], VOID[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // The sun, square and far off to the east, added onto the sky.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      multiply(rot, IDENTITY, sunView);
      var savedView = view;
      view = sunView;
      flat(sunBuf, sunTex, IDENTITY, [1, 1, 1, 1], [0, 0], [9000, 9001]);
      view = savedView;

      // The world: only the slices the view reaches.
      frustum();
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      /* The solid blocks through a program with no cut-out test in it
         (SOLID_FS): every texel they wear is opaque, so the test never cut
         anything, and a shader that can discard makes the card shade a
         fragment before it may keep or drop it by depth. */
      gl.useProgram(solidProg.p);
      gl.uniform1i(solidProg.u.uTex, 0);
      gl.uniformMatrix4fv(solidProg.u.uProj, false, proj);
      gl.uniformMatrix4fv(solidProg.u.uView, false, view);
      gl.uniform3f(solidProg.u.uFog, FOG[0], FOG[1], FOG[2]);
      gl.bindSampler(0, smooth);
      drawWorldPass(opaqueBuf, solidProg, IDENTITY, 1.0, 0.5, fogRange);
      gl.bindSampler(0, null);

      // Leaves are boxes and plants carry both windings, so culling stays on.
      // Alpha-to-coverage turns each texel's alpha into sample coverage: far
      // tufts thin out smoothly rather than popping when their mip averages
      // cross a cut-off.
      gl.useProgram(worldProg.p);
      gl.uniform1i(worldProg.u.uTex, 0);
      gl.uniformMatrix4fv(worldProg.u.uProj, false, proj);
      gl.uniformMatrix4fv(worldProg.u.uView, false, view);
      gl.uniform3f(worldProg.u.uFog, FOG[0], FOG[1], FOG[2]);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      drawWorldPass(cutoutBuf, worldProg, IDENTITY, 1.0, 0.02, fogRange);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.disable(gl.CULL_FACE);

      // The clouds, a sheet high over everything, drifting east.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      flat(cloudBuf, cloudTex, IDENTITY, [1, 1, 1, 0.8], [t * 0.7 / CLOUD_SCALE, 0], [140, 460]);

      // Water, seen through.
      gl.useProgram(worldProg.p);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      // The water moves: the game shows each of its 32 frames for two ticks.
      gl.bindSampler(0, smooth);
      drawWorldPass(waterBuf, worldProg, IDENTITY, 0.78, 0.0, fogRange, Math.floor(t * 10) % WATER_FRAMES);
      gl.bindSampler(0, null);

      // Waypoint beams, blended the way the game blends them — a solid
      // coloured core, a glass sleeve — so the colour holds against the sky.
      if (beams.length && beamTex) {
        beams.forEach(function (b) { beam(b, t); });
      }
      gl.depthMask(true);

      // The arm, over everything, the way first person draws it.
      if (showHand) {
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.useProgram(worldProg.p);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
        gl.uniformMatrix4fv(worldProg.u.uView, false, IDENTITY);
        // Already in view space; api.arm is only a nudge on top of the game's own placement.
        var a = api.arm;
        drawWorldPass(armBuf, worldProg, translation(a.x, a.y, a.z, armAt), 1.0, 0.5, [9000, 9001]);
      }

      // Labels that stand in the world: project their anchor to the screen.
      if (labels.length) {
        // vp is this frame's projection times view, from frustum() above.
        labels.forEach(function (l) {
          var x = l.x + 0.5, y = l.y, z = l.z + 0.5;
          var cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
          var cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
          var cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
          if (cw <= 0.01) { l.el.style.visibility = 'hidden'; return; }
          // The stylesheet starts a label hidden; only a projected one shows.
          var px = (cx / cw * 0.5 + 0.5) * canvas.clientWidth;
          var py = (0.5 - cy / cw * 0.5) * canvas.clientHeight;
          l.el.style.visibility = 'visible';
          l.el.style.transform = 'translate(' + Math.round(px) + 'px,' + Math.round(py) + 'px) translate(-50%, -100%)';
        });
      }
    }

    /* The first seconds are timed. A machine that cannot hold twenty-five
       frames a second here is told so, once, through options.onSlow, and may
       stand the world down for a still. options.fps, if given, holds the rate
       from the very first frame — the launcher asks for thirty, which is
       plenty for a world turning once in three and a half minutes.

       Until 2026-09-10 the probe ran UNCAPPED: seventy frames drawn as fast
       as the machine could, at one and a half device pixels per CSS pixel,
       in the same seconds the launcher was loading its pages, its fonts and
       its icons — and Adrian felt it: "slightly laggy when you open the
       launcher first time and try to switch pages, then its better after a
       few seconds". The cap costs the probe nothing: a machine that cannot
       hold thirty shows it just as plainly in the spacing of capped frames,
       since a frame that is late is late whatever it was asked for. */
    var probe = [], probed = !options.onSlow, lastDrawn = 0, wait = 0;

    /* The cap sleeps until the next frame is due rather than polling for it
       (2026-09-22). Asking for thirty and re-scheduling a rAF each time the
       answer is "not yet" means the page is woken at the DISPLAY's rate —
       144 times a second on Adrian's screen to draw thirty — and a renderer
       that is woken every frame never reaches Chromium's idle state, so the
       cap that exists to cost less was itself a cost. A timer for the
       remainder and one rAF after it wakes the page thirty times instead;
       the rAF is still what draws, so nothing runs while the tab is hidden
       and the frames still land on a compositor frame. */
    function schedule() {
      if (frame || wait || !running || destroyed) return;
      var due = options.fps && lastDrawn ? 1000 / options.fps - 2 - (performance.now() - lastDrawn) : 0;
      if (due > 1) {
        wait = setTimeout(function () { wait = 0; schedule(); }, due);
        return;
      }
      frame = requestAnimationFrame(function step(now) {
        frame = 0;
        if (!probed) {
          if (lastDrawn) probe.push(now - lastDrawn);
          if (probe.length >= 70) {
            probed = true;
            var sample = probe.slice(10);
            var mean = sample.reduce(function (a, b) { return a + b; }, 0) / sample.length;
            if (mean > 40) { options.onSlow(mean); if (destroyed) return; }
          }
        }
        lastDrawn = now;
        draw(now);
        if (running && !destroyed && (spin || beams.length)) schedule();
      });
    }

    var api = {
      pause: function () {
        running = false;
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        if (wait) { clearTimeout(wait); wait = 0; }
        last = 0;
      },
      resume: function () { if (destroyed) return; running = true; if (ready) schedule(); },
      redraw: function () { if (ready) draw(performance.now()); },
      /* Everything the world holds is given back (2026-09-22). destroy()
         used to stop the frames and nothing else: the window's resize
         listener kept the whole closure — the world, its buffers, the
         context and its multisampled drawing buffer on the card — for the
         life of the page, so every switch to a picture of your own and back
         (Background) or off and on (Live background) left one more world on
         the card, until Chromium began dropping the oldest contexts. */
      destroy: function () {
        if (destroyed) return;
        api.pause();
        destroyed = true;
        window.removeEventListener('resize', onResize);
        if (observer) observer.disconnect();
        [opaqueBuf, cutoutBuf, waterBuf, armBuf, sunBuf, cloudBuf].forEach(function (b) { if (b) gl.deleteBuffer(b.b); });
        gl.deleteBuffer(skyBuf);
        gl.deleteBuffer(flatBuf);
        [tex, sunTex, cloudTex, beamTex].forEach(function (t) { if (t) gl.deleteTexture(t); });
        if (smooth) gl.deleteSampler(smooth);
        [worldProg, solidProg, flatProg, skyProg].forEach(function (p) { gl.deleteProgram(p.p); });
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        world = null; meshing = null;
      },
      /* The drawing buffer let go while nobody is looking, and taken back
         with the next frame. Both idempotent; sleep() pauses, wake() does
         not resume — that is still the caller's call. */
      sleep: function () { if (asleep || destroyed) return; asleep = true; api.pause(); resize(); gl.flush(); },
      wake: function () { if (!asleep) return; asleep = false; resize(); },
      ground: ground,
      /* Where the camera stands: its height is the ground's, so asking
         builds the world if it is not built yet. */
      get eye() { if (!destroyed) build(); return eye; },
      /* A nudge on the arm, on top of where the game itself puts it. Zero. */
      arm: { x: 0, y: 0, z: 0 },
      stats: function () { build(); return { opaque: opaqueBuf.n, cutout: cutoutBuf.n, water: waterBuf.n, size: [canvas.width, canvas.height] }; },
      look: function (deg) { yaw = deg * Math.PI / 180; if (ready && !running) draw(performance.now()); },
      /* One frame from a given direction, as a PNG data URL. This is how the
         stills and the game's six panorama faces are made (the launcher's
         tools/render-world.js). Time is frozen so the six faces share one
         sky, and it needs capture: true at mount. */
      snapshot: function (yawDeg, pitchDeg) {
        if (!ready) return null;
        yaw = yawDeg * Math.PI / 180;
        pitch = pitchDeg * Math.PI / 180;
        last = 0;
        draw(1000);
        return canvas.toDataURL('image/png');
      }
    };

    function onResize() {
      measure();
      if (ready && !running && !asleep) draw(performance.now());
    }
    var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    if (observer) observer.observe(canvas);

    /* The drawing buffer is sized now, while the graphics card is idle,
       rather than on the first frame (2026-09-15). The first frame lands
       just as the compositor is compiling the launcher's own shaders — some
       sixty of them, none kept between runs on Windows — and sizing the
       buffer then waited behind them: 470 ms, measured, in one canvas.width
       assignment. Sized here it costs nothing, and draw()'s resize() finds
       nothing to do. */
    measure();
    resize();
    api.resume();
    window.addEventListener('resize', onResize);
    return api;
  }

  window.BlueWorld = { mount: mount };
})();
