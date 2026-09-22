/**
 * The Minecraft families, with their names and their posters.
 *
 * A "family" is what the picker shows a card for. For the 1.x line it is the
 * version to its second number — 1.21 for 1.21.11 — the unit Mojang named
 * and drew a poster for. From 26 on, Mojang's versions are the year and a
 * drop (26.1, 26.1.2, 26.2), each drop with its own name and poster, and the
 * card is the year: Adrian, 2026-09-14, "merge 26.2 and 26.1 into 26". The
 * card's name and poster follow whichever drop is chosen on it.
 *
 * The pictures in `assets/art/versions/` are the posters, one 3:4 each,
 * made by tools/make-version-art.js from minecraft.net and the wiki; the
 * names are Mojang's own for the update (2026-09-14, for the version picker
 * — Adrian: "a card pops up … with the different official minecraft
 * versions and their official artwork for each one").
 *
 * Nine families, and nothing older than 1.13, nor 1.15 (Adrian, later the
 * same day: "we can definitely remove everything older than 1.13, then
 * remove 1.15 too" — Buzzy Bees is a version nobody picks on purpose). A
 * version outside these, snapshots included, is the picker's Custom card.
 *
 * Until this date the folder held seven patch-note screenshots keyed by
 * exact version, and the module served them to a profile menu that has worn
 * the profile's block since 2026-09-13; nothing read it.
 */

const VERSION_DIR = 'assets/art/versions';

/** Newest first — the order the cards come in. A family with `drops` is a year. */
export const FAMILIES = [
  { id: '26', drops: [{ id: '26.2', name: 'Chaos Cubed' }, { id: '26.1', name: 'Tiny Takeover' }] },
  { id: '1.21', name: 'Tricky Trials' },
  { id: '1.20', name: 'Trails & Tales' },
  { id: '1.19', name: 'The Wild Update' },
  { id: '1.18', name: 'Caves & Cliffs II' },
  { id: '1.17', name: 'Caves & Cliffs I' },
  { id: '1.16', name: 'Nether Update' },
  { id: '1.14', name: 'Village & Pillage' },
  { id: '1.13', name: 'Update Aquatic' }
];

const byId = new Map(FAMILIES.map((family) => [family.id, family]));

const parts = (version) => String(version).split('.').map((n) => parseInt(n, 10));

/**
 * "1.21.11" → "1.21"; "26.1.2" → "26"; a snapshot ("26w14a") → null. The
 * year scheme began at 26, so a first number that size is a year.
 */
export function familyOf(version) {
  if (!/^\d+(\.\d+)+$/.test(String(version))) return null;   // "26w14a", "1.21.2-pre1": not a release
  const [major, minor] = parts(version);
  return major >= 26 ? String(major) : `${major}.${minor}`;
}

/** The drop a year-family version belongs to ("26.1.2" → the 26.1 entry), or null. */
function dropOf(family, version) {
  if (!family?.drops) return null;
  const [major, minor] = parts(version);
  return family.drops.find((drop) => drop.id === `${major}.${minor}`) || null;
}

/** The family's entry, or null for one the picker has no card for. */
export const family = (id) => byId.get(id) || null;

/** "Tricky Trials", "Chaos Cubed" — or nothing for a version outside the families. */
export function familyName(version) {
  const entry = byId.get(familyOf(version));
  if (!entry) return '';
  return entry.drops ? (dropOf(entry, version)?.name || '') : entry.name;
}

/**
 * The poster for a version: its family's, or for a year its drop's — a drop
 * without a poster yet (26.3, the day it lands) wears the newest that has one.
 */
export function familyArt(version) {
  const entry = byId.get(familyOf(version));
  if (!entry) return null;
  const id = entry.drops ? (dropOf(entry, version) || entry.drops[0]).id : entry.id;
  return `${VERSION_DIR}/${id}.jpg`;
}
