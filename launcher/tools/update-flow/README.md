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

The swap script itself is Windows cmd and is not run here; scenario 2 does
its copy by hand. Run it on Windows for that half.
