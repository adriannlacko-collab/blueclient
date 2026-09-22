'use strict';

/**
 * The launcher's version, and the name it gives itself on the network.
 *
 * One source: package.json, which electron-builder already stamps the
 * installer and the executable from. Three modules send HTTP requests
 * (game/files.js to Mojang, modrinth.js to Modrinth, skins.js to Mojang's
 * session servers) and Mojang's own argument templates want a launcher name
 * and version on the command line; all four used to carry a hand-typed 0.1.0
 * that was six releases stale, and one of them still called itself
 * BeamLauncher.
 *
 * Modrinth asks projects to identify themselves so they can get in touch about
 * abusive traffic rather than silently blocking, which is why the address is
 * part of the string.
 */

const { version } = require('../../package.json');

const NAME = 'BlueClient';
const USER_AGENT = `${NAME}/${version} (blueclient.net)`;

module.exports = { NAME, VERSION: version, USER_AGENT };
