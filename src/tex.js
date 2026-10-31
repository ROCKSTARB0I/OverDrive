// Procedural textures, all painted at load on 2D canvases.
import * as THREE from 'three';

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// speckle noise into an ImageData, value fn gets (x,y) -> 0..255
function fillNoise(ctx, w, h, fn) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    fn(x, y, d, i);
  }
  ctx.putImageData(img, 0, 0);
}

// Road surface: asphalt aggregate + painted lines. u = across (0..1 covers the shoulder-to-shoulder width), v = 24 m along.
export function roadTextures(halfW, shoulder) {
  const W = 1024, H = 1024, R = rng(91);
  const [c, x] = canvas(W, H);
  const [rc, rx] = canvas(W, H);
  const total = (halfW + shoulder) * 2;
  const toPx = m => (m + halfW + shoulder) / total * W;
  // base asphalt with tyre-polished racing lanes
  fillNoise(x, W, H, (px, py, d, i) => {
    const r = R();
    let v = 26 + r * 22 + (R() < .03 ? 40 : 0);
    const lat = px / W * total - (halfW + shoulder);
    const wear = Math.exp(-Math.pow((Math.abs(lat) - 1.8) / 1.4, 2)) * 6;
    v -= wear;
    d[i] = v * .95; d[i + 1] = v * .97; d[i + 2] = v * 1.05; d[i + 3] = 255;
  });
  fillNoise(rx, W, H, (px, py, d, i) => {
    const lat = px / W * total - (halfW + shoulder);
    const wear = Math.exp(-Math.pow((Math.abs(lat) - 1.8) / 1.6, 2));
    const v = 120 + R() * 60 - wear * 50;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  });
  // standing water: glossy puddles that pick up the city reflections (darker albedo too)
  for (let k = 0; k < 26; k++) {
    const px = R() * W, py = R() * H, r = 20 + R() * 70;
    const sx = 1 + R() * 1.5;
    for (const [ctx, col] of [[rx, 'rgba(18,18,18,'], [x, 'rgba(6,7,10,']]) {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, col + (ctx === rx ? '.95)' : '.5)')); g.addColorStop(.7, col + (ctx === rx ? '.7)' : '.3)')); g.addColorStop(1, col + '0)');
      ctx.save(); ctx.translate(px, py); ctx.scale(sx, 1); ctx.translate(-px, -py);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill(); ctx.restore();
    }
  }
  // cracks + patch tar seams
  x.strokeStyle = 'rgba(8,8,10,.6)'; rx.strokeStyle = 'rgba(70,70,70,1)';
  for (let k = 0; k < 40; k++) {
    let px = R() * W, py = R() * H;
    x.lineWidth = rx.lineWidth = 1 + R() * 2;
    x.beginPath(); rx.beginPath(); x.moveTo(px, py); rx.moveTo(px, py);
    for (let s = 0; s < 8; s++) { px += (R() - .5) * 40; py += (R() - .3) * 40; x.lineTo(px, py); rx.lineTo(px, py); }
    x.stroke(); rx.stroke();
  }
  // shoulders darker
  x.fillStyle = 'rgba(0,0,0,.35)';
  x.fillRect(0, 0, toPx(-halfW), H); x.fillRect(toPx(halfW), 0, W - toPx(halfW), H);
  // paint: worn edges
  const paint = (x0, x1, y0, y1, col) => {
    x.fillStyle = col; x.fillRect(x0, y0, x1 - x0, y1 - y0);
    rx.fillStyle = '#5a5a5a'; rx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // wear specks
    x.fillStyle = 'rgba(40,40,44,.55)';
    for (let k = 0; k < (x1 - x0) * (y1 - y0) / 40; k++) x.fillRect(x0 + R() * (x1 - x0), y0 + R() * (y1 - y0), 1 + R() * 2, 1 + R() * 2);
  };
  const lw = .18 / total * W;
  paint(toPx(-halfW + .25), toPx(-halfW + .25) + lw, 0, H, '#d9d4c4');
  paint(toPx(halfW - .25) - lw, toPx(halfW - .25), 0, H, '#d9d4c4');
  // lane dashes: 3 m dash, 9 m gap -> two per 24 m tile
  for (const lane of [-halfW / 2, 0, halfW / 2]) {
    const col = lane === 0 ? '#e8c45a' : '#d9d4c4';
    for (const off of [0, .5]) paint(toPx(lane) - lw / 2, toPx(lane) + lw / 2, off * H, (off + 3 / 24) * H, col);
  }
  return { map: tex(c), rough: tex(rc, { srgb: false }) };
}

