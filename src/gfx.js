// Renderer, environment lighting and the post chain (bloom, speed blur, grade, grain).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },      // 0..1 radial blur + aberration
    uRewind: { value: 0 },     // 0..1 cyan tape look
    uVig: { value: .9 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uSpeed, uRewind, uVig; uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - .5;
      float r = length(c);
      // radial speed blur, stronger at the edges
      float amt = uSpeed * .045 * smoothstep(.12, .7, r);
      vec3 col = vec3(0.);
      for (int i = 0; i < 10; i++) {
        float k = float(i) / 9.;
        vec2 uv = .5 + c * (1. - amt * k);
        col += texture2D(tDiffuse, uv).rgb;
      }
      col /= 10.;
      // chromatic fringe at the edges
      float ca = (.0015 + uSpeed * .006) * r;
      col.r = mix(col.r, texture2D(tDiffuse, .5 + c * (1. + ca)).r, .6);
      col.b = mix(col.b, texture2D(tDiffuse, .5 + c * (1. - ca)).b, .6);
      // rewind: desaturate, tint, tracking lines
      if (uRewind > 0.) {
        float l = dot(col, vec3(.3,.59,.11));
        vec3 t = vec3(l*.6, l*.95, l*1.25);
        float line = step(.985, fract(vUv.y * 3. - uTime * 1.7));
        col = mix(col, t + line * .15, uRewind);
      }
      // night grade: cool teal shadows, warm sodium highlights, a touch more saturation
      float lum = dot(col, vec3(.2126,.7152,.0722));
      col = mix(vec3(lum), col, 1.12);
      col += vec3(-.006, .004, .016) * (1. - smoothstep(0., .35, lum));
      col *= mix(vec3(.96, .99, 1.06), vec3(1.05, 1., .93), smoothstep(.2, .9, lum));
      col = pow(max(col, 0.), vec3(1.06));
      // vignette + grain + gentle filmic lift
      col *= mix(1., 1. - smoothstep(.25, .95, r), uVig);
      col += (h(vUv * uRes + uTime) - .5) * .035;
      col = max(col, vec3(.004));
      gl_FragColor = vec4(col, 1.);
    }`,
};

// Graphics quality. AUTO picks a level from the GPU's name; on every level the render resolution then slides
// between scale[0] and scale[1] to hold the frame rate (dynamic resolution).
export const QUALITY = {
  high: { scale: [.7, 1], maxDpr: 1.75, samples: 4, shadows: 'soft', shadowSize: 2048, bloom: 1, lamps: 6, extra: true },
  medium: { scale: [.6, 1], maxDpr: 1.25, samples: 2, shadows: 'hard', shadowSize: 1024, bloom: .5, lamps: 3, extra: true },
  low: { scale: [.5, .8], maxDpr: 1, samples: 0, shadows: 'off', shadowSize: 1024, bloom: .5, lamps: 2, extra: false },
};
export function gpuName(renderer) {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}
export function autoQuality(name) {
  if (/SwiftShader|llvmpipe|Basic Render/i.test(name)) return 'low';
  if (/Intel/i.test(name) && !/Arc/i.test(name)) return /Iris\(R\) Xe|Iris Xe/i.test(name) ? 'medium' : 'low';   // HD / UHD / older Iris = low
  if (/Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+|Radeon R\d/i.test(name)) return 'medium';                  // AMD integrated
  if (/GeForce (\d{3}M\b|MX ?\d{3}|GT \d{3})/i.test(name)) return 'medium';                                          // older mobile / entry NVIDIA
  return 'high';
}

export function createGfx(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .05, 4000);

  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // guard: clamp HDR and scrub NaN/Inf before bloom, or one bad pixel blurs into black squares
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b) || c.r > 6e4 || c.g > 6e4 || c.b > 6e4) c = vec4(0.);
      gl_FragColor = vec4(clamp(c.rgb, 0., 40.), 1.); }`,
  }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .75, .55, .82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const final = new ShaderPass(FinalShader);
  composer.addPass(final);

  // bloom can run at a fraction of the screen resolution (it's a blur, so it barely shows)
  const bloomSetSize = bloom.setSize.bind(bloom);
  let q = QUALITY.high, scale = 1, slow = 0, quick = 0, ema = 1 / 60, nextCheck = 0;
  bloom.setSize = (w, h) => bloomSetSize(Math.max(1, Math.round(w * q.bloom)), Math.max(1, Math.round(h * q.bloom)));
  const pixelRatio = () => Math.min(devicePixelRatio, q.maxDpr) * scale;

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(pixelRatio());
    composer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    final.uniforms.uRes.value.set(w, h);
  }
  addEventListener('resize', resize);
  resize();

  // switch quality level; scenes = every scene, so lights and materials can follow
  function setQuality(name, scenes = []) {
    q = QUALITY[name] || QUALITY.high;
    scale = q.scale[1];
    const shadowsOn = q.shadows !== 'off', type = q.shadows === 'soft' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const changed = renderer.shadowMap.enabled !== shadowsOn || renderer.shadowMap.type !== type;
    renderer.shadowMap.enabled = shadowsOn; renderer.shadowMap.type = type;
    for (const t of [composer.renderTarget1, composer.renderTarget2]) if (t.samples !== q.samples) { t.samples = q.samples; t.dispose(); }
    for (const sc of scenes) sc && sc.traverse(o => {
      if (o.isLight && o.userData.extra) o.visible = q.extra;
      if (o.isLight && o.shadow && o.castShadow && o.shadow.mapSize.x !== q.shadowSize) {
        o.shadow.mapSize.set(q.shadowSize, q.shadowSize); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
      }
      if (changed && o.material) for (const m of [].concat(o.material)) m.needsUpdate = true;   // rebuild shaders for the new shadow mode
    });
    resize();
  }
  // dynamic resolution: drop the render scale when frames take too long, creep back up when there's room
  function perf(dt, now) {
    if (dt <= 0 || dt > .1) return;                   // hidden tab or a hitch: ignore
    ema += (dt - ema) * .08;
    if (now < nextCheck) return;
    nextCheck = now + 1;
    if (ema > 1 / 45) { slow++; quick = 0; } else if (ema < 1 / 57) { quick++; slow = 0; } else { slow = quick = 0; }
    const was = scale;
    if (slow >= 2) { scale = Math.max(q.scale[0], scale - .1); slow = 0; }
    else if (quick >= 4) { scale = Math.min(q.scale[1], scale + .05); quick = 0; }
    if (scale !== was) resize();
  }
  const stats = () => ({ fps: Math.round(1 / ema), scale, px: [Math.round(innerWidth * pixelRatio()), Math.round(innerHeight * pixelRatio())] });

  return { renderer, scene, camera, composer, bloom, final, resize, setQuality, perf, stats };
}

