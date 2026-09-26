// NEW pack opening (default; `packAnim: 'new'`) — FUT 17/18/19 style, see docs/PACK_BRIEF.md:
// black fade -> dark stadium stage with a glowing floor line -> pack rips open from the top -> rarity
// coloured light column / spark shower -> hidden card rises -> (walkouts: two banners slide in and reveal
// nation flag -> position + rating -> spinning club crest coin -> fireworks + floor smoke) -> card flips ->
// (walkouts only, lazy, optional) the 3D player walks in beside the card, celebrates once and stands.
// Everything is DOM/CSS transforms plus ONE 2D canvas for particles; the 3D figure is a small separate
// WebGL canvas loaded on demand at the very end and never blocks the flow. Skippable at any time.
import { h, clear, frag } from './dom.js';
import { playerCard } from './card.js';
import { flagSVG, crestSVG } from './art.js';
import { NATION_BY_CODE, clubById } from '../core/data.js';
import { PROMO_BY_ID } from '../core/promos.js';
import { SPECIAL_BADGE, walkoutKit, pseudoNumber, ensureCss, packArt, positionName, makeGrid, animToggle } from './packopen_common.js';
import { classifyPull, buildPackSequence } from './packopen_seq.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ---------------------------------------------------------------- particles (single 2D canvas)
class Sparks {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.ps = []; this.emitters = []; this.alive = true; this.dirty = false; this.last = performance.now();
    this.resize = this.resize.bind(this); this.loop = this.loop.bind(this);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.loop);
  }
  resize() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const r = this.c.getBoundingClientRect();
    this.w = r.width || window.innerWidth; this.h = r.height || window.innerHeight;
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  _push(p) { if (this.ps.length < 900) this.ps.push(p); }
  /** Radial burst of streak sparks. */
  burst(x, y, colors, count = 80, speed = 7, gravity = 0.12) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.3, 1) * speed;
      this._push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: gravity, drag: 0.975, life: 1, decay: rand(0.012, 0.028), size: rand(1, 2.6), color: pick(colors), streak: true });
    }
  }
  /** Sparks spat upward from a tear point (the pack rip). */
  spray(x, y, colors, count = 6) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + rand(-1.1, 1.1), s = rand(2, 7);
      this._push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.22, drag: 0.98, life: 1, decay: rand(0.02, 0.045), size: rand(0.8, 2), color: pick(colors), streak: true });
    }
  }
  /** Falling glitter over [x0, x1] for `ms` — the "gold rain". */
  rain(x0, x1, colors, ms, rate) { this.emitters.push({ type: 'rain', x0, x1, colors, until: performance.now() + ms, rate }); }
  /** Sparks rising inside the light column. */
  column(x, w, yTop, yBottom, colors, ms, rate) { this.emitters.push({ type: 'col', x, w, yTop, yBottom, colors, until: performance.now() + ms, rate }); }
  /** Rockets from the floor that explode into bursts. */
  fireworks(xs, yFloor, colors, ms, every = 380) { this.emitters.push({ type: 'fw', xs, yFloor, colors, until: performance.now() + ms, every, next: 0 }); }
  loop(now) {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.loop);
    const f = Math.min(3, Math.max(0.25, (now - this.last) / 16.67)); this.last = now;
    const { ctx } = this;
    this.emitters = this.emitters.filter((e) => e.until > now);
    for (const e of this.emitters) {
      if (e.type === 'rain') {
        for (let k = 0; k < e.rate * f; k++) this._push({ x: rand(e.x0, e.x1), y: rand(-20, this.h * 0.15), vx: rand(-0.4, 0.4), vy: rand(1.2, 3.2), g: 0.03, drag: 0.995, life: 1, decay: rand(0.006, 0.012), size: rand(0.8, 2.2), color: pick(e.colors), streak: Math.random() < 0.55, tw: Math.random() * 6 });
      } else if (e.type === 'col') {
        for (let k = 0; k < e.rate * f; k++) this._push({ x: e.x + rand(-e.w, e.w) * 0.5, y: rand(e.yBottom - 30, e.yBottom), vx: rand(-0.3, 0.3), vy: -rand(3, 9), g: -0.02, drag: 0.99, life: 1, decay: rand(0.012, 0.025), size: rand(0.8, 2.2), color: pick(e.colors), streak: true });
      } else if (e.type === 'fw' && now >= e.next) {
        e.next = now + e.every * rand(0.7, 1.3);
        this._push({ x: pick(e.xs) + rand(-30, 30), y: e.yFloor, vx: rand(-0.8, 0.8), vy: -rand(9, 12.5), g: 0.16, drag: 0.995, life: 1, decay: 0.004, size: 2.2, color: '#ffffff', streak: true, rocket: true, colors: e.colors });
      }
    }
    if (!this.ps.length) { if (this.dirty) { ctx.clearRect(0, 0, this.w, this.h); this.dirty = false; } return; }
    ctx.clearRect(0, 0, this.w, this.h); this.dirty = true;
    ctx.globalCompositeOperation = 'lighter';
    const out = [];
    for (const p of this.ps) {
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g * f;
      p.x += p.vx * f; p.y += p.vy * f; p.life -= p.decay * f;
      if (p.rocket && (p.vy > -1.2 || p.life < 0.6)) { this.burst(p.x, p.y, p.colors, 70, 6.5, 0.06); continue; }
      if (p.life <= 0 || p.y > this.h + 20) continue;
      out.push(p);
      let a = Math.min(1, p.life * 1.4);
      if (p.tw !== undefined) a *= 0.55 + 0.45 * Math.sin(now / 90 + p.tw);
      ctx.globalAlpha = a;
      if (p.streak) {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4); ctx.stroke();
      } else {
        ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    this.ps = out;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  clearAll() { this.ps.length = 0; this.emitters.length = 0; }
  destroy() { this.alive = false; cancelAnimationFrame(this.raf); window.removeEventListener('resize', this.resize); }
}

