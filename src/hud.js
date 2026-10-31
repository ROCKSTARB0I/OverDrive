// Race HUD: analogue-style tach with boost and nitrous arcs, position/lap/timing, leaderboard, minimap and call-outs.
import { fmtTime } from './menu.js';

const $ = id => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = $('hud');
    this.gc = $('gauge'); this.g = this.gc.getContext('2d');
    this.mc = $('minimap'); this.m = this.mc.getContext('2d');
    const dpr = Math.min(devicePixelRatio, 2);
    this.gc.width = this.gc.height = 340 * dpr; this.g.scale(dpr, dpr);
    this.mc.width = this.mc.height = 240 * dpr; this.m.scale(dpr, dpr);
    this.last = {};
    this.mapCache = null;
  }
  show(on) { this.el.classList.toggle('hidden', !on); }

  set(id, v) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; } }

  timing({ pos, of, lap, laps, time, lapTime, best }) {
    this.set('h-pos', String(pos)); this.set('h-of', String(of));
    this.set('h-lap', String(Math.min(lap, laps))); this.set('h-laps', laps === Infinity ? '∞' : String(laps));
    this.set('h-time', fmtTime(time)); this.set('h-laptime', fmtTime(lapTime)); this.set('h-best', fmtTime(best));
  }

  board(rows) {
    const html = rows.map((r, k) => `<div class="${r.me ? 'me' : ''}"><i>${k + 1}</i>${r.name}<b>${r.gap}</b></div>`).join('');
    if (html !== this.last.board) { this.last.board = html; $('board').innerHTML = html; }
  }

  gauge({ rpm, kmh, gear, nitro, nitroOn, boost, redline = 7900, manual, shiftT }) {
    const g = this.g, cx = 178, cy = 178, R = 140;
    g.clearRect(0, 0, 340, 340);
    const a0 = Math.PI * .72, a1 = Math.PI * 2.08;
    const maxR = 9000;
    const ang = r => a0 + (a1 - a0) * Math.min(1, r / maxR);
    // backplate
    const bg = g.createRadialGradient(cx, cy, 20, cx, cy, R + 14);
    bg.addColorStop(0, 'rgba(10,12,18,.75)'); bg.addColorStop(1, 'rgba(10,12,18,.15)');
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R + 14, 0, Math.PI * 2); g.fill();
    // rpm segments
    const segs = 54;
    for (let i = 0; i < segs; i++) {
      const r0 = i / segs * maxR, r1 = (i + .72) / segs * maxR;
      const lit = rpm >= r0;
      const red = r0 >= redline - 400;
      g.strokeStyle = lit ? (red ? '#ff3b1f' : (r0 > redline - 1600 ? '#ffb347' : '#f4f1ea')) : 'rgba(255,255,255,.12)';
      if (lit && red) { g.shadowColor = '#ff3b1f'; g.shadowBlur = 10; }
      g.lineWidth = 14; g.beginPath(); g.arc(cx, cy, R, ang(r0), ang(r1)); g.stroke(); g.shadowBlur = 0;
    }
    // numbers
    g.fillStyle = 'rgba(244,241,234,.7)'; g.font = '600 15px Rajdhani'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 0; k <= 9; k++) { const a = ang(k * 1000); g.fillText(String(k), cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); }
    // boost arc (inner) + nitrous arc (outer bottom)
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(41,224,255,.15)'; g.beginPath(); g.arc(cx, cy, R - 40, a0, a0 + 1.4); g.stroke();
    g.strokeStyle = '#29e0ff'; g.shadowColor = '#29e0ff'; g.shadowBlur = 8;
    g.beginPath(); g.arc(cx, cy, R - 40, a0, a0 + 1.4 * Math.max(0, boost)); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = 'rgba(41,224,255,.7)'; g.font = '600 10px Michroma'; g.fillText('BOOST', cx - 74, cy + 74);
    const n0 = Math.PI * .28, n1 = Math.PI * .72;
    g.lineWidth = 9; g.strokeStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.arc(cx, cy, R + 4, n0, n1); g.stroke();
    g.strokeStyle = nitroOn ? '#ffffff' : '#ff2e88'; g.shadowColor = '#ff2e88'; g.shadowBlur = nitroOn ? 18 : 8;
    g.beginPath(); g.arc(cx, cy, R + 4, n1 - (n1 - n0) * nitro, n1); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = '#ff2e88'; g.font = '600 10px Michroma'; g.fillText('N₂O', cx, cy + R + 20 > 336 ? 330 : cy + R - 4);
    // speed + gear
    g.fillStyle = '#f4f1ea'; g.font = 'italic 900 78px "Saira Condensed"'; g.textAlign = 'center';
    g.fillText(String(Math.round(kmh)), cx - 4, cy - 4);
    g.font = '600 12px Michroma'; g.fillStyle = 'rgba(244,241,234,.55)'; g.fillText('KM/H', cx, cy + 38);
    const shiftNow = rpm > redline - 300;
    g.font = 'italic 900 44px "Saira Condensed"';
    g.fillStyle = shiftNow && manual ? (Math.floor(performance.now() / 80) % 2 ? '#ff3b1f' : '#fff') : '#ff3b1f';
    g.fillText(gear, cx + 70, cy + 70);
    if (manual) { g.font = '600 9px Michroma'; g.fillStyle = 'rgba(244,241,234,.5)'; g.fillText('MANUAL', cx + 70, cy + 98); }
    // shift lights
    for (let i = 0; i < 7; i++) {
      const th = redline - 1800 + i * 260;
      const on = rpm > th;
      g.fillStyle = on ? (i < 3 ? '#3cff9e' : i < 5 ? '#ffcc33' : '#ff3b1f') : 'rgba(255,255,255,.08)';
      if (on && shiftNow) g.fillStyle = '#29e0ff';
      g.beginPath(); g.arc(cx - 66 + i * 22, cy - 82, 6, 0, Math.PI * 2); g.fill();
    }
    void shiftT;
  }

  minimap(track, cars) {
    const m = this.m, S = 240;
    if (!this.mapCache || this.mapCache.track !== track) {
      let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
      for (const p of track.P) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
      const sc = (S - 30) / Math.max(mxx - mnx, mxz - mnz);
      this.mapCache = { track, sc, cx: (mnx + mxx) / 2, cz: (mnz + mxz) / 2 };
    }
    const { sc, cx, cz } = this.mapCache;
    const X = p => S / 2 - (p.x - cx) * sc, Z = p => S / 2 - (p.z - cz) * sc;
    m.clearRect(0, 0, S, S);
    m.fillStyle = 'rgba(8,10,16,.55)'; m.beginPath(); m.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); m.fill();
    m.lineJoin = 'round';
    m.strokeStyle = 'rgba(255,255,255,.18)'; m.lineWidth = 8;
    m.beginPath(); track.P.forEach((p, i) => { if (i % 4) return; i ? m.lineTo(X(p), Z(p)) : m.moveTo(X(p), Z(p)); }); m.closePath(); m.stroke();
    m.strokeStyle = 'rgba(244,241,234,.75)'; m.lineWidth = 2.5; m.stroke();
    m.fillStyle = '#fff'; const p0 = track.P[0]; m.fillRect(X(p0) - 5, Z(p0) - 1.5, 10, 3);
    for (const c of cars) {
      m.fillStyle = c.me ? '#ff3b1f' : c.ghost ? 'rgba(41,224,255,.7)' : '#f4f1ea';
      m.beginPath(); m.arc(X(c.pos), Z(c.pos), c.me ? 6 : 4, 0, Math.PI * 2); m.fill();
      if (c.me) { m.strokeStyle = '#fff'; m.lineWidth = 2; m.stroke(); }
    }
  }

  pop(text, sub = '', color = '#f4f1ea') {
    const d = document.createElement('div'); d.className = 'pop'; d.style.color = color;
    d.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    const box = $('pops'); box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 1900);
  }

  center(html, cls = 'cd') {
    $('center').innerHTML = html ? `<span class="${cls}">${html}</span>` : '';
  }

  drift(state, pts, mul) {
    const d = $('drift');
    d.classList.toggle('on', state !== 'off');
    d.classList.toggle('banked', state === 'banked');
    d.classList.toggle('lost', state === 'lost');
    this.set('d-pts', Math.round(pts).toLocaleString());
    this.set('d-mul', 'x' + mul);
  }

  flags({ wrong, rewind, cam }) {
    $('wrongway').style.display = wrong ? 'block' : 'none';
    $('rewind').style.display = rewind ? 'block' : 'none';
    this.set('camhint', cam);
  }
}
