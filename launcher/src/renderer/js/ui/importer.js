/**
 * Import profiles — the panel behind the button on Profiles (2026-09-16).
 *
 * Adrian: "build it for lunar, feather/dawn client, fastclient, and the other
 * ones too." Until this date the button said the feature was on its way;
 * now it opens this: what the other launchers on this PC hold, grouped by
 * launcher, every row a switch and all of them on, and one button that
 * brings the ticked rows over. Main does the reading and the copying
 * (src/main/game/import.js) and answers with profile records; the page
 * adopts them (state.adoptProfiles) and lands on the first.
 *
 * A row says what it is in the words of the Profiles card — the name, then
 * "1.21.11 · Fabric · 9 mods (3 off) · 4.0 GB" — and, where the row cannot
 * come over whole, the one plain line saying why (a Forge pack arrives as
 * the version alone). Lunar's waypoints are a row of their own.
 *
 * The panel arrives at the size it keeps: three placeholder rows stand in
 * for the scan, which takes a few folder listings, so the pane does not
 * grow under its blur when the answer lands. Nothing here is a path — a
 * row is a key main made up.
 *
 * **Import settings (2026-09-17).** Adrian: "in import profiles … can we
 * have import settings too, to turn off and on?" One switch above the
 * launchers, on by default, shown only when a ticked row has settings to
 * bring: with it on, every profile brought over takes its launcher's
 * keybinds, video settings, server list, packs and mod settings as well
 * (main/game/import.js, `settings.takeFrom`), so it opens the way it did
 * there; off, it opens on the settings of the profile played last, like a
 * new profile.
 *
 * **Opened from "We found your profiles" (2026-09-18, ui/found.js)** it is
 * handed the scan's answer that dialog already has (`answer`), so it paints
 * its rows at once — every one on — in place of the three ghost rows, and
 * the next press is Import. **And the panel is a spotlight dialog like it**
 * (2026-09-18, evening; Adrian: "the popup when you click import profiles
 * should have the same exact style as the auto popup") — the pane over the
 * undimmed world, everything around it dimmed and blurred, the rim, no band
 * under the buttons — whichever way it is opened, and each launcher's group
 * wears the same logo tile the offer's rows do.
 */

import { el } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { host } from '../bridge.js';
import { adoptProfiles, loaderLabel } from '../state.js';
import { launcherLogo } from './launcherlogo.js';

