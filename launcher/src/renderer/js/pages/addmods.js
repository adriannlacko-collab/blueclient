/**
 * Add mods — a Modrinth browser in a side drawer. Since 2026-09-09 the same
 * drawer adds resource packs (`kind: 'pack'`).
 *
 * Mod results are filtered to the target profile's loader and game version,
 * so anything listed can actually load on it; pack results to the version
 * alone, because a pack is for the game itself and goes into the profile's
 * own packs — shared with the profiles it is synced with, since 2026-09-17
 * (see main/game/packs.js). The request runs in the main process; see
 * src/main/modrinth.js for why.
 */

import { el } from '../ui/dom.js';
import { icons } from '../icons.js';
import { openDrawerPanel } from '../ui/drawer.js';
import { toast } from '../ui/toast.js';
import { monogram } from '../monogram.js';
import { host } from '../bridge.js';
import { addMod, removeMod, profileMods, loaderLabel, settingsScopeWords } from '../state.js';
import { paintModIcon } from '../modicon.js';

let results;
let status;
let searchTimer = null;
let requestSeq = 0;

export function openAddMods(profile, onAdded, { kind = 'mod' } = {}) {
  const packs = kind === 'pack';
  results = el('div', { class: 'catalog' });
  status = el('p', { class: 'catalog__status' });

  const input = el('input', {
    class: 'input',
    type: 'search',
    placeholder: packs
      ? `Search Modrinth for ${profile.version} resource packs`
      : `Search Modrinth for ${loaderLabel(profile.loader)} ${profile.version} mods`,
    onInput: (event) => {
      const value = event.target.value;
      clearTimeout(searchTimer);
      // Debounced: typing a word should not fire six requests.
      searchTimer = setTimeout(() => run(profile, value, onAdded, packs), 280);
    }
  });

  const dismiss = openDrawerPanel({
    title: packs ? 'Add resource packs' : 'Add mods',
    subtitle: packs
      ? `For Minecraft ${profile.version} · on in ${settingsScopeWords(profile.id)}`
      : `${profile.name} · ${profile.version} · ${loaderLabel(profile.loader)}`,
    build: () => [
      el('div', { class: 'catalog__search' }, [
        el('span', { html: icons.search }),
        input
      ]),
      status,
      results
    ],
    // The trap focuses this instead of the close button, so there is no
    // second focus change a moment later.
    initialFocus: () => input,
    onClose: () => { clearTimeout(searchTimer); requestSeq++; }
  });

  // Laying out thirty rows while the panel is still sliding makes the slide
  // stutter, so the first search waits for it to land.
  setTimeout(() => run(profile, '', onAdded, packs), 300);
  return dismiss;
}

async function run(profile, query, onAdded, packs) {
  const seq = ++requestSeq;
  const what = packs ? 'resource packs' : 'mods';
  const where = packs ? profile.version : `${profile.version} · ${loaderLabel(profile.loader)}`;

  status.textContent = query ? `Searching for “${query}”…` : `Loading popular ${what}…`;
  results.replaceChildren(...Array.from({ length: 4 }, () => el('div', { class: 'catalog-row is-skeleton' })));

  const [response, installed] = await Promise.all([
    host.modrinth.search({
      query,
      loader: packs ? undefined : profile.loader,
      version: profile.version,
      limit: 30,
      type: packs ? 'resourcepack' : 'mod'
    }),
    installedMap(profile, packs)
  ]);

  if (seq !== requestSeq) return;   // a newer keystroke already won

  if (!response?.ok) {
    status.textContent = '';
    results.replaceChildren(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: icons.puzzle }),
      el('p', { class: 'empty__title', text: 'Search unavailable' }),
      el('p', { class: 'empty__text', text: response?.error || 'Could not reach Modrinth.' })
    ]));
    return;
  }

  const hits = response.hits || [];

  status.textContent = hits.length
    ? `${hits.length} result${hits.length === 1 ? '' : 's'} for ${where}`
    : '';

  if (!hits.length) {
    results.replaceChildren(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: icons.puzzle }),
      el('p', { class: 'empty__title', text: 'No matches' }),
      el('p', {
        class: 'empty__text',
        text: `Nothing on Modrinth matches that for ${where}.`
      })
    ]));
    return;
  }

  results.replaceChildren(...hits.map((hit) => row(hit, profile, installed, onAdded, packs)));
  hits.forEach((hit, i) => {
    const img = results.children[i]?.querySelector('.catalog-row__icon');
    paintModIcon(img, hit.iconUrl);
  });
}

