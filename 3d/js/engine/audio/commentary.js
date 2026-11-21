// Standalone: wire unlock() to a user gesture, onEvent() to match events,
// setMuted()/setVolume() to settings, and dispose() to match teardown.
const phrases = {
  goal: ['A fine finish.', 'The ball is in the net.', 'That is a goal.'],
  save: ['A strong save.', 'The keeper keeps it out.'],
  nearMiss: ['Just wide.', 'That was close.'],
  yellow: ['A yellow card.'], red: ['A red card.'],
  halftime: ['The whistle goes for half time.'], fulltime: ['The final whistle.'],
};
const volumeOf = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export function surnameOf(evt = {}) {
  const name = String(evt.surname || evt.playerName || '').trim().replace(/[^\p{L}\p{M}' -]/gu, '').slice(0, 80);
  return name.split(/\s+/).pop() || '';
}

export function createCommentary({ volume = 0.7 } = {}) {
  const synth = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  const supported = !!synth && typeof Utterance === 'function';
  let level = volumeOf(volume), muted = false, disposed = false, speaking = null;
  let lastSpoken = -Infinity, serial = 0, context, master, noise, crowd, chant;
  const enabled = () => supported && !muted && level > 0 && !disposed;

  function audio() {
    if (!enabled() || context) return;
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return;
    try {
      context = new Audio(); master = context.createGain(); master.gain.value = level * 0.22; master.connect(context.destination);
      crowd = context.createGain(); crowd.gain.value = 0; crowd.connect(master);
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = buffer.getChannelData(0); let smooth = 0;
      for (let i = 0; i < samples.length; i++) { smooth = (smooth + (Math.random() * 2 - 1) * 0.08) / 1.08; samples[i] = smooth; }
      noise = context.createBufferSource(); noise.buffer = buffer; noise.loop = true; noise.connect(crowd); noise.start();
      chant = context.createGain(); chant.gain.value = 0; chant.connect(master);
      const oscillator = context.createOscillator(); oscillator.type = 'triangle'; oscillator.frequency.value = 146.8;
      oscillator.connect(chant); oscillator.start(); chant.oscillator = oscillator;
    } catch { context?.close()?.catch?.(() => {}); context = null; }
  }

  async function unlock() {
    audio();
    try { if (context?.state === 'suspended') await context.resume(); } catch { /* autoplay denied */ }
  }

  function swell(strength) {
    audio(); if (!context || !crowd) return;
    const now = context.currentTime;
    crowd.gain.cancelScheduledValues(now); crowd.gain.setValueAtTime(crowd.gain.value, now);
    crowd.gain.linearRampToValueAtTime(strength, now + 0.35);
    crowd.gain.linearRampToValueAtTime(0, now + 3.5);
    chant.gain.cancelScheduledValues(now); chant.gain.setValueAtTime(0, now);
    for (let i = 0; i < 4; i++) {
      chant.gain.linearRampToValueAtTime(strength * 0.025, now + i * 0.6 + 0.15);
      chant.gain.linearRampToValueAtTime(0, now + i * 0.6 + 0.4);
    }
  }

  function stop() {
    if (speaking) { speaking = null; synth?.cancel(); }
    if (context && master) { master.gain.cancelScheduledValues(context.currentTime); master.gain.setValueAtTime(0, context.currentTime); }
    for (const node of [crowd, chant]) if (node && context) {
      node.gain.cancelScheduledValues(context.currentTime); node.gain.setValueAtTime(0, context.currentTime);
    }
  }

  function onEvent(evt = {}) {
    if (!enabled()) return false;
    const kind = evt.type === 'card' ? evt.card : ({ bigSave: 'save', bigsave: 'save', 'near-miss': 'nearMiss', nearmiss: 'nearMiss', post: 'nearMiss' }[evt.type] || evt.type);
    if (kind === 'attack') { swell(0.6); return true; }
    const lines = phrases[kind]; if (!lines) return false;
    const priority = kind === 'goal' || kind === 'fulltime';
    if (!priority && (speaking || Date.now() - lastSpoken < 2800 || synth.speaking)) return false;
    if (priority && speaking) { synth.cancel(); speaking = null; }
    else if (synth.speaking) return false;
    const surname = surnameOf(evt);
    const line = lines[serial++ % lines.length];
    const u = new Utterance(surname && ['goal', 'yellow', 'red'].includes(kind) ? `${surname}. ${line}` : line);
    u.volume = level; u.rate = 1.02; u.pitch = 1;
    u.onend = u.onerror = () => { if (speaking === u) speaking = null; };
    try { synth.speak(u); speaking = u; lastSpoken = Date.now(); if (kind === 'goal' || kind === 'save') swell(kind === 'goal' ? 1 : 0.5); return true; }
    catch { speaking = null; return false; }
  }

  return {
    supported, onEvent, unlock,
    setMuted(value) { muted = !!value; if (muted) stop(); else if (master) master.gain.value = level * 0.22; },
    setVolume(value) { level = volumeOf(value); if (!level) stop(); else if (master && !muted) master.gain.value = level * 0.22; if (speaking) speaking.volume = level; },
    dispose() { if (disposed) return; stop(); disposed = true; noise?.stop(); chant?.oscillator?.stop(); context?.close()?.catch?.(() => {}); },
  };
}
