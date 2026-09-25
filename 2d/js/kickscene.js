// First-person dead-ball scene: penalties (in-match or shootout), direct free kicks
// (in-match) and free-kick practice. Renders with View3D and simulates with kickphys.
import { PITCH, CY, GOAL, BALL_R, PEN_SPOT, BOX, PHYS } from './constants.js';
import { KeeperModel, buildWall, makeKickState, launch, stepKick, kickError, aiPenaltyChoice, keeperPenaltyGuess, penaltySpeed, freeKickSpeed, predictKick, aiFreeKickDive } from './kickphys.js';
import { View3D } from './view3d.js';
import { input, mouseAimActive } from './input.js';
import { settings } from './settings.js';
import { sfx } from './audio.js';
import { store } from './storage.js';
import { chooseKits } from './data.js';
import { keyLabel } from './keybinds.js';
import { clamp, TAU, norm } from './util.js';

const L = PITCH.L;
const KEEPER_BY_DIFF = { Easy: 0.45, Normal: 0.65, Hard: 0.8, Legend: 0.95 };
const TYPES = ['driven', 'dipping', 'knuckle'];
const FK_BEST_KEY = 'touchline.fkbest.v1';

export class KickScene {
  /**
   * o.mode: 'penalty' | 'freekick' (in-match single kicks), 'shootout', 'fkpractice'
   * o.att / o.def: team objects; o.ball {x,y} (already mirrored so goal is at x = L)
   * o.humanShooter / o.humanKeeper: controller index or null
   * o.onDone(result) is called when the scene is finished.
   */
  constructor(o, ui) {
    this.o = o; this.ui = ui;
    this.mode = o.mode;
    this.view = new View3D();
    this.time = 0; this.paused = false;
    this.rng = Math.random;
    this.msg = null;
    this.type = 'driven'; this.curve = 0; this.power = 0; this.charging = false; this.sliderPower = 0.65;
    this.practice = { goals: 0, attempts: 0, streak: 0, best: store.get(FK_BEST_KEY, 0) || 0 };
    if (this.mode === 'shootout') {
      const k = chooseKits(o.teams[0], o.teams[1]);
      this.so = { teams: o.teams, kits: k.kits, gk: k.gk, human: o.humanTeam, res: [[], []], turn: o.firstTeam || 0, idx: [0, 0], done: false, winner: null };
    }
    this.buildDom();
    this.nextKick();
  }

  // ---------- setup ----------
  nextKick() {
    const o = this.o;
    let att, def, attKit, defGk, shooter, keeperInfo, humanShooter = null, humanKeeper = null, ballPos, walls = 0;
    if (this.mode === 'shootout') {
      const s = this.so, t = s.turn;
      att = s.teams[t]; def = s.teams[1 - t];
      attKit = s.kits[t]; defGk = s.gk[1 - t];
      const order = att.squad.filter((p) => p.role !== 'GK').sort((a, b) => b.attrs.shooting - a.attrs.shooting);
      shooter = order[s.idx[t] % order.length];
      keeperInfo = def.squad.find((p) => p.role === 'GK');
      if (s.human === t) humanShooter = 0;
      if (s.human === 1 - t) humanKeeper = 0;
      ballPos = { x: L - PEN_SPOT, y: CY };
    } else {
      att = o.att; def = o.def;
      const k = chooseKits(o.home || att, o.away || def);
      attKit = o.attKit || k.kits[0]; defGk = o.defGk || k.gk[1];
      this.defKit = o.defKit || k.kits[1];
      shooter = o.shooter || att.squad.filter((p) => p.role !== 'GK').sort((a, b) => b.attrs.shooting - a.attrs.shooting)[0];
      keeperInfo = o.keeper || def.squad.find((p) => p.role === 'GK');
      humanShooter = o.humanShooter ?? null; humanKeeper = o.humanKeeper ?? null;
      if (this.mode === 'penalty') ballPos = { x: L - PEN_SPOT, y: CY };
      else if (this.mode === 'fkpractice') ballPos = this.fkSpot || this.randomSpot();
      else ballPos = { x: o.ball.x, y: o.ball.y };
      if (this.mode !== 'penalty') {
        const d = Math.hypot(L - ballPos.x, CY - ballPos.y);
        walls = d < 20 ? 5 : d < 26 ? 4 : 3;
      }
    }
    this.att = att; this.def = def;
    this.attKit = attKit; this.defGk = defGk;
    this.defKit = this.defKit || (this.mode === 'shootout' ? this.so.kits[1 - this.so.turn] : chooseKits(att, def).kits[1]);
    if (this.mode === 'shootout') this.defKit = this.so.kits[1 - this.so.turn];
    this.shooter = shooter; this.keeperInfo = keeperInfo;
    this.humanShooter = humanShooter; this.humanKeeper = humanKeeper;
    this.ballPos = ballPos;
    const isFK = this.mode === 'freekick' || this.mode === 'fkpractice';
    this.isFK = isFK;
    const kp = this.mode === 'fkpractice' ? KEEPER_BY_DIFF[settings.difficulty] || 0.65 : keeperInfo ? keeperInfo.attrs.keeping : 0.65;
    const ky = isFK ? CY + (ballPos.y < CY ? 1 : -1) * 0.8 : CY;
    this.keeper = new KeeperModel(ky, kp, isFK ? L - 0.6 : L - 0.3);
    this.wall = walls ? buildWall(ballPos, walls, this.rng) : [];
    this.state = makeKickState(ballPos, this.keeper, this.wall);
    this.state.ball.z = BALL_R;
    this.reticle = { y: CY + (isFK ? (ballPos.y < CY ? 2.2 : -2.2) : 1.8), z: isFK ? 1.7 : 0.9 };
    this.power = 0; this.charging = false; this.curve = isFK ? (ballPos.y < CY ? 0.5 : -0.5) : 0;
    this.type = 'driven';
    this.phase = 'intro'; this.phaseT = 0;
    this.kickT = null; this.aiPlan = null; this.keeperDived = false; this.earlyDive = false;
    this.result = null; this.bulge = null;
    this.runner = { t: 0 };
    this.syncDom();
  }

