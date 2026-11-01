#!/usr/bin/env python3
"""Publishes OVERDRIVE to GitHub in one commit, without a browser. Every installed .exe then updates itself.

Uploads only what changed: the game files listed in version.json, version.json itself, and the source files that
belong in the repo (desktop launcher code, server code). Never uploads songs (.mp3/.odm), the intro video, accounts
(server/data), tools/, or any token. Files that were removed locally (like the old Electron launcher) are removed
from the repo too, but only from the folders this script manages.

  python3 desktop/release.py     first, when game files changed (bumps version.json)
  python3 desktop/publish.py     then this

It uses the same GitHub token as the server manager (server-manager/github-token.txt), which Nathan makes himself:
a fine-grained token for the OverDrive repo with Contents: read and write.
"""
import base64, hashlib, json, os, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
REPO, BRANCH = 'ROCKSTARB0I/OverDrive', 'main'
TOKEN_FILE = os.environ.get('OVERDRIVE_TOKEN_FILE') or os.path.join(os.path.dirname(GAME), 'server-manager', 'github-token.txt')
SOURCES = ['desktop/overdrive.c', 'desktop/overdrive.rc', 'desktop/overdrive.manifest', 'desktop/pack.py', 'desktop/release.py',
           'desktop/publish.py', 'desktop/lock-music.py', 'desktop/config.json', 'desktop/icon.ico',
           'server/server.py', 'Dockerfile', '.dockerignore', '.gitignore']
MANAGED = ('desktop/',)                       # folders where files missing locally get deleted from the repo
NEVER = ('server/data/', 'tools/', 'media/music/')

def gh(method, path, body=None):
    req = urllib.request.Request(f'https://api.github.com/repos/{REPO}{path}', method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Accept': 'application/vnd.github+json',
                                          'User-Agent': 'overdrive-publish', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'GitHub said {e.code} for {method} {path}: {e.read()[:300].decode("utf-8", "replace")}')

def blob_sha(data): return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()

def allowed(rel):
    low = rel.lower()
    return not (low.startswith(NEVER) or low.endswith(('.mp3', '.odm', '.wav', '.flac')) or 'token' in low or rel == 'media/redline.mp4')

def main():
    global TOKEN
    try: TOKEN = open(TOKEN_FILE).read().strip()
    except OSError: sys.exit(f'No GitHub token at {TOKEN_FILE}. See server-manager/README.md ("One-time setup").')
    man = json.load(open(os.path.join(GAME, 'version.json')))
    want = [r for r in list(man['files']) + ['version.json'] + SOURCES if allowed(r) and os.path.isfile(os.path.join(GAME, r))]

    head = gh('GET', f'/git/ref/heads/{BRANCH}')['object']['sha']
    base_tree = gh('GET', f'/git/commits/{head}')['tree']['sha']
    remote = {e['path']: e['sha'] for e in gh('GET', f'/git/trees/{base_tree}?recursive=1')['tree'] if e['type'] == 'blob'}

    tree, sent = [], 0
    for rel in want:
        data = open(os.path.join(GAME, rel), 'rb').read()
        if remote.get(rel) == blob_sha(data): continue
        b = gh('POST', '/git/blobs', {'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
        tree.append({'path': rel, 'mode': '100644', 'type': 'blob', 'sha': b['sha']}); sent += len(data)
        print('  up  ', rel)
    gone = [p for p in remote if p.startswith(MANAGED) and not os.path.isfile(os.path.join(GAME, p))]
    for p in gone:
        tree.append({'path': p, 'mode': '100644', 'type': 'blob', 'sha': None}); print('  del ', p)
    if not tree:
        print('GitHub already has everything.'); return
    t = gh('POST', '/git/trees', {'base_tree': base_tree, 'tree': tree})
    c = gh('POST', '/git/commits', {'message': f"OVERDRIVE version {man['version']}", 'tree': t['sha'], 'parents': [head]})
    gh('PATCH', f'/git/refs/heads/{BRANCH}', {'sha': c['sha']})
    print(f"published version {man['version']}: {len(tree) - len(gone)} file(s) up ({sent / 1048576:.1f} MB), {len(gone)} removed -> {c['html_url']}")

if __name__ == '__main__':
    main()
