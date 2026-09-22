'use strict';

/**
 * Two things Windows decides about the game's process that the launcher can
 * decide better (2026-09-20).
 *
 * **Which graphics card draws it.** A laptop with a chip in the processor and
 * a proper card beside it picks per program, and a Java it has never heard
 * of can land on the chip — the game then runs at a third of the frames it
 * should, and every setting in Video Settings is beside the point. Windows
 * keeps the choice per executable under
 * `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` (Settings → System →
 * Display → Graphics is a front end for the same key), and `GpuPreference=2`
 * is "High performance". So the runtime's own `javaw.exe` is written there
 * before the first launch on it — and only when Windows has no line for it
 * yet: a line the player set themselves, whichever way, is theirs. This PC
 * is exactly that laptop (Intel UHD beside an RTX 5050), which is how the
 * question came up.
 *
 * **How much of the processor it gets.** The game is started a step above
 * normal priority, so when Discord, a browser and the launcher itself want
 * the same cores mid-fight the frame wins the argument. Above normal, not
 * high: high starves the sound service and the very things a player is
 * talking through. Nothing here needs administrator rights.
 */

const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const HIGH_PERFORMANCE = 'GpuPreference=2;';

/** The binaries already looked at this run, so a Play press reads nothing twice. */
const seen = new Map();

function reg(args) {
  return new Promise((resolve) => {
    try {
      execFile('reg', args, { timeout: 4000, windowsHide: true }, (error, stdout) => {
        resolve({ ok: !error, out: String(stdout || '') });
      });
    } catch {
      resolve({ ok: false, out: '' });
    }
  });
}

/**
 * Make sure Windows draws `binary` on the high-performance card, unless the
 * player has already said otherwise. Never throws; answers what it did:
 * `set`, `kept` (a line was there), `none` (not Windows, or the registry
 * refused).
 */
async function prefer(binary) {
  if (process.platform !== 'win32' || !binary) return 'none';
  const exe = path.resolve(binary);
  if (seen.has(exe)) return seen.get(exe);
  const work = (async () => {
    const query = await reg(['query', KEY, '/v', exe]);
    if (query.ok && /GpuPreference=/i.test(query.out)) return 'kept';
    const add = await reg(['add', KEY, '/v', exe, '/t', 'REG_SZ', '/d', HIGH_PERFORMANCE, '/f']);
    return add.ok ? 'set' : 'none';
  })();
  seen.set(exe, work);
  const answer = await work;
  seen.set(exe, answer);
  return answer;
}

/**
 * Lift a freshly spawned game a step above normal. Never throws: a process
 * that has already gone, or a Windows that refuses, leaves it where it was.
 */
function raise(pid) {
  if (!pid) return false;
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
    return true;
  } catch {
    return false;
  }
}

module.exports = { prefer, raise, KEY, HIGH_PERFORMANCE };
