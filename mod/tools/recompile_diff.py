#!/usr/bin/env python3
"""Print, member by member, how the released classes differ from the untouched
decompiled sources (mod/baseline/<mc>/) compiled again, for review by hand.

    python3 mod/tools/recompile_diff.py 26.3 [member-substring]
"""

import difflib
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import deps  # noqa: E402
import javapdiff  # noqa: E402
from build import BASELINE, compile_patch  # noqa: E402


def main():
    mc = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    javap = deps.jdk25() / "bin" / "javap"
    sources = sorted((BASELINE / mc).rglob("*.java"))
    with tempfile.TemporaryDirectory() as tmp:
        recompiled = compile_patch(mc, sources, Path(tmp))
    with zipfile.ZipFile(deps.original_jar(mc)) as jar:
        for name in sorted(recompiled):
            a = javapdiff.members(javap, jar.read(name))
            b = javapdiff.members(javap, recompiled[name])
            for key in sorted(a.keys() | b.keys()):
                if a.get(key) == b.get(key) or (only and only not in key):
                    continue
                print(f"===== {name} :: {key}")
                for line in difflib.unified_diff(a.get(key, []), b.get(key, []), lineterm="", n=1):
                    print(line)


if __name__ == "__main__":
    main()
