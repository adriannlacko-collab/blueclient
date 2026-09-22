import { el } from '../ui/dom.js';

/**
 * Home's layout — three columns, the five blocks in them, and the mode that
 * moves them.
 *
 * Home has three columns since 2026-09-21 ("Build C", off the Home, Six
 * Ways sheet): the player's block (nameplate, model, Play, the profile row)
 * and two columns of cards — Featured servers, Cosmetics (`play` here: the
 * block kept its first name), Where you left off and Friends. A layout says
 * where the player stands — left, centre or right — and which cards are in
 * which of the two card columns, in what order:
 *
 *   { skin: 'centre', columns: [['play', 'continue'], ['servers', 'friends']] }
 *
 * `columns` are the two card columns left to right (whichever side of the
 * player they end up on), every card once, one to three a column — four in
 * one column do not fit the height Home is drawn at, and a column with
 * nothing in it is not a layout Home has a shape for. The player's block was
 * fixed in the middle for an hour on the day the columns landed; Adrian:
 * "make it so you can move the play card to the left or right too, so its
 * not fixed in the center." A layout file from before this day (`skin` with
 * a `side` list) is read as the default.
 *
 * The mode is the iPhone's (2026-09-17, Adrian: "make it the same as when
 * moving around apps on the homescreen in an iphone", and "i dont like the
 * bluer boxes around the elements" — the first build drew a tinted pane with
 * a dashed rim and a name on each block, and that is gone). Press Layout and
 * the five blocks start to jiggle, each on its own beat; nothing else is
 * drawn on them. Pick one up and it stops jiggling, grows a little and casts
 * a deeper shadow, and follows the hand; the others spring out of its way;
 * let go and it springs into the slot it is over. The player's block dragged
 * past the middle of the column beside it changes places with that column.
 * A card dragged across the line between the two card columns — the middle
 * of the player when he stands between them, the middle of their gap when
 * he does not — changes column, unless that column already has three, or it
 * was the last card in its own, in which case it stays where it is and
 * springs back. Dragged up or down its column it changes places with its
 * neighbours. The arrow keys do the same from the keyboard. Done, Escape, or
 * a press on the empty world beside the blocks — the iPhone's tap on the
 * wallpaper — ends it. Every change is written to the settings the moment
 * it happens, so there is nothing to save and closing the launcher mid-drag
 * loses nothing.
 *
 * Each block carries an invisible pane (.home-block) while the mode is on:
 * it is the drag handle, and it is what keeps a press from reaching Play, a
 * server row or the card that opens Cosmetics. It draws nothing.
 *
 * Three transforms, three properties. The jiggle is a CSS animation of
 * `rotate`, the lift is `scale`, and the drag and the springs are
 * `translate` written from here — the individual transform properties, so
 * the animation never fights the inline value and a block can wobble, grow
 * and travel at once. Everything is measured by a block's centre, which none
 * of the three moves.
 *
 * The columns are placed by `order` and a class on the grid, and the cards
 * within a column by `order` — never by moving nodes. Across the two card
 * columns a card's node has to move (each column is its own flex container,
 * so that each stacks its cards to its own heights), and that is the one
 * move made in the document: the pointer is held by the page (`home`),
 * which never moves, so the drag survives it; the card under the hand
 * carries no transition while it is lifted, so there is none to lose; and a
 * canvas or an image keeps what it shows when it is re-attached.
 */

/** Every block, by id, and the name a screen reader is given for it. */
export const BLOCKS = Object.freeze({
  skin: 'Player',
  servers: 'Featured servers',
  play: 'Cosmetics',
  continue: 'Where you left off',
  friends: 'Friends'
});

/** The four cards — every block but the player's. */
const CARDS = Object.freeze(['servers', 'play', 'continue', 'friends']);

/** Where the player's block can stand. */
const SIDES = Object.freeze(['left', 'centre', 'right']);

/** The layout a fresh install has: the "C" sheet. */
export const DEFAULT_LAYOUT = Object.freeze({
  skin: 'centre',
  columns: Object.freeze([Object.freeze(['play', 'continue']), Object.freeze(['servers', 'friends'])])
});

/** The most cards one column holds (see the top of the file). */
export const COLUMN_MAX = 3;

/** How far past a seam a block's centre has to travel before it changes
    place — and back past it before it changes again, so a hand resting on
    the line does not flip it on every pixel. */
const SEAM_HYSTERESIS = 8;

/** A press that moves less than this is a press, not a drag. */
const DRAG_SLOP = 5;

/** The jiggle's beat: one swing of the rotation, in seconds. Each block gets
    its own length inside this range and its own start, so the five never
    swing together — the iPhone's icons do not either. */
const JIGGLE_MIN_S = 0.26;
const JIGGLE_MAX_S = 0.32;

