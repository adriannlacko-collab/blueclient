#!/usr/bin/env python3
"""Make the bench's template world for one Minecraft version.

    python3 tools/bench/world.py <bench-root> <mc> <java-binary>

A normal world with a fixed seed, generated once by Mojang's own dedicated
server (so the template is the same bytes for every run), plus a data pack
that makes each run the same workload: the player is put in spectator mode at
y=110 and moved +X a quarter block a tick (5 blocks/s, a walk), facing along
the path and a little down, with the time held at noon and the weather clear.
The world is copied fresh into the profile before every run, so every run
generates the same new chunks on the integrated server in the same order.
"""
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

SEED = '5316911983139663491'


def main(root, mc, java):
    version = json.load(open(os.path.join(root, 'root', 'versions', mc, mc + '.json')))
    server_dir = os.path.join(root, 'server', mc)
    os.makedirs(server_dir, exist_ok=True)
    jar = os.path.join(server_dir, 'server.jar')
    if not os.path.exists(jar):
        urllib.request.urlretrieve(version['downloads']['server']['url'], jar)
    with open(os.path.join(server_dir, 'eula.txt'), 'w') as f:
        f.write('eula=true\n')
    with open(os.path.join(server_dir, 'server.properties'), 'w') as f:
        f.write('\n'.join([
            'level-name=bench', 'level-seed=' + SEED, 'level-type=minecraft\\:normal',
            'online-mode=false', 'gamemode=spectator', 'view-distance=4', 'simulation-distance=4',
            'spawn-protection=0', 'generate-structures=true', 'server-port=25599', ''
        ]))
    shutil.rmtree(os.path.join(server_dir, 'bench'), ignore_errors=True)
    env = {k: v for k, v in os.environ.items() if k != 'JAVA_TOOL_OPTIONS'}
    proc = subprocess.Popen([java, '-Xmx2G', '-jar', 'server.jar', '--nogui'], cwd=server_dir,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, env=env)
    for line in proc.stdout:
        sys.stdout.write(line)
        if 'Done (' in line and 'For help' in line:
            proc.stdin.write('stop\n')
            proc.stdin.flush()
    proc.wait()

    with zipfile.ZipFile(os.path.join(root, 'root', 'versions', mc, mc + '.jar')) as z:
        data = json.loads(z.read('version.json'))['pack_version']['data_major']

    world = os.path.join(server_dir, 'bench')
    pack = os.path.join(world, 'datapacks', 'bench')
    fn = os.path.join(pack, 'data', 'bench', 'function')
    tags = os.path.join(pack, 'data', 'minecraft', 'tags', 'function')
    os.makedirs(fn, exist_ok=True)
    os.makedirs(tags, exist_ok=True)
    with open(os.path.join(pack, 'pack.mcmeta'), 'w') as f:
        json.dump({'pack': {'description': 'bench', 'pack_format': data,
                            'min_format': data, 'max_format': data}}, f)
    with open(os.path.join(fn, 'load.mcfunction'), 'w') as f:
        f.write('time set noon\nweather clear\n')
    with open(os.path.join(fn, 'tick.mcfunction'), 'w') as f:
        f.write('gamemode spectator @a[gamemode=!spectator]\n'
                'execute as @a at @s run tp @s ~0.25 110 ~ -90 30\n')
    with open(os.path.join(tags, 'load.json'), 'w') as f:
        json.dump({'values': ['bench:load']}, f)
    with open(os.path.join(tags, 'tick.json'), 'w') as f:
        json.dump({'values': ['bench:tick']}, f)

    template = os.path.join(root, 'worlds', mc)
    shutil.rmtree(template, ignore_errors=True)
    shutil.copytree(world, template)
    print('template', template)


if __name__ == '__main__':
    main(*sys.argv[1:4])
