// Circuits: spline layout, sampled frame data, road/wall/lamp meshes and position queries.
import * as THREE from 'three';
import { shaftMaterial, shaftGeometry } from './city.js';
import { roadTextures, concreteTexture, curbTexture, checkerTexture, signTexture, glowTexture, rng } from './tex.js';

export const TRACKS = [
  {
    id: 'downtown', name: 'NEON DOWNTOWN', blurb: 'Tight city blocks, a sodium-lit tunnel and a 900 m main straight.',
    pts: [[0, 0, 0], [0, 300, 0], [0, 650, 4], [30, 820, 8], [160, 900, 10], [340, 880, 10], [430, 760, 6], [420, 600, 2], [500, 480, 0], [680, 470, 0], [800, 380, 3], [800, 150, 8], [760, -60, 12], [640, -200, 10], [460, -240, 6], [300, -180, 2], [200, -260, 0], [120, -380, 0], [0, -360, 0], [-30, -200, 0]],
    tunnels: [[.47, .56]], seed: 11,
  },
  {
    id: 'harbor', name: 'HARBOR HIGHWAY', blurb: 'Flat-out sweepers and an elevated bridge over the docks. Fastest track.',
    pts: [[0, 0, 0], [0, 500, 0], [60, 900, 10], [300, 1100, 20], [650, 1080, 25], [900, 900, 18], [1000, 600, 8], [1150, 350, 0], [1100, 50, 0], [850, -120, 5], [500, -80, 12], [300, -250, 6], [120, -300, 0], [0, -200, 0]],
    tunnels: [[.83, .88]], seed: 23,
  },
];

export const HALF_W = 7, SHOULDER = 1.6, WALL = HALF_W + SHOULDER + .2;

export function buildTrack(def, envMap) {
  const curve = new THREE.CatmullRomCurve3(def.pts.map(p => new THREE.Vector3(p[0], p[2], p[1])), true, 'centripetal');
  const length = curve.getLength();
  const N = Math.round(length / 2);
  const ds = length / N;
  const P = curve.getSpacedPoints(N).slice(0, N);
  const T = [], R = [], U = [], K = [];
  const tangents = () => { for (let i = 0; i < N; i++) T[i] = P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize(); };
  tangents();
  // signed curvature in plan view (+ = turning left)
  for (let i = 0; i < N; i++) {
    const a = T[i], b = T[(i + 1) % N];
    K.push((a.z * b.x - a.x * b.z) / ds);
  }
  // smooth curvature, then bank into the corner
  const Ks = K.map((_, i) => { let s = 0; for (let k = -6; k <= 6; k++) s += K[(i + k + N) % N]; return s / 13; });
  const up0 = new THREE.Vector3(0, 1, 0);
  const frame = () => {
    for (let i = 0; i < N; i++) {
      const r = new THREE.Vector3().crossVectors(T[i], up0).normalize();
      const bank = THREE.MathUtils.clamp(Ks[i] * 9, -.09, .09);
      r.applyAxisAngle(T[i], bank);
      R[i] = r; U[i] = new THREE.Vector3().crossVectors(r, T[i]).normalize();
    }
  };
  frame();
  // keep every bit of the road (banked edges, and dips where the spline sags) above the city's ground sheet (y -.05),
  // or the ground pokes up through the asphalt and the car looks like it sinks into it. Max-filter then average the
  // lift so it never drops below what a sample needs and rolls in too gently to feel.
  const EDGE = HALF_W + SHOULDER, FLOOR = .04, need = new Float32Array(N), wide = new Float32Array(N);
  for (let i = 0; i < N; i++) need[i] = Math.max(0, FLOOR - (P[i].y - Math.abs(R[i].y) * EDGE));
  for (let i = 0; i < N; i++) { let m = 0; for (let k = -40; k <= 40; k++) m = Math.max(m, need[(i + k + N) % N]); wide[i] = m; }
  if (wide.some(x => x > 0)) {
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -20; k <= 20; k++) s += wide[(i + k + N) % N]; P[i].y += s / 41; }
    tangents(); frame();
  }
  const inTunnel = new Uint8Array(N);
  for (const [a, b] of def.tunnels || []) for (let i = Math.floor(a * N); i < b * N; i++) inTunnel[i] = 1;

  const track = { def, curve, length, N, ds, P, T, R, U, K: Ks, inTunnel, group: new THREE.Group(), lamps: [] };
  buildRoad(track);
  buildWalls(track);
  buildLamps(track);
  buildTunnels(track);
  buildBridges(track);
  buildStart(track);
  buildSpeedProfile(track);
  return track;
}

