/**
 * The graphics card's first look at every page (2026-09-15).
 *
 * Electron keeps no shader cache for the compositor (JOURNAL.md, *Background
 * blur, and the first second*), so on every launch the GPU process compiles a
 * shader the first time it rasterises each new kind of paint. Home's kinds are
 * compiled while the shell's first frame is being made, before anything is on
 * screen. The other pages are full of kinds Home has none of — a hairline
 * stroked round a card, a block cut into a swatch, a switch, a slider, a
 * section bar — and the first switch off Home compiled about ninety shaders
 * for them, with the frames stopped for 80–100 ms while it did. Adrian: "when
 * opening the launcher after it being closed, the first time I switch pages
 * its always a bit laggy. then after that its smooth."
 *
 * So the card is shown the pages before the player can ask for one. Every
 * page the bar reaches, plus the two surfaces that are not pages — a dropdown
 * and a dialog — is rendered once into a host that is on screen, full size
 * and one percent opaque, in the same frame the shell first appears. The card
 * rasterises them with the shell (whose first frame already waits on its own
 * compiles, with nobody looking yet), and two frames later the host is gone.
 *
 * Why one percent and not hidden: the compositor rasterises only what it will
 * draw. `opacity: 0`, `visibility: hidden`, a clip to nothing, a box off the
 * edge of the window — none of those is drawn, so none is rasterised, so
 * nothing is compiled. At 0.01 the host is drawn, and at 0.01 over a dark
 * launcher nothing in it reaches a level the eye can see, for two frames.
 *
 * Why the real pages and not a sheet of samples: the shaders come from the
 * exact paint each page asks for, and a hand-written list of "every effect we
 * use" would be wrong the week after it was written. A page's `render()` is
 * the list. The pages that are not here are the ones no tab reaches
 * (Accounts, Worlds, Your play), which paint nothing the others do not — and
 * Clips, which is warmed, but later: its render lists a folder before it has
 * anything to paint, so it comes through `warmLater` below once its answer
 * is in (pages/clips.js says why it was left out until 2026-09-17, and what
 * the first switch to it cost while it was).
 *
 * The pages' own module state survives this the way it survives any visit
 * that was left: every page rebuilds itself from scratch on the next
 * `render()`, and the one that cared (Mods' pinned profile) is consumed on
 * the first render, which at boot holds nothing.
 */

import { el } from './ui/dom.js';
import { menuItem, menuSeparator } from './ui/menu.js';
import { icons } from './icons.js';

/**
 * @param {Array<{ id: string, page: { render: () => HTMLElement } }>} pages
 *   the routes to show the card, current one excluded by the caller
 */
export function warmGraphics(pages) {
  const host = el('div', { class: 'warmup', 'aria-hidden': 'true' });

  for (const route of pages) {
    try {
      const node = route.page.render();
      /* With the arrival animation, so the transformed frame a page arrives
         on is a kind the card has met too. */
      node.classList.add('page--enter');
      host.append(node);
    } catch (error) {
      /* A page that cannot be drawn now will be drawn when it is asked for;
         warming is not allowed to stop the boot. */
      console.warn(`warm-up: ${route.id} did not render`, error);
    }
  }

  /* The two samples stand on the page itself, not in the host. A pane's
     backdrop blur is drawn against what is behind it up to the nearest
     ancestor that is itself translucent, and inside the one-percent host
     that ancestor is the host: a dropdown blurring a box of pages is a
     different drawing from a dropdown blurring the world, and the card
     learned nothing from it (measured — the dialog's first opening still
     compiled eight). Out here, one percent themselves, they blur what the
     real ones blur. */
  const samples = [menuSample(), dialogSample()];
  document.body.append(host, ...samples);

  /* Two frames. The first commit carries the host, and the second frame's
     callback cannot run until that commit's tiles are rasterised and the
     frame activated — the compositor holds the next main frame until then —
     so by the time this runs, every shader the host needed has been built. */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    host.remove();
    for (const sample of samples) sample.remove();
  }));
}

/**
 * The same look, later, for a page that is not whole at boot (2026-09-17).
 *
 * `node` goes into a host of its own straight away — one percent, full size,
 * on screen, like the boot's — and `ready` is the page's own word for when
 * it has everything it will paint (a folder's answer, the pictures it asked
 * for). Two frames after that the host is gone, on the same reasoning as
 * above: the second frame's callback cannot run until the first's tiles are
 * rasterised. A page whose `ready` fails is warmed as far as it got.
 */
export async function warmLater(node, ready) {
  const host = el('div', { class: 'warmup', 'aria-hidden': 'true' });
  node.classList.add('page--enter');
  host.append(node);
  document.body.append(host);
  try { await ready; } catch (error) { console.warn('warm-up: a page did not settle', error); }
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  host.remove();
}

/* A dropdown as ui/menu.js builds one: the deep glass, two account rows
   (the account menu and the profile dropdown under Play share them) and a
   plain item — not opened through openMenu, which would focus it, listen for
   Escape and pin it to an anchor. */
function menuSample() {
  const row = (name, active) => el('button', { class: `menu__account${active ? ' is-active' : ''}`, tabindex: '-1' }, [
    el('span', { class: 'menu__account-face' }),
    el('span', { class: 'stack truncate' }, [
      el('span', { class: 'menu__account-name truncate', text: name }),
      el('span', { class: 'menu__account-meta', text: 'Offline' })
    ]),
    active && el('span', { class: 'menu__account-dot' })
  ]);
  return el('div', { class: 'menu warmup-sample', role: 'presentation' }, [
    row('Steve', true),
    row('Alex', false),
    menuSeparator(),
    menuItem({ label: 'Add account', icon: icons.plus }),
    menuItem({ label: 'Sign out', icon: icons.close, danger: true })
  ]);
}

/* A dialog as ui/modal.js builds one — scrim, pane, head, body, foot — with
   a field and the three kinds of button, not opened through openModal, which
   would trap focus and take Escape. */
function dialogSample() {
  return el('div', { class: 'scrim warmup-sample', role: 'presentation' }, [
    el('div', { class: 'modal' }, [
      el('div', { class: 'modal__head' }, [
        el('div', {}, [
          el('h2', { class: 'modal__title', text: 'Warm-up' }),
          el('p', { class: 'modal__sub', text: 'Shown to the graphics card, not to you' })
        ]),
        el('button', { class: 'modal__close', tabindex: '-1', html: icons.close })
      ]),
      el('div', { class: 'modal__body' }, [
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Name' }),
          el('input', { class: 'input', value: 'Warm-up', tabindex: '-1' })
        ]),
        el('p', { class: 'muted', text: 'A line of quieter text.' })
      ]),
      el('div', { class: 'modal__foot' }, [
        el('button', { class: 'btn btn--ghost', tabindex: '-1', text: 'Cancel' }),
        el('button', { class: 'btn', tabindex: '-1', text: 'Back' }),
        el('button', { class: 'btn btn--danger', tabindex: '-1', text: 'Delete' }),
        el('button', { class: 'btn btn--primary', tabindex: '-1', text: 'Save' })
      ])
    ])
  ]);
}
