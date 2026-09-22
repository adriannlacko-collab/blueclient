/**
 * A strip of tabs with one tint that travels behind them, and a drag that
 * carries it: the masthead's tab bar, and from 2026-09-14 the Settings
 * section bar, which is the same control at a different size (Adrian: "the
 * settings category bar should look and feel exactly the same as the main
 * topbar … but it should keep the size it has currently").
 *
 * One slab that travels, rather than N that light up in turn (2026-09-07,
 * Adrian: "the top bar should kind of slide too, the selected button"). The
 * tabs are a strip you walk along and a marker that moves says so; independent
 * highlights say the opposite. It has to be a sibling of the buttons rather
 * than a background on the active one, because a background cannot travel
 * between two elements.
 *
 * Press and hold anywhere on the strip and the tint follows the pointer,
 * switching the page under it as it goes (2026-09-09, Adrian: "if you press
 * and hold on the top bar, the selection box of liquid glass smoothly follows
 * your cursor, and you can drag it around to switch between the different
 * pages", then: "I want the page to switch when you hover over a page … like
 * switching a normal page except you can just drag the slider").
 *
 * So the drag is not a picker that commits on release — the page changes the
 * moment the tint claims a new tab, with the same slide-in a click gives it,
 * and letting go changes nothing but the tint settling into place. Drag back
 * and you are back where you were; there is nothing to undo and nothing to
 * confirm. It costs one page render per tab crossed, which is what clicking
 * that tab would have cost anyway: the nearest tab only changes at the
 * halfway line between two, so a sweep along the bar renders each page once.
 *
 * A plain click is still a click: the drag only takes over once the pointer
 * has moved a few pixels, and for that press the tab's own click handler is
 * stood down, so releasing over a tab does not route twice. While the tint is
 * under the pointer it takes the width of whichever tab it is nearest, so it
 * arrives already the right shape.
 *
 * The strip's CSS is `.topnav` / `.nav-item` / `.nav-slide` in shell.css; a
 * second strip adds its own class beside those for whatever size it keeps.
 *
 * Since 2026-09-15 the profile editor's icon row is a strip too (Adrian: "make
 * it slide, just like when you switch pages in the top bar … and so you can
 * drag to slide too"): its items are the eight block swatches, its id is the
 * block's, and its travelling mark is the short cyan line under the pick
 * rather than a tint — the third argument says which selector, which
 * `data-` key, so nothing here names the masthead.
 *
 * A strip that has just appeared shows its mark in place; it does not slide
 * it there. Settings' bar is built afresh on every visit and the icon row on
 * every profile switch, and each used to draw its mark travelling in from the
 * left edge (Adrian, 2026-09-15: "you can see the slider go from left to
 * right … it should move instantly to the correct icon/settingscategory").
 * For an afternoon that same day the icon row was handed the outgoing row's
 * mark to glide from, profile to profile; that went with the fix — arriving
 * is not moving. The mark only travels for a press or a drag on the strip
 * it is on.
 */

import { el } from './dom.js';

/**
 * @param {HTMLElement} nav  the strip; the tab buttons are its `.nav-item`s,
 *   already mounted, each carrying the id this strip routes by in `data-tab`
 * @param {{ current: () => string, select: (id: string) => void }} spec
 *   `current` is asked for the id that is active now; `select` is told the
 *   id the hand or the click wants. Selecting must end in `move()`.
 * @returns {{ slide: HTMLElement, move: () => void, destroy: () => void }}
 */
/**
 * The third argument:
 *   item   the selector of the strip's items (`.nav-item`)
 *   key    the `data-` key each item carries its id in (`tab`)
 */
