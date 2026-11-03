// OVERDRIVE launch menu. Runs inside our own PC launcher (desktop/overdrive.c), which talks to it through
// window.chrome.webview: the launcher sends update progress, the menu sends back "play", "quit", "fs:1"/"fs:0".
// Inside the Ruff Dogs Launcher's game window (window.ruffDogs) it asks for quit/fullscreen at /_rd/... instead; that
// window already updated the game before it opened. Opened in a plain browser it still works as a preview.
const host = window.chrome && window.chrome.webview;
const rd = !host && window.ruffDogs && window.ruffDogs.launcher;
const rdSay = what => fetch('/_rd/' + what, { cache: 'no-store' }).catch(() => { });
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('odl_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('odl_' + k, JSON.stringify(v)); } catch (e) { } },
};
const opts = { fs: store.get('fs', true) };
if (!host && !rd) $('menu').querySelector('[data-act=quit]').remove();

// ------------------------------------------------------------------------------------------------ sound
// The theme ("Sodium") and the menu sounds were composed and rendered from scratch for OVERDRIVE (tools/launcher-audio.js).
// They share the theme's instruments and key (D Dorian), so moving through the menu plays notes that fit the music.
const ac = new AudioContext();
const master = ac.createGain(); master.connect(ac.destination);
const musicGain = ac.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
const sfx = ac.createGain(); sfx.gain.value = .8; sfx.connect(master);
const resume = () => { if (ac.state === 'suspended') ac.resume(); };
addEventListener('pointerdown', resume); addEventListener('keydown', resume);

const load = url => fetch(url).then(r => r.arrayBuffer()).then(b => ac.decodeAudioData(b)).catch(() => null);
const SFX = {};
for (const k of ['hover', 'select', 'back', 'deny', 'play']) load(`sfx/${k}.m4a`).then(b => { SFX[k] = b; });
function snd(name, semis = 0, vol = 1) {
  const b = SFX[name]; if (!b) return;
  const s = ac.createBufferSource(), g = ac.createGain(); s.buffer = b; s.playbackRate.value = Math.pow(2, semis / 12); g.gain.value = vol;
  s.connect(g).connect(sfx); s.start();
}
const HOVER_NOTES = [0, -5, -9, -12];                 // D, A, F, D down the menu
const tick = (i = 0) => snd('hover', HOVER_NOTES[i % HOVER_NOTES.length], .9);
const confirmSnd = () => snd('select');
const backSnd = () => snd('back');
const denySnd = () => snd('deny');
const launchSnd = () => snd('play');

let theme = null;
async function startTheme() {                         // loops seamlessly: the file is exactly 16 bars with its tail folded in
  const b = await load('theme.m4a'); if (!b || busy) return;
  theme = ac.createBufferSource(); theme.buffer = b; theme.loop = true; theme.connect(musicGain); theme.start();
  const t = ac.currentTime; musicGain.gain.setValueAtTime(0, t); musicGain.gain.linearRampToValueAtTime(.85, t + 3);
}
function fadeTheme(sec) { const t = ac.currentTime; musicGain.gain.cancelScheduledValues(t); musicGain.gain.setValueAtTime(musicGain.gain.value, t); musicGain.gain.linearRampToValueAtTime(0, t + sec); }

