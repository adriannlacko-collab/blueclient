import { el, observeSize } from '../ui/dom.js';
import { icons } from '../icons.js';
import { openMenu, menuLabel, menuItem, menuSeparator } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { host } from '../bridge.js';
import { getSkin, paintAccountHead } from '../skin.js';
import { blockIcon, blockIdFor } from '../blocks.js';
import { openAccountModal } from './account.js';
import { openSkinsModal } from './skins.js';
import { openBackgroundModal } from '../ui/background.js';
import { openAddFriendModal } from '../ui/addfriend.js';
import { openImporter } from '../ui/importer.js';
import { openSection } from './settings.js';
import { APP_NAME } from '../config.js';
import { servers, adopt, primeServers, partnerLogo, formatPlayers, needsAccount } from '../partners.js';
import { fillLogo, logoInto } from '../servericons.js';
import { createCharacter } from '../ui/character.js';
import { launchMoment } from '../ui/burst.js';
import { spell, levelLine, announce, capeWorn, capeStrip, capeColours, capeFace, CAPES } from '../play.js';
import { arrange, readLayout, isDefaultLayout } from './layout.js';
import {
  state, activeAccount, activeProfile, setActiveProfile, setRoute,
  touchProfile, loaderLabel, javaFor, relativeTime,
  sessionsFor, reservedMemoryMb, removeMod, updateSettings, gameStatus
} from '../state.js';

/* The server list on disk, asked for now so it is in hand before the first
   paint (partners.js, primeServers). */
primeServers();

/* Elements the progress stream writes into, kept out of the render path so
   updates are a handful of property writes rather than a re-render. */
let refs = {};
let timerHandle = null;
/* The ledger re-read a moment after a game ends (syncSessions). */
let recentTimer = null;
/* Unsubscribes the corner of Home from main's update state. Home is rebuilt on
   every visit, so the previous one has to be dropped or they stack up. */
let updateOff = null;
/* True until the stack has been painted once. Rows built on that first pass
   belong to games that were already running when Home opened, so they appear
   without the launch moment — only a row that turns up afterwards was
   actually just started by somebody pressing Play. */
let stackFresh = true;
/* The arrange mode while Layout is pressed (pages/layout.js), or null. */
let arranger = null;

/**
 * Just play (2026-09-02). The world is the screen: the player stands on the
 * panorama under a nameplate, Play and the profile picker ride up over his
 * shins the way a title-screen button sits in front of the world, and
 * one quiet line remembers what was played last. The partner servers stand
 * in one opaque slab on the right, and the player column sits a little left
 * of centre to make room for it. The version sits in the corner, where the
 * game puts it.
 *
 * Several games can run at once (2026-09-02). Pressing Play again starts
 * another — it says "Launch another" while one is up (2026-09-19) — and every
 * launch takes a thin row of its own in the
 * stack, newest nearest the button, growing upward over the player. A row
 * carries the profile it is running, who it signed in as, its clock, and one
 * control that closes it. While it is still installing, the same row carries
 * the stage and the percent over a progress sweep.
 *
 * Where the five blocks stand is the player's (2026-09-17, the Layout
 * button): `launcher.layout` says which side the player's block is on —
 * left, centre or right — and which of the two card columns each card is
 * in and in what order, and the page is built that way: a class on the grid
 * for the side, the cards appended to their column in their order. See
 * pages/layout.js for the mode that changes it.
 */
export function render() {
  const account = activeAccount();
  const profile = activeProfile();
  const layout = readLayout(state.settings);

  stopArrange();
  refs = {};

  // "Show your character" off (Settings → General) takes the model and his
  // nameplate off the world and nothing else: the Layout and Skins capsules
  // hang off this block, not off him, and went with him from 2026-09-17 to
  // 2026-09-20 — a player who had switched him off had no way to arrange
  // Home or change a skin (Adrian, with a screenshot: "the layout button is
  // gone when you remove the skin").
  refs.centre = el('div', { class: 'home__centre', 'data-block': 'skin' }, [
    state.settings?.launcher?.hideCharacter === true ? null : renderPlayer(account),
    renderLayoutTools(),
    renderSkinsButton(),
    renderLaunchStack(account, profile)
  ]);
  /* Three columns since 2026-09-21 (Home, Six Ways — "Build C"): two
     columns of cards and the player's block, which stands under the tabs
     unless the player has put him to one side. */
  const [first, second] = renderSides(layout);
  const side = layout.skin === 'left' ? ' home--skin-left' : layout.skin === 'right' ? ' home--skin-right' : '';
  refs.home = el('div', { class: `home${side}` }, [first, refs.centre, second]);

  return el('div', { class: 'page page--home' }, [
    refs.home,
    /* The number comes from main, which reads it off the same package.json
       the installer is stamped from. Nothing is typed in here to go stale.
       When a newer BlueClient exists the same corner says so and becomes a
       button to the download page — see paintUpdate(). */
    refs.version = el('div', { class: 'home__version' }, [
      el('span', { text: `${APP_NAME} ${state.system?.appVersion || ''}`.trim() })
    ]),
    /* Background, over the version line in the same corner (2026-09-21,
       Adrian: "a 'Background' button in the bottom left corner, a small
       button"): the world or a picture of the player's own, and the blur
       and brightness — see ui/background.js. Quiet, like the corner it is
       in; it is not on the road to Play. */
    el('button', {
      class: 'btn btn--sm background-open',
      'aria-label': 'Background',
      title: 'Change the background',
      onClick: () => openBackgroundModal()
    }, [
      el('span', { html: icons.image, style: { display: 'contents' } }),
      el('span', { text: 'Background' })
    ])
  ]);
}

/**
 * The active profile changed without leaving Home (the caret menu): repaint
 * the profile row in place, no re-render.
 */
export function syncProfile() {
  const profile = activeProfile();
  if (refs.pickName) refs.pickName.textContent = profile ? profile.name : 'Choose a profile';
  if (refs.pickFace) {
    refs.pickFace.style.display = profile ? '' : 'none';
    if (profile) refs.pickFace.src = blockIcon(blockIdFor(profile));
  }
}

/* ------------------------------------------------------------------ side */

/**
 * The right-hand column: three panels, and two of them are the play ledger
 * finally having a screen on the other end (2026-09-08, Adrian: "youre supposed
 * to add the new modules like playtime or continue where you left like in the
 * mockup").
 *
 * Where you left off and Your play are always on the page — they were hidden
 * until the ledger answered, and Adrian caught it straight away: "you had it in
 * mockup but not in launcher no". A record that has never been written is the
 * normal state for anyone who has not played since the mod started keeping it,
 * so each panel says that in one plain line and fills itself in when it can.
 * Never a fake number: the rule is that nothing on screen may claim something
 * the launcher did not measure. Partner servers takes the height between them.
 */
function renderSides(layout) {
  /* Cosmetics over Where you left off in the first card column, Featured
     servers over Friends in the second — the "C" sheet Adrian picked on
     2026-09-21; since 2026-09-17 the player can put the cards where they
     like (the Layout button), and `layout` is where they were left. The
     cards keep their sizes whatever the order: Cosmetics and the server list
     are content-sized, Where you left off and Friends take their column's
     slack and show as many rows as fit it. */
  const cards = {
    servers: renderPartners,
    play: renderPlaytime,
    continue: renderContinue,
    friends: renderFriends
  };
  refs.first = el("aside", { class: "home__side home__side--first" }, layout.columns[0].map((id) => cards[id]()));
  refs.second = el("aside", { class: "home__side home__side--second" }, layout.columns[1].map((id) => cards[id]()));
  return [refs.first, refs.second];
}

/**
 * Where you left off is a list since 2026-09-21 (Home, Six Ways — "Build
 * C"): the ledger's last RECENT_ROWS places, newest first, each a row with
 * its logo, its name and "19h 45m · just now". The ledger has always handed
 * Home eight places (`recent()` in src/main/ledger.js); Home drew one.
 * The card takes its column's slack and shows as many rows as fit it
 * (fitRows) — the rows are never squeezed or clipped.
 */
function renderContinue() {
  refs.continueBody = el("div", { class: "side-card__body side-card__list" });
  refs.continueTitle = el("h2", { class: "side-card__title", text: "Where you left off" });
  refs.continueNote = el("span", { class: "side-card__note" });
  refs.continueCard = el("section", { class: "side-card side-card--cont", "data-block": "continue" }, [
    el("div", { class: "side-card__head" }, [
      refs.continueTitle,
      el("span", { class: "spacer" }),
      refs.continueNote
    ]),
    refs.continueBody
  ]);
  fitRows(refs.continueBody);
  paintStarter();
  return refs.continueCard;
}

/* ---------------------------------------------------------- get started */

/* The import scan's answer, asked once for the launcher's life: it reads
   every other launcher's folders, and the starter only needs to know
   whether there is anything to bring. */
let starterScan = null;

/**
 * Get started (2026-09-24), in the card's own place until the first game.
 *
 * Where you left off has nothing to list before a place has been played,
 * and a new player's Home was a card with one grey line in it. The growth
 * review's finding: the launcher never told a new player what it could do.
 * So until the ledger has a place the card is a short road instead — sign
 * in, import your setup (only when the scan found one), play, open the
 * menu in the game, add a friend (a Microsoft account only: Friends needs
 * one) — each row a press that does the thing, and the steps done wear a
 * check and go to the bottom. The first place played replaces all of it
 * with the list (fillSide), so this is never in anyone's way twice.
 *
 * Nothing here claims what was not measured: "done" is an account in the
 * list, a profile marked imported, a friend on the list. The menu row is a
 * tip, never ticked — the launcher cannot see a key pressed in the game.
 */
