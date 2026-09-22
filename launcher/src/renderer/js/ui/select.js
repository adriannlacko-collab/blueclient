/**
 * A dropdown of the launcher's own, in place of the browser's <select>.
 *
 * A native <select> draws its list in a popup the page cannot style, and over
 * the glass it came up as a white box with black rows — Adrian, 2026-09-09:
 * "make dropdown menus when selecting things like version etc darker, right
 * now it is just light mode on those dropdown menus". The button here wears
 * the same field styling the <select> did, and the list is the same glass
 * menu the account chip and the profile picker already open, with the current
 * choice marked and scrolled into view.
 *
 * The element returned is a <button> that also answers `getValue()`,
 * `setValue(v)` and `setOptions(list)`, so a caller that used to rebuild the
 * <select>'s <option>s repaints this the same way.
 */

import { el } from './dom.js';
import { icons } from '../icons.js';
import { openMenu } from './menu.js';

/**
 * @param {{ value: any, options: {value: any, label: string, disabled?: boolean}[],
 *   onChange?: (value: any) => void, label?: string, width?: number|string }} spec
 */
export function selectMenu({ value, options = [], onChange, label, width }) {
  const text = el('span', { class: 'select-btn__label truncate' });
  const button = el('button', {
    class: 'select select-btn',
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-label': label || null,
    onClick: (event) => open(event.currentTarget)
  }, [
    text,
    el('span', { class: 'select-btn__caret', html: icons.chevronDown })
  ]);
  if (width) button.style.width = typeof width === 'number' ? `${width}px` : width;

  let current = value;
  let list = options;

  function paint() {
    const hit = list.find((option) => option.value === current);
    text.textContent = hit ? hit.label : String(current ?? '');
  }

  function open(anchor) {
    openMenu(anchor, (close) => list.map((option) => {
      const on = option.value === current;
      return el('button', {
        class: `menu__item${on ? ' is-active' : ''}`,
        role: 'option',
        'aria-selected': String(on),
        disabled: option.disabled ? true : null,
        onClick: () => {
          close();
          if (on) return;
          current = option.value;
          paint();
          onChange?.(option.value);
        }
      }, [
        el('span', { class: 'truncate', text: option.label }),
        on && el('span', { class: 'menu__check', html: icons.check })
      ]);
    }), {
      align: 'start',
      /* The button's own width, and no floor of its own: a dropdown is the
         list of what its button says, so it opens at the button's width and
         grows only for a row too long to fit. The 220 it used to insist on
         hung 50px off the side of the panel holding a 138px picker
         (2026-09-10, the Browse skins modes). */
      width: anchor.offsetWidth,
      scroll: true,
      current: '.menu__item.is-active'
    });
  }

  paint();
  button.getValue = () => current;
  button.setValue = (next) => { current = next; paint(); };
  button.setOptions = (next) => { list = next; paint(); };
  return button;
}
