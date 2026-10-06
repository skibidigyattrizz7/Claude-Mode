// Prototype 7-Claude: renderer. Draws everything from the sim state; VFX live on their own clock so hit-stop
// and slow-mo freeze the fight but not the sparks. Three looks: NIGHT (phase 1), EMBER (phase 2), TOTALITY (secret).
import { W, H, HZ, FLOOR, BOX, STAR_PATH, starPoint, DLASER, dlPoint, SUKKAH, sukkahGeom, MAGEN, CAGE, BARRAGE, BLADE, BLADE_EDGES, bladePt, TORNADO, HELLT, HELL, DOMINO, dominoPos, COMET, RICO, ricochetLegs, COLLAPSE, FIN_NAMES, finNext, spikeDots, clamp, lerp, easeOut, STAGES, TUNE, ABIL, ABIL_ORDER, FIN, CLASH, TALK_CPS, aligned } from './sim.js?v=pb3';

const TAU = Math.PI * 2;
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1, x = clamp(t, 0, 1) - 1; return 1 + c3 * x * x * x + c1 * x * x; };
const font = (px, wt = 700) => `${wt} ${px}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
const ATTACK_NAMES = { barrage: 'HAND BARRAGE', orbs: 'VOLLEY', slam: 'HAND SLAM', chains: 'CHAINS', rune: 'RUNE LOCK', catch: 'CATCH', earth: 'EARTH THROW', laser: 'EYE LASER', spikes: 'BLOOD SPIKES', minions: 'SUMMON',
  cross: 'CROSSFIRE', doom: 'DOOMFALL', gravity: 'GRAVITY WELL', spiral: 'SPIRAL', corona: 'CORONA SWEEP', twin: 'TWIN HOLES' };
// palettes: danger is always red-family, safe is always pale green, the hero colour is always the player's
export const P = {
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

// owner (Oct 5): uploaded pictures for the boss and the hero, per phase (set by dev.js)
export const CUSTOM = { boss: {}, hero: {} };
export function createRenderer(canvas, { reducedMotion = false, onEvent = null } = {}) { // reducedMotion can be flipped later (settings)
  let ctx = canvas.getContext('2d'); // swapped briefly while painting the cached sky
  const skyCache = {};
  let fx;
  const reset = () => {
    fx = { particles: [], numbers: [], rings: [], slashes: [], trauma: 0, flash: 0, flashColor: '#fff', invert: 0, zoom: 1, camX: 0, camY: 0, clock: 0,
      embers: Array.from({ length: 52 }, (_, i) => ({ x: (i * 211) % W, y: (i * 97) % H, s: 0.4 + (i % 5) * 0.25, ph: i })), scorch: [], cracks: [], vignette: 0,
      callout: null, blasts: [], bossGone: false, dawn: 0, last: null, dock: [], formShown: 1, clashPulse: 0, chroma: 0 };
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
        case 'bossHit': { // P10 owner: "the effects of hitting aren't dramatic enough". Three tiers, all loud.
          const BIG = ['finisher', 'nova', 'counter', 'judgement', 'totality', 'seal', 'reflect'], MID = ['burst', 'eyes', 'lance', 'wave', 'shield', 'halo', 'break', 'star', 'fall', 'shard', 'spin', 'domain', 'ember'];
          const tier = BIG.includes(e.kind) ? 3 : MID.includes(e.kind) ? 2 : 1;
          fx.bossKick = Math.min(1.4, (fx.bossKick || 0) + [0, .35, .8, 1.3][tier]);
          part(e.x, e.y, [0, 10, 24, 46][tier], tier > 1 ? '#ffffff' : pal.hero, [0, 300, 520, 760][tier], [0, .45, .6, .9][tier], [0, 2.5, 3.5, 5][tier]);
          part(e.x, e.y, [0, 4, 12, 24][tier], '#5d8cff', [0, 220, 420, 620][tier], .6, 3);
          num(e.x + (Math.random() - 0.5) * 30, e.y - 30, String(e.dmg), tier === 3 ? '#ffd27a' : tier === 2 ? '#ffffff' : '#dce8ff', tier > 1);
          shake([0, .22, .45, .8][tier]); s.hitstop = Math.max(s.hitstop, [0, .02, .07, .13][tier]);
          ring(e.x, e.y, '#ffffff', 10, [0, 70, 130, 240][tier], [0, .3, .4, .55][tier], [0, 3, 6, 10][tier]);
          blast('hit', e.x, e.y, [0, 46, 80, 130][tier]); fx.blasts[fx.blasts.length - 1].tier = tier;
          if (tier >= 2) flash('#ffffff', tier === 3 ? .4 : .14);
          if (tier === 3) { negative(.06); s.slowmo = Math.max(s.slowmo || 0, .22); fx.chroma = .35; }
          break;
        }
        case 'heroHit': if (s.phase === 'box') { shake(.22); part(e.x, e.y, 8, '#ff6d5a', 220, .4, 2.5); num(e.x, e.y - 24, '-' + e.dmg, '#ff7a66'); fx.vignette = .18; break; } // in the box: readable, not a red screen
          shake(0.42); part(e.x, e.y, 12, '#ff6d5a', 280, 0.5, 3); num(e.x, e.y - 30, '-' + e.dmg, '#ff7a66'); fx.vignette = 0.5; fx.chroma = 0.25; s.hitstop = Math.max(s.hitstop, 0.05); break;
        case 'fire': part(e.x, e.y, 4, pal.hero, 160, 0.3, 2.5, 0); break;
        case 'cast': if (e.name === 'nova' && !e.big && form(s) === 1) { ring(e.x, e.y, '#ffffff', 20, 260, .4, 8); ring(e.x, e.y, '#7fb0ff', 10, 180, .5, 5); fx.flares.push({ x: e.x, y: e.y, t: 0, life: .35, size: 120, color: '200,230,255' }); flash('#cfe6ff', .12); }
          part(e.x, e.y, e.name === 'nova' ? 26 : 10, e.name === 'nova' ? '#ffe0a0' : pal.hero, e.name === 'nova' ? 360 : 220, 0.4, 3, 0); ring(e.x, e.y, pal.hero, 6, e.name === 'nova' ? 90 : 46, 0.3, 3); if (e.name === 'nova') shake(0.25); break;
        case 'splash':
          if (e.kind === 'nova' && e.big) { const R = 250; blast('eclipse', e.x, e.y, R); impact(.4, 'void', e.x, e.y); shake(1); flash('#000000', .55); fx.chroma = .7; s.hitstop = Math.max(s.hitstop, .16); // SUPERNOVA (phase 3): a black sun bursts its corona, not NOVA's star
            ring(e.x, e.y, '#ffffff', 60, R * 5.5, 1.1, 5); ring(e.x, e.y, '#ffffff', 20, R * 2.2, .5, 14); part(e.x, e.y, 120, '#ffffff', 1400, 1, 2.5); for (let i = 0; i < 18; i++) fx.flares.push({ x: e.x + Math.cos(i / 18 * TAU) * R * 1.3, y: e.y + Math.sin(i / 18 * TAU) * R, t: -i * .02, life: .4, size: 50, color: '255,255,255' }); addScar(e.x, s.boss.y + 30); }
          else if (e.kind === 'nova') { const R = e.big ? 230 : 170; blast('nova', e.x, e.y, R); impact(.5, 'nova', e.x, e.y); shake(1); flash('#ffffff', e.big ? .7 : .5); negative(.07); fx.chroma = .5; s.hitstop = Math.max(s.hitstop, .14); // NOVA: a HUGE version of its explosion, bigger than the star that hit
            ring(e.x, e.y, '#ffffff', 40, R * 5, 1, 12); ring(e.x, e.y, GOLD, 30, R * 3.6, .9, 8); fx.flares.push({ x: e.x, y: e.y, t: 0, life: .45, size: R * 2.4, color: '255,255,255' }); part(e.x, e.y, 90, '#ffffff', 1100, 1.2, 5); part(e.x, e.y, 50, '#ffe7b8', 900, 1.1, 4); addScar(e.x, s.boss.y + 30); }
          else if (e.kind === 'fall' && e.meteor) { blast('meteor', e.x, e.y, 110); shake(.3); flash('#ffffff', .06); for (let i = 0; i < 14; i++) fx.particles.push({ x: e.x, y: e.y, vx: (Math.random() - .5) * 700, vy: -200 - Math.random() * 500, life: .7, max: .7, size: 3, color: i % 3 ? '#ffffff' : '#20242a', grav: 1400 }); addScar(e.x, e.y); } // STARFALL meteor crater
          else if (e.kind === 'fall') { blast('fall', e.x, e.y); if (form(s) === 1) { ring(e.x, e.y, '#9fd0ff', 10, 150, .35, 5, .36); fx.flares.push({ x: e.x, y: e.y - 20, t: 0, life: .22, size: 50, color: '200,230,255' }); } shake(.18); part(e.x, e.y - 10, 10, '#e8dcc0', 300, .5, 3); addScar(e.x, e.y); }
          else if (e.kind === 'burst') { blast(e.fizzle ? 'fizzle' : 'burst', e.x, e.y, e.r); shake(e.fizzle ? .15 : .45); part(e.x, e.y, 22, '#ffe7b8', 420, .6, 3.5); if (!e.fizzle && form(s) === 1) { ring(e.x, e.y, '#9fd0ff', 20, e.r * 2.4, .45, 8); ring(e.x, e.y, '#ffffff', 10, e.r * 1.5, .3, 4); part(e.x, e.y, 30, '#bfe0ff', 700, .7, 3); fx.flares.push({ x: e.x, y: e.y, t: 0, life: .3, size: e.r * 1.4, color: '190,225,255' }); flash('#cfe6ff', .12); } }
          else { ring(e.x, e.y, pal.hero, 10, e.r, 0.45, 6); part(e.x, e.y, 18, '#ffe7b8', 380, 0.6, 3.5); }
          break;
        case 'eyesHit': blast('eyes', e.x, e.y); shake(.3); part(e.x, e.y, 16, '#ffffff', 420, .5, 3); if (form(s) === 1) { ring(e.x, e.y, '#9fd0ff', 16, 200, .4, 7); fx.flares.push({ x: e.x, y: e.y, t: 0, life: .3, size: 90, color: '200,230,255' }); part(e.x, e.y, 20, '#8fc4ff', 600, .6, 3); } break;
        case 'heroBeam': shake(0.2); break;
        case 'bossDodge': num(e.x, e.y - 250, 'DODGED', '#c8d0d6'); for (let i = 0; i < 3; i++) fx.rings.push({ x: e.x, y: e.y - 90, color: pal.boss, r0: 60, r1: 140, t: i * 0.05, life: 0.35, w: 2, flat: 1.4 }); break;
        case 'dodge': ring(e.x, e.y - 40, '#d7f3ff', 8, 46, 0.25, 2); break;
        case 'perfect': num(e.x, e.y - 110, 'PERFECT', '#9ff8ff', true); num(e.x + 40, e.y - 70, '+2', '#9ff0c4'); ring(e.x, e.y - 40, '#9ff8ff', 10, 140, 0.5, 3); flash('#bff4ff', 0.16); if (s.stage === 3) negative(0.06); break;
        case 'heal': part(e.x, e.y - 50, 24, '#9ff0c4', 200, 0.9, 3, -120); ring(e.x, e.y - 40, '#9ff0c4', 20, 90, 0.5, 3); num(e.x, e.y - 120, '+' + TUNE.heal, '#9ff0c4', true); break;
        case 'healGain': num(640, 300, '+1 HEAL', '#9ff0c4', true); break;
        case 'tell': fx.callout = { text: ATTACK_NAMES[e.kind] || '', t: 0 }; break;
        case 'slam': shake(0.55); part(e.x, e.y, 26, '#c9a27a', 380, 0.8, 4); ring(e.x, e.y, pal.tele, 20, 160, 0.45, 6, 0.36); ring(e.x, e.y, '#ffffff', 10, 230, 0.3, 3, 0.36); blast('crack', e.x, e.y, 150, pal.tele); flash(pal.tele, .06); for (let i = 0; i < 16; i++) fx.particles.push({ x: e.x + (Math.random() - .5) * 60, y: e.y, vx: (Math.random() - .5) * 500, vy: -250 - Math.random() * 450, life: .8, max: .8, size: 4 + Math.random() * 4, color: '#2a2220', grav: 1500 }); addScar(e.x, e.y); break;
        case 'impact': shake(e.big ? 0.6 : 0.35); part(e.x, e.y, e.big ? 30 : 16, e.big ? '#d8b48a' : pal.tele, e.big ? 420 : 300, 0.7, 4); ring(e.x, e.y, pal.tele, 20, e.big ? 170 : 110, 0.4, 5, 0.36); addScar(e.x, e.y); break;
        case 'clap': shake(0.5); ring(e.x, e.y, '#ffe1c8', 10, 260, 0.4, 6, 0.5); part(e.x, e.y, 24, '#ffd2b0', 420, 0.5, 3); break;
        case 'laser': shake(0.3); flash(pal.tele, 0.06); ring(e.x, e.y, '#ffffff', 10, 120, .3, 5); break;
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
        case 'finisherReady': num(s.hero.x, s.hero.y - 130, e.hell ? 'STAR OF HELL!' : 'FINISHER!', e.hell ? '#ff3b3b' : '#ffe08a', true); if (e.hell) { flash('#ff2a1a', .3); shake(.4); } break;
        case 'sukkahBuilt': shake(.3); flash('#fff1c8', .18); part(e.x, e.y - 120, 24, '#ffe7a8', 300, .8, 3, -60); break;
        case 'starLaunch': part(e.x, e.y, 10, '#ffffff', 260, .4, 3); shake(.08); break;
        case 'starBomb': blast('bomb', e.x, e.y, 120); shake(.6); flash('#ffffff', .25); part(e.x, e.y - 40, 26, '#ffd9a0', 620, .9, 4, -80); addScar(e.x, e.y); break;
        case 'dlBlink': shake(.25); flash('#cfe0ff', .12); part(e.x, e.y, 18, '#ffffff', 420, .45, 3); ring(e.x, e.y, '#cfe0ff', 10, 140, .3, 4); break;
        case 'dlFire': shake(.6); flash('#ffffff', .3); fx.chroma = .3; ring(e.x, e.y, '#ffffff', 20, 300, .5, 8); break;
        case 'dlLink': shake(.7); flash('#ffffff', .35); negative(.05); part(e.x, e.y, 40, '#cfe0ff', 600, .8, 4); break;
        case 'dlSpin': shake(.3); break;
        case 'dlBoom': if (e.v === 4) { blast('nova', e.x, e.y, 320); impact(.6, 'blue', e.x, e.y); shake(1); flash('#ffffff', .9); negative(.1); fx.chroma = .6; ring(e.x, e.y, '#ffffff', 30, 1000, 1.1, 14); ring(e.x, e.y, '#7aa8ff', 20, 700, .9, 8); part(e.x, e.y, 90, '#ffffff', 1100, 1.3, 5); part(e.x, e.y, 40, GOLD, 900, 1.2, 4); addScar(s.boss.x, s.boss.y + 30); } // DAVID LASER: the original blow-up, gold sparks in it
          else { shake(.8); flash('#bff4ff', .5); fx.chroma = .4; ring(e.x, e.y, '#7fe8ff', 30, 700, .7, 8); } break; // SPINNING STAR: the points break off (they come back: ssBoom)
        case 'ssBoom': blast('nova', e.x, e.y, 300, '#7fe8ff'); impact(.6, 'spin', e.x, e.y); shake(1); flash('#ffffff', .8); fx.chroma = .7; ring(e.x, e.y, '#7fe8ff', 30, 1100, 1.1, 14); ring(e.x, e.y, '#ffffff', 20, 800, .9, 8); part(e.x, e.y, 90, '#bff4ff', 1200, 1.2, 4); part(e.x, e.y, 30, GOLD, 900, 1, 4); addScar(s.boss.x, s.boss.y + 30); break;
        case 'sukkahHammer': shake(.2 + e.n * .06); part(e.x, e.y, 10, '#ffe7a8', 260, .35, 3); ring(e.x, e.y + 4, '#ffe7a8', 6, 60, .25, 3); break;
        case 'sukkahWalls': shake(.15); break;
        case 'sukkahBranch': part(e.x, e.y, 6, '#7fbf5a', 200, .4, 3); break;
        case 'sukkahBlown': part(e.x, e.y - 200, 50, '#c9a66b', 900, 1.2, 5, 400); break;
        case 'mdRaise': flash('#cfe0ff', .2); ring(e.x, e.y, '#ffffff', 20, 220, .4, 5); part(e.x, e.y, 20, '#ffffff', 400, .5, 3); break;
        case 'mdAbsorb': shake(.15 + e.n * .03); ring(e.x, e.y, '#cfe0ff', 40, 200 + e.n * 12, .3, 4); part(e.x, e.y, 10, '#ffe7b8', 380, .4, 3); break;
        case 'mdCharge': flash('#ffffff', .3); shake(.4); break;
        case 'mdSlam': impact(.55, 'shield', e.x, e.y); shake(1); flash('#ffffff', .85); negative(.09); fx.chroma = .5; fx.bossKick = 1.4; ring(e.x, e.y, '#ffffff', 30, 900, 1, 14); part(e.x, e.y, 80, '#ffffff', 1000, 1.1, 5); part(e.x, e.y, 30, GOLD, 800, 1, 4); addScar(s.boss.x, s.boss.y + 30); break;
        case 'scLock': shake(.8); flash('#ffffff', .5); ring(e.x, e.y, '#ffffff', 280, 420, .4, 8); part(e.x, e.y, 40, '#cfe0ff', 600, .6, 4); break;
        case 'scSqueeze': shake(.4 + e.n * .15); flash('#cfe0ff', .15 + e.n * .05); impact(.1 + e.n * .04, 'ice', e.x, e.y); part(e.x, e.y, 16, '#ffffff', 300, .4, 3); break;
        case 'scShatter': blast('nova', e.x, e.y, 260, '#bff4ff'); impact(.6, 'ice', e.x, e.y); shake(1); flash('#dff8ff', .8); ring(e.x, e.y, '#bff4ff', 60, 520, .8, 6); part(e.x, e.y, 90, '#dff8ff', 1100, 1.2, 3, 500); break; // STAR CAGE: ice
        case 'spikeUp': shake(.12); break;
        case 'dmPlace': if (e.i % 2 === 0) shake(.06); break;
        case 'dmFlick': shake(.2); part(e.x, e.y, 10, '#ffffff', 300, .3, 3); break;
        case 'dmPop': ring(e.x, e.y - 20, GOLD, 6, 50 + e.i * 6, .3, 3, .5); for (let j = 0; j < 6; j++) { const a = j / 6 * TAU; fx.particles.push({ x: e.x, y: e.y - 20, vx: Math.cos(a) * (180 + e.i * 20), vy: Math.sin(a) * (180 + e.i * 20) - 120, life: .4, max: .4, size: 3, color: j % 2 ? GOLD : '#ffffff', grav: 500 }); } shake(.1 + e.i * .04); break;
        case 'cmWings': flash('#ffe08a', .2); part(e.x, e.y, 30, GOLD, 300, .8, 3, -100); break;
        case 'cmLaunch': shake(.6); flash('#ffffff', .25); ring(e.x, e.y, '#ffffff', 10, 260, .4, 5, .3); part(e.x, e.y, 40, '#d8e6ff', 500, .7, 4); break;
        case 'cmGleam': break;
        case 'cmDive': shake(.4); fx.chroma = .3; break;
        case 'cmImpact': blast('nova', e.x, e.y - 60, 340, GOLD); impact(.7, 'gold', e.x, e.y - 60); shake(1); flash('#ffffff', 1); negative(.1); fx.chroma = .7; ring(e.x, e.y, '#ffffff', 40, 1200, 1.2, 16, .35); ring(e.x, e.y, GOLD, 30, 800, 1, 10, .35); part(e.x, e.y - 20, 80, '#ffffff', 1200, 1.2, 5, 900); for (let i = 0; i < 40; i++) fx.particles.push({ x: e.x + (Math.random() - .5) * 200, y: e.y, vx: (Math.random() - .5) * 900, vy: -400 - Math.random() * 900, life: 1.6, max: 1.6, size: 5 + Math.random() * 5, color: '#3a3430', grav: 1600 }); addScar(e.x, e.y + 30); break; // STAR COMET: the crater
        case 'rcFinal': shake(1); flash('#ffe9a8', .5); part(e.x, e.y, 50, '#ffe9a8', 900, .8, 3); break;
        case 'rcBoom': blast('nova', e.x, e.y, 320, GOLD); impact(.6, 'rico', e.x, e.y); shake(1); flash('#ffffff', .9); negative(.08); fx.chroma = .6; ring(e.x, e.y, GOLD, 30, 1100, 1.1, 14); ring(e.x, e.y, '#ffffff', 20, 800, .9, 8); part(e.x, e.y, 90, '#ffe9a8', 1200, 1.2, 4); addScar(s.boss.x, s.boss.y + 30); break; // STAR RICOCHET: the path snaps in and detonates
        case 'rcHit': fx.flares.push({ x: e.x, y: e.y, t: 0, life: .3, size: 70 + e.i * 8, color: '255,233,168' }); shake(.25 + e.i * .03); break;
        case 'rcBounce': ring(e.x, e.y, '#cfe0ff', 6, 70, .25, 3); part(e.x, e.y, 8, '#ffffff', 300, .3, 2); break;
        case 'clDraw': shake(.2); break;
        case 'clCollapse': shake(.5); flash('#000000', .4); impact(.2, 'void', e.x, e.y); break;
        case 'clNova': blast('nova', e.x, e.y, 360); impact(.8, 'void', e.x, e.y); shake(1); flash('#ffffff', 1); negative(.12); fx.chroma = .8; ring(e.x, e.y, '#ffffff', 30, 1300, 1.2, 16); ring(e.x, e.y, GOLD, 20, 900, 1, 10); part(e.x, e.y, 120, '#ffffff', 1300, 1.3, 5); part(e.x, e.y, 60, GOLD, 900, 1.3, 4); addScar(s.boss.x, s.boss.y + 30); break; // STAR COLLAPSE: supernova with black & white impact frames
        case 'codeKey': fx.keyFlash = fx.keyFlash || {}; fx.keyFlash[e.k] = 1; break;
        case 'codeOk': shake(1); flash('#ffffff', .8); negative(.08); ring(s.boss.x, s.boss.y - 120, '#ffffff', 40, 900, 1, 12); part(640, 110, 80, '#ffffff', 700, 1.2, 4); break;
        case 'sbShot': if (e.i % 3 === 0) shake(.08); break;
        case 'sbImpact': ring(e.x, e.y, '#9fd8ff', 6, 46, .22, 3); for (let j = 0; j < 4; j++) fx.particles.push({ x: e.x, y: e.y, vx: 120 + Math.random() * 260, vy: (Math.random() - .5) * 260, life: .3, max: .3, size: 2.5, color: j % 2 ? GOLD : '#ffffff', grav: 0 }); break;
        case 'sbCharge': flash('#cfe0ff', .15); break;
        case 'sbFinal': blast('burst', e.x, e.y, 260); impact(.5, 'barrage', e.x, e.y); shake(1); flash('#ffffff', .8); negative(.08); ring(e.x, e.y, '#ffffff', 30, 800, .9, 12); part(e.x, e.y, 70, '#ffffff', 900, 1, 4); for (let i = 0; i < 50; i++) fx.particles.push({ x: e.x, y: e.y, vx: (Math.random() - .5) * 700, vy: -300 - Math.random() * 800, life: 1.2, max: 1.2, size: 4, color: GOLD, grav: 1300 }); break; // STAR BARRAGE: the original burst + a gold fountain
        case 'dbGrow': flash('#cfe0ff', .2); part(e.x, e.y, 20, '#ffffff', 300, .6, 3, -100); break;
        case 'dbCut': shake(.35); flash('#ffffff', .12); fx.slashes.push({ y: e.y, a: [Math.PI / 3, -Math.PI / 3, 0, -Math.PI / 3, Math.PI / 3, 0][e.n] || 0, t: 0 }); part(e.x, e.y, 16, '#ffffff', 600, .4, 3); part(e.x, e.y, 8, GOLD, 500, .4, 3); break;
        case 'dbSheathe': shake(.2); flash('#ffffff', .1); break;
        case 'dbSplit': blast('nova', e.x, e.y, 300, '#e8f0ff'); impact(.65, 'silver', e.x, e.y); shake(1); flash('#ffffff', .9); negative(.1); fx.chroma = .6; ring(e.x, e.y, '#ffffff', 30, 1100, 1.1, 14); ring(e.x, e.y, GOLD, 20, 800, .9, 8); part(e.x, e.y, 90, '#e8f0ff', 1200, 1.2, 4); addScar(s.boss.x, s.boss.y + 30); break; // DAVID'S BLADE: the star of cuts detonates
        case 'stRise': shake(.3); break;
        case 'stCollapse': shake(.6); flash('#cfe0ff', .3); break;
        case 'stBurst': blast('nova', e.x, e.y, 320, '#6fe8d0'); impact(.6, 'teal', e.x, e.y); shake(1); flash('#ffffff', .85); fx.chroma = .5; ring(e.x, e.y, '#6fe8d0', 30, 1000, 1, 12); ring(e.x, e.y, '#ffffff', 20, 700, .8, 6); part(e.x, e.y, 80, '#ffffff', 1000, 1.1, 5); part(e.x, e.y, 40, '#6fe8d0', 900, 1.1, 4, -400); addScar(s.boss.x, s.boss.y + 30); break; // STAR TORNADO: it explodes
        case 'hellStar': flash('#ff2a1a', .35); shake(.4); break;
        case 'hellFire': flash('#ff5020', .3); shake(.5); break;
        case 'hellBoom': impact(e.big ? 1.25 : .55, 'hell', e.x, e.y); shake(1); flash(e.big ? '#fff0e0' : '#ff6030', e.big ? 1 : .6); negative(e.big ? .12 : .06); fx.chroma = e.big ? .9 : .4; ring(e.x, e.y, '#ff5030', 30, e.big ? 1400 : 700, e.big ? 1.4 : 1, e.big ? 18 : 10); if (e.big) ring(e.x, e.y, '#ffd0a0', 20, 1000, 1.2, 10); part(e.x, e.y, e.big ? 160 : 60, '#ff9a50', e.big ? 1400 : 800, 1.4, 5); if (e.big) { part(e.x, e.y, 60, '#ffffff', 1200, 1, 4); addScar(s.boss.x, s.boss.y + 30); } break;
        case 'hellAlgol': shake(.6); flash('#ff3020', .3); break;
        case 'hellEye': shake(.25); break;
        case 'hellCrack': impact(.22, 'hell', e.x, s.boss.y - 120); shake(.5); flash('#ff6a3a', .15); break;
        case 'hellAlgol2': impact(.3, 'hell', e.x, e.y); shake(.8); flash('#ffd0b0', .35); part(e.x, e.y, 40, '#ff7a40', 700, .8, 4); break;
        case 'hellVert': impact(.35, 'hell', e.x, e.y); shake(.9); flash('#ffd0b0', .5); part(e.x, e.y, 50, '#ff7a40', 800, .8, 4); break;
        case 'hellSpin': shake(.2); break;
        case 'minions': shake(.5); flash('#ff5a46', .2); ring(e.x, e.y, '#ff6a5a', 20, 300, .5, 6); part(e.x, e.y, 30, '#ff9a5a', 500, .7, 4); break;
        case 'minionHit': part(e.x, e.y, 6, '#ffd7a1', 240, .3, 3); break;
        case 'minionDie': shake(e.last ? .6 : .3); blast('hit', e.x, e.y, 70); part(e.x, e.y, 24, '#ff9a5a', 500, .6, 4); if (e.last) flash('#7fe0b0', .25); break;
        case 'shielded': num(e.x, e.y, 'SHIELDED', '#ff6a5a'); break;
        case 'starBombBig': impact(.6, 'sukkah', e.x, e.y); blast('bomb', e.x, e.y + 10, 260); shake(1); flash('#ffffff', .75); negative(.08); fx.chroma = .5; part(e.x, e.y - 80, 70, '#fff1d0', 900, 1.2, 5, -120); ring(e.x, e.y, '#ffffff', 30, 900, 1, 12, .36); break;
        case 'finisherStar': shake(.9); flash('#ffffff', .5); negative(.07); ring(e.x, e.y - 100, '#ffffff', 20, 520, .7, 10); part(e.x, e.y - 100, 50, '#ffffff', 700, 1, 4); fx.finStarT = 0; break;
        case 'finisherBeam': shake(1); flash('#ffffff', .6); impact(.45, 'blue', e.x, e.y); fx.finBeamT = 0; part(e.x, e.y, 60, '#cfe0ff', 800, 1.1, 4, -200); part(e.x, e.y, 30, GOLD, 700, 1, 4, -200); break;
        case 'finisherSlash': if (e.star) { shake(.3); fx.flares.push({ x: e.x, y: e.y, t: 0, life: .5, size: 90, color: '255,236,180' }); part(e.x, e.y, 16, GOLD, 360, .6, 3, -200); blast('hit', e.x, e.y, 60); fx.blasts[fx.blasts.length - 1].tier = 2; part(e.x, e.y, 14, '#ffffff', 420, .5, 3); break; }
          shake(0.35); flash('#ffffff', 0.2); fx.slashes.push({ t: 0, a: -0.45 + e.n * 1.6, y: 260 + e.n * 160 }); if (s.stage === 3) negative(0.05); break;
        case 'finisherHit': { const ac = FIN_ACCENT[e.v] || '#ffffff', x = s.boss.x, y = s.boss.y - 110; shake(.8); sig(e.v, x, y, ac); break; }
        case 'clashLost': shake(0.7); fx.vignette = 0.8; fx.chroma = 0.4; break;
        case 'boxStart': ring(640, 470, '#e8f1ff', 300, 40, 0.4, 3); break;
        case 'timingResult': if (e.result === 'perfect') { flash('#ffffff', 0.3); shake(0.6); negative(0.06); part(s.boss.x, s.boss.y - 90, 40, '#ffe7b8', 600, 0.9, 4); } else if (e.result === 'good') shake(0.35); break;
        case 'clashStart': flash('#ffffff', 0.5); shake(0.6); break;
        case 'clashPress': fx.clashPulse = 1; if (Math.random() < 0.5) shake(0.06); break;
        case 'clashEscalate': shake(0.5); flash('#ffffff', 0.18); if (s.stage === 3) negative(0.06); break;
        case 'clashWin': shake(1); flash('#ffffff', 0.9); negative(0.1); part(s.boss.x, s.boss.y - 100, 80, '#fff1d0', 800, 1.2, 5, 60); break;
        case 'cineBeat': cineBeat(s, e); break;
        case 'miss': num(e.x, e.y - 30, 'MISS', '#c8d0d6'); break;
        case 'block': if (Math.random() < .5) part(e.x, e.y, 5, pal.hero, 200, .3, 2.5, 0); break;
        case 'lanceHit': blast('lance', e.x, e.y); shake(0.5); flash('#ffffff', 0.15); ring(e.x, e.y, pal.hero, 10, 160, .35, 6); part(e.x, e.y, 26, pal.hero, 520, .6, 3.5); fx.slashes.push({ t: 0, a: -0.2, y: e.y, world: true }); break;
        case 'domainTick': if (e.last) { impact(.6, 'sun', e.x, e.y - 60); s.hitstop = Math.max(s.hitstop, .14); negative(.08); fx.chroma = .6; ring(e.x, e.y - 60, '#ffffff', 30, 1100, 1, 12); ring(e.x, e.y, GOLD, 40, 700, .9, 14, .36); part(e.x, e.y - 60, 90, '#fff3d0', 1100, 1.1, 5); fx.flares.push({ x: e.x, y: e.y - 80, t: 0, life: .45, size: 260, color: '255,236,180' }); addScar(e.x, e.y); } else impact(.07, 'sun', e.x, e.y - 60);
          blast('domain', e.x, e.y, e.last ? 200 : 130); shake(e.last ? .8 : .35); flash(e.last ? '#fff0c8' : '#ffe08a', e.last ? .3 : .1); ring(e.x, e.y, GOLD, 20, e.last ? 420 : 240, e.last ? .7 : .4, e.last ? 10 : 5, .36); part(e.x, e.y - 40, e.last ? 50 : 18, GOLD, e.last ? 800 : 420, .7, 4, -300); if (e.last) { part(e.x, e.y - 60, 30, '#ff7a3a', 700, .8, 4, -500); addScar(e.x, e.y); } break; // DOMAIN strikes
        case 'shardLoose': ring(e.x, e.y, '#ffffff', 4, 34, .2, 3); part(e.x, e.y, 5, '#ffffff', 240, .25, 2); break;
        case 'sealBoom': shake(0.7); flash(pal.hero, 0.18); ring(e.x, e.y, pal.hero, 20, 260, .5, 8); part(e.x, e.y, 40, '#ffffff', 600, .8, 4); break;
        case 'judgement': shake(0.8); flash('#ffffff', 0.3); negative(0.05); ring(e.x, e.y, '#ffffff', 20, 300, .5, 8, .36); part(e.x, e.y - 100, 40, '#ffffff', 600, .8, 4); break;
        case 'totalityHit': impact(.8, 'total', e.x, e.y - 110); fx.chroma = .9; fx.flares.push({ x: e.x, y: e.y - 110, t: 0, life: .5, size: 320, color: '255,255,255' }); shake(1); flash('#ffffff', 0.7); negative(0.1); ring(e.x, e.y - 110, '#ffffff', 20, 900, 1, 12); part(e.x, e.y - 110, 80, pal.hero, 900, 1.2, 5, 40); break;
        case 'fqStart': flash('#ffe08a', 0.12); break;
        case 'fqWin': flash('#ffffff', 0.3); shake(0.3); break;
        case 'fqFail': shake(0.4); fx.chroma = 0.4; break;
        case 'swordThrow': shake(0.3); break;
        case 'swordHit': shake(1); flash('#ffffff', 1); negative(0.1); part(e.x, e.y, 90, '#ffffff', 900, 1.3, 5, 60); ring(e.x, e.y, '#ffffff', 20, 900, 1.1, 14); break;
        case 'talkLine': fx.talkPunch = 1; break;
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
      if (e.at === 0.15) { part(h.x, h.y - 50, 40, '#9ff8ff', 260, 1.2, 3, -260); }
      if (e.at === 0.4) { shake(0.4); }
      if (e.at === 0.3) { shake(0.5); flash('#ffffff', 0.25); }
      if (e.at === 0.5) { shake(1); flash('#ffffff', 0.85); ring(h.x, h.y - 60, '#ffe08a', 10, 520, 0.9, 10); ring(b.x, b.y - 100, '#ff6a3a', 10, 560, 0.9, 10); part(h.x, h.y - 60, 50, '#ffe08a', 600, 1, 4, 0); part(b.x, b.y - 100, 60, '#ff7a4a', 650, 1, 4, 0); }
      if (e.at === 0.7) shake(0.3);
    } else if (e.kind === 'totality') {
      if (e.at === 0.3) shake(0.3);
      if (e.at === 0.5) { shake(1); flash('#ffffff', 1); negative(0.14); ring(980, 150, '#ffffff', 60, 900, 1.2, 12); }
      if (e.at === 0.7) { shake(0.4); negative(0.06); }
    } else {
      if (e.at === 0.4) { fx.swordLanded = fx.clock; shake(0.7); } // the sword digs in
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

  // the hero's six-point sigil; prog 0..1 draws the two triangles in; flat squashes it onto the floor
  // P8 (owner: every ability has a Star of David): a solid, glowing Star of David. Two interlaced triangles, a
  // coloured edge, a white core line and a soft glow; `fill` lights the centre.
  // P10 (owner sent the Israel flag): every star is the FLAG's Star of David. White inside (the hexagon and the six
  // points), two interlaced bands in flag blue, a thin white rim so it reads on a dark sky. Calls that pass white
  // as the colour get the secondary look: a white outline only, for inner / counter-rotating stars.
  const FLAG_BLUE = '#0038b8';
  const triPath = (r, off) => { ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = off + i / 3 * TAU; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); };
  const trails = new WeakMap(); // phase 1 shots leave tapered light ribbons
  function ribbon(tr, hx, hy, w, rgb) {
    if (!w || tr.length < 2) return; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; const n = tr.length;
    for (let i = 1; i < n; i++) { const k = i / n; ctx.strokeStyle = `rgba(${rgb},${(k * .55).toFixed(2)})`; ctx.lineWidth = w * k; ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(i === n - 1 ? hx : tr[i].x, i === n - 1 ? hy : tr[i].y); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${(k * .5).toFixed(2)})`; ctx.lineWidth = w * k * .3; ctx.stroke(); }
    ctx.restore();
  }
  function davidStar(x, y, r, rot, color, alpha = 1, fill = .35, glowCol = null) {
    if (alpha <= 0 || r <= 0) return;
    ctx.save();
    if (glowCol) { ctx.globalCompositeOperation = 'lighter'; glow(x, y, r * 2.4, glowCol, alpha); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot); ctx.lineJoin = 'miter'; ctx.miterLimit = 3;
    const band = Math.max(2, r * .2);
    if (color === '#ffffff') { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, r * .08); triPath(r, -Math.PI / 2); ctx.stroke(); triPath(r, Math.PI / 2); ctx.stroke(); ctx.restore(); return; }
    // P11 owner: "the white inside is way too strong, make it hollow": no fill, just the flag-blue bands on a thin white rim
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = band + Math.max(2.5, r * .09); triPath(r, -Math.PI / 2); ctx.stroke(); triPath(r, Math.PI / 2); ctx.stroke(); // white rim
    ctx.strokeStyle = FLAG_BLUE; ctx.lineWidth = band; triPath(r, -Math.PI / 2); ctx.stroke(); triPath(r, Math.PI / 2); ctx.stroke();                     // flag-blue bands
    ctx.restore();
  }
  function tintStar(x, y, r, rot, color, alpha = 1, fill = .35, glowCol = null) { // the soul keeps its mode colour
    if (alpha <= 0 || r <= 0) return;
    ctx.save(); ctx.globalAlpha = alpha; if (glowCol) glow(x, y, r * 2.4, glowCol, alpha); ctx.translate(x, y); ctx.rotate(rot); ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha * fill; ctx.fillStyle = color; triPath(r, -Math.PI / 2); ctx.fill(); triPath(r, Math.PI / 2); ctx.fill(); ctx.globalAlpha = alpha;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, r * .2); triPath(r, -Math.PI / 2); ctx.stroke(); triPath(r, Math.PI / 2); ctx.stroke(); ctx.restore();
  }
  // star-shaped explosions, one look per move
  const blast = (kind, x, y, r = 120, tint = null) => { fx.blasts.push({ kind, x, y, r, tint, t: 0, rot: Math.random() * TAU, life: { bomb: 1.3, hit: .45, nova: 1.5, crack: 1.4, domain: .5, eclipse: 1.1, meteor: .6, burst: .85, fall: .5, eyes: .55, lance: .5, fizzle: .4, shard: .35 }[kind] || .5 }); if (fx.blasts.length > 24) fx.blasts.shift(); };
  // four-point light flares (the ricochet's hits)
  // impact frames (owner: "black and white impact frames"): the whole frame re-drawn as hard black & white, flipping
  // impact frames: the whole frame redrawn as hard black & white, flipping. style 'hell' (STAR OF HELL) cycles through
  // black & white, inverted, and blood red-black, punches the zoom in and out, and throws speed lines at the focus point
  function impact(len = .22, style = 'bw', x = null, y = null) { if (!reducedMotion) fx.impact = { t: 0, len, style, x, y, seed: Math.random() * 100 }; }
  // P13 owner: "make the other finishers impact frames cooler too": every finisher gets its own impact frames - its own
  // colour duotone, its own zoom punch and its own line pattern (STAR OF HELL keeps the red/black/white set)
  const BWF = 'grayscale(1) contrast(900%)', INVF = BWF + ' invert(1)', duo = (h, sat = 900) => `grayscale(1) contrast(700%) sepia(1) saturate(${sat}%) hue-rotate(${h}deg)`;
  const IMPACT = {
    bw:      { f: [BWF, INVF], step: .055 },
    hell:    { f: [BWF, INVF, duo(-38)], step: .075, z: .045, lines: 'radial', n: 70, ac: '20,0,0' },
    blue:    { f: [BWF, duo(175), INVF], step: .065, z: .035, lines: 'radial', n: 46, ac: '190,220,255' }, // STAR PATH, DAVID LASER
    shield:  { f: [duo(180), BWF, INVF], step: .07, z: .03, lines: 'hex', ac: '255,255,255' },               // MAGEN DAVID
    ice:     { f: [duo(150, 300), INVF, BWF], step: .06, z: .03, lines: 'crack', ac: '235,252,255' },        // STAR CAGE
    gold:    { f: [BWF, duo(6, 500), INVF], step: .065, z: .05, lines: 'rain', ac: '255,240,190' },          // STAR COMET
    barrage: { f: [duo(6, 500), BWF, INVF], step: .05, z: .025, lines: 'horiz', ac: '255,236,170' },         // STAR BARRAGE
    spin:    { f: [duo(150), INVF, BWF], step: .06, z: .035, lines: 'pinwheel', ac: '200,250,255' },         // SPINNING STAR
    silver:  { f: [BWF, INVF], step: .07, z: .02, lines: 'slash', slice: true },                             // DAVID'S BLADE
    teal:    { f: [duo(128), BWF, INVF], step: .065, z: .035, lines: 'spiral', ac: '200,255,240' },          // STAR TORNADO
    rico:    { f: [duo(6, 500), INVF, BWF], step: .055, z: .04, lines: 'zig', ac: '255,240,190' },           // STAR RICOCHET
    void:    { f: [INVF, BWF, INVF], step: .08, z: -.05, lines: 'rings' },                                    // STAR COLLAPSE: pulls IN
    sukkah:  { f: [duo(62, 500), BWF, INVF], step: .065, z: .03, lines: 'bars', ac: '240,255,200' },        // SUKKAH
    // owner: "make sure the strongest ability in each phase really stands out": NOVA, DOMAIN and TOTALITY get their own
    nova:    { f: [INVF, duo(175), BWF], step: .06, z: .05, lines: 'points', ac: '200,230,255' },          // NOVA (phase 1)
    sun:     { f: [duo(10, 600), BWF, INVF], step: .07, z: .045, lines: 'dial', ac: '255,236,180' },       // DOMAIN (phase 2)
    total:   { f: [BWF, INVF], step: .09, z: .06, lines: 'eclipse' },                                       // TOTALITY (phase 3)
  };
  const hs = (n) => { const q = Math.sin(n * 127.1 + 311.7) * 43758.5453; return q - Math.floor(q); };
  function drawImpact(dt) {
    const I = fx.impact; if (!I) return; I.t += dt; if (I.t >= I.len) { fx.impact = null; return; }
    const v = fx.view || { scale: 1, ox: 0, oy: 0 }, cw = ctx.canvas.width, ch = ctx.canvas.height, S = IMPACT[I.style] || IMPACT.bw;
    const fr = Math.floor(I.t / S.step), fi = fr % S.f.length, F = S.f[fi], k = I.t / I.len, sc = v.scale;
    const z = S.z ? 1 + (fr % 2 ? S.z : S.z * .33) * (1 - k) : 1;
    const fxp = I.x == null ? cw / 2 : (640 + (I.x - 640 - fx.camX) * fx.zoom) * v.scale + v.ox, fyp = I.y == null ? ch / 2 : (360 + (I.y - 360 - fx.camY) * fx.zoom) * v.scale + v.oy;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = F;
    if (S.slice) { // DAVID'S BLADE: the frame is cut in two along the slash and the halves slide apart
      const off = 34 * sc * (1 - k) * (fr % 2 ? 1 : -1);
      ctx.drawImage(ctx.canvas, 0, 0, cw, fyp, off, 0, cw, fyp); ctx.drawImage(ctx.canvas, 0, fyp, cw, ch - fyp, -off, fyp, cw, ch - fyp);
    } else ctx.drawImage(ctx.canvas, fxp - fxp * z, fyp - fyp * z, cw * z, ch * z);
    ctx.filter = 'none';
    // line colour flips with the frame: black on white frames, white on inverted ones, the accent on the colour frame
    const col = F === INVF ? '255,255,255' : F === BWF ? '0,0,0' : (S.ac || '0,0,0'), R0 = Math.max(cw, ch) * .9, sd = I.seed;
    ctx.strokeStyle = ctx.fillStyle = `rgba(${col},.88)`; ctx.lineCap = 'round';
    const line = (x0, y0, x1, y1, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    switch (S.lines) {
      case 'radial': for (let i = 0; i < S.n; i++) { const a = (i / S.n) * TAU + fr * .37, r1 = R0 * (.18 + ((i * 37 + fr * 13) % 23) / 60);
        line(fxp + Math.cos(a) * R0, fyp + Math.sin(a) * R0, fxp + Math.cos(a) * r1, fyp + Math.sin(a) * r1, 2 + ((i * 7) % 5) * 1.6 * sc); } break;
      case 'hex': for (let j = 0; j < 3; j++) { const r = ((I.t * 1.6 + j / 3) % 1) * R0 * .9 + 30 * sc; ctx.lineWidth = (10 - j * 2) * sc;
        for (let t2 = 0; t2 < 2; t2++) { ctx.beginPath(); for (let q = 0; q <= 3; q++) { const a = -Math.PI / 2 + t2 * Math.PI + q / 3 * TAU + I.t; ctx[q ? 'lineTo' : 'moveTo'](fxp + Math.cos(a) * r, fyp + Math.sin(a) * r); } ctx.stroke(); } } break;
      case 'crack': { const grow = Math.min(1, k * 3.2); for (let i = 0; i < 11; i++) { let a = i / 11 * TAU + sd, x = fxp, y = fyp; ctx.lineWidth = (5 - (i % 3)) * sc; ctx.beginPath(); ctx.moveTo(x, y);
          for (let q = 1; q <= 14 * grow; q++) { a += (hs(sd + i * 19 + q) - .5) * .9; const L = (30 + hs(sd + i * 7 + q * 3) * 50) * sc; x += Math.cos(a) * L; y += Math.sin(a) * L; ctx.lineTo(x, y);
            if (q % 4 === 2) { ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a + 1) * L * .7, y + Math.sin(a + 1) * L * .7); ctx.moveTo(x, y); } } ctx.stroke(); } break; }
      case 'rain': for (let i = 0; i < 56; i++) { const x = hs(sd + i) * cw, near = 1 - Math.min(1, Math.abs(x - fxp) / (cw * .5)), y1 = ((hs(sd + i * 3) + I.t * 3.4) % 1) * ch * 1.3;
        line(x, y1 - (120 + near * 380) * sc, x, y1, (2 + near * 9) * sc); } break;
      case 'horiz': for (let i = 0; i < 44; i++) { const y = hs(sd + i) * ch, d = i % 2 ? 1 : -1, L = (160 + hs(sd + i * 5) * 520) * sc, x = ((hs(sd + i * 9) + I.t * 4 * d) % 1 + 1) % 1 * cw * 1.4 - cw * .2;
        line(x, y, x - L * d, y, (2 + (i % 4) * 2) * sc); } break;
      case 'pinwheel': { ctx.globalAlpha = .42; const n = 10, rot = I.t * 9; for (let i = 0; i < n; i += 2) { const a0 = rot + i / n * TAU, a1 = rot + (i + 1) / n * TAU;
          ctx.beginPath(); ctx.moveTo(fxp, fyp); ctx.arc(fxp, fyp, R0 * 1.6, a0, a1); ctx.closePath(); ctx.fill(); } ctx.globalAlpha = 1; break; }
      case 'slash': { const L = R0 * 1.5, a = -.62; ctx.lineWidth = 3 * sc; line(fxp - Math.cos(a) * L, fyp - Math.sin(a) * L, fxp + Math.cos(a) * L, fyp + Math.sin(a) * L, 16 * sc * (1 - k) + 3);
        line(fxp - Math.cos(-a) * L, fyp - Math.sin(-a) * L, fxp + Math.cos(-a) * L, fyp + Math.sin(-a) * L, 10 * sc * (1 - k) + 2); line(0, fyp, cw, fyp, 5 * sc); break; }
      case 'spiral': for (let i = 0; i < 12; i++) { ctx.lineWidth = (3 + (i % 3) * 2) * sc; ctx.beginPath(); for (let q = 0; q <= 26; q++) { const r = q / 26 * R0, a = i / 12 * TAU + r / R0 * 3.4 - I.t * 7;
          ctx[q ? 'lineTo' : 'moveTo'](fxp + Math.cos(a) * r, fyp + Math.sin(a) * r * .8); } ctx.stroke(); } break;
      case 'zig': for (let i = 0; i < 7; i++) { let x = fxp, y = fyp; const a = i / 7 * TAU + fr * .9; ctx.lineWidth = (6 - (i % 3) * 1.5) * sc; ctx.beginPath(); ctx.moveTo(x, y);
          for (let q = 0; q < 9; q++) { const L = R0 / 7, b2 = a + (q % 2 ? .7 : -.7) * (hs(sd + fr * 11 + i * 5 + q) + .3); x += Math.cos(b2) * L; y += Math.sin(b2) * L; ctx.lineTo(x, y); } ctx.stroke(); } break;
      case 'points': { const rot = I.t * 1.4; for (let i = 0; i < 6; i++) { const a = rot - Math.PI / 2 + i / 6 * TAU, w2 = R0 * .07 * (1 - k * .5); ctx.beginPath(); ctx.moveTo(fxp + Math.cos(a) * R0 * 1.4, fyp + Math.sin(a) * R0 * 1.4); ctx.lineTo(fxp + Math.cos(a + Math.PI / 2) * w2, fyp + Math.sin(a + Math.PI / 2) * w2); ctx.lineTo(fxp + Math.cos(a - Math.PI / 2) * w2, fyp + Math.sin(a - Math.PI / 2) * w2); ctx.closePath(); ctx.fill(); }
        const rr = (k * 1.3) * R0; ctx.lineWidth = 8 * sc; ctx.beginPath(); ctx.arc(fxp, fyp, Math.max(1, rr), 0, TAU); ctx.stroke(); break; } // NOVA: six star points spear out of her
      case 'dial': { const rr = R0 * (.3 + k * .5); ctx.lineWidth = 7 * sc; ctx.beginPath(); ctx.ellipse(fxp, fyp, rr, rr * .45, 0, 0, TAU); ctx.stroke(); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; line(fxp + Math.cos(a) * rr * .8, fyp + Math.sin(a) * rr * .36, fxp + Math.cos(a) * R0 * 1.3, fyp + Math.sin(a) * R0 * .58, (i % 3 ? 3 : 9) * sc); }
        line(fxp, 0, fxp, ch, 30 * sc * (1 - k) + 4); break; } // DOMAIN: the sun-dial's spokes and its pillar
      case 'eclipse': { const rr = R0 * (.07 + k * .1); ctx.fillStyle = col === '255,255,255' ? '#000' : '#fff'; ctx.beginPath(); ctx.arc(fxp, fyp, rr, 0, TAU); ctx.fill(); ctx.lineWidth = 10 * sc; ctx.beginPath(); ctx.arc(fxp, fyp, rr + 12 * sc, 0, TAU); ctx.stroke();
        for (let i = 0; i < 40; i++) { const a = i / 40 * TAU + fr * .2, L = rr * (1.3 + hs(sd + i + fr) * 2.2); line(fxp + Math.cos(a) * (rr + 16 * sc), fyp + Math.sin(a) * (rr + 16 * sc), fxp + Math.cos(a) * L, fyp + Math.sin(a) * L, (i % 4 ? 2 : 6) * sc); } break; } // TOTALITY: a black sun with a tearing corona
      case 'rings': for (let j = 0; j < 6; j++) { const r = (1 - ((I.t * 1.8 + j / 6) % 1)) * R0; ctx.lineWidth = (3 + j * 1.5) * sc; ctx.beginPath(); ctx.arc(fxp, fyp, Math.max(1, r), 0, TAU); ctx.stroke(); } break;
      case 'bars': { const n = 9, drop = Math.min(1, k * 5); for (let i = 0; i <= n; i++) { const x = i / n * cw; line(x, 0, x, ch * drop, (8 + (i % 2) * 6) * sc); }
        line(0, ch * .12, cw * drop, ch * .12, 12 * sc); break; }
    }
    ctx.restore();
  }
  function drawFlares(dt) {
    fx.flares = fx.flares || []; ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const f of fx.flares) { f.t += dt; if (f.t < 0) continue; const k = clamp(f.t / f.life, 0, 1), a = 1 - k, L = f.size * (.6 + k * .6);
      ctx.strokeStyle = `rgba(${f.color},${a.toFixed(2)})`; ctx.lineWidth = 4 * a + 1; ctx.beginPath(); ctx.moveTo(f.x - L, f.y); ctx.lineTo(f.x + L, f.y); ctx.moveTo(f.x, f.y - L * .7); ctx.lineTo(f.x, f.y + L * .7); ctx.stroke(); glow(f.x, f.y, 30 * a + 6, `rgba(${f.color},${a.toFixed(2)})`); }
    fx.flares = fx.flares.filter((f) => f.t < f.life); ctx.restore();
  }
  // each finisher's final-hit signature: its own colour AND its own particle behaviour, never a shared explosion
  function sig(v, x, y, ac) {
    const P2 = (o) => fx.particles.push({ life: 1, max: 1, size: 3, color: ac, grav: 0, ...o }), R = Math.random;
    switch (v) {
      case 0: for (let i = 0; i < 50; i++) P2({ x: x + (R() - .5) * 160, y: y + R() * 120, vx: (R() - .5) * 40, vy: -80 - R() * 160, life: 1.6, max: 1.6, color: i % 3 ? '#ffffff' : '#9fc0ff' }); break;       // STAR PATH: motes of light rising
      case 1: for (let i = 0; i < 40; i++) P2({ x, y: y + (R() - .5) * 140, vx: (i % 2 ? 1 : -1) * (500 + R() * 600), vy: (R() - .5) * 40, life: .6, max: .6, size: 4 }); break;      // MAGEN DAVID: gold streaks sideways
      case 2: for (let i = 0; i < 36; i++) { const a = i / 36 * TAU; P2({ x, y, vx: Math.cos(a) * 700, vy: Math.sin(a) * 700, life: .35, max: .35, size: 4, color: i % 2 ? '#bff4ff' : '#ffffff' }); } break; // STAR CAGE: ice splinters
      case 3: for (let i = 0; i < 40; i++) P2({ x: x + (R() - .5) * 300, y: y - 200 - R() * 100, vx: (R() - .5) * 120, vy: 40 + R() * 80, life: 2.2, max: 2.2, size: 5, color: ['#3f7a34', '#5ea24a', '#ffcf3a', '#e8483a'][i % 4], grav: 60 }); break; // SUKKAH: leaves and fruit tumbling down
      case 4: for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; P2({ x, y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, life: .7, max: .7, size: 5 }); } break;    // DAVID LASER: an even gold sunburst
      case 5: for (let i = 0; i < 48; i++) { const a = i * .5, sp = 200 + i * 12; P2({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .8, max: .8, size: 3 }); } break;  // SPINNING STAR: a cyan spiral
      case 6: for (let i = 0; i < 60; i++) P2({ x: x + (R() - .5) * 60, y, vx: (R() - .5) * 500, vy: -500 - R() * 600, life: 1.2, max: 1.2, size: 4, color: i % 3 ? GOLD : '#ffffff', grav: 1300 }); break; // STAR BARRAGE: a gold fountain
      case 7: for (let i = 0; i < 40; i++) { const d = i % 2 ? 1 : -1, sp = 300 + R() * 500; P2({ x, y, vx: sp * .7 * d, vy: sp * .7 * (i % 4 < 2 ? 1 : -1), life: .5, max: .5, size: 3, color: '#e8f0ff' }); } break; // DAVID'S BLADE: silver along the X of the cuts
      case 8: for (let i = 0; i < 50; i++) { const a = i * .7, r = 40 + i * 3; P2({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * .3, vx: -Math.sin(a) * 260, vy: -160 - i * 6, life: 1, max: 1, size: 3 }); } break; // STAR TORNADO: teal wind winding upward
      case 9: for (let i = 0; i < 70; i++) P2({ x: x + (R() - .5) * 260, y: y + R() * 160, vx: (R() - .5) * 60, vy: -60 - R() * 220, life: 1.8, max: 1.8, size: 3 + R() * 3, color: ['#ff3a20', '#ff9a40', '#ffd060'][i % 3], grav: -40 }); break; // STAR OF HELL: embers
      case 10: for (let i = 0; i < 70; i++) P2({ x: x + (R() - .5) * 400, y: y - 260 - R() * 120, vx: (R() - .5) * 140, vy: 30 + R() * 90, life: 2, max: 2, size: 4, color: [GOLD, '#ffffff', '#7fb0ff'][i % 3], grav: 90 }); break; // STAR DOMINOES: confetti
      case 11: for (let k2 = 0; k2 < 6; k2++) fx.flares.push({ x: x + (R() - .5) * 300, y: y + (R() - .5) * 200, t: -k2 * .06, life: .35, size: 60, color: '255,233,168' }); break; // STAR RICOCHET: echo flares
      case 12: for (let i = 0; i < 60; i++) { const a = R() * TAU, r = 300 + R() * 200; P2({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * .7, vx: -Math.cos(a) * r * 2.2, vy: -Math.sin(a) * r * 1.5, life: .45, max: .45, size: 3, color: i % 2 ? '#ffffff' : GOLD }); } break; // STAR COLLAPSE: an implosion
      default: for (let i = 0; i < 40; i++) P2({ x, y, vx: (R() - .5) * 600, vy: (R() - .5) * 600, life: .7, max: .7 });
    }
  }
  function drawBlasts(dt) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const bl of fx.blasts) {
      bl.t += dt; const k = clamp(bl.t / bl.life, 0, 1), o = easeOut(k), col = bl.tint || P[fx.form || 1].hero, x = bl.x, y = bl.y;
      if (bl.kind === 'bomb') { // a giant star bomb: white-out core, a fireball that climbs into a column, a ground shock ring, the star burned in
        const R = bl.r, rise = easeOut(clamp(k / .8, 0, 1));
        if (k < .18) glow(x, y - 20, R * 2.4 * (1 - k * 3), 'rgba(255,255,255,1)');
        glow(x, y - 30 - rise * R * .8, R * (.6 + o * .9), 'rgba(255,170,80,.75)', 1 - k);
        glow(x, y - 30 - rise * R * .8, R * (.35 + o * .5), 'rgba(255,245,220,.9)', 1 - k);
        for (let i = 0; i < 5; i++) glow(x + Math.sin(i * 2.1) * R * .08, y - i * R * .22 * rise, R * (.28 + i * .02), 'rgba(255,190,120,.5)', (1 - k) * .8); // the column
        glow(x, y - R * 1.05 * rise - 30, R * .55 * (.5 + o), 'rgba(255,220,170,.7)', (1 - k) * rise);                                      // the cap
        ctx.save(); ctx.translate(x, y); ctx.scale(1, .32); ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 6 * (1 - k) + 1; ctx.beginPath(); ctx.arc(0, 0, R * .3 + o * R * 2.2, 0, TAU); ctx.stroke(); ctx.restore();
        ctx.globalCompositeOperation = 'source-over'; davidStar(x, y - 20, R * (.2 + o * .7), bl.rot + o, col, (1 - k) * .9, 0); ctx.globalCompositeOperation = 'lighter';
        continue;
      }
      if (bl.kind === 'hit') { // the impact: a white pop, a flag star punching outward and speed lines
        const R = bl.r, T = bl.tier || 1;
        if (k < .25) glow(x, y, R * 1.4 * (1 - k * 2), 'rgba(255,255,255,1)');
        davidStar(x, y, R * (.25 + o * .75), bl.rot + o * .6, col, (1 - k) * (T > 1 ? 1 : .8), .5);
        ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2 + T;
        for (let i = 0; i < 6 + T * 3; i++) { const a = bl.rot + i / (6 + T * 3) * TAU, r0 = R * (.35 + o * .9), r1 = r0 + R * (.5 + T * .2) * (1 - k); ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.stroke(); }
        ctx.globalAlpha = 1; continue;
      }
      if (bl.kind === 'burst' || bl.kind === 'fizzle') { // the star itself blows outward, its six points throw rays
        const R = bl.r * (bl.kind === 'fizzle' ? .7 : 1);
        if (k < .2) glow(x, y, R * 1.6 * (1 - k * 2), 'rgba(255,255,255,.95)');
        davidStar(x, y, 20 + o * R, bl.rot + o * .8, col, 1 - k, .5 * (1 - k));
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3 * (1 - k) + .5; ctx.globalAlpha = 1 - k;
        for (let i = 0; i < 6; i++) { const a = bl.rot + o * .8 - Math.PI / 2 + i / 6 * TAU; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (20 + o * R), y + Math.sin(a) * (20 + o * R)); ctx.lineTo(x + Math.cos(a) * (40 + o * R * 1.9), y + Math.sin(a) * (40 + o * R * 1.9)); ctx.stroke(); }
        ctx.globalAlpha = 1;
      } else if (bl.kind === 'fall') { // small star blast on the ground + a flat star scorched into it
        hexagram(x, y, 24 + o * 110, bl.rot, 1, col, 4, .36, 1 - k);
        davidStar(x, y - 30, 14 + o * 60, bl.rot + o, '#ffffff', 1 - k, .45);
        if (k < .25) glow(x, y - 20, 70, 'rgba(255,250,230,.9)', 1 - k * 4);
      } else if (bl.kind === 'eyes') { // the star on the beam bursts into a flare where it lands
        davidStar(x, y, 14 + o * 70, bl.rot + o * 2, col, 1 - k, .5, 'rgba(255,255,255,.6)');
        ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 1 - k; ctx.fillRect(x - 120 * (1 - k), y - 1.5, 240 * (1 - k), 3); ctx.fillRect(x - 1.5, y - 80 * (1 - k), 3, 160 * (1 - k)); ctx.globalAlpha = 1;
      } else if (bl.kind === 'crack') { // her slam splits the ground: jagged cracks on the floor plane
        ctx.save(); ctx.translate(x, y); ctx.scale(1, .36); ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = `rgba(12,8,8,${(1 - k).toFixed(2)})`; ctx.lineWidth = 4;
        for (let i = 0; i < 9; i++) { let a2 = bl.rot + i / 9 * TAU, cx = 0, cy = 0; ctx.beginPath(); ctx.moveTo(0, 0); for (let q = 0; q < 5; q++) { a2 += Math.sin(bl.rot * 7 + i * 3 + q) * .5; const L = bl.r * (.18 + .1 * Math.cos(i + q)) * Math.min(1, o * 3); cx += Math.cos(a2) * L; cy += Math.sin(a2) * L; ctx.lineTo(cx, cy); } ctx.stroke(); }
        ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = col; ctx.globalAlpha = (1 - k) * .7; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
      } else if (bl.kind === 'domain') { // a gold sun-flare bursting up off the dial
        ctx.strokeStyle = GOLD; ctx.globalAlpha = 1 - k; ctx.lineWidth = 3;
        for (let i = 0; i < 12; i++) { const a2 = -Math.PI / 2 + (i - 5.5) * .16, L = bl.r * (.4 + o * 1.4) * (i % 2 ? .7 : 1); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a2) * L * .5, y + Math.sin(a2) * L); ctx.stroke(); }
        ctx.globalAlpha = 1; if (k < .3) glow(x, y - 40, bl.r * .8, 'rgba(255,224,138,.9)', 1 - k / .3);
      } else if (bl.kind === 'eclipse') { // SUPERNOVA: the black sun's corona tears outward in white spikes, the dark core shrinks away
        const R = bl.r; if (k < .1) glow(x, y, R * 3.2, 'rgba(255,255,255,1)', 1 - k / .1);
        ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 1 - k;
        for (let i = 0; i < 30; i++) { const a2 = bl.rot + i / 30 * TAU, r0 = R * (.8 + o * 1.4), r1 = r0 + R * (.6 + (i % 3) * .5) * (1 - k); ctx.lineWidth = i % 3 ? 2 : 5; ctx.beginPath(); ctx.moveTo(x + Math.cos(a2) * r0, y + Math.sin(a2) * r0); ctx.lineTo(x + Math.cos(a2) * r1, y + Math.sin(a2) * r1); ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = `rgba(3,4,10,${(1 - k).toFixed(2)})`; ctx.beginPath(); ctx.arc(x, y, R * .9 * (1 - o), 0, TAU); ctx.fill(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6 * (1 - k) + 1; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(x, y, R * (.9 + o * 2.6), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      } else if (bl.kind === 'meteor') { // STARFALL crater: a dark scorch with a white rim and thrown rays
        ctx.save(); ctx.translate(x, y); ctx.scale(1, .36); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = `rgba(5,6,10,${(.8 * (1 - k)).toFixed(2)})`; ctx.beginPath(); ctx.arc(0, 0, bl.r * (.4 + o * .5), 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, bl.r * (.45 + o * .7), 0, TAU); ctx.stroke(); ctx.restore();
        if (k < .25) glow(x, y - 20, 80, 'rgba(255,255,255,.9)', 1 - k * 4);
      } else if (bl.kind === 'lance' || bl.kind === 'shard') {
        davidStar(x, y, 10 + o * (bl.kind === 'lance' ? 110 : 40), bl.rot, col, 1 - k, .3);
      } else if (bl.kind === 'nova') { // the finale of the moveset: a star imprint, a double star that opens,
        // six small stars flung from its points that pop into stars of their own, and a star burned into the ground
        const R = bl.r;
        if (k < .12) glow(x, y, R * 3, 'rgba(255,255,255,1)', 1 - k / .12);
        davidStar(x, y, R * (.6 + o * 1.9), bl.rot + o * 1.2, col, (1 - k) * .9, .25 * (1 - k), k < .4 ? 'rgba(255,255,255,.5)' : null);
        davidStar(x, y, R * (.4 + o * 1.1), bl.rot - o * 2.4, '#ffffff', 1 - k, .15);
        hexagram(x, y + 60, R * (.5 + o * 2.6), bl.rot, 1, col, 6 * (1 - k) + 1, .36, 1 - k);
        if (k > .45) { const kk = (k - .45) / .55, ok = easeOut(kk); hexagram(x, y, R * (1 + ok * 9), bl.rot + ok, 1, '#ffffff', 5 * (1 - kk) + 1, 1, 1 - kk); hexagram(x, y, R * (.8 + ok * 6.5), -bl.rot - ok, 1, 'rgba(255,224,138,1)', 4 * (1 - kk) + 1, 1, (1 - kk) * .9); } // NOVA: a second, screen-wide star shockwave
        for (let i = 0; i < 6; i++) {
          const a = bl.rot + o * 1.2 - Math.PI / 2 + i / 6 * TAU, d = R * (.6 + Math.min(1, k / .55) * 2.4), sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d;
          if (k < .55) davidStar(sx, sy, 12, -bl.t * 9, col, 1, .6, 'rgba(255,255,255,.4)');
          else { const kk = (k - .55) / .45; ctx.strokeStyle = `rgba(255,255,255,${(1 - kk).toFixed(2)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x + Math.cos(a) * (d + kk * 700), y + Math.sin(a) * (d + kk * 700)); ctx.stroke(); } // the points fire off as rays
        }
      }
    }
    fx.blasts = fx.blasts.filter((bl) => bl.t < bl.life);
    ctx.restore();
  }
  function hexagram(x, y, r, rot, prog, color, width = 3, flat = 1, alpha = 1) {
    if (prog <= 0 || alpha <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(1, flat); ctx.rotate(rot); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const per = 3 * r * Math.sqrt(3);
    for (const off of [-Math.PI / 2, Math.PI / 2]) {
      ctx.beginPath(); for (let i = 0; i <= 3; i++) { const a = off + i / 3 * TAU; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.setLineDash([per * clamp(prog, 0, 1), per]); ctx.lineWidth = width * 3; ctx.globalAlpha = alpha * .25; ctx.stroke(); ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.stroke();
    }
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(0, 0, r * 1.08, 0, TAU * clamp(prog, 0, 1)); ctx.lineWidth = width * .6; ctx.stroke();
    ctx.restore();
  }
  function drawSword(x, y, rot, sc = 1, alpha = 1) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.globalAlpha = alpha;
    ctx.fillStyle = '#e8f2f8'; ctx.beginPath(); ctx.moveTo(-5, -10); ctx.lineTo(5, -10); ctx.lineTo(3, 120); ctx.lineTo(0, 138); ctx.lineTo(-3, 120); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(160,190,210,.8)'; ctx.fillRect(-1, -8, 2, 124);
    ctx.fillStyle = '#c79a4a'; ctx.fillRect(-24, -16, 48, 7); ctx.fillStyle = '#5a3a22'; ctx.fillRect(-4, -46, 8, 30); ctx.fillStyle = '#c79a4a'; ctx.beginPath(); ctx.arc(0, -50, 6, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawShield(x, y, r, rot, alpha = 1) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = alpha;
    ctx.fillStyle = '#8a2a2a'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d8dde2'; ctx.beginPath(); ctx.arc(0, 0, r * .78, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a2a2a'; ctx.beginPath(); ctx.arc(0, 0, r * .58, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a4a8a'; ctx.beginPath(); ctx.arc(0, 0, r * .4, 0, TAU); ctx.fill();
    ctx.restore(); hexagram(x, y, r * .62, rot, 1, '#f2f6fa', Math.max(1.5, r * .07), 1, alpha);
  }

  // ------------------------------------------------------------------ arenas
  function drawArena(s) {
    const f = form(s), pal = P[f];
    // phase 3: the boss IS the black sun, so the sky's corona moves to the far side
    const ex = (f === 3 ? 330 : 980) - fx.camX * 0.1, ey = f === 3 ? 110 : 112;
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
    for (let i = 0; i < 18; i++) { const x = (i * 83 - fx.camX * 0.2) % (W + 200) - 100, h = 50 + (i * 37 % 80); ctx.fillRect(x, HZ - h, 54, h); }
    // a few windows still lit in the far ruins (P7 arena depth)
    ctx.fillStyle = f === 2 ? 'rgba(255,106,58,.22)' : f === 3 ? 'rgba(255,255,255,.12)' : 'rgba(255,208,138,.16)';
    for (let i = 1; i < 18; i += 3) { const x = (i * 83 - fx.camX * 0.2) % (W + 200) - 100, h = 50 + (i * 37 % 80); for (let r = 0; r < Math.floor((h - 20) / 22); r++) for (let c = 0; c < 2; c++) if (((i * 7 + r * 13 + c * 5) % 5) < 2) ctx.fillRect(x + 12 + c * 22, HZ - h + 12 + r * 22, 8, 10); }
    ctx.fillStyle = pal.ruin[0];
    ctx.fillStyle = pal.ruin[1];
    for (let i = 0; i < 9; i++) { const x = (i * 157 - fx.camX * 0.5) % (W + 260) - 130; ctx.fillRect(x, HZ - 104 + (i % 3) * 14, 26, 104); ctx.fillRect(x - 14, HZ - 112 + (i % 3) * 14, 54, 14); }
    if (f === 3) { ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; for (let i = 0; i < 9; i++) { const x = (i * 157 - fx.camX * 0.5) % (W + 260) - 130; ctx.strokeRect(x, HZ - 104 + (i % 3) * 14, 26, 104); } }
    // floor
    const floor = ctx.createLinearGradient(0, HZ, 0, H);
    floor.addColorStop(0, pal.floor); floor.addColorStop(1, '#020203');
    ctx.fillStyle = floor; ctx.fillRect(-500, HZ, W + 1000, H + 300);
    if (f === 3) drawMirrorFloor(s, ex);
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(640 + i * 40, HZ); ctx.lineTo(640 + i * 220, H + 60); ctx.stroke(); }
    const scroll = f === 2 ? (fx.clock * 0.08) % 1 : 0;
    for (let i = 0; i < 7; i++) { const y = HZ + Math.pow((i + scroll) / 6, 1.7) * (H + 70 - HZ); ctx.beginPath(); ctx.moveTo(-500, y); ctx.lineTo(W + 500, y); ctx.stroke(); }
    ctx.strokeStyle = pal.horizon; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-500, HZ); ctx.lineTo(W + 500, HZ); ctx.stroke();
    if (f === 2) { // lava seams pulsing in the floor
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,90,40,${0.25 + 0.15 * Math.sin(fx.clock * 2)})`; ctx.lineWidth = 3;
      for (const pts of [[[120, 420], [220, 470], [210, 560], [300, 640]], [[1100, 400], [1010, 480], [1060, 560]], [[600, 690], [700, 620], [820, 650], [900, 600]]]) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
      ctx.restore();
    }
    // P7 arena depth: a light band on the horizon, the eclipse reflected in the floor, low drifting fog
    if (s.phase !== 'clash') { // the clash domains cover the floor anyway: skip it there (fps)
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const hz = pal.sunGlow;
    ctx.globalAlpha = .55; ctx.drawImage(glowSprite(hz), -300 - fx.camX * .1, HZ - 32, W + 600, 70);
    if (f !== 3) { ctx.globalAlpha = .4; ctx.drawImage(glowSprite(hz), ex - 60, HZ + 4, 120, 340); }
    ctx.globalAlpha = .22;
    for (let i = 0; i < 3; i++) { const fxp = ((i * 520 + fx.clock * (10 + i * 6)) % (W + 1200)) - 600; ctx.drawImage(glowSprite(pal.horizon), fxp, HZ + 40 + i * 110, 900, 70 + i * 20); }
    ctx.restore(); }
    if (s.boss && !['clash', 'cine', 'victory'].includes(s.phase)) glow(s.boss.x, s.boss.y + 40, 230, pal.sunGlow, .9); // a pool of her light on the ground
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
    const g = ctx.createLinearGradient(0, HZ, 0, 560); g.addColorStop(0, 'rgba(255,250,236,.12)'); g.addColorStop(1, 'rgba(255,250,236,0)');
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
    ctx.save(); ctx.translate(x, y + bob); ctx.scale(face * (1 / sq), sq); ctx.globalAlpha = alpha; // owner: the hero is small, the boss is a world ruler
    const ci = CUSTOM.hero[f]; if (ci && ci.naturalWidth) { if (!ghost) { ctx.save(); ctx.scale(face, 1); shadow(0, 2, 28); ctx.restore(); } const ih = 130, iw = ih * ci.naturalWidth / ci.naturalHeight; ctx.drawImage(ci, -iw / 2, -ih + 6, iw, ih); if (h.hurt > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha * .5; ctx.drawImage(ci, -iw / 2, -ih + 6, iw, ih); } ctx.restore(); return; } // DEV: an uploaded hero picture
    if (!ghost) { ctx.save(); ctx.scale(face, 1); shadow(0, 2, 28); ctx.restore(); }
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
    if (!ghost) { // cape: trails behind the body, lags with speed and ripples (secondary motion)
      const lag = clamp(Math.hypot(h.vx || 0, h.vy || 0) / 320, 0, 1) * 18, wv = reducedMotion ? 0 : Math.sin(fx.clock * 7) * (3 + lag * .3);
      ctx.fillStyle = f === 2 ? '#7a2a14' : f === 3 ? '#0e3a44' : '#16303c';
      ctx.beginPath(); ctx.moveTo(-8, -76); ctx.quadraticCurveTo(-30 - lag, -44 + wv, -38 - lag * 1.5 + wv, 2); ctx.lineTo(-24 - lag + wv * .6, 8); ctx.quadraticCurveTo(-12 - lag * .4, -30, 8, -74); ctx.closePath(); ctx.fill();
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
    if (!ghost && alpha >= 1) drawHeroPowers(s, x, y);
    if (h.inv > 0 || h.dodgeT > 0) { ctx.save(); ctx.globalAlpha = 0.5 + 0.3 * Math.sin(fx.clock * 30); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y - 48, 30, 52, 0, 0, TAU); ctx.stroke(); ctx.restore(); }
  }
  function drawHeroPowers(s, x, y) {
    const h = s.hero, pal = P[form(s)];
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (h.orbit) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < h.orbit.n; i++) { const a = s.t * 2.4 + i / 6 * TAU, ex = x + Math.cos(a) * 52, ey = y - 50 + Math.sin(a) * 20, al = Math.sin(a) > 0 ? 1 : .5; // ORBIT: six gold embers circle him, each with a flame tail (phase 1 has no orbit)
      for (let q = 1; q <= 4; q++) { const aq = a - q * .16; glow(x + Math.cos(aq) * 52, y - 50 + Math.sin(aq) * 20, 12 - q * 2, 'rgba(255,120,50,.6)', al * (1 - q / 5)); }
      glow(ex, ey, 16, 'rgba(255,224,138,.9)', al); ctx.fillStyle = '#fff6dc'; ctx.globalAlpha = al; ctx.beginPath(); ctx.arc(ex, ey, 4, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; } ctx.restore(); }
    ctx.globalAlpha = 1;
    if (h.field) { const a = Math.min(1, h.field.t * 2) * (0.6 + 0.2 * Math.sin(fx.clock * 6)); hexagram(x, y - 20, h.field.r * .9, fx.clock * .5, 1, pal.hero, 2, .5, a * .7); ctx.globalAlpha = a * .25; ctx.fillStyle = pal.hero; ctx.beginPath(); ctx.ellipse(x, y - 20, h.field.r, h.field.r * .5, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    if (h.charge) { const k = h.charge.t / h.charge.len; glow(x + h.face * 30, y - 55, 30 + k * 90, 'rgba(255,255,255,.9)', .6 + k * .4); hexagram(x + h.face * 30, y - 55, 30 + k * 40, -fx.clock * 4, k, '#ffffff', 2);
      if (Math.random() < .9) { const a = Math.random() * TAU; fx.particles.push({ x: x + Math.cos(a) * 160, y: y - 55 + Math.sin(a) * 160, tx: x + h.face * 30, ty: y - 55, life: .4, max: .4, size: 3, color: '#ffffff', spiral: true, a, d: 160 }); } }
    if (h.lance) { const g = ctx.createLinearGradient(x - 120 * h.face, 0, x, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, pal.hero); ctx.fillStyle = g; ctx.globalAlpha = .7; ctx.fillRect(Math.min(x, x - 140 * h.face), y - 62, 140, 16); ctx.globalAlpha = 1; }
    ctx.restore();
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
    shadow(x, y + 34, 140, 0.6);
    const kick = fx.bossKick || 0, slump = b.stagger > 0 && s.phase === 'fight' ? 1 : 0;
    ctx.save(); ctx.translate(x + kick * 16 * (s.hero.x < x ? 1 : -1), y - tell * 12 + slump * 10); ctx.rotate(-tell * .05 + kick * .04 * (s.hero.x < x ? 1 : -1) + slump * .06); ctx.scale(sx * 1.12, sy * 1.12); // owner (Oct 5): smaller boss (was 1.32). wind-up lean, hit recoil, stagger slump
    { const ci = CUSTOM.boss[s.stage]; if (ci && ci.naturalWidth) { const ih = 250, iw = Math.min(330, ih * ci.naturalWidth / ci.naturalHeight); glow(0, -90, 230, pal.bossGlow); ctx.drawImage(ci, -iw / 2, -ih + 30, iw, ih); if (b.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(ci, -iw / 2, -ih + 30, iw, ih); } ctx.restore(); drawHands(s); return; } } // DEV: an uploaded boss picture for this phase
    if (f === 3) { drawTotalityBoss(s, b, tell); ctx.restore(); drawHands(s); return; }
    glow(0, -90, 230, pal.bossGlow.replace(/[\d.]+\)$/, f === 2 ? '.4)' : '.2)'));
    ctx.fillStyle = b.flash > 0 ? '#ffffff' : '#07090b'; robePath(f === 2 ? 18 : 12); ctx.fill();
    ctx.save(); ctx.clip(); ctx.strokeStyle = f === 2 ? 'rgba(255,90,50,.85)' : 'rgba(255,180,100,.45)'; ctx.lineWidth = f === 2 ? 3 : 2; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(fx.clock * 3);
    for (const [x0, y0, x1, y1, x2, y2] of [[-40, -150, -55, -90, -38, -30], [30, -160, 52, -100, 40, -20], [-10, -60, 8, -20, -6, 15], [60, -60, 78, -10, 70, 20], ...(f === 2 ? [[-70, -100, -40, -60, -60, 0], [10, -190, -5, -150, 15, -120]] : [])]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    // P7: her robe holds a slow night sky (twinkling stars drift inside the cloth)
    ctx.globalAlpha = 1; ctx.fillStyle = f === 2 ? '#ffb08a' : '#ffe6b8';
    for (let i = 0; i < 16; i++) { const sx2 = ((i * 53.7) % 180) - 90 + Math.sin(fx.clock * .3 + i) * 6, sy2 = -200 + ((i * 97.3 + fx.clock * 6) % 230), tw = .25 + .75 * Math.abs(Math.sin(fx.clock * 1.7 + i * 2.1)); ctx.globalAlpha = tw * .8; ctx.fillRect(sx2, sy2, i % 4 ? 1.5 : 2.5, i % 4 ? 1.5 : 2.5); }
    ctx.globalAlpha = 1;
    ctx.restore();
    robePath(f === 2 ? 18 : 12); ctx.strokeStyle = f === 2 ? 'rgba(255,90,50,.9)' : 'rgba(255,190,110,.7)'; ctx.lineWidth = 2 + tell * 3; ctx.stroke();
    if (f === 1) {
      ctx.fillStyle = b.flash > 0 ? '#fff' : pal.boss;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 22 - 9, -190); ctx.lineTo(i * 22, -228 - (2 - Math.abs(i)) * 12); ctx.lineTo(i * 22 + 9, -190); ctx.fill(); }
      const gl = ((fx.clock * .45) % 2.2) - .6; if (gl > 0 && gl < 1 && b.flash <= 0) { const gx = -55 + gl * 110; ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(gx, -212, 26, 'rgba(255,255,255,.7)'); ctx.restore(); } // a glint runs across the crown
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
    if (b.stagger > 0 && s.phase === 'fight') text('STAGGERED', x, y - 340, 20, '#ffe2a6');
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
  const FRONT = new Set(['seal', 'judgement', 'totalitySigil', 'halo']); // the hero's big effects draw over the characters
  function drawHazards(s, front = false) {
    const f = form(s), pal = P[f], tf = pal.teleFill;
    for (const z of s.hazards) {
      if (FRONT.has(z.kind) !== front) continue;
      switch (z.kind) {
        case 'spikes': { // red dots, then spikes a second later where each row's dots are
          for (const r of z.rows) {
            if (r.t < 0 || r.t > 1.35) continue;
            const pts = r.pts || (r.pts = spikeDots(r));
            if (r.t < 1) { const k = r.t, rad = 3 + k * 3 + (k > .7 ? Math.sin(fx.clock * 40) * 1.2 : 0);
              ctx.fillStyle = `rgba(255,${Math.round(70 - k * 50)},${Math.round(60 - k * 40)},${(.55 + k * .45).toFixed(2)})`;
              for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); } }
            else { const e = (r.t - 1) / .35, up = e < .25 ? easeOut(e / .25) : 1 - (e - .25) / .75 * .6, hgt = 46 * up;
              ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,60,50,.35)'; for (const [x, y] of pts) { ctx.beginPath(); ctx.ellipse(x, y, 16, 6, 0, 0, TAU); ctx.fill(); } ctx.restore();
              for (const [x, y] of pts) { ctx.fillStyle = '#f2ede2'; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x, y - hgt); ctx.lineTo(x + 8, y); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#ff4a3a'; ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x, y - hgt * .45); ctx.lineTo(x + 3, y); ctx.closePath(); ctx.fill(); } }
          }
          break;
        }
        case 'slam': case 'meteor': {
          if (z.hit || z.t < 0) break;
          const k = clamp(z.t / z.tele, 0, 1), pulse = 0.5 + 0.5 * Math.sin(fx.clock * 14);
          ctx.save(); ctx.strokeStyle = pal.tele; ctx.lineWidth = 3; ctx.setLineDash([12, 10]); ctx.globalAlpha = 0.5 + pulse * 0.4;
          ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.36, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = `rgba(${tf},${0.08 + k * 0.24})`; ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * k, z.r * 0.36 * k, 0, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'lighter'; ctx.translate(z.x, z.y); ctx.scale(1, .36); ctx.rotate(fx.clock * (1 + k * 3)); ctx.strokeStyle = `rgba(${tf},${(.35 + k * .55).toFixed(2)})`; ctx.lineWidth = 3; // a rune ring winding up
          for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * z.r * .72, Math.sin(a) * z.r * .72); ctx.lineTo(Math.cos(a + .18) * z.r * .9, Math.sin(a + .18) * z.r * .9); ctx.stroke(); } ctx.restore();
          if (z.kind === 'meteor') { // the meteor falls in on an angle with a burning trail
            const my = lerp(z.y - 760, z.y, k * k), mx = z.x + (1 - k * k) * 260;
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            beam(mx + 90, my - 120, mx, my, 10 * k + 2, pal.tele, '#ffe1c8'); for (let q = 1; q <= 5; q++) glow(mx + q * 26, my - q * 34, 26 - q * 3, `rgba(${tf},.6)`, 1 - q / 6); if (Math.random() < .6) part(mx, my, 1, f === 3 ? '#ffffff' : '#ffb07a', 120, .4, 3); // a burning tail
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
            else if (z.t < z.tele + z.len + 0.2) { const k = clamp((z.t - z.tele) / (z.len + 0.2), 0, 1), bw = z.w * (1 - k * 0.7); beam(x1, y1, x2, y2, bw, pal.tele, f === 3 ? '#ffffff' : '#fff1e0', 1);
              const nx = -Math.sin(a), ny = Math.cos(a), L = Math.hypot(x2 - x1, y2 - y1); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 2; // two strands of her colour twist round the beam
              for (let h2 = 0; h2 < 2; h2++) { ctx.strokeStyle = h2 ? 'rgba(255,255,255,.7)' : `rgba(${tf},.9)`; ctx.beginPath(); for (let d2 = 0; d2 <= L; d2 += 18) { const o2 = Math.sin(d2 * .03 - fx.clock * 30 + h2 * Math.PI) * bw * .9; ctx[d2 ? 'lineTo' : 'moveTo'](x1 + Math.cos(a) * d2 + nx * o2, y1 + Math.sin(a) * d2 + ny * o2); } ctx.stroke(); }
              if (Math.random() < .7) { const d2 = Math.random() * Math.min(L, 1300); part(x1 + Math.cos(a) * d2, y1 + Math.sin(a) * d2, 1, f === 3 ? '#ffffff' : '#ffd0b0', 260, .35, 2.5); } ctx.restore(); }
          }
          if (z.kind === 'cross' && z.t < z.tele) { ctx.save(); ctx.strokeStyle = pal.tele; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(z.x, z.y, 18 + Math.sin(fx.clock * 12) * 4, 0, TAU); ctx.stroke(); ctx.restore(); }
          if (z.kind === 'laser' && z.t < z.tele) { const kc = z.t / z.tele; glow(z.x, z.y, 30 + kc * 40, `rgba(${tf},.8)`); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(${tf},${(.4 + kc * .5).toFixed(2)})`; ctx.lineWidth = 2; for (let i = 0; i < 8; i++) { const a2 = i / 8 * TAU + fx.clock * 3, r1 = 90 * (1 - kc) + 14; ctx.beginPath(); ctx.moveTo(z.x + Math.cos(a2) * r1, z.y + Math.sin(a2) * r1); ctx.lineTo(z.x + Math.cos(a2) * (r1 + 18), z.y + Math.sin(a2) * (r1 + 18)); ctx.stroke(); } ctx.restore(); } // energy drawn in before it fires
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
        case 'domain': { // DOMAIN: a gold sun-dial opens on the ground under her, its hand sweeps and strikes four times
          const x = z.x, y = z.y, op = easeOut(clamp(z.t / .4, 0, 1)), out = clamp((z.t - 1.95) / .35, 0, 1), al = 1 - out, R = 170 * op;
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(x, y); ctx.scale(1, .36);
          ctx.fillStyle = `rgba(255,170,70,${(.12 * al).toFixed(2)})`; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
          ctx.strokeStyle = GOLD; ctx.globalAlpha = al; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke(); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R * .72, 0, TAU); ctx.stroke();
          for (let i = 0; i < 12; i++) { const a2 = i / 12 * TAU - Math.PI / 2, lit = i < z.n * 3; ctx.strokeStyle = lit ? '#ffffff' : GOLD; ctx.lineWidth = lit ? 6 : 3; ctx.beginPath(); ctx.moveTo(Math.cos(a2) * R * .78, Math.sin(a2) * R * .78); ctx.lineTo(Math.cos(a2) * R * .96, Math.sin(a2) * R * .96); ctx.stroke(); }
          const hand = -Math.PI / 2 + Math.min(1, z.t / 1.85) * TAU; ctx.strokeStyle = '#fff3d0'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(hand) * R * .9, Math.sin(hand) * R * .9); ctx.stroke();
          ctx.restore(); ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const since = z.n ? z.t - [.5, .9, 1.3, 1.85][z.n - 1] : 9; if (since < .3) { const kk = since / .3, w = (z.n === 4 ? 70 : 34) * (1 - kk); const g = ctx.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, 'rgba(255,120,40,0)'); g.addColorStop(.5, 'rgba(255,240,200,.95)'); g.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = g; ctx.fillRect(x - w, -300, w * 2, y + 300); } // a gold pillar on each strike
          ctx.restore(); break;
        }
        case 'seal': {
          const k = clamp(z.t / z.tele, 0, 1), boom = z.t >= z.tele, x = s.boss.x, y = s.boss.y - 105;
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          if (!boom) { hexagram(x, y, 150 - k * 40, fx.clock * (1 + k * 4), easeOut(k * 1.4), pal.hero, 3 + k * 3); hexagram(x, y, 70, -fx.clock * 3, k, '#ffffff', 2); glow(x, y, 60 + k * 120, 'rgba(255,255,255,.5)', k); }
          else { const kk = clamp((z.t - z.tele) / .35, 0, 1); glow(x, y, 200 + kk * 200, 'rgba(255,255,255,.9)', 1 - kk); hexagram(x, y, 110 + kk * 200, 0, 1, '#ffffff', 6, 1, 1 - kk); }
          ctx.restore(); break;
        }
        case 'halo': {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; const k = clamp(z.t / z.len, 0, 1);
          ctx.strokeStyle = pal.hero; ctx.globalAlpha = 1 - k * .7; ctx.lineWidth = 14 * (1 - k) + 2; ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r || 1, (z.r || 1) * .8, 0, 0, TAU); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(z.x, z.y, Math.max(1, z.r - 6), Math.max(1, z.r - 6) * .8, 0, 0, TAU); ctx.stroke();
          for (let i = 0; i < 6; i++) { const a2 = k * 3 + i / 6 * TAU; davidStar(z.x + Math.cos(a2) * (z.r || 1), z.y + Math.sin(a2) * (z.r || 1) * .8, 14, -fx.clock * 3, pal.hero, 1 - k * .6, .5); } // HALO: a ring of six stars
          ctx.restore(); break;
        }
        case 'judgement': {
          const x = z.x ?? s.boss.x, gy = s.boss.y + 20;
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          if (z.t < z.tele) { const k = z.t / z.tele; hexagram(x, gy, 130, fx.clock * 2, k, '#ffffff', 2, .36); ctx.fillStyle = `rgba(255,255,255,${.1 + k * .25})`; ctx.fillRect(x - 6 * k, -300, 12 * k, gy + 300); }
          else { const k = clamp((z.t - z.tele) / z.len, 0, 1), w = 110 * (1 - k * .6); const g = ctx.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - w, -300, w * 2, gy + 300); hexagram(x, gy, 130 + k * 60, 0, 1, '#ffffff', 4, .36, 1 - k); }
          ctx.restore(); break;
        }
        case 'totalitySigil': {
          const k = clamp(z.t / z.tele, 0, 1), boom = z.t >= z.tele;
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          if (!boom) { ctx.fillStyle = `rgba(0,0,0,${k * .4})`; ctx.globalCompositeOperation = 'source-over'; ctx.fillRect(-500, -300, W + 1000, H + 600); ctx.globalCompositeOperation = 'lighter';
            hexagram(640, 420, 420, fx.clock * .6, easeOut(k), pal.hero, 5, .5); hexagram(s.boss.x, s.boss.y - 110, 180, -fx.clock, k, '#ffffff', 3); }
          else { const kk = clamp((z.t - z.tele) / .5, 0, 1); hexagram(640, 420, 420 + kk * 300, 0, 1, '#ffffff', 10 * (1 - kk) + 1, .5, 1 - kk); }
          ctx.restore(); break;
        }
        case 'heroBeam': {
          const x2 = z.x + Math.cos(z.a) * 1600, y2 = z.y + Math.sin(z.a) * 1600;
          if (z.t < z.tele) { const kc = z.t / z.tele; dashedLine(z.x, z.y, x2, y2, pal.hero, 0.6, 2, [8, 6]); ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(z.x, z.y, 20 + kc * 40, 'rgba(140,200,255,.8)'); davidStar(z.x, z.y, 8 + kc * 18, fx.clock * 8, pal.hero, kc, .5); ctx.restore(); } // EYES charges a star at the muzzle
          else { const k = (z.t - z.tele) / z.len, bw = 22 * (1 - k * 0.6) + s.stage * 4; beam(z.x, z.y, x2, y2, bw, pal.hero, '#ffffff', 1);
            if (s.stage === 1) { const L = z.ix != null ? Math.hypot(z.ix - z.x, z.iy - z.y) + 60 : 1600, nx = -Math.sin(z.a), ny = Math.cos(z.a); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 2.5; // a double helix of light winds round the beam
              for (let h2 = 0; h2 < 2; h2++) { ctx.strokeStyle = h2 ? 'rgba(255,255,255,.85)' : 'rgba(120,200,255,.9)'; ctx.beginPath(); for (let d2 = 0; d2 <= L; d2 += 14) { const o2 = Math.sin(d2 * .035 - fx.clock * 34 + h2 * Math.PI) * bw * 1.1 * (1 - k * .5); ctx[d2 ? 'lineTo' : 'moveTo'](z.x + Math.cos(z.a) * d2 + nx * o2, z.y + Math.sin(z.a) * d2 + ny * o2); } ctx.stroke(); }
              for (let r2 = 0; r2 < 3; r2++) { const rk = (k * 2 + r2 / 3) % 1; ctx.strokeStyle = `rgba(200,235,255,${(1 - rk).toFixed(2)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(z.x + Math.cos(z.a) * rk * 140, z.y + Math.sin(z.a) * rk * 140, 8 + rk * 10, (24 + rk * 30), z.a, 0, TAU); ctx.stroke(); } ctx.restore(); } // muzzle rings rolling out
            // EYES: a Star of David rides the laser out to where it lands
            const reach = z.ix != null ? Math.hypot(z.ix - z.x, z.iy - z.y) : 1100, d = Math.min(reach, easeOut(clamp(k * 2.2, 0, 1)) * reach);
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; davidStar(z.x + Math.cos(z.a) * d, z.y + Math.sin(z.a) * d, 28, fx.clock * 3, pal.hero, 1, .6, 'rgba(255,255,255,.6)'); davidStar(z.x, z.y, 16, -fx.clock * 3, pal.hero, 1 - k, .5); ctx.restore(); }
          break;
        }
      }
    }
    // boss orb telegraph: a short aim guide while the orb charges
    if (!front) for (const p of s.shots) if (p.age < p.tele) dashedLine(p.x, p.y, p.x + Math.cos(p.a) * 120, p.y + Math.sin(p.a) * 120, pal.tele, 0.35 + 0.3 * (p.age / p.tele), 1.5, [4, 8]);
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
  // the secret: while the eclipse aligns, a keyboard of stars hangs in the sky; a light runs over it in the order the
  // code is played (letter rows top to bottom, then the number row). Keys you press flash; nothing says if you're right.
  const SKY_ROWS = [['1234567890', 392, 58], ['QWERTYUIOP', 414, 92], ['ASDFGHJKL', 426, 126], ['ZXCVBNM', 448, 160]], SKY_ORDER = [1, 2, 3, 0];
  const skyPos = {}; SKY_ROWS.forEach(([keys, x0, y]) => [...keys].forEach((ch, i) => { skyPos[ch] = [x0 + i * 50, y]; }));
  const skySeq = SKY_ORDER.flatMap((r) => [...SKY_ROWS[r][0]]);
  function drawSkyKeys(s) {
    fx.keyFlash = fx.keyFlash || {};
    const cyc = skySeq.length * .2 + 1.2, t = fx.clock % cyc, lit = t / .2;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(200,220,255,.08)'; ctx.lineWidth = 1; ctx.beginPath(); skySeq.forEach((ch, i) => { const [x, y] = skyPos[ch]; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    for (const ch of skySeq) { const [x, y] = skyPos[ch], i = skySeq.indexOf(ch), d = lit - i, run = d >= 0 && d < 3 ? 1 - d / 3 : 0, f = fx.keyFlash[ch] || 0, tw = .25 + .1 * Math.sin(fx.clock * 3 + i);
      glow(x, y, 10 + run * 22 + f * 24, `rgba(${f > run ? '140,230,255' : '255,255,255'},${Math.min(1, tw + run * .8 + f).toFixed(2)})`);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, tw + .3 + run + f).toFixed(2)})`; ctx.beginPath(); ctx.arc(x, y, 2 + run * 2 + f * 2, 0, TAU); ctx.fill(); }
    ctx.restore();
    for (const k in fx.keyFlash) fx.keyFlash[k] = Math.max(0, fx.keyFlash[k] - 1 / 60 * 2.5);
  }
  function drawMinions(s) { // EXTREME shades: small eclipses with eyes, a tether to her, an HP bar; her shield while they live
    if (!s.minions || !s.minions.length) return;
    const b = s.boss;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,90,70,.6)'; ctx.lineWidth = 4 + Math.sin(fx.clock * 6) * 1.5; ctx.beginPath(); ctx.ellipse(b.x, b.y - 110, 210, 250, 0, 0, TAU); ctx.stroke();
    glow(b.x, b.y - 110, 260, 'rgba(255,60,50,.12)');
    for (const m of s.minions) { ctx.strokeStyle = 'rgba(255,90,70,.35)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(b.x, b.y - 160); ctx.lineTo(m.x, m.y); ctx.stroke(); } ctx.setLineDash([]);
    ctx.restore();
    for (const m of s.minions) {
      const bob = Math.sin(fx.clock * 5 + m.x * .01) * 4;
      ctx.save(); ctx.translate(m.x, m.y + bob);
      ctx.globalCompositeOperation = 'lighter'; glow(0, 0, 60, 'rgba(255,120,60,.35)'); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = m.hurt > 0 ? '#ffffff' : '#07090b'; ctx.beginPath(); ctx.arc(0, 0, m.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ff9a5a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, m.r, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ffd7a1'; ctx.fillRect(-12, -6, 8, 3); ctx.fillRect(4, -6, 8, 3);
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * .32; ctx.fillStyle = '#e0a860'; ctx.beginPath(); ctx.moveTo(Math.cos(a - .1) * m.r, Math.sin(a - .1) * m.r); ctx.lineTo(Math.cos(a) * (m.r + 14), Math.sin(a) * (m.r + 14)); ctx.lineTo(Math.cos(a + .1) * m.r, Math.sin(a + .1) * m.r); ctx.fill(); }
      ctx.fillStyle = '#23303a'; ctx.fillRect(-26, m.r + 8, 52, 5); ctx.fillStyle = '#ff6a5a'; ctx.fillRect(-26, m.r + 8, 52 * clamp(m.hp / m.max, 0, 1), 5);
      ctx.restore();
    }
  }
  function drawShots(s) {
    const f = form(s), pal = P[f], tf = pal.teleFill;
    // owner (Oct 5): "make sure the boss's abilities look cool too": her orbs are little eclipses - a dark core in a
    // burning corona, spikes turning round it, a tail of her colour (phase 2 spikier, phase 3 black and white)
    for (const p of s.shots) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (p.age < p.tele) { const k = p.age / p.tele; glow(p.x, p.y, p.r * 1.6, pal.orb, 0.6); ctx.strokeStyle = `rgba(${tf},${(.3 + k * .6).toFixed(2)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (3.2 - k * 2.2), 0, TAU); ctx.stroke(); ctx.restore(); continue; } // charging: a ring closes in
      let tr = trails.get(p); if (!tr) trails.set(p, tr = []); const lt = tr[tr.length - 1]; if (!lt || Math.hypot(lt.x - p.x, lt.y - p.y) > 7) { tr.push({ x: p.x, y: p.y }); if (tr.length > 12) tr.shift(); }
      ctx.restore(); ribbon(tr, p.x, p.y, p.r * 1.3, tf); ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(p.x, p.y, p.r * 2.6, pal.orb);
      ctx.translate(p.x, p.y); ctx.rotate(p.age * (f === 2 ? 7 : 4)); ctx.fillStyle = pal.orbCore; const n = f === 2 ? 8 : 6;
      for (let i = 0; i < n; i++) { const a = i / n * TAU, L = p.r * (f === 2 ? 1.9 : 1.5); ctx.beginPath(); ctx.moveTo(Math.cos(a) * L, Math.sin(a) * L); ctx.lineTo(Math.cos(a + .35) * p.r * .8, Math.sin(a + .35) * p.r * .8); ctx.lineTo(Math.cos(a - .35) * p.r * .8, Math.sin(a - .35) * p.r * .8); ctx.closePath(); ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, 0, p.r * .78, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = f === 3 ? '#000' : '#0a0405'; ctx.beginPath(); ctx.arc(0, 0, p.r * .5, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const p of s.heroShots) {
      const a = Math.atan2(p.vy, p.vx);
      if (f === 1 && p.hold == null) { let tr = trails.get(p); if (!tr) trails.set(p, tr = []); const lt = tr[tr.length - 1]; if (!lt || Math.hypot(lt.x - p.x, lt.y - p.y) > 6) { tr.push({ x: p.x, y: p.y }); if (tr.length > (p.kind === 'fall' ? 16 : p.kind === 'burst' ? 22 : 26)) tr.shift(); }
        ribbon(tr, p.x, p.y, p.kind === 'burst' ? 40 : p.kind === 'nova' ? 0 : p.kind === 'spin' ? 12 : p.kind === 'fall' ? 14 : 18, p.kind === 'spin' ? '140,230,255' : '110,170,255');
        if (Math.random() < (p.kind === 'burst' ? .9 : .45)) part(p.x + (Math.random() - .5) * p.r, p.y + (Math.random() - .5) * p.r, 1, Math.random() < .5 ? '#ffffff' : '#9fd0ff', 70, .45, 2.5); }
      ctx.save(); ctx.translate(p.x, p.y); ctx.globalCompositeOperation = 'lighter';
      if (p.kind === 'slash') {
        ctx.rotate(a); ctx.strokeStyle = pal.hero; ctx.lineWidth = 5; ctx.shadowColor = pal.hero; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(-p.r * 0.6, 0, p.r, -1.1, 1.1); ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(-p.r * 0.6, 0, p.r - 2, -0.9, 0.9); ctx.stroke();
      } else if (p.kind === 'star') { // STAR: a thrown, spinning Star of David with a short afterimage trail
        const sp = Math.hypot(p.vx, p.vy) || 1, col = f === 3 ? '#fff6d8' : pal.hero;
        for (let i = 3; i >= 1; i--) davidStar(-p.vx / sp * i * 20, -p.vy / sp * i * 20, p.r + 8 - i * 2, -p.age * 4 - i * .15, col, .22 * (4 - i) / 3, 0);
        if (f === 1) { glow(0, 0, 46, 'rgba(110,170,255,.55)'); ctx.save(); ctx.rotate(-p.age * 9); ctx.strokeStyle = 'rgba(200,235,255,.7)'; ctx.lineWidth = 2; for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(0, 0, p.r + 17, i * Math.PI, i * Math.PI + 1.3); ctx.stroke(); } ctx.restore(); } // phase 1 STAR: a blue comet - glow, a ribbon tail, spinning light arcs
        davidStar(0, 0, p.r + 10, -p.age * 4, col, 1, .45, f === 3 ? 'rgba(255,250,220,.55)' : 'rgba(160,240,255,.5)');
        if (f === 1) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, TAU); ctx.fill(); }
      } else if (p.kind === 'spin') { // SPIN: three small stars that curve in on her
        const col = pal.hero; ctx.strokeStyle = col; ctx.globalAlpha = .35; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, p.r + 9, p.age * 22, p.age * 22 + 2.2); ctx.stroke(); ctx.globalAlpha = 1;
        glow(0, 0, 34, 'rgba(140,230,255,.5)'); davidStar(0, 0, p.r + 7, p.age * 6, col, 1, .5, 'rgba(160,240,255,.35)'); davidStar(0, 0, p.r - 2, -p.age * 10, '#ffffff', .8, .2); // SPIN: each star cuts a curved cyan ribbon
      } else if (p.kind === 'burst') { // BURST: a big spinning star, its points flaring, about to blow
        const pu = 1 + Math.sin(p.age * 30) * 0.08;
        glow(0, 0, 70 * pu, f === 3 ? 'rgba(255,255,255,.6)' : 'rgba(255,210,140,.55)');
        davidStar(0, 0, (p.r + 26) * pu, p.age * 3, pal.hero, 1, .55); davidStar(0, 0, (p.r + 6) * pu, -p.age * 5, '#ffffff', .7, .2);
        if (f === 1) { // BURST: unstable - lightning crackles point to point, sparks orbit, the core throbs
          const R2 = (p.r + 26) * pu, pts = []; for (let i = 0; i < 6; i++) { const a2 = p.age * 3 - Math.PI / 2 + i / 6 * TAU; pts.push([Math.cos(a2) * R2, Math.sin(a2) * R2]); }
          ctx.strokeStyle = 'rgba(210,240,255,.9)'; ctx.lineWidth = 1.6; for (let i = 0; i < 6; i++) { if (Math.random() < .35) continue; const [x0, y0] = pts[i], [x1, y1] = pts[(i + 2) % 6]; ctx.beginPath(); ctx.moveTo(x0, y0); for (let q = 1; q < 6; q++) ctx.lineTo(lerp(x0, x1, q / 6) + (Math.random() - .5) * 14, lerp(y0, y1, q / 6) + (Math.random() - .5) * 14); ctx.lineTo(x1, y1); ctx.stroke(); }
          for (let i = 0; i < 10; i++) { const a2 = -p.age * 6 + i / 10 * TAU, rr = R2 * (1.25 + .1 * Math.sin(p.age * 20 + i)); ctx.fillStyle = i % 2 ? '#ffffff' : '#8fc4ff'; ctx.beginPath(); ctx.arc(Math.cos(a2) * rr, Math.sin(a2) * rr, 2.6, 0, TAU); ctx.fill(); }
          glow(0, 0, 26 + Math.sin(p.age * 40) * 8, 'rgba(255,255,255,.95)'); }
      } else if (p.kind === 'fall' && p.meteor) { // STARFALL (phase 3): a black-sun meteor slanting in on a white tail
        ctx.rotate(a); const g3 = ctx.createLinearGradient(-200, 0, 0, 0); g3.addColorStop(0, 'rgba(255,255,255,0)'); g3.addColorStop(1, 'rgba(255,255,255,.9)'); ctx.fillStyle = g3; ctx.beginPath(); ctx.moveTo(-200, 0); ctx.lineTo(0, -13); ctx.lineTo(0, 13); ctx.closePath(); ctx.fill();
        glow(0, 0, 34, 'rgba(255,255,255,.8)'); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#05060a'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.restore(); ctx.save(); ctx.globalCompositeOperation = 'lighter'; const near = clamp(1 - (p.gy - p.y) / 500, 0, 1); ctx.strokeStyle = `rgba(255,255,255,${(near * .8).toFixed(2)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x + p.vx * (p.gy - p.y) / p.vy, p.gy, 30 - near * 12, (30 - near * 12) * .36, 0, 0, TAU); ctx.stroke(); // where it will land
      } else if (p.kind === 'fall') { // SIXFOLD / STARFALL: stars dropping out of the sky on a light trail
        const g = ctx.createLinearGradient(0, -110, 0, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, pal.hero); ctx.fillStyle = g; ctx.fillRect(-3, -110, 6, 110);
        if (f === 1) { const g4 = ctx.createLinearGradient(0, -260, 0, 0); g4.addColorStop(0, 'rgba(110,170,255,0)'); g4.addColorStop(1, 'rgba(190,225,255,.55)'); ctx.fillStyle = g4; ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(0, -260); ctx.lineTo(16, 0); ctx.closePath(); ctx.fill(); glow(0, 0, 40, 'rgba(120,180,255,.6)'); } // SIXFOLD: a wide falling-star wake
        davidStar(0, 0, p.r + 7, p.age * 3, pal.hero, 1, .5, 'rgba(255,255,255,.4)');
        if (p.gy != null) { ctx.restore(); ctx.save(); ctx.globalCompositeOperation = 'lighter'; const near = clamp(1 - (p.gy - p.y) / 500, 0, 1); hexagram(p.x, p.gy, 16 + near * 14, fx.clock * 3, near, pal.hero, 1.5, .36, near * .7); } // where it will land
      } else if (p.kind === 'shield') {
        ctx.globalCompositeOperation = 'source-over'; glow(0, 0, 40, 'rgba(255,224,138,.5)'); drawShield(0, 0, 18, p.age * 16);
      } else if (p.kind === 'wave') {
        ctx.scale(Math.sign(p.vx) || 1, 1); const pu = 1 + Math.sin(p.age * 40) * .06;
        ctx.fillStyle = pal.hero; ctx.globalAlpha = .35; ctx.beginPath(); ctx.ellipse(-60, 0, 120, 16, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = pal.hero; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(0, -40, 26 * pu, 70 * pu, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(-4, -40, 22 * pu, 64 * pu, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        if (Math.random() < .7) part(p.x - Math.sign(p.vx) * 20, p.y, 2, '#d8c8a8', 160, .4, 3);
        davidStar(0, -40, 26 * pu, p.age * 3, pal.hero, .95, .3); hexagram(-50, 0, 30, p.age * 5, 1, pal.hero, 2, .36, .7); // SHOCKWAVE: a star rides the wave, stars burn into the ground behind it
      } else if (p.kind === 'ember') { // ORBIT dart: a gold ember with a red-orange flame tail
        ctx.rotate(a); const g2 = ctx.createLinearGradient(-90, 0, 0, 0); g2.addColorStop(0, 'rgba(255,60,20,0)'); g2.addColorStop(.6, 'rgba(255,110,40,.6)'); g2.addColorStop(1, 'rgba(255,224,138,1)');
        ctx.fillStyle = g2; ctx.beginPath(); ctx.moveTo(-90, 0); ctx.quadraticCurveTo(-30, -9, 6, 0); ctx.quadraticCurveTo(-30, 9, -90, 0); ctx.fill();
        glow(0, 0, 26, 'rgba(255,224,138,.8)'); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -4); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill();
      } else if (p.kind === 'shard' && f === 3) { // SUNSHARD (phase 3): white crescents of the eclipse corona, black-cored
        const pre = p.hold > 0, sp = Math.hypot(p.vx, p.vy) || 1; ctx.rotate(pre ? Math.atan2(p.oy, p.ox) : a);
        if (!pre) { ctx.globalAlpha = .5; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-14 - sp * .07, 0); ctx.stroke(); ctx.globalAlpha = 1; }
        glow(0, 0, pre ? 22 + Math.sin(fx.clock * 30) * 4 : 26, 'rgba(255,255,255,.75)');
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 15, -1.35, 1.35); ctx.arc(-7, 0, 13, 1.2, -1.2, true); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#05060a'; ctx.beginPath(); ctx.arc(-5, 0, 6, 0, TAU); ctx.fill();
      } else if (p.kind === 'shard') { // SUNSHARD: homing stars of light
        const sp = Math.hypot(p.vx, p.vy) || 1; ctx.globalAlpha = .4; ctx.strokeStyle = pal.hero; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-p.vx / sp * 50, -p.vy / sp * 50); ctx.stroke(); ctx.globalAlpha = 1;
        davidStar(0, 0, p.r + 7, p.age * 5, pal.hero, 1, .5, 'rgba(160,250,255,.5)');
      } else if (p.kind === 'nova' && p.supernova) { // SUPERNOVA (phase 3): a black sun with a writhing white corona
        const R = p.r, sp = Math.hypot(p.vx, p.vy) || 1, tx = -p.vx / sp, ty = -p.vy / sp;
        for (let i = 1; i <= 5; i++) glow(tx * i * R * .5, ty * i * R * .5, R * (1.3 - i * .18), 'rgba(255,255,255,.4)', (6 - i) / 6);
        glow(0, 0, R * 2.8, 'rgba(255,255,255,.7)'); ctx.strokeStyle = '#ffffff';
        for (let i = 0; i < 24; i++) { const a2 = i / 24 * TAU + p.age * (i % 2 ? 1.4 : -1), L = R * (1.15 + .35 * Math.sin(p.age * 9 + i * 1.7)); ctx.lineWidth = i % 3 ? 2 : 4; ctx.beginPath(); ctx.moveTo(Math.cos(a2) * R * .95, Math.sin(a2) * R * .95); ctx.lineTo(Math.cos(a2) * L, Math.sin(a2) * L); ctx.stroke(); }
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#03040a'; ctx.beginPath(); ctx.arc(0, 0, R * .92, 0, TAU); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, R * .7, p.age * 3, p.age * 3 + 2); ctx.stroke();
      } else if (p.kind === 'nova') { // NOVA / DOMAIN / SUPERNOVA: the biggest star - two counter-spinning stars,
        // six satellites riding its points and a comet tail
        const R = p.r, sp = Math.hypot(p.vx, p.vy) || 1, tx = -p.vx / sp, ty = -p.vy / sp, col = pal.hero;
        for (let i = 1; i <= 4; i++) { ctx.globalAlpha = .18 * (5 - i) / 4; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(tx * i * R * .55, ty * i * R * .55, R * (1 - i * .16), 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 1; glow(0, 0, R * 2.6, f === 3 ? 'rgba(255,255,255,.65)' : f === 2 ? 'rgba(255,170,90,.6)' : 'rgba(150,240,255,.55)');
        // owner: "make the nova look cooler": a small blue sun - rotating light rays, three accretion arms spiralling in,
        // a heartbeat shockwave and sparks being pulled into it
        ctx.save(); ctx.rotate(p.age * .7); for (let i = 0; i < 16; i++) { const a2 = i / 16 * TAU, L = R * (i % 2 ? 2.1 : 3.2) * (1 + .12 * Math.sin(p.age * 12 + i)); const g5 = ctx.createLinearGradient(0, 0, Math.cos(a2) * L, Math.sin(a2) * L); g5.addColorStop(0, 'rgba(200,235,255,.55)'); g5.addColorStop(1, 'rgba(120,170,255,0)'); ctx.strokeStyle = g5; ctx.lineWidth = i % 2 ? 3 : 6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a2) * L, Math.sin(a2) * L); ctx.stroke(); } ctx.restore();
        for (let arm = 0; arm < 3; arm++) for (let q = 0; q < 14; q++) { const u = ((q / 14) + p.age * 1.6) % 1, rr = R * (2.6 - u * 1.9), a2 = arm / 3 * TAU - u * 4.2 - p.age * 2; ctx.fillStyle = q % 3 ? 'rgba(150,200,255,.85)' : 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(Math.cos(a2) * rr, Math.sin(a2) * rr, 1.5 + u * 3, 0, TAU); ctx.fill(); }
        { const hb = (p.age * 2.4) % 1; ctx.strokeStyle = `rgba(210,235,255,${(.8 * (1 - hb)).toFixed(2)})`; ctx.lineWidth = 6 * (1 - hb) + 1; ctx.beginPath(); ctx.arc(0, 0, R * (1 + hb * 1.6), 0, TAU); ctx.stroke(); }
        if (Math.random() < .8) { const a2 = Math.random() * TAU, rr = R * 3; fx.particles.push({ x: p.x + Math.cos(a2) * rr, y: p.y + Math.sin(a2) * rr, vx: p.vx - Math.cos(a2) * rr * 3, vy: p.vy - Math.sin(a2) * rr * 3, life: .3, max: .3, size: 3, color: Math.random() < .5 ? '#ffffff' : '#9fd0ff', grav: 0 }); }
        davidStar(0, 0, R * 1.15, p.age * 1.5, col, 1, .4); davidStar(0, 0, R * .55, -p.age * 2.5, '#ffffff', 1, .25);
        for (let i = 0; i < 6; i++) { const a2 = p.age * 1.5 - Math.PI / 2 + i / 6 * TAU; davidStar(Math.cos(a2) * R * 1.5, Math.sin(a2) * R * 1.5, R * .22, -p.age * 3, pal.hero, 1, .6); }
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
    if (b.act === 'cgpt' && b.cg) { // ChatGPT's marker, as in its live box: a dashed pale-blue outline of the safe lane
      // for the oldest wave still on screen (so it doesn't vanish when the wave fires)
      const G = b.cg, w = G.waves[0] || G.preview;
      if (w) { const BWd = BOX.maxX - BOX.minX, BHt = BOX.maxY - BOX.minY; ctx.save(); ctx.setLineDash([7, 7]); ctx.strokeStyle = '#98bbcf'; ctx.globalAlpha = .75; ctx.lineWidth = 2;
        if (w.pattern === 'vertical') ctx.strokeRect(BOX.minX + BWd * w.safe / 5 + 18, BOX.minY + 10, BWd / 5 - 36, BHt - 20);
        else if (w.pattern === 'radial') { const gap = Math.round(w.safe * 16 / 5), ang = (gap + 1) * Math.PI / 8 + w.wave * .19, cx = (BOX.minX + BOX.maxX) / 2, cy = (BOX.minY + BOX.maxY) / 2, dx = Math.cos(ang), dy = Math.sin(ang), reach = Math.min((BWd - 14) / 2 / Math.max(1e-4, Math.abs(dx)), (BHt - 14) / 2 / Math.max(1e-4, Math.abs(dy))) * .65; ctx.strokeRect(cx + dx * reach - 12, cy + dy * reach - 9, 24, 18); }
        else ctx.strokeRect(BOX.minX + 10, BOX.minY + BHt * w.safe / 5 + 12, BWd - 20, BHt / 5 - 24);
        ctx.restore(); }
    }
    // P8 (owner: fewer indicators): the ONLY marker is the blue safe area, for the patterns that have one. It shows
    // before the wave and stays while the wave passes. No labels, no aim lines.
    const pv = b.preview || (b.shown && b.t < b.shown.until ? b.shown : null);
    if (pv && ['lanes', 'radial', 'sweep', 'crush'].includes(pv.pattern)) {
      const early = !!b.preview, pulse = early && !reducedMotion ? .5 + .5 * Math.sin(fx.clock * 14) : 1;
      ctx.save(); ctx.beginPath(); ctx.rect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY); ctx.clip();
      ctx.fillStyle = `rgba(60,140,255,${(early ? .18 + .12 * pulse : .22).toFixed(2)})`; ctx.strokeStyle = 'rgba(127,188,255,.85)'; ctx.lineWidth = 2;
      const band = (x, y, w, h) => { ctx.fillRect(x, y, w, h); ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); };
      if (pv.pattern === 'lanes') { const n = pv.n || 5, lw = (BOX.maxX - BOX.minX) / n, lh = (BOX.maxY - BOX.minY) / n; if (pv.vertical) band(BOX.minX + lw * pv.safe, BOX.minY, lw, BOX.maxY - BOX.minY); else band(BOX.minX, BOX.minY + lh * pv.safe, BOX.maxX - BOX.minX, lh); }
      else if (pv.pattern === 'radial') { const cx = (BOX.minX + BOX.maxX) / 2, cy = (BOX.minY + BOX.maxY) / 2, mid = (pv.safe + 1) / 24 * TAU + pv.off, half = TAU / 24 * 1.3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 600, mid - half, mid + half); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      else if (pv.pattern === 'sweep') band(BOX.minX, pv.gapY - pv.half, BOX.maxX - BOX.minX, pv.half * 2);
      else if (pv.pattern === 'crush') band(BOX.minX, pv.cy - pv.half, BOX.maxX - BOX.minX, pv.half * 2);
      ctx.restore();
    }
    ctx.save(); ctx.beginPath(); ctx.rect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, BOX.maxY - BOX.minY); ctx.clip();
    if (b.mode === 'purple') { ctx.strokeStyle = 'rgba(200,120,255,.9)'; ctx.lineWidth = 3; for (let i = 0; i < 3; i++) { const y = BOX.minY + (BOX.maxY - BOX.minY) * (i + 1) / 4; ctx.beginPath(); ctx.moveTo(BOX.minX, y); ctx.lineTo(BOX.maxX, y); ctx.stroke(); } } // Muffet's strings
    // P10 owner: "make the Undertale mechanisms more polished, they look hard to look at". Undertale's own rule:
    // hazards are clean WHITE shapes on black; colour only where it carries a rule (blue / orange) or a theme.
    const BONE = { white: '#f4f1ea', blue: '#2f86ff', orange: '#ff9a1f' }, HALO = { white: 'rgba(255,255,255,.18)', blue: 'rgba(47,134,255,.45)', orange: 'rgba(255,154,31,.45)' };
    const pill = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    for (const z of b.beams) {
      if (z.kind === 'swipe') { // Asgore's sweep: a soft trail and a hard leading edge, colour = the rule
        const c = BONE[z.col], dir = Math.sign(z.vx), g = ctx.createLinearGradient(z.x - dir * 90, 0, z.x, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, HALO[z.col]);
        ctx.fillStyle = g; ctx.fillRect(Math.min(z.x, z.x - dir * 90), BOX.minY, 90, BOX.maxY - BOX.minY);
        ctx.fillStyle = c; pill(z.x - 6, BOX.minY + 2, 12, BOX.maxY - BOX.minY - 4, 6); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(z.x - 1.5, BOX.minY + 6, 3, BOX.maxY - BOX.minY - 12); continue;
      }
      if (z.kind === 'bone') { // Papyrus bones: outlined shaft, round knobs, a soft glow on the coloured ones
        const c = BONE[z.col], top = Math.max(z.y1, BOX.minY - 4), bot = Math.min(z.y2, BOX.maxY + 4);
        if (z.col !== 'white') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(z.x, (top + bot) / 2, Math.max(30, (bot - top) * .6), HALO[z.col], .8); ctx.restore(); }
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#0a0d10'; ctx.fillStyle = c;
        const knobs = () => { ctx.beginPath(); for (const yy of [top + 6, bot - 6]) { ctx.moveTo(z.x - 1, yy); ctx.arc(z.x - 5, yy, 6, 0, TAU); ctx.moveTo(z.x + 11, yy); ctx.arc(z.x + 5, yy, 6, 0, TAU); } };
        knobs(); ctx.stroke(); pill(z.x - 5, top + 4, 10, Math.max(4, bot - top - 8), 4); ctx.stroke(); ctx.fill(); knobs(); ctx.fill(); continue;
      }
      if (z.kind === 'sweep' && z.t < 0) continue;
      if (z.kind === 'sweep') { // a white wall with one gap
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(z.x, (z.gapY - z.half + BOX.minY) / 2, 40, 'rgba(255,255,255,.22)'); glow(z.x, (z.gapY + z.half + BOX.maxY) / 2, 40, 'rgba(255,255,255,.22)'); ctx.restore();
        ctx.fillStyle = '#f4f1ea'; pill(z.x - 5, BOX.minY - 4, 10, z.gapY - z.half - BOX.minY + 4, 5); ctx.fill(); pill(z.x - 5, z.gapY + z.half, 10, BOX.maxY - z.gapY - z.half + 4, 5); ctx.fill();
      } else { // crusher: two white slabs closing to a corridor
        const top = lerp(BOX.minY, z.cy - z.half, z.k), bot = lerp(BOX.maxY, z.cy + z.half, z.k);
        ctx.fillStyle = 'rgba(244,241,234,.92)'; ctx.fillRect(BOX.minX, BOX.minY, BOX.maxX - BOX.minX, top - BOX.minY); ctx.fillRect(BOX.minX, bot, BOX.maxX - BOX.minX, BOX.maxY - bot);
        ctx.fillStyle = '#0a0d10'; for (let x = BOX.minX + 8; x < BOX.maxX; x += 26) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + 8, top - 10); ctx.lineTo(x + 16, top); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, bot); ctx.lineTo(x + 8, bot + 10); ctx.lineTo(x + 16, bot); ctx.fill(); }
      }
    }
    for (const p of b.bullets) {
      const ready = p.age >= p.tele;
      if (p.spear) continue; // drawn outside the clip below, so you see them coming
      if (p.fire) { // Asgore's fire: a warm glow under a clean flame
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(p.x, p.y, 18, 'rgba(255,120,40,.55)'); ctx.restore();
        ctx.fillStyle = '#ff8a2e'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 13); ctx.quadraticCurveTo(p.x + 9, p.y + 1, p.x, p.y + 8); ctx.quadraticCurveTo(p.x - 9, p.y + 1, p.x, p.y - 13); ctx.fill();
        ctx.fillStyle = '#fff1c8'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.quadraticCurveTo(p.x + 4, p.y + 3, p.x, p.y + 6); ctx.quadraticCurveTo(p.x - 4, p.y + 3, p.x, p.y - 4); ctx.fill(); continue;
      }
      if (p.spider) { // Muffet's spider: a round body, eight smooth legs that step in turn
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.sign(p.vx) || 1, 1); ctx.strokeStyle = '#cfa2ff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) { const st2 = Math.sin(fx.clock * 18 + k * 1.6 + (sd > 0 ? 0 : Math.PI)) * 2.5; ctx.beginPath(); ctx.moveTo(-3 + k * 2, sd * 4); ctx.quadraticCurveTo(-8 + k * 5 + st2, sd * 13, -10 + k * 7 + st2, sd * 15); ctx.stroke(); }
        ctx.fillStyle = '#3a1652'; ctx.beginPath(); ctx.ellipse(-3, 0, 9, 7, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#4e1f6e'; ctx.beginPath(); ctx.arc(6, 0, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff7ad9'; ctx.beginPath(); ctx.arc(8, -2, 1.6, 0, TAU); ctx.arc(8, 2, 1.6, 0, TAU); ctx.fill(); ctx.restore(); continue;
      }
      if (p.missile) { // Mad Dummy's missile
        const a2 = Math.atan2(p.vy, p.vx); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a2); ctx.globalAlpha = ready ? 1 : .4;
        ctx.fillStyle = 'rgba(220,220,220,.3)'; for (let k = 1; k <= 4; k++) { ctx.beginPath(); ctx.arc(-10 - k * 7, Math.sin(fx.clock * 20 + k) * 1.5, 4.5 - k, 0, TAU); ctx.fill(); }
        ctx.fillStyle = '#f4f1ea'; pill(-10, -5, 18, 10, 5); ctx.fill(); ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(6, -5); ctx.lineTo(6, 5); ctx.fill(); ctx.fillStyle = '#ff5a46'; ctx.fillRect(-12, -6, 4, 12); ctx.restore(); continue;
      }
      if (p.donut) { ctx.strokeStyle = ready ? '#ffb6e3' : 'rgba(255,182,227,.3)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 3, 0, TAU); ctx.stroke(); if (ready) { ctx.fillStyle = '#fff'; for (let k = 0; k < 5; k++) { const a2 = k * 1.3 + p.age; ctx.fillRect(p.x + Math.cos(a2) * (p.r - 3) - 1, p.y + Math.sin(a2) * (p.r - 3) - 1, 2.5, 2.5); } } continue; }
      if (p.bounce) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(p.x, p.y, p.r * 2.2, 'rgba(255,255,255,.25)', ready ? 1 : .4); ctx.restore(); ctx.fillStyle = ready ? '#f4f1ea' : 'rgba(244,241,234,.3)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); ctx.strokeStyle = '#0a0d10'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * .5, 0, TAU); ctx.stroke(); continue; }
      if (p.wall) { ctx.fillStyle = ready ? '#f4f1ea' : 'rgba(244,241,234,.22)'; if (p.vertical) { pill(p.x - p.r, p.y - 12, p.r * 2, 24, 6); ctx.fill(); } else { pill(p.x - 12, p.y - p.r, 24, p.r * 2, 6); ctx.fill(); } }
      else if (!ready) { ctx.fillStyle = `rgba(244,241,234,${(.12 + .4 * p.age / p.tele).toFixed(2)})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * .7, 0, TAU); ctx.fill(); }
      else { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(p.x, p.y, p.r * 2.4, 'rgba(255,255,255,.3)'); ctx.restore(); ctx.fillStyle = '#f4f1ea'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    for (const p of b.bullets) if (p.spear) { // Undyne's spears: cyan, or yellow for the ones that jump to the far side
      const a2 = Math.atan2(p.vy, p.vx), yel = p.rev && !p.flipped, c = yel ? '#ffe14a' : '#62d6ff'; ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(p.x, p.y, 22, yel ? 'rgba(255,225,74,.4)' : 'rgba(98,214,255,.4)'); ctx.restore();
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a2); ctx.fillStyle = c; pill(-40, -2.5, 34, 5, 2.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-4, -8); ctx.lineTo(0, 0); ctx.lineTo(-4, 8); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    for (const tu of b.turrets || []) { // Mad Dummy's ring: dark pods with a red eye that flares when it fires
      ctx.save(); ctx.translate(tu.x, tu.y); if (tu.flash > 0) { ctx.globalCompositeOperation = 'lighter'; glow(0, 0, 34, 'rgba(255,90,70,.6)', tu.flash * 5); ctx.globalCompositeOperation = 'source-over'; }
      ctx.fillStyle = '#151a1f'; ctx.strokeStyle = '#c9ced4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#5a636c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.stroke();
      ctx.fillStyle = tu.flash > 0 ? '#ffffff' : '#ff4a3a'; ctx.beginPath(); ctx.arc(0, 0, 5 + tu.flash * 10, 0, TAU); ctx.fill(); ctx.restore();
    }
    const so = b.soul, soulCol = b.mode === 'blue' ? '#3f8cff' : b.mode === 'purple' ? '#c05cff' : b.mode === 'green' ? '#3fe08a' : P[f].hero, inv = s.hero.inv > 0 && Math.floor(fx.clock * 16) % 2;
    if (b.mode === 'green') { // Undyne's shield: an arc on the side you point at, and a ring you can't leave
      const A = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[so.shield];
      ctx.save(); ctx.strokeStyle = 'rgba(63,224,138,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(so.x, so.y, 26, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#3fe08a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(so.x, so.y, 26, A - .7, A + .7); ctx.stroke(); ctx.restore();
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; tintStar(so.x, so.y, 11, 0, soulCol, inv ? .35 : 1, .8, inv ? null : 'rgba(127,188,255,.45)'); ctx.restore(); // the soul is a small star
    // the strip for her lines and the one-time soul hints: a fixed place under every box shape, clear of the HP panel
    const SX = 430, SW = 580, SY = 640, fit = (str, px, maxW, wt = 600) => { ctx.font = font(px, wt); const w = ctx.measureText(str).width; return w > maxW ? Math.max(13, Math.floor(px * maxW / w)) : px; };
    if (b.hint && b.hint.t < 4.5) { // first time a soul colour shows up, the strip explains it once
      const a2 = clamp(b.hint.t / .2, 0, 1) * (1 - clamp((b.hint.t - 4.1) / .4, 0, 1)), col2 = b.mode === 'blue' ? '#7fb2ff' : b.mode === 'green' ? '#6fe8a6' : '#d79bff';
      ctx.save(); ctx.globalAlpha = a2; ctx.fillStyle = 'rgba(5,8,10,.92)'; ctx.fillRect(SX, SY, SW, 46); ctx.strokeStyle = col2; ctx.lineWidth = 1; ctx.strokeRect(SX, SY, SW, 46);
      text(b.hint.text, SX + SW / 2, SY + 29, fit(b.hint.text, 18, SW - 24, 700), col2, 'center', false, 700); ctx.restore();
    } else if (b.line && b.line.t < 3.6) { // her line (Undertale-style); click / Enter clears it
      const a2 = clamp(b.line.t / .2, 0, 1) * (1 - clamp((b.line.t - 3.2) / .4, 0, 1)), shown2 = b.line.text.slice(0, Math.floor(b.line.t * 48));
      ctx.save(); ctx.globalAlpha = a2; ctx.fillStyle = 'rgba(5,8,10,.9)'; ctx.fillRect(SX, SY, SW, 46); ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.strokeRect(SX, SY, SW, 46);
      const nm = STAGES[s.stage].boss; text(nm, SX + 14, SY + 28, 14, P[f].name, 'left', false, 700); ctx.font = font(14, 700); const nx = SX + 28 + ctx.measureText(nm).width;
      text(shown2, nx, SY + 30, fit(b.line.text, 21, SX + SW - 14 - nx), '#f2ede2', 'left', false, 600); ctx.restore();
    }
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
  // P13 owner: a key you've pressed burns out, cracks, then breaks and falls away like glass
  const keyT = new WeakMap();
  function keyAge(o, i, done) { if (!o) return -1; let a = keyT.get(o); if (!a) { a = []; keyT.set(o, a); } if (done && a[i] == null) a[i] = fx.clock; return done && a[i] != null ? fx.clock - a[i] : -1; }
  function keycap(x, y, label, state, size = 54, age = -1) {
    if (state === 'done' && age >= 0 && !reducedMotion) { shatterCap(x, y, label, size, age); return; }
    const col = { todo: '#2a333b', now: '#f2ede2', done: '#7fe0b0', bad: '#ff5a46' }[state];
    ctx.save(); ctx.translate(x, y); if (state === 'now' && !reducedMotion) { const p = 1 + Math.sin(fx.clock * 10) * 0.05; ctx.scale(p, p); }
    ctx.fillStyle = '#0b1014'; ctx.fillRect(-size / 2, -size / 2 + 5, size, size);
    ctx.fillStyle = col; ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = state === 'todo' ? '#9aa6b0' : '#0b1014'; ctx.font = font(size * 0.55); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 2); ctx.restore(); ctx.textBaseline = 'alphabetic';
  }
  function shatterCap(x, y, label, size, age) {
    const h2 = size / 2, seed = label.charCodeAt(0) * 7 + Math.round(x);
    const R = (i) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
    ctx.save(); ctx.translate(x, y);
    if (age < .44) { // flash, then it burns: green to charcoal, an ember rim, the letter going dark, then cracks
      const b = clamp((age - .08) / .26, 0, 1), sc = age < .08 ? 1 + age * 2 : 1.16 - b * .16;
      ctx.scale(sc, sc);
      if (age < .08) { ctx.fillStyle = '#ffffff'; ctx.fillRect(-h2, -h2, size, size); }
      else {
        const c0 = [127, 224, 176], c1 = [26, 14, 10], c = c0.map((v, i) => Math.round(v + (c1[i] - v) * b));
        ctx.fillStyle = `rgb(${c})`; ctx.fillRect(-h2, -h2, size, size);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,${Math.round(150 - b * 60)},40,${(.4 + b * .5).toFixed(2)})`; ctx.lineWidth = 3 + b * 2; ctx.strokeRect(-h2, -h2, size, size);
        for (let i = 0; i < 5; i++) { const ex = (R(i) - .5) * size, ey = h2 - b * size * (.4 + R(i + 9) * .8); glow(ex, ey, 3 + R(i + 3) * 3, 'rgba(255,140,50,.9)', 1 - b * .5); } ctx.restore(); // embers lifting off it
        ctx.fillStyle = `rgba(11,16,20,${(1 - b * .6).toFixed(2)})`; ctx.font = font(size * 0.55); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, 2);
        if (age > .34) { ctx.strokeStyle = 'rgba(255,230,200,.9)'; ctx.lineWidth = 1.5; for (let i = 0; i < 4; i++) { let a = R(i + 20) * TAU, px = 0, py = 0; ctx.beginPath(); ctx.moveTo(0, 0); for (let j = 0; j < 3; j++) { a += (R(i * 3 + j) - .5) * 1.2; px += Math.cos(a) * h2 * .45; py += Math.sin(a) * h2 * .45; ctx.lineTo(px, py); } ctx.stroke(); } }
      }
    } else if (age < 1.4) { // it breaks: wedges of charred glass fall and spin away
      const t = age - .44, pts = [[-h2, -h2], [0, -h2], [h2, -h2], [h2, 0], [h2, h2], [0, h2], [-h2, h2], [-h2, 0]];
      for (let i = 0; i < 8; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 8], mx = (ax + bx) / 3, my = (ay + by) / 3, dir = Math.atan2(my, mx);
        const dx = Math.cos(dir) * (40 + R(i) * 80) * t, dy = Math.sin(dir) * (30 + R(i + 1) * 40) * t + 900 * t * t, rot = (R(i + 2) - .5) * 9 * t;
        ctx.save(); ctx.globalAlpha = clamp(1 - t / .9, 0, 1); ctx.translate(mx + dx, my + dy); ctx.rotate(rot); ctx.translate(-mx, -my);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ax, ay); ctx.lineTo(bx, by); ctx.closePath(); ctx.fillStyle = i % 2 ? '#1a0e0a' : '#2a1610'; ctx.fill(); ctx.strokeStyle = 'rgba(255,200,150,.7)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
      }
      if (t < .12) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(0, 0, size * (1 + t * 8), 'rgba(255,190,120,.7)', 1 - t / .12); ctx.restore(); }
    }
    ctx.restore(); ctx.textBaseline = 'alphabetic';
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
    const warm = r.warn > 0; // P11: a GET READY beat first; keys pressed now are ignored
    text(warm ? `RUNE LOCK · GET READY ${r.warn.toFixed(1)}` : r.done === 'fail' ? 'RUNE BROKEN' : r.done === 'win' ? 'REFLECTED!' : 'TYPE THE RUNES IN ORDER', cx, cy - 64, 28, warm ? '#ffffff' : '#ffe2a6');
    r.keys.forEach((key, i) => keycap(x0 + i * gap, cy, key, warm ? 'todo' : r.done === 'fail' && i === Math.max(0, r.wrong) ? 'bad' : i < r.i ? 'done' : i === r.i && !r.done ? 'now' : 'todo', 52, keyAge(r, i, !warm && i < r.i)));
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
    c.keys.forEach((key, i) => keycap(x0 + i * gap, cy, key, i < c.i ? 'done' : i === c.i ? (c.wrong > 0 ? 'bad' : 'now') : 'todo', 54, keyAge(c, i, i < c.i)));
    const left = clamp(1 - c.t / c.limit, 0, 1); ctx.fillStyle = '#23303a'; ctx.fillRect(cx - 110, cy + 42, 220, 7); ctx.fillStyle = '#ff7a5a'; ctx.fillRect(cx - 110, cy + 42, 220 * left, 7);
    ctx.restore();
  }
  function drawFinisherQte(s) {
    const q = s.fq; if (!q) return;
    const cx = 640, cy = 250, n = q.keys.length, gap = 64, x0 = cx - (n - 1) * gap / 2, k = clamp((q.t + 1 - Math.max(0, q.ready ?? 0)) / .25, 0, 1);
    ctx.save(); ctx.fillStyle = `rgba(0,0,0,${.72 * k})`; ctx.fillRect(-500, -300, W + 1000, H + 600);
    const hell = q.hell, ready = q.ready > 0 && !q.done; // P13: a 1 s GET READY first; STAR OF HELL is all red
    if (hell) { ctx.fillStyle = `rgba(90,0,0,${(.35 * k).toFixed(2)})`; ctx.fillRect(-500, -300, W + 1000, H + 600); }
    if (hell) { hellPent(cx, cy + 10, 200, fx.clock * .5, .85 * k, k, .2); ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(cx, cy, 300, 'rgba(255,30,10,.25)', k); ctx.restore(); for (let i = 0; i < 9; i++) flame(cx - 360 + i * 90, cy + 300, 30, 70 + (i % 3) * 30, fx.clock + i, .6 * k); }
    else { ctx.globalCompositeOperation = 'lighter'; hexagram(cx, cy, 230, fx.clock * .4, k, 'rgba(255,224,138,.6)', 2); ctx.globalCompositeOperation = 'source-over'; }
    text(FIN_NAMES[finNext(s)], cx, cy - 92, 46, hell ? '#ff3b3b' : '#ffffff');
    text(q.done === 'win' ? 'UNLEASHED' : q.done === 'fail' ? 'BROKEN' : ready ? `GET READY · ${q.ready.toFixed(1)}` : `TYPE ALL ${n} KEYS IN ORDER`, cx, cy - 52, 22, q.done === 'fail' ? '#ff8a6b' : hell ? '#ffb0a0' : '#ffffff', 'center', true, 600);
    q.keys.forEach((key, i) => keycap(x0 + i * gap, cy, key, ready ? 'todo' : q.done === 'fail' && i === q.wrong ? 'bad' : i < q.i ? 'done' : i === q.i && !q.done ? 'now' : 'todo', 50, keyAge(q, i, !ready && i < q.i)));
    const left = ready ? 1 : clamp(1 - q.t / q.limit, 0, 1); ctx.fillStyle = '#23303a'; ctx.fillRect(cx - 220, cy + 46, 440, 8); ctx.fillStyle = ready ? '#5a6670' : left < .3 ? '#ff5a46' : hell ? '#ff3b3b' : '#ffe08a'; ctx.fillRect(cx - 220, cy + 46, 440 * left, 8);
    ctx.restore();
  }
  function drawFinisherWorld(s) {
    for (const tr of s.hero.trail) drawHero(s, tr.x, tr.y, tr.life * 2.4, tr.face, true);
    const c = s.finisher.cine; if (!c) return;
    const k = c.t / c.len, b = s.boss, dark = clamp(k * 6, 0, 1) * .4;
    ctx.save(); ctx.fillStyle = `rgba(0,4,16,${dark.toFixed(2)})`; ctx.fillRect(-500, -300, W + 1000, H + 600);
    if (c.v === 3) { drawSukkahFront(s, c, k); ctx.restore(); drawHero(s, s.hero.x, s.hero.y); return; }
    if (c.v === 4 || c.v === 5) { drawDavidLaser(s, c, k); ctx.restore(); return; }
    if (c.v === 6) { drawBarrage(s, c, k); ctx.restore(); return; }
    if (c.v === 7) { drawBlade(s, c, k); ctx.restore(); return; }
    if (c.v === 8) { drawTornado(s, c, k); ctx.restore(); return; }
    if (c.v === HELL) { drawHell(s, c, k); ctx.restore(); return; }
    if (c.v === 10) { drawComet(s, c, k); ctx.restore(); return; }
    if (c.v === 11) { drawRicochet(s, c, k); ctx.restore(); return; }
    if (c.v === 12) { drawCollapse(s, c, k); ctx.restore(); return; }
    if (c.v === 1) { drawMagen(s, c, k); ctx.restore(); return; }
    if (c.v === 2) { drawCage(s, c, k); ctx.restore(); return; }
    // 1) the trace: every line of the Star of David drawn behind him as he runs it (flag blue on a white core)
    const segs = STAR_PATH.length - 1, done = c.trace * segs;
    let cx = c.cx, cy = c.cy, R = c.R;
    if (c.v === 2 && k > .52) { const d = easeOut(clamp((k - .52) / .14, 0, 1)); cy = lerp(c.cy, b.y + 30, d); } // RISING STAR: the drawn star slams down
    const P = (i) => { const a = -Math.PI / 2 + i * Math.PI / 3; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R * .82]; };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [w, col, al] of [[22, 'rgba(120,170,255,.25)', 1], [11, '#0038b8', 1], [4, '#ffffff', 1]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.globalAlpha = al * (k > .9 ? 1 - (k - .9) * 10 : 1);
      for (let i = 0; i < Math.ceil(done); i++) { if (i === 3) continue; // 3 is the jump between the triangles
        const [x0, y0] = P(STAR_PATH[i]), [x1, y1] = P(STAR_PATH[i + 1]), f = clamp(done - i, 0, 1); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(lerp(x0, x1, f), lerp(y0, y1, f)); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    if (c.trace >= 1 && k < .9) { ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 6; i++) { const [px, py] = P(i); glow(px, py, 40 + Math.sin(fx.clock * 12 + i) * 8, 'rgba(200,220,255,.8)'); } ctx.globalCompositeOperation = 'source-over'; }
    // 2) a huge spinning Star of David burned into the ground under her
    if (k > .5) {
      const g = easeOut(clamp((k - .5) / .15, 0, 1)), fade = k > .92 ? 1 - (k - .92) / .08 : 1, gy = b.y + 30;
      ctx.globalCompositeOperation = 'lighter'; glow(b.x, gy, 420 * g, 'rgba(90,140,255,.45)', fade); ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(b.x, gy); ctx.scale(1, .34); ctx.rotate(fx.clock * 1.6); ctx.globalAlpha = fade;
      for (const [w, col] of [[26, 'rgba(120,170,255,.3)'], [12, '#0038b8'], [4, '#ffffff']]) { ctx.strokeStyle = col; ctx.lineWidth = w; for (const off of [-Math.PI / 2, Math.PI / 2]) { ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = off + i / 3 * TAU; i ? ctx.lineTo(Math.cos(a) * 400 * g, Math.sin(a) * 400 * g) : ctx.moveTo(Math.cos(a) * 400 * g, Math.sin(a) * 400 * g); } ctx.closePath(); ctx.stroke(); } }
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 440 * g, 0, TAU); ctx.stroke(); ctx.restore();
    }
    // 3) the beam of light from the sky: a twisting vortex of light, shock rings rolling out on the ground
    if (k > .7) {
      const bk = clamp((k - .7) / .3, 0, 1), w = 30 + 90 * easeOut(Math.min(1, bk * 3)) * (1 - bk * .4), gy = b.y + 30;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createLinearGradient(b.x - w * 2, 0, b.x + w * 2, 0); gr.addColorStop(0, 'rgba(0,56,184,0)'); gr.addColorStop(.5, 'rgba(90,150,255,.35)'); gr.addColorStop(1, 'rgba(0,56,184,0)'); ctx.fillStyle = gr; ctx.fillRect(b.x - w * 2, -300, w * 4, gy + 300); ctx.restore();
      vortexBeam(b.x, -300, gy, w, fx.clock, 1 - bk * .5, 'blue');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(b.x, gy, w * 3, 'rgba(255,255,255,.8)'); for (let j = 0; j < 3; j++) { const rr2 = ((fx.clock * 1.8 + j / 3) % 1); ctx.strokeStyle = `rgba(${j % 2 ? '255,224,138' : '200,225,255'},${(1 - rr2).toFixed(2)})`; ctx.lineWidth = 6 * (1 - rr2) + 1; ctx.beginPath(); ctx.ellipse(b.x, gy, 50 + rr2 * 520, (50 + rr2 * 520) * .26, 0, 0, TAU); ctx.stroke(); } ctx.restore();
    }
    ctx.restore();
    for (const tr of s.hero.trail) drawHero(s, tr.x, tr.y, tr.life * 2.4, tr.face, true); drawHero(s, s.hero.x, s.hero.y); // he stays on top of his own star
  }
  // P13 owner: "don't reuse effects; colours that match blue, gold looks really cool": each finisher keeps the flag blue
  // and gets its own accent, and its own ending
  const GOLD = '#ffe08a', GOLD_DEEP = '#c79a4a', FIN_ACCENT = { 0: '#ffffff', 1: GOLD, 2: '#bff4ff', 3: '#ffb347', 4: '#ffd76a', 5: '#7fe8ff', 6: GOLD, 7: '#e8f0ff', 8: '#6fe8d0', 9: '#ff3b3b', 10: GOLD, 11: '#ffe9a8', 12: '#ffffff' };
  function goldStar(x, y, r, rot, a = 1, rim = GOLD) { // flag-blue bands on a gold rim
    if (a <= 0 || r <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(rot); ctx.lineJoin = 'miter'; ctx.miterLimit = 3; const band = Math.max(2, r * .2);
    ctx.strokeStyle = rim; ctx.lineWidth = band + Math.max(2.5, r * .09); for (const off of [-Math.PI / 2, Math.PI / 2]) { triPath(r, off); ctx.stroke(); }
    ctx.strokeStyle = FLAG_BLUE; ctx.lineWidth = band; for (const off of [-Math.PI / 2, Math.PI / 2]) { triPath(r, off); ctx.stroke(); } ctx.restore(); }
  function endShield(x, y, R, rot = 0, a = 1) { // owner: "fully connected like a circle of blue, an outer and inner circle of white and the star in the middle"
    if (R <= 0 || a <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();               // outer white circle
    ctx.fillStyle = FLAG_BLUE; ctx.beginPath(); ctx.arc(0, 0, R * .88, 0, TAU); ctx.fill();          // the circle of blue
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, R * .7, 0, TAU); ctx.fill();           // inner white circle
    ctx.rotate(rot); ctx.lineJoin = 'miter'; ctx.miterLimit = 3; ctx.strokeStyle = FLAG_BLUE; ctx.lineWidth = R * .085;
    for (const off of [-Math.PI / 2, Math.PI / 2]) { triPath(R * .5, off); ctx.stroke(); } ctx.restore();
  }
  const ku = (k, a, b) => clamp((k - a) / (b - a), 0, 1);
  const dim = (k, a = .35) => { ctx.fillStyle = `rgba(0,4,20,${(a * ku(k, 0, .1)).toFixed(2)})`; ctx.fillRect(-500, -300, W + 1000, H + 600); };
  // STAR BARRAGE: thirty small stars stream from his hand into her, then a big charged one
  function drawBarrage(s, c, k) {
    const B = BARRAGE, h = s.hero, b = s.boss, col = P[form(s)].hero, hx = h.x + 50, hy = h.y - 80; dim(k);
    const firing = k > B.shots[0] - .03 && k < B.shots[1] + .03, spinA = c.t * 14;
    // three launch points wheel round his hand like a gatling, each one throwing a star in turn
    const muzzle = (i) => { const a = spinA + (i % 3) / 3 * TAU; return [hx + 10 + Math.cos(a) * 26, hy + Math.sin(a) * 26]; };
    if (k > B.shots[0] - .06 && k < B.final + .02) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 3; i++) { const [mx, my] = muzzle(i); glow(mx, my, 16 + (firing ? Math.sin(fx.clock * 60 + i) * 6 + 8 : 0), 'rgba(255,224,138,.9)'); } ctx.restore(); hexagram(hx + 10, hy, 30, spinA, 1, '#ffffff', 2, 1, .8); }
    for (let i = 0; i < B.n; i++) { const t0 = B.shots[0] + i * B.gap, f = ku(k, t0, t0 + B.fly); if (k < t0 || f >= 1) continue;
      const [ox, oy] = muzzle(i), tx = b.x - 40 + ((i * 37) % 60 - 30), ty = b.y - 120 + ((i * 53) % 90 - 45), x = lerp(ox, tx, f), y = lerp(oy, ty, f) - Math.sin(f * Math.PI) * ((i % 3) - 1) * 50;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(160,200,255,.55)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(lerp(ox, tx, Math.max(0, f - .45)), lerp(oy, ty, Math.max(0, f - .45))); ctx.stroke(); ctx.restore();
      davidStar(x, y, 15, k * 40 + i, col, 1, 0, 'rgba(160,240,255,.45)'); }
    const n = Math.min(B.n, Math.floor(ku(k, B.shots[0] + B.fly, B.shots[1] + B.fly) * B.n)); if (n > 0 && k < B.final + .05) text('x' + n, b.x + 150, b.y - 260, 34 + Math.min(20, n), '#ffffff');
    if (k >= B.charge && k < B.final) { const g = ku(k, B.charge, B.final); ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(hx, hy, 60 + g * 140, 'rgba(255,224,138,.75)'); glow(hx, hy, 30 + g * 60, 'rgba(255,255,255,.9)'); ctx.restore();
      for (let i = 0; i < 3; i++) { const a = -spinA * 1.5 + i / 3 * TAU, r = (1 - g) * 90 + 10; ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(hx + Math.cos(a) * r, hy + Math.sin(a) * r, 4, 0, TAU); ctx.fill(); } // light sucked into the shot
      davidStar(hx + 30, hy, 20 + g * 70, k * 30, col, 1, 0); }
    if (k >= B.final && k < B.final + B.fly * 2) { const f = ku(k, B.final, B.final + B.fly * 2); davidStar(lerp(hx + 30, b.x - 40, f), lerp(hy, b.y - 120, f), 90, k * 30, col, 1, 0, 'rgba(255,255,255,.6)'); }
    if (k > B.final + B.fly) { const e = ku(k, B.final + B.fly, 1), o = easeOut(e); davidStar(b.x - 40, b.y - 120, 90 + o * 400, o * 2, col, 1 - e, 0); ctx.save(); ctx.globalCompositeOperation = 'lighter'; hexagram(b.x, b.y + 30, 80 + o * 520, o, 1, '#ffffff', 5, .3, 1 - e); hexagram(b.x, b.y + 30, 60 + o * 360, -o, 1, GOLD, 3, .3, (1 - e) * .8); ctx.restore(); }
    drawHero(s, h.x, h.y);
  }
  // DAVID'S BLADE (remade): the blade charges with light, six dashes through her along the star's lines leave the cuts
  // hanging in the air, he lands and sheathes it, and the star of cuts detonates
  function drawBlade(s, c, k) {
    const D = BLADE, h = s.hero, b = s.boss, col = P[form(s)].hero, slot = (D.cutEnd - D.cut0) / 6; dim(k, .45);
    const blade = (x, y, ang, len, a = 1) => { if (len <= 0) return; ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha = a;
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(140,190,255,.35)'; ctx.fillRect(0, -20, len, 40); ctx.fillStyle = 'rgba(255,224,138,.25)'; ctx.fillRect(0, -8, len * .9, 16); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#eef6ff'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(len - 34, -9); ctx.lineTo(len, 0); ctx.lineTo(len - 34, 9); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = FLAG_BLUE; ctx.fillRect(0, -2, len - 44, 4); ctx.restore(); davidStar(x, y, 22, ang, col, a, 0, 'rgba(255,224,138,.5)'); };
    // the cuts left in the air: a fast sweep, then they hang there humming
    const cuts = () => { for (let i = 0; i < 6; i++) { const t0 = D.cut0 + i * slot; if (k < t0) break; const [i0, i1] = BLADE_EDGES[i], p0 = bladePt(b, i0), p1 = bladePt(b, i1), m = easeOut(clamp((k - t0) / (slot * .55), 0, 1));
        const split = k > D.split ? ku(k, D.split, D.split + .14) : 0, fade = k > D.split ? 1 - ku(k, D.split + .04, 1) : 1, hum = 1 + Math.sin(fx.clock * 30 + i) * .15 * (k > D.sheathe ? 2 : 1);
        if (fade <= 0) continue; const x1 = lerp(p0[0], p1[0], m), y1 = lerp(p0[1], p1[1], m);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.globalAlpha = fade;
        ctx.strokeStyle = 'rgba(110,160,255,.35)'; ctx.lineWidth = (18 + split * 60) * hum; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,224,138,.5)'; ctx.lineWidth = (8 + split * 24) * hum; ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3 + split * 14; ctx.stroke(); ctx.restore(); } };
    cuts();
    if (k < D.cut0) { // charging: the blade grows out of his sword, gold light spiralling into it
      const g = easeOut(ku(k, .02, .18)), len = 40 + g * 380, ang = -Math.PI / 2 + .2;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 14; i++) { const t = (fx.clock * 1.4 + i / 14) % 1, d = (1 - t) * 160, a = i * 2.4 + t * 6; glow(h.x + 20 + Math.cos(a) * d, h.y - 80 - len * .5 + Math.sin(a) * d, 6, 'rgba(255,224,138,.9)', t); } ctx.restore();
      drawHero(s, h.x, h.y); blade(h.x + 20, h.y - 80, ang, len);
    } else if (k < D.cutEnd) { // dashing: afterimages along the line, the blade laid along the dash
      const f = (k - D.cut0) / slot, i = Math.min(5, Math.floor(f)), [i0, i1] = BLADE_EDGES[i], p0 = bladePt(b, i0), p1 = bladePt(b, i1), ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), g = f - i;
      for (let j = 4; j >= 1; j--) { const m = easeOut(clamp((g - j * .06) / .55, 0, 1)); drawHero(s, lerp(p0[0], p1[0], m), lerp(p0[1], p1[1], m) + 60, .5 - j * .1, Math.cos(ang) >= 0 ? 1 : -1, true); }
      drawHero(s, h.x, h.y, 1, Math.cos(ang) >= 0 ? 1 : -1); blade(h.x - Math.cos(ang) * 60, h.y - 60 - Math.sin(ang) * 60, ang, 330);
    } else { // landed: he sheathes it slowly; the cuts hum louder; then the click
      const sh = ku(k, D.cutEnd + .02, D.sheathe); drawHero(s, h.x, h.y, 1, 1); if (sh < 1) blade(h.x + 20, h.y - 40, Math.PI / 2 - .25, 380 * (1 - easeOut(sh)), 1);
      if (k > D.split) { const e = ku(k, D.split, 1); ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (e < .2) glow(b.x, b.y - 120, 900 * (1 - e * 4), 'rgba(235,245,255,1)'); glow(b.x, b.y - 120, 200 + e * 300, 'rgba(120,170,255,.5)', 1 - e); ctx.restore(); }
    }
  }
  // STAR TORNADO: a whirlwind of stars round her, tightening and speeding up, then it collapses into her and bursts
  function drawTornado(s, c, k) {
    const T = TORNADO, b = s.boss, col = P[form(s)].hero, rise = easeOut(ku(k, 0, .2)), col2 = ku(k, T.collapse - .1, T.collapse), N = 70, base = b.y + 30; dim(k, .4);
    const spin = c.t * (3 + c.t * 2.5);
    if (k < T.burst) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(160,200,255,.25)'; ctx.lineWidth = 2; // the funnel
      for (let j = 0; j < 8; j++) { ctx.beginPath(); for (let y = 0; y <= 1.001; y += .05) { const r = (70 + y * 260) * (1 - col2 * .8), a = spin * 1.3 + j / 8 * TAU + y * 3, x = b.x + Math.cos(a) * r, yy = base - y * 560 * rise + Math.sin(a) * r * .22; y ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
      glow(b.x, base - 280 * rise, 200 + col2 * 200, `rgba(150,190,255,${(.15 + col2 * .5).toFixed(2)})`); ctx.restore();
      // the dust it tears up at its base, and lightning crawling inside the funnel
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 26; i++) { const a = spin * 2 + i * .9, r = (90 + (i * 23) % 120) * (1 - col2 * .7); ctx.fillStyle = `rgba(200,220,235,${(.18 * rise).toFixed(2)})`; ctx.beginPath(); ctx.ellipse(b.x + Math.cos(a) * r, base + Math.sin(a) * r * .22, 14, 6, 0, 0, TAU); ctx.fill(); }
      if (Math.sin(fx.clock * 23) > .55) { ctx.strokeStyle = 'rgba(220,240,255,.85)'; ctx.lineWidth = 2; ctx.beginPath(); let x = b.x + (Math.random() - .5) * 80, y = base - 40; ctx.moveTo(x, y); for (let j = 0; j < 7; j++) { x += (Math.random() - .5) * 70; y -= 60 * rise; ctx.lineTo(x, y); } ctx.stroke(); }
      ctx.restore();
      for (let i = 0; i < N; i++) { const y = i / N, r = (70 + y * 260) * (1 - col2 * .85), a = spin * (1.6 - y * .6) + i * 2.399, x = b.x + Math.cos(a) * r, yy = base - y * 560 * rise + Math.sin(a) * r * .22;
        davidStar(x, yy, 10 + (i % 4) * 4, a * 2, i % 5 ? col : '#ffffff', .4 + .6 * (Math.sin(a) * .5 + .5), 0); }
    } else { const e = ku(k, T.burst, 1), o = easeOut(e); ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (e < .2) glow(b.x, b.y - 150, 900 * (1 - e * 4), 'rgba(220,255,250,1)'); glow(b.x, b.y - 150, 200 + o * 320, 'rgba(111,232,208,.45)', 1 - e); ctx.restore();
      for (let i = 0; i < 36; i++) { const a = i * 2.399, d = o * (260 + (i * 71) % 480); davidStar(b.x + Math.cos(a) * d, b.y - 150 + Math.sin(a) * d * .7 + e * e * 160, 14 + (i % 3) * 6, o * 9 + i, i % 4 ? col : '#ffffff', 1 - e, 0); } // flung out
      for (let i = 0; i < 24; i++) { const a = i * 2.399 + o * 7, r = 60 + o * (200 + (i * 37) % 200), y = b.y - 150 - o * (300 + (i * 53) % 400); davidStar(b.x + Math.cos(a) * r, y + Math.sin(a) * r * .25, 10 + (i % 3) * 4, a * 2, '#6fe8d0', (1 - e) * .8, 0); } } // and spiralling up
    drawHero(s, s.hero.x, s.hero.y);
  }
  // STAR COMET: wings of light, he launches out of sight, a gleam in the sky, the dive as a comet, the crater
  function drawComet(s, c, k) {
    const C = COMET, h = s.hero, b = s.boss, col = P[form(s)].hero; dim(k, .35 + .25 * ku(k, C.launch, C.gleam));
    const wings = (x, y, open, a = 1) => { if (open <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter';
      for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) { const ang = -Math.PI / 2 + sd * (.5 + i * .32) * open, L = (90 + i * 26) * open, ex = x + Math.cos(ang) * L, ey = y + Math.sin(ang) * L;
        ctx.strokeStyle = i % 2 ? 'rgba(255,224,138,.8)' : 'rgba(160,210,255,.85)'; ctx.lineWidth = 10 - i * 1.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(ang - sd * .4) * L * .6, y + Math.sin(ang - sd * .4) * L * .6, ex, ey); ctx.stroke(); glow(ex, ey, 14, 'rgba(255,255,255,.9)'); }
      ctx.restore(); for (const sd of [-1, 1]) davidStar(x + sd * 120 * open, y - 110 * open, 14, fx.clock * 3, col, a, 0); };
    if (k < C.launch) { const op = easeOut(ku(k, .02, .14)); drawHero(s, h.x, h.y); wings(h.x, h.y - 70, op); }
    else if (k < C.dive) { // the climb: a streak of stars rising off the top of the screen, then a gleam high in the sky
      const f = ku(k, C.launch, C.launch + .12); if (f < 1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createLinearGradient(0, h.y, 0, b.y + 60); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(160,210,255,0)'); ctx.fillStyle = gr; ctx.fillRect(h.x - 14, h.y - 60, 28, b.y + 120 - h.y); ctx.restore(); drawHero(s, h.x, h.y); wings(h.x, h.y - 70, 1); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 40; i++) { const x = (i * 197) % 1280 + (b.x - 640) * .55, y = 90 + (i * 71) % 260, tw = .3 + .7 * Math.abs(Math.sin(fx.clock * 3 + i)); glow(x, y, 4 + tw * 4, `rgba(255,255,255,${(tw * ku(k, C.launch, C.gleam)).toFixed(2)})`); } ctx.restore(); // the night sky opens while he's up there
      if (k > C.gleam) { const g = ku(k, C.gleam, C.dive), x = b.x - 760, y = 150; ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(x, y, 30 + g * 40, 'rgba(255,255,255,1)'); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 60 * g, y); ctx.lineTo(x + 60 * g, y); ctx.moveTo(x, y - 60 * g); ctx.lineTo(x, y + 60 * g); ctx.stroke(); ctx.restore(); }
    } else if (k < C.impact) { // the dive: a comet with a long tail and a Star of David at its head, speed lines across the screen
      const ang = Math.atan2(b.y + 20 - 150, b.x - 60 - (b.x - 760)), f = ku(k, C.dive, C.impact);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) { const off = ((i * 97) % 700) - 350, ln = 80 + (i * 37) % 160, px = h.x - Math.cos(ang) * (200 + (i * 53) % 500) + Math.sin(ang) * off, py = h.y - Math.sin(ang) * (200 + (i * 53) % 500) - Math.cos(ang) * off; ctx.strokeStyle = 'rgba(200,225,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.cos(ang) * ln, py - Math.sin(ang) * ln); ctx.stroke(); }
      for (let j = 12; j >= 0; j--) { const d = j * 34, x = h.x - Math.cos(ang) * d, y = h.y - 40 - Math.sin(ang) * d; glow(x, y, (70 - j * 4) * (1 + f * .4), j < 3 ? 'rgba(255,255,255,.95)' : j % 2 ? 'rgba(255,224,138,.5)' : 'rgba(120,170,255,.55)'); }
      ctx.restore(); davidStar(h.x, h.y - 40, 46 + f * 20, c.t * 12, col, 1, 0, 'rgba(255,255,255,.7)');
    } else { // the crater: a star burned into the ground, rocks thrown up, he climbs out of it
      const e = ku(k, C.impact, 1), o = easeOut(e), gx = b.x - 40, gy = b.y + 30;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (e < .2) glow(gx, gy - 60, 1000 * (1 - e * 4), 'rgba(255,255,255,1)'); glow(gx, gy, 200 + o * 200, 'rgba(255,224,138,.4)', 1 - e); hexagram(gx, gy, 140 + o * 120, 0, 1, GOLD, 8, .3, 1 - e * .6); hexagram(gx, gy, 300 + o * 500, o, 1, '#ffffff', 5, .3, 1 - e); ctx.restore();
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.ellipse(gx, gy, 170, 50, 0, 0, TAU); ctx.fill(); ctx.restore();
      drawHero(s, h.x, h.y); }
  }
  // STAR RICOCHET: one star bouncing between her and the edges of the screen, faster each leg, with a long trail
  function drawRicochet(s, c, k) {
    const b = s.boss, col = P[form(s)].hero, legs = ricochetLegs(s), tt = c.t - RICO.start * c.len, end = legs[legs.length - 1].t1; dim(k, .4);
    const pos = (t) => { if (t <= 0) return [legs[0].x0, legs[0].y0]; for (const L of legs) if (t <= L.t1) { const f = (t - L.t0) / (L.t1 - L.t0); return [lerp(L.x0, L.x, f), lerp(L.y0, L.y, f)]; } return null; };
    if (tt < end) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (let j = 24; j >= 1; j--) { const p0 = pos(tt - j * .012), p1 = pos(tt - (j - 1) * .012); if (!p0 || !p1) continue; ctx.strokeStyle = `rgba(160,200,255,${(.6 * (1 - j / 25)).toFixed(2)})`; ctx.lineWidth = 14 * (1 - j / 25) + 2; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); }
      ctx.restore();
      const p = pos(Math.max(0, tt)), leg = legs.findIndex((L) => tt <= L.t1), big = leg === legs.length - 1 ? 1.8 : 1;
      if (p) davidStar(p[0], p[1], 24 * big, c.t * 14, col, 1, 0, 'rgba(255,255,255,.6)');
      const hits = legs.filter((L) => L.boss && L.t1 <= tt).length; if (hits) text('x' + hits, b.x + 170, b.y - 280, 30 + hits * 3, '#ffffff');
    } else { const tA = tt - end, snap = clamp((tA - .4) / .15, 0, 1), sn = snap * snap, bx = b.x - 30, by = b.y - 120; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      if (tA < .55) { // the whole path lights up gold with pulses running along it, then every line snaps into her
        for (const L of legs) { const x0 = lerp(L.x0, bx, sn), y0 = lerp(L.y0, by, sn), x1 = lerp(L.x, bx, sn), y1 = lerp(L.y, by, sn); ctx.strokeStyle = 'rgba(255,224,138,.85)'; ctx.lineWidth = 6 + tA * 18; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          const pf = (tA * 3) % 1; glow(lerp(x0, x1, pf), lerp(y0, y1, pf), 18, 'rgba(255,255,255,.9)'); if (!L.boss) glow(x1, y1, 30, 'rgba(255,220,140,.8)'); }
      } else { const f = clamp((tA - .55) / .9, 0, 1), o = easeOut(f); if (f < .2) glow(bx, by, 900 * (1 - f * 4), 'rgba(255,245,220,1)'); for (let i = 0; i < legs.length; i++) { const L = legs[i], a = Math.atan2(L.y - by, L.x - bx) || i; ctx.strokeStyle = `rgba(255,224,138,${(.8 * (1 - f)).toFixed(2)})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(bx + Math.cos(a) * o * 100, by + Math.sin(a) * o * 100); ctx.lineTo(bx + Math.cos(a) * (o * 900 + 60), by + Math.sin(a) * (o * 900 + 60)); ctx.stroke(); } }
      ctx.restore(); }
    drawHero(s, s.hero.x, s.hero.y);
  }
  // STAR COLLAPSE: every light on screen streams into one star inside her; it shrinks to a black point; silence; supernova
  function drawCollapse(s, c, k) {
    const C = COLLAPSE, b = s.boss, cx = b.x, cy = b.y - 120, col = P[form(s)].hero, draw = ku(k, 0, C.collapse), dark = Math.min(.85, .3 + draw * .55);
    ctx.fillStyle = `rgba(0,2,10,${(k < C.nova ? dark : dark * (1 - ku(k, C.nova, C.nova + .05))).toFixed(2)})`; ctx.fillRect(-500, -300, W + 1000, H + 600);
    if (k < C.collapse) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (let i = 0; i < 70; i++) { const a = i * 2.399, ph = (c.t * (1.1 + draw) + i * .137) % 1, d = (1 - ph) * 950, len = 40 + draw * 80; ctx.strokeStyle = `rgba(${i % 3 ? '200,220,255' : '255,240,200'},${(.25 + .6 * ph).toFixed(2)})`; ctx.lineWidth = 2 + ph * 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d * .7); ctx.lineTo(cx + Math.cos(a) * Math.max(0, d - len), cy + Math.sin(a) * Math.max(0, d - len) * .7); ctx.stroke(); }
      glow(cx, cy, 40 + draw * 160, 'rgba(255,255,255,.9)'); ctx.restore();
      davidStar(cx, cy, 14 + easeOut(draw) * 60, c.t * (2 + draw * 10), col, 1, 0);
    } else if (k < C.nova) { const f = ku(k, C.collapse, C.nova), r = lerp(70, 5, easeOut(f)); // the black point, a beat of nothing
      ctx.save(); ctx.lineJoin = 'miter'; ctx.translate(cx, cy); ctx.rotate(c.t * 12); ctx.fillStyle = '#000'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; for (const off of [-Math.PI / 2, Math.PI / 2]) { triPath(r, off); ctx.fill(); ctx.stroke(); } ctx.restore(); }
    else { const e = ku(k, C.nova, 1), o = easeOut(e); ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (e < .25) glow(cx, cy, 1100 * (1 - e * 3), 'rgba(255,255,255,1)');
      for (let j = 0; j < 5; j++) hexagram(cx, cy, 60 + o * (260 + j * 200), o * (j % 2 ? -1 : 1) * 2, 1, j % 2 ? GOLD : 'rgba(120,170,255,1)', 7 - j, 1, (1 - e) * (1 - j * .15)); ctx.restore(); }
    drawHero(s, s.hero.x, s.hero.y);
  }
  // STAR OF HELL (owner: "a devil star, Algol, not David's star; the longest and coolest; effects in sync"). An
  // inverted pentagram burns itself into the sky over her, hellfire pours down, a blast; a pentagram of lasers with
  // every point firing into her; a vertical laser through her; a second pentagram at her heart spins up for three
  // seconds, exponentially faster, white-hot, and overcharges; impact frames; a scorched pentagram left on the ground.
  const PENT = (r, rot, i) => { const a = Math.PI / 2 + rot + i * TAU / 5; return [Math.cos(a) * r, Math.sin(a) * r]; };
  function hellPent(x, y, r, rot, a = 1, prog = 1, hot = 0) { // inverted pentagram in a ring, drawn line by line
    if (a <= 0 || r <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const order = [0, 2, 4, 1, 3, 0], segs = 5, done = prog * (segs + 1);
    const pass = (w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(0, 0, r * 1.12, 0, TAU * clamp(done - segs, 0, 1)); ctx.stroke();
      for (let i = 0; i < segs; i++) { const f = clamp(done - i, 0, 1); if (f <= 0) break; const [x0, y0] = PENT(r, rot, order[i]), [x1, y1] = PENT(r, rot, order[i + 1]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(lerp(x0, x1, f), lerp(y0, y1, f)); ctx.stroke(); } };
    ctx.globalCompositeOperation = 'lighter'; pass(r * .16, `rgba(255,${Math.round(40 + hot * 120)},20,.35)`); ctx.globalCompositeOperation = 'source-over';
    pass(r * .07, hot > .5 ? '#ffd0b0' : '#b8000f'); pass(Math.max(1.5, r * .022), hot > .3 ? '#ffffff' : '#ff8a40');
    ctx.restore();
  }
  function flame(x, y, w, hgt, t, a = 1) { // a flickering tongue of fire
    if (a <= 0 || hgt <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 3; j++) { const ww = w * (1 - j * .3), hh = hgt * (1 - j * .22) * (1 + Math.sin(t * 13 + j * 2 + x) * .12), sway = Math.sin(t * 7 + x * .05 + j) * ww * .3;
      ctx.fillStyle = ['rgba(200,20,10,.55)', 'rgba(255,110,30,.6)', 'rgba(255,230,160,.7)'][j]; ctx.beginPath(); ctx.moveTo(x - ww, y); ctx.quadraticCurveTo(x - ww * .6 + sway, y - hh * .6, x + sway * 1.6, y - hh); ctx.quadraticCurveTo(x + ww * .6 + sway, y - hh * .6, x + ww, y); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  function redBeam(x0, y0, x1, y1, w, a = 1) { if (w <= 0 || a <= 0) return; ctx.save(); ctx.lineCap = 'round'; ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,30,10,.45)'; ctx.lineWidth = w * 3.2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.strokeStyle = '#ff3a20'; ctx.lineWidth = w; ctx.stroke(); ctx.strokeStyle = '#fff0e0'; ctx.lineWidth = Math.max(1.5, w * .35); ctx.stroke(); ctx.restore(); }
  // a twisting fire beam: wavy edges in three heat layers, spiral rings sliding down it, sparks pouring off it
  const BEAM_PAL = { red: ['rgba(160,0,0,.35)', 'rgba(255,70,20,.55)', 'rgba(255,200,120,.8)', 'rgba(255,255,240,.95)', 'rgba(255,160,80,.6)', '#ffd060', '#ff6a20'],
    blue: ['rgba(0,40,170,.35)', 'rgba(70,130,255,.55)', 'rgba(180,215,255,.8)', 'rgba(255,255,255,.95)', 'rgba(255,224,138,.55)', '#ffe08a', '#cfe0ff'] };
  function vortexBeam(x, y0, y1, w, t, a = 1, pal = 'red') { const C = BEAM_PAL[pal];
    if (a <= 0 || w <= 0 || y1 <= y0) return; ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter';
    const layer = (ww, col, ph) => { ctx.fillStyle = col; ctx.beginPath(); for (let y = y0; y <= y1; y += 12) ctx.lineTo(x - ww * (1 + .22 * Math.sin(y * .035 + t * 18 + ph)), y); for (let y = y1; y >= y0; y -= 12) ctx.lineTo(x + ww * (1 + .22 * Math.sin(y * .03 - t * 16 + ph * 2)), y); ctx.closePath(); ctx.fill(); };
    layer(w * 1.8, C[0], 0); layer(w * 1.15, C[1], 1.3); layer(w * .55, C[2], 2.1); layer(w * .2, C[3], 3);
    for (let i = 0; i < 7; i++) { const yy = y0 + ((t * 700 + i * (y1 - y0) / 7) % (y1 - y0)); ctx.strokeStyle = C[4]; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, yy, w * 1.6, w * .35, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
    if (!reducedMotion) for (let i = 0; i < 2; i++) fx.particles.push({ x: x + (Math.random() - .5) * w * 2, y: y0 + Math.random() * (y1 - y0), vx: (Math.random() - .5) * 300, vy: 200 + Math.random() * 300, life: .5, max: .5, size: 3, color: Math.random() < .5 ? C[5] : C[6], grav: 300 });
  }
  // a laser with a crackling lightning core (re-jagged every frame) and a hot spark at its head
  function crackBeam(x0, y0, x1, y1, w, a = 1, pal = 'red') {
    if (a <= 0 || w <= 0) return; if (pal === 'blue') laser(x0, y0, x1, y1, w, a); else redBeam(x0, y0, x1, y1, w, a);
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.floor(L / 26)), nx = -(y1 - y0) / (L || 1), ny = (x1 - x0) / (L || 1);
    ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,245,230,.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let i = 1; i < n; i++) { const f = i / n, j = (Math.random() - .5) * w * 1.4; ctx.lineTo(lerp(x0, x1, f) + nx * j, lerp(y0, y1, f) + ny * j); } ctx.lineTo(x1, y1); ctx.stroke();
    glow(x1, y1, w * 2.6, pal === 'blue' ? 'rgba(220,235,255,.95)' : 'rgba(255,220,180,.95)'); ctx.restore();
  }
  // the hell portal: a black eye in the sky ringed with turning runes
  function hellPortal(x, y, r, t, a = 1) {
    if (a <= 0 || r <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter'; glow(0, 0, r * 2.4, 'rgba(255,30,10,.5)'); ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#080000'; ctx.beginPath(); ctx.arc(0, 0, r * .62, 0, TAU); ctx.fill();
    for (const [rr, dir, n] of [[r * 1.32, 1, 18], [r * 1.5, -1, 24]]) { ctx.save(); ctx.rotate(t * .9 * dir); ctx.strokeStyle = '#ff5a20'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
      for (let i = 0; i < n; i++) { ctx.save(); ctx.rotate(i / n * TAU); ctx.fillStyle = i % 3 ? '#ff7a30' : '#ffd0a0'; ctx.fillRect(rr - 4, -3, 8 + (i % 2) * 5, 6); ctx.restore(); } ctx.restore(); }
    ctx.restore();
  }
  function drawHell(s, c, k) {
    const L = HELLT, b = s.boss, cx = b.x, cy = b.y - 120, gy = b.y + 30, u = (a, b2) => ku(k, a, b2), T = c.t;
    ctx.fillStyle = `rgba(${Math.round(40 + 30 * u(L.spin, L.boom2))},0,0,${(.45 + .35 * u(0, L.boom2)).toFixed(2)})`; ctx.fillRect(-500, -300, W + 1000, H + 600); // the sky bleeds red
    if (!reducedMotion) for (let i = 0; i < 3; i++) fx.particles.push({ x: Math.random() * W, y: H + 10, vx: (Math.random() - .5) * 40, vy: -120 - Math.random() * 200, life: 2.5, max: 2.5, size: 2 + Math.random() * 2, color: Math.random() < .5 ? '#ff5a20' : '#ffb040', grav: -20 }); // embers everywhere
    if (k > L.fire + .05) { const g = u(L.fire + .05, L.boom1), pul = .6 + .4 * Math.sin(T * 9); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,${Math.round(80 + 100 * pul)},30,${(.8 * g * (k > L.boom2 + .06 ? 1 - u(L.boom2 + .06, 1) : 1)).toFixed(2)})`; ctx.lineWidth = 3; // ground cracks
      for (let i = 0; i < 9; i++) { let a = i / 9 * TAU, x = cx, y = gy; ctx.beginPath(); ctx.moveTo(x, y); for (let j = 0; j < 5 * g; j++) { a += ((i * 7 + j * 3) % 5 - 2) * .22; x += Math.cos(a) * 60; y += Math.sin(a) * 18; ctx.lineTo(x, y); } ctx.stroke(); } ctx.restore(); }
    if (k >= L.draw && k < L.boom1 + .03) { // the devil star burns into the sky around a portal; hellfire pours out of it as a vortex
      const pr = u(L.draw, L.draw + .08), sx = cx, sy = b.y - 290, chg = u(L.fire, L.boom1), rr = 70 + 40 * chg, out = k > L.boom1 ? 1 - u(L.boom1, L.boom1 + .03) : 1;
      hellPortal(sx, sy, rr * pr, T, out); hellPent(sx, sy, rr, T * .8, out, pr, u(L.fire, L.boom1));
      if (k > L.fire) { const f = easeOut(u(L.fire, L.fire + .03)), w = 8 + 90 * chg * chg; // charging: a thread of fire that swells into a torrent
        vortexBeam(cx, sy, sy + (gy - sy) * f, w, T, out);
        if (f >= 1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(cx, gy, w * 4, 'rgba(255,120,40,.85)', out * (.3 + .7 * chg)); for (let j = 0; j < 3; j++) { const rr2 = ((T * 1.6 + j / 3) % 1); ctx.strokeStyle = `rgba(255,${Math.round(180 - rr2 * 120)},60,${((1 - rr2) * .8 * out).toFixed(2)})`; ctx.lineWidth = 6 * (1 - rr2) + 1; ctx.beginPath(); ctx.ellipse(cx, gy, 60 + rr2 * 360, (60 + rr2 * 360) * .26, 0, 0, TAU); ctx.stroke(); } ctx.restore();
          for (let j = 0; j < 12; j++) { const a = j / 12 * TAU, r2 = 50 + (j % 3) * 30 + chg * 60; flame(cx + Math.cos(a) * r2, gy + Math.sin(a) * r2 * .26, 10 + 16 * chg, (30 + (j % 4) * 40) * (.3 + chg), T + j, out); } } } }
    if (k >= L.algol && k < L.spin) { // five demon eyes spawn one by one round her, orbit, and fire crackling lasers point to point, then into her
      const hot = u(L.algol + .1, L.vert), fade = 1 - u(L.vert + .05, L.spin), R = 280, rot = T * .35 * (1 + hot * 2), order = [0, 2, 4, 1, 3, 0];
      const born = (i) => L.algol + i * .015, pts = [0, 1, 2, 3, 4].map((i) => { const [x, y] = PENT(R, rot, i); return [cx + x, cy + y * .9]; });
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(cx, cy, (100 + hot * 220) * fade, 'rgba(255,220,190,.9)'); ctx.restore();
      for (let i = 0; i < 5; i++) { const go = u(born(i) + .015, born(i) + .05); if (go <= 0) continue; const [x0, y0] = pts[order[i]], [x1, y1] = pts[order[i + 1]]; crackBeam(x0, y0, lerp(x0, x1, easeOut(go)), lerp(y0, y1, easeOut(go)), (2 + 18 * u(born(i) + .015, L.vert) ** 1.5) * (Math.random() < .08 ? .4 : 1), fade); }
      if (k > L.algol + .1) for (const [x, y] of pts) crackBeam(x, y, lerp(x, cx, u(L.algol + .1, L.algol + .13)), lerp(y, cy, u(L.algol + .1, L.algol + .13)), 2 + hot * 13, fade);
      for (let i = 0; i < 5; i++) { const sp = u(born(i), born(i) + .02); if (sp <= 0) continue; const [x, y] = pts[i]; // the eyes
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (sp < 1) glow(x, y, 120 * (1 - sp) + 20, 'rgba(255,255,255,1)'); glow(x, y, 46 + hot * 20, 'rgba(255,40,10,.8)', fade); ctx.restore();
        ctx.save(); ctx.globalAlpha = fade; ctx.translate(x, y); ctx.fillStyle = '#1a0000'; ctx.beginPath(); ctx.ellipse(0, 0, 22 * sp, 13 * sp, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#ff3a10'; ctx.beginPath(); ctx.ellipse(0, 0, 5 * sp, 12 * sp, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#ff9a50'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 22 * sp, 13 * sp, 0, 0, TAU); ctx.stroke(); ctx.restore(); } }
    if (k >= L.vert - .04 && k < L.spin + .02) { // the sky splits open, then the beam crashes down through her
      const crack = u(L.vert - .04, L.vert), f = easeOut(u(L.vert, L.vert + .02)), vch = u(L.vert, L.spin - .02), fade = 1 - u(L.spin - .03, L.spin + .02), skyY = 60;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,200,160,${(fade).toFixed(2)})`; ctx.lineWidth = 3 + crack * 8; ctx.beginPath(); let px = cx, py = skyY - 120; ctx.moveTo(px, py); for (let j = 0; j < 6; j++) { px = cx + ((j * 37) % 5 - 2) * 14 * crack; py += 28; ctx.lineTo(px, py); } ctx.stroke(); glow(cx, skyY, 160 * crack * fade, 'rgba(255,90,40,.8)'); ctx.restore();
      if (k >= L.vert) { vortexBeam(cx, skyY - 100, lerp(skyY - 100, gy + 10, f), (6 + 58 * vch * vch + Math.sin(fx.clock * 60) * 3 * vch) * fade, T * 1.4, fade); // a pilot thread that swells
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(cx, gy, 220 * fade, 'rgba(255,140,70,.9)'); for (let j = 0; j < 3; j++) { const rr2 = ((T * 2.2 + j / 3) % 1); ctx.strokeStyle = `rgba(255,220,180,${((1 - rr2) * fade).toFixed(2)})`; ctx.lineWidth = 8 * (1 - rr2) + 1; ctx.beginPath(); ctx.ellipse(cx, gy, 40 + rr2 * 520, (40 + rr2 * 520) * .25, 0, 0, TAU); ctx.stroke(); } ctx.restore();
        for (let i = 0; i < 8; i++) flame(cx + (i - 3.5) * 46, gy, 8 + 14 * vch, (30 + 110 * vch) * fade + (i % 3) * 30 * vch, T * 1.3 + i, fade);
        if (!reducedMotion && Math.random() < .6) fx.particles.push({ x: cx + (Math.random() - .5) * 120, y: gy, vx: (Math.random() - .5) * 900, vy: -300 - Math.random() * 600, life: .9, max: .9, size: 4 + Math.random() * 4, color: '#2a1410', grav: 1400 }); } }
    if (k >= L.spin && k < L.boom2) { const f = u(L.spin, L.boom2), shk = f * f * 14, R = 80 + f * 70; // the second devil star spins up and overcharges
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(cx, cy, R * (2 + f * 2.5), `rgba(255,${Math.round(40 + f * 180)},${Math.round(20 + f * 160)},${(.4 + f * .5).toFixed(2)})`); ctx.restore();
      for (let j = Math.min(6, Math.floor(c.w / 3)); j >= 0; j--) hellPent(cx + (Math.random() - .5) * shk, cy + (Math.random() - .5) * shk, R, c.rot - j * .07, j ? .22 : 1, 1, f);
      if (f > .45) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,240,220,.85)'; ctx.lineWidth = 2; for (let i = 0; i < 4 + f * 10; i++) { let a = Math.random() * TAU, x = cx, y = cy; ctx.beginPath(); ctx.moveTo(x, y); for (let j = 0; j < 5; j++) { a += (Math.random() - .5) * .9; x += Math.cos(a) * R * .45; y += Math.sin(a) * R * .45; ctx.lineTo(x, y); } ctx.stroke(); } ctx.restore(); }
      if (f > .8 && Math.floor(fx.clock * 20) % 2) { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(-500, -300, W + 1000, H + 600); } }
    if (k >= L.boom2) { const e = u(L.boom2, 1), o = easeOut(e); ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (e < .25) glow(cx, cy, 1200 * (1 - e * 3), 'rgba(255,230,200,1)'); glow(cx, cy, 300 + o * 500, 'rgba(255,40,20,.6)', 1 - e); ctx.restore(); // the blow-out
      hellPent(cx, cy, 140 + o * 700, o * 2, 1 - e, 1, 1 - e);
      ctx.save(); ctx.translate(cx, gy); ctx.scale(1, .32); hellPent(0, 0, 260, 0, (1 - e) * .9, 1, 0); ctx.restore(); // scorched into the ground
      for (let i = 0; i < 5; i++) flame(cx + (i - 2) * 90, gy, 30, 160 * (1 - e), T + i, 1 - e); }
    drawHero(s, s.hero.x, s.hero.y);
  }
  // MAGEN DAVID finisher: the Shield of David soaks up her shots, charges, and is rammed into her
  function drawMagen(s, c, k) {
    const M = MAGEN, h = s.hero, b = s.boss, u = (a, b2) => clamp((k - a) / (b2 - a), 0, 1), col = P[form(s)].hero, pal = P[form(s)];
    const sx = h.x + 115, sy = h.y - 105, ch = k < M.charge ? c.absorbed / M.n : 1, R = 98 * easeOut(u(0, .1)) * (1 + ch * .15);
    ctx.fillStyle = `rgba(0,4,20,${(.35 * u(0, .1)).toFixed(2)})`; ctx.fillRect(-500, -300, W + 1000, H + 600);
    // her shots, flying into the shield
    for (const o of c.orbs) { if (!o || o.hit) continue; const f = clamp(o.t / M.fly, 0, 1), x = lerp(b.x - 60, sx, f), y = lerp(o.y0, sy, f) - Math.sin(f * Math.PI) * 40;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(x, y, 34, pal.orb); ctx.restore(); ctx.fillStyle = pal.orbCore; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill(); }
    if (k < M.dash[1]) {
      const spin = k > M.charge ? (k - M.charge) * c.len * 14 : Math.sin(fx.clock * 2) * .08, pulse = k > M.charge ? 1 + Math.sin(fx.clock * 40) * .05 : 1;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(sx, sy, R * (1.5 + ch), `rgba(150,200,255,${(.25 + ch * .55).toFixed(2)})`); if (k > M.charge) glow(sx, sy, R * .7, 'rgba(255,255,255,.9)'); ctx.restore();
      ctx.save(); ctx.globalAlpha = .55; ctx.fillStyle = '#0a1a40'; ctx.beginPath(); ctx.arc(sx, sy, R * 1.02 * pulse, 0, TAU); ctx.fill(); ctx.restore(); // the shield's face
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4 + ch * 4; ctx.beginPath(); ctx.arc(sx, sy, R * 1.04 * pulse, 0, TAU); ctx.stroke();
      davidStar(sx, sy, R * .92 * pulse, spin, col, 1, 0);
      if (ch > .45) for (let i = 0; i < 2 + ch * 4; i++) { const a0 = Math.random() * TAU, a1 = a0 + .6 + Math.random(); crackBeam(sx + Math.cos(a0) * R, sy + Math.sin(a0) * R, sx + Math.cos(a1) * R * 1.15, sy + Math.sin(a1) * R * 1.15, 1.5 + ch * 2, .8, 'blue'); } // it's full: lightning crawls over it
      if (k > M.dash[0]) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 1; i <= 4; i++) glow(sx - i * 50, sy, R * .8, 'rgba(160,200,255,.25)', 1 - i / 5); ctx.restore(); } // the charge streak
      drawHero(s, h.x, h.y);
    } else { // the slam: the star punches through her, a ground shockwave rolls out both ways
      const e = u(M.dash[1], 1), o = easeOut(e), gy = b.y + 30;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (e < .2) glow(b.x - 80, b.y - 120, 700 * (1 - e * 4), 'rgba(255,255,255,1)');
      ctx.fillStyle = `rgba(255,255,255,${(.8 * (1 - e)).toFixed(2)})`; ctx.fillRect(-500, b.y - 128 - 8 * (1 - e), W + 1000, 16 * (1 - e) + 2); // the shock line
      hexagram(b.x, gy, 80 + o * 640, o * .6, 1, '#ffffff', 6, .3, 1 - e); hexagram(b.x, gy, 60 + o * 420, -o, 1, 'rgba(120,170,255,1)', 4, .3, (1 - e) * .8);
      ctx.restore();
      endShield(b.x - 40, b.y - 120, 130 + o * 120, o * 1.5, 1 - e);               // the shield, driven into her
      davidStar(b.x + 120 + o * 500, b.y - 120, 90 * (1 - e * .5), o * 6, '#ffffff', (1 - e) * .8, 0); // its star, out of her back
      drawHero(s, h.x, h.y);
      endShield(h.x + 115, h.y - 105, 62, 0, 1); // he keeps the shield
    }
  }
  // STAR CAGE finisher: the two triangles slam together round her, crush, shatter
  function oneTri(x, y, r, rot, off, a = 1) {
    if (a <= 0 || r <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(rot); ctx.lineJoin = 'miter'; ctx.miterLimit = 3; const band = Math.max(3, r * .12);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = band + 6; triPath(r, off); ctx.stroke(); ctx.strokeStyle = FLAG_BLUE; ctx.lineWidth = band; triPath(r, off); ctx.stroke(); ctx.restore();
  }
  function drawCage(s, c, k) {
    const C = CAGE, b = s.boss, u = (a, b2) => clamp((k - a) / (b2 - a), 0, 1), cx = b.x, cy = b.y - 120, R0 = 290;
    ctx.fillStyle = `rgba(0,4,20,${(.35 * u(0, .1)).toFixed(2)})`; ctx.fillRect(-500, -300, W + 1000, H + 600);
    if (k < C.lock) { // flying in: up-triangle from the left, down-triangle from the right, spinning to a stop
      const f = u(C.fly[0], C.fly[1]), e = f * f * f, d = (1 - e) * 1200, rot = (1 - e) * 7;
      for (let i = 3; i >= 0; i--) { const dd = d + i * 70 * (1 - e), a = i ? .18 * (1 - i / 4) : 1;
        oneTri(cx - dd, cy, R0, rot + i * .1, -Math.PI / 2, a); oneTri(cx + dd, cy, R0, -rot - i * .1, Math.PI / 2, a); }
    } else if (k < C.shatter) { // locked: the cage, crushing in three squeezes, cracking white-hot
      const sq = c.squeeze + (c.squeeze < 3 ? 0 : u(C.squeeze[2], C.shatter) * .3), R = R0 - sq * 48, shake = (k > C.squeeze[2] ? 6 : 2) * Math.sin(fx.clock * 60);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(cx, cy, R * 1.6, `rgba(150,190,255,${(.2 + sq * .15).toFixed(2)})`); glow(cx, cy, 60 + sq * 50, 'rgba(255,255,255,.9)'); ctx.restore();
      oneTri(cx + shake, cy, R, 0, -Math.PI / 2); oneTri(cx - shake, cy, R, 0, Math.PI / 2);
      for (let i = 0; i < 6; i++) if (Math.random() < .35 + sq * .2) { const a0 = -Math.PI / 2 + i * Math.PI / 3, a1 = a0 + Math.PI / 3; crackBeam(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, 2 + sq, .8, 'blue'); } // arcs crawl round the cage
      ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.globalAlpha = .9; // the cracks
      for (let i = 0; i < c.squeeze * 4; i++) { let a = i * 2.39, x = cx + Math.cos(a) * R * .2, y = cy + Math.sin(a) * R * .2; ctx.beginPath(); ctx.moveTo(x, y);
        for (let j = 0; j < 4; j++) { a += ((i * 7 + j * 3) % 5 - 2) * .25; x += Math.cos(a) * R * .2; y += Math.sin(a) * R * .2; ctx.lineTo(x, y); } ctx.stroke(); }
      ctx.restore();
    } else { // shattered: shards of the star flung out spinning
      const e = u(C.shatter, 1), o = easeOut(e), R = R0 - 3 * 48;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (e < .2) glow(cx, cy, 800 * (1 - e * 4), 'rgba(255,255,255,1)'); glow(cx, cy, 200 + o * 300, 'rgba(170,240,255,.5)', 1 - e); ctx.restore();
      for (let i = 0; i < 30; i++) { const a = i * 2.399, d = R * .4 + o * (170 + (i * 67) % 360), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * .85 + e * e * 260, r = 26 + (i * 13) % 34;
        ctx.save(); ctx.globalAlpha = 1 - e * e; ctx.translate(x, y); ctx.rotate(i + o * (6 + i % 5)); ctx.fillStyle = ['#bff4ff', FLAG_BLUE, '#e8fbff'][i % 3]; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * .8, r * .6); ctx.lineTo(-r * .7, r * .5); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#7fd8ff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
    }
    drawHero(s, s.hero.x, s.hero.y);
  }
  // DAVID LASER finisher: six of him on the six points, lasers into her, lasers across into the star, spin-up, blow
  function laser(x0, y0, x1, y1, w, a = 1) { // a flag-blue beam on a white-hot core, with a soft glow
    if (w <= 0 || a <= 0) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.globalAlpha = a;
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(90,140,255,.35)'; ctx.lineWidth = w * 3.2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = '#0038b8'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, w * .38); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }
  function drawDavidLaser(s, c, k) {
    const L = DLASER[c.v], u = (a, b) => clamp((k - a) / (b - a), 0, 1), cx = c.cx, cy = c.cy, pts = [0, 1, 2, 3, 4, 5].map((i) => dlPoint(c, i));
    const shown = k < L.tp ? c.hits : 6, pre = k < L.boom, fl = 1 + Math.sin(fx.clock * 50) * .12; // laser flicker
    ctx.fillStyle = `rgba(0,4,20,${(.3 * u(0, .1) + .25 * u(L.spin, L.boom)).toFixed(2)})`; ctx.fillRect(-500, -300, W + 1000, H + 600);
    if (pre) {
      // the six points: a blink flash where he lands, then his echo holds the point
      for (let i = 0; i < shown; i++) {
        const [x, y] = pts[i], born = (i + .5) / 6 * L.tp, age = (k - born) * c.len;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(x, y, 46 + (age < .2 ? (1 - age / .2) * 80 : 0), 'rgba(160,200,255,.7)'); ctx.restore();
        if (age < .25) davidStar(x, y, 20 + age * 260, age * 9, '#ffffff', 1 - age / .25, 0);
        const last = i === Math.min(5, c.hits - 1) && k < L.tp;
        drawHero(s, x, y + 60, last ? 1 : .85, x < cx ? 1 : -1, !last);
      }
      // all six fire into her at once
      if (k >= L.fire) {
        const g = easeOut(u(L.fire, L.fire + .03)), fade = 1 - u(L.spin - .02, L.spin + .04);
        const pow = u(L.fire, L.boom), bw = (9 + pow * 14) * fl * fade; // the beams fatten as it charges
        for (const [x, y] of pts) crackBeam(x, y - 8, lerp(x, cx, g), lerp(y - 8, cy, g), bw, fade, 'blue');
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(cx, cy, (80 + 70 * g + pow * 120) * fl * (.4 + fade * .6), 'rgba(255,255,255,.9)'); ctx.restore();
        if (L.link > 1 && g >= 1) { // DAVID LASER: where the six beams meet, the sign burns into her and grows
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; hexagram(cx, cy, 70 + pow * 150, fx.clock * (1 + pow * 4), 1, 'rgba(120,170,255,1)', 10, 1, .5 + pow * .5); ctx.restore();
          davidStar(cx, cy, 60 + pow * 150, -fx.clock * (1 + pow * 3), P[form(s)].hero, 1, 0);
          if (!reducedMotion && Math.random() < .5 + pow) part(cx, cy, 2, '#ffffff', 500 + pow * 400, .4, 3, 0);
        }
      }
      // then across: each point fires at the points two along, which draws both triangles = the star
      if (k >= L.link) {
        const g = easeOut(u(L.link, L.link + .05)), w = (8 + 10 * u(L.spin, L.boom)) * fl;
        const spinning = k > L.spin ? Math.min(5, Math.floor(c.w / 7)) : 0;
        for (let j = spinning; j >= 0; j--) { // motion-blur copies once it spins fast
          const back = j * .05, alpha = j ? .22 * (1 - j / 6) : 1, rp = (i) => dlPoint({ ...c, rot: c.rot - back }, i);
          for (let i = 0; i < 6; i++) { const [x0, y0] = rp(i), [x1, y1] = rp((i + 2) % 6); if (j) laser(x0, y0, lerp(x0, x1, g), lerp(y0, y1, g), w * .7, alpha); else crackBeam(x0, y0, lerp(x0, x1, g), lerp(y0, y1, g), w, alpha, 'blue'); }
        }
        if (k > L.spin) { // the spin-up: a halo ring, the core heating white, sparks thrown off the points
          const sp = u(L.spin, L.boom);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          glow(cx, cy, c.R * (.5 + sp * .9), `rgba(150,190,255,${(.25 + sp * .5).toFixed(2)})`); glow(cx, cy, 40 + sp * 140, 'rgba(255,255,255,.95)');
          ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2 + sp * 6; ctx.beginPath(); ctx.ellipse(cx, cy, c.R * 1.04, c.R * .86, 0, 0, TAU); ctx.stroke();
          ctx.restore();
          if (!reducedMotion && Math.random() < .3 + sp) for (const [x, y] of pts) { const a = Math.atan2(y - cy, x - cx) + Math.PI / 2; fx.particles.push({ x, y, vx: Math.cos(a) * c.w * 22 + (x - cx) * 2, vy: Math.sin(a) * c.w * 22 + (y - cy) * 2, life: .35, max: .35, size: 3, color: '#cfe0ff', grav: 0 }); }
        }
      }
      // his echoes ride the spinning points (drawn over the beams)
      if (k >= L.spin) for (let i = 0; i < 6; i++) { const [x, y] = pts[i]; drawHero(s, x, y + 60, i === 5 ? 1 : .8, x < cx ? 1 : -1, i !== 5); }
    } else {
      const e = u(L.boom, 1), o = easeOut(e), gy = s.boss.y + 30;
      if (c.v === 4) { // DAVID LASER: the original blow-up: a white-out core, a hollow star shockwave, six stars flung out, a star burned flat into the ground
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        if (e < .25) glow(cx, cy, 900 * (1 - e * 3), 'rgba(255,255,255,1)');
        glow(cx, cy, 160 + o * 260, 'rgba(120,170,255,.6)', 1 - e); glow(cx, cy, 90 + o * 140, 'rgba(255,224,138,.45)', 1 - e);
        ctx.restore();
        davidStar(cx, cy, 60 + o * 480, o * 1.2, P[form(s)].hero, (1 - e) * .95, 0);
        davidStar(cx, cy, 40 + o * 380, -o * 2, '#ffffff', (1 - e) * .8, 0);
        for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3, d = 40 + o * 760; davidStar(cx + Math.cos(a) * d, cy + Math.sin(a) * d * .82, 34 * (1 - e * .5), e * 14 + i, P[form(s)].hero, 1 - e, 0, 'rgba(255,224,138,.5)'); }
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; hexagram(s.boss.x, gy, 120 + o * 420, o * .8, 1, '#ffffff', 6, .34, 1 - e); hexagram(s.boss.x, gy, 90 + o * 300, -o, 1, 'rgba(255,224,138,1)', 4, .34, (1 - e) * .8); ctx.restore();
      } else { // SPINNING STAR: the six points break off as spinning blades, fly out, boomerang back into her and detonate
        const out = easeOut(clamp(e / .45, 0, 1)), back = clamp((e - .45) / .27, 0, 1), d = e < .45 ? 60 + out * 520 : 580 * (1 - back * back), spin = e * 9;
        if (e < .72) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 6; i++) for (let j = 1; j <= 5; j++) { const a = -Math.PI / 2 + i * Math.PI / 3 + spin - j * .06, dd = Math.max(0, d - j * (e < .45 ? 10 : -14)); glow(cx + Math.cos(a) * dd, cy + Math.sin(a) * dd * .82, 18, 'rgba(127,232,255,.5)', 1 - j / 6); }
          if (e > .45) glow(cx, cy, 60 + back * 160, 'rgba(255,255,255,.8)');
          ctx.restore();
          for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3 + spin, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * .82;
            ctx.save(); ctx.translate(x, y); ctx.rotate(c.t * 24 + i); ctx.fillStyle = '#e8fbff'; ctx.strokeStyle = FLAG_BLUE; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(24, 20); ctx.lineTo(-24, 20); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
        } else { const f = (e - .72) / .28, of = easeOut(f); ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (f < .2) glow(cx, cy, 900 * (1 - f * 4), 'rgba(220,250,255,1)'); glow(cx, cy, 200 + of * 300, 'rgba(127,232,255,.5)', 1 - f); hexagram(cx, cy, 80 + of * 520, of * 3, 1, '#7fe8ff', 7, 1, 1 - f); hexagram(cx, cy, 60 + of * 340, -of * 4, 1, '#ffffff', 4, 1, 1 - f); ctx.restore(); }
      }
      drawHero(s, s.hero.x, s.hero.y);
    }
  }
  // SUKKAH finisher (P13: built AROUND her). The back wall, side walls and back poles are drawn before the boss so she
  // stands inside the hut; the front poles, beams, roof, fruit and the bombs after her.
  const SK = { reed: '#c9a66b', reedDark: '#b48e55', weave: 'rgba(90,60,30,.55)', pole: '#7a5530', beam: '#6a4a26', leaf: '#3f7a34', leaf2: '#5ea24a' };
  const skU = (k, a, b) => clamp((k - a) / (b - a), 0, 1);
  function skPole(x0, y0, len, p, w = 12) { if (p <= 0) return; ctx.fillStyle = SK.pole; ctx.fillRect(x0 - w / 2, y0 - len * p, w, len * p); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x0 + w / 2 - 4, y0 - len * p, 4, len * p); }
  function skPanel(pts, p) { // a woven reed panel, unrolled from its top edge by p (pts: top-left, top-right, bottom-right, bottom-left)
    if (p <= 0) return; const [a, b, c2, d] = pts, bl = [lerp(a[0], d[0], p), lerp(a[1], d[1], p)], br = [lerp(b[0], c2[0], p), lerp(b[1], c2[1], p)];
    ctx.fillStyle = SK.reed; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(br[0], br[1]); ctx.lineTo(bl[0], bl[1]); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.clip(); ctx.strokeStyle = SK.weave; ctx.lineWidth = 2; for (let i = 1; i < 40; i++) { const f = i / 40; if (f > p) break; ctx.beginPath(); ctx.moveTo(lerp(a[0], d[0], f), lerp(a[1], d[1], f)); ctx.lineTo(lerp(b[0], c2[0], f), lerp(b[1], c2[1], f)); ctx.stroke(); } ctx.restore();
    ctx.fillStyle = SK.reedDark; ctx.fillRect(Math.min(bl[0], br[0]), Math.min(bl[1], br[1]) - 3, Math.abs(br[0] - bl[0]) || 3, 6); // the rolled edge
  }
  function drawSukkahBack(s) {
    const c = s.finisher.cine; if (!c || c.v !== 3) return; const k = c.t / c.len; if (k >= SUKKAH.big) return;
    const G = sukkahGeom(s.boss), bt = G.top - 22, by = G.gy + G.back, w = easeOut(skU(k, SUKKAH.walls[0], SUKKAH.walls[1])), bm = skU(k, SUKKAH.beams[0], SUKKAH.beams[1]);
    ctx.save();
    skPanel([[G.x - G.bw, bt], [G.x + G.bw, bt], [G.x + G.bw, by], [G.x - G.bw, by]], w);                                              // back wall
    ctx.globalAlpha = .92; skPanel([[G.x - G.fw, G.top], [G.x - G.bw, bt], [G.x - G.bw, by], [G.x - G.fw, G.gy]], w);                       // side walls
    skPanel([[G.x + G.bw, bt], [G.x + G.fw, G.top], [G.x + G.fw, G.gy], [G.x + G.bw, by]], w); ctx.globalAlpha = 1;
    skPole(G.poles[0][0], by, G.poleH(0), c.pole[0]); skPole(G.poles[3][0], by, G.poleH(3), c.pole[3]);
    ctx.strokeStyle = SK.beam; ctx.lineWidth = 8; ctx.lineCap = 'round';
    if (bm > 0) { ctx.beginPath(); ctx.moveTo(G.x - G.bw, bt); ctx.lineTo(lerp(G.x - G.bw, G.x + G.bw, bm), bt); ctx.stroke(); // back + side beams
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(G.x + sd * G.bw, bt); ctx.lineTo(lerp(G.x + sd * G.bw, G.x + sd * G.fw, bm), lerp(bt, G.top, bm)); ctx.stroke(); } }
    ctx.restore();
  }
  function drawSukkahFront(s, c, k) {
    const S = SUKKAH, G = sukkahGeom(s.boss), b = s.boss, col = P[form(s)].hero;
    if (k < S.big) {
      const bm = skU(k, S.beams[0], S.beams[1]), deco = skU(k, S.deco[0], S.deco[1]);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (c.built) glow(G.x, G.gy - 160, 340, 'rgba(255,200,120,.18)'); ctx.restore();
      skPole(G.poles[1][0], G.gy, G.poleH(1), c.pole[1], 14); skPole(G.poles[2][0], G.gy, G.poleH(2), c.pole[2], 14);
      if (bm > 0) { ctx.strokeStyle = SK.beam; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(G.x - G.fw, G.top); ctx.lineTo(lerp(G.x - G.fw, G.x + G.fw, bm), G.top); ctx.stroke(); }
      // the roof: branches he throws up, laid front to back, each with its leaves
      const span = 2 * G.fw, nb = S.branches, bx = (j) => G.x - G.fw + (j + .5) * span / nb;
      const branch = (x, y, rot, a = 1) => { ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = SK.beam; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-34, 8); ctx.lineTo(34, -8); ctx.stroke();
        for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? SK.leaf2 : SK.leaf; ctx.beginPath(); ctx.ellipse(-30 + i * 12, -4 + (i % 3) * 5 - 6, 14, 6, (i % 3 - 1) * .5, 0, TAU); ctx.fill(); } ctx.restore(); };
      for (let j = 0; j < c.branches; j++) branch(bx(j), G.top - 14 - (j % 2) * 6, -.12 + (j % 3) * .08);
      if (k >= S.roof[0] && k < S.roof[1] && c.branches < nb) { // the one in the air: an arc from his hands to its place
        const f = skU(k, S.roof[0], S.roof[1]) * nb - c.branches, tx = bx(c.branches), ty = G.top - 14, hx = s.hero.x, hy = s.hero.y - 90;
        branch(lerp(hx, tx, f), lerp(hy, ty, f) - Math.sin(f * Math.PI) * 170, f * 7);
      }
      if (deco > 0) { const cols = ['#ffcf3a', '#e8483a', '#9fd65a', '#ffffff', '#ff9a3a']; for (let i = 0; i < 9; i++) { const dx = G.x - G.fw + 40 + i * (span - 80) / 8, len = (22 + (i % 3) * 14) * easeOut(deco); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(dx, G.top + 4); ctx.lineTo(dx, G.top + 4 + len); ctx.stroke(); ctx.fillStyle = cols[i % 5]; ctx.beginPath(); ctx.arc(dx, G.top + 8 + len, 6, 0, TAU); ctx.fill(); } }
      // the bombs: Stars of David dropping out of the sky onto the hut, a light streak behind each
      for (const q of c.bombs) { if (!q || q.hit) continue; const f = clamp(q.t / S.fall, 0, 1), y = lerp(-320, q.ty, f * f);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createLinearGradient(0, y - 220, 0, y); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(200,220,255,.8)'); ctx.fillStyle = g; ctx.fillRect(q.x - 6, y - 220, 12, 220); ctx.restore();
        goldStar(q.x, y, 36, q.t * 6, 1); }
      if (k > S.big - .07) { const f = skU(k, S.big - .07, S.big), y = lerp(-500, b.y - 60, f * f); // the giant one
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(G.x, y, 240, 'rgba(255,255,255,.7)'); ctx.fillStyle = 'rgba(200,220,255,.35)'; ctx.fillRect(G.x - 40, y - 600, 80, 600); ctx.restore();
        goldStar(G.x, y, 110, f * 4, 1); }
    } else { // blown apart: poles spin away, branches and reed scraps fly, everything fades
      const e = skU(k, S.big, 1), o = easeOut(e);
      ctx.save(); ctx.globalAlpha = 1 - e;
      G.poles.forEach(([px, py], i) => { ctx.save(); const dx = px - G.x; ctx.translate(px + dx * o * 2.2, py - 140 - o * 260 + e * e * 300); ctx.rotate((i % 2 ? 1 : -1) * o * 6); ctx.fillStyle = SK.pole; ctx.fillRect(-6, -150, 12, 300); ctx.restore(); });
      for (let i = 0; i < 26; i++) { const a = -Math.PI / 2 + (i / 26 - .5) * 3, d = o * (300 + (i * 53 % 260)); ctx.save(); ctx.translate(G.x + Math.cos(a) * d, G.top + 80 + Math.sin(a) * d + e * e * 400); ctx.rotate(i + o * 9);
        if (i % 3) { ctx.fillStyle = i % 2 ? SK.leaf : SK.leaf2; ctx.beginPath(); ctx.ellipse(0, 0, 16, 7, 0, 0, TAU); ctx.fill(); } else { ctx.fillStyle = SK.reed; ctx.fillRect(-22, -12, 44, 24); } ctx.restore(); }
      ctx.restore();
    }
  }
  function letterbox(k) { const bar = easeOut(clamp(k, 0, 1)) * 74; ctx.fillStyle = '#000'; ctx.fillRect(-500, -300, W + 1000, 300 + bar); ctx.fillRect(-500, H - bar, W + 1000, bar + 300); }
  function drawFinisherScreen(s) {
    const c = s.finisher.cine; if (!c) return;
    const k = c.t / c.len;
    letterbox(k * 5);
    drawSlashes();
    if (k < 0.3) { ctx.save(); ctx.globalAlpha = Math.min(1, k * 8) * (1 - Math.max(0, (k - 0.22) * 12)); const sc = reducedMotion ? 1 : lerp(1.25, 1, easeOut(k * 6));
      ctx.translate(640, 140); ctx.scale(sc, sc); text(c.name, 0, 0, 66, c.v === HELL ? '#ff3b3b' : '#ffffff'); if (c.sub) text(c.sub, 0, 40, 22, '#9fc0ff', 'center', true, 700); ctx.restore(); }
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
    const hx = h.x + 34, hy = h.y - 62, bx = b.x - 30, by = b.y - 125;
    const sway = c.t > 1.3 && !c.won && !reducedMotion ? Math.sin(c.t * 2.1) * (.05 + c.p * .04) + Math.sin(c.t * 5.3) * .02 : 0; // owner: it swings toward both as they struggle
    let p = c.won ? (c.sword && c.wonT < .55 ? .95 : lerp(.95, 1.25, easeOut((c.wonT - (c.sword ? .55 : 0)) / 0.35))) : clamp(c.p + sway, .05, .98);
    if (c.struggle) { // the seam swings toward each of them, wider and wider, then the hero wins it back
      const g = c.struggle, swing = .52 + Math.sin(g.t * 2.7) * (.22 + g.t * .05);
      p = lerp(swing, .95, clamp((g.t - g.len + .55) / .55, 0, 1));
    }
    const sxp = lerp(hx, bx, p), syp = lerp(hy, by, p), pw = c.t < 1.3 ? easeOut(c.t / 1.3) : 1;
    return { hx, hy, bx, by, sxp, syp, pw, p };
  }
  function drawClashWorld(s) {
    const c = s.clash; if (!c) return;
    const f = form(s), pal = P[f], g = clashGeom(s);
    const heroCol = pal.hero, bossCol = f === 3 ? '#ff3b5c' : pal.boss;
    // two domains split at the seam: the hero's sky of rings vs the boss's eclipse sigil
    ctx.save();
    const bulge = (g.p - .5) * 220, wallX = (yy) => g.sxp + bulge * Math.max(0, 1 - ((yy - g.syp) / 520) ** 2) * .6 + Math.sin(yy * .02 + fx.clock * 9) * 10 - bulge * .6;
    const wallPath = (edge) => { ctx.beginPath(); ctx.moveTo(edge, -300); for (let i = 0; i <= 24; i++) { const yy = -300 + i * 55; ctx.lineTo(wallX(yy), yy); } ctx.lineTo(edge, H + 300); ctx.closePath(); };
    wallPath(-500); ctx.clip();
    ctx.fillStyle = f === 3 ? 'rgba(10,40,48,.55)' : f === 2 ? 'rgba(60,44,10,.45)' : 'rgba(6,40,46,.5)'; ctx.fillRect(-120, -100, W + 240, H + 200); // just past what the clash camera can see
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = heroCol; ctx.translate(s.hero.x, s.hero.y - 70);
    for (let i = 0; i < 6; i++) { ctx.globalAlpha = 0.18 + (i % 2) * 0.12; ctx.lineWidth = 2; ctx.save(); ctx.rotate(fx.clock * (i % 2 ? 0.6 : -0.4)); ctx.setLineDash([30 + i * 8, 18]); ctx.beginPath(); ctx.arc(0, 0, 80 + i * 70, 0, TAU); ctx.stroke(); ctx.restore(); }
    ctx.restore(); ctx.restore();
    ctx.save();
    wallPath(W + 500); ctx.clip();
    ctx.fillStyle = f === 3 ? 'rgba(0,0,0,.6)' : 'rgba(40,4,2,.55)'; ctx.fillRect(-120, -100, W + 240, H + 200);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(s.boss.x, s.boss.y - 110); ctx.strokeStyle = bossCol;
    ctx.rotate(-fx.clock * 0.3); ctx.globalAlpha = 0.4; ctx.lineWidth = 3;
    for (const r of [200, 260, 380]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
    for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i / 12 * TAU); ctx.beginPath(); ctx.moveTo(200, -10); ctx.lineTo(258, 0); ctx.lineTo(200, 10); ctx.stroke(); ctx.fillStyle = bossCol; ctx.fillRect(300, -2, 50, 4); ctx.restore(); }
    ctx.restore(); ctx.restore();
    // the wall between the two domains glows; debris is pushed off it toward the weaker side
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
    for (const [w, col] of [[26, 'rgba(255,255,255,.08)'], [10, g.p > .5 ? heroCol : bossCol], [3, '#ffffff']]) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.globalAlpha = w === 10 ? .55 : 1; ctx.beginPath(); for (let i = 0; i <= 24; i++) { const yy = -300 + i * 55; i ? ctx.lineTo(wallX(yy), yy) : ctx.moveTo(wallX(yy), yy); } ctx.stroke(); }
    ctx.restore();
    if (g.pw >= 1 && fx.particles.length < P_MAX - 4 && Math.random() < .7) { const yy = 120 + Math.random() * 520, dir = g.p > .5 ? 1 : -1; fx.particles.push({ x: wallX(yy), y: yy, vx: dir * (160 + Math.random() * 240), vy: (Math.random() - .5) * 80, life: .6, max: .6, size: 3, color: '#d8c8b8', grav: 120 }); }
    // their domains on the floor, counter-rotating
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const hf = s.hero, bf = s.boss, flo = .36, grow = g.pw;
    for (const [r, a] of [[180, .5], [130, .35]]) { ctx.strokeStyle = heroCol; ctx.globalAlpha = a * grow; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(hf.x, hf.y, r * grow, r * flo * grow, 0, 0, TAU); ctx.stroke(); }
    hexagram(hf.x, hf.y, 150 * grow, fx.clock * .5, grow, heroCol, 3, flo, .9);
    for (const [r, a] of [[260, .5], [200, .35]]) { ctx.strokeStyle = bossCol; ctx.globalAlpha = a * grow; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(bf.x, bf.y + 25, r * grow, r * flo * grow, 0, 0, TAU); ctx.stroke(); }
    ctx.save(); ctx.translate(bf.x, bf.y + 25); ctx.scale(1, flo); ctx.rotate(-fx.clock * .4 + Math.PI); ctx.strokeStyle = bossCol; ctx.globalAlpha = .9; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.beginPath(); for (let i = 0; i <= 5; i++) { const an = -Math.PI / 2 + (i * 2 % 5) / 5 * TAU, rr = 210 * grow; i ? ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); } ctx.closePath(); ctx.stroke(); ctx.restore();
    ctx.restore();
    // beams grow from both fighters and meet at the seam
    const hEndX = lerp(g.hx, g.sxp, g.pw), hEndY = lerp(g.hy, g.syp, g.pw), bEndX = lerp(g.bx, g.sxp, g.pw), bEndY = lerp(g.by, g.syp, g.pw);
    const push = fx.clashPulse;
    beam(g.hx, g.hy, hEndX, hEndY, 22 + push * 8 + (c.kind - 1) * 4, heroCol, '#ffffff', 1);
    if (!c.won || c.wonT < (c.sword ? .6 : 0.3)) beam(g.bx, g.by, bEndX, bEndY, 24 + (c.kind - 1) * 5, bossCol, f === 3 ? '#000' : '#fff3e8', 1);
    glow(g.hx, g.hy, 50, 'rgba(255,255,255,.8)');
    if (c.sword && c.won && c.wonT < .58) { // he throws his sword along the beam; it catches her off guard
      const k = clamp(c.wonT / .55, 0, 1), x = lerp(s.hero.x + 10, g.bx + 10, easeOut(k)), y = lerp(s.hero.y - 70, g.by, easeOut(k)) - Math.sin(k * Math.PI) * 90;
      for (let i = 1; i <= 4; i++) { const kk = Math.max(0, k - i * .05); drawSword(lerp(s.hero.x + 10, g.bx + 10, easeOut(kk)), lerp(s.hero.y - 70, g.by, easeOut(kk)) - Math.sin(kk * Math.PI) * 90, kk * 30, .9, .25 / i); }
      drawSword(x, y, k * 30, .9, 1);
    }
    if (g.pw >= 1) {
      // the seam: a churning ball of both colours, lightning arcs, sparks
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const R = 60 + push * 14 + Math.sin(fx.clock * 30) * 6;
      glow(g.sxp, g.syp, R * 2.6, 'rgba(255,255,255,.45)'); glow(g.sxp - 20, g.syp, R * 1.4, heroCol.length === 7 ? heroCol + 'aa' : heroCol); glow(g.sxp + 20, g.syp, R * 1.4, bossCol + 'aa');
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(g.sxp, g.syp, R * 0.45, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over'; const sr = Math.min(64, 44 + push * 10); hexagram(g.sxp, g.syp, sr, fx.clock * .8, 1, '#05070a', 9); hexagram(g.sxp, g.syp, sr, fx.clock * .8, 1, '#ffe08a', 4); hexagram(g.sxp, g.syp, sr - 5, fx.clock * .8, 1, '#ffffff', 1.5); ctx.globalCompositeOperation = 'lighter';
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
    const title = ['', 'BEAM CLASH', 'FINAL BEAM CLASH', 'TOTALITY CLASH'][c.kind];
    { const left = 3 - (c.losses || 0); ctx.save(); text('TRIES', 1150, 100, 14, '#c8d0d6', 'right', true, 700); // P13: 3 losses reset the level
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i < left ? '#7fe0b0' : '#3a444c'; ctx.beginPath(); ctx.arc(1166 + i * 22, 95, 7, 0, TAU); ctx.fill(); } ctx.restore(); }
    if (c.line && c.t - c.line.at < 1.9) { // pushing dialogue: big, one at a time, next to whoever says it
      const a = c.t - c.line.at, k = clamp(a / .15, 0, 1) * (1 - clamp((a - 1.6) / .3, 0, 1)), hero = c.line.who === 'hero';
      const cx = 640 + ((hero ? s.hero.x + 60 : s.boss.x - 250) - 640 - fx.camX) * fx.zoom, cy = 360 + ((hero ? s.hero.y - 190 : s.boss.y - 250) - 360 - fx.camY) * fx.zoom;
      ctx.save(); ctx.globalAlpha = k; ctx.translate(clamp(cx, 220, 1060), clamp(cy, 200, 520)); const sc = reducedMotion ? 1 : lerp(1.35, 1, easeOutBack(clamp(a / .25, 0, 1))); ctx.scale(sc, sc);
      text(c.line.text, 0, 0, 38, hero ? heroCol : bossCol); ctx.restore();
    }
    if (c.t < 1.6) { ctx.save(); const k = c.t / 1.6; ctx.globalAlpha = Math.sin(clamp(k, 0, 1) * Math.PI); const sc = reducedMotion ? 1 : lerp(1.5, 1, easeOut(k * 2)); ctx.translate(640, 300); ctx.scale(sc, sc); text(title, 0, 0, 84, '#ffffff'); ctx.restore(); }
    // tug-of-war bar
    const x0 = 340, w = 600, y = 92, p = clamp(c.p, 0, 1);
    text(title, 640, y - 22, 22, '#ffffff');
    ctx.fillStyle = '#0b1014'; ctx.fillRect(x0 - 4, y - 4, w + 8, 26);
    ctx.fillStyle = bossCol; ctx.fillRect(x0, y, w, 18);
    ctx.fillStyle = heroCol; ctx.fillRect(x0, y, w * p, 18);
    ctx.fillStyle = '#0b1014'; for (const m of [0.65, 0.8, 0.9]) ctx.fillRect(x0 + w * m - 1.5, y - 4, 3, 26);
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 14; ctx.fillRect(x0 + w * p - 3, y - 8, 6, 34); ctx.shadowBlur = 0;
    // key moments still to come: gold notches above the bar (normal 3, hard 4)
    const KM = s.M.keyMoments >= 4 ? [.56, .67, .78, .89] : [.58, .72, .86];
    KM.forEach((m, i) => { const done = i < c.km; ctx.fillStyle = done ? 'rgba(255,224,138,.35)' : '#ffe08a'; ctx.beginPath(); ctx.moveTo(x0 + w * m, y - 6); ctx.lineTo(x0 + w * m - 6, y - 14); ctx.lineTo(x0 + w * m + 6, y - 14); ctx.closePath(); ctx.fill(); });
    if (c.lost) { const k = clamp(c.lost.t / .3, 0, 1); ctx.save(); ctx.globalAlpha = .35 * (1 - clamp((c.lost.t - 1.2) / .6, 0, 1)); ctx.fillStyle = '#ff2a2a'; ctx.fillRect(0, 0, W, H); ctx.restore();
      ctx.save(); ctx.globalAlpha = k; text('OVERPOWERED', 640, 330, 80, '#ff8a6b'); text(c.losses >= 3 ? 'THIRD LOSS · THE LEVEL RESETS' : `SHE WON THIS PUSH · ${3 - c.losses} ${3 - c.losses === 1 ? 'TRY' : 'TRIES'} LEFT · AGAIN IN ${Math.max(0, 1.8 - c.lost.t).toFixed(1)}s`, 640, 380, 22, c.losses >= 3 ? '#ff8a6b' : '#ffffff', 'center', true, 600); ctx.restore(); return; }
    text(STAGES[s.stage].hero, x0, y + 44, 16, heroCol, 'left', true, 600); text(STAGES[s.stage].boss, x0 + w, y + 44, 16, bossCol, 'right', true, 600);
    if (c.won && c.sword && c.wonT < .55) { text('SWORD THROW!', 640, 330, 60, '#ffffff'); return; }
    if (c.won) { const k = clamp((c.wonT - (c.sword ? .55 : 0)) / 0.6, 0, 1); ctx.save(); ctx.globalAlpha = k; ctx.translate(640, 330); const sc = reducedMotion ? 1 : lerp(1.6, 1, easeOutBack(k)); ctx.scale(sc, sc); text('BREAKTHROUGH', 0, 0, 90, '#ffffff'); ctx.restore(); return; }
    if (c.seq) { // announced key moment
      const q = c.seq, cx = 730, cy = fx.touch ? 470 : 610; // clear of the hero and the beam (phone: above the key buttons)
      ctx.save(); ctx.fillStyle = 'rgba(5,7,10,.72)'; ctx.fillRect(cx - 260, cy - 92, 520, 168); ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.strokeRect(cx - 260, cy - 92, 520, 168);
      if (q.warn > 0) { text('GET READY', cx, cy - 46, 40, '#ffe08a'); text(`KEYS IN ${q.warn.toFixed(1)}s · MASHING IS IGNORED`, cx, cy - 12, 18, '#c8d0d6', 'center', true, 600); }
      else text(q.stun > 0 ? 'STUNNED' : 'TYPE THE KEYS IN ORDER', cx, cy - 46, q.stun > 0 ? 36 : 28, q.stun > 0 ? '#ff8a6b' : '#ffffff');
      q.keys.forEach((key, i) => keycap(cx - (q.keys.length - 1) * 35 + i * 70, cy + 20, key, q.warn > 0 ? 'todo' : i < q.i ? 'done' : i === q.i ? (q.stun > 0 ? 'bad' : 'now') : 'todo', 54, keyAge(q, i, q.warn <= 0 && i < q.i)));
      if (q.warn <= 0) { const left = clamp(1 - q.t / q.limit, 0, 1); ctx.fillStyle = '#23303a'; ctx.fillRect(cx - 200, cy + 60, 400, 7); ctx.fillStyle = left < .3 ? '#ff5a46' : '#ffe08a'; ctx.fillRect(cx - 200, cy + 60, 400 * left, 7); }
      ctx.restore();
    }
    if (c.t >= 1.3 && !c.struggle && !c.seq) {
      const pulse = reducedMotion ? 1 : 1 + Math.sin(fx.clock * 16) * 0.05 + fx.clashPulse * 0.08;
      ctx.save(); ctx.translate(640, fx.touch ? 520 : 610); ctx.scale(pulse, pulse); // phone: clear of the PUSH button
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
      // owner: "a star that spins slowly, then a light from the sky appears and starts disappearing again going up, which spawns him"
      const sig = clamp((k - .08) / .3, 0, 1), sigFade = k < .7 ? 1 : 1 - (k - .7) / .2;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(h.x, h.y, 180 * sig, 'rgba(255,224,138,.35)', sigFade);
      hexagram(h.x, h.y, 120, fx.clock * .35, easeOut(sig), '#ffe08a', 3, .36, sigFade);
      hexagram(h.x, h.y, 80, -fx.clock * .5, easeOut(clamp(sig * 1.3 - .3, 0, 1)), '#ffffff', 2, .36, sigFade * .8);
      // the sky light: its bottom edge comes down to the sigil, holds, then rises away
      const down = easeOut(clamp((k - .3) / .14, 0, 1)), up = easeOut(clamp((k - .55) / .22, 0, 1));
      if (down > 0 && up < 1) {
        const bottom = lerp(-300, h.y, down), top = lerp(-300, h.y, up), w = 70;
        const g = ctx.createLinearGradient(h.x - w, 0, h.x + w, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(255,240,200,.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(h.x - w, top, w * 2, bottom - top); ctx.fillStyle = '#ffffff'; ctx.fillRect(h.x - 6, top, 12, bottom - top);
        if (Math.random() < .9) part(h.x + (Math.random() - .5) * 90, lerp(top, bottom, Math.random()), 1, '#fff2c8', 80, .8, 3, -300);
      }
      // the boss erupts in its own crimson column at the same time
      const bk = k < .5 ? easeOut(clamp((k - .15) / .3, 0, 1)) : 1 - easeOut((k - .5) / .3);
      if (bk > 0) { const w = 150, g = ctx.createLinearGradient(b.x - w, 0, b.x + w, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, '#ff6a3a'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = .75 * bk; ctx.fillStyle = g; ctx.fillRect(b.x - w, -300, w * 2, 1200); ctx.globalAlpha = 1; if (Math.random() < .8) part(b.x + (Math.random() - .5) * 140, b.y, 1, '#ff7a4a', 140, 1, 3, -400); }
      ctx.restore();
    } else if (c.kind === 'totality') {
      // the moon slides over the sun; the world goes dark from the edges in
      const dk = easeOut(clamp(k / 0.5, 0, 1));
      ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.7 * dk * (k < 0.5 ? 1 : 1 - easeOut((k - 0.5) / 0.2))})`; ctx.fillRect(-500, -300, W + 1000, H + 600); ctx.restore();
      if (k < 0.5) { const ex = 980 - fx.camX * 0.1, ey = 150; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(lerp(ex + 260, ex, dk), lerp(ey - 60, ey, dk), 86, 0, TAU); ctx.fill(); glow(ex, ey, 140 * (1 - dk) + 20, 'rgba(255,255,255,.6)'); }
    } else if (c.kind === 'ending' || c.kind === 'trueEnding') {
      // cracks of light spread over the boss, it shatters, dawn rises
      if (!fx.bossGone && k < 0.4) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 16;
        const n = Math.floor(k / 0.4 * 16) + 1;
        for (let i = 0; i < n; i++) { const a = i * 2.39996, r = 30 + (i % 4) * 30; ctx.beginPath(); ctx.moveTo(b.x, b.y - 110); ctx.lineTo(b.x + Math.cos(a) * r * 0.6, b.y - 110 + Math.sin(a) * r * 0.6); ctx.lineTo(b.x + Math.cos(a + 0.3) * r * 1.4, b.y - 110 + Math.sin(a + 0.3) * r * 1.4); ctx.stroke(); }
        ctx.restore(); glow(b.x, b.y - 110, 80 + k * 300, 'rgba(255,255,255,.6)', k * 2);
      }
      if (k > 0.36 && k < 0.5) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(b.x, b.y - 130, lerp(60, 1500, easeOut((k - 0.36) / 0.12)), 'rgba(255,255,255,.95)'); ctx.restore(); }
    }
  }
  // owner: "a beautiful peaceful place, sunset grass, the shield dug into the ground, the sword falls from the sky and digs in"
  const grass = Array.from({ length: 220 }, (_, i) => ({ x: (i * 37.3) % 1400 - 60, y: 420 + ((i * 53) % 300), h: 14 + (i * 13) % 22, ph: i * .7 }));
  function drawMeadow(s, a, k) {
    const secret = fx.endKind === 'trueEnding', sx = (Math.sin(fx.clock * 47) * 10 + 0) * fx.trauma * fx.trauma;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(sx, 0);
    const sky = ctx.createLinearGradient(0, -100, 0, 420);
    if (secret) { sky.addColorStop(0, '#2a3a5a'); sky.addColorStop(.6, '#f2d6b0'); sky.addColorStop(1, '#fff4dc'); } else { sky.addColorStop(0, '#2b1a3c'); sky.addColorStop(.55, '#d9644a'); sky.addColorStop(1, '#ffc27a'); }
    ctx.fillStyle = sky; ctx.fillRect(-500, -300, W + 1000, 720);
    ctx.globalCompositeOperation = 'lighter'; glow(640, 400, 420, secret ? 'rgba(255,250,230,.6)' : 'rgba(255,190,110,.55)'); ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = secret ? '#fffaf0' : '#ffe0a0'; ctx.beginPath(); ctx.arc(640, 410, 80, Math.PI, TAU); ctx.fill();
    if (secret) { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(640, 410, 130, Math.PI, TAU); ctx.stroke(); }
    ctx.save(); ctx.globalAlpha = a * .1; ctx.fillStyle = '#fff8d5'; // slow sun rays
    for (let i = 0; i < 7; i++) { const an = Math.PI + .25 + i * .42 + Math.sin(fx.clock * .2 + i) * .03; ctx.beginPath(); ctx.moveTo(640, 410); ctx.lineTo(640 + Math.cos(an) * 900, 410 + Math.sin(an) * 900); ctx.lineTo(640 + Math.cos(an + .07) * 900, 410 + Math.sin(an + .07) * 900); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    for (let i = 0; i < 5; i++) { ctx.fillStyle = `rgba(255,${200 - i * 20},${170 - i * 20},${.25 - i * .03})`; ctx.beginPath(); ctx.ellipse(((i * 290 + fx.clock * (6 + i * 2)) % 1700) - 200, 120 + i * 40, 240, 16, 0, 0, TAU); ctx.fill(); }
    // hills and field
    ctx.fillStyle = secret ? '#6a7a5a' : '#4a3a4a'; ctx.beginPath(); ctx.moveTo(-500, 420); for (let x = -500; x <= W + 500; x += 40) ctx.lineTo(x, 400 - Math.sin(x * .006) * 24 - Math.sin(x * .017) * 8); ctx.lineTo(W + 500, 720); ctx.lineTo(-500, 720); ctx.fill();
    const haze = ctx.createLinearGradient(0, 330, 0, 450); haze.addColorStop(0, 'rgba(255,214,160,0)'); haze.addColorStop(.6, 'rgba(255,214,160,.22)'); haze.addColorStop(1, 'rgba(255,214,160,0)');
    ctx.fillStyle = haze; ctx.fillRect(-500, 330, W + 1000, 120);
    const field = ctx.createLinearGradient(0, 410, 0, 720); field.addColorStop(0, secret ? '#9ab86a' : '#7a8a3a'); field.addColorStop(1, secret ? '#3a5a2a' : '#2a3a1a');
    ctx.fillStyle = field; ctx.fillRect(-500, 418, W + 1000, 400);
    // grass behind the keepsakes first, so no blade ever draws over the shield (owner)
    for (const g of grass) { if (g.y >= 600) continue; const sw = Math.sin(fx.clock * 1.6 + g.ph) * 4; ctx.strokeStyle = `rgba(${secret ? '200,230,150' : '190,200,110'},${.4 + (g.y - 420) / 500})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.quadraticCurveTo(g.x + sw * .5, g.y - g.h * .5, g.x + sw, g.y - g.h); ctx.stroke(); }
    { // the near bank: a rolling edge instead of a straight band, darker toward the viewer
      const nb = ctx.createLinearGradient(0, 624, 0, H);
      nb.addColorStop(0, secret ? '#2f4a22' : '#24331a'); nb.addColorStop(1, secret ? '#1d3016' : '#141d0c'); ctx.fillStyle = nb;
      ctx.beginPath(); ctx.moveTo(-500, H + 120); for (let x = -500; x <= W + 500; x += 30) ctx.lineTo(x, 634 + Math.sin(x * .011) * 9 + Math.sin(x * .043 + 1) * 4); ctx.lineTo(W + 500, H + 120); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = secret ? '#b8d888' : '#a8b860'; ctx.lineWidth = 2;
    for (const g of grass) { if (g.y < 600 || (g.x > 500 && g.x < 790)) continue; const sw = Math.sin(fx.clock * 1.6 + g.ph) * 5; ctx.beginPath(); ctx.moveTo(g.x, g.y + 40); ctx.quadraticCurveTo(g.x + sw * .5, g.y + 20, g.x + sw, g.y + 40 - g.h); ctx.stroke(); }
    for (const [x, y, col] of [[160, 612, '#f2d68a'], [300, 650, '#e8a8b0'], [395, 600, '#f6e7b0'], [880, 640, '#f2d68a'], [1010, 606, '#e8a8b0'], [1150, 660, '#f6e7b0'], [240, 690, '#e8a8b0'], [960, 690, '#f2d68a']]) { const sw = Math.sin(fx.clock * 1.6 + x) * 2; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + sw, y, 3, 0, TAU); ctx.fill(); }
    // keepsakes, placed like ChatGPT's 14: shield standing, the sword planted just to its right on the same soil
    const GY = 606, SHX = 590, SWX = 704, sec = s.cine ? s.cine.len : 9, age = s.cine ? s.cine.t - .4 * sec : 99;
    ctx.fillStyle = 'rgba(36,45,31,.28)'; ctx.beginPath(); ctx.ellipse(SHX, GY + 4, 78, 15, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(SWX, GY + 6, 42, 9, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(-500, -300, W + 1000, GY + 306); ctx.clip(); drawShield(SHX, GY - 36, 60, -.035); ctx.restore(); // owner: dug a bit deeper
    // the sword: gravity fall, a slight lean that settles, lands tip-first, half the blade buried, a short wobble
    const fall = clamp((k - .3) / .1, 0, 1), landed = fall * fall;
    if (fall > 0) {
      if (fall >= 1) { ctx.fillStyle = 'rgba(35,35,25,.36)'; ctx.beginPath(); ctx.ellipse(SWX, GY + 4, 48, 11, 0, 0, TAU); ctx.fill();
        if (age < .5) { const im = 1 - age / .5; ctx.save(); ctx.globalAlpha *= im; ctx.strokeStyle = '#b99a62'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(SWX, GY + 4, 28 + (1 - im) * 52, 7 + (1 - im) * 10, 0, 0, TAU); ctx.stroke(); ctx.restore(); } }
      const tipY = lerp(-122, GY + 84, landed), wob = !reducedMotion && age >= 0 && age < .4 ? Math.sin(age * 42) * (1 - age / .4) * .018 : 0;
      ctx.save(); ctx.beginPath(); ctx.rect(-500, -300, W + 1000, GY + 300); ctx.clip();
      if (fall < 1) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(SWX - 3, tipY - 420, 6, 220); ctx.globalCompositeOperation = 'source-over'; }
      ctx.translate(SWX, tipY); ctx.rotate(lerp(-.035, -.1, landed) + wob); drawSword(0, -138 * 1.2, 0, 1.2);
      ctx.restore();
      if (age >= 0 && age < .6) { ctx.save(); ctx.globalAlpha *= (1 - age / .6) * .8; ctx.strokeStyle = '#fff5cc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(SWX - 12, GY - 96); ctx.lineTo(SWX + 12, GY - 96); ctx.moveTo(SWX, GY - 108); ctx.lineTo(SWX, GY - 84); ctx.stroke(); ctx.restore(); }
    }
    // a thin dark lip of soil buries the shield's rim and the sword's entry point
    ctx.fillStyle = secret ? '#3a3a24' : '#33432f'; ctx.beginPath();
    ctx.moveTo(SHX - 70, GY - 2); ctx.quadraticCurveTo(SHX - 34, GY - 9, SHX - 6, GY + 2); ctx.quadraticCurveTo(SHX + 8, GY + 10, SHX + 22, GY - 1);
    ctx.lineTo(SHX + 52, GY + 3); ctx.quadraticCurveTo(SWX - 32, GY - 2, SWX - 12, GY + 2); ctx.quadraticCurveTo(SWX, GY + 10, SWX + 14, GY);
    ctx.lineTo(SWX + 50, GY - 2); ctx.quadraticCurveTo(SWX + 20, GY + 22, SWX - 14, GY + 15); ctx.quadraticCurveTo(SHX + 60, GY + 20, SHX + 24, GY + 14);
    ctx.quadraticCurveTo(SHX - 12, GY + 26, SHX - 46, GY + 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#85714b'; for (const [x, y, r] of [[-44, 9, 2.4], [-20, 14, 1.8], [36, 12, 2.1], [52, 6, 1.6], [-80, 15, 1.8], [-6, 16, 2]]) { ctx.beginPath(); ctx.arc(SWX + x, GY + y, r, 0, TAU); ctx.fill(); }
    if (age >= 0 && age < .42) { // soil kicked up by the landing
      const kick = 1 - age / .42; ctx.save(); ctx.globalAlpha *= kick; ctx.fillStyle = '#96784d';
      for (const [dx, dy, r] of [[-19, -5, 2], [-11, -11, 1.5], [-3, -8, 1.8], [8, -12, 1.5], [17, -6, 2], [-24, -1, 1.3], [23, -1, 1.4], [-7, -15, 1.1], [13, -16, 1.2], [-16, -14, 1.2], [4, -4, 1.1], [27, -10, 1.1]]) { ctx.beginPath(); ctx.arc(SWX + dx * 1.3, GY + 4 + dy * 1.3 - kick * (6 + r * 2), r * 1.3, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    if (age > .7 && age < 4.2) { // memorial: the hero's light leaves the sword and rises into the sky
      const m = (age - .7) / 3.5, al = Math.sin(clamp(m, 0, 1) * Math.PI) * .75;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(SWX, GY - 120 - m * 260, 70, 'rgba(255,240,200,.6)', al);
      drawHero(s, SWX, GY - 70 - m * 260, al, 1, true); ctx.restore();
    }
    // drifting light motes
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) { const x = (i * 97 + fx.clock * 12) % 1300, y = 300 + ((i * 61) % 300) + Math.sin(fx.clock + i) * 10; ctx.globalAlpha = a * (.3 + .3 * Math.sin(fx.clock * 2 + i)); ctx.fillStyle = '#fff2c8'; ctx.fillRect(x, y, 2, 2); }
    ctx.restore();
  }
  function drawCineScreen(s) {
    const c = s.cine; if (!c) return;
    const k = c.t / c.len;
    if (c.kind === 'ending' || c.kind === 'trueEnding') { // white (from the sword hit), a moment of black, then the meadow fades up
      const white = 1 - clamp(k / .05, 0, 1), black = k < .05 ? 0 : 1 - clamp((k - .1) / .06, 0, 1);
      if (black > 0) { ctx.fillStyle = `rgba(0,0,0,${black})`; ctx.fillRect(-500, -300, W + 1000, H + 600); } if (white > 0) { ctx.fillStyle = `rgba(255,252,240,${white})`; ctx.fillRect(-500, -300, W + 1000, H + 600); }
    } else letterbox(Math.min(k * 4, (1 - k) * 8 + 0.2));
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
    if ((c.kind === 'ending' || c.kind === 'trueEnding') && k > 0.55) {
      const a = clamp((k - 0.55) * 5, 0, 1); ctx.globalAlpha = a;
      text(c.kind === 'trueEnding' ? 'TOTALITY IS OVER' : 'THE ECLIPSE IS BROKEN', 640, 190, 66, '#ffffff');
      text(c.kind === 'trueEnding' ? 'TRUE ENDING · THE LIGHT STAYS' : 'A NEW, HUMBLE BEGINNING', 640, 232, 24, '#fff0d0', 'center', true, 600);
    }
    ctx.restore();
    if ((c.kind === 'ending' || c.kind === 'trueEnding') && c.t > 2.5) text(fx.touch ? 'TAP TO SKIP' : 'ENTER TO SKIP', W - 30, H - 24, 15, '#9aa6b0', 'right', false, 600);
  }

  // ------------------------------------------------------------------ dialogue (clickable, cinematic)
  function wrap(str, maxW) { const words = str.split(' '), lines = []; let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line); return lines; }
  function drawTalk(s) {
    const k = s.talk; if (!k) return;
    const line = k.lines[k.i], hero = line.who === 'hero', pal = P[form(s)], col = hero ? pal.hero : pal.name;
    letterbox(Math.min(1, k.t * 4 + (k.i ? 1 : 0)));
    // portrait: the speaker, framed and larger, on their side of the screen
    const px = hero ? 70 : W - 70 - 220, py = 330, pw = 220, ph = 220;
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    ctx.fillStyle = 'rgba(5,8,10,.85)'; ctx.fillRect(px, py, pw, ph);
    ctx.globalCompositeOperation = 'lighter'; glow(px + pw / 2, py + ph / 2, 160, hero ? 'rgba(160,240,255,.25)' : 'rgba(255,120,80,.25)'); ctx.globalCompositeOperation = 'source-over';
    // bust shots: the speaker's head and shoulders fill the frame
    if (hero) { const sc = 2.5; ctx.translate(px + pw / 2 - 4, py + ph * 1.12); ctx.scale(sc, sc); drawHero(s, 0, 0, 1, 1); }
    else { const b = s.boss, sc = 1.02; ctx.translate(px + pw / 2, py + ph / 2); ctx.scale(sc, sc); ctx.translate(-b.x, -(b.y - 150)); drawBoss(s); }
    ctx.restore();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.strokeRect(px, py, pw, ph);
    // the line itself
    const bx = 120, by = 566, bw = W - 240, bh = 108, shown = Math.floor(k.t * TALK_CPS), full = shown >= line.text.length;
    ctx.fillStyle = 'rgba(5,8,10,.92)'; ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
    ctx.font = font(22); const nw = ctx.measureText(line.name).width + 28;
    ctx.fillStyle = col; ctx.fillRect(hero ? bx + 24 : bx + bw - 24 - nw, by - 18, nw, 30);
    text(line.name, hero ? bx + 38 : bx + bw - 10 - nw + 0, by + 4, 22, '#05070a', 'left', false);
    ctx.font = font(30, 600); const lines = wrap(line.text.slice(0, shown), bw - 90);
    lines.slice(0, 2).forEach((l, i) => text(l, bx + 40, by + 52 + i * 34, 30, '#f2ede2', 'left', false, 600));
    if (full && Math.floor(fx.clock * 2.5) % 2) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(bx + bw - 44, by + bh - 30); ctx.lineTo(bx + bw - 30, by + bh - 22); ctx.lineTo(bx + bw - 44, by + bh - 14); ctx.fill(); }
    text(fx.touch ? 'TAP TO CONTINUE' : 'CLICK · ENTER · J', bx + bw - 60, by + bh + 26, 14, '#9aa6b0', 'right', false, 600);
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
    text(flick ? 'THE ECLIPSE ALIGNS' : st.boss, 290, 42, 22, flick ? '#ffffff' : pal.name, 'left', true);
    const hardM = s.M.key !== 'normal', ex = s.M.key === 'extreme';
    text(s.stage === 3 ? 'SECRET PHASE' : `PHASE ${s.stage}`, hardM ? (ex ? 906 : 920) : 990, 42, 16, s.stage === 3 ? '#ff3b5c' : '#c8d0d6', 'right', true, 600);
    if (hardM) { ctx.fillStyle = ex ? '#000000' : '#7a1420'; ctx.fillRect(ex ? 916 : 930, 27, ex ? 74 : 60, 20); if (ex) { ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2; ctx.strokeRect(916, 27, 74, 20); } text(s.M.name, ex ? 953 : 960, 42, 14, ex ? '#ff4a4a' : '#ffd6d6', 'center', false, 800); }
    hpBar(290, 52, 700, 14, b.hp, b.chip, b.max, pal.bar, b.gates.slice(b.gateIndex));
    { const bh = Math.max(0, Math.ceil(b.hp)); text(`${bh.toLocaleString('en-US')} / ${b.max.toLocaleString('en-US')} HP   ${Math.ceil(bh / b.max * 100)}%`, 990, 86, 14, '#e8eef2', 'right', true, 700); } // owner: the boss bar shows its real HP and a percentage
    if (fx.callout && fx.callout.t < 1 && s.phase === 'fight') { ctx.save(); ctx.globalAlpha = 1 - clamp((fx.callout.t - 0.6) / 0.4, 0, 1); text(fx.callout.text, 640, 96, 20, pal.tele); ctx.restore(); }
    // hero panel
    const hy = touch ? 96 : 646;
    text(st.hero, 40, hy, 18, pal.hero, 'left', false);
    text(`${Math.max(0, Math.ceil(h.hp))} / ${TUNE.heroMax}`, 340, hy, 15, h.hp < 25 ? '#ff8a7a' : '#e8eef2', 'right', true, 700); // owner: whole-number HP for the hero
    hpBar(40, hy + 10, 300, 12, h.hp, Math.max(h.hp, h.chip), TUNE.heroMax, h.hp < 25 ? '#ff6a5a' : '#7fe0b0');
    for (let i = 0; i < Math.max(h.heals, 1); i++) { const on = i < h.heals; ctx.fillStyle = on ? '#9ff0c4' : '#26323a'; ctx.beginPath(); ctx.arc(360 + i * 22, hy + 16, 8, 0, TAU); ctx.fill(); ctx.fillStyle = on ? '#0b1014' : '#4b5a63'; ctx.fillRect(356 + i * 22, hy + 15, 8, 2); ctx.fillRect(359 + i * 22, hy + 12, 2, 8); }
    text(touch ? 'HEALS' : 'H  HEAL', 356, hy + 40, 14, '#c8d0d6', 'left', false, 600);
    // ability dock: six specials of the current form
    fx.dock = [];
    const size = touch ? 64 : 52, gap = touch ? 80 : 78, dx0 = touch ? 640 - gap * 2.5 : 1240 - size / 2 - gap * 5, dy = touch ? 630 : 640;
    if (!touch && s.t < 22 && s.phase !== 'box') text('J SLASH   K CAST   Q / E SWITCH   SPACE DODGE', 1240, dy - 46, 15, '#c8d0d6', 'right', true, 600); // hides after the first 20 s
    if (!(touch && s.phase !== 'fight') && s.phase !== 'box') ABIL_ORDER.forEach((name, i) => { // phone: the centred dock would sit on the box
      const a = ABIL[name], x = dx0 + i * gap, sel = h.sel === name, cd = Math.min(1, (h.cds[name] || 0) / (a.cd[s.stage] * TUNE.abilCd));
      fx.dock.push({ x: x - size / 2, y: dy - size / 2, w: size, h: size, key: a.key });
      ctx.save(); ctx.translate(x, dy - (sel ? 6 : 0));
      ctx.fillStyle = '#0b1014'; ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.fillStyle = sel ? pal.hero : '#1e262c'; ctx.globalAlpha = sel ? 0.22 : 1; ctx.fillRect(-size / 2, -size / 2, size, size); ctx.globalAlpha = 1;
      if (cd > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(-size / 2, -size / 2, size, size * cd); }
      ctx.strokeStyle = sel ? pal.hero : '#3a4650'; ctx.lineWidth = sel ? 3 : 1.5; ctx.strokeRect(-size / 2, -size / 2, size, size);
      drawAbilityIcon(name, f, cd > 0 ? 0.45 : 1, pal.hero);
      text(a.key, -size / 2 + 6, -size / 2 + 15, 14, '#e8eef2', 'left', false, 700);
      ctx.restore();
      ctx.font = font(14, 600); const lw = ctx.measureText(a.names[s.stage]).width, lpx = lw > gap - 4 ? Math.max(12, Math.floor(14 * (gap - 4) / lw)) : 14; // never collide, even with a fallback font
      text(a.names[s.stage], x, dy + size / 2 + 16, lpx, sel ? pal.hero : '#9aa6b0', 'center', false, 600);
    });
    if (s.finisher.prompt > 0 && s.phase === 'fight') {
      const p = s.finisher.prompt / FIN.window, pulse = reducedMotion ? 1 : 1 + Math.sin(fx.clock * 12) * 0.06;
      const fpx = clamp(640 + (h.x - 640 - fx.camX) * fx.zoom, 200, 1080), fpy = clamp(360 + (h.y - 185 - 360 - fx.camY) * fx.zoom, 150, touch ? 470 : 520); // above the hero, never on top of him
      ctx.save(); ctx.translate(fpx, fpy); ctx.scale(pulse, pulse);
      const hellP = s.finisher.hell, col = hellP ? '#ff3b3b' : al ? '#ffffff' : '#ffe08a';
      ctx.fillStyle = hellP ? '#2a0003' : '#0b1014'; ctx.fillRect(-160, -30, 320, 60); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.strokeRect(-160, -30, 320, 60);
      ctx.fillStyle = col; ctx.fillRect(-160, 26, 320 * p, 4);
      ctx.font = font(30); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(FIN_NAMES[finNext(s)] + (touch ? '!' : '  [ F ]'), 0, 0, 296); ctx.restore(); ctx.textBaseline = 'alphabetic';
    }
    if (h.invertIn > 0 && s.phase !== 'rune') { // the countdown before the inversion lands: big, centred, can't be missed
      const n = Math.ceil(h.invertIn / .55), pu = reducedMotion ? 1 : 1 + (1 - (h.invertIn % .55) / .55) * .25;
      ctx.save(); ctx.translate(640, 300); ctx.scale(pu, pu); text(`CONTROLS INVERT IN ${n}`, 0, 0, 44, '#ff8a6b'); ctx.restore();
      text('LEFT BECOMES RIGHT, UP BECOMES DOWN', 640, 340, 18, '#ffffff', 'center', true, 600);
    }
    if (h.invert > 0 && s.phase !== 'rune') { const jit = reducedMotion ? 0 : Math.sin(fx.clock * 40) * 2; text(`CONTROLS INVERTED  ${h.invert.toFixed(1)}s`, 640 + jit, 128, 22, '#ff7a5a'); }
    drawBanner(s);
  }
  function drawAbilityIcon(name, f, alpha, col) {
    // P8: every icon is built on the Star of David, one silhouette per move so they still read apart
    const D = (x, y, r, fill = .4, c = col, rot = 0) => davidStar(x, y, r, rot, c, alpha, fill);
    const k = name + f;
    ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = alpha;
    switch (k) {
      case 'star1': D(0, 2, 15, .5); break;                                                   // one thrown star
      case 'spinner1': D(-10, 8, 7, .6); D(10, 8, 7, .6); D(0, -8, 7, .6); ctx.beginPath(); ctx.arc(0, 2, 17, -.4, 1.6); ctx.stroke(); break; // three, curving
      case 'burst1': D(0, 2, 11, .6); for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i / 6 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 14, 2 + Math.sin(a) * 14); ctx.lineTo(Math.cos(a) * 20, 2 + Math.sin(a) * 20); ctx.stroke(); } break;
      case 'eyes1': ctx.beginPath(); ctx.ellipse(0, 2, 18, 9, 0, 0, TAU); ctx.stroke(); D(0, 2, 7, .7); break;          // the eye's pupil is a star
      case 'lattice1': for (let i = 0; i < 3; i++) { ctx.globalAlpha = alpha * .5; ctx.fillRect(-13 + i * 11, -16 + i * 4, 2, 12); ctx.globalAlpha = alpha; D(-12 + i * 11, 2 + i * 4, 5, .7); } break;
      case 'nova1': D(0, 2, 17, .25); D(0, 2, 9, .5, '#ffffff', Math.PI / 6); break;          // the big double star
      case 'star2': ctx.restore(); drawShield(0, 2, 14, 0, alpha); return;                       // shield (its face is a star)
      case 'spinner2': ctx.beginPath(); ctx.ellipse(0, 2, 16, 8, 0, 0, TAU); ctx.stroke(); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * 16, 2 + Math.sin(a) * 8, 3.2, 0, TAU); ctx.fill(); } break; // gold embers on an orbit
      case 'burst2': ctx.beginPath(); ctx.ellipse(0, 4, 8, 16, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke(); D(-8, 4, 7, .5); break;
      case 'eyes2': ctx.beginPath(); ctx.moveTo(-16, 12); ctx.lineTo(8, -4); ctx.stroke(); D(10, -6, 8, .6); break;   // lance with a star tip
      case 'lattice2': ctx.save(); ctx.scale(1, .55); D(0, 14, 17, .2); ctx.restore(); D(0, -4, 6, .6); break;        // a seal on the ground
      case 'nova2': ctx.save(); ctx.translate(0, 8); ctx.scale(1, .5); ctx.beginPath(); ctx.arc(0, 0, 18, 0, TAU); ctx.stroke(); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 13, Math.sin(a) * 13); ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 17); ctx.stroke(); } ctx.restore(); ctx.fillRect(-2, -16, 4, 22); break; // the sun-dial and its pillar
      case 'star3': for (let i = 0; i < 6; i++) { const a = i / 6 * TAU - Math.PI / 2; ctx.save(); ctx.translate(Math.cos(a) * 13, 2 + Math.sin(a) * 11); ctx.rotate(a); ctx.beginPath(); ctx.arc(0, 0, 5, -1.3, 1.3); ctx.arc(-2.5, 0, 4.4, 1.15, -1.15, true); ctx.closePath(); ctx.fill(); ctx.restore(); } break; // a corona of crescents
      case 'spinner3': ctx.beginPath(); ctx.ellipse(0, 2, 17, 12, 0, 0, TAU); ctx.stroke(); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; D(Math.cos(a) * 17, 2 + Math.sin(a) * 12, 3.5, .8); } break;
      case 'burst3': for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 11, 2 + Math.sin(a) * 11); ctx.lineTo(Math.cos(a) * (i % 2 ? 16 : 20), 2 + Math.sin(a) * (i % 2 ? 16 : 20)); ctx.stroke(); } ctx.fillStyle = '#05060a'; ctx.beginPath(); ctx.arc(0, 2, 10, 0, TAU); ctx.fill(); ctx.stroke(); break; // the black sun
      case 'eyes3': ctx.globalAlpha = alpha * .6; ctx.fillRect(-4, -18, 8, 26); ctx.globalAlpha = alpha; ctx.save(); ctx.scale(1, .45); D(0, 30, 15, .3); ctx.restore(); break;
      case 'lattice3': for (let i = 0; i < 3; i++) { const x0 = -16 + i * 11, y0 = -14 + i * 9; ctx.globalAlpha = alpha * .5; ctx.beginPath(); ctx.moveTo(x0 - 10, y0 - 10); ctx.lineTo(x0, y0); ctx.stroke(); ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x0, y0, 4, 0, TAU); ctx.stroke(); } break; // slanting meteors
      case 'nova3': D(0, 2, 18, .2); D(0, 2, 12, .3, '#ffffff', Math.PI / 6); D(0, 2, 6, .8); break;
    }
    ctx.restore();
  }
  function drawBanner(s) {
    if (!s.banner) return;
    const bn = s.banner, inT = easeOutBack(bn.t / 0.3), out = clamp((bn.t - 1.4) / 0.35, 0, 1);
    if (bn.t >= 1.75) return;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(640, s.phase === 'box' ? 150 : 250); const sc = reducedMotion ? 1 : lerp(1.4, 1, clamp(inT, 0, 1.1)); ctx.scale(sc, sc);
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
    fx.clock += dt; fx.touch = !!view.touch; fx.form = form(s);
    fx.clashPulse = Math.max(0, fx.clashPulse - dt * 6); fx.bossKick = Math.max(0, (fx.bossKick || 0) - dt * 5);
    if (fx.callout) fx.callout.t += dt;
    for (const x of fx.scorch) x.t += dt; for (const x of fx.cracks) x.t += dt; for (const x of fx.slashes) x.t += dt;
    fx.scorch = fx.scorch.filter((x) => x.t < 6); fx.cracks = fx.cracks.filter((x) => x.t < 6); fx.slashes = fx.slashes.filter((x) => x.t < 0.45);
    fx.talkPunch = Math.max(0, (fx.talkPunch || 0) - dt * 4);
    if (s.phase === 'cine' && s.cine && (s.cine.kind === 'ending' || s.cine.kind === 'trueEnding')) { fx.endKind = s.cine.kind; fx.bossGone = true; fx.meadow = clamp((s.cine.t / s.cine.len - .1) / .02, 0, 1); }
    if (s.phase === 'victory') { fx.meadow = 1; fx.bossGone = true; fx.endKind = s.result?.tier === 'secret' ? 'trueEnding' : 'ending'; }
    consume(s); s.events.length = 0;
    const { width, height, scale, ox, oy } = view; fx.view = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050708'; ctx.fillRect(0, 0, width, height);
    const h = s.hero, b = s.boss;
    // camera
    let tz = 1, tx = 0, ty = 0;
    if (s.phase === 'finisher' && s.finisher.cine?.v === 3) { tz = .92; tx = (b.x - 640) * .7; ty = -70; } // the whole hut in frame
    else if (s.phase === 'finisher') { tz = 1.12; tx = (b.x - 640) * 0.55; ty = (b.y - 200 - 360) * 0.5; } // pulled back: nothing cut off at the top
    else if (s.phase === 'box') tz = 0.96;
    else if (s.phase === 'talk' && s.talk) { const hero = s.talk.lines[s.talk.i].who === 'hero', sx = hero ? h.x : b.x, sy = hero ? h.y - 60 : b.y - 150; tz = 1.22 + (fx.talkPunch || 0) * .03; tx = sx - 640 - ((hero ? 720 : 520) - 640) / tz; ty = (sy - 330) * .5; }
    else if (s.phase === 'finisherQte') { tz = 1.1; tx = (b.x - 640) * .3; }
    else if (s.phase === 'chained') { tz = 1.08; tx = ((h.x + b.x) / 2 - 640) * 0.4; }
    else if (s.phase === 'clash' && s.clash) { const g = clashGeom(s); tz = 1.04 + (s.clash.won ? 0.12 : s.clash.struggle ? 0.1 : s.clash.p * 0.06); tx = (g.sxp - 640) * (s.clash.struggle ? .5 : 0.25); ty = -20; }
    else if (s.phase === 'cine' && s.cine) { const k = s.cine.t / s.cine.len; if (s.cine.kind === 'totality') { tz = lerp(1, 1.12, easeOut(k)); tx = 160 * easeOut(k); ty = -120 * easeOut(k); } else if (s.cine.kind === 'reborn') { tz = k < 0.5 ? lerp(1, 1.1, easeOut(k * 2)) : 1.02; } else { tz = lerp(1.05, 1.12, k); tx = (b.x - 640) * 0.3 * (1 - k); } }
    else if (['fight', 'intro', 'victory', 'defeat'].includes(s.phase)) { tx = ((h.x + b.x) / 2 - 640) * 0.18; tz = 1 + clamp(1 - Math.abs(b.x - h.x) / 900, 0, 1) * 0.06; }
    if (reducedMotion) tz = 1;
    if (s.phase !== 'box') tz *= TUNE.view; // owner (Oct 5): "we are way too big and the boss too, it's overwhelming": the camera sits further back (the SURVIVE box keeps its size)
    fx.zoom = lerp(fx.zoom, tz, 1 - Math.exp(-dt * 5)); fx.camX = lerp(fx.camX, tx, 1 - Math.exp(-dt * 4)); fx.camY = lerp(fx.camY, ty, 1 - Math.exp(-dt * 4));
    fx.trauma = Math.max(0, fx.trauma - dt * 1.5);
    const sh = fx.trauma * fx.trauma, shx = Math.sin(fx.clock * 47) * 14 * sh, shy = Math.sin(fx.clock * 61) * 9 * sh, rot = Math.sin(fx.clock * 31) * 0.02 * sh;
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.translate(640 + shx, 360 + shy); ctx.rotate(rot); ctx.scale(fx.zoom, fx.zoom); ctx.translate(-640 - fx.camX, -360 - fx.camY);
    drawArena(s);
    if (s.phase === 'fight' && aligned(s) && !s.codeOk) drawSkyKeys(s); // the hint for the secret code
    if (s.clash) drawClashWorld(s); // also while a clash story beat is paused
    drawHazards(s);
    const heroFirst = h.y < b.y + 30;
    if (s.phase !== 'finisher') for (const tr of h.trail) drawHero(s, tr.x, tr.y, tr.life * 2, tr.face, true);
    if (s.phase === 'defeat') { ctx.save(); ctx.globalAlpha = 0.5; drawBoss(s); ctx.restore(); }
    else {
      // reborn cine: the hero fades into the sigil and only reappears when the sky light lifts
      const rk = s.phase === 'cine' && s.cine?.kind === 'reborn' ? s.cine.t / s.cine.len : -1, heroA = rk < 0 ? 1 : rk < .16 ? 1 - rk / .16 : rk < .5 ? 0 : 1;
      const dh = () => { if (s.phase === 'fight' && heroA >= 1) { const hc = P[form(s)].hero; glow(h.x, h.y, 90, hc, .16); ctx.save(); ctx.globalAlpha = .5; ctx.strokeStyle = hc; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(h.x, h.y + 2, 34, 10, 0, 0, TAU); ctx.stroke(); ctx.restore(); } if (heroA > 0) { if (heroA < 1) { ctx.save(); ctx.globalAlpha = heroA; drawHero(s, h.x, h.y, heroA); ctx.restore(); } else drawHero(s, h.x, h.y); } };
      if (s.phase === 'finisher') drawSukkahBack(s); // the hut goes up around her
      if (heroFirst) { dh(); drawBoss(s); } else { drawBoss(s); dh(); }
    }
    if (s.phase === 'clash' && s.clash && s.clash.won && s.clash.wonT > (s.clash.sword ? .55 : 0.15)) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(b.x, b.y - 110, 300 * easeOut(s.clash.wonT), 'rgba(255,255,255,.85)'); ctx.restore(); }
    drawMinions(s);
    drawShots(s);
    drawHazards(s, true);
    if (s.phase === 'chained') drawChained(s);
    drawFinisherWorld(s);
    drawCineWorld(s);
    drawBlasts(dt); drawFlares(dt);
    drawFx(dt);
    if (!fx.meadow) { // foreground rubble: parallax faster than the floor gives the arena depth
      ctx.save(); ctx.translate(-fx.camX * .35, 0); ctx.fillStyle = form(s) === 3 ? '#000' : '#020304';
      for (const [x0, w, h2] of [[-80, 260, 46], [150, 120, 24], [1050, 200, 36], [1230, 220, 52]]) { ctx.beginPath(); ctx.moveTo(x0, H + 10); ctx.lineTo(x0 + w * .15, H - h2 * .7); ctx.lineTo(x0 + w * .35, H - h2); ctx.lineTo(x0 + w * .6, H - h2 * .8); ctx.lineTo(x0 + w * .85, H - h2 * .5); ctx.lineTo(x0 + w, H + 10); ctx.fill(); }
      ctx.restore();
    }
    drawBox(s);
    drawRune(s);
    drawTiming(s);
    // screen space
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    drawFinisherQte(s); // P13: in screen space so the keys sit centred whatever the camera does
    fx.chroma = Math.max(h.invert > 0 ? 0.12 + 0.05 * Math.sin(fx.clock * 9) : 0, fx.chroma - dt * 1.5);
    if (fx.chroma > 0 && !reducedMotion) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fx.chroma * 0.6; ctx.fillStyle = '#ff2a2a'; ctx.fillRect(-6, 0, W, H); ctx.fillStyle = '#2affd8'; ctx.fillRect(6, 0, W, H); ctx.restore(); }
    fx.vignette = Math.max(h.hp < 25 && s.phase === 'fight' ? 0.25 + 0.15 * Math.sin(fx.clock * 5) : 0, fx.vignette - dt);
    if (fx.vignette > 0) { const g = ctx.createRadialGradient(640, 360, 250, 640, 360, 760); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(170,20,10,${fx.vignette})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    if (fx.meadow > 0) drawMeadow(s, fx.meadow, s.cine ? s.cine.t / s.cine.len : 1);
    drawFinisherScreen(s);
    drawCineScreen(s);
    drawTalk(s);
    if (s.phase === 'clash') drawClashHud(s);
    else if (!view.menu && !['finisher', 'cine', 'victory', 'intro', 'talk', 'finisherQte'].includes(s.phase)) drawHud(s, !!view.touch); // the title screen's live backdrop has no HUD
    if (s.phase === 'cine' || s.phase === 'clash') drawBanner(s);
    if (fx.flash > 0) { ctx.globalAlpha = Math.min(1, fx.flash); ctx.fillStyle = fx.flashColor; ctx.fillRect(-500, -300, W + 1000, H + 600); ctx.globalAlpha = 1; fx.flash = Math.max(0, fx.flash - dt * 4); }
    if (fx.invert > 0) { // photo-negative frame for the heaviest beats (off with reduced motion)
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.restore(); fx.invert -= dt;
    }
    drawImpact(dt); // last, so it catches the flash too
    if (s.phase === 'intro') { const k = s.phaseT / 1.6, st = STAGES[s.stage]; ctx.fillStyle = `rgba(0,0,0,${1 - easeOut(k)})`; ctx.fillRect(-500, -300, W + 1000, H + 600); ctx.save(); ctx.globalAlpha = Math.sin(clamp(k, 0, 1) * Math.PI); text(st.boss, 640, 340, 72, P[s.stage].name); text(s.stage === 3 ? 'SECRET PHASE' : `PHASE ${s.stage}`, 640, 380, 22, '#c8d0d6', 'center', true, 600); ctx.restore(); }
    if (s.phase === 'defeat') { ctx.fillStyle = `rgba(0,0,0,${Math.min(0.6, s.phaseT)})`; ctx.fillRect(0, 0, W, H); }
  }
  return { render, get dock() { return fx.dock; }, setReduced(v) { reducedMotion = !!v; } };
}