function paintStarter() {
  const body = refs.continueBody;
  if (!body || body._places) return;
  const account = activeAccount();
  const imported = state.profiles.some((p) => p.imported);
  const found = (starterScan?.groups || []).filter((g) => g.rows.length);
  const labels = found.map((g) => g.label.replace(/^the /i, "").replace(/ \(.*\)$/, ""));
  const names = labels.length > 2 ? `${labels.slice(0, 2).join(", ")} and more` : labels.join(" and ");

  const steps = [
    {
      id: "account", icon: icons.user, done: Boolean(account),
      name: account ? `Signed in as ${account.username}` : "Sign in",
      meta: account ? "Your account is ready" : "A Microsoft account, or just a name",
      press: account ? null : () => openAccountModal()
    },
    (found.length || imported) && {
      id: "import", icon: icons.download, done: imported,
      name: imported ? "Your setup is imported" : "Import your setup",
      meta: imported ? "Profiles, mods and settings imported" : `From ${names}`,
      press: imported ? null : () => openImporter({ answer: starterScan, onDone: (adopted) => {
        if (adopted?.[0]) setActiveProfile(adopted[0].id);
        paintStarter();
      } })
    },
    {
      id: "play", icon: icons.play, done: false,
      name: "Play your first game",
      meta: "Your servers and worlds show up here after",
      press: () => launchActive()
    },
    {
      id: "menu", icon: icons.bolt, done: false, tip: true,
      name: "Press Right Shift in the game",
      meta: "Minimap, zoom, waypoints and more"
    },
    account?.type === "microsoft" && {
      id: "friend", icon: icons.userPlus, done: Boolean(lastFriends?.friends?.length),
      name: lastFriends?.friends?.length ? "You have friends here" : "Add a friend",
      meta: lastFriends?.friends?.length ? "See where they are on the right" : "Join their server from Home in one press",
      press: lastFriends?.friends?.length ? null : () => openAddFriendModal({ onChanged: () => { syncFriends(); paintStarter(); } })
    }
  ].filter(Boolean);

  /* Still to do first, in the order above; done at the foot, so the rows the
     card has room for are the ones worth pressing. */
  const ordered = [...steps.filter((x) => !x.done), ...steps.filter((x) => x.done)];
  const todo = steps.filter((x) => !x.tip);
  refs.continueTitle.textContent = "Get started";
  refs.continueNote.textContent = `${todo.filter((x) => x.done).length} of ${todo.length} done`;
  body.replaceChildren(...ordered.map(starterRow));
  body._fit?.();

  if (!starterScan) {
    starterScan = { groups: [] };
    Promise.resolve(host.game?.importScan?.()).then((answer) => {
      if (answer?.ok) starterScan = answer;
      if (refs.continueBody?.isConnected) paintStarter();
    }).catch(() => {});
  }
}

function starterRow(step) {
  const inner = [
    el("span", { class: `cont-row__icon${step.done ? " is-done" : ""}`, html: step.done ? icons.check : step.icon }),
    el("span", { class: "stack truncate" }, [
      el("span", { class: "truncate cont-row__name", text: step.name }),
      el("span", { class: "truncate cont-row__meta", text: step.meta })
    ])
  ];
  const cls = `cont-row starter-row${step.done ? " is-done" : ""}${step.tip ? " is-tip" : ""}`;
  if (!step.press) return el("div", { class: cls }, inner);
  return el("button", { class: `${cls} cont-row--press`, onClick: step.press }, [
    ...inner,
    el("span", { class: "cont-row__glyph", html: icons.chevronRight, "aria-hidden": "true" })
  ]);
}

/** How many places Where you left off lists at most. */
const RECENT_ROWS = 4;

/**
 * Friends (2026-09-21, "Build C"): who is a friend, who is online and
 * where — the game's own Friends list, read by the launcher (src/main/
 * friends.js signs in the way the game does). A friend on a server is a row
 * you can press: the game starts on the active profile and joins them
 * there, the same press a featured row is. A friend in a world, in the menu
 * or offline is a row that says so and nothing more — joining a world goes
 * through the game's own Friends screen, where the door is knocked on.
 * Answering and messaging stay in the game; adding is the button in the
 * head (the same evening, Adrian: "make a 'add friends' button for the
 * friends card" — ui/addfriend.js, the game's own Add friend), which is
 * put away for an account Friends cannot sign in — a door to a dialog that
 * could only say no.
 *
 * The card never claims what it has not read: before the first answer the
 * head says "Checking…"; an offline account is told, in the game's own
 * words, that Friends wants a Microsoft account; a site that cannot be
 * reached says so once and keeps whatever rows it had.
 */
function renderFriends() {
  refs.friendsNote = el("span", { class: "side-card__note", text: "Checking…" });
  refs.friendsBody = el("div", { class: "side-card__body side-card__list" });
  refs.friendsAdd = el("button", {
    class: "btn btn--sm btn--add side-card__add",
    title: "Ask someone to be friends, by their Minecraft name",
    onClick: () => openAddFriendModal({ onChanged: () => syncFriends() })
  }, [
    el("span", { html: icons.userPlus, style: { display: "contents" } }),
    el("span", { text: "Add friends" })
  ]);
  refs.friendsCard = el("section", { class: "side-card side-card--friends", "data-block": "friends" }, [
    el("div", { class: "side-card__head" }, [
      el("h2", { class: "side-card__title", text: "Friends" }),
      el("span", { class: "spacer" }),
      refs.friendsNote,
      refs.friendsAdd
    ]),
    refs.friendsBody
  ]);
  fitRows(refs.friendsBody);
  return refs.friendsCard;
}

/**
 * A list shows as many rows as its card has room for, whole rows only.
 * The two list cards take their column's slack, and the slack depends on
 * where the player put the cards (Layout): a column of three leaves a list
 * one row, a column of two leaves it four. Rows are `flex: 1 1 0` with a
 * floor, so they share whatever height there is; past the floor a row would
 * overflow, so the ones that do not fit are hidden — never squeezed, never
 * cut in half. Measured by a ResizeObserver, so a layout change while
 * arranging is followed.
 */
function fitRows(list) {
  const fit = () => {
    const rows = [...list.children].filter((n) => n.classList.contains("cont-row"));
    /* Not before the card is laid out (2026-09-24): Get started paints while
       Home is still being built, and a list with no height fitted one row
       and hid the rest. */
    if (!rows.length || !list.isConnected || !list.clientHeight) return;
    const style = getComputedStyle(list);
    const gap = parseFloat(style.rowGap) || 0;
    const floor = parseFloat(getComputedStyle(rows[0]).minHeight) || 52;
    const room = Math.max(1, Math.floor((list.clientHeight + gap) / (floor + gap)));
    rows.forEach((row, i) => { row.hidden = i >= room; });
  };
  /* A frame later, not inside the observer's own callback: hiding a row
     changes the list's size, and a change made inside the callback is the
     "loop completed with undelivered notifications" warning. */
  // observeSize, not a bare ResizeObserver: Home is rebuilt on every visit
  // and two of these were made each time, each pinning the card it watched
  // (2026-09-22).
  observeSize(list, () => requestAnimationFrame(fit));
  list._fit = fit;
}

/**
 * Cosmetics — the next cape and the road to it, and the way into the page.
 * (The card was Your play from 2026-09-10 until Adrian renamed it on
 * 2026-09-17, evening; the refs and the block keep the old names.)
 *
 * The card is one control: pressing it anywhere opens the Cosmetics page
 * (route 'stats', 2026-09-10). It stays a `section` rather than becoming a
 * `button` because it carries a heading and a road, and a
 * heading inside a button is not something a screen reader can make sense of;
 * the role, the tabindex and the Enter/Space handler give it everything a
 * button would have given it, and `.side-card--link` gives it the hover.
 */
function renderPlaytime() {
  refs.playtimeBody = el("div", { class: "side-card__body" }, [firstPlay()]);
  refs.playtimeNote = el("span", { class: "side-card__note" });
  refs.playtimeCard = el("section", {
    class: "side-card side-card--play side-card--link",
    "data-block": "play",
    role: "button",
    tabindex: "0",
    "aria-label": "Cosmetics: your level and the road to the next cape. Opens the Cosmetics page.",
    title: "Open Cosmetics",
    onClick: () => setRoute("stats"),
    onKeyDown: (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();      // or Space scrolls the page under the card
      setRoute("stats");
    }
  }, [
    el("div", { class: "side-card__head" }, [
      el("h2", { class: "side-card__title", text: "Cosmetics" }),
      el("span", { class: "spacer" }),
      refs.playtimeNote
    ]),
    refs.playtimeBody
  ]);
  return refs.playtimeCard;
}

/**
 * The card before any hour exists (2026-09-14).
 *
 * It was one grey sentence in a 180px card — "Play once … and your hours land
 * here" — which told a new player nothing about what the card would become.
 * The record is the thing that brings anyone back, so its first state is the
 * ladder itself, read before it is climbed: Level 1 over the empty bar to
 * Level 2, "your first game starts the record", and the first cape as the goal
 * in sight — the Signature cape at level 3, which is an hour of play on the
 * ladder in src/main/ledger.js (level L at (L−1)²/4 hours). Nothing here is a
 * number the launcher made up: the levels and the cape are the same ones the
 * record hands out, and fillDays replaces all of this the moment a day of play
 * exists. Every word is spelt the way Stats spells it.
 *
 * Three things and not four (2026-09-17). The card also carried the old grey
 * sentence — "Play once with BlueClient in the game and your hours land here,
 * day by day." — under the bar, and on a fresh install the cape row stood
 * over the foot of the card and on top of Where you left off (Adrian: "when
 * youre new to the launcher, the 'your play' bar is a bit glitched … with the
 * signature cape thing"). The column is a fixed height (--home-h), the
 * partner card holds three rows, Where you left off has its floor, and what
 * is left for this card is 183px — a body of 120 — whatever the window,
 * since Home scales and never reflows. The week chart fits that because its
 * bars give; this card had nothing that gave and needed 162. The sentence
 * was two lines of it and said what the figure's own line already says, so
 * it is gone and the card measures 114. Nothing else may be added here
 * without taking something away.
 */
function firstPlay() {
  const first = CAPES[0];
  const cape = el("span", { class: "play-first__cape" }, [capeFace(first, null, 3)]);
  return el("div", { class: "play-first" }, [
    el("div", { class: "play-figure" }, [
      el("span", { class: "play-figure__num", text: "Level 1" }),
      el("span", { class: "play-figure__sub", text: "your first game starts the record" })
    ]),
    el("span", { class: "play-first__track", role: "img", "aria-label": "Nothing played yet" }, [
      el("span", { class: "play-level__fill", style: { width: "0%" } })
    ]),
    el("div", { class: "play-first__goal" }, [
      cape,
      el("div", { class: "play-first__words" }, [
        el("span", { class: "play-first__name", text: `${first.name} cape` }),
        el("span", { class: "play-first__line", text: `Level ${first.level} · about an hour of play` })
      ])
    ])
  ]);
}

