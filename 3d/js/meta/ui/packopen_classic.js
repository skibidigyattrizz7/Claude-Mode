// CLASSIC pack opening (kept so the owner can revert via the `packAnim: 'classic'` setting):
// 3D tunnel glide -> pack shake -> rip open -> (walkout: 3D player -> flag -> position -> club) ->
// card reveal (flip) -> item grid. The tunnel/walkout is Three.js (walkout3d.js TunnelScene).
import { h, clear, frag } from './dom.js';
import { playerCard } from './card.js';
import { flagSVG, crestSVG } from './art.js';
import { NATION_BY_CODE, clubById } from '../core/data.js';
import { isWalkout } from '../core/ut.js';
import { PROMO_BY_ID } from '../core/promos.js';
import { TunnelScene, supports3D } from './walkout3d.js';
import { FLARE, SPECIAL_FLARE, SPECIAL_BADGE, walkoutKit, ensureCss, packArt, positionName, makeGrid, animToggle } from './packopen_common.js';

// The card is 3D-rendered / promoted "unmistakably" from ovr 86 up.
const WALKOUT3D_OVR = 86;

// ---------------------------------------------------------------- per-promo / per-special themes
// Each entry: tunnel wall colour, beam/particle colours, an audio "sting" recipe. Unknown promo ids
// (or specials not listed) fall back to DEFAULT_THEME, keyed off the pack's own rarity flare colour.
const PROMO_THEME = {
  toty: { wall: '#0a1740', beam: '#5b8bff', particles: ['#2f6bff', '#dfe9ff', '#ffffff'], sting: { wave: 'triangle', freq: [220, 440, 660] } },
  tots: { wall: '#083244', beam: '#37d6f2', particles: ['#19c3e6', '#d9fbff', '#ffffff'], sting: { wave: 'sine', freq: [260, 520, 780] } },
  futurestars: { wall: '#220a44', beam: '#c976ff', particles: ['#b44dff', '#ffd9fb', '#ffffff'], sting: { wave: 'sawtooth', freq: [196, 392, 588] } },
  flashback: { wall: '#331a08', beam: '#f0a94e', particles: ['#e0892b', '#ffe8c7', '#ffffff'], sting: { wave: 'square', freq: [174, 349, 523] } },
  birthday: { wall: '#42092a', beam: '#ff7fb8', particles: ['#ff4f9a', '#ffe0ef', '#ffffff'], sting: { wave: 'sine', freq: [392, 494, 659] } },
  rttk: { wall: '#062a1c', beam: '#3fe89a', particles: ['#18d17b', '#d7ffe9', '#ffffff'], sting: { wave: 'triangle', freq: [220, 330, 440] } },
  moments: { wall: '#2a2a2a', beam: '#ffffff', particles: ['#f2f2f2', '#ffffff', '#cfcfcf'], sting: { wave: 'sine', freq: [440, 554, 659] } },
};
const SPECIAL_THEME = {
  legend: { wall: '#2a1c04', beam: '#ffd35a', particles: ['#fff2c4', '#ffe08a', '#ffffff'], sting: { wave: 'sine', freq: [196, 247, 294] } },
  lotg: { wall: '#1a1204', beam: '#ffd35a', particles: ['#ffcc33', '#fff6d8', '#ff9f1c'], sting: { wave: 'sawtooth', freq: [130, 260, 520] } },
  hero: { wall: '#063c34', beam: '#54ffe0', particles: ['#27e1c1', '#c8fff2', '#ffffff'], sting: { wave: 'square', freq: [233, 349, 466] } },
  inform: { wall: '#2a1a00', beam: '#ffcc55', particles: ['#ffb300', '#ffe08a', '#ffffff'], sting: { wave: 'triangle', freq: [261, 329, 392] } },
  objective: { wall: '#083041', beam: '#8ff0ff', particles: ['#6ee7ff', '#d9fbff', '#ffffff'], sting: { wave: 'sine', freq: [293, 369, 440] } },
  // Reserved for future card types (Secret / Admin-issued cards): themed now so they never fall back silently.
  secret: { wall: '#141414', beam: '#ff2d55', particles: ['#ff003c', '#ffffff', '#8a8a8a'], sting: { wave: 'sawtooth', freq: [110, 220, 330] } },
  admin: { wall: '#0b1220', beam: '#93c5fd', particles: ['#ffffff', '#94a3b8', '#38bdf8'], sting: { wave: 'square', freq: [440, 880, 660] } },
};
function themeFor(best, promo) {
  if (promo && PROMO_THEME[promo.id]) return PROMO_THEME[promo.id];
  if (best.special && SPECIAL_THEME[best.special]) return SPECIAL_THEME[best.special];
  return { wall: '#0b1120', beam: null, particles: null, sting: { wave: 'sine', freq: [220, 330, 440] } };
}

