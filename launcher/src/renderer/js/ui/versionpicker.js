/**
 * The version picker (2026-09-14): a wall of Minecraft's own posters, one
 * per family, each with its version under it — and one card for anything
 * else.
 *
 * Adrian, with Lunar's version grid in hand: "when you click to select a
 * version inside the profiles section … a card pops up like this with the
 * different official minecraft versions and their official artwork for each
 * one, and then some way to pick the exact version." Until this date the
 * field was a dropdown of a hundred numbers, 26.2 at the top and 1.0 at the
 * bottom, and 1.21.11 looked exactly like 1.21.10.
 *
 * Three passes the same morning settled it:
 * - The first cut had a strip of chips under the wall for the exact version,
 *   and pills on the posters. "No need to show the vanilla or blueclient, we
 *   will fix it eventually for all versions anyways. Remove the version
 *   selection down below, only have a Done button on the bottom right.
 *   Instead make it so you can click on the version under each poster to
 *   change it within the specific version it is."
 * - Then: "remove everything older than 1.13, then remove 1.15 too, and add
 *   a Custom version card. Merge 26.2 and 26.1 into 26. There should now be
 *   10 total cards. Remove the background of the Done button that spans
 *   across the entire popup — just keep the Done button on top of the
 *   cards, then more is visible."
 *
 * So: nine posters (art.js — 26 down to 1.13, Lunar's 3:4, five to a row)
 * and the CUSTOM card, ten in all. Under each poster is its version as a
 * small dropdown — the family's newest, or the profile's own where it is one
 * of them; press the poster and that is the choice, press the version and
 * the family's versions open as the glass menu (ui/menu.js), and the row
 * picked is the card's version and the choice at once. On the year card the
 * poster and the name follow the drop picked (26.2 Chaos Cubed, 26.1 Tiny
 * Takeover). The Custom card is a field: any id Mojang's list knows — an old
 * release, a snapshot — typed in, and the card is the choice as you type; a
 * profile already on such a version opens with it filled in. DONE floats
 * over the wall's corner, on nothing, and is the only button; it applies the
 * choice and closes — or, on a Custom id the list does not know, says so and
 * stays. Escape and the backdrop change nothing.
 *
 * No marks. A version the loader cannot run (Fabric under 1.14) is still a
 * choice: the caller flips the loader to Vanilla with it and says so — the
 * picker itself says nothing about loaders.
 *
 * One line, only when it applies (2026-09-16): a version no companion jar
 * covers — 26.2 until its port lands, 1.20.1, a snapshot typed on the Custom
 * card — starts as plain Minecraft, and until this date the wall let a player
 * choose it in silence and Play was the first thing to say so. The line
 * floats in the wall's bottom-left corner, opposite Done, in the same glass,
 * and says which version and what that means; it is gone the moment a covered
 * version is the choice. Still no pill on any poster — Adrian took those off
 * on 2026-09-14 — and nothing at all while the jars have not yet answered,
 * so nothing is claimed early.
 */

import { el } from './dom.js';
import { icons } from '../icons.js';
import { openModal } from './modal.js';
import { openMenu } from './menu.js';
import { toast } from './toast.js';
import { FAMILIES, familyOf, familyArt, familyName } from '../art.js';

/**
 * @param {{
 *   versions: string[],            releases, newest first, as the manifest lists them
 *   known: Set<string>,            every id the manifest has — releases and snapshots
 *   current: string,               the profile's version
 *   covered?: Set<string>,         the versions the companion mod has a jar for; empty = not known yet
 *   onPick: (version: string) => void
 * }} spec
 */