/* spell() — "12h 40m", "48m", "under a minute", the launcher's only duration
   format — lived here until 2026-09-12 and is in ../play.js now, beside the
   other words the play record is said in; both pages read it from there. */
export { spell };

/* -------------------------------------------------------------- partners */

/**
 * Featured servers: the first rows of the admin site's list, the same list
 * the game's Find Servers screen reads (2026-09-11; partners.js says how many
 * and why). The rows are built empty — a dash where the count goes, a grey
 * dot — and filled in by refreshPartners() once the servers have answered.
 * Nothing on this slab claims a number the launcher did not measure (until
 * 2026-09-02 the counts were typed in, and one was wrong by a factor of eight).
 */
function renderPartners() {
  refs.partnerRows = new Map();
  refs.partnersNote = el('span', { class: 'partners__note', text: partnersNote() });
  refs.partnerList = el('div', { class: 'partners__list' });
  paintPartners();

  refs.partnersCard = el('aside', { class: 'partners', 'data-block': 'servers' }, [
    el('div', { class: 'partners__head' }, [
      el('h2', { class: 'partners__title', text: 'Featured servers' }),
      el('span', { class: 'spacer' }),
      refs.partnersNote
    ]),
    refs.partnerList
  ]);
  return refs.partnersCard;
}

/** The rows, from whatever list is in hand. Rebuilt only when the rows change. */
function paintPartners() {
  if (!refs.partnerList) return;
  refs.partnerRows = new Map();
  refs.partnerList.replaceChildren(...servers().map(partnerRow));
  refs.partnersDrawn = servers().map((row) => row.address).join('|');
}

/**
 * Stale-while-revalidate, from Home's side: whatever list is in hand is on
 * screen already; main is asked for a fresher one, and only a list whose rows
 * differ is drawn again — then pinged, because the addresses are new.
 */
async function refreshServers() {
  const note = refs.partnersNote;
  const got = await host.servers?.refresh?.().catch(() => null);
  if (!note?.isConnected || refs.partnersNote !== note) return;   // left Home while main asked
  if (!adopt(got) && refs.partnersDrawn === servers().map((row) => row.address).join('|')) return;
  paintPartners();
  refreshPartners();
}

/**
 * Live counts, from the servers themselves: main pings each one the way the
 * game's Multiplayer screen does. Runs when Home is shown and once a minute
 * while it stays on screen; a row whose server did not answer keeps its dash
 * and a grey dot.
 */
let partnerTimer = null;

/* The last answer from each featured server, kept for the launcher's life
   (2026-09-17, Adrian: "every time I leave home screen and come back it says
   'checking' and re fetching the numbers for the featured servers. can it
   not stay as the old numbers, until the new ones update?"). Home is
   rebuilt on every visit, and until this a fresh row started at a dash and
   the note at "Checking…" for the second the ping took. Now a row is
   painted from here first and the ping repaints it; only a server never yet
   asked shows the dash, and only a slab with no answer at all says
   Checking. A server that stops answering is an answer too (ok: false) and
   goes grey; one the ping could not ask this minute keeps its last figure. */
const lastPing = new Map();

/** What the slab's note says for the answers in hand. */
function partnersNote() {
  const rows = servers();
  let answered = 0;
  let up = 0;
  for (const row of rows) {
    const result = lastPing.get(row.address);
    if (!result) continue;
    answered += 1;
    if (result.ok) up += 1;
  }
  return !answered ? 'Checking…'
    : up === rows.length ? 'All online'
    : `${up} of ${rows.length} online`;
}

/** A row's dot and figures from one answer. */
function paintPartnerRow(row, result) {
  row.dot.classList.toggle('is-off', !result.ok);
  row.players.textContent = result.ok ? formatPlayers(result.online) : '—';
  row.capacity.textContent = result.ok && result.max ? `/${formatPlayers(result.max)}` : '';
}

async function refreshPartners() {
  if (!refs.partnerRows?.size) return;
  if (!refs.partnersNote?.isConnected) { clearInterval(partnerTimer); return; }

  const addresses = [...refs.partnerRows.keys()];
  const results = await host.servers.status(addresses).catch(() => ({}));
  if (!refs.partnersNote?.isConnected) return;

  for (const [address, row] of refs.partnerRows) {
    const result = results?.[address];
    if (!result) continue;
    lastPing.set(address, result);
    paintPartnerRow(row, result);
  }

  refs.partnersNote.textContent = partnersNote();
}

/** A row is Play with a destination: press it and the game starts on the
    active profile and goes straight to that server. */
function partnerRow(server) {
  const dot = el('span', { class: 'partner-row__dot is-off' });
  const players = el('span', { text: '—' });
  /* Capacity is its own span so a narrow slab can shed it and keep the
     live count — the number that actually answers "is it busy". */
  const capacity = el('span', { class: 'partner-row__capacity', text: '' });
  const row = { dot, players, capacity };
  refs.partnerRows.set(server.address, row);
  // The last answer, if there is one, before the ping's fresh one lands.
  if (lastPing.has(server.address)) paintPartnerRow(row, lastPing.get(server.address));

  /* A server that checks accounts with Mojang, pressed by an offline
     account, is a minute of loading and "Invalid session" at the end of it
     (2026-09-21). The row says so under the address, the tooltip says why,
     and the press says it once instead of launching. */
  const locked = needsAccount(server) && activeAccount()?.type === 'offline';
  return el('button', {
    class: `partner-row${locked ? ' is-locked' : ''}`,
    title: locked
      ? `${server.name} checks accounts with Mojang — sign in with a Microsoft account to join`
      : [server.about, 'Play and join'].filter(Boolean).join(' — '),
    onClick: () => {
      if (locked) {
        toast(`${server.name} checks accounts with Mojang — sign in with a Microsoft account to join it`, 'info', 5000);
        return;
      }
      launchActive(server.address);
    }
  }, [
    el('div', { class: 'partner-row__logo-wrap' }, [
      /* The bundled art or the initial tile first, the server's own logo
         the moment it lands (servericons.js, 2026-09-13). */
      (() => {
        const logo = el('img', { class: 'partner-row__logo', src: partnerLogo(server, 40), alt: '' });
        fillLogo(logo, server.address);
        return logo;
      })()
    ]),

    el('div', { class: 'partner-row__body' }, [
      el('div', { class: 'partner-row__title' }, [
        el('span', { class: 'partner-row__name truncate', text: server.name }),
        dot,
        /* The padlock says the row is closed to this account; the tooltip and
           the press say why (2026-09-22). Beside the dot, so the address line
           stays the address and nothing on the row is cut short. */
        locked && el('span', { class: 'partner-row__lock', html: icons.lock, 'aria-label': 'Needs a Microsoft account' }),
        /* The top row wore a "Featured" pill from 2026-09-07 (in place of a
           podium the live counts contradicted). The panel is called Featured
           servers since 2026-09-09, so the word is on every row already and
           the pill came off with the rename. */
      ]),
      el('span', { class: 'partner-row__address truncate', text: server.address })
    ]),

    el('div', { class: 'partner-row__count' }, [
      el('span', { html: icons.users, style: { display: 'contents' } }),
      el('span', { class: 'partner-row__players' }, [players, capacity])
    ]),

    /* What the row does, said only under the pointer (2026-09-14): the play
       glyph Continue already wears, fading in at the row's edge while the
       count steps aside for it. At rest the row is a server and its count;
       nothing on it says "press me" until the hand is there. */
    el('span', { class: 'partner-row__go', html: icons.play, 'aria-hidden': 'true' })
  ]);
}

/**
 * Whether Home's minute timers should stand down (2026-09-22): the same rule
 * the world and the cape clock keep — a game playing and this window not the
 * one in front. Behind a game the two of them were three TCP connections to
 * the featured servers, a favicon read off the disk apiece and a request to
 * the friends backend, every minute, for a card nobody can see; and every
 * answer repainted glass on the card the game is drawing with. They catch up
 * the moment the launcher is looked at: the listener below asks once then,
 * rather than leaving the rows a minute stale.
 */
function yielding() {
  return gameStatus() === 'playing' && !document.hasFocus();
}

window.addEventListener('focus', () => {
  // The clocks first: they stood still while the game had the window.
  if (refs.list?.isConnected) startClocks();
  if (!refs.friendsCard?.isConnected) return;   // Home is not the page on screen
  refreshPartners();
  syncFriends();
});

/**
 * The running rows' clocks, once a second while Home is on screen — and
 * stopped, not skipped, while the game has the window (2026-09-22), the
 * cape clock's rule in play.js: a row's time is a text change on glass,
 * and behind a four-hour game that was a repaint of the launcher's glass
 * every second on the card the game is drawing with, for a clock nobody
 * could see. The focus listener above starts it again, and the first tick
 * is at once, so the time is right the moment the launcher is looked at.
 */
function startClocks() {
  clearInterval(timerHandle);
  timerHandle = null;
  paintClocks();
  if (yielding()) return;
  timerHandle = setInterval(() => {
    if (yielding()) { clearInterval(timerHandle); timerHandle = null; return; }
    paintClocks();
  }, 1000);
}

/** Keeps the session clocks ticking while this page is on screen. */
export function mounted() {
  startClocks();

  clearInterval(partnerTimer);
  refreshPartners();
  partnerTimer = setInterval(() => { if (!yielding()) refreshPartners(); }, 60000);
  // And the list itself, from the site, if the copy in hand has gone stale.
  refreshServers();

  // No event fires while a game simply runs, so coming back to Home
  // mid-session has to rebuild the rows by hand.
  syncSessions();
  // Nor for a game that crashed while another page was up: its row is
  // rebuilt from what main still holds.
  syncCrashes();

  syncRecent();

  clearInterval(friendsTimer);
  syncFriends();
  friendsTimer = setInterval(() => { if (!yielding()) syncFriends(); }, 60000);

  paintUpdate();
}