// Night-city environment map: gradient sky plus strips of sodium, neon and white light so paint and glass have something to reflect.
export function nightEnvironment(renderer) {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {},
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vP; void main(){
      float y = vP.y;
      vec3 top = vec3(.010,.014,.035), hor = vec3(.16,.07,.09), gnd = vec3(.012,.012,.014);
      vec3 c = y > 0. ? mix(hor, top, pow(clamp(y,0.,1.), .45)) : mix(hor*.5, gnd, clamp(-y*4.,0.,1.));
      gl_FragColor = vec4(c, 1.);
    }`,
  }));
  env.add(sky);
  const strip = (color, intensity, x, y, z, w, h, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, y, 0); m.rotateZ(ry);
    env.add(m);
  };
  // overhead street lamps (warm), neon (pink/cyan), cool billboard panels
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    strip(0xffa45a, 6, Math.cos(a) * 30, 22, Math.sin(a) * 30, 6, 1.2);
  }
  strip(0xff2e88, 4, -40, 6, 10, 14, 3);
  strip(0x29e0ff, 4, 38, 8, -14, 16, 2.5);
  strip(0xdfe8ff, 3, 10, 12, 40, 22, 6);
  strip(0xffcf8a, 2.5, -12, 4, -42, 30, 3);
  // a few long thin overhead strips (sodium + cool) rather than one big panel, so flat decks don't mirror a white sheet
  for (let k = -2; k <= 2; k++) strip(k % 2 ? 0xffb070 : 0x9fb6ff, .9, k * 9, 40, 6, 1.2, 50);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, .03).texture;
  pm.dispose();
  return tex;
}

// Sky dome: stars, a moon and a warm city glow on the horizon.
export function skyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uMoon: { value: new THREE.Vector3(-.45, .38, -.8).normalize() } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uMoon; varying vec3 vD;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){
        float y = vD.y;
        vec3 top = vec3(.004,.006,.018), mid = vec3(.03,.03,.07), glow = vec3(.36,.15,.12);
        vec3 c = mix(mid, top, smoothstep(0., .7, y));
        c += glow * exp(-max(y,0.) * 9.) * .9;
        c = y < 0. ? glow * .25 : c;
        // stars
        vec3 q = floor(vD * 420.);
        float s = h(q);
        c += step(.9975, s) * smoothstep(.05, .4, y) * (.6 + h(q+1.)*1.4) * vec3(.9,.95,1.);
        // moon + halo
        float m = dot(vD, uMoon);
        c += vec3(1.,.96,.88) * smoothstep(.99965, .99985, m) * 3.;
        c += vec3(.25,.27,.35) * pow(max(m,0.), 280.) * .9;
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}
