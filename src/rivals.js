// Rival drivers. They ride the track in (distance, lateral) space against a precomputed speed profile,
// with per-driver skill, racing-line drift, overtaking moves and rubber-banding.
import * as THREE from 'three';
import { pointAt, frameAt, HALF_W } from './track.js';
import { makeCar, CAR, BODY_IDS } from './carmodel.js';
import { GEARS, FINAL } from './vehicle.js';
import { nameLabel } from './online.js';

const NAMES = ['K. VOSS', 'R. TANAKA', 'M. DELACROIX', 'J. OKAFOR', 'S. NIKOLAEV', 'A. MORETTI', 'D. HALE', 'L. REYES'];
// period paint: Miami teal, Bianco, Nero, Giallo, racing green, Grigio, burgundy, Tahiti blue
const COLORS = [0x1aa6a0, 0xf0eee8, 0x0d0d0f, 0xf2b705, 0x0f4d32, 0x9aa0a8, 0x6d0f1c, 0x1f4fa8];
const WHEELS = ['gold', 'silver', 'gold', 'black', 'gold', 'silver', 'silver', 'white'];
const STRIPES = [0xffffff, 0xd81e1e, 0xd4a017, null, 0xf0e6c8, null, 0xd4a017, 0xffffff];

export class Rival {
  constructor(track, k, skill) {
    this.track = track; this.k = k;
    this.name = NAMES[k % NAMES.length];
    this.car = makeCar({ body: BODY_IDS[(k + Math.floor(Math.random() * 4)) % BODY_IDS.length], color: COLORS[k % COLORS.length], wheels: WHEELS[k % 8], stripe: STRIPES[k % 8], wing: k % 2 === 0 });
    this.skill = skill;
    this.s = 0; this.total = 0; this.d = 0; this.dTarget = 0; this.v = 0; this.dv = 0;
    this.lineSeed = Math.random() * 100;
    this.wheelRot = 0; this.steer = 0; this.brake = 0;
    this.rpm = 1000; this.gear = 1; this.throttle = 0;
    this.finished = false; this.finishTime = 0; this.lap = 0; this.bestLap = 1e9; this.lapStart = 0;
    this.pos = new THREE.Vector3(); this.yaw = 0;
    this.nearMissCool = 0; this.bumpT = 0;
    this.perf = { power: 230000, mass: 1300 };
    this.label = nameLabel(this.name, 'STREET RACER', 'driver');
    this.car.chassis.add(this.label);
  }

  place(s, d) { this.s = s; this.total = s; this.d = d; this.dTarget = d; this.v = 0; this.update(0, [], true); }

  update(dt, others, locked, rubber = 1) {
    const tr = this.track;
    if (!locked && !this.finished) {
      // look ahead for the slowest corner within braking range
      const f = frameAt(tr, this.s);
      let target = f.v;
      for (let k = 6; k <= 120; k += 6) { const fa = frameAt(tr, this.s + k); target = Math.min(target, Math.sqrt(fa.v * fa.v + 2 * 10.5 * k)); }
      target *= this.skill * rubber;
      // racing line: hug the inside of corners
      const kAhead = frameAt(tr, this.s + 25).K;
      let line = THREE.MathUtils.clamp(-kAhead * 420, -1, 1) * (HALF_W - 2) + Math.sin(this.s * .004 + this.lineSeed) * 1.2;
      // traffic: steer round slower cars ahead
      let blocked = false;
      for (const o of others) {
        if (o === this) continue;
        let gap = o.total - this.total;
        if (gap > 0 && gap < 22 && Math.abs(o.d - this.d) < 2.6) {
          blocked = true;
          if (o.v < this.v + 2) {
            const passSide = o.d > 0 ? -1 : 1;
            line = THREE.MathUtils.clamp(o.d + passSide * 3.6, -(HALF_W - 1.3), HALF_W - 1.3);
            if (gap < 9) target = Math.min(target, o.v - 1);
          }
        }
      }
      this.dTarget = THREE.MathUtils.clamp(line, -(HALF_W - 1.2), HALF_W - 1.2);
      const dd = THREE.MathUtils.clamp(this.dTarget - this.d, -3, 3);
      this.dv = THREE.MathUtils.lerp(this.dv, dd * .9, Math.min(1, dt * 2.5));
      this.d += this.dv * dt;
      // real car physics: wheel power over mass, minus aero drag and rolling resistance, traction-limited off the line
      const m = this.perf.mass, drive = Math.min(6.5, this.perf.power / (m * Math.max(this.v, 4))) - .444 * this.v * this.v / m - .15;
      const acc = this.v < target ? Math.max(.2, drive) * (blocked ? .85 : 1) : -11;
      this.throttle = this.v < target ? 1 : 0;
      this.brake = this.v > target + 1.5 ? 1 : 0;
      this.v = Math.max(0, this.v + acc * dt);
      if (this.v > target && acc < 0) this.v = Math.max(this.v, target);
      this.s += this.v * dt; this.total += this.v * dt;
      this.bumpT = Math.max(0, this.bumpT - dt);
    } else if (this.finished) {
      // cool-down lap pace
      this.v = THREE.MathUtils.lerp(this.v, 30, dt * .5);
      this.s += this.v * dt; this.total += this.v * dt;
    }
    // world placement
    const f = frameAt(tr, this.s);
    pointAt(tr, this.s, this.d, this.pos);
    const ahead = pointAt(tr, this.s + 3, this.d + this.dv * 3 / Math.max(this.v, 5), new THREE.Vector3());
    this.yaw = Math.atan2(ahead.x - this.pos.x, ahead.z - this.pos.z);
    const up = f.U;
    const fwd = ahead.sub(this.pos).normalize();
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const left = new THREE.Vector3().crossVectors(up, fwd);
    this.car.root.position.copy(this.pos);
    this.car.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, fwd));
    // wheels + gearbox (for sound)
    this.wheelRot += this.v / CAR.wheelR * dt;
    this.steer = THREE.MathUtils.lerp(this.steer, THREE.MathUtils.clamp(f.K * 2.6 + this.dv * .02, -.4, .4), Math.min(1, dt * 6));
    for (const [i, w] of this.car.wheels.entries()) {
      w.spin.rotation.x = this.wheelRot;
      if (i < 2) w.hub.rotation.y = this.steer;
    }
    this.car.setBrake(this.brake);
    const wr = this.v / CAR.wheelR * 60 / (2 * Math.PI) * FINAL;
    while (this.gear < GEARS.length && wr * GEARS[this.gear - 1] > 7600) this.gear++;
    while (this.gear > 1 && wr * GEARS[this.gear - 2] < 6200) this.gear--;
    this.rpm = Math.max(900, wr * GEARS[this.gear - 1]);
    this.car.chassis.rotation.x = THREE.MathUtils.lerp(this.car.chassis.rotation.x, this.brake ? .02 : -.012 * this.throttle, dt * 5);
  }

  snapshot() { return [this.s, this.total, this.d, this.v, this.dv, this.lap, this.lapStart]; }
  restore(a) { [this.s, this.total, this.d, this.v, this.dv, this.lap, this.lapStart] = a; }
}

export const AI_COLORS = COLORS;
