// OVERDRIVE desktop (PC) build: the same game in its own window, running from local files.
// It plays online through the hosted server named in config.json, so PC players and browser players race together.
//
// Auto-update: on every launch it reads version.json from the OverDrive GitHub repo. If the repo has a newer version,
// it downloads just the changed game files into the player's app-data folder and runs those. Publishing an update
// = uploading the game to GitHub with a bumped version.json (desktop/release.py). The radio songs are never on GitHub;
// they always come from inside the .exe.
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const crypto = require('crypto');

const BUNDLED = path.join(__dirname, 'app');                        // the game files shipped inside the .exe
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const UPDATES = (config.updates || 'https://raw.githubusercontent.com/ROCKSTARB0I/OverDrive/main/').replace(/\/?$/, '/');
let ROOT = BUNDLED;                                                 // where the game is served from this run

// the game loads from app://overdrive/ so ES modules, fetch and saved sign-ins all work like on the web
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');   // the studio intro plays with sound

const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex');
const inside = (dir, rel) => { const f = path.normalize(path.join(dir, rel)); return f.startsWith(dir + path.sep) ? f : null; };

async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await net.fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error(r.status + ' ' + url); return r; }
  finally { clearTimeout(t); }
}

// returns the folder to run the game from: the newest of (shipped copy, last downloaded update, fresh update)
async function update(onProgress) {
  const data = app.getPath('userData'), live = path.join(data, 'game'), next = path.join(data, 'game-next');
  const shipped = readJSON(path.join(BUNDLED, 'version.json')) || { version: 0, files: {} };
  let current = { dir: BUNDLED, man: shipped };
  const have = readJSON(path.join(live, 'version.json'));
  if (have && have.version > shipped.version) current = { dir: live, man: have };

  let remote;
  try { remote = await (await fetchWithTimeout(UPDATES + 'version.json?t=' + Date.now(), 5000)).json(); }
  catch (e) { return current.dir; }                                 // offline or GitHub unreachable: play what we have
  if (!remote || !(remote.version > current.man.version) || !remote.files) return current.dir;

  try {
    fs.rmSync(next, { recursive: true, force: true });
    const list = Object.entries(remote.files);
    let done = 0;
    for (const [rel, hash] of list) {
      const dst = inside(next, rel); if (!dst) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      const old = inside(current.dir, rel);
      if (current.man.files[rel] === hash && old && fs.existsSync(old)) fs.copyFileSync(old, dst);   // unchanged: reuse
      else {
        const buf = Buffer.from(await (await fetchWithTimeout(UPDATES + rel.split('/').map(encodeURIComponent).join('/') + '?v=' + remote.version, 120000)).arrayBuffer());
        if (sha1(buf) !== hash) throw new Error('bad download: ' + rel);
        fs.writeFileSync(dst, buf);
      }
      onProgress(++done / list.length, remote.version);
    }
    fs.writeFileSync(path.join(next, 'version.json'), JSON.stringify(remote));
    fs.rmSync(live, { recursive: true, force: true });
    fs.renameSync(next, live);
    return live;
  } catch (e) {
    console.error('update failed, playing the current version:', e);
    fs.rmSync(next, { recursive: true, force: true });
    return current.dir;
  }
}

const updatingPage = `data:text/html,${encodeURIComponent(`<!doctype html><body style="margin:0;background:#000;color:#fff;display:grid;place-items:center;height:100vh;font:600 14px/1.4 system-ui,sans-serif;letter-spacing:.3em">
  <div style="text-align:center"><div style="font-size:42px;font-weight:900;font-style:italic;letter-spacing:.05em">OVER<span style="color:#ff3b1f">DRIVE</span></div>
  <div id="m" style="margin-top:18px;color:#9aa0ab">CHECKING FOR UPDATES</div>
  <div style="width:320px;height:3px;background:#222;margin:14px auto 0"><div id="b" style="height:100%;width:0;background:#ff3b1f;transition:width .2s"></div></div></div></body>`)}`;

app.whenReady().then(async () => {
  protocol.handle('app', req => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    // locked songs (and anything else too big for GitHub, like the intro video) only ship inside the .exe;
    // everything else comes from the current game version
    let file = inside(rel.startsWith('media/music/') ? BUNDLED : ROOT, rel);
    if (file && !fs.existsSync(file)) file = inside(BUNDLED, rel);
    if (!file) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 600, backgroundColor: '#000000', title: 'OVERDRIVE',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  win.removeMenu();
  if (config.fullscreen) win.setFullScreen(true);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // links (GitHub, Terms) open in the real browser, never inside the game window
  win.webContents.setWindowOpenHandler(({ url }) => { require('electron').shell.openExternal(url); return { action: 'deny' }; });

  await win.loadURL(updatingPage);
  ROOT = await update((k, v) => win.webContents.executeJavaScript(
    `document.getElementById('m').textContent='DOWNLOADING UPDATE ${v}';document.getElementById('b').style.width='${Math.round(k * 100)}%'`).catch(() => { }));
  win.loadURL('app://overdrive/index.html');
});

app.on('window-all-closed', () => app.quit());
