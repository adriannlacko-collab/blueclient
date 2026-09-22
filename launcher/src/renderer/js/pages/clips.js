/**
 * Clips — everything the game saved: clips on F8, screenshots on F2.
 *
 * <h2>It holds both, and it is still called Clips (2026-09-08)</h2>
 * Screenshots had nowhere at all before this: the game wrote a PNG into a
 * folder four levels inside an instance and said one line about it, and that
 * was the end of the launcher's involvement — while the thing a player takes
 * ten times more often than a clip had none of the tab a clip had. Adrian
 * asked for them handled the same way and asked for it without another tab on
 * the bar, so this one holds both.
 *
 * It was renamed **Gallery** for a few minutes on the strength of that, and
 * Adrian put it back: Clips is the word players already use for this tab, the
 * picture icon says the rest, and the All / Clips / Screenshots row is the
 * first thing under it — so nobody is a glance away from knowing what is in
 * here. A tab named for the thing people come for beats one named for the
 * union of its contents.
 *
 * <h2>Clips are moved, screenshots are read where they lie</h2>
 * A clip is written to one folder the launcher chose and told the game about,
 * because a clip is BlueClient's own invention and had no home. A screenshot
 * has had one since 2011, inside the profile that took it, and moving a
 * player's pictures for the sake of a tidier listing is not ours to do. So
 * main reads every profile's own screenshots folder and this shows the lot in
 * one place — which also means the tab opens full of pictures taken long
 * before any of this existed.
 *
 * The two are one grid, newest first, with a filter above it for the days you
 * want one kind. Each card carries the three things anyone does with either:
 * paste it into Discord, find the file, or bin it.
 *
 * <h2>A clip's picture is there before its video is (2026-09-15)</h2>
 * A video element shows nothing until it has decoded a frame, and this page
 * builds its cards afresh each time the tab is opened — so every switch to
 * Clips was a grid of black cards for the length of a decode (Adrian: "the
 * clips lagg like they are black for a tiny second"). Main keeps one still
 * per clip (see its clip-stills note) and the list hands it over; the card
 * gives it to the video as its poster, which is what a video element shows
 * until it has a frame of its own, so the card is a picture from its first
 * paint. A still made after the list answered arrives through onStill and
 * goes onto its card the same way.
 *
 * <h2>A card at rest is a picture, not a video (2026-09-15, evening)</h2>
 * The poster fixed the black moment and left the slower one: four cards each
 * holding a paused video ran the whole window at half its rate — 72 Hz on a
 * 144 Hz screen, measured, for as long as the tab was open — and the switch
 * itself opened four decoders at once (Adrian: "slight lagg whenever I
 * switch to the clips page"). A paused video is still a video layer to the
 * compositor, whatever it shows. So the still is the card now, an image like
 * a screenshot's, and the video element beside it has no file at all until
 * the pointer arrives: then it is given the clip, plays, and is shown over
 * the still once it has a frame; when the pointer leaves it lets the file go
 * again. The length on the card comes from main, which reads it off the
 * file's header, since no decoder is open to ask. A clip with no still yet
 * (the encoder is still making it, or the machine has none) is a video at
 * rest as before, and becomes a picture the moment its still lands.
 *
 * <h2>The page is shown to the graphics card at boot, and kept (2026-09-17)</h2>
 * With the cards pictures, the first switch to Clips in a launch was still
 * the slow one (Adrian: "the first time after I open the blueclient launcher
 * every session, when switching to clips, its a bit laggy with the clips
 * being black too for a short millisecond"). Traced: the compositor compiled
 * four programs for the stills — a JPEG is decoded to its three planes on
 * the card and drawn through a shader no other page asks for — with the
 * frames held 80–100 ms three times in the half second after the click, and
 * the cards stood dark for 60 ms before that while the list's first call
 * (the folder, a stat and a header read per clip, cold) came back and the
 * stills loaded. Every later switch compiled nothing and was fine. Clips had
 * been left out of the boot warm-up (js/warmup.js) while it was a page of
 * videos; it is a page of pictures now, so at boot it lists the folder,
 * builds its cards, lets the ones in view load their stills, and stands in a
 * one-percent host for two frames — the card meets the stills' paint while
 * the player is still looking at Home.
 *
 * And the cards are kept for the launcher's life, not the visit's: a card at
 * rest holds a picture and nothing else, and the page used to build every
 * card again on each visit, which put a frame or two of dark cards on every
 * switch while the observer handed out files and the pictures came back
 * from the cache. Now the cards from the last visit (or the boot) go into
 * the grid before the page is on screen, pictures in place, and the list's
 * answer only adds what is new and drops what is gone. Leaving the page puts
 * every card to sleep — the video let go, the pointer forgotten — and the
 * next visit wakes them. What is held between visits is what was looked at:
 * a card's picture is only ever asked for as it scrolls into view.
 *
 * <h2>A star keeps the one that matters (2026-09-19)</h2>
 * Adrian: "Add to favorite for screenshots and clips … good if is a
 * important screenshot, for ex base coords, fan taking photo with adrian on
 * livestream, etc instead of having to search it minutes or hours." Every
 * card carries a star in its action row, outline until pressed and filled
 * once it is; the mark is main's (favourites.json beside the settings —
 * src/main/favourites.js) and comes back on the list as `favourite`, so it
 * survives a restart and goes with the file when the file is binned. The
 * filter row's fourth pick, Favourites, shows only the starred of both
 * kinds; the fourth segment fits the bar at its width, so no second control
 * was added beside it. Pressing the star flips the button in place — the
 * card is not rebuilt, its picture is not asked for again, and its video is
 * not touched — and, on the Favourites view, unstarring a card hides it the
 * way the filter hides the other kind. Nothing is added to a card at rest
 * for it: one more ghost button, no clock, no observer.
 */

