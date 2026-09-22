#!/usr/bin/env python3
"""Show the normalized javap -c difference of changed members between two class files.

    python3 mod/tools/methoddiff.py A.class B.class [member-substring]
"""

import difflib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deps  # noqa: E402
import javapdiff  # noqa: E402


def main():
    a_path, b_path = sys.argv[1], sys.argv[2]
    only = sys.argv[3] if len(sys.argv) > 3 else None
    javap = deps.jdk25() / "bin" / "javap"
    a = javapdiff.members(javap, Path(a_path).read_bytes())
    b = javapdiff.members(javap, Path(b_path).read_bytes())
    for key in sorted(a.keys() | b.keys()):
        if only and only not in key:
            continue
        if a.get(key) == b.get(key):
            continue
        print("=====", key)
        for line in difflib.unified_diff(a.get(key, []), b.get(key, []), lineterm="", n=2):
            print(line)


if __name__ == "__main__":
    main()
