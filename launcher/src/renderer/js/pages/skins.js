import { el } from '../ui/dom.js';
import { icons } from '../icons.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { host } from '../bridge.js';
import { createCharacter } from '../ui/character.js';
import { flatSize, rememberSkin, frontView } from '../skin.js';
import { activeAccount } from '../state.js';
import { selectMenu } from '../ui/select.js';

/**
 * Three skins, and the one you are wearing.
 *
 * Changing a skin has always meant leaving the game for minecraft.net, and
 * changing back means doing it again. Every client the audience has come from
 * keeps a few and switches between them in a click, which is the whole
 * feature: three slots, a picture of each on the player's own model, and one
 * button that says Wear.
 *
 * Wearing is a real upload to the player's own Minecraft account through
 * Mojang's own endpoint, so it is their skin everywhere — on servers, in the
 * vanilla launcher, on their friends' screens — and not a picture this
 * launcher paints over the model on the home screen.
 *
 * The one thing a skin file cannot tell us is which model it was drawn for:
 * the two differ by a column of pixels in the arms and nothing distinguishes
 * a slim sheet from a classic one that happens not to use those pixels. So
 * every slot carries a button that says which, set to Classic and corrected
 * in one click when the arms come out too wide.
 *
 * A slot is filled from a PNG on this PC, or from **Browse skins** below.
 */
