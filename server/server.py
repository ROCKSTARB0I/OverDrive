#!/usr/bin/env python3
"""OVERDRIVE online server: accounts, profiles + avatars, cloud saves, presence, lobbies, invites,
text chat, race-state relay and WebRTC signalling for voice chat. Python standard library only.

  python3 server.py [port]        (default 9310, or $PORT)
  OVERDRIVE_DATA=/some/disk        where accounts live (default ./data); point it at a persistent disk when hosted

Crossplay: every connection says which platform it is on (PC = the desktop .exe, WEB = a browser). Players who
switch crossplay off only see, invite and join players on their own platform.

Also serves the static game (the Claude Atlas folder) with no-cache headers and byte-range support for media.
HTTP  /api/register  /api/login  /api/me  /api/save  /api/avatar  /api/profile/<name>  /avatars/<file>
WS    /ws?token=...   JSON messages, see handle_msg()
Data lives in ./data (users.json + avatars/). Passwords are stored as salted PBKDF2-SHA256 hashes only.
"""
import base64, hashlib, hmac, json, mimetypes, os, re, secrets, socket, struct, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 9310))
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('OVERDRIVE_DATA') or os.path.join(HERE, 'data')
AV = os.path.join(DATA, 'avatars')
os.makedirs(AV, exist_ok=True)
DB_PATH = os.path.join(DATA, 'users.json')
GAME = os.path.abspath(os.path.join(HERE, '..'))          # the game folder (the repo root); served at / and /overdrive/
# locked radio songs live outside the game folder so they never end up on GitHub (see desktop/lock-music.py).
# A hosted server has no songs, which is fine: the radio just goes quiet for web players.
MUSIC = os.path.join(os.environ.get('OVERDRIVE_MUSIC') or os.path.join(os.path.dirname(GAME), 'overdrive-music'), 'locked')
mimetypes.add_type('text/javascript', '.js'); mimetypes.add_type('audio/mp4', '.m4a')
NAME_RE = re.compile(r'^[A-Za-z0-9_]{3,16}$')
BANNED = ('nigg', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'kike', 'chink', 'spic')
lock = threading.RLock()

# ------------------------------------------------------------------ storage
def load_db():
    try:
        with open(DB_PATH) as f: return json.load(f)
    except Exception:
        return {'users': {}, 'tokens': {}}
db = load_db()
def save_db():
    tmp = DB_PATH + '.tmp'
    with open(tmp, 'w') as f: json.dump(db, f)
    os.replace(tmp, DB_PATH)

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt), 200_000).hex()
    return salt, h

def public(u):
    rec = db['users'][u]
    car = (rec.get('save') or {}).get('current', 'kaze')
    save = rec.get('save') or {}
    return {
        'name': rec['name'], 'avatar': rec.get('avatar'), 'joined': rec.get('joined'),
        'title': rec.get('title') or title_for(rec), 'role': rec.get('role', 'driver'),
        'car': car, 'cash': save.get('cash', 0), 'cars': list((save.get('owned') or {}).keys()),
        'wins': len(save.get('wins') or {}), 'races': save.get('races', 0),
        'mpWins': rec.get('mpWins', 0), 'mpRaces': rec.get('mpRaces', 0),
        'online': u in clients, 'status': clients[u].status if u in clients else 'offline',
    }

# earned titles: everyone has one; the developer's is set on their record and never earned
TITLES = [(0, 'ROOKIE'), (1, 'STREET RACER'), (3, 'NIGHT RUNNER'), (5, 'MIDNIGHT HUNTER'), (6, 'KING OF THE STREETS')]
def title_for(rec):
    wins = len((rec.get('save') or {}).get('wins') or {}) + rec.get('mpWins', 0)
    t = TITLES[0][1]
    for need, name in TITLES:
        if wins >= need: t = name
    return t

def user_for(token):
    return db['tokens'].get(token or '')

# ------------------------------------------------------------------ live state
clients = {}        # username(lower) -> Client
lobbies = {}        # id -> dict

class Client:
    def __init__(self, user, sock):
        self.user, self.sock, self.status, self.lobby = user, sock, 'menu', None
        self.platform, self.crossplay = 'WEB', True
        self.wlock = threading.Lock()
    def send(self, obj):
        try:
            data = json.dumps(obj).encode()
            hdr = bytearray([0x81])
            n = len(data)
            if n < 126: hdr.append(n)
            elif n < 65536: hdr.append(126); hdr += struct.pack('>H', n)
            else: hdr.append(127); hdr += struct.pack('>Q', n)
            with self.wlock: self.sock.sendall(bytes(hdr) + data)
        except Exception:
            pass

