#!/usr/bin/env python3
"""Allocation summary of a JFR recording made by test/run_game.py --jfr.

    python3 mod/tools/jfr_alloc.py mod/run/26.3-patched/alloc.jfr [--json out.json]

Runs tools/JfrAlloc.java, which streams the recording with jdk.jfr.consumer:
* render-thread allocation rate, exact: jdk.ThreadAllocationStatistics at the
  start and end of the recording;
* where it goes: every new-TLAB / outside-TLAB allocation event on the render
  thread (the harness pins TLABs to 16 KB, so one event per 16 KB), weighted by
  size and summed by the innermost com.blueclient frame on its stack.
"""

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deps  # noqa: E402


def main():
    java = deps.jdk25() / "bin" / "java"
    out = subprocess.run([str(java), "-Xmx1G", str(Path(__file__).resolve().parent / "JfrAlloc.java"), sys.argv[1]],
                         capture_output=True, text=True, check=True).stdout
    if "--json" in sys.argv:
        Path(sys.argv[sys.argv.index("--json") + 1]).write_text(out)
    print(out)


if __name__ == "__main__":
    main()
