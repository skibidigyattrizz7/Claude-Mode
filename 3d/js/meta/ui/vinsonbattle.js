import { createVinsonBattle } from '../core/vinsonbattle.js';
import { sampleVinsonCinematic } from './vinsoncinematic.js';

const W = 1280, H = 720;
const asset = (name) => new URL(`../../../assets/vinson/${name}.webp`, import.meta.url).href;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const names = { patel: 'Israeli Patel', captain: 'Captain Israel', world: 'World-Ruler Vinson', phonk: 'Phonk Mode Vinson' };
const heroArt = (stage) => stage ? 'captain' : 'patel';
const bossArt = (stage) => stage ? 'phonk' : 'world';
const ATTACK_NAMES = { laserline: 'RED LASER EYES', bombcircle: 'THE HUMBLE BOMB', painring: 'ASSIGNING PAIN' };

function node(tag, cls, text) {
  const el = document.createElement(tag); el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function beam(ctx, x1, y1, x2, y2, color, width = 5, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 22;
  ctx.lineWidth = width * 4; ctx.globalAlpha = alpha * .15;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.stroke();
  ctx.shadowBlur = 0; ctx.strokeStyle = '#fff6e8'; ctx.lineWidth = Math.max(1, width * .25); ctx.stroke(); ctx.restore();
}
function star(ctx, x, y, radius, angle, alpha = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#bbe8ff'; ctx.lineWidth = Math.max(2, radius * .025); ctx.shadowColor = '#46a5ff'; ctx.shadowBlur = 24;
  for (const offset of [0, Math.PI]) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + offset + i * Math.PI * 2 / 3;
      const px = Math.cos(a) * radius, py = Math.sin(a) * radius;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}
function sprite(ctx, image, key, x, y, t, alpha = 1, moving = false) {
  if (alpha <= 0) return;
  const width = key === 'captain' ? 182 : 148, height = key === 'captain' ? 145 : 196;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = '#020a09'; ctx.beginPath(); ctx.ellipse(x, y + 12, width * .42, 14, 0, 0, Math.PI * 2); ctx.fill();
  const bob = moving ? Math.sin(t * 15) * 4 : Math.sin(t * 2) * 2;
  ctx.translate(x, y + bob); ctx.rotate(moving ? Math.sin(t * 7.5) * .035 : 0);
  if (image?.complete && image.naturalWidth) {
    // Keep the owner's source intact; the portrait is framed rather than stretched.
    const cropTop = key === 'patel' ? image.naturalHeight * .23 : 0;
    const sourceHeight = image.naturalHeight - cropTop;
    const scale = Math.min(width / image.naturalWidth, height / sourceHeight);
    const dw = image.naturalWidth * scale, dh = sourceHeight * scale;
    // Composite the source's plain matte into the field without replacing the owner's art.
    ctx.globalCompositeOperation = key === 'world' ? 'screen' : key === 'patel' ? 'source-over' : 'multiply';
    ctx.drawImage(image, 0, cropTop, image.naturalWidth, sourceHeight, -dw / 2, -dh, dw, dh);
  } else {
    ctx.fillStyle = key === 'world' || key === 'phonk' ? '#871c20' : '#1c567e';
    ctx.fillRect(-width * .25, -height * .7, width * .5, height * .7);
    ctx.beginPath(); ctx.arc(0, -height * .75, 23, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function field(ctx, t) {
  ctx.fillStyle = '#071011'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#141f20'; ctx.beginPath(); ctx.moveTo(0, 105); ctx.lineTo(640, 65); ctx.lineTo(W, 105); ctx.lineTo(W, 230); ctx.lineTo(0, 230); ctx.fill();
  for (let row = 0; row < 5; row++) {
    ctx.fillStyle = row % 2 ? '#303638' : '#252c2e'; ctx.fillRect(0, 110 + row * 20, W, 12);
    ctx.fillStyle = '#637071';
    for (let i = 0; i < 64; i++) { if ((i * 13 + row * 7) % 9 < 2) ctx.fillRect(i * 20, 115 + row * 20, 3, 3); }
  }
  ctx.fillStyle = '#113f32'; ctx.fillRect(0, 215, W, H - 215);
  for (let i = 0; i < 9; i++) { ctx.fillStyle = i % 2 ? '#174737' : '#134032'; ctx.fillRect(i * 160, 215, 160, H - 215); }
  ctx.strokeStyle = '#a9bda37a'; ctx.lineWidth = 3;
  ctx.strokeRect(72, 236, 1136, 422); ctx.beginPath(); ctx.moveTo(640, 236); ctx.lineTo(640, 658); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(640, 444, 118, 78, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(72, 324, 175, 244); ctx.strokeRect(1033, 324, 175, 244);
  for (const x of [120, 1160]) {
    ctx.fillStyle = '#d6e2d9'; ctx.fillRect(x - 20, 60, 40, 10);
    ctx.fillStyle = '#b6e2d20a'; ctx.beginPath(); ctx.moveTo(x - 22, 72); ctx.lineTo(x - 260, H); ctx.lineTo(x + 260, H); ctx.lineTo(x + 22, 72); ctx.fill();
  }
  // Slow drifting mist remains cheap and never occludes attack markers.
  ctx.fillStyle = '#aac4bd08';
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse((i * 300 + t * 12) % 1600 - 160, 630 + Math.sin(t + i) * 12, 230, 24, 0, 0, Math.PI * 2); ctx.fill(); }
}
function health(ctx, s) {
  const bar = (x, actor, label, color) => {
    ctx.fillStyle = '#040809cc'; ctx.fillRect(x, 93, 380, 48);
    ctx.fillStyle = '#f4eee4'; ctx.font = 'bold 17px monospace'; ctx.fillText(label.toUpperCase(), x + 12, 112);
    ctx.fillStyle = '#34413b'; ctx.fillRect(x + 12, 121, 356, 7);
    ctx.fillStyle = color; ctx.fillRect(x + 12, 121, 356 * actor.hp / actor.maxHp, 7);
  };
  bar(80, s.hero, names[heroArt(s.stage)], '#88beed'); bar(820, s.boss, names[bossArt(s.stage)], '#d73d35');
}
function shieldAndSword(ctx, shot) {
  if (!shot.shield) return;
  ctx.save(); ctx.globalAlpha = shot.shield; ctx.translate(640, 510);
  ctx.scale(1, .35); ctx.fillStyle = '#7895a2'; ctx.strokeStyle = '#d7dde1'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(0, 0, 84, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#bd3935'; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(0, 0, 64, 0, Math.PI * 2); ctx.stroke(); star(ctx, 0, 0, 45, 0);
  ctx.strokeStyle = '#071015'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-16, -77); ctx.lineTo(9, -28); ctx.lineTo(-6, 0); ctx.lineTo(24, 33); ctx.lineTo(15, 78); ctx.stroke(); ctx.restore();
  if (!shot.sword) return;
  const p = shot.sword, fall = p * p, y = -360 + 790 * fall;
  ctx.save(); ctx.translate(645, Math.min(y, 430)); ctx.rotate(-.08);
  ctx.fillStyle = '#bdcbd3'; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(8, 0); ctx.lineTo(3, 122); ctx.lineTo(0, 150); ctx.lineTo(-6, 118); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b79b52'; ctx.fillRect(-31, -8, 62, 11); ctx.fillStyle = '#394855'; ctx.fillRect(-6, -48, 12, 40); ctx.restore();
}

/** Isolated render function for the arena, actors and smooth cinematics. */
export function drawVinsonBattle(ctx, state, images, t, { shot = null, particles = [], trauma = 0, reducedMotion = false, visualHero = state.hero } = {}) {
  ctx.save(); ctx.clearRect(0, 0, W, H);
  const shake = reducedMotion ? 0 : trauma * trauma;
  const zoom = shot?.zoom || 1;
  ctx.translate(W / 2 + Math.sin(t * 31) * shake * 12, H / 2 + Math.sin(t * 43) * shake * 7);
  ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2);
  if (shot) field(ctx, t);
  else {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#f7f2e8'; ctx.lineWidth = 4; ctx.strokeRect(76, 184, 1128, 482);
    ctx.fillStyle = '#f7f2e8'; ctx.font = 'bold 22px monospace';
    ctx.fillText('DODGE THE MARKED ATTACKS', 80, 165);
  }
  if (!shot) {
    for (const h of state.hazards) {
      const ready = h.elapsed >= h.telegraph;
      const alpha = ready ? .95 : .28 + .18 * Math.sin(h.elapsed * 7);
      if (h.type === 'laserline') {
        if (ready) beam(ctx, h.x1, h.y1, h.x2, h.y2, '#f3332d', 10, alpha);
        else { ctx.save(); ctx.strokeStyle = '#f38271'; ctx.setLineDash([15, 12]); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(h.x1, h.y1); ctx.lineTo(h.x2, h.y2); ctx.stroke(); ctx.restore(); }
      } else {
        const radius = h.type === 'bombcircle' ? h.radius : ready ? 30 + (h.elapsed - h.telegraph) * h.ringMax / h.duration : 30;
        ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = '#f76b50'; ctx.lineWidth = ready ? 9 : 3;
        ctx.beginPath(); ctx.arc(h.x, h.y, radius, 0, Math.PI * 2); ctx.stroke();
        if (h.type === 'bombcircle') { ctx.fillStyle = ready ? '#ff493551' : '#ed423121'; ctx.fill(); }
        ctx.restore();
      }
    }
    // Small soul marker makes precise dodging readable inside the combat box.
    ctx.save(); ctx.translate(visualHero.x, visualHero.y);
    ctx.globalAlpha = state.hero.invulnerable > 0 ? .6 + .25 * Math.sin(t * 14) : 1;
    ctx.fillStyle = '#ff293d'; ctx.beginPath(); ctx.moveTo(0, 11);
    ctx.bezierCurveTo(-24,-4,-16,-21,0,-10); ctx.bezierCurveTo(16,-21,24,-4,0,11); ctx.fill();
    ctx.restore();
    sprite(ctx, images[bossArt(state.stage)], bossArt(state.stage), state.boss.x, state.boss.y, t);
    for (const p of state.projectiles) beam(ctx, p.x - p.vx * .035, p.y - p.vy * .035, p.x, p.y, '#4faaff', 4);
  } else {
    sprite(ctx, images[shot.hero], shot.hero, 300, 470, t, shot.heroAlpha);
    sprite(ctx, images[shot.villain], shot.villain, 980, 470, t, shot.villainAlpha);
    if (shot.beams > 0) {
      const cx = shot.hero === 'patel' ? 380 - clamp((shot.time - 12) / 4, 0, 1) * 125 : 640;
      beam(ctx, 958, 324, cx, 355, '#ff3325', 9, shot.beams);
      beam(ctx, 335, 333, cx, 355, '#399dff', 8, shot.beams);
      if (shot.star) star(ctx, cx, 355, 24 + shot.star ** 3 * 850, reducedMotion ? 0 : t * .85, shot.beams);
    }
    shieldAndSword(ctx, shot);
  }
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1); ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.restore(); ctx.globalAlpha = 1;
  if (!shot && state.phase === 'fight') health(ctx, state);
  if (shot) {
    ctx.fillStyle = '#020304'; ctx.fillRect(0, 0, W, 55); ctx.fillRect(0, H - 55, W, 55);
    if (shot.white) { ctx.fillStyle = `rgba(255,251,235,${shot.white})`; ctx.fillRect(0, 0, W, H); }
    if (shot.black) { ctx.fillStyle = `rgba(0,0,0,${shot.black})`; ctx.fillRect(0, 0, W, H); }
  }
}

/** One canvas, one RAF, one fixed-step clock. The account API owns win/reward authority. */
// Status clears the online layer's cached Vinson ban after an owner unban.
export async function registerVinsonBattleAttempt(online) {
  const remote = await online.vinson.status();
  if (!remote?.ok) return remote || { ok: false, error: 'offline' };
  return online.vinson.battleStart();
}

export function launchVinsonBattle({ parent = document.body, online, onWin, onClaim, onClose, resumeRewards = false, seed = 1, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  if (document.querySelector('.vb-screen')) return null;
  const link = node('link', ''); link.rel = 'stylesheet'; link.href = new URL('../../../css/vinsonbattle.css', import.meta.url).href; document.head.append(link);
  const screen = node('section', 'vb-screen'); screen.setAttribute('role', 'dialog'); screen.setAttribute('aria-modal', 'true'); screen.setAttribute('aria-label', 'Fight Suppression');
  const stage = node('div', 'vb-stage'), canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  canvas.setAttribute('aria-label', 'Move to dodge the marked attacks, attack Vinson, and dodge with Space.'); stage.append(canvas);
  const top = node('div', 'vb-top'); top.append(node('strong', 'vb-title', 'FIGHT SUPPRESSION'));
  const closeButton = node('button', '', 'Return to Pitchside'); closeButton.onclick = close; top.append(closeButton); stage.append(top);
  const panel = node('div', 'vb-panel'), subtitle = node('div', 'vb-subtitle'); stage.append(panel, subtitle);
  const controls = node('div', 'vb-controls'); controls.append(node('span', 'vb-hint', 'WASD / arrows: move · J / click: attack · Space: dodge'));
  const touch = node('div', 'vb-touch'); controls.append(touch);
  const buttons = [['left','←'],['up','↑'],['down','↓'],['right','→'],['dodge','Dodge'],['attack','Attack']];
  for (const [action, label] of buttons) {
    const b = node('button', '', label); b.dataset.action = action; b.setAttribute('aria-label', label);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); held.add(action); b.setPointerCapture(e.pointerId); });
    for (const evt of ['pointerup','pointercancel','lostpointercapture']) b.addEventListener(evt, () => held.delete(action));
    touch.append(b);
  }
  screen.append(stage, controls); parent.append(screen);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    panel.append(node('h2', '', 'Canvas unavailable'), node('p', '', 'Return to Pitchside and try another browser.'));
    let exited = false;
    const exit = () => { if (exited) return; exited = true; screen.remove(); link.remove(); onClose?.(); };
    closeButton.onclick = exit; return { close: exit };
  }
  let battle = createVinsonBattle({ seed }), raf = 0, last = 0, clock = 0, accumulator = 0, closed = false;
  let mode = '', cinematicKind = '', cinematicTime = 0, trauma = 0, particles = [], nonce = null, victoryBusy = false, victoryConfirmed = false;
  let audio = null, muted = false, viewHero = { x: 250, y: 425 }, oldFocus = document.activeElement;
  const held = new Set(), keys = new Set(), images = {};
  const originalOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';
  for (const key of ['patel','captain','world','phonk']) { const img = new Image(); img.src = asset(key); images[key] = img; void img.decode().catch(() => {}); }
  const mute = node('button', '', 'Sound on'); mute.onclick = () => { muted = !muted; mute.textContent = muted ? 'Sound off' : 'Sound on'; }; top.insertBefore(mute, closeButton);
  function tone(kind) {
    if (muted || document.hidden) return;
    try {
      const settings = JSON.parse(localStorage.getItem('meta.settings') || '{}'), volume = clamp(Number(settings.volume ?? 70) / 100, 0, 1);
      if (!volume) return;
      const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
      audio ||= new Audio(); void audio.resume();
      const osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      osc.type = kind === 'hit' ? 'sawtooth' : 'sine'; osc.frequency.setValueAtTime(kind === 'hit' ? 130 : 460, now);
      osc.frequency.exponentialRampToValueAtTime(kind === 'hit' ? 34 : 170, now + .14);
      gain.gain.setValueAtTime(.06 * volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + .2);
      osc.connect(gain); gain.connect(audio.destination); osc.start(now); osc.stop(now + .22);
    } catch { /* muted/unavailable audio never affects gameplay */ }
  }
  function burst(x, y, color, count = 24) {
    for (let i = 0; i < count && particles.length < 220; i++) {
      const angle = i * 2.39996 + clock, speed = 70 + i % 7 * 24;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40, life: .6 + i % 5 * .12, maxLife: 1.1, color, size: 2 + i % 3 });
    }
  }
  function input() { return { x: Number(keys.has('d') || keys.has('arrowright') || held.has('right')) - Number(keys.has('a') || keys.has('arrowleft') || held.has('left')),
    y: Number(keys.has('s') || keys.has('arrowdown') || held.has('down')) - Number(keys.has('w') || keys.has('arrowup') || held.has('up')),
    attack: keys.has('j') || held.has('attack'), dodge: keys.has(' ') || held.has('dodge') }; }
  function keydown(e) {
    if (e.key === 'Escape') { close(); return; }
    if ([' ','w','a','s','d','j','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase())) { e.preventDefault(); keys.add(e.key.toLowerCase()); }
    if (e.key === 'Tab') { const all = [...screen.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null); if (!all.length) return; const idx = all.indexOf(document.activeElement); e.preventDefault(); all[(idx + (e.shiftKey ? -1 : 1) + all.length) % all.length].focus(); }
  }
  function keyup(e) { keys.delete(e.key.toLowerCase()); }
  function blur() { keys.clear(); held.clear(); last = 0; accumulator = 0; }
  document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', blur);
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); held.add('attack'); canvas.setPointerCapture(e.pointerId); });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type, () => held.delete('attack'));
  function showPanel(title, description, actions) {
    panel.replaceChildren(node('h2', '', title), node('p', '', description));
    const row = node('div', 'vb-actions');
    for (const [label, action] of actions) { const b = node('button', '', label); b.onclick = action; row.append(b); }
    panel.append(row); panel.hidden = false;
  }
  async function startFight() {
    if (victoryBusy || closed) return;
    victoryBusy = true;
    try {
      if (online && (!online.vinson?.status || !online.vinson?.battleStart || !online.vinson?.battleWin || !online.vinson?.claimBattleRewards)) {
        showPanel('Battle unavailable', 'The battle service is not ready yet. Return to Pitchside and try again later.', [['Return to Pitchside', close]]); return;
      }
      if (!nonce && online?.vinson?.battleStart) {
        const result = await registerVinsonBattleAttempt(online);
        if (closed) return;
        if (!result?.ok) { showPanel('Unable to start', 'Your fight could not start. If the Vinson escape service is still updating, try again shortly.', [['Retry', startFight]]); return; }
        nonce = result.nonce;
      }
      battle.step(0, { advance: true }); panel.hidden = true; mode = 'fight'; tone('fire');
    } catch { showPanel('Connection interrupted', 'Try again when your connection returns.', [['Retry', startFight]]); }
    finally { victoryBusy = false; }
  }
  async function confirmVictory() {
    if (victoryBusy || closed) return;
    victoryBusy = true;
    showPanel('Victory', 'Confirming your victory and curse protection…', []);
    try {
      const result = onWin ? await onWin({ nonce }) : await online?.vinson?.battleWin?.({ nonce });
      if (closed) return;
      if (!result?.ok || !result.immune) {
        showPanel('Victory', result?.error === 'too_soon' ? `The server needs ${Math.max(1, Math.ceil(Number(result.retryAfter) || 60))} more seconds before confirming. Retry after that wait.` : 'Your victory could not be confirmed. Your curse and rewards have not changed.', [['Retry confirmation', confirmVictory], ['Return to Pitchside', close]]); return;
      }
      victoryConfirmed = true;
      showPanel('The curse is broken', 'Congratulations. Claim your three exclusive cards. Vinson can no longer curse this account.', [['Collect rewards', claimRewards], ['Return to Pitchside', close]]);
    } catch { if (!closed) showPanel('Victory', 'Connection interrupted. Retry to confirm victory and collect your rewards.', [['Retry confirmation', confirmVictory], ['Return to Pitchside', close]]); }
    finally { victoryBusy = false; }
  }
  async function claimRewards() {
    if (!victoryConfirmed || victoryBusy || closed) return;
    victoryBusy = true;
    try {
      const result = onClaim ? await onClaim() : await online?.vinson?.claimBattleRewards?.();
      if (closed) return;
      if (!result?.ok) { showPanel('Rewards pending', 'Your victory is confirmed. Retry collecting your rewards.', [['Retry collection', claimRewards], ['Return to Pitchside', close]]); return; }
      showPanel('Congratulations', 'Your World-Ruler Vinson, Phonk Mode Vinson and Captain Israel rewards are ready in your club.', [['Return to Pitchside', close]]);
      const rewards = node('div', 'vb-rewards');
      for (const key of ['world','phonk','captain']) { const tile = node('div', 'vb-reward'); const img = new Image(); img.src = asset(key); img.alt = names[key]; tile.append(img, node('span', '', names[key])); rewards.append(tile); }
      panel.insertBefore(rewards, panel.lastChild);
    } catch { if (!closed) showPanel('Rewards pending', 'Try again when your connection returns.', [['Retry collection', claimRewards], ['Return to Pitchside', close]]); }
    finally { victoryBusy = false; }
  }
  function animate(dt) {
    clock += dt; trauma = Math.max(0, trauma - dt * 1.8);
    particles = particles.filter(p => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 150 * dt; return p.life > 0; });
    if (cinematicKind) {
      cinematicTime += dt;
      const shot = sampleVinsonCinematic(cinematicKind, cinematicTime, { reducedMotion });
      if (shot.done && cinematicKind === 'transition') { battle.next(); cinematicKind = ''; mode = ''; viewHero = { ...battle.state.hero }; }
      else if (shot.done && mode !== 'result') { mode = 'result'; subtitle.replaceChildren(); void confirmVictory(); }
      return;
    }
    const s = battle.step(dt, input());
    const target = s.hero; const k = 1 - Math.exp(-22 * dt);
    viewHero.x += (target.x - viewHero.x) * k; viewHero.y += (target.y - viewHero.y) * k;
    viewHero.moving = !!(input().x || input().y);
    for (const evt of s.events) {
      if (evt.type === 'hit') { trauma = Math.min(1, trauma + (evt.target === 'hero' ? .7 : .32)); const who = evt.target === 'hero' ? s.hero : s.boss; burst(who.x, who.y - 65, evt.target === 'hero' ? '#f67460' : '#a4d9ff'); tone('hit'); }
      if (evt.type === 'fire') { burst(evt.x, evt.y - 20, '#70bfff', 4); tone('fire'); }
      if (evt.type === 'dodge') burst(evt.x, evt.y - 40, '#d3ebff', 18);
    }
    if (s.phase === 'transition' || s.phase === 'clash') {
      cinematicKind = s.phase === 'transition' ? 'transition' : 'finale'; cinematicTime = 0; panel.hidden = true; mode = cinematicKind; held.clear(); keys.clear(); tone('hit');
    } else if (s.phase !== mode) {
      mode = s.phase;
      if (mode === 'intro') showPanel(s.stage ? 'Captain Israel' : 'Fight Suppression', s.stage ? 'Vinson has returned in Phonk Mode. Dodge her attacks and fight back.' : "Israeli Patel: I'll avenge my fallen Israelis once and for all. Vinson: That's too humble. I'm going to assign pain.", [['Begin fight', startFight]]);
      else if (mode === 'defeat') showPanel('Suppressed', 'Retry this stage. Your curse remains until you win and the victory is confirmed.', [['Retry stage', () => { nonce = null; battle.retry(); viewHero = { ...battle.state.hero }; mode = ''; }], ['Return to Pitchside', close]]);
    }
  }
  function frame(now) {
    if (closed) return;
    if (document.hidden) { last = 0; raf = requestAnimationFrame(frame); return; }
    const delta = last ? Math.min(.1, (now - last) / 1000) : 0; last = now; accumulator += delta;
    for (let i = 0; i < 6 && accumulator >= 1 / 60; i++) { animate(1 / 60); accumulator -= 1 / 60; }
    const shot = cinematicKind ? sampleVinsonCinematic(cinematicKind, cinematicTime, { reducedMotion }) : null;
    drawVinsonBattle(ctx, battle.state, images, clock, { shot, particles, trauma, reducedMotion, visualHero: viewHero });
    const text = shot?.black > .8 || shot?.white > .8 || mode === 'result' ? '' : shot?.text || '';
    if (subtitle.dataset.text !== text) { subtitle.dataset.text = text; subtitle.replaceChildren(); if (text) subtitle.append(node('strong', '', shot.speaker), node('p', '', text)); }
    raf = requestAnimationFrame(frame);
  }
  function close() {
    if (closed) return; closed = true; cancelAnimationFrame(raf);
    document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', blur);
    void audio?.close(); document.documentElement.style.overflow = originalOverflow; screen.remove(); link.remove(); oldFocus?.focus?.(); onClose?.();
  }
  if (resumeRewards) {
    mode = 'result'; victoryConfirmed = true; cinematicKind = 'finale'; cinematicTime = 26;
    showPanel('The curse is broken', 'Your victory is saved. Collect your three exclusive reward cards.', [['Collect rewards', claimRewards], ['Return to Pitchside', close]]);
  } else animate(0);
  closeButton.focus(); raf = requestAnimationFrame(frame);
  return { close, get state() { return battle.state; } };
}
