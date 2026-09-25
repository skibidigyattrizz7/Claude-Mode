// WebAudio-synthesised match audio: crowd ambience that swells near goal, kicks, whistle,
// net, woodwork, goal roar, "ooh" on saves/misses. No audio files.
export class MatchAudio {
  constructor() {
    this.ctx = null;
    this.ok = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    this.excite = 0;
    this.roar = 0;
    this.muted = false;
    this._gesture = () => this.unlock();
    if (this.ok) {
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, this._gesture, { passive: true });
    }
  }

  unlock() {
    if (!this.ok) return;
    try {
      if (!this.ctx) this._init();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ok = false; }
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    // noise buffers
    const len = ctx.sampleRate * 4;
    const brown = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = brown.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    const white = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const wd = white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.white = white;
    // crowd bed
    const bed = ctx.createBufferSource(); bed.buffer = brown; bed.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 900;
    const bg = ctx.createGain(); bg.gain.value = 0.25;
    bed.connect(bf).connect(bg).connect(this.master);
    bed.start();
    // murmur / chant layer
    const mur = ctx.createBufferSource(); mur.buffer = brown; mur.loop = true; mur.playbackRate.value = 1.7;
    const mf = ctx.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 700; mf.Q.value = 1.1;
    const mg = ctx.createGain(); mg.gain.value = 0.0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.45;
    const lg = ctx.createGain(); lg.gain.value = 0.05;
    lfo.connect(lg).connect(mg.gain);
    lfo.start();
    mur.connect(mf).connect(mg).connect(this.master);
    mur.start();
    this.bed = { src: bed, filter: bf, gain: bg };
    this.mur = { src: mur, filter: mf, gain: mg, lfo };
  }

  // per-frame: excitement 0..1 (ball near goal, attacks)
  update(dt, excitement, paused) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.excite += (excitement - this.excite) * Math.min(1, dt * 1.2);
    this.roar = Math.max(0, this.roar - dt * 0.18);
    const e = Math.min(1, this.excite + this.roar);
    const target = paused || this.muted ? 0.02 : 0.18 + e * 0.5;
    this.bed.gain.gain.setTargetAtTime(target, t, 0.3);
    this.bed.filter.frequency.setTargetAtTime(600 + e * 1600, t, 0.4);
    this.mur.gain.gain.setTargetAtTime(paused || this.muted ? 0 : 0.06 + e * 0.25, t, 0.4);
    this.mur.filter.frequency.setTargetAtTime(650 + e * 700, t, 0.5);
  }

  _noise(dur, type, freq, q, gain, when = 0, sweepTo) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t); s.stop(t + dur + 0.05);
  }

  _tone(freq, dur, type, gain, when = 0, freqEnd) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  kick(speed = 10) {
    if (!this.ctx || this.muted) return;
    const k = Math.min(1, speed / 30);
    this._tone(110 + k * 40, 0.09 + k * 0.05, 'sine', 0.25 + k * 0.45, 0, 50);
    this._noise(0.05, 'lowpass', 1800 + k * 2000, 0.7, 0.12 + k * 0.25);
  }

  whistle(n = 1) {
    if (!this.ctx || this.muted) return;
    const blow = (when, dur) => {
      const ctx = this.ctx, t = ctx.currentTime + when;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 2750;
      const v = ctx.createOscillator(); v.frequency.value = 38;
      const vg = ctx.createGain(); vg.gain.value = 90;
      v.connect(vg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.setValueAtTime(0.16, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2800; f.Q.value = 3;
      o.connect(f).connect(g).connect(this.master);
      o.start(t); v.start(t); o.stop(t + dur + 0.05); v.stop(t + dur + 0.05);
    };
    if (n === 0 || n === 1) blow(0, n === 0 ? 0.45 : 0.3);
    else if (n === 2) { blow(0, 0.25); blow(0.35, 0.8); }
    else { blow(0, 0.25); blow(0.35, 0.25); blow(0.7, 1.1); }
  }

  net(s = 8) {
    if (!this.ctx || this.muted) return;
    this._noise(0.35, 'bandpass', 2400, 0.8, Math.min(0.35, 0.05 + s * 0.015), 0, 700);
  }

  post() {
    if (!this.ctx || this.muted) return;
    this._tone(1180, 0.5, 'sine', 0.3); this._tone(1870, 0.35, 'sine', 0.15); this._tone(640, 0.25, 'triangle', 0.15);
    this.ooh();
  }

  ooh() {
    if (!this.ctx || this.muted) return;
    this._noise(1.4, 'bandpass', 380, 2.2, 0.45, 0.05, 700);
    this._noise(1.2, 'bandpass', 900, 2.0, 0.25, 0.1, 500);
  }

  goal() {
    if (!this.ctx || this.muted) return;
    this.roar = 1.2;
    this._noise(4.5, 'bandpass', 500, 0.7, 0.9, 0, 1400);
    this._noise(4.0, 'bandpass', 1500, 0.9, 0.4, 0.2, 900);
  }

  cheer(k = 0.5) {
    if (!this.ctx || this.muted) return;
    this.roar = Math.max(this.roar, k);
  }

  dispose() {
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, this._gesture);
    if (this.ctx) {
      try { this.bed.src.stop(); this.mur.src.stop(); this.mur.lfo.stop(); } catch { /* already stopped */ }
      try { this.ctx.close(); } catch { /* ignore */ }
      this.ctx = null;
    }
  }
}
