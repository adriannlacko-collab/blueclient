/**
 * Cosmetics — the page behind the Cosmetics card on Home: the level, the
 * road to the cape, and what else there will be to wear.
 *
 * <h2>Why it exists (2026-09-10)</h2>
 * The Cosmetics card on Home opens here. It has no tab on the bar: it is
 * reached by pressing that card, the way Accounts is reached from the
 * account menu. (The route is still 'stats' and the classes still say
 * stats-: the page was Your play from 2026-09-10 until Adrian renamed it on
 * 2026-09-17, evening — "Rename 'your play' to 'Cosmetics'" — once its one
 * subject had become the cape.)
 *
 * <h2>Two cards, pointed at the cape (2026-09-17)</h2>
 * Adrian, after three sheets of mockups in one afternoon (journal, *Your
 * play, three rounds*): "we must remove the day by day playtime, and instead
 * make the focus on leveling up towards the cape. so we'll only keep 2 cards
 * in 'your play', the big LEVEL card, and the capes card. remove the next up
 * and the day by day." So the page is two cards on the top row, side by
 * side, and the world under them:
 *
 * - THE LEVEL CARD — the player from behind, wearing his cape (the one view
 *   Home never gives, and the cape is what this page is about), his name and
 *   when he started, the cape he wears and his streak as pills, the level
 *   big with the bar to the next one, and three figures: Played (all time —
 *   the investment), Players killed and Mobs killed (the flex, one for each
 *   half of the audience). It is what Copy as image photographs, and it
 *   wears the brand line only for the picture.
 * - THE CAPES CARD — while a cape is still to be earned it is titled NEXT
 *   CAPE and is the goal: that cape big and dimmed, "1,971h of play to go",
 *   a bar from your level to its level, and every other cape as one row
 *   (Wear / Wearing for an earned one). Once every cape is earned it is
 *   CAPES again: Yours big and lit with its colours in the tile — the eight
 *   starting points, Top / Bottom / Sparkles, "the B, pressed in" — and
 *   Signature as a row.
 *
 * <h2>And a third, wide, for what is still to come (2026-09-17, evening)</h2>
 * Under the two, across both columns: MORE TO WEAR — the kinds of cosmetics
 * that are not in BlueClient yet, as a shelf of bare tiles with a hairline
 * between them (an icon in a disc, the name, "Soon"), the way the three
 * figures on the Level card are bare. Adrian's pick from six takes (journal,
 * *Cosmetics, the third card*): it names everything that is coming at one
 * glance, draws no box inside the box, and grows into the real card as the
 * kinds arrive — a kind that lands takes its tile. The kinds are the list
 * COMING below, and the card says "earned by playing, like the capes" because
 * that is the capes' rule: nothing on this page is for sale.
 *
 * Gone before that: the week chart (the Screen Time card of 2026-09-12, every
 * day a button, the share line and chips under it) and Next up (the three
 * nearest milestones). The ledger still records the days and the milestones
 * — `summary()` hands them over untouched — the page simply does not draw
 * them, and a toast about a milestone is not said any more either (play.js,
 * `announce`). Nothing here ranks anyone against anyone else, because the
 * record never leaves the machine; the level is hours on the ladder in
 * src/main/ledger.js and never anything else.
 *
 * The earlier shapes of this page — the ledger of 2026-09-10, the record
 * you build of 2026-09-12, the four panels of 2026-09-13 — are the journal's.
 */

import { el } from '../ui/dom.js';
import { icons } from '../icons.js';
import { host } from '../bridge.js';
import { setRoute, activeAccount, state, updateSettings } from '../state.js';
import { toast } from '../ui/toast.js';
import { getSkin } from '../skin.js';
import { createCharacter } from '../ui/character.js';
import { spell, levelLine, news, CAPES, CAPE_STARTS, capeWorn, capeEarned, capeFace, capeStrip, capeColours, capeById } from '../play.js';

let refs = {};

/**
 * The model stands from behind, a little turned, so the cape reads as cloth
 * on a shoulder and not a flat picture. The Home model rests at -24 (facing
 * you); this one returns here on a double-click.
 */
const CAPE_VIEW_YAW = 152;

