// OVERDRIVE: boot -> REDLINE studio intro -> title card -> rooftop menu (cabin + places) -> drive (radio fades, new area)
// -> race -> results -> back to the roof. Cameras, input and the frame loop live here.
import * as THREE from 'three';
import { createGfx, nightEnvironment, skyDome, gpuName, autoQuality, QUALITY } from './gfx.js';
import { TRACKS, buildTrack, pointAt } from './track.js';
import { buildWorld, buildLights } from './world.js';
import { makeCar } from './carmodel.js';
import { buildCockpit, EYE } from './cockpit.js';
import { Vehicle } from './vehicle.js';
import { Sound, audioCtx } from './audio.js';
import { Radio } from './radio.js';
import { Menu, loadSettings, saveSettings, loadBest, PAINTS, WHEEL_FINISHES, STRIPES, fmtTime } from './menu.js';
import { Hud } from './hud.js';
import { Fx } from './fx.js';
import { Race } from './race.js';
import { buildHub } from './hub.js';
import { Intro } from './intro.js';
import { showTerms, termsAccepted } from './terms.js';
import { Online, nameLabel } from './online.js';
import { Career, CARS, UPGRADES, EVENTS, PRICES, money, carById } from './career.js';

const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const gateBar = $('gateload').firstElementChild;
const step = async pct => { gateBar.style.width = pct + '%'; await wait(0); };

const gfx = createGfx($('stage'));
const { renderer, camera, composer, final } = gfx;
const renderPass = composer.passes[0];
const settings = loadSettings();
const sound = new Sound();
sound.settings.sfx = settings.sfx; sound.settings.music = settings.music;
const radio = new Radio(sound);
const hud = new Hud();
const intro = new Intro();
const career = new Career();
// look of a car as plain data (sent to other players so they can build your car)
const lookData = () => { const m = career.mine; return { body: career.car.body, paint: m.paint, wheels: m.wheels, stripe: m.stripe }; };
const lookFrom = d => ({ body: d && d.body || 'coupe', color: PAINTS[(d && d.paint) || 0][1], wheels: WHEEL_FINISHES[(d && d.wheels) || 0], stripe: STRIPES[(d && d.stripe) || 0][1], headlights: false });
// the Ruff Dogs plate is the developer account's alone (the role comes from the server, not the save)
const plateFor = role => role === 'dev' ? 'ruffdogs' : null;
const online = new Online({ career, sound, carLook: lookData, onRaceStart: m => driveOnline(m), onResults: () => { },
  onProfile: () => { if (playerCar) playerCar.setPlate(plateFor(online.profile && online.profile.role)); } });
const carLook = () => { const m = career.mine; return { body: career.car.body, color: PAINTS[m.paint][1], wheels: WHEEL_FINISHES[m.wheels], stripe: STRIPES[m.stripe][1], headlights: true, plate: plateFor(online.profile && online.profile.role) }; };

const G = window.__od = { state: 'boot', settings, camera, sound, radio, gfx, career };

let env, hub, raceScene, track, world, lights, fx, player, playerCar, cockpit, menu, race = null;
let camMode = settings.camera;
const CAM_NAMES = ['CHASE', 'FAR CHASE', 'BONNET', 'COCKPIT'];
let engineRunning = false, clusterSweep = 0, idleRpm = 0, rev = 0;
let place = 'cabin', camFly = null, placeT = 0;

function useScene(sc) { renderPass.scene = sc; G.scene = sc; }

// --------------------------------------------------------------- boot
async function boot() {
  await step(4);
  env = nightEnvironment(renderer);
  hub = buildHub(env);
  await step(20);
  raceScene = new THREE.Scene();
  raceScene.environment = env;
  raceScene.add(skyDome());
  raceScene.fog = new THREE.FogExp2(0x0a0c16, .0024);
  fx = new Fx(raceScene);
  fx.setFog(raceScene.fog);
  await loadTrack(settings.track);
  await step(60);
  playerCar = makeCar(carLook());
  player = new Vehicle(track);
  cockpit = buildCockpit();
  playerCar.chassis.add(cockpit.group);
  menu = new Menu({ cockpit, settings, radio, sound, renderer, envMap: env, onStart: () => drive() });
  menu.onLook = () => rebuildPlayerLook();
  menu.onButton = id => onConsoleButton(id);
  G.cockpit = cockpit; G.menu = menu; G.hub = hub;
  menu.onQuality = () => applyQuality();
  applyQuality();
  await step(72);
  await radio.load();
  await step(80);
  await intro.prepare();
  await step(92);
  parkInHub();
  useScene(hub.scene);
  renderer.compile(hub.scene, camera);
  renderer.compile(raceScene, camera);
  await step(100);
  // no "press a key": the show starts by itself. Audio unlocks on the first interaction if the browser held it back.
  window.__unlockAudio = () => {
    sound.resume();
    if (radio.el && radio.index >= 0 && radio.el.paused) radio.tune(radio.index, { quiet: true });
  };
  const unlock = () => { window.__unlockAudio(); removeEventListener('pointerdown', unlock, true); removeEventListener('keydown', unlock, true); };
  addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true);
  startShow();
}

async function startShow() {
  G.state = 'intro';
  sound.init(); sound.resume(); sound.setVolumes(settings.sfx, settings.music);
  $('gate').classList.add('gone');
  await intro.play();
  if (G.skipped) return;                   // a dev skip already took us to the roof
  // title card: Ruff Dogs Studios presents OVERDRIVE; the radio comes up underneath
  G.state = 'title';
  radio.ensureGraph();
  radio.fade(0, 0); radio.randomStation(); setTimeout(() => radio.fade(1, 3.5), 600);
  sound.cityAmbience(true);
  const sp = $('splash'); sp.classList.remove('hidden');
  await wait(50); sp.classList.add('show');
  await Promise.race([wait(4600), new Promise(r => { const k = () => { removeEventListener('keydown', k); removeEventListener('pointerdown', k); r(); }; setTimeout(() => { addEventListener('keydown', k); addEventListener('pointerdown', k); }, 600); })]);
  sp.classList.add('gone');
  enterMenu();
  // first visit (or new version): the agreement just appears over the menu
  if (!termsAccepted()) { menu.enabled = false; await showTerms({ click: () => sound.click(.4, 3000) }); menu.enabled = true; }
  setTimeout(() => sp.classList.add('hidden'), 1100);
}

async function loadTrack(i) {
  if (world) raceScene.remove(world);
  if (track) raceScene.remove(track.group);
  track = buildTrack(TRACKS[i], env);
  raceScene.add(track.group);
  world = buildWorld(raceScene, track);
  if (!lights) { lights = buildLights(raceScene, track); if (G.quality) lights.setQuality(QUALITY[G.quality.name]); }
  if (player) player.track = track;
  G.track = track;
}

