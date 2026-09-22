import { el, trapFocus } from './dom.js';
import { icons } from '../icons.js';

/* The dialog on screen: the scrim under it, and what has to be undone when
   it goes. One at a time — opening a second modal replaces the first. */
let live = null;

/** A dropdown (ui/menu.js) is up — it hangs off <body>, over the scrim. */
const menuOpen = () => Boolean(document.querySelector('.menu'));

/**
 * Open a modal.
 *
 * `build(close)` returns the body content; `actions(close)` returns footer
 * buttons. Escape and a backdrop click both close, focus is trapped while
 * open and restored on close.
 *
 * A modal opened while another is up **replaces** it on the scrim already
 * there rather than building a second one. Skins and Browse skins are two
 * panels either of which opens the other, and each swap used to tear the
 * scrim down and put a new one up: its fade ran again from nothing, so the
 * whole window lifted to full brightness and dimmed again, with the incoming
 * pane's blur coming up from zero over the top of it — the flicker Adrian
 * reported going back and forth between the two (2026-09-10). Now the dim
 * never moves, the pane stays put and glides between the two heights, and
 * only what is written on it changes.
 *
 * **`spotlight` (2026-09-18).** The ordinary scrim dims the whole window, the
 * pane included: a dialog's glass samples a world already at 58%, which is
 * why a dialog reads darker than the cards beside it. Adrian, on the first
 * "We found your profiles" mockup: "so dark and weird" — and then, of the
 * version drawn over the bare world, "the popup should look exactly as it
 * does … but around the popup in the background needs to be darker or
 * slightly blurry". So a spotlight dialog keeps the scrim clear and puts the
 * dim on its own outer shadow, which stops at its rounded edge — the pane's
 * glass samples the undimmed world, measured the same colour as a card — and
 * a layer under the scrim blurs everything else through a hole cut where the
 * pane stands. Costs nothing measurable with the live world turning (7.0 ms a
 * frame median, with or without). The hole follows the window. A panel that
 * replaces a spotlight one on the same scrim gets the ordinary dim back,
 * faded in the way scrim-in fades it.
 */