/** Leaving Home: the clocks and the partner pings stop, and the corner lets
    go of main's update state. Until 2026-09-06 the clock ran on for as long
    as the launcher was open, writing into rows that were no longer there. */
export function unmounted() {
  clearTimeout(recentTimer);
  clearInterval(timerHandle);
  clearInterval(partnerTimer);
  clearInterval(friendsTimer);
  timerHandle = null;
  partnerTimer = null;
  friendsTimer = null;
  if (updateOff) updateOff();
  updateOff = null;
  // Arranging ends with the page; what was moved is already written down.
  stopArrange();
}

/**
 * "There is a newer one" — in the corner the version already sits in.
 *
 * Until 2026-09-04 an installed BlueClient had no way of knowing a release had
 * happened, so everybody stayed on whatever they first installed. Now main
 * watches for one and fetches it on its own (src/main/update.js), and this
 * corner is the whole of what the player is told about it: one line that says
 * it is coming down, then one that says it is ready and can go in now. When
 * there is nothing to say — no release, offline, or still asking — the corner
 * says exactly what it said before. Nothing appears that leads nowhere.
 *
 * It is deliberately the quietest thing on Home. An update is worth knowing
 * about; it is not worth standing between the player and Play.
 */
async function paintUpdate() {
  // Home is rebuilt every time the tab is opened, and the old subscription
  // would otherwise go on writing into a corner that is no longer on screen.
  if (updateOff) updateOff();
  updateOff = null;

  const holder = refs.version;
  if (!holder) return;

  updateOff = host.update.onState((state) => paintUpdateLine(state));
  paintUpdateLine(await host.update.check().catch(() => null));
}

/** One line, chosen by what main says the update is doing. */
function paintUpdateLine(update) {
  const holder = refs.version;
  if (!holder || !holder.isConnected) return;

  if (!refs.updateSlot) {
    refs.updateSlot = el('span', { class: 'home__update-slot' });
    holder.append(refs.updateSlot);
  }

  // Nothing is rebuilt for a line that already says this (2026-09-22). Main
  // only publishes a changed state now, but a re-shown Home and a repeated
  // phase both land here, and every rebuild re-fires the version line's
  // ResizeObserver and makes placeNews read layout after writing it.
  const key = update ? `${update.phase}|${update.percent}|${update.version}|${update.url || ''}` : 'none';
  if (refs.updateSlot._key === key) return;
  refs.updateSlot._key = key;

  const line = updateLine(update);
  refs.updateSlot.replaceChildren(
    ...(line ? [el('span', { class: 'home__version-sep', text: '·' }), line] : [])
  );
}

function updateLine(update) {
  const phase = update?.phase;

  // Coming down. Not a button: there is nothing useful to press yet, and a
  // percentage that looked pressable would only invite a click that stops
  // nothing.
  if (phase === 'downloading') {
    return el('span', {
      class: 'home__update home__update--note',
      text: `Updating… ${update.percent || 0}%`
    });
  }

  // On disk and checked. It goes in by itself the next time the launcher is
  // closed; this is the player who would rather have it now.
  if (phase === 'ready') {
    return el('button', {
      class: 'home__update',
      text: 'Restart to update',
      onClick: async () => {
        const result = await host.update.install().catch(() => null);
        if (!result?.ok) toast("Couldn't restart to update. It installs by itself the next time you close BlueClient.", 'error', 7000);
      }
    });
  }

  // There is one, but this copy cannot fetch it — GitHub unreachable, or a
  // build with no updater in it. The old road: send them to the download.
  if (phase === 'available' && update.url) {
    return el('button', {
      class: 'home__update',
      text: `Update to ${update.version}`,
      onClick: () => host.shell.openExternal(update.url)
    });
  }

  return null;
}

/* --------------------------------------------------------------- player */

/** The nameplate over the head and the model — nothing at the feet (the flat
    ground bar was dropped 2026-09-02; the buttons stand there instead).

    Skins sits in the top right of the block the player stands in (Adrian,
    2026-09-04): the same corner every page here puts its primary action in,
    and level with the nameplate so the two read as one row over his head. */
function renderPlayer(account) {
  return el('div', { class: 'player' }, [
    el('div', { class: 'nameplate' }, [
      el('span', { class: 'nameplate__name truncate', text: account?.username || 'Not signed in' }),
      /* The green dot is what friends see — and only a Microsoft account has
         friends to see it (2026-09-24): on an offline name it claimed a
         presence nobody could see. */
      account?.type === 'microsoft' && el('span', { class: 'nameplate__dot', 'aria-label': 'Online' })
    ]),
    characterFor(account)
  ]);
}

/**
 * Skins, in the top right of the block the player stands in.
 *
 * A sibling of the player rather than a child of him, and for a reason worth
 * keeping: the column centres its children, so the player box is only as wide
 * as the model on its stage — and it clips, because the model's legs are meant
 * to run under Play. A button hung off that box's right edge was therefore
 * placed against 360px instead of the column's 516 and then cut off entirely.
 */
function renderSkinsButton() {
  return el('button', {
    class: 'btn btn--sm skins-open',
    'aria-label': 'Skins',
    title: 'Skins',
    onClick: () => openSkinsModal({ onWorn: (skin) => refs.stage?.setSkin(skin) })
  }, [
    el('span', { html: icons.shirt, style: { display: 'contents' } }),
    el('span', { text: 'Skins' })
  ]);
}

/**
 * Layout, in the top left of the same block — Skins' twin on the other
 * corner (2026-09-17 morning, Adrian, off the round-two mockups: "add a
 * 'layout' button there instead … same as the skins button but on the left
 * side"). It toasted "on its way" for a few hours; since the same afternoon
 * it is the door to arranging Home ("make the layout button … work … the 4
 * elements should be divided into blocks"): a press puts the page into the
 * arrange mode in pages/layout.js, the capsule reads Done while it is on,
 * and Reset stands beside it for the layout a fresh install has. Nothing
 * else on the launcher has a Layout — the button is Home's, and only
 * Home's, because the four blocks are the only things the player can move.
 */
function renderLayoutTools() {
  refs.layoutBtn = el('button', {
    class: 'btn btn--sm layout-open',
    'aria-label': 'Layout',
    title: 'Arrange the home screen',
    onClick: () => (arranger ? stopArrange() : startArrange())
  });
  refs.layoutReset = el('button', {
    class: 'btn btn--sm layout-reset',
    hidden: true,
    title: 'Put the blocks back where they started',
    onClick: () => arranger?.reset()
  }, [
    el('span', { html: icons.refresh, style: { display: 'contents' } }),
    el('span', { text: 'Reset' })
  ]);
  paintLayoutTools();
  return el('div', { class: 'layout-tools' }, [refs.layoutBtn, refs.layoutReset]);
}

/** The Layout capsule as Layout or as Done, and Reset shown only while arranging. */
function paintLayoutTools() {
  if (!refs.layoutBtn) return;
  const on = Boolean(arranger);
  refs.layoutBtn.classList.toggle('is-on', on);
  refs.layoutBtn.setAttribute('aria-label', on ? 'Done arranging' : 'Layout');
  refs.layoutBtn.setAttribute('aria-pressed', String(on));
  refs.layoutBtn.replaceChildren(
    el('span', { html: on ? icons.check : icons.layout, style: { display: 'contents' } }),
    el('span', { text: on ? 'Done' : 'Layout' })
  );
  refs.layoutReset.hidden = !on;
  refs.layoutReset.disabled = on && isDefaultLayout(arranger.layout());
}

function startArrange() {
  if (arranger || !refs.home) return;
  arranger = arrange({
    home: refs.home,
    columns: { first: refs.first, second: refs.second },
    blocks: {
      skin: refs.centre,
      servers: refs.partnersCard,
      play: refs.playtimeCard,
      continue: refs.continueCard,
      friends: refs.friendsCard
    },
    layout: readLayout(state.settings),
    /* Written the moment it changes, quietly — a 'settings' notification
       would rebuild Home under the hand (state.js, updateSettings). */
    onChange: (layout) => {
      updateSettings({ launcher: { layout } }, { silent: true }).catch(() => {});
      paintLayoutTools();
    },
    onExit: () => { arranger = null; paintLayoutTools(); }
  });
  paintLayoutTools();
}

function stopArrange() {
  if (!arranger) return;
  arranger.stop();
  arranger = null;
  paintLayoutTools();
}

/**
 * The model, with the account's own Mojang skin loaded into it once it
 * arrives. Renders immediately on the bundled texture so there is no gap.
 *
 * Kept in refs so a skin worn from the Skins panel can go straight onto it:
 * Mojang holds a name's profile for about a minute, and waiting for that
 * would leave the old skin standing there after the player changed it.
 */
function characterFor(account) {
  // The whole model stays on stage: nothing below it crops the feet any more.
  const stage = createCharacter({ overflow: 1 });
  refs.stage = stage;
  getSkin(account?.username || '').then((skin) => {
    if (skin?.ok) stage.setSkin(skin);
  });
  return stage;
}

/* --------------------------------------------------------- launch stack */

/**
 * The running rows, then Play, then the profile row: the wide button opens
 * Profiles, the caret beside it swaps the profile in place without leaving
 * Home.
 */
function renderLaunchStack(account, profile) {
  const pickFace = el('img', {
    class: 'profile-pick__face',
    src: profile ? blockIcon(blockIdFor(profile)) : '',
    alt: '',
    style: { display: profile ? '' : 'none' }
  });
  const pickName = el('span', { class: 'profile-pick__name truncate', text: profile ? profile.name : 'Choose a profile' });
  const pick = el('button', {
    class: 'profile-pick',
    'aria-label': profile ? `Profile: ${profile.name}. Open profiles` : 'Choose a profile',
    onClick: () => setRoute('profiles')
  }, [pickFace, pickName]);
  Object.assign(refs, { pickFace, pickName });

  const caret = el('button', {
    class: 'profile-pick__caret',
    'aria-label': 'Switch profile',
    'aria-haspopup': 'menu',
    'data-tip': 'Switch profile',
    html: icons.chevronDown,
    onClick: (event) => openProfileMenu(event.currentTarget)
  });

  const list = el('div', { class: 'sessions', role: 'list', 'aria-label': 'Running games' });
  refs.list = list;
  refs.rows = new Map();
  /* Rows of games that crashed, kept apart from the running ones: a crashed
     row is not in state.sessions (main dropped it), so syncSessions must not
     prune it, and it is the player who takes it down (2026-09-11). */
  refs.crashRows = new Map();
  stackFresh = true;

  const stack = el('div', { class: 'launch-stack' }, [
    list,
    renderLaunchRow(account),
    el('div', { class: 'launch-stack__row' }, [pick, caret])
  ]);

  syncSessions();
  return stack;
}