// graphics quality: AUTO picks from the GPU (an old Intel laptop gets LOW), or the player's choice in SETUP
function applyQuality() {
  const gpu = gpuName(renderer), auto = autoQuality(gpu);
  const name = QUALITY[settings.quality] ? settings.quality : auto;
  gfx.setQuality(name, [raceScene, hub.scene, menu.gScene, cockpit.group]);
  if (lights) lights.setQuality(QUALITY[name]);
  G.quality = { name, auto, gpu };
  menu.gfxAuto = auto;
  saveSettings(settings);
}
// F3: frame rate, render resolution and GPU, so slow PCs can be diagnosed
const fpsEl = document.createElement('div');
fpsEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;font:12px/1.4 monospace;color:#7dffb0;background:rgba(0,0,0,.6);padding:6px 8px;pointer-events:none;display:none;white-space:pre';
document.body.appendChild(fpsEl);
addEventListener('keydown', e => { if (e.code === 'F3') { e.preventDefault(); fpsEl.style.display = fpsEl.style.display === 'none' ? 'block' : 'none'; } });

function rebuildPlayerLook() {
  const old = playerCar;
  playerCar = makeCar(carLook());
  old.chassis.remove(cockpit.group);
  playerCar.chassis.add(cockpit.group);
  playerCar.root.position.copy(old.root.position); playerCar.root.quaternion.copy(old.root.quaternion);
  const parent = old.root.parent; parent.remove(old.root); parent.add(playerCar.root);
  if (engineRunning) playerCar.setHeadlights(true);
}

// --------------------------------------------------------------- the roof (menu hub)
function parkInHub() {
  hub.scene.add(playerCar.root);
  playerCar.root.position.copy(hub.carSpot.pos);
  playerCar.root.quaternion.identity();
  playerCar.chassis.rotation.set(0, 0, 0); playerCar.chassis.position.set(0, 0, 0);
  playerCar.wheels.forEach((w, i) => { w.spin.rotation.x = 0; if (i < 2) w.hub.rotation.y = 0; });
  playerCar.setBrake(0);
}

// cloud save arrived after sign-in: show that car and cash
online.onCareerLoaded = () => { if (playerCar && cockpit) rebuildPlayerLook(); if (typeof updateCash === 'function') updateCash(); };

function enterMenu() {
  online.status(online.lobby ? 'lobby' : 'menu');
  if (race) { race.dispose(); race = null; }
  parkInHub();
  useScene(hub.scene);
  playerCar.setHeadlights(false);
  cockpit.key.target = 0; cockpit.group.visible = true;
  engineRunning = false; clusterSweep = 0;
  sound.engineOff(); sound.silenceCar(); sound.cityAmbience(true);
  radio.setSpeaker('cabin');
  hud.show(false);
  $('menuui').classList.remove('hidden');
  menu.enabled = true; menu.starting = false; menu.page = 'home'; menu.draw();
  place = 'cabin'; camFly = null;
  refreshBoard();
  setShot(shotFor('cabin'));
  showPlaceUI();
  G.state = 'menu';
}

// camera shots for each place
const CAB_POS = new THREE.Vector3(-.3, .99, -.62), CAB_LOOK = new THREE.Vector3(.1, .7, .45);
function shotFor(p) {
  const root = playerCar.root;
  if (p === 'cabin') return { pos: root.localToWorld(CAB_POS.clone()), look: root.localToWorld(CAB_LOOK.clone()), fov: 58 };
  if (p === 'screen' || p === 'radio') {
    const m = cockpit.screen.mesh;
    const c = m.getWorldPosition(new THREE.Vector3()), n = m.getWorldDirection(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion()));
    const look = c.clone().addScaledVector(up, p === 'radio' ? -.12 : -.03);
    return { pos: look.clone().addScaledVector(n, p === 'radio' ? .55 : .42), look, fov: 50 };
  }
  if (p === 'garage') return hub.shots.garage(placeT, root.position);
  if (p === 'board') return hub.shots.board(placeT, root.position);
  return shotFor('cabin');
}
const curShot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 58 };
function setShot(s) { curShot.pos.copy(s.pos); curShot.look.copy(s.look); curShot.fov = s.fov; }

// fly between places. Leaving or entering the car goes out through the open passenger window.
function goPlace(p) {
  if (p === place && !camFly) return Promise.resolve();
  const from = { pos: camera.position.clone(), look: curShot.look.clone(), fov: camera.fov };
  const inside = q => q === 'cabin' || q === 'screen' || q === 'radio';
  const cross = inside(place) !== inside(p);
  const via = cross ? playerCar.root.localToWorld(new THREE.Vector3(-1.9, 1.25, -.4)) : null;
  place = p; placeT = 0;
  hub.setWorkLight(p === 'garage');
  sound.whoosh(cross ? .22 : .1);
  return new Promise(res => { camFly = { from, via, t: 0, dur: cross ? 1.7 : 1.0, res }; showPlaceUI(true); });
}

function onConsoleButton(id) {
  if (id === 'race' || id === 'time') { refreshBoard(); goPlace('board'); }
  else if (id === 'garage') goPlace('garage');
  else if (id === 'radio') goPlace('radio');
  else goPlace('screen');
}

$('termslink').addEventListener('click', e => { e.preventDefault(); showTerms({ readOnly: true, click: () => sound.click(.4, 3000) }); });
$('back').addEventListener('click', () => { sound.click(.4, 3000); backToCabin(); });
function backToCabin() { menu.page = 'home'; menu.draw(); goPlace('cabin'); }

