// Prototype 2-Claude: renderer. Draws everything from the sim state; VFX live on their own clock so hit-stop
// and slow-mo freeze the fight but not the sparks. Three looks: NIGHT (phase 1), EMBER (phase 2), TOTALITY (secret).
import { W, H, FLOOR, BOX, clamp, lerp, easeOut, STAGES, HERO_MAX, HEAL, ABIL, ABIL_ORDER, FIN, CLASH, aligned } from './sim.js?v=2';

const TAU = Math.PI * 2;
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1, x = clamp(t, 0, 1) - 1; return 1 + c3 * x * x * x + c1 * x * x; };
const font = (px, wt = 700) => `${wt} ${px}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
const ATTACK_NAMES = { orbs: 'VOLLEY', slam: 'HAND SLAM', chains: 'CHAINS', rune: 'RUNE LOCK', catch: 'CATCH', earth: 'EARTH THROW', laser: 'EYE LASER',
  cross: 'CROSSFIRE', doom: 'DOOMFALL', gravity: 'GRAVITY WELL', spiral: 'SPIRAL', corona: 'CORONA SWEEP', twin: 'TWIN HOLES' };
// palettes: danger is always red-family, safe is always pale green, the hero colour is always the player's
const P = {
  1: { sky: ['#061316', '#0c2427', '#050708'], floor: '#0b1a1c', grid: 'rgba(120,230,220,.12)', horizon: 'rgba(140,240,230,.35)', sun: '#ffd08a', sunGlow: 'rgba(255,190,110,.22)',
    ember: '#ffc27a', ruin: ['#0a1b1d', '#0e2528'], boss: '#e6b56e', bossGlow: 'rgba(255,170,90,.25)', core: 'rgba(255,190,110,.85)', orb: 'rgba(255,100,60,.55)', orbCore: '#fff1d8',
    tele: '#ff5a3a', teleFill: '255,70,40', hero: '#9ff8ff', heroBody: '#1d3b4a', heroTrim: '#2d5a6e', heroHead: '#16303c', bar: '#e6a54a', name: '#ffd7a1' },
  2: { sky: ['#160405', '#3a0d0b', '#060303'], floor: '#1f0907', grid: 'rgba(255,90,60,.16)', horizon: 'rgba(255,120,80,.45)', sun: '#ff6a3a', sunGlow: 'rgba(255,90,50,.35)',
    ember: '#ff7a4a', ruin: ['#200a09', '#2b0e0c'], boss: '#ff6a3a', bossGlow: 'rgba(255,80,40,.35)', core: 'rgba(255,80,40,.9)', orb: 'rgba(255,60,40,.6)', orbCore: '#ffe2d0',
    tele: '#ff4a2a', teleFill: '255,60,30', hero: '#ffe08a', heroBody: '#e9e2cf', heroTrim: '#c79a4a', heroHead: '#f6f0e0', bar: '#ff5a3a', name: '#ff8a6b' },
  3: { sky: ['#000000', '#05060a', '#000000'], floor: '#030305', grid: 'rgba(255,255,255,.09)', horizon: 'rgba(255,255,255,.6)', sun: '#000000', sunGlow: 'rgba(255,248,230,.3)',
    ember: '#ffffff', ruin: ['#07080b', '#0b0c10'], boss: '#f4efe4', bossGlow: 'rgba(255,250,235,.22)', core: 'rgba(255,255,255,.9)', orb: 'rgba(255,50,95,.55)', orbCore: '#ffffff',
    tele: '#ff3b5c', teleFill: '255,40,80', hero: '#7ff6ff', heroBody: '#05070a', heroTrim: '#7ff6ff', heroHead: '#000000', bar: '#ffffff', name: '#ffffff' },
};

export function createRenderer(canvas, { reducedMotion = false, onEvent = null } = {}) {
  let ctx = canvas.getContext('2d'); // swapped briefly while painting the cached sky
  const skyCache = {};
  let fx;
  const reset = () => {
    fx = { particles: [], numbers: [], rings: [], slashes: [], trauma: 0, flash: 0, flashColor: '#fff', invert: 0, zoom: 1, camX: 0, camY: 0, clock: 0,
      embers: Array.from({ length: 52 }, (_, i) => ({ x: (i * 211) % W, y: (i * 97) % H, s: 0.4 + (i % 5) * 0.25, ph: i })), scorch: [], cracks: [], vignette: 0,
      callout: null, bossGone: false, dawn: 0, last: null, dock: [], formShown: 1, clashPulse: 0, chroma: 0 };
  };
  reset();
  const P_MAX = 220;
  const part = (x, y, n, color, speed = 260, life = 0.6, size = 3, grav = 300) => {
    for (let i = 0; i < n && fx.particles.length < P_MAX; i++) {
      const a = Math.random() * TAU, v = speed * (0.35 + Math.random() * 0.65);
      fx.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.25, life, max: life, size: size * (0.6 + Math.random() * 0.8), color, grav });
    }
  };
  const num = (x, y, text, color, big = false) => { fx.numbers.push({ x, y, text, color, t: 0, big }); if (fx.numbers.length > 18) fx.numbers.shift(); };
  const ring = (x, y, color, r0, r1, life, w = 4, flat = 1) => { fx.rings.push({ x, y, color, r0, r1, t: 0, life, w, flat }); if (fx.rings.length > 28) fx.rings.shift(); };
  const shake = (amt) => { if (!reducedMotion) fx.trauma = Math.min(1, fx.trauma + amt); };
  const flash = (color, amt) => { if (!reducedMotion) { fx.flash = Math.max(fx.flash, amt); fx.flashColor = color; } };
  const negative = (t = 0.07) => { if (!reducedMotion) fx.invert = Math.max(fx.invert, t); };

  // which look to show: the cines switch forms halfway through the transformation
  function form(s) {
    if (s.phase === 'cine' && s.cine) {
      const k = s.cine.t / s.cine.len;
      if (s.cine.kind === 'reborn') return k >= 0.5 ? 2 : 1;
      if (s.cine.kind === 'totality') return k >= 0.5 ? 3 : 2;
    }
    return s.stage;
  }

  function consume(s) {
    const pal = P[form(s)];
    for (const e of s.events) {
      if (onEvent) onEvent(e, s);
      switch (e.type) {
        case 'bossHit': {
          const big = ['finisher', 'nova', 'burst', 'counter', 'eyes'].includes(e.kind), mid = big || ['reflect', 'break', 'star'].includes(e.kind);
          part(e.x, e.y, big ? 22 : 6, big ? '#ffd68a' : pal.hero, big ? 420 : 240, big ? 0.7 : 0.4, big ? 4 : 2.5);
          num(e.x + (Math.random() - 0.5) * 30, e.y - 20, String(e.dmg), big ? '#ffd27a' : '#eaf6ff', big);
          if (mid) { shake(big ? 0.4 : 0.2); ring(e.x, e.y, '#ffe1a8', 10, big ? 120 : 70, 0.35, big ? 6 : 3); }
          if (big && s.stage === 3) negative(0.05);
          if (e.kind === 'nova' || e.kind === 'burst') s.hitstop = Math.max(s.hitstop, 0.06);
          break;
        }
        case 'heroHit': shake(0.42); part(e.x, e.y, 12, '#ff6d5a', 280, 0.5, 3); num(e.x, e.y - 30, '-' + e.dmg, '#ff7a66'); fx.vignette = 0.5; fx.chroma = 0.25; s.hitstop = Math.max(s.hitstop, 0.05); break;
        case 'fire': part(e.x, e.y, 4, pal.hero, 160, 0.3, 2.5, 0); break;
        case 'cast': part(e.x, e.y, e.name === 'nova' ? 26 : 10, e.name === 'nova' ? '#ffe0a0' : pal.hero, e.name === 'nova' ? 360 : 220, 0.4, 3, 0); ring(e.x, e.y, pal.hero, 6, e.name === 'nova' ? 90 : 46, 0.3, 3); if (e.name === 'nova') shake(0.25); break;
        case 'splash': ring(e.x, e.y, e.kind === 'nova' ? '#ffe7b8' : pal.hero, 10, e.r, 0.45, 6); part(e.x, e.y, 18, '#ffe7b8', 380, 0.6, 3.5); break;
        case 'heroBeam': shake(0.2); break;
        case 'bossDodge': num(e.x, e.y - 250, 'DODGED', '#c8d0d6'); for (let i = 0; i < 3; i++) fx.rings.push({ x: e.x, y: e.y - 90, color: pal.boss, r0: 60, r1: 140, t: i * 0.05, life: 0.35, w: 2, flat: 1.4 }); break;
        case 'dodge': ring(e.x, e.y - 40, '#d7f3ff', 8, 46, 0.25, 2); break;
        case 'perfect': num(e.x, e.y - 110, 'PERFECT', '#9ff8ff', true); ring(e.x, e.y - 40, '#9ff8ff', 10, 140, 0.5, 3); flash('#bff4ff', 0.16); if (s.stage === 3) negative(0.06); break;
        case 'heal': part(e.x, e.y - 50, 24, '#9ff0c4', 200, 0.9, 3, -120); ring(e.x, e.y - 40, '#9ff0c4', 20, 90, 0.5, 3); num(e.x, e.y - 120, '+' + HEAL, '#9ff0c4', true); break;
        case 'healGain': num(640, 300, '+1 HEAL', '#9ff0c4', true); break;
        case 'tell': fx.callout = { text: ATTACK_NAMES[e.kind] || '', t: 0 }; break;
        case 'slam': shake(0.55); part(e.x, e.y, 26, '#c9a27a', 380, 0.8, 4); ring(e.x, e.y, pal.tele, 20, 160, 0.45, 6, 0.36); addScar(e.x, e.y); break;
        case 'impact': shake(e.big ? 0.6 : 0.35); part(e.x, e.y, e.big ? 30 : 16, e.big ? '#d8b48a' : pal.tele, e.big ? 420 : 300, 0.7, 4); ring(e.x, e.y, pal.tele, 20, e.big ? 170 : 110, 0.4, 5, 0.36); addScar(e.x, e.y); break;
        case 'clap': shake(0.5); ring(e.x, e.y, '#ffe1c8', 10, 260, 0.4, 6, 0.5); part(e.x, e.y, 24, '#ffd2b0', 420, 0.5, 3); break;
        case 'laser': shake(0.3); flash(pal.tele, 0.06); break;
        case 'hole': shake(0.3); ring(e.x, e.y, pal.tele, 140, 10, 0.5, 5, 0.36); break;
        case 'holeEnd': ring(e.x, e.y, '#ffb18a', 10, 220, 0.6, 3, 0.36); part(e.x, e.y, 30, '#ff8a5a', 420, 0.7, 3); shake(0.35); break;
        case 'chainThrow': shake(0.1); break;
        case 'chained': shake(0.45); flash('#ff4b3a', 0.12); break;
        case 'chainBreak': part(e.x, e.y - 40, 34, '#d8dee8', 460, 0.8, 3.5); ring(e.x, e.y - 40, '#e9f6ff', 10, 170, 0.5, 5); shake(0.5); flash('#ffffff', 0.22); break;
        case 'chainSlam': shake(0.6); break;
        case 'qteGood': shake(0.08); break;
        case 'qteBad': shake(0.2); break;
        case 'runeWin': flash('#ffe7b0', 0.3); shake(0.5); part(640, 220, 40, '#ffd27a', 520, 0.9, 3.5); break;
        case 'runeFail': flash('#ff4b3a', 0.3); shake(0.6); fx.chroma = 0.6; break;
        case 'finisherReady': num(s.hero.x, s.hero.y - 130, 'FINISHER!', '#ffe08a', true); break;
        case 'finisherSlash': shake(0.35); flash('#ffffff', 0.2); fx.slashes.push({ t: 0, a: -0.45 + e.n * 1.6, y: 260 + e.n * 160 }); if (s.stage === 3) negative(0.05); break;
        case 'finisherHit': shake(1); flash('#ffffff', 0.55); negative(0.08); ring(s.boss.x, s.boss.y - 90, '#ffffff', 20, 420, 0.7, 10); part(s.boss.x, s.boss.y - 90, 60, '#ffe7b8', 700, 1.1, 5); break;
        case 'boxStart': ring(640, 470, '#e8f1ff', 300, 40, 0.4, 3); break;
        case 'timingResult': if (e.result === 'perfect') { flash('#ffffff', 0.3); shake(0.6); negative(0.06); part(s.boss.x, s.boss.y - 90, 40, '#ffe7b8', 600, 0.9, 4); } else if (e.result === 'good') shake(0.35); break;
        case 'clashStart': flash('#ffffff', 0.5); shake(0.6); break;
        case 'clashPress': fx.clashPulse = 1; if (Math.random() < 0.5) shake(0.06); break;
        case 'clashEscalate': shake(0.5); flash('#ffffff', 0.18); if (s.stage === 3) negative(0.06); break;
        case 'clashWin': shake(1); flash('#ffffff', 0.9); negative(0.1); part(s.boss.x, s.boss.y - 100, 80, '#fff1d0', 800, 1.2, 5, 60); break;
        case 'cineBeat': cineBeat(s, e); break;
        case 'bossDown': flash('#ffffff', 0.4); shake(0.8); break;
        case 'stage': flash('#ffffff', 0.4); break;
        case 'defeat': flash('#ff3a2a', 0.4); shake(0.8); break;
        case 'victory': break;
      }
    }
  }
  function cineBeat(s, e) {
    const b = s.boss, h = s.hero;
    if (e.kind === 'reborn') {
      if (e.at === 0.3) { shake(0.5); flash('#ffffff', 0.25); }
      if (e.at === 0.5) { shake(1); flash('#ffffff', 0.85); ring(h.x, h.y - 60, '#ffe08a', 10, 520, 0.9, 10); ring(b.x, b.y - 100, '#ff6a3a', 10, 560, 0.9, 10); part(h.x, h.y - 60, 50, '#ffe08a', 600, 1, 4, 0); part(b.x, b.y - 100, 60, '#ff7a4a', 650, 1, 4, 0); }
      if (e.at === 0.7) shake(0.3);
    } else if (e.kind === 'totality') {
      if (e.at === 0.3) shake(0.3);
      if (e.at === 0.5) { shake(1); flash('#ffffff', 1); negative(0.14); ring(980, 150, '#ffffff', 60, 900, 1.2, 12); }
      if (e.at === 0.7) { shake(0.4); negative(0.06); }
    } else {
      if (e.at === 0.3) { shake(0.5); flash('#ffffff', 0.3); }
      if (e.at === 0.5) { shake(1); flash('#ffffff', 1); if (e.kind === 'trueEnding') negative(0.12); fx.bossGone = true; for (let i = 0; i < 3; i++) part(b.x, b.y - 100, 60, i ? '#ffe7b8' : '#ffffff', 700 + i * 150, 1.6, 5, 40); ring(b.x, b.y - 100, '#ffffff', 20, 900, 1.2, 12); }
      if (e.at === 0.7) shake(0.25);
    }
  }
  function addScar(x, y) {
    fx.scorch.push({ x, y, t: 0 }); if (fx.scorch.length > 8) fx.scorch.shift();
    const lines = []; for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + Math.random() * 0.4; let px = x, py = y; const seg = []; for (let k = 0; k < 4; k++) { px += Math.cos(a + (Math.random() - 0.5) * 0.6) * 22; py += Math.sin(a + (Math.random() - 0.5) * 0.6) * 11; seg.push([px, py]); } lines.push(seg); }
    fx.cracks.push({ x, y, lines, t: 0 }); if (fx.cracks.length > 6) fx.cracks.shift();
  }

  // ------------------------------------------------------------------ helpers
  // soft glows are pre-rendered sprites per colour: a live radial gradient per glow per frame halved the frame rate
  const glowCache = new Map();
  function glowSprite(color) {
    let c = glowCache.get(color);
    if (!c) {
      if (glowCache.size > 160) glowCache.clear();
      c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); glowCache.set(color, c);
    }
    return c;
  }
  function glow(x, y, r, color, alpha = 1) {
    if (r <= 0 || alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1;
  }
  const q = (v) => Math.round(v * 20) / 20; // quantise dynamic alphas so the glow cache stays small
  function shadow(x, y, w, a = 0.55) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.28, 0, 0, TAU); ctx.fill(); }
  function text(str, x, y, px, color, align = 'center', stroke = true, wt = 700) {
    ctx.font = font(px, wt); ctx.textAlign = align; ctx.fillStyle = color;
    if (stroke) { ctx.strokeStyle = 'rgba(3,4,6,.9)'; ctx.lineWidth = Math.max(3, px / 9); ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
    ctx.fillText(str, x, y);
  }
  function beam(x1, y1, x2, y2, w, color, core = '#ffffff', wobble = 0) {
    const a = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
    ctx.save(); ctx.translate(x1, y1); ctx.rotate(a); ctx.globalCompositeOperation = 'lighter';
    const ww = w * (1 + wobble * Math.sin(fx.clock * 50) * 0.15);
    ctx.fillStyle = color; ctx.globalAlpha = 0.25; ctx.fillRect(0, -ww * 1.2, len, ww * 2.4);
    ctx.globalAlpha = 0.6; ctx.fillRect(0, -ww * 0.6, len, ww * 1.2);
    ctx.globalAlpha = 1; ctx.fillStyle = core; ctx.fillRect(0, -ww * 0.22, len, ww * 0.44);
    ctx.restore();
  }
  function dashedLine(x1, y1, x2, y2, color, alpha, w = 2, dash = [10, 10]) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }
  function star(x, y, r, points, inner, rot) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) { const a = rot + i / (points * 2) * TAU, rr = i % 2 ? r * inner : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath();
  }

  // ------------------------------------------------------------------ arenas
  function drawArena(s) {
    const f = form(s), pal = P[f];
    // phase 3: the boss IS the black sun, so the sky's corona moves to the far side
    const ex = (f === 3 ? 330 : 980) - fx.camX * 0.1, ey = f === 3 ? 140 : 150;
    const al = aligned(s) ? 0.5 + 0.5 * Math.sin(fx.clock * 6) : 0;
    if (al) paintSky(f, ex, ey, al);
    else { // the sky is painted once per look into a cached image; repainting its big glows every frame cost ~20 fps
      let c = skyCache[f];
      if (!c) {
        c = document.createElement('canvas'); c.width = W + 1000; c.height = 640;
        const real = ctx; ctx = c.getContext('2d'); ctx.translate(500, 300); paintSky(f, ex + fx.camX * 0.1, ey, 0); ctx = real; skyCache[f] = c;
      }
      ctx.drawImage(c, -500 - fx.camX * 0.1, -300);
    }
    if (f === 3) { // live diamond-ring flare on the cached corona
      const fl = 0.7 + 0.3 * Math.sin(fx.clock * 2.3), fxp = ex + Math.cos(-0.7) * 84, fyp = ey + Math.sin(-0.7) * 84;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(fxp, fyp, 60 * fl, 'rgba(255,255,255,.95)');
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(fxp - 120 * fl, fyp - 1, 240 * fl, 2); ctx.fillRect(fxp - 1, fyp - 70 * fl, 2, 140 * fl); ctx.restore();
    }
    if (f === 2) { // drifting ash clouds
      ctx.fillStyle = 'rgba(80,16,10,.45)';
      for (let i = 0; i < 5; i++) { const x = ((i * 300 + fx.clock * (8 + i * 3)) % (W + 600)) - 300; ctx.beginPath(); ctx.ellipse(x, 90 + i * 34, 220, 22, 0, 0, TAU); ctx.fill(); }
    }
    // skyline (parallax) and ruins
    ctx.fillStyle = pal.ruin[0];
    for (let i = 0; i < 18; i++) { const x = (i * 83 - fx.camX * 0.2) % (W + 200) - 100, h = 80 + (i * 37 % 110); ctx.fillRect(x, 330 - h, 54, h); }
    ctx.fillStyle = pal.ruin[1];
    for (let i = 0; i < 9; i++) { const x = (i * 157 - fx.camX * 0.5) % (W + 260) - 130; ctx.fillRect(x, 230 + (i % 3) * 20, 26, 140); ctx.fillRect(x - 14, 222 + (i % 3) * 20, 54, 14); }
    if (f === 3) { ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; for (let i = 0; i < 9; i++) { const x = (i * 157 - fx.camX * 0.5) % (W + 260) - 130; ctx.strokeRect(x, 230 + (i % 3) * 20, 26, 140); } }
    // floor
    const floor = ctx.createLinearGradient(0, 330, 0, H);
    floor.addColorStop(0, pal.floor); floor.addColorStop(1, '#020203');
    ctx.fillStyle = floor; ctx.fillRect(-500, 330, W + 1000, H + 300);
    if (f === 3) drawMirrorFloor(s, ex);
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(640 + i * 40, 330); ctx.lineTo(640 + i * 220, H + 60); ctx.stroke(); }
    const scroll = f === 2 ? (fx.clock * 0.08) % 1 : 0;
    for (let i = 0; i < 7; i++) { const y = 330 + Math.pow((i + scroll) / 6, 1.7) * 400; ctx.beginPath(); ctx.moveTo(-500, y); ctx.lineTo(W + 500, y); ctx.stroke(); }
    ctx.strokeStyle = pal.horizon; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-500, 330); ctx.lineTo(W + 500, 330); ctx.stroke();
    if (f === 2) { // lava seams pulsing in the floor
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,90,40,${0.25 + 0.15 * Math.sin(fx.clock * 2)})`; ctx.lineWidth = 3;
      for (const pts of [[[120, 420], [220, 470], [210, 560], [300, 640]], [[1100, 400], [1010, 480], [1060, 560]], [[600, 690], [700, 620], [820, 650], [900, 600]]]) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
      ctx.restore();
    }
    // scars
    for (const sc of fx.scorch) { const a = clamp(1 - sc.t / 6, 0, 1) * 0.6; ctx.globalAlpha = a; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(sc.x, sc.y, 80, 26, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    for (const c of fx.cracks) { const a = clamp(1 - c.t / 6, 0, 1); ctx.strokeStyle = f === 3 ? `rgba(255,255,255,${0.6 * a})` : `rgba(255,140,80,${0.7 * a})`; ctx.lineWidth = 2; for (const seg of c.lines) { ctx.beginPath(); ctx.moveTo(c.x, c.y); for (const [x, y] of seg) ctx.lineTo(x, y); ctx.stroke(); } }
    // embers (phase 3: white ash falls instead of rising)
    for (const e of fx.embers) {
      if (f === 3) { e.y += e.s * 0.9; if (e.y > H + 10) { e.y = -10; e.x = Math.random() * W; } } else { e.y -= e.s * 0.6; if (e.y < -10) { e.y = H + 10; e.x = Math.random() * W; } }
      e.x += Math.sin(fx.clock * 0.8 + e.ph) * 0.3;
      ctx.globalAlpha = 0.3 + 0.35 * Math.sin(fx.clock * 3 + e.ph); ctx.fillStyle = pal.ember; ctx.fillRect(e.x, e.y, f === 3 ? 1.5 : 2, f === 3 ? 3 : 2);
    }
    ctx.globalAlpha = 1;
    if (fx.dawn > 0) drawDawn(s);
  }
  function paintSky(f, ex, ey, al) {
    const pal = P[f], sky = ctx.createLinearGradient(0, -200, 0, H);
    sky.addColorStop(0, pal.sky[0]); sky.addColorStop(0.55, pal.sky[1]); sky.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = sky; ctx.fillRect(-500, -300, W + 1000, 640);
    if (f === 3) { drawTotalitySky(ex, ey); return; }
    // the eclipse: in phase 2 it is cracked and bleeding light; when the secret "aligns" it pulses white
    glow(ex, ey, 260 + al * 60, al ? `rgba(255,255,255,${q(0.2 + al * 0.25)})` : pal.sunGlow);
    ctx.fillStyle = al ? '#ffffff' : pal.sun; ctx.beginPath(); ctx.arc(ex, ey, 74, 0, TAU); ctx.fill();
    ctx.fillStyle = '#04090a'; ctx.beginPath(); ctx.arc(ex + 10 * (1 - al), ey - 4 * (1 - al), 70, 0, TAU); ctx.fill();
    if (f === 2) {
      ctx.save(); ctx.lineCap = 'round';
      for (const [w, col] of [[7, 'rgba(255,90,40,.25)'], [2, 'rgba(255,140,90,.9)']]) for (const [a, l] of [[0.4, 120], [1.9, 90], [2.8, 150], [4.4, 110], [5.5, 80]]) { ctx.beginPath(); ctx.moveTo(ex + Math.cos(a) * 74, ey + Math.sin(a) * 74); ctx.lineTo(ex + Math.cos(a + 0.08) * (74 + l * 0.5), ey + Math.sin(a + 0.08) * (74 + l * 0.5)); ctx.lineTo(ex + Math.cos(a - 0.05) * (74 + l), ey + Math.sin(a - 0.05) * (74 + l)); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); }
      ctx.restore();
    }
  }
  function drawTotalitySky(ex, ey) {
    // a black sun with a living white corona: long filaments, slow rotation, a diamond-ring flare
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glow(ex, ey, 520, 'rgba(255,246,225,.16)');
    glow(ex, ey, 230, 'rgba(255,250,240,.55)');
    ctx.translate(ex, ey);
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * TAU + fx.clock * 0.04 + Math.sin(i * 7.3) * 0.08, l = 140 + (Math.sin(i * 3.7 + fx.clock * 0.6) * 0.5 + 0.5) * 220 + (i % 5 === 0 ? 160 : 0);
      ctx.strokeStyle = `rgba(255,250,236,${0.12 + (i % 3) * 0.06})`; ctx.lineWidth = 1 + (i % 4);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 82, Math.sin(a) * 82);
      ctx.quadraticCurveTo(Math.cos(a + 0.12) * l * 0.6, Math.sin(a + 0.12) * l * 0.6, Math.cos(a + 0.2) * l, Math.sin(a + 0.2) * l); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(ex, ey, 84, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(ex, ey, 84, 0, TAU); ctx.stroke();
  }
  function drawMirrorFloor(s, ex) {
    // obsidian floor reflecting the corona
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, 330, 0, 560); g.addColorStop(0, 'rgba(255,250,236,.12)'); g.addColorStop(1, 'rgba(255,250,236,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(ex, 332, 150, 230, 0, 0, Math.PI); ctx.fill();
    ctx.restore();
  }
  function drawDawn(s) {
    const k = fx.dawn, secret = fx.endKind === 'trueEnding';
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, 80, 0, 360);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, secret ? `rgba(200,240,255,${0.5 * k})` : `rgba(255,170,90,${0.55 * k})`);
    ctx.fillStyle = g; ctx.fillRect(-500, 80, W + 1000, 260);
    glow(640, 340, 380 * k, secret ? 'rgba(220,250,255,.7)' : 'rgba(255,200,120,.7)', k);
    ctx.fillStyle = secret ? '#f4fdff' : '#ffe2a8'; ctx.globalAlpha = k; ctx.beginPath(); ctx.arc(640, 340, 70 * k, Math.PI, TAU); ctx.fill();
    for (let i = 0; i < 14; i++) { const a = Math.PI + (i + 0.5) / 14 * Math.PI; ctx.strokeStyle = secret ? 'rgba(220,250,255,.3)' : 'rgba(255,210,150,.28)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(640 + Math.cos(a) * 90, 340 + Math.sin(a) * 90); ctx.lineTo(640 + Math.cos(a) * (200 + 300 * k), 340 + Math.sin(a) * (200 + 300 * k)); ctx.stroke(); }
    ctx.restore();
  }

  // ------------------------------------------------------------------ fighters
  function drawHero(s, x, y, alpha = 1, face = s.hero.face, ghost = false) {
    const h = s.hero, f = form(s), pal = P[f], sq = h.squash > 0 ? 1 + h.squash * 0.8 : 1, bob = ghost ? 0 : Math.sin(fx.clock * 6) * 2;
    ctx.save(); ctx.translate(x, y + bob); ctx.scale(face * (1 / sq) * 1.3, sq * 1.3); ctx.globalAlpha = alpha;
    if (!ghost) { ctx.save(); ctx.scale(face, 1); shadow(0, 2, 34); ctx.restore(); }
    if (f >= 2 && !ghost) { // wings of light shards
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = pal.hero; ctx.lineWidth = 1.5;
      const flap = Math.sin(fx.clock * 3) * 0.08, n = f === 3 ? 5 : 3;
      for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
        const len = (f === 3 ? 58 : 40) + i * (f === 3 ? 12 : 14), a = -0.5 - i * 0.28 + flap * side;
        ctx.globalAlpha = (0.85 - i * 0.12) * alpha; ctx.fillStyle = f === 3 ? 'rgba(127,246,255,.12)' : 'rgba(255,224,138,.16)';
        ctx.beginPath(); ctx.moveTo(side * 6, -66); ctx.lineTo(side * Math.cos(a) * len, -66 + Math.sin(a) * len); ctx.lineTo(side * Math.cos(a + 0.22) * len * 0.7, -66 + Math.sin(a + 0.22) * len * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.quadraticCurveTo(-30, -50, -12, -78); ctx.lineTo(14, -78); ctx.quadraticCurveTo(30, -46, 24, 0);
    ctx.quadraticCurveTo(0, 8 + Math.sin(fx.clock * 8) * 3, -26, 0);
    if (ghost) { ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = pal.hero; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = alpha * 0.25; ctx.fillStyle = pal.hero; ctx.fill(); ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(1, -90, 16, 0, TAU); ctx.stroke(); ctx.restore(); return; }
    ctx.fillStyle = h.hurt > 0 ? '#ff8a7a' : pal.heroBody; ctx.fill();
    if (f === 3) { ctx.strokeStyle = 'rgba(127,246,255,.25)'; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = pal.hero; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (f === 2) { ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(255,140,60,.55)'; for (let i = 0; i < 5; i++) { const fy = -6 - Math.abs(Math.sin(fx.clock * 7 + i)) * 12; ctx.beginPath(); ctx.moveTo(-26 + i * 11, 2); ctx.lineTo(-20 + i * 11, fy); ctx.lineTo(-14 + i * 11, 2); ctx.fill(); } ctx.restore(); }
    ctx.fillStyle = f === 3 ? '#0b1a1f' : pal.heroTrim; ctx.fillRect(-12, -72, 24, 30);
    if (f === 3) { ctx.strokeStyle = pal.hero; ctx.lineWidth = 1; ctx.strokeRect(-12, -72, 24, 30); ctx.fillStyle = pal.hero; star(0, -57, 6, 4, 0.35, 0); ctx.fill(); }
    ctx.fillStyle = pal.heroHead; ctx.beginPath(); ctx.arc(1, -90, 16, 0, TAU); ctx.fill();
    if (f === 3) { ctx.strokeStyle = pal.hero; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.fillStyle = f === 2 ? '#ff9a4a' : pal.hero; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12; ctx.fillRect(2, -93, 12, 4); ctx.shadowBlur = 0;
    if (f >= 2) { ctx.beginPath(); ctx.ellipse(1, -114 + Math.sin(fx.clock * 2) * 2, 15, 4.5, 0, 0, TAU); ctx.strokeStyle = f === 3 ? 'rgba(127,246,255,.3)' : 'rgba(255,224,138,.3)'; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = pal.hero; ctx.lineWidth = 2; ctx.stroke(); }
    // blade grows with each form
    const bl = [0, 64, 78, 92][f], swing = h.slashCd > 0.16 ? 1.2 : 0, cast = ABIL_ORDER.some((n) => (h.cds[n] || 0) > ABIL[n].cd[s.stage] - 0.12) ? 0.5 : 0;
    ctx.save(); ctx.translate(18, -52); ctx.rotate(-0.9 + swing - cast);
    ctx.fillStyle = f === 3 ? '#ffffff' : '#d8f6ff'; ctx.shadowColor = pal.hero; ctx.shadowBlur = f === 1 ? 14 : 0; // forms 2-3 get an additive edge instead of a blur
    ctx.fillRect(0, -3, bl, 6); if (f >= 2) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = pal.hero; ctx.globalAlpha = 0.4; ctx.fillRect(0, -7, bl + 6, 14); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'source-over'; }
    ctx.fillStyle = f === 2 ? '#c79a4a' : '#5a7a88'; ctx.fillRect(-10, -6, 12, 12); ctx.restore(); ctx.shadowBlur = 0;
    ctx.restore();
    if (f === 3) { // six orbiting star shards
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = pal.hero;
      for (let i = 0; i < 6; i++) { const a = fx.clock * 1.6 + i / 6 * TAU; star(x + Math.cos(a) * 58, y - 60 + Math.sin(a) * 20, 6, 4, 0.35, fx.clock * 3); ctx.globalAlpha = Math.sin(a) > 0 ? 0.95 : 0.4; ctx.fill(); }
      ctx.restore();
    }
    if (h.inv > 0 || h.dodgeT > 0) { ctx.save(); ctx.globalAlpha = 0.5 + 0.3 * Math.sin(fx.clock * 30); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y - 45, 36, 56, 0, 0, TAU); ctx.stroke(); ctx.restore(); }
  }
  function robePath(amp) {
    ctx.beginPath(); ctx.moveTo(-70, -170); ctx.quadraticCurveTo(-120, -60, -95, 20);
    for (let i = 0; i <= 8; i++) ctx.lineTo(-95 + i * 23.75, 20 + Math.sin(fx.clock * 4 + i) * amp + (i % 2) * amp * 1.5);
    ctx.quadraticCurveTo(120, -60, 70, -170); ctx.quadraticCurveTo(0, -215, -70, -170);
  }
  function drawBoss(s) {
    if (fx.bossGone) return;
    const b = s.boss, f = form(s), pal = P[f], x = b.x, y = b.y;
    const tell = b.tell > 0 ? Math.sin((0.45 - b.tell) / 0.45 * Math.PI) : 0, sx = 1 + tell * 0.06, sy = 1 - tell * 0.05;
    // afterimage while sidestepping
    if (b.dodgeT > 0) { ctx.save(); ctx.globalAlpha = 0.25; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = pal.boss; ctx.translate(x, y - b.dodgeDir * 40); ctx.scale(1.12, 1.12); robePath(12); ctx.fill(); ctx.restore(); }
    shadow(x, y + 30, 120, 0.6);
    ctx.save(); ctx.translate(x, y); ctx.scale(sx * 1.12, sy * 1.12);
    if (f === 3) { drawTotalityBoss(s, b, tell); ctx.restore(); drawHands(s); return; }
    glow(0, -90, 230, pal.bossGlow.replace(/[\d.]+\)$/, f === 2 ? '.4)' : '.2)'));
    ctx.fillStyle = b.flash > 0 ? '#ffffff' : '#07090b'; robePath(f === 2 ? 18 : 12); ctx.fill();
    ctx.save(); ctx.clip(); ctx.strokeStyle = f === 2 ? 'rgba(255,90,50,.85)' : 'rgba(255,180,100,.45)'; ctx.lineWidth = f === 2 ? 3 : 2; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(fx.clock * 3);
    for (const [x0, y0, x1, y1, x2, y2] of [[-40, -150, -55, -90, -38, -30], [30, -160, 52, -100, 40, -20], [-10, -60, 8, -20, -6, 15], [60, -60, 78, -10, 70, 20], ...(f === 2 ? [[-70, -100, -40, -60, -60, 0], [10, -190, -5, -150, 15, -120]] : [])]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    ctx.restore();
    robePath(f === 2 ? 18 : 12); ctx.strokeStyle = f === 2 ? 'rgba(255,90,50,.9)' : 'rgba(255,190,110,.7)'; ctx.lineWidth = 2 + tell * 3; ctx.stroke();
    if (f === 1) {
      ctx.fillStyle = b.flash > 0 ? '#fff' : pal.boss;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 22 - 9, -190); ctx.lineTo(i * 22, -228 - (2 - Math.abs(i)) * 12); ctx.lineTo(i * 22 + 9, -190); ctx.fill(); }
    } else { // UNBOUND: the crown breaks into orbiting shards
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) { const a = fx.clock * 0.9 + i / 7 * TAU, rx = Math.cos(a) * 92, ry = -205 + Math.sin(a) * 22;
        ctx.save(); ctx.translate(rx, ry); ctx.rotate(a); ctx.fillStyle = b.flash > 0 ? '#fff' : pal.boss; ctx.globalAlpha = Math.sin(a) > 0 ? 1 : 0.45;
        ctx.beginPath(); ctx.moveTo(-7, 8); ctx.lineTo(0, -26); ctx.lineTo(7, 8); ctx.fill(); ctx.restore(); }
      ctx.restore();
    }
    glow(0, -95, 60 + tell * 25, pal.core);
    ctx.fillStyle = '#04090a'; ctx.beginPath(); ctx.arc(0, -95, 20, 0, TAU); ctx.fill();
    if (f === 2) { ctx.fillStyle = '#ffd0b0'; ctx.beginPath(); ctx.ellipse(0, -95, 4 + tell * 3, 14, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = f === 2 ? '#ffd0b0' : '#fff2cf'; ctx.shadowColor = f === 2 ? '#ff5a3a' : '#ffbf6a'; ctx.shadowBlur = 16 + tell * 18;
    ctx.fillRect(-26, -142, 16, 4); ctx.fillRect(10, -142, 16, 4); if (f === 2) { ctx.fillRect(-20, -152, 10, 3); ctx.fillRect(10, -152, 10, 3); } ctx.shadowBlur = 0;
    ctx.restore();
    drawHands(s);
    if (b.stagger > 0 && s.phase === 'fight') text('STAGGERED', x, y - 290, 20, '#ffe2a6');
  }
  function drawTotalityBoss(s, b, tell) {
    // TOTALITY: the boss IS the black sun. White corona, mask face, robe of night with white rim light.
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glow(0, -120, 300, 'rgba(255,250,236,.28)');
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * TAU + fx.clock * 0.25, l = 150 + Math.sin(fx.clock * 3 + i * 1.7) * 30 + (i % 4 === 0 ? 50 : 0) + tell * 40;
      ctx.fillStyle = `rgba(255,250,236,${0.18 + (i % 2) * 0.1})`;
      ctx.beginPath(); ctx.moveTo(Math.cos(a - 0.05) * 96, -120 + Math.sin(a - 0.05) * 96); ctx.lineTo(Math.cos(a) * l, -120 + Math.sin(a) * l); ctx.lineTo(Math.cos(a + 0.05) * 96, -120 + Math.sin(a + 0.05) * 96); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = b.flash > 0 ? '#ffffff' : '#000'; robePath(16); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = b.flash > 0 ? '#ffffff' : '#000'; ctx.beginPath(); ctx.arc(0, -120, 96, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 16 + tell * 8; ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3 + tell * 3; ctx.stroke();
    // mask: two slit eyes and a vertical seam that splits open on the tell
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(-30, -130, 34 + tell * 20, 'rgba(255,59,92,.7)'); glow(30, -130, 34 + tell * 20, 'rgba(255,59,92,.7)'); ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(-30, -130, 18, 3.5, -0.15, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(30, -130, 18, 3.5, 0.15, 0, TAU); ctx.fill();
    ctx.fillRect(-1 - tell * 3, -100, 2 + tell * 6, 60);
    // diamond-ring flare on the rim
    const fl = 0.7 + 0.3 * Math.sin(fx.clock * 4), px = Math.cos(-0.9) * 96, py = -120 + Math.sin(-0.9) * 96;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(px, py, 40 * fl, 'rgba(255,255,255,1)'); ctx.fillStyle = '#fff'; ctx.fillRect(px - 70 * fl, py - 1, 140 * fl, 2); ctx.fillRect(px - 1, py - 40 * fl, 2, 80 * fl); ctx.restore();
  }
  function drawHands(s) {
    const b = s.boss, f = form(s), pal = P[f];
    for (const hand of b.hands) {
      ctx.save(); ctx.translate(hand.x, hand.y);
      glow(0, 0, 70, f === 3 ? 'rgba(255,255,255,.22)' : pal.bossGlow);
      ctx.fillStyle = b.flash > 0 ? '#fff' : (f === 3 ? '#000' : '#0a0c0f'); ctx.strokeStyle = f === 3 ? '#ffffff' : pal.boss; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 30, 24, 0, 0, TAU); ctx.fill(); ctx.stroke();
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * 11, -14); ctx.quadraticCurveTo(k * 16, -40, k * 14 + Math.sin(fx.clock * 5 + k) * 3, -56 - (f - 1) * 6); ctx.lineWidth = 7; ctx.strokeStyle = f === 3 ? '#000' : '#0a0c0f'; ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = f === 3 ? '#ffffff' : pal.boss; ctx.stroke(); }
      if (f >= 2) { ctx.fillStyle = f === 3 ? '#fff' : '#ffd0b0'; ctx.beginPath(); ctx.ellipse(0, 2, 8, 3, 0, 0, TAU); ctx.fill(); } // an eye in each palm
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ hazards (telegraph grammar: dashed outline -> filling shape -> solid hit)
  function drawHazards(s) {
    const f = form(s), pal = P[f], tf = pal.teleFill;
    for (const z of s.hazards) {
      switch (z.kind) {
        case 'slam': case 'meteor': {
          if (z.hit || z.t < 0) break;
          const k = clamp(z.t / z.tele, 0, 1), pulse = 0.5 + 0.5 * Math.sin(fx.clock * 14);
          ctx.save(); ctx.strokeStyle = pal.tele; ctx.lineWidth = 3; ctx.setLineDash([12, 10]); ctx.globalAlpha = 0.5 + pulse * 0.4;
          ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.36, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = `rgba(${tf},${0.08 + k * 0.24})`; ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * k, z.r * 0.36 * k, 0, 0, TAU); ctx.fill(); ctx.restore();
          if (z.kind === 'meteor') { // the meteor falls in on an angle with a burning trail
            const my = lerp(z.y - 760, z.y, k * k), mx = z.x + (1 - k * k) * 260;
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            beam(mx + 90, my - 120, mx, my, 10 * k + 2, pal.tele, '#ffe1c8');
            glow(mx, my, 40, `rgba(${tf},.8)`); ctx.fillStyle = f === 3 ? '#fff' : '#ffe1c8'; ctx.beginPath(); ctx.arc(mx, my, 12, 0, TAU); ctx.fill(); ctx.restore();
          }
          break;
        }
        case 'spin': {
          const k = z.t / z.len;
          ctx.save(); ctx.translate(z.x, z.y); ctx.scale(1, 0.36); ctx.rotate(fx.clock * 14);
          ctx.strokeStyle = f === 3 ? '#ffffff' : '#ff8a5a'; ctx.lineWidth = 5; ctx.globalAlpha = 0.9;
          for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, Math.max(4, 90 - k * 50 - i * 14), i * 2, i * 2 + 4); ctx.stroke(); }
          ctx.restore(); break;
        }
        case 'hole': {
          const st = Math.sin(clamp(z.t / z.len, 0, 1) * Math.PI), r = 26 + st * 30;
          ctx.save(); ctx.strokeStyle = `rgba(${tf},.4)`; ctx.lineWidth = 2;
          for (let i = 0; i < 5; i++) { const rr = ((fx.clock * 120 + i * 90) % 450); ctx.globalAlpha = (1 - rr / 450) * 0.6 * st; ctx.beginPath(); ctx.ellipse(z.x, z.y - 10, 480 - rr, (480 - rr) * 0.36, 0, 0, TAU); ctx.stroke(); }
          ctx.globalAlpha = 1; ctx.translate(z.x, z.y - 14); ctx.scale(1, 0.5); ctx.rotate(fx.clock * 4);
          for (let i = 0; i < 26; i++) { const a = i / 26 * TAU, d = r + 18 + Math.sin(fx.clock * 6 + i) * 6; ctx.fillStyle = f === 3 ? (i % 2 ? '#ffffff' : '#ff3b5c') : (i % 2 ? '#ff6a3a' : '#ffd08a'); ctx.globalAlpha = 0.7 * st; ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, 4, 4); }
          ctx.globalAlpha = 1; ctx.rotate(-fx.clock * 4); ctx.scale(1, 2);
          glow(0, 0, r * 2.4, `rgba(${tf},.55)`, st);
          ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
          ctx.strokeStyle = f === 3 ? '#ffffff' : '#ffcf8a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 1, 0, TAU); ctx.stroke();
          ctx.restore();
          if (Math.random() < 0.6 * st && fx.particles.length < P_MAX) { const a = Math.random() * TAU; fx.particles.push({ x: z.x, y: z.y, tx: z.x, ty: z.y - 14, life: 0.8, max: 0.8, size: 2.5, color: f === 3 ? '#ffffff' : '#ffb07a', spiral: true, a, d: 220 }); }
          break;
        }
        case 'chain':
          if (z.t < z.tele) { dashedLine(z.hx, z.hy, z.tx, z.ty, pal.tele, 0.45 + 0.35 * Math.sin(fx.clock * 16), 2, [6, 8]); ctx.save(); ctx.strokeStyle = pal.tele; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(z.tx, z.ty, 22, 0, TAU); ctx.stroke(); ctx.restore(); }
          else if (z.cx != null) drawChain(z.hx, z.hy, z.cx, z.cy, 1);
          break;
        case 'catch': {
          // a horizontal band the hands will close on; arrows show the hands' direction
          const k = clamp(z.t / z.tele, 0, 1), closing = z.t >= z.tele, y0 = z.y + 20; // band is in feet space (hero.y - 20 = z.y)
          ctx.save();
          ctx.fillStyle = `rgba(${tf},${closing ? 0.28 : 0.06 + k * 0.12})`; ctx.fillRect(FLOOR.minX - 40, y0 - z.band, FLOOR.maxX - FLOOR.minX + 80, z.band * 2);
          ctx.strokeStyle = pal.tele; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(fx.clock * 14); ctx.lineWidth = 2; ctx.setLineDash([14, 10]);
          for (const yy of [y0 - z.band, y0 + z.band]) { ctx.beginPath(); ctx.moveTo(FLOOR.minX - 40, yy); ctx.lineTo(FLOOR.maxX + 40, yy); ctx.stroke(); }
          ctx.setLineDash([]); ctx.fillStyle = pal.tele;
          if (!closing) for (let i = 0; i < 4; i++) { const o = ((fx.clock * 2 + i / 4) % 1) * 200; for (const [sx, d] of [[FLOOR.minX + o, 1], [FLOOR.maxX - o, -1]]) { ctx.beginPath(); ctx.moveTo(sx, y0 - 14); ctx.lineTo(sx + 16 * d, y0); ctx.lineTo(sx, y0 + 14); ctx.fill(); } }
          ctx.restore(); break;
        }
        case 'earth': {
          const k = clamp(z.t / z.tele, 0, 1), fly = clamp((z.t - z.tele) / z.fly, 0, 1);
          if (!z.hit) {
            ctx.save(); ctx.strokeStyle = pal.tele; ctx.lineWidth = 3; ctx.setLineDash([12, 10]); ctx.globalAlpha = 0.55 + 0.35 * Math.sin(fx.clock * 14);
            ctx.beginPath(); ctx.ellipse(z.tx, z.ty, z.r, z.r * 0.36, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = `rgba(${tf},${0.06 + fly * 0.3})`; ctx.beginPath(); ctx.ellipse(z.tx, z.ty, z.r * Math.max(k * 0.3, fly), z.r * 0.36 * Math.max(k * 0.3, fly), 0, 0, TAU); ctx.fill(); ctx.restore();
            const rx = lerp(z.sx, z.tx, fly), ry = lerp(z.sy - k * 60, z.ty - 30, fly) - Math.sin(fly * Math.PI) * 220, sc = 0.5 + k * 0.5 + fly * 0.4;
            drawRock(rx, ry, 46 * sc, z.t * 3);
          }
          break;
        }
        case 'laser': case 'cross': {
          const angles = z.kind === 'cross' ? [z.a, z.a + Math.PI / 2] : [z.a], back = z.kind === 'cross' ? 1500 : 0;
          for (const a of angles) {
            const x1 = z.x - Math.cos(a) * back, y1 = z.y - Math.sin(a) * back, x2 = z.x + Math.cos(a) * 1600, y2 = z.y + Math.sin(a) * 1600;
            if (z.t < z.tele) { const k = z.t / z.tele; dashedLine(x1, y1, x2, y2, pal.tele, 0.4 + 0.5 * k, 1 + k * 3, [16, 10]); if (k > 0.7 && Math.floor(fx.clock * 20) % 2) dashedLine(x1, y1, x2, y2, '#ffffff', 0.5, 1, []); }
            else if (z.t < z.tele + z.len + 0.2) { const k = clamp((z.t - z.tele) / (z.len + 0.2), 0, 1); beam(x1, y1, x2, y2, z.w * (1 - k * 0.7), pal.tele, f === 3 ? '#ffffff' : '#fff1e0', 1); }
          }
          if (z.kind === 'cross' && z.t < z.tele) { ctx.save(); ctx.strokeStyle = pal.tele; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(z.x, z.y, 18 + Math.sin(fx.clock * 12) * 4, 0, TAU); ctx.stroke(); ctx.restore(); }
          if (z.kind === 'laser' && z.t < z.tele) glow(z.x, z.y, 30 + z.t / z.tele * 40, `rgba(${tf},.8)`);
          break;
        }
        case 'well': {
          const r = z.r ?? z.r0, k = clamp(z.t / z.len, 0, 1);
          ctx.save(); ctx.strokeStyle = pal.tele; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.globalAlpha = 0.7;
          ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r0 / 1, z.r0 / 1.6, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = `rgba(${tf},${0.1 + k * 0.25})`; ctx.beginPath(); ctx.ellipse(z.x, z.y, r, r / 1.6, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = `rgba(${tf},.6)`; ctx.lineWidth = 2;
          for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + fx.clock * 1.5, o = ((fx.clock * 1.4 + i * 0.13) % 1); const r1 = lerp(z.r0, 40, o); ctx.globalAlpha = o; ctx.beginPath(); ctx.moveTo(z.x + Math.cos(a) * r1, z.y + Math.sin(a) * r1 / 1.6); ctx.lineTo(z.x + Math.cos(a + 0.2) * (r1 - 24), z.y + Math.sin(a + 0.2) * (r1 - 24) / 1.6); ctx.stroke(); }
          ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(z.x, z.y, 18 + k * 20, (18 + k * 20) / 1.6, 0, 0, TAU); ctx.fill();
          ctx.restore(); break;
        }
        case 'corona': {
          // a sheet of corona light sweeps the floor top to bottom; stand inside the green shadow band to survive
          const gy = z.gap + 30, active = z.t >= z.tele;
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(FLOOR.minX - 60, gy - 70, FLOOR.maxX - FLOOR.minX + 120, 140);
          ctx.strokeStyle = 'rgba(150,240,200,.9)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
          ctx.strokeRect(FLOOR.minX - 60, gy - 70, FLOOR.maxX - FLOOR.minX + 120, 140); ctx.setLineDash([]);
          text('SHADOW', FLOOR.minX - 40, gy - 78, 15, 'rgba(150,240,200,.95)', 'left', true, 700);
          if (!active) { const k = z.t / z.tele; dashedLine(FLOOR.minX - 60, FLOOR.minY - 10, FLOOR.maxX + 60, FLOOR.minY - 10, pal.tele, 0.4 + 0.5 * k, 3, [18, 10]); }
          else {
            const wy = z.y + 30, inGap = Math.abs(z.y - z.gap) <= 70;
            ctx.globalCompositeOperation = 'lighter';
            const g = ctx.createLinearGradient(0, wy - 60, 0, wy + 10); g.addColorStop(0, 'rgba(255,250,236,0)'); g.addColorStop(1, inGap ? 'rgba(255,250,236,.15)' : 'rgba(255,250,236,.55)');
            ctx.fillStyle = g; ctx.fillRect(-500, wy - 60, W + 1000, 70);
            ctx.fillStyle = inGap ? 'rgba(255,255,255,.25)' : '#ffffff'; ctx.fillRect(-500, wy - 2, W + 1000, 4);
            ctx.fillStyle = `rgba(${tf},.5)`; ctx.fillRect(-500, wy + 2, W + 1000, 6);
          }
          ctx.restore(); break;
        }
        case 'heroBeam': {
          const x2 = z.x + Math.cos(z.a) * 1600, y2 = z.y + Math.sin(z.a) * 1600;
          if (z.t < z.tele) dashedLine(z.x, z.y, x2, y2, pal.hero, 0.6, 2, [8, 6]);
          else { const k = (z.t - z.tele) / z.len; beam(z.x, z.y, x2, y2, 22 * (1 - k * 0.6) + s.stage * 4, pal.hero, '#ffffff', 1); }
          break;
        }
      }
    }
    // boss orb telegraph: a short aim guide while the orb charges
    for (const p of s.shots) if (p.age < p.tele) dashedLine(p.x, p.y, p.x + Math.cos(p.a) * 120, p.y + Math.sin(p.a) * 120, pal.tele, 0.35 + 0.3 * (p.age / p.tele), 1.5, [4, 8]);
  }
  function drawRock(x, y, r, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#3a2a22'; ctx.strokeStyle = '#ff8a5a'; ctx.lineWidth = 2;
    ctx.beginPath(); for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, rr = r * (0.75 + ((i * 37) % 10) / 30); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.2); ctx.lineTo(0, r * 0.1); ctx.lineTo(r * 0.4, -r * 0.3); ctx.moveTo(0, r * 0.1); ctx.lineTo(r * 0.1, r * 0.5); ctx.stroke();
    ctx.restore();
  }
  function drawChain(x1, y1, x2, y2, alpha) {
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.floor(d / 16)), a = Math.atan2(y2 - y1, x2 - x1);
    ctx.save(); ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      const t = i / n, x = lerp(x1, x2, t), y = lerp(y1, y2, t) + Math.sin(t * Math.PI) * 10;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + (i % 2 ? Math.PI / 2 : 0)); ctx.strokeStyle = '#c7ccd4'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 8, 4.5, 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
    ctx.fillStyle = '#e8ecf2'; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(a - 0.5) * 18, y2 - Math.sin(a - 0.5) * 18); ctx.lineTo(x2 - Math.cos(a + 0.5) * 18, y2 - Math.sin(a + 0.5) * 18); ctx.fill();
    ctx.restore();
  }
  function drawShots(s) {
    const f = form(s), pal = P[f];
    for (const p of s.shots) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (p.age < p.tele) { glow(p.x, p.y, p.r * 1.6, pal.orb, 0.6); ctx.restore(); continue; }
      glow(p.x, p.y, p.r * 2.6, pal.orb);
      ctx.fillStyle = pal.orbCore; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.55, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const p of s.heroShots) {
      const a = Math.atan2(p.vy, p.vx);
      ctx.save(); ctx.translate(p.x, p.y); ctx.globalCompositeOperation = 'lighter';
      if (p.kind === 'slash') {
        ctx.rotate(a); ctx.strokeStyle = pal.hero; ctx.lineWidth = 5; ctx.shadowColor = pal.hero; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(-p.r * 0.6, 0, p.r, -1.1, 1.1); ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(-p.r * 0.6, 0, p.r - 2, -0.9, 0.9); ctx.stroke();
      } else if (p.kind === 'star') {
        glow(0, 0, 34, f === 3 ? 'rgba(255,250,220,.7)' : 'rgba(160,240,255,.6)');
        ctx.fillStyle = f === 3 ? '#fffbe8' : '#ffffff'; star(0, 0, p.r + 4, f === 2 ? 6 : 4, 0.4, p.age * 14); ctx.fill();
        if (f === 2) { ctx.strokeStyle = pal.hero; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, p.r + 8, 0, TAU); ctx.stroke(); }
      } else if (p.kind === 'spin') {
        ctx.rotate(p.age * 20); ctx.strokeStyle = pal.hero; ctx.lineWidth = 3; ctx.shadowColor = pal.hero; ctx.shadowBlur = 10;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, p.r + (p.spinR ? 6 : 0), i * 2.1, i * 2.1 + 1.2); ctx.stroke(); }
        if (p.spinR) { ctx.beginPath(); ctx.arc(0, 0, p.spinR, 0, TAU); ctx.globalAlpha = 0.4; ctx.stroke(); }
      } else if (p.kind === 'burst') {
        const pu = 1 + Math.sin(p.age * 30) * 0.1;
        glow(0, 0, 60 * pu, f === 3 ? 'rgba(255,255,255,.75)' : 'rgba(255,200,120,.7)'); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.7, 0, TAU); ctx.fill();
        ctx.strokeStyle = pal.hero; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, p.r + 8 + Math.sin(p.age * 18) * 4, 0, TAU); ctx.stroke();
      } else if (p.kind === 'fall') {
        ctx.fillStyle = pal.hero; ctx.globalAlpha = 0.5; ctx.fillRect(-2, -70, 4, 70); ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff'; star(0, 0, p.r, 4, 0.35, 0); ctx.fill();
      } else if (p.kind === 'nova') {
        ctx.rotate(a); glow(0, 0, p.r * 2.6, f === 3 ? 'rgba(255,255,255,.7)' : f === 2 ? 'rgba(255,170,90,.7)' : 'rgba(150,240,255,.65)');
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.6, 0, TAU); ctx.fill();
        ctx.strokeStyle = pal.hero; ctx.lineWidth = 3; ctx.save(); ctx.scale(1, 0.35); ctx.rotate(p.age * 6); ctx.beginPath(); ctx.arc(0, 0, p.r * 1.4, 0, TAU * 0.8); ctx.stroke(); ctx.restore();
        ctx.globalAlpha = 0.35; ctx.fillStyle = pal.hero; ctx.fillRect(-p.r * 4, -p.r * 0.4, p.r * 3.4, p.r * 0.8);
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ SURVIVE box, counter bar, QTEs
  function drawBox(s) {
    const b = s.box; if (!b) return;
    const f = form(s);
    ctx.save();
    ctx.fillStyle = 'rgba(2,4,6,.82)'; ctx.fillRect(-500, -300, W + 1000, H + 600);
    const sh = b.shake > 0 && !reducedMotion ? (Math.random() - 0.5) * 6 : 0;
    ctx.translate(sh, sh * 0.6);
    ctx.fillStyle = '#05080b'; ctx.fillRect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY);
    ctx.strokeStyle = f === 3 ? '#ffffff' : '#f2ede2'; ctx.lineWidth = 4; ctx.strokeRect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY);
    const left = clamp(1 - b.t / b.len, 0, 1);
    ctx.fillStyle = '#23303a'; ctx.fillRect(BOX.minX, BOX.minY - 22, BOX.maxX - BOX.minX, 8);
    ctx.fillStyle = '#e8f1ff'; ctx.fillRect(BOX.minX, BOX.minY - 22, (BOX.maxX - BOX.minX) * left, 8);
    if (b.preview) {
      const pv = b.preview, lh = (BOX.maxY - BOX.minY) / 5, lw = (BOX.maxX - BOX.minX) / 5;
      ctx.save(); ctx.fillStyle = 'rgba(150,240,200,.16)'; ctx.strokeStyle = 'rgba(150,240,200,.8)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
      if (pv.pattern === 'lanes') {
        if (pv.vertical) { const x = BOX.minX + lw * pv.safe; ctx.fillRect(x, BOX.minY, lw, BOX.maxY - BOX.minY); ctx.strokeRect(x + 2, BOX.minY + 2, lw - 4, BOX.maxY - BOX.minY - 4); }
        else { const y = BOX.minY + lh * pv.safe; ctx.fillRect(BOX.minX, y, BOX.maxX - BOX.minX, lh); ctx.strokeRect(BOX.minX + 2, y + 2, BOX.maxX - BOX.minX - 4, lh - 4); }
      } else {
        // the gap is the 3 skipped spokes starting at `safe`: centre on the middle one
        const cx = (BOX.minX + BOX.maxX) / 2, cy = (BOX.minY + BOX.maxY) / 2, mid = (pv.safe + 1) / 20 * TAU + pv.off, half = TAU / 20 * 1.3;
        ctx.beginPath(); ctx.rect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY); ctx.clip();
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 400, mid - half, mid + half); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.setLineDash([]); text('SAFE', 640, BOX.maxY + 22, 15, 'rgba(150,240,200,.95)', 'center', false);
      ctx.restore();
    }
    ctx.save(); ctx.beginPath(); ctx.rect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY); ctx.clip();
    for (const p of b.bullets) {
      const ready = p.age >= p.tele;
      if (p.wall) { ctx.fillStyle = ready ? '#ff5a46' : 'rgba(255,90,70,.25)'; if (p.vertical) ctx.fillRect(p.x - p.r, p.y - 12, p.r * 2, 24); else ctx.fillRect(p.x - 12, p.y - p.r, 24, p.r * 2); }
      else if (!ready) {
        const sp = Math.hypot(p.vx, p.vy) || 1; ctx.strokeStyle = 'rgba(255,170,140,.55)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.vx / sp * (p.aimed ? 110 : 50), p.y + p.vy / sp * (p.aimed ? 110 : 50)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,200,170,.6)'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, TAU); ctx.fill();
      } else { ctx.fillStyle = '#ffd9c8'; ctx.shadowColor = '#ff5a46'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }
    }
    ctx.restore();
    const so = b.soul, inv = s.hero.inv > 0 && Math.floor(fx.clock * 16) % 2;
    ctx.save(); ctx.translate(so.x, so.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = inv ? 'rgba(159,248,255,.35)' : P[f].hero; ctx.shadowColor = P[f].hero; ctx.shadowBlur = 14; ctx.fillRect(-6, -6, 12, 12); ctx.restore();
    ctx.restore();
  }
  function drawTiming(s) {
    const tm = s.timing; if (!tm) return;
    const x0 = 400, w = 480, y = 230, m = tm.marker, pal = P[form(s)];
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(-500, -300, W + 1000, H + 600);
    text(tm.result ? '' : 'COUNTER! PRESS J', 640, y - 34, 30, '#ffffff');
    ctx.fillStyle = '#0b1014'; ctx.fillRect(x0 - 4, y - 4, w + 8, 30);
    ctx.fillStyle = '#1e262c'; ctx.fillRect(x0, y, w, 22);
    ctx.fillStyle = 'rgba(197,233,255,.35)'; ctx.fillRect(x0 + w * (0.5 - 0.13), y, w * 0.26, 22);
    ctx.fillStyle = pal.hero; ctx.fillRect(x0 + w * 0.45, y, w * 0.1, 22);
    const mx = x0 + w * m;
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 12; ctx.fillRect(mx - 3, y - 10, 6, 42); ctx.shadowBlur = 0;
    text('GOOD', x0 + w * 0.5, y + 46, 14, '#c5e9ff', 'center', false, 600);
    ctx.restore();
  }
  function keycap(x, y, label, state, size = 54) {
    const col = { todo: '#2a333b', now: '#f2ede2', done: '#7fe0b0', bad: '#ff5a46' }[state];
    ctx.save(); ctx.translate(x, y); if (state === 'now' && !reducedMotion) { const p = 1 + Math.sin(fx.clock * 10) * 0.05; ctx.scale(p, p); }
    ctx.fillStyle = '#0b1014'; ctx.fillRect(-size / 2, -size / 2 + 5, size, size);
    ctx.fillStyle = col; ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = state === 'todo' ? '#9aa6b0' : '#0b1014'; ctx.font = font(size * 0.55); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 2); ctx.restore(); ctx.textBaseline = 'alphabetic';
  }
  function drawRune(s) {
    const r = s.rune; if (!r) return;
    const cx = 640, cy = 210, k = easeOut(r.rise), pal = P[form(s)];
    ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.5 * k})`; ctx.fillRect(-500, -300, W + 1000, H + 600);
    ctx.translate(s.boss.x, s.boss.y - 100); ctx.rotate(fx.clock * 0.8); ctx.strokeStyle = form(s) === 3 ? '#ffffff' : '#ffcf7a'; ctx.globalAlpha = 0.6 * k; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 150 + i * 26, 0, TAU); ctx.stroke(); }
    for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i / 12 * TAU); ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(160, -3, 14, 6); ctx.restore(); }
    ctx.restore();
    const n = r.keys.length, gap = 66, x0 = cx - (n - 1) * gap / 2;
    ctx.save(); ctx.globalAlpha = k;
    text(r.done === 'fail' ? 'RUNE BROKEN' : r.done === 'win' ? 'REFLECTED!' : 'TYPE THE RUNES IN ORDER', cx, cy - 64, 28, '#ffe2a6');
    r.keys.forEach((key, i) => keycap(x0 + i * gap, cy, key, r.done === 'fail' && i === Math.max(0, r.wrong) ? 'bad' : i < r.i ? 'done' : i === r.i && !r.done ? 'now' : 'todo', 52));
    const left = clamp(1 - r.t / r.limit, 0, 1);
    ctx.fillStyle = '#23303a'; ctx.fillRect(cx - 200, cy + 48, 400, 8); ctx.fillStyle = left < 0.3 ? '#ff5a46' : '#ffcf7a'; ctx.fillRect(cx - 200, cy + 48, 400 * left, 8);
    text('WRONG KEY OR TOO SLOW = CONTROLS INVERTED', cx, cy + 84, 17, '#c8d0d6', 'center', true, 600);
    ctx.restore();
  }
  function drawChained(s) {
    const c = s.chain; if (!c) return;
    const h = s.hero;
    drawChain(s.boss.x - 70, s.boss.y - 70, h.x, h.y - 45, 1);
    drawChain(s.boss.x + 30, s.boss.y - 40, h.x + 10, h.y - 30, 0.8);
    const n = c.keys.length, gap = 70, cx = clamp(h.x, 200, 1080), cy = h.y - 170, x0 = cx - (n - 1) * gap / 2;
    ctx.save(); text('BREAK FREE!', cx, cy - 50, 26, '#ffffff');
    c.keys.forEach((key, i) => keycap(x0 + i * gap, cy, key, i < c.i ? 'done' : i === c.i ? (c.wrong > 0 ? 'bad' : 'now') : 'todo', 54));
    const left = clamp(1 - c.t / c.limit, 0, 1); ctx.fillStyle = '#23303a'; ctx.fillRect(cx - 110, cy + 42, 220, 7); ctx.fillStyle = '#ff7a5a'; ctx.fillRect(cx - 110, cy + 42, 220 * left, 7);
    ctx.restore();
  }
  function drawFinisherWorld(s) {
    for (const tr of s.hero.trail) drawHero(s, tr.x, tr.y, tr.life * 2.4, tr.face, true);
    const c = s.finisher.cine; if (!c) return;
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(-500, -300, W + 1000, H + 600);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) { const a = i / 26 * TAU + fx.clock * 0.5, r1 = 160 + ((fx.clock * 900 + i * 53) % 420); ctx.beginPath(); ctx.moveTo(s.boss.x + Math.cos(a) * r1, s.boss.y - 90 + Math.sin(a) * r1); ctx.lineTo(s.boss.x + Math.cos(a) * (r1 + 70), s.boss.y - 90 + Math.sin(a) * (r1 + 70)); ctx.stroke(); }
    ctx.restore();
  }
  function letterbox(k) { const bar = easeOut(clamp(k, 0, 1)) * 74; ctx.fillStyle = '#000'; ctx.fillRect(-500, -300, W + 1000, 300 + bar); ctx.fillRect(-500, H - bar, W + 1000, bar + 300); }
  function drawFinisherScreen(s) {
    const c = s.finisher.cine; if (!c) return;
    const k = c.t / c.len;
    letterbox(k * 5);
    drawSlashes();
    if (k < 0.32) { ctx.save(); ctx.globalAlpha = Math.min(1, k * 8) * (1 - Math.max(0, (k - 0.22) * 10)); const sc = reducedMotion ? 1 : lerp(1.25, 1, easeOut(k * 6));
      ctx.translate(640, 150); ctx.scale(sc, sc); text('ECLIPSE BREAKER', 0, 0, 70, s.stage === 3 ? '#ffffff' : '#ffe08a'); ctx.restore(); }
    if (k > 0.8) { ctx.save(); ctx.globalAlpha = clamp((k - 0.8) * 8, 0, 1); text(aligned(s) || (s.stage === 2 && s.boss.hp <= c.dmg) ? 'THE ECLIPSE ALIGNS' : 'FINISH!', 640, H - 30, 30, '#ffffff'); ctx.restore(); }
  }
  function drawSlashes() {
    for (const sl of fx.slashes) {
      const a = clamp(1 - sl.t / 0.45, 0, 1), grow = easeOut(Math.min(1, sl.t * 9));
      ctx.save(); ctx.translate(640, sl.y); ctx.rotate(sl.a); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(-900 * grow, -4 * a - 1, 1800 * grow, 8 * a + 2);
      ctx.fillStyle = `rgba(255,210,120,${a * 0.6})`; ctx.fillRect(-900 * grow, -14 * a, 1800 * grow, 28 * a);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ laser clash (mash to win)
  function clashGeom(s) {
    const c = s.clash, h = s.hero, b = s.boss;
    const hx = h.x + 46, hy = h.y - 74, bx = b.x - 30, by = b.y - 128;
    const p = c.won ? lerp(c.p, 1.25, easeOut(c.wonT / 0.35)) : c.p;
    const sxp = lerp(hx, bx, p), syp = lerp(hy, by, p), pw = c.t < 1.3 ? easeOut(c.t / 1.3) : 1;
    return { hx, hy, bx, by, sxp, syp, pw, p };
  }
  function drawClashWorld(s) {
    const c = s.clash; if (!c) return;
    const f = form(s), pal = P[f], g = clashGeom(s);
    const heroCol = pal.hero, bossCol = f === 3 ? '#ff3b5c' : pal.boss;
    // two domains split at the seam: the hero's sky of rings vs the boss's eclipse sigil
    ctx.save();
    ctx.beginPath(); ctx.moveTo(-500, -300);
    for (let i = 0; i <= 12; i++) { const yy = -300 + i * 110, jag = Math.sin(i * 2.7 + fx.clock * 9) * 18; ctx.lineTo(g.sxp + jag, yy); }
    ctx.lineTo(-500, H + 300); ctx.closePath(); ctx.clip();
    ctx.fillStyle = f === 3 ? 'rgba(10,40,48,.55)' : f === 2 ? 'rgba(60,44,10,.45)' : 'rgba(6,40,46,.5)'; ctx.fillRect(-500, -300, W + 1000, H + 600);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = heroCol; ctx.translate(s.hero.x, s.hero.y - 70);
    for (let i = 0; i < 6; i++) { ctx.globalAlpha = 0.18 + (i % 2) * 0.12; ctx.lineWidth = 2; ctx.save(); ctx.rotate(fx.clock * (i % 2 ? 0.6 : -0.4)); ctx.setLineDash([30 + i * 8, 18]); ctx.beginPath(); ctx.arc(0, 0, 80 + i * 70, 0, TAU); ctx.stroke(); ctx.restore(); }
    ctx.restore(); ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.moveTo(W + 500, -300);
    for (let i = 0; i <= 12; i++) { const yy = -300 + i * 110, jag = Math.sin(i * 2.7 + fx.clock * 9) * 18; ctx.lineTo(g.sxp + jag, yy); }
    ctx.lineTo(W + 500, H + 300); ctx.closePath(); ctx.clip();
    ctx.fillStyle = f === 3 ? 'rgba(0,0,0,.6)' : 'rgba(40,4,2,.55)'; ctx.fillRect(-500, -300, W + 1000, H + 600);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(s.boss.x, s.boss.y - 110); ctx.strokeStyle = bossCol;
    ctx.rotate(-fx.clock * 0.3); ctx.globalAlpha = 0.4; ctx.lineWidth = 3;
    for (const r of [200, 260, 380]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
    for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i / 12 * TAU); ctx.beginPath(); ctx.moveTo(200, -10); ctx.lineTo(258, 0); ctx.lineTo(200, 10); ctx.stroke(); ctx.fillStyle = bossCol; ctx.fillRect(300, -2, 50, 4); ctx.restore(); }
    ctx.restore(); ctx.restore();
    // beams grow from both fighters and meet at the seam
    const hEndX = lerp(g.hx, g.sxp, g.pw), hEndY = lerp(g.hy, g.syp, g.pw), bEndX = lerp(g.bx, g.sxp, g.pw), bEndY = lerp(g.by, g.syp, g.pw);
    const push = fx.clashPulse;
    beam(g.hx, g.hy, hEndX, hEndY, 22 + push * 8 + (c.kind - 1) * 4, heroCol, '#ffffff', 1);
    if (!c.won || c.wonT < 0.3) beam(g.bx, g.by, bEndX, bEndY, 24 + (c.kind - 1) * 5, bossCol, f === 3 ? '#000' : '#fff3e8', 1);
    glow(g.hx, g.hy, 50, 'rgba(255,255,255,.8)');
    if (g.pw >= 1) {
      // the seam: a churning ball of both colours, lightning arcs, sparks
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const R = 60 + push * 14 + Math.sin(fx.clock * 30) * 6;
      glow(g.sxp, g.syp, R * 2.6, 'rgba(255,255,255,.45)'); glow(g.sxp - 20, g.syp, R * 1.4, heroCol.length === 7 ? heroCol + 'aa' : heroCol); glow(g.sxp + 20, g.syp, R * 1.4, bossCol + 'aa');
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(g.sxp, g.syp, R * 0.45, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        let px = g.sxp, py = g.syp; const a = Math.random() * TAU; ctx.globalAlpha = 0.5 + Math.random() * 0.5; ctx.beginPath(); ctx.moveTo(px, py);
        for (let k = 0; k < 6; k++) { px += Math.cos(a + (Math.random() - 0.5) * 1.4) * 26; py += Math.sin(a + (Math.random() - 0.5) * 1.4) * 26; ctx.lineTo(px, py); } ctx.stroke();
      }
      ctx.restore();
      if (fx.particles.length < P_MAX - 6) for (let i = 0; i < 3; i++) { const a = (Math.random() - 0.5) * 2.4 + (Math.random() < 0.5 ? Math.PI : 0); fx.particles.push({ x: g.sxp, y: g.syp, vx: Math.cos(a) * 500, vy: Math.sin(a) * 400 - 100, life: 0.5, max: 0.5, size: 3, color: Math.random() < 0.5 ? heroCol : '#ffffff', grav: 500 }); }
    }
  }
  function drawClashHud(s) {
    const c = s.clash; if (!c) return;
    const f = form(s), pal = P[f], heroCol = pal.hero, bossCol = f === 3 ? '#ff3b5c' : pal.boss;
    const title = ['', 'BEAM CLASH', 'DOMAIN CLASH', 'TOTALITY CLASH'][c.kind];
    if (c.t < 1.6) { ctx.save(); const k = c.t / 1.6; ctx.globalAlpha = Math.sin(clamp(k, 0, 1) * Math.PI); const sc = reducedMotion ? 1 : lerp(1.5, 1, easeOut(k * 2)); ctx.translate(640, 300); ctx.scale(sc, sc); text(title, 0, 0, 84, '#ffffff'); ctx.restore(); }
    // tug-of-war bar
    const x0 = 340, w = 600, y = 92, p = clamp(c.p, 0, 1);
    text(title, 640, y - 14, 22, '#ffffff');
    ctx.fillStyle = '#0b1014'; ctx.fillRect(x0 - 4, y - 4, w + 8, 26);
    ctx.fillStyle = bossCol; ctx.fillRect(x0, y, w, 18);
    ctx.fillStyle = heroCol; ctx.fillRect(x0, y, w * p, 18);
    ctx.fillStyle = '#0b1014'; for (const m of [0.65, 0.8, 0.9]) ctx.fillRect(x0 + w * m - 1.5, y - 4, 3, 26);
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 14; ctx.fillRect(x0 + w * p - 3, y - 8, 6, 34); ctx.shadowBlur = 0;
    text(STAGES[s.stage].hero, x0, y + 44, 16, heroCol, 'left', true, 600); text(STAGES[s.stage].boss, x0 + w, y + 44, 16, bossCol, 'right', true, 600);
    if (c.won) { const k = clamp(c.wonT / 0.6, 0, 1); ctx.save(); ctx.globalAlpha = k; ctx.translate(640, 330); const sc = reducedMotion ? 1 : lerp(1.6, 1, easeOutBack(k)); ctx.scale(sc, sc); text('BREAKTHROUGH', 0, 0, 90, '#ffffff'); ctx.restore(); return; }
    if (c.t >= 1.3) {
      const pulse = reducedMotion ? 1 : 1 + Math.sin(fx.clock * 16) * 0.05 + fx.clashPulse * 0.08;
      ctx.save(); ctx.translate(640, 610); ctx.scale(pulse, pulse);
      const msg = c.p >= 0.9 ? 'FINISH IT!' : c.p >= 0.8 ? 'ALMOST THERE' : c.p >= 0.65 ? 'BREAKING THROUGH' : c.p < 0.3 ? 'HOLD IT!' : 'PUSH!';
      text(msg, 0, -44, 40, c.p < 0.3 ? '#ff8a6b' : '#ffffff');
      text(fx.touch ? 'TAP FAST' : 'MASH  J  ·  ENTER  ·  CLICK', 0, 12, 30, '#ffffff');
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ cinematics
  function drawCineWorld(s) {
    const c = s.cine; if (!c) return;
    const k = c.t / c.len, h = s.hero, b = s.boss;
    if (c.kind === 'reborn') {
      // pillars of light swallow both fighters, then the new forms step out
      const pk = k < 0.5 ? easeOut(k / 0.5) : 1 - easeOut((k - 0.5) / 0.3);
      if (pk > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (const [x, col, w] of [[h.x, k < 0.5 ? '#9ff8ff' : '#ffe08a', 70], [b.x, '#ff6a3a', 140]]) {
          const g = ctx.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, col); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.75 * pk; ctx.fillStyle = g; ctx.fillRect(x - w, -300, w * 2, 1200);
          ctx.globalAlpha = pk; ctx.fillStyle = '#ffffff'; ctx.fillRect(x - w * 0.08, -300, w * 0.16, 1200);
        }
        ctx.restore();
        if (Math.random() < 0.8) part(h.x + (Math.random() - 0.5) * 60, h.y, 1, '#ffe08a', 120, 1, 3, -400);
        if (Math.random() < 0.8) part(b.x + (Math.random() - 0.5) * 120, b.y, 1, '#ff7a4a', 140, 1, 3, -400);
      }
    } else if (c.kind === 'totality') {
      // the moon slides over the sun; the world goes dark from the edges in
      const dk = easeOut(clamp(k / 0.5, 0, 1));
      ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.7 * dk * (k < 0.5 ? 1 : 1 - easeOut((k - 0.5) / 0.2))})`; ctx.fillRect(-500, -300, W + 1000, H + 600); ctx.restore();
      if (k < 0.5) { const ex = 980 - fx.camX * 0.1, ey = 150; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(lerp(ex + 260, ex, dk), lerp(ey - 60, ey, dk), 86, 0, TAU); ctx.fill(); glow(ex, ey, 140 * (1 - dk) + 20, 'rgba(255,255,255,.6)'); }
    } else if (c.kind === 'ending' || c.kind === 'trueEnding') {
      // cracks of light spread over the boss, it shatters, dawn rises
      if (!fx.bossGone && k < 0.5) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 16;
        const n = Math.floor(k / 0.5 * 14) + 1;
        for (let i = 0; i < n; i++) { const a = i * 2.39996, r = 30 + (i % 4) * 30; ctx.beginPath(); ctx.moveTo(b.x, b.y - 110); ctx.lineTo(b.x + Math.cos(a) * r * 0.6, b.y - 110 + Math.sin(a) * r * 0.6); ctx.lineTo(b.x + Math.cos(a + 0.3) * r * 1.4, b.y - 110 + Math.sin(a + 0.3) * r * 1.4); ctx.stroke(); }
        ctx.restore(); glow(b.x, b.y - 110, 80 + k * 300, 'rgba(255,255,255,.6)', k * 2);
      }
      if (c.kind === 'trueEnding' && k > 0.45 && k < 0.7) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(b.x, b.y - 130, lerp(60, 1400, easeOut((k - 0.45) / 0.25)), 'rgba(255,255,255,.95)'); ctx.restore(); }
    }
  }
  function drawCineScreen(s) {
    const c = s.cine; if (!c) return;
    const k = c.t / c.len;
    letterbox(Math.min(k * 4, (1 - k) * 8 + 0.2));
    ctx.save();
    if (c.kind === 'reborn' && k > 0.58) {
      const a = clamp((k - 0.58) * 5, 0, 1), sl = reducedMotion ? 0 : (1 - easeOut(a)) * 80;
      ctx.globalAlpha = a; text(STAGES[2].hero, 360 - sl, 640, 34, P[2].hero); text(STAGES[2].boss, 960 + sl, 640, 34, P[2].name);
      text('BOTH FIGHTERS TRANSFORMED', 640, 140, 26, '#ffffff', 'center', true, 600);
    }
    if (c.kind === 'totality' && k > 0.52) {
      const a = clamp((k - 0.52) * 4, 0, 1); ctx.globalAlpha = a; ctx.translate(640, 300);
      const sc = reducedMotion ? 1 : lerp(1.3, 1, easeOut(a)); ctx.scale(sc, sc); ctx.font = font(120); ctx.letterSpacing = `${Math.round(lerp(40, 14, easeOut(a)))}px`;
      text('TOTALITY', 0, 0, 120, '#ffffff'); ctx.letterSpacing = '0px'; text('SECRET PHASE', 0, 54, 26, '#ff3b5c', 'center', true, 600);
    }
    if ((c.kind === 'ending' || c.kind === 'trueEnding') && k > 0.6) {
      const a = clamp((k - 0.6) * 4, 0, 1); ctx.globalAlpha = a;
      text(c.kind === 'trueEnding' ? 'TOTALITY IS OVER' : 'THE ECLIPSE IS BROKEN', 640, 300, 72, '#ffffff');
      text(c.kind === 'trueEnding' ? 'TRUE ENDING' : 'VICTORY', 640, 344, 24, c.kind === 'trueEnding' ? '#bff4ff' : '#ffd7a1', 'center', true, 600);
    }
    ctx.restore();
    if ((c.kind === 'ending' || c.kind === 'trueEnding') && c.t > 2.5) text(fx.touch ? 'TAP TO SKIP' : 'ENTER TO SKIP', W - 30, H - 24, 15, '#9aa6b0', 'right', false, 600);
  }

  // ------------------------------------------------------------------ HUD
  function hpBar(x, y, w, h, hp, chip, max, color, gates = []) {
    ctx.fillStyle = '#0b1014'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = '#1e262c'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f2ede2'; ctx.fillRect(x, y, w * chip / max, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * hp / max, h);
    ctx.fillStyle = '#0b1014'; for (const g of gates) ctx.fillRect(x + w * g / max - 1.5, y - 3, 3, h + 6);
  }
  function drawHud(s, touch) {
    const b = s.boss, h = s.hero, f = form(s), pal = P[f], st = STAGES[s.stage];
    const al = aligned(s);
    // boss bar
    const flick = al && Math.floor(fx.clock * 8) % 5 === 0;
    text(flick ? 'THE ECLIPSE ALIGNS' : st.boss, 290, 42, 22, flick ? '#ffffff' : pal.name, 'left', false);
    text(s.stage === 3 ? 'SECRET PHASE' : `PHASE ${s.stage}`, 990, 42, 15, s.stage === 3 ? '#ff3b5c' : '#9aa6b0', 'right', false, 600);
    hpBar(290, 52, 700, 14, b.hp, b.chip, b.max, pal.bar, b.gates.slice(b.gateIndex));
    if (fx.callout && fx.callout.t < 1 && s.phase === 'fight') { ctx.save(); ctx.globalAlpha = 1 - clamp((fx.callout.t - 0.6) / 0.4, 0, 1); text(fx.callout.text, 640, 96, 20, pal.tele); ctx.restore(); }
    // hero panel
    const hy = touch ? 96 : 646;
    text(st.hero, 40, hy, 18, pal.hero, 'left', false);
    hpBar(40, hy + 10, 300, 12, h.hp, Math.max(h.hp, h.chip), HERO_MAX, h.hp < 25 ? '#ff6a5a' : '#7fe0b0');
    for (let i = 0; i < Math.max(h.heals, 1); i++) { const on = i < h.heals; ctx.fillStyle = on ? '#9ff0c4' : '#26323a'; ctx.beginPath(); ctx.arc(360 + i * 22, hy + 16, 8, 0, TAU); ctx.fill(); ctx.fillStyle = on ? '#0b1014' : '#4b5a63'; ctx.fillRect(356 + i * 22, hy + 15, 8, 2); ctx.fillRect(359 + i * 22, hy + 12, 2, 8); }
    text(touch ? 'HEALS' : 'H  HEAL', 356, hy + 40, 13, '#9aa6b0', 'left', false, 600);
    // ability dock: six specials of the current form
    fx.dock = [];
    const size = touch ? 64 : 52, gap = touch ? 80 : 70, dx0 = touch ? 640 - gap * 2.5 : 1240 - size / 2 - gap * 5, dy = touch ? 630 : 640;
    if (!touch) text('J SLASH   K CAST   Q / E SWITCH   SPACE DODGE', 1240, dy - 46, 14, '#9aa6b0', 'right', false, 600);
    ABIL_ORDER.forEach((name, i) => {
      const a = ABIL[name], x = dx0 + i * gap, sel = h.sel === name, cd = (h.cds[name] || 0) / a.cd[s.stage];
      fx.dock.push({ x: x - size / 2, y: dy - size / 2, w: size, h: size, key: a.key });
      ctx.save(); ctx.translate(x, dy - (sel ? 6 : 0));
      ctx.fillStyle = '#0b1014'; ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.fillStyle = sel ? pal.hero : '#1e262c'; ctx.globalAlpha = sel ? 0.22 : 1; ctx.fillRect(-size / 2, -size / 2, size, size); ctx.globalAlpha = 1;
      if (cd > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(-size / 2, -size / 2, size, size * cd); }
      ctx.strokeStyle = sel ? pal.hero : '#3a4650'; ctx.lineWidth = sel ? 3 : 1.5; ctx.strokeRect(-size / 2, -size / 2, size, size);
      drawAbilityIcon(name, f, cd > 0 ? 0.45 : 1, pal.hero);
      text(a.key, -size / 2 + 6, -size / 2 + 14, 13, '#c8d0d6', 'left', false, 700);
      ctx.restore();
      ctx.font = font(13, 600); const lw = ctx.measureText(a.names[s.stage]).width, lpx = lw > gap - 6 ? Math.floor(13 * (gap - 6) / lw) : 13; // never collide, even with a fallback font
      text(a.names[s.stage], x, dy + size / 2 + 16, lpx, sel ? pal.hero : '#9aa6b0', 'center', false, 600);
    });
    if (s.finisher.prompt > 0 && s.phase === 'fight') {
      const p = s.finisher.prompt / FIN.window, pulse = reducedMotion ? 1 : 1 + Math.sin(fx.clock * 12) * 0.06;
      ctx.save(); ctx.translate(640, touch ? 470 : 560); ctx.scale(pulse, pulse);
      const col = al ? '#ffffff' : '#ffe08a';
      ctx.fillStyle = '#0b1014'; ctx.fillRect(-160, -30, 320, 60); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.strokeRect(-160, -30, 320, 60);
      ctx.fillStyle = col; ctx.fillRect(-160, 26, 320 * p, 4);
      ctx.font = font(30); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(touch ? 'FINISHER!' : 'FINISHER  [ F ]', 0, 0); ctx.restore(); ctx.textBaseline = 'alphabetic';
    }
    if (h.invert > 0 && s.phase !== 'rune') { const jit = reducedMotion ? 0 : Math.sin(fx.clock * 40) * 2; text(`CONTROLS INVERTED  ${h.invert.toFixed(1)}s`, 640 + jit, 128, 22, '#ff7a5a'); }
    drawBanner(s);
  }
  function drawAbilityIcon(name, f, alpha, col) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    if (name === 'star') { star(0, 2, 13, f === 2 ? 6 : 4, 0.4, -Math.PI / 2); ctx.fill(); }
    else if (name === 'spinner') { for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 2, 12, i * 2.1, i * 2.1 + 1.2); ctx.stroke(); } }
    else if (name === 'burst') { ctx.beginPath(); ctx.arc(0, 2, 7, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(0, 2, 14, 0, TAU); ctx.stroke(); }
    else if (name === 'eyes') { ctx.beginPath(); ctx.ellipse(0, 2, 15, 7, 0, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 2, 4, 0, TAU); ctx.fill(); }
    else if (name === 'lattice') { for (let i = 0; i < 3; i++) { ctx.fillRect(-11 + i * 9, -12 + i * 3, 3, 14); star(-10 + i * 9, 6 + i * 3, 4, 4, 0.4, 0); ctx.fill(); } }
    else if (name === 'nova') { ctx.beginPath(); ctx.arc(0, 2, 9, 0, TAU); ctx.fill(); ctx.save(); ctx.scale(1, 0.4); ctx.beginPath(); ctx.arc(0, 5, 17, 0, TAU); ctx.stroke(); ctx.restore(); }
    ctx.restore();
  }
  function drawBanner(s) {
    if (!s.banner) return;
    const bn = s.banner, inT = easeOutBack(bn.t / 0.3), out = clamp((bn.t - 1.4) / 0.35, 0, 1);
    if (bn.t >= 1.75) return;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(640, s.phase === 'box' ? 200 : 250); const sc = reducedMotion ? 1 : lerp(1.4, 1, clamp(inT, 0, 1.1)); ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-W, -46, W * 2, 92);
    text(bn.text, 0, 18, 64, bn.color, 'center', false);
    if (bn.sub) text(bn.sub, 0, 40, 18, '#d0d8de', 'center', false, 600);
    ctx.restore();
  }
  function drawFx(dt) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of fx.particles) {
      p.life -= dt;
      if (p.spiral) { p.a += dt * 5; p.d = Math.max(0, p.d - dt * 260); p.x = p.tx + Math.cos(p.a) * p.d; p.y = p.ty + Math.sin(p.a) * p.d * 0.4; }
      else { p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; }
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    fx.particles = fx.particles.filter((p) => p.life > 0);
    for (const r of fx.rings) { r.t += dt; if (r.t < 0) continue; const k = r.t / r.life; ctx.globalAlpha = 1 - k; ctx.strokeStyle = r.color; ctx.lineWidth = r.w * (1 - k) + 0.5; const rr = lerp(r.r0, r.r1, easeOut(k)); ctx.beginPath(); ctx.ellipse(r.x, r.y, Math.max(0.1, rr), Math.max(0.1, rr * r.flat), 0, 0, TAU); ctx.stroke(); }
    fx.rings = fx.rings.filter((r) => r.t < r.life);
    ctx.restore();
    for (const n of fx.numbers) {
      n.t += dt; const k = n.t / (n.big ? 1 : 0.7);
      ctx.save(); ctx.globalAlpha = clamp(1 - k, 0, 1);
      const y = n.y - easeOut(k) * 30, sc = n.big && !reducedMotion ? lerp(1.5, 1, easeOut(Math.min(1, n.t * 6))) : 1;
      ctx.translate(n.x, y); ctx.scale(sc, sc); text(n.text, 0, 0, n.big ? 34 : 22, n.color); ctx.restore();
    }
    fx.numbers = fx.numbers.filter((n) => n.t < (n.big ? 1 : 0.7));
  }

  // ------------------------------------------------------------------ frame
  function render(s, dt, view) {
    if (fx.last !== s) { reset(); fx.last = s; }
    fx.clock += dt; fx.touch = !!view.touch;
    fx.clashPulse = Math.max(0, fx.clashPulse - dt * 6);
    if (fx.callout) fx.callout.t += dt;
    for (const x of fx.scorch) x.t += dt; for (const x of fx.cracks) x.t += dt; for (const x of fx.slashes) x.t += dt;
    fx.scorch = fx.scorch.filter((x) => x.t < 6); fx.cracks = fx.cracks.filter((x) => x.t < 6); fx.slashes = fx.slashes.filter((x) => x.t < 0.45);
    if (s.phase === 'cine' && s.cine && (s.cine.kind === 'ending' || s.cine.kind === 'trueEnding')) { fx.endKind = s.cine.kind; if (s.cine.t / s.cine.len > 0.5) fx.dawn = Math.min(1, fx.dawn + dt * 0.5); }
    if (s.phase === 'victory') { fx.dawn = Math.min(1, fx.dawn + dt * 0.5); fx.bossGone = true; fx.endKind = s.result?.tier === 'secret' ? 'trueEnding' : 'ending'; }
    consume(s); s.events.length = 0;
    const { width, height, scale, ox, oy } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050708'; ctx.fillRect(0, 0, width, height);
    const h = s.hero, b = s.boss;
    // camera
    let tz = 1, tx = 0, ty = 0;
    if (s.phase === 'finisher') { tz = 1.35; tx = (b.x - 640) * 0.6; ty = (b.y - 140 - 360) * 0.6; }
    else if (s.phase === 'box') tz = 0.96;
    else if (s.phase === 'chained') { tz = 1.08; tx = ((h.x + b.x) / 2 - 640) * 0.4; }
    else if (s.phase === 'clash' && s.clash) { const g = clashGeom(s); tz = 1.04 + (s.clash.won ? 0.12 : s.clash.p * 0.06); tx = (g.sxp - 640) * 0.25; ty = -20; }
    else if (s.phase === 'cine' && s.cine) { const k = s.cine.t / s.cine.len; if (s.cine.kind === 'totality') { tz = lerp(1, 1.12, easeOut(k)); tx = 160 * easeOut(k); ty = -120 * easeOut(k); } else if (s.cine.kind === 'reborn') { tz = k < 0.5 ? lerp(1, 1.1, easeOut(k * 2)) : 1.02; } else { tz = lerp(1.05, 1.12, k); tx = (b.x - 640) * 0.3 * (1 - k); } }
    else if (['fight', 'intro', 'victory', 'defeat'].includes(s.phase)) { tx = ((h.x + b.x) / 2 - 640) * 0.18; tz = 1 + clamp(1 - Math.abs(b.x - h.x) / 900, 0, 1) * 0.06; }
    if (reducedMotion) tz = 1;
    fx.zoom = lerp(fx.zoom, tz, 1 - Math.exp(-dt * 5)); fx.camX = lerp(fx.camX, tx, 1 - Math.exp(-dt * 4)); fx.camY = lerp(fx.camY, ty, 1 - Math.exp(-dt * 4));
    fx.trauma = Math.max(0, fx.trauma - dt * 1.5);
    const sh = fx.trauma * fx.trauma, shx = Math.sin(fx.clock * 47) * 14 * sh, shy = Math.sin(fx.clock * 61) * 9 * sh, rot = Math.sin(fx.clock * 31) * 0.02 * sh;
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.translate(640 + shx, 360 + shy); ctx.rotate(rot); ctx.scale(fx.zoom, fx.zoom); ctx.translate(-640 - fx.camX, -360 - fx.camY);
    drawArena(s);
    if (s.phase === 'clash') drawClashWorld(s);
    drawHazards(s);
    const heroFirst = h.y < b.y + 30;
    if (s.phase !== 'finisher') for (const tr of h.trail) drawHero(s, tr.x, tr.y, tr.life * 2, tr.face, true);
    if (s.phase === 'defeat') { ctx.save(); ctx.globalAlpha = 0.5; drawBoss(s); ctx.restore(); }
    else if (heroFirst) { drawHero(s, h.x, h.y); drawBoss(s); } else { drawBoss(s); drawHero(s, h.x, h.y); }
    if (s.phase === 'clash' && s.clash && s.clash.won && s.clash.wonT > 0.15) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(b.x, b.y - 110, 300 * easeOut(s.clash.wonT), 'rgba(255,255,255,.85)'); ctx.restore(); }
    drawShots(s);
    if (s.phase === 'chained') drawChained(s);
    drawFinisherWorld(s);
    drawCineWorld(s);
    drawFx(dt);
    drawBox(s);
    drawRune(s);
    drawTiming(s);
    // screen space
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    fx.chroma = Math.max(h.invert > 0 ? 0.12 + 0.05 * Math.sin(fx.clock * 9) : 0, fx.chroma - dt * 1.5);
    if (fx.chroma > 0 && !reducedMotion) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fx.chroma * 0.6; ctx.fillStyle = '#ff2a2a'; ctx.fillRect(-6, 0, W, H); ctx.fillStyle = '#2affd8'; ctx.fillRect(6, 0, W, H); ctx.restore(); }
    fx.vignette = Math.max(h.hp < 25 && s.phase === 'fight' ? 0.25 + 0.15 * Math.sin(fx.clock * 5) : 0, fx.vignette - dt);
    if (fx.vignette > 0) { const g = ctx.createRadialGradient(640, 360, 250, 640, 360, 760); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(170,20,10,${fx.vignette})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    drawFinisherScreen(s);
    drawCineScreen(s);
    if (s.phase === 'clash') drawClashHud(s);
    else if (!['finisher', 'cine', 'victory', 'intro'].includes(s.phase)) drawHud(s, !!view.touch);
    if (s.phase === 'cine' || s.phase === 'clash') drawBanner(s);
    if (fx.flash > 0) { ctx.globalAlpha = Math.min(1, fx.flash); ctx.fillStyle = fx.flashColor; ctx.fillRect(-500, -300, W + 1000, H + 600); ctx.globalAlpha = 1; fx.flash = Math.max(0, fx.flash - dt * 4); }
    if (fx.invert > 0) { // photo-negative frame for the heaviest beats (off with reduced motion)
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.restore(); fx.invert -= dt;
    }
    if (s.phase === 'intro') { const k = s.phaseT / 1.6, st = STAGES[s.stage]; ctx.fillStyle = `rgba(0,0,0,${1 - easeOut(k)})`; ctx.fillRect(-500, -300, W + 1000, H + 600); ctx.save(); ctx.globalAlpha = Math.sin(clamp(k, 0, 1) * Math.PI); text(st.boss, 640, 340, 72, P[s.stage].name); text(s.stage === 3 ? 'SECRET PHASE' : `PHASE ${s.stage}`, 640, 380, 22, '#c8d0d6', 'center', true, 600); ctx.restore(); }
    if (s.phase === 'defeat') { ctx.fillStyle = `rgba(0,0,0,${Math.min(0.6, s.phaseT)})`; ctx.fillRect(0, 0, W, H); }
  }
  return { render, get dock() { return fx.dock; } };
}
