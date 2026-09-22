/**
 * Icon set — inline SVG, stroke-based, 24×24 grid, `currentColor`.
 * Inlined rather than loaded from a font or sprite sheet so icons never
 * flash-of-unstyled and the launcher has zero network dependencies.
 */

const svg = (paths, opts = {}) =>
  `<svg viewBox="0 0 24 24" fill="${opts.fill || 'none'}" stroke="${opts.stroke || 'currentColor'}" ` +
  `stroke-width="${opts.width || 1.9}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  /* ---- A video camera: a clip's empty state ---- */
  film: svg('<rect x="2" y="6" width="14" height="12"/><path d="M16 10l6-3.5v11L16 14"/>'),

  /* ---- A picture: screenshots' empty state ---- */
  image: svg('<rect x="3" y="4" width="18" height="16"/><circle cx="8.5" cy="9.5" r="1.5"/>' +
    '<path d="M21 16l-5-5-6 6-2-2-5 5"/>'),

  /* ---- A clapperboard: the Clips tab (2026-09-09, Adrian: "an actual clip
     emoji / camera or whatever"). A picture frame said "screenshots"; the
     board says "clips" at a glance and still holds a screenshot happily. ---- */
  clapper: svg('<path d="M3 10h18v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>' +
    '<path d="M3.6 10 2.8 6.9a1 1 0 0 1 .7-1.2l14.5-3.9a1 1 0 0 1 1.2.7l.8 3.1"/>' +
    '<path d="m7.4 8.9 1.9-4.3M12.2 7.6l1.9-4.3M17 6.3l1.4-3.1"/>'),

  /* ---- Brand: an atom — three orbits round a nucleus ----
     Painted from #brandGradient in index.html rather than currentColor, so the
     mark carries the same sweep as every other accent fill. */
  atom: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    // Orbits at -30/30/90 rather than 0/60/120: the reference has an upright
    // orbit and no flat one. Ratio is 2.6:1, thinner than a generic atom.
    '<g stroke="url(#brandGradient)" stroke-width="1.3">' +
    '<ellipse cx="12" cy="12" rx="10.5" ry="4.02" transform="rotate(-30 12 12)"/>' +
    '<ellipse cx="12" cy="12" rx="10.5" ry="4.02" transform="rotate(30 12 12)"/>' +
    '<ellipse cx="12" cy="12" rx="10.5" ry="4.02" transform="rotate(90 12 12)"/>' +
    '</g>' +
    '<circle cx="12" cy="12" r="1.75" fill="url(#brandGradient)"/>' +
    '</svg>',

  /* ---- Brand: a beam of light rising from a block ---- */
  beam: svg(
    '<path d="M9.4 2.5v9M14.6 2.5v9" opacity=".55"/><path d="M5.4 12.4h13.2l-1.6 8.7H7z"/><path d="m12 15.2 2 2-2 2-2-2z"/>',
    { width: 1.7 }
  ),

  /* ---- Navigation ---- */
  /* ---- Play: the triangle, with its three corners rounded off (2026-09-14
     — Adrian, holding Lunar's play button beside ours: "ours is very edge …
     this one is very smooth edges; use the same shape everywhere"). The
     same triangle as before — 7,4.5 / 19,12 / 7,19.5 — each corner cut two
     units in along both edges and bridged with a curve through the point,
     the tip a little more; the round-joined stroke softens it the rest of
     the way. One glyph, so the Play button, the Play tab, Continue and
     every world's Play change together. ---- */
  play: svg('<path d="M7 7.7Q7 4.5 9.71 6.2L15.95 10.09Q19 12 15.95 13.91L9.71 17.8Q7 19.5 7 16.3Z"/>', { fill: 'currentColor', stroke: 'currentColor', width: 1.6 }),
  layers: svg(
    '<path d="M12 2.8 2.6 7.5 12 12.2l9.4-4.7L12 2.8Z"/><path d="m2.6 12.4 9.4 4.7 9.4-4.7"/><path d="m2.6 16.9 9.4 4.7 9.4-4.7"/>'
  ),
  puzzle: svg(
    '<path d="M9.5 3.5a2 2 0 1 1 4 0V5h3a1.5 1.5 0 0 1 1.5 1.5v3h1.5a2 2 0 1 1 0 4H18v3a1.5 1.5 0 0 1-1.5 1.5h-3v1.5a2 2 0 1 1-4 0V18h-3A1.5 1.5 0 0 1 5 16.5v-3H3.5a2 2 0 1 1 0-4H5v-3A1.5 1.5 0 0 1 6.5 5h3V3.5Z"/>'
  ),
  settings: svg(
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.6 14.6a1.5 1.5 0 0 0 .3 1.65l.06.06a1.8 1.8 0 1 1-2.55 2.55l-.06-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37v.17a1.8 1.8 0 1 1-3.6 0v-.09a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06a1.8 1.8 0 1 1-2.55-2.55l.06-.06a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9h-.17a1.8 1.8 0 1 1 0-3.6h.09a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.06-.06a1.8 1.8 0 1 1 2.55-2.55l.06.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37v-.17a1.8 1.8 0 1 1 3.6 0v.09a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.8 1.8 0 1 1 2.55 2.55l-.06.06a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9h.17a1.8 1.8 0 1 1 0 3.6h-.09a1.5 1.5 0 0 0-1.37.9Z"/>',
    { width: 1.6 }
  ),
  /* ---- A globe: the Worlds tab (2026-09-11) — circle, equator, meridian ---- */
  globe: svg(
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="3.6" ry="9"/>',
    { width: 1.7 }
  ),

  /* ---- Window controls (1px hairlines, drawn on a 10px box) ---- */
  minimize: svg('<path d="M4 12h16"/>', { width: 1.6 }),
  maximize: svg('<rect x="4.5" y="4.5" width="15" height="15" rx="1.6"/>', { width: 1.6 }),
  restore: svg(
    '<rect x="4.5" y="7.5" width="12" height="12" rx="1.6"/><path d="M8 7.5V6a1.5 1.5 0 0 1 1.5-1.5H18A1.5 1.5 0 0 1 19.5 6v8.5A1.5 1.5 0 0 1 18 16h-1.5"/>',
    { width: 1.6 }
  ),
  close: svg('<path d="M5 5l14 14M19 5 5 19"/>', { width: 1.7 }),


  /* ---- FastClient chrome ---- */
  home: svg('<path d="M3.5 10.2 12 3.4l8.5 6.8V20a1.4 1.4 0 0 1-1.4 1.4h-4.3v-6.1H9.2v6.1H4.9A1.4 1.4 0 0 1 3.5 20Z"/>', { width: 1.7 }),
  folderOpen: svg('<path d="M3 7.6A1.9 1.9 0 0 1 4.9 5.7h3.7a1.9 1.9 0 0 1 1.5.8l.9 1.2H19a1.9 1.9 0 0 1 1.9 1.9v.6"/><path d="M3 7.6v10.5a1.9 1.9 0 0 0 1.9 1.9h13.4a1.9 1.9 0 0 0 1.85-1.5l1.35-6.4a1.2 1.2 0 0 0-1.18-1.45H6.3a1.9 1.9 0 0 0-1.86 1.52L3 18.1"/>', { width: 1.7 }),
  serverStack: svg('<rect x="3" y="4.5" width="18" height="6" rx="1.8"/><rect x="3" y="13.5" width="18" height="6" rx="1.8"/><path d="M6.8 7.5h.01M6.8 16.5h.01"/>', { width: 1.7 }),
  terminal: svg('<path d="m5 8 4 4-4 4"/><path d="M12 16h7"/>', { width: 1.9 }),
  shirt: svg('<path d="M8.5 3.5 12 5.6l3.5-2.1 5 2.6-1.9 4.2-2.1-.8v9.1a1 1 0 0 1-1 1H8.5a1 1 0 0 1-1-1V9.5l-2.1.8L3.5 6.1Z"/>', { width: 1.6 }),
  layers: svg('<path d="M12 2.8 2.6 7.5 12 12.2l9.4-4.7L12 2.8Z"/><path d="m2.6 12.4 9.4 4.7 9.4-4.7"/><path d="m2.6 16.9 9.4 4.7 9.4-4.7"/>'),
  wrench: svg('<path d="M15.6 3.6a5.2 5.2 0 0 0-6.4 6.6L3.4 16a2 2 0 1 0 2.8 2.8l5.8-5.8a5.2 5.2 0 0 0 6.6-6.4l-3 3-2.4-.6-.6-2.4Z"/>', { width: 1.7 }),
  bolt: svg('<path d="M12.5 2.5 5 13.2h5.2L9.9 21.5 18 10.8h-5.3Z"/>', { width: 1.6 }),
  cube: svg('<path d="M12 2.9 20.5 7.5v9L12 21.1 3.5 16.5v-9L12 2.9Z"/><path d="m3.7 7.4 8.3 4.5 8.3-4.5"/><path d="M12 21.1v-9.2"/>', { width: 1.6 }),
  gauge: svg('<circle cx="12" cy="12" r="9"/><path d="M12 12 15.5 8.5"/><path d="M12 12h.01"/>', { width: 1.7 }),
  drive: svg('<rect x="2.6" y="5" width="18.8" height="14" rx="2.4"/><path d="M2.6 13h18.8"/><path d="M6.5 16.5h.01M10 16.5h.01"/>', { width: 1.7 }),
  lifebuoy: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.6"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>', { width: 1.6 }),
  stopSq: svg('<rect x="7" y="7" width="10" height="10" rx="1.6"/>', { width: 1.8 }),

  /* ---- Shell chrome ---- */
  rocket: svg('<path d="M12.5 3.2c3 1.4 5.4 4.5 5.8 8.2l-4.2 4.2-4.6-4.6 4.2-4.2"/><path d="M9.5 11.1 5.2 12l-1.7 1.7 3 1.1M12.9 14.5l.9 4.3-1.7 1.7-1.1-3"/><path d="m3.6 20.4 2.6-2.6"/><circle cx="14.4" cy="9.6" r="1.3"/>', { width: 1.7 }),
  bell: svg('<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.2 7.5-2.2 7.5h16.4S18 14.5 18 8.5"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>', { width: 1.7 }),
  /* ---- The play record (2026-09-12, evening): the six milestone tracks, a
     rosette for an earned one, and a flame for the streak. ---- */
  flame: svg('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>', { width: 1.8 }),
  award: svg('<circle cx="12" cy="8" r="5.5"/><path d="M15.2 12.6 16.8 21.5 12 18.6 7.2 21.5l1.6-8.9"/>', { width: 1.8 }),
  sword: svg('<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/>', { width: 1.8 }),
  skull: svg('<path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z"/><path d="m12.5 17-.5-1-.5 1h1z"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>', { width: 1.7 }),
  compass: svg('<circle cx="12" cy="12" r="9.5"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>', { width: 1.8 }),
  calendar: svg('<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3.5 10.5h17"/>', { width: 1.8 }),

  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', { width: 1.8 }),
  users: svg('<circle cx="9" cy="8" r="3.6"/><path d="M2.8 20.2a6.2 6.2 0 0 1 12.4 0"/><path d="M16.5 4.8a3.6 3.6 0 0 1 0 6.9"/><path d="M18.4 14.4a6.2 6.2 0 0 1 2.8 5.2"/>', { width: 1.7 }),
  server: svg('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>', { width: 1.7 }),
  layout: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 10h18M9 10v10"/>', { width: 1.7 }),
  grid: svg('<rect x="3.2" y="3.2" width="7.4" height="7.4" rx="1.6"/><rect x="13.4" y="3.2" width="7.4" height="7.4" rx="1.6"/><rect x="3.2" y="13.4" width="7.4" height="7.4" rx="1.6"/><rect x="13.4" y="13.4" width="7.4" height="7.4" rx="1.6"/>', { width: 1.7 }),
  filter: svg('<path d="M3.5 5.5h17M6.5 12h11M10 18.5h4"/>', { width: 1.9 }),
  swap: svg('<path d="M7.5 4.5 4 8l3.5 3.5"/><path d="M4 8h12a4 4 0 0 1 0 8h-1"/><path d="m16.5 19.5 3.5-3.5-3.5-3.5"/>', { width: 1.7 }),

  /* ---- Chevrons / arrows ---- */
  chevronLeft: svg('<path d="m15 6-6 6 6 6"/>', { width: 2.1 }),
  chevronDown: svg('<path d="m6 9 6 6 6-6"/>', { width: 2.1 }),
  chevronRight: svg('<path d="m9 6 6 6-6 6"/>', { width: 2.1 }),
  chevronUp: svg('<path d="m6 15 6-6 6 6"/>', { width: 2.1 }),
  arrowUpRight: svg('<path d="M7 17 17 7M8 7h9v9"/>'),

  /* ---- Actions ---- */
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', { width: 2.1 }),
  check: svg('<path d="m4.5 12.5 5 5 10-11"/>', { width: 2.3 }),
  trash: svg('<path d="M3.5 6h17"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M18.5 6v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6"/><path d="M10 11v5M14 11v5"/>'),
  folder: svg('<path d="M3 7.5A2 2 0 0 1 5 5.5h3.9a2 2 0 0 1 1.6.8l1 1.4H19a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11Z"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-13.6-4.6L3 9.5"/><path d="M3 4.5v5h5"/><path d="M4 13a8 8 0 0 0 13.6 4.6L21 14.5"/><path d="M21 19.5v-5h-5"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>'),
  edit: svg('<path d="M12.5 5.5H6a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2v-6.5"/><path d="M17 3.6a1.9 1.9 0 0 1 2.7 2.7L12.4 13.6l-3.4.8.8-3.4L17 3.6Z"/>'),
  download: svg('<path d="M12 3.5v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 16.5v2A2 2 0 0 0 6 20.5h12a2 2 0 0 0 2-2v-2"/>'),
  externalLink: svg('<path d="M14 4.5h5.5V10"/><path d="M19 5 11 13"/><path d="M18.5 14v4.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2H10"/>'),
  power: svg('<path d="M12 3.5v8"/><path d="M17.6 6.9a8 8 0 1 1-11.2 0"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2.4" fill="currentColor" stroke="none"/>'),
  command: svg('<path d="M8.5 5.5A2.5 2.5 0 1 0 6 8h12a2.5 2.5 0 1 0-2.5-2.5v13A2.5 2.5 0 1 0 18 16H6a2.5 2.5 0 1 0 2.5 2.5v-13Z"/>', { width: 1.7 }),

  /* ---- A star: the favourite mark on a clip or screenshot card (2026-09-19).
     Outline like every other stroke here; the card fills it with
     currentColor once the mark is on (pages.css, .clip-card__star), so one
     glyph is both states and nothing is swapped when it is pressed. ---- */
  star: svg('<path d="M12 2.8l2.85 5.85 6.45.9-4.7 4.5 1.15 6.4L12 17.4l-5.75 3.05 1.15-6.4-4.7-4.5 6.45-.9Z"/>'),

  /* ---- Objects ---- */
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M15 5.5a2.5 2.5 0 0 0-2.5-2.5H5.5A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15"/>', { width: 1.7 }),
  /* A padlock: the featured row a server that checks accounts turns an offline account away from (2026-09-22). */
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>', { width: 1.7 }),
  shield: svg('<path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.6 7.5 10 4.4-1.4 7.5-5.4 7.5-10v-6L12 2.5Z"/>', { width: 1.7 }),
  /* The four-pane Microsoft mark, monochrome so it sits on any fill. */
  microsoft: svg(
    '<rect x="4" y="4" width="7.4" height="7.4"/><rect x="12.6" y="4" width="7.4" height="7.4"/>' +
    '<rect x="4" y="12.6" width="7.4" height="7.4"/><rect x="12.6" y="12.6" width="7.4" height="7.4"/>',
    { fill: 'currentColor', stroke: 'none', width: 0 }
  ),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  userPlus: svg('<circle cx="9.5" cy="8" r="4"/><path d="M2.5 20.5a7 7 0 0 1 14 0"/><path d="M19 8.5v5M21.5 11h-5"/>'),
  logOut: svg('<path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5"/><path d="m15.5 16 4-4-4-4"/><path d="M19.5 12H9"/>'),
  cpu: svg('<rect x="7" y="7" width="10" height="10" rx="2"/><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9.5 1.5v2M14.5 1.5v2M9.5 20.5v2M14.5 20.5v2M1.5 9.5h2M1.5 14.5h2M20.5 9.5h2M20.5 14.5h2"/>', { width: 1.6 }),
  memory: svg('<rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M6.5 17v3M12 17v3M17.5 17v3"/><path d="M6.5 10.5v3M12 10.5v3M17.5 10.5v3"/>', { width: 1.6 }),
  coffee: svg('<path d="M4 8.5h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-6Z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7.5 2.5c-.8 1.2-.8 2.3 0 3.5M11.5 2.5c-.8 1.2-.8 2.3 0 3.5"/>', { width: 1.6 }),
  monitor: svg('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 17v4"/>', { width: 1.6 }),
  cube: svg('<path d="M12 2.9 20.5 7.5v9L12 21.1 3.5 16.5v-9L12 2.9Z"/><path d="m3.7 7.4 8.3 4.5 8.3-4.5"/><path d="M12 21.1v-9.2"/>', { width: 1.6 }),
  palette: svg('<path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2h1.9A3.9 3.9 0 0 0 21 10.7 9 9 0 0 0 12 3Z"/><circle cx="7.7" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.2" cy="7.6" r="1.1" fill="currentColor" stroke="none"/>', { width: 1.6 }),

  /* ---- The cosmetics still to come, on the Cosmetics page's shelf
     (2026-09-17). Silhouettes of a kind, not of any item: a kind that
     arrives brings its own pictures and its icon leaves. ---- */
  hat: svg('<path d="M6.5 15V9.5a5.5 5.5 0 0 1 11 0V15"/><path d="M3 15h18"/><path d="M6.5 15c0 2 2.5 3 5.5 3s5.5-1 5.5-3"/>', { width: 1.8 }),
  wings: svg('<path d="M12 11.5C11 7.5 8 4.5 3 4.5c1 4 3 6 5 7-1 1-2 3-2 6 3-1 5-3 6-6Z"/><path d="M12 11.5c1-4 4-7 9-7-1 4-3 6-5 7 1 1 2 3 2 6-3-1-5-3-6-6Z"/>', { width: 1.8 }),
  bandana: svg('<path d="M4.5 7.5h15"/><path d="M6.5 7.5c0 4.5 2.5 8 5.5 9.5 3-1.5 5.5-5 5.5-9.5"/><path d="M4.5 7.5 3 4.5M19.5 7.5 21 4.5"/>', { width: 1.8 }),
  emote: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c1 1.4 2.2 2.1 3.5 2.1s2.5-.7 3.5-2.1"/><path d="M9.2 9.5h.01M14.8 9.5h.01"/>'),
  trail: svg('<path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8-4.8-1.7 4.8-1.7Z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z"/>', { width: 1.8 }),
  backpack: svg('<rect x="5" y="7.5" width="14" height="13" rx="3"/><path d="M9 7.5V5.5a3 3 0 0 1 6 0v2"/><path d="M5 13.5h14"/><path d="M10 16.5h4"/>', { width: 1.8 }),

  /* ---- Feedback ---- */
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>'),
  alert: svg('<path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3.1L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 16.6v.2"/>'),
  checkCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16 9.6"/>'),
  xCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>')
};

/** Render an icon into a DOM element (used where innerHTML is awkward). */
export function icon(name) {
  const el = document.createElement('span');
  el.className = 'icon';
  el.innerHTML = icons[name] || '';
  return el.firstElementChild;
}
