// Prototype 7-Claude: synthesized sound effects (WebAudio, no files, no voices). M toggles mute.
// One call per sim event; each sound is a short envelope on an oscillator or a filtered noise burst.
export function createSfx() {
  let ac = null, master = null, muted = false, hum = null, noiseBuf = null;
  const last = {};
  function init() {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ac = new AC(); master = ac.createGain(); master.gain.value = muted ? 0 : 0.5;
    const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const unlock = () => { init(); if (ac && ac.state === 'suspended') ac.resume(); };
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  function tone(f0, f1, dur, type = 'sine', vol = 0.3, at = 0) {
    if (!ac) return; const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, freq, vol = 0.3, q = 1, type = 'lowpass', at = 0, f1 = null) {
    if (!ac) return; const t = ac.currentTime + at, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02);
  }
  const boom = (v = 0.6) => { tone(120, 35, 0.5, 'sine', v); noise(0.4, 600, v * 0.6, 1, 'lowpass', 0, 80); };
  // rate-limit so 15 presses or a volley don't stack into mush
  const gate = (k, ms) => { const n = performance.now(); if (n - (last[k] || 0) < ms) return false; last[k] = n; return true; };
  function play(e, s) {
    if (!ac || muted) return;
    switch (e.type) {
      case 'fire': if (gate('fire', 60)) noise(0.08, 3000, 0.12, 2, 'highpass'); break;
      case 'cast': if (e.name === 'nova') { tone(220, 880, 0.35, 'sawtooth', 0.12); noise(0.4, 1200, 0.2, 1, 'bandpass', 0, 4000); } else tone(660, 1320, 0.12, 'triangle', 0.12); break;
      case 'bossHit': if (gate('hit', 45)) { const big = ['finisher', 'nova', 'burst', 'counter', 'eyes'].includes(e.kind); tone(big ? 180 : 320, big ? 60 : 140, big ? 0.25 : 0.09, 'square', big ? 0.18 : 0.08); noise(big ? 0.2 : 0.06, big ? 1500 : 2500, big ? 0.3 : 0.12); } break;
      case 'heroHit': tone(200, 70, 0.22, 'sawtooth', 0.22); noise(0.18, 900, 0.3); break;
      case 'dodge': noise(0.16, 800, 0.12, 1, 'bandpass', 0, 3000); break;
      case 'perfect': tone(880, 1760, 0.3, 'sine', 0.2); tone(1320, 2640, 0.3, 'sine', 0.1, 0.04); break;
      case 'heal': [523, 659, 784].forEach((f, i) => tone(f, f, 0.3, 'sine', 0.15, i * 0.07)); break;
      case 'healGain': tone(784, 1046, 0.25, 'sine', 0.15); break;
      case 'tell': if (gate('tell', 300)) tone(140, 110, 0.25, 'sawtooth', 0.06); break;
      case 'slam': case 'impact': case 'chainSlam': if (gate('boom', 70)) boom(e.big ? 0.7 : 0.5); break;
      case 'clap': boom(0.6); noise(0.12, 4000, 0.3, 1, 'highpass'); break;
      case 'laser': if (gate('laser', 80)) { tone(900, 300, 0.5, 'sawtooth', 0.1); noise(0.5, 2500, 0.15, 3, 'bandpass'); } break;
      case 'heroBeam': tone(1200, 600, 0.3, 'sawtooth', 0.08); break;
      case 'hole': tone(60, 30, 1.2, 'sine', 0.3); break;
      case 'holeEnd': boom(0.4); break;
      case 'chainThrow': noise(0.3, 1800, 0.15, 6, 'bandpass'); break;
      case 'chained': tone(100, 60, 0.3, 'square', 0.15); noise(0.25, 2400, 0.2, 8, 'bandpass'); break;
      case 'chainBreak': noise(0.4, 5000, 0.3, 1, 'highpass'); tone(600, 1200, 0.2, 'triangle', 0.15); break;
      case 'qteGood': tone(660 + Math.random() * 60, 700, 0.07, 'square', 0.08); break;
      case 'qteBad': case 'runeFail': tone(160, 90, 0.3, 'square', 0.14); break;
      case 'runeStart': tone(330, 330, 0.5, 'triangle', 0.1); tone(495, 495, 0.5, 'triangle', 0.06); break;
      case 'runeWin': [392, 523, 659, 784].forEach((f, i) => tone(f, f, 0.25, 'triangle', 0.12, i * 0.05)); break;
      case 'finisherReady': tone(1046, 1568, 0.3, 'square', 0.08); tone(1568, 2093, 0.3, 'square', 0.05, 0.1); break;
      case 'finisherStart': noise(0.8, 300, 0.25, 1, 'lowpass', 0, 4000); break;
      case 'finisherSlash': noise(0.15, 6000, 0.3, 1, 'highpass'); tone(1800, 400, 0.15, 'sawtooth', 0.08); break;
      case 'finisherHit': boom(0.9); noise(0.6, 8000, 0.2, 1, 'highpass', 0.02); break;
      case 'boxStart': tone(440, 220, 0.3, 'square', 0.08); break;
      case 'timingStart': tone(880, 880, 0.08, 'square', 0.06); break;
      case 'timingResult': if (e.result === 'perfect') { boom(0.6); tone(1320, 2640, 0.4, 'sine', 0.15); } else if (e.result === 'good') boom(0.4); else tone(200, 120, 0.2, 'square', 0.08); break;
      case 'bossDodge': noise(0.18, 1200, 0.12, 2, 'bandpass', 0, 400); break;
      case 'clashStart': startHum(s); boom(0.7); break;
      case 'clashPress': if (gate('press', 40)) tone(300 + (e.p || 0.5) * 500, 200 + (e.p || 0.5) * 400, 0.06, 'square', 0.05); break;
      case 'clashEscalate': boom(0.4); tone(440, 880, 0.3, 'sawtooth', 0.08); break;
      case 'clashWin': stopHum(); boom(1); noise(1.2, 6000, 0.3, 1, 'lowpass', 0, 200); break;
      case 'cineBeat': if (e.at === 0.5) { boom(0.9); noise(1.4, 200, 0.3, 1, 'lowpass', 0, 6000); } else tone(110, 90, 0.6, 'sawtooth', 0.06); break;
      case 'bossDown': boom(0.8); break;
      case 'miss': tone(500, 380, 0.08, 'triangle', 0.05); break;
      case 'block': if (gate('block', 50)) tone(1400, 1800, 0.05, 'square', 0.04); break;
      case 'lanceHit': noise(0.12, 5000, 0.3, 1, 'highpass'); boom(0.5); break;
      case 'sealBoom': [523, 784, 1046].forEach((f, i) => tone(f, f * 0.5, 0.4, 'sawtooth', 0.08, i * 0.03)); boom(0.7); break;
      case 'judgement': tone(1600, 200, 0.6, 'sawtooth', 0.1); boom(0.8); break;
      case 'totalityHit': boom(1); tone(80, 30, 1.4, 'sawtooth', 0.2); noise(1, 8000, 0.25, 1, 'lowpass', 0, 300); break;
      case 'fqStart': [659, 880, 1175].forEach((f, i) => tone(f, f, 0.12, 'square', 0.06, i * 0.05)); break;
      case 'fqWin': [784, 988, 1175, 1568].forEach((f, i) => tone(f, f, 0.2, 'triangle', 0.1, i * 0.04)); break;
      case 'fqFail': tone(220, 80, 0.5, 'sawtooth', 0.14); break;
      case 'swordThrow': noise(0.5, 900, 0.2, 4, 'bandpass', 0, 5000); break;
      case 'swordHit': stopHum(); boom(1); noise(1.4, 7000, 0.3, 1, 'lowpass', 0, 200); tone(2093, 1046, 0.6, 'triangle', 0.1); break;
      case 'talkLine': tone(e.who === 'hero' ? 660 : 220, e.who === 'hero' ? 700 : 200, 0.06, 'square', 0.05); break;
      case 'clashSeq': [523, 659].forEach((f, i) => tone(f, f, 0.18, 'square', 0.07, i * 0.12)); break;
      case 'clashSeqWin': [784, 988, 1318].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.1, i * 0.04)); boom(0.5); break;
      case 'clashLost': tone(160, 50, 0.7, 'sawtooth', 0.22); noise(0.4, 600, 0.35); boom(0.8); break;
      case 'clashRetry': tone(330, 660, 0.25, 'triangle', 0.1); break;
      case 'clashSeqFail': tone(200, 90, 0.4, 'sawtooth', 0.13); break;
      case 'victory': [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.6, 'triangle', 0.12, i * 0.12)); break;
      case 'defeat': stopHum(); tone(220, 55, 1.2, 'sawtooth', 0.15); break;
    }
  }
  // ---- music: a small step sequencer per phase (kick, hats, bass, pad, arps); ducks under dialogue/cines/clashes
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const SONG = {
    1: { bpm: 104, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], kick: [0, 8], arp: false, lead: 'triangle' },
    2: { bpm: 132, chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [57, 61, 64]], kick: [0, 4, 8, 12], arp: true, lead: 'sawtooth' },
    3: { bpm: 150, chords: [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 51, 54]], kick: [0, 4, 8, 10, 12], arp: true, lead: 'square' },
  };
  let mus = null;
  function toneAt(t, f0, f1, dur, type, vol) { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02); }
  function noiseAt(t, dur, freq, vol) { const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); src.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02); }
  function musicStep(S, step, t, spb) {
    const v = 0.07 * mus.duck, b16 = step % 16, chord = S.chords[Math.floor(step / 16) % 4];
    if (S.kick.includes(b16)) toneAt(t, 140, 40, 0.22, 'sine', v * 2.6);
    if (b16 % 4 === 2) noiseAt(t, 0.05, 7000, v * 0.9);
    if ([0, 3, 6, 8, 11, 14].includes(b16)) toneAt(t, midi(chord[0] - 24), midi(chord[0] - 24), spb * 1.6, 'sawtooth', v * 0.9);
    if (b16 === 0) chord.forEach((n) => toneAt(t, midi(n), midi(n), spb * 15, 'sine', v * 0.45));
    if (S.arp && b16 % 2 === 0) toneAt(t, midi(chord[(step / 2) % 3 | 0] + 12), midi(chord[(step / 2) % 3 | 0] + 12), spb * 1.4, S.lead, v * 0.35);
  }
  function musicTick() {
    if (!ac || !mus) return;
    if (muted) { mus.next = ac.currentTime + 0.1; return; }
    const S = SONG[mus.stage], spb = 60 / S.bpm / 4;
    if (mus.next < ac.currentTime) mus.next = ac.currentTime + 0.05;
    while (mus.next < ac.currentTime + 0.12) { musicStep(S, mus.step, mus.next, spb); mus.next += spb; mus.step++; }
  }
  function startHum(s) {
    stopHum(); if (!ac) return;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = 55; o2.frequency.value = 55.7; f.type = 'lowpass'; f.frequency.value = 400; g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + 1.2);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master); o1.start(); o2.start();
    hum = { o1, o2, g, f };
  }
  function stopHum() { if (!hum || !ac) return; const h = hum; hum = null; h.g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.08); setTimeout(() => { h.o1.stop(); h.o2.stop(); }, 400); }
  return {
    play,
    // the clash hum rises in pitch and brightness as the player pushes
    update(s) {
      if (ac && !mus && ['fight', 'talk', 'box'].includes(s.phase)) { mus = { next: ac.currentTime + 0.1, step: 0, stage: s.stage, duck: 1, timer: setInterval(musicTick, 25) }; }
      if (mus) { if (mus.stage !== s.stage) { mus.stage = s.stage; mus.step = 0; } mus.duck = ['talk', 'cine', 'finisherQte'].includes(s.phase) ? 0.4 : s.phase === 'clash' ? 0.55 : 1; if (['victory', 'defeat'].includes(s.phase)) { clearInterval(mus.timer); mus = null; } } if (hum && s.clash) { const p = s.clash.p; hum.o1.frequency.value = 55 + p * 55; hum.o2.frequency.value = 55.7 + p * 56; hum.f.frequency.value = 300 + p * 2200; } else if (hum && s.phase !== 'clash') stopHum(); },
    toggle() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; if (muted) stopHum(); return muted; },
    get muted() { return muted; },
  };
}
