// WebAudio synthesised sound effects: kick, whistle, crowd roar, net swish, post clang.
let ctx = null, master = null, noiseBuf = null, crowdGain = null, crowdSrc = null;
let muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}

export function setMuted(m) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.7, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

function noise(dur, type, freq, q, gainPeak, attack = 0.005, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gainPeak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  return { f, g, t };
}

function tone(freq, dur, type = 'sine', gain = 0.3, when = 0, slideTo = null) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}

export function sfx(name, strength = 1) {
  if (!ctx || muted) return;
  try {
    switch (name) {
      case 'kick': {
        const s = Math.min(1, Math.max(0.2, strength));
        tone(140 + 60 * s, 0.09, 'sine', 0.5 * s, 0, 55);
        noise(0.05, 'bandpass', 1800, 1.2, 0.25 * s);
        break;
      }
      case 'whistle': whistle(0, 0.28); break;
      case 'whistleLong': whistle(0, 0.25); whistle(0.33, 0.8); break;
      case 'whistleEnd': whistle(0, 0.3); whistle(0.4, 0.3); whistle(0.8, 1.0); break;
      case 'net': noise(0.35, 'highpass', 3000, 0.6, 0.35, 0.01); noise(0.25, 'bandpass', 900, 0.8, 0.15, 0.02); break;
      case 'post': tone(820, 0.5, 'triangle', 0.25); tone(1230, 0.35, 'sine', 0.12); break;
      case 'roar': {
        const n = noise(3.2, 'bandpass', 700, 0.5, 0.55, 0.25);
        if (n) n.f.frequency.linearRampToValueAtTime(1100, n.t + 1.2);
        noise(3.0, 'lowpass', 400, 0.7, 0.4, 0.3);
        break;
      }
      case 'ooh': { const n = noise(1.4, 'bandpass', 500, 2, 0.3, 0.15); if (n) n.f.frequency.linearRampToValueAtTime(320, n.t + 1.2); break; }
      case 'tackle': noise(0.12, 'lowpass', 600, 0.8, 0.3); break;
      case 'click': tone(660, 0.05, 'square', 0.08); break;
      case 'save': noise(0.15, 'lowpass', 900, 0.7, 0.4); tone(220, 0.12, 'sine', 0.25, 0, 90); break;
      default: break;
    }
  } catch (e) { /* ignore audio errors */ }
}

function whistle(when, dur) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2650;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 38;
  const lg = ctx.createGain(); lg.gain.value = 90;
  lfo.connect(lg); lg.connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
  g.gain.setValueAtTime(0.18, t + dur - 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}

/** Continuous low crowd murmur during matches. */
export function crowdAmbience(on) {
  if (!ctx) return;
  try {
    if (on && !crowdSrc) {
      crowdSrc = ctx.createBufferSource(); crowdSrc.buffer = noiseBuf; crowdSrc.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.4;
      crowdGain = ctx.createGain(); crowdGain.gain.value = 0.0001;
      crowdSrc.connect(f); f.connect(crowdGain); crowdGain.connect(master);
      crowdSrc.start();
      crowdGain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 1.5);
    } else if (!on && crowdSrc) {
      const s = crowdSrc; crowdSrc = null;
      crowdGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
      setTimeout(() => { try { s.stop(); } catch (e) { /* */ } }, 1200);
    }
  } catch (e) { /* ignore */ }
}
