"""Which methods of a class changed, by `javap -c -p`, ignoring constant-pool numbering."""

import re
import subprocess
import tempfile
from pathlib import Path

_CP_REF = re.compile(r"#\d+(?:\.#\d+)?")


def members(javap, class_bytes):
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "C.class"
        f.write_bytes(class_bytes)
        text = subprocess.run([str(javap), "-c", "-p", str(f)], check=True, capture_output=True, text=True).stdout
    out = {}
    current = None
    for line in text.splitlines():
        if line.startswith("  ") and line[2:3] != " " and line.rstrip().endswith(";"):
            current = line.strip()
            out[current] = []
            continue
        if current is not None and line.startswith("    "):
            body = re.sub(r"\s+", " ", _CP_REF.sub("#", line.strip()))
            out[current].append(body)
    return out


_OFFSET = re.compile(r"^\d+: ")
_LAMBDA_NAME = re.compile(r"lambda\$(\w+?)\$\d+")
_TARGET = re.compile(r"\b(if\w*|goto|goto_w|jsr) \d+")
_SLOT = re.compile(r"\b([ailfd](?:load|store))(?:_| )\d+")


def _shape(body):
    """The instructions as a multiset, without offsets, jump targets or local slots."""
    out = []
    for line in body:
        if line.startswith(("Exception table", "from to target")) or re.match(r"^\d+ \d+ \d+ ", line):
            continue
        line = _OFFSET.sub("", line)
        line = _TARGET.sub(lambda m: m.group(1), line)
        line = _SLOT.sub(lambda m: m.group(1), line)
        line = line.replace("ldc_w ", "ldc ").replace("ldc2_w ", "ldc2 ")
        line = _LAMBDA_NAME.sub(r"lambda$\1$#", line)
        out.append(line)
    return sorted(out)


def layout_only(a_body, b_body):
    """True when two method bodies differ only in block order, jump targets and local slots
    (plus inverted branch conditions, which a reordered if/else produces)."""
    flip = {"ifeq": "ifne", "ifne": "ifeq", "iflt": "ifge", "ifge": "iflt", "ifgt": "ifle", "ifle": "ifgt",
            "ifnull": "ifnonnull", "ifnonnull": "ifnull", "if_icmpeq": "if_icmpne", "if_icmpne": "if_icmpeq",
            "if_icmplt": "if_icmpge", "if_icmpge": "if_icmplt", "if_icmpgt": "if_icmple", "if_icmple": "if_icmpgt",
            "if_acmpeq": "if_acmpne", "if_acmpne": "if_acmpeq"}

    def norm(body):
        return sorted(flip.get(x, x) if flip.get(x, x) < x else x for x in _shape(body)
                      if x not in ("goto", "return", "ireturn", "areturn", "freturn", "lreturn", "dreturn", "athrow"))
    return norm(a_body) == norm(b_body)


def _renumbered(a, b):
    """Synthetic lambda methods that only changed their number (javac versions count differently)."""
    added = sorted(b.keys() - a.keys())
    removed = sorted(a.keys() - b.keys())
    matched = set()
    for r in removed:
        for n in added:
            if n in matched:
                continue
            if _LAMBDA_NAME.sub(r"lambda$\1$#", r) == _LAMBDA_NAME.sub(r"lambda$\1$#", n) and layout_only(a[r], b[n]):
                matched.add(n)
                matched.add(r)
                break
    return matched


def diff(javap, before, after):
    a, b = members(javap, before), members(javap, after)
    changed = sorted(k for k in a.keys() & b.keys() if a[k] != b[k])
    renumbered = _renumbered(a, b)
    return {
        "layout_only": sorted(k for k in changed if layout_only(a[k], b[k])),
        "renumbered_lambdas": len(renumbered) // 2,
        "changed": changed,
        "added": sorted(k for k in b.keys() - a.keys() if k not in renumbered),
        "removed": sorted(k for k in a.keys() - b.keys() if k not in renumbered),
        "same": len([k for k in a.keys() & b.keys() if a[k] == b[k]]),
    }