export function openVersionPicker({ versions, known, current, covered = new Set(), onPick }) {
  /* The families present in the list, in the poster order. */
  const grouped = new Map();
  for (const version of versions) {
    const id = familyOf(version);
    if (!id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(version);
  }
  const cards = FAMILIES.filter((family) => grouped.has(family.id)).map((family) => ({
    id: family.id,
    versions: grouped.get(family.id)
  }));
  cards.push({ id: 'custom', custom: true, versions: [] });

  /* Each card's own version — the profile's where it is one of them, else
     the family's newest; the Custom card's is whatever is typed. */
  const chosen = new Map(cards.map((card) => [card.id, card.versions.includes(current) ? current : card.versions[0] || '']));
  let familyId = cards.find((card) => card.versions.includes(current))?.id;
  if (!familyId) {
    familyId = 'custom';
    chosen.set('custom', current || '');
  }

  const wall = el('div', { class: 'vpick__wall' });
  const nodes = new Map();   // card id -> { label, art, name, input }

  const cardFor = (card) => {
    const bits = {};
    nodes.set(card.id, bits);
    let caption;
    if (card.custom) {
      bits.input = el('input', {
        class: 'input vpick-card__input',
        type: 'text',
        value: chosen.get('custom'),
        placeholder: 'Type a version',
        spellcheck: 'false',
        autocomplete: 'off',
        'aria-label': 'Custom version',
        onInput: (event) => {
          chosen.set('custom', event.target.value.trim());
          choose('custom');
        },
        onFocus: () => choose('custom'),
        onKeyDown: (event) => { if (event.key === 'Enter') doneButton.click(); }
      });
      caption = bits.input;
    } else {
      bits.label = el('span', { class: 'vpick-card__version' });
      caption = el('button', {
        class: 'vpick-card__pick',
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        title: `Choose the exact ${card.id} version`,
        onClick: (event) => {
          event.stopPropagation();
          openVersions(card, event.currentTarget);
        }
      }, [bits.label, el('span', { class: 'vpick-card__caret', html: icons.chevronDown })]);
    }
    bits.art = el('button', {
      class: 'vpick-card__art',
      type: 'button',
      'aria-pressed': 'false',
      'aria-label': card.custom ? 'Custom version' : card.id,
      onClick: () => {
        choose(card.id);
        if (card.custom) bits.input.focus();
      }
    }, card.custom ? [
      el('span', { class: 'vpick-card__custom' }, [
        el('span', { class: 'vpick-card__custom-glyph', html: icons.edit }),
        el('span', { class: 'vpick-card__custom-text', text: 'Any version — snapshots too' })
      ])
    ] : [
      (bits.img = el('img', { src: familyArt(chosen.get(card.id)), alt: '', draggable: 'false', loading: 'lazy' }))
    ]);
    bits.name = el('span', { class: 'vpick-card__name truncate' });
    return el('div', {
      class: `vpick-card${card.custom ? ' vpick-card--custom' : ''}`,
      dataset: { family: card.id }
    }, [
      bits.art,
      el('span', { class: 'vpick-card__caption' }, [caption, bits.name])
    ]);
  };
  wall.append(...cards.map(cardFor));

  function choose(id) {
    familyId = id;
    paint();
  }

  /** The family's versions as a menu off its caption; a row is a choice. */
  function openVersions(card, anchor) {
    openMenu(anchor, (close) => card.versions.map((version) => {
      const on = version === chosen.get(card.id);
      return el('button', {
        class: `menu__item${on ? ' is-active' : ''}`,
        role: 'menuitemradio',
        'aria-checked': String(on),
        onClick: () => {
          close();
          chosen.set(card.id, version);
          choose(card.id);
        }
      }, [
        el('span', { class: 'truncate', text: version }),
        on ? el('span', { class: 'menu__check', html: icons.check }) : null
      ]);
    }), { align: 'start', width: Math.max(anchor.offsetWidth, 132), scroll: true, current: '.menu__item.is-active' });
  }

  /** The one honest line about the choice, or nothing. */
  function paintNote() {
    const picked = chosen.get(familyId);
    const plain = covered.size > 0 && picked && !covered.has(picked);
    note.hidden = !plain;
    if (plain) note.textContent = `${picked} starts as plain Minecraft — no BlueClient menu or HUD on it yet`;
  }

  function paint() {
    paintNote();
    for (const card of cards) {
      const bits = nodes.get(card.id);
      const on = card.id === familyId;
      bits.art.parentElement.classList.toggle('is-on', on);
      bits.art.setAttribute('aria-pressed', String(on));
      if (card.custom) {
        bits.name.textContent = 'Custom version';
        continue;
      }
      const version = chosen.get(card.id);
      bits.label.textContent = version;
      bits.name.textContent = familyName(version);
      /* The year card's poster follows its drop. */
      const art = familyArt(version);
      if (bits.img.getAttribute('src') !== art) bits.img.src = art;
    }
  }

  /** The choice — or, on a Custom id the list does not know, nothing and a word. */
  const finish = (done) => {
    const picked = chosen.get(familyId);
    if (familyId === 'custom' && !known.has(picked)) {
      toast(picked ? `No Minecraft version called ${picked}` : 'Type a version, or press a poster', 'error');
      nodes.get('custom').input.focus();
      return;
    }
    done();
    if (picked && picked !== current) onPick(picked);
  };

  /* It does the useful thing and closes; there is nothing else. It floats
     over the wall's corner rather than sitting in a footer of its own, so a
     row more of posters is in view — and because it floats over pictures it
     is the glass capsule, not the tint (2026-09-14). */
  const doneButton = el('button', { class: 'btn btn--confirm btn--glass vpick__done', type: 'button' }, [
    el('span', { html: icons.check, style: { display: 'contents' } }),
    el('span', { text: 'Done' })
  ]);
  const note = el('span', { class: 'vpick__note', role: 'status', hidden: true });

  paint();
  const close = openModal({
    /* The title alone — Adrian: "remove the 'pick the update, then the exact
       version' text, only keep Game version". The wall explains itself. */
    title: 'Game version',
    className: 'modal--wall',
    build: (done) => {
      doneButton.addEventListener('click', () => finish(done));
      return [wall, note, doneButton];
    },
    initialFocus: () => (familyId === 'custom' ? nodes.get('custom').input : wall.querySelector('.vpick-card.is-on .vpick-card__art'))
  });
  requestAnimationFrame(() => wall.querySelector('.vpick-card.is-on')?.scrollIntoView({ block: 'nearest' }));
  return close;
}
