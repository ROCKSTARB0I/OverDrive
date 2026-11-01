// City dressing around a track: lit towers, neon signage, ground, distant skyline, moonlight and roaming street-lamp lights.
import * as THREE from 'three';
import { HALF_W, WALL } from './track.js';
import { signTexture, rng, concreteTexture } from './tex.js';
import { towerMeshes } from './city.js';

export function buildWorld(scene, tr) {
  const g = new THREE.Group();
  const R = rng(tr.def.seed);
  // spatial hash of the track for clearance tests
  const cell = 24, hash = new Map();
  const key = (x, z) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(z / cell) * 19349663);
  tr.P.forEach((p, i) => { const k = key(p.x, p.z); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(i); });
  const clear = (x, z, r) => {
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const l = hash.get(key(x + a * cell, z + b * cell)); if (!l) continue;
      for (const i of l) { const p = tr.P[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return false; }
    }
    return true;
  };

  // ground
  const gt = concreteTexture(41); gt.repeat.set(300, 300);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x15161a, map: gt, roughness: .95 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.05; ground.receiveShadow = true;
  g.add(ground);

  // towers along the circuit
  const boxes = [];
  for (let i = 0; i < tr.N; i += 9) {
    for (const side of [-1, 1]) {
      if (R() < .25) continue;
      const off = WALL + 16 + R() * 45;
      const p = tr.P[i].clone().addScaledVector(tr.R[i], side * off);
      const w = 14 + R() * 26, d = 14 + R() * 26;
      if (!clear(p.x, p.z, Math.max(w, d) * .72 + HALF_W + 5)) continue;
      const h = 12 + Math.pow(R(), 1.7) * 140;
      boxes.push([p.x, p.z, w, h, d, Math.atan2(tr.T[i].x, tr.T[i].z) + (R() - .5) * .1]);
    }
  }
  // distant skyline ring
  let cx = 0, cz = 0; tr.P.forEach(p => { cx += p.x; cz += p.z; }); cx /= tr.N; cz /= tr.N;
  let rad = 0; tr.P.forEach(p => { rad = Math.max(rad, Math.hypot(p.x - cx, p.z - cz)); });
  for (let k = 0; k < 260; k++) {
    const a = R() * Math.PI * 2, r = rad + 160 + R() * 700;
    boxes.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, 30 + R() * 60, 40 + Math.pow(R(), 1.5) * 260, 30 + R() * 60, R() * 3]);
  }
  g.add(towerMeshes(boxes, R));

  // neon signs facing the road
  const words = [['NOODLE BAR', '#ff2e88'], ['24H', '#29e0ff'], ['MOTEL', '#ff4b2b'], ['CLUB VEGA', '#b45cff'], ['PARKING', '#3cff9e'], ['RAMEN', '#ffcc33'], ['ARCADE', '#29e0ff'], ['HOTEL ORBIT', '#ff2e88'], ['CASINO', '#ffcc33'], ['DINER', '#ff4b2b']];
  const signMats = words.map(([w, c]) => new THREE.MeshBasicMaterial({ map: signTexture(w, c), toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) }));
  for (let i = 40; i < tr.N; i += 70 + Math.floor(R() * 60)) {
    if (tr.inTunnel[i]) continue;
    const side = R() < .5 ? -1 : 1;
    const p = tr.P[i].clone().addScaledVector(tr.R[i], side * (WALL + 6 + R() * 6));
    if (!clear(p.x, p.z, HALF_W + 3)) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), signMats[Math.floor(R() * signMats.length)]);
    m.position.set(p.x, tr.P[i].y + 7 + R() * 10, p.z);
    m.lookAt(tr.P[i].x, m.position.y, tr.P[i].z);
    g.add(m);
    const back = new THREE.Mesh(new THREE.BoxGeometry(12.4, 3.4, .3), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: .6 }));
    back.position.copy(m.position).addScaledVector(new THREE.Vector3().subVectors(m.position, tr.P[i]).setY(0).normalize(), .2);
    back.quaternion.copy(m.quaternion); g.add(back);
  }
  scene.add(g);
  return g;
}

// Moonlight with a shadow frustum that follows the player, plus a small pool of point lights moved to the nearest street lamps.
export function buildLights(scene, tr) {
  const hemi = new THREE.HemisphereLight(0x33405e, 0x0c0a0a, .5);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xa8b8ff, .55);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const c = moon.shadow.camera; c.left = -30; c.right = 30; c.top = 30; c.bottom = -30; c.near = 1; c.far = 160;
  moon.shadow.bias = -.0004; moon.shadow.normalBias = .03;
  scene.add(moon, moon.target);
  const pool = [];
  for (let k = 0; k < 6; k++) { const l = new THREE.PointLight(0xffa255, 0, 34, 1.6); scene.add(l); pool.push(l); }
  const dir = new THREE.Vector3(-.45, .8, -.35).normalize();
  return {
    moon, pool,
    // graphics quality: how many street-lamp lights follow the player, and the moon's shadow size
    setQuality(q) {
      pool.forEach((l, k) => { l.visible = k < q.lamps; });
      if (moon.shadow.mapSize.x !== q.shadowSize) { moon.shadow.mapSize.set(q.shadowSize, q.shadowSize); if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; } }
    },
    update(focus, trackNow = tr) {
      moon.position.copy(focus).addScaledVector(dir, 80);
      moon.target.position.copy(focus);
      // nearest lamps to the focus point
      const L = trackNow.lamps;
      const near = L.map(l => [l, l.head.distanceToSquared(focus)]).sort((a, b) => a[1] - b[1]).slice(0, pool.length);
      pool.forEach((pl, k) => {
        const n = near[k];
        if (!n) { pl.intensity = 0; return; }
        pl.position.copy(n[0].head).y -= .5;
        pl.intensity = 320 * (1 - THREE.MathUtils.smoothstep(Math.sqrt(n[1]), 35, 90));
      });
    },
  };
}
