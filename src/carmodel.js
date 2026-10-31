// Period cars, all original designs sculpted from lofted cross-sections in the late-70s/80s language:
//  wedge    Vanta 308 Turbo   Italian mid-engine wedge: knife nose, pop-ups, louvred rear glass, ribbed tails
//  coupe    Kaze GT-S         Japanese front-engine pop-up coupe with a glass hatch
//  ttop     Stallion T-Top    American long-hood muscle coupe: quad lamps, shaker scoop, T-top roof, ducktail
//  fastback Adler 930 Turbo   German rear-engine fastback: round lamps on raised wings, whale tail, wide hips
// Local frame: +z forward, +y up, x to the car's LEFT (right side is -x). All share a 0.31 m rolling radius.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { tireTexture, glowTexture } from './tex.js';

export const CAR = { wheelR: .31, axleF: 1.2, axleR: -1.24, trackF: .77, trackR: .79, tireWF: .225, tireWR: .285 };

// piecewise-linear profile: panels of the era are straight lines meeting at creases
function lin(keys) {
  return z => {
    if (z <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (z <= keys[i][0]) {
      const [z0, v0] = keys[i - 1], [z1, v1] = keys[i];
      return v0 + (v1 - v0) * (z - z0) / (z1 - z0);
    }
    return keys[keys.length - 1][1];
  };
}

const BODIES = {
  wedge: {
    z0: -2.12, z1: 2.15,
    halfW: [[-2.12, .89], [-1.9, .93], [-.9, .93], [-.1, .9], [.9, .915], [1.7, .9], [2.05, .855], [2.15, .79]],
    yBot: [[-2.12, .34], [-1.95, .2], [-1.55, .155], [1.65, .15], [2.0, .18], [2.15, .25]],
    yTop: [[-2.12, .955], [-2.02, .985], [-1.5, .985], [-1.0, .965], [-.25, .875], [.58, .865], [2.15, .55]],
    crease: [[-2.12, .8], [-1.0, .74], [.4, .62], [2.15, .44]],
    roof: [[-1.5, .975], [-.78, 1.105], [-.25, 1.11], [.58, .865]],
    glass: [-1.5, .58], cabin: [-1.45, .6], hoodFrom: .58,
    axleF: 1.2, axleR: -1.24, trackF: .77, trackR: .79, tireWF: .225, tireWR: .285,
    intake: true, lamps: 'popup', popZ: 1.6, popX: .58, tail: 'ribbed', louvres: true, spoiler: 'wing',
    roofPanel: [1.18, -.5, .52], exhaust: [-.42, -.3, .3, .42], stripe: [.585, 3.6],
  },
  coupe: {
    z0: -2.2, z1: 2.22,
    halfW: [[-2.2, .8], [-2.0, .855], [-1.0, .865], [0, .85], [1.0, .86], [1.8, .85], [2.1, .8], [2.22, .74]],
    yBot: [[-2.2, .36], [-2.0, .22], [-1.6, .17], [1.7, .17], [2.05, .2], [2.22, .27]],
    yTop: [[-2.2, .92], [-2.1, .95], [-1.6, .955], [.25, .9], [.36, .89], [2.22, .63]],
    crease: [[-2.2, .78], [.4, .72], [2.22, .6]],
    roof: [[-2.02, .955], [-1.0, 1.255], [-.15, 1.285], [.36, .89]],
    glass: [-2.02, .36], cabin: [-1.0, .38], hoodFrom: .36,
    axleF: 1.38, axleR: -1.12, trackF: .73, trackR: .74, tireWF: .205, tireWR: .225,
    lamps: 'popup', popZ: 1.72, popX: .55, tail: 'bar', spoiler: 'lip',
    roofPanel: [1.0, -.58, .78], exhaust: [-.5], stripe: [.6, 3.7],
  },
  ttop: {
    z0: -2.42, z1: 2.5,
    halfW: [[-2.42, .86], [-2.2, .92], [-1.3, .93], [-.3, .9], [.6, .9], [1.7, .905], [2.35, .86], [2.5, .82]],
    yBot: [[-2.42, .38], [-2.2, .24], [-1.8, .18], [1.9, .18], [2.3, .22], [2.5, .3]],
    yTop: [[-2.42, .94], [-2.36, .975], [-1.55, .985], [-1.38, .965], [.15, .905], [.26, .92], [2.5, .72]],
    crease: [[-2.42, .76], [2.5, .66]],
    roof: [[-1.55, .985], [-.92, 1.215], [-.28, 1.245], [.26, .92]],
    glass: [-1.55, .26], cabin: [-1.4, .28], hoodFrom: .26,
    axleF: 1.55, axleR: -1.2, trackF: .78, trackR: .79, tireWF: .235, tireWR: .25,
    lamps: 'quad', tail: 'ribbed', spoiler: 'ducktail', scoop: true, ttop: true,
    roofPanel: null, exhaust: [-.6, -.5, .5, .6], stripe: [.62, 4.1],
  },
  fastback: {
    z0: -2.15, z1: 2.15,
    halfW: [[-2.15, .82], [-1.9, .89], [-1.15, .9], [-.45, .83], [.6, .82], [1.25, .855], [1.9, .82], [2.15, .74]],
    yBot: [[-2.15, .36], [-1.95, .22], [-1.5, .16], [1.7, .16], [2.0, .2], [2.15, .28]],
    yTop: [[-2.15, .86], [-1.95, .9], [-1.2, .93], [-.9, .935], [.62, .84], [2.15, .6]],
    crease: [[-2.15, .72], [2.15, .6]],
    roof: [[-1.95, .9], [-.62, 1.24], [-.12, 1.3], [.62, .845]],
    glass: [-1.3, .62], cabin: [-.95, .64], hoodFrom: .62,
    // raised front wings carrying the round lamps, and broad rear hips
    fender: [[.9, 0], [1.35, .09], [1.9, .1], [2.15, .05]], hips: [[-2.0, .02], [-1.4, .06], [-.8, 0]],
    axleF: 1.18, axleR: -1.1, trackF: .72, trackR: .78, tireWF: .205, tireWR: .255,
    lamps: 'round', tail: 'bar', spoiler: 'whale',
    roofPanel: [.98, -.55, .9], exhaust: [-.32, -.22], stripe: [.6, 3.4],
  },
};
export const BODY_IDS = Object.keys(BODIES);

function loft(stations, colorFn) {
  const S = stations.length, M = stations[0].pts.length;
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i < S; i++) {
    const { z, pts } = stations[i];
    for (let j = 0; j < M; j++) {
      const [x, y] = pts[j];
      pos.push(x, y, z); uv.push(j / M, i / (S - 1));
      const c = colorFn ? colorFn(x, y, z) : 1;
      col.push(c, c, c);
    }
  }
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M;
    idx.push(a, b, c, b, d, c);           // rings run counter-clockwise seen from the front, so this faces outward
  }
  for (const [i, flip] of [[0, false], [S - 1, true]]) {
    const { z, pts } = stations[i];
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= M; cy /= M;
    const ci = pos.length / 3; pos.push(cx, cy, z); uv.push(.5, i ? 1 : 0);
    const cc = colorFn ? colorFn(cx, cy, z) : 1; col.push(cc, cc, cc);
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + (j + 1) % M;
      flip ? idx.push(ci, a, b) : idx.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return toCreasedNormals(g, .5);
}