export function tabStrip(nav, { current, select }, { item = '.nav-item', key = 'tab' } = {}) {
  const slide = el('span', { class: 'nav-slide', 'aria-hidden': 'true' });
  nav.prepend(slide);

  /** While this is up the tint belongs to the hand; see move(). */
  let dragging = false;
  let swallowClick = false;
  let press = null;

  const items = () => [...nav.querySelectorAll(item)];

  const nearest = (clientX) => {
    const strip = nav.getBoundingClientRect();
    const x = clientX - strip.left;
    let best = null;
    let gap = Infinity;
    for (const item of items()) {
      const mid = item.offsetLeft + item.offsetWidth / 2;
      const d = Math.abs(mid - x);
      if (d < gap) { gap = d; best = item; }
    }
    return best;
  };

  const follow = (clientX) => {
    const strip = nav.getBoundingClientRect();
    const all = items();
    const tab = nearest(clientX);
    if (!tab) return;
    const width = tab.offsetWidth;
    /* Held between the first item's left edge and the last item's right edge
       — the items' own extent, not the strip's box. On the masthead the two
       are the same thing less its padding; the icon row fills its block and
       is wider than its eight swatches, and clamped to the box the line ran
       on past the last block (2026-09-15, Adrian: "I'm able to drag it past
       the last icon to the right"). */
    const first = all[0];
    const last = all[all.length - 1];
    const left = Math.min(Math.max(first.offsetLeft, clientX - strip.left - width / 2), last.offsetLeft + last.offsetWidth - width);
    slide.classList.remove('is-away');
    slide.style.width = `${width}px`;
    slide.style.transform = `translateX(${left}px)`;
  };

  /**
   * Put the travelling slab under the active tab.
   *
   * Measured rather than declared: the tabs size themselves to their labels
   * and shed padding at the narrow breakpoint, so there is no width to
   * hard-code.
   */
  const move = () => {
    /* The hand owns the tint while it is down. Switching page calls this
       from the route change, and without this line every tab the drag
       crossed would yank the slab out from under the pointer and back onto
       the new tab. */
    if (dragging) return;

    const active = items().find((node) => node.dataset[key] === current());
    /* A page reached from somewhere other than the strip has no tab of its
       own (Accounts, from the account menu). The slab waits where it is
       rather than pointing at something unselected. */
    if (!active) {
      slide.classList.add('is-away');
      return;
    }

    slide.classList.remove('is-away');
    slide.style.width = `${active.offsetWidth}px`;
    slide.style.transform = `translateX(${active.offsetLeft}px)`;
  };

  nav.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    press = { id: event.pointerId, startX: event.clientX, moved: false };
  });

  nav.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.id) return;
    if (!press.moved) {
      if (Math.abs(event.clientX - press.startX) < 5) return;
      press.moved = true;
      /* Captured only once it is a drag. Capturing on the press itself made
         the strip the target of the click that followed, and the tab under
         the pointer never heard it — every plain click on a tab went dead. */
      try { nav.setPointerCapture(event.pointerId); } catch { /* a pointer that cannot be held is still dragged */ }
      dragging = true;
      slide.classList.add('is-dragging');
    }
    follow(event.clientX);

    const over = nearest(event.clientX)?.dataset[key];
    if (over && over !== current()) select(over);
  });

  const release = (event) => {
    if (!press || event.pointerId !== press.id) return;
    const was = press;
    press = null;
    dragging = false;
    slide.classList.remove('is-dragging');
    if (!was.moved) return;                     // a click: the tab's own handler routes

    /* Armed for the click the browser sends after a pointerup, and disarmed
       on the next turn of the loop whether that click came or not. A drag the
       system takes away (`pointercancel`) is followed by no click at all, and
       an arm left standing would eat the next genuine press on a tab. */
    if (event.type === 'pointerup') {
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
    }
    /* The page changed under the hand on the way here, so there is normally
       nothing left to route to and this only settles the tint onto its tab.
       The route is still asked for because a drag that ends off the strip —
       a cancelled pointer — never got a last move over the tab it stopped on. */
    const tab = event.type === 'pointerup' ? nearest(event.clientX) : null;
    const id = tab?.dataset[key];
    if (id && id !== current()) select(id);
    move();
  };
  nav.addEventListener('pointerup', release);
  nav.addEventListener('pointercancel', release);

  /* The click that follows a drag's release would land on whichever tab the
     pointer let go over and route a second time; it is eaten here, before
     the tab sees it. */
  nav.addEventListener('click', (event) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);

  /* Placed on the first frame, not now: a strip is built before it is in the
     page (Settings' is handed back from render() and mounted after), and a tab
     that is not in the page measures 0 wide.

     Landed, flushed, then armed — in that order. A transition starts when a
     property's value changes between two style passes and the later pass
     carries the transition; place the mark and arm it in the same pass and
     the browser sees "0 wide at the left edge" become "under the tab, with a
     transition", and slides it there. Reading the slab's width between the
     two forces the placement through as its own pass, so when the transition
     arrives nothing has changed and nothing moves. (The masthead's slab never
     showed this only because the route places it before the frame; a strip
     that is placed here for the first time did, on every arrival.) */
  requestAnimationFrame(() => {
    move();
    void slide.offsetWidth;
    slide.classList.add('is-ready');
  });

  /* The tabs move under it when the window crosses the narrow breakpoint.
     A strip that is painted afresh on every visit (Settings) leaves the old
     one behind; its listener lets go the first time it finds itself gone. */
  const onResize = () => {
    if (!nav.isConnected) { destroy(); return; }
    move();
  };
  window.addEventListener('resize', onResize);

  /* And when its page says it is done with it (2026-09-22): the window held
     the listener, the listener the strip, and the strip its whole page, so
     every Settings visit and every profile picked in the editor stayed in
     memory until the next time the window was resized. The owner calls this
     when it rebuilds the strip or leaves the page; the check above is only
     the backstop for one that never says. */
  const destroy = () => window.removeEventListener('resize', onResize);

  return { slide, move, destroy };
}
