// Sound: a synthesized V10 built from firing-pulse loops, tyres, wind, road, scrapes, impacts, nitrous,
// cabin controls and race cues. Everything is generated at load; no samples.
import * as THREE from 'three';

let ac = null;
export function audioCtx() { return ac; }

function noiseBuffer(sec = 2, color = 'white') {
  const n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}

function impulse(sec = 1.8, decay = 2.6) {
  const n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < ac.sampleRate * .012 ? i / (ac.sampleRate * .012) : 1);
    }
  }
  return b;
}

// One loop of several engine cycles. Each cylinder firing is an exhaust pulse: a few damped resonances plus a short noise tick.
// Small per-cylinder level and timing differences give the uneven, mechanical texture.
function engineLoop(baseRpm, ncyl, res, seed, banks = null, tick = .5, jitter = .05) {
  const sr = ac.sampleRate, cycles = 8;
  const cycle = 120 / baseRpm;
  const n = Math.round(cycle * cycles * sr);
  const b = ac.createBuffer(1, n, sr), d = b.getChannelData(0);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const amp = Array.from({ length: ncyl }, () => .8 + rnd() * .4);
  const off = Array.from({ length: ncyl }, () => (rnd() - .5) * jitter);
  const pulses = ncyl * cycles;
  for (let p = 0; p < pulses; p++) {
    const cyl = p % ncyl;
    const t0 = (p + off[cyl] + (rnd() - .5) * .02) / ncyl * cycle;
    const a = amp[cyl] * (.9 + rnd() * .2);
    const i0 = Math.floor(t0 * sr);
    const len = Math.floor(sr * .03);
    for (let k = 0; k < len; k++) {
      const t = k / sr;
      let v = 0;
      const bank = Array.isArray(res[0][0]) ? res[banks ? banks[cyl] : cyl % res.length] : res;
      for (const [f, dec, g] of bank) v += g * Math.exp(-t / dec) * Math.sin(2 * Math.PI * f * t);
      v += (rnd() * 2 - 1) * Math.exp(-t / .0008) * tick;
      const idx = (i0 + k) % n;
      d[(idx + n) % n] += v * a;
    }
  }
  // normalise + gentle DC removal
  let mean = 0; for (let i = 0; i < n; i++) mean += d[i]; mean /= n;
  let peak = 0; for (let i = 0; i < n; i++) { d[i] -= mean; peak = Math.max(peak, Math.abs(d[i])); }
  for (let i = 0; i < n; i++) d[i] /= peak;
  return b;
}

function shaperCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
  return c;
}

// per-engine voices: firing count, bank pattern and pipe resonances give each car its own character
const VOICES = {
  // flat-plane V8: banks alternate -> two screaming fours
  v8f: () => ({
    low: engineLoop(1500, 8, [[[190, .008, 1], [450, .0045, .7], [1250, .0016, .35], [2800, .0006, .2]], [[205, .0075, .9], [520, .004, .75], [1400, .0015, .3], [3100, .0006, .18]]], 11),
    high: engineLoop(6000, 8, [[[128, .006, 1], [310, .0035, .8], [760, .0014, .45], [1600, .0005, .25]], [[140, .0058, .95], [345, .0033, .8], [820, .0013, .4], [1750, .0005, .22]]], 29) }),
  // cross-plane V8: same bank fires twice in a row -> lumpy burble, loose timing
  v8x: () => ({
    low: engineLoop(1500, 8, [[[120, .012, 1], [300, .006, .6], [800, .002, .25]], [[150, .011, .8], [360, .006, .55], [900, .002, .22]]], 41, [0, 1, 0, 0, 1, 0, 1, 1], .35, .16),
    high: engineLoop(6000, 8, [[[85, .009, 1], [210, .005, .7], [560, .0018, .3]], [[100, .009, .85], [250, .005, .6], [640, .0018, .25]]], 43, [0, 1, 0, 0, 1, 0, 1, 1], .35, .12) }),
  // turbo straight-six: smooth, silky, higher harmonics
  i6: () => ({
    low: engineLoop(1500, 6, [[230, .006, 1], [610, .0035, .8], [1700, .0013, .45], [3600, .0005, .25]], 51, null, .4, .025),
    high: engineLoop(6000, 6, [[160, .005, 1], [420, .003, .85], [1100, .0011, .45], [2300, .0004, .25]], 53, null, .4, .02) }),
  // air-cooled flat-six: boxer banks alternate, raspy and hollow
  f6: () => ({
    low: engineLoop(1500, 6, [[[150, .009, 1], [520, .004, .8], [1500, .0014, .5]], [[175, .008, .9], [470, .004, .7], [1650, .0013, .45]]], 61, null, .9, .06),
    high: engineLoop(6000, 6, [[[105, .007, 1], [360, .0035, .8], [980, .0012, .5]], [[118, .0068, .9], [330, .0034, .75], [1080, .0011, .45]]], 63, null, .9, .05) }),
};
const VOICE_BUF = {};
function voiceBuffers(v) { return VOICE_BUF[v] ??= (VOICES[v] || VOICES.v8f)(); }