// lateral point at sample i, offset d (+ = right), lifted h
function at(tr, i, d, h = 0, out = new THREE.Vector3()) {
  i = (i + tr.N) % tr.N;
  return out.copy(tr.P[i]).addScaledVector(tr.R[i], d).addScaledVector(tr.U[i], h);
}

function buildRoad(tr) {
  const { N } = tr;
  const cols = [-HALF_W - SHOULDER, -HALF_W - SHOULDER * .5, -HALF_W, -HALF_W * .5, 0, HALF_W * .5, HALF_W, HALF_W + SHOULDER * .5, HALF_W + SHOULDER];
  const C = cols.length, total = (HALF_W + SHOULDER) * 2;
  const pos = new Float32Array((N + 1) * C * 3), uv = new Float32Array((N + 1) * C * 2), lamp = new Float32Array((N + 1) * C * 3);
  const v = new THREE.Vector3();
  // lamp positions first so we can bake the pools
  const lamps = [];
  for (let i = 0; i < N; i += 15) {
    if (tr.inTunnel[i]) continue;
    const side = (i / 15) % 2 ? 1 : -1;
    lamps.push({ i, side, pool: at(tr, i, side * (WALL - 2.4), 0), head: at(tr, i, side * (WALL - 1.5), 9.05) });
  }
  tr.lamps = lamps;
  const tunnelGlow = new THREE.Color(1, .55, .2);
  for (let i = 0; i <= N; i++) {
    const ii = i % N;
    for (let c = 0; c < C; c++) {
      at(tr, ii, cols[c], 0, v);
      const k = (i * C + c);
      pos.set([v.x, v.y, v.z], k * 3);
      uv.set([(cols[c] + HALF_W + SHOULDER) / total, i * tr.ds / 24], k * 2);
      let lr = 0, lg = 0, lb = 0;
      for (let L = 0; L < lamps.length; L++) {
        const p = lamps[L].pool; const dx = p.x - v.x, dz = p.z - v.z, dy = p.y - v.y;
        const d2 = dx * dx + dz * dz + dy * dy;
        if (d2 > 400) continue;
        const f = Math.exp(-d2 / 60) * 1.7;
        lr += f; lg += f * .62; lb += f * .3;
      }
      if (tr.inTunnel[ii]) { lr += tunnelGlow.r * 1.3; lg += tunnelGlow.g * 1.3; lb += tunnelGlow.b * 1.3; }
      lamp.set([lr, lg, lb], k * 3);
    }
  }
  const idx = [];
  for (let i = 0; i < N; i++) for (let c = 0; c < C - 1; c++) {
    const a = i * C + c, b = a + 1, d = a + C, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('lamp', new THREE.BufferAttribute(lamp, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const { map, rough } = roadTextures(HALF_W, SHOULDER);
  const mat = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0, envMapIntensity: 1.1 });
  addLampPools(mat);
  const road = new THREE.Mesh(g, mat);
  road.receiveShadow = true;
  tr.group.add(road);
  tr.road = road;

  // curbs on the inside of tight corners
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: .6, side: THREE.DoubleSide });
  addLampPools(curbMat);
  const cp = [], cu = [], cl = [], ci = [];
  for (let i = 0; i < N; i++) {
    if (Math.abs(tr.K[i]) < .006 || tr.inTunnel[i]) continue;
    const side = tr.K[i] > 0 ? -1 : 1; // inside of a left turn is the left (-) side
    const base = cp.length / 3;
    for (const [d, h] of [[side * (HALF_W - .1), .005], [side * (HALF_W + 1.1), .07]]) {
      for (const j of [i, i + 1]) {
        at(tr, j, d, h, v); cp.push(v.x, v.y, v.z);
        cu.push(d === side * (HALF_W - .1) ? 0 : 1, j * tr.ds / 4);
        const li = (j % N) * C + (side < 0 ? 2 : 6);
        cl.push(lamp[li * 3], lamp[li * 3 + 1], lamp[li * 3 + 2]);
      }
    }
    side > 0 ? ci.push(base, base + 2, base + 1, base + 1, base + 2, base + 3) : ci.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  if (cp.length) {
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
    cg.setAttribute('lamp', new THREE.Float32BufferAttribute(cl, 3));
    cg.setIndex(ci); cg.computeVertexNormals();
    const curbs = new THREE.Mesh(cg, curbMat); curbs.receiveShadow = true;
    tr.group.add(curbs);
  }
}