import { segmented } from '../ui/segmented.js';
import { el, mount } from '../ui/dom.js';
import { icons } from '../icons.js';
import { confirmModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { host } from '../bridge.js';
import { warmLater } from '../warmup.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'clips', label: 'Clips' },
  { id: 'shots', label: 'Screenshots' },
  /* The starred of both kinds (2026-09-19) — a fourth segment on the same
     bar, not a mark beside it, so there is one control to read. */
  { id: 'favs', label: 'Favourites' }
];

let grid;
let count;
let folderButton;
let filter = 'all';
let items = [];

/* Every card on the page, by item, kept for as long as the launcher is
   (2026-09-10, evening; across visits since 2026-09-17 — see the header).
   Switching All → Clips used to build every card again from nothing, and a
   clip card is dark until its video has decoded a frame — so the whole grid
   went black for the length of a decode on every pick, and again on every
   refresh when the window came back to the front. Adrian: "clips turn black
   for a millisecond when you switch category". Now a filter only hides the
   cards that are not its kind, and a refresh adds what is new and drops what
   is gone; a card that is already showing its picture keeps it. */
const cards = new Map();                 // key -> { node, mark, video?, sleep?, wake?, gotStill? }
let emptyNode = null;
/* Whether the folder has answered once: the empty message is for a listed
   folder with nothing in it, not for the moment before the answer. */
let listed = false;
/* The list in flight, or the last one — the warm-up waits on it. */
let listing = Promise.resolve();
/* On screen as the page the player is looking at (not the warm-up host). */
let live = false;

const keyOf = (item) => `${item.kind}:${item.id}`;

/* A still that landed after the list answered: onto its card, if the card is
   still here and has none, and the video it was standing in for is let go. */
host.clips.onStill?.(({ name, still }) => {
  cards.get(`clip:${name}`)?.gotStill?.(still);
});

export function render() {
  grid = el('div', { class: 'clip-grid' });
  count = el('span', { class: 'eyebrow' });
  emptyNode = el('div', { class: 'empty' });
  emptyNode.hidden = true;

  /* The cards as they were left go straight in, pictures and all, so the
     page's first frame is the page; the list then adds what is new. */
  for (const card of cards.values()) card.wake?.();
  place();
  listing = refresh();

  return el('div', { class: 'page page--clips' }, [
    el('div', { class: 'page__inner' }, [
      el('header', { class: 'page-actions' }, [
        count,
        el('span', { class: 'spacer' }),
        filterRow(),
        folderRow()
      ]),

      grid
    ])
  ]);
}

export function mounted() {
  live = true;
}

/** The page was left: every card to sleep, the file it was playing let go. */
export function unmounted() {
  live = false;
  for (const card of cards.values()) card.sleep?.();
}

/**
 * The card's first look at this page, at boot — see the header (2026-09-17).
 *
 * The page is built as for a visit and stood in the warm-up host; when the
 * folder has answered and the stills the observer asked for are decoded (or
 * two seconds have passed — a still that never comes must not hold the
 * boot), it stays two frames more and goes. The cards it built are the ones
 * the first visit shows. If the player reaches the tab before this is done,
 * render() has already taken the cards into the real grid; the host goes
 * with its empty page and nothing is put to sleep.
 */