// DOM panels for the outside places
let garageTab = 'cars', shopCar = null;
const hex = c => '#' + c.toString(16).padStart(6, '0');
const pips = (n, max = 3) => Array.from({ length: max }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('');
function updateCash() { $('cash').textContent = money(career.cash); }
function refreshBoard() {
  const S = settings, ev = career.event;
  const trackId = S.mode === 'race' ? ev.track : S.track;
  hub.drawBoard({ ...S, track: trackId, laps: ev.laps }, loadBest()[TRACKS[trackId].id], S.mode === 'race' ? ev : null);
}
function showPlaceUI(hideFirst) {
  const el = $('place'), back = $('back');
  back.classList.toggle('hidden', place === 'cabin');
  $('menuhint').style.display = place === 'cabin' ? '' : 'none';
  updateCash();
  if (place !== 'garage' && place !== 'board') { el.classList.remove('on'); setTimeout(() => { if (place !== 'garage' && place !== 'board') el.classList.add('hidden'); }, 350); return; }
  if (hideFirst) el.classList.remove('on');
  el.classList.remove('hidden');
  const S = settings, car = career.car, mine = career.mine;
  if (place === 'garage') {
    const tabs = `<div class="tabs">${['cars', 'paint', 'tune'].map(t => `<button data-tab="${t}" class="${garageTab === t ? 'on' : ''}">${t.toUpperCase()}</button>`).join('')}</div>`;
    let body = '';
    if (garageTab === 'cars') {
      const view = carById(shopCar || car.id), owned = career.owns(view.id), cur = view.id === car.id;
      const bar = (l, v) => `<div class="stat"><span>${l}</span><b style="width:${Math.round(v * 100)}%"></b></div>`;
      body = `<div class="row">${CARS.map(c => `<button data-view="${c.id}" class="${c.id === view.id ? 'on' : ''}" style="flex:1;padding:8px 2px;font-size:9px">${c.name.split(' ')[0]}</button>`).join('')}</div>
        <div class="swname">${view.name}</div><div class="sub" style="margin:2px 0 8px">${view.origin} · ${view.engine.toUpperCase()}</div>
        <p class="blurb">${view.blurb}</p>
        ${bar('POWER', view.stats.power)}${bar('GRIP', view.stats.grip / 1.04)}${bar('WEIGHT', 1 - (view.stats.mass - 1150) / 500)}
        ${cur ? `<button class="buy" disabled>IN YOUR BAY</button>` : owned ? `<button class="buy" data-take="${view.id}">DRIVE THIS ONE</button>`
          : `<button class="buy ${career.cash >= view.price ? '' : 'poor'}" data-buy="${view.id}">BUY ${money(view.price)}</button>`}`;
    } else if (garageTab === 'paint') {
      const price = (list, k, kind) => mine[list].includes(k) ? '' : `<small>${money(PRICES[kind])}</small>`;
      body = `<label>PAINT</label><div class="sw">${PAINTS.map(([n, c], k) => `<button data-paint="${k}" class="${k === mine.paint ? 'on' : ''}" title="${n}${mine.paints.includes(k) ? '' : ' · ' + money(PRICES.paint)}" style="background:${hex(c)}">${mine.paints.includes(k) ? '' : '<em>$</em>'}</button>`).join('')}</div>
        <div class="swname">${PAINTS[mine.paint][0]}</div>
        <label>WHEELS</label><div class="row">${WHEEL_FINISHES.map((w, k) => `<button data-wh="${k}" class="${k === mine.wheels ? 'on' : ''}" style="flex:1;padding:8px 2px;font-size:9px">${w.toUpperCase()}${price('wheelSets', k, 'wheels')}</button>`).join('')}</div>
        <label>STRIPE</label><div class="row">${STRIPES.map(([n], k) => `<button data-st="${k}" class="${k === mine.stripe ? 'on' : ''}" style="flex:1;padding:8px 2px;font-size:9px">${n}${price('stripes', k, 'stripe')}</button>`).join('')}</div>`;
    } else {
      body = UPGRADES.map(u => { const c = career.upgradeCost(u.id); return `<div class="up"><div><b>${u.name}</b><span>${u.desc}</span><div class="pips">${pips(mine.up[u.id])}</div></div>
        ${c === null ? '<button disabled>MAX</button>' : `<button data-up="${u.id}" class="${career.cash >= c ? '' : 'poor'}">${money(c)}</button>`}</div>`; }).join('');
    }
    el.innerHTML = `<h3>GAR<span>AGE</span></h3><div class="sub">${car.name} · ${money(career.cash)}</div>${tabs}${body}`;
  } else {
    const best = loadBest()[TRACKS[S.track].id];
    const modeRow = `<div class="tabs"><button data-mode="race" class="${S.mode === 'race' ? 'on' : ''}">STREET RACES</button><button data-mode="time" class="${S.mode === 'time' ? 'on' : ''}">TIME ATTACK</button></div>`;
    if (S.mode === 'race') {
      const list = EVENTS.map((ev, i) => { const open = career.unlocked(i), won = career.d.wins[ev.id], sel = career.event.id === ev.id;
        return `<button class="ev ${sel ? 'on' : ''} ${open ? '' : 'locked'}" data-ev="${open ? ev.id : ''}"><b>${open ? ev.name : '— LOCKED —'}</b><span>${TRACKS[ev.track].name} · ${ev.laps} LAPS · ${['STRADA', 'SPORT', 'CORSA'][ev.difficulty]}</span><em>${won ? '✓ ' : ''}${money(ev.prize)}</em></button>`; }).join('');
      el.innerHTML = `<h3>STREET <span>RACES</span></h3><div class="sub">${car.name} · ${money(career.cash)}</div>${modeRow}<div class="evs">${list}</div>
        <button class="drive" data-drive="1">DRIVE</button>`;
    } else {
      el.innerHTML = `<h3>TIME <span>ATTACK</span></h3><div class="sub">${car.name}</div>${modeRow}
        <label>CIRCUIT</label><div class="row"><button data-trk="-1">&#9664;</button><div class="val">${TRACKS[S.track].name}</div><button data-trk="1">&#9654;</button></div>
        <label>BEST LAP</label><div class="val" style="text-align:left">${fmtTime(best)}</div>
        <button class="drive" data-drive="1">DRIVE</button>`;
    }
  }
  setTimeout(() => el.classList.add('on'), hideFirst ? 500 : 0);
}
function denied() { sound.burst({ f: 220, q: 2, dur: .15, g: .3, type: 'bandpass' }); const c = $('cash'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
function cha_ching() { sound.chime(true); setTimeout(() => sound.click(.5, 5200), 90); }
$('place').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const S = settings, d = b.dataset;
  sound.click(.45, 2800);
  let look = false, board = false;
  if (d.tab) garageTab = d.tab;
  if (d.view) shopCar = d.view;
  if (d.take) { career.buyCar(d.take); look = true; }
  if (d.buy) { if (career.buyCar(d.buy)) { look = true; cha_ching(); } else denied(); }
  if (d.paint) { if (career.buyLook('paint', +d.paint)) look = true; else denied(); }
  if (d.wh) { if (career.buyLook('wheels', +d.wh)) look = true; else denied(); }
  if (d.st) { if (career.buyLook('stripe', +d.st)) look = true; else denied(); }
  if (d.up) { if (career.upgrade(d.up)) { cha_ching(); sound.thump(.3, 50); } else denied(); }
  if (d.mode) { S.mode = d.mode; board = true; }
  if (d.ev) { career.selectEvent(d.ev); board = true; }
  if (d.trk) { S.track = (S.track + +d.trk + TRACKS.length) % TRACKS.length; board = true; }
  if (d.drive) { drive(); return; }
  saveSettings(S);
  if (look) rebuildPlayerLook();
  if (board) refreshBoard();
  showPlaceUI();
});

// --------------------------------------------------------------- DRIVE: key, ignition, radio fades, new area
async function drive(mp = null) {
  if (menu.starting) return;
  if (mp) { settings.track = mp.track; }
  menu.starting = true;
  $('place').classList.remove('on'); $('back').classList.add('hidden');
  if (place !== 'cabin') await goPlace('cabin');
  menu.enabled = false; menu.tip.classList.remove('on'); document.body.style.cursor = '';
  $('menuhint').style.display = 'none';
  cockpit.key.target = 1.25; sound.click(.4, 5200);
  sound.voice = career.car.sound;
  G.state = 'ignition';
  await new Promise(r => sound.ignition(() => { engineRunning = true; clusterSweep = 1; playerCar.setHeadlights(true); r(); }));
  await wait(700); rev = 1;                    // a blip or two on the way out
  await wait(900);
  radio.fade(0, 1.6);
  $('fade').classList.add('slow', 'on');
  await wait(1700);
  // new area: the circuit
  if (!mp && settings.mode === 'race') settings.track = career.event.track;
  if (track.def !== TRACKS[settings.track]) await loadTrack(settings.track);
  $('menuui').classList.add('hidden');
  beginRace(mp ? 'mp' : settings.mode, mp);
  await wait(250);
  $('fade').classList.remove('on');
  radio.fade(.75, 2.5);
  setTimeout(() => $('fade').classList.remove('slow'), 1500);
}

function driveOnline(m) {
  if (G.state === 'race' || G.state === 'results') { $('results').classList.add('hidden'); enterMenu(); }
  online.status('race');
  drive(m);
}

function beginRace(mode, mp = null) {
  if (race) race.dispose();
  raceScene.add(playerCar.root);
  useScene(raceScene);
  const ev = mode === 'race' ? career.event : null;
  const rs = ev ? { ...settings, laps: ev.laps, difficulty: ev.difficulty } : mp ? { ...settings, laps: mp.laps, gridSlot: Math.max(0, mp.grid.indexOf(online.name)) } : settings;
  player.applyTuning(career.tuning());
  race = new Race({ track, player, playerCar, scene: raceScene, settings: rs, hud, sound, fx, mode });
  race.event = ev;
  // your wheel power (peak torque x revs x driveline), so rivals can be matched to your car
  race.playerPower = 565 * 7000 * 2 * Math.PI / 60 * .86 * player.torqueMul * (1 + (player.boostTop - 1) * .7);
  race.setup();
  race.me.name = online.name;
  race.mp = mp;
  if (mp) {
    // other players: their own cars and look, name + title floating above, driven by the network feed
    const L = online.lobby ? online.lobby.members : [];
    for (const name of mp.grid) {
      if (name === online.name) continue;
      const info = L.find(p => p.name === name) || {};
      const car = makeCar({ ...lookFrom(mp.cars[name]), plate: plateFor(info.role) });
      car.chassis.add(nameLabel(name, info.title || '', info.role));
      car.setHeadlights(true);
      const slot = mp.grid.indexOf(name), sp = track.length - 12 - Math.floor(slot / 2) * 9 - (slot % 2) * 3;
      const p = new THREE.Vector3(); pointAt(track, sp, slot % 2 ? 3.4 : -3.4, p);
      car.root.position.copy(p);
      raceScene.add(car.root);
      race.remotes.push({ name, car, total: sp - track.length, finished: false, finishTime: 0, v: 0, pos: car.root.position, yaw: 0, remote: true });
    }
  }
  fx.skids.clear();
  player.manual = settings.gearbox === 'manual';
  player.rpm = Math.max(player.rpm, 950);
  engineRunning = true;
  playerCar.setHeadlights(true);
  placeCar();
  for (const r of race.rivals) r.car.setHeadlights(true);
  hud.show(true); hud.center('');
  // establishing crane shot across the grid, then down into the race camera
  const f = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)), l = new THREE.Vector3(f.z, 0, -f.x);
  camera.position.copy(player.pos).addScaledVector(f, 16).addScaledVector(l, -7).add(new THREE.Vector3(0, 4.5, 0));
  camera.lookAt(player.pos.clone().addScaledVector(f, -6));
  transition = { t: 0, dur: 3.2, from: camera.position.clone(), fromQ: camera.quaternion.clone() };
  chase.init = false;
  G.state = 'race';
  setTimeout(() => { if (race && race.phase === 'grid') race.startCountdown(); }, 2600);
}