let BUF = null;
function buffers() {
  if (BUF) return BUF;
  BUF = {
    white: noiseBuffer(2.5),
    brown: noiseBuffer(3, 'brown'),
    // flat-plane V8: firing alternates banks, each bank its own pipe resonance -> two screaming fours
    rival: engineLoop(4000, 8, [[140, .007, 1], [360, .004, .6], [900, .0015, .3]], 7),
    ir: impulse(1.6, 2.8),
    tunnelIr: impulse(2.6, 2.0),
  };
  return BUF;
}

class Engine {
  constructor(out, { rival = false, voice = 'v8f' } = {}) {
    const B = buffers();
    this.rival = rival;
    this.out = ac.createGain(); this.out.gain.value = 0;
    this.out.connect(out);
    this.lp = ac.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = .9;
    this.shaper = ac.createWaveShaper(); this.shaper.curve = shaperCurve(1.6); this.shaper.oversample = '2x';
    this.body = ac.createBiquadFilter(); this.body.type = 'peaking'; this.body.frequency.value = 160; this.body.gain.value = 5; this.body.Q.value = .8;
    this.shaper.connect(this.lp); this.lp.connect(this.body); this.body.connect(this.out);
    this.srcs = [];
    const V = voiceBuffers(voice);
    const loops = rival ? [[B.rival, 4000]] : [[V.low, 1500], [V.high, 6000]];
    this.top = 8000;
    for (const [buf, base] of loops) {
      const s = ac.createBufferSource(); s.buffer = buf; s.loop = true;
      const gn = ac.createGain(); gn.gain.value = 0;
      s.connect(gn); gn.connect(this.shaper); s.start(ac.currentTime + Math.random() * .05);
      this.srcs.push({ s, gn, base });
    }
    if (!rival) {
      // intake roar
      const n = ac.createBufferSource(); n.buffer = B.white; n.loop = true;
      this.intakeBp = ac.createBiquadFilter(); this.intakeBp.type = 'bandpass'; this.intakeBp.Q.value = 1.4;
      this.intake = ac.createGain(); this.intake.gain.value = 0;
      n.connect(this.intakeBp); this.intakeBp.connect(this.intake); this.intake.connect(this.out);
      n.start();
      // gear whine
      this.whine = ac.createOscillator(); this.whine.type = 'triangle';
      this.whineG = ac.createGain(); this.whineG.gain.value = 0;
      this.whine.connect(this.whineG); this.whineG.connect(this.out); this.whine.start();
      // twin turbos: spool whistle that follows boost
      this.turbo = ac.createOscillator(); this.turbo.type = 'sine';
      this.turbo2 = ac.createOscillator(); this.turbo2.type = 'sine';
      this.turboG = ac.createGain(); this.turboG.gain.value = 0;
      this.turbo.connect(this.turboG); this.turbo2.connect(this.turboG); this.turboG.connect(this.out);
      this.turbo.start(); this.turbo2.start();
      this.boost = 0;
    }
    this.lastThr = 0; this.lastRpm = 0; this.popCool = 0; this.level = 1;
  }