function densify(poly, per) {
  const out = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[i + 1], n = per[i] ?? 2;
    for (let k = 0; k < n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  out.push(poly[poly.length - 1]);
  return out;
}

// shared wheel parts
let PARTS = null;
function parts() {
  if (PARTS) return PARTS;
  const tyre = w => {
    const r = CAR.wheelR, rim = .205, p = [], hw = w / 2;
    p.push(new THREE.Vector2(rim, -hw * .86));
    for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + k / 8 * Math.PI / 2; p.push(new THREE.Vector2(r - .045 + Math.cos(a) * .045, -hw + .045 + Math.sin(a) * .045)); }
    for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI / 2; p.push(new THREE.Vector2(r - .045 + Math.cos(a) * .045, hw - .045 + Math.sin(a) * .045)); }
    p.push(new THREE.Vector2(rim, hw * .86));
    const g = new THREE.LatheGeometry(p, 48); g.rotateZ(Math.PI / 2); return g;
  };
  const sh = new THREE.Shape(); sh.absarc(0, 0, .2, 0, Math.PI * 2, false);
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, h = new THREE.Path(); h.absarc(Math.cos(a) * .128, Math.sin(a) * .128, .033, 0, Math.PI * 2, true); sh.holes.push(h); }
  const hubH = new THREE.Path(); hubH.absarc(0, 0, .035, 0, Math.PI * 2, true); sh.holes.push(hubH);
  const dial = new THREE.ExtrudeGeometry(sh, { depth: .018, bevelEnabled: true, bevelThickness: .008, bevelSize: .006, bevelSegments: 3, curveSegments: 24 });
  dial.rotateY(Math.PI / 2); dial.translate(.06, 0, 0);
  const barrel = new THREE.CylinderGeometry(.205, .205, .2, 40, 1, true); barrel.rotateZ(Math.PI / 2);
  const lip = new THREE.TorusGeometry(.204, .01, 8, 48); lip.rotateY(Math.PI / 2); lip.translate(.09, 0, 0);
  const cap = new THREE.CylinderGeometry(.045, .05, .04, 20); cap.rotateZ(Math.PI / 2); cap.translate(.075, 0, 0);
  const disc = new THREE.CylinderGeometry(.15, .15, .025, 32); disc.rotateZ(Math.PI / 2);
  const caliper = new THREE.BoxGeometry(.06, .16, .07); caliper.translate(.03, .08, .1);
  const blur = new THREE.CircleGeometry(.2, 32);
  PARTS = { blur, tyre: {}, tyreFor: w => PARTS.tyre[w] ??= tyre(w), dial, barrel, lip, cap, disc, caliper };
  return PARTS;
}

