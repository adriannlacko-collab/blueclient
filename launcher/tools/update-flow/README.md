# update-flow

The self-update path, end to end, before a release goes out (2026-09-23).

`drive.sh` runs the real `src/main/update.js` under Electron's own node
(`ELECTRON_RUN_AS_NODE`, so `process.versions.electron` is the real one), as a
packaged Windows build: `electron`, `https`, `electron-updater` and
`child_process` are stood in for by `run.js`, and `server.js` is a local fake
of the GitHub release downloads serving a made-up `1.12.0` bundle — a real
asar and a real tar.gz, so Electron's asar-aware `fs` and the sha512 check
see what they would in the wild. Nothing leaves the machine.

    ELECTRON=path/to/electron-44.4.3/electron launcher/tools/update-flow/drive.sh

What each scenario must show:

1. found, downloaded, verified and staged; "Restart to update" quits into
   one hidden swap host that copies app.asar, mirrors resources and relaunches
2. after the swap, the next start knows it took and clears its records
3. a launcher killed before its close applies the staged bundle at the next
   start, before any window
4. a swap that never takes is tried twice and then left to the installer
5. a bad sha512, 6. a release that moves Electron, 7. a dropped download and
9. no network all fall back to the installer channel, leaving nothing staged
8. "Get updates early" flipped during a look stages once, cleanly
10. closed without "Restart to update" and opened again while that close's
    swap is still waiting: the start starts no second script, asks the one
    running to relaunch and quits; once it has, the start on the new version
    clears the folder
11. the same with that swap's host gone (a reboot): the start applies the
    bundle itself, as in 3

And rescue.js, the second way to the newest version (boot.js loads it before
anything else):

R1. a start after one that never reached Home fetches the newer version at
    once, asks, and swaps with a relaunch
R2. an ordinary start only notes a new version — update.js has its turn
R3. a version seen for a day over three starts is put in by rescue itself
R4. overdue but moving Electron, and R5. overdue after two failed swaps:
    the download is offered instead, and opened on "Download"
R6. main.js will not load and a newer version exists: fetched and swapped
R7. main.js will not load and nothing is newer, and R12. the same offline:
    "could not start", with the download offered
R8. Home painting marks the start healthy; R9. "Later" swaps nothing
R10. boot joins a swap still waiting (writes its relaunch file) and leaves
     one whose host is gone alone
R11. rescue's newer() agrees with update.js's on every pair of a list

The swap script itself is Windows cmd and is not run here; scenario 2 does
its copy by hand. Run it on Windows for that half.