  set(rpm, thr, { cut = false, gear = 3, speed = 0, dt = .016 } = {}) {
    const t = ac.currentTime;
    for (const v of this.srcs) v.s.playbackRate.setTargetAtTime(Math.max(.25, rpm / v.base), t, .015);
    if (this.srcs.length === 2) {
      const x = THREE.MathUtils.smoothstep(rpm, 2600, 5200);
      this.srcs[0].gn.gain.setTargetAtTime(.9 * (1 - x) + .05, t, .03);
      this.srcs[1].gn.gain.setTargetAtTime(.9 * x, t, .03);
    } else this.srcs[0].gn.gain.setTargetAtTime(.8, t, .05);
    const load = cut ? .12 : .3 + thr * .7;
    this.lp.frequency.setTargetAtTime(500 + rpm * .45 * (.45 + load) + thr * 1800, t, .03);
    this.out.gain.setTargetAtTime(this.level * (.16 + load * .22) * (.8 + rpm / 8000 * .45), t, .02);
    if (!this.rival) {
      this.intakeBp.frequency.setTargetAtTime(240 + rpm * .16, t, .05);
      this.intake.gain.setTargetAtTime(this.level * thr * (rpm / 8000) * .09, t, .05);
      this.whine.frequency.setTargetAtTime(speed * 38 + 60, t, .05);
      this.whineG.gain.setTargetAtTime(this.level * Math.min(.012, speed * .00018), t, .1);
      // boost builds with load above ~3000 rpm, bleeds off on lift
      const want = cut ? this.boost * .9 : thr * THREE.MathUtils.smoothstep(rpm, 2600, 5200);
      this.boost += (want - this.boost) * Math.min(1, dt * (want > this.boost ? 2.2 : 6));
      this.turbo.frequency.setTargetAtTime(1900 + this.boost * 5400 + rpm * .15, t, .05);
      this.turbo2.frequency.setTargetAtTime(1900 * 1.007 + this.boost * 5450 + rpm * .15, t, .05);
      this.turboG.gain.setTargetAtTime(this.level * this.boost * this.boost * .022, t, .05);
      if (this.lastThr > .55 && thr < .15 && this.boost > .45) this.blowOff(this.boost);
      // overrun crackle when lifting off at high revs
      this.popCool -= dt;
      if (this.lastThr > .6 && thr < .15 && rpm > 4800 && this.popCool <= 0) { this.crackle(rpm); this.popCool = .7; }
    }
    this.lastThr = thr; this.lastRpm = rpm;
  }