export function concreteTexture(seed = 5) {
  const W = 512, H = 256, R = rng(seed);
  const [c, x] = canvas(W, H);
  fillNoise(x, W, H, (px, py, d, i) => {
    const v = 120 + R() * 30 - (py / H) * 30;
    d[i] = v; d[i + 1] = v * .98; d[i + 2] = v * .95; d[i + 3] = 255;
  });
  // grime streaks + tyre rubber marks at the base
  for (let k = 0; k < 60; k++) {
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(20,18,16,${.1 + R() * .25})`);
    x.fillStyle = g; x.fillRect(R() * W, 0, 2 + R() * 10, H);
  }
  x.fillStyle = 'rgba(15,15,15,.55)'; x.fillRect(0, H * .82, W, H * .18);
  // panel joints every quarter
  x.fillStyle = 'rgba(0,0,0,.6)';
  for (let k = 0; k < 4; k++) x.fillRect(k * W / 4, 0, 2, H);
  return tex(c);
}

export function curbTexture() {
  const [c, x] = canvas(64, 256);
  for (let k = 0; k < 4; k++) { x.fillStyle = k % 2 ? '#e8e6e0' : '#c8161c'; x.fillRect(0, k * 64, 64, 64); }
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 0, 8, 256);
  return tex(c);
}

// carbon fibre twill weave
export function carbonTexture() {
  const W = 256, [c, x] = canvas(W, W), n = 16, s = W / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const horiz = ((i + j) >> 1) % 2 === 0;
    const g = horiz ? x.createLinearGradient(0, j * s, 0, j * s + s) : x.createLinearGradient(i * s, 0, i * s + s, 0);
    g.addColorStop(0, '#0b0c0e'); g.addColorStop(.5, horiz ? '#2c2f35' : '#1c1e22'); g.addColorStop(1, '#0b0c0e');
    x.fillStyle = g; x.fillRect(i * s, j * s, s, s);
  }
  return tex(c);
}

// leather / alcantara grain (used as roughness+bump-ish map)
export function grainTexture(seed = 3, scale = 1) {
  const W = 256, R = rng(seed), [c, x] = canvas(W, W);
  fillNoise(x, W, W, (px, py, d, i) => { const v = 150 + R() * 80 * scale; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; });
  x.globalAlpha = .25;
  for (let k = 0; k < 900; k++) { x.fillStyle = R() < .5 ? '#000' : '#fff'; x.beginPath(); x.arc(R() * W, R() * W, .5 + R() * 1.6, 0, 7); x.fill(); }
  return tex(c, { srgb: false });
}

// soft round glow sprite
export function glowTexture(stops = [[0, 'rgba(255,255,255,1)'], [.25, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']]) {
  const [c, x] = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return tex(c, { repeat: false });
}

// smoke puff with soft noisy edge
export function smokeTexture() {
  const W = 128, R = rng(77), [c, x] = canvas(W, W);
  for (let k = 0; k < 26; k++) {
    const r = 18 + R() * 26, px = 64 + (R() - .5) * 40, py = 64 + (R() - .5) * 40;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, W);
  }
  return tex(c, { repeat: false });
}

// neon sign text
export function signTexture(text, color, { font = '900 italic 120px "Saira Condensed"', w = 1024, h = 256, frame = true } = {}) {
  const [c, x] = canvas(w, h);
  x.fillStyle = '#050507'; x.fillRect(0, 0, w, h);
  x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = color; x.shadowBlur = 30; x.fillStyle = color;
  x.fillText(text, w / 2, h / 2 + 6);
  x.shadowBlur = 8; x.fillStyle = '#fff'; x.globalAlpha = .55; x.fillText(text, w / 2, h / 2 + 6); x.globalAlpha = 1;
  if (frame) { x.strokeStyle = color; x.lineWidth = 6; x.shadowBlur = 20; x.strokeRect(14, 14, w - 28, h - 28); }
  return tex(c, { repeat: false });
}

// checkered start line
export function checkerTexture() {
  const [c, x] = canvas(256, 64), s = 16;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 16; i++) { x.fillStyle = (i + j) % 2 ? '#111' : '#eee'; x.fillRect(i * s, j * s, s, s); }
  return tex(c);
}

export function tireTexture() {
  // sidewall lettering + tread blocks wrapped round the tyre (u around, v across)
  const W = 1024, H = 128, [c, x] = canvas(W, H);
  x.fillStyle = '#141414'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#0b0b0b';
  for (let i = 0; i < 64; i++) { x.fillRect(i * 16, 40, 9, 48); }
  x.fillStyle = '#2a2a2a'; x.font = '700 18px Michroma, sans-serif';
  for (let k = 0; k < 2; k++) { x.fillText('OVERDRIVE  CORSA  R', 60 + k * 512, 24); x.fillText('305/30 ZR20', 300 + k * 512, 118); }
  return tex(c);
}

// tangent-space normal map from a greyscale height canvas (Sobel)
export function normalFromHeight(src, strength = 2) {
  const w = src.width, h = src.height;
  const sc = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, x] = canvas(w, h), out = x.createImageData(w, h), d = out.data;
  const H = (i, j) => sc[(((j + h) % h) * w + ((i + w) % w)) * 4] / 255;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = (H(i + 1, j - 1) + 2 * H(i + 1, j) + H(i + 1, j + 1)) - (H(i - 1, j - 1) + 2 * H(i - 1, j) + H(i - 1, j + 1));
    const dy = (H(i - 1, j + 1) + 2 * H(i, j + 1) + H(i + 1, j + 1)) - (H(i - 1, j - 1) + 2 * H(i, j - 1) + H(i + 1, j - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (j * w + i) * 4; d[k] = (nx * .5 + .5) * 255; d[k + 1] = (ny * .5 + .5) * 255; d[k + 2] = (nz * .5 + .5) * 255; d[k + 3] = 255;
  }
  x.putImageData(out, 0, 0);
  return tex(c, { srgb: false });
}