// ---------------------------------------------------------------- tiny synthesised sound effects
class Sfx {
  constructor() { this.ctx = null; this.out = null; }
  _ctx() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { this.ctx = new AC(); this.out = this.ctx.createGain(); this.out.gain.value = 0.35; this.out.connect(this.ctx.destination); } catch { this.ctx = null; }
    return this.ctx;
  }
  _noise(ms, type, freq, peak, sweepTo) {
    const ctx = this._ctx(); if (!ctx) return;
    try {
      const len = Math.max(1, Math.round(ctx.sampleRate * ms / 1000));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = 0.8;
      const g = ctx.createGain(); const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + ms / 1000);
      src.connect(fl).connect(g).connect(this.out); src.start(t); src.stop(t + ms / 1000 + 0.05);
    } catch { /* ignore */ }
  }
  _tone(f0, f1, ms, peak, wave = 'sine', delay = 0) {
    const ctx = this._ctx(); if (!ctx) return;
    try {
      const o = ctx.createOscillator(); o.type = wave; const g = ctx.createGain(); const t = ctx.currentTime + delay;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + ms / 1000);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + ms / 1000 + 0.05);
    } catch { /* ignore */ }
  }
  unlock() { this._ctx(); }
  riser() { this._noise(900, 'bandpass', 300, 0.25, 2400); }
  rip() { this._noise(420, 'highpass', 1800, 0.5, 5000); }
  boom(big) { this._tone(120, 38, big ? 900 : 500, big ? 0.9 : 0.5); this._noise(big ? 700 : 350, 'lowpass', 900, big ? 0.5 : 0.25, 120); }
  hit() { this._tone(180, 60, 380, 0.6); this._noise(200, 'bandpass', 2600, 0.18); }
  sting() { [392, 523, 659, 784].forEach((f, i) => this._tone(f, f * 1.01, 700, 0.14, 'triangle', i * 0.07)); }
  pop() { this._noise(260, 'bandpass', 1400, 0.22, 400); }
  dispose() { try { this.ctx && this.ctx.close(); } catch { /* ignore */ } this.ctx = null; }
}