export async function warm() {
  if (live) return;
  await warmLater(render(), (async () => {
    await listing;
    /* The observer hands out files in a task after the frame the cards
       landed in; two frames on, every card in view has its file. */
    await frames(2);
    const stills = [...grid.querySelectorAll('img[src]')];
    await Promise.race([
      Promise.all(stills.map((img) => img.decode().catch(() => {}))),
      new Promise((done) => setTimeout(done, 2000))
    ]);
  })());
  if (!live) for (const card of cards.values()) card.sleep?.();
}

const frames = (n) => new Promise((done) => {
  const step = () => (--n > 0 ? requestAnimationFrame(step) : done());
  requestAnimationFrame(step);
});

/**
 * The one button that opens a folder in Explorer.
 *
 * Which folder depends on what is being shown, because there is no one folder:
 * clips live in a single place the launcher chose, and screenshots live inside
 * whichever profile took them. On All it offers the clips folder, which is the
 * only one of the two that is a single place — and says so, rather than
 * offering a vague "folder" that could be either.
 */
function folderRow() {
  folderButton = el('button', {
    class: 'btn btn--secondary btn--lg',
    onClick: () => (filter === 'shots' ? host.shots.folder() : host.clips.folder())
  }, [
    el('span', { html: icons.folder, style: { display: 'contents' } }),
    /* Both labels live in the button, the longer one invisible, so its width
       is the same on every filter (Adrian, 2026-09-09: "the folder text is
       changing width as well which is very inconvenient"). */
    el('span', { class: 'label-stack' }, [
      el('span', { class: 'js-folder-label', text: 'Clips folder' }),
      el('span', { class: 'label-stack__ghost', 'aria-hidden': 'true', text: 'Screenshots folder' })
    ])
  ]);
  paintFolder();
  return folderButton;
}

function paintFolder() {
  const label = folderButton?.querySelector('.js-folder-label');
  if (label) label.textContent = filter === 'shots' ? 'Screenshots folder' : 'Clips folder';
}

/**
 * All / Clips / Screenshots.
 *
 * The thumb is parked without a slide on the first paint, the same bargain the
 * profile editor's loader row makes: a slide belongs to the click that caused
 * it, and one played on arrival means nothing.
 */
function filterRow() {
  return segmented({
    options: FILTERS,
    value: filter,
    label: 'Show',
    onChange: (id) => {
      filter = id;
      paintFolder();
      paint();
    }
  });
}

/* Anything saved while the launcher sat behind the game is on the page by the
   time the player has alt-tabbed to it — but not more than once every few
   seconds (2026-09-22). A refresh lists two folders in main and can set the
   encoder going for a still that is not made yet, and Windows sends a focus
   event for every alt-tab, every click back from the game and every dialog
   that closes: a player switching between a windowed game and the launcher
   was scanning their Videos folder several times a second. */
const FOCUS_RESCAN_MS = 4000;
let lastRescan = 0;
window.addEventListener('focus', () => {
  if (!grid?.isConnected) return;
  const now = Date.now();
  if (now - lastRescan < FOCUS_RESCAN_MS) return;
  lastRescan = now;
  refresh();
});

/* Only the newest list is placed (2026-09-22), as on Worlds: a focus
   refresh and the one after a delete can be in flight together, and an
   older answer landing last put a card just binned back on the page until
   the next look. A list that failed leaves the page as it was, and is not
   a rejection nobody catches (the focus refresh has no one waiting). */
let refreshSeq = 0;

async function refresh() {
  const seq = ++refreshSeq;
  const [clipsAnswer, shotsAnswer] = await Promise.all([
    host.clips.list().catch(() => null),
    host.shots.list().catch(() => null)
  ]);
  if (seq !== refreshSeq) return;              // a newer list is on its way
  if (!clipsAnswer || !shotsAnswer) return;

  const clips = (clipsAnswer?.clips || []).map((clip) => ({ ...clip, kind: 'clip', id: clip.name }));
  const shots = (shotsAnswer?.shots || []).map((shot) => ({ ...shot, kind: 'shot' }));

  items = [...clips, ...shots].sort((a, b) => b.modified - a.modified);

  // What is gone leaves, letting go of its file; what is new is built.
  const wanted = new Set(items.map(keyOf));
  for (const [key, card] of cards) {
    if (wanted.has(key)) continue;
    card.sleep?.();
    card.node.remove();
    cards.delete(key);
  }
  for (const item of items) {
    const card = cards.get(keyOf(item));
    if (!card) cards.set(keyOf(item), item.kind === 'clip' ? clipCard(item) : shotCard(item));
    /* The file is the record of the star; a kept card takes its word. */
    else card.mark(Boolean(item.favourite));
  }
  listed = true;

  /* A page that was left while the folder was being read is placed on its
     next render; the cards are built either way. */
  if (grid?.isConnected) place();
}

