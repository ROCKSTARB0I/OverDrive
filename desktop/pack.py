#!/usr/bin/env python3
"""Builds OVERDRIVE.exe: compiles our launcher (overdrive.c) and glues the whole game onto the end of it.

The result is ONE file. Inside the pack: every game file listed in version.json, the 1080p intro, the locked radio
songs (.odm, never mp3s), the launcher settings (config.json) and Microsoft's small WebView2 loader (only used as a
backup if ours can't start the web engine).

  python3 desktop/release.py      first, whenever game files changed (bumps version.json)
  python3 desktop/pack.py         ->  <build>/dist/OVERDRIVE.exe  and  OVERDRIVE.zip

Big tools live on the external drive: set OVERDRIVE_BUILD (default /Volumes/QUICKSILVER/overdrive-build), which holds
zig/ (the compiler), webview2-sdk/ and shim/.
"""
import hashlib, json, os, struct, subprocess, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
BUILD = os.environ.get('OVERDRIVE_BUILD') or '/Volumes/QUICKSILVER/overdrive-build'
MUSIC = os.path.join(os.environ.get('OVERDRIVE_MUSIC') or os.path.join(os.path.dirname(GAME), 'overdrive-music'), 'locked')
SDK = os.path.join(BUILD, 'webview2-sdk', 'pkg', 'build', 'native')
EXTRA = {'media/redline.mp4': os.path.join(GAME, 'media', 'redline.mp4')}   # too big for GitHub, so only the .exe carries it

def compile_launcher(out):
    libs = ['user32', 'gdi32', 'shell32', 'shlwapi', 'ole32', 'advapi32', 'winhttp', 'bcrypt', 'dwmapi']
    cmd = [os.path.join(BUILD, 'zig', 'zig'), 'build-exe', '-target', 'x86_64-windows-gnu', '-O', 'ReleaseSmall', '-fstrip',
           '--subsystem', 'windows', '-lc', '-I', os.path.join(BUILD, 'shim'), '-I', os.path.join(SDK, 'include'),
           'overdrive.c', 'overdrive.rc', *[f'-l{l}' for l in libs], '--name', 'OVERDRIVE', f'-femit-bin={out}']
    subprocess.run(cmd, cwd=HERE, check=True)

def main():
    man = json.load(open(os.path.join(GAME, 'version.json')))
    files = {}
    stale = []
    for rel, want in man['files'].items():
        p = os.path.join(GAME, rel)
        data = open(p, 'rb').read()
        if hashlib.sha1(data).hexdigest() != want: stale.append(rel)
        files[rel] = data
    if stale:
        sys.exit(f'{len(stale)} file(s) changed since version.json was made (e.g. {stale[0]}). Run desktop/release.py first.')
    files['version.json'] = open(os.path.join(GAME, 'version.json'), 'rb').read()
    for rel, p in EXTRA.items(): files[rel] = open(p, 'rb').read()
    songs = 0
    for st in json.load(open(os.path.join(GAME, 'media', 'stations.json')))['stations']:
        for t in st['tracks']:
            if t.get('song'):
                files[f"media/music/{t['song']}.odm"] = open(os.path.join(MUSIC, t['song'] + '.odm'), 'rb').read(); songs += 1
    files['_launcher/config.json'] = open(os.path.join(HERE, 'config.json'), 'rb').read()
    files['_native/WebView2Loader.dll'] = open(os.path.join(SDK, 'x64', 'WebView2Loader.dll'), 'rb').read()

    dist = os.path.join(BUILD, 'dist'); os.makedirs(dist, exist_ok=True)
    exe = os.path.join(dist, 'OVERDRIVE.exe')
    compile_launcher(exe)
    launcher_size = os.path.getsize(exe)

    # [launcher][file bytes...][index][b'ODPAK001'][u64 index offset]
    with open(exe, 'ab') as f:
        entries = []
        for rel in sorted(files):
            entries.append((rel, f.tell(), len(files[rel]))); f.write(files[rel])
        idx = f.tell()
        f.write(struct.pack('<I', len(entries)))
        for rel, off, size in entries:
            b = rel.encode(); f.write(struct.pack('<H', len(b)) + b + struct.pack('<QQ', off, size))
        f.write(b'ODPAK001' + struct.pack('<Q', idx))

    z = os.path.join(dist, 'OVERDRIVE.zip')
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf: zf.write(exe, 'OVERDRIVE/OVERDRIVE.exe')
    mb = lambda n: f'{n / 1048576:.1f} MB'
    print(f'version {man["version"]}: launcher {launcher_size // 1024} KB + {len(files)} packed files ({songs} locked songs)')
    print(f'built {exe} ({mb(os.path.getsize(exe))}), {z} ({mb(os.path.getsize(z))})')

if __name__ == '__main__':
    main()
