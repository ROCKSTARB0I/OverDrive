// Particles: tyre smoke, wall sparks, exhaust flames/backfires, nitrous plume, plus streaks that sell speed.
import * as THREE from 'three';
import { smokeTexture, glowTexture } from './tex.js';

class Pool {
  constructor(n, map, { additive = false, fog = true } = {}) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.size = new Float32Array(n); this.grow = new Float32Array(n);
    this.col = new Float32Array(n * 3); this.alpha = new Float32Array(n); this.a0 = new Float32Array(n);
    this.drag = new Float32Array(n); this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: innerHeight / 2 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; varying float vFog;
        uniform float scale; uniform float fogDensity;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv;
          gl_PointSize = size * scale / -mv.z; float d = -mv.z; vFog = 1. - exp(-fogDensity*fogDensity*d*d); }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 fogColor; varying float vA; varying vec3 vC; varying float vFog;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); vec3 c = mix(vC, fogColor, ${fog ? 'vFog' : '0.'}); gl_FragColor = vec4(c, t.a * vA * ${fog ? '(1.-vFog*.7)' : '1.'}); if (gl_FragColor.a < .003) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.geo = g; this.mat = m;
  }
  emit(p, v, { life = 1, size = 1, grow = 0, color = [1, 1, 1], alpha = 1, drag = 1, grav = 0 } = {}) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.grow[i] = grow;
    this.col.set(color, i * 3); this.a0[i] = alpha; this.alpha[i] = alpha; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3, d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.max[i];
      this.alpha[i] = this.a0[i] * Math.min(1, f * 2.5) * Math.min(1, (1 - f) * 8 + .2);
    }
    for (const n of ['position', 'size', 'alpha', 'color']) this.geo.attributes[n].needsUpdate = true;
  }
}

// Rubber laid on the asphalt: a ring buffer of quads, one chain per tyre, fading with age.
class Skids {
  constructor(scene, max = 3000) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 4 * 3); this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let k = 0; k < max; k++) idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 1, k * 4 + 3, k * 4 + 2], k * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(.012, .012, .014, vA); }',
    });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.last = new Map();
  }
  // key: one per tyre; p: contact point; side: unit vector across the tyre; w: tyre width; a: darkness 0..1
  mark(key, p, side, w, a) {
    const prev = this.last.get(key);
    const l = [p.x + side.x * w / 2, p.y + .015, p.z + side.z * w / 2], r = [p.x - side.x * w / 2, p.y + .015, p.z - side.z * w / 2];
    if (prev && (prev.l[0] - l[0]) ** 2 + (prev.l[2] - l[2]) ** 2 < 6) {
      const k = this.i; this.i = (this.i + 1) % this.max;
      this.pos.set([...prev.l, ...prev.r, ...l, ...r], k * 12);
      this.alpha.set([prev.a, prev.a, a, a], k * 4);
      this.dirty = true;
    }
    this.last.set(key, { l, r, a });
  }
  lift(key) { this.last.delete(key); }
  clear() { this.alpha.fill(0); this.last.clear(); this.dirty = true; }
  update() {
    if (!this.dirty) return;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.dirty = false;
  }
}

export class Fx {
  constructor(scene) {
    this.smoke = new Pool(700, smokeTexture());
    this.spark = new Pool(400, glowTexture(), { additive: true, fog: false });
    this.flame = new Pool(300, glowTexture([[0, 'rgba(255,255,255,1)'], [.3, 'rgba(255,200,120,.8)'], [1, 'rgba(255,80,20,0)']]), { additive: true, fog: false });
    scene.add(this.smoke.points, this.spark.points, this.flame.points);
    this.skids = new Skids(scene);
    // speed streaks: short line segments that live around the camera
    const n = 160;
    this.streakPos = new Float32Array(n * 6);
    this.streakSeed = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random()]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.streakMat = new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.streaks = new THREE.LineSegments(g, this.streakMat); this.streaks.frustumCulled = false;
    scene.add(this.streaks);
    this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
  }

  setFog(fog) { for (const p of [this.smoke, this.spark, this.flame]) { p.mat.uniforms.fogColor.value.copy(fog.color); p.mat.uniforms.fogDensity.value = fog.density; } }
  resize() { for (const p of [this.smoke, this.spark, this.flame]) p.mat.uniforms.scale.value = innerHeight / 2; }

  tyreSmoke(p, carVel, amount, lit = .5) {
    if (Math.random() > amount) return;
    const v = this.v.set((Math.random() - .5) * 1.5, .6 + Math.random() * .8, (Math.random() - .5) * 1.5).addScaledVector(carVel, .25);
    const c = .35 + lit * .5;
    this.smoke.emit(p, v, { life: 1.6 + Math.random() * 1.4, size: 1.2, grow: 2.6 + Math.random() * 1.4, color: [c, c * .98, c * 1.02], alpha: .32 * Math.min(1, amount * 1.5), drag: 1.2, grav: -.25 });
  }

  sparks(p, dir, n = 8) {
    for (let k = 0; k < n; k++) {
      const v = this.v.copy(dir).multiplyScalar(.6 + Math.random() * .5).add(this.w.set((Math.random() - .5) * 8, Math.random() * 5, (Math.random() - .5) * 8));
      this.spark.emit(p, v, { life: .25 + Math.random() * .4, size: .18 + Math.random() * .12, color: [1, .7 + Math.random() * .25, .35], alpha: 1, drag: 1.5, grav: 12 });
    }
  }

  exhaust(p, back, { nitro = false, pop = false } = {}) {
    if (nitro) {
      for (let k = 0; k < 2; k++) {
        const v = this.v.copy(back).multiplyScalar(6 + Math.random() * 4).add(this.w.set((Math.random() - .5), (Math.random() - .5), (Math.random() - .5)));
        this.flame.emit(p, v, { life: .09 + Math.random() * .06, size: .55 + Math.random() * .3, grow: -2, color: [.45, .65, 1], alpha: .9, drag: 4 });
      }
    }
    if (pop) {
      for (let k = 0; k < 6; k++) {
        const v = this.v.copy(back).multiplyScalar(3 + Math.random() * 4).add(this.w.set((Math.random() - .5) * 2, Math.random(), (Math.random() - .5) * 2));
        this.flame.emit(p, v, { life: .07 + Math.random() * .08, size: .5 + Math.random() * .5, grow: 2, color: [1, .55, .2], alpha: 1, drag: 5 });
      }
    }
  }

  update(dt, camera, speed) {
    this.smoke.update(dt); this.spark.update(dt); this.flame.update(dt); this.skids.update();
    // streaks around the view axis, flowing past the camera
    const k = THREE.MathUtils.smoothstep(speed, 45, 95);
    this.streakMat.opacity = k * .35;
    this.streaks.visible = k > 0;
    if (!this.streaks.visible) return;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const len = speed * .05;
    this.streakSeed.forEach((s, i) => {
      s[2] -= dt * speed / 40;
      if (s[2] < 0) { s[2] += 1; s[0] = Math.random(); s[1] = Math.random(); }
      const a = s[0] * Math.PI * 2, rad = 2.5 + s[1] * 5;
      const along = s[2] * 40 - 4;
      const p = camera.position.clone().addScaledVector(f, along).addScaledVector(r, Math.cos(a) * rad).addScaledVector(u, Math.sin(a) * rad * .6);
      this.streakPos.set([p.x, p.y, p.z, p.x - f.x * len, p.y - f.y * len, p.z - f.z * len], i * 6);
    });
    this.streaks.geometry.attributes.position.needsUpdate = true;
  }
}