def name_of(u): return db['users'][u]['name']

def can_meet(a, b):
    # crossplay: players on different platforms only see each other when both have it switched on
    return a.platform == b.platform or (a.crossplay and b.crossplay)

def player_view(u, c):
    r = db['users'][u]
    return {'name': name_of(u), 'avatar': r.get('avatar'), 'status': c.status, 'title': r.get('title') or title_for(r),
            'role': r.get('role', 'driver'), 'platform': c.platform}

def broadcast_presence():
    with lock:
        everyone = list(clients.items())
        for me in list(clients.values()):
            me.send({'t': 'online', 'players': [player_view(u, c) for u, c in everyone if c is me or can_meet(me, c)]})

def lobby_view(lb):
    return {'id': lb['id'], 'host': name_of(lb['host']), 'track': lb['track'], 'laps': lb['laps'], 'state': lb['state'],
            'members': [{'name': name_of(u), 'avatar': db['users'][u].get('avatar'), 'ready': u in lb['ready'], 'car': lb['cars'].get(u), 'title': db['users'][u].get('title') or title_for(db['users'][u]), 'role': db['users'][u].get('role', 'driver'), 'platform': clients[u].platform if u in clients else 'WEB'} for u in lb['members']]}

def lobby_send(lb, obj, skip=None):
    for u in lb['members']:
        if u != skip and u in clients: clients[u].send(obj)

def leave_lobby(c):
    lb = lobbies.get(c.lobby)
    c.lobby = None; c.status = 'menu'
    if not lb: return
    if c.user in lb['members']: lb['members'].remove(c.user)
    lb['ready'].discard(c.user)
    if not lb['members']:
        lobbies.pop(lb['id'], None); return
    if lb['host'] == c.user: lb['host'] = lb['members'][0]
    if lb['state'] == 'racing' and len(lb['results']) >= len(lb['members']):
        lb['state'] = 'open'; lb['ready'] = set()
        for u in lb['members']:
            if u in clients: clients[u].status = 'lobby'
    lobby_send(lb, {'t': 'lobby', 'lobby': lobby_view(lb)})
    lobby_send(lb, {'t': 'chat', 'scope': 'lobby', 'from': '', 'text': f'{name_of(c.user)} left the lobby'})

def clean(text):
    text = re.sub(r'\s+', ' ', str(text))[:240].strip()
    for w in BANNED:
        text = re.sub(w, '*' * len(w), text, flags=re.I)
    return text