/**
 * The cards into the grid in the list's order, then the filter over them.
 * The grid is touched only when its order changed — a refresh that found
 * nothing new moves nothing, and every showing picture stays put.
 */
function place() {
  const nodes = items.map((item) => cards.get(keyOf(item))?.node).filter(Boolean);
  const same = grid.children.length === nodes.length + 1
    && nodes.every((node, at) => grid.children[at] === node);
  if (!same) grid.replaceChildren(...nodes, emptyNode);
  paint();
}

function wanted(item) {
  if (filter === 'clips') return item.kind === 'clip';
  if (filter === 'shots') return item.kind === 'shot';
  if (filter === 'favs') return Boolean(item.favourite);
  return true;
}

/**
 * The star was pressed and main said yes: the page's own copy of the item
 * takes the mark, so the filter reads it, and the Favourites view is
 * repainted — an unstarred card leaves it, the count follows. Any other
 * view changes nothing on screen but the star itself.
 */
function marked(key, on) {
  const item = items.find((one) => keyOf(one) === key);
  if (item) item.favourite = on;
  if (filter === 'favs') paint();
}

/** Show the filter's kind and hide the rest; nothing is rebuilt. */
function paint() {
  let shown = 0;
  for (const item of items) {
    const on = wanted(item);
    cards.get(keyOf(item)).node.hidden = !on;
    if (on) shown++;
  }

  count.textContent = shown === 0 ? '' : `${shown} ${word(shown)}`;

  if (shown === 0 && listed) mount(emptyNode, ...empty());
  emptyNode.hidden = shown > 0 || !listed;
}

/* A card's picture is asked for only as it scrolls into view — see the note
   above `watcher` below. One observer for the page; a hidden card does not
   intersect, and is given its file the first time its filter shows it. */
function watch(media) {
  watcher ||= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = entry.target;
      if (!node.src && node.dataset.src) node.src = node.dataset.src;
      watcher.unobserve(node);
    }
  }, { rootMargin: '200px' });
  watcher.observe(media);
}

function word(n) {
  if (filter === 'clips') return n === 1 ? 'clip' : 'clips';
  if (filter === 'shots') return n === 1 ? 'screenshot' : 'screenshots';
  if (filter === 'favs') return n === 1 ? 'favourite' : 'favourites';
  return n === 1 ? 'item' : 'items';
}

function empty() {
  const lines = {
    clips: [
      'No clips yet',
      'In the game, switch on Clipping under Blue Settings → General and press F8 to save the last few seconds. They land here.'
    ],
    shots: [
      'No screenshots yet',
      'Press F2 in the game. The picture is saved and put on your clipboard, and it turns up here.'
    ],
    favs: [
      'No favourites yet',
      'Press the star on a clip or screenshot to keep it here.'
    ],
    all: [
      'Nothing saved yet',
      'Press F2 for a screenshot, or switch on Clipping under Blue Settings → General and press F8 for a clip. Both land here.'
    ]
  }[filter];
  const glyph = { shots: icons.image, favs: icons.star }[filter] || icons.film;

  return [
    el('span', { class: 'empty__icon', html: glyph }),
    el('span', { class: 'empty__title', text: lines[0] }),
    el('span', { class: 'empty__text', text: lines[1] })
  ];
}

/* A clip is given its file only as its card scrolls into view (2026-09-06).
   Every card used to carry its video from the start, which on a page of
   fifty clips was fifty decoders opened at once — on a tab that is often
   opened while a game is still running. Screenshots go the same way: an
   image is cheaper than a video and a hundred of them is not. */
let watcher = null;

/**
 * Make a card's video let go of its file.
 *
 * Pausing does not: the element keeps the resource it loaded and Windows
 * still counts the file as open, so anything that moves or deletes it is
 * refused. Dropping the source and reloading is what closes it — the empty
 * load() is the part that matters, and it has to come after the attribute is
 * gone or the element simply fetches the same file again.
 */
function release(video) {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch { /* already torn down */ }
}