const GEOS = {};
function bodyGeometry(id) {
  if (GEOS[id]) return GEOS[id];
  const B = BODIES[id];
  const halfW = lin(B.halfW), yBot = lin(B.yBot), yTop = lin(B.yTop), yCrease = lin(B.crease), roof = lin(B.roof);
  const fender = B.fender ? lin(B.fender) : () => 0, hips = B.hips ? lin(B.hips) : () => 0;
  const wheels = [[B.axleF, B.trackF], [B.axleR, B.trackR]];
  const archR = .4, S = 170, stations = [];
  for (let i = 0; i < S; i++) {
    const z = B.z0 + (B.z1 - B.z0) * i / (S - 1);
    const W = halfW(z) + hips(z), yb = yBot(z), yt = yTop(z), yc = Math.min(yCrease(z), yt - .07);
    const tf = z > B.hoodFrom ? .9 : .86, fr = fender(z);
    const half = densify([[0, yb], [W - .07, yb], [W - .012, yb + .07], [W, yc], [W - .035, yc + .018 + fr * .4], [W * tf, yt - .006 + fr], [W * tf - .06 - fr * .6, yt + .006 + fr * .6], [0, yt + .016]],
      [4, 2, 14, 2, 4, 2, 5]);
    const ring = [];
    for (const [x, y] of half) ring.push([x, y]);
    for (let k = half.length - 2; k >= 1; k--) ring.push([-half[k][0], half[k][1]]);
    for (const p of ring) {
      for (const [wz, tr] of wheels) {
        const d = Math.hypot(z - wz, p[1] - CAR.wheelR);
        if (d < archR && Math.abs(p[0]) > tr - .2) {
          const k = THREE.MathUtils.smoothstep(archR - d, 0, .02);
          p[0] = Math.sign(p[0]) * THREE.MathUtils.lerp(Math.abs(p[0]), tr - .18, k);
        }
      }
      if (B.intake) {
        const sc = Math.exp(-Math.pow((z + .62) / .26, 2)) * Math.exp(-Math.pow((p[1] - .66) / .07, 2));
        p[0] -= Math.sign(p[0]) * sc * .07;
      }
    }
    stations.push({ z, pts: ring });
  }
  const inArch = (x, y, z) => wheels.some(([wz, tr]) => Math.hypot(z - wz, y - CAR.wheelR) < archR - .004 && Math.abs(x) < tr - .1);
  const body = loft(stations, (x, y, z) => {
    if (inArch(x, y, z)) return .02;
    if (B.intake && Math.exp(-Math.pow((z + .62) / .22, 2)) * Math.exp(-Math.pow((y - .66) / .055, 2)) > .4) return .03;
    if (y < .22) return .05;
    return 1;
  });
  // glasshouse
  const gst = [], [g0, g1] = B.glass;
  for (let i = 0; i < 70; i++) {
    const z = g0 + (g1 - g0) * i / 69;
    const belt = yTop(z) - .012, top = Math.max(roof(z), belt + .006);
    const bw = halfW(z) - .1, tw = bw * (B.ttop ? .8 : .76);
    const half = densify([[0, belt], [bw, belt], [tw, top], [tw - .04, top + .006], [0, top + .012]], [3, 6, 1, 4]);
    const ring = [...half]; for (let k = half.length - 2; k >= 1; k--) ring.push([-half[k][0], half[k][1]]);
    gst.push({ z, pts: ring });
  }
  const glass = loft(gst);
  // the same body with the cabin opening cut out of its top skin, used while the camera is inside
  const pos = body.attributes.position, keep = [];
  for (let t = 0; t < pos.count; t += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += pos.getX(t + k); cy += pos.getY(t + k); cz += pos.getZ(t + k); }
    cx /= 3; cy /= 3; cz /= 3;
    if (!(cz > B.cabin[0] && cz < B.cabin[1] && cy > yTop(cz) - .09 && Math.abs(cx) < halfW(cz) - .04)) keep.push(t);
  }
  const bodyOpen = new THREE.BufferGeometry();
  for (const name of Object.keys(body.attributes)) {
    const a = body.attributes[name], n = a.itemSize, arr = new Float32Array(keep.length * 3 * n);
    keep.forEach((t, i) => { for (let k = 0; k < 3 * n; k++) arr[i * 3 * n + k] = a.array[t * n + k]; });
    bodyOpen.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  return (GEOS[id] = { body, bodyOpen, glass, f: { halfW, yTop, roof, fender } });
}