// adds a baked per-vertex "lamp" light term to a standard material as emission scaled by albedo
export function addLampPools(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 lamp; varying vec3 vLamp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLamp = lamp;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLamp;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLamp * diffuseColor.rgb;');
  };
}

function buildWalls(tr) {
  const { N } = tr;
  // jersey barrier profile (lateral offset outward, height)
  const prof = [[0, 0], [.02, .08], [.16, .3], [.24, .82], [.31, .86], [.36, 0]];
  const tex = concreteTexture(); tex.repeat.set(1, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .85, color: 0x9a9690 });
  addLampPools(mat);
  const v = new THREE.Vector3();
  for (const side of [-1, 1]) {
    const pos = [], uv = [], lamp = [], idx = [];
    const Pn = prof.length;
    for (let i = 0; i <= N; i++) {
      const ii = i % N;
      let lr = .05, lg = .05, lb = .06;
      for (const L of tr.lamps) {
        const dx = L.pool.x - tr.P[ii].x, dz = L.pool.z - tr.P[ii].z;
        const d2 = dx * dx + dz * dz; if (d2 < 900) { const f = Math.exp(-d2 / 120) * (L.side === side ? 2.2 : .9); lr += f; lg += f * .62; lb += f * .3; }
      }
      if (tr.inTunnel[ii]) { lr += 1.2; lg += .66; lb += .25; }
      for (let p = 0; p < Pn; p++) {
        at(tr, ii, side * (WALL + prof[p][0]), prof[p][1], v);
        pos.push(v.x, v.y, v.z);
        uv.push(i * tr.ds / 8, prof[p][1] / .86);
        lamp.push(lr, lg, lb);
      }
    }
    for (let i = 0; i < N; i++) for (let p = 0; p < Pn - 1; p++) {
      const a = i * Pn + p, b = a + 1, c = a + Pn, d = c + 1;
      side > 0 ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('lamp', new THREE.Float32BufferAttribute(lamp, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = false;
    tr.group.add(m);
  }
  // reflector studs every 8 m on both walls (amber left, white right)
  const geo = new THREE.BoxGeometry(.12, .07, .02);
  for (const [side, col] of [[-1, 0xffa020], [1, 0xffffff]]) {
    const n = Math.floor(N / 4);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(3) }), n);
    const o = new THREE.Object3D();
    for (let k = 0; k < n; k++) {
      const i = k * 4;
      at(tr, i, side * (WALL - .005 + .2), .62, o.position);
      o.lookAt(at(tr, i, 0, .62, v));
      o.updateMatrix(); im.setMatrixAt(k, o.matrix);
    }
    tr.group.add(im);
  }
}