export function openSkinsModal({ onWorn } = {}) {
  const grid = el('div', { class: 'skins' });
  let busy = false;

  /* One tile per slot, kept across answers (2026-09-10, evening). Every
     answer from main used to rebuild all three tiles — a new model, the
     sheet decoded again, a frame with nothing on the stage — so pressing
     Wear or flipping the arms blinked every tile at once, the one being
     worn included. A tile is rebuilt only when the picture in its slot
     changes; which arms it has and whether it is worn are written onto the
     tile that is already there. */
  const tiles = [null, null, null];          // { key, node, update? }

  const paint = (slots) => {
    for (const index of [0, 1, 2]) {
      const slot = slots?.[index] || null;
      const key = slot ? slot.dataUri : '';
      const held = tiles[index];
      if (held && held.key === key) {
        held.update?.(slot);
        continue;
      }
      tiles[index] = slot ? { key, ...filled(slot, index) } : { key, node: empty(index) };
    }
    const nodes = tiles.map((tile) => tile.node);
    if (grid.children.length !== nodes.length || nodes.some((node, at) => grid.children[at] !== node)) {
      grid.replaceChildren(...nodes);
    }
  };

  /* Three tiles the shape of a slot, in before the first frame. `slots()` is
     a round trip to main, so a grid that starts empty opens the panel at a
     third of its height and grows it as the answer lands — under the entry
     animation, over a live world, which is what a re-blur mid-jump looks
     like. Browse skins was given the same treatment on 2026-09-10; this is
     the panel in front of it. */
  const holding = () => [0, 1, 2].map(() => el('div', { class: 'skin-slot skin-slot--holding' }));

  /** Anything that talks to main: one at a time, and the grid says so. */
  const run = async (work) => {
    if (busy) return;
    busy = true;
    /* The dim is for work you can feel. `busy` already turns away a second
       click on the same frame, so the grid only has to *say* it is waiting
       when there is a wait: flipping which arms a skin has is a millisecond,
       and dimming three tiles to 60% for one frame of that is a blink, not a
       state. A file dialog or an upload to Mojang crosses the threshold and
       the grid dims properly. */
    const slow = setTimeout(() => grid.classList.add('is-busy'), 150);
    try {
      const result = await work();
      if (result?.slots) paint(result.slots);
      if (result && result.ok === false && result.reason) toast(result.reason, 'error');
      return result;
    } finally {
      clearTimeout(slow);
      busy = false;
      grid.classList.remove('is-busy');
    }
  };

  function empty(index) {
    return el('button', {
      class: 'skin-slot skin-slot--empty',
      onClick: () => run(() => host.skins.pick(index, 'classic'))
    }, [
      el('span', { class: 'skin-slot__plus', html: icons.plus }),
      el('span', { class: 'skin-slot__name', text: 'Add a skin' }),
      el('span', { class: 'skin-slot__note', text: '64 × 64 PNG' })
    ]);
  }

  /** A filled tile: its node, and `update(slot)` for every later answer about the same picture. */
  function filled(first, index) {
    let slot = null;                         // what main last said about this slot

    // No clearance: the tile's own padding holds the head off the top, and
    // the words under the stage are 12px below it — see character.js.
    const stage = createCharacter({ overflow: 1, clearance: 0 });

    const arms = el('button', {
      class: 'skin-slot__arms',
      title: 'Which model this skin was drawn for',
      onClick: async () => {
        const result = await run(() =>
          host.skins.variant(index, slot.variant === 'slim' ? 'classic' : 'slim'));
        /* Flipped on the skin being worn, main has just re-sent it to Mojang
           with the other arms (skinslots.setVariant), so the model on the
           home screen gets the new arms now, the way Wear gives it a new
           skin (2026-09-10, night). */
        const now = result?.ok && result.slots?.[index];
        if (now?.worn) {
          const skin = { dataUri: now.dataUri, slim: now.variant === 'slim', height: now.height || 64 };
          rememberSkin(activeAccount()?.username || '', skin);
          onWorn?.(skin);
        }
      }
    });

    const wearButton = el('button', {
      class: 'btn btn--sm skin-slot__wear',
      onClick: () => wear(index, slot)
    });

    const node = el('div', { class: 'skin-slot' }, [
      el('div', { class: 'skin-slot__stage' }, [stage]),
      arms,
      el('div', { class: 'skin-slot__foot' }, [
        wearButton,
        el('button', {
          class: 'btn btn--sm btn--icon btn--ghost',
          'aria-label': 'Remove this skin',
          html: icons.trash,
          onClick: () => run(() => host.skins.clear(index))
        })
      ])
    ]);

    const update = (next) => {
      const was = slot;
      slot = next;
      // The model is rebuilt only for a change it can see: the arms.
      if (!was || was.variant !== next.variant || was.height !== next.height) {
        stage.setSkin({ dataUri: next.dataUri, slim: next.variant === 'slim', height: next.height || 64 });
      }
      arms.textContent = next.variant === 'slim' ? 'Slim arms' : 'Classic arms';
      node.classList.toggle('is-worn', Boolean(next.worn));
      wearButton.textContent = next.worn ? 'Worn' : 'Wear';
      wearButton.disabled = Boolean(next.worn);
      wearButton.classList.toggle('btn--primary', !next.worn);
    };
    update(first);

    return { node, update };
  }

  async function wear(index, slot) {
    const result = await run(() => host.skins.wear(index));
    if (!result?.ok) return;

    // Mojang holds a name's profile for about a minute, so waiting for it to
    // report the change would leave the model showing the old skin for that
    // long. The file is already the player's skin; it goes on the model now
    // — and into the cache, so the next Home draws it and not Steve.
    const skin = {
      dataUri: slot.dataUri,
      slim: slot.variant === 'slim',
      height: slot.height || 64
    };
    rememberSkin(activeAccount()?.username || '', skin);
    onWorn?.(skin);
    toast('Skin changed', 'success');
  }

  openModal({
    title: 'Skins',
    subtitle: 'Keep three, and switch whenever you like.',
    wide: true,
    build: () => {
      grid.replaceChildren(...holding());
      host.skins.slots().then(paint).catch(() => paint([null, null, null]));
      return [grid];
    },
    actions: (close) => [
      el('button', {
        class: 'btn btn--secondary',
        text: 'Browse skins',
        /* Not `close()` first: the two panels swap on one scrim, and closing
           this one took the scrim with it — the dim lifted and came back and
           both panes re-blurred from nothing between them (2026-09-10). */
        onClick: () => openBrowseSkins({ onWorn })
      }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--primary', text: 'Done', onClick: () => close() })
    ]
  });
}

/* --------------------------------------------------------- browse skins */

/**
 * Browse skins (2026-09-09) — Adrian: "a browse skins button to the skins
 * card, where people can search for skins, like namemc."
 *
 * Two things in one panel, and no mode switch between them. Before you type,
 * the grid is the skins players are putting on most this week. Type a name
 * and it becomes that player: the skin they are wearing first, then the ones
 * they wore before it. Click any of them and it is yours — it drops into a
 * free slot and you go back to press Wear.
 *
 * Where they come from, and what happens when one of the two is down, is in
 * `src/main/skinfind.js`. Nothing here reaches the network: a card arrives as
 * a PNG data URI with the model it was drawn for, and keeping one sends back
 * the texture hash rather than the picture.
 *
 * Every card is drawn flat by `frontView` rather than on the real model —
 * two dozen turnable models is two dozen times seventy-two 3D boxes, and the
 * one place you want to turn a skin is the slot you kept it in.
 */
/** CSS px per skin pixel in the grid — about 80 wide in a column of 96. */
const SHEET_SIZE = 5;

function openBrowseSkins({ onWorn } = {}) {
  const status = el('p', { class: 'catalog__status' });
  const grid = el('div', { class: 'skin-find' });
  const replace = el('div', { class: 'skin-find__replace' });
  replace.hidden = true;

  /* The slots as main last reported them, so "is there room" is answered
     without a round trip on every click. */
  let slots = [null, null, null];
  let seq = 0;
  let timer = null;

  /* Two ways to search, chosen in the dropdown beside the field (2026-09-10,
     Adrian: "a selection bar with dropdown so you select if you want to
     search for skin by player name, or … by category like if I search
     'lava'"). Player is a Minecraft name; Category is words about the skin
     itself — lava, burger, girl, hoodie — answered by BlueClient's own index
     (src/main/skinfind.js says how). The field keeps what was typed when the
     mode changes and searches it again the new way. */
  /* Category first (2026-09-10, night). It opened on Player name, and with
     Crafty refusing this PC the grid under it was empty, so typing "lava"
     looked up a player called Lava and Adrian read the whole panel as "it
     only shows players I have searched before … it needs to show the top
     skins that match the search term, like NameMC". Searching skins is what
     the panel is for; a player's name is the second way in. */
  const MODES = {
    look: { label: 'Category', placeholder: 'Search skins — lava, burger, girl, hoodie' },
    player: { label: 'Player name', placeholder: 'A player’s name — Notch, Dream, a friend' }
  };
  let mode = 'look';

  const input = el('input', {
    class: 'input',
    type: 'search',
    placeholder: MODES[mode].placeholder,
    onInput: (event) => {
      const value = event.target.value;
      clearTimeout(timer);
      // Debounced: typing a name should not fire six lookups.
      timer = setTimeout(() => run(value), 420);
    }
  });

  const picker = selectMenu({
    value: mode,
    options: Object.entries(MODES).map(([value, m]) => ({ value, label: m.label })),
    label: 'Search by',
    width: 138,
    onChange: (value) => {
      mode = value;
      input.placeholder = MODES[mode].placeholder;
      clearTimeout(timer);
      run(input.value);
      input.focus();
    }
  });

  async function run(query) {
    const mine = ++seq;
    const text = String(query || '').trim();
    const asked = mode;

    /* A name is three characters at least. Under that the player is still
       typing: the grid stays as it is instead of blinking to placeholders
       on every keystroke, and nobody is asked about "D" — a burst of those
       from one address is what got this PC blocked by Crafty (2026-09-10). */
    if (asked === 'player' && text && text.length < 3) {
      status.textContent = 'Keep typing — a name is at least 3 characters';
      return;
    }

    status.textContent = !text
      ? 'Loading popular skins…'
      : (asked === 'look' ? `Looking for ${text}…` : `Looking up ${text}…`);
    // As many tiles as the grid is holding, so a second search does not move
    // it; twelve when it is holding something else — a note spans the grid,
    // and one placeholder in its place would collapse the panel.
    const showing = grid.querySelectorAll('.skin-find__card').length;
    grid.replaceChildren(...skeletons(Math.min(24, showing || 12)));

    /* A call that failed outright is the index not answering (2026-09-22):
       it threw past this, and the placeholders stood in the grid for good. */
    const answer = await host.skins.find(text, asked).catch(() => null);
    if (mine !== seq) return;                  // a newer keystroke already won
    paint(text, answer);
  }

  function paint(text, answer) {
    hideReplace();

    if (!answer?.ok) {
      status.textContent = '';
      grid.replaceChildren(note(answer?.kind === 'popular' ? 'No popular skins right now' : 'No skins to show',
        answer?.reason || 'Could not reach the skin index. Your three skins still work.'));
      return;
    }

    const results = answer.results || [];
    if (!results.length) {
      status.textContent = '';
      if (answer.kind === 'look') {
        /* With the tag lists in (2026-09-11) every word the index knows has
           thousands of skins, so an empty answer means the word is one it
           does not know — the fix is another word, not another day. */
        grid.replaceChildren(note(`Nothing that looks like “${text}”`,
          'Try another word — pig, hoodie, iron man — or one word instead of two.'));
      } else if (answer.invalid || answer.short) {
        grid.replaceChildren(note('Not a name',
          'A Minecraft name is 3 to 16 letters, numbers or underscores.'));
      } else {
        grid.replaceChildren(note(`No player called “${text}”`, 'A name has to match exactly — check the spelling.'));
      }
      return;
    }

    const n = results.length;
    status.textContent = answer.kind === 'player'
      ? `${answer.player} · ${n === 1 ? 'the skin they are wearing' : `${n} skins, newest first`}`
      : (answer.kind === 'look'
        ? `${n === 1 ? 'One skin that looks' : `${n} skins that look`} like “${text}” — click one to keep it`
        : (answer.source === 'index'
          ? 'Popular skins — click one to keep it'
          : 'Popular this week — click one to keep it'));

    grid.replaceChildren(...results.map(card));
  }

  /**
   * Tiles the shape of a card, so nothing moves when the cards come.
   *
   * As many as are already on screen, not always twelve: a search made from a
   * full grid of two dozen used to drop to twelve placeholders and take a
   * third of the panel's height with it, then grow again as the results
   * landed — the panel breathing in and out under its own blur for every
   * word typed.
   */
  function skeletons(count = 12) {
    // The box a drawn sheet will take, to the pixel — see flatSize.
    const { width, height } = flatSize(SHEET_SIZE);
    return Array.from({ length: count }, () => el('div', { class: 'skin-find__card is-skeleton' }, [
      el('span', { class: 'skin-find__ghost', style: { width: `${width}px`, height: `${height}px` } }),
      el('span', { class: 'skin-find__ghost-label' })
    ]));
  }

  function note(title, text) {
    return el('div', { class: 'empty skin-find__note' }, [
      el('div', { class: 'empty__icon', html: icons.shirt }),
      el('p', { class: 'empty__title', text: title }),
      el('p', { class: 'empty__text', text })
    ]);
  }

  function card(skin) {
    /* What is worth saying under a skin: that it is the one this player
       wears now, when they changed into it — or, for a popular skin, how
       many wear it, which is the number that made it popular. The line is
       always there, written on or not, so every card in a grid is one
       height (and the height the placeholders had). */
    const label = skin.current
      ? 'Wearing now'
      : (skin.changed ? worn(skin.changed) : (skin.players > 1 ? `${wearing(skin.players)} wearing` : ''));

    const tile = el('button', {
      class: 'skin-find__card',
      title: 'Keep this skin',
      onClick: () => take(skin, tile)
    }, [
      el('span', { class: 'skin-find__badge', html: icons.check }),
      frontView(skin, { size: SHEET_SIZE }),
      el('span', { class: 'skin-find__label truncate', text: label })
    ]);
    return tile;
  }

  /** "Jan 2025" — the month a player changed into that skin. */
  function worn(iso) {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return '';
    return when.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }

  /** "1.5M", "12k", "340" — a player count, short. */
  function wearing(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
    return String(n);
  }

  /**
   * Keep one. Three slots is the whole design, so when they are full the
   * panel asks which to replace rather than choosing for the player or
   * refusing them the skin they just found.
   */
  async function take(skin, tile) {
    const free = slots.findIndex((slot) => !slot);
    if (free >= 0) return keep(free, skin, tile);
    showReplace(skin, tile);
  }

  /* One keep at a time (2026-09-22): the free slot is read from `slots`,
     which only learns of a keep when main answers, so a quick second click
     on a card kept the same skin into two slots. */
  let keeping = false;

  async function keep(index, skin, tile) {
    if (keeping) return;
    hideReplace();
    keeping = true;
    const result = await host.skins.keep(index, { hash: skin.hash, slim: skin.slim, name: skin.name }).catch(() => null);
    keeping = false;
    if (!result?.ok) {
      toast(result?.reason || 'That skin could not be kept.', 'error');
      return;
    }

    slots = result.slots || slots;
    tile?.classList.add('is-kept');
    toast('Skin kept', 'success');
  }

  function showReplace(skin, tile) {
    replace.replaceChildren(
      el('p', { class: 'skin-find__replace-say', text: 'You keep three. Which one does this replace?' }),
      el('div', { class: 'skin-find__replace-row' }, [
        ...slots.map((slot, index) => el('button', {
          class: 'skin-find__slot',
          'aria-label': `Replace skin ${index + 1}`,
          title: slot?.worn ? 'The one you are wearing' : 'Replace this one',
          onClick: () => keep(index, skin, tile)
        }, [
          frontView({ dataUri: slot?.dataUri, slim: slot?.variant === 'slim' }, { size: 3 }),
          slot?.worn && el('span', { class: 'skin-find__slot-worn', text: 'Worn' })
        ])),
        el('button', { class: 'btn btn--sm btn--ghost', text: 'Cancel', onClick: hideReplace })
      ])
    );
    replace.hidden = false;
    /* The row goes in above the grid, and the card that asked for it can be
       four rows down: from there the panel answers a click by putting a
       question somewhere the player cannot see.

       Two frames late, and not smooth. The browser's scroll anchoring has
       its own opinion about a row appearing above the reading position — it
       holds the cards still by scrolling down exactly as far as the row is
       tall, which undoes a scroll asked for in the same breath and overrules
       a smooth one for as long as it lasts. By the second frame it has had
       its say, and a cut gets there before it can have another. */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      replace.scrollIntoView({ block: 'nearest' });
    }));
  }

  function hideReplace() {
    replace.hidden = true;
    replace.replaceChildren();
  }

  openModal({
    title: 'Browse skins',
    subtitle: 'Search skins by what they look like, or take any player’s.',
    wide: true,
    build: () => {
      host.skins.slots().then((kept) => { slots = kept || slots; }).catch(() => {});
      // The skeletons go in before the first frame, so the panel comes in at
      // the size it will keep: it used to arrive holding only the search
      // field and grow two rows of cards 220 ms later, exactly as its entry
      // animation ended, and the glass re-blurring over that jump read as a
      // glitch (Adrian, 2026-09-10). Twelve empty tiles cost nothing to lay
      // out; the fetch still waits for the entry to land.
      grid.replaceChildren(...skeletons());
      status.textContent = 'Loading popular skins…';
      setTimeout(() => run(''), 220);
      return [
        el('div', { class: 'catalog__search catalog__search--modes' }, [
          el('span', { html: icons.search }),
          input,
          picker
        ]),
        status,
        replace,
        grid
      ];
    },
    initialFocus: () => input,
    onClose: () => { clearTimeout(timer); seq++; },
    actions: (close) => [
      el('button', {
        class: 'btn',
        text: 'Back to my skins',
        onClick: () => openSkinsModal({ onWorn })
      }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--primary', text: 'Done', onClick: () => close() })
    ]
  });
}
