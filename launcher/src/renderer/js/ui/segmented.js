/**
 * A segmented control: a glass track, and a tint that travels to the picked
 * segment the way the masthead's does behind the tabs.
 *
 * One builder for the three places that had each grown their own (the Clips
 * filter, the profile editor's loader row, and from 2026-09-09 the Mods page's
 * Mods / Resource packs switch). Every segment is the same width — the widest
 * label decides, in CSS — so the thumb is one shape wherever it sits and the
 * controls beside it never shift when the pick changes.
 *
 * The thumb is parked without a slide on the first paint: a slide belongs to
 * the click that caused it, and one played on arrival means nothing.
 *
 * Every label is written twice — once as read, once invisible in the picked
 * weight (2026-09-18, evening). The picked segment is semibold and the others
 * medium, and a semibold "Screenshots" is a hair wider than the 112px a
 * segment holds, so the whole bar grew 1.2px when Screenshots was picked and
 * shrank when it was not (Adrian: "the bar grows slightly larger, compared to
 * when pressing all and clips"). The ghost twin holds the semibold width from
 * the first paint, whatever is picked; the same label-stack the Clips folder
 * button uses for "Clips folder" / "Screenshots folder".
 *
 * `tint` makes the track a tint instead of glass, for a control that sits
 * inside a glass panel: a second sheet of glass over the first only stacks
 * darkness, and the profile editor's loader row read as a dark slot for it
 * (Adrian, 2026-09-09).
 */

import { el } from './dom.js';

/**
 * @param {{ options: {id: string, label: string}[], value: string,
 *   onChange?: (id: string) => void, label?: string, tint?: boolean }} spec
 * @returns {HTMLElement} the track, which also answers getValue() / setValue(id)
 */
export function segmented({ options, value, onChange, label, tint = false }) {
  const thumb = el('span', { class: 'segmented__thumb' });
  let current = value;

  const buttons = options.map((option) => el('button', {
    class: 'segmented__item',
    type: 'button',
    role: 'tab',
    'aria-selected': String(option.id === current),
    onClick: () => pick(option.id, true)
  }, [
    el('span', { class: 'label-stack' }, [
      el('span', { text: option.label }),
      el('span', { class: 'label-stack__ghost segmented__ghost', 'aria-hidden': 'true', text: option.label })
    ])
  ]));

  const row = el('div', {
    class: `segmented${tint ? ' segmented--tint' : ''}`,
    role: 'tablist',
    'aria-label': label || null
  }, [thumb, ...buttons]);

  function move(animate) {
    const active = buttons[options.findIndex((option) => option.id === current)];
    if (!active || !active.offsetWidth) return;
    if (!animate) {
      thumb.style.transition = 'none';
      requestAnimationFrame(() => { thumb.style.transition = ''; });
    }
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function pick(id, fromClick) {
    if (id === current) return;
    current = id;
    buttons.forEach((button, i) => button.setAttribute('aria-selected', String(options[i].id === id)));
    move(true);
    if (fromClick) onChange?.(id);
  }

  requestAnimationFrame(() => move(false));

  row.getValue = () => current;
  row.setValue = (id) => pick(id, false);
  row.remeasure = () => move(false);
  return row;
}