  crackle(rpm) {
    const B = buffers();
    const n = 3 + Math.floor(Math.random() * 6 + rpm / 2500);
    let t = ac.currentTime + .03;
    for (let i = 0; i < n; i++) {
      t += .035 + Math.random() * .11;
      const s = ac.createBufferSource(); s.buffer = B.white; s.playbackRate.value = .6 + Math.random() * .8;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 1600; bp.Q.value = 1.1;
      const g = ac.createGain();
      const amp = (.25 + Math.random() * .35) * this.level;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + .002); g.gain.exponentialRampToValueAtTime(.001, t + .04 + Math.random() * .05);
      s.connect(bp); bp.connect(g); g.connect(this.out.context === ac ? this.out : this.out);
      s.start(t, Math.random() * 2, .12);
      // low thump under each pop
      const o = ac.createOscillator(); o.frequency.setValueAtTime(90 + Math.random() * 40, t); o.frequency.exponentialRampToValueAtTime(40, t + .06);
      const og = ac.createGain(); og.gain.setValueAtTime(amp * .9, t); og.gain.exponentialRampToValueAtTime(.001, t + .07);
      o.connect(og); og.connect(this.out); o.start(t); o.stop(t + .08);
    }
  }

  // blow-off valve: a flutter of released charge air
  blowOff(b) {
    const B = buffers(), t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = B.white;
    const hp = ac.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.setValueAtTime(3200, t); hp.frequency.exponentialRampToValueAtTime(1300, t + .45); hp.Q.value = .9;
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.32 * b * this.level, t + .012); g.gain.exponentialRampToValueAtTime(.001, t + .5);
    const flutter = ac.createGain(); flutter.gain.value = .6;
    const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.setValueAtTime(28, t); lfo.frequency.linearRampToValueAtTime(14, t + .45);
    const lg = ac.createGain(); lg.gain.value = .4; lfo.connect(lg); lg.connect(flutter.gain);
    s.connect(hp); hp.connect(flutter); flutter.connect(g); g.connect(this.out);
    s.start(t, Math.random()); s.stop(t + .55); lfo.start(t); lfo.stop(t + .55);
    this.boost *= .2;
  }

  stop() { for (const v of this.srcs) try { v.s.stop(); } catch (e) { } this.out.disconnect(); }
}

// Loop of filtered noise with a controllable gain.
function noiseVoice(dest, buf, filters, rate = 1) {
  const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  let node = s;
  const fs = filters.map(([type, f, q]) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q ?? .7; node.connect(b); node = b; return b; });
  const g = ac.createGain(); g.gain.value = 0; node.connect(g); g.connect(dest);
  s.start(0, Math.random() * buf.duration);
  return { s, g, fs };
}

export class Sound {
  constructor() {
    this.ready = false;
    this.settings = { sfx: .9, music: .7 };
  }

  init() {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const B = buffers();
    this.master = ac.createGain(); this.master.gain.value = /[?&]mute/.test(location.search) ? 0 : .9;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .2;
    this.master.connect(comp); comp.connect(ac.destination);
    this.sfx = ac.createGain(); this.sfx.gain.value = this.settings.sfx; this.sfx.connect(this.master);
    this.musicBus = ac.createGain(); this.musicBus.gain.value = this.settings.music; this.musicBus.connect(this.master);
    // reverbs: short "space" + long tunnel
    this.verb = ac.createConvolver(); this.verb.buffer = B.ir;
    this.verbSend = ac.createGain(); this.verbSend.gain.value = .06;
    this.verbSend.connect(this.verb); this.verb.connect(this.sfx);
    this.tunnel = ac.createConvolver(); this.tunnel.buffer = B.tunnelIr;
    this.tunnelSend = ac.createGain(); this.tunnelSend.gain.value = 0;
    this.tunnelSend.connect(this.tunnel); this.tunnel.connect(this.sfx);
    // car bus (player car) with an interior low-pass for cabin views
    this.carBus = ac.createGain(); this.carBus.gain.value = 0;
    this.cabin = ac.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 20000;
    this.carBus.connect(this.cabin); this.cabin.connect(this.sfx); this.cabin.connect(this.verbSend); this.cabin.connect(this.tunnelSend);
    this.engine = null;
    this.tyre = noiseVoice(this.carBus, B.white, [['bandpass', 1050, 7], ['peaking', 1900, 4]]);
    this.tyre2 = noiseVoice(this.carBus, B.white, [['bandpass', 1650, 12]], 1.03);
    this.road = noiseVoice(this.carBus, B.brown, [['lowpass', 220, .8]]);
    this.wind = noiseVoice(this.carBus, B.white, [['highpass', 380, .5], ['lowpass', 2400, .4]]);
    this.scrapeV = noiseVoice(this.carBus, B.white, [['bandpass', 2600, 2.5]], .7);
    this.nitroV = noiseVoice(this.carBus, B.white, [['highpass', 1800, .6], ['peaking', 4200, 3]]);
    this.rumble = noiseVoice(this.carBus, B.brown, [['lowpass', 90, 1.2]], .5);
    // ambient city bed for the menu
    this.city = noiseVoice(this.sfx, B.brown, [['lowpass', 380, .6]]);
    this.rivals = [];
    for (let k = 0; k < 3; k++) {
      const p = ac.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 6; p.rolloffFactor = 1.2; p.maxDistance = 400;
      p.connect(this.sfx); p.connect(this.verbSend);
      const e = new Engine(p, { rival: true }); e.level = .55;
      this.rivals.push({ p, e });
    }
    this.ready = true;
  }