function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
/** Remove + re-add a class so its CSS animation plays again. */
function retrigger(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

/**
 * Same contract as runPackOpening (see packopen.js). opts.onSwitchAnim(mode) switches to the classic animation
 * before the pack is opened.
 */
export function runFut(root, opts) {
  ensureCss(root);
  const { pack, items, getPlayer } = opts;
  const players = items.map((it) => ({ ...it, p: getPlayer(it.pid), state: 'new' }));
  const best = players[0].p;
  const pull = classifyPull(best, PROMO_BY_ID);
  const promo = pull.promoId ? PROMO_BY_ID[pull.promoId] : null;
  const [cDark, cMain, cLight] = pull.colors;
  const sparkCols = [cMain, cLight, '#ffffff'];
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wantFigure = pull.walkout && !reduce && webglOk();
  const steps = buildPackSequence(pull, { reduce, figure: wantFigure });
  const nation = NATION_BY_CODE[best.nat];
  const club = clubById(best.club);
  const sfx = new Sfx();

  let phase = 'ready'; // ready -> playing -> reveal -> grid
  const timers = [];
  let ripRaf = 0;
  let figure = null, figPromise = null;

  // ---------------- DOM
  const bgEl = h('div', { class: 'pm-po-bg' });
  const rays = h('div', { class: 'pm-po-rays', 'aria-hidden': 'true' });
  const canvas = h('canvas', { class: 'pk2-canvas', 'aria-hidden': 'true' });
  const black = h('div', { class: 'pk2-black', 'aria-hidden': 'true' });
  const flash = h('div', { class: 'pk2-flash', 'aria-hidden': 'true' });
  const smoke = h('div', { class: 'pk2-smoke', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4, 5, 6].map((i) => h('i', { style: { '--i': i } })));

  const banner = (side) => h('div', { class: `pk2-banner ${side}`, 'aria-hidden': 'true' },
    h('div', { class: 'pk2-bn-in' },
      h('div', { class: 'pk2-bn-lamps' }),
      h('div', { class: 'pk2-bn-base' }, h('span', null, 'P')),
      h('div', { class: 'pk2-bn-promo' }, promo ? promo.tag : pull.prestige ? (best.special === 'lotg' ? 'LEGEND OF THE GAME' : 'CLASSIC') : ''),
      h('div', { class: 'pk2-bn-flag' }, frag(flagSVG(best.nat, 'pk2-flagsvg'))),
      h('div', { class: 'pk2-bn-top' }, h('b', null, String(best.ovr)), h('span', null, best.pos)),
      h('div', { class: 'pk2-bn-crest' }, frag(crestSVG(club || best.club, 'pk2-crestsvg')))));
  const bannerL = banner('l'), bannerR = banner('r');

  // pack: body + a top foil strip that tears off (two clipped copies of the same art)
  const packBody = packArt(pack, 'lg'); packBody.classList.add('pk2-pbody');
  const packStrip = packArt(pack, 'lg'); packStrip.classList.add('pk2-pstrip');
  const tear = h('div', { class: 'pk2-tear' });
  const packWrap = h('div', { class: 'pk2-pack' }, packBody, packStrip, tear);

  // hidden card (back) + the real card (front) for the flip
  const back = h('div', { class: 'pk2-back' },
    h('div', { class: 'pk2-bk-in' },
      h('div', { class: 'pk2-bk-mark' }, 'P'),
      h('div', { class: 'pk2-bk-ovr' }, h('b', null, String(best.ovr)), h('span', null, best.pos)),
      h('div', { class: 'pk2-bk-flag' }, frag(flagSVG(best.nat, 'pk2-flagsvg'))),
      h('div', { class: 'pk2-bk-crest' }, frag(crestSVG(club || best.club, 'pk2-crestsvg')))));
  const front = h('div', { class: 'pk2-front' }, playerCard(best, { size: 'lg' }));
  const cardWrap = h('div', { class: 'pk2-card' }, back, front);
  const coin = h('div', { class: 'pk2-coin', 'aria-hidden': 'true' }, h('div', { class: 'pk2-coin-face' }, frag(crestSVG(club || best.club, 'pk2-crestsvg'))));
  const caption = h('div', { class: 'pk2-caption', 'aria-live': 'polite' });
  const tap = h('div', { class: 'pk2-tap' }, 'Tap to open');
  const center = h('div', { class: 'pk2-center' }, cardWrap, packWrap, coin);
  const figCanvas = h('canvas', { class: 'pk2-figcanvas', 'aria-hidden': 'true' });
  const figWrap = h('div', { class: 'pk2-fig', 'aria-hidden': 'true' }, h('div', { class: 'pk2-figshadow' }), figCanvas);
  const cont = h('button', { class: 'pm-btn pm-btn--primary pk2-continue', onclick: (e) => { e.stopPropagation(); toGrid(); } }, 'Continue');
  const reveal = h('div', { class: 'pk2-reveal' },
    h('div', { class: 'pk2-revealname' }, best.name, best.special ? h('span', { class: `pm-sp-badge sp-${best.special}` }, SPECIAL_BADGE[best.special] || best.special) : null),
    cont);

  const cam = h('div', { class: 'pk2-cam' },
    h('div', { class: 'pk2-sky' }), h('div', { class: 'pk2-stands' }), h('div', { class: 'pk2-rig' }), h('div', { class: 'pk2-cones' }),
    h('div', { class: 'pk2-floor' }, h('div', { class: 'pk2-line' })),
    h('div', { class: 'pk2-column' }), smoke, bannerL, bannerR, figWrap, center, caption, tap, reveal);
  const scene = h('div', { class: 'pk2-scene' }, cam);
  const skipBtn = h('button', { class: 'pm-po-skip pm-btn pm-btn--ghost', onclick: (e) => { e.stopPropagation(); toGrid(); } }, 'Skip ›');
  const toggle = opts.onSwitchAnim ? animToggle('new', (m) => opts.onSwitchAnim(m)) : null;
  const ov = h('div', {
    class: `pm-po pk2 lvl-${pull.level} ${pull.walkout ? 'is-walk' : ''} k-${pull.key}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': `Opening ${pack.name}`,
    style: { '--c1': cDark, '--c2': cMain, '--c3': cLight, '--flare': cMain, '--accent': cMain },
  }, bgEl, rays, scene, canvas, flash, black, skipBtn, toggle);
  root.appendChild(ov);
  const sparks = new Sparks(canvas);
  ov.tabIndex = -1;
  setTimeout(() => { try { if (phase === 'ready') ov.focus({ preventScroll: true }); } catch { /* ignore */ } }, 30);
  requestAnimationFrame(() => ov.classList.add('s-in'));

  // ---------------- input: tap/Space opens, then tap/Space skips to the reveal; Esc -> summary
  const onKey = (e) => {
    if (phase === 'grid') return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toGrid(); return; }
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') {
      if (e.target && e.target.tagName === 'BUTTON' && ov.contains(e.target) && phase !== 'playing') return; // let the overlay's own focused buttons work
      e.preventDefault(); e.stopPropagation();
      if (phase === 'ready') start(); else if (phase === 'playing') toReveal(); else if (phase === 'reveal') toGrid();
    }
  };
  document.addEventListener('keydown', onKey, true);
  scene.addEventListener('click', () => { if (phase === 'ready') start(); else if (phase === 'playing') toReveal(); });

  // ---------------- helpers
  const at = (ms, fn) => { const id = setTimeout(() => { try { fn(); } catch (err) { console.warn('pack beat failed', err); toReveal(); } }, Math.max(0, ms)); timers.push(id); };
  const cancelTimers = () => { timers.forEach(clearTimeout); timers.length = 0; cancelAnimationFrame(ripRaf); };
  const rectOf = (el) => { const r = el.getBoundingClientRect(), o = ov.getBoundingClientRect(); return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }; };
  const shake = (big) => { retrigger(cam, big ? 'shake-big' : 'shake'); };
  const punch = (el) => retrigger(el, 'punch');
  const say = (text, sub) => { clear(caption); caption.appendChild(h('b', null, text)); if (sub) caption.appendChild(h('small', null, sub)); retrigger(caption, 'show'); };
  const setState = (cls) => ov.classList.add(cls);

  function start() {
    if (phase !== 'ready') return;
    phase = 'playing';
    sfx.unlock();
    if (toggle) toggle.remove();
    setState('s-go');
    if (wantFigure) {
      // Lazy: fetch three.js + the rig now so it is (probably) ready by the end; never awaited by the beats.
      figPromise = import('./walkout3d.js').catch((err) => { console.warn('3D walkout unavailable', err); return null; });
    }
    for (const s of steps) at(s.at, () => beat(s.kind, s.dur));
  }

  function beat(kind, dur) {
    if (phase !== 'playing' && !(kind === 'figure' && phase === 'reveal')) return;
    const lv = pull.level;
    switch (kind) {
      case 'rise': setState('s-rise'); if (lv >= 1) sfx.riser(); break;
      case 'tension': setState('s-tense'); break;
      case 'rip': {
        setState('s-rip'); sfx.rip();
        const t0 = performance.now(), tearMs = dur * 0.62;
        const step = (now) => {
          const u = Math.min(1, (now - t0) / tearMs);
          const r = rectOf(packWrap);
          sparks.spray(r.x + r.w * (0.04 + 0.92 * u), r.y + r.h * 0.13, lv ? sparkCols : ['#ffffff', '#dfe6f2'], lv >= 2 ? 5 : 3);
          if (u < 1 && phase === 'playing') ripRaf = requestAnimationFrame(step);
        };
        ripRaf = requestAnimationFrame(step);
        break;
      }
      case 'burst': {
        setState('s-open'); sfx.boom(lv >= 2);
        const r = rectOf(packWrap), cx = r.x + r.w / 2;
        if (lv >= 1) retrigger(flash, 'go');
        sparks.burst(cx, r.y + r.h * 0.15, lv ? sparkCols : ['#ffffff', '#c9d3de'], [26, 60, 110, 150][lv], [4, 6, 8, 9][lv]);
        if (lv >= 1) sparks.column(cx, r.w * 0.8, 0, r.y + r.h * 0.4, sparkCols, lv === 1 ? 900 : 1800, lv >= 3 ? 3 : 2);
        if (lv >= 2) sparks.rain(sparks.w * (lv >= 3 ? 0.18 : 0.3), sparks.w * (lv >= 3 ? 0.82 : 0.7), sparkCols, lv >= 3 ? 5200 : 2600, lv >= 3 ? 3 : 1.6);
        if (lv >= 2) shake(false);
        break;
      }
      case 'card': setState('s-card'); break;
      case 'banners': setState('s-banners'); sfx.hit(); shake(false); break;
      case 'promo': setState('s-promo'); sfx.hit(); shake(true); punch(bannerL); punch(bannerR);
        say(promo ? promo.name : best.special === 'lotg' ? 'Legend of the Game' : 'Classic', best.moment || (promo && promo.desc) || '');
        break;
      case 'flag': {
        setState('s-flag'); sfx.hit();
        if (pull.walkout) { shake(true); punch(bannerL); punch(bannerR); sideBursts(40); }
        punch(back);
        say(nation ? nation.name : best.nat);
        break;
      }
      case 'rating': setState('s-rating'); sfx.hit(); shake(true); punch(bannerL); punch(bannerR); punch(back); sideBursts(40); say(`${best.ovr} ${best.pos}`, positionName(best.pos)); break;
      case 'club': {
        setState('s-coin'); sfx.riser(); say(club ? club.name : String(best.club));
        at(dur * 0.66, () => { if (phase !== 'playing') return; setState('s-club'); sfx.hit(); shake(true); punch(bannerL); punch(bannerR); punch(back); sideBursts(50); });
        break;
      }
      case 'fireworks': {
        setState('s-lit'); sfx.pop();
        const floorY = sparks.h * 0.74;
        sparks.fireworks([sparks.w * 0.12, sparks.w * 0.3, sparks.w * 0.7, sparks.w * 0.88], floorY, sparkCols, 6000, 330);
        caption.classList.remove('show');
        break;
      }
      case 'flip': flip(); break;
      case 'figure': startFigure(); break;
      default: break;
    }
  }

  function sideBursts(n) {
    const a = rectOf(bannerL), b = rectOf(bannerR);
    if (a.w) sparks.burst(a.x + a.w / 2, a.y + a.h * 0.35, sparkCols, n, 6);
    if (b.w) sparks.burst(b.x + b.w / 2, b.y + b.h * 0.35, sparkCols, n, 6);
  }

  function flip() {
    phase = 'reveal';
    setState('s-flip'); caption.classList.remove('show');
    sfx.boom(pull.walkout); sfx.sting();
    retrigger(flash, 'go');
    const r = rectOf(cardWrap);
    sparks.burst(r.x + r.w / 2, r.y + r.h / 2, sparkCols, [30, 70, 120, 180][pull.level], [5, 7, 9, 11][pull.level]);
    if (!pull.walkout && pull.level >= 1) sparks.fireworks([sparks.w * 0.15, sparks.w * 0.85], sparks.h * 0.74, sparkCols, 1300, 420);
    at(550, () => { if (phase === 'reveal') { setState('s-done'); cont.focus({ preventScroll: true }); } });
  }

  function startFigure() {
    if (!figPromise || figure) return;
    const deadline = performance.now() + 2500; // too slow (first load on a slow network) -> just skip the figure
    figPromise.then((mod) => {
      if (!mod || phase !== 'reveal' || performance.now() > deadline) return;
      try {
        figure = new mod.WalkoutFigure(figCanvas, { player: { ...best, number: pseudoNumber(best) }, kit: walkoutKit(best, opts.userKit), accent: cMain });
        setState('s-fig');
        figure.play();
      } catch (err) {
        console.warn('3D walkout figure unavailable; card reveal continues.', err);
        if (figure) { figure.dispose(); figure = null; }
        ov.classList.remove('s-fig');
      }
    });
  }

  /** Jump straight to the final reveal (tap/Space during the cinematic). */
  function toReveal() {
    if (phase !== 'playing') return;
    cancelTimers();
    phase = 'reveal';
    if (toggle) toggle.remove();
    ov.classList.add('s-go', 's-rise', 's-open', 's-card', 's-skipped');
    if (pull.walkout) ov.classList.add('s-banners', 's-flag', 's-rating', 's-club', 's-lit');
    ov.classList.add('s-flag');
    sparks.clearAll();
    caption.classList.remove('show');
    setState('s-flip');
    const r = rectOf(cardWrap);
    sparks.burst(r.x + r.w / 2, r.y + r.h / 2, sparkCols, [20, 40, 70, 110][pull.level], [5, 6, 8, 9][pull.level]);
    setState('s-done');
    setTimeout(() => cont.focus({ preventScroll: true }), 30);
  }

  function toGrid() {
    if (phase === 'grid') return;
    phase = 'grid';
    cancelTimers();
    if (figure) { figure.dispose(); figure = null; }
    sparks.clearAll();
    scene.remove(); skipBtn.remove(); if (toggle) toggle.remove();
    ov.classList.add('is-grid', 'is-flare', `flare-${pull.walkout ? 'walkout' : best.tier}`);
    ov.appendChild(stage);
    grid.render();
  }

  const stage = h('div', { class: 'pm-po-stage' });
  function destroy() {
    phase = 'grid';
    cancelTimers();
    document.removeEventListener('keydown', onKey, true);
    if (figure) { figure.dispose(); figure = null; }
    sparks.destroy(); sfx.dispose();
    ov.remove();
  }
  const grid = makeGrid(stage, pack, players, opts, destroy);
  return { destroy, skip: toGrid, _debug: { pull, steps, toReveal, get phase() { return phase; } } };
}
