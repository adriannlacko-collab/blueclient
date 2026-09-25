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
run() { ELECTRON_RUN_AS_NODE=1 $ELECTRON $S/run.js "$@" 2>&1 | grep -E "RESULT|CRASH|Error|DISAGREE" ; }
mode() { curl -s -X POST --data "$1" http://127.0.0.1:$PORT/__mode >/dev/null; }
MODE=ok node $S/server.js & SRV=$!; sleep 0.5
sleep 120 & LIVE2=$!
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
echo "== R1. rescue: the last start never reached Home, 1.12.0 is out — fetched, asked, swapped, relaunched"; mode ok; fresh r1
mkdir -p $W/r1/userData; echo '{"pending":true,"streak":0}' > $W/r1/userData/rescue.json
HOST_PID=$LIVE2 run rescue-start $W/r1 1.11.0
echo "== R2. rescue: an ordinary start, 1.12.0 just out — left to update.js, only noted"; fresh r2; mkdir -p $W/r2/userData
run rescue-start $W/r2 1.11.0
echo "== R3. rescue: seen for a day over three starts — update.js has not delivered it, so rescue does"; fresh r3; mkdir -p $W/r3/userData
echo "{\"seen\":{\"version\":\"1.12.0\",\"at\":$(( $(date +%s%3N) - 90000000 )),\"starts\":2}}" > $W/r3/userData/rescue.json
run rescue-start $W/r3 1.11.0
echo "== R4. rescue: overdue, but the release moves Electron — the download is offered instead"; mode electron; fresh r4; mkdir -p $W/r4/userData
echo "{\"seen\":{\"version\":\"1.12.0\",\"at\":$(( $(date +%s%3N) - 90000000 )),\"starts\":5}}" > $W/r4/userData/rescue.json
run rescue-start $W/r4 1.11.0
echo "== R5. rescue: overdue, but two of its swaps already failed — the download is offered"; mode ok; fresh r5; mkdir -p $W/r5/userData
echo "{\"seen\":{\"version\":\"1.12.0\",\"at\":$(( $(date +%s%3N) - 90000000 )),\"starts\":5},\"attempt\":{\"version\":\"1.12.0\"},\"failed\":{\"1.12.0\":1}}" > $W/r5/userData/rescue.json
run rescue-start $W/r5 1.11.0
echo "== R6. rescue: main.js will not load, 1.12.0 is out — fetched and swapped with no launcher behind it"; fresh r6
run rescue-failed $W/r6 1.11.0
echo "== R7. rescue: main.js will not load, nothing newer — says so and offers the installer"; fresh r7
run rescue-failed $W/r7 1.12.0
echo "== R8. rescue: Home painted — the start is counted healthy"; fresh r8; mkdir -p $W/r8/userData
echo '{"pending":true,"streak":2}' > $W/r8/userData/rescue.json
run rescue-healthy $W/r8 1.11.0
echo "== R9. rescue: the player says Later — nothing swaps"; fresh r9; mkdir -p $W/r9/userData
echo '{"pending":true}' > $W/r9/userData/rescue.json
DIALOG=1 run rescue-start $W/r9 1.11.0
echo "== R10. boot: a start while a swap waits joins it; with its host gone it does not"
sleep 60 & LIVE3=$!
fresh r10; mkdir -p $W/r10/userData/update-bundle/1
echo "{\"pid\":$LIVE3,\"at\":$(date +%s%3N),\"result\":\"$W/r10/userData/swap-1.result\",\"relaunch\":\"$W/r10/userData/update-bundle/1/relaunch\"}" > $W/r10/userData/swap-running.json
run rescue-join $W/r10 1.11.0; echo "   relaunch file: $( [ -f $W/r10/userData/update-bundle/1/relaunch ] && echo written || echo missing )"
kill $LIVE3 2>/dev/null; wait $LIVE3 2>/dev/null
run rescue-join $W/r10 1.11.0
echo "== R11. rescue's newer() agrees with update.js's"; run rescue-versions $W/r11 1.11.0
kill $SRV; sleep 0.3
echo "== 9. offline"; fresh h; run look $W/h 1.11.0
echo "== R12. rescue offline: main.js will not load and nothing answers — still says so"; fresh r12
run rescue-failed $W/r12 1.11.0