const gb = (mb) => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB`;

/** The card's own meta line, for a row: "1.21.11 · Fabric · 9 mods (3 off) · 4.0 GB". */
function metaOf(r) {
  if (r.kind === 'waypoints') return r.note;
  const bits = [r.version, loaderLabel(r.imports)];
  if (r.mods) bits.push(`${r.mods} mod${r.mods === 1 ? '' : 's'}${r.disabled ? ` (${r.disabled} off)` : ''}`);
  if (r.memoryMb) bits.push(gb(r.memoryMb));
  return bits.join(' · ');
}

export function openImporter({ onDone, answer: known } = {}) {
  const picked = new Set();
  let rows = [];
  let busy = false;
  let withSettings = true;

  /* The switch, and the row it sits in — shown only while a ticked row has
     settings to bring, so the panel never offers a switch that does nothing. */
  const settingsSwitch = el('button', {
    class: 'switch', role: 'switch', 'aria-checked': 'true', 'aria-label': 'Also bring their settings',
    onClick: () => {
      withSettings = !withSettings;
      settingsSwitch.setAttribute('aria-checked', String(withSettings));
      count();
    }
  });
  const settingsRow = el('section', { class: 'group importer__group importer__settings', hidden: true }, [
    el('div', { class: 'setting-row importer__row' }, [
      el('div', { class: 'stack setting-row__text' }, [
        el('span', { class: 'setting-row__name', text: 'Also bring their settings' }),
        el('span', { class: 'setting-row__desc', text: 'Keybinds, video settings, the server list, resource packs and mod settings — so each profile opens the way it does there' })
      ]),
      el('div', { class: 'setting-row__control' }, [settingsSwitch])
    ])
  ]);

  const body = el('div', { class: 'importer' });
  const summary = el('span', { class: 'importer__sum', text: 'Looking…' });
  const importButton = el('button', {
    class: 'btn btn--add', type: 'button', disabled: true,
    onClick: () => bring()
  }, [el('span', { text: 'Import' })]);

  /* Three rows the shape of a real one, until the scan answers. */
  body.append(el('section', { class: 'group importer__group' }, [
    el('div', { class: 'group__head' }, [el('span', { class: 'group__title importer__ghost', text: 'Looking for launchers' })]),
    ...[0, 1, 2].map(() => el('div', { class: 'setting-row importer__row importer__row--ghost' }, [
      el('div', { class: 'stack setting-row__text' }, [
        el('span', { class: 'setting-row__name importer__ghost', text: 'A profile' }),
        el('span', { class: 'setting-row__desc importer__ghost', text: '1.21.11 · Fabric · 9 mods' })
      ])
    ]))
  ]));

  function switchFor(row) {
    const node = el('button', {
      class: 'switch', role: 'switch', 'aria-checked': 'true', 'aria-label': `Bring ${row.name} over`,
      onClick: () => {
        const on = node.getAttribute('aria-checked') !== 'true';
        node.setAttribute('aria-checked', String(on));
        if (on) picked.add(row.key); else picked.delete(row.key);
        count();
      }
    });
    return node;
  }

  function paint(groups) {
    rows = groups.flatMap((g) => g.rows);
    body.replaceChildren();
    body.append(settingsRow);
    if (!rows.length) {
      body.append(el('p', { class: 'importer__none', text: 'No other launcher with profiles was found on this PC. BlueClient looks for Lunar, Dawn (Feather), FastClient, the Minecraft launcher, Prism, MultiMC, CurseForge, ATLauncher and the Modrinth App.' }));
      summary.textContent = '';
      return;
    }
    for (const g of groups) {
      body.append(el('section', { class: 'group importer__group' }, [
        el('div', { class: 'group__head importer__head' }, [launcherLogo(g.launcher, { small: true }), el('span', { class: 'group__title', text: g.label })]),
        ...g.rows.map((r) => {
          picked.add(r.key);
          return el('div', { class: 'setting-row importer__row' }, [
            el('div', { class: 'stack setting-row__text' }, [
              el('span', { class: 'setting-row__name', text: r.name }),
              el('span', { class: 'setting-row__desc', text: metaOf(r) }),
              r.note && r.kind !== 'waypoints' ? el('span', { class: 'setting-row__desc importer__why', text: r.note }) : null
            ]),
            el('div', { class: 'setting-row__control' }, [switchFor(r)])
          ]);
        })
      ]));
    }
    count();
  }

  function count() {
    const chosen = rows.filter((r) => picked.has(r.key));
    const profiles = chosen.filter((r) => r.kind === 'profile').length;
    const settingsRows = chosen.filter((r) => r.kind === 'profile' && r.settings).length;
    settingsRow.hidden = !rows.some((r) => r.kind === 'profile' && r.settings);
    const mods = chosen.reduce((n, r) => n + (r.mods || 0), 0);
    const points = chosen.reduce((n, r) => n + (r.count || 0), 0);
    const bits = [];
    if (profiles) bits.push(`${profiles} profile${profiles === 1 ? '' : 's'}`);
    if (mods) bits.push(`${mods} mod${mods === 1 ? '' : 's'}`);
    if (points) bits.push(`${points} waypoint${points === 1 ? '' : 's'}`);
    if (withSettings && settingsRows) bits.push(`settings for ${settingsRows === profiles ? (profiles === 1 ? 'it' : 'all') : settingsRows}`);
    summary.textContent = bits.length ? bits.join(', ') : 'Nothing ticked';
    importButton.disabled = busy || !chosen.length;
  }

  let close = () => {};

  async function bring() {
    if (busy) return;
    busy = true;
    importButton.disabled = true;
    importButton.replaceChildren(el('span', { text: 'Importing…' }));
    let answer;
    try {
      answer = await host.game.importBring([...picked], { settings: withSettings });
    } catch (error) {
      answer = { ok: false, error: String(error?.message || error) };
    }
    if (!answer?.ok) {
      busy = false;
      importButton.replaceChildren(el('span', { text: 'Import' }));
      count();
      toast(answer?.error || 'Could not bring the profiles over', 'error');
      return;
    }
    const adopted = await adoptProfiles(answer.profiles);
    close();
    const said = [];
    if (adopted.length) said.push(`${adopted.length} profile${adopted.length === 1 ? '' : 's'}`);
    if (answer.waypoints) said.push(`${answer.waypoints} waypoint${answer.waypoints === 1 ? '' : 's'}`);
    if (answer.settings) said.push(answer.settings === adopted.length && adopted.length ? 'their settings' : `settings for ${answer.settings}`);
    const tail = [];
    if (answer.copied) tail.push(answer.copied === 1 ? 'one jar not on Modrinth went into the folder as it is' : `${answer.copied} jars not on Modrinth went into the folder as they are`);
    if (answer.leftBehind) tail.push(`${answer.leftBehind} Forge mod${answer.leftBehind === 1 ? '' : 's'} stayed behind`);
    toast(`${said.length ? said.join(' and ') + ' brought over' : 'Nothing to bring over'}${tail.length ? ' — ' + tail.join('; ') : ''}`, 'success', 5200);
    onDone?.(adopted);
  }

  close = openModal({
    spotlight: true,
    title: 'Import profiles',
    subtitle: 'From the other launchers on this PC. Nothing is moved — they keep everything.',
    className: 'modal--importer',
    build: () => [body],
    actions: (done) => [
      summary,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onClick: () => done() }),
      importButton
    ]
  });

  (known ? Promise.resolve(known) : host.game.importScan()).then((answer) => {
    if (!body.isConnected) return;
    if (!answer?.ok) {
      body.replaceChildren(el('p', { class: 'importer__none', text: answer?.error || 'Could not look for other launchers.' }));
      summary.textContent = '';
      return;
    }
    paint(answer.groups || []);
  });

  return close;
}