def handle_msg(c, m):
    t = m.get('t')
    with lock:
        if t == 'lobby.create':
            leave_lobby(c)
            lid = secrets.token_hex(3)
            lobbies[lid] = {'id': lid, 'host': c.user, 'members': [c.user], 'ready': set(), 'cars': {}, 'track': int(m.get('track', 0)), 'laps': int(m.get('laps', 3)), 'state': 'open', 'results': []}
            c.lobby = lid; c.status = 'lobby'
            c.send({'t': 'lobby', 'lobby': lobby_view(lobbies[lid])})
        elif t == 'lobby.join':
            lb = lobbies.get(m.get('id'))
            if not lb or lb['state'] != 'open' or len(lb['members']) >= 6:
                c.send({'t': 'error', 'msg': 'That lobby is full or already racing.'}); return
            if any(u in clients and not can_meet(c, clients[u]) for u in lb['members']):
                c.send({'t': 'error', 'msg': 'That lobby has players on another platform. Turn CROSSPLAY on to join.'}); return
            if c.lobby != lb['id']: leave_lobby(c)
            if c.user not in lb['members']: lb['members'].append(c.user)
            c.lobby = lb['id']; c.status = 'lobby'
            lobby_send(lb, {'t': 'lobby', 'lobby': lobby_view(lb)})
            lobby_send(lb, {'t': 'chat', 'scope': 'lobby', 'from': '', 'text': f'{name_of(c.user)} joined the lobby'})
        elif t == 'lobby.leave':
            leave_lobby(c)
        elif t == 'lobby.set':
            lb = lobbies.get(c.lobby)
            if lb and lb['host'] == c.user and lb['state'] == 'open':
                lb['track'] = int(m.get('track', lb['track'])) % 2; lb['laps'] = max(1, min(10, int(m.get('laps', lb['laps']))))
                lobby_send(lb, {'t': 'lobby', 'lobby': lobby_view(lb)})
        elif t == 'lobby.ready':
            lb = lobbies.get(c.lobby)
            if lb:
                (lb['ready'].add if m.get('ready') else lb['ready'].discard)(c.user)
                lb['cars'][c.user] = m.get('car')
                lobby_send(lb, {'t': 'lobby', 'lobby': lobby_view(lb)})
        elif t == 'lobby.start':
            lb = lobbies.get(c.lobby)
            if lb and lb['host'] == c.user and lb['state'] == 'open':
                lb['state'] = 'racing'; lb['results'] = []
                for u in lb['members']:
                    if u in clients: clients[u].status = 'race'
                lobby_send(lb, {'t': 'race.start', 'track': lb['track'], 'laps': lb['laps'], 'grid': [name_of(u) for u in lb['members']], 'cars': {name_of(u): lb['cars'].get(u) for u in lb['members']}, 'seed': secrets.randbelow(1 << 30)})
        elif t == 'state':
            lb = lobbies.get(c.lobby)
            if lb and lb['state'] == 'racing':
                m['from'] = name_of(c.user)
                lobby_send(lb, m, skip=c.user)
        elif t == 'finish':
            lb = lobbies.get(c.lobby)
            if lb and lb['state'] == 'racing':
                lb['results'].append({'name': name_of(c.user), 'time': float(m.get('time', 0))})
                rec = db['users'][c.user]; rec['mpRaces'] = rec.get('mpRaces', 0) + 1
                if len(lb['results']) == 1: rec['mpWins'] = rec.get('mpWins', 0) + 1
                save_db()
                lobby_send(lb, {'t': 'race.results', 'results': lb['results']})
                if len(lb['results']) >= len(lb['members']):
                    lb['state'] = 'open'; lb['ready'] = set()
                    for u in lb['members']:
                        if u in clients: clients[u].status = 'lobby'
                    lobby_send(lb, {'t': 'lobby', 'lobby': lobby_view(lb)})
        elif t == 'invite':
            to = str(m.get('to', '')).lower()
            if to in clients and c.lobby and not can_meet(c, clients[to]):
                c.send({'t': 'error', 'msg': f'{name_of(to)} plays on another platform with crossplay off.'})
            elif to in clients and c.lobby:
                clients[to].send({'t': 'invite', 'from': name_of(c.user), 'avatar': db['users'][c.user].get('avatar'), 'lobby': c.lobby})
                c.send({'t': 'toast', 'msg': f'Invite sent to {name_of(to)}'})
        elif t == 'chat':
            text = clean(m.get('text', ''))
            if not text: return
            out = {'t': 'chat', 'scope': m.get('scope', 'lobby'), 'from': name_of(c.user), 'role': db['users'][c.user].get('role', 'driver'), 'text': text, 'ts': time.time()}
            if out['scope'] == 'lobby' and c.lobby in lobbies: lobby_send(lobbies[c.lobby], out)
            else:
                out['scope'] = 'global'
                for cl in list(clients.values()): cl.send(out)
        elif t == 'rtc':   # WebRTC voice signalling relay, only between players in the same lobby
            to = str(m.get('to', '')).lower()
            if to in clients and clients[to].lobby and clients[to].lobby == c.lobby:
                clients[to].send({'t': 'rtc', 'from': name_of(c.user), 'data': m.get('data')})
        elif t == 'voice':
            lb = lobbies.get(c.lobby)
            if lb: lobby_send(lb, {'t': 'voice', 'from': name_of(c.user), 'on': bool(m.get('on'))}, skip=c.user)
        elif t == 'status':
            c.status = str(m.get('status', 'menu'))[:12]
        elif t == 'hello':   # platform + crossplay setting, sent on connect and whenever crossplay is toggled
            c.platform = 'PC' if m.get('platform') == 'PC' else 'WEB'
            c.crossplay = bool(m.get('crossplay', True))
        elif t == 'ping':
            c.send({'t': 'pong'})
    if t in ('lobby.create', 'lobby.join', 'lobby.leave', 'lobby.start', 'status', 'hello'): broadcast_presence()

