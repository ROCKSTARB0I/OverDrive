// Shared city pieces: procedural tower facades (curtain wall / punched concrete / brick), setback massing, rooftop clutter,
// and soft light shafts under lamps.
import * as THREE from 'three';

// Facade material: windows, mullions, spandrels, storefronts and crown lights are generated in the shader from the
// box's own scaled local coordinates, so any size/rotation keeps real-world proportions. Style is picked per instance.
export function towerMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: .6, metalness: .3, envMapIntensity: .8 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP; varying vec3 vLN; varying float vSeed; varying vec3 vSize;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 sz = vec3(1.);
        #ifdef USE_INSTANCING
          sz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.99, 78.23))) * 43758.55);
        #else
          vSeed = .5;
        #endif
        vSize = sz; vLP = position * sz; vLN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLP; varying vec3 vLN; varying float vSeed; varying vec3 vSize;
        float hh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float style = floor(vSeed * 3.);                 // 0 glass curtain wall, 1 punched concrete, 2 brick
        vec3 an = abs(vLN);
        float side = step(an.y, .5);
        float u = an.x > an.z ? vLP.z : vLP.x;
        float y = vLP.y;
        float bayW = style == 0. ? 1.5 : (style == 1. ? 2.4 : 2.0);
        float floorH = style == 0. ? 3.6 : 3.3;
        vec2 cell = vec2(u / bayW, y / floorH);
        vec2 id = floor(cell), f = fract(cell);
        float wx = style == 0. ? .94 : (style == 1. ? .55 : .5);
        float wy = style == 0. ? .72 : .52;
        float win = smoothstep(.5 - wx * .5 - .01, .5 - wx * .5, f.x) * (1. - smoothstep(.5 + wx * .5, .5 + wx * .5 + .01, f.x))
                  * smoothstep(.18, .19, f.y) * (1. - smoothstep(.18 + wy, .18 + wy + .01, f.y));
        win *= side * step(4.5, y) * step(y, vSize.y - 1.2);
        vec3 base = style == 0. ? vec3(.05, .07, .1) : (style == 1. ? vec3(.24, .23, .22) : vec3(.22, .11, .08));
        base *= .8 + .4 * hh(vec2(vSeed, 3.));
        // spandrel bands
        base *= mix(1., .7, step(f.y, .16) * side);
        diffuseColor.rgb = mix(base, vec3(.015, .02, .03), win);
        // roof
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.08), 1. - side);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .06, win);
        roughnessFactor = mix(roughnessFactor, style == 0. ? .18 : .85, (1. - win) * side);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float r = hh(id + vSeed * 17.);
          float floorOn = step(.35, hh(vec2(id.y, vSeed * 9.)));         // whole floors dark at night
          float lit = step(.62, r) * floorOn + step(.97, r);
          // interior: brighter ceiling band, occasional blinds
          float ceil = mix(.55, 1.2, smoothstep(.2, .85, f.y));
          float blinds = mix(1., .55 + .45 * step(.5, fract(f.y * 9.)), step(.8, hh(id * 3.1)));
          float tint = hh(id * 1.7 + vSeed);
          vec3 wc = tint > .7 ? vec3(.75, .85, 1.) : (tint > .15 ? vec3(1., .74, .45) : vec3(.5, .6, 1.));
          totalEmissiveRadiance += win * lit * wc * ceil * blinds * .75;
          // storefronts at street level
          float shop = side * step(y, 4.) * step(.6, y) * step(.4, hh(vec2(id.x, vSeed))) * smoothstep(.05, .1, fract(u / 6.)) * (1. - smoothstep(.9, .95, fract(u / 6.)));
          vec3 sc = hh(vec2(floor(u / 6.), vSeed)) > .5 ? vec3(1., .55, .25) : vec3(.4, .9, 1.);
          totalEmissiveRadiance += shop * sc * .9;
          // crown light band on some towers
          float crown = side * step(.75, vSeed) * smoothstep(vSize.y - 2.2, vSize.y - 1.9, y) * (1. - smoothstep(vSize.y - .9, vSize.y - .6, y));
          totalEmissiveRadiance += crown * mix(vec3(1., .3, .5), vec3(.3, .9, 1.), step(.88, vSeed)) * 2.5;
        }`);
  };
  return m;
}

// Fill an InstancedMesh list of towers with setbacks + roof boxes. items: [x, z, w, h, d, rotY]
export function towerMeshes(items, seedFn) {
  const R = seedFn;
  const boxes = [], roofs = [];
  for (const [x, z, w, h, d, ry] of items) {
    boxes.push([x, 0, z, w, h, d, ry]);
    let yy = h, ww = w, dd = d;
    // setbacks on tall buildings
    const tiers = h > 60 ? 1 + Math.floor(R() * 2.2) : 0;
    for (let t = 0; t < tiers; t++) {
      ww *= .62 + R() * .2; dd *= .62 + R() * .2;
      const th = 8 + R() * h * .35;
      boxes.push([x, yy, z, ww, th, dd, ry]); yy += th;
    }
    // rooftop plant
    const n = 1 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) roofs.push([x + (R() - .5) * ww * .5, yy, z + (R() - .5) * dd * .5, 2 + R() * 5, 1.5 + R() * 3, 2 + R() * 5, ry]);
  }
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, .5, 0);
  const im = new THREE.InstancedMesh(geo, towerMaterial(), boxes.length);
  const o = new THREE.Object3D();
  boxes.forEach(([x, y, z, w, h, d, ry], k) => { o.position.set(x, y, z); o.rotation.set(0, ry, 0); o.scale.set(w, h, d); o.updateMatrix(); im.setMatrixAt(k, o.matrix); });
  im.receiveShadow = true;
  const rm = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: .8, metalness: .4 }), roofs.length);
  roofs.forEach(([x, y, z, w, h, d, ry], k) => { o.position.set(x, y, z); o.rotation.set(0, ry, 0); o.scale.set(w, h, d); o.updateMatrix(); rm.setMatrixAt(k, o.matrix); });
  // aviation beacons on the tallest
  const bpos = [];
  boxes.forEach(([x, y, z, w, h]) => { if (y + h > 110) bpos.push(new THREE.Vector3(x, y + h + 1, z)); });
  const beacons = new THREE.Points(new THREE.BufferGeometry().setFromPoints(bpos), new THREE.PointsMaterial({ color: 0xff2a1a, size: 3, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const g = new THREE.Group(); g.add(im, rm, beacons);
  return g;
}

// Soft light shaft: an open cone, brightest at the lamp, fading toward the ground and at grazing edges.
let SHAFT_MAT = null;
export function shaftMaterial(color = 0xffa860, strength = .09) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: `varying float vH; varying vec3 vN; varying vec3 vV;
      void main(){ vH = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.);
        #ifdef USE_INSTANCING
          mv = modelViewMatrix * instanceMatrix * vec4(position, 1.);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        #else
          vN = normalize(normalMatrix * normal);
        #endif
        vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vH; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float a = pow(vH, 1.6) * edge * uStrength;
        gl_FragColor = vec4(uColor * a, a); }`,
  });
}
export function shaftGeometry(h = 8.6, r0 = .25, r1 = 4.2) {
  const g = new THREE.CylinderGeometry(r0, r1, h, 32, 1, true);
  g.translate(0, -h / 2, 0);   // apex at the origin, opening downward
  return g;
}
void SHAFT_MAT;
