// The Vanta 308 Turbo cabin, late-80s Italian exotic. It is the main menu: every option is a physical control.
// Car-local frame: +z forward, +y up, +x is the car's LEFT (left-hand drive, driver on +x).
import * as THREE from 'three';
import { grainTexture, canvas, normalFromHeight } from './tex.js';

export const EYE = new THREE.Vector3(.37, .985, -.42);

function mat(o) { return new THREE.MeshStandardMaterial(o); }
function ctex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

// chunky 80s push-button cap: white silk-screened legend on soft-touch black
function capTexture(text) {
  const [c, x] = canvas(256, 140);
  const g = x.createLinearGradient(0, 0, 0, 140); g.addColorStop(0, '#1d1d20'); g.addColorStop(1, '#0c0c0e');
  x.fillStyle = g; x.fillRect(0, 0, 256, 140);
  x.fillStyle = '#f2efe6'; x.font = '700 40px "Saira Condensed", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 80);
  x.fillStyle = 'rgba(255,255,255,.06)'; x.fillRect(0, 0, 256, 10);
  return ctex(c);
}

export const BUTTONS = [
  ['race', 'RACE', 'Quick race · 5 rivals'],
  ['time', 'TIME ATK', 'Time attack · chase your ghost'],
  ['garage', 'GARAGE', 'Paint, wheels & stripes'],
  ['radio', 'RADIO', 'Stations & now playing'],
  ['settings', 'SETUP', 'Laps, gearbox, camera, audio'],
  ['controls', 'CONTROLS', 'Keyboard & gamepad'],
];

