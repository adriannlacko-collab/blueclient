import { el, trapFocus } from './dom.js';
import { icons } from '../icons.js';

let openDrawer = null;

/**
 * Slide-in panel anchored to the right edge.
 *
 * Same contract as openModal: `build(close)` returns the body, Escape and a
 * backdrop click both dismiss, focus is trapped while open. A drawer rather
 * than a dialog because browsing a catalogue is a side task — the list you
 * are adding to should stay visible behind it.
 */
export function openDrawerPanel({ title, subtitle, build, initialFocus, onClose }) {
  closeDrawer();

  const close = (result) => {
    if (!openDrawer) return;
    document.removeEventListener('keydown', onKeydown, true);
    releaseFocus();
    const node = openDrawer;
    openDrawer = null;
    node.classList.add('is-closing');

    // The panel slides for longer than the scrim fades, and animationend
    // bubbles — listening on the scrim tore the panel out mid-slide when the
    // fade finished first. Wait for the panel's own animation.
    const drop = (event) => {
      if (event && event.target !== panel) return;
      node.remove();
    };
    panel.addEventListener('animationend', drop);
    setTimeout(() => node.remove(), 500);
    onClose?.(result);
  };

  const onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const panel = el('aside', {
    class: 'drawer',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title
  }, [
    el('header', { class: 'drawer__head' }, [
      el('div', { class: 'stack truncate' }, [
        el('h2', { class: 'drawer__title', text: title }),
        subtitle && el('p', { class: 'drawer__sub', text: subtitle })
      ]),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'drawer__close',
        'aria-label': 'Close',
        html: icons.close,
        onClick: () => close()
      })
    ]),
    el('div', { class: 'drawer__body' }, build ? [].concat(build(close)) : [])
  ]);

  const scrim = el('div', {
    class: 'drawer-scrim',
    onMousedown: (event) => { if (event.target === scrim) close(); }
  }, [panel]);

  document.body.append(scrim);
  openDrawer = scrim;

  const releaseFocus = trapFocus(panel, initialFocus?.());
  document.addEventListener('keydown', onKeydown, true);

  return close;
}

export function closeDrawer() {
  openDrawer?.remove();
  openDrawer = null;
}
