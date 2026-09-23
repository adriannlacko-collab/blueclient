#!/usr/bin/env python3
"""Build the two bench probe jars (1.21.x intermediary names, 26.x Mojang names).

    python3 tools/bench/probe/build.py <javac> <sponge-mixin.jar> <out-dir>

No Gradle, no Loom: the probe is one plain class and one mixin whose targets
are strings (remap = false), so javac against the Mixin jar is enough.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))


def build(javac, mixin_jar, family, out):
    work = tempfile.mkdtemp(prefix='probe-')
    try:
        sources = [os.path.join(HERE, 'src', 'benchprobe', 'Probe.java'),
                   os.path.join(HERE, family, 'benchprobe', 'mixin', 'MinecraftMixin.java')]
        env = {k: v for k, v in os.environ.items() if k != 'JAVA_TOOL_OPTIONS'}
        subprocess.run([javac, '--release', '17', '-nowarn', '-proc:none', '-cp', mixin_jar, '-d', work] + sources,
                       check=True, env=env)
        mod = {
            'schemaVersion': 1,
            'id': 'benchprobe',
            'version': '1.0.0',
            'name': 'Bench probe',
            'environment': 'client',
            'mixins': ['benchprobe.mixins.json'],
            'depends': {'fabricloader': '>=0.15'}
        }
        mixins = {
            'required': True,
            'minVersion': '0.8',
            'package': 'benchprobe.mixin',
            'compatibilityLevel': 'JAVA_17',
            'client': ['MinecraftMixin'],
            'injectors': {'defaultRequire': 1}
        }
        target = os.path.join(out, f'benchprobe-{family}.jar')
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('fabric.mod.json', json.dumps(mod, indent=2))
            z.writestr('benchprobe.mixins.json', json.dumps(mixins, indent=2))
            for base, _, files in os.walk(work):
                for name in files:
                    full = os.path.join(base, name)
                    z.write(full, os.path.relpath(full, work))
        print(target)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    javac, mixin_jar, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    for family in ('int', 'moj'):
        build(javac, mixin_jar, family, out)
