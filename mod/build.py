#!/usr/bin/env python3
"""Rebuild the BlueClient companion jars with a few classes patched.

    python3 mod/build.py                      # all ten versions -> launcher/resources/mod/
    python3 mod/build.py --versions 26.3      # just one
    python3 mod/build.py --out /tmp/mods      # somewhere else
    python3 mod/build.py --no-verify          # skip the javap report

For every Minecraft version the released jar is taken from the v1.11.0 bundle,
the sources under mod/patches/<version>/ are compiled with javac against that
jar + the (intermediary-mapped, for 1.2x) Minecraft client + Fabric Loader,
Mixin, Fabric API and Minecraft's own libraries, and only the resulting .class
entries are swapped into a copy of the jar. Everything else in the jar keeps
its bytes. Versions without a patches/ folder are copied through unchanged, and
so is blueclient-shared.zip, so the output folder is a complete
resources/mod/ for the launcher.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))
import deps  # noqa: E402
import jarpatch  # noqa: E402
import javapdiff  # noqa: E402

MOD = Path(__file__).resolve().parent
PATCHES = MOD / "patches"
BASELINE = MOD / "baseline"
DEFAULT_OUT = MOD.parent / "launcher" / "resources" / "mod"


def compile_patch(mc, sources, workdir):
    jdk = deps.jdk25()
    classes = workdir / "classes"
    shutil.rmtree(classes, ignore_errors=True)
    classes.mkdir(parents=True)
    classpath = ":".join(str(p) for p in deps.compile_classpath(mc))
    argfile = workdir / "javac.args"
    argfile.write_text("\n".join([
        "--release", str(deps.java_release(mc)),
        "-proc:none", "-encoding", "UTF-8", "-g", "-nowarn", "-Xlint:none",
        "-cp", classpath,
        "-d", str(classes),
        *[str(s) for s in sources],
    ]))
    subprocess.run([str(jdk / "bin" / "javac"), f"@{argfile}"], check=True)
    out = {}
    for f in classes.rglob("*.class"):
        out[f.relative_to(classes).as_posix()] = f.read_bytes()
    return out


def _member_report(javap, before, after, indent="      "):
    d = javapdiff.diff(javap, before, after)
    lines = [f"{len(d['changed'])} changed, {len(d['added'])} added, {len(d['removed'])} removed, {d['same']} identical"]
    for key in ("changed", "added", "removed"):
        for m in d[key]:
            lines.append(f"{indent}{key}: {m}")
    return lines


def verify(mc, original, patched_jar, compiled, baseline):
    """
    Two reports per patched class, by javap -c -p:
      patch:     the untouched decompiled source recompiled -> the patched source
                 (what the patch itself changes; the same compiler on both sides)
      recompile: the released class -> the untouched decompiled source recompiled
                 (what decompiling and recompiling alone changes; expected to be
                 branch layout and lambda numbering only, reviewed by hand)
    and a check that every entry that was not patched is byte-for-byte the same.
    """
    javap = deps.jdk25() / "bin" / "javap"
    lines = []
    with zipfile.ZipFile(original) as a, zipfile.ZipFile(patched_jar) as b:
        names_a = set(a.namelist())
        for name in sorted(compiled):
            after = b.read(name)
            if name not in baseline:
                lines.append(f"  {name}: new class (no baseline)")
                continue
            head, *rest = _member_report(javap, baseline[name], after)
            lines.append(f"  {name}  patch: {head}")
            lines.extend(rest)
            if name in names_a:
                d = javapdiff.diff(javap, a.read(name), baseline[name])
                semantic = [m for m in d["changed"] if m not in d["layout_only"]]
                lines.append(f"  {name}  recompile: {len(d['layout_only'])} member(s) differ only in branch layout; "
                             f"{d['renumbered_lambdas']} lambda(s) only renumbered; {len(semantic)} other, {len(d['added'])} added, {len(d['removed'])} removed")
                for m in semantic + d["added"] + d["removed"]:
                    lines.append(f"      review: {m}")
        for info in a.infolist():
            if info.filename in compiled:
                continue
            if info.filename not in b.namelist():
                lines.append(f"  dropped: {info.filename}")
                continue
            if a.read(info.filename) != b.read(info.filename):
                raise RuntimeError(f"{mc}: {info.filename} changed but was not patched")
    return lines


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--versions", nargs="*", default=deps.VERSIONS)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--no-verify", action="store_true")
    args = ap.parse_args()

    bundle = deps.bundle()
    args.out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(bundle / "blueclient-shared.zip", args.out / "blueclient-shared.zip")
    report = {}
    for mc in deps.VERSIONS:
        original = bundle / f"blueclient-{mc}.jar"
        target = args.out / original.name
        sources = sorted((PATCHES / mc).rglob("*.java")) if (PATCHES / mc).is_dir() else []
        if mc not in args.versions or not sources:
            shutil.copy2(original, target)
            continue
        print(f"== {mc}: {len(sources)} patched source(s)", flush=True)
        with tempfile.TemporaryDirectory() as tmp:
            compiled = compile_patch(mc, sources, Path(tmp))
        tmp_jar = target.with_name(target.name + ".part")
        changes = jarpatch.patch(original, tmp_jar, compiled)
        if not args.no_verify:
            base_sources = sorted((BASELINE / mc).rglob("*.java")) if (BASELINE / mc).is_dir() else []
            with tempfile.TemporaryDirectory() as tmp:
                baseline = compile_patch(mc, base_sources, Path(tmp)) if base_sources else {}
            for line in verify(mc, original, tmp_jar, compiled, baseline):
                print(line)
        tmp_jar.replace(target)
        report[mc] = changes
        print(f"   replaced {len(changes['replaced'])}, added {len(changes['added'])}, dropped {len(changes['dropped'])}")
    (MOD / "build").mkdir(exist_ok=True)
    (MOD / "build" / "report.json").write_text(json.dumps(report, indent=2))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
