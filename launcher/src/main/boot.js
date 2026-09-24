'use strict';

/**
 * The launcher's entry point (2026-09-24): the rescue, then everything else.
 *
 * main.js loads thirty-odd modules before it does anything, and a release in
 * which any one of them throws is a launcher that does nothing when clicked —
 * with the updater, one of those modules, never reached, so the release that
 * fixes it can never arrive. rescue.js (see there) is loaded first and on its
 * own, so that whatever breaks in main.js, something is still running that
 * can fetch the next version or say where to get it.
 */

const { app } = require('electron');

let rescue = null;
try {
  rescue = require('./rescue');
} catch {
  /* Without it the launcher is only what it always was. */
}

if (rescue && rescue.joinRunningSwap()) {
  // A swap script is waiting for this process to be gone, and relaunches
  // the launcher when it is done.
  app.exit(0);
} else {
  if (rescue) rescue.begin();
  try {
    require('./main');
  } catch (error) {
    if (!rescue) throw error;
    rescue.mainFailed(error);
  }
}