// ------------------------------------------------------------------------------------------------ credits: the radio's songs
fetch('../media/stations.json').then(r => r.json()).then(j => {
  $('songs').innerHTML = (j.stations || []).map(s => `<div class="stn"><b style="color:${s.color}">${s.name} ${s.freq}</b>` +
    (s.tracks || []).map(t => `<div>${esc(t.artist)} &mdash; ${esc(t.title)}</div>`).join('') + '</div>').join('');
}).catch(() => { });
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ------------------------------------------------------------------------------------------------ update status from the launcher
let phase = host ? 'checking' : rd ? 'current' : 'browser', fsSent = false;
const playBtn = $('menu').querySelector('[data-act=play]');
function onUpdate(m) {
  phase = m.phase;
  const dot = $('dot'), bar = $('bar'), txt = $('stxt'), v = m.version ? `VERSION ${m.version}` : '';
  dot.className = ''; bar.className = '';
  if (m.version) $('ver').textContent = v;
  if (phase === 'checking') { txt.textContent = 'CHECKING FOR UPDATES'; bar.className = 'idle'; }
  else if (phase === 'downloading') { txt.textContent = `DOWNLOADING UPDATE ${m.remote} · ${m.pct}%`; bar.firstElementChild.style.width = m.pct + '%'; }
  else {
    bar.firstElementChild.style.width = '100%'; bar.className = 'hide';
    if (phase === 'ready') { dot.className = 'ok'; txt.textContent = `UPDATED · ${v}`; }
    else if (phase === 'current') { dot.className = 'ok'; txt.textContent = `UP TO DATE · ${v}`; }
    else if (phase === 'offline') { dot.className = 'off'; txt.textContent = `OFFLINE · ${v}`; }
    else { dot.className = 'bad'; txt.textContent = `UPDATE FAILED · PLAYING ${v}`; }
  }
  const wait = phase === 'checking' || phase === 'downloading';
  playBtn.classList.toggle('wait', wait);
  playBtn.querySelector('em').textContent = wait ? (phase === 'checking' ? 'CHECKING FOR UPDATES' : 'UPDATING') : 'HIT THE STREETS';
  if (!fsSent) { fsSent = true; if (opts.fs && !m.fullscreen) host.postMessage('fs:1'); }
}
if (host) { host.addEventListener('message', e => { const m = e.data; if (m && m.t === 'update') onUpdate(m); }); host.postMessage('hello'); }
else if (rd) {
  $('dot').className = 'ok'; $('bar').className = 'hide'; $('stxt').textContent = 'RUFF DOGS LAUNCHER · UP TO DATE';
  fetch('../version.json', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j.version) { $('ver').textContent = `VERSION ${j.version}`; $('stxt').textContent = `RUFF DOGS LAUNCHER · VERSION ${j.version}`; } }).catch(() => { });
  if (opts.fs) rdSay('fs1');
}
else { $('stxt').textContent = 'BROWSER PREVIEW'; $('dot').className = 'off'; $('bar').className = 'hide'; }

// ------------------------------------------------------------------------------------------------ menu
const items = [...$('menu').querySelectorAll('button')];
let idx = 0, busy = false, panel = null, pidx = 0;
function focusItem(i, sound = true) {
  i = (i + items.length) % items.length;
  if (i === idx && items[i].classList.contains('on')) return;
  idx = i; items.forEach((b, k) => b.classList.toggle('on', k === idx));
  const b = items[idx], sel = $('sel'), span = b.querySelector('span');
  sel.style.top = (b.offsetTop + b.offsetHeight * .12) + 'px';
  sel.style.height = (b.classList.contains('big') ? span.offsetHeight * .82 : b.offsetHeight * .76) + 'px';
  sel.style.width = (span.offsetWidth + b.offsetWidth * .1 + 90) + 'px';
  if (sound) tick(idx);
}
items.forEach((b, k) => {
  b.addEventListener('mouseenter', () => { if (!busy && !panel) focusItem(k); });
  b.addEventListener('click', () => { focusItem(k, false); activate(b.dataset.act); });
});
function activate(act) {
  if (busy) return;
  resume();
  if (act === 'play') return play();
  if (act === 'quit') return quit();
  if (act === 'settings' || act === 'credits') return openPanel(act);
}
function play() {
  if (phase === 'checking' || phase === 'downloading') { denySnd(); playBtn.animate([{ transform: 'translateX(0) skewX(-8deg)' }, { transform: 'translateX(-10px) skewX(-8deg)' }, { transform: 'translateX(8px) skewX(-8deg)' }, { transform: 'translateX(0) skewX(-8deg)' }], { duration: 260 }); return; }
  busy = true; launchSnd(); fadeTheme(1.4);
  document.body.classList.add('go'); speedBoost = 1;
  setTimeout(() => { if (host) host.postMessage('play'); else location.href = '../index.html'; }, 2100);
}
function quit() {
  busy = true; backSnd(); fadeTheme(.6); document.body.classList.add('quit');
  setTimeout(() => { if (host) host.postMessage('quit'); else if (rd) rdSay('quit'); }, 750);
}

