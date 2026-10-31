// Builds the desktop (PC) version OUTSIDE the game folder, in ../../overdrive-build, so nothing with music in it
// can ever be uploaded to GitHub by accident.
//   node build.js start    run it on this computer
//   node build.js win      make the Windows version  ->  overdrive-build/dist/OVERDRIVE-win32-x64/OVERDRIVE.exe
//   node build.js mac      make the Mac version
// The radio songs go in LOCKED (.odm files from ../../overdrive-music/locked), never as mp3s.
const fs = require('fs');
const path = require('path');

const GAME = path.join(__dirname, '..');
const BUILD = path.join(GAME, '..', 'overdrive-build');
const STAGE = path.join(BUILD, 'stage');
const MUSIC = path.join(process.env.OVERDRIVE_MUSIC || path.join(GAME, '..', 'overdrive-music'), 'locked');
const SKIP = new Set(['server', 'desktop', 'tools', 'node_modules']);

function copy(src, dst, top) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('.') || (top && SKIP.has(e.name)) || /\.(mp3|wav|flac)$/i.test(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, d, false); }
    else fs.copyFileSync(s, d);
  }
}

function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGE, 'app'), { recursive: true });
  for (const f of ['main.js', 'preload.js', 'config.json']) fs.copyFileSync(path.join(__dirname, f), path.join(STAGE, f));
  const pkg = require('./package.json');
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, author: pkg.author, main: 'main.js' }, null, 1));
  copy(GAME, path.join(STAGE, 'app'), true);
  let songs = 0;
  if (fs.existsSync(MUSIC)) {
    fs.mkdirSync(path.join(STAGE, 'app', 'media', 'music'), { recursive: true });
    for (const f of fs.readdirSync(MUSIC)) if (f.endsWith('.odm')) { fs.copyFileSync(path.join(MUSIC, f), path.join(STAGE, 'app', 'media', 'music', f)); songs++; }
  }
  console.log(`staged in ${STAGE}: game + ${songs} locked song(s)${songs ? '' : ' (run lock-music.py first to include radio music)'}`);
}

async function main() {
  const mode = process.argv[2] || 'start';
  stage();
  if (mode === 'start') {
    const { spawn } = require('child_process');
    spawn(require('electron'), [STAGE], { stdio: 'inherit' }).on('exit', c => process.exit(c || 0));
    return;
  }
  const P = require('@electron/packager'), packager = P.packager || P.default || P;
  const out = await packager({
    dir: STAGE, out: path.join(BUILD, 'dist'), overwrite: true, asar: true, name: 'OVERDRIVE',
    platform: mode === 'mac' ? 'darwin' : 'win32', arch: mode === 'mac' ? 'universal' : 'x64',
    electronVersion: require('electron/package.json').version,
    appCopyright: '(c) 2026 Ruff Dogs Studios',
  });
  console.log('built:', out.join(', '));
}
main().catch(e => { console.error(e); process.exit(1); });