export function openModal({ title, subtitle, build, actions, wide = false, xl = false, className = '', initialFocus, onClose, spotlight = false }) {
  const previous = live;
  const scrim = previous ? previous.scrim : el('div', {
    class: 'scrim',
    /* `live`, not this modal's own close: the scrim outlasts the panel that
       built it, so a click on it dismisses whatever is on it now.

       Not while a dropdown is open, though: a menu hangs off <body> above
       the scrim, so a click beside it to put it away lands on the scrim,
       and Escape reaches this document listener as well as the menu's. Both
       used to take the whole panel down with the menu — pick "Category" in
       Browse skins, change your mind, press Escape, and you were back on
       Home (2026-09-10). The menu's own handlers close the menu; the panel
       stays. */
    onMousedown: (event) => {
      if (event.target !== event.currentTarget || menuOpen()) return;
      live?.close();
    }
  });

  /* Measured before the outgoing panel leaves, so the pane can glide from the
     height it was to the height it becomes. */
  const from = previous ? previous.dialog.getBoundingClientRect().height : 0;
  previous?.retire();

  const self = { scrim };

  const close = (result) => {
    if (live !== self) return;
    live = null;
    scrim.remove();
    self.retire(result);
  };

  const onKeydown = (event) => {
    if (event.key === 'Escape' && !menuOpen()) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const dialog = el('div', {
    class: `modal${wide ? ' modal--wide' : ''}${xl ? ' modal--xl' : ''}${spotlight ? ' modal--spot' : ''}${className ? ' ' + className : ''}${previous ? ' modal--swap' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title
  }, [
    el('div', { class: 'modal__head' }, [
      el('div', {}, [
        el('h2', { class: 'modal__title', text: title }),
        subtitle && el('p', { class: 'modal__sub', text: subtitle })
      ]),
      el('button', { class: 'modal__close', 'aria-label': 'Close', html: icons.close, onClick: () => close() })
    ]),
    el('div', { class: 'modal__body' }, build ? [].concat(build(close)) : []),
    actions && el('div', { class: 'modal__foot' }, [].concat(actions(close)))
  ]);

  scrim.replaceChildren(dialog);
  // `isConnected`, not `!previous`: a scrim carried over from the panel this
  // one replaces is already on the page, and one that somehow is not still
  // has to go on rather than leave the launcher with a dialog nobody can see.
  if (!scrim.isConnected) document.body.append(scrim);

  /* The spotlight surround — see the note above. The scrim goes clear (the
     dim is the pane's own shadow now), and the blur layer sits under it with
     the pane's rectangle cut out, inset a little so the cut never shows past
     the pane's rounded corners. Measured after the dialog is in the document,
     and again whenever the window changes size. `scrim--clear` is taken off
     when this panel leaves, so a panel replacing it on the same scrim gets
     the ordinary dim back. */
  let blurLayer = null;
  const cutHole = () => {
    if (!blurLayer) return;
    const r = dialog.getBoundingClientRect();
    const inset = 12;
    const x0 = r.left + inset, y0 = r.top + inset, x1 = r.right - inset, y1 = r.bottom - inset;
    blurLayer.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x0}px ${y0}px, ${x0}px ${y1}px, ${x1}px ${y1}px, ${x1}px ${y0}px, ${x0}px ${y0}px)`;
  };
  if (spotlight) {
    scrim.classList.add('scrim--clear');
    blurLayer = el('div', { class: 'scrim__blur', 'aria-hidden': 'true' });
    document.body.insertBefore(blurLayer, scrim);
    cutHole();
    window.addEventListener('resize', cutHole);
  }

  /* The spotlight's dim arrives on a box of its own and hands over to the
     pane's shadow when it lands (2026-09-22) — components.css, .modal__dim,
     says why. The box is the pane's size, and kept so while the pane can
     still change (its rows landing); a panel replacing another on the same
     scrim has its dim already, and arrives without one. */
  let dim = null;
  let fit = null;
  const landed = () => {
    if (!dim) return;
    fit?.disconnect();
    dim.remove();
    dim = null;
    dialog.classList.remove('is-arriving');
  };
  if (spotlight && !previous) {
    dim = el('div', { class: 'modal__dim', 'aria-hidden': 'true' });
    const size = () => {
      if (!dim) return;
      const style = getComputedStyle(dialog);
      dim.style.width = style.width;
      dim.style.height = style.height;
    };
    size();
    dialog.classList.add('is-arriving');
    scrim.insertBefore(dim, dialog);
    fit = new ResizeObserver(size);
    fit.observe(dialog);
    dim.addEventListener('animationend', (event) => {
      if (event.animationName === 'sheet-in') landed();
    });
    // An arrival that never ends (reduced motion ends it at once; a hidden
    // window may not run it) still has to hand over. Well clear of it.
    setTimeout(landed, 1200);
  }

  /* `initialFocus` is a function so it can name a node the body built a
     moment ago — a panel that opens on a search field should be typing into
     it, not tabbing to it. */
  const releaseFocus = trapFocus(dialog, initialFocus?.());
  document.addEventListener('keydown', onKeydown, true);

  /* Off the screen. `close` takes the scrim with it; `retire` leaves the
     scrim for whatever replaces this panel. Either way the panel has closed,
     so both come through here and `onClose` runs exactly once — a swap used
     to be `scrim.remove()` on its own, which skipped the outgoing panel's
     `onClose` and left its Escape handler on the document and its focus trap
     unreleased: two traps deep after one trip to Browse skins. */
  let gone = false;
  self.retire = (result) => {
    if (gone) return;
    gone = true;
    document.removeEventListener('keydown', onKeydown, true);
    releaseFocus();
    landed();
    if (spotlight) {
      window.removeEventListener('resize', cutHole);
      blurLayer?.remove();
      scrim.classList.remove('scrim--clear');
    }
    dialog.remove();
    onClose?.(result);
  };
  self.dialog = dialog;
  self.close = close;
  live = self;

  if (previous) glideHeight(dialog, from, blurLayer ? cutHole : null);

  return close;
}

export function closeModal() {
  live?.retire();
  live?.scrim.remove();
  live = null;
}

/**
 * Grow the pane from the height it had into the height it now wants.
 *
 * Only between two panels on one scrim. The pane is glass over a live world:
 * jumping from 440px to 766px between one frame and the next re-blurs a
 * different piece of the world at a different size, which is the second half
 * of what read as a glitch. Under a tenth of a second it settles.
 */
function glideHeight(dialog, from, recut) {
  const to = dialog.getBoundingClientRect().height;
  if (!from || !to || Math.abs(to - from) < 8) return;

  const done = () => {
    dialog.style.height = '';
    dialog.style.transition = '';
    recut?.();
  };

  dialog.style.height = `${from}px`;
  dialog.getBoundingClientRect();               // the old height, this frame
  /* A spotlight pane's hole was cut at the height it becomes; while it is
     still the height it was, the hole is cut to that, and cut again once it
     has grown — a pane over the blurred world is unnoticeable, blurred world
     showing past a pane's edge is not. */
  recut?.();
  dialog.style.transition = 'height var(--dur-fast) var(--ease-out)';
  dialog.style.height = `${to}px`;

  dialog.addEventListener('transitionend', (event) => {
    if (event.propertyName === 'height') done();
  }, { once: true });
  // A transition that never fires — the panel closed mid-glide, the window
  // was hidden — still has to let go of the height it was given. Well clear
  // of --dur-fast: reaching this before the glide ends would cut it.
  setTimeout(done, 1200);
}

/**
 * Confirmation. Returns a promise resolving true/false.
 *
 * `message` is one sentence; `lines` is several, each its own paragraph —
 * warnings that have more than one thing to say (what is shared, and what
 * that costs) read as a list rather than a wall.
 */
export function confirmModal({ title, message, lines, confirmLabel = 'Delete', danger = true }) {
  const paragraphs = lines || (message ? [message] : []);

  return new Promise((resolve) => {
    let settled = false;
    openModal({
      title,
      build: () => paragraphs.map((text) => el('p', {
        class: 'muted',
        text,
        style: { lineHeight: 'var(--leading-normal)' }
      })),
      actions: (close) => [
        el('button', { class: 'btn btn--ghost', text: 'Cancel', onClick: () => close(false) }),
        el('button', {
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
          text: confirmLabel,
          onClick: () => close(true)
        })
      ],
      onClose: (result) => {
        if (settled) return;
        settled = true;
        resolve(result === true);
      }
    });
  });
}