  resume() { if (ac && ac.state !== 'running') ac.resume(); }

  setVolumes(sfx, music) {
    this.settings.sfx = sfx; this.settings.music = music;
    if (!ac) return;
    this.sfx.gain.setTargetAtTime(sfx, ac.currentTime, .05);
    this.musicBus.gain.setTargetAtTime(music, ac.currentTime, .05);
  }

  // ---------------- engine lifecycle
  engineOn(voice = this.voice || 'v8f') {
    if (this.engine && this.engine.voice !== voice) this.engineOff();
    if (!this.engine) { this.engine = new Engine(this.carBus, { voice }); this.engine.voice = voice; }
    this.carBus.gain.setTargetAtTime(1, ac.currentTime, .05);
  }
  engineOff() {
    if (this.engine) { const e = this.engine; e.out.gain.setTargetAtTime(0, ac.currentTime, .15); setTimeout(() => e.stop(), 800); this.engine = null; }
  }

  // starter motor whirr, then the engine catches and flares
  ignition(onCatch) {
    const t = ac.currentTime;
    const dur = 1.05;
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(52, t); o.frequency.linearRampToValueAtTime(70, t + dur);
    const am = ac.createGain(); am.gain.value = 0;
    const lfo = ac.createOscillator(); lfo.frequency.setValueAtTime(9, t); lfo.frequency.linearRampToValueAtTime(15, t + dur);
    const lg = ac.createGain(); lg.gain.value = .5; lfo.connect(lg); lg.connect(am.gain);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = .8;
    const out = ac.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(.35, t + .05); out.gain.setValueAtTime(.35, t + dur - .05); out.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(am); am.connect(bp); bp.connect(out); out.connect(this.sfx);
    const n = ac.createBufferSource(); n.buffer = buffers().white;
    const nb = ac.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 3200; nb.Q.value = 2;
    const ng = ac.createGain(); ng.gain.value = 0; lg.connect(ng.gain);
    n.connect(nb); nb.connect(ng); ng.connect(out);
    o.start(t); lfo.start(t); n.start(t); o.stop(t + dur); lfo.stop(t + dur); n.stop(t + dur);
    this.click(.9, 1800);
    setTimeout(() => { this.engineOn(); this.thump(.5, 70); onCatch && onCatch(); }, dur * 1000 - 60);
  }

  // ---------------- per-frame car update
  car(state) {
    if (!this.ready) return;
    const t = ac.currentTime;
    const { rpm, thr, cut, gear, speed, slip, scrape, nitro, tunnel = 0, cabin = false, dt = .016, offroad = false } = state;
    if (this.engine) this.engine.set(rpm, thr, { cut, gear, speed, dt });
    const sp = Math.min(1, speed / 90);
    this.tyre.g.gain.setTargetAtTime(Math.min(.38, slip * slip * .5) * Math.min(1, speed / 6), t, .04);
    this.tyre.fs[0].frequency.setTargetAtTime(900 + slip * 400 + Math.sin(t * 13) * 40, t, .05);
    this.tyre2.g.gain.setTargetAtTime(Math.min(.2, Math.max(0, slip - .35) * .4) * Math.min(1, speed / 8), t, .04);
    this.road.g.gain.setTargetAtTime(sp * .22 + (offroad ? .25 : 0), t, .1);
    this.rumble.g.gain.setTargetAtTime(offroad ? .7 : sp * .12, t, .05);
    this.wind.g.gain.setTargetAtTime(sp * sp * (cabin ? .09 : .2), t, .1);
    this.wind.fs[1].frequency.setTargetAtTime(1400 + sp * 3500, t, .1);
    this.scrapeV.g.gain.setTargetAtTime(scrape > 1 ? Math.min(.5, scrape * .012) * (.7 + Math.random() * .6) : 0, t, .02);
    this.nitroV.g.gain.setTargetAtTime(nitro ? .14 : 0, t, .06);
    this.tunnelSend.gain.setTargetAtTime(tunnel * .5, t, .3);
    this.cabin.frequency.setTargetAtTime(cabin ? 3800 : 20000, t, .2);
  }

