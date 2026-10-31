// Main menu logic: hover/press on the cabin controls and the CRT trip-computer pages.
import * as THREE from 'three';
import { TRACKS } from './track.js';
import { makeCar } from './carmodel.js';
import { BUTTONS } from './cockpit.js';

export const PAINTS = [
  ['ROSSO CORSA', 0xb3100f], ['BIANCO', 0xefede6], ['NERO', 0x0c0c0e], ['GIALLO', 0xf0b400],
  ['MIAMI TEAL', 0x13a39b], ['VERDE BRG', 0x0e4a30], ['ARGENTO', 0xa9afb7], ['BLU TAHITI', 0x1f4fa8],
];
export const WHEEL_FINISHES = ['silver', 'gold', 'black', 'white'];
export const STRIPES = [['NONE', null], ['WHITE', 0xf2efe6], ['GOLD', 0xd4a017], ['RED', 0xd81e1e]];
const DIFF = ['STRADA', 'SPORT', 'CORSA'];
const CAMS = ['CHASE', 'FAR CHASE', 'BONNET', 'COCKPIT'];

const DEFAULTS = { laps: 3, difficulty: 1, gearbox: 'auto', camera: 0, sfx: .9, music: .7, track: 0, paint: 0, wheels: 1, stripe: 0, mode: 'race', assist: 1 };
export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('overdrive_settings') || '{}') }; } catch (e) { return { ...DEFAULTS }; }
}
export function saveSettings(s) { try { localStorage.setItem('overdrive_settings', JSON.stringify(s)); } catch (e) { } }
export function loadBest() { try { return JSON.parse(localStorage.getItem('overdrive_best') || '{}'); } catch (e) { return {}; } }
export function fmtTime(t) {
  if (!isFinite(t) || t <= 0 || t > 1e8) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// track outline points for the CRT map
const OUTLINES = TRACKS.map(def => {
  const c = new THREE.CatmullRomCurve3(def.pts.map(p => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
  return c.getSpacedPoints(160);
});

export class Menu {
  constructor({ cockpit, settings, radio, sound, renderer, envMap, onStart, onPlayerLook }) {
    Object.assign(this, { cockpit, settings, radio, sound, renderer, onStart, onPlayerLook });
    this.page = 'home';
    this.hover = null;
    this.hot = [];
    this.t = 0;
    this.enabled = false;
    this.starting = false;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(9, 9);
    this.tip = document.getElementById('tooltip');
    // garage turntable scene drawn into the CRT
    this.gScene = new THREE.Scene();
    this.gScene.environment = envMap;
    this.gScene.background = new THREE.Color(0x020604);
    this.gCam = new THREE.PerspectiveCamera(30, 512 / 320, .1, 50);
    this.gCam.position.set(0, 1.6, 7.6); this.gCam.lookAt(0, .45, 0);
    this.gCar = makeCar({ color: PAINTS[settings.paint][1], wheels: WHEEL_FINISHES[settings.wheels], stripe: STRIPES[settings.stripe][1] });
    this.gCar.setHeadlights(true);
    this.gScene.add(this.gCar.root);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64), new THREE.MeshStandardMaterial({ color: 0x111312, roughness: .25, metalness: .6 }));
    floor.rotation.x = -Math.PI / 2; this.gScene.add(floor);
    const key = new THREE.SpotLight(0xffffff, 120, 20, .5, .6); key.position.set(3, 6, 4); this.gScene.add(key);
    const rim = new THREE.SpotLight(0x29e0ff, 60, 20, .6, .6); rim.position.set(-4, 3, -4); this.gScene.add(rim);
    const rim2 = new THREE.SpotLight(0xff2e88, 60, 20, .6, .6); rim2.position.set(4, 2, -5); this.gScene.add(rim2);
    this.gScene.add(new THREE.HemisphereLight(0x405060, 0x101010, .4));
    radio.onChange(() => { if (this.page === 'radio' || this.page === 'home') this.draw(); });
  }

  // ---------------------------------------------------------------- input
  pointer(e, camera, dom) {
    const r = dom.getBoundingClientRect();
    this.mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    this.mouseScreen = [e.clientX, e.clientY];
    this.pick(camera);
  }

  pick(camera) {
    if (!this.enabled) { this.hover = null; return; }
    this.ray.setFromCamera(this.mouse, camera);
    const hit = this.ray.intersectObjects(this.cockpit.interactives, false)[0];
    let h = hit ? hit.object.userData : null;
    if (h && h.id === 'screen') {
      const u = hit.uv.x * 1024, v = (1 - hit.uv.y) * 640;
      const spot = this.hot.find(s => u >= s.x && u <= s.x + s.w && v >= s.y && v <= s.y + s.h);
      h = spot ? { id: 'screen', spot, tip: spot.tip } : null;
      this.screenUV = [u, v];
    }
    const key = h ? h.id + (h.spot ? h.spot.key : '') : null;
    if (key !== this.hoverKey) { this.hoverKey = key; if (this.page) this.draw(); }
    this.hover = h;
    document.body.style.cursor = h ? 'pointer' : 'default';
    if (h && h.tip && this.mouseScreen) {
      this.tip.textContent = h.tip; this.tip.classList.add('on');
      this.tip.style.left = (this.mouseScreen[0] + 16) + 'px'; this.tip.style.top = (this.mouseScreen[1] + 14) + 'px';
    } else this.tip.classList.remove('on');
  }

  click() {
    if (!this.enabled || !this.hover) return;
    const h = this.hover, c = this.cockpit, S = this.settings;
    if (h.kind === 'button') {
      const b = c.buttons[h.id]; b.press = 1;
      this.sound.click(.55, 2600);
      if (h.id === 'race' || h.id === 'time') S.mode = h.id;
      this.page = h.id;
      this.draw();
      this.onButton && this.onButton(h.id);
    } else if (h.id === 'dial') {
      S.difficulty = (S.difficulty + 1) % 3; c.dial.target = (S.difficulty - 1) * -1.0;
      this.sound.detent(); setTimeout(() => this.sound.detent(), 70);
      this.draw();
    } else if (h.id === 'knob') {
      c.knob.target -= .52; this.sound.detent();
      this.radio.next(1); this.page = 'radio'; this.draw();
    } else if (h.id === 'hazard') {
      this.hazard = !this.hazard; this.sound.click(.5, 2000);
    } else if (h.id === 'horn') {
      this.sound.horn();
    } else if (h.id === 'start') {
      if (this.starting) return;
      this.onStart(S.mode);
    } else if (h.id === 'screen') {
      this.sound.click(.35, 4200);
      h.spot.act();
      this.draw();
    }
    saveSettings(S);
  }

  wheel(dy) {
    if (!this.enabled || !this.hover) return;
    if (this.hover.id === 'knob') {
      this.radio.setVolume(this.radio.volume - Math.sign(dy) * .05);
      this.cockpit.knob.target -= Math.sign(dy) * .12;
      this.sound.detent();
      this.flash = { text: `VOLUME ${Math.round(this.radio.volume * 100)}`, t: 1.2 };
      this.draw();
    }
  }

  // keyboard navigation of the six buttons + key
  key(code) {
    if (!this.enabled) return;
    const ids = [...BUTTONS.map(b => b[0]), 'start'];
    let i = ids.indexOf(this.kbSel ?? 'race');
    if (code === 'ArrowRight' || code === 'Tab') i = (i + 1) % ids.length;
    else if (code === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
    else if (code === 'Enter' || code === 'Space') {
      const id = ids[i];
      this.hover = id === 'start' ? { id, kind: 'start' } : { id, kind: 'button' };
      this.click(); return;
    } else if (code === 'KeyT') { this.radio.next(1); return; }
    else return;
    this.kbSel = ids[i];
    this.sound.detent();
  }

  // ---------------------------------------------------------------- per frame
  update(dt, camera) {
    this.t += dt;
    const c = this.cockpit;
    for (const [id, b] of Object.entries(c.buttons)) {
      b.press = Math.max(0, b.press - dt * 6);
      const hov = (this.hover && this.hover.id === id) || this.kbSel === id;
      b.hover += ((hov ? 1 : 0) - b.hover) * Math.min(1, dt * 12);
      const active = this.page === id || (id === this.settings.mode && (this.page === 'home'));
      b.cap.position.z = b.baseZ - b.press * .004;
      b.led.material.color.setHex(active ? 0xff7a1a : 0x2a1205);
      if (active) b.led.material.color.multiplyScalar(3);
      b.capMat.emissive = b.capMat.emissive || new THREE.Color();
      b.capMat.emissive.setRGB(.25 * b.hover, .12 * b.hover, .03 * b.hover);
    }
    c.dial.angle += (c.dial.target - c.dial.angle) * Math.min(1, dt * 14);
    c.dial.mesh.rotation.z = c.dial.angle;
    c.knob.angle += (c.knob.target - c.knob.angle) * Math.min(1, dt * 14);
    c.knob.mesh.rotation.z = c.knob.angle;
    c.key.turn += (c.key.target - c.key.turn) * Math.min(1, dt * 10);
    c.key.group.rotation.z = -c.key.turn;
    if (this.hazard) c.hazard.material[4].emissive.setHex(Math.sin(this.t * 9) > 0 ? 0xff2a00 : 0x200000);
    else c.hazard.material[4].emissive.setHex(0x300000);
    // highlight hovered knob/key by a small lift
    for (const [o, id] of [[c.dial.mesh, 'dial'], [c.knob.mesh, 'knob']]) o.position.z = (this.hover && this.hover.id === id ? .015 : .012);
    if (this.flash) { this.flash.t -= dt; if (this.flash.t <= 0) this.flash = null; }
    // redraw a few times a second for clocks / radio progress / CRT flicker
    this.redraw = (this.redraw || 0) - dt;
    if (this.redraw <= 0) { this.draw(); this.redraw = .25; }
    if (this.page === 'garage') {
      this.gCar.root.rotation.y += dt * .5;
      this.gCar.update(dt);
      this.renderer.setRenderTarget(c.screen.preview);
      this.renderer.render(this.gScene, this.gCam);
      this.renderer.setRenderTarget(null);
    }
    c.screen.previewMesh.visible = this.page === 'garage';
    this.pick(camera);
    this.drawRings();
  }

  drawRings() {
    if (this._ringsDrawn === this.settings.difficulty) return;
    this._ringsDrawn = this.settings.difficulty;
    const ring = (ctx, labels, sel, title) => {
      ctx.clearRect(0, 0, 256, 256);
      ctx.fillStyle = '#0c0c0e'; ctx.beginPath(); ctx.arc(128, 128, 126, 0, 7); ctx.fill();
      ctx.strokeStyle = '#2a2a2e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(128, 128, 122, 0, 7); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      labels.forEach((l, k) => {
        const a = -Math.PI / 2 + (k - (labels.length - 1) / 2) * 1.0;
        ctx.save(); ctx.translate(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); ctx.rotate(a + Math.PI / 2);
        ctx.font = '700 22px "Saira Condensed"'; ctx.fillStyle = k === sel ? '#ff8a2a' : '#8c8f96';
        ctx.fillText(l, 0, 0); ctx.restore();
      });
      ctx.font = '600 15px Michroma'; ctx.fillStyle = '#6c6f76'; ctx.fillText(title, 128, 226);
    };
    const c = this.cockpit;
    ring(c.dial.ctx, DIFF, this.settings.difficulty, 'MODE');
    c.dial.ring.material.map.needsUpdate = true;
    ring(c.knob.ctx, ['VOL', 'TUNE', 'BAND'], 1, 'RADIO');
    c.knob.ring.material.map.needsUpdate = true;
  }

  // ---------------------------------------------------------------- CRT pages
  draw() {
    const { ctx: x, tex } = this.cockpit.screen;
    const W = 1024, H = 640, S = this.settings;
    const G = '#7dffb0', D = '#2f7a52', A = '#ffb347';
    this.hot = [];
    const hot = (key, rx, ry, w, h, act, tip) => this.hot.push({ key, x: rx, y: ry, w, h, act, tip });
    const isHot = key => this.hover && this.hover.spot && this.hover.spot.key === key;
    x.clearRect(0, 0, W, H);
    x.fillStyle = '#020a05'; x.fillRect(0, 0, W, H);
    x.textBaseline = 'alphabetic';
    const txt = (t, px, py, size = 40, col = G, align = 'left', glow = 12) => {
      x.font = `${size}px VT323, monospace`; x.textAlign = align; x.fillStyle = col; x.shadowColor = col; x.shadowBlur = glow;
      x.fillText(t, px, py); x.shadowBlur = 0;
    };
    const btn = (key, label, px, py, w, h, act, tip) => {
      const on = isHot(key);
      x.strokeStyle = on ? A : D; x.lineWidth = 3; x.shadowColor = on ? A : G; x.shadowBlur = on ? 14 : 0;
      x.strokeRect(px, py, w, h); x.shadowBlur = 0;
      if (on) { x.fillStyle = 'rgba(255,179,71,.12)'; x.fillRect(px, py, w, h); }
      txt(label, px + w / 2, py + h / 2 + 13, 40, on ? A : G, 'center');
      hot(key, px, py, w, h, act, tip);
    };
    // header bar
    x.fillStyle = 'rgba(125,255,176,.08)'; x.fillRect(0, 0, W, 64);
    const now = new Date();
    txt('VANTA  TRIP COMPUTER', 28, 46, 38, D, 'left', 0);
    txt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, W - 28, 46, 44, G, 'right');
    const np = this.radio.nowPlaying();
    const footer = msg => { x.fillStyle = 'rgba(125,255,176,.08)'; x.fillRect(0, H - 60, W, 60); txt(msg, W / 2, H - 18, 36, Math.sin(this.t * 4) > -.3 ? A : D, 'center'); };
    const p = this.page;

    if (p === 'home') {
      txt('OVERDRIVE', W / 2, 250, 150, G, 'center', 24);
      txt('NIGHT CIRCUIT  ·  VANTA 308 TURBO', W / 2, 310, 38, D, 'center', 0);
      txt('SELECT A MODE BELOW', W / 2, 400, 44, G, 'center');
      if (np) txt(`${np.station.freq || ''} ${np.station.name}  ·  ${np.item.ident ? 'STATION ID' : np.item.title}`, W / 2, 470, 34, D, 'center', 0);
      footer('TURN THE KEY TO DRIVE');
    } else if (p === 'race' || p === 'time') {
      const def = TRACKS[S.track];
      txt(p === 'race' ? 'QUICK RACE' : 'TIME ATTACK', 40, 120, 64, G);
      txt(def.name, 40, 175, 46, A);
      // wrap blurb
      const words = def.blurb.split(' '); let line = '', ly = 220;
      for (const w of words) { if ((line + w).length > 30) { txt(line, 40, ly, 32, D, 'left', 0); line = ''; ly += 32; } line += w + ' '; }
      txt(line, 40, ly, 32, D, 'left', 0);
      btn('trkP', '<', 40, 330, 70, 60, () => { S.track = (S.track + TRACKS.length - 1) % TRACKS.length; }, 'Previous track');
      btn('trkN', '>', 120, 330, 70, 60, () => { S.track = (S.track + 1) % TRACKS.length; }, 'Next track');
      if (p === 'race') {
        txt(`LAPS ${S.laps}`, 230, 372, 44, G);
        btn('lapM', '-', 380, 330, 60, 60, () => { S.laps = Math.max(1, S.laps - 1); }, 'Fewer laps');
        btn('lapP', '+', 450, 330, 60, 60, () => { S.laps = Math.min(10, S.laps + 1); }, 'More laps');
        txt(`5 RIVALS  ·  ${DIFF[S.difficulty]}`, 40, 450, 40, D, 'left', 0);
      } else {
        const best = (JSON.parse(localStorage.getItem('overdrive_best') || '{}'))[def.id];
        txt(`BEST LAP  ${fmtTime(best)}`, 230, 372, 44, G);
        txt('GHOST OF YOUR BEST LAP', 40, 450, 40, D, 'left', 0);
      }
      // map
      const pts = OUTLINES[S.track];
      let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
      for (const q of pts) { mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); mnz = Math.min(mnz, q.z); mxz = Math.max(mxz, q.z); }
      const box = [600, 90, 380, 400], sc = Math.min(box[2] / (mxx - mnx), box[3] / (mxz - mnz));
      const mx = q => box[0] + box[2] / 2 - ((q.x - (mnx + mxx) / 2) * sc), mz = q => box[1] + box[3] / 2 - ((q.z - (mnz + mxz) / 2) * sc);
      x.strokeStyle = G; x.lineWidth = 6; x.shadowColor = G; x.shadowBlur = 14; x.lineJoin = 'round';
      x.beginPath(); pts.forEach((q, k) => k ? x.lineTo(mx(q), mz(q)) : x.moveTo(mx(q), mz(q))); x.closePath(); x.stroke(); x.shadowBlur = 0;
      const dot = pts[Math.floor(this.t * 12) % pts.length];
      x.fillStyle = A; x.beginPath(); x.arc(mx(dot), mz(dot), 10, 0, 7); x.fill();
      x.fillStyle = '#fff'; x.fillRect(mx(pts[0]) - 12, mz(pts[0]) - 3, 24, 6);
      footer('TURN THE KEY TO START');
    } else if (p === 'garage') {
      // transparent window over the live turntable render
      x.clearRect(30, 80, 620, 400);
      x.strokeStyle = D; x.lineWidth = 3; x.strokeRect(30, 80, 620, 400);
      txt(PAINTS[S.paint][0], 40, 525, 46, A);
      txt('PAINT', 680, 110, 36, D, 'left', 0);
      PAINTS.forEach(([name, col], k) => {
        const px = 680 + (k % 4) * 80, py = 125 + Math.floor(k / 4) * 80;
        x.fillStyle = '#' + col.toString(16).padStart(6, '0'); x.fillRect(px, py, 64, 64);
        x.strokeStyle = k === S.paint ? A : (isHot('p' + k) ? G : D); x.lineWidth = k === S.paint ? 5 : 2; x.strokeRect(px - 3, py - 3, 70, 70);
        hot('p' + k, px, py, 64, 64, () => { S.paint = k; this.applyLook(); }, name);
      });
      txt('WHEELS', 680, 330, 36, D, 'left', 0);
      btn('wh', WHEEL_FINISHES[S.wheels].toUpperCase(), 680, 345, 300, 56, () => { S.wheels = (S.wheels + 1) % WHEEL_FINISHES.length; this.applyLook(); }, 'Telephone-dial alloys: change finish');
      txt('STRIPE', 680, 440, 36, D, 'left', 0);
      btn('st', STRIPES[S.stripe][0], 680, 455, 300, 56, () => { S.stripe = (S.stripe + 1) % STRIPES.length; this.applyLook(); }, 'Side stripe decal');
      footer('VANTA 308 TURBO  ·  TWIN-TURBO V8  ·  5-SPEED');
    } else if (p === 'radio') {
      txt('RADIO', 40, 120, 64, G);
      const st = this.radio.stations;
      if (!st.length) txt('SEARCHING…', 40, 220, 64, A);
      st.forEach((s, k) => {
        const py = 150 + k * 62, on = this.radio.index === k;
        if (py > 520) return;
        const key = 's' + k, hv = isHot(key);
        x.fillStyle = on ? 'rgba(255,179,71,.14)' : hv ? 'rgba(125,255,176,.08)' : 'transparent'; x.fillRect(30, py, 560, 54);
        txt(`${s.freq || ''}`, 44, py + 40, 40, on ? A : D, 'left', 0);
        txt(s.name, 170, py + 40, 42, on ? A : G);
        hot(key, 30, py, 560, 54, () => this.radio.tune(k), s.tag || s.name);
      });
      btn('off', 'OFF', 30, 150 + Math.min(st.length, 6) * 62 + 4, 160, 50, () => this.radio.tune(-1), 'Radio off');
      // now playing panel
      x.strokeStyle = D; x.lineWidth = 2; x.strokeRect(620, 140, 370, 360);
      txt('NOW PLAYING', 640, 185, 34, D, 'left', 0);
      if (np) {
        const it = np.item;
        const wrap = (t, py, size, col, max) => { let l = '', yy = py; for (const w of String(t).split(' ')) { if ((l + w).length > max) { txt(l, 640, yy, size, col); yy += size * .9; l = ''; } l += w + ' '; } txt(l, 640, yy, size, col); return yy; };
        let yy = wrap(it.ident ? np.station.name : it.title, 240, 46, A, 16);
        yy = wrap(it.ident ? 'STATION IDENT' : (it.artist || ''), yy + 44, 36, G, 20);
        const f = Math.min(1, np.elapsed / (np.dur || 1));
        x.fillStyle = D; x.fillRect(640, 450, 330, 8); x.fillStyle = A; x.fillRect(640, 450, 330 * f, 8);
        const mm = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        txt(`${mm(np.elapsed)} / ${mm(np.dur || 0)}`, 640, 490, 30, D, 'left', 0);
      } else txt('—', 640, 260, 46, D);
      txt('MUSIC © ITS ARTISTS & RIGHTS HOLDERS · NOT OWNED BY RUFF DOGS STUDIOS', W / 2, H - 76, 26, D, 'center', 0);
      footer(`VOLUME ${Math.round(this.radio.volume * 100)}  ·  KNOB: NEXT  ·  SCROLL: VOLUME`);
    } else if (p === 'settings') {
      txt('SETUP', 40, 120, 64, G);
      const rows = [
        ['GEARBOX', S.gearbox === 'auto' ? 'AUTOMATIC' : 'MANUAL  (Q / E)', () => { S.gearbox = S.gearbox === 'auto' ? 'manual' : 'auto'; }],
        ['CAMERA', CAMS[S.camera], () => { S.camera = (S.camera + 1) % CAMS.length; }],
        ['STEER ASSIST', ['OFF', 'ON', 'HIGH'][S.assist], () => { S.assist = (S.assist + 1) % 3; }],
        ['SFX VOLUME', `${Math.round(S.sfx * 100)}%`, () => { S.sfx = S.sfx >= 1 ? 0 : Math.round((S.sfx + .1) * 10) / 10; this.sound.setVolumes(S.sfx, S.music); }],
        ['MUSIC VOLUME', `${Math.round(S.music * 100)}%`, () => { S.music = S.music >= 1 ? 0 : Math.round((S.music + .1) * 10) / 10; this.sound.setVolumes(S.sfx, S.music); }],
        ['DIFFICULTY', DIFF[S.difficulty], () => { S.difficulty = (S.difficulty + 1) % 3; this.cockpit.dial.target = (S.difficulty - 1) * -1; }],
      ];
      rows.forEach(([k, v, act], i) => {
        const py = 150 + i * 70, key = 'r' + i, on = isHot(key);
        x.fillStyle = on ? 'rgba(255,179,71,.12)' : 'transparent'; x.fillRect(30, py, 964, 60);
        txt(k, 50, py + 44, 44, on ? A : G);
        txt(v, 970, py + 44, 44, A, 'right');
        hot(key, 30, py, 964, 60, act, 'Click to change');
      });
    } else if (p === 'controls') {
      txt('CONTROLS', 40, 120, 64, G);
      const rows = [['W / UP', 'THROTTLE'], ['S / DOWN', 'BRAKE / REVERSE'], ['A D / LEFT RIGHT', 'STEER'], ['SPACE', 'HANDBRAKE'], ['SHIFT', 'NITROUS'], ['Q / E', 'SHIFT DOWN / UP (MANUAL)'], ['C', 'CAMERA'], ['R (HOLD)', 'REWIND'], ['T', 'NEXT RADIO STATION'], ['ESC', 'PAUSE']];
      rows.forEach(([k, v], i) => { const py = 170 + i * 42; txt(k, 50, py, 38, A); txt(v, 470, py, 38, G); });
      txt('GAMEPAD SUPPORTED', 50, 610, 32, D, 'left', 0);
    }
    if (this.flash) { x.fillStyle = 'rgba(2,10,5,.85)'; x.fillRect(W / 2 - 220, H / 2 - 50, 440, 100); txt(this.flash.text, W / 2, H / 2 + 18, 56, A, 'center'); }
    // CRT: scanlines, slight roll band, vignette
    x.fillStyle = 'rgba(0,0,0,.28)';
    for (let yy = 0; yy < H; yy += 4) x.fillRect(0, yy, W, 2);
    const band = (this.t * 90) % (H + 200) - 100;
    const gr = x.createLinearGradient(0, band - 60, 0, band + 60);
    gr.addColorStop(0, 'rgba(125,255,176,0)'); gr.addColorStop(.5, 'rgba(125,255,176,.05)'); gr.addColorStop(1, 'rgba(125,255,176,0)');
    x.fillStyle = gr; x.fillRect(0, band - 60, W, 120);
    const vg = x.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)');
    x.fillStyle = vg; x.fillRect(0, 0, W, H);
    if (p === 'garage') x.clearRect(33, 83, 614, 394);
    tex.needsUpdate = true;
  }

  applyLook() {
    const S = this.settings;
    const rot = this.gCar.root.rotation.y;
    this.gScene.remove(this.gCar.root);
    this.gCar = makeCar({ color: PAINTS[S.paint][1], wheels: WHEEL_FINISHES[S.wheels], stripe: STRIPES[S.stripe][1] });
    this.gCar.setHeadlights(true);
    this.gCar.root.rotation.y = rot;
    this.gScene.add(this.gCar.root);
    this.onLook && this.onLook();
    saveSettings(S);
  }
}