// side panels (settings, credits): keyboard/gamepad move between their rows
const panelRows = () => [...panel.querySelectorAll('.opt, .back')];
function openPanel(name) {
  confirmSnd(); panel = $(name); panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panelopen'); pidx = 0; focusRow(0, false);
}
function closePanel() {
  if (!panel) return;
  backSnd(); panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true');
  panelRows().forEach(r => r.classList.remove('focus'));
  panel = null; document.body.classList.remove('panelopen');
}
function focusRow(i, sound = true) {
  const rows = panelRows(); pidx = (i + rows.length) % rows.length;
  rows.forEach((r, k) => r.classList.toggle('focus', k === pidx));
  rows[pidx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (sound) tick(pidx + 1);
}
function pressRow() {
  const r = panelRows()[pidx];
  if (r.classList.contains('back')) return closePanel();
  const c = r.querySelector('input[type=checkbox]'); if (c) { c.checked = !c.checked; c.dispatchEvent(new Event('change')); confirmSnd(); }
}
document.querySelectorAll('[data-act=back]').forEach(b => b.addEventListener('click', closePanel));
document.querySelectorAll('.opt').forEach(r => r.addEventListener('mouseenter', () => { if (panel) { const k = panelRows().indexOf(r); if (k >= 0 && k !== pidx) focusRow(k); } }));

$('optfs').checked = opts.fs;
$('optfs').addEventListener('change', e => { opts.fs = e.target.checked; store.set('fs', opts.fs); if (host) host.postMessage(opts.fs ? 'fs:1' : 'fs:0'); else if (rd) rdSay(opts.fs ? 'fs1' : 'fs0'); });

const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'ok', Space: 'ok', NumpadEnter: 'ok', Escape: 'back', Backspace: 'back' };
addEventListener('keydown', e => { const a = KEYS[e.code]; if (!a) return; e.preventDefault(); input(a); });
function input(a) {
  if (busy) return;
  if (!ready) { if (a === 'ok') skipIntro(); return; }
  if (panel) {
    if (a === 'up') focusRow(pidx - 1); else if (a === 'down') focusRow(pidx + 1);
    else if (a === 'ok') pressRow(); else if (a === 'back') closePanel();
    return;
  }
  if (a === 'up') focusItem(idx - 1); else if (a === 'down') focusItem(idx + 1);
  else if (a === 'ok') activate(items[idx].dataset.act);
}
// gamepad: d-pad / left stick to move, A to choose, B to go back
const padPrev = {};
function pollPad() {
  for (const p of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!p) continue;
    const st = { up: p.buttons[12]?.pressed || p.axes[1] < -.6, down: p.buttons[13]?.pressed || p.axes[1] > .6, left: p.buttons[14]?.pressed || p.axes[0] < -.6,
      right: p.buttons[15]?.pressed || p.axes[0] > .6, ok: p.buttons[0]?.pressed, back: p.buttons[1]?.pressed };
    for (const k in st) { if (st[k] && !padPrev[p.index + k]) { resume(); input(k); } padPrev[p.index + k] = st[k]; }
  }
}

