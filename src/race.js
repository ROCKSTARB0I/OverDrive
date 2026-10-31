// Race rules: grid, start lights, laps, positions, drift/near-miss/slipstream scoring, collisions, rewind, ghost, results.
import * as THREE from 'three';
import { pointAt, HALF_W } from './track.js';
import { Rival } from './rivals.js';
import { makeCar } from './carmodel.js';
import { fmtTime, loadBest } from './menu.js';

const SKILL = [[.76, .83], [.83, .9], [.89, .95]];   // rival pace vs the ideal line, per difficulty

export class Race {
  constructor({ track, player, playerCar, scene, settings, hud, sound, fx, mode }) {
    Object.assign(this, { track, player, playerCar, scene, settings, hud, sound, fx, mode });
    this.L = track.length;
    this.laps = mode === 'time' ? Infinity : settings.laps;
    this.t = 0; this.phase = 'grid'; this.cd = 0;
    this.rivals = [];
    this.history = []; this.rewinding = false; this.recT = 0;
    this.drift = { pts: 0, mul: 1, t: 0, idle: 0, state: 'off', showT: 0, total: 0 };
    this.stats = { topSpeed: 0, nearMiss: 0, overtakes: 0, driftTotal: 0, bestLap: Infinity };
    this.best = loadBest()[track.def.id] || Infinity;
    this.ghostRec = []; this.ghost = null; this.ghostCar = null;
    this.finishOrder = [];
    this.me = { name: 'YOU', lap: 0, total: 0, lapStart: 0, finished: false, finishTime: 0, lastS: 0, half: false };
  }

  setup() {
    const { track, settings } = this;
    const L = this.L;
    // grid: two columns behind the line, 9 m rows
    const slots = [];
    for (let k = 0; k < 6; k++) slots.push([L - 12 - Math.floor(k / 2) * 9 - (k % 2) * 3, k % 2 ? 3.4 : -3.4]);
    const mySlot = this.mode === 'time' ? 0 : this.mode === 'mp' ? (this.settings.gridSlot || 0) : 4;
    const [ps, pd] = slots[mySlot];
    this.player.reset(ps, this.mode === 'time' ? 0 : pd);
    this.me.lastS = ps; this.me.total = ps - L;
    this.remotes = [];
    if (this.mode === 'race') {
      const [lo, hi] = SKILL[settings.difficulty];
      let k = 0;
      for (let i = 0; i < 6; i++) {
        if (i === mySlot) continue;
        const r = new Rival(track, k, lo + (hi - lo) * (1 - k / 5) + (Math.random() - .5) * .02);
        // rivals get your car's power scaled by difficulty (less at STRADA, level at CORSA)
        const pf = [.82, .9, .98][settings.difficulty] * (.96 + Math.random() * .06);
        r.perf = { power: this.playerPower * pf, mass: this.player.m };
        r.place(slots[i][0], slots[i][1]);
        r.total = slots[i][0] - L;
        this.scene.add(r.car.root);
        this.rivals.push(r); k++;
      }
    } else {
      const g = JSON.parse(localStorage.getItem('overdrive_ghost_' + track.def.id) || 'null');
      if (g && g.frames && g.frames.length) this.loadGhost(g);
    }
  }

