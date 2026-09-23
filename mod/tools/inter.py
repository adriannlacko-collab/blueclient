#!/usr/bin/env python3
"""Mojang name -> intermediary name, for the reflective lookups a 1.2x patch makes.

    python3 mod/tools/inter.py 1.21.11 com.mojang.blaze3d.opengl.GlStateManager [member ...]

Prints the intermediary class name and, for each member (field or method), its
intermediary name and descriptor.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deps  # noqa: E402
import mojmap  # noqa: E402


def tables(mc):
    deps.intermediary_client(mc)
    inter = {}
    cls = None
    for line in (deps.CACHE / "mc" / mc / "intermediary.tiny").read_text().splitlines()[1:]:
        p = line.split("\t")
        if p[0] == "c":
            cls = p[1]
            inter[("c", cls)] = p[2]
        elif len(p) >= 5 and p[1] in ("f", "m"):
            inter[(p[1], cls, p[3], p[2])] = p[4]
    named = []
    cls = None
    for line in mojmap.tiny(mc).read_text().splitlines()[1:]:
        p = line.split("\t")
        if p[0] == "c":
            cls = p[1]
            named.append(("c", cls, p[2], None, None))
        elif len(p) >= 5 and p[1] in ("f", "m"):
            named.append((p[1], cls, p[4], p[3], p[2]))
    return inter, named


def main():
    mc, want = sys.argv[1], sys.argv[2].replace(".", "/")
    members = sys.argv[3:]
    inter, named = tables(mc)
    official = next((c for k, c, n, _, _ in named if k == "c" and n == want), None)
    if official is None:
        print("no such class", want)
        return
    print(want, "->", inter.get(("c", official), official))
    for k, c, n, off_name, desc in named:
        if k != "c" and c == official and (not members or n in members):
            print(f"  {k} {n} -> {inter.get((k, c, off_name, desc), off_name)}   (official {off_name} {desc})")


if __name__ == "__main__":
    main()