// --------------------------------------------------------------- input
const keys = new Set();
const input = { steer: 0, throttle: 0, brake: 0, hand: false, nitro: false, rewind: false, analog: false };
// in-race text chat (online races): Enter opens a line, Enter sends, Esc cancels; driving keys pause while typing
function openRaceChat() {
  if (document.getElementById('racechatin')) return;
  const f = document.createElement('form'); f.id = 'racechatin';
  f.innerHTML = '<input maxlength="240" placeholder="Chat (Enter to send, Esc to cancel)" autocomplete="off">';
  document.getElementById('hud').appendChild(f);
  const inp = f.firstChild; keys.clear(); inp.focus();
  f.addEventListener('submit', ev => { ev.preventDefault(); const t = inp.value.trim(); if (t) online.send({ t: 'chat', scope: 'lobby', text: t }); f.remove(); });
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Escape') f.remove(); });
}
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (G.state === 'race' && race && race.mp && e.code === 'Enter') { e.preventDefault(); openRaceChat(); return; }
  if (e.repeat && e.code !== 'KeyR') return;
  keys.add(e.code);
  if (G.state === 'menu') {
    if (e.code === 'Escape' && place !== 'cabin' && !camFly) backToCabin();
    else if (place === 'cabin' || place === 'screen' || place === 'radio') menu.key(e.code);
    if (['Space', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  }
  if (e.code === 'KeyT' && (G.state === 'race' || G.state === 'paused' || G.state === 'results')) radio.next(e.shiftKey ? -1 : 1);
  if (G.state === 'race') {
    if (e.code === 'KeyC') { camMode = (camMode + 1) % 4; settings.camera = camMode; saveSettings(settings); sound.click(.2, 3000); }
    if (e.code === 'KeyE' && player.manual) player.shift(1);
    if (e.code === 'KeyQ' && player.manual) player.shift(-1);
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  } else if (G.state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) togglePause();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const dom = renderer.domElement;
addEventListener('pointermove', e => { if (G.state === 'menu' && !camFly) menu.pointer(e, camera, dom); });
dom.addEventListener('click', () => { if (G.state === 'menu' && !camFly) menu.click(); });
addEventListener('wheel', e => { if (G.state === 'menu') menu.wheel(e.deltaY); }, { passive: true });

const padPrev = new Map();
function readInput() {
  const k = c => keys.has(c);
  let steer = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
  let thr = k('KeyW') || k('ArrowUp') ? 1 : 0, brk = k('KeyS') || k('ArrowDown') ? 1 : 0;
  let hand = k('Space'), nitro = k('ShiftLeft') || k('ShiftRight'), rewind = k('KeyR');
  input.analog = false;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0;
    if (Math.abs(ax) > .08) { steer = Math.sign(ax) * Math.pow(Math.abs(ax), 1.5); input.analog = true; }
    const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
    if (rt > .05) thr = rt; if (lt > .05) brk = lt;
    if (p.buttons[0]?.pressed) nitro = true;
    if (p.buttons[1]?.pressed || p.buttons[2]?.pressed) hand = true;
    if (p.buttons[3]?.pressed) rewind = true;
    const prev = padPrev.get(p.index) || [];
    const edge = i => p.buttons[i]?.pressed && !prev[i];
    if (edge(5) && player.manual) player.shift(1);
    if (edge(4) && player.manual) player.shift(-1);
    if (edge(9) && (G.state === 'race' || G.state === 'paused')) togglePause();
    if (edge(8) || edge(10)) camMode = (camMode + 1) % 4;
    if (edge(12)) radio.next(1);
    padPrev.set(p.index, p.buttons.map(b => b.pressed));
  }
  Object.assign(input, { steer, throttle: thr, brake: brk, hand, nitro, rewind });
}

// --------------------------------------------------------------- pause / results
function togglePause() {
  if (G.state === 'race') { G.state = 'paused'; $('pause').classList.remove('hidden'); sound.silenceCar(); if (sound.engine) sound.engine.out.gain.setTargetAtTime(0, 0, .05); }
  else if (G.state === 'paused') { G.state = 'race'; $('pause').classList.add('hidden'); }
}
for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', () => {
  sound.click(.4, 3000);
  const a = b.dataset.act;
  $('pause').classList.add('hidden'); $('results').classList.add('hidden');
  if (a === 'resume') G.state = 'race';
  if (a === 'restart') beginRace(race.mode);
  if (a === 'garage') {
    $('fade').classList.add('on');
    radio.fade(0, .6);
    setTimeout(() => { enterMenu(); camMode = settings.camera; $('fade').classList.remove('on'); radio.fade(1, 2); }, 700);
  }
});

