/**
 * A launcher's mark on a tile (2026-09-18) — the same tile wherever another
 * launcher is named: a row of "We found your profiles" (ui/found.js) and a
 * group's head on the Import panel (ui/importer.js). The four marks Adrian
 * sent are in assets/art/launchers/; anything else the scan knows the shape
 * of wears the folder glyph. Lunar's mark is white and sits on the darker
 * tint (components.css, .found__logo--lunar).
 */

import { el } from './dom.js';
import { icons } from '../icons.js';

const MARKED = new Set(['lunar', 'dawn', 'fastclient', 'minecraft']);

/** @param {string} id the launcher id main's scan uses; `small` for a group head. */
export function launcherLogo(id, { small = false } = {}) {
  return el('span', { class: `found__logo found__logo--${id}${small ? ' found__logo--sm' : ''}`, 'aria-hidden': 'true' }, [
    MARKED.has(id)
      ? el('img', { src: `assets/art/launchers/${id}.png`, alt: '', draggable: 'false' })
      : el('span', { html: icons.folderOpen, style: { display: 'contents' } })
  ]);
}
