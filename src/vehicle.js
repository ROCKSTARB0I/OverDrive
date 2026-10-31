// Player car dynamics: planar bicycle model with Pacejka-style tyres, weight transfer, combined slip,
// a 7-speed gearbox, aero drag/downforce, nitrous and slipstream. Height/attitude come from the road surface.
import * as THREE from 'three';
import { locate, WALL } from './track.js';
import { CAR } from './carmodel.js';

const G = 9.81;
// twin-turbo flat-plane V8: boost builds from 3000 rpm
const TORQUE = [[800, 300], [2000, 360], [3000, 430], [4000, 520], [5000, 560], [6000, 565], [7000, 530], [7800, 480], [8200, 420]];
export const GEARS = [2.95, 2.05, 1.52, 1.18, .94];
export const FINAL = 3.3;
const IDLE = 900, REDLINE = 7900, LIMIT = 8050;

function torqueAt(rpm) {
  if (rpm <= TORQUE[0][0]) return TORQUE[0][1];
  for (let i = 1; i < TORQUE.length; i++) if (rpm <= TORQUE[i][0]) {
    const [r0, t0] = TORQUE[i - 1], [r1, t1] = TORQUE[i];
    return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0);
  }
  return TORQUE[TORQUE.length - 1][1];
}
// lateral force curve: normalised slip -> -1..1, peak around 7 degrees, ~78% sliding grip
function tyre(alpha, B = 15, C = 1.42) { return Math.sin(C * Math.atan(B * alpha)); }

export class Vehicle {
  constructor(track) {
    this.track = track;
    this.m = 1290; this.a = 1.26; this.b = 1.39; this.L = this.a + this.b; this.h = .44;
    this.Iz = 2350;
    this.mu = 1.32;
    this.torqueMul = 1; this.boostTop = 1; this.brakeMul = 1;
    this.reset(0, 0);
  }

  // car stats + garage upgrades (career.tuning())
  applyTuning(t) {
    this.torqueMul = t.torque; this.boostTop = t.boostTop; this.mu = t.mu; this.brakeMul = t.brake;
    this.m = t.mass; this.Iz = 2350 * t.mass / 1290;
  }