  // rival engines: list of {pos, rpm, thr} nearest first, listener follows the camera
  rivalUpdate(list, cam) {
    if (!this.ready) return;
    const L = ac.listener, t = ac.currentTime;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.position.x, t, .02); L.positionY.setTargetAtTime(cam.position.y, t, .02); L.positionZ.setTargetAtTime(cam.position.z, t, .02);
      L.forwardX.setTargetAtTime(f.x, t, .02); L.forwardY.setTargetAtTime(f.y, t, .02); L.forwardZ.setTargetAtTime(f.z, t, .02);
      L.upX.setTargetAtTime(u.x, t, .02); L.upY.setTargetAtTime(u.y, t, .02); L.upZ.setTargetAtTime(u.z, t, .02);
    } else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    this.rivals.forEach((v, k) => {
      const r = list[k];
      if (!r) { v.e.out.gain.setTargetAtTime(0, t, .1); return; }
      v.p.positionX ? (v.p.positionX.setTargetAtTime(r.pos.x, t, .03), v.p.positionY.setTargetAtTime(r.pos.y, t, .03), v.p.positionZ.setTargetAtTime(r.pos.z, t, .03)) : v.p.setPosition(r.pos.x, r.pos.y, r.pos.z);
      v.e.set(r.rpm, r.thr);
    });
  }

  silenceCar() {
    if (!this.ready) return;
    const t = ac.currentTime;
    for (const v of [this.tyre, this.tyre2, this.road, this.wind, this.scrapeV, this.nitroV, this.rumble]) v.g.gain.setTargetAtTime(0, t, .05);
    for (const r of this.rivals) r.e.out.gain.setTargetAtTime(0, t, .1);
  }

  cityAmbience(on) { if (this.ready) this.city.g.gain.setTargetAtTime(on ? .05 : 0, ac.currentTime, .5); }

  // ---------------- one-shots
  burst({ f = 1000, q = 1, dur = .1, g = .4, type = 'bandpass', dest = this.sfx, rate = 1, t = ac.currentTime }) {
    const s = ac.createBufferSource(); s.buffer = buffers().white; s.playbackRate.value = rate;
    const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    const gn = ac.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(.0008, t + dur);
    s.connect(b); b.connect(gn); gn.connect(dest); s.start(t, Math.random()); s.stop(t + dur + .02);
  }
  thump(g = .6, f = 60, dur = .18) {
    if (!this.ready) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(); o.frequency.setValueAtTime(f * 1.8, t); o.frequency.exponentialRampToValueAtTime(f * .6, t + dur);
    const gn = ac.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(gn); gn.connect(this.sfx); o.start(t); o.stop(t + dur + .02);
    this.burst({ f: 180, q: .7, dur: dur * .7, g: g * .5, type: 'lowpass' });
  }
  // switchgear: a sharp plastic/metal contact on press, softer on release
  click(g = .5, f = 3200) {
    if (!this.ready) return;
    const t = ac.currentTime;
    this.burst({ f, q: 4, dur: .018, g, t });
    this.burst({ f: f * .45, q: 3, dur: .03, g: g * .5, t: t + .004 });
    this.burst({ f: f * 1.3, q: 5, dur: .012, g: g * .35, t: t + .085 });
  }
  detent() { if (this.ready) { this.burst({ f: 4200, q: 6, dur: .01, g: .35 }); this.burst({ f: 1500, q: 4, dur: .015, g: .15 }); } }
  coverFlip(open) {
    if (!this.ready) return;
    const t = ac.currentTime;
    this.burst({ f: open ? 2200 : 1800, q: 3, dur: .04, g: .45, t });
    this.burst({ f: 700, q: 2, dur: .06, g: .3, t: t + .01 });
    this.burst({ f: 3800, q: 8, dur: .015, g: .2, t: t + (open ? .09 : .03) });
  }
  horn() {
    if (!this.ready) return;
    const t = ac.currentTime, dur = .55;
    const out = ac.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(.22, t + .02); out.gain.setValueAtTime(.22, t + dur - .05); out.gain.linearRampToValueAtTime(0, t + dur);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = .5;
    const sh = ac.createWaveShaper(); sh.curve = shaperCurve(3);
    for (const f of [370, 466]) { const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(sh); o.start(t); o.stop(t + dur); }
    sh.connect(bp); bp.connect(out); out.connect(this.sfx); out.connect(this.verbSend);
  }
  shiftClunk(up) {
    if (!this.ready) return;
    this.burst({ f: up ? 260 : 200, q: 1, dur: .07, g: .35, type: 'lowpass' });
    this.burst({ f: 2400, q: 6, dur: .02, g: .15 });
    if (up && this.engine) { // ignition cut "brap"
      const t = ac.currentTime;
      this.engine.out.gain.cancelScheduledValues(t);
      this.engine.out.gain.setTargetAtTime(.05, t, .008);
    }
  }
  impact(power) {
    if (!this.ready) return;
    const g = Math.min(1, power / 20);
    this.thump(.5 + g * .6, 55);
    const t = ac.currentTime;
    for (let k = 0; k < 4; k++) this.burst({ f: 900 + Math.random() * 3000, q: 6 + Math.random() * 10, dur: .15 + Math.random() * .3, g: .25 * g, t: t + Math.random() * .03 });
    this.burst({ f: 5000, q: 1, dur: .25, g: .2 * g, type: 'highpass', t: t + .01 });
  }
  nitroStart() { if (this.ready) { this.burst({ f: 600, q: .5, dur: .5, g: .4, type: 'lowpass' }); this.burst({ f: 3000, q: .8, dur: .35, g: .25 }); } }
  beep(go = false) {
    if (!this.ready) return;
    const t = ac.currentTime, dur = go ? .7 : .22;
    const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = go ? 1046 : 523;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const gn = ac.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(.12, t + .01); gn.gain.setValueAtTime(.12, t + dur - .04); gn.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp); lp.connect(gn); gn.connect(this.sfx); gn.connect(this.verbSend); o.start(t); o.stop(t + dur);
  }
  // UI chime for HUD pop-ups (two short sine partials)
  chime(hi = false) {
    if (!this.ready) return;
    const t = ac.currentTime;
    for (const [f, d] of [[hi ? 1568 : 1175, 0], [hi ? 2093 : 1568, .06]]) {
      const o = ac.createOscillator(); o.frequency.value = f;
      const g = ac.createGain(); g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(.06, t + d + .01); g.gain.exponentialRampToValueAtTime(.001, t + d + .35);
      o.connect(g); g.connect(this.sfx); o.start(t + d); o.stop(t + d + .4);
    }
  }
  whoosh(g = .3) { if (this.ready) { this.burst({ f: 900, q: .6, dur: .45, g, type: 'bandpass' }); } }
  rewindTick() { if (this.ready) this.burst({ f: 5000, q: 10, dur: .02, g: .05 }); }
}