/**
 * Play. While a game runs it says "Launch another" (2026-09-19; "Play
 * another" from 2026-09-18, changed at Adrian's word), because pressing it
 * starts a second one and a plain "Play" beside a running row read as if the
 * first press had not taken. Crashed rows are not running games, so they do
 * not turn the word.
 */
function launchLabel() {
  if (!activeAccount()) return 'Sign in';
  return state.sessions.length ? 'Launch another' : 'Play';
}

function renderLaunchRow(account) {
  const glyph = el('span', { class: 'launch__icon', html: icons.play });
  const label = el('span', { class: 'launch__text', text: launchLabel() });

  const launch = el('button', {
    class: 'launch',
    onClick: onLaunchClick
  }, [el('span', { class: 'launch__content' }, [glyph, label])]);

  Object.assign(refs, { launch, glyph, label });

  return el('div', { class: 'launch-row' }, [launch]);
}

/* -------------------------------------------------------- running rows */

/**
 * One row per game, oldest at the top so the one just started appears where
 * the eye already is — directly above the button that started it.
 *
 * Rows are built once and then painted in place: progress arrives ten times a
 * second and the clocks tick every second, which is no reason to rebuild a
 * list somebody may be reaching for.
 */
export function syncSessions() {
  if (!refs.list) return;

  const live = new Set();
  for (const session of state.sessions) {
    live.add(session.id);
    let row = refs.rows.get(session.id);
    if (!row) {
      row = buildRow(session);
      refs.rows.set(session.id, row);
      refs.list.append(row.node);
      if (!stackFresh) playLaunchMoment(row, session);
    }
    paintRow(row, session);
  }

  let ended = false;
  for (const [id, row] of refs.rows) {
    if (live.has(id)) continue;
    row.node.remove();
    refs.rows.delete(id);
    ended = true;
  }

  /* A game just ended: the mod wrote the sitting on its way out, so the
     week, the level and the news are re-read (2026-09-12, evening) — this is
     the moment a level reached or a record beaten is said. A moment after
     the process is gone, because the file is written before the exit and
     the read should not race the last flush. */
  if (ended) {
    clearTimeout(recentTimer);
    recentTimer = setTimeout(syncRecent, 1500);
  }

  refs.list.style.display = state.sessions.length || refs.crashRows?.size ? '' : 'none';
  stackFresh = false;
  syncLaunchButton();
  paintClocks();
}

/* ---------------------------------------------------------- crashed rows */

/**
 * A game died (2026-09-11). Its row stays, and says why.
 *
 * Called from app.js the moment main announces the crash, before the session
 * is dropped from the list — so the running row is turned into the crashed
 * one in place, where the player was already looking, rather than vanishing
 * and coming back. Off Home there is no row to turn; mounted() rebuilds it
 * from what main still holds (syncCrashes). The record is crashes.js's
 * summary: the headline, the line under it, the kind, the suspect — and
 * whether there is a log or a report to open. No path ever reaches here.
 */
export function noteCrash(id, record) {
  if (!refs.list || !record) return;
  let row = refs.rows.get(id);
  if (row) {
    refs.rows.delete(id);
  } else {
    row = buildRow({ id, profileId: record.profileId, name: record.name });
    refs.list.append(row.node);
  }
  refs.crashRows.set(id, row);
  paintCrash(row, record);
  refs.list.style.display = '';
}

/** The crashes main still holds, drawn if they are not on screen already. */
async function syncCrashes() {
  const list = refs.list;
  if (!list) return;
  const records = await host.game.crashes?.().catch(() => null);
  if (!records || refs.list !== list) return;   // left Home while main answered
  const keep = new Set(records.map((record) => record.id));
  for (const [id, row] of refs.crashRows) {
    if (keep.has(id)) continue;
    row.node.remove();                            // closed from elsewhere
    refs.crashRows.delete(id);
  }
  for (const record of records) {
    if (refs.crashRows.has(record.id) || refs.rows.has(record.id)) continue;
    noteCrash(record.id, record);
  }
  list.style.display = state.sessions.length || refs.crashRows.size ? '' : 'none';
}

/**
 * The row, crashed: the same first line — face, name, who it ran as, the
 * clock stopped where the game died — and under it the reason and the
 * actions that follow from it. Everything is a tint on the row's own glass.
 *
 * Retry is the one main action (cyan). Remove is red, because it takes a mod
 * off the profile — and it is only offered for a mod the player added; one
 * that came with BlueClient is named and left alone. More memory and Java
 * settings only go somewhere (grey), Open log too.
 */
function paintCrash(row, record) {
  row.crashed = record;
  row.node.dataset.state = 'crashed';
  row.name.textContent = record.name || row.name.textContent;
  // Usually already there (paintRow sets it once the row leaves 'working') —
  // but several kinds (missing files, a Java too old, a heap this PC would
  // not give) crash before that, while the row still carried an install
  // stage, so the record's own username is what makes "who it ran as" true
  // even then, and after a reload when there is no live row to read it from.
  row.meta.textContent = record.username || row.meta.textContent || '';
  row.time.textContent = record.ranMs ? clock(record.ranMs) : '';
  row.fill.style.display = 'none';

  row.stop.setAttribute('aria-label', `Close ${record.name}`);
  row.stop.setAttribute('data-tip', 'Close');

  const detail = el('span', { class: 'session__detail truncate', text: record.detail || '', title: record.detail || '' });
  const actions = el('div', { class: 'session__actions' }, crashActions(record, row, detail));

  const block = el('div', { class: 'session__crash' }, [
    el('div', { class: 'session__reason' }, [
      el('span', { class: 'session__dot', 'aria-hidden': 'true' }),
      el('span', { class: 'session__headline truncate', text: record.headline, title: record.headline })
    ]),
    detail,
    actions
  ]);

  row.crash?.remove();
  row.crash = block;
  row.node.append(block);
}

function crashActions(record, row, detail) {
  const profile = state.profiles.find((p) => p.id === record.profileId);
  const button = (label, icon, onClick, tier = '') => el('button', {
    class: `btn btn--sm${tier ? ` ${tier}` : ''}`,
    onClick
  }, [
    icon ? el('span', { html: icon, style: { display: 'contents' } }) : null,
    el('span', { text: label })
  ]);

  const out = [];

  // The same profile again, with the same destination. A profile deleted
  // since the crash has nothing to retry — no button that leads nowhere.
  // After "Java's files were incomplete" (2026-09-19) the launch is told to
  // hash every file of the runtime rather than only size them — the row's
  // own line promises "Retry repairs Java", and a file of the right length
  // with the wrong bytes is the one thing the every-launch sweep cannot see.
  if (profile) {
    out.push(button('Retry', icons.refresh, async () => {
      if (!(await launchChecks(profile, record.join))) return;
      dismissCrash(record.id);
      startGame(profile, record.join, record.kind === 'runtime' ? { repairJava: true } : {});
    }, 'btn--primary'));
  }

  // A crash inside a mod, or (2026-09-21) a freeze the companion's stall
  // note put inside one: the same Remove for the same reason.
  const suspect = record.suspect;
  if ((record.kind === 'mod' || record.kind === 'hang') && suspect && !suspect.bundled) {
    if (suspect.modId && profile && (profile.mods || []).some((mod) => mod.id === suspect.modId)) {
      const remove = button(`Remove ${suspect.name}`, icons.trash, async () => {
        remove.disabled = true;
        await removeMod(profile.id, suspect.modId);
        remove.remove();
        detail.textContent = `${suspect.name} was removed from ${profile.name}. Retry starts without it.`;
        detail.title = detail.textContent;
        toast(`${suspect.name} removed from ${profile.name}`, 'success');
      }, 'btn--danger');
      out.push(remove);
    } else if (!suspect.modId) {
      // A jar the player dropped into the folder by hand: the launcher's
      // list knows nothing about it, so the folder is the way to it.
      out.push(button('Mods folder', icons.folderOpen, () => host.game.crashOpen?.(record.id, 'mods')));
    }
  }

  if (record.kind === 'memory') {
    out.push(button('More memory', icons.memory, () => { openSection('game'); setRoute('settings'); }));
  }
  // A heap this PC could not give — or one it gave and then froze under,
  // when Windows closed a game that had stopped responding (2026-09-20).
  if (record.kind === 'heap' || record.memoryHigh) {
    out.push(button('Less memory', icons.memory, () => { openSection('game'); setRoute('settings'); }));
  }
  // A Java the player pointed Settings at is theirs: too old, or (2026-09-19)
  // missing files the launcher must not fetch into someone else's folder.
  if ((record.kind === 'javaVersion' || record.kind === 'runtime') && record.customJava) {
    out.push(button('Java settings', icons.coffee, () => { openSection('game'); setRoute('settings'); }));
  }

  // A fault inside a graphics driver (2026-09-20): the vendor's download
  // page, since a current driver is what ends most of these. The row's own
  // line says which driver is installed and how old it is.
  if (record.driver && record.driver.page) {
    out.push(button('Update driver', icons.download, () => host.shell.openExternal(record.driver.page)));
  }

  if (record.hasLog) {
    out.push(button('Open log', icons.terminal, () => host.game.crashOpen?.(record.id, 'log')));
  } else if (record.hasReport) {
    out.push(button('Open report', icons.terminal, () => host.game.crashOpen?.(record.id, 'report')));
  }

  return out;
}

/** The player closed the row: main forgets the crash and the row goes. */
function dismissCrash(id) {
  const row = refs.crashRows?.get(id);
  if (row) {
    row.node.remove();
    refs.crashRows.delete(id);
  }
  host.game.crashDismiss?.(id).catch?.(() => {});
  if (refs.list) refs.list.style.display = state.sessions.length || refs.crashRows?.size ? '' : 'none';
}