function showResults() {
  const rows = race.results();
  $('r-table').innerHTML = rows.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${r.pos}</td><td>${r.name}</td><td>${fmtTime(r.best)}</td><td>${fmtTime(r.time)}</td></tr>`).join('');
  const me = rows.find(r => r.me);
  $('r-title').textContent = race.mode === 'time' ? 'SESSION' : me.pos === 1 ? 'VICTORY' : `FINISHED P${me.pos}`;
  const s = race.stats;
  let pay = '';
  if (race.event && !race.paid) {
    race.paid = career.payout(race.event, me.pos, s);
    const p = race.paid;
    pay = `<div class="pay">${me.pos === 1 ? 'WINNER\'S PURSE' : 'PRIZE'} <b>${money(p.prize)}</b> + STYLE <b>${money(p.style)}</b> = <b class="tot">${money(p.total)}</b>${p.unlockedNext ? `<br>UNLOCKED: <b>${p.unlockedNext}</b>` : ''}</div>`;
    if (p.total > 0) cha_ching();
  }
  $('r-stats').innerHTML = pay + `<div>TOP SPEED <b>${Math.round(s.topSpeed)} km/h</b></div><div>BEST LAP <b>${fmtTime(s.bestLap)}</b></div><div>DRIFT <b>${Math.round(s.driftTotal).toLocaleString()}</b></div><div>NEAR MISSES <b>${s.nearMiss}</b></div><div>OVERTAKES <b>${s.overtakes}</b></div>`;
  document.querySelector('#results [data-act=restart]').style.display = race.mp ? 'none' : '';
  $('results').classList.remove('hidden');
  G.state = 'results';
}

// --------------------------------------------------------------- cameras
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3();
function placeCar() {
  playerCar.root.position.copy(player.pos);
  playerCar.root.quaternion.copy(player.quat);
  const s = player.susp;
  playerCar.chassis.rotation.set(s.pitch, 0, -s.roll);
  playerCar.chassis.position.y = Math.min(0, -Math.abs(s.pitch) * .3);
  playerCar.wheels.forEach((w, i) => { w.spin.rotation.x = player.wheelRot; if (i < 2) w.hub.rotation.y = player.steer; });
}

let transition = null;
const chase = { pos: new THREE.Vector3(), init: false, yaw: 0 };
function raceCamera(dt) {
  const root = playerCar.root;
  const sp = Math.abs(player.vx);
  let fov = 62 + THREE.MathUtils.smoothstep(sp, 20, 95) * 14 + (player.nitroOn ? 7 : 0) + (player.boostT > 0 ? 4 : 0);
  const cabin = camMode === 3, bonnet = camMode === 2;
  let pos, q;
  if (cabin || bonnet) {
    const local = cabin ? EYE.clone().add(new THREE.Vector3(0, -.01, .02)) : new THREE.Vector3(0, 1.0, .9);
    pos = root.localToWorld(local.clone());
    const look = root.localToWorld(local.clone().add(new THREE.Vector3(-player.steerIn * .4 * (cabin ? 1 : 0), -.06, 3)));
    tmpM.lookAt(pos, look, tmpV.set(0, 1, 0).applyQuaternion(root.quaternion));
    q = new THREE.Quaternion().setFromRotationMatrix(tmpM);
    chase.init = false;
    if (cabin) fov -= 4;
  } else {
    const far = camMode === 1;
    const dist = (far ? 8.6 : 5.9) + THREE.MathUtils.smoothstep(sp, 30, 95) * 1.2;
    const h = far ? 2.5 : 1.75;
    const velYaw = sp > 3 ? Math.atan2(Math.sin(player.yaw) * player.vx + Math.cos(player.yaw) * player.vy, Math.cos(player.yaw) * player.vx - Math.sin(player.yaw) * player.vy) : player.yaw;
    const target = THREE.MathUtils.lerp(player.yaw, velYaw, .35);
    if (!chase.init) chase.yaw = target;
    let dy = target - chase.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    chase.yaw += dy * Math.min(1, dt * 5);
    const up = player.loc.up;
    const want = player.pos.clone().add(new THREE.Vector3(-Math.sin(chase.yaw) * dist, 0, -Math.cos(chase.yaw) * dist)).addScaledVector(up, h);
    if (!chase.init) { chase.pos.copy(want); chase.init = true; }
    chase.pos.lerp(want, Math.min(1, dt * 9));
    chase.pos.y = Math.max(chase.pos.y, player.pos.y + .6);
    pos = chase.pos.clone();
    const look = player.pos.clone().addScaledVector(up, .95).add(new THREE.Vector3(Math.sin(chase.yaw), 0, Math.cos(chase.yaw)).multiplyScalar(2.5));
    tmpM.lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    q = new THREE.Quaternion().setFromRotationMatrix(tmpM);
  }
  const shake = THREE.MathUtils.smoothstep(sp, 40, 95) * .004 + (player.offroad ? .01 : 0) + Math.min(.05, player.hitWall * .004) + (player.nitroOn ? .003 : 0);
  if (shake > 0) { const tt = performance.now() * .001; pos.x += Math.sin(tt * 53) * shake; pos.y += Math.sin(tt * 61 + 1) * shake; }
  let inside = cabin;
  if (transition) {
    transition.t += dt;
    const e = THREE.MathUtils.smootherstep(transition.t / transition.dur, 0, 1);
    camera.position.lerpVectors(transition.from, pos, e);
    camera.quaternion.slerpQuaternions(transition.fromQ, q, e);
    camera.fov = THREE.MathUtils.lerp(48, fov, e);
    if (transition.t >= transition.dur) transition = null;
    inside = cabin && e > .9;
  } else {
    camera.position.copy(pos); camera.quaternion.copy(q);
    camera.fov = THREE.MathUtils.lerp(camera.fov, fov, Math.min(1, dt * 4));
  }
  playerCar.setInterior(inside);
  cockpit.group.visible = inside;
  camera.updateProjectionMatrix();
  radio.setSpeaker(inside ? 'cabin' : 'open');
  return inside;
}

const ease = t => t * t * (3 - 2 * t);
function menuCamera(dt) {
  placeT += dt;
  const target = shotFor(place);
  if (camFly) {
    camFly.t += dt;
    const k = Math.min(1, camFly.t / camFly.dur), e = THREE.MathUtils.smootherstep(k, 0, 1);
    const a = camFly.from.pos, b = target.pos;
    if (camFly.via) {   // quadratic bezier out through the window
      const v = camFly.via;
      camera.position.set(
        (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * v.x + e * e * b.x,
        (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * v.y + e * e * b.y,
        (1 - e) * (1 - e) * a.z + 2 * (1 - e) * e * v.z + e * e * b.z);
    } else camera.position.lerpVectors(a, b, e);
    curShot.look.lerpVectors(camFly.from.look, target.look, ease(k));
    camera.fov = THREE.MathUtils.lerp(camFly.from.fov, target.fov, e);
    if (k >= 1) { const r = camFly.res; camFly = null; r(); }
  } else {
    camera.position.copy(target.pos);
    curShot.look.copy(target.look);
    camera.fov = target.fov;
  }
  camera.up.set(0, 1, 0);
  camera.lookAt(curShot.look);
  camera.updateProjectionMatrix();
  // the shell hides while the camera is inside the car
  const lp = playerCar.root.worldToLocal(camera.position.clone());
  const inside = Math.abs(lp.x) < .95 && lp.y < 1.14 && lp.y > .2 && Math.abs(lp.z) < 2.1;
  playerCar.setInterior(inside);
  cockpit.group.visible = inside;      // tinted glass: the cabin is never seen from outside
}

// analogue gauges: tach (left), speedo (right), boost between, warning lamps
function drawCluster(rpm, kmh, gear, boost, lit) {
  const { ctx: x, tex } = cockpit.cluster, W = 1024;
  x.fillStyle = '#060607'; x.fillRect(0, 0, W, 400);
  const glow = lit ? 1 : .15;
  const dialFn = (cx, cy, r, max, val, stepV, label, red, fmt = v => v) => {
    const a0 = Math.PI * .75, a1 = Math.PI * 2.25;
    x.fillStyle = '#0c0c0e'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.strokeStyle = '#2b2b30'; x.lineWidth = 6; x.stroke();
    for (let v = 0; v <= max; v += stepV / 2) {
      const a = a0 + (a1 - a0) * v / max, major = v % stepV === 0;
      x.strokeStyle = red && v >= red ? `rgba(255,50,30,${.5 + glow * .5})` : `rgba(255,${150 + glow * 60},${80 + glow * 40},${.25 + glow * .7})`;
      x.lineWidth = major ? 5 : 2;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8)); x.lineTo(cx + Math.cos(a) * (r - (major ? 30 : 18)), cy + Math.sin(a) * (r - (major ? 30 : 18))); x.stroke();
      if (major) { x.fillStyle = `rgba(255,${190 + glow * 40},140,${.3 + glow * .7})`; x.font = `600 ${r * .15}px Rajdhani`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(fmt(v), cx + Math.cos(a) * (r - 52), cy + Math.sin(a) * (r - 52)); }
    }
    x.fillStyle = `rgba(255,170,90,${.3 + glow * .5})`; x.font = `600 ${r * .1}px Michroma`; x.fillText(label, cx, cy + r * .45);
    const a = a0 + (a1 - a0) * Math.min(val, max * 1.02) / max;
    x.strokeStyle = '#ff5a1a'; x.lineWidth = 6; x.shadowColor = '#ff5a1a'; x.shadowBlur = 12 * glow;
    x.beginPath(); x.moveTo(cx - Math.cos(a) * 18, cy - Math.sin(a) * 18); x.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); x.stroke(); x.shadowBlur = 0;
    x.fillStyle = '#1b1b1f'; x.beginPath(); x.arc(cx, cy, 16, 0, 7); x.fill();
  };
  dialFn(250, 205, 180, 9, rpm / 1000, 1, 'RPM x1000', 8);
  dialFn(774, 205, 180, 320, kmh, 40, 'km/h', 0);
  dialFn(512, 120, 80, 2, boost * 1.6, 1, 'BOOST', 0, v => v.toFixed(0));
  x.font = 'italic 900 88px "Saira Condensed"'; x.textAlign = 'center'; x.fillStyle = lit ? '#ffb070' : '#3a2a1a';
  x.fillText(gear, 512, 300);
  [['#ff3b1f', !engineRunning], ['#ffb000', !engineRunning], ['#3cff9e', engineRunning && playerCar.headlightsUp > .9]].forEach(([c, on], k) => { x.fillStyle = on ? c : '#151515'; x.beginPath(); x.arc(452 + k * 60, 370, 10, 0, 7); x.fill(); });
  tex.needsUpdate = true;
}

// --------------------------------------------------------------- loop
let last = performance.now(), clusterT = 0, popT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000, dt = Math.min(.05, raw); last = now;
  if (!hub || !cockpit || G.state === 'boot' || G.state === 'gate' || G.state === 'intro') return;
  gfx.perf(raw, now / 1000);
  if (fpsEl.style.display !== 'none' && G.quality) {
    const s = gfx.stats();
    fpsEl.textContent = `${s.fps} FPS  ·  ${G.quality.name.toUpperCase()}${settings.quality === 'auto' || !QUALITY[settings.quality] ? ' (AUTO)' : ''}  ·  ${s.px[0]}x${s.px[1]} (${Math.round(s.scale * 100)}%)\n${G.quality.gpu}`;
  }
  try { tick(dt); } catch (err) { console.error(err); }
}

function tick(dt) {
  const st = G.state;
  readInput();
  let cabinView = true;
  if (st === 'title' || st === 'menu' || st === 'ignition') {
    // engine on the roof: idle with a couple of throttle blips before we leave
    rev = Math.max(0, rev - dt * .9);
    const blip = rev > 0 ? Math.max(0, Math.sin(rev * Math.PI * 2.2)) : 0;
    idleRpm = THREE.MathUtils.lerp(idleRpm, engineRunning ? 950 + blip * 5200 : 0, Math.min(1, dt * (blip > 0 ? 9 : 4)));
    player.rpm = idleRpm; player.throttle = blip; player.vx = 0;
    playerCar.chassis.rotation.z = engineRunning ? Math.sin(performance.now() * .05) * .0012 + blip * .006 : 0;
    menuCamera(dt);
    hub.update(dt);
    if (st === 'menu' && !camFly) menu.update(dt, camera); else menu.update(0, camera);
  } else if (st === 'race' || st === 'results') {
    const ctl = race.phase === 'done' ? { steer: 0, throttle: 0, brake: .4, hand: false, nitro: false } : input;
    const assist = [.25, .7, .95][settings.assist];
    const n = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < n; i++) player.step(dt / n, ctl, { locked: race.locked, assist });
    race.update(dt, input);
    placeCar();
    if (race.phase === 'done' && race.doneT > 2.5 && st === 'race') showResults();
    cabinView = raceCamera(dt);
    for (const ev of player.events) {
      if (ev === 'upshift' || ev === 'downshift') { sound.shiftClunk(ev === 'upshift'); if (ev === 'downshift' && player.rpm > 4500) popT = .25; }
      if (ev === 'perfectShift') { player.boostT = Math.max(player.boostT, .5); hud.pop('PERFECT SHIFT', '', '#7dffa1'); }
    }
    player.events.length = 0;
    if (player.nitroOn && !G.wasNitro) sound.nitroStart();
    G.wasNitro = player.nitroOn;
    if (player.hitWall > 3) sound.impact(player.hitWall);
    const stand = race.standings(), myPos = stand.indexOf(race.me) + 1;
    hud.timing({ pos: myPos, of: stand.length, lap: race.me.lap, laps: race.laps, time: race.t, lapTime: race.phase === 'race' ? race.t - race.me.lapStart : 0, best: Math.min(race.stats.bestLap, race.best) });
    const meTotal = race.me.total;
    hud.board(stand.slice(0, 6).map(e => ({ name: e.name, me: e === race.me, gap: e === race.me ? '' : (() => { const d = e.total - meTotal; return (d > 0 ? '+' : '') + (d / Math.max(20, Math.abs(player.vx))).toFixed(1); })() })));
    hud.gauge({ rpm: player.rpm, kmh: player.kmh, gear: player.reverse ? 'R' : String(player.gear), nitro: player.nitro, nitroOn: player.nitroOn, boost: sound.engine ? sound.engine.boost : 0, manual: player.manual });
    hud.minimap(track, [...race.rivals.map(r => ({ pos: r.pos })), ...(race.ghostCar && race.ghostCar.root.visible ? [{ pos: race.ghostCar.root.position, ghost: true }] : []), { pos: player.pos, me: true }]);
    const wrong = race.phase === 'race' && player.vx > 5 && (Math.sin(player.yaw) * player.loc.tx + Math.cos(player.yaw) * player.loc.tz) < -.4;
    hud.flags({ wrong, rewind: race.rewinding, cam: `C: ${CAM_NAMES[camMode]}  ·  R: REWIND  ·  T: RADIO${player.manual ? '  ·  Q/E: SHIFT' : ''}` });
    final.uniforms.uRewind.value = THREE.MathUtils.lerp(final.uniforms.uRewind.value, race.rewinding ? 1 : 0, Math.min(1, dt * 8));
    lights.update(player.pos);
    if (race.mp) onlineRaceTick(dt);
  } else if (st === 'paused') { composer.render(); return; }

  playerCar.update(dt);
  const inRace = st === 'race' || st === 'results';
  playerCar.setBrake(inRace ? Math.max(player.brake, race && race.locked ? .3 : 0) : 0);
  if (race) for (const r of race.rivals) { r.car.update(dt); r.car.setDynamics(r.v, r.brake, dt); }
  playerCar.setDynamics(inRace ? player.vx : 0, inRace ? player.brake : 0, dt);
  for (const c of hub.parked) c.update(dt);
  if (cockpit.group.visible) {
    cockpit.wheel.rotation.z = inRace ? -player.steerIn * 2.4 : 0;
    const slots = cockpit.gate.slots, gk = player.reverse ? 'R' : (inRace && race && !race.locked ? String(player.gear) : 'N');
    const tgt = slots[gk] || slots.N;
    cockpit.gate.pos.lerp(new THREE.Vector2(tgt[0], tgt[1]), Math.min(1, dt * 18));
    cockpit.gate.lever.rotation.set(cockpit.gate.pos.y * 4, 0, -cockpit.gate.pos.x * 4);
    clusterT -= dt;
    if (clusterT <= 0) {
      clusterT = 1 / 30;
      let rpm = engineRunning ? player.rpm : 0, kmh = inRace ? player.kmh : 0;
      if (clusterSweep > 0) { clusterSweep = Math.max(0, clusterSweep - dt * .9); const s = Math.sin(clusterSweep * Math.PI); rpm = Math.max(rpm, s * 9000); kmh = Math.max(kmh, s * 320); }
      drawCluster(rpm, kmh, player.reverse ? 'R' : gk, sound.engine ? sound.engine.boost : 0, engineRunning);
    }
  }

  if (inRace) {
    const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    const vel = fwd.clone().multiplyScalar(player.vx).add(new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw)).multiplyScalar(player.vy));
    // rubber on the road: rears when sliding or spinning up, fronts when the brakes bite hard
    const left = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const lock = player.brake > .85 && Math.abs(player.vx) > 10 ? .55 : 0;
    playerCar.wheels.forEach((w, i) => {
      const a = i < 2 ? lock : Math.max(Math.min(1, (player.slip - .4) * 1.6), lock);
      const key = 'p' + i;
      if (a > .05 && race.phase !== 'grid') { const p = w.hub.getWorldPosition(tmpV); p.y = player.pos.y; fx.skids.mark(key, p, left, .22, Math.min(.75, a)); }
      else fx.skids.lift(key);
    });
    const smokeAmt = Math.max(0, player.slip - .25) * 1.4;
    if (smokeAmt > 0) for (const w of playerCar.wheels.slice(2)) fx.tyreSmoke(w.hub.getWorldPosition(tmpV).setY(player.pos.y + .25), vel, smokeAmt);
    if (player.scrape > 3) {
      const side = Math.sign(player.loc.d);
      fx.sparks(player.pos.clone().add(new THREE.Vector3(player.loc.rx * side * .9, .35, player.loc.rz * side * .9)), vel.clone().multiplyScalar(-.3), 3);
    }
    popT -= dt;
    const back = fwd.clone().negate();
    for (const e of playerCar.exhausts) fx.exhaust(playerCar.chassis.localToWorld(e.clone()), back, { nitro: player.nitroOn, pop: popT > 0 && Math.random() < .3 });
    if (sound.engine && sound.engine.popCool > .6) popT = .3;
    fx.update(dt, camera, Math.abs(player.vx));
  }

  if (sound.ready) {
    const tunnel = inRace && track.inTunnel[player.loc.i] ? 1 : 0;
    sound.car({ rpm: player.rpm, thr: engineRunning ? player.throttle : 0, cut: player.shiftT > 0 || player.limiter > 0, gear: player.gear, speed: inRace ? Math.abs(player.vx) : 0, slip: inRace ? player.slip : 0, scrape: inRace ? player.scrape : 0, nitro: inRace && player.nitroOn, tunnel, cabin: inRace ? cabinView : place !== 'garage' && place !== 'board', dt, offroad: inRace && player.offroad && Math.abs(player.vx) > 3 });
    if (inRace && race) {
      const near = race.rivals.map(r => ({ r, d: r.pos.distanceToSquared(camera.position) })).sort((a, b) => a.d - b.d).slice(0, 3).map(o => ({ pos: o.r.pos, rpm: o.r.rpm, thr: o.r.throttle }));
      sound.rivalUpdate(near, camera);
    }
  }

  const sp = inRace ? THREE.MathUtils.smoothstep(Math.abs(player.vx), 40, 100) * (camMode === 3 ? .6 : 1) + (player.nitroOn ? .35 : 0) : 0;
  final.uniforms.uSpeed.value = THREE.MathUtils.lerp(final.uniforms.uSpeed.value, sp, Math.min(1, dt * 4));
  final.uniforms.uTime.value += dt;
  composer.render();
}

addEventListener('resize', () => fx && fx.resize());
// dev hooks for scripted checks in a background tab (rAF is throttled there)
G.tick = dt => tick(dt);
G.snap = async (name = 'snap', q = .85) => {
  composer.render();
  const url = renderer.domElement.toDataURL('image/jpeg', q);
  await fetch('http://127.0.0.1:9301/' + name, { method: 'POST', body: url });
  return name;
};
G.skipToMenu = () => { G.skipped = true; sound.init(); $('gate').classList.add('gone'); $('intro').classList.add('hidden'); radio.ensureGraph(); radio.randomStation(); enterMenu(); };
G.goPlace = p => goPlace(p);
G.drive = () => drive();
// key art / store shots: pose the camera yourself and render at any size
G.art = {
  THREE, renderer, composer, final,
  get camera() { return camera; }, get race() { return race; }, get player() { return player; }, get playerCar() { return playerCar; }, get track() { return track; },
  get fx() { return fx; }, rebuild: () => rebuildPlayerLook(), begin: async (mode = 'time', trackIdx = 0) => { await loadTrack(trackIdx); $('menuui').classList.add('hidden'); beginRace(mode); },
  render(w, h) {
    const pr = renderer.getPixelRatio(); renderer.setPixelRatio(1);
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    composer.render();
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(renderer.domElement, 0, 0);
    renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    return c;
  },
};
G.setCam = m => { camMode = m; };
// multiplayer race feed: send ours ~15 times a second, ease the others toward theirs
let netT = 0;
function onlineRaceTick(dt) {
  netT -= dt;
  if (netT <= 0) {
    netT = 1 / 15;
    online.sendState({ x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), yaw: +player.yaw.toFixed(3), v: +player.vx.toFixed(2),
      total: +race.me.total.toFixed(1), fin: race.me.finished, ft: race.me.finishTime, b: player.brake > .3 ? 1 : 0 });
  }
  if (race.me.finished && !race.sentFinish) { race.sentFinish = true; online.finish(race.me.finishTime); }
  for (const r of race.remotes) {
    const st = online.remote.get(r.name);
    // a player who quit or lost connection: take their car off the road instead of leaving it frozen
    const gone = (online.lobby && !online.lobby.members.some(p => p.name === r.name)) || (st && performance.now() - st.at > 8000);
    if (gone !== !!r.dropped) { r.dropped = gone; r.car.root.visible = !gone; }
    if (!st || gone) continue;
    const ahead = Math.min(.25, (performance.now() - st.at) / 1000);
    const tx = st.x + Math.sin(st.yaw) * st.v * ahead, tz = st.z + Math.cos(st.yaw) * st.v * ahead;
    const k = Math.min(1, dt * 10);
    r.car.root.position.x += (tx - r.car.root.position.x) * k;
    r.car.root.position.z += (tz - r.car.root.position.z) * k;
    r.car.root.position.y += (st.y - r.car.root.position.y) * k;
    let dy = st.yaw - r.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.yaw += dy * k;
    r.car.root.rotation.set(0, r.yaw, 0);
    r.v = st.v; r.total = st.total; r.car.setBrake(st.b);
    if (st.fin && !r.finished) { r.finished = true; r.finishTime = st.ft; race.finishOrder.push(r); }
    r.spin = (r.spin || 0) + st.v / .31 * dt;
    r.car.wheels.forEach(w => { w.spin.rotation.x = r.spin; });
    r.car.update(dt); r.car.setDynamics(st.v, st.b, dt);
  }
}

G.online = online;
G.info = () => ({ state: G.state, place, flying: !!camFly });

boot().then(() => requestAnimationFrame(frame)).catch(e => { console.error(e); $('gatekey').textContent = 'ERROR: ' + e.message; $('gatekey').classList.add('on'); });