function buildLamps(tr) {
  const n = tr.lamps.length;
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: .7, roughness: .45 });
  const pole = new THREE.CylinderGeometry(.09, .14, 9.4, 8); pole.translate(0, 4.7, 0);
  const arm = new THREE.BoxGeometry(.1, .1, 2.6); arm.translate(0, 9.25, 1.2);
  const head = new THREE.BoxGeometry(.5, .14, .9); head.translate(0, 9.15, 2.4);
  const lens = new THREE.PlaneGeometry(.42, .78); lens.rotateX(Math.PI / 2); lens.translate(0, 9.07, 2.4);
  const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .62, .3).multiplyScalar(14), side: THREE.DoubleSide });
  const ims = [new THREE.InstancedMesh(pole, steel, n), new THREE.InstancedMesh(arm, steel, n), new THREE.InstancedMesh(head, steel, n), new THREE.InstancedMesh(lens, lensMat, n)];
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffa050, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false });
  const o = new THREE.Object3D(), v = new THREE.Vector3();
  const glowPos = [];
  tr.lamps.forEach((L, k) => {
    at(tr, L.i, L.side * (WALL + .9), 0, o.position);
    o.lookAt(at(tr, L.i, 0, 0, v).setY(o.position.y));
    o.updateMatrix();
    for (const im of ims) im.setMatrixAt(k, o.matrix);
    glowPos.push(L.head.clone());
  });
  for (const im of ims) { im.castShadow = false; tr.group.add(im); }
  // light shafts under each lamp head
  const shafts = new THREE.InstancedMesh(shaftGeometry(9.1, .22, 3.6), shaftMaterial(0xffa860, .07), n);
  tr.lamps.forEach((L, k) => { o.position.copy(L.head); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix(); shafts.setMatrixAt(k, o.matrix); });
  shafts.frustumCulled = false;
  tr.group.add(shafts);
  // camera-facing glow cards are cheap as points
  const pg = new THREE.BufferGeometry().setFromPoints(glowPos);
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTexture(), color: 0xff9a48, size: 7, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  tr.group.add(pts);
}

function buildTunnels(tr) {
  const { N } = tr;
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: .8, map: concreteTexture(31) });
  addLampPools(mat);
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .55, .2).multiplyScalar(9) });
  const v = new THREE.Vector3();
  // arch profile from left wall top over to right wall top
  const arch = [];
  for (let k = 0; k <= 12; k++) { const a = Math.PI * k / 12; arch.push([-Math.cos(a) * (WALL + .4), .86 + Math.sin(a) * 6.2]); }
  let i0 = -1;
  const lightGeo = new THREE.BoxGeometry(.25, .06, 1.8);
  const lights = [];
  for (let i = 0; i <= N; i++) {
    const on = tr.inTunnel[i % N] && i < N;
    if (on && i0 < 0) i0 = i;
    if ((!on || i === N) && i0 >= 0) {
      const pos = [], lamp = [], uv = [], idx = [];
      const A = arch.length;
      for (let j = i0; j <= i; j++) {
        for (let p = 0; p < A; p++) {
          at(tr, j, arch[p][0], arch[p][1], v); pos.push(v.x, v.y, v.z);
          uv.push(j * tr.ds / 8, p / A * 4); lamp.push(.9, .5, .2);
        }
        if ((j - i0) % 3 === 0) for (const s of [-3.5, 3.5]) lights.push([j, s]);
      }
      for (let j = 0; j < i - i0; j++) for (let p = 0; p < A - 1; p++) {
        const a = j * A + p, b = a + 1, c = a + A, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('lamp', new THREE.Float32BufferAttribute(lamp, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide;
      tr.group.add(m);
      // portal faces
      for (const j of [i0, i]) {
        const sh = new THREE.Shape();
        sh.moveTo(-WALL - 6, 0); sh.lineTo(WALL + 6, 0); sh.lineTo(WALL + 6, 12); sh.lineTo(-WALL - 6, 12); sh.closePath();
        const hole = new THREE.Path(); hole.moveTo(arch[0][0], 0);
        for (const [x, y] of arch) hole.lineTo(x, y);
        hole.lineTo(arch[A - 1][0], 0); sh.holes.push(hole);
        const pg = new THREE.ShapeGeometry(sh);
        const pm = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0x45423e, roughness: .9, side: THREE.DoubleSide }));
        const jj = j % N;
        pm.position.copy(tr.P[jj]);
        const b = new THREE.Matrix4().makeBasis(tr.R[jj].clone().negate(), tr.U[jj], tr.T[jj].clone().negate());
        pm.quaternion.setFromRotationMatrix(b);
        tr.group.add(pm);
      }
      i0 = -1;
    }
  }
  if (lights.length) {
    const im = new THREE.InstancedMesh(lightGeo, lightMat, lights.length);
    const o = new THREE.Object3D();
    lights.forEach(([j, s], k) => {
      at(tr, j, s, 6.95, o.position);
      o.lookAt(at(tr, j + 1, s, 6.95, v)); o.updateMatrix(); im.setMatrixAt(k, o.matrix);
    });
    tr.group.add(im);
  }
}