/**
 * What the shelf promises, in the order it shows them. Placeholders for
 * now — the six kinds every other client has — until Adrian says which of
 * them BlueClient makes; a kind that is built comes off this list and gets
 * its own card.
 */
const COMING = [
  { icon: 'hat', name: 'Hats' },
  { icon: 'wings', name: 'Wings' },
  { icon: 'bandana', name: 'Bandanas' },
  { icon: 'emote', name: 'Emotes' },
  { icon: 'trail', name: 'Trails' },
  { icon: 'backpack', name: 'Backpacks' }
];

export function render() {
  refs = {};

  /* The page arrives at the height it keeps — see the direction in CLAUDE.md.
     A panel that grows once the disk answers is half of what reads as a
     glitch, so the empty line holds the space until the record lands. */
  refs.body = el('div', { class: 'stats' }, [
    el('p', { class: 'stats__empty', text: 'Reading your record…' })
  ]);

  /* Green: it does something useful and safe (the colour tiers are in
     CLAUDE.md). Hidden until there is a card to copy. */
  refs.copy = el('button', {
    class: 'btn btn--confirm stats__copy',
    hidden: true,
    title: 'Copy your player card as a picture, to paste into Discord',
    onClick: copyImage
  }, [
    el('span', { html: icons.copy, style: { display: 'contents' } }),
    el('span', { text: 'Copy as image' })
  ]);

  load();

  return el('div', { class: 'page page--stats' }, [
    el('div', { class: 'page__inner' }, [
      el('header', { class: 'page-actions' }, [
        el('h1', { class: 'stats__title', text: 'Cosmetics' }),
        el('span', { class: 'spacer' }),
        refs.copy,
        /* Grey: this only goes somewhere. */
        el('button', { class: 'btn', onClick: () => setRoute('home') }, [
          el('span', { html: icons.chevronLeft, style: { display: 'contents' } }),
          el('span', { text: 'Back to Play' })
        ])
      ]),
      refs.body
    ])
  ]);
}

/**
 * The ledger, read once when the page is shown. The summary carries
 * everything the page draws; a record with no place in it yet is the empty
 * line, not a card of zeros.
 */
async function load() {
  const body = refs.body;
  if (!body) return;

  let summary = null;
  try {
    summary = (await host.ledger?.summary?.()) || null;
  } catch {
    summary = null;
  }
  if (refs.body !== body || !body.isConnected) return;   // left the page while we read

  /* A player who has not played yet gets the road, not a blank (2026-09-22):
     main answers a whole summary at Level 1 with nothing in it, and the two
     cards drawn from it are the ladder from the first minute — "No cape
     yet", the Signature cape as the goal an hour away, the shelf under
     them. Until this day the page was one grey line for exactly the player
     the Home card had just promised a cape to. The line is kept for the one
     case there is nothing to draw from: the ledger could not be read at all. */
  if (!summary?.totals || !summary.level) {
    body.replaceChildren(el('p', {
      class: 'stats__empty',
      text: 'Your record could not be read right now. Play once with BlueClient in the game and try again.'
    }));
    return;
  }

  body.replaceChildren(heroCard(summary), capesPanel(summary), morePanel());
  if (refs.copy) refs.copy.hidden = !refs.hero;
}

/** A figure over its name. */
const tile = (figure, label) => el('div', { class: 'stats-tile' }, [
  el('span', { class: 'stats-tile__num', text: figure }),
  el('span', { class: 'stats-tile__label', text: label })
]);

/* ------------------------------------------------------- the level card */

/**
 * Who you are on BlueClient, on one card: the model with his cape on, from
 * behind; the name and the start from the account and the ledger; the cape
 * worn and the streak as pills; the level and its bar; three figures. It
 * wears the brand line only while it is being photographed (see copyImage),
 * because a paste into a Discord is the one place this record is ever shown
 * to anyone, and every paste carries the name.
 */