let SHARED = null;
function sharedMaterials() {
  if (SHARED) return SHARED;
  SHARED = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x06080b, metalness: .1, roughness: .03, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 1.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: .75, metalness: 0 }),
    tyre: new THREE.MeshStandardMaterial({ map: tireTexture(), roughness: .88, metalness: 0 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x5a5a5e, metalness: .85, roughness: .5 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: .3, roughness: .5 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd6d8dc, metalness: 1, roughness: .1 }),
    black: new THREE.MeshStandardMaterial({ color: 0x050506, metalness: .1, roughness: .55 }),
    louvre: new THREE.MeshStandardMaterial({ color: 0x08080a, metalness: .3, roughness: .45 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d6, emissiveIntensity: 0, roughness: .2 }),
    amber: new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff8a10, emissiveIntensity: 1.2 }),
    glow: glowTexture(),
  };
  return SHARED;
}

export const WHEEL_FINISH = { silver: [0xc9ccd2, .85, .3], gold: [0xb08a3a, .9, .3], black: [0x1a1a1c, .6, .4], white: [0xe8e8e6, .2, .35] };

// The Ruff Dogs plate from the REDLINE intro: chrome rounded frame, deep red guilloché enamel, chrome lettering.
// Only the studio's developer account carries it.
let plateTex = null;
function ruffDogsPlateTexture() {
  if (plateTex) return plateTex;
  const W = 1024, H = 480, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, 620); gr.addColorStop(0, '#6a0808'); gr.addColorStop(1, '#1c0202');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,90,70,.13)'; g.lineWidth = 1.5;
  for (let k = 0; k < 110; k++) {
    g.beginPath();
    for (let a = 0; a <= 6.3; a += .02) { const r = 40 + k * 6 + 6 * Math.sin(a * 24 + k * .3); const x = W / 2 + Math.cos(a) * r * 1.6, y = H / 2 + Math.sin(a) * r * .8; a ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // chrome type: dark drop, bright top edge, then a mirror gradient face
  const chromeText = (txt, y, font, spacing) => {
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    const wds = [...txt].map(ch => g.measureText(ch).width), tot = wds.reduce((a, b) => a + b, 0) + spacing * (txt.length - 1);
    const draw = (dx, dy, fill) => { let x = W / 2 - tot / 2; g.fillStyle = fill; [...txt].forEach((ch, i) => { g.fillText(ch, x + wds[i] / 2 + dx, y + dy); x += wds[i] + spacing; }); };
    const sz = parseFloat(font.match(/(\d+)px/)[1]);
    const face = g.createLinearGradient(0, y - sz / 2, 0, y + sz / 2);
    face.addColorStop(0, '#ffffff'); face.addColorStop(.42, '#c9ced6'); face.addColorStop(.5, '#5d636d'); face.addColorStop(.62, '#e8ebf0'); face.addColorStop(1, '#8a9099');
    draw(0, sz * .07, 'rgba(0,0,0,.75)'); draw(0, -sz * .025, 'rgba(255,255,255,.9)'); draw(0, 0, face);
    return tot;
  };
  chromeText('RUFF DOGS', H * .42, '900 168px Anton, Impact, sans-serif', 12);
  const sub = chromeText('STUDIOS', H * .78, '600 60px Michroma, sans-serif', 30);
  for (const sx of [-1, 1]) {
    const x0 = W / 2 + sx * (sub / 2 + 40), x1 = W / 2 + sx * (sub / 2 + 190);
    const rg = g.createLinearGradient(0, H * .78 - 5, 0, H * .78 + 5); rg.addColorStop(0, '#fff'); rg.addColorStop(.5, '#6b717b'); rg.addColorStop(1, '#d9dde3');
    g.fillStyle = rg; g.fillRect(Math.min(x0, x1), H * .78 - 5, Math.abs(x1 - x0), 10);
  }
  plateTex = new THREE.CanvasTexture(c); plateTex.colorSpace = THREE.SRGBColorSpace; plateTex.anisotropy = 8;
  // fonts arrive after the first race loads; redraw once they're in
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { const t = plateTex; plateTex = null; const n = ruffDogsPlateTexture(); t.image = n.image; t.needsUpdate = true; plateTex = t; });
  return plateTex;
}
function roundRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}
export function ruffDogsPlate() {
  const g = new THREE.Group(), w = .34, h = .16, r = .022;
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, metalness: 1, roughness: .16, envMapIntensity: 1.4 });
  const frame = roundRect(w, h, r); frame.holes.push(roundRect(w - .02, h - .02, r - .008));
  g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(frame, { depth: .006, bevelEnabled: true, bevelThickness: .003, bevelSize: .003, bevelSegments: 3, curveSegments: 16 }), chrome));
  const tex = ruffDogsPlateTexture();
  const enamel = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(w - .018, h - .018, r - .007), 16),
    new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: .07, metalness: .2, roughness: .25, clearcoat: 1, clearcoatRoughness: .03 }));
  { const geo = enamel.geometry, P = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < P.count; i++) uv.setXY(i, P.getX(i) / (w - .018) + .5, P.getY(i) / (h - .018) + .5); }
  enamel.position.z = .003; g.add(enamel);
  // two chrome bolts
  for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.SphereGeometry(.007, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), chrome); b.rotation.x = Math.PI / 2; b.position.set(sx * (w / 2 - .03), h / 2 - .022, .006); g.add(b); }
  return g;
}