function buildBridges(tr) {
  // pillars under any road that sits more than 4 m above the ground plane
  const geo = new THREE.BoxGeometry(1.6, 1, 2.2); geo.translate(0, .5, 0);
  const cap = new THREE.BoxGeometry(WALL * 2 + 1, 1.2, 2.4);
  const mat = new THREE.MeshStandardMaterial({ map: concreteTexture(17), roughness: .9, color: 0x8c8780 });
  const spots = [];
  for (let i = 0; i < tr.N; i += 12) if (tr.P[i].y > 4) spots.push(i);
  if (!spots.length) return;
  const im = new THREE.InstancedMesh(geo, mat, spots.length * 2), ic = new THREE.InstancedMesh(cap, mat, spots.length);
  const o = new THREE.Object3D(), v = new THREE.Vector3();
  spots.forEach((i, k) => {
    for (const [n, s] of [[0, -1], [1, 1]]) {
      at(tr, i, s * (HALF_W - 1), 0, o.position); const h = o.position.y - 1.2; o.position.y = 0;
      o.rotation.set(0, Math.atan2(tr.T[i].x, tr.T[i].z), 0); o.scale.set(1, h, 1); o.updateMatrix(); im.setMatrixAt(k * 2 + n, o.matrix);
    }
    at(tr, i, 0, -.75, o.position); o.scale.set(1, 1, 1); o.updateMatrix(); ic.setMatrixAt(k, o.matrix);
  });
  im.castShadow = true;
  tr.group.add(im, ic);
  // underside slab so the bridge is not paper thin
  const pos = [], idx = [];
  for (let i = 0; i <= tr.N; i++) for (const s of [-1, 1]) { at(tr, i, s * (WALL + .35), -.6, v); pos.push(v.x, v.y, v.z); }
  for (let i = 0; i < tr.N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  tr.group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2c2b29, roughness: 1, side: THREE.DoubleSide })));
}

function buildStart(tr) {
  // checkered line + grid boxes
  const v = new THREE.Vector3();
  const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 1.4), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: .6, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.material.map.repeat.set(4, 1);
  line.position.copy(at(tr, 0, 0, .012));
  line.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tr.R[0].clone().negate(), tr.T[0], tr.U[0]));
  tr.group.add(line);
  // gantry
  const steel = new THREE.MeshStandardMaterial({ color: 0x23252a, metalness: .7, roughness: .4 });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.6, 8.5, .6), steel);
    leg.position.copy(at(tr, 2, s * (WALL + .8), 4.25)); tr.group.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(WALL * 2 + 2.2, 1.6, .8), steel);
  beam.position.copy(at(tr, 2, 0, 8.3));
  beam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tr.R[2].clone().negate(), tr.U[2], tr.T[2].clone().negate()));
  tr.group.add(beam);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshBasicMaterial({ map: signTexture('OVERDRIVE', '#ff3b1f'), toneMapped: false }));
  sign.position.copy(at(tr, 2, 0, 8.35)).addScaledVector(tr.T[2], -.42);
  sign.quaternion.copy(beam.quaternion); sign.rotateY(Math.PI);
  sign.material.color.setScalar(2.2);
  tr.group.add(sign);
  // start lights: 5 pods, lit by race logic
  tr.startLights = [];
  for (let k = 0; k < 5; k++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(.28, 20), new THREE.MeshBasicMaterial({ color: 0x220303 }));
    m.position.copy(at(tr, 2, (k - 2) * .9, 6.9)).addScaledVector(tr.T[2], -.42);
    m.quaternion.copy(sign.quaternion);
    tr.group.add(m); tr.startLights.push(m);
  }
  const hous = new THREE.Mesh(new THREE.BoxGeometry(5, .9, .4), steel);
  hous.position.copy(at(tr, 2, 0, 6.9)).addScaledVector(tr.T[2], -.2); hous.quaternion.copy(beam.quaternion);
  tr.group.add(hous);
  v.set(0, 0, 0);
}

