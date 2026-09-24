#!/bin/bash
# Usage: ELECTRON=/path/to/electron tools/update-flow/drive.sh   (needs tar, curl, node)
# Drives every update scenario against the real update.js.
S=$(cd "$(dirname "$0")" && pwd)
ELECTRON=${ELECTRON:?set ELECTRON to an electron binary of the version the launcher ships}
ASAR=${ASAR:-npx --yes @electron/asar}
W=${WORK:-$(mktemp -d)}
export UPDATE_JS=${UPDATE_JS:-$S/../../src/main/update.js}
export PORT=18777
mkdir -p $W/bundle/resources/mod
mkdir -p $W/newapp && echo '{"name":"x","version":"1.12.0"}' > $W/newapp/package.json && $ASAR pack $W/newapp $W/bundle/app.asar
echo -n "1.12.0" > $W/bundle/resources/bundle.version
head -c 3000000 /dev/urandom > $W/bundle/resources/mod/blueclient-26.3.jar
tar czf $W/bundle.tar.gz -C $W/bundle .
export TAR=$W/bundle.tar.gz
mkdir -p $W/oldapp && echo '{"name":"x","version":"1.11.0"}' > $W/oldapp/package.json && $ASAR pack $W/oldapp $W/oldapp.asar
fresh() { rm -rf $W/$1; mkdir -p $W/$1/install/resources/mod; cp $W/oldapp.asar $W/$1/install/app.asar; echo -n "1.11.0" > $W/$1/install/resources/bundle.version; echo old > $W/$1/install/resources/mod/old.jar; }
run() { ELECTRON_RUN_AS_NODE=1 $ELECTRON $S/run.js "$@" 2>&1 | grep -E "RESULT|CRASH|Error" ; }
mode() { curl -s -X POST --data "$1" http://127.0.0.1:$PORT/__mode >/dev/null; }
MODE=ok node $S/server.js & SRV=$!; sleep 0.5
echo "== 1. update found, downloaded, verified, staged; Restart to update"; fresh a; run install $W/a 1.11.0
echo "== 2. the swap script's work, then the next start on 1.12.0"
D=$(ls -d $W/a/userData/update-bundle/*/new); cp $D/app.asar $W/a/install/app.asar; rm -rf $W/a/install/resources; cp -r $D/resources $W/a/install/resources
R=$(ls $W/a/userData/swap-*.result 2>/dev/null | head -1); [ -z "$R" ] && R=$(python3 -c "import json;print(json.load(open('$W/a/userData/update-attempts.json'))['last']['result'])"); echo ok > "$R"
(cd $W && $ASAR extract-file a/install/app.asar package.json >/dev/null 2>&1 && cat package.json && rm -f package.json); cat $W/a/install/resources/bundle.version; echo; ls $W/a/install/resources/mod
run start-applies $W/a 1.12.0
run look $W/a 1.12.0
echo "   staging left: $(ls $W/a/userData/update-bundle 2>/dev/null | wc -l)  attempts: $(cat $W/a/userData/update-attempts.json)"
echo "== 3. staged, then the launcher is killed; next start (still 1.11.0) applies it"; fresh b; run look $W/b 1.11.0; run start-applies $W/b 1.11.0
echo "== 4. a swap that never takes: twice, then the installer channel"; fresh c; run install $W/c 1.11.0 >/dev/null; run start-applies $W/c 1.11.0; run start-applies $W/c 1.11.0; run look $W/c 1.11.0
echo "== 5. sha512 mismatch"; mode badsha; fresh d; run look $W/d 1.11.0; echo "   staging left: $(ls $W/d/userData/update-bundle 2>/dev/null | wc -l)"
echo "== 6. next release moves Electron"; mode electron; fresh e; run look $W/e 1.11.0
echo "== 7. connection drops mid-download"; mode drop; fresh f; run look $W/f 1.11.0; echo "   staging left: $(ls $W/f/userData/update-bundle 2>/dev/null | wc -l)"
echo "== 8. early-updates switch flipped during a slow look"; mode slow; fresh g
ELECTRON_RUN_AS_NODE=1 WAIT_MS=6000 $ELECTRON -e "
setTimeout(()=>{ const u=require(process.env.UPDATE_JS); u.recheck().then((r)=>console.log('RECHECK '+JSON.stringify(r))); }, 100);
process.argv=[process.argv[0],'$S/run.js','look','$W/g','1.11.0']; require('$S/run.js');" 2>&1 | grep -E "RESULT|RECHECK|CRASH"
echo "   server counts: $(curl -s http://127.0.0.1:$PORT/__counts)"
echo "== 10. closed without Restart to update, opened again while that swap still waits"; mode ok; fresh j
sleep 60 & LIVE=$!
HOST_PID=$LIVE run close $W/j 1.11.0
run start-applies $W/j 1.11.0
echo "   the script finishes: result ok, and the relaunch file it reads is $( [ -f "$(dirname $(ls $W/j/userData/update-bundle/*/staged.json))/relaunch" ] && echo there || echo missing )"
D=$(ls -d $W/j/userData/update-bundle/*/new); cp $D/app.asar $W/j/install/app.asar; rm -rf $W/j/install/resources; cp -r $D/resources $W/j/install/resources
R=$(python3 -c "import json;print(json.load(open('$W/j/userData/update-attempts.json'))['last']['result'])"); echo ok > "$R"
run start-applies $W/j 1.12.0
echo "   staging left: $(ls $W/j/userData/update-bundle 2>/dev/null | grep -v '^swap-' | wc -l)"
echo "== 11. the same, but that swap's host is gone (a reboot): the start applies it itself"; fresh k
HOST_PID=$LIVE run close $W/k 1.11.0 >/dev/null
kill $LIVE 2>/dev/null; wait $LIVE 2>/dev/null
run start-applies $W/k 1.11.0
kill $SRV; sleep 0.3
echo "== 9. offline"; fresh h; run look $W/h 1.11.0