  loadGhost(g) {
    this.ghost = g;
    if (!this.ghostCar) {
      this.ghostCar = makeCar({ color: 0x29e0ff, wing: true });
      this.ghostCar.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone ? (Array.isArray(o.material) ? o.material.map(m => ghostify(m)) : ghostify(o.material)) : o.material; o.castShadow = false; } });
      this.scene.add(this.ghostCar.root);
    }
    this.ghostCar.root.visible = false;
  }

  dispose() {
    for (const r of this.rivals) this.scene.remove(r.car.root);
    for (const r of this.remotes || []) this.scene.remove(r.car.root);
    if (this.ghostCar) this.scene.remove(this.ghostCar.root);
    this.rivals = [];
  }

  // start lights: one red per second, all out = go
  startCountdown() { this.phase = 'countdown'; this.cd = 0; this.lightsLit = 0; }

  get locked() { return this.phase === 'grid' || this.phase === 'countdown'; }

  progress(e) { return e === this.me ? this.me.total : e.total; }

  standings() {
    const all = [this.me, ...this.rivals, ...(this.remotes || [])];
    return all.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1; if (b.finished) return 1;
      return this.progress(b) - this.progress(a);
    });
  }

  update(dt, input) {
    const P = this.player, me = this.me, L = this.L;
    if (this.phase === 'countdown') {
      this.cd += dt;
      const n = Math.min(5, Math.floor(this.cd / .8));
      if (n > this.lightsLit && this.cd < 4.4) { this.lightsLit = n; this.sound.beep(false); this.setLights(n); this.hud.center(String(6 - n === 1 ? 1 : 6 - n), 'cd'); }
      if (this.cd >= 4.4 + this.goDelay()) {
        this.phase = 'race'; this.setLights(0); this.sound.beep(true); this.hud.center('GO!', 'cd go');
        // launch quality
        if (P.rpm > 3500 && P.rpm < 7000) { P.boostT = 1.6; this.hud.pop('PERFECT START', '+BOOST', '#7dffa1'); this.sound.chime(true); }
        else if (P.rpm > 7000) { this.hud.pop('WHEELSPIN', '', '#ffcc33'); }
        me.lapStart = 0;
      }
    }
    if (this.phase === 'race' || this.phase === 'done') this.t += dt;

    // ---- rewind
    this.rewinding = input.rewind && this.phase === 'race' && this.history.length > 2;
    if (this.rewinding) {
      for (let k = 0; k < 2 && this.history.length > 1; k++) this.history.pop();
      const h = this.history[this.history.length - 1];
      P.restore(h.p); this.t = h.t;
      Object.assign(me, h.me);
      this.rivals.forEach((r, i) => r.restore(h.r[i]));
      for (const r of this.rivals) r.update(0, this.rivals, true);
      this.drift.state = 'off'; this.drift.pts = 0;
      this.rwTick = (this.rwTick || 0) + dt; if (this.rwTick > .08) { this.rwTick = 0; this.sound.rewindTick(); }
      return;
    }
    this.recT += dt;
    if (this.phase === 'race' && this.recT > 1 / 30) {
      this.recT = 0;
      this.history.push({ t: this.t, p: P.snapshot(), me: { ...me }, r: this.rivals.map(r => r.snapshot()) });
      if (this.history.length > 300) this.history.shift();
    }

    // ---- lap tracking (player)
    const s = P.loc.s;
    let dsS = s - me.lastS;
    if (dsS < -L / 2) dsS += L; if (dsS > L / 2) dsS -= L;
    me.total += dsS; me.lastS = s;
    if (s > L * .45 && s < L * .55) me.half = true;
    const lapNow = Math.floor(me.total / L) + 1;     // lap 1 begins at the first crossing
    if (lapNow > me.lap && this.phase !== 'grid' && this.phase !== 'countdown') {
      if (me.lap >= 1) {
        const lt = this.t - me.lapStart;
        if (me.half || me.lap >= 1) this.lapDone(lt);
      }
      me.lap = lapNow; me.lapStart = this.t; me.half = false;
      if (me.lap > this.laps && !me.finished) this.finish();
      else if (me.lap === this.laps && this.laps > 1) this.hud.pop('FINAL LAP', '', '#ff3b1f');
    } else if (lapNow < me.lap) me.lap = lapNow;
    if (this.phase === 'countdown' || this.phase === 'grid') me.lap = Math.max(me.lap, 1);

    // ---- rivals
    const playerAsCar = { total: me.total, d: P.loc.d, v: P.vx, isPlayer: true };
    const lead = Math.max(...this.rivals.map(r => r.total), me.total);
    for (const r of this.rivals) {
      let rubber = 1;
      const gap = r.total - me.total;
      if (this.phase === 'race' && !me.finished) rubber = THREE.MathUtils.clamp(1 - Math.max(0, gap - 40) * .0006, .86, 1);   // only ease off when well ahead; never boosted by your speed
      r.update(dt, [...this.rivals, playerAsCar], this.locked, rubber);
      const rl = Math.floor(r.total / L) + 1;
      if (rl > r.lap && !this.locked) {
        if (r.lap >= 1) { const lt = this.t - r.lapStart; r.bestLap = Math.min(r.bestLap, lt); }
        r.lap = rl; r.lapStart = this.t;
        if (r.lap > this.laps && !r.finished) { r.finished = true; r.finishTime = this.t; this.finishOrder.push(r); }
      }
    }
    void lead;

    if (this.phase === 'race' && !me.finished) this.scoring(dt);
    this.collide(dt);

    // ---- ghost
    if (this.mode === 'time' && this.phase === 'race') {
      this.ghostRec.push([+(this.t - me.lapStart).toFixed(3), +P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2), +P.yaw.toFixed(3)]);
      if (this.ghost && this.ghostCar) {
        const lt = this.t - me.lapStart, fr = this.ghost.frames;
        let i = this.ghostIdx || 0; if (i >= fr.length || fr[i][0] > lt) i = 0;
        while (i < fr.length - 1 && fr[i + 1][0] < lt) i++;
        this.ghostIdx = i;
        const a = fr[i], b = fr[Math.min(i + 1, fr.length - 1)];
        const f = b[0] > a[0] ? THREE.MathUtils.clamp((lt - a[0]) / (b[0] - a[0]), 0, 1) : 0;
        const gc = this.ghostCar.root;
        gc.visible = lt < this.ghost.time && me.lap >= 1;
        gc.position.set(a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f);
        let dy = b[4] - a[4]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        gc.rotation.set(0, a[4] + dy * f, 0);
      }
    }

    // ---- finish wrap-up
    if (me.finished) {
      this.doneT += dt;
    }
  }

  goDelay() { return this._go ?? (this._go = .2 + Math.random() * .6); }

  setLights(n) {
    this.track.startLights.forEach((m, k) => m.material.color.setHex(k < n ? 0xff1a10 : 0x220303));
    this.track.startLights.forEach((m, k) => { if (k < n) m.material.color.multiplyScalar(6); });
  }

  lapDone(lt) {
    const me = this.me;
    if (lt < 5) return;
    const isBest = lt < this.stats.bestLap;
    this.stats.bestLap = Math.min(this.stats.bestLap, lt);
    const allBest = lt < this.best;
    if (allBest) {
      this.best = lt;
      const b = loadBest(); b[this.track.def.id] = lt; localStorage.setItem('overdrive_best', JSON.stringify(b));
      if (this.mode === 'time') {
        const rec = this.ghostRec.filter(f => f[0] >= 0 && f[0] <= lt);
        const g = { time: lt, frames: rec.filter((f, i) => i % 3 === 0) };
        try { localStorage.setItem('overdrive_ghost_' + this.track.def.id, JSON.stringify(g)); } catch (e) { }
        this.loadGhost(g);
      }
    }
    this.ghostRec = [];
    this.hud.pop(`LAP ${fmtTime(lt)}`, allBest ? 'TRACK RECORD' : isBest ? 'BEST LAP' : '', allBest ? '#ff2e88' : isBest ? '#7dffa1' : '#f4f1ea');
    this.sound.chime(isBest);
    void me;
  }

  finish() {
    const me = this.me;
    me.finished = true; me.finishTime = this.t; this.finishOrder.push(me);
    this.phase = 'done'; this.doneT = 0;
    const pos = this.standings().indexOf(me) + 1;
    this.hud.center(pos === 1 ? 'WINNER' : `P${pos}`, 'cd msg');
    this.sound.chime(true);
  }

  // drift chains, near misses, overtakes, slipstream
  scoring(dt) {
    const P = this.player, D = this.drift, hud = this.hud;
    const sp = Math.abs(P.vx);
    this.stats.topSpeed = Math.max(this.stats.topSpeed, P.kmh);
    const drifting = P.drift > .2 && sp > 14 && !P.offroad;
    if (drifting) {
      if (D.state !== 'on') { D.state = 'on'; D.pts = 0; D.mul = 1; D.t = 0; }
      D.t += dt; D.idle = 0;
      D.mul = Math.min(5, 1 + Math.floor(D.t / 1.6));
      D.pts += dt * sp * P.drift * 14 * D.mul;
      if (P.hitWall > 3) { D.state = 'lost'; D.showT = 1.2; hud.pop('DRIFT LOST', '', '#ff4b4b'); this.sound.thump(.3, 50); }
    } else if (D.state === 'on') {
      D.idle += dt;
      if (D.idle > .6) {
        D.state = 'banked'; D.showT = 1.3;
        if (D.pts > 150) {
          P.nitro = Math.min(1, P.nitro + D.pts / 9000);
          this.stats.driftTotal += D.pts;
          hud.pop('DRIFT', `+${Math.round(D.pts)}`, '#7dffa1');
          this.sound.chime(D.pts > 2000);
        } else D.state = 'off';
      }
    } else if (D.showT > 0) { D.showT -= dt; if (D.showT <= 0) D.state = 'off'; }
    hud.drift(D.state, D.pts, D.mul);

    // traffic events
    let draft = 0;
    const fwd = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
    for (const r of this.rivals) {
      const gap = r.total - this.me.total, dd = Math.abs(r.d - P.loc.d);
      r.nearMissCool = Math.max(0, r.nearMissCool - dt);
      // passing: sign change of gap
      if (r.prevGap !== undefined && r.prevGap > 0 && gap <= 0 && sp > 15) {
        this.stats.overtakes++;
        if (dd < 2.6 && r.bumpT <= 0 && r.nearMissCool <= 0) { this.stats.nearMiss++; P.nitro = Math.min(1, P.nitro + .1); hud.pop('NEAR MISS', '+N₂O', '#29e0ff'); this.sound.whoosh(.35); r.nearMissCool = 3; }
        else { hud.pop('OVERTAKE', '', '#f4f1ea'); P.nitro = Math.min(1, P.nitro + .04); }
      }
      r.prevGap = gap;
      // slipstream
      if (gap > 3.5 && gap < 32 && dd < 1.8 && sp > 30) {
        const toR = r.pos.clone().sub(P.pos).setY(0).normalize();
        if (toR.dot(fwd) > .97) draft = Math.max(draft, 1 - (gap - 3.5) / 28.5);
      }
    }
    P.draft = THREE.MathUtils.lerp(P.draft, draft, Math.min(1, dt * 3));
    if (P.draft > .35) { P.nitro = Math.min(1, P.nitro + dt * .03); if (!this.drafting) { this.drafting = true; hud.pop('SLIPSTREAM', '', '#29e0ff'); } }
    else if (P.draft < .1) this.drafting = false;
  }

  // car-to-car contact: two circles per car
  collide(dt) {
    const P = this.player;
    const pf = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
    const pc = [P.pos.clone().addScaledVector(pf, 1.0), P.pos.clone().addScaledVector(pf, -1.0)];
    for (const r of this.rivals) {
      if ((r.pos.x - P.pos.x) ** 2 + (r.pos.z - P.pos.z) ** 2 > 36) continue;
      const rf = new THREE.Vector3(Math.sin(r.yaw), 0, Math.cos(r.yaw));
      const rc = [r.pos.clone().addScaledVector(rf, 1.0), r.pos.clone().addScaledVector(rf, -1.0)];
      let best = null;
      for (const a of pc) for (const b of rc) {
        const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
        if (d < 1.85 && (!best || d < best.d)) best = { d, nx: dx / (d || 1), nz: dz / (d || 1), at: a.clone().lerp(b, .5) };
      }
      if (!best) continue;
      const pen = 1.85 - best.d;
      P.pos.x += best.nx * pen * .55; P.pos.z += best.nz * pen * .55;
      const fr = new THREE.Vector3(); pointAt(this.track, r.s + 1, 0, fr);
      const right = this.track.R[Math.floor(((r.s % this.L) + this.L) % this.L / this.track.ds) % this.track.N];
      r.d = THREE.MathUtils.clamp(r.d - (best.nx * right.x + best.nz * right.z) * pen * .45, -(HALF_W - .8), HALF_W - .8);
      // relative velocity along the normal
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
      const pvx = fx * P.vx + fz * P.vy, pvz = fz * P.vx - fx * P.vy;
      const rvx = rf.x * r.v, rvz = rf.z * r.v;
      const rel = (pvx - rvx) * best.nx + (pvz - rvz) * best.nz;
      if (rel < 0) {
        const j = -rel * .65;
        const nvx = pvx + best.nx * j, nvz = pvz + best.nz * j;
        P.vx = nvx * fx + nvz * fz; P.vy = nvx * fz - nvz * fx;
        r.v = Math.max(0, r.v - (rf.x * best.nx + rf.z * best.nz) * j);
        r.dv += -(best.nx * right.x + best.nz * right.z) * j * .4;
        P.r += (Math.random() - .5) * j * .05;
        r.bumpT = 1;
        if (-rel > 2.5) { this.sound.impact(-rel); this.fx.sparks(best.at.setY(P.pos.y + .4), new THREE.Vector3(best.nx, .3, best.nz).multiplyScalar(3), 10); }
      }
    }
    void dt;
  }

  results() {
    const rows = this.standings().map((e, k) => {
      let time;
      if (e.finished) time = e.finishTime;
      else { const rem = (this.laps * this.L) - this.progress(e); time = this.t + rem / Math.max(20, (e.v || 40)); }
      return { pos: k + 1, name: e.name, me: e === this.me, time, best: e === this.me ? this.stats.bestLap : e.bestLap };
    });
    return rows;
  }
}

function ghostify(m) {
  const g = m.clone();
  g.transparent = true; g.opacity = .28; g.depthWrite = false;
  if (g.emissive) { g.emissive = new THREE.Color(0x29e0ff); g.emissiveIntensity = .4; }
  return g;
}
