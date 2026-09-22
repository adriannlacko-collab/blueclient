/**
 * We found your profiles — the first opening of Profiles (2026-09-18).
 *
 * Adrian: "when pressing profiles for the first time in blueclient, can you
 * make a popup that prompts the user to import profile from other clients
 * like lunar and dawn … it should be obvious to the user what it means
 * instantly … only popup first ever time you press on profiles page." Off a
 * sheet of seven ("Import Prompt, Seven Ways") he took this one, and then
 * its glass off a second sheet ("Found, in Glass": A3, the pane over the bare
 * world, with the surround dimmed and blurred around it — modal.js's
 * `spotlight`).
 *
 * The rule that makes it obvious: **it only appears when the scan has found
 * something, and it names what it found.** "We found your Lunar and Dawn
 * profiles" is understood in a second because it names the thing the player
 * already knows by the name they call it; a player with nothing to import
 * never sees a popup at all. One row per launcher — its own logo, its name,
 * "3 profiles · 21 mods · 14 waypoints" — not the profiles themselves: that
 * is the Import panel's job, which Import them opens with every row
 * already on, so the next press is Import. Not now closes it; the Import
 * profiles button at the top of the page is still there. The button said
 * "Bring them over" for an hour — Adrian: "it sounds like you are stealing
 * it from the other clients" — so it is the page's own word, Import, and the
 * sentence under the title says "copy", which is what happens.
 *
 * Whether it shows is pages/profiles.js's business (`launcher.importOffered`
 * in the settings, written whatever is pressed). This file only draws it.
 */

import { el } from './dom.js';
import { icons } from '../icons.js';
import { openModal } from './modal.js';
import { openImporter } from './importer.js';
import { launcherLogo } from './launcherlogo.js';

/* The short name the title says, by the launcher id main's scan uses. A
   launcher not named here is a row (by its group's label), never a name in
   the title. The marks are ui/launcherlogo.js's. */
const SHORT = {
  lunar: 'Lunar', dawn: 'Dawn', fastclient: 'FastClient', minecraft: 'Minecraft launcher',
  prism: 'Prism', polymc: 'PolyMC', multimc: 'MultiMC', curseforge: 'CurseForge', atlauncher: 'ATLauncher'
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Lunar", "Lunar and Dawn", "Lunar, Dawn and FastClient", "Lunar, Dawn, FastClient and 2 more". */
function nameList(groups) {
  const names = groups.map((g) => SHORT[g.launcher]);
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more) return `${shown.join(', ')} and ${more} more`;
  if (shown.length <= 1) return shown[0] || '';
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** A launcher's row: what it holds, in the card's own words. */
function metaOf(group) {
  const profiles = group.rows.filter((r) => r.kind === 'profile');
  const mods = profiles.reduce((n, r) => n + (r.mods || 0), 0);
  const points = group.rows.filter((r) => r.kind === 'waypoints').reduce((n, r) => n + (r.count || 0), 0);
  const bits = [];
  if (profiles.length) bits.push(plural(profiles.length, 'profile'));
  if (mods) bits.push(plural(mods, 'mod'));
  if (points) bits.push(plural(points, 'waypoint'));
  return bits.join(' · ');
}

/**
 * Open the dialog for a scan answer that found something.
 *
 * `answer` is `host.game.importScan()`'s, handed on to the Import panel so it
 * paints at once rather than scanning again. `onDone(adopted)` is the
 * importer's own — the page lands on the first profile brought over.
 */
export function openFound({ answer, onDone } = {}) {
  const groups = (answer?.groups || []).filter((g) => g.rows.length);
  /* The title names the launchers it knows by name; a game folder the scan
     found by its shape ("Another launcher") is a row, not a name. */
  const known = groups.filter((g) => SHORT[g.launcher]);
  const names = nameList(known);
  const keep = !names ? 'the other launchers keep everything.'
    : known.length === 1 ? `${names} keeps everything.`
      : `${names.replace(/ and \d+ more$/, ' and the rest')} keep everything.`;

  return openModal({
    spotlight: true,
    title: names ? `We found your ${names} profiles` : 'We found profiles on this PC',
    subtitle: 'Import them into BlueClient? Each one is copied with its version, mods, settings and waypoints.',
    className: 'modal--found',
    build: () => [
      el('div', { class: 'found' }, [
        el('div', { class: 'found__rows' }, groups.map((g) => el('div', { class: 'setting-row importer__row found__row' }, [
          launcherLogo(g.launcher),
          el('div', { class: 'stack setting-row__text' }, [
            el('span', { class: 'setting-row__name', text: g.label.replace(/^the /, (m) => m.toUpperCase()) }),
            el('span', { class: 'setting-row__desc', text: metaOf(g) })
          ])
        ]))),
        el('p', { class: 'found__note', text: `Nothing is moved — ${keep} You choose which ones to import on the next screen.` })
      ])
    ],
    actions: (close) => [
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Not now', onClick: () => close() }),
      el('button', {
        class: 'btn btn--add', type: 'button',
        /* Not `close()` first: the Import panel replaces this one on the
           scrim already there — the same spotlight surround, the pane
           gliding to its height with the hole cut again behind it. */
        onClick: () => openImporter({ answer, onDone })
      }, [
        el('span', { html: icons.download, style: { display: 'contents' } }),
        el('span', { text: 'Import them' })
      ])
    ]
  });
}
