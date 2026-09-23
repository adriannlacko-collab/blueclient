#!/usr/bin/env python3
"""Start the real game headless with Fabric + Fabric API + a BlueClient jar, into a test world.

    python3 mod/test/run_game.py 26.3                       # patched jar from launcher/resources/mod
    python3 mod/test/run_game.py 26.3 --jars /path/to/dir   # any folder of blueclient-<mc>.jar
    python3 mod/test/run_game.py 26.3 --original            # the released jar, for comparison

What it does:
  * makes (once, cached) a world with the dedicated server of that version,
    with a 20-line sidebar scoreboard in it (names and scores chosen so that
    the first fifteen found are not the fifteen the game shows);
  * lays out a game folder the way the launcher does: mods/blueclient.jar is
    the version's jar with blueclient-shared.zip merged in (jar entries first),
    beside the Fabric API jar;
  * writes a blueclient.json and a waypoint so the HUD, the scoreboard
    placement and the waypoint beam all draw;
  * runs Xvfb + Mesa llvmpipe, offline, --quickPlaySingleplayer, waits for
    the world, takes screenshots (java.awt.Robot), then closes the game and
    greps the log for mixin/class errors.

No network is needed by the game: its DNS is pinned to a hosts file holding
only localhost (-Djdk.net.hosts.file), so nothing it tries to reach — Mojang,
or the mod's own servers — can be resolved, and the proxy settings the sandbox
puts in JAVA_TOOL_OPTIONS are not passed to it.
"""

import argparse
import json
import os
import random
import shutil
import signal
import subprocess
import sys
import time
import uuid
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MOD = HERE.parent
sys.path.insert(0, str(MOD / "tools"))
import deps  # noqa: E402

WORLD = "bctest"
SCORE_NAMES = [
    # (name, score): the long names have the lowest scores, so the game leaves them out
    ("a_very_long_holder_name_that_is_wide", 1), ("another_extremely_long_name_here", 2),
    ("Alpha", 90), ("Bravo", 85), ("Charlie", 80), ("Delta", 75), ("Echo", 70), ("Foxtrot", 65),
    ("Golf", 60), ("Hotel", 55), ("India", 50), ("Juliett", 45), ("Kilo", 40), ("Lima", 35),
    ("Mike", 30), ("November", 25), ("Oscar", 20), ("Papa", 15), ("Quebec", 10), ("Romeo", 5),
]


def java_for(mc):
    if deps.java_release(mc) >= 25:
        return str(deps.jdk25() / "bin" / "java")
    return shutil.which("java") or str(deps.jdk25() / "bin" / "java")


def clean_env():
    env = dict(os.environ)
    for key in ("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"):
        env.pop(key, None)
    return env


# ------------------------------------------------------------------- world

def make_world(mc):
    out = deps.CACHE / "worlds" / mc / WORLD
    if (out / "level.dat").exists():
        return out
    server_dir = deps.CACHE / "worlds" / mc / "server"
    shutil.rmtree(server_dir, ignore_errors=True)
    server_dir.mkdir(parents=True)
    (server_dir / "eula.txt").write_text("eula=true\n")
    (server_dir / "server.properties").write_text("\n".join([
        f"level-name={WORLD}", "online-mode=false", "level-seed=424242", "spawn-protection=0",
        f"server-port={random.randint(30000, 60000)}", "view-distance=4", "simulation-distance=4",
        "sync-chunk-writes=false", "max-tick-time=-1", "enable-rcon=false", "enable-query=false",
        "server-ip=127.0.0.1", ""]))
    cmd = [java_for(mc), "-Xmx1G", "-Djdk.net.hosts.file=" + str(hosts_file()), "-jar",
           str(deps.server_jar(mc)), "--nogui"]
    print(f"[world] generating {mc} world with the dedicated server", flush=True)
    proc = subprocess.Popen(cmd, cwd=server_dir, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, env=clean_env())
    log = open(server_dir / "console.log", "w")
    deadline = time.time() + 600
    for line in proc.stdout:
        log.write(line)
        if "Done (" in line:
            break
        if time.time() > deadline:
            proc.kill()
            raise RuntimeError("server did not start")
    commands = ['scoreboard objectives add bc dummy "BlueClient test"', "scoreboard objectives setdisplay sidebar bc"]
    commands += [f"scoreboard players set {name} bc {score}" for name, score in SCORE_NAMES]
    commands += ["save-all flush", "stop"]
    for c in commands:
        proc.stdin.write(c + "\n")
        proc.stdin.flush()
        time.sleep(0.2)
    for line in proc.stdout:
        log.write(line)
    proc.wait(timeout=300)
    log.close()
    shutil.copytree(server_dir / WORLD, out)
    return out


