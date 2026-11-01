// In-car radio. Stations are "live": each runs a fixed looping schedule against the wall clock, so tuning away and back
// lands wherever the broadcast has got to, mid-song, like real radio. Tuning crosses a band of static.
// Songs and idents are listed in media/stations.json (built from Nathan's own songs).
import { audioCtx } from './audio.js';

function seeded(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function hashStr(t) { let h = 2166136261; for (const c of t) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// Songs ship locked (media/music/<id>.odm, made by desktop/lock-music.py) so they can't be copied out as mp3s.
// One song is unlocked at a time, in memory, right before it plays: a few milliseconds, no up-front loading.
const LOCK_SECRET = 'rd-overdrive-1986';
export function unlock(buf, id) {
  let x = hashStr(LOCK_SECRET + id) || 1;
  const key = new Uint32Array(16384);
  for (let i = 0; i < key.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; key[i] = x >>> 0; }
  const out = new Uint8Array(buf.byteLength - 16); out.set(new Uint8Array(buf, 16));
  const w = new Uint32Array(out.buffer, 0, out.length >> 2);
  for (let i = 0; i < w.length; i++) w[i] ^= key[i & 16383];
  const kb = new Uint8Array(key.buffer);
  for (let i = w.length << 2; i < out.length; i++) out[i] ^= kb[i & 65535];
  return out;
}
// Where the songs come from: the .exe and the local server have them right next to the game. The GitHub copy has none,
// so it streams them (still locked) from the OVERDRIVE online server named in index.html.
const SERVER = ((window.overdriveDesktop && window.overdriveDesktop.server) || document.querySelector('meta[name="overdrive-server"]')?.content || '').trim().replace(/\/$/, '');
let songBase = 'media/music/';
const songPath = id => `${songBase}${id}.odm`;
const songThere = async id => (await fetch(songPath(id), { method: 'HEAD', cache: 'no-store' }).catch(() => null))?.ok;

export class Radio {
  constructor(sound) {
    this.sound = sound;
    this.stations = [];
    this.index = -1;              // -1 = off
    this.volume = .8;
    this.listeners = new Set();
    this.speaker = 'cabin';
    this.songs = new Map();       // id -> Promise<blob url>, the last few unlocked songs
  }

  songUrl(id) {
    if (!this.songs.has(id)) {
      this.songs.set(id, fetch(songPath(id)).then(r => { if (!r.ok) throw new Error('song missing'); return r.arrayBuffer(); })
        .then(buf => URL.createObjectURL(new Blob([unlock(buf, id)], { type: 'audio/mpeg' }))));
      // keep memory small: forget the oldest unlocked song unless it's the one playing
      for (const [k, v] of this.songs) {
        if (this.songs.size <= 3) break;
        if (this.playing && this.playing.song === k) continue;
        this.songs.delete(k); v.then(u => URL.revokeObjectURL(u)).catch(() => { });
      }
    }
    const p = this.songs.get(id);
    p.catch(() => this.songs.delete(id));
    return p;
  }
  // get the next song on this station ready while the current one plays
  prefetch(st, i) {
    const nx = st.items[(i + 1) % st.items.length];
    if (nx && nx.song) this.songUrl(nx.song).catch(() => { });
  }

  async load() {
    try {
      const r = await fetch('media/stations.json', { cache: 'no-store' });
      if (!r.ok) throw 0;
      const j = await r.json();
      // builds without the songs (the GitHub copy) simply have no music stations
      const first = (j.stations || []).flatMap(s => s.tracks || []).find(t => t.song);
      let haveSongs = first ? await songThere(first.song) : false;
      if (first && !haveSongs && SERVER) { songBase = SERVER + '/media/music/'; haveSongs = await songThere(first.song); }
      for (const s of j.stations || []) s.tracks = (s.tracks || []).filter(t => t.song ? haveSongs : t.file);
      this.stations = (j.stations || []).filter(s => s.tracks && s.tracks.length);
      for (const st of this.stations) this.schedule(st);
    } catch (e) { this.stations = []; }
    return this.stations.length;
  }

  // fixed running order per station: shuffled songs with an ident every couple of tracks
  schedule(st) {
    const R = seeded(hashStr(st.name));
    const songs = st.tracks.slice();
    for (let i = songs.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [songs[i], songs[j]] = [songs[j], songs[i]]; }
    const items = [];
    songs.forEach((t, k) => {
      if (st.idents && st.idents.length) items.push({ ...st.idents[k % st.idents.length], ident: true });
      items.push(t);
    });
    let at = 0;
    for (const it of items) { it.start = at; at += it.dur; }
    st.items = items; st.total = at;
    st.offset = R() * at;       // stations don't all start their loop together
  }

  // where the broadcast is right now
  position(st) {
    const t = (Date.now() / 1000 + st.offset) % st.total;
    let i = 0; while (i < st.items.length - 1 && st.items[i + 1].start <= t) i++;
    return { item: st.items[i], i, at: t - st.items[i].start };
  }

  ensureGraph() {
    const ac = audioCtx();
    if (!ac || this.el) return !!this.el;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.src = ac.createMediaElementSource(this.el);
    // car speaker voicing (switchable to full range for exterior cameras)
    this.hp = ac.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 85; this.hp.Q.value = .7;
    this.mid = ac.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 2600; this.mid.Q.value = .8; this.mid.gain.value = 2.5;
    this.lp = ac.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 11000; this.lp.Q.value = .5;
    this.gain = ac.createGain(); this.gain.gain.value = 0;
    this.duck = ac.createGain(); this.duck.gain.value = 1;
    this.src.connect(this.hp); this.hp.connect(this.mid); this.mid.connect(this.lp); this.lp.connect(this.gain); this.gain.connect(this.duck); this.duck.connect(this.sound.musicBus);
    // static band
    this.staticG = ac.createGain(); this.staticG.gain.value = 0;
    const n = ac.createBufferSource(); const len = ac.sampleRate * 2, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < .002 ? 3 : 1);
    n.buffer = b; n.loop = true;
    this.staticBp = ac.createBiquadFilter(); this.staticBp.type = 'bandpass'; this.staticBp.frequency.value = 2500; this.staticBp.Q.value = .4;
    n.connect(this.staticBp); this.staticBp.connect(this.staticG); this.staticG.connect(this.duck);
    n.start();
    this.whistle = ac.createOscillator(); this.whistle.type = 'sine';
    this.whistleG = ac.createGain(); this.whistleG.gain.value = 0;
    this.whistle.connect(this.whistleG); this.whistleG.connect(this.duck); this.whistle.start();
    this.el.addEventListener('ended', () => { if (this.index >= 0) this.tune(this.index, { quiet: true }); });
    this.el.addEventListener('error', () => { if (this.index >= 0) setTimeout(() => this.tune(this.index, { quiet: true }), 1500); });
    return true;
  }

  get current() { return this.index >= 0 ? this.stations[this.index] : null; }

  nowPlaying() {
    const st = this.current;
    if (!st) return null;
    const it = this.playing || this.position(st).item;
    return { station: st, item: it, elapsed: this.el ? this.el.currentTime : 0, dur: it.dur };
  }

  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const f of this.listeners) f(this); }

  // sweep through static, then lock onto the station partway through whatever it is broadcasting
  tune(i, { quiet = false } = {}) {
    if (!this.ensureGraph()) return;
    const ac = audioCtx(), t = ac.currentTime;
    const prev = this.index;
    this.index = i >= 0 && i < this.stations.length ? i : -1;
    this.gain.gain.cancelScheduledValues(t);
    if (!quiet) {
      this.gain.gain.setTargetAtTime(0, t, .03);
      this.staticG.gain.cancelScheduledValues(t);
      this.staticG.gain.setValueAtTime(0, t);
      this.staticG.gain.linearRampToValueAtTime(.09 * this.volume, t + .04);
      this.staticG.gain.setValueAtTime(.09 * this.volume, t + .32);
      this.staticG.gain.linearRampToValueAtTime(0, t + .5);
      this.staticBp.frequency.setValueAtTime(900 + Math.random() * 600, t);
      this.staticBp.frequency.exponentialRampToValueAtTime(4200, t + .45);
      this.whistle.frequency.setValueAtTime(prev < this.index ? 600 : 3400, t);
      this.whistle.frequency.exponentialRampToValueAtTime(prev < this.index ? 3800 : 500, t + .4);
      this.whistleG.gain.setValueAtTime(0, t); this.whistleG.gain.linearRampToValueAtTime(.012 * this.volume, t + .05); this.whistleG.gain.linearRampToValueAtTime(0, t + .42);
    }
    clearTimeout(this.lockT);
    const st = this.current;
    if (!st) { this.el.pause(); this.playing = null; this.emit(); return; }
    const lock = async () => {
      const p = this.position(st);
      this.playing = p.item;
      const key = p.item.song || p.item.file;
      let url;
      try { url = p.item.song ? await this.songUrl(p.item.song) : 'media/' + p.item.file; } catch (e) { return; }
      if (this.current !== st || this.playing !== p.item) return;   // tuned away while it was unlocking
      this.prefetch(st, p.i);
      const startAt = p.at + (quiet ? 0 : .45);
      const go = () => {
        try { this.el.currentTime = Math.min(startAt, Math.max(0, (this.el.duration || p.item.dur) - .5)); } catch (e) { }
        this.el.play().catch(() => { });
        const tt = ac.currentTime;
        this.gain.gain.cancelScheduledValues(tt);
        this.gain.gain.setValueAtTime(0, tt);
        this.gain.gain.linearRampToValueAtTime(this.volume, tt + (quiet ? .05 : .35));
      };
      if (this.elKey === key && this.el.readyState >= 1) go();
      else { this.elKey = key; this.el.src = url; this.el.addEventListener('loadedmetadata', go, { once: true }); }
      this.emit();
    };
    if (quiet) lock(); else this.lockT = setTimeout(lock, 330);
    this.emit();
  }

  next(dir = 1) {
    const n = this.stations.length;
    if (!n) { this.tune(-1); return; }
    // cycle through stations and OFF
    let k = this.index < 0 ? n : this.index;
    k = (k + dir + n + 1) % (n + 1);
    this.tune(k >= n ? -1 : k);
  }

  randomStation() { if (this.stations.length) this.tune(Math.floor(Math.random() * this.stations.length)); }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain && this.index >= 0) this.gain.gain.setTargetAtTime(this.volume, audioCtx().currentTime, .05);
    this.emit();
  }

  // 'cabin' = car speakers, 'open' = full range (exterior cameras)
  setSpeaker(mode) {
    if (!this.lp || this.speaker === mode) return;
    this.speaker = mode;
    const t = audioCtx().currentTime;
    this.lp.frequency.setTargetAtTime(mode === 'cabin' ? 11000 : 20000, t, .2);
    this.hp.frequency.setTargetAtTime(mode === 'cabin' ? 85 : 25, t, .2);
    this.mid.gain.setTargetAtTime(mode === 'cabin' ? 2.5 : 0, t, .2);
  }

  // linear fade of the whole radio (station + static) over sec seconds
  fade(v, sec = 1.5) {
    if (!this.duck) return;
    const t = audioCtx().currentTime, g = this.duck.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + sec);
  }

  setDuck(v) { if (this.duck) this.duck.gain.setTargetAtTime(v, audioCtx().currentTime, .3); }
}