  randomSpot() {
    for (let i = 0; i < 50; i++) {
      const x = L - (17 + Math.random() * 15);
      const y = CY + (Math.random() - 0.5) * 34;
      const inBox = x > L - BOX.D - 0.5 && Math.abs(y - CY) < BOX.W / 2 + 0.5;
      if (!inBox && Math.hypot(L - x, CY - y) < 33) return { x, y };
    }
    return { x: L - 24, y: CY };
  }

  // ---------- DOM controls (sliders / buttons for touch and mouse users) ----------
  buildDom() {
    const d = document.createElement('div');
    d.id = 'kickui';
    d.innerHTML = `
      <div class="krow kpow"><label>Power</label><input id="kPower" type="range" min="0" max="100" value="65"></div>
      <div class="krow fk"><label>Curve</label><input id="kCurve" type="range" min="-100" max="100" value="0"></div>
      <div class="krow fk kt">${TYPES.map((t) => `<button data-type="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      <div class="krow"><button id="kKick" class="primary">KICK</button><button id="kHold" class="primary hold">HOLD</button></div>
      <div class="krow prac"><button id="kNew">New spot</button><button id="kPlace">Place ball</button></div>`;
    document.getElementById('app').appendChild(d);
    this.dom = d;
    const $ = (id) => d.querySelector('#' + id);
    $('kPower').addEventListener('input', (e) => { this.sliderPower = e.target.value / 100; });
    $('kCurve').addEventListener('input', (e) => { this.curve = e.target.value / 100; });
    d.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { this.type = b.dataset.type; this.syncDom(); }));
    $('kKick').addEventListener('click', () => this.kickButton());
    const hold = $('kHold');
    hold.addEventListener('pointerdown', (e) => { e.preventDefault(); this.domHold = true; });
    const up = () => { if (this.domHold) { this.domHold = false; this.domRelease = true; } };
    hold.addEventListener('pointerup', up); hold.addEventListener('pointercancel', up); hold.addEventListener('pointerleave', up);
    $('kNew').addEventListener('click', () => { this.fkSpot = null; this.nextKick(); });
    $('kPlace').addEventListener('click', () => this.enterPlace());
    // canvas pointer: touch-drag aims; mouse handled through input.mouse
    const cv = document.getElementById('game');
    this.onPtr = (e) => {
      if (e.pointerType === 'mouse') return;
      this.touchAim = { x: e.clientX, y: e.clientY - 70 };
      if (e.type === 'pointerdown' && this.phase === 'place') this.placeAt(e.clientX, e.clientY);
      else if (e.type === 'pointerdown' && this.humanKeeper != null && this.phase !== 'result') this.touchDive = true;
    };
    cv.addEventListener('pointerdown', this.onPtr); cv.addEventListener('pointermove', this.onPtr);
  }

  syncDom() {
    if (!this.dom) return;
    const d = this.dom;
    d.classList.toggle('isfk', !!this.isFK);
    d.classList.toggle('ispractice', this.mode === 'fkpractice');
    const keeperMode = this.humanKeeper != null;
    d.classList.toggle('keeper', keeperMode);
    // "hold" power mode on a desktop: the power bar is charged with the key / mouse, so the
    // slider + KICK button are only offered in "slider" mode (touch always gets both)
    const holdMode = settings.penaltyPower !== 'slider' && !input.touchMode;
    d.classList.toggle('holdmode', holdMode);
    d.classList.toggle('hidden', (this.humanShooter == null && !keeperMode) || (holdMode && !keeperMode && !this.isFK) || this.phase === 'over');
    d.querySelector('#kKick').textContent = keeperMode ? 'DIVE' : 'KICK';
    d.querySelector('#kHold').textContent = keeperMode ? 'DIVE' : 'HOLD';
    d.querySelector('#kCurve').value = Math.round(this.curve * 100);
    d.querySelector('#kPower').value = Math.round(this.sliderPower * 100);
    d.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('sel', b.dataset.type === this.type));
  }

  destroy() {
    if (this.dom) this.dom.remove();
    const cv = document.getElementById('game');
    cv.removeEventListener('pointerdown', this.onPtr); cv.removeEventListener('pointermove', this.onPtr);
  }

  kickButton() {
    if (this.phase !== 'aim') return;
    if (this.humanKeeper != null) { this.keeperDive(); return; }
    if (this.humanShooter != null) this.startRunup(this.sliderPower);
  }

  enterPlace() { if (this.mode === 'fkpractice' && (this.phase === 'aim' || this.phase === 'intro')) { this.phase = 'place'; this.phaseT = 0; } }

  placeRect() {
    const w = this.view.w, h = this.view.h;
    const mw = Math.min(w * 0.7, 520), mh = mw * (PITCH.W / 40);
    const hh = Math.min(mh, h * 0.7), ww = hh * 40 / PITCH.W;
    return { x: (w - ww) / 2, y: (h - hh) / 2, w: ww, h: hh };
  }

  placeAt(sx, sy) {
    const r = this.placeRect();
    const x = L - 40 + ((sx - r.x) / r.w) * 40;
    const y = ((sy - r.y) / r.h) * PITCH.W;
    if (sx < r.x || sx > r.x + r.w || sy < r.y || sy > r.y + r.h) return;
    const inBox = x > L - BOX.D - 0.5 && Math.abs(y - CY) < BOX.W / 2 + 0.5;
    const d = Math.hypot(L - x, CY - y);
    if (inBox || d > 36 || d < 16 || y < 2 || y > PITCH.W - 2) { this.msg = { text: 'Pick a spot outside the box, 16–36 m out', t: 0, dur: 1.6 }; return; }
    this.fkSpot = { x, y };
    this.nextKick();
  }

  // ---------- control helpers ----------
  ctrl(i) { return input.ctrls[i]; }

  updateReticle(dt, ci) {
    const c = this.ctrl(ci);
    const mv = c.move();
    if (ci === 0 && mouseAimActive()) {
      const p = this.view.unprojectToPlaneX(input.mouse.x, input.mouse.y, L);
      if (p) { this.reticle.y = p.y; this.reticle.z = p.z; }
    } else if (this.touchAim) {
      const p = this.view.unprojectToPlaneX(this.touchAim.x, this.touchAim.y, L);
      if (p) { this.reticle.y = p.y; this.reticle.z = p.z; }
    } else {
      this.reticle.y += mv.x * 3.2 * dt;
      this.reticle.z -= mv.y * 2.4 * dt;
    }
    this.reticle.y = clamp(this.reticle.y, CY - 7, CY + 7);
    this.reticle.z = clamp(this.reticle.z, 0.05, 4.5);
  }

  startRunup(power) {
    if (this.phase !== 'aim') return;
    this.power = clamp(power, 0, 1);
    this.phase = 'runup'; this.phaseT = 0;
    this.charging = false;
  }

  keeperDive() {
    if (this.keeperDived || this.humanKeeper == null) return;
    this.keeperDived = true;
    if (this.kickT == null) this.earlyDive = true;
    const dur = clamp(0.5 - 0.12 * this.keeper.keeping, 0.34, 0.55);
    this.keeper.dive(this.reticle.y, this.reticle.z, dur);
    sfx('save', 0.3);
  }

  // ---------- update ----------
  update(dt) {
    if (this.paused) return;
    this.time += dt; this.phaseT += dt;
    if (this.msg) { this.msg.t += dt; if (this.msg.t > this.msg.dur) this.msg = null; }
    const hs = this.humanShooter, hk = this.humanKeeper;
    const c0 = this.ctrl(hs ?? hk ?? 0);
    if (this.mode === 'fkpractice' && this.phase !== 'flight') {
      if (input.raw.has('KeyP')) this.enterPlace();
      if (input.raw.has('KeyN') || input.ctrls[0].wasPressed('switch')) { this.fkSpot = null; this.nextKick(); return; }
    }
    switch (this.phase) {
      case 'intro':
        this.keeper.update(dt);
        if (this.phaseT > 0.8) { this.phase = 'aim'; this.phaseT = 0; }
        break;
      case 'place':
        if (input.mouse.pressed) this.placeAt(input.mouse.x, input.mouse.y);
        if (c0.wasPressed('pause')) { this.phase = 'aim'; }
        break;
      case 'aim': this.updateAim(dt); break;
      case 'runup': this.updateRunup(dt); break;
      case 'flight': this.updateFlight(dt); break;
      case 'result':
        this.keeper.update(dt);
        this.settleBall(dt);
        if (this.phaseT > 2.0 || (this.phaseT > 0.8 && (input.anyPressed || input.mouse.pressed) && this.mode !== 'penalty' && this.mode !== 'freekick')) this.finishKick();
        break;
      case 'over':
        if (this.phaseT > 1 && (input.anyPressed || input.mouse.pressed)) {
          const so = this.so;
          this.phase = 'done';
          this.o.onDone({ winner: so.winner, score: [so.res[0].filter(Boolean).length, so.res[1].filter(Boolean).length] });
        }
        break;
      default: break;
    }
    this.domRelease = false;
    this.touchDive = false;
  }

  settleBall(dt) {
    // let the ball drop into the net / roll after the decision
    const b = this.state.ball;
    if (b.x > L + GOAL.D - BALL_R) b.x = L + GOAL.D - BALL_R;
    b.vz -= PHYS.G * dt; b.z += b.vz * dt; if (b.z < BALL_R * 0) { b.z = 0; b.vz = 0; }
    b.x += b.vx * dt * 0.3; b.y += b.vy * dt * 0.3; b.vx *= 0.95; b.vy *= 0.95;
    if (b.x > L && Math.abs(b.y - CY) < GOAL.W / 2) b.y = clamp(b.y, CY - GOAL.W / 2 + BALL_R, CY + GOAL.W / 2 - BALL_R);
  }

  updateAim(dt) {
    const hs = this.humanShooter, hk = this.humanKeeper;
    this.keeper.update(dt);
    if (hs != null) {
      const c = this.ctrl(hs);
      this.updateReticle(dt, hs);
      if (this.isFK) {
        if (c.isHeld('lob')) this.curve = clamp(this.curve - dt * 1.4, -1, 1);
        if (c.isHeld('through')) this.curve = clamp(this.curve + dt * 1.4, -1, 1);
        if (c.wasPressed('skill')) this.type = TYPES[(TYPES.indexOf(this.type) + 1) % TYPES.length];
        if (c.isHeld('lob') || c.isHeld('through') || c.wasPressed('skill')) this.syncDom();
      }
      const holding = c.isHeld('shoot') || (hs === 0 && input.mouse.down && !input.touchMode) || this.domHold;
      if (holding) {
        if (!this.charging) { this.charging = true; this.power = 0; }
        this.power = Math.min(1, this.power + dt / 1.25);
      } else if (this.charging) {
        this.startRunup(this.power);
        return;
      }
      if (c.wasPressed('pass') || (hs === 0 && input.ctrls[0].wasPressed('pass'))) this.startRunup(this.sliderPower);
    } else {
      // AI shooter: human keeper chooses a spot and dives; AI steps up after a pause
      if (hk != null) {
        this.updateReticle(dt, hk);
        const c = this.ctrl(hk);
        if (c.wasPressed('shoot') || c.wasPressed('pass') || c.wasPressed('tackle') || this.touchDive || (hk === 0 && input.mouse.pressed && !input.touchMode) || this.domRelease) this.keeperDive();
      }
      if (this.phaseT > (hk != null ? 1.6 : 0.9)) { this.phase = 'runup'; this.phaseT = 0; }
    }
  }

  updateRunup(dt) {
    this.keeper.update(dt);
    const hk = this.humanKeeper;
    if (hk != null) {
      this.updateReticle(dt, hk);
      const c = this.ctrl(hk);
      if (c.wasPressed('shoot') || c.wasPressed('pass') || c.wasPressed('tackle') || this.touchDive || (hk === 0 && input.mouse.pressed && !input.touchMode) || this.domRelease) this.keeperDive();
    }
    this.runner.t = this.phaseT;
    const dur = this.humanShooter != null ? 0.35 : 0.85;
    if (this.phaseT >= dur) this.strike();
  }

  /** The foot meets the ball. */
  strike() {
    const skill = this.shooter ? this.shooter.attrs.shooting : 0.7;
    let target, power, spin = 0, topspin = 0, knuckle = 0;
    if (this.humanShooter != null) {
      power = this.power;
      const extra = this.isFK ? 1 + Math.abs(this.curve) * 0.35 + (this.type === 'knuckle' ? 0.3 : 0) : 1;
      target = kickError(this.reticle, power, skill, this.rng, extra);
      if (this.isFK) { spin = this.curve * 1.4; if (this.type === 'dipping') topspin = 1.3; if (this.type === 'knuckle') { knuckle = 1; spin *= 0.2; } }
    } else if (!this.isFK) {
      const c = aiPenaltyChoice(this.rng);
      // if the human keeper committed early, most takers go the other way
      if (this.earlyDive && Math.random() < 0.7) c.y = CY - Math.sign(this.keeper.ty - CY || 1) * (1.8 + Math.random() * 1.4);
      power = c.power;
      target = kickError({ y: c.y, z: c.z }, power, skill, this.rng);
    } else {
      // AI free kick: curl it around the wall to the far post, or dip it over to the near post
      const near = this.ballPos.y < CY ? -1 : 1;
      const far = -near;
      let ty, tz;
      if (Math.random() < 0.6) { ty = CY + far * (GOAL.W / 2 - 0.6); tz = 0.5 + Math.random() * 1.3; }
      else { ty = CY + near * (GOAL.W / 2 - 0.7); tz = 1.9 + Math.random() * 0.3; topspin = 1.3; }
      power = 0.6 + Math.random() * 0.25;
      spin = (far > 0 ? 1 : -1) * 0.6 * (this.ballPos.x < L ? 1 : 1);
      target = kickError({ y: ty, z: tz }, power, skill, this.rng, 1.2);
    }
    const hsp = this.isFK ? freeKickSpeed(power) : penaltySpeed(power);
    launch(this.state, target, hsp, { spin, topspin, knuckle });
    this.kickT = 0;
    this.phase = 'flight'; this.phaseT = 0;
    sfx('kick', 0.5 + power * 0.5);
    // AI keeper reaction
    if (this.humanKeeper == null) {
      if (!this.isFK) {
        const g = keeperPenaltyGuess(this.rng, this.keeper.keeping, target, power);
        this.aiDive = { at: 0.04, y: g.y, z: g.z, dur: null };
      } else {
        this.aiDive = aiFreeKickDive(this.state.ball, this.keeper, this.wall.length > 0, this.rng);
      }
    } else this.aiDive = null;
  }

  updateFlight(dt) {
    this.kickT += dt;
    if (this.aiDive && this.kickT >= this.aiDive.at && this.keeper.state !== 'dive') { this.keeper.dive(this.aiDive.y, this.aiDive.z, this.aiDive.dur); }
    const hk = this.humanKeeper;
    if (hk != null) {
      const c = this.ctrl(hk);
      this.updateReticle(dt, hk);
      if (c.wasPressed('shoot') || c.wasPressed('pass') || c.wasPressed('tackle') || this.touchDive || (hk === 0 && input.mouse.pressed && !input.touchMode) || this.domRelease) this.keeperDive();
    }
    const before = this.state.events.length;
    stepKick(this.state, dt);
    for (const e of this.state.events.slice(before)) {
      if (e === 'post' || e === 'bar') sfx('post');
      if (e === 'save') sfx('save');
      if (e === 'wall') sfx('tackle');
      if (e === 'net') sfx('net');
    }
    if (this.state.done) this.onResult();
  }

  onResult() {
    const s = this.state, b = s.ball;
    const r = s.result || 'miss';
    this.result = r;
    this.phase = 'result'; this.phaseT = 0;
    let text = 'MISSED', color = '#ff6b6b';
    if (r === 'goal') { text = 'GOAL!'; color = '#7dffa0'; sfx('net'); sfx('roar'); this.bulge = { y: b.y, z: b.z, k: 0.8 }; }
    else if (r === 'save') { text = 'SAVED!'; color = '#8ecae6'; sfx('ooh'); }
    else if (r === 'wall') { text = 'BLOCKED BY THE WALL'; color = '#ffd166'; sfx('ooh'); }
    else if (r === 'post') { text = s.events.includes('bar') ? 'OFF THE BAR!' : 'OFF THE POST!'; color = '#ffd166'; sfx('ooh'); }
    else { text = b.z > GOAL.H - 0.2 ? 'OVER THE BAR' : 'WIDE'; sfx('ooh'); }
    this.resultText = { text, color };
    this.caught = r === 'save' && Math.random() < 0.45;
    if (this.mode === 'fkpractice') {
      const p = this.practice;
      p.attempts++;
      if (r === 'goal') { p.goals++; p.streak++; if (p.streak > p.best) { p.best = p.streak; store.set(FK_BEST_KEY, p.best); } }
      else p.streak = 0;
    }
    if (this.mode === 'shootout') {
      const so = this.so;
      so.res[so.turn].push(r === 'goal');
      so.idx[so.turn]++;
      this.checkShootout();
    }
  }

  checkShootout() {
    const so = this.so;
    const [a, b] = so.res;
    const ga = a.filter(Boolean).length, gb = b.filter(Boolean).length;
    const na = a.length, nb = b.length;
    if (na <= 5 && nb <= 5) {
      const remA = 5 - na, remB = 5 - nb;
      if (ga + remA < gb) so.winner = 1;
      else if (gb + remB < ga) so.winner = 0;
      else if (na === 5 && nb === 5 && ga !== gb) so.winner = ga > gb ? 0 : 1;
    } else if (na === nb && ga !== gb) so.winner = ga > gb ? 0 : 1;
    if (so.winner != null) so.done = true;
  }

  finishKick() {
    if (this.mode === 'penalty' || this.mode === 'freekick') {
      this.o.onDone({ result: this.result, caught: this.caught, y: this.state.ball.y, shooter: this.shooter });
      this.phase = 'done';
      return;
    }
    if (this.mode === 'shootout') {
      if (this.so.done) {
        if (this.phase !== 'over') { this.phase = 'over'; this.phaseT = 0; sfx('whistleEnd'); this.syncDom(); }
        return;
      }
      this.so.turn = 1 - this.so.turn;
    }
    this.nextKick();
  }

  // ---------- render ----------
  render(ctx, w, h) {
    const v = this.view;
    const bp = this.ballPos;
    const dir = norm(L - bp.x, CY - bp.y);
    const aiShooterVisible = this.humanShooter == null;
    const back = aiShooterVisible ? 5.2 : 4.6;
    let fwd = 0;
    if (this.phase === 'runup' && this.humanShooter != null) fwd = Math.min(1, this.phaseT / 0.35) * 1.4;
    const eye = { x: bp.x - dir.x * (back - fwd), y: bp.y - dir.y * (back - fwd), z: aiShooterVisible ? 1.75 : this.isFK ? 1.75 : 1.5 };
    const look = { x: L, y: CY + (bp.y - CY) * 0.12, z: this.isFK ? 1.4 : 1.05 };
    // keep the ball on the spot visible near the bottom of the screen
    v.setup(w, h, eye, look, this.isFK ? 0.42 : 0.55, { cyFrac: this.isFK ? 0.36 : 0.42, keep: { x: bp.x, y: bp.y, z: 0 }, maxY: 0.86 });

    v.drawBackground(ctx, this.time);
    v.drawGround(ctx);
    v.drawLines(ctx);
    const b = this.state.ball;
    const ballInGoal = b.x > L;
    if (ballInGoal) v.drawBall(ctx, b, b.rot);
    v.drawNet(ctx, this.bulge);
    v.drawPosts(ctx);

    // sprites sorted by depth (far first)
    const sprites = [];
    const kpose = this.keeper.pose();
    sprites.push({ d: this.depth(kpose.feet), draw: () => this.drawKeeper(ctx) });
    for (const wp of this.wall) sprites.push({ d: this.depth(wp), draw: () => v.drawFigure(ctx, { x: wp.x, y: wp.y, z: wp.jump }, { x: wp.x, y: wp.y, z: wp.jump + 1.8 }, this.defKit, { pose: wp.jump > 0.05 ? 'jump' : 'wall', num: null, skin: '#c89070' }) });
    if (aiShooterVisible) {
      const t = this.phase === 'runup' ? Math.min(1, this.phaseT / 0.85) : this.phase === 'aim' || this.phase === 'intro' ? 0 : 1;
      const perp = { x: -dir.y, y: dir.x };
      const sx = bp.x - dir.x * (2.6 - 2.2 * t) - perp.x * (1.3 - 1.1 * t), sy = bp.y - dir.y * (2.6 - 2.2 * t) - perp.y * (1.3 - 1.1 * t);
      const run = this.phase === 'runup' ? this.phaseT * 14 : 0;
      sprites.push({ d: this.depth({ x: sx, y: sy, z: 0 }), draw: () => v.drawFigure(ctx, { x: sx, y: sy, z: 0 }, { x: sx, y: sy, z: 1.8 }, this.attKit, { back: true, num: this.shooter.num, name: this.shooter.name, run }) });
    }
    if (!ballInGoal) sprites.push({ d: this.depth(b), draw: () => v.drawBall(ctx, b, b.rot) });
    sprites.sort((a, c) => c.d - a.d).forEach((s) => s.draw());

    if (this.phase === 'aim' && this.isFK && this.humanShooter != null) this.drawArc(ctx);
    if ((this.phase === 'aim' || this.phase === 'runup' || (this.phase === 'flight' && this.humanKeeper != null)) && (this.humanShooter != null || this.humanKeeper != null)) this.drawReticle(ctx);
    this.drawHud(ctx, w, h);
    if (this.phase === 'place') this.drawPlace(ctx, w, h);
  }

  depth(p) { const c = this.view.toCam({ x: p.x, y: p.y, z: p.z || 0 }); return c.z; }

  drawKeeper(ctx) {
    const k = this.keeper, pose = k.pose();
    const v = this.view;
    const kit = this.defGk;
    if (k.state === 'dive' && Math.abs(k.ty - k.y) >= 0.6) {
      // body axis from feet to beyond the hands
      const dx = pose.hands.y - pose.feet.y, dz = pose.hands.z - pose.feet.z, l = Math.hypot(dx, dz) || 1;
      const head = { x: pose.feet.x, y: pose.feet.y + (dx / l) * 1.8, z: pose.feet.z + (dz / l) * 1.8 };
      v.drawFigure(ctx, pose.feet, head, kit, { pose: 'dive', gloves: true, num: 1 });
    } else {
      const f = pose.feet;
      v.drawFigure(ctx, f, { x: f.x, y: f.y, z: f.z + 1.85 }, kit, { pose: k.state === 'dive' ? 'jump' : 'keeper', gloves: true, num: 1, sway: Math.sin(this.time * 4) * 0.15 });
    }
  }

  drawArc(ctx) {
    const hsp = freeKickSpeed(this.charging ? this.power : this.sliderPower);
    const pts = predictKick(this.ballPos, this.reticle, hsp, { spin: this.curve * 1.4 * (this.type === 'knuckle' ? 0.2 : 1), topspin: this.type === 'dipping' ? 1.3 : 0 });
    const v = this.view;
    for (let i = 0; i < pts.length; i += 2) {
      const q = v.project(pts[i]);
      if (!q) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.5 * (i / pts.length)})`;
      ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, q.s * 0.05), 0, TAU); ctx.fill();
      const g = v.project({ x: pts[i].x, y: pts[i].y, z: 0 });
      if (g && i % 4 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(g.x - 1, g.y - 1, 2, 2); }
    }
  }

  drawReticle(ctx) {
    const p = this.view.project({ x: L, y: this.reticle.y, z: this.reticle.z });
    if (!p) return;
    const inside = Math.abs(this.reticle.y - CY) < GOAL.W / 2 - BALL_R && this.reticle.z < GOAL.H - BALL_R;
    const risky = inside && (Math.abs(this.reticle.y - CY) > GOAL.W / 2 - 0.45 || this.reticle.z > GOAL.H - 0.35);
    const keeperMode = this.humanKeeper != null;
    const col = keeperMode ? '#35e0ff' : !inside ? '#ff5a5a' : risky ? '#ffb84d' : '#7dffa0';
    const r = Math.max(8, p.s * 0.28);
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - r * 1.5, p.y); ctx.lineTo(p.x - r * 0.4, p.y); ctx.moveTo(p.x + r * 0.4, p.y); ctx.lineTo(p.x + r * 1.5, p.y);
    ctx.moveTo(p.x, p.y - r * 1.5); ctx.lineTo(p.x, p.y - r * 0.4); ctx.moveTo(p.x, p.y + r * 0.4); ctx.lineTo(p.x, p.y + r * 1.5); ctx.stroke();
    if (keeperMode) { ctx.fillStyle = col; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.fillText(this.keeperDived ? 'DIVING' : 'DIVE HERE', p.x, p.y - r * 1.8); }
  }

  drawHud(ctx, w, h) {
    ctx.save();
    ctx.textBaseline = 'middle';
    // title strip
    const title = this.mode === 'fkpractice' ? 'FREE-KICK PRACTICE' : this.mode === 'shootout' ? 'PENALTY SHOOTOUT' : this.mode === 'penalty' ? 'PENALTY' : 'DIRECT FREE KICK';
    ctx.fillStyle = 'rgba(8,14,28,0.85)'; ctx.fillRect(14, 14, 250, 50);
    ctx.fillStyle = '#16a34a'; ctx.fillRect(14, 14, 6, 50);
    ctx.fillStyle = '#fff'; ctx.font = 'italic 900 16px Arial'; ctx.textAlign = 'left';
    ctx.fillText(title, 28, 30);
    ctx.font = 'bold 12px Arial'; ctx.fillStyle = '#cfd8ff';
    const sh = this.shooter ? `#${this.shooter.num} ${this.shooter.name}` : '';
    ctx.fillText(`${this.att.code}  ${sh}`, 28, 50);
    if (this.mode === 'fkpractice') {
      const p = this.practice;
      ctx.fillStyle = 'rgba(8,14,28,0.85)'; ctx.fillRect(14, 68, 250, 28);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial';
      ctx.fillText(`Goals ${p.goals}/${p.attempts}   Streak ${p.streak}   Best ${p.best}`, 24, 82);
      const d = Math.hypot(L - this.ballPos.x, CY - this.ballPos.y);
      ctx.fillStyle = 'rgba(8,14,28,0.7)'; ctx.fillRect(14, 100, 250, 22);
      ctx.fillStyle = '#cfd8ff'; ctx.font = '12px Arial'; ctx.fillText(`Distance ${d.toFixed(1)} m · Keeper: ${settings.difficulty}`, 24, 111);
    }
    if (this.mode === 'shootout') this.drawShootoutBoard(ctx, w);

    // power bar (vertical, right side)
    if (this.humanShooter != null) {
      const bx = w - 46, by = h * 0.25, bh = h * 0.42, bw = 20;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
      const pv = this.charging || this.phase !== 'aim' ? this.power : this.sliderPower;
      const g = ctx.createLinearGradient(0, by + bh, 0, by);
      g.addColorStop(0, '#5cff7a'); g.addColorStop(0.7, '#ffe14d'); g.addColorStop(1, '#ff4040');
      ctx.fillStyle = g; ctx.fillRect(bx, by + bh * (1 - pv), bw, bh * pv);
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(bx - 6, by + bh * (1 - 0.82), bw + 12, 2);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
      ctx.fillText('POWER', bx + bw / 2, by - 14);
      ctx.fillText(Math.round(pv * 100) + '%', bx + bw / 2, by + bh + 16);
      ctx.font = '10px Arial'; ctx.fillStyle = '#ffb3b3'; ctx.fillText('risk', bx - 18, by + bh * 0.1);
      if (this.isFK) {
        // curve & type indicator
        const cx = w - 150, cy = h * 0.25 + bh + 44;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - 70, cy - 12, 160, 44);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 11px Arial';
        ctx.fillText(`CURVE ${this.curve < -0.05 ? '◀' : this.curve > 0.05 ? '▶' : '•'} ${Math.abs(Math.round(this.curve * 100))}`, cx - 62, cy);
        ctx.fillText(`TYPE  ${this.type.toUpperCase()}`, cx - 62, cy + 18);
      }
    }
    // hints
    const b = input.binds.p1;
    let hint = '';
    if (this.phase === 'aim' && this.humanShooter != null) {
      const aimTxt = `Aim: mouse / ${keyLabel(b.up)}${keyLabel(b.left)}${keyLabel(b.down)}${keyLabel(b.right)}`;
      hint = input.touchMode ? 'Drag to aim · hold HOLD (or use slider + KICK)'
        : settings.penaltyPower === 'slider' ? `${aimTxt} · set power with the slider, then KICK or ${keyLabel(b.pass)} · (holding ${keyLabel(b.shoot)} also works)`
        : `${aimTxt} · Hold ${keyLabel(b.shoot)} or mouse button for power, release to shoot`;
      if (this.isFK && !input.touchMode) hint += ` · ${keyLabel(b.lob)}/${keyLabel(b.through)} curve · ${keyLabel(b.skill)} type`;
      if (this.mode === 'fkpractice' && !input.touchMode) hint += ' · N new spot · P place ball';
    } else if (this.humanKeeper != null && (this.phase === 'aim' || this.phase === 'runup' || this.phase === 'flight')) {
      hint = input.touchMode ? 'Tap where you want to dive — timing matters!' : `Pick a spot (mouse / move keys), press ${keyLabel(b.shoot)} / click to dive — go too early and he'll see it!`;
    }
    if (hint) {
      ctx.font = '13px Arial'; ctx.textAlign = 'center';
      const tw = Math.min(w - 20, ctx.measureText(hint).width + 24);
      // keep the hint clear of the on-screen kick controls
      let hy = h - 40;
      if (this.dom && !this.dom.classList.contains('hidden')) {
        const r = this.dom.getBoundingClientRect();
        if (r.height > 0 && r.right > w / 2 - tw / 2 && r.top < hy + 26) hy = r.top - 34;
      }
      ctx.fillStyle = 'rgba(8,14,28,0.75)'; ctx.fillRect(w / 2 - tw / 2, hy, tw, 26);
      ctx.fillStyle = '#e6ecff'; ctx.fillText(hint, w / 2, hy + 13, w - 30);
    }
    // result
    if (this.phase === 'result' && this.resultText) {
      const a = clamp(this.phaseT / 0.2, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(8,14,28,0.85)'; ctx.fillRect(w / 2 - 220, h * 0.2, 440, 70);
      ctx.fillStyle = this.resultText.color; ctx.fillRect(w / 2 - 220, h * 0.2, 8, 70); ctx.fillRect(w / 2 + 212, h * 0.2, 8, 70);
      ctx.fillStyle = '#fff'; ctx.font = 'italic 900 36px Arial'; ctx.textAlign = 'center';
      ctx.fillText(this.resultText.text, w / 2, h * 0.2 + 35);
      ctx.globalAlpha = 1;
    }
    if (this.phase === 'over' && this.so) {
      const so = this.so, win = so.teams[so.winner];
      ctx.fillStyle = 'rgba(8,14,28,0.9)'; ctx.fillRect(w / 2 - 240, h * 0.35, 480, 100);
      ctx.fillStyle = '#fff'; ctx.font = 'italic 900 30px Arial'; ctx.textAlign = 'center';
      ctx.fillText(`${win.name.toUpperCase()} WIN!`, w / 2, h * 0.35 + 36);
      const ga = so.res[0].filter(Boolean).length, gb = so.res[1].filter(Boolean).length;
      ctx.font = 'bold 16px Arial'; ctx.fillStyle = '#cfd8ff';
      ctx.fillText(`${so.teams[0].code} ${ga} – ${gb} ${so.teams[1].code} on penalties · press any key`, w / 2, h * 0.35 + 72);
    }
    if (this.msg) {
      ctx.fillStyle = 'rgba(8,14,28,0.85)'; ctx.fillRect(w / 2 - 200, h * 0.12, 400, 30);
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.fillText(this.msg.text, w / 2, h * 0.12 + 15);
    }
    ctx.restore();
  }

  drawShootoutBoard(ctx, w) {
    const so = this.so;
    const n = Math.max(5, so.res[0].length, so.res[1].length);
    const bw = 110 + n * 22;
    // centred at the top, or under the title strip on narrow screens
    const narrow = w / 2 - bw / 2 < 280;
    const x = narrow ? 14 : w / 2 - bw / 2, y = narrow ? 72 : 14;
    ctx.fillStyle = 'rgba(8,14,28,0.88)'; ctx.fillRect(x, y, bw, 58);
    for (let t = 0; t < 2; t++) {
      const yy = y + 16 + t * 26;
      ctx.fillStyle = so.kits[t].shirt; ctx.fillRect(x + 8, yy - 8, 12, 16);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'left';
      ctx.fillText(so.teams[t].code, x + 26, yy);
      ctx.fillText(String(so.res[t].filter(Boolean).length), x + 72, yy);
      for (let i = 0; i < n; i++) {
        const r = so.res[t][i];
        ctx.beginPath(); ctx.arc(x + 100 + i * 22, yy, 7, 0, TAU);
        ctx.fillStyle = r === undefined ? 'rgba(255,255,255,0.15)' : r ? '#3ddc84' : '#ff4d4d';
        ctx.fill();
      }
      if (so.turn === t && !so.done) { ctx.fillStyle = '#ffd166'; ctx.fillRect(x + 2, yy - 8, 3, 16); }
    }
  }

  drawPlace(ctx, w, h) {
    const r = this.placeRect();
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2f8a3a'; ctx.fillRect(r.x, r.y, r.w, r.h);
    const sx = r.w / 40, sy = r.h / PITCH.W;
    const X = (x) => r.x + (x - (L - 40)) * sx, Y = (y) => r.y + y * sy;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.strokeRect(X(L - BOX.D), Y(CY - BOX.W / 2), BOX.D * sx, BOX.W * sy);
    ctx.beginPath(); ctx.moveTo(X(L), r.y); ctx.lineTo(X(L), r.y + r.h); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(X(L), Y(CY - GOAL.W / 2), 6, GOAL.W * sy);
    // allowed ring
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.ellipse(X(L), Y(CY), 36 * sx, 36 * sy, 0, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(this.ballPos.x), Y(this.ballPos.y), 6, 0, TAU); ctx.fill();
    ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center'; ctx.fillText('Click / tap to place the ball (outside the box)', w / 2, r.y - 16);
  }
}
