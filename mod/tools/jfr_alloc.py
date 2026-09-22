#!/usr/bin/env python3
"""Allocation summary of a JFR recording made by test/run_game.py --jfr.

    python3 mod/tools/jfr_alloc.py mod/run/26.3-patched/alloc.jfr [--json out.json]

* Render-thread allocation rate, exact: jdk.ThreadAllocationStatistics at the
  start and end of the recording (bytes the thread allocated in between).
* Where it goes, sampled: jdk.ObjectAllocationSample weights on the render
  thread, summed by the first com.blueclient frame on the stack (or by the top
  frame for the rest), plus the share of all sampled bytes that had a
  com.blueclient frame anywhere on the stack.
"""

import collections
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deps  # noqa: E402

RENDER = "Render thread"


def events(path, names):
    out = subprocess.run([str(deps.jdk25() / "bin" / "jfr"), "print", "--json", "--stack-depth", "64",
                          "--events", ",".join(names), str(path)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)["recording"]["events"]


def when(event):
    return datetime.fromisoformat(event["values"]["startTime"].replace("Z", "+00:00")).timestamp()


def frame_name(frame):
    method = frame.get("method") or {}
    owner = (method.get("type") or {}).get("name", "?")
    return f"{owner}.{method.get('name', '?')}:{frame.get('lineNumber', '?')}"


def summarise(path):
    stats = [e for e in events(path, ["jdk.ThreadAllocationStatistics"])
             if (e["values"].get("thread") or {}).get("javaName") == RENDER]
    stats.sort(key=when)
    rate = None
    seconds = None
    if len(stats) >= 2:
        seconds = when(stats[-1]) - when(stats[0])
        allocated = stats[-1]["values"]["allocated"] - stats[0]["values"]["allocated"]
        rate = allocated / seconds if seconds > 0 else None

    ours = collections.Counter()
    top = collections.Counter()
    total = 0
    blue = 0
    for e in events(path, ["jdk.ObjectAllocationSample"]):
        v = e["values"]
        if (v.get("eventThread") or {}).get("javaName") != RENDER:
            continue
        weight = v.get("weight", 0)
        total += weight
        frames = (v.get("stackTrace") or {}).get("frames") or []
        mine = next((f for f in frames if ((f.get("method") or {}).get("type") or {}).get("name", "").startswith("com.blueclient")), None)
        if mine is not None:
            blue += weight
            ours[f"{frame_name(mine)}  [{(v.get('objectClass') or {}).get('name', '?')}]"] += weight
        elif frames:
            top[frame_name(frames[0])] += weight
    return {
        "recording": str(path),
        "render_seconds": seconds,
        "render_alloc_mb_per_s": None if rate is None else rate / 1e6,
        "sampled_mb": total / 1e6,
        "blueclient_share": (blue / total) if total else None,
        "blueclient_sampled_mb": blue / 1e6,
        "top_blueclient": [(k, round(w / 1e6, 2)) for k, w in ours.most_common(15)],
        "top_other": [(k, round(w / 1e6, 2)) for k, w in top.most_common(10)],
    }


def main():
    result = summarise(Path(sys.argv[1]))
    if "--json" in sys.argv:
        Path(sys.argv[sys.argv.index("--json") + 1]).write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
