"""Download and cache everything the patch pipeline and the test harness need.

Nothing here talks to blueclient.net: the only hosts are Mojang's piston
servers, maven.fabricmc.net / meta.fabricmc.net, GitHub release assets (the
BlueClient bundle and Temurin) and api.adoptium.net.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MOD = HERE.parent
CACHE = Path(os.environ.get("BLUECLIENT_MOD_CACHE", MOD / ".cache"))

BUNDLE_URL = "https://github.com/adriannlacko-collab/blueclient/releases/download/v1.11.0/bundle.tar.gz"
MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
FABRIC_MAVEN = "https://maven.fabricmc.net/"
FABRIC_META = "https://meta.fabricmc.net/v2/"
TEMURIN_25 = "https://api.adoptium.net/v3/binary/latest/25/ga/linux/x64/jdk/hotspot/normal/eclipse"

VERSIONS = ["1.20.6", "1.21.1", "1.21.4", "1.21.5", "1.21.8", "1.21.10", "1.21.11", "26.1.2", "26.2", "26.3"]

LOADER = "0.19.5"          # what the jars were built with (MANIFEST Fabric-Loader-Version)
TINY_REMAPPER = "0.14.1"


def log(*parts):
    print("[deps]", *parts, file=sys.stderr, flush=True)


def obfuscated(mc):
    """1.2x ship obfuscated and the mod targets intermediary; 26.x is unobfuscated."""
    return not mc.startswith("26.")


def java_release(mc):
    return 25 if mc.startswith("26.") else 21


# --------------------------------------------------------------- fetching

def fetch(url, dest, sha1=None):
    dest = Path(dest)
    if dest.exists() and (sha1 is None or _sha1(dest) == sha1):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    for attempt in range(4):
        log("GET", url)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "blueclient-mod-patcher"})
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
        except OSError as e:
            if attempt == 3:
                raise
            log("retrying after", e)
            continue
        if sha1 is None or _sha1(tmp) == sha1:
            tmp.replace(dest)
            return dest
        tmp.unlink()
        log("sha1 mismatch (a cut-off download?), retrying")
    raise RuntimeError(f"sha1 mismatch for {url}")


def fetch_json(url, dest):
    return json.loads(Path(fetch(url, dest)).read_text())


def _sha1(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def maven_path(coord):
    parts = coord.split(":")
    group, artifact, version = parts[0], parts[1], parts[2]
    classifier = parts[3] if len(parts) > 3 else None
    name = f"{artifact}-{version}" + (f"-{classifier}" if classifier else "") + ".jar"
    return f"{group.replace('.', '/')}/{artifact}/{version}/{name}"


def maven(coord, repo=FABRIC_MAVEN):
    rel = maven_path(coord)
    return fetch(repo + rel, CACHE / "maven" / rel)


# ------------------------------------------------------------ the bundle

def bundle():
    """resources/mod/ of the v1.11.0 launcher bundle: ten jars + the shared zip."""
    out = CACHE / "bundle"
    marker = out / "resources" / "mod" / "blueclient-shared.zip"
    if not marker.exists():
        tgz = fetch(BUNDLE_URL, CACHE / "bundle.tar.gz")
        with tarfile.open(tgz) as t:
            members = [m for m in t.getmembers() if m.name.lstrip("./").startswith("resources/mod/")]
            t.extractall(out, members=members)
    return out / "resources" / "mod"


def original_jar(mc):
    return bundle() / f"blueclient-{mc}.jar"


# ----------------------------------------------------------------- the JDK

def jdk25():
    """A JDK whose javac can target both 21 and 25."""
    home = os.environ.get("JDK25_HOME")
    if home and (Path(home) / "bin" / "javac").exists():
        return Path(home)
    out = CACHE / "jdk25"
    if not (out / "bin" / "javac").exists():
        tgz = fetch(TEMURIN_25, CACHE / "jdk25.tar.gz")
        tmp = CACHE / "jdk25.tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        with tarfile.open(tgz) as t:
            t.extractall(tmp)
        (top,) = [p for p in tmp.iterdir() if p.is_dir()]
        shutil.rmtree(out, ignore_errors=True)
        top.rename(out)
        shutil.rmtree(tmp, ignore_errors=True)
    return out


# ------------------------------------------------------------ minecraft

def version_json(mc):
    manifest = fetch_json(MANIFEST_URL, CACHE / "mc" / "version_manifest_v2.json")
    entry = next((v for v in manifest["versions"] if v["id"] == mc), None)
    if entry is None:
        # a stale cached manifest may predate the version
        (CACHE / "mc" / "version_manifest_v2.json").unlink()
        manifest = fetch_json(MANIFEST_URL, CACHE / "mc" / "version_manifest_v2.json")
        entry = next(v for v in manifest["versions"] if v["id"] == mc)
    return fetch_json(entry["url"], CACHE / "mc" / mc / f"{mc}.json")


def client_jar(mc):
    info = version_json(mc)["downloads"]["client"]
    return fetch(info["url"], CACHE / "mc" / mc / "client.jar", info["sha1"])


def server_jar(mc):
    info = version_json(mc)["downloads"]["server"]
    return fetch(info["url"], CACHE / "mc" / mc / "server.jar", info["sha1"])


def _rules_allow(rules):
    if not rules:
        return True
    allowed = False
    for rule in rules:
        os_rule = rule.get("os")
        if os_rule and os_rule.get("name") not in (None, "linux"):
            continue
        if os_rule and os_rule.get("arch") and os_rule["arch"] not in ("x86_64", "amd64"):
            continue
        if rule.get("features"):
            continue
        allowed = rule["action"] == "allow"
    return allowed


def libraries(mc):
    """Every library jar the vanilla client puts on its classpath on Linux x64."""
    out = []
    for lib in version_json(mc)["libraries"]:
        if not _rules_allow(lib.get("rules")):
            continue
        art = lib.get("downloads", {}).get("artifact")
        if art:
            out.append(fetch(art["url"], CACHE / "libraries" / art["path"], art["sha1"]))
        # pre-1.19-style natives (not used by these versions, kept for safety)
        natives = lib.get("natives", {}).get("linux")
        if natives:
            info = lib["downloads"]["classifiers"][natives]
            out.append(fetch(info["url"], CACHE / "libraries" / info["path"], info["sha1"]))
    return out


def intermediary_client(mc):
    """The client jar remapped official -> intermediary, which is what the 1.2x jars link against."""
    out = CACHE / "mc" / mc / "client-intermediary.jar"
    if out.exists():
        return out
    v2 = maven(f"net.fabricmc:intermediary:{mc}:v2")
    tiny = CACHE / "mc" / mc / "intermediary.tiny"
    tiny.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(v2) as z:
        tiny.write_bytes(z.read("mappings/mappings.tiny"))
    remapper = maven(f"net.fabricmc:tiny-remapper:{TINY_REMAPPER}:fat")
    java = jdk25() / "bin" / "java"
    tmp = out.with_name(out.name + ".part")
    cmd = [str(java), "-jar", str(remapper), str(client_jar(mc)), str(tmp), str(tiny), "official", "intermediary",
           *map(str, libraries(mc)), "--ignoreConflicts", "--renameInvalidLocals"]
    log("remap", mc, "official -> intermediary")
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    tmp.replace(out)
    return out


def compile_minecraft(mc):
    return intermediary_client(mc) if obfuscated(mc) else client_jar(mc)


# ----------------------------------------------------------------- fabric

def fabric_profile(mc, loader=LOADER):
    return fetch_json(f"{FABRIC_META}versions/loader/{mc}/{loader}/profile/json",
                      CACHE / "fabric" / f"profile-{mc}-{loader}.json")


def fabric_libraries(mc, loader=LOADER):
    """Loader, intermediary, mixin, mixinextras, asm — what the Fabric profile adds."""
    out = []
    for lib in fabric_profile(mc, loader)["libraries"]:
        out.append(maven(lib["name"], lib.get("url") or FABRIC_MAVEN))
    return out


def fabric_api_version(mc):
    meta = CACHE / "fabric" / "fabric-api-metadata.xml"
    if not meta.exists() or os.environ.get("BLUECLIENT_REFRESH"):
        fetch(FABRIC_MAVEN + "net/fabricmc/fabric-api/fabric-api/maven-metadata.xml", meta)
    import re
    found = re.findall(r"<version>([^<]+)</version>", meta.read_text())
    mine = [v for v in found if v.endswith("+" + mc)]
    if not mine:
        raise RuntimeError(f"no Fabric API build for {mc}")

    def key(v):
        return tuple(int(x) for x in v.split("+")[0].split("."))
    return max(mine, key=key)


def fabric_api(mc):
    return maven(f"net.fabricmc.fabric-api:fabric-api:{fabric_api_version(mc)}")


def fabric_api_modules(mc):
    """The module jars nested in the Fabric API jar (the API jar itself has no classes)."""
    jar = fabric_api(mc)
    out_dir = CACHE / "fabric" / f"api-{fabric_api_version(mc)}"
    if not (out_dir / ".done").exists():
        out_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(jar) as z:
            for name in z.namelist():
                if name.startswith("META-INF/jars/") and name.endswith(".jar"):
                    (out_dir / Path(name).name).write_bytes(z.read(name))
        (out_dir / ".done").write_text("")
    return sorted(p for p in out_dir.glob("*.jar"))


def compile_classpath(mc):
    """Everything javac needs to resolve a BlueClient class for this Minecraft."""
    return [original_jar(mc), compile_minecraft(mc), *libraries(mc), *fabric_libraries(mc), *fabric_api_modules(mc)]


if __name__ == "__main__":
    for v in sys.argv[1:] or VERSIONS:
        for p in compile_classpath(v):
            pass
        log(v, "ready; fabric-api", fabric_api_version(v))