# ------------------------------------------------------------------ websocket plumbing
def ws_recv(sock):
    def recvn(n):
        buf = b''
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk: raise ConnectionError
            buf += chunk
        return buf
    msg = b''
    while True:
        b1, b2 = recvn(2)
        op, masked, n = b1 & 0x0F, b2 & 0x80, b2 & 0x7F
        if n == 126: n = struct.unpack('>H', recvn(2))[0]
        elif n == 127: n = struct.unpack('>Q', recvn(8))[0]
        if n > 2_000_000: raise ConnectionError
        mask = recvn(4) if masked else b'\0\0\0\0'
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(recvn(n)))
        if op == 8: raise ConnectionError
        if op == 9: sock.sendall(bytes([0x8A, len(data)]) + data); continue
        if op == 10: continue
        msg += data
        if b1 & 0x80: return msg.decode('utf-8', 'replace')

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    def reply(self, code, obj=None, body=None, ctype='application/json'):
        data = body if body is not None else json.dumps(obj).encode()
        self.send_response(code); self.cors()
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(data)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 3_000_000: return None
        try: return json.loads(self.rfile.read(n) or b'{}')
        except Exception: return None
    def me(self):
        auth = self.headers.get('Authorization', '')
        return user_for(auth[7:] if auth.startswith('Bearer ') else '')

    def do_OPTIONS(self): self.reply(204, body=b'')

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/ws' and self.headers.get('Upgrade', '').lower() == 'websocket':
            return self.websocket(parse_qs(u.query).get('token', [''])[0])
        if u.path == '/api/me':
            who = self.me()
            if not who: return self.reply(401, {'error': 'Not signed in'})
            with lock: return self.reply(200, {'profile': public(who), 'save': db['users'][who].get('save')})
        if u.path.startswith('/api/profile/'):
            name = u.path.rsplit('/', 1)[-1].lower()
            with lock:
                if name not in db['users']: return self.reply(404, {'error': 'No such driver'})
                return self.reply(200, {'profile': public(name)})
        if u.path == '/api/ranks':
            with lock:
                rows = sorted((public(n) for n in db['users']), key=lambda p: (-p['mpWins'], -p['wins'], -p['cash']))[:50]
            return self.reply(200, {'ranks': rows})
        if u.path.startswith('/avatars/'):
            f = os.path.join(AV, os.path.basename(u.path))
            if os.path.isfile(f):
                with open(f, 'rb') as fh: return self.reply(200, body=fh.read(), ctype='image/jpeg')
        return self.static(u.path)

    def static(self, path):
        from urllib.parse import unquote
        rel = unquote(path).lstrip('/')
        if rel == 'overdrive':   # no trailing slash would break the page's relative URLs
            self.send_response(301); self.send_header('Location', '/overdrive/'); self.send_header('Content-Length', '0'); self.end_headers(); return
        # the game is served both at / and at /overdrive/
        if rel.startswith('overdrive/'): rel = rel[len('overdrive/'):]
        song = re.fullmatch(r'media/music/([0-9a-f]{12})\.odm', rel)
        if song: return self.send_file(os.path.join(MUSIC, song.group(1) + '.odm'))
        f = os.path.abspath(os.path.join(GAME, rel))
        if os.path.isdir(f): f = os.path.join(f, 'index.html')
        # only the game's own files are public: never the server code, its data, the desktop build or the rest of the machine
        private = [os.path.join(GAME, d) + os.sep for d in ('server', 'desktop', '.git')]
        if not f.startswith(GAME + os.sep) or any(f.startswith(d) for d in private) or os.path.basename(f).startswith('.'):
            return self.reply(403, {'error': 'Forbidden'})
        return self.send_file(f)

    def send_file(self, f):
        if not os.path.isfile(f): return self.reply(404, {'error': 'Not found'})
        size = os.path.getsize(f)
        ctype = mimetypes.guess_type(f)[0] or 'application/octet-stream'
        rng = re.match(r'bytes=(\d*)-(\d*)', self.headers.get('Range', ''))
        start, end = 0, size - 1
        if rng and (rng.group(1) or rng.group(2)):
            if rng.group(1): start = int(rng.group(1)); end = int(rng.group(2)) if rng.group(2) else size - 1
            else: start = max(0, size - int(rng.group(2)))
            end = min(end, size - 1)
            self.send_response(206); self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        else:
            self.send_response(200)
        self.cors()
        self.send_header('Content-Type', ctype); self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1)); self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command == 'HEAD': return
        with open(f, 'rb') as fh:
            fh.seek(start); left = end - start + 1
            try:
                while left > 0:
                    chunk = fh.read(min(262144, left))
                    if not chunk: break
                    self.wfile.write(chunk); left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True

    def do_HEAD(self): return self.static(urlparse(self.path).path)

    def do_POST(self):
        u = urlparse(self.path); b = self.body()
        if b is None: return self.reply(400, {'error': 'Bad request'})
        if u.path == '/api/register':
            name, pw = str(b.get('username', '')).strip(), str(b.get('password', ''))
            if not NAME_RE.match(name): return self.reply(400, {'error': 'Username: 3-16 letters, numbers or _'})
            if any(w in name.lower() for w in BANNED): return self.reply(400, {'error': 'Pick a different username'})
            if len(pw) < 6: return self.reply(400, {'error': 'Password needs at least 6 characters'})
            with lock:
                if name.lower() in db['users']: return self.reply(409, {'error': 'That username is taken'})
                salt, h = hash_pw(pw)
                db['users'][name.lower()] = {'name': name, 'salt': salt, 'hash': h, 'joined': time.strftime('%Y-%m-%d'), 'save': b.get('save')}
                tok = secrets.token_hex(24); db['tokens'][tok] = name.lower(); save_db()
            return self.reply(200, {'token': tok, 'profile': public(name.lower())})
        if u.path == '/api/login':
            name, pw = str(b.get('username', '')).strip().lower(), str(b.get('password', ''))
            with lock:
                rec = db['users'].get(name)
                if not rec or not hmac.compare_digest(hash_pw(pw, rec['salt'])[1], rec['hash']):
                    return self.reply(401, {'error': 'Wrong username or password'})
                tok = secrets.token_hex(24); db['tokens'][tok] = name; save_db()
                return self.reply(200, {'token': tok, 'profile': public(name), 'save': rec.get('save')})
        if u.path == '/api/avatar':
            who = self.me()
            if not who: return self.reply(401, {'error': 'Not signed in'})
            m = re.match(r'^data:image/(jpeg|png|webp);base64,(.+)$', str(b.get('image', '')))
            if not m: return self.reply(400, {'error': 'Upload a JPG or PNG'})
            raw = base64.b64decode(m.group(2))
            if len(raw) > 400_000: return self.reply(400, {'error': 'Image too large'})
            with lock:
                fn = f'{who}.jpg'
                with open(os.path.join(AV, fn), 'wb') as fh: fh.write(raw)
                db['users'][who]['avatar'] = f'/avatars/{fn}?v={int(time.time())}'; save_db()
                return self.reply(200, {'avatar': db['users'][who]['avatar']})
        if u.path == '/api/logout':
            auth = self.headers.get('Authorization', '')
            with lock: db['tokens'].pop(auth[7:], None); save_db()
            return self.reply(200, {'ok': True})
        return self.reply(404, {'error': 'Not found'})

    def do_PUT(self):
        u = urlparse(self.path); b = self.body()
        if u.path == '/api/save':
            who = self.me()
            if not who or b is None: return self.reply(401, {'error': 'Not signed in'})
            with lock: db['users'][who]['save'] = b.get('save'); save_db()
            return self.reply(200, {'ok': True})
        return self.reply(404, {'error': 'Not found'})

    def websocket(self, token):
        who = user_for(token)
        if not who: return self.reply(401, {'error': 'Not signed in'})
        key = self.headers.get('Sec-WebSocket-Key', '')
        acc = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        self.send_response(101)
        self.send_header('Upgrade', 'websocket'); self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', acc); self.end_headers()
        sock = self.connection
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        sock.settimeout(75)
        c = Client(who, sock)
        with lock:
            old = clients.get(who)
            if old:
                old.send({'t': 'kicked', 'msg': 'You signed in somewhere else.'})
                try: old.sock.close()
                except Exception: pass
            clients[who] = c
        broadcast_presence()
        try:
            while True:
                try: handle_msg(c, json.loads(ws_recv(sock)))
                except (ValueError, KeyError, TypeError): pass
        except Exception:
            pass
        finally:
            with lock:
                if clients.get(who) is c:
                    leave_lobby(c); clients.pop(who, None)
            broadcast_presence()
            self.close_connection = True

if __name__ == '__main__':
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), H)
    print(f'OVERDRIVE online server on :{PORT}', flush=True)
    srv.serve_forever()