function buildRow(session) {
  const profile = state.profiles.find((p) => p.id === session.profileId);

  const fill = el('span', { class: 'session__fill' });
  const face = el('img', {
    class: 'session__face',
    src: blockIcon(blockIdFor(profile || { icon: 'grass' })),
    alt: ''
  });
  const name = el('span', { class: 'session__name truncate', text: session.name });
  const meta = el('span', { class: 'session__meta truncate' });
  const time = el('span', { class: 'session__time' });

  const row = { crashed: null };
  const stop = el('button', {
    class: 'session__stop',
    html: icons.close,
    // Cancel or close while it runs; once it has crashed, take the row down.
    onClick: () => (row.crashed ? dismissCrash(session.id) : host.game.stop(session.id))
  });

  const node = el('div', {
    class: 'session',
    role: 'listitem',
    dataset: { id: session.id }
  }, [fill, face, name, meta, time, stop]);

  return Object.assign(row, { node, fill, name, meta, time, stop });
}

/**
 * The same four slots either way: while it installs they carry the stage and
 * the percent over the sweep, and once it is up, the account and the clock.
 */
function paintRow(row, session) {
  const working = session.status !== 'playing';

  /* The game window just opened. Only ever on the change itself — arriving at
     Home to find something already running is not a moment. */
  if (row.painted && row.working && !working) flashLive(row);
  row.painted = true;
  row.working = working;

  row.node.dataset.state = session.status;
  row.name.textContent = session.name;

  row.meta.textContent = working ? (session.label || 'Preparing') : (session.username || '');
  row.time.textContent = working ? `${Math.round(session.percent || 0)}%` : '00:00';
  row.fill.style.transform = `translateX(${working ? (session.percent || 0) - 100 : 0}%)`;
  row.fill.style.display = working ? '' : 'none';

  row.stop.setAttribute('aria-label', working
    ? `Cancel launching ${session.name}`
    : `Close ${session.name}`);
  row.stop.setAttribute('data-tip', working ? 'Cancel' : 'Close');
}

/* ------------------------------------------------------- launch moment */

/**
 * Pressing Play, given a moment of its own (2026-09-02).
 *
 * Three beats, all of them finished inside half a second: the button takes
 * the hit, the row is driven out of its top edge, and the seam between them
 * throws off a handful of the profile block's own pixels. It is button-sized
 * on purpose. A launcher is opened ten times a day, so a full-screen takeover
 * is a delight three times and a toll thereafter — and now that several games
 * can start at once, a takeover has nothing coherent to say when Play is
 * pressed twice. None of it delays anything: the install is already running
 * by the time the first frame draws.
 *
 * The louder beat is deliberately somewhere else — see flashLive.
 */
function playLaunchMoment(row, session) {
  const profile = state.profiles.find((p) => p.id === session.profileId);

  row.node.classList.add('is-entering');
  onceAnimation(row.node, 'session-enter', () => row.node.classList.remove('is-entering'));

  if (refs.launch) {
    /* Restarting the keyframe by hand, so a second press while the first is
       still playing kicks the button again instead of doing nothing. */
    refs.launch.classList.remove('is-struck');
    void refs.launch.offsetWidth;
    refs.launch.classList.add('is-struck');
    onceAnimation(refs.launch, 'launch-struck', () => refs.launch.classList.remove('is-struck'));
  }

  /* The full-window sequence (2026-09-09) — the rocket, the blocks in every
     colour, two and a half seconds. It replaced the fourteen pixels off the
     button's seam; see ui/burst.js for what Adrian asked for. */
  launchMoment({ name: profile?.name || '' });
}

/**
 * The payoff, and the reason the press stays small.
 *
 * The press is a certainty; the game actually opening, ten to thirty seconds
 * later, is not — so that is where the louder beat belongs. The accent wipes
 * once across the row and clears off the right, and the row settles into its
 * clock.
 */
function flashLive(row) {
  row.node.classList.remove('is-live');
  void row.node.offsetWidth;
  row.node.classList.add('is-live');
  onceAnimation(row.node, 'session-live', () => row.node.classList.remove('is-live'));
}

/** Runs `done` when one named keyframe finishes, ignoring any other. */
function onceAnimation(node, name, done) {
  const handler = (event) => {
    if (event.animationName !== name) return;
    node.removeEventListener('animationend', handler);
    done();
  };
  node.addEventListener('animationend', handler);
}



/**
 * The line under the stack. It said "Last played <profile name>" until
 * 2026-09-07 — true, and no use to anybody: the profile is already named on
 * the row directly above it, so the line restated the screen back at itself.
 *
 * What a player actually wants back is the *place*. The companion mod has
 * recorded every server and world played since it shipped and nothing read it
 * (see src/main/ledger.js); this is the screen on the other end. Most sessions
 * are a return to the same server, and that was three clicks.
 *
 * Drawn in two passes on purpose. render() is synchronous and the ledger is a
 * file read, so the profile line goes up first and is replaced in place when
 * the record arrives — Home never waits on disk, and an install with no mod
 * yet, or nobody who has played, simply keeps the line it always had.
 */
function fillSide(places) {
  if (!places.length || !refs.continueBody) return;

  /* ---- Where you left off ------------------------------------------------
     A server is a button from the first paint: the game takes
     --quickPlayMultiplayer. A world became one on 2026-09-24 — Worlds has
     opened a save with --quickPlaySingleplayer since 2026-09-11, and the
     ledger names the world but not the profile it lives in, so the row is
     drawn quiet and made a press once the world list has answered with
     exactly where that world is (pressWorlds). One that cannot be found stays
     a row that says so and nothing more: a control that says Continue and
     then does not is exactly what the rule at the top of CLAUDE.md forbids.
     The newest place keeps its Continue button; a place further down is the
     row itself, pressable like a featured row, with the play glyph under the
     pointer. */
  const worldRows = [];
  const rows = places.slice(0, RECENT_ROWS).map((place, index) => {
    const facts = [spell(place.playedMs), when(place.lastSeen)]
      .filter(Boolean).join(" · ");
    const name = clean(place.name);

    /* A server's row wears the server's own logo once it lands; the glyph
       holds the box until then (servericons.js, 2026-09-13). */
    const icon = el("span", { class: "cont-row__icon", html: place.kind === "server" ? icons.server : icons.cube });
    if (place.kind === "server") logoInto(icon, place.name, "cont-row__logo");

    const body = [
      icon,
      el("span", { class: "stack truncate" }, [
        el("span", { class: "truncate cont-row__name", text: name }),
        el("span", { class: "truncate cont-row__meta", text: facts })
      ])
    ];

    if (place.kind !== "server") {
      const row = el("div", { class: "cont-row" }, body);
      worldRows.push({ row, body, name, index });
      return row;
    }
    if (index === 0) {
      return el("div", { class: "cont-row" }, [
        ...body,
        el("button", {
          class: "btn btn--confirm cont-row__go",
          title: `Start the game and join ${place.name}`,
          onClick: () => launchActive(place.name)
        }, [
          el("span", { html: icons.play, style: { display: "contents" } }),
          el("span", { text: "Continue" })
        ])
      ]);
    }
    return el("button", {
      class: "cont-row cont-row--press",
      title: `Start the game and join ${place.name}`,
      onClick: () => launchActive(place.name)
    }, [
      ...body,
      el("span", { class: "cont-row__glyph", html: icons.play, "aria-hidden": "true" })
    ]);
  });

  refs.continueBody._places = true;
  refs.continueTitle.textContent = "Where you left off";
  refs.continueNote.textContent = "";
  refs.continueBody.replaceChildren(...rows);
  refs.continueBody._fit?.();
  if (worldRows.length) pressWorlds(worldRows);
}

/**
 * The world rows made presses, once the world list says where each one is
 * (2026-09-24). The ledger keys a world by its name; the list has every save
 * of every profile, so a name is matched to the save of that name in a
 * profile that still exists, the most recently played if two share it.
 */
async function pressWorlds(worldRows) {
  const body = refs.continueBody;
  let list = null;
  try { list = await host.worlds?.list?.(); } catch { list = null; }
  if (!list?.ok || refs.continueBody !== body || !body.isConnected) return;
  const owned = (list.worlds || []).filter((w) => state.profiles.some((p) => p.id === w.profileId));
  for (const { row, body: inner, name, index } of worldRows) {
    const world = owned
      .filter((w) => clean(w.name) === name)
      .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0];
    if (!world || !row.isConnected) continue;
    const title = `Start the game and open ${name}`;
    const press = () => launchWorld(world, name);
    row.replaceWith(index === 0
      ? el("div", { class: "cont-row" }, [
          ...inner,
          el("button", { class: "btn btn--confirm cont-row__go", title, onClick: press }, [
            el("span", { html: icons.play, style: { display: "contents" } }),
            el("span", { text: "Continue" })
          ])
        ])
      : el("button", { class: "cont-row cont-row--press", title, onClick: press }, [
          ...inner,
          el("span", { class: "cont-row__glyph", html: icons.play, "aria-hidden": "true" })
        ]));
  }
  body._fit?.();
}

/** A world's name as the game shows it, without the § colour codes a server's world can carry. */
const clean = (text) => String(text || "").replace(/\u00a7./g, "");

/* ------------------------------------------------------------- friends */

let friendsTimer = null;
/* The last list, for the launcher's life — a rebuilt card paints from it
   before the site is asked, the way the featured rows paint from lastPing. */
let lastFriends = null;

/**
 * The friends list, painted. Asked when Home is shown and once a minute
 * after; a rebuilt card paints the last answer first.
 */
async function syncFriends() {
  const card = refs.friendsCard;
  if (!card) return;
  /* The last answer is the active account's or nothing: a switched account
     must not see the other one's friends while the site is asked. */
  const who = String(activeAccount()?.uuid || "").toLowerCase();
  if (lastFriends && lastFriends.who !== who) lastFriends = null;
  if (lastFriends) paintFriends(lastFriends);
  let answer = null;
  try {
    answer = await host.friends?.list?.();
  } catch {
    answer = null;
  }
  if (refs.friendsCard !== card || !card.isConnected) return;   // left Home while main asked
  if (answer?.ok) lastFriends = { ...answer, who };
  paintFriends(answer || { ok: false, reason: "unreachable" });
  // Get started ticks its friend row off the same answer.
  if (answer?.ok) paintStarter();
}