/**
 * What is already on: for mods, the profile's own list keyed by name; for
 * packs, the shared set keyed by Modrinth slug, so a row can remove it again.
 */
async function installedMap(profile, packs) {
  if (!packs) {
    return new Map(profileMods(profile.id).map((m) => [m.name.toLowerCase(), m]));
  }
  const answer = await host.packs.list(profile.id);
  const listed = answer?.ok ? answer.packs : [];
  return new Map(listed.filter((p) => p.slug).map((p) => [p.slug, p]));
}

/**
 * One result. Its button is a toggle: Add installs the mod, and once it is on
 * the profile the same button reads Remove and takes it off again — no dead
 * "Added" state that makes an accidental add a trip to another page.
 */
function row(hit, profile, installed, onAdded, packs) {
  const key = packs ? hit.slug : hit.name.toLowerCase();

  const paint = (busy = false) => {
    const on = installed.has(key);
    button.textContent = busy ? (on ? 'Removing…' : 'Adding…') : on ? 'Remove' : 'Add';
    button.className = `btn ${on ? 'btn--delete' : 'btn--confirm btn--add'}`;
    button.disabled = busy;
  };

  const button = el('button', {
    onClick: async (event) => {
      event.stopPropagation();
      const current = installed.get(key);

      if (packs) {
        paint(true);
        if (current) {
          const answer = await host.packs.remove(profile.id, current.file);
          if (answer?.ok) {
            installed.delete(key);
            toast(`${hit.name} removed`, 'info');
          } else {
            toast(answer?.error || `${hit.name} could not be removed`, 'error');
          }
        } else {
          const answer = await host.packs.add(profile.id, {
            slug: hit.slug,
            name: hit.name,
            author: hit.author,
            description: hit.description,
            iconUrl: hit.iconUrl,
            version: profile.version
          });
          if (answer?.ok) {
            installed.set(key, { file: answer.file });
            toast(`${hit.name} added — on in ${settingsScopeWords(profile.id)}`, 'success');
          } else {
            toast(answer?.error || `${hit.name} could not be added`, 'error');
          }
        }
        paint();
        onAdded?.();
        return;
      }

      if (current) {
        await removeMod(profile.id, current.id);
        installed.delete(key);
        toast(`${hit.name} removed from ${profile.name}`, 'info');
      } else {
        const entry = await addMod(profile.id, {
          name: hit.name,
          author: hit.author,
          version: hit.latestVersion || '1.0.0',
          description: hit.description,
          source: 'modrinth',
          slug: hit.slug,
          iconUrl: hit.iconUrl
        });
        if (entry) installed.set(key, entry);
        toast(`${hit.name} added to ${profile.name}`, 'success');
      }

      paint();
      onAdded?.();
    }
  });
  paint();

  return el('article', { class: 'catalog-row' }, [
    el('img', { class: 'catalog-row__icon', src: monogram(hit.name, 44), alt: '' }),
    el('div', { class: 'catalog-row__body' }, [
      el('div', { class: 'catalog-row__head' }, [
        el('h3', { class: 'catalog-row__name truncate', text: hit.name }),
        el('span', { class: 'catalog-row__author truncate', text: `by ${hit.author}` })
      ]),
      el('p', { class: 'catalog-row__desc', text: hit.description }),
      el('div', { class: 'catalog-row__meta' }, [
        el('span', { html: icons.download, style: { display: 'contents' } }),
        el('span', { text: compact(hit.downloads) })
      ])
    ]),
    button
  ]);
}

function compact(n) {
  const value = Number(n) || 0;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return String(value);
}