class Particles {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.ps = []; this.emitters = []; this.raf = 0; this.alive = true;
    this.resize = this.resize.bind(this);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.c.getBoundingClientRect();
    this.w = r.width || window.innerWidth; this.h = r.height || window.innerHeight;
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  burst(color, count = 160, speed = 9, x = null, y = null, colors = null) {
    x = x ?? this.w / 2; y = y ?? this.h / 2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed + 1.5;
      this.ps.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, life: 1, decay: 0.008 + Math.random() * 0.014, size: 1 + Math.random() * 3.2, color: colors ? colors[i % colors.length] : color, streak: Math.random() < 0.5 });
    }
  }
  fountain(color, ms = 2500, colors = null) {
    const until = performance.now() + ms;
    this.emitters.push({ color, until, colors });
  }
  loop() {
    if (!this.alive) return;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const now = performance.now();
    this.emitters = this.emitters.filter((e) => e.until > now);
    for (const e of this.emitters) {
      for (let k = 0; k < 4; k++) {
        const side = Math.random() < 0.5 ? 0.12 : 0.88;
        this.ps.push({ x: this.w * side, y: this.h + 5, vx: (0.5 - side) * (4 + Math.random() * 5), vy: -(9 + Math.random() * 7), life: 1, decay: 0.01 + Math.random() * 0.01, size: 1.4 + Math.random() * 2.6, color: e.colors ? e.colors[Math.floor(Math.random() * e.colors.length)] : e.color, streak: true });
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.ps) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.16; p.vx *= 0.985; p.life -= p.decay;
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
      if (p.streak) {
        ctx.lineWidth = p.size * 0.8;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.ps = this.ps.filter((p) => p.life > 0);
    this.raf = requestAnimationFrame(this.loop);
  }
  destroy() { this.alive = false; cancelAnimationFrame(this.raf); window.removeEventListener('resize', this.resize); }
}

// Stage chains after the tunnel/rip cinematic: kinds shown in order; gaps[i] is the wait (ms) after
// showing kinds[i] before the next one (the last gap is the wait before the card reveal).
const STAGE_PLANS = {
  plain: { kinds: [], gaps: [] },
  walk: { kinds: ['flag', 'pos', 'club'], gaps: [1500, 1200, 1500] },
  lotg: { kinds: ['lotg', 'flag', 'pos', 'club'], gaps: [1900, 1600, 1300, 1500] },
  promo: { kinds: ['promo', 'flag', 'pos', 'club'], gaps: [1800, 1400, 1200, 1400] },
};

/**
 * root: container to append the overlay into
 * opts: { pack, items:[{pid, dup}], getPlayer, sellValue(p), onSend(pid), onSell(pid)->coins, onDone(summary),
 *         userKit?:{primary,secondary,shorts?,socks?} — user's club colours for the 3D walkout kit }
 */
export function runClassic(root, opts) {
  ensureCss(root);
  const { pack, items, getPlayer } = opts;
  const players = items.map((it) => ({ ...it, p: getPlayer(it.pid), state: 'new' }));
  const best = players[0].p;
  const walk = isWalkout(best); // gates the flag/pos/club stage chain (unchanged threshold)
  const walk3d = best.ovr >= WALKOUT3D_OVR; // gates the unmistakable 3D player walkout
  const flareKey = walk ? 'walkout' : best.tier;
  const lotg = best.special === 'lotg';
  const promo = PROMO_BY_ID[best.special] && best.ovr >= 86 ? PROMO_BY_ID[best.special] : null;
  const flare = lotg ? '#ffcc33' : promo ? promo.colors[1] : FLARE[flareKey];
  const accent = best.special ? SPECIAL_FLARE[best.special] : flare;
  const theme = themeFor(best, promo);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = reduce ? 0.45 : 1;
  const cancels = [];
  const wait = (ms) => new Promise((resolve) => {
    const id = setTimeout(resolve, Math.max(0, ms));
    cancels.push(() => { clearTimeout(id); resolve(); });
  });
  let particles = null;
  let phase = 'pack';
  let stopped = false;
  let scene = null;

  const bgEl = h('div', { class: 'pm-po-bg' });
  const canvas = h('canvas', { class: 'pm-po-canvas', 'aria-hidden': 'true' });
  const canvas3d = h('canvas', { class: 'pm-po-3d', 'aria-hidden': 'true' });
  const rays = h('div', { class: 'pm-po-rays', 'aria-hidden': 'true' });
  const flash = h('div', { class: 'pm-po-flash', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'pm-po-stage' });
  const skipBtn = h('button', { class: 'pm-po-skip pm-btn pm-btn--ghost', onclick: () => toGrid() }, 'Skip ›');
  const ov = h('div', { class: 'pm-po', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Opening ${pack.name}`, style: { '--flare': flare, '--accent': accent } },
    bgEl, rays, canvas, canvas3d, flash, stage, skipBtn);
  root.appendChild(ov);
  particles = new Particles(canvas);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (phase !== 'grid') toGrid(); }
  };
  document.addEventListener('keydown', onKey, true);

  // ---- phase 1: pack ----
  const packEl = packArt(pack, 'lg');
  const openBtn = h('button', { class: 'pm-po-packbtn', 'aria-label': `Open ${pack.name}`, onclick: start }, packEl, h('div', { class: 'pm-po-tap' }, 'Tap to open'));
  stage.appendChild(h('div', { class: 'pm-po-center' }, openBtn));
  const toggle = opts.onSwitchAnim ? animToggle('classic', (m) => opts.onSwitchAnim(m)) : null;
  if (toggle) ov.appendChild(toggle);
  setTimeout(() => openBtn.focus(), 30);

  function sideFireworks(count) {
    particles.burst(accent, count, 5, particles.w * 0.14, particles.h * 0.45, [accent, flare]);
    particles.burst(accent, count, 5, particles.w * 0.86, particles.h * 0.45, [accent, flare]);
  }

  async function start() {
    if (phase !== 'pack') return;
    phase = 'intro';
    openBtn.disabled = true;
    if (toggle) toggle.remove();
    ov.classList.add('is-shaking');
    if (lotg) ov.classList.add('is-lotg');
    if (promo) { ov.classList.add('is-promo', `promo-${promo.id}`); ov.style.setProperty('--pa', promo.colors[0]); ov.style.setProperty('--pb', promo.colors[1]); ov.style.setProperty('--pc', promo.colors[2]); }
    packEl.classList.add('shake');

    if (!reduce && supports3D()) {
      try { scene = new TunnelScene(canvas3d, { theme, flare, accent }); } catch { scene = null; }
    }
    if (scene) {
      clear(stage); // the 3D canvas takes over from the 2D pack button
      ov.classList.add('is-3d');
      canvas3d.classList.add('show');
      try {
        cancels.push(() => scene && scene.skipAll());
        await scene.introSequence();
        if (!stopped) {
          flash.classList.add('go');
          particles.burst(flare, reduce ? 60 : 200, walk ? 13 : 9, null, null, walk ? [flare, accent, '#ffffff'] : null);
        }
        if (walk3d && !stopped) {
          ov.classList.add('is-walkout3d');
          await scene.walkoutSequence(best, walkoutKit(best, opts.userKit));
        }
        if (!stopped && scene) scene.hold();
      } catch (error) {
        console.warn('Pack cinematic unavailable; continuing with card reveal.', error);
        if (scene) { scene.dispose(); scene = null; }
        canvas3d.classList.remove('show');
        ov.classList.remove('is-3d');
      } finally {
        ov.classList.remove('is-walkout3d');
      }
    } else {
      // No WebGL / reduced motion: cheap legacy shake -> burst instead of the tunnel cinematic.
      await wait(reduce ? 480 : 1150);
      if (!stopped) {
        packEl.classList.add('burst');
        flash.classList.add('go');
        particles.burst(flare, reduce ? 40 : 160, walk ? 11 : 7, null, null, walk ? [flare, accent, '#ffffff'] : null);
        await wait(reduce ? 200 : 450);
      }
      clear(stage);
    }
    if (stopped) return;

    phase = 'flare';
    ov.classList.add('is-flare', `flare-${flareKey}`);
    const plan = promo ? STAGE_PLANS.promo : lotg ? STAGE_PLANS.lotg : walk ? STAGE_PLANS.walk : STAGE_PLANS.plain;
    if (!plan.kinds.length) { if (!reduce) sideFireworks(24); await wait(350 * T); if (stopped) return; }
    await runStages(plan);
  }

  async function runStages(plan) {
    for (let i = 0; i < plan.kinds.length; i++) {
      showStage(plan.kinds[i]);
      await wait(plan.gaps[i] * T);
      if (stopped) return;
    }
    revealCard();
  }

  function showStage(kind) {
    phase = kind;
    clear(stage);
    let inner;
    if (kind === 'promo') {
      inner = h('div', { class: 'pm-wo pm-wo-promo' }, h('div', { class: 'pm-wo-promotitle' }, promo.short, h('small', null, promo.name.toUpperCase())), h('div', { class: 'pm-wo-label' }, best.moment || promo.desc));
    } else if (kind === 'lotg') {
      inner = h('div', { class: 'pm-wo pm-wo-lotg' }, h('div', { class: 'pm-wo-lotgtitle' }, 'LEGEND', h('small', null, 'OF THE GAME')), h('div', { class: 'pm-wo-label' }, best.era === 'prime' ? 'Prime' : 'Real-world star'));
    } else if (kind === 'flag') {
      const n = NATION_BY_CODE[best.nat];
      inner = h('div', { class: 'pm-wo pm-wo-flag' }, frag(flagSVG(best.nat, 'pm-wo-flagsvg')), h('div', { class: 'pm-wo-label' }, n ? n.name : best.nat));
    } else if (kind === 'pos') {
      inner = h('div', { class: 'pm-wo pm-wo-pos' }, h('div', { class: 'pm-wo-big' }, best.pos), h('div', { class: 'pm-wo-label' }, positionName(best.pos)));
    } else {
      const c = clubById(best.club);
      inner = h('div', { class: 'pm-wo pm-wo-club' }, frag(crestSVG(c || best.club, 'pm-wo-crest')), h('div', { class: 'pm-wo-label' }, c ? c.name : best.club));
    }
    stage.appendChild(h('div', { class: 'pm-po-center' }, inner));
    particles.burst(accent, reduce ? 20 : 50, 5);
  }

  function revealCard() {
    if (stopped) return;
    phase = 'reveal';
    ov.classList.add('is-card-reveal');
    clear(stage);
    const card = playerCard(best, { size: 'lg', className: 'pm-reveal flip-in' });
    const cont = h('button', { class: 'pm-btn pm-btn--primary pm-po-continue', onclick: () => toGrid() }, 'Continue');
    stage.appendChild(h('div', { class: 'pm-po-center pm-po-revealwrap' },
      h('div', { class: 'pm-po-glow' }), card,
      h('div', { class: 'pm-po-revealname' }, best.name, best.special ? h('span', { class: `pm-sp-badge sp-${best.special}` }, SPECIAL_BADGE[best.special] || best.special) : null),
      cont));
    particles.burst(accent, reduce ? 50 : 200, 11, null, null, [accent, flare, '#ffffff']);
    if (walk && !reduce) particles.fountain(accent, lotg || promo ? 5200 : 2600, promo ? promo.colors.concat('#ffffff') : [accent, flare, '#ffffff']);
    setTimeout(() => cont.focus(), 50);
  }

  function toGrid() {
    if (phase === 'grid') return;
    phase = 'grid';
    stopped = true;
    cancels.forEach((c) => c()); cancels.length = 0;
    if (scene) { scene.dispose(); scene = null; }
    canvas3d.classList.remove('show');
    ov.classList.remove('is-shaking');
    ov.classList.add('is-grid', 'is-flare', `flare-${flareKey}`);
    skipBtn.remove();
    renderGrid();
  }

  const grid = makeGrid(stage, pack, players, opts, destroy);
  function renderGrid() { grid.render(); }
  function destroy() {
    stopped = true;
    cancels.forEach((c) => c()); cancels.length = 0;
    document.removeEventListener('keydown', onKey, true);
    if (scene) { scene.dispose(); scene = null; }
    if (particles) particles.destroy();
    ov.remove();
  }
  return { destroy, skip: toGrid };
}
