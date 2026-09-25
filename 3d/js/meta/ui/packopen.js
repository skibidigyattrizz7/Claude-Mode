// Pack opening sequence: shake -> flare -> (walkout: flag -> position -> club) -> card reveal -> item grid.
import { h, clear, frag, fmtNum } from './dom.js';
import { playerCard } from './card.js';
import { flagSVG, crestSVG } from './art.js';
import { NATION_BY_CODE, clubById } from '../core/data.js';
import { isWalkout } from '../core/ut.js';

const FLARE = { bronze: '#a9b1bf', silver: '#e4ecf6', gold: '#ffc933', walkout: '#b44dff' };
const SPECIAL_FLARE = { legend: '#fff2c4', hero: '#27e1c1', inform: '#ffb300' };

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

export function packArt(pack, size = 'md') {
  return frag(`<div class="pm-pack pm-pack--${pack.look} pm-pack--${size}" aria-hidden="true">
    <div class="pk-foil"></div><div class="pk-shine"></div>
    <div class="pk-logo"><span>P</span></div>
    <div class="pk-brand">PITCHSIDE<br><small>ULTIMATE TEAM</small></div>
    <div class="pk-name">${pack.name.replace(' Pack', '').toUpperCase()}</div>
  </div>`);
}

/**
 * root: container to append the overlay into
 * opts: { pack, items:[{pid, dup}], getPlayer, sellValue(p), onSend(pid), onSell(pid)->coins, onDone(summary) }
 */