/* ------------------------------------------------------------- clip card */

function clipCard(clip) {
  const duration = el('span', { class: 'clip-card__duration', text: length(clip.duration) });
  /* The picture at rest — main's still of the clip's first frame. */
  const image = el('img', { class: 'clip-card__shot', alt: '' });
  const video = el('video', {
    class: 'clip-card__video',
    preload: 'metadata',
    muted: true,
    loop: true,
    playsinline: true,
    disablepictureinpicture: true
  });
  /* The attribute alone is not always honoured before the first load. */
  video.muted = true;
  video.addEventListener('loadedmetadata', () => {
    if (!duration.textContent) duration.textContent = length(video.duration);
    if (!hovering) park();
  });
  /* Over the still only once there is a frame to show — a video with a file
     and no frame yet is a black card. */
  video.addEventListener('playing', () => { if (hovering) video.hidden = false; });

  let hovering = false;
  const hasStill = () => Boolean(image.src || image.dataset.src);

  /* Parked a frame in, because a video element shows nothing at all until it
     has decoded one, and it only decodes one when asked for a time. Only the
     card with no still is a video at rest. */
  const park = () => {
    video.pause();
    try { video.currentTime = 0.05; } catch { /* not seekable yet */ }
  };

  /* The card as it is with no pointer on it: a picture, and a video holding
     nothing — or, with no picture yet, the video parked on its first frame,
     asked for as the card comes into view (and again after a sleep let it
     go: the observer takes a card back once its file has been dropped). */
  const rest = () => {
    hovering = false;
    if (hasStill()) {
      video.hidden = true;
      release(video);
    } else {
      video.hidden = false;
      if (video.src) park();
      else {
        video.dataset.src = clip.url;
        watch(video);
      }
    }
  };
  /* The page was left, or the card is going: whatever the video held, let
     go, and no pointer is on anything. The picture stays. */
  const sleep = () => {
    hovering = false;
    video.hidden = true;
    release(video);
  };
  const play = () => {
    hovering = true;
    if (!video.src) video.src = clip.url;
    video.play().catch(() => {});
  };
  /* The picture is under the video before the video goes, so the card never
     shows its empty floor between the two. */
  const gotStill = (still) => {
    if (hasStill()) return;
    image.addEventListener('load', () => { if (!hovering) rest(); }, { once: true });
    image.src = still;
  };

  if (clip.still) {
    image.dataset.src = clip.still;
    watch(image);
  }
  rest();

  const { node, mark } = card({
    frameLabel: `Open ${clip.name}`,
    onOpen: () => host.clips.open(clip.name),
    media: [image, video, duration],
    title: when(clip.modified),
    meta: `${size(clip.size)} · ${clip.name}`,
    favourite: clip.favourite,
    onFavourite: async (on) => {
      const ok = await host.clips.favourite(clip.name, on);
      /* Unstarred on the Favourites view, the card is about to hide with
         the pointer still on it, and a hidden card is not left playing. */
      if (ok && !on && filter === 'favs') rest();
      if (ok) marked(keyOf(clip), on);
      return ok;
    },
    onCopy: async () => {
      const ok = await host.clips.copy(clip.name);
      toast(ok ? 'Copied — paste it into Discord' : 'Could not copy the clip', ok ? 'success' : 'error');
    },
    onReveal: () => host.clips.reveal(clip.name),
    onDelete: async () => {
      const ok = await confirmModal({
        title: 'Delete this clip?',
        message: `The clip from ${when(clip.modified).toLowerCase()} goes to the Recycle Bin.`,
        confirmLabel: 'Delete'
      });
      if (!ok) return false;

      /* Let go of the file before asking main to bin it (2026-09-07).
         Windows will not move a file to the Recycle Bin while something has it
         open, and a card that is *playing* has it open — pausing is not
         enough, because the element keeps its media resource and the reader
         behind it. Reaching the Delete button means the pointer is inside the
         card, which is what started it playing, and a modal opening over the
         card does not fire mouseleave (nothing moved), so it is still playing
         at the press. That is the whole of "sometimes I can't delete clips". */
      rest();
      release(video);

      const done = await host.clips.remove(clip.name);
      if (!done) {
        /* Put the picture back — the card is staying. */
        if (!hasStill()) video.src = clip.url;
        toast('Could not delete the clip — it may be open in another program', 'error');
        return false;
      }
      return true;
    }
  });

  node.addEventListener('mouseenter', play);
  node.addEventListener('mouseleave', rest);
  return { node, mark, video, gotStill, sleep, wake: rest };
}