def hosts_file():
    path = deps.CACHE / "hosts.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("127.0.0.1 localhost\n::1 localhost\n")
    return path


# --------------------------------------------------------------- game dir

def merged_jar(jar, shared, dest):
    """What mods.js/jar.js do: the version's own entries first, then the shared ones it lacks."""
    with zipfile.ZipFile(jar) as j, zipfile.ZipFile(shared) as s, zipfile.ZipFile(dest, "w") as out:
        names = set()
        for info in j.infolist():
            out.writestr(info, j.read(info.filename))
            names.add(info.filename)
        for info in s.infolist():
            if info.filename not in names:
                out.writestr(info, s.read(info.filename))


def blueclient_config(scoreboard_pos, defaults=False):
    """defaults=True: no module switched on or off, i.e. what a fresh install runs."""
    settings = {}
    if scoreboard_pos is not None:
        settings["scoreboard.pos"] = scoreboard_pos
    modules = {} if defaults else {"fps": True, "ping": True, "coords": True, "scoreboard": True, "armour": True,
                                   "waypoints": True, "keystrokes": True, "clock": True, "light": True}
    return {
        "activeProfile": "Default",
        "menuHintShown": True,
        "profiles": {"Default": {"modules": modules, "settings": settings}},
    }


def lay_out(mc, run_dir, jars_dir, scoreboard_pos, extra_config, defaults=False, modules=None, files=None):
    shutil.rmtree(run_dir, ignore_errors=True)
    (run_dir / "mods").mkdir(parents=True)
    (run_dir / "config").mkdir()
    (run_dir / "saves").mkdir()
    shutil.copy2(deps.fabric_api(mc), run_dir / "mods" / "fabric-api.jar")
    merged_jar(Path(jars_dir) / f"blueclient-{mc}.jar", Path(jars_dir) / "blueclient-shared.zip",
               run_dir / "mods" / "blueclient.jar")
    shutil.copytree(make_world(mc), run_dir / "saves" / WORLD)
    config = blueclient_config(scoreboard_pos, defaults)
    if modules:
        config["profiles"]["Default"]["modules"].update(json.loads(modules))
    if extra_config:
        config.update(json.loads(extra_config))
    (run_dir / "config" / "blueclient.json").write_text(json.dumps(config, indent=2))
    (run_dir / "config" / "blueclient-waypoints.json").write_text(json.dumps({
        f"world:{WORLD}": [{"name": "Beam here", "x": 8, "y": 70, "z": 8, "color": 3,
                            "dimension": "minecraft:overworld", "visible": True, "style": "beam"}]}))
    (run_dir / "options.txt").write_text("\n".join([
        "onboardAccessibility:false", "skipMultiplayerWarning:true", "tutorialStep:none",
        "joinedFirstServer:true", "pauseOnLostFocus:false", "renderDistance:4", "simulationDistance:5",
        "guiScale:2", "narrator:0", "soundCategory_master:0.0", "fullscreen:false", ""]))
    for spec in files or []:
        dest, src = spec.split("=", 1)
        (run_dir / dest).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, run_dir / dest)


def classpath(mc):
    """Vanilla libraries, minus any the Fabric profile brings its own version of (ASM on some
    versions; Loader refuses two), then the Fabric ones and the client — as a launcher merges them."""
    fabric = deps.fabric_libraries(mc)
    theirs = {(p.parts[-4], p.parts[-3]) for p in fabric}
    vanilla = [p for p in deps.libraries(mc) if (p.parts[-4], p.parts[-3]) not in theirs]
    return [*vanilla, *fabric, deps.client_jar(mc)]


# ------------------------------------------------------------------ run

def glx_shim():
    """The sRGB-visual shim 26.x needs under Xvfb (see glxshim.c), built once."""
    out = deps.CACHE / "glxshim.so"
    src = HERE / "glxshim.c"
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        subprocess.run(["cc", "-shared", "-fPIC", "-O2", "-o", str(out), str(src), "-ldl"], check=True)
    return out