function heroCard(summary) {
  const account = activeAccount();
  const name = account?.username || 'You';
  const { level, totals, streak } = summary;

  /* The Home model's own code — the same skin, the same moving cape — on a
     stage of its own, standing the other way round. Drag turns him, a
     double-click brings him back; the skin lands once Mojang answers, the
     cape once its strip is cooked (dressModel). */
  const stage = createCharacter({ overflow: 0.88, clearance: 6, rest: CAPE_VIEW_YAW });
  stage.classList.add('stats-hero__stage');
  refs.stage = stage;
  getSkin(account?.username || '').then((skin) => {
    if (skin?.ok && refs.stage === stage) stage.setSkin(skin);
  });
  dressModel(summary);

  const run = streak?.days || 0;
  const since = totals.since
    ? `Playing since ${new Date(totals.since).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
    : 'On BlueClient';

  refs.hero = el('section', { class: 'card card--pad stats-hero' }, [
    stage,
    el('div', { class: 'stats-hero__top' }, [
      el('div', { class: 'stats-hero__who' }, [
        el('span', { class: 'stats-hero__name truncate', text: name, title: name }),
        el('span', { class: 'stats-hero__since', text: since })
      ]),
      el('span', { class: 'spacer' }),
      /* The cape worn, as a pill; "No cape yet" with the level that earns the
         first before one is. Rebuilt in place by paintCapes when the choice
         changes. */
      (refs.heroCape = el('div', { class: 'stats-hero__cape' }, heroCape(summary))),
      /* The streak, with its flame — lit while the run is alive, grey when
         today has not been played yet; the tip says which. */
      el('div', {
        class: `stats-hero__streak${run && streak.alive ? ' is-lit' : ''}`,
        'data-tip': !run ? 'Play today to start one' : streak.alive ? 'Played today' : 'Play today to keep it'
      }, [
        el('span', { class: 'stats-hero__flame', html: icons.flame }),
        el('span', { class: 'stats-hero__streak-num', text: run ? `${run} day streak` : 'No streak yet' })
      ])
    ]),
    el('div', { class: 'stats-hero__level' }, [
      el('div', { class: 'stats-hero__level-row' }, [
        el('span', { class: 'stats-hero__level-num', text: `Level ${level.level}` }),
        news().level === level.level ? el('span', { class: 'stats-tile__new', text: 'New' }) : null,
        el('span', { class: 'spacer' }),
        el('span', { class: 'stats-hero__level-next', text: levelLine(level) })
      ]),
      el('div', {
        class: 'stats-hero__bar',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(Math.round((level.into / level.span) * 100)),
        'aria-label': `Level ${level.level}, ${levelLine(level)}`
      }, [
        el('div', { class: 'stats-hero__fill', style: { width: `${Math.max(1.5, (level.into / level.span) * 100)}%` } })
      ])
    ]),
    el('div', { class: 'stats-tiles' }, [
      /* A figure, never a sentence: "under a minute" ran into the next tile on
         a record with nothing in it yet (2026-09-22). */
      tile(totals.playedMs < 60000 ? '0m' : spell(totals.playedMs), 'Played'),
      tile(totals.playerKills.toLocaleString(), 'Players killed'),
      tile(totals.mobKills.toLocaleString(), 'Mobs killed')
    ]),
    /* Only in the picture: who made the card. See copyImage(). */
    el('div', { class: 'stats-hero__brand' }, [
      el('span', { class: 'brand__mark' }, [
        el('img', { src: 'assets/art/logo-round.png', alt: '', draggable: 'false' })
      ]),
      el('span', { text: 'BlueClient' }),
      el('span', { class: 'stats-hero__brand-site', text: 'blueclient.net' })
    ])
  ]);
  return refs.hero;
}

/**
 * The worn cape onto the model, or none — the same rule the game applies
 * and the same strip Home hangs (fillCape in pages/home.js). Yours is cooked
 * in the colours picked, which takes a moment the first time; a change of
 * colours or of choice calls this again.
 */
async function dressModel(summary) {
  const stage = refs.stage;
  if (!stage?.setCape || !summary?.level) return;
  const worn = capeWorn(summary.level.level, choice());
  if (!worn) {
    stage.setCape(null);
    return;
  }
  const strip = await capeStrip(worn, colours()).catch(() => null);
  if (refs.stage === stage) stage.setCape(strip);
}

/**
 * The player card as a picture on the clipboard, for a paste into Discord —
 * the one way a record that never leaves the machine gets shown to anyone.
 * Main photographs the card's own rectangle out of the live page (the glass,
 * the world behind it and all), so the picture is exactly what is on screen,
 * plus the brand line the card only wears while it is being photographed.
 */
async function copyImage() {
  const card = refs.hero;
  if (!card || !host.ledger?.snapshot) return;
  /* The card has to be on screen to be photographed, and it is the first
     thing on the page — so the page goes back to its top. (scrollIntoView
     would put it under the floating chrome, which the picture would carry.) */
  card.closest('.page')?.scrollTo({ top: 0 });
  card.classList.add('is-sharing');
  /* Two frames: one for the class to lay out, one for it to paint. */
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const rect = card.getBoundingClientRect();
  let ok = false;
  try {
    ok = await host.ledger.snapshot({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  } catch {
    ok = false;
  }
  card.classList.remove('is-sharing');
  toast(ok ? 'Copied — paste it into Discord' : 'Could not copy the picture', ok ? 'success' : 'error');
}

/* ------------------------------------------------------------------ capes */

const choice = () => state.settings?.play?.cape || '';
const colours = () => capeColours(state.settings?.play);

/** A long way off is said in hours alone: '172h to go', not '172h 22m'. */
const roughly = (ms) => (ms >= 10 * 3600000 ? `${Math.ceil(ms / 3600000).toLocaleString()}h` : spell(ms));

/** The hours the ladder wants for a level — levelOf's rule, read backwards. */
const hoursFor = (level) => ((level - 1) ** 2 / 4) * 3600000;

/** The first cape still to be earned, or null once they all are. */
const nextCape = (level) => CAPES.find((cape) => cape.level > level) || null;

/**
 * The player card's cape pill: the one worn; "No cape on" for a player who
 * has one and took it off; "No cape yet" before there is one (the Capes card
 * beside it says which is first and how far — the pill has 420px to share
 * with the name and the streak, and a longer line pushed the streak off
 * the card).
 */
function heroCape(summary) {
  const worn = capeWorn(summary.level.level, choice());
  if (worn) {
    return [
      capeFace(worn, colours(), 2),
      el('span', { class: 'stats-hero__cape-name', text: `${worn.name} cape` })
    ];
  }
  return [
    el('span', { class: 'stats-hero__cape-empty', html: icons.award }),
    el('span', { class: 'stats-hero__cape-name', text: capeEarned(summary.level.level) ? 'No cape on' : 'No cape yet' })
  ];
}

/**
 * The Capes card. One cape stands big in it — the next to be earned while
 * there is one, Yours once every cape is — and every other cape is a row
 * under it. A row that is earned is a button that wears it (Wear / Wearing,
 * press again to take it off); one still to be earned says its level and
 * how far. Under the big tile, while it is the goal, the road: a bar from
 * Level 1 to its level, the ends written under it. Once Yours is earned its
 * colours are in the tile (2026-09-13): eight starting points, the three
 * colours themselves, and whether the B is on it — every change goes onto
 * the tile, the model and the pill at once, and to the game from the next
 * launch.
 */
function capesPanel(summary) {
  const level = summary.level.level;
  refs.level = summary.level;
  const next = nextCape(level);
  const big = next || capeById('yours');
  refs.capeTiles = new Map();

  const tiles = CAPES.map((cape) => {
    const earned = cape.level <= level;
    const isBig = cape.id === big.id;
    /* An earned row is a button that wears it. The big tile is never one —
       it holds the colour pickers once Yours is earned, and a picker inside
       a button is a click that goes two places — so its Wear is a button of
       its own inside it. */
    const asButton = earned && !isBig;
    const tile = el(asButton ? 'button' : 'div', {
      class: `stats-cape${isBig ? ' stats-cape--big' : ' stats-cape--row'}${earned ? ' is-earned' : ''}`,
      type: asButton ? 'button' : null,
      onClick: asButton ? () => wear(cape, summary) : null
    }, [
      el('span', { class: 'stats-cape__face' }, [capeFace(cape, colours(), isBig ? 9 : 3)]),
      el('span', { class: 'stats-cape__name', text: cape.name }),
      isBig ? el('span', { class: 'stats-cape__about', text: cape.about }) : null,
      el('span', { class: 'stats-cape__level', text: `Level ${cape.level}` }),
      isBig && earned
        ? el('button', { class: 'stats-cape__state stats-cape__wear', type: 'button', onClick: () => wear(cape, summary) })
        : el('span', { class: 'stats-cape__state' }),
      /* The road to it, while it is the goal. */
      isBig && next ? road(level, cape) : null
    ]);
    refs.capeTiles.set(cape.id, tile);
    return tile;
  });
  /* The big one first, whichever it is. */
  tiles.sort((a, b) => (b.classList.contains('stats-cape--big') ? 1 : 0) - (a.classList.contains('stats-cape--big') ? 1 : 0));

  refs.capeColours = capeById('yours').level <= level ? coloursRow(summary) : null;
  if (refs.capeColours) refs.capeTiles.get('yours').append(refs.capeColours);

  refs.capesTitle = el('h2', { class: 'stats-panel__title' });
  refs.capesNote = el('span', { class: 'stats-panel__note' });
  paintCapes(summary);

  return el('section', { class: 'card card--pad stats-panel stats-capes-card' }, [
    el('div', { class: 'stats-panel__head' }, [refs.capesTitle, el('span', { class: 'spacer' }), refs.capesNote]),
    el('div', { class: 'stats-capes' }, tiles)
  ]);
}

/**
 * More to wear: the shelf of what is still to come. One bare tile a kind —
 * the icon in a quiet disc, the name, "Soon" — with only a hairline between
 * them. Nothing here is pressable: there is nothing to press yet, and a tile
 * that looked like a button would be six clicks that go nowhere.
 */
function morePanel() {
  return el('section', { class: 'card card--pad stats-panel stats-more', 'aria-label': 'More to wear, coming soon' }, [
    el('div', { class: 'stats-panel__head' }, [
      el('h2', { class: 'stats-panel__title', text: 'More to wear' }),
      el('span', { class: 'stats-panel__note', text: 'Coming soon · earned by playing, like the capes' })
    ]),
    el('div', { class: 'stats-shelf' }, COMING.map((kind) => el('div', { class: 'stats-shelf__item' }, [
      el('span', { class: 'stats-shelf__icon', html: icons[kind.icon] }),
      el('span', { class: 'stats-shelf__name', text: kind.name }),
      el('span', { class: 'stats-shelf__sub', text: 'Soon' })
    ])))
  ]);
}

/**
 * The road to the next cape: a bar from Level 1 to the cape's level, filled
 * to the player's — in levels, the launcher's own unit. Under it, the two
 * ends: where you are (and how far the next level is), and where the cape
 * is. The hours are in the tile's state line, so the picture is friendly
 * and the words are true.
 */
function road(level, cape) {
  const L = refs.level;
  return el('span', { class: 'stats-road' }, [
    el('span', { class: 'stats-road__track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(cape.level), 'aria-valuenow': String(level) }, [
      el('span', { class: 'stats-road__fill', style: { width: `${Math.max(1.5, (level / cape.level) * 100)}%` } })
    ]),
    el('span', { class: 'stats-road__ends' }, [
      el('span', {}, [el('b', { text: `Level ${level}` }), el('span', { text: L ? ` · ${levelLine(L)}` : '' })]),
      el('span', { text: `Level ${cape.level}` })
    ])
  ]);
}

/** Yours' colours: the starting points, the three pickers, the B. */
function coloursRow(summary) {
  const c = colours();
  const starts = el('div', { class: 'stats-colours__starts' }, CAPE_STARTS.map(([top, bottom, spark]) => el('button', {
    class: 'stats-colours__start',
    type: 'button',
    title: `${top} to ${bottom}`,
    style: { background: `linear-gradient(135deg, ${top}, ${bottom})` },
    onClick: (event) => { event.stopPropagation(); setColours(summary, { top, bottom, spark }); }
  })));
  let timer = 0;
  const pick = (key, label) => el('label', { class: 'stats-colours__pick', onClick: (event) => event.stopPropagation() }, [
    el('span', { text: label }),
    el('input', {
      type: 'color',
      value: c[key],
      dataset: { key },
      /* The native picker fires on every move of the pointer, and every
         landing cooks thirty sheets in the new colours, builds the model's
         strip and writes the settings file. A quarter of a second, not a
         tenth (2026-09-22): ten sets a second is thirty canvases and nine
         megabytes of pixels ten times a second, and the drag was the most
         expensive thing a hand could do in the launcher. The picker's own
         change event — the colour committed — is applied at once, so letting
         go is never the slow one. */
      onInput: (e) => {
        clearTimeout(timer);
        const value = e.target.value;
        timer = setTimeout(() => setColours(summary, { [key]: value }), 250);
      },
      onChange: (e) => {
        clearTimeout(timer);
        setColours(summary, { [key]: e.target.value });
      }
    })
  ]);
  const letter = el('label', { class: 'stats-colours__letter', onClick: (event) => event.stopPropagation() }, [
    el('input', { type: 'checkbox', checked: c.letter, onChange: (e) => setColours(summary, { letter: e.target.checked }) }),
    el('span', { text: 'the B, pressed in' })
  ]);
  return el('div', { class: 'stats-colours' }, [
    starts,
    el('div', { class: 'stats-colours__picks' }, [pick('top', 'Top'), pick('bottom', 'Bottom'), pick('spark', 'Sparkles'), letter])
  ]);
}

/** A colour changed: it is worn, kept, and on every picture of it. */
async function setColours(summary, patch) {
  const now = colours();
  const next = { ...now, ...patch };
  // The picker fires twice for one colour — the last input and the change —
  // and a start tile pressed twice is the same set again. Nothing below is
  // cheap enough to do for a set that is already worn (2026-09-22).
  if (Object.keys(next).every((key) => next[key] === now[key])) return;
  await updateSettings({ play: { cape: 'yours', colours: next } });
  const tile = refs.capeTiles?.get('yours');
  if (tile) tile.querySelector('.stats-cape__face').replaceChildren(capeFace(capeById('yours'), next, 9));
  if (refs.capeColours) {
    for (const input of refs.capeColours.querySelectorAll('input[type="color"]')) input.value = next[input.dataset.key];
    refs.capeColours.querySelector('input[type="checkbox"]').checked = next.letter;
  }
  paintCapes(summary);
}

/**
 * Everything on the Capes card that follows the level and the choice: the
 * title, the note, the state line on every tile, the pill on the Level card
 * and the cape on the model.
 */
function paintCapes(summary) {
  const level = summary.level.level;
  refs.level = summary.level;
  const worn = capeWorn(level, choice());
  const next = nextCape(level);
  for (const cape of CAPES) {
    const tile = refs.capeTiles?.get(cape.id);
    if (!tile) continue;
    const isWorn = worn?.id === cape.id;
    tile.classList.toggle('is-worn', isWorn);
    const line = tile.querySelector('.stats-cape__state');
    for (const pressable of [tile, line]) if (pressable.tagName === 'BUTTON') pressable.setAttribute('aria-pressed', String(isWorn));
    if (cape.level > level) {
      const left = Math.max(0, hoursFor(cape.level) - summary.totals.playedMs);
      line.textContent = tile.classList.contains('stats-cape--big') ? `${roughly(left)} of play to go` : `${roughly(left)} to go`;
    } else {
      line.textContent = isWorn ? 'Wearing' : 'Wear';
    }
  }
  if (refs.capesTitle) refs.capesTitle.textContent = next ? 'Next cape' : 'Capes';
  if (refs.capesNote) {
    refs.capesNote.textContent = next
      ? `Level ${level} now`
      : `${CAPES.length} of ${CAPES.length} earned`;
  }
  if (refs.heroCape) refs.heroCape.replaceChildren(...heroCape(summary));
  dressModel(summary);
}

/** Wear a cape, or take the worn one off. A launcher setting; the game reads it as it opens. */
async function wear(cape, summary) {
  const worn = capeWorn(summary.level.level, choice());
  const next = worn?.id === cape.id ? 'none' : cape.id;
  await updateSettings({ play: { cape: next } });
  paintCapes(summary);
}