// ------------------------------------------------------------------------------------------------ rain, lights, grain
const fx = $('fx'), g = fx.getContext('2d'), grain = $('grain'), gg = grain.getContext('2d');
let W = 0, H = 0, drops = [], motes = [], streaks = [], speedBoost = 0;
function size() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  W = fx.width = innerWidth * dpr; H = fx.height = innerHeight * dpr;
  grain.width = 240; grain.height = 135;
  drops = Array.from({ length: Math.round(innerWidth * innerHeight / 5200) }, () => newDrop(true));
  motes = Array.from({ length: 26 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: (6 + Math.random() * 26) * dpr, vx: (Math.random() - .5) * .15, vy: -.05 - Math.random() * .2, a: Math.random() * Math.PI * 2, warm: Math.random() < .7 }));
  if (items[idx].classList.contains('on')) { items[idx].classList.remove('on'); focusItem(idx, false); }
}
function newDrop(any) {
  const z = Math.random();
  return { x: Math.random() * W * 1.2 - W * .1, y: any ? Math.random() * H : -Math.random() * H * .3, z, len: (14 + z * 46) * (W / 1600), v: (12 + z * 26) * (H / 900) };
}
let last = performance.now(), frame = 0;
function draw(now) {
  const dt = Math.min(50, now - last) / 16.67; last = now; frame++;
  g.clearRect(0, 0, W, H);
  const wind = .2 + speedBoost * 1.4;
  g.lineCap = 'round';
  for (const d of drops) {
    d.y += d.v * dt * (1 + speedBoost * 2); d.x += d.v * wind * .12 * dt;
    if (d.y > H + 40) Object.assign(d, newDrop(false));
    g.strokeStyle = `rgba(200,220,255,${.08 + d.z * .22})`; g.lineWidth = .6 + d.z * 1.1;
    g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - d.len * wind * .12, d.y - d.len * (1 + speedBoost)); g.stroke();
  }
  // soft out-of-focus city lights drifting up
  for (const m of motes) {
    m.x += m.vx * dt; m.y += m.vy * dt; m.a += .01 * dt;
    if (m.y < -40) { m.y = H + 40; m.x = Math.random() * W; }
    const al = (.05 + .04 * Math.sin(m.a)) * (1 + speedBoost * 3);
    const grd = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
    grd.addColorStop(0, m.warm ? `rgba(255,170,90,${al})` : `rgba(80,200,255,${al})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill();
  }
  // passing light streaks low on the road, a lot of them once you hit PLAY
  if (Math.random() < (.012 + speedBoost * .6) * dt) streaks.push({ x: -W * .3, y: H * (.62 + Math.random() * .34), len: W * (.12 + Math.random() * .3), v: W * (.02 + Math.random() * .03), c: Math.random() < .5 ? '255,59,31' : Math.random() < .5 ? '41,224,255' : '255,220,180' });
  for (let i = streaks.length - 1; i >= 0; i--) {
    const s = streaks[i]; s.x += s.v * dt * (1 + speedBoost * 2);
    const grd = g.createLinearGradient(s.x - s.len, 0, s.x, 0);
    grd.addColorStop(0, `rgba(${s.c},0)`); grd.addColorStop(1, `rgba(${s.c},.55)`);
    g.strokeStyle = grd; g.lineWidth = 2; g.beginPath(); g.moveTo(s.x - s.len, s.y); g.lineTo(s.x, s.y); g.stroke();
    if (s.x - s.len > W) streaks.splice(i, 1);
  }
  if (frame % 2 === 0) {
    const im = gg.createImageData(240, 135), px = im.data;
    for (let i = 0; i < px.length; i += 4) { const v = Math.random() * 255; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; }
    gg.putImageData(im, 0, 0);
  }
  pollPad();
  requestAnimationFrame(draw);
}
addEventListener('resize', size);

// mouse parallax: the art drifts against the cursor a little
addEventListener('pointermove', e => {
  const x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
  $('hero').style.translate = `${-x * 22}px ${-y * 12}px`;
  $('flare').style.translate = `${-x * 34}px ${-y * 18}px`;
  $('top').style.translate = `${x * 8}px ${y * 5}px`;
});

// ------------------------------------------------------------------------------------------------ intro
let ready = false;
function skipIntro() {
  document.body.classList.add('in', 'ready');
  document.querySelectorAll('#menu button, #logo, #status, #corner').forEach(el => el.getAnimations().forEach(a => a.finish()));
  if (!ready) { ready = true; focusItem(0, false); }
}
async function start() {
  size(); requestAnimationFrame(draw);
  const img = $('hero').querySelector('img');
  if (!img.complete) await new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 2500); });
  document.body.classList.add('in');
  startTheme();
  setTimeout(() => { if (!ready) { ready = true; document.body.classList.add('ready'); focusItem(0, false); } }, 2100);
}
start();
