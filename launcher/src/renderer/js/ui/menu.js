import { el } from './dom.js';

let current = null;

/**
 * Anchored dropdown. Positioned against the trigger's bounding box and
 * flipped when it would overflow the window, so menus near the bottom or the
 * right edge stay fully on screen.
 */
export function openMenu(anchor, build, { align = 'end', width, scroll = false, current: currentRow } = {}) {
  const alreadyOpen = current?.anchor === anchor;
  closeMenu();
  if (alreadyOpen) return null;

  /* `scroll` caps the height and scrolls the list — a version picker is sixty
     rows — and `current` names the row to open on, which is focused and
     scrolled into view in place of the first one (2026-09-09, the dropdowns). */
  const menu = el('div', { class: `menu${scroll ? ' menu--scroll' : ''}`, role: 'menu' });
  if (width) menu.style.minWidth = `${width}px`;

  const close = () => closeMenu();
  menu.append(...[].concat(build(close)).filter(Boolean));
  document.body.append(menu);

  position(menu, anchor, align);
  anchor.setAttribute('aria-expanded', 'true');

  const onPointerDown = (event) => {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) close();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  };
  const onScroll = (event) => {
    if (!menu.contains(event.target)) close();
  };

  // Deferred so the click that opened the menu doesn't immediately close it.
  setTimeout(() => document.addEventListener('pointerdown', onPointerDown, true));
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', onScroll, true);

  current = {
    anchor,
    menu,
    teardown() {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      anchor.setAttribute('aria-expanded', 'false');
      menu.remove();
    }
  };

  const opener = (currentRow && menu.querySelector(currentRow)) || menu.querySelector('button:not([disabled])');
  if (currentRow && opener) opener.scrollIntoView({ block: 'center' });
  opener?.focus();
  return close;
}

export function closeMenu() {
  current?.teardown();
  current = null;
}

function position(menu, anchor, align) {
  const gap = 6;
  const pad = 8;
  const box = anchor.getBoundingClientRect();
  const size = menu.getBoundingClientRect();

  let left = align === 'end' ? box.right - size.width : box.left;
  left = Math.min(Math.max(pad, left), window.innerWidth - size.width - pad);

  let top = box.bottom + gap;
  if (top + size.height > window.innerHeight - pad) {
    const above = box.top - size.height - gap;
    top = above >= pad ? above : Math.max(pad, window.innerHeight - size.height - pad);
    menu.style.transformOrigin = 'bottom right';
  }

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

/* ---- menu building blocks ---- */

export const menuLabel = (text) => el('div', { class: 'menu__label', text });
export const menuSeparator = () => el('div', { class: 'menu__sep' });

export const menuItem = ({ label, icon, onSelect, danger = false, disabled = false }) =>
  el('button', {
    class: `menu__item${danger ? ' menu__item--danger' : ''}`,
    role: 'menuitem',
    disabled,
    onClick: onSelect
  }, [
    icon && el('span', { html: icon, style: { display: 'contents' } }),
    el('span', { text: label })
  ]);