/**
 * The layout the settings hold, made safe: anything that is not a side and
 * exactly the four cards once each across two columns of one to three is
 * the default. The mock bridge has no layout at all, a hand-edited file can
 * say anything, and a file from before this day says `skin`/`side`.
 */
export function readLayout(settings) {
  const raw = settings?.launcher?.layout;
  const columns = Array.isArray(raw?.columns) && raw.columns.length === 2
    ? raw.columns.map((column) => (Array.isArray(column) ? column.filter((id) => CARDS.includes(id)) : []))
    : null;
  const all = columns ? [...columns[0], ...columns[1]] : [];
  const sound = columns
    && columns.every((column) => column.length >= 1 && column.length <= COLUMN_MAX)
    && all.length === CARDS.length
    && CARDS.every((id) => all.includes(id));
  if (!sound) return clone(DEFAULT_LAYOUT);
  return { skin: SIDES.includes(raw.skin) ? raw.skin : 'centre', columns: columns.map((c) => c.slice()) };
}

export function isDefaultLayout(layout) {
  return layout.skin === DEFAULT_LAYOUT.skin
    && same(layout.columns[0], DEFAULT_LAYOUT.columns[0])
    && same(layout.columns[1], DEFAULT_LAYOUT.columns[1]);
}

const same = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const clone = (layout) => ({ skin: layout.skin, columns: [layout.columns[0].slice(), layout.columns[1].slice()] });

/** The three columns left to right for a layout: 'skin', 0 and 1 (the card columns). */
const orderOf = (layout) => (layout.skin === 'left' ? ['skin', 0, 1] : layout.skin === 'right' ? [0, 1, 'skin'] : [0, 'skin', 1]);

/** A block's centre as drawn — with whatever translate, rotate and scale are
    on it at the moment. The rotation and the scale turn about the centre, so
    only the translate moves it. */