export function runPackOpening(root, opts) {
  const { pack, items, getPlayer } = opts;
  const players = items.map((it) => ({ ...it, p: getPlayer(it.pid), state: 'new' }));
  const best = players[0].p;
  const walk = isWalkout(best);
  const flareKey = walk ? 'walkout' : best.tier;
  const flare = FLARE[flareKey];
  const accent = best.special ? SPECIAL_FLARE[best.special] : flare;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = reduce ? 0.45 : 1;
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms * T));
  let particles = null;
  let phase = 'pack';

  const canvas = h('canvas', { class: 'pm-po-canvas', 'aria-hidden': 'true' });
  const rays = h('div', { class: 'pm-po-rays', 'aria-hidden': 'true' });
  const flash = h('div', { class: 'pm-po-flash', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'pm-po-stage' });
  const skipBtn = h('button', { class: 'pm-po-skip pm-btn pm-btn--ghost', onclick: () => toGrid() }, 'Skip ›');
  const ov = h('div', { class: 'pm-po', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Opening ${pack.name}`, style: { '--flare': flare, '--accent': accent } },
    h('div', { class: 'pm-po-bg' }), rays, canvas, flash, stage, skipBtn);
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
  setTimeout(() => openBtn.focus(), 30);

  function start() {
    if (phase !== 'pack') return;
    phase = 'shake';
    openBtn.disabled = true;
    ov.classList.add('is-shaking');
    packEl.classList.add('shake');
    at(1150, () => {
      phase = 'flare';
      ov.classList.add('is-flare', `flare-${flareKey}`);
      flash.classList.add('go');
      packEl.classList.add('burst');
      particles.burst(flare, reduce ? 60 : 220, walk ? 13 : 9, null, null, walk ? [flare, accent, '#ffffff'] : null);
    });
    if (walk) {
      at(1700, () => showStage('flag'));
      at(3200, () => showStage('pos'));
      at(4400, () => showStage('club'));
      at(5900, () => revealCard());
    } else at(1700, () => revealCard());
  }

  function showStage(kind) {
    phase = kind;
    clear(stage);
    let inner;
    if (kind === 'flag') {
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
    phase = 'reveal';
    clear(stage);
    const card = playerCard(best, { size: 'lg', className: 'pm-reveal' });
    const cont = h('button', { class: 'pm-btn pm-btn--primary pm-po-continue', onclick: () => toGrid() }, 'Continue');
    stage.appendChild(h('div', { class: 'pm-po-center pm-po-revealwrap' },
      h('div', { class: 'pm-po-glow' }), card,
      h('div', { class: 'pm-po-revealname' }, best.name, best.special ? h('span', { class: `pm-sp-badge sp-${best.special}` }, best.special === 'inform' ? 'In-Form' : best.special) : null),
      cont));
    particles.burst(accent, reduce ? 50 : 200, 11, null, null, [accent, flare, '#ffffff']);
    if (walk && !reduce) particles.fountain(accent, 2600, [accent, flare, '#ffffff']);
    setTimeout(() => cont.focus(), 50);
  }

  function toGrid() {
    if (phase === 'grid') return;
    phase = 'grid';
    timers.forEach(clearTimeout);
    ov.classList.remove('is-shaking');
    ov.classList.add('is-grid', 'is-flare', `flare-${flareKey}`);
    skipBtn.remove();
    renderGrid();
  }

  let coinsGained = 0;
  function renderGrid() {
    clear(stage);
    const newCount = players.filter((x) => !x.dup).length;
    const dupCount = players.length - newCount;
    const dupValue = players.filter((x) => x.dup && x.state === 'new').reduce((a, x) => a + opts.sellValue(x.p), 0);
    const allValue = players.filter((x) => x.state === 'new').reduce((a, x) => a + opts.sellValue(x.p), 0);
    const grid = h('div', { class: 'pm-po-grid' });
    for (const x of players) {
      const tile = h('div', { class: `pm-po-item ${x.dup ? 'is-dup' : ''} is-${x.state}` },
        x.dup ? h('div', { class: 'pm-po-badge dup' }, 'Duplicate') : h('div', { class: 'pm-po-badge new' }, 'New'),
        playerCard(x.p, { size: 'sm' }),
        x.state === 'new' ? h('div', { class: 'pm-po-actions' },
          !x.dup ? h('button', { class: 'pm-btn pm-btn--sm pm-btn--primary', onclick: () => send(x) }, 'Send to club') : null,
          h('button', { class: 'pm-btn pm-btn--sm', onclick: () => sell(x) }, `Quick sell +${fmtNum(opts.sellValue(x.p))}`))
          : h('div', { class: 'pm-po-done' }, x.state === 'sent' ? '✓ Sent to club' : `Sold +${fmtNum(x.sold)}`));
      grid.appendChild(tile);
    }
    const pending = players.some((x) => x.state === 'new');
    stage.appendChild(h('div', { class: 'pm-po-gridwrap' },
      h('div', { class: 'pm-po-gridhead' },
        h('div', null, h('div', { class: 'pm-kicker' }, pack.name), h('h2', null, `${players.length} items`), h('p', { class: 'pm-dim' }, `${newCount} new · ${dupCount} duplicate${dupCount === 1 ? '' : 's'}${coinsGained ? ` · +${fmtNum(coinsGained)} coins` : ''}`)),
        h('div', { class: 'pm-po-bulk' },
          pending && players.some((x) => !x.dup && x.state === 'new') ? h('button', { class: 'pm-btn pm-btn--primary', onclick: () => { players.filter((x) => !x.dup && x.state === 'new').forEach((x) => send(x, true)); renderGrid(); } }, 'Send all to club') : null,
          dupValue ? h('button', { class: 'pm-btn', onclick: () => { players.filter((x) => x.dup && x.state === 'new').forEach((x) => sell(x, true)); renderGrid(); } }, `Quick sell duplicates +${fmtNum(dupValue)}`) : null,
          pending ? h('button', { class: 'pm-btn', onclick: () => { players.filter((x) => x.state === 'new').forEach((x) => sell(x, true)); renderGrid(); } }, `Quick sell all +${fmtNum(allValue)}`) : null,
          h('button', { class: 'pm-btn pm-btn--accent pm-po-finish', onclick: finish }, pending ? 'Done' : 'Close'))),
      pending ? h('p', { class: 'pm-hint' }, 'Unassigned items are sent to your club on Done; duplicates are quick sold.') : null,
      grid));
  }
  function send(x, silent) { if (x.state !== 'new' || x.dup) return; opts.onSend(x.pid); x.state = 'sent'; if (!silent) renderGrid(); }
  function sell(x, silent) { if (x.state !== 'new') return; const v = opts.onSell(x.pid, x.dup); x.sold = v; coinsGained += v; x.state = 'sold'; if (!silent) renderGrid(); }
  function finish() {
    for (const x of players) { if (x.state === 'new') { if (x.dup) sell(x, true); else send(x, true); } }
    destroy();
    opts.onDone && opts.onDone({ coins: coinsGained, sent: players.filter((x) => x.state === 'sent').length });
  }
  function destroy() {
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', onKey, true);
    if (particles) particles.destroy();
    ov.remove();
  }
  return { destroy, skip: toGrid };
}

export function positionName(pos) {
  return ({ GK: 'Goalkeeper', CB: 'Centre-Back', LB: 'Left-Back', RB: 'Right-Back', LWB: 'Left Wing-Back', RWB: 'Right Wing-Back', CDM: 'Defensive Midfield', CM: 'Central Midfield', CAM: 'Attacking Midfield', LM: 'Left Midfield', RM: 'Right Midfield', LW: 'Left Wing', RW: 'Right Wing', ST: 'Striker', CF: 'Centre-Forward' })[pos] || pos;
}