  reset(s, d, heading) {
    const tr = this.track;
    const f = Math.floor(((s % tr.length) + tr.length) % tr.length / tr.ds) % tr.N;
    const p = tr.P[f].clone().addScaledVector(tr.R[f], d);
    this.pos = new THREE.Vector3(p.x, p.y, p.z);
    this.yaw = heading ?? Math.atan2(tr.T[f].x, tr.T[f].z);
    this.vx = 0; this.vy = 0; this.r = 0;      // body frame: forward, left, yaw rate (+ = left)
    this.ax = 0; this.ay = 0;
    this.gear = 1; this.rpm = IDLE; this.shiftT = 0; this.clutch = 1;
    this.steer = 0; this.steerIn = 0;
    this.throttle = 0; this.brake = 0; this.hand = 0;
    this.nitro = .65; this.nitroOn = false; this.boostT = 0;
    this.slip = 0; this.spin = 0; this.drift = 0; this.beta = 0;
    this.wheelRot = 0; this.wheelSpin = 0;
    this.loc = locate(tr, this.pos, -1, {});
    this.hitWall = 0; this.scrape = 0;
    this.draft = 0; this.reverse = false;
    this.limiter = 0; this.lastShift = 0;
    this.susp = { pitch: 0, roll: 0, vp: 0, vr: 0, heave: 0 };
    this.quat = new THREE.Quaternion();
    this.manual = false;
    this.events = [];
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get kmh() { return Math.abs(this.vx) * 3.6; }

  shift(dir) {
    if (this.shiftT > 0) return;
    const g = this.gear + dir;
    if (g < 1 || g > GEARS.length) return;
    this.gear = g; this.shiftT = .11; this.events.push(dir > 0 ? 'upshift' : 'downshift');
    // perfect manual upshift window
    if (dir > 0 && this.manual && this.rpm > 7100 && this.rpm < 7950) this.events.push('perfectShift');
  }

  // input: {steer -1..1 (+ = right), throttle, brake, hand, nitro}
  step(dt, input, opts = {}) {
    const { m, a, b, L, h } = this;
    // ---- inputs
    const vAbs = Math.abs(this.vx);
    const steerRate = input.analog ? 8 : 3.4 + (input.steer === 0 ? 2.2 : 0);
    this.steerIn += THREE.MathUtils.clamp(input.steer - this.steerIn, -steerRate * dt, steerRate * dt);
    const maxSteer = .58 / (1 + vAbs / 16);
    this.beta = vAbs > 2 ? Math.atan2(this.vy, Math.abs(this.vx)) : 0;
    const assist = opts.assist ?? .55;
    // steer is + left internally
    this.steer = -this.steerIn * maxSteer + this.beta * assist * THREE.MathUtils.smoothstep(vAbs, 4, 12);
    this.steer = THREE.MathUtils.clamp(this.steer, -.62, .62);

    let thr = input.throttle, brk = input.brake;
    // reverse when stopped and holding brake
    if (this.vx < .6 && brk > .5 && thr < .1 && !opts.locked) this.reverse = true;
    if (thr > .1 && this.reverse && this.vx > -.5) this.reverse = false;
    if (this.reverse) { const t = thr; thr = brk; brk = t; }
    this.throttle = thr; this.brake = brk; this.hand = input.hand ? 1 : 0;

    // ---- engine & gearbox
    if (this.shiftT > 0) this.shiftT -= dt;
    const ratio = (this.reverse ? 3.1 : GEARS[this.gear - 1]) * FINAL;
    const wheelRpm = Math.abs(this.vx) / CAR.wheelR * 60 / (2 * Math.PI);
    let rpm = wheelRpm * ratio;
    // launch clutch slip keeps the engine in its torque band from rest
    const slipRpm = IDLE + thr * (opts.locked ? 7000 : 3400);
    if (this.gear === 1 || this.reverse) this.clutch = THREE.MathUtils.clamp((rpm - 900) / 2600, 0, 1);
    else this.clutch = 1;
    rpm = Math.max(rpm, THREE.MathUtils.lerp(slipRpm, rpm, this.clutch), IDLE);
    if (opts.locked) rpm = THREE.MathUtils.lerp(this.rpm, IDLE + thr * 7300, Math.min(1, dt * (thr > this.rpm / 8000 ? 7 : 4)));
    this.limiter = Math.max(0, this.limiter - dt);
    if (rpm > LIMIT) this.limiter = .06;
    const cut = this.limiter > 0 || this.shiftT > 0;
    this.rpm = THREE.MathUtils.lerp(this.rpm, Math.min(rpm, LIMIT + 60), Math.min(1, dt * 30));
    if (opts.locked) { thr = 0; brk = 1; this.vx *= .5; this.vy = 0; this.r = 0; }

    // auto box
    if (!this.manual && !this.reverse && !opts.locked && this.shiftT <= 0 && this.clutch >= 1 || (!this.manual && this.gear === 1 && !opts.locked && this.shiftT <= 0)) {
      if (this.rpm > 7650 && this.gear < GEARS.length && thr > .2) this.shift(1);
      else if (this.gear > 1) {
        const down = wheelRpm * GEARS[this.gear - 2] * FINAL;
        if (down < 7000 && (this.rpm < 4000 || (brk > .3 && down < 6300))) this.shift(-1);
      }
    }

    // ---- forces
    const speed2 = this.vx * this.vx + this.vy * this.vy;
    const drag = .5 * 1.2 * .74 * (1 - this.draft * .4) * speed2;
    const down = .5 * 1.2 * 1.5 * speed2;
    const roll = 160 + this.m * .012 * Math.abs(this.vx);
    let Nf = m * G * b / L - m * this.ax * h / L + down * .44;
    let Nr = m * G * a / L + m * this.ax * h / L + down * .56;
    Nf = Math.max(Nf, 800); Nr = Math.max(Nr, 800);
    const surf = this.offroad ? .62 : 1;
    const muF = this.mu * surf, muR = this.mu * surf * (this.hand ? .42 : 1);

    // drive
    let Fdrive = 0;
    const tq = torqueAt(this.rpm) * this.torqueMul * (1 + (this.boostTop - 1) * THREE.MathUtils.smoothstep(this.rpm, 4000, 6500));
    if (!cut) Fdrive = tq * thr * ratio * .86 / CAR.wheelR * (this.clutch < 1 ? .9 : 1);
    if (!cut && thr < .05 && !this.reverse) Fdrive -= (this.rpm / 8000) * 70 * ratio / CAR.wheelR; // engine braking
    if (this.reverse) Fdrive = -Math.min(Fdrive, 5200) * (this.vx > -14 ? 1 : 0);
    // nitrous
    this.nitroOn = input.nitro && this.nitro > 0 && thr > .3 && !this.reverse;
    if (this.nitroOn) { Fdrive += 6200; this.nitro = Math.max(0, this.nitro - dt * .15); }
    if (this.boostT > 0) { this.boostT -= dt; Fdrive += 5500; }
    // brakes (front biased, split by load)
    const brakeF = brk * 19500 * this.brakeMul * Math.sign(this.vx || 1);
    const handF = this.hand * 3600 * Math.sign(this.vx || 1);
    // rear longitudinal demand vs grip
    let Fxr = Fdrive - brakeF * .38 - handF;
    const capR = muR * Nr;
    this.spin = Math.max(0, Math.abs(Fxr) / capR - .92);
    if (Math.abs(Fxr) > capR) Fxr = Math.sign(Fxr) * capR * (Fdrive > 0 && !brk ? .92 : 1);
    let Fxf = -brakeF * .62;
    const capF = muF * Nf;
    if (Math.abs(Fxf) > capF) Fxf = Math.sign(Fxf) * capF;
    // stop at rest instead of jittering
    if (Math.abs(this.vx) < .5 && thr < .05 && !this.reverse) { Fxr = -this.vx * m * 4; Fxf = 0; }

    // lateral
    const vxs = Math.max(Math.abs(this.vx), 3.5) * Math.sign(this.vx || 1);
    const alphaF = Math.atan2(this.vy + a * this.r, Math.abs(vxs)) - this.steer * Math.sign(vxs);
    const alphaR = Math.atan2(this.vy - b * this.r, Math.abs(vxs));
    // combined slip: lateral capacity left after longitudinal use
    const latCapF = Math.sqrt(Math.max(0, capF * capF - Fxf * Fxf));
    // rear ellipse is forgiving (power oversteer, not snap spins); wheelspin still costs some side grip
    const ur = Fxr / capR;
    const latCapR = capR * Math.sqrt(Math.max(.2, 1 - .55 * ur * ur)) * (1 - Math.min(.3, this.spin * .3));
    const Fyf = -tyre(alphaF) * latCapF;
    const Fyr = -tyre(alphaR, 13) * latCapR;

    const cs = Math.cos(this.steer), sn = Math.sin(this.steer);
    const Fx = Fxr + Fxf * cs - Fyf * sn - drag * Math.sign(this.vx) - roll * Math.sign(this.vx) * Math.min(1, Math.abs(this.vx));
    const Fy = Fyr + Fyf * cs + Fxf * sn;
    const Mz = a * (Fyf * cs + Fxf * sn) - b * Fyr;

    this.ax = THREE.MathUtils.lerp(this.ax, Fx / m, Math.min(1, dt * 10));
    this.ay = Fy / m;
    this.vx += (Fx / m + this.vy * this.r) * dt;
    this.vy += (Fy / m - this.vx * this.r) * dt;
    this.r += Mz / this.Iz * dt;
    // low speed: blend to kinematic steering, kill sideways creep
    const lowK = 1 - THREE.MathUtils.smoothstep(Math.abs(this.vx), 1.5, 6);
    if (lowK > 0) {
      const rk = this.vx * Math.tan(this.steer) / L;
      this.r = THREE.MathUtils.lerp(this.r, rk, lowK * Math.min(1, dt * 12));
      this.vy *= 1 - lowK * Math.min(1, dt * 8);
    }
    // stability aid on keyboard: damp extreme yaw a little
    this.r *= 1 - Math.min(1, dt * (opts.yawDamp ?? .6));

    // ---- integrate in the world
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const lx = fz, lz = -fx;                    // left vector
    const wx = fx * this.vx + lx * this.vy, wz = fz * this.vx + lz * this.vy;
    this.pos.x += wx * dt; this.pos.z += wz * dt;
    this.yaw += this.r * dt;

    // ---- road surface + walls
    const tr = this.track;
    const loc = locate(tr, this.pos, this.loc.i, this.loc);
    this.offroad = Math.abs(loc.d) > 7.4;
    const lim = WALL - 1.05;
    this.hitWall = 0;
    if (Math.abs(loc.d) > lim) {
      const side = Math.sign(loc.d);
      const push = Math.abs(loc.d) - lim;
      // wall normal points back to the road
      const nx = -side * loc.rx, nz = -side * loc.rz;
      this.pos.x += nx * push; this.pos.z += nz * push;
      let vxw = wx, vzw = wz;
      const vn = vxw * nx + vzw * nz;
      if (vn < 0) {
        vxw -= 1.12 * vn * nx; vzw -= 1.12 * vn * nz;
        const tang = Math.hypot(vxw, vzw);
        const fr = Math.max(0, 1 - (-vn) * .01 - dt * .3);
        vxw *= fr; vzw *= fr;
        this.hitWall = -vn;
        // glancing hits steer the nose along the wall
        const tx = -nz * side, tz = nx * side;
        const along = Math.atan2(vxw, vzw);
        let dy = along - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * Math.min(1, -vn * .015);
        this.r *= .6;
        void tang; void tx; void tz;
      }
      this.scrape = Math.hypot(vxw, vzw);
      const fx2 = Math.sin(this.yaw), fz2 = Math.cos(this.yaw);
      this.vx = vxw * fx2 + vzw * fz2;
      this.vy = vxw * fz2 - vzw * fx2;
    } else this.scrape = 0;
    this.pos.y = loc.y;

    // ---- drift / spin state
    const vAbs2 = Math.abs(this.vx);
    this.drift = vAbs2 > 12 ? Math.abs(this.beta) : 0;
    this.slip = Math.max(this.spin, THREE.MathUtils.smoothstep(Math.abs(alphaR), .1, .35), brk > .8 && vAbs2 > 8 ? .3 : 0, this.hand && vAbs2 > 5 ? .6 : 0);
    this.wheelSpin = this.vx / CAR.wheelR + this.spin * 40;
    this.wheelRot += this.wheelSpin * dt;

    // ---- suspension feel (visual)
    const s = this.susp;
    const tp = THREE.MathUtils.clamp(-this.ax * .006, -.05, .05), trl = THREE.MathUtils.clamp(this.ay * .0055, -.055, .055);
    s.vp += ((tp - s.pitch) * 110 - s.vp * 13) * dt; s.pitch += s.vp * dt;
    s.vr += ((trl - s.roll) * 110 - s.vr * 13) * dt; s.roll += s.vr * dt;
    // orient to the road normal
    const up = loc.up;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const left = new THREE.Vector3().crossVectors(up, fwd);
    const mtx = new THREE.Matrix4().makeBasis(left, up, fwd);
    this.quat.setFromRotationMatrix(mtx);
  }

  // copy a compact state for rewind
  snapshot() {
    return [this.pos.x, this.pos.y, this.pos.z, this.yaw, this.vx, this.vy, this.r, this.gear, this.rpm, this.nitro, this.loc.i];
  }
  restore(s) {
    this.pos.set(s[0], s[1], s[2]); this.yaw = s[3]; this.vx = s[4]; this.vy = s[5]; this.r = s[6]; this.gear = s[7]; this.rpm = s[8]; this.nitro = s[9];
    locate(this.track, this.pos, s[10], this.loc);
    this.shiftT = 0; this.ax = 0;
    const up = this.loc.up;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    this.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, fwd), up, fwd));
  }
}

export { REDLINE, IDLE };
