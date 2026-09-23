#!/usr/bin/env python3
"""Which candidate mods Modrinth has a Fabric build of, for every Minecraft the launcher supports.

    python3 tools/bench/availability.py [slug ...]

The same question mods.js asks (a version listed for this game version on
this loader), asked once per project.
"""
import json
import sys
import time
import urllib.parse
import urllib.request

VERSIONS = ['1.20.6', '1.21.1', '1.21.4', '1.21.5', '1.21.8', '1.21.10', '1.21.11', '26.1.2', '26.2', '26.3']
CANDIDATES = ['modernfix', 'scalablelux', 'c2me-fabric', 'noisium', 'ebe', 'fastquit', 'threadtweak',
              'clumps', 'debugify', 'memoryleakfix', 'krypton', 'no-chat-reports']
UA = 'BlueClient-bench/1.11.0 (bench; github.com/adriannlacko-collab/blueclient)'


def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 ** attempt)
    raise RuntimeError(url)


def main(slugs):
    print('| mod | ' + ' | '.join(VERSIONS) + ' |')
    print('|---|' + '---|' * len(VERSIONS))
    for slug in slugs:
        versions = get(f'https://api.modrinth.com/v2/project/{slug}/version?loaders=' + urllib.parse.quote('["fabric"]'))
        if versions is None:
            print(f'| {slug} | ' + ' | '.join(['(no project)'] * len(VERSIONS)) + ' |')
            continue
        cells = []
        for v in VERSIONS:
            hit = [x for x in versions if v in x['game_versions']]
            cells.append(hit[0]['version_number'][:18] if hit else '—')
        print(f'| {slug} | ' + ' | '.join(cells) + ' |')


if __name__ == '__main__':
    main(sys.argv[1:] or CANDIDATES)