export function buildCockpit() {
  const g = new THREE.Group();
  g.name = 'cockpit';
  const grain = grainTexture(4); grain.repeat.set(6, 6);
  const leatherN = normalFromHeight(grainTexture(8, 1.4).image, 2.2); leatherN.repeat.set(8, 8);
  const M = {
    leather: mat({ color: 0x0f0e0f, roughness: .62, roughnessMap: grain, normalMap: leatherN, normalScale: new THREE.Vector2(.35, .35) }),
    tan: mat({ color: 0x6e4527, roughness: .62, roughnessMap: grain, normalMap: leatherN, normalScale: new THREE.Vector2(.35, .35) }),
    suede: mat({ color: 0x1b1a1c, roughness: 1 }),
    plastic: mat({ color: 0x111113, roughness: .55, roughnessMap: grain }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: .2, clearcoat: 1, clearcoatRoughness: .05 }),
    chrome: mat({ color: 0xdcdfe4, metalness: 1, roughness: .08 }),
    alu: mat({ color: 0xb4b8bf, metalness: 1, roughness: .32 }),
    darkAlu: mat({ color: 0x3a3c41, metalness: .9, roughness: .35 }),
    stitch: mat({ color: 0xc9a46a, roughness: .7 }),
    carpet: mat({ color: 0x0d0c0c, roughness: 1 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a1a).multiplyScalar(2.2) }),
  };
  const add = (geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent = g) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); parent.add(o); return o;
  };
  const beam = (a, b, r, m) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const o = new THREE.Mesh(new THREE.BoxGeometry(r * 2.4, d.length(), r * 1.4), m);
    o.position.copy(a).addScaledVector(d, .5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(o); return o;
  };
  const profile = (pts, depth, x0, m) => {
    const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) { const p = pts[i]; p.length === 4 ? s.quadraticCurveTo(p[0], p[1], p[2], p[3]) : s.lineTo(p[0], p[1]); }
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 3, curveSegments: 12 });
    geo.rotateY(-Math.PI / 2); geo.translate(x0, 0, 0);
    const o = new THREE.Mesh(geo, m); g.add(o); return o;
  };

  // ---------------- dashboard: one sculpted leather moulding lofted across the car.
  // The side profile morphs along x: a hooded binnacle over the gauges (driver side) and a low cap over the centre stack.
  const N = [[.54, .865], [.42, .905], [.3, .9], [.275, .872], [.272, .845], [.276, .79], [.285, .71], [.33, .6], [.5, .5], [.54, .5]];
  const B = [[.54, .865], [.45, .968], [.27, .958], [.252, .93], [.44, .918], [.445, .752], [.3, .735], [.33, .6], [.5, .5], [.54, .5]];
  const C = [[.54, .865], [.505, .895], [.475, .888], [.465, .868], [.47, .855], [.5, .8], [.52, .73], [.53, .62], [.535, .55], [.54, .5]];
  const bump = (x, c, w) => { const d = Math.abs(x - c) / w; return d >= 1 ? 0 : .5 + .5 * Math.cos(d * Math.PI); };
  const dashStations = [], DM = 64;
  for (let i = 0; i <= 70; i++) {
    const x = -.86 + 1.72 * i / 70;
    const wb = THREE.MathUtils.clamp(bump(x, .37, .4) * 1.4, 0, 1), wc = THREE.MathUtils.clamp(bump(x, 0, .34) * 1.35, 0, 1);
    const key = N.map((n, k) => new THREE.Vector2(n[0] + (B[k][0] - n[0]) * wb + (C[k][0] - n[0]) * wc, n[1] + (B[k][1] - n[1]) * wb + (C[k][1] - n[1]) * wc));
    // smooth closed profile through the key points
    const crv = new THREE.SplineCurve([...key, key[0]]);
    const pts = crv.getSpacedPoints(DM - 1).slice(0, DM);
    dashStations.push({ x, pts });
  }
  {
    const pos = [], uv = [], idx = [];
    dashStations.forEach((st, i) => st.pts.forEach((p, j) => { pos.push(st.x, p.y, p.x); uv.push(st.x * 3, j / DM * 2); }));
    for (let i = 0; i < dashStations.length - 1; i++) for (let j = 0; j < DM; j++) {
      const a = i * DM + j, b = i * DM + (j + 1) % DM, c = (i + 1) * DM + j, d = (i + 1) * DM + (j + 1) % DM;
      idx.push(a, b, c, b, d, c);
    }
    for (const [i, flip] of [[0, false], [dashStations.length - 1, true]]) {
      const ci = pos.length / 3, st = dashStations[i];
      pos.push(st.x, .7, .42); uv.push(0, 0);
      for (let j = 0; j < DM; j++) { const a = i * DM + j, b = i * DM + (j + 1) % DM; flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const dash = new THREE.Mesh(geo, M.leather); dash.material.side = THREE.DoubleSide; g.add(dash);
    // contrast stitching that follows the dash lip
    const seam = [];
    for (const st of dashStations) { const p = st.pts[Math.round(DM * .2)]; seam.push(new THREE.Vector3(st.x, p.y + .002, p.x - .004)); }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam), 140, .0016, 5), M.stitch);
  }
  // passenger-side grab handle + slatted vents
  add(new THREE.CapsuleGeometry(.014, .28, 4, 10), M.darkAlu, -.5, .83, .285, 0, 0, Math.PI / 2);
  for (const vx of [-.74, .78]) {
    add(new THREE.BoxGeometry(.13, .06, .025), M.plastic, vx, .842, .29);
    for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(.12, .004, .022), M.gloss, vx, .822 + k * .013, .278, .3);
  }

  const [cc, cx] = canvas(1024, 400);
  const clusterTex = ctex(cc);
  const cluster = add(new THREE.PlaneGeometry(.37, .145), new THREE.MeshBasicMaterial({ map: clusterTex }), .37, .835, .43);
  cluster.lookAt(EYE.clone().add(new THREE.Vector3(0, .1, 0)));
  add(new THREE.BoxGeometry(.39, .16, .01), M.gloss, 0, 0, -.008, 0, 0, 0, cluster);
  // gauge glass glint
  const glassM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: .06, roughness: 0, metalness: 0, clearcoat: 1 });
  add(new THREE.PlaneGeometry(.37, .145), glassM, 0, 0, .006, 0, 0, 0, cluster);

  // ---------------- centre stack (tilted toward the cabin)
  const stack = new THREE.Group();
  stack.position.set(.02, .69, .34);
  stack.rotation.set(-Math.PI / 4.4, Math.PI - .2, 0, 'YXZ');  // angled toward the driver
  stack.scale.setScalar(1.25);
  g.add(stack);
  add(new THREE.BoxGeometry(.36, .42, .05), M.plastic, 0, -.02, -.03, 0, 0, 0, stack);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(.025, .46, .08), M.leather, s * .19, -.02, -.035, 0, 0, 0, stack);
  add(new THREE.BoxGeometry(.37, .008, .06), M.chrome, 0, .19, -.03, 0, 0, 0, stack);

  // CRT trip computer: the menu screen
  const [sc, sx] = canvas(1024, 640);
  const screenTex = ctex(sc);
  const preview = new THREE.WebGLRenderTarget(512, 320, { samples: 4 });
  preview.texture.colorSpace = THREE.SRGBColorSpace;
  add(new THREE.BoxGeometry(.31, .195, .02), M.gloss, 0, .085, -.004, 0, 0, 0, stack);  // bezel
  const previewMesh = add(new THREE.PlaneGeometry(.282, .176), new THREE.MeshBasicMaterial({ map: preview.texture, toneMapped: false }), 0, .085, .0065, 0, 0, 0, stack);
  previewMesh.visible = false;
  const screen = add(new THREE.PlaneGeometry(.282, .176), new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, toneMapped: false }), 0, .085, .007, 0, 0, 0, stack);
  screen.userData = { id: 'screen' };
  // six chunky push buttons
  const buttons = {};
  const interactives = [screen];
  BUTTONS.forEach(([id, label, tip], k) => {
    const bx = (k - 2.5) * .05, by = -.04;
    add(new THREE.BoxGeometry(.047, .033, .01), M.darkAlu, bx, by, .0, 0, 0, 0, stack);
    const capMat = new THREE.MeshStandardMaterial({ map: capTexture(label), roughness: .9, envMapIntensity: .3 });
    const cap = add(new THREE.BoxGeometry(.043, .029, .012), [M.plastic, M.plastic, M.plastic, M.plastic, capMat, M.plastic], bx, by, .008, 0, 0, 0, stack);
    const led = add(new THREE.BoxGeometry(.008, .003, .002), new THREE.MeshBasicMaterial({ color: 0x2a1205 }), bx + .016, by + .009, .0145, 0, 0, 0, stack);
    cap.userData = { id, tip, kind: 'button' };
    buttons[id] = { cap, led, capMat, baseZ: .008, press: 0, active: false, hover: 0 };
    interactives.push(cap);
  });

  // cassette deck slot
  add(new THREE.BoxGeometry(.15, .022, .006), M.gloss, 0, -.09, .002, 0, 0, 0, stack);
  add(new THREE.BoxGeometry(.13, .006, .004), M.chrome, 0, -.083, .006, 0, 0, 0, stack);
  const [tc, tx] = canvas(256, 32);
  tx.fillStyle = '#0a0a0b'; tx.fillRect(0, 0, 256, 32); tx.fillStyle = '#9aa0a8'; tx.font = '700 15px Michroma'; tx.textAlign = 'center'; tx.fillText('AUTO REVERSE  ·  DOLBY B', 128, 22);
  add(new THREE.PlaneGeometry(.13, .016), new THREE.MeshBasicMaterial({ map: ctex(tc) }), 0, -.108, .004, 0, 0, 0, stack);

  // knobs: drive mode (difficulty) toward the driver, radio tuning on the passenger side
  const knurl = (r, h) => {
    const geo = new THREE.CylinderGeometry(r, r * 1.04, h, 48, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i)); const rr = Math.hypot(p.getX(i), p.getZ(i));
      if (rr > r * .98) { const k = 1 + Math.cos(a * 40) * .025; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    }
    geo.computeVertexNormals(); geo.rotateX(Math.PI / 2); return geo;
  };
  const ringFace = (x, y) => {
    const grp = new THREE.Group(); grp.position.set(x, y, .002); stack.add(grp);
    const [c, ctx] = canvas(256, 256);
    const ring = add(new THREE.CircleGeometry(.042, 48), new THREE.MeshBasicMaterial({ map: ctex(c), transparent: true }), 0, 0, .001, 0, 0, 0, grp);
    return { grp, ring, c, ctx };
  };
  const dialF = ringFace(-.115, -.15);
  const dial = add(knurl(.022, .022), M.alu, 0, 0, .012, 0, 0, 0, dialF.grp);
  add(new THREE.BoxGeometry(.003, .014, .002), M.glow, 0, .013, .0235, 0, 0, 0, dial);
  dial.userData = { id: 'dial', tip: 'Drive mode · difficulty', kind: 'dial' };
  const knobF = ringFace(.115, -.15);
  const knob = add(knurl(.02, .02), M.alu, 0, 0, .011, 0, 0, 0, knobF.grp);
  add(new THREE.BoxGeometry(.003, .012, .002), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, .011, .0215, 0, 0, 0, knob);
  knob.userData = { id: 'knob', tip: 'Radio · click: next station · scroll: volume', kind: 'knob' };
  interactives.push(dial, knob);
  // hazard switch between the knobs (decor, but it clicks)
  const hazard = add(new THREE.BoxGeometry(.03, .022, .012), [M.plastic, M.plastic, M.plastic, M.plastic, mat({ color: 0x8a0d0d, emissive: 0x400000 }), M.plastic], 0, .205, .0, 0, 0, 0, stack);
  hazard.userData = { id: 'hazard', tip: 'Hazards', kind: 'hazard' };
  interactives.push(hazard);

  // ---------------- steering column, ignition key
  const column = add(new THREE.CylinderGeometry(.045, .055, .3, 20), M.plastic, .37, .7, .14, Math.PI / 2 - .44, 0, 0);
  void column;
  // ignition barrel set into the centre stack, below the cassette deck
  const ign = new THREE.Group(); ign.position.set(0, -.15, .004); stack.add(ign);
  add(new THREE.RingGeometry(.02, .03, 32), new THREE.MeshBasicMaterial({ map: (() => { const [c, x] = canvas(128, 128); x.fillStyle = '#0c0c0e'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#9aa0a8'; x.font = '700 15px Michroma'; x.textAlign = 'center'; x.fillText('OFF', 30, 70); x.fillText('ON', 64, 22); x.fillStyle = '#ff7a1a'; x.fillText('START', 100, 70); return ctex(c); })() }), 0, 0, .001, 0, 0, 0, ign);
  add(new THREE.CylinderGeometry(.018, .02, .012, 24), M.darkAlu, 0, 0, .004, Math.PI / 2, 0, 0, ign);
  const key = new THREE.Group(); ign.add(key); key.position.z = .008;
  add(new THREE.BoxGeometry(.006, .01, .03), M.alu, 0, 0, .012, 0, 0, 0, key);
  const keyHead = add(new THREE.BoxGeometry(.03, .036, .008), M.plastic, 0, 0, .036, 0, 0, 0, key);
  add(new THREE.CircleGeometry(.008, 16), new THREE.MeshStandardMaterial({ color: 0xc8161c, metalness: .5, roughness: .3 }), 0, .004, .0042, 0, 0, 0, keyHead);
  const fob = add(new THREE.TorusGeometry(.01, .002, 6, 16), M.alu, 0, -.026, .036, 0, 0, 0, key);
  fob.rotation.set(0, Math.PI / 2, 0);
  keyHead.userData = { id: 'start', tip: 'Turn the key · ENGINE START', kind: 'start' };
  interactives.push(keyHead);

  // ---------------- three-spoke wheel with drilled aluminium spokes
  const wheel = new THREE.Group();
  wheel.position.set(.37, .72, .07);
  wheel.rotation.set(-.46, Math.PI, 0, 'YXZ');
  g.add(wheel);
  const steer = new THREE.Group(); wheel.add(steer);
  add(new THREE.TorusGeometry(.172, .018, 16, 96), M.leather, 0, 0, 0, 0, 0, 0, steer);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const sp = new THREE.Group(); sp.rotation.z = a; steer.add(sp);
    add(new THREE.BoxGeometry(.12, .034, .006), M.alu, .095, 0, -.01, 0, 0, 0, sp);
    for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(.006, .006, .008, 12), M.gloss, .06 + k * .03, 0, -.01, Math.PI / 2, 0, 0, sp);
  }
  const hub = add(new THREE.CylinderGeometry(.052, .056, .035, 32), M.leather, 0, 0, -.012, Math.PI / 2, 0, 0, steer);
  const [lc, lx] = canvas(128, 128);
  lx.fillStyle = '#c8161c'; lx.beginPath(); lx.arc(64, 64, 62, 0, 7); lx.fill();
  lx.fillStyle = '#f2efe6'; lx.beginPath(); lx.moveTo(30, 36); lx.lineTo(54, 36); lx.lineTo(64, 72); lx.lineTo(74, 36); lx.lineTo(98, 36); lx.lineTo(72, 100); lx.lineTo(56, 100); lx.closePath(); lx.fill();
  const badge = add(new THREE.CircleGeometry(.022, 32), new THREE.MeshStandardMaterial({ map: ctex(lc), metalness: .4, roughness: .3 }), 0, 0, .006, 0, 0, 0, steer);
  badge.userData = { id: 'horn', tip: 'Horn', kind: 'horn' };
  hub.userData = badge.userData;
  interactives.push(badge, hub);
  // stalks
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(.11, .012, .012), M.plastic, s * .1, -.02, -.07, 0, 0, s * -.1, wheel);

  // ---------------- gated five-speed shifter (dogleg first) on the tunnel
  add(new THREE.BoxGeometry(.26, .16, .95), M.leather, 0, .47, -.22);
  const gate = new THREE.Group(); gate.position.set(0, .556, -.08); g.add(gate);
  add(new THREE.BoxGeometry(.12, .006, .15), M.chrome, 0, 0, 0, 0, 0, 0, gate);
  const slots = { R: [.04, .05], 1: [.04, -.05], 2: [0, .05], 3: [0, -.05], 4: [-.04, .05], 5: [-.04, -.05], N: [0, 0] };
  for (const [x, z] of [[.04, 0], [0, 0], [-.04, 0]]) add(new THREE.BoxGeometry(.012, .007, .11), M.gloss, x, .001, z, 0, 0, 0, gate);
  add(new THREE.BoxGeometry(.092, .007, .012), M.gloss, 0, .001, 0, 0, 0, 0, gate);
  const lever = new THREE.Group(); gate.add(lever);
  add(new THREE.CylinderGeometry(.006, .007, .14, 10), M.chrome, 0, .07, 0, 0, 0, 0, lever);
  add(new THREE.SphereGeometry(.022, 20, 14), M.gloss, 0, .145, 0, 0, 0, 0, lever);

  // ---------------- pillars, roof, mirror, doors, floor, passenger seat
  for (const s of [-1, 1]) beam(new THREE.Vector3(s * .82, .87, .58), new THREE.Vector3(s * .66, 1.1, -.25), .028, M.suede);
  add(new THREE.BoxGeometry(1.36, .04, .09), M.suede, 0, 1.09, -.26);
  add(new THREE.PlaneGeometry(1.36, .8), M.suede, 0, 1.105, -.68, Math.PI / 2);
  const mirror = new THREE.Group(); mirror.position.set(0, 1.04, -.2); g.add(mirror);
  add(new THREE.BoxGeometry(.01, .04, .01), M.plastic, 0, .03, .01, 0, 0, 0, mirror);
  add(new THREE.BoxGeometry(.22, .06, .02), M.plastic, 0, 0, 0, .1, 0, 0, mirror);
  add(new THREE.PlaneGeometry(.205, .048), mat({ color: 0x9aa4b2, metalness: 1, roughness: .02, envMapIntensity: 1.4 }), 0, 0, -.0105, .1, Math.PI, 0, mirror);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(.06, .46, 1.5), M.leather, s * .9, .64, -.2);
    add(new THREE.BoxGeometry(.02, .3, 1.1), M.tan, s * .868, .66, -.25);
    for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(.004, .004, 1.1), M.stitch, s * .857, .54 + k * .06, -.25);
    add(new THREE.BoxGeometry(.03, .03, .2), M.chrome, s * .86, .82, .2);
    add(new THREE.BoxGeometry(.02, .26, .03), M.suede, s * .9, .99, .42, .62);
  }
  add(new THREE.PlaneGeometry(1.8, 2.2), M.carpet, 0, .3, -.2, -Math.PI / 2);
  add(new THREE.BoxGeometry(1.7, .4, .05), M.carpet, 0, .5, .7);
  // tan leather bucket seat with horizontal pleats
  const seat = new THREE.Group(); seat.position.set(-.37, .3, -.66); g.add(seat);
  add(new THREE.BoxGeometry(.46, .1, .48), M.tan, 0, .13, .05, 0, 0, 0, seat);
  const back = new THREE.Group(); back.position.set(0, .2, -.22); back.rotation.x = -.26; seat.add(back);
  for (let k = 0; k < 7; k++) add(new THREE.BoxGeometry(.3, .07, .08), M.tan, 0, .06 + k * .075, 0, 0, 0, 0, back);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(.08, .58, .16), M.tan, s * .19, .3, .02, 0, 0, s * -.06, back);
    add(new THREE.BoxGeometry(.07, .14, .46), M.tan, s * .21, .2, .05, 0, 0, 0, seat);
  }
  add(new THREE.BoxGeometry(.24, .14, .1), M.tan, 0, .66, -.01, 0, 0, 0, back); // headrest

  // dim cabin fill and gauge spill
  const fill = new THREE.PointLight(0xffc89a, .3, 2.2, 1.5); fill.position.set(0, 1.05, -.2); g.add(fill);
  const spill = new THREE.PointLight(0xff8a3a, .06, 1.0, 2); spill.position.set(.37, .95, .05); g.add(spill);
  const crt = new THREE.PointLight(0x7dffb0, .04, 1.0, 2); crt.position.set(-.05, .98, -.15); g.add(crt);

  // the cabin shell shades itself: lamps above the car mustn't flood the console through the roof
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    group: g, stack, interactives, buttons,
    screen: { canvas: sc, ctx: sx, tex: screenTex, mesh: screen, preview, previewMesh },
    cluster: { canvas: cc, ctx: cx, tex: clusterTex },
    dial: { mesh: dial, ring: dialF.ring, ctx: dialF.ctx, canvas: dialF.c, angle: 0, target: 0 },
    knob: { mesh: knob, ring: knobF.ring, ctx: knobF.ctx, canvas: knobF.c, angle: 0, target: 0 },
    key: { group: key, turn: 0, target: 0 },
    hazard,
    gate: { lever, slots, pos: new THREE.Vector2(0, 0) },
    wheel: steer, glowMat: M.glow,
    setGlow(c) { M.glow.color.set(c).multiplyScalar(2.2); },
  };
}
