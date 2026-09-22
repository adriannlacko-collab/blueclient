'use strict';

/**
 * The clips and screenshots the player has starred (2026-09-19).
 *
 * Adrian: "Add to favorite for screenshots and clips … good if is a important
 * screenshot, for ex base coords, fan taking photo with adrian on livestream,
 * etc instead of having to search it minutes or hours." A mark is the one
 * thing about a clip or a screenshot that is the launcher's and not the
 * file's — the file is the game's, in a folder the player owns (see the
 * screenshots note in main.js: they are read where they lie), and nothing is
 * written into it or beside it. So the marks live here, in one small JSON
 * beside the settings: the clips by name, the screenshots by the
 * "<profile>/<file>" id the listing already hands out. `clips:list` and
 * `shots:list` read it onto each item as `favourite`, the star on a card
 * toggles it, and a delete through the launcher takes the mark with the file.
 *
 * Written whole and atomically — a temp file renamed over the real one, the
 * way the store writes settings — so a bad shutdown leaves the last good
 * file and never half of one. Read once at start; anything unreadable is an
 * empty set, because a mark is worth keeping and not worth refusing to start
 * over.
 *
 * A file deleted outside the launcher leaves its mark behind, on purpose. A
 * list that finds the folder empty (a Videos folder on a drive that is not
 * plugged in) must not be taken as the player unstarring everything, and a
 * mark for a name that is gone matches nothing and costs nothing.
 */

const path = require('path');
const fs = require('fs');

const FILE = 'favourites.json';
const KINDS = ['clips', 'shots'];
/** Beyond this the renderer is asking for something no player did. */
const MAX = 5000;

let file = null;
let marks = empty();

function empty() {
  return { clips: new Set(), shots: new Set() };
}

/** Point the marks at the launcher's own folder and read what is there. */
function init(userDataDir) {
  file = path.join(userDataDir, FILE);
  marks = empty();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const kind of KINDS) {
      const list = Array.isArray(parsed?.[kind]) ? parsed[kind] : [];
      for (const id of list.slice(0, MAX)) if (typeof id === 'string') marks[kind].add(id);
    }
  } catch {
    /* none yet, or unreadable: start empty */
  }
}

/** Whether `id` of `kind` ('clips' or 'shots') is starred. */
function has(kind, id) {
  return marks[kind]?.has(id) === true;
}

/**
 * Star or unstar one; answers whether the file now says so. The id is what
 * the listing spells — the caller has already resolved it against the real
 * file, so nothing lands here that the folder did not offer.
 */
function mark(kind, id, on) {
  const set = marks[kind];
  if (!set || typeof id !== 'string' || !id) return false;
  if (set.has(id) === Boolean(on)) return true;
  if (on && set.size >= MAX) return false;
  if (on) set.add(id);
  else set.delete(id);
  return save();
}

/** The mark goes with the file: called once a delete has gone through. */
function drop(kind, id) {
  return mark(kind, id, false);
}

function save() {
  if (!file) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ clips: [...marks.clips], shots: [...marks.shots] }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (error) {
    console.error('[favourites] failed to persist:', error.message);
    return false;
  }
}

module.exports = { init, has, mark, drop, FILE };
