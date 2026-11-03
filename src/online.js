// Online: accounts + cloud saves, profiles with pictures and titles, who's online, invites, lobbies,
// lobby/global text chat, WebRTC voice chat, and the race-state feed used to draw other players' cars.
import * as THREE from 'three';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Where the account server lives. Empty = the same server as the game (local play).
// A fixed address can come from the .exe's config (window.overdriveDesktop.server) or <meta name="overdrive-server">.
// Otherwise the .exe and the GitHub copy look up the current address in server.json on GitHub, which Nathan's
// server manager keeps up to date whenever it opens the server's public tunnel (the address changes on restart).
const DESKTOP = window.overdriveDesktop || null;
const FIXED = ((DESKTOP && DESKTOP.server) || document.querySelector('meta[name="overdrive-server"]')?.content || '').trim().replace(/\/$/, '');
const LOOKUP = !FIXED && (DESKTOP || /\.github\.io$|\.ruffdogs\.game$/.test(location.hostname)) ? 'https://raw.githubusercontent.com/ROCKSTARB0I/OverDrive/main/server.json' : '';
const LOOKUP_API = 'https://api.github.com/repos/ROCKSTARB0I/OverDrive/contents/server.json?ref=main';
export const PLATFORM = DESKTOP || /\.ruffdogs\.game$/.test(location.hostname) ? 'PC' : 'WEB';   // the .exe and the Ruff Dogs Launcher are PC
let API = FIXED, lookedUp = 0, lookup = null;
const wsUrl = () => (API ? API.replace(/^http/, 'ws') : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`) + '/ws';
const media = u => u && u.startsWith('/') ? API + u : u;   // avatars are served by the account server
// find the server's current address (again, at most every 20 s, when it stops answering)
function findServer(again) {
  if (!LOOKUP) return Promise.resolve();
  if (lookup && !(again && Date.now() - lookedUp > 20000)) return lookup;
  lookedUp = Date.now();
  // GitHub's API always has the newest copy; the raw file can lag a few minutes behind (CDN cache), so it's the backup
  const use = j => { const s = String(j.server || '').trim().replace(/\/$/, ''); if (/^https?:\/\//.test(s)) { API = s; return true; } };
  const get = (u, h) => fetch(u, { cache: 'no-store', headers: h }).then(r => r.ok ? r.json() : Promise.reject(r.status));
  return lookup = get(LOOKUP_API, { Accept: 'application/vnd.github.raw+json' }).then(use)
    .catch(() => get(LOOKUP + '?t=' + Date.now()).then(use)).catch(() => { });
}
const TRACK_NAMES = ['NEON DOWNTOWN', 'HARBOR HIGHWAY'];
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export class Online {
  constructor({ career, sound, onRaceStart, onResults, carLook, onProfile }) {
    Object.assign(this, { career, sound, onRaceStart, onResults, carLook, onProfile });
    this.token = localStorage.getItem('overdrive_token') || '';
    // remember who was signed in so the menu shows you straight away, even before the server answers
    try { this.profile = this.token ? JSON.parse(localStorage.getItem('overdrive_profile') || 'null') : null; } catch (e) { this.profile = null; }
    this.players = []; this.lobby = null; this.chat = []; this.view = 'profile';
    this.remote = new Map();      // name -> latest race state
    try { this.crossplay = localStorage.getItem('overdrive_crossplay') !== '0'; } catch (e) { this.crossplay = true; }
    this.voice = { on: false, stream: null, peers: new Map(), muted: new Set() };
    this.buildDom();
    if (this.token) this.restore();
    // cloud save: mirror every career save to the server while signed in
    const save = career.save.bind(career);
    career.save = () => { save(); this.pushSave(); };
  }

  get signedIn() { return !!this.profile; }
  get name() { return this.profile ? this.profile.name : 'YOU'; }

  // ------------------------------------------------------------------ http
  async api(path, method = 'GET', body) {
    await findServer();
    if (LOOKUP && !API) { await findServer(true); if (!API) throw new Error('Server unavailable'); }
    const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) }, body: body ? JSON.stringify(body) : undefined })
      .catch(e => { findServer(true); throw new Error('Server unavailable'); });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Server unavailable'); e.status = r.status; throw e; }
    return j;
  }
  async restore() {
    try { const j = await this.api('/api/me'); this.signIn(j); }
    catch (e) {
      // only a rejected token signs you out; if the server is just unreachable, stay signed in and try again
      if (e.status === 401) { this.forget(); this.render(); }
      else { this.render(); clearTimeout(this.retryT); this.retryT = setTimeout(() => this.restore(), 5000); }
    }
  }
  forget() {
    this.token = ''; this.profile = null;
    this.onProfile && this.onProfile();
    localStorage.removeItem('overdrive_token'); localStorage.removeItem('overdrive_profile');
  }
  signIn(j) {
    if (j.token) { this.token = j.token; localStorage.setItem('overdrive_token', j.token); }
    this.profile = j.profile;
    this.onProfile && this.onProfile();
    try { localStorage.setItem('overdrive_profile', JSON.stringify(j.profile)); } catch (e) { }
    // the server copy wins if it exists, otherwise upload this browser's progress
    if (j.save && j.save.owned) { this.career.d = { ...this.career.d, ...j.save }; localStorage.setItem('overdrive_career', JSON.stringify(this.career.d)); this.onCareerLoaded && this.onCareerLoaded(); }
    else this.pushSave(true);
    this.connect();
    this.render();
  }
  pushSave(now) {
    if (!this.token) return;
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.api('/api/save', 'PUT', { save: this.career.d }).catch(() => { }), now ? 0 : 800);
  }
  async signOut() {
    try { await this.api('/api/logout', 'POST', {}); } catch (e) { }
    this.forget();
    if (this.ws) this.ws.close();
    this.render();
  }

  // ------------------------------------------------------------------ socket
  async connect() {
    if (this.ws && this.ws.readyState < 2) return;
    await findServer();
    if (this.ws && this.ws.readyState < 2) return;
    const ws = new WebSocket(`${wsUrl()}?token=${this.token}`);
    this.ws = ws; this.kicked = false;
    ws.onopen = () => {
      this.hello();
      // keep the connection alive through hosting proxies, and let the server notice dead connections
      clearInterval(this.pingT); this.pingT = setInterval(() => this.send({ t: 'ping' }), 20000);
    };
    ws.onmessage = e => { try { this.onMsg(JSON.parse(e.data)); } catch (err) { console.warn(err); } };
    ws.onclose = () => {
      clearInterval(this.pingT);
      if (this.token && this.ws === ws && !this.kicked) { findServer(true); setTimeout(() => this.connect(), 2500); }
    };
  }
  hello() { this.send({ t: 'hello', platform: PLATFORM, crossplay: this.crossplay }); }
  setCrossplay(on) {
    this.crossplay = on;
    try { localStorage.setItem('overdrive_crossplay', on ? '1' : '0'); } catch (e) { }
    this.hello(); this.render();
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  status(s) { this.send({ t: 'status', status: s }); }

  onMsg(m) {
    switch (m.t) {
      case 'online': this.players = m.players; if (this.open && this.view === 'players') this.render(); this.renderChip(); break;
      case 'lobby':
        this.lobby = m.lobby;
        if (this.open) this.render();
        this.syncVoicePeers();
        break;
      case 'invite': this.inviteToast(m); break;
      case 'toast': this.toast(m.msg); break;
      case 'kicked': this.kicked = true; this.players = []; this.lobby = null; this.toast(m.msg, true); this.render(); break;
      case 'error': this.toast(m.msg, true); break;
      case 'chat':
        this.chat.push(m); if (this.chat.length > 80) this.chat.shift();
        this.renderChat(); this.raceChat(m);
        if (m.from && m.from !== this.name) this.sound.click(.15, 5200);
        break;
      case 'race.start':
        this.remote.clear(); this.results = [];
        this.close();
        this.onRaceStart && this.onRaceStart(m);
        break;
      case 'state': this.remote.set(m.from, { ...m, at: performance.now() }); break;
      case 'race.results': this.results = m.results; this.onResults && this.onResults(m.results); break;
      case 'voice': if (this.lobby) this.render(); break;
      case 'rtc': this.onRtc(m.from, m.data); break;
    }
  }

  // ------------------------------------------------------------------ lobbies
  createLobby() { this.send({ t: 'lobby.create', track: 0, laps: 3 }); this.view = 'lobby'; }
  joinLobby(id) { this.send({ t: 'lobby.join', id }); this.view = 'lobby'; }
  leaveLobby() { this.send({ t: 'lobby.leave' }); this.lobby = null; this.stopVoice(); this.view = 'players'; this.render(); }
  get isHost() { return this.lobby && this.profile && this.lobby.host === this.profile.name; }
  get me() { return this.lobby && this.lobby.members.find(p => p.name === this.name); }

  // ------------------------------------------------------------------ voice chat (WebRTC mesh between lobby members)
  async startVoice() {
    try {
      this.voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { this.toast('Microphone permission was blocked', true); return; }
    this.voice.on = true;
    this.send({ t: 'voice', on: true });
    // the alphabetically-first of each pair starts the call
    for (const p of this.lobby ? this.lobby.members : []) if (p.name !== this.name && this.name < p.name) this.call(p.name);
    this.render();
  }
  stopVoice() {
    for (const pc of this.voice.peers.values()) { pc.pc.close(); pc.audio && pc.audio.remove(); }
    this.voice.peers.clear();
    if (this.voice.stream) this.voice.stream.getTracks().forEach(t => t.stop());
    this.voice.stream = null;
    if (this.voice.on) this.send({ t: 'voice', on: false });
    this.voice.on = false;
    this.render();
  }
  peer(name) {
    if (this.voice.peers.has(name)) return this.voice.peers.get(name);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const entry = { pc, audio: null };
    if (this.voice.stream) for (const t of this.voice.stream.getTracks()) pc.addTrack(t, this.voice.stream);
    pc.onicecandidate = e => { if (e.candidate) this.send({ t: 'rtc', to: name, data: { ice: e.candidate } }); };
    pc.ontrack = e => {
      if (!entry.audio) { entry.audio = new Audio(); entry.audio.autoplay = true; document.body.appendChild(entry.audio); }
      entry.audio.srcObject = e.streams[0]; entry.audio.muted = this.voice.muted.has(name);
    };
    this.voice.peers.set(name, entry);
    return entry;
  }
  async call(name) {
    const { pc } = this.peer(name);
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    this.send({ t: 'rtc', to: name, data: { sdp: pc.localDescription } });
  }
  async onRtc(from, data) {
    if (!this.voice.on) return;
    const { pc } = this.peer(from);
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') { const a = await pc.createAnswer(); await pc.setLocalDescription(a); this.send({ t: 'rtc', to: from, data: { sdp: pc.localDescription } }); }
    } else if (data.ice) { try { await pc.addIceCandidate(data.ice); } catch (e) { } }
  }
  syncVoicePeers() {
    if (!this.voice.on || !this.lobby) return;
    const names = new Set(this.lobby.members.map(p => p.name));
    for (const [n, e] of this.voice.peers) if (!names.has(n)) { e.pc.close(); e.audio && e.audio.remove(); this.voice.peers.delete(n); }
    for (const n of names) if (n !== this.name && !this.voice.peers.has(n) && this.name < n) this.call(n);
  }
  toggleMute(name) {
    this.voice.muted.has(name) ? this.voice.muted.delete(name) : this.voice.muted.add(name);
    const e = this.voice.peers.get(name); if (e && e.audio) e.audio.muted = this.voice.muted.has(name);
    this.render();
  }

  // ------------------------------------------------------------------ DOM
  buildDom() {
    const chip = document.createElement('button'); chip.id = 'acct'; $('menuui').appendChild(chip);
    chip.addEventListener('click', () => { this.sound.click(.4, 3000); this.show(this.signedIn ? (this.lobby ? 'lobby' : 'players') : 'profile'); });
    const net = document.createElement('div'); net.id = 'net'; net.className = 'hidden'; document.body.appendChild(net);
    for (const ev of ['pointerdown', 'click', 'wheel', 'keydown']) net.addEventListener(ev, e => e.stopPropagation());
    net.addEventListener('click', e => this.onClick(e));
    net.addEventListener('submit', e => { e.preventDefault(); this.onSubmit(e.target); });
    net.addEventListener('change', e => { if (e.target.id === 'avfile') this.uploadAvatar(e.target.files[0]); });
    const toasts = document.createElement('div'); toasts.id = 'toasts'; document.body.appendChild(toasts);
    toasts.addEventListener('click', e => this.onClick(e));
    const rc = document.createElement('div'); rc.id = 'racechat'; rc.className = 'hidden'; document.getElementById('hud').appendChild(rc);
    this.renderChip();
  }
  show(view) { this.view = view; this.open = true; $('net').classList.remove('hidden'); this.render(); }
  close() { this.open = false; $('net').classList.add('hidden'); }

  badge(p, size = 44) {
    const img = p.avatar ? `<img src="${esc(media(p.avatar))}" alt="">` : `<span>${esc((p.name || '?')[0])}</span>`;
    return `<div class="av ${p.role === 'dev' ? 'dev' : ''}" style="width:${size}px;height:${size}px">${img}</div>`;
  }
  plat(p) { return p.platform ? `<i class="plat ${p.platform === 'PC' ? 'pc' : 'web'}" title="${p.platform === 'PC' ? 'Playing on PC' : 'Playing in a browser'}">${p.platform}</i>` : ''; }
  nameTag(p) {
    return `<div class="who"><b class="${p.role === 'dev' ? 'devname' : ''}">${esc(p.name)}</b>${p.role === 'dev' ? '<i class="devbadge">DEV</i>' : ''}${this.plat(p)}<small class="${p.role === 'dev' ? 'devtitle' : ''}">${esc(p.title || '')}</small></div>`;
  }
  renderChip() {
    const c = $('acct'); if (!c) return;
    if (!this.profile) { c.innerHTML = `<div class="av"><span>+</span></div><div class="who"><b>SIGN IN</b><small>SAVE PROGRESS · RACE ONLINE</small></div>`; c.className = ''; return; }
    const n = Math.max(0, this.players.length - 1);
    c.className = this.profile.role === 'dev' ? 'dev' : '';
    c.innerHTML = this.badge(this.profile, 40) + this.nameTag(this.profile) + `<em>${n} ONLINE</em>`;
  }

  render() {
    this.renderChip();
    if (!this.open) return;
    const el = $('net'), v = this.view, P = this.profile;
    const tabs = P ? `<div class="ntabs">${[['profile', 'PROFILE'], ['players', 'PLAYERS'], ['lobby', 'LOBBY'], ['ranks', 'RANKS']].map(([k, l]) => `<button data-view="${k}" class="${v === k ? 'on' : ''}">${l}</button>`).join('')}<button data-act="close" class="x">&times;</button></div>` : `<div class="ntabs"><button class="on">ACCOUNT</button><button data-act="close" class="x">&times;</button></div>`;
    let body = '';
    if (!P) {
      body = `<p class="nlead">Make an account to save your progress to the cloud, show off your profile and race other players online. Playing without one is fine too: progress then stays on this computer.</p>
        <form class="auth" data-form="${this.authMode || 'login'}">
          <label>USERNAME</label><input name="username" maxlength="16" autocomplete="username" required>
          <label>PASSWORD</label><input name="password" type="password" autocomplete="${this.authMode === 'register' ? 'new-password' : 'current-password'}" required>
          <div class="err">${esc(this.err || '')}</div>
          <button class="primary" type="submit">${this.authMode === 'register' ? 'CREATE ACCOUNT' : 'SIGN IN'}</button>
        </form>
        <button class="link" data-act="authmode">${this.authMode === 'register' ? 'Have an account? Sign in' : 'New here? Create an account'}</button>`;
    } else if (v === 'profile' || v === 'other') {
      const p = v === 'other' ? this.viewing : P;
      if (!p) body = '<p class="nlead">Loading…</p>';
      else body = `<div class="prof ${p.role === 'dev' ? 'devcard' : ''}">
          ${this.badge(p, 110)}
          <div>${this.nameTag(p)}<div class="since">Driving since ${esc(p.joined || '')}${p.online ? ' · <span class="on">ONLINE</span>' : ''}</div></div>
        </div>
        ${v === 'profile' ? `<label class="up">CHANGE PICTURE<input id="avfile" type="file" accept="image/png,image/jpeg,image/webp"></label>` : ''}
        <div class="stats">
          <div><b>${p.wins}</b><span>STREET WINS</span></div><div><b>${p.mpWins}</b><span>ONLINE WINS</span></div>
          <div><b>${p.mpRaces}</b><span>ONLINE RACES</span></div><div><b>$${(p.cash || 0).toLocaleString('en-US')}</b><span>STREET CASH</span></div>
        </div>
        <label>GARAGE</label><div class="cars">${(p.cars && p.cars.length ? p.cars : [p.car]).map(c => `<span>${esc(c).toUpperCase()}</span>`).join('')}</div>
        ${v === 'profile' ? `<button class="link" data-act="signout">Sign out</button>` : (p.online && p.name !== this.name ? `<button class="primary" data-invite="${esc(p.name)}">INVITE TO LOBBY</button>` : '')}`;
    } else if (v === 'players') {
      const others = this.players.filter(p => p.name !== this.name);
      body = `<div class="xplay"><div><b>CROSSPLAY</b><span>${this.crossplay ? 'Racing PC and browser players' : `Only ${PLATFORM === 'PC' ? 'PC' : 'browser'} players`}</span></div>
          <button data-act="xplay" class="${this.crossplay ? 'on' : ''}">${this.crossplay ? 'ON' : 'OFF'}</button></div>
        <p class="nlead">${others.length ? 'Drivers online now. Open a profile or invite them to your lobby.' : 'Nobody else is online right now.'}</p>
        <div class="plist">${others.map(p => `<div class="prow">${this.badge(p, 40)}${this.nameTag(p)}<em>${esc(p.status).toUpperCase()}</em>
          <button data-profile="${esc(p.name)}">PROFILE</button><button data-invite="${esc(p.name)}">INVITE</button></div>`).join('')}</div>
        ${this.lobby ? '' : '<button class="primary" data-act="create">CREATE LOBBY</button>'}`;
    } else if (v === 'lobby') {
      const L = this.lobby;
      if (!L) body = `<p class="nlead">You're not in a lobby. Create one, then invite drivers from the PLAYERS tab.</p><button class="primary" data-act="create">CREATE LOBBY</button>`;
      else {
        const me = this.me, ready = me && me.ready;
        body = `<div class="lhead"><div><b>${esc(TRACK_NAMES[L.track])}</b><span>${L.laps} LAPS · HOST ${esc(L.host)}</span></div>
            ${this.isHost ? `<div class="hostctl"><button data-act="trk">CIRCUIT</button><button data-act="lapm">&minus;</button><button data-act="lapp">+</button></div>` : ''}</div>
          <div class="plist">${L.members.map(p => `<div class="prow">${this.badge(p, 40)}${this.nameTag(p)}<em class="${p.ready ? 'rdy' : ''}">${p.ready ? 'READY' : 'NOT READY'}</em>
            ${p.name !== this.name && this.voice.on ? `<button data-mute="${esc(p.name)}">${this.voice.muted.has(p.name) ? 'UNMUTE' : 'MUTE'}</button>` : ''}</div>`).join('')}</div>
          <div class="lrow"><button data-act="ready" class="${ready ? 'on' : ''}">${ready ? 'READY ✓' : 'READY UP'}</button>
            <button data-act="voice" class="${this.voice.on ? 'on' : ''}">${this.voice.on ? '🎙 VOICE ON' : 'VOICE CHAT'}</button>
            ${this.isHost ? `<button class="primary" data-act="start">START RACE</button>` : ''}<button data-act="leave">LEAVE</button></div>
          <div id="chatlog" class="chat"></div>
          <form class="chatin" data-form="chat"><input name="text" maxlength="240" placeholder="Say something…" autocomplete="off"><button type="submit">SEND</button></form>`;
      }
    } else if (v === 'ranks') {
      body = `<div id="ranks" class="plist"><p class="nlead">Loading…</p></div>`;
      this.api('/api/ranks').then(j => {
        const box = $('ranks'); if (!box) return;
        box.innerHTML = j.ranks.map((p, k) => `<div class="prow"><i class="rk">${k + 1}</i>${this.badge(p, 36)}${this.nameTag(p)}<em>${p.mpWins} ONLINE · ${p.wins} STREET</em><button data-profile="${esc(p.name)}">PROFILE</button></div>`).join('');
      }).catch(() => { });
    }
    el.innerHTML = `<div class="nbox">${tabs}<div class="nbody">${body}</div></div>`;
    this.renderChat();
  }
  renderChat() {
    const box = $('chatlog'); if (!box) return;
    box.innerHTML = this.chat.filter(m => m.scope === 'lobby').slice(-40).map(m => m.from ? `<div><b class="${m.role === 'dev' ? 'devname' : ''}">${esc(m.from)}</b> ${esc(m.text)}</div>` : `<div class="sys">${esc(m.text)}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }
  raceChat(m) {
    const rc = $('racechat'); if (!rc || !m.from) return;
    const d = document.createElement('div'); d.innerHTML = `<b class="${m.role === 'dev' ? 'devname' : ''}">${esc(m.from)}</b> ${esc(m.text)}`;
    rc.appendChild(d); rc.classList.remove('hidden');
    while (rc.children.length > 6) rc.firstChild.remove();
    setTimeout(() => d.remove(), 12000);
  }

  async onClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    this.sound.click(.35, 3200);
    if (d.view) { this.view = d.view; this.render(); }
    if (d.act === 'close') this.close();
    if (d.act === 'authmode') { this.authMode = this.authMode === 'register' ? 'login' : 'register'; this.err = ''; this.render(); }
    if (d.act === 'signout') this.signOut();
    if (d.act === 'xplay') this.setCrossplay(!this.crossplay);
    if (d.act === 'create') this.createLobby();
    if (d.act === 'leave') this.leaveLobby();
    if (d.act === 'ready') this.send({ t: 'lobby.ready', ready: !(this.me && this.me.ready), car: this.carLook() });
    if (d.act === 'start') { if (this.lobby.members.every(p => p.ready || p.name === this.name)) this.send({ t: 'lobby.start' }); else this.toast('Everyone needs to READY UP first', true); }
    if (d.act === 'trk') this.send({ t: 'lobby.set', track: (this.lobby.track + 1) % 2 });
    if (d.act === 'lapm') this.send({ t: 'lobby.set', laps: this.lobby.laps - 1 });
    if (d.act === 'lapp') this.send({ t: 'lobby.set', laps: this.lobby.laps + 1 });
    if (d.act === 'voice') this.voice.on ? this.stopVoice() : this.startVoice();
    if (d.mute) this.toggleMute(d.mute);
    if (d.profile) { this.viewing = null; this.view = 'other'; this.render(); try { this.viewing = (await this.api('/api/profile/' + encodeURIComponent(d.profile))).profile; } catch (err) { } this.render(); }
    if (d.invite) {
      if (!this.lobby) { this.createLobby(); setTimeout(() => this.send({ t: 'invite', to: d.invite }), 300); }
      else this.send({ t: 'invite', to: d.invite });
    }
    if (d.accept) { this.joinLobby(d.accept); b.closest('.toast').remove(); this.show('lobby'); }
    if (d.decline) b.closest('.toast').remove();
  }
  async onSubmit(form) {
    const f = new FormData(form);
    if (form.dataset.form === 'chat') {
      const text = String(f.get('text') || '').trim(); if (text) this.send({ t: 'chat', scope: 'lobby', text });
      form.reset(); return;
    }
    try {
      const j = await this.api(form.dataset.form === 'register' ? '/api/register' : '/api/login', 'POST', { username: f.get('username'), password: f.get('password'), save: this.career.d });
      this.err = ''; this.signIn(j); this.view = 'profile'; this.render(); this.sound.chime(true);
    } catch (err) { this.err = err.message; this.render(); }
  }
  // shrink the picture to a 256px square JPEG before upload
  uploadAvatar(file) {
    if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const s = Math.min(img.width, img.height), x = c.getContext('2d');
      x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
      try { const j = await this.api('/api/avatar', 'POST', { image: c.toDataURL('image/jpeg', .86) }); this.profile.avatar = j.avatar; localStorage.setItem('overdrive_profile', JSON.stringify(this.profile)); this.render(); this.toast('Profile picture updated'); }
      catch (e) { this.toast(e.message, true); }
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }
  toast(msg, bad) {
    const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
    $('toasts').appendChild(t); setTimeout(() => t.remove(), 3500);
  }
  inviteToast(m) {
    const t = document.createElement('div'); t.className = 'toast invite';
    t.innerHTML = `${this.badge({ name: m.from, avatar: m.avatar }, 36)}<div><b>${esc(m.from)}</b> invited you to race</div><button data-accept="${esc(m.lobby)}">JOIN</button><button data-decline="1">&times;</button>`;
    $('toasts').appendChild(t); this.sound.chime(true);
    setTimeout(() => t.remove(), 20000);
  }

  // ------------------------------------------------------------------ race feed
  sendState(o) { this.send({ t: 'state', ...o }); }
  finish(time) { this.send({ t: 'finish', time }); }
}

// Floating name + title above a car. Developer tags are gold.
export function nameLabel(name, title, role) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d'), dev = role === 'dev';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'italic 900 58px "Saira Condensed", sans-serif';
  x.shadowColor = dev ? '#ffb000' : 'rgba(0,0,0,.9)'; x.shadowBlur = dev ? 18 : 10;
  x.fillStyle = dev ? '#ffd56a' : '#ffffff'; x.fillText(name, 256, 48);
  x.shadowBlur = 6; x.shadowColor = 'rgba(0,0,0,.9)';
  x.font = '600 24px Michroma, sans-serif'; x.fillStyle = dev ? '#ffb000' : '#29e0ff';
  if (title) x.fillText(title, 256, 100);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(3.2, .8, 1); s.position.y = 1.95; s.renderOrder = 5;
  return s;
}