/** "On bluemc.org", "In a world", "Last online 3 h ago" — the game's own words (screen/FriendsScreen.java). */
function friendLine(friend) {
  if (!friend.online) return friend.lastSeen > 0 ? `Last online ${when(friend.lastSeen)}` : "Offline";
  switch (friend.state) {
    case "world": return friend.open ? "World open to friends" : "In a world";
    case "server": return friend.detail ? `On ${friend.detail}` : "On a server";
    case "guest": return friend.detail ? `In ${friend.detail}'s world` : "In a friend's world";
    default: return "Online";
  }
}

function paintFriends(answer) {
  const body = refs.friendsBody;
  const note = refs.friendsNote;
  if (!body || !note) return;

  /* The Add button only for an account that can ask: an offline account,
     or none, is told below what Friends wants instead. */
  if (refs.friendsAdd) refs.friendsAdd.hidden = !answer.ok && (answer.reason === "offline-account" || answer.reason === "no-account");

  if (!answer.ok) {
    /* A site that cannot be reached keeps the rows it had and says so in
       the head; anything else is one plain line in the body. */
    if (answer.reason === "unreachable" && lastFriends) {
      note.textContent = "Can't refresh right now";
      return;
    }
    const line = answer.reason === "offline-account" ? "Sign in with a Microsoft account to see your friends."
      : answer.reason === "no-account" ? "Add an account to see your friends."
      : answer.reason === "not-signed-in" ? "Start a game once to turn on Friends."
      : "Friends can't be reached right now. They'll be back shortly.";
    note.textContent = "";
    body._painted = null;
    body.replaceChildren(el("span", { class: "side-card__empty", text: line }));
    return;
  }

  const friends = answer.friends.slice().sort((a, b) => (b.online - a.online) || (b.lastSeen - a.lastSeen));
  const online = friends.filter((f) => f.online).length;
  note.textContent = !friends.length ? ""
    : online ? `${online} of ${friends.length} online`
    : `${friends.length} friend${friends.length === 1 ? "" : "s"}`;

  if (!friends.length) {
    body._painted = null;
    /* It said "Add friends in the game" under an Add friends button that
       has been right above it since 2026-09-21 (2026-09-24). */
    body.replaceChildren(el("span", { class: "side-card__empty", text: "No friends here yet. Add someone by their Minecraft name and join them in one press." }));
    return;
  }

  /* Nothing is rebuilt when nothing has changed (2026-09-22). The poll runs
     once a minute for as long as the launcher is open — usually the whole of
     a game — and it replaced every row each time: a face drawn from the skin
     cache and a `_fit()` that reads two computed styles, for a list that had
     not moved. The signature is everything below draws from, so a friend
     coming online still repaints at once. */
  const signature = friends.map((f) => `${f.name}|${f.online ? 1 : 0}|${friendLine(f)}|${f.state}|${f.detail || ""}`).join("\n");
  if (body._painted === signature) { body._fit?.(); return; }
  body._painted = signature;

  body.replaceChildren(...friends.map((friend) => {
    const face = el("span", { class: "friend-row__face" });
    paintAccountHead(face, friend.name);
    const dot = el("span", { class: `partner-row__dot${friend.online ? "" : " is-off"}` });
    const inner = [
      face,
      el("span", { class: "stack truncate" }, [
        el("span", { class: "cont-row__title" }, [
          el("span", { class: "truncate cont-row__name", text: friend.name }),
          dot
        ]),
        el("span", { class: "truncate cont-row__meta", text: friendLine(friend) })
      ])
    ];
    /* Only a friend on a server is a press: that is the one place the
       launcher can take you. */
    if (friend.online && friend.state === "server" && friend.detail) {
      return el("button", {
        class: "cont-row cont-row--press friend-row",
        title: `Start the game and join ${friend.name} on ${friend.detail}`,
        onClick: () => launchActive(friend.detail)
      }, [
        ...inner,
        el("span", { class: "cont-row__glyph", html: icons.play, "aria-hidden": "true" })
      ]);
    }
    return el("div", { class: `cont-row friend-row${friend.online ? "" : " is-off"}` }, inner);
  }));
  body._fit?.();
}

/**
 * The card's head note: the streak (2026-09-12). It said the all-time death
 * count until this date — true, and the one figure on Home that pulled
 * against the rest of the card, an all-time number in the corner of a seven-
 * day one. A run of days is the figure that belongs to a week, and it is the
 * one that brings a player back tomorrow. Deaths are on Stats, where the
 * other all-time totals are.
 *
 * Shown from two days: "1 day in a row" is not a run. The streak stays alive
 * until midnight when today has not been played yet, and the flame beside it
 * says which — lit while today is played, grey while it is still to be kept
 * ("3 day streak" either way); how it is counted is in src/main/ledger.js.
 */
function fillNote(summary) {
  if (!refs.playtimeNote) return;
  const days = summary?.streak?.days || 0;
  if (days < 2) {
    refs.playtimeNote.replaceChildren();
    return;
  }
  refs.playtimeNote.classList.toggle("is-lit", Boolean(summary.streak.alive));
  refs.playtimeNote.replaceChildren(
    el("span", { class: "play-streak__flame", html: icons.flame }),
    el("span", { text: `${days} day streak` })
  );
}

/** A long way off is said in hours alone: '1,971h to go', not '1,971h 22m'. */
const roughly = (ms) => (ms >= 10 * 3600000 ? `${Math.ceil(ms / 3600000).toLocaleString()}h` : spell(ms));

/** The hours the ladder wants for a level — levelOf's rule, read backwards. */
const hoursFor = (level) => ((level - 1) ** 2 / 4) * 3600000;

/**
 * The next cape, and the road to it (2026-09-17).
 *
 * The week's seven bars stood here from 2026-09-12 to this day, and came out
 * at Adrian's word with the whole day-by-day idea: "we must remove the day by
 * day playtime, and instead make the focus on leveling up towards the cape."
 * Of five takes on what the card should hold instead he picked this one
 * (journal, *Your play, three rounds*): one row — the next cape's face at
 * half strength, "Next cape · Yours", "Level 100 · 1,971h of play to go",
 * and the level at the right — then the road, a bar from Level 1 to the
 * cape's level filled to yours, with the two ends written under it: where
 * you are and how far the next level is, and where the cape is.
 *
 * The road is in levels, the launcher's own unit (Level 44 is 44% of the way
 * to 100); the hours — the truer figure, since the ladder climbs faster as
 * it goes — are in the words beside it. Once every cape is earned there is
 * no next one: the row is the cape worn, lit, and the road is the bar to the
 * next level. Nothing here is a number the launcher made up: the levels are
 * levelOf()'s, the capes are CAPES in play.js.
 */
function fillDays(summary) {
  if (!refs.playtimeBody || !summary?.level) return;
  const level = summary.level;
  const next = CAPES.find((cape) => cape.level > level.level) || null;
  const worn = capeWorn(level.level, state.settings?.play?.cape || "");
  const colours = capeColours(state.settings?.play);
  const levelTag = el("span", { class: "play-level", title: levelLine(level) }, [
    el("span", { class: "play-level__num", text: `Level ${level.level}` })
  ]);

  const row = next
    ? el("div", { class: "play-cape" }, [
        el("span", { class: "play-cape__face is-dim" }, [capeFace(next, colours, 3)]),
        el("div", { class: "play-cape__words" }, [
          el("span", { class: "play-cape__name truncate", text: `Next cape · ${next.name}` }),
          el("span", { class: "play-cape__line", text: `Level ${next.level} · ${roughly(Math.max(0, hoursFor(next.level) - summary.totals.playedMs))} of play to go` })
        ]),
        levelTag
      ])
    : el("div", { class: "play-cape" }, [
        el("span", { class: "play-cape__face" }, [capeFace(worn || CAPES[CAPES.length - 1], colours, 3)]),
        el("div", { class: "play-cape__words" }, [
          el("span", { class: "play-cape__name truncate", text: worn ? `${worn.name} cape · wearing` : "Every cape earned" }),
          el("span", { class: "play-cape__line", text: `${spell(summary.totals.playedMs)} played all time` })
        ]),
        levelTag
      ]);

  /* To the cape by level; with every cape earned, to the next level by hours. */
  const share = next ? level.level / next.level : level.into / level.span;
  const road = el("div", {
    class: "play-road",
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": "100",
    "aria-valuenow": String(Math.round(share * 100)),
    "aria-label": next ? `Level ${level.level} of ${next.level} to the ${next.name} cape` : `Level ${level.level}, ${levelLine(level)}`
  }, [
    el("span", { class: "play-road__fill", style: { width: `${Math.max(1.5, share * 100)}%` } })
  ]);

  const ends = el("div", { class: "play-road__ends" }, [
    el("span", {}, [el("b", { text: `Level ${level.level}` }), el("span", { text: ` · ${levelLine(level)}` })]),
    el("span", { text: next ? `Level ${next.level}` : `Level ${level.level + 1}` })
  ]);

  refs.playtimeBody.replaceChildren(row, road, ends);
}

/**
 * The ledger, read once when Home is shown. Home never waits on disk: the two
 * panels start hidden and appear if and when the record arrives, so an install
 * with no mod yet, or nobody who has played, simply never sees them.
 */
async function syncRecent() {
  const card = refs.continueCard;
  if (!card) return;

  let places = [];
  let summary = null;
  try {
    /* Two reads of one file, asked for together — the places answer "where"
       and the days answer "when", and neither waits on the other. */
    const [gotPlaces, gotSummary] = await Promise.all([
      host.ledger?.recent?.(),
      host.ledger?.summary?.()
    ]);
    places = gotPlaces || [];
    summary = gotSummary || null;
  } catch {
    return;
  }
  if (refs.continueCard !== card || !card.isConnected) return;   // left Home while we read

  /* A level reached, a record beaten or a milestone earned since the last
     look, said once — this is the moment the launcher comes back from a
     game. Before any place exists it only remembers where the record stands
     (level 1, nothing earned), so the first game ever played is announced
     when it ends. See play.js. */
  announce(summary);
  /* The cape the record has earned hangs on the model (2026-09-12, evening)
     — turn him and it is there, the way it is in the game. */
  fillCape(summary);
  if (!places.length) return;

  fillSide(places);
  fillNote(summary);
  fillDays(summary);
}