/* ------------------------------------------------------------- shot card */

function shotCard(shot) {
  const image = el('img', {
    class: 'clip-card__shot',
    alt: shot.name,
    dataset: { src: shot.url }
  });
  watch(image);

  const { node, mark } = card({
    frameLabel: `Open ${shot.name}`,
    onOpen: () => host.shots.open(shot.id),
    media: [image],
    title: when(shot.modified),
    meta: `${size(shot.size)} · ${shot.name}`,
    favourite: shot.favourite,
    onFavourite: async (on) => {
      const ok = await host.shots.favourite(shot.id, on);
      if (ok) marked(keyOf(shot), on);
      return ok;
    },
    onCopy: async () => {
      const ok = await host.shots.copy(shot.id);
      toast(ok ? 'Copied — paste it anywhere' : 'Could not copy the screenshot', ok ? 'success' : 'error');
    },
    onReveal: () => host.shots.reveal(shot.id),
    onDelete: async () => {
      const ok = await confirmModal({
        title: 'Delete this screenshot?',
        message: `The screenshot from ${when(shot.modified).toLowerCase()} goes to the Recycle Bin.`,
        confirmLabel: 'Delete'
      });
      if (!ok) return false;

      const done = await host.shots.remove(shot.id);
      if (!done) {
        toast('Could not delete the screenshot — it may be open in another program', 'error');
        return false;
      }
      return true;
    }
  });
  return { node, mark };
}

/* --------------------------------------------------------- the card itself */

/**
 * The shape both kinds share: a picture, two lines, and four buttons — Copy,
 * then the star, the folder and the bin. Answers the card and `mark(on)`,
 * which sets the star without touching anything else on the card.
 */
function card({ frameLabel, onOpen, media, title, meta, favourite, onFavourite, onCopy, onReveal, onDelete }) {
  /* The star (2026-09-19): a ghost button like the two beside it, its state
     on aria-pressed, which is what pages.css fills the glyph from. Flipped
     the moment it is pressed and flipped back only if main refused, so the
     press answers at once and the file is still the record. */
  const star = el('button', {
    class: 'btn btn--ghost btn--sm btn--icon clip-card__star',
    html: icons.star,
    onClick: async () => {
      const on = star.getAttribute('aria-pressed') !== 'true';
      mark(on);
      if (await onFavourite(on)) return;
      mark(!on);
      toast(on ? 'Could not keep the favourite' : 'Could not remove the favourite', 'error');
    }
  });
  const mark = (on) => {
    if (star.getAttribute('aria-pressed') === String(on)) return;
    star.setAttribute('aria-pressed', String(on));
    star.setAttribute('aria-label', on ? 'Favourited' : 'Favourite');
    star.dataset.tip = on ? 'Favourited' : 'Favourite';
  };
  mark(Boolean(favourite));

  const node = el('article', { class: 'clip-card' }, [
    el('button', { class: 'clip-card__frame', 'aria-label': frameLabel, onClick: onOpen }, media),

    el('div', { class: 'clip-card__body' }, [
      el('span', { class: 'clip-card__name truncate', text: title }),
      el('span', { class: 'clip-card__meta truncate', text: meta })
    ]),

    el('div', { class: 'clip-card__actions' }, [
      el('button', { class: 'btn btn--secondary btn--sm', onClick: onCopy }, [
        el('span', { html: icons.copy, style: { display: 'contents' } }),
        el('span', { text: 'Copy' })
      ]),
      el('span', { class: 'spacer' }),
      star,
      el('button', {
        class: 'btn btn--ghost btn--sm btn--icon',
        'aria-label': 'Show in folder',
        'data-tip': 'Show in folder',
        html: icons.folder,
        onClick: onReveal
      }),
      el('button', {
        class: 'btn btn--ghost btn--sm btn--icon',
        'aria-label': 'Delete',
        'data-tip': 'Delete',
        html: icons.trash,
        onClick: async () => {
          if (!(await onDelete())) return;
          node.remove();
          refresh();
        }
      })
    ])
  ]);

  return { node, mark };
}

/* --------------------------------------------------------------- wording */

/** "Today · 08:42", "Yesterday · 23:10", "6 Sep · 08:42". */
function when(ms) {
  const date = new Date(ms);
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, now)) return `Today · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday · ${time}`;

  const day = date.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  });
  return `${day} · ${time}`;
}

function length(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function size(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