// AI target speeds: corner limit, then braking/accel passes
function buildSpeedProfile(tr) {
  const { N, ds } = tr;
  const v = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0; for (let j = -4; j <= 4; j++) k = Math.max(k, Math.abs(tr.K[(i + j + N) % N]));
    v[i] = Math.min(96, Math.sqrt(1.38 * 9.81 / Math.max(k, 1e-4)));   // rivals corner on the same grip you have
  }
  for (let pass = 0; pass < 2; pass++) for (let i = N - 1; i >= 0; i--) { const n = v[(i + 1) % N]; v[i] = Math.min(v[i], Math.sqrt(n * n + 2 * 11 * ds)); }
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N; i++) { const p = v[(i - 1 + N) % N]; const a = Math.max(2, 10 - p * .085); v[i] = Math.min(v[i], Math.sqrt(p * p + 2 * a * ds)); }
  tr.vProfile = v;
}

// ------------------------------------------------------------- queries
// nearest sample to a world point, searching around a hint index
export function locate(tr, p, hint = -1, out = {}) {
  const { N } = tr;
  let best = 1e18, bi = 0;
  if (hint < 0) {
    for (let i = 0; i < N; i++) { const q = tr.P[i]; const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2 + (q.y - p.y) ** 2 * 4; if (d < best) { best = d; bi = i; } }
  } else {
    for (let k = -25; k <= 25; k++) { const i = (hint + k + N) % N; const q = tr.P[i]; const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2 + (q.y - p.y) ** 2 * 4; if (d < best) { best = d; bi = i; } }
  }
  // fractional position along segment
  const i0 = bi, P0 = tr.P[i0], Tt = tr.T[i0];
  const along = (p.x - P0.x) * Tt.x + (p.z - P0.z) * Tt.z;
  const f = along / tr.ds;
  let i = i0, frac = f;
  if (f < 0) { i = (i0 - 1 + N) % N; frac = 1 + f; }
  frac = THREE.MathUtils.clamp(frac, 0, 1);
  const j = (i + 1) % N;
  const A = tr.P[i], B = tr.P[j];
  const cx = A.x + (B.x - A.x) * frac, cy = A.y + (B.y - A.y) * frac, cz = A.z + (B.z - A.z) * frac;
  const Rr = tr.R[i], Rj = tr.R[j];
  const rx = Rr.x + (Rj.x - Rr.x) * frac, ry = Rr.y + (Rj.y - Rr.y) * frac, rz = Rr.z + (Rj.z - Rr.z) * frac;
  const rl = Math.hypot(rx, rz);
  const d = ((p.x - cx) * rx + (p.z - cz) * rz) / rl;
  out.i = bi; out.seg = i; out.frac = frac;
  out.s = (i + frac) * tr.ds;
  out.d = d;
  out.y = cy + d * ry / rl;
  out.rx = rx / rl; out.rz = rz / rl;
  out.tx = Tt.x; out.tz = Tt.z;
  out.up = tr.U[i];
  return out;
}

// world transform at distance s and lateral offset d
export function pointAt(tr, s, d, out = new THREE.Vector3()) {
  const { N, ds } = tr;
  s = ((s % tr.length) + tr.length) % tr.length;
  const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
  const A = tr.P[i], B = tr.P[j], R0 = tr.R[i], R1 = tr.R[j];
  out.set(A.x + (B.x - A.x) * t + (R0.x + (R1.x - R0.x) * t) * d,
    A.y + (B.y - A.y) * t + (R0.y + (R1.y - R0.y) * t) * d,
    A.z + (B.z - A.z) * t + (R0.z + (R1.z - R0.z) * t) * d);
  return out;
}

export function frameAt(tr, s) {
  const { N, ds } = tr;
  s = ((s % tr.length) + tr.length) % tr.length;
  const i = Math.floor(s / ds) % N;
  return { i, T: tr.T[i], R: tr.R[i], U: tr.U[i], K: tr.K[i], v: tr.vProfile[i] };
}
