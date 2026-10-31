#!/usr/bin/env python3
"""Locks the radio songs so they can't be copied out of the game as mp3s.

The real mp3s live OUTSIDE the game folder, in  Claude Atlas/overdrive-music/  (never uploaded to GitHub).
This writes a scrambled copy of each one to  overdrive-music/locked/<id>.odm  and points media/stations.json at
the id. The game unscrambles one song at a time, in memory, only while it plays.

  python3 lock-music.py          run again after adding songs (add them to stations.json by file name first)
"""
import hashlib, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
MUSIC = os.environ.get('OVERDRIVE_MUSIC') or os.path.join(os.path.dirname(GAME), 'overdrive-music')
LOCKED = os.path.join(MUSIC, 'locked')
STATIONS = os.path.join(GAME, 'media', 'stations.json')
SECRET = 'rd-overdrive-1986'          # must match LOCK_SECRET in src/radio.js

def song_id(filename): return hashlib.sha1(filename.encode()).hexdigest()[:12]

def keystream(sid):
    h = 2166136261
    for ch in SECRET + sid: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    x, words = h or 1, []
    for _ in range(16384):
        x ^= (x << 13) & 0xffffffff; x ^= x >> 17; x ^= (x << 5) & 0xffffffff
        words.append(x)
    return struct.pack('<16384I', *words)

def lock(src, dst, sid):
    data = open(src, 'rb').read()
    key = keystream(sid)
    pad = key * (len(data) // len(key) + 1)
    body = (int.from_bytes(data, 'little') ^ int.from_bytes(pad[:len(data)], 'little')).to_bytes(len(data), 'little')
    with open(dst, 'wb') as f: f.write(b'ODM1' + os.urandom(12) + body)

def main():
    os.makedirs(LOCKED, exist_ok=True)
    st = json.load(open(STATIONS))
    n = 0
    for station in st['stations']:
        for t in station['tracks']:
            name = t.pop('file', None) or t.get('name')
            sid = t.get('song') or song_id(name)
            src = os.path.join(MUSIC, name) if name else None
            dst = os.path.join(LOCKED, sid + '.odm')
            if src and os.path.isfile(src) and not os.path.isfile(dst):
                lock(src, dst, sid); n += 1
            elif not os.path.isfile(dst):
                print('missing song:', name or sid, file=sys.stderr)
            t['song'] = sid; t.pop('name', None)
    json.dump(st, open(STATIONS, 'w'), indent=1)
    print(f'locked {n} new song(s) into {LOCKED}')

if __name__ == '__main__':
    main()
