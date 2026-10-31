// Plays the Ruff Dogs "REDLINE" studio intro (media/redline.mp4, rendered by the intro lab) full screen with sound.
// Any key, click or gamepad button skips it.
export class Intro {
  constructor() {
    this.root = document.getElementById('intro');
    this.video = document.getElementById('introvid');
    this.ready = false;
  }

  prepare() {
    return new Promise(res => {
      const v = this.video;
      const ok = () => { this.ready = true; res(true); };
      if (v.readyState >= 3) return ok();
      v.addEventListener('canplaythrough', ok, { once: true });
      v.addEventListener('error', () => res(false), { once: true });
      setTimeout(() => res(this.ready), 15000);
      v.load();
    });
  }

  play() {
    const v = this.video;
    if (!this.ready) return Promise.resolve();
    return new Promise(resolve => {
      this.root.classList.remove('hidden');
      v.muted = /[?&]mute/.test(location.search);
      v.currentTime = 0;
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        removeEventListener('keydown', skip); removeEventListener('pointerdown', skip); clearInterval(pad);
        // quick audio fade, then dissolve
        const v0 = v.volume, t0 = performance.now();
        const fade = () => { const k = Math.min(1, (performance.now() - t0) / 400); v.volume = v0 * (1 - k); if (k < 1) requestAnimationFrame(fade); else v.pause(); };
        fade();
        this.root.classList.add('gone');
        setTimeout(() => { this.root.classList.add('hidden'); v.removeAttribute('src'); v.load(); }, 900);
        resolve();
      };
      v.addEventListener('ended', finish, { once: true });
      // the click that unmutes a blocked intro shouldn't also skip it
      const skip = () => { if (this.justUnmuted) { this.justUnmuted = false; return; } finish(); };
      setTimeout(() => { addEventListener('keydown', skip); addEventListener('pointerdown', skip); }, 400);
      const pad = setInterval(() => { for (const p of navigator.getGamepads ? navigator.getGamepads() : []) if (p && p.buttons.some(b => b.pressed)) finish(); }, 100);
      // try with sound; if the browser blocks it, keep rolling muted and unmute on the first click/key
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => finish());
        const hint = document.getElementById('soundhint'); hint.classList.remove('hidden');
        const unmute = () => { this.justUnmuted = true; v.muted = /[?&]mute/.test(location.search); hint.classList.add('hidden'); window.__unlockAudio && window.__unlockAudio(); };
        addEventListener('pointerdown', unmute, { once: true, capture: true });
        addEventListener('keydown', unmute, { once: true, capture: true });
      });
    });
  }
}