/**
 * The worn cape, or none, onto the model — the same rule the game applies.
 * The cape moves (2026-09-13), so it goes on as a strip of its thirty frames;
 * Yours is cooked in the colours picked on Stats first, which takes a
 * moment the first time.
 */
async function fillCape(summary) {
  if (!refs.stage?.setCape || !summary?.level) return;
  const worn = capeWorn(summary.level.level, state.settings?.play?.cape || '');
  if (!worn) {
    refs.stage.setCape(null);
    return;
  }
  const stage = refs.stage;
  const strip = await capeStrip(worn, capeColours(state.settings?.play)).catch(() => null);
  if (refs.stage === stage) stage.setCape(strip);
}

/* state.js capitalises its times for use on their own; here one follows a comma.
   '3h ago', 'just now', 'Sep 14' — relativeTime's word mid-sentence; only the Just is lowered, a month keeps its capital. */
const when = (at) => relativeTime(at).replace(/^Just/, 'just');

/**
 * The configuration summary on a profile card — the two facts the card is not
 * already carrying.
 *
 * It was four (2026-09-07): version, loader, Java, memory. The card's own
 * subtitle, one line above the row, reads "26.2 · Fabric" — so half the pills
 * repeated what was directly over them, in a second style, and the four
 * together wrapped to two lines on a card the width this column gives. What is
 * left is what the card does not say anywhere else.
 */
export function specTags(profile) {
  const memoryMb = profile.memoryMb || state.settings?.game?.memoryMb || 0;
  return [
    tag(javaFor(profile.version), icons.coffee, 'java'),
    tag(`${(memoryMb / 1024).toFixed(1)}GB`, icons.cpu, 'memory')
  ];
}

function tag(text, icon, kind) {
  return el('span', { class: `tag tag--${kind}` }, [
    el('span', { html: icon, style: { display: 'contents' } }),
    el('span', { text })
  ]);
}

/* -------------------------------------------------------------- session */

/** Every running row's clock, once a second. Rows still installing show a
    percent instead and are left alone. */
function paintClocks() {
  if (!refs.rows) return;
  for (const session of state.sessions) {
    const row = refs.rows.get(session.id);
    if (!row || session.status !== 'playing') continue;
    row.time.textContent = elapsed(session.startedAt);
  }
}

/** mm:ss until the hour, then h:mm:ss — a row is too narrow for 00:04:12. */
function elapsed(since) {
  return clock(Date.now() - (since || Date.now()));
}

/** The same face for a span that has already ended — a crashed row's stopped clock. */
function clock(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* --------------------------------------------------------------- launch */

function onLaunchClick() {
  return launchActive();
}

/* A press being checked, and when the last launch went out — see below. */
const PRESS_SETTLE_MS = 1000;
let pressing = false;
let launchedAt = 0;

/**
 * Start the active profile — plain, or with a server to join on arrival
 * (a partner row). Everything Play checks, Play checks here too.
 */
async function launchActive(join = null) {
  /* One launch per press, and a double-click is one press (2026-09-22). The
     session row is announced the moment main has the launch, so the second
     click of a double-click found the first click's game already running and
     asked "Start anyway?" about a game nobody meant to start twice. A press
     while the first is still being checked, or within a second of its launch
     going out, is the same press; after that it is a deliberate Launch
     another, and asks as it always has. */
  if (pressing || Date.now() - launchedAt < PRESS_SETTLE_MS) return;
  const profile = activeProfile();
  if (!profile && activeAccount()) {
    toast('Choose a profile to play', 'info');
    setRoute('profiles');
    return;
  }
  pressing = true;
  let go;
  try {
    go = await launchChecks(profile, join);
  } finally {
    pressing = false;
  }
  if (!go) return;
  launchedAt = Date.now();
  await startGame(profile, join);
}

/**
 * A world from Where you left off (2026-09-24): its own profile, straight
 * into the save — Worlds' Play, from Home. Play's one-press rule and its
 * checks, with the world's profile in the active one's place.
 */
async function launchWorld(world, name) {
  if (pressing || Date.now() - launchedAt < PRESS_SETTLE_MS) return;
  const profile = state.profiles.find((p) => p.id === world.profileId);
  if (!profile) return;
  pressing = true;
  let go;
  try {
    go = await launchChecks(profile);
  } finally {
    pressing = false;
  }
  if (!go) return;
  launchedAt = Date.now();
  if (await startGame(profile, null, { world: world.folder })) {
    toast(`${profile.name} will open ${name} as soon as it is up`, 'info', 4000);
  }
}

/**
 * Everything Play asks before it starts a game — an account, the same profile
 * already running, the memory left — for Play, a partner row and a crashed
 * row's Retry alike. True when the launch may go ahead.
 */
async function launchChecks(profile) {
  if (!activeAccount()) {
    openAccountModal();
    return false;
  }
  if (!profile) return false;
  const memoryMb = profile.memoryMb || state.settings?.game?.memoryMb || 4096;
  if (!(await allowDuplicate(profile))) return false;
  if (!(await allowMemory(profile, memoryMb))) return false;
  return true;
}

/**
 * The launch itself, checks passed. `extra` rides on the launch call beside
 * the destination — today only `repairJava`, from a crashed row's Retry.
 */
async function startGame(profile, join = null, extra = {}) {
  const memoryMb = profile.memoryMb || state.settings?.game?.memoryMb || 4096;
  const result = await host.game.launch({
    id: profile.id,
    name: profile.name,
    version: profile.version,
    loader: profile.loader,
    memoryMb,
    join,
    ...extra
  });

  if (result?.ok) {
    touchProfile(profile.id);
    if (join) toast(`${profile.name} will join ${join} as soon as it is up`, 'info', 4000);
    return true;
  }
  if (result?.cancelled) return;
  // A JVM that died at once has its row on Home saying why (noteCrash); a
  // toast on top of it would say it twice.
  if (result?.crashed) return;
  if (result?.error) toast(result.error, 'error', 6000);
}

/**
 * A second copy of a profile that is already running.
 *
 * Allowed — two alt accounts on one modpack is a reason people want this at
 * all — but it is not free: a profile owns one game directory, so both copies
 * read and write the same saves, options and mods. Minecraft locks a world
 * while it has it open, so the second copy can start and still be unable to
 * open the world the first one is in.
 */
async function allowDuplicate(profile) {
  const already = sessionsFor(profile.id);
  if (!already.length) return true;

  return confirmModal({
    title: `${profile.name} is already running`,
    lines: [
      'Both copies share the same saves, options and mods folder.',
      'A world open in one cannot be opened in the other.'
    ],
    confirmLabel: 'Start anyway',
    danger: false
  });
}

/**
 * The memory the running games have already claimed, plus this one.
 *
 * Each game reserves its heap up front, so three at 4 GB is 12 GB spoken for
 * before Windows, the launcher and everything else. A quarter of the machine
 * is left out of the budget for them.
 */
async function allowMemory(profile, memoryMb) {
  const totalMb = state.system?.totalMemoryMb || 0;
  const reserved = reservedMemoryMb();
  if (!totalMb || !reserved || reserved + memoryMb <= totalMb * 0.75) return true;

  const gb = (mb) => `${(mb / 1024).toFixed(1)} GB`;
  const fallback = state.settings?.game?.memoryMb || 4096;

  return confirmModal({
    title: 'Not much memory left',
    lines: [
      `Running: ${state.sessions.map((s) => gb(s.memoryMb || fallback)).join(' + ')}.` +
      ` This one wants ${gb(memoryMb)}.`,
      `This machine has ${gb(totalMb)} — Windows needs some of it too.`
    ],
    confirmLabel: 'Start anyway',
    danger: false
  });
}

/** Play says "Sign in" until there is an account to play as, and "Play
    another" while a game is up. */
export function syncLaunchButton() {
  if (!refs.launch) return;
  refs.label.textContent = launchLabel();
}

/* -------------------------------------------------------------- profiles */

/**
 * The quick switcher on the caret. Each row wears the profile's own block —
 * the same cube the row under Play and the card on Profiles wear. Until
 * 2026-09-13 it wore a world shot for the profile's Minecraft version
 * instead, so a TNT profile and a diamond profile on the same version were
 * told apart only by name (Adrian: "the icon for each profile doesn't match
 * the true one selected (tnt, diamond, gold, etc)").
 */
function openProfileMenu(anchor) {
  openMenu(anchor, (close) => {
    const items = state.profiles.map((profile) => el('button', {
      class: 'menu__account',
      role: 'menuitem',
      onClick: () => { setActiveProfile(profile.id); syncProfile(); close(); }
    }, [
      el('img', { class: 'menu__cube', src: blockIcon(blockIdFor(profile)), alt: '' }),
      el('span', { class: 'stack truncate' }, [
        el('span', { class: 'menu__account-name truncate', text: profile.name }),
        el('span', { class: 'menu__account-meta', text: `${profile.version} · ${loaderLabel(profile.loader)}` })
      ]),
      profile.id === state.activeProfileId && el('span', { class: 'menu__account-check', html: icons.check })
    ]));

    return [
      menuLabel('Profiles'),
      ...(items.length ? items : [el('div', { class: 'menu__label', text: 'No profiles yet' })]),
      menuSeparator(),
      menuItem({ label: 'Manage profiles', icon: icons.folderOpen, onSelect: () => { close(); setRoute('profiles'); } })
    ];
    /* The stack's own width, not 300 (2026-09-07). The caret sits at the foot
       of the window, so the menu always flips upward — over Play, which is
       directly above it. At 300 it covered the right two thirds of the button
       and left a bright cyan stub sticking out of the left edge, which reads
       as a drawing bug rather than as a menu. At the stack's width it covers
       the stack exactly and reads as the stack being replaced while you
       choose. */
  }, { align: 'end', width: 480 });
}
