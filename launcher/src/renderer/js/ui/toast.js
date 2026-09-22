import { el } from './dom.js';
import { icons } from '../icons.js';

const layer = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
document.body.append(layer);

const GLYPH = {
  success: icons.checkCircle,
  error: icons.xCircle,
  info: icons.info,
  /* A level reached or a milestone earned (2026-09-12, evening) — see play.js. */
  level: icons.award
};

/**
 * Transient confirmation. Deliberately capped at three visible at once —
 * a stack taller than that is noise, not feedback.
 */
export function toast(message, kind = 'info', duration = 3200) {
  while (layer.children.length >= 3) layer.firstElementChild.remove();

  const node = el('div', { class: `toast toast--${kind}` }, [
    el('span', { class: 'toast__icon', html: GLYPH[kind] || GLYPH.info }),
    el('span', { class: 'toast__text', text: message })
  ]);

  layer.append(node);

  const dismiss = () => {
    if (node.dataset.leaving) return;
    node.dataset.leaving = 'true';
    node.addEventListener('animationend', () => node.remove(), { once: true });
  };

  const timer = setTimeout(dismiss, duration);
  node.addEventListener('click', () => { clearTimeout(timer); dismiss(); });

  return dismiss;
}
