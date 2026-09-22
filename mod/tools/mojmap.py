#!/usr/bin/env python3
"""Mojang-named copies of the 1.2x client jars, for reading the game's code while writing a patch.

    python3 mod/tools/mojmap.py 1.21.11      # -> .cache/mc/1.21.11/client-named.jar
    python3 mod/tools/mojmap.py 1.21.11 --lookup class_4493 [member]

The official ProGuard mappings (client_mappings in the version JSON) are turned
into a tiny v2 file official -> named and applied to the obfuscated client jar
with tiny-remapper. `--lookup` translates an intermediary name, as the 1.2x
BlueClient classes spell it, to the Mojang name. Only used to read code; the
patched classes are still compiled against the intermediary jar.
"""

import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deps  # noqa: E402

PRIMS = {"void": "V", "boolean": "Z", "byte": "B", "char": "C", "short": "S", "int": "I", "long": "J",
         "float": "F", "double": "D"}


def proguard(mc):
    info = deps.version_json(mc)["downloads"]["client_mappings"]
    return deps.fetch(info["url"], deps.CACHE / "mc" / mc / "client.txt", info["sha1"])


def parse(mc):
    classes = {}   # named -> official
    members = []   # (named class, kind, named name, named type/desc, official name)
    current = None
    for line in Path(proguard(mc)).read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        if not line.startswith(" "):
            named, off = line.rstrip(":").split(" -> ")
            classes[named] = off
            current = named
            continue
        line = line.strip()
        left, off = line.split(" -> ")
        left = re.sub(r"^\d+:\d+:", "", left)
        typ, rest = left.split(" ", 1)
        if "(" in rest:
            name, args = rest.split("(", 1)
            args = args.split(")")[0]
            members.append((current, "m", name, (typ, [a for a in args.split(",") if a]), off))
        else:
            members.append((current, "f", rest, typ, off))
    return classes, members


def desc(t, classes):
    dims = t.count("[]")
    base = t.replace("[]", "")
    if base in PRIMS:
        d = PRIMS[base]
    else:
        d = "L" + classes.get(base, base).replace(".", "/") + ";"
    return "[" * dims + d


def tiny(mc):
    out = deps.CACHE / "mc" / mc / "named.tiny"
    if out.exists():
        return out
    classes, members = parse(mc)
    by_class = {}
    for m in members:
        by_class.setdefault(m[0], []).append(m)
    lines = ["tiny\t2\t0\tofficial\tnamed"]
    for named, off in classes.items():
        lines.append(f"c\t{off.replace('.', '/')}\t{named.replace('.', '/')}")
        for _, kind, name, typ, offname in by_class.get(named, []):
            if kind == "f":
                lines.append(f"\tf\t{desc(typ, classes)}\t{offname}\t{name}")
            else:
                ret, args = typ
                d = "(" + "".join(desc(a, classes) for a in args) + ")" + desc(ret, classes)
                lines.append(f"\tm\t{d}\t{offname}\t{name}")
    out.write_text("\n".join(lines) + "\n")
    return out


def named_jar(mc):
    out = deps.CACHE / "mc" / mc / "client-named.jar"
    if out.exists():
        return out
    remapper = deps.maven(f"net.fabricmc:tiny-remapper:{deps.TINY_REMAPPER}:fat")
    subprocess.run([str(deps.jdk25() / "bin" / "java"), "-jar", str(remapper), str(deps.client_jar(mc)), str(out),
                    str(tiny(mc)), "official", "named", *map(str, deps.libraries(mc)), "--ignoreConflicts"],
                   check=True, stdout=subprocess.DEVNULL)
    return out


def lookup(mc, name, member=None):
    """intermediary class_/field_/method_ -> Mojang name."""
    deps.intermediary_client(mc)
    inter = {}
    cls = None
    for line in (deps.CACHE / "mc" / mc / "intermediary.tiny").read_text().splitlines():
        p = line.split("\t")
        if p[0] == "c":
            cls = p[1]
            inter[p[2]] = ("c", p[1], None)
        elif len(p) > 4 and p[1] in ("f", "m"):
            inter[p[-1]] = (p[1], p[-2], cls)
    named = {}
    ncls = None
    for line in tiny(mc).read_text().splitlines()[1:]:
        p = line.split("\t")
        if p[0] == "c":
            ncls = p[1]
            named[("c", p[1], None)] = p[2]
        else:
            named[(p[1], p[3], ncls)] = p[4]
    key = inter.get(name.split("/")[-1])
    if key is None:
        return None
    return named.get(key)


if __name__ == "__main__":
    mc = sys.argv[1]
    if len(sys.argv) > 3 and sys.argv[2] == "--lookup":
        for n in sys.argv[3:]:
            print(n, "->", lookup(mc, n))
    else:
        print(named_jar(mc))
