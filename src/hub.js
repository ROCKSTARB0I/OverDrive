// The menu hub: a top-floor car park above the city at night. Your car sits in a lit bay; around it are the "places"
// the menu flies to: the work-light bay (garage), the circuit billboard on the next tower (race / time attack).
import * as THREE from 'three';
import { canvas, rng, concreteTexture, signTexture, glowTexture } from './tex.js';
import { towerMeshes, shaftMaterial, shaftGeometry } from './city.js';
import { skyDome } from './gfx.js';
import { makeCar } from './carmodel.js';
import { TRACKS } from './track.js';
import { fmtTime } from './menu.js';

function deckTexture() {
  const W = 1024, [c, x] = canvas(W, W), R = rng(5);
  const [rc, rx] = canvas(W, W);
  const img = x.createImageData(W, W), d = img.data, ri = rx.createImageData(W, W), rd = ri.data;
  for (let i = 0; i < W * W; i++) {
    const v = 52 + R() * 26; d[i * 4] = v; d[i * 4 + 1] = v * .99; d[i * 4 + 2] = v * 1.02; d[i * 4 + 3] = 255;
    const r = 175 + R() * 60; rd[i * 4] = rd[i * 4 + 1] = rd[i * 4 + 2] = r; rd[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0); rx.putImageData(ri, 0, 0);
  // expansion joints
  x.fillStyle = 'rgba(0,0,0,.5)'; for (let k = 0; k <= 4; k++) { x.fillRect(k * W / 4 - 1, 0, 3, W); x.fillRect(0, k * W / 4 - 1, W, 3); }
  // tyre marks
  x.strokeStyle = 'rgba(10,10,10,.25)'; x.lineWidth = 10;
  for (let k = 0; k < 10; k++) { x.beginPath(); x.moveTo(R() * W, R() * W); x.bezierCurveTo(R() * W, R() * W, R() * W, R() * W, R() * W, R() * W); x.stroke(); }
  // puddles (glossy, darker)
  for (let k = 0; k < 14; k++) {
    const px = R() * W, py = R() * W, r = 30 + R() * 90;
    for (const [ctx, col, a] of [[rx, '70,70,70', .8], [x, '8,9,12', .35]]) {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(.75, `rgba(${col},${a * .7})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  const rt = new THREE.CanvasTexture(rc); rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
  return [t, rt];
}

export function buildHub(env) {
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.fog = new THREE.FogExp2(0x0b0e18, .0032);
  scene.add(skyDome());
  const R = rng(321);
  const Y = 0;

  // ---------------- deck
  const [dt, drt] = deckTexture(); dt.repeat.set(4, 3); drt.repeat.set(4, 3);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ map: dt, roughnessMap: drt, roughness: 1, metalness: 0, envMapIntensity: .6 }));
  deck.rotation.x = -Math.PI / 2; deck.receiveShadow = true; scene.add(deck);
  // bay lines (yellow, worn) + numbers
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xc9a12a, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2 });
  for (let k = -3; k <= 3; k++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(.14, 5.6), lineMat); l.rotation.x = -Math.PI / 2; l.position.set(k * 3.3 + 1.65, .005, -.6); scene.add(l);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(23.2, .14), lineMat); back.rotation.x = -Math.PI / 2; back.position.set(0, .005, -3.4); scene.add(back);

  // ---------------- parapet + railing round the edge
  const conc = concreteTexture(9); conc.repeat.set(8, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: conc, color: 0x8a8580, roughness: .9 });
  const rail = new THREE.MeshStandardMaterial({ color: 0x6a6d72, metalness: .8, roughness: .4 });
  const edges = [[0, 30, 80, 0], [0, -30, 80, 0], [40, 0, 60, Math.PI / 2], [-40, 0, 60, Math.PI / 2]];
  for (const [x, z, len, ry] of edges) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(len, 1.05, .35), wallMat); w.position.set(x, .525, z); w.rotation.y = ry; w.receiveShadow = true; scene.add(w);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, len, 8), rail); r.rotation.z = Math.PI / 2; r.position.set(x, 1.45, z); r.rotation.y = ry; scene.add(r);
    for (let k = -len / 2; k <= len / 2; k += 2.5) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .45, 6), rail);
      p.position.set(x + Math.cos(ry) * k, 1.25, z - Math.sin(ry) * k); scene.add(p);
    }
  }

  // ---------------- stair/lift tower with a lit door and level sign
  const tower = new THREE.Mesh(new THREE.BoxGeometry(7, 4.2, 6), wallMat); tower.position.set(-24, 2.1, -18); tower.castShadow = true; scene.add(tower);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .85, .6).multiplyScalar(1.6) }));
  door.position.set(-20.49, 1.15, -18); door.rotation.y = Math.PI / 2; scene.add(door);
  const lvl = new THREE.Mesh(new THREE.PlaneGeometry(2.4, .6), new THREE.MeshBasicMaterial({ map: signTexture('LEVEL 9', '#ffcc33', { w: 512, h: 128, font: '900 italic 80px "Saira Condensed"' }), toneMapped: false }));
  lvl.position.set(-20.48, 3, -18); lvl.rotation.y = Math.PI / 2; scene.add(lvl);

  // ---------------- lamp posts with sodium heads, light shafts and real lights
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: .7, roughness: .45 });
  const lampHeads = [];
  const posts = [[-9, -6], [9, -6], [-9, 9], [9, 9], [-22, 6], [22, 6]];
  const shaftMat = shaftMaterial(0xffa860, .11);
  for (const [x, z] of posts) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, 7, 10), steel); p.position.set(x, 3.5, z); scene.add(p);
    const h = new THREE.Mesh(new THREE.BoxGeometry(.7, .16, .4), steel); h.position.set(x, 7.05, z); scene.add(h);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(.6, .32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .62, .3).multiplyScalar(12) }));
    lens.rotation.x = Math.PI / 2; lens.position.set(x, 6.96, z); scene.add(lens);
    const sh = new THREE.Mesh(shaftGeometry(7, .25, 3.4), shaftMat); sh.position.set(x, 6.95, z); scene.add(sh);
    lampHeads.push(new THREE.Vector3(x, 6.8, z));
  }
  // the bay lamp over your car casts shadows; the others are plain point lights
  const key = new THREE.SpotLight(0xffb26b, 320, 30, .75, .6, 1.6);
  key.position.set(2.5, 7, -3); key.target.position.set(0, 0, 0); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.0003; key.shadow.normalBias = .02;
  scene.add(key, key.target);
  for (const v of lampHeads.slice(2)) { const l = new THREE.PointLight(0xffa255, 90, 26, 1.6); l.position.copy(v); scene.add(l); }

  // ---------------- garage place: work-light bay beside the car
  const shop = new THREE.Group(); shop.position.set(-6.5, 0, 2.5); scene.add(shop);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, .55), new THREE.MeshPhysicalMaterial({ color: 0xa3141a, roughness: .35, clearcoat: .6 }));
  chest.position.set(0, .5, 0); chest.castShadow = true; shop.add(chest);
  for (let k = 0; k < 5; k++) { const dr = new THREE.Mesh(new THREE.BoxGeometry(1.1, .012, .02), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: .2 })); dr.position.set(0, .2 + k * .17, .285); shop.add(dr); }
  const tyreGeo = new THREE.TorusGeometry(.3, .11, 12, 28); tyreGeo.rotateX(Math.PI / 2);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .9 });
  for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(tyreGeo, tyreMat); t.position.set(1.4, .11 + k * .22, -.2); t.castShadow = true; shop.add(t); }
  // tripod work light aimed at the car
  const tri = new THREE.Group(); tri.position.set(-1.2, 0, 1.6); shop.add(tri);
  for (let k = 0; k < 3; k++) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, 1.9, 6), steel); const a = k / 3 * Math.PI * 2; leg.position.set(Math.cos(a) * .3, .9, Math.sin(a) * .3); leg.rotation.set(Math.sin(a) * .16, 0, -Math.cos(a) * .16); tri.add(leg); }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(.5, .32, .08), steel); panel.position.set(0, 1.9, 0); panel.lookAt(6.5, .8, -2.5); tri.add(panel);
  const panelLens = new THREE.Mesh(new THREE.PlaneGeometry(.44, .26), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .97, .9).multiplyScalar(3) }));
  panelLens.position.set(0, 0, .041); panel.add(panelLens);
  const work = new THREE.SpotLight(0xfff2e0, 0, 18, .55, .5, 1.5);
  work.position.set(-7.7, 1.95, 4.1); work.target.position.set(0, .5, 0); scene.add(work, work.target);

  // ---------------- other cars parked in the bays (period exotics)
  const parked = [];
  for (const [x, col, wh, st] of [[-13.2, 0xf0eee8, 'gold', 0xd81e1e], [6.6, 0x0d0d0f, 'gold', 0xd4a017], [9.9, 0x1aa6a0, 'silver', 0xffffff]]) {
    const c = makeCar({ color: col, wheels: wh, stripe: st, wing: R() > .5 });
    c.root.position.set(x, 0, -.6); c.root.rotation.y = R() * .06 - .03;
    c.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(c.root); parked.push(c);
  }

  // ---------------- skyline around the roof (we're 9 floors up: towers start below the deck)
  const items = [];
  for (let k = 0; k < 340; k++) {
    const a = R() * Math.PI * 2, r = 70 + Math.pow(R(), .8) * 700;
    const w = 18 + R() * 40, d = 18 + R() * 40, h = 20 + Math.pow(R(), 1.6) * 230;
    items.push([Math.cos(a) * r, Math.sin(a) * r, w, h, d, R() * 3]);
  }
  const city = towerMeshes(items, R); city.position.y = -30; scene.add(city);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -30; scene.add(ground);
  // the building we're on drops away beneath the parapet
  const bld = new THREE.Mesh(new THREE.BoxGeometry(80.6, 30, 60.6), new THREE.MeshStandardMaterial({ map: conc, color: 0x55524e, roughness: .95 }));
  bld.position.y = -15.02; scene.add(bld);
  // neon on neighbours
  const neon = [['HOTEL ORBIT', '#ff2e88', -60, 18, 70, .6], ['CLUB VEGA', '#29e0ff', 80, 12, 20, -1.2], ['RAMEN', '#ffcc33', -90, 6, -30, 1.4], ['24H', '#3cff9e', 40, 8, -80, 3.0]];
  for (const [t, c, x, y, z, ry] of neon) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: signTexture(t, c), toneMapped: false, color: new THREE.Color(1.8, 1.8, 1.8) }));
    m.position.set(x, y, z); m.lookAt(0, y, 0); m.rotation.y += 0; scene.add(m); void ry;
  }

  // ---------------- race place: circuit billboard on the next tower, facing the deck
  const [bc, bx] = canvas(1600, 900);
  const boardTex = new THREE.CanvasTexture(bc); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 8;
  const board = new THREE.Group(); board.position.set(10, 9, 58); board.lookAt(0, 6, 0); scene.add(board);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(24, 13.5), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }));
  board.add(face);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(25, 14.5, .6), steel); frame.position.z = -.35; board.add(frame);
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.6, 16, .6), steel); leg.position.set(s * 8, -14, -.6); board.add(leg); }
  const boardTower = new THREE.Mesh(new THREE.BoxGeometry(40, 60, 30), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: .7 }));
  boardTower.position.set(12, -36, 72); scene.add(boardTower);
  const boardGlow = new THREE.PointLight(0x9fd8ff, 300, 40, 1.4); boardGlow.position.set(8, 9, 50); scene.add(boardGlow);

  function drawBoard(S, best, ev) {
    const x = bx, W = 1600, H = 900, def = TRACKS[S.track];
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a0f1e'); g.addColorStop(1, '#05060c');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // retro sun grid
    x.strokeStyle = 'rgba(255,46,136,.18)'; x.lineWidth = 2;
    for (let k = 0; k < 14; k++) { const yy = 560 + k * k * 3.2; x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke(); }
    for (let k = -12; k <= 12; k++) { x.beginPath(); x.moveTo(W / 2 + k * 30, 560); x.lineTo(W / 2 + k * 160, H); x.stroke(); }
    const title = S.mode === 'time' ? 'TIME ATTACK' : ev ? ev.name : 'NIGHT RACE';
    x.font = `italic 900 ${title.length > 12 ? 86 : 120}px "Saira Condensed"`; x.textAlign = 'left'; x.fillStyle = '#fff';
    x.shadowColor = '#ff2e88'; x.shadowBlur = 30; x.fillText(title, 70, 160); x.shadowBlur = 0;
    x.font = '700 64px "Saira Condensed"'; x.fillStyle = '#29e0ff'; x.fillText(def.name, 74, 250);
    x.font = '600 38px Rajdhani'; x.fillStyle = '#c9d2e6';
    const words = def.blurb.split(' '); let line = '', ly = 320;
    for (const w of words) { if ((line + w).length > 36) { x.fillText(line, 74, ly); line = ''; ly += 46; } line += w + ' '; }
    x.fillText(line, 74, ly);
    x.font = '700 46px Michroma'; x.fillStyle = '#ffcc33';
    x.fillText(S.mode === 'time' ? `BEST  ${fmtTime(best)}` : `${S.laps} LAPS  ·  PURSE $${(ev ? ev.prize : 0).toLocaleString('en-US')}`, 74, 500);
    // circuit outline
    const c = new THREE.CatmullRomCurve3(def.pts.map(p => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
    const pts = c.getSpacedPoints(200);
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (const q of pts) { mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); mnz = Math.min(mnz, q.z); mxz = Math.max(mxz, q.z); }
    const bxx = [880, 90, 640, 640], sc = Math.min(bxx[2] / (mxx - mnx), bxx[3] / (mxz - mnz));
    const mx = q => bxx[0] + bxx[2] / 2 - (q.x - (mnx + mxx) / 2) * sc, mz = q => bxx[1] + bxx[3] / 2 - (q.z - (mnz + mxz) / 2) * sc;
    x.lineJoin = 'round';
    for (const [w, col, blur] of [[26, 'rgba(41,224,255,.25)', 30], [10, '#29e0ff', 18], [3, '#ffffff', 0]]) {
      x.strokeStyle = col; x.lineWidth = w; x.shadowColor = '#29e0ff'; x.shadowBlur = blur;
      x.beginPath(); pts.forEach((q, k) => k ? x.lineTo(mx(q), mz(q)) : x.moveTo(mx(q), mz(q))); x.closePath(); x.stroke();
    }
    x.shadowBlur = 0; x.fillStyle = '#ff2e88'; x.beginPath(); x.arc(mx(pts[0]), mz(pts[0]), 16, 0, 7); x.fill();
    x.font = '700 30px Michroma'; x.fillStyle = '#ff2e88'; x.fillText('START', mx(pts[0]) + 26, mz(pts[0]) + 10);
    x.font = '600 30px Michroma'; x.fillStyle = 'rgba(255,255,255,.35)'; x.fillText(`TRACK ${S.track + 1} / ${TRACKS.length}`, 74, 840);
    boardTex.needsUpdate = true;
  }

  let t = 0;
  return {
    scene, board, boardFace: face, drawBoard, parked,
    carSpot: { pos: new THREE.Vector3(0, Y, 0), yaw: 0 },
    // world-space camera shots for the places
    shots: {
      garage: (tt, carPos) => {
        const a = .8 + Math.sin(tt * .12) * .45;
        return { pos: carPos.clone().add(new THREE.Vector3(Math.cos(a) * 6.4, 1.35, Math.sin(a) * 6.4)), look: carPos.clone().add(new THREE.Vector3(-.4, .55, 0)), fov: 42 };
      },
      board: (tt, carPos) => ({ pos: carPos.clone().add(new THREE.Vector3(-2.4 + Math.sin(tt * .2) * .2, 2.6, -6.8)), look: board.position.clone().add(new THREE.Vector3(0, -1.5, 0)), fov: 46 }),
    },
    setWorkLight(on) { work.intensity = on ? 90 : 0; },
    update(dt) {
      t += dt;
      // a tired sodium lamp that flickers now and then
      shaftMat.uniforms.uStrength.value = .11 * (Math.sin(t * 37) > .985 ? .4 : 1);
    },
  };
}