def start_xvfb():
    display = f":{random.randint(50, 250)}"
    proc = subprocess.Popen(["Xvfb", display, "-screen", "0", "1280x720x24", "-nolisten", "tcp"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    if proc.poll() is not None:
        raise RuntimeError("Xvfb did not start")
    return proc, display


def screenshot(display, out, *keys):
    env = clean_env()
    env["DISPLAY"] = display
    subprocess.run([str(deps.jdk25() / "bin" / "java"), str(HERE / "Shot.java"), str(out), *keys],
                   env=env, check=False, timeout=120)


def jcmd_for(mc):
    java = Path(java_for(mc)).resolve()
    tool = java.parent / "jcmd"
    return str(tool if tool.exists() else deps.jdk25() / "bin" / "jcmd")


def allocation_settings():
    """JFR's profile settings with every new-TLAB and outside-TLAB allocation recorded with its stack.

    With TLABs pinned to 16 KB (see run()) that is one event per 16 KB a thread
    allocates: every allocation site that allocates at all shows up in
    proportion, rather than the few hundred samples a second the profile
    setting keeps."""
    out = deps.CACHE / "alloc.jfc"
    text = (deps.jdk25() / "lib" / "jfr" / "profile.jfc").read_text()
    for event in ("jdk.ObjectAllocationInNewTLAB", "jdk.ObjectAllocationOutsideTLAB"):
        head = f'<event name="{event}">'
        at = text.index(head)
        end = text.index("</event>", at)
        block = text[at:end].replace('control="gc-enabled-high">false<', 'control="gc-enabled-high">true<')
        text = text[:at] + block + text[end:]
    out.write_text(text)
    return out


def record(mc, game, run_dir, seconds):
    """A JFR recording of `seconds` of play: per-thread allocation totals, every TLAB refill with its stack, GC."""
    out = run_dir / "alloc.jfr"
    subprocess.run([jcmd_for(mc), str(game.pid), "JFR.start", "name=bc", f"settings={allocation_settings()}",
                    f"duration={seconds}s", f"filename={out}"],
                   env=clean_env(), check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(seconds + 8)
    return out


def run(mc, jars_dir, label, seconds, scoreboard_pos, extra_config, keep, jfr=0, defaults=False, modules=None,
        quit_at=None, files=None, shots=None):
    run_dir = MOD / "run" / f"{mc}-{label}"
    lay_out(mc, run_dir, jars_dir, scoreboard_pos, extra_config, defaults, modules, files)
    xvfb, display = start_xvfb()
    env = clean_env()
    env.update({"DISPLAY": display, "LIBGL_ALWAYS_SOFTWARE": "1", "GALLIUM_DRIVER": "llvmpipe"})
    if not deps.obfuscated(mc):
        env["LD_PRELOAD"] = str(glx_shim())
    env.setdefault("XDG_RUNTIME_DIR", str(deps.CACHE / "xdg"))
    Path(env["XDG_RUNTIME_DIR"]).mkdir(parents=True, exist_ok=True, mode=0o700)
    info = deps.version_json(mc)
    profile = deps.fabric_profile(mc)
    measure = ["-XX:TLABSize=16k", "-XX:-ResizeTLAB"] if jfr else []
    cmd = [java_for(mc), "-Xmx3G", "-Xss4M", *measure,
           "-Djdk.net.hosts.file=" + str(hosts_file()),
           *[a for a in profile.get("arguments", {}).get("jvm", [])],
           "-cp", ":".join(str(p) for p in classpath(mc)),
           profile["mainClass"],
           "--username", "Tester", "--version", mc, "--gameDir", str(run_dir),
           "--assetsDir", str(run_dir / "assets"), "--assetIndex", info["assetIndex"]["id"],
           "--uuid", str(uuid.uuid3(uuid.NAMESPACE_DNS, "OfflinePlayer:Tester")).replace("-", ""),
           "--accessToken", "0", "--userType", "legacy", "--versionType", "release",
           "--width", "1280", "--height", "720", "--quickPlaySingleplayer", WORLD]
    out = open(run_dir / "stdout.log", "w")
    print(f"[game] {mc} {label}: starting (DISPLAY {display})", flush=True)
    game = subprocess.Popen(cmd, cwd=run_dir, stdout=out, stderr=subprocess.STDOUT, env=env)
    joined = False
    started = time.time()
    deadline = time.time() + 900
    log = run_dir / "logs" / "latest.log"
    try:
        while time.time() < deadline and game.poll() is None:
            time.sleep(3)
            text = log.read_text(errors="replace") if log.exists() else ""
            if "joined the game" in text:
                joined = True
                break
            if "Failed to create backend" in text and "Created " not in text and time.time() - started > 120:
                break
        if joined:
            print(f"[game] joined the world; letting it render for {seconds}s", flush=True)
            time.sleep(seconds)
            if jfr:
                print(f"[game] recording {jfr}s with JFR", flush=True)
                record(mc, game, run_dir, jfr)
            screenshot(display, run_dir / "screen-world.png")
            for shot in shots or []:
                # "name=step step ...": Shot.java's keys, hold:KEY:ms, click:x,y and wait:ms, then a screenshot
                name, _, steps = shot.partition("=")
                screenshot(display, run_dir / f"screen-{name}.png", *steps.split())
            screenshot(display, run_dir / "screen-tab.png", "TAB")
            screenshot(display, run_dir / "screen-menu.png", "ESC", "wait:1500")
            if quit_at:
                # "Save and Quit to Title": the disconnect makes BlueClient's frame
                # clock log the session's frame count and frame-time percentiles.
                screenshot(display, run_dir / "screen-quit.png", f"click:{quit_at}", "wait:4000")
                until = time.time() + 90
                while time.time() < until and "Frames:" not in (log.read_text(errors="replace") if log.exists() else ""):
                    time.sleep(2)
    finally:
        if game.poll() is None:
            game.send_signal(signal.SIGTERM)
            try:
                game.wait(timeout=60)
            except subprocess.TimeoutExpired:
                game.kill()
        xvfb.terminate()
        out.close()
    report(run_dir, joined)
    if not keep:
        shutil.rmtree(run_dir / "saves", ignore_errors=True)
    return joined


def report(run_dir, joined):
    text = (run_dir / "stdout.log").read_text(errors="replace")
    bad = [line for line in text.splitlines()
           if any(k in line for k in ("Mixin apply", "MixinApplyError", "InvalidInjectionException",
                                      "NoSuchMethodError", "NoSuchFieldError", "ClassNotFoundException",
                                      "NoClassDefFoundError", "IncompatibleClassChangeError", "VerifyError",
                                      "AbstractMethodError", "Critical injection failure"))]
    ours = [line for line in text.splitlines() if "BlueClient" in line or "blueclient" in line]
    errors = [line for line in text.splitlines() if "/ERROR]" in line or "Exception" in line]
    summary = {"joined": joined, "linkage_or_mixin_errors": bad[:50], "blueclient_lines": ours[:80],
               "error_lines": errors[:80]}
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({"joined": joined, "linkage_or_mixin_errors": len(bad), "error_lines": len(errors)}))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mc")
    ap.add_argument("--jars", default=str(MOD.parent / "launcher" / "resources" / "mod"))
    ap.add_argument("--original", action="store_true", help="use the released jars from the bundle")
    ap.add_argument("--label", default=None)
    ap.add_argument("--seconds", type=int, default=120)
    ap.add_argument("--scoreboard-pos", default=None, help='JSON pair, e.g. "[0.0, 0.0]"')
    ap.add_argument("--config", default=None, help="JSON merged into the top of blueclient.json")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--quit-at", default=None, help="x,y of the pause menu's Save and Quit button (screen pixels)")
    ap.add_argument("--jfr", type=int, default=0, help="after --seconds, record this many seconds with JFR (alloc.jfr)")
    ap.add_argument("--defaults", action="store_true", help="leave every module at its default (a fresh install)")
    ap.add_argument("--modules", default=None, help='JSON of module switches on top, e.g. {"colour_saturation": true}')
    ap.add_argument("--file", action="append", default=[], metavar="DEST=SRC",
                    help="copy SRC into the game folder at DEST (e.g. config/blueclient-hotkeys.json=h.json)")
    ap.add_argument("--shot", action="append", default=[], metavar="NAME=STEPS",
                    help="after the world screenshot: press/click/wait (Shot.java steps, space-separated), "
                         "then save screen-NAME.png; repeatable, in order")
    args = ap.parse_args()
    jars = deps.bundle() if args.original else Path(args.jars)
    label = args.label or ("original" if args.original else "patched")
    pos = json.loads(args.scoreboard_pos) if args.scoreboard_pos else None
    ok = run(args.mc, jars, label, args.seconds, pos, args.config, args.keep, args.jfr, args.defaults, args.modules,
             args.quit_at, args.file, args.shot)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
