import { el } from './dom.js';
import { icons } from '../icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { host } from '../bridge.js';
import { state, updateSettings, paintWorldBlur, paintWorldBrightness } from '../state.js';
import { pictureUrl, forgetPicture } from '../backgrounds.js';

/**
 * Background (2026-09-21, Adrian: "add a 'Background' button in the bottom
 * left corner, a small button, where people can click it and switch
 * background, upload there own backgruond, etc."). The panel behind that
 * capsule on Home: the world — the turning one the launcher has always
 * shown — and the player's own pictures as tiles, an Add tile at the end
 * that opens the file dialog, and the two sliders the world already had in
 * Settings › General (blur and brightness; the same settings, so the two
 * pages agree) under the tiles, since they are the rest of "how the
 * background looks".
 *
 * A tile is the choice the moment it is pressed — the shell changes behind
 * the panel, which is the preview — and the choice is written then
 * (`launcher.background`). A picture's Remove sits on its tile under the
 * pointer; removing the picture in use puts the world back. The pictures are
 * copies in the launcher's own folder (src/main/backgrounds.js); nothing
 * here ever sees a path.
 */
export function openBackgroundModal() {
  const grid = el('div', { class: 'backgrounds' });
  let pictures = [];
  let busy = false;

  const chosen = () => {
    const bg = state.settings?.launcher?.background;
    return bg?.kind === 'image' && bg.file ? bg.file : 'world';
  };

  const choose = (file) => {
    /* The file is written null with the world, not left: the settings are
       merged, and a name left behind would name a picture nothing shows. */
    const background = file === 'world' ? { kind: 'world', file: null } : { kind: 'image', file };
    updateSettings({ launcher: { background } }).catch(() => {});
    mark(file);
  };

  const mark = (file) => {
    for (const tile of grid.querySelectorAll('.bg-tile')) {
      tile.classList.toggle('is-picked', tile.dataset.file === file);
      tile.setAttribute('aria-pressed', String(tile.dataset.file === file));
    }
  };

  /** The world's tile: the still, the way the launcher opens. */
  const worldTile = () => el('button', {
    class: 'bg-tile',
    'data-file': 'world',
    title: 'The world — turning, the way the game\'s title screen does',
    onClick: () => choose('world')
  }, [
    el('img', { class: 'bg-tile__picture', src: new URL('assets/art/backdrop.jpg', location.href).href, alt: '', draggable: 'false' }),
    el('span', { class: 'bg-tile__name', text: 'World' })
  ]);

  /** One of the player's pictures, with Remove under the pointer. */
  const pictureTile = (picture) => {
    const img = el('img', { class: 'bg-tile__picture', alt: '', draggable: 'false' });
    pictureUrl(picture.file).then((url) => { if (url && img.isConnected) img.src = url; });
    const remove = el('button', {
      class: 'bg-tile__remove',
      title: 'Remove this picture',
      'aria-label': `Remove ${picture.name}`,
      onClick: (event) => { event.stopPropagation(); take(picture); }
    }, [el('span', { html: icons.close, style: { display: 'contents' } })]);
    return el('div', {
      class: 'bg-tile',
      role: 'button',
      tabindex: '0',
      'data-file': picture.file,
      title: picture.name,
      onClick: () => choose(picture.file),
      onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(picture.file); } }
    }, [img, el('span', { class: 'bg-tile__name truncate', text: picture.name }), remove]);
  };

  /** The dashed tile that opens the file dialog. */
  const addTile = () => el('button', {
    class: 'bg-tile bg-tile--add',
    title: 'Choose a picture on this PC',
    onClick: () => add()
  }, [
    el('span', { class: 'bg-tile__plus', html: icons.plus }),
    el('span', { class: 'bg-tile__name', text: 'Add a picture' })
  ]);

  const paint = () => {
    grid.replaceChildren(worldTile(), ...pictures.map(pictureTile), addTile());
    mark(chosen());
  };

  const load = async () => {
    pictures = (await host.backgrounds?.list?.().catch(() => [])) || [];
    paint();
  };

  const add = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await host.backgrounds?.add?.();
      if (!result || result.cancelled) return;
      if (!result.ok) { toast(result.error || 'The picture could not be added.', 'error'); return; }
      await load();
      choose(result.file);
    } finally {
      busy = false;
    }
  };

  const take = async (picture) => {
    if (busy) return;
    busy = true;
    try {
      const result = await host.backgrounds?.remove?.(picture.file);
      if (!result?.ok) { toast('The picture could not be removed.', 'error'); return; }
      forgetPicture(picture.file);
      if (chosen() === picture.file) choose('world');
      await load();
    } finally {
      busy = false;
    }
  };

  const launcher = state.settings?.launcher || {};

  openModal({
    title: 'Background',
    subtitle: 'The world, or a picture of your own.',
    wide: true,
    className: 'modal--background',
    build: () => {
      paint();
      load();
      return [
        grid,
        sliderRow({
          label: 'Blur',
          min: 0, max: 100, step: 5,
          value: Math.max(0, Math.min(100, Math.round(Number(launcher.worldBlur) || 0))),
          say: (n) => (n ? `${n}%` : 'Off'),
          onInput: (n) => paintWorldBlur(n),
          onChange: (n) => updateSettings({ launcher: { worldBlur: n } })
        }),
        sliderRow({
          label: 'Brightness',
          min: 10, max: 100, step: 5,
          value: Math.max(10, Math.min(100, Math.round(Number.isFinite(Number(launcher.worldBrightness)) ? Number(launcher.worldBrightness) : 100))),
          say: (n) => `${n}%`,
          onInput: (n) => paintWorldBrightness(n),
          onChange: (n) => updateSettings({ launcher: { worldBrightness: n } })
        })
      ];
    },
    actions: (close) => [
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--primary', text: 'Done', onClick: () => close() })
    ]
  });
}

/** Name and value on one line, the slider under them — the Settings rows' shape, on the panel. */
function sliderRow({ label, min, max, step, value, say, onInput, onChange }) {
  const readout = el('span', { class: 'mem-value' });
  const slider = el('input', {
    class: 'slider', type: 'range', min: String(min), max: String(max), step: String(step),
    value: String(value), 'aria-label': label,
    onInput: (event) => { paint(Number(event.target.value)); onInput(Number(event.target.value)); },
    onChange: (event) => onChange(Number(event.target.value))
  });
  function paint(n) {
    readout.textContent = say(n);
    slider.style.setProperty('--fill', `${((n - min) / (max - min)) * 100}%`);
  }
  paint(value);
  return el('div', { class: 'bg-slider' }, [
    el('div', { class: 'row', style: { gap: 'var(--space-3)', width: '100%' } }, [
      el('span', { class: 'bg-slider__name', text: label }),
      el('span', { class: 'spacer' }),
      readout
    ]),
    slider
  ]);
}