export function makeCar({ body: bodyId = 'wedge', color = 0xc8161c, headlights = false, wheels: wheelFinish = 'silver', stripe = null, wing = true, plate = null } = {}) {
  const B = BODIES[bodyId] || BODIES.wedge;
  const GEO = bodyGeometry(bodyId in BODIES ? bodyId : 'wedge'), P = parts(), F = GEO.f;
  const M = sharedMaterials();
  const paintOpts = { color, metalness: .35, roughness: .3, clearcoat: 1, clearcoatRoughness: .025, envMapIntensity: 1.3 };
  const paint = new THREE.MeshPhysicalMaterial({ ...paintOpts, vertexColors: true });
  const paintPlain = new THREE.MeshPhysicalMaterial(paintOpts);
  const tail = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1608, emissiveIntensity: 1.6 });
  const lampMat = M.lamp.clone();
  const [wc, wm, wr] = WHEEL_FINISH[wheelFinish] || WHEEL_FINISH.silver;
  const alloy = new THREE.MeshStandardMaterial({ color: wc, metalness: wm, roughness: wr });
  // per-car brake discs so they can glow with heat, and a soft disc that reads as a spinning wheel at speed
  const discMat = M.disc.clone(); discMat.emissive = new THREE.Color(0xff3c08); discMat.emissiveIntensity = 0;
  const blurMat = new THREE.MeshStandardMaterial({ color: wc, metalness: wm * .8, roughness: .45, transparent: true, opacity: 0, depthWrite: false });

  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const body = new THREE.Mesh(GEO.body, paint); body.castShadow = true; body.receiveShadow = true; chassis.add(body);
  const glass = new THREE.Mesh(GEO.glass, M.glass); glass.castShadow = true; chassis.add(glass);
  const box = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = chassis) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };
  const outer = [];
  const zF = B.z1, zR = B.z0, wF = F.halfW(zF - .1), wR = F.halfW(zR + .1);

  // roof: painted panel, or a T-top (painted centre bar between two smoked glass panels)
  if (B.roofPanel) {
    const [w, z, d] = B.roofPanel;
    outer.push(box(w, .012, d, paintPlain, 0, F.roof(z) + .008, z));
  }
  if (B.ttop) {
    const z = -.6, y = F.roof(z) + .008;
    outer.push(box(.2, .014, .62, paintPlain, 0, y, z));
    for (const s of [-1, 1]) outer.push(box(.42, .01, .58, M.glass, s * .32, y + .002, z));
  }
  // louvres across the sloping rear glass (wedge)
  if (B.louvres) {
    const slope = Math.atan2(1.105 - .975, 1.5 - .78);
    for (let k = 0; k < 11; k++) {
      const z = -.84 - k * .058, y = F.roof(z) + .02, w = (F.halfW(z) - .1) * .76 * 2;
      outer.push(box(w, .006, .05, M.louvre, 0, y, z, -slope - .5));
    }
    for (const s of [-1, 1]) outer.push(box(.03, .03, .68, M.louvre, s * .64, 1.03, -1.13, -slope));
  }
  // impact bumpers, chin spoiler, rub strips
  box(wF * 1.82, .12, .1, M.rubber, 0, .33, zF - .03, -.12);
  for (const s of [-1, 1]) box(.06, .12, .32, M.rubber, s * (wF - .02), .33, zF - .17, -.12, s * .45);
  box(wF * 1.75, .03, .22, M.rubber, 0, .17, zF - .12);
  box(wR * 1.9, .13, .1, M.rubber, 0, .4, zR - .01);
  const midZ = (B.axleF + B.axleR) / 2, sideLen = (B.axleF - B.axleR) - .9;
  for (const s of [-1, 1]) {
    box(.03, .045, sideLen + .6, M.rubber, s * (F.halfW(midZ) + .005), .5, midZ);
    box(.04, .07, sideLen, M.rubber, s * (F.halfW(midZ) - .01), .18, midZ);
  }
  if (stripe) for (const s of [-1, 1]) {
    const st = new THREE.MeshStandardMaterial({ color: stripe, roughness: .35 });
    const [y, len] = B.stripe;
    box(.004, .035, len, st, s * (F.halfW(midZ) + .012), y, midZ);
    box(.004, .012, len, st, s * (F.halfW(midZ) + .012), y - .045, midZ);
  }
  // bullet mirrors at the base of the A-pillar
  const mz = B.glass[1] - .16;
  for (const s of [-1, 1]) {
    box(.02, .05, .03, M.black, s * (F.halfW(mz) - .01), F.yTop(mz) + .03, mz);
    const m = new THREE.Mesh(new THREE.SphereGeometry(.055, 16, 10), paintPlain);
    m.scale.set(1.1, .8, 1.5); m.position.set(s * (F.halfW(mz) + .05), F.yTop(mz) + .07, mz); chassis.add(m);
  }

  // headlamps
  const pops = [], glowAt = [];
  const hoodSlope = Math.atan((F.yTop(B.hoodFrom) - F.yTop(zF)) / (zF - B.hoodFrom));
  if (B.lamps === 'popup') {
    for (const s of [-1, 1]) {
      const z0 = B.popZ, hinge = new THREE.Group();
      hinge.position.set(s * B.popX, F.yTop(z0) + .004, z0);
      chassis.add(hinge);
      box(.36, .12, .26, [M.black, M.black, paintPlain, lampMat, M.black, M.black], 0, -.06, .13, 0, 0, 0, hinge);
      hinge.rotation.x = hoodSlope;
      pops.push(hinge);
      glowAt.push([hinge, new THREE.Vector3(0, -.12, .14)]);
    }
  } else if (B.lamps === 'quad') {
    const y = .55, z = zF + .005;
    box(wF * 1.7, .16, .04, M.black, 0, y, z - .02);
    for (const s of [-1, 1]) for (const k of [.32, .6]) {
      const l = box(.2, .11, .02, lampMat, s * k, y, z); void l;
      glowAt.push([chassis, new THREE.Vector3(s * k, y, z + .05)]);
    }
  } else if (B.lamps === 'round') {
    for (const s of [-1, 1]) {
      const x = s * (F.halfW(1.95) - .2), y = F.yTop(1.95) + F.fender(1.95) + .02, z = 1.98;
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(.095, .1, .12, 28), paintPlain); pod.rotation.x = Math.PI / 2 - .35; pod.position.set(x, y, z); chassis.add(pod);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(.085, 28), lampMat); lens.position.set(x, y + .02, z + .065); lens.rotation.x = -.35; chassis.add(lens);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.088, .008, 8, 28), M.chrome); ring.position.copy(lens.position); ring.rotation.x = -.35; chassis.add(ring);
      glowAt.push([chassis, new THREE.Vector3(x, y + .02, z + .12)]);
    }
  }
  for (const s of [-1, 1]) box(.16, .04, .02, M.amber, s * (wF - .3), .36, zF + .04, -.12);

  // tail lamps
  if (B.tail === 'ribbed') {
    box(wR * 1.82, .14, .03, tail, 0, .72, zR - .005);
    for (const s of [-1, 1]) { box(.03, .14, .26, tail, s * (wR - .015), .72, zR + .12); box(.2, .14, .032, M.amber, s * (wR - .2), .72, zR - .007); }
    for (let k = -13; k <= 13; k++) box(.008, .14, .036, M.black, k * wR / 14.5, .72, zR - .01);
  } else {
    box(wR * 1.84, .11, .03, tail, 0, .75, zR - .005);
    box(wR * 1.84, .02, .034, M.black, 0, .75, zR - .008);
    for (const s of [-1, 1]) box(.14, .11, .032, M.amber, s * (wR - .12), .75, zR - .007);
  }
  box(.42, .1, .012, M.black, 0, .55, zR - .02);
  const exhausts = [];
  for (const s of B.exhaust) {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(.04, .042, .16, 16, 1, true), M.chrome);
    e.rotation.x = Math.PI / 2; e.position.set(s, .3, zR - .01); chassis.add(e);
    exhausts.push(new THREE.Vector3(s, .3, zR - .12));
  }

  // spoilers
  const sp = B.spoiler;
  if (sp === 'wing' && wing) {
    outer.push(box(1.62, .03, .3, paintPlain, 0, 1.17, -1.86, .08));
    for (const s of [-1, 1]) { box(.025, .2, .16, M.black, s * .45, 1.06, -1.82, -.2); box(.02, .12, .34, M.black, s * .82, 1.16, -1.86); }
  } else if (sp === 'lip') {
    outer.push(box(1.4, .025, .16, M.black, 0, F.roof(-1.85) + .05, -1.85, .15));
  } else if (sp === 'ducktail') {
    box(wR * 1.8, .05, .16, M.black, 0, F.yTop(zR + .1) + .03, zR + .1, -.35);
  } else if (sp === 'whale') {
    const z = -1.72, y = F.yTop(z) + .05;
    outer.push(box(1.36, .04, .42, paintPlain, 0, y + .04, z, .06));
    outer.push(box(1.36, .1, .03, M.rubber, 0, y + .08, z - .22));
    for (const s of [-1, 1]) outer.push(box(.04, .1, .42, paintPlain, s * .66, y + .04, z));
  }
  if (B.scoop) {
    const z = .9, y = F.yTop(z);
    box(.34, .1, .5, M.black, 0, y + .05, z, -hoodSlope);
    box(.3, .06, .02, M.chrome, 0, y + .09, z + .26, -hoodSlope);
  }

  // glows
  const sprite = (col, sx, sy, pos, parent = chassis) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.glow, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.scale.set(sx, sy, 1); s.position.copy(pos); parent.add(s); return s;
  };
  const tailGlow = sprite(0xff1a08, 2.4, .5, new THREE.Vector3(0, .73, zR - .08)); tailGlow.material.opacity = .5;
  const headGlow = glowAt.map(([p, v]) => sprite(0xfff1d6, B.lamps === 'quad' ? .5 : .9, .5, v, p));

  // wheels
  const wheelsOut = [];
  for (const [z, x, tw] of [[B.axleF, B.trackF, B.tireWF], [B.axleF, -B.trackF, B.tireWF], [B.axleR, B.trackR, B.tireWR], [B.axleR, -B.trackR, B.tireWR]]) {
    const hub = new THREE.Group(); hub.position.set(x, CAR.wheelR, z);
    const side = Math.sign(x), spin = new THREE.Group(); hub.add(spin);
    const t = new THREE.Mesh(P.tyreFor(tw), M.tyre); t.castShadow = true; spin.add(t);
    const face = new THREE.Group(); face.scale.x = side; face.position.x = side * (tw / 2 - .11); spin.add(face);
    face.add(new THREE.Mesh(P.dial, alloy), new THREE.Mesh(P.barrel, alloy), new THREE.Mesh(P.lip, alloy), new THREE.Mesh(P.cap, M.black));
    const d = new THREE.Mesh(P.disc, discMat); d.position.x = side * -.02; spin.add(d);
    const blur = new THREE.Mesh(P.blur, blurMat); blur.position.x = side * (tw / 2 - .02); blur.rotation.y = side * Math.PI / 2; hub.add(blur);
    const cal = new THREE.Mesh(P.caliper, M.caliper); cal.position.x = side * -.02; cal.scale.x = side; hub.add(cal);
    root.add(hub);
    wheelsOut.push({ hub, spin, baseY: CAR.wheelR, x, z });
  }

  let lights = null;
  if (headlights) {
    lights = [];
    for (const s of [-1, 1]) {
      const sl = new THREE.SpotLight(0xfff0d8, 0, 130, .4, .5, 1.6);
      sl.position.set(s * .58, .62, zF + .3);        // just ahead of the nose, clear of every surface
      sl.target.position.set(s * 1.4, -.6, 26);
      chassis.add(sl, sl.target);
      lights.push(sl);
    }
  }

  // rear plate (developer account only), facing backwards in the recess between the tail lamps and bumper
  let plateG = null;
  const setPlate = kind => {
    if (kind === 'ruffdogs' && !plateG) { plateG = ruffDogsPlate(); plateG.position.set(0, .555, zR - .032); plateG.rotation.y = Math.PI; chassis.add(plateG); }
    if (plateG) plateG.visible = kind === 'ruffdogs';
  };
  setPlate(plate);

  let popT = 0, popTarget = 0, heat = 0;
  return {
    setPlate,
    root, chassis, body, glass, wheels: wheelsOut, paint, tail, tailGlow, exhausts, lights, pops, bodyId,
    setPaint(c) { paint.color.set(c); paintPlain.color.set(c); },
    setWheels(f) { const [c, m, r] = WHEEL_FINISH[f] || WHEEL_FINISH.silver; alloy.color.set(c); alloy.metalness = m; alloy.roughness = r; },
    setBrake(b) {
      tail.emissiveIntensity = 1.6 + b * 6;
      tailGlow.material.opacity = .4 + b * .6;
      tailGlow.scale.set(2.4 + b * 1.2, .5 + b * .3, 1);
    },
    setHeadlights(on) { popTarget = on ? 1 : 0; },
    // speed in m/s, brake 0..1: blur the spokes when they're a smear, heat the discs under hard braking
    setDynamics(speed, brake, dt) {
      blurMat.opacity = THREE.MathUtils.smoothstep(Math.abs(speed), 9, 30) * .88;
      heat = Math.max(0, heat + (brake * Math.abs(speed) * .012 - .12) * dt);
      heat = Math.min(heat, 1.2);
      discMat.emissiveIntensity = THREE.MathUtils.smoothstep(heat, .25, 1) * 3;
    },
    update(dt) {
      if (popT === popTarget) return;
      popT = THREE.MathUtils.clamp(popT + Math.sign(popTarget - popT) * dt * 1.6, 0, 1);
      const e = popT * popT * (3 - 2 * popT);
      for (const h of pops) h.rotation.x = hoodSlope - e * (Math.PI / 2 - .04);
      const lit = pops.length ? THREE.MathUtils.smoothstep(popT, .7, 1) : popT;
      lampMat.emissiveIntensity = lit * 9;
      headGlow.forEach(g => g.material.opacity = lit * .9);
      if (lights) lights.forEach(l => l.intensity = lit * 240);
    },
    setInterior(on) { glass.visible = !on; for (const o of outer) o.visible = !on; body.geometry = on ? GEO.bodyOpen : GEO.body; },
    get headlightsUp() { return popT; },
  };
}