function drawnCentre(node) {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * A block's centre where the page has laid it, whatever is on it at the
 * moment — a block mid-spring from the last change, or the one under the
 * hand. The translate is read back off the computed style and taken out;
 * every translate this file writes is in px, so the two numbers are the
 * offset.
 */
function layoutCentre(node) {
  const drawn = drawnCentre(node);
  const value = getComputedStyle(node).translate;
  let tx = 0;
  let ty = 0;
  if (value && value !== 'none') {
    const parts = value.split(' ').map(parseFloat);
    tx = parts[0] || 0;
    ty = parts[1] || 0;
  }
  return { x: drawn.x - tx, y: drawn.y - ty };
}

/**
 * Put the mode on and start listening. `blocks` maps each id in BLOCKS to
 * its node — the player's block under `skin`; `columns` is the two card
 * columns' asides, first and second; `home` is the grid they all stand in.
 * `onChange(layout)` is told every time the layout is different from a
 * moment ago, `onExit()` when the mode ends from inside (Escape, or a press
 * on the world). Returns the handle Home keeps: `stop()` takes everything
 * off again, `reset()` puts the default back, `layout()` says where things
 * stand.
 */
export function arrange({ home, columns, blocks, layout, onChange, onExit }) {
  let current = clone(layout);
  const nodes = new Map(Object.entries(blocks).filter(([, node]) => node));
  const panes = new Map();
  /* What each block had before the mode went on, put back by stop(). */
  const restore = [];
  let drag = null;
  let stopped = false;

  home.classList.add('is-arranging');

  for (const [id, node] of nodes) {
    /* The block's own controls — Play, the rows, the Skins button, a card
       that is one control — are put to sleep under the pane, so a Tab
       cannot reach them and a screen reader does not read them as live.
       The Layout capsules are the one thing that stays awake: they are
       inside the player's block, and Done is one of them. */
    for (const child of node.children) {
      if (child.classList.contains('layout-tools')) continue;
      restore.push(() => { child.inert = false; });
      child.inert = true;
    }
    if (node.hasAttribute('tabindex')) {
      const was = node.getAttribute('tabindex');
      restore.push(() => node.setAttribute('tabindex', was));
      node.setAttribute('tabindex', '-1');
    }

    /* Its own beat: a length of its own and a start somewhere in it. */
    node.style.animationDuration = `${(JIGGLE_MIN_S + Math.random() * (JIGGLE_MAX_S - JIGGLE_MIN_S)).toFixed(3)}s`;
    node.style.animationDelay = `-${(Math.random() * JIGGLE_MAX_S).toFixed(3)}s`;
    node.style.animationDirection = Math.random() < 0.5 ? 'alternate' : 'alternate-reverse';

    const pane = el('div', {
      class: 'home-block',
      role: 'button',
      tabindex: '0',
      'aria-label': `${BLOCKS[id]}. Drag it, or move it with the arrow keys.`,
      onPointerdown: (event) => press(event, id),
      onKeydown: (event) => key(event, id),
      /* The Cosmetics card opens its page on a click anywhere in it, and this
         pane is anywhere in it. */
      onClick: (event) => event.stopPropagation()
    });
    node.append(pane);
    panes.set(id, pane);
  }

  home.addEventListener('pointermove', move);
  home.addEventListener('pointerup', release);
  home.addEventListener('pointercancel', release);
  document.addEventListener('keydown', escape);
  document.addEventListener('pointerdown', outside, true);

  /* ---- where things are ---- */

  /** Which card column (0 or 1) a card stands in under the current layout. */
  const columnOf = (id) => (current.columns[0].includes(id) ? 0 : 1);

  /** The aside of a card column. */
  const asideOf = (column) => columns[column === 0 ? 'first' : 'second'];

  /** The node standing in a column slot — the player's block or an aside. */
  const nodeAt = (slot) => (slot === 'skin' ? nodes.get('skin') : asideOf(slot));

  /** The line a card crosses to change column: the middle between the two
      card columns' centres — the player's middle when he stands between
      them, the middle of their gap when he does not. */
  const seamX = () => (layoutCentre(asideOf(0)).x + layoutCentre(asideOf(1)).x) / 2;

  /* The layout as it stands, put on the page before anything is measured —
     after the helpers above, which `apply` reads (a `const` is not there
     until its line has run). */
  apply(current);

  /**
   * The layout, on the page: the player's side as a class on the grid, the
   * three columns by `order`, each card in its column's aside in `order`. A
   * card already in the right aside only gets its order; one that is not is
   * moved there — the one move made in the document (see the top of the
   * file).
   */
  function apply(layout) {
    home.classList.toggle('home--skin-left', layout.skin === 'left');
    home.classList.toggle('home--skin-right', layout.skin === 'right');
    layout.columns.forEach((ids, column) => {
      const aside = asideOf(column);
      ids.forEach((id, index) => {
        const node = nodes.get(id);
        if (!node) return;
        if (node.parentNode !== aside) aside.append(node);
        node.style.order = String(index);
      });
    });
  }

  /**
   * A different layout, and every block that is not under the hand springs
   * from where it was drawn to where it now belongs (FLIP): the centre
   * before, as drawn — a block still on its way from the last change starts
   * this one from wherever it had got to — then the change, then the centre
   * as laid out, and the difference put on as a translate that is taken off
   * again with the transition on. The dragged block is left alone: move()
   * keeps it under the pointer whatever the page does around it.
   */
  function change(next) {
    const others = [...nodes.values()].filter((node) => node !== drag?.node);
    const before = new Map(others.map((node) => [node, drawnCentre(node)]));
    apply(next);
    current = clone(next);
    for (const node of others) {
      const was = before.get(node);
      const now = layoutCentre(node);
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      node.classList.remove('is-settling');
      node.style.translate = `${dx}px ${dy}px`;
      /* Landed, flushed, then armed — the transition only sees the second
         write, from the old place to none. */
      void node.offsetWidth;
      node.classList.add('is-settling');
      node.style.translate = '';
    }
    onChange?.(clone(current));
  }

  /** The block under the hand, drawn with its centre at `visual` — its own
      layout centre taken off, whatever that is after the last change. */
  function place(node, visual) {
    const now = layoutCentre(node);
    node.style.translate = `${visual.x - now.x}px ${visual.y - now.y}px`;
  }

  /** `id` taken out of its column and put into `column` at `slot`, if the
      columns allow it; null when they do not. */
  function movedCard(id, column, slot) {
    const from = columnOf(id);
    if (from !== column && (current.columns[column].length >= COLUMN_MAX || current.columns[from].length <= 1)) return null;
    const next = clone(current);
    next.columns = next.columns.map((ids) => ids.filter((x) => x !== id));
    const at = Math.max(0, Math.min(slot, next.columns[column].length));
    next.columns[column].splice(at, 0, id);
    return next;
  }

  /** The player's block one column over, or null at the edge. */
  function movedSkin(step) {
    const at = SIDES.indexOf(current.skin) + step;
    if (at < 0 || at >= SIDES.length) return null;
    return { ...clone(current), skin: SIDES[at] };
  }

  /* ---- the pointer ---- */

  function press(event, id) {
    if (event.button !== 0 || drag) return;
    const node = nodes.get(id);
    drag = {
      id,
      node,
      pointer: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      start: layoutCentre(node),
      moved: false
    };
    /* Held by the page, not the pane: the pane's block changes `order` and
       column under the drag, and the page is the one node that never does. */
    try { home.setPointerCapture(event.pointerId); } catch { /* a pointer that cannot be held is still followed */ }
    /* No text selection, no focus stolen from Done, no mouse events under. */
    event.preventDefault();
  }

  function move(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    const dx = event.clientX - drag.x0;
    const dy = event.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      drag.moved = true;
      drag.node.classList.remove('is-settling');
      drag.node.classList.add('is-lifting');
    }

    const { id, node, start } = drag;
    const visual = { x: start.x + dx, y: start.y + dy };

    if (id === 'skin') {
      /* Past the middle of the column beside him: the two change places. */
      const order = orderOf(current);
      const at = order.indexOf('skin');
      const leftOf = at > 0 ? layoutCentre(nodeAt(order[at - 1])).x : null;
      const rightOf = at < order.length - 1 ? layoutCentre(nodeAt(order[at + 1])).x : null;
      if (leftOf !== null && visual.x < leftOf - SEAM_HYSTERESIS) change(movedSkin(-1));
      else if (rightOf !== null && visual.x > rightOf + SEAM_HYSTERESIS) change(movedSkin(1));
    } else {
      /* Across the seam: the other card column, if it has room and this one
         is not left empty. Then up or down: a card takes the slot its centre
         is in — the number of the column's other cards whose centres it has
         passed. Both are one layout, worked out from where the hand is. */
      const seam = seamX();
      let column = columnOf(id);
      if ((column === 0 && visual.x > seam + SEAM_HYSTERESIS) || (column === 1 && visual.x < seam - SEAM_HYSTERESIS)) {
        const across = 1 - column;
        if (current.columns[across].length < COLUMN_MAX && current.columns[column].length > 1) column = across;
      }
      const rest = current.columns[column].filter((x) => x !== id);
      const slot = rest.filter((x) => layoutCentre(nodes.get(x)).y < visual.y).length;
      if (column !== columnOf(id) || slot !== current.columns[column].indexOf(id)) {
        const next = movedCard(id, column, slot);
        if (next) change(next);
      }
    }

    place(node, visual);
  }

  function release(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { node, moved } = drag;
    drag = null;
    if (!moved) return;
    /* Let go: from wherever the hand left it into its slot, on the spring,
       and back to its size. The lifted state had no transition on the
       translate, and the two classes change in the same pass as the value,
       so the browser sees one change — "from here to none, springing". */
    node.classList.remove('is-lifting');
    node.classList.add('is-settling');
    node.style.translate = '';
  }

  /* ---- the keyboard ---- */

  function key(event, id) {
    /* Nothing under the pane hears a key: Enter on the Cosmetics card would
       open its page. */
    event.stopPropagation();
    let next = null;

    if (id === 'skin') {
      if (event.key === 'ArrowLeft') next = movedSkin(-1);
      else if (event.key === 'ArrowRight') next = movedSkin(1);
      else return;
    } else {
      const column = columnOf(id);
      const at = current.columns[column].indexOf(id);
      if ((event.key === 'ArrowRight' && column === 0) || (event.key === 'ArrowLeft' && column === 1)) {
        next = movedCard(id, 1 - column, at);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const to = at + (event.key === 'ArrowUp' ? -1 : 1);
        if (to >= 0 && to < current.columns[column].length) next = movedCard(id, column, to);
      } else {
        return;
      }
    }

    event.preventDefault();
    if (next) change(next);
  }

  /** Escape ends the mode — unless a dialog is up over it, whose Escape it is. */
  function escape(event) {
    if (event.key !== 'Escape' || document.querySelector('.scrim')) return;
    event.preventDefault();
    finish();
  }

  /** A press on the world beside the blocks ends the mode — the iPhone's
      tap on the wallpaper. A press on a block, on Done or Reset, or off the
      page altogether (the bar, a dialog) is not that. */
  function outside(event) {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest('.page--home')) return;
    if (target.closest('[data-block], .layout-tools')) return;
    finish();
  }

  function finish() {
    stop();
    onExit?.();
  }

  /* ---- the handle ---- */

  function stop() {
    if (stopped) return;
    stopped = true;
    if (drag) {
      try { home.releasePointerCapture(drag.pointer); } catch { /* already let go */ }
      drag = null;
    }
    home.removeEventListener('pointermove', move);
    home.removeEventListener('pointerup', release);
    home.removeEventListener('pointercancel', release);
    document.removeEventListener('keydown', escape);
    document.removeEventListener('pointerdown', outside, true);
    for (const pane of panes.values()) pane.remove();
    for (const node of nodes.values()) {
      node.classList.remove('is-lifting', 'is-settling');
      node.style.translate = '';
      node.style.animationDuration = '';
      node.style.animationDelay = '';
      node.style.animationDirection = '';
    }
    for (const undo of restore) undo();
    home.classList.remove('is-arranging');
  }

  return {
    stop,
    reset: () => { if (!stopped && !isDefaultLayout(current)) change(clone(DEFAULT_LAYOUT)); },
    layout: () => clone(current)
  };
}
