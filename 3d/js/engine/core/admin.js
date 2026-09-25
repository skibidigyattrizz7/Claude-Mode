// Owner/admin "fun commands": temporary joke effects run by the AUTHORITATIVE simulation only
// (offline match or online host). Guests see them through the snapshot field `ae`. DOM-free.
//
// Engine API (index.js):
//   createMatch opts.adminLevel: 'owner'|'mod'|null   -> shows the hidden Admin menu (key ` or \, crown on touch)
//   createMatch opts.onAdminCommand(effectId, params)  -> used by a GUEST admin: the menu forwards the command
//                                                         (the net layer verifies the admin and calls
//                                                         applyAdminEffect on the host)
//   handle.listAdminEffects() -> [{id, label, desc, params:[{key,type,...}], ownerOnly, scope}]
//   handle.applyAdminEffect(id, params) -> {ok, label} | {ok:false, error}
//     id must be one of the whitelisted ids below. params (all optional, validated + clamped, never evaluated):
//       target  'opponent'|'mine'|'everyone'|'home'|'away'   (relative to `by`)
//       by      'home'|'away'  side of the admin issuing it (default home)
//       level   'owner'|'mod'  (default 'mod'; owner-only effects need 'owner')
//       seconds 1..120 (default 20)   count 1..6   player 1..10 (slot in team, -1 random)
//       name / homeName / awayName  <= 16 chars, sanitised     home / away  0..99 (edit scoreboard)
//     Rate-limited to 1 accepted command per 2 s per source.
// Snapshot: ae = [[code, target 0|1|2(both), remainingSeconds, param], ...] (param: vanished-player
// bitmask for 'va'/'eg', name for 'rn', otherwise 0). Effects never touch player stats/cards; any use
// marks the result with `admin: true` so callers can skip saving rewards.
import { PHASE, SP, PITCH, GOAL } from './constants.js';
import { setPhysMods } from './physics.js';
import { clamp } from './mathx.js';

const HL = PITCH.HL, HW = PITCH.HW;
const T = (key) => ({ key, type: 'target' });
const SECS = { key: 'seconds', type: 'number', min: 1, max: 120, def: 20 };

// code: 2-letter snapshot id. scope: 'team' (uses target) | 'global' | 'instant' (one-shot)
export const ADMIN_EFFECTS = [
  { id: 'vanish', code: 'va', label: 'Vanish', desc: 'Evaporate N outfield players of the target team for a while', scope: 'team', def: 'opponent', params: [T(), SECS, { key: 'count', type: 'number', min: 1, max: 6, def: 3 }] },
  { id: 'erasegk', code: 'eg', label: 'Erase goalkeeper', desc: 'Target team\'s keeper vanishes: empty net', scope: 'team', def: 'opponent', params: [T(), SECS] },
  { id: 'giantball', code: 'gb', label: 'Giant ball', desc: 'The ball becomes huge (and a bit slower)', scope: 'global', params: [SECS] },
  { id: 'tinyball', code: 'tb', label: 'Tiny ball', desc: 'A tiny, zippy ball', scope: 'global', params: [SECS] },
  { id: 'beachball', code: 'bb', label: 'Beach ball', desc: 'Floaty beach ball with massive curve', scope: 'global', params: [SECS] },
  { id: 'bowling', code: 'bw', label: 'Bowling ball', desc: 'Heavy ball that barely rolls', scope: 'global', params: [SECS] },
  { id: 'moon', code: 'mo', label: 'Moon gravity', desc: 'Low gravity: the ball floats for ages', scope: 'global', params: [SECS] },
  { id: 'bounce', code: 'bo', label: 'Super bounce', desc: 'The ball bounces like rubber', scope: 'global', params: [SECS] },
  { id: 'shrink', code: 'sh', label: 'Shrink players', desc: 'Tiny players: quicker, but less reach', scope: 'team', def: 'opponent', params: [T(), SECS] },
  { id: 'giant', code: 'gi', label: 'Giant players', desc: 'Giants: huge reach, a bit slower', scope: 'team', def: 'mine', params: [T(), SECS] },
  { id: 'bigheads', code: 'bh', label: 'Big heads', desc: 'Comically big heads', scope: 'team', def: 'everyone', params: [T(), SECS] },
  { id: 'slowmo', code: 'sm', label: 'Slow-mo team', desc: 'Target team moves at 50% speed', scope: 'team', def: 'opponent', params: [T(), SECS] },
  { id: 'turbo', code: 'tu', label: 'Turbo me', desc: 'Controlled player runs 1.5x faster', scope: 'team', def: 'mine', params: [T(), SECS] },
  { id: 'reverse', code: 're', label: 'Reverse controls', desc: 'Target human\'s controls are mirrored', scope: 'team', def: 'opponent', params: [T(), SECS] },
  { id: 'freeze', code: 'fr', label: 'Freeze', desc: 'Target team frozen in ice for 5 s', scope: 'team', def: 'opponent', params: [T(), { key: 'seconds', type: 'number', min: 1, max: 5, def: 5 }] },
  { id: 'butterfingers', code: 'bf', label: 'Butterfingers', desc: 'Target keeper spills everything', scope: 'team', def: 'opponent', params: [T(), SECS] },
  { id: 'wall', code: 'wk', label: 'Wall of keepers', desc: 'The goal the target attacks shrinks behind a wall of keepers', scope: 'team', def: 'opponent', params: [T(), SECS] },
  { id: 'magnet', code: 'mg', label: 'Magnet ball', desc: 'Loose ball drifts toward the admin\'s player', scope: 'global', params: [SECS] },
  { id: 'disco', code: 'di', label: 'Disco lights', desc: 'Disco lights and a crowd chant', scope: 'global', params: [SECS] },
  { id: 'confetti', code: 'cf', label: 'Confetti cannon', desc: 'Fire the confetti cannons', scope: 'instant', params: [] },
  { id: 'rename', code: 'rn', label: 'Rename team', desc: 'Change the target team\'s scoreboard name', scope: 'team', def: 'opponent', params: [T(), SECS, { key: 'name', type: 'text', max: 16, def: 'NOOBS' }] },
  { id: 'scoreup', code: 'su', label: 'Score +1', desc: 'ADMIN GOAL for the target team', scope: 'instant', def: 'mine', params: [T()] },
  { id: 'scoredown', code: 'sd', label: 'Score -1', desc: 'VAR SAYS NO: take a goal away', scope: 'instant', def: 'opponent', params: [T()] },
  { id: 'redcard', code: 'rd', label: 'Instant red card', desc: 'Send off a chosen player (this match only)', scope: 'instant', def: 'opponent', params: [T(), { key: 'player', type: 'player', min: -1, max: 10, def: -1 }] },
  { id: 'swap', code: 'sw', label: 'Swap scores', desc: 'Swap the two scores', scope: 'instant', params: [] },
  { id: 'editscore', code: 'es', label: 'Edit scoreboard', desc: 'Set any score / team names', scope: 'instant', params: [{ key: 'home', type: 'number', min: 0, max: 99 }, { key: 'away', type: 'number', min: 0, max: 99 }, { key: 'homeName', type: 'text', max: 16 }, { key: 'awayName', type: 'text', max: 16 }, SECS] },
  { id: 'end', code: 'en', label: 'End match now', desc: 'Blow the final whistle', scope: 'instant', ownerOnly: true, params: [] },
  { id: 'win', code: 'wn', label: 'Instant win', desc: 'End the match as a win for the admin', scope: 'instant', ownerOnly: true, params: [] },
  { id: 'reset', code: 'rs', label: 'Reset all effects', desc: 'Remove every active effect', scope: 'instant', params: [] },
];
export const ADMIN_BY_ID = Object.fromEntries(ADMIN_EFFECTS.map((e) => [e.id, e]));
export const ADMIN_BY_CODE = Object.fromEntries(ADMIN_EFFECTS.map((e) => [e.code, e]));
// mutually exclusive groups (a new one replaces the other)
const EXCL = [['gb', 'tb'], ['bb', 'bw'], ['sh', 'gi']];
// visual/physical constants shared with the renderer
export const ADMIN_SCALE = { sh: 0.55, gi: 1.6 };
export const WALL_OPEN = 1.1; // half-width of the goal mouth left open by the wall of keepers

export function sanitizeName(s) {
  return String(s ?? '').replace(/[^\p{L}\p{N} .'!?_-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? clamp(Math.round(n), min, max) : def; };

export class AdminFx {
  constructor(sim) {
    this.sim = sim;
    this.list = [];       // active timed effects {code, tg, until, param, data}
    this.touched = false; // any admin effect used this match
    this.spd = new Float32Array(sim.players.length).fill(1);
    this.kickMul = 1;
    this.physKey = '';
    this.names = [null, null];
  }

  // ---------------------------------------------------------------- queries
  has(code, team) { return this.list.some((e) => e.code === code && (team == null || e.tg === 2 || e.tg === team)); }
  teams(tg) { return tg === 2 ? [0, 1] : [tg]; }
  encode() {
    const t = this.sim.t;
    return this.list.map((e) => [e.code, e.tg, Math.max(0, Math.round((e.until - t) * 10) / 10), e.param ?? 0]);
  }

  // ---------------------------------------------------------------- validation + apply
  // Returns {ok, label, code} or {ok:false, error}. Never throws for bad input.
  apply(id, params) {
    const def = typeof id === 'string' && Object.prototype.hasOwnProperty.call(ADMIN_BY_ID, id) ? ADMIN_BY_ID[id] : null;
    if (!def) return { ok: false, error: 'unknown effect' };
    const p = params && typeof params === 'object' ? params : {};
    const level = p.level === 'owner' ? 'owner' : 'mod';
    if (def.ownerOnly && level !== 'owner') return { ok: false, error: 'owner only' };
    const sim = this.sim;
    if (sim.ended) return { ok: false, error: 'match over' };
    const by = p.by === 'away' || p.by === 1 ? 1 : 0;
    const tRaw = ['opponent', 'mine', 'everyone', 'home', 'away'].includes(p.target) ? p.target : def.def || 'everyone';
    let tg = tRaw === 'mine' ? by : tRaw === 'opponent' ? 1 - by : tRaw === 'home' ? 0 : tRaw === 'away' ? 1 : 2;
    if (def.scope === 'global') tg = 2;
    const sp = def.params.find((q) => q.key === 'seconds');
    const secs = sp ? num(p.seconds, sp.min, sp.max, sp.def) : 0;
    let r;
    try { r = this._apply(def, tg, secs, p, by); } catch (e) { r = { ok: false, error: 'failed' }; }
    if (r && r.ok) {
      this.touched = true;
      sim.fxPush('admin', { e: def.code, tg, ...(r.fx || {}) });
      return { ok: true, label: def.label, code: def.code };
    }
    return r || { ok: false, error: 'failed' };
  }

  _add(code, tg, secs, param = 0, data = null) {
    const t = this.sim.t;
    // replace the same effect on overlapping targets + exclusive partners
    const grp = EXCL.find((g) => g.includes(code)) || [code];
    const overlap = (a) => a === 2 || tg === 2 || a === tg;
    for (const e of [...this.list]) if (grp.includes(e.code) && overlap(e.tg) && !(e.code === code && (code === 'va' || code === 'eg'))) this._end(e);
    const e = { code, tg, until: t + secs, param, data };
    this.list.push(e);
    return e;
  }

  _apply(def, tg, secs, p, by) {
    const sim = this.sim, c = def.code;
    switch (c) {
      case 'va': {
        const n = num(p.count, 1, 6, 3);
        let mask = 0;
        for (const team of this.teams(tg)) mask |= this._vanish(team, n, secs);
        return mask || this.has('va') ? { ok: true } : { ok: false, error: 'nobody to vanish' };
      }
      case 'eg': {
        for (const team of this.teams(tg)) {
          const old = this.list.find((e) => e.code === 'eg' && e.tg === team);
          if (old) old.until = sim.t + secs;
          else this.list.push({ code: 'eg', tg: team, until: sim.t + secs, param: 0, data: { pending: true } });
        }
        this._stepErase();
        return { ok: true };
      }
      case 'gb': case 'tb': case 'bb': case 'bw': case 'mo': case 'bo': case 'sh': case 'gi': case 'bh':
      case 'sm': case 're': case 'bf': case 'wk': case 'di':
        this._add(c, tg, secs); return { ok: true };
      case 'tu': case 'mg': this._add(c, c === 'mg' ? by : tg, secs); return { ok: true };
      case 'fr': {
        this._add(c, tg, Math.min(5, secs));
        this._freezeNow();
        return { ok: true };
      }
      case 'cf': return { ok: true };
      case 'rn': {
        const name = sanitizeName(p.name);
        if (!name) return { ok: false, error: 'empty name' };
        this._add('rn', tg, secs, name.toUpperCase());
        return { ok: true };
      }
      case 'su': case 'sd': {
        for (const team of this.teams(tg)) sim.score[team] = clamp(sim.score[team] + (c === 'su' ? 1 : -1), 0, 99);
        return { ok: true };
      }
      case 'sw': { sim.score = [sim.score[1], sim.score[0]]; return { ok: true }; }
      case 'es': {
        const h = num(p.home, 0, 99, sim.score[0]), a = num(p.away, 0, 99, sim.score[1]);
        sim.score = [h, a];
        const hn = sanitizeName(p.homeName), an = sanitizeName(p.awayName);
        if (hn) this._add('rn', 0, secs || 20, hn.toUpperCase());
        if (an) this._add('rn', 1, secs || 20, an.toUpperCase());
        return { ok: true };
      }
      case 'rd': {
        const team = tg === 2 ? 1 - by : tg;
        const pi = this._redCard(team, num(p.player, -1, 10, -1));
        return pi >= 0 ? { ok: true, fx: { pi } } : { ok: false, error: 'no player to send off' };
      }
      case 'en': case 'wn': {
        if (c === 'wn' && sim.score[by] <= sim.score[1 - by]) sim.score[by] = Math.min(99, sim.score[1 - by] + 1);
        this.reset();
        this.touched = true;
        sim._fullTime();
        return { ok: true, fx: { by } };
      }
      case 'rs': this.reset(); return { ok: true };
    }
    return { ok: false, error: 'unknown effect' };
  }

  // ---------------------------------------------------------------- vanish / erase / red card
  _onPitch(team) { return this.sim.teamList[team].filter((m) => !m.isGK).length; }
  _vanish(team, n, secs) {
    const sim = this.sim;
    let e = this.list.find((x) => x.code === 'va' && x.tg === team);
    if (!e) { e = { code: 'va', tg: team, until: sim.t + secs, param: 0, data: { ids: [] } }; this.list.push(e); }
    e.until = Math.max(e.until, sim.t + secs);
    const b = sim.ball, taker = sim.sp && !sim.sp.done && (sim.phase === PHASE.SETPIECE || sim.phase === PHASE.KICKOFF) ? sim.sp.taker : -1;
    const cands = sim.teamList[team].filter((m) => !m.isGK && !m.sentOff && !m.pendingOff && m.idx !== b.owner && m.idx !== taker && m.idx !== b.intended);
    // prefer the most dangerous players (closest to the ball)
    cands.sort((a, c) => Math.hypot(a.x - b.p.x, a.z - b.p.z) - Math.hypot(c.x - b.p.x, c.z - b.p.z));
    const room = Math.max(0, Math.min(6 - e.data.ids.length, this._onPitch(team) - 4));
    let mask = 0;
    for (const m of cands.slice(0, Math.min(n, room))) {
      m.sentOff = true; m.admVanish = true; m.act = null; m.run = null; m.vx = 0; m.vz = 0;
      m.admLast = { x: m.x, z: m.z };
      m.x = -1000; m.z = -1000;
      e.data.ids.push(m.idx);
      mask |= 1 << m.idx;
    }
    e.param = e.data.ids.reduce((acc, i) => acc | (1 << i), 0);
    if (!e.data.ids.length) this.list.splice(this.list.indexOf(e), 1);
    this._rebuild();
    return mask;
  }
  _respawn(p) {
    const sim = this.sim, d = sim.dir[p.team];
    p.sentOff = false; p.admVanish = false;
    let x, z;
    if (p.isGK) { x = -d * (HL - 1); z = 0; }
    else if (sim.phase === PHASE.PLAY && p.home && Number.isFinite(p.home.x) && Number.isFinite(p.home.z) && Math.abs(p.home.x) < HL && Math.abs(p.home.z) < HW) { x = p.home.x; z = p.home.z; }
    else { x = sim.wx(p.team, clamp(p.sd.d * 95, 8, 46)); z = clamp(p.sd.l * d * 25, -HW + 2, HW - 2); }
    sim._teleport(p, x, z);
    p.face = Math.atan2(-z, -x);
    p.cool.touch = sim.t + 0.4;
  }
  _stepErase() {
    const sim = this.sim, b = sim.ball;
    for (const e of this.list) {
      if (e.code !== 'eg' || !e.data.pending) continue;
      const g = sim.gk(e.tg);
      const taker = sim.sp && !sim.sp.done && (sim.phase === PHASE.SETPIECE || sim.phase === PHASE.KICKOFF) ? sim.sp.taker : -1;
      if (g.sentOff || b.owner === g.idx || taker === g.idx) continue; // wait until he lets go of the ball
      g.sentOff = true; g.admVanish = true; g.act = null; g.gkPlan = null;
      g.admLast = { x: g.x, z: g.z };
      g.x = -1000; g.z = -1000;
      e.data.pending = false; e.data.ids = [g.idx]; e.param = 1 << g.idx;
      if (sim.ctrl[e.tg] === g.idx) this._fixCtrl(e.tg);
    }
  }
  _redCard(team, slot) {
    const sim = this.sim, b = sim.ball;
    if (this._onPitch(team) <= 6) return -1;
    const taker = sim.sp && !sim.sp.done && (sim.phase === PHASE.SETPIECE || sim.phase === PHASE.KICKOFF) ? sim.sp.taker : -1;
    const ok = (m) => m && !m.isGK && !m.sentOff && !m.pendingOff && m.idx !== taker;
    let p = slot >= 1 ? sim.players[team * 11 + slot] : null;
    if (!ok(p)) {
      const c = sim.teamList[team].filter(ok);
      if (!c.length) return -1;
      p = c[Math.floor(sim.rng() * c.length)];
    }
    if (b.owner === p.idx) { b.owner = -1; b.inHands = false; sim.path = null; }
    p.sentOff = true; p.admWalk = true; p.act = null; p.run = null;
    this._rebuild();
    // a card fx (flagged `adm`) for the banner; no stats, no match event
    sim.fxPush('card', { pi: p.idx, c: 'r', adm: 1 });
    return p.idx;
  }
  // walk-off of an admin-red-carded player (called from sim._walkOff)
  walkOff(p, dt) {
    if (!p.admWalk) return false;
    const sz = p.z >= 0 ? 1 : -1;
    const tz = sz * (HW + 4);
    const dz = tz - p.z;
    if (Math.abs(dz) < 0.3 || !Number.isFinite(p.x + p.z)) { p.admWalk = false; p.x = -1000; p.z = -1000; p.speed = 0; return false; }
    const v = 2.4;
    p.z += Math.sign(dz) * Math.min(Math.abs(dz), v * dt);
    p.vx = 0; p.vz = Math.sign(dz) * v; p.speed = v;
    p.face = Math.atan2(Math.sign(dz), 0);
    return true;
  }
  _rebuild() {
    const sim = this.sim;
    sim.teamList = [sim.players.slice(0, 11).filter((q) => !q.sentOff), sim.players.slice(11).filter((q) => !q.sentOff)];
    for (let team = 0; team < 2; team++) { const c = sim.players[sim.ctrl[team]]; if (c && c.sentOff) this._fixCtrl(team); }
  }
  _fixCtrl(team) {
    const sim = this.sim;
    const n = sim.nearestToBall(team) || sim.teamList[team][0];
    if (n) sim.ctrl[team] = n.idx;
  }

  // ---------------------------------------------------------------- expiry
  _end(e) {
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    const sim = this.sim;
    if ((e.code === 'va' || e.code === 'eg') && e.data && e.data.ids) {
      for (const idx of e.data.ids) { const p = sim.players[idx]; if (p && p.admVanish) this._respawn(p); }
      this._rebuild();
    }
    if (e.code === 'mg' || e.code === 'fr') sim.path = null;
  }
  reset() {
    for (const e of [...this.list]) this._end(e);
    this.list.length = 0;
    this._mods(true);
  }
  dispose() {
    this.list.length = 0;
    setPhysMods(null);
    this.physKey = '';
  }

  // ---------------------------------------------------------------- per-step
  // Called at the start of every sim step (after the clock advanced).
  step(dt) {
    const sim = this.sim;
    if (!this.list.length) { if (this.physKey || this.kickMul !== 1 || this._scaled) this._mods(true); return; }
    for (const e of [...this.list]) if (sim.t >= e.until) this._end(e);
    this._stepErase();
    this._mods(false);
    if (sim.phase !== PHASE.PLAY || sim.shootout) return;
    const b = sim.ball, t = sim.t;
    // freeze: no touches/tackles, owner loses the ball
    if (this.has('fr')) this._freezeNow();
    // butterfingers: a keeper holding the ball spills it
    if (b.owner >= 0 && b.inHands) {
      const g = sim.players[b.owner];
      if (g.isGK && this.has('bf', g.team)) {
        const d = sim.dir[g.team];
        b.owner = -1; b.inHands = false; b.intended = -1;
        b.v.x = d * (1.8 + sim.rng() * 2.2); b.v.z = (sim.rng() - 0.5) * 6; b.v.y = 1.6 + sim.rng() * 1.5;
        b.w.x = b.w.y = b.w.z = 0;
        g.cool.touch = t + 0.9; sim.path = null; sim.pendingPass = null;
        sim.fxPush('admin', { e: 'spill', tg: g.team, pi: g.idx });
      }
    }
    // magnet ball: loose ball drifts toward the admin's player
    const mg = this.list.find((e) => e.code === 'mg');
    if (mg && b.owner < 0 && b.p.y < 4) {
      const team = mg.tg === 2 ? 0 : mg.tg;
      const tp = sim.human[team] && sim.ctrl[team] >= 0 ? sim.players[sim.ctrl[team]] : sim.nearestToBall(team);
      if (tp && !tp.sentOff) {
        const dx = tp.x - b.p.x, dz = tp.z - b.p.z, dd = Math.hypot(dx, dz);
        if (dd > 0.7 && dd < 60) {
          const a = 7 * dt;
          b.v.x += (dx / dd) * a; b.v.z += (dz / dd) * a;
          const s = Math.hypot(b.v.x, b.v.z);
          if (s > 14) { b.v.x *= 14 / s; b.v.z *= 14 / s; }
          if (b.p.y <= 0.12) { b.w.x = b.v.z / 0.11; b.w.z = -b.v.x / 0.11; }
          if (sim.nextPredict > t + 0.05) sim.nextPredict = t + 0.05;
        }
      }
    }
  }
  _freezeNow() {
    const sim = this.sim, b = sim.ball, t = sim.t;
    if (sim.phase !== PHASE.PLAY) return;
    for (const e of this.list) {
      if (e.code !== 'fr') continue;
      for (const team of this.teams(e.tg)) {
        for (const p of sim.teamList[team]) {
          p.cool.touch = Math.max(p.cool.touch, t + 0.05); p.cool.tackle = Math.max(p.cool.tackle, t + 0.05); p.cool.steal = Math.max(p.cool.steal, t + 0.05);
          if (p.act && p.act.type !== 'dive') p.act = null;
          p.vx = 0; p.vz = 0; p.windup = 0;
          if (b.owner === p.idx) { b.owner = -1; b.inHands = false; b.v.x = b.v.z = 0; b.intended = -1; sim.path = null; }
        }
      }
    }
  }
  // speed multipliers, physics modifiers, player scale
  _mods(clear) {
    const sim = this.sim, spd = this.spd;
    spd.fill(1);
    let key = '';
    const m = { g: 1, drag: 1, magnus: 1, spinDecay: 1, roll: 1 };
    let kick = 1;
    if (!clear) {
      for (const e of this.list) {
        switch (e.code) {
          case 'gb': m.drag *= 1.8; kick *= 0.9; break;
          case 'tb': m.drag *= 0.7; m.roll *= 0.8; kick *= 1.08; break;
          case 'bb': m.drag *= 4.5; m.magnus *= 3.5; m.spinDecay *= 0.4; m.g *= 0.75; m.restHi = 0.82; m.restLo = 0.72; kick *= 0.9; break;
          case 'bw': m.drag *= 0.3; m.roll *= 4.5; m.magnus *= 0.1; m.restHi = 0.12; m.restLo = 0.05; kick *= 0.5; break;
          case 'mo': m.g *= 0.17; m.drag *= 0.6; break;
          case 'bo': m.restHi = Math.max(m.restHi || 0, 0.93); m.restLo = 0.88; m.grip = 0.97; break;
        }
      }
      key = JSON.stringify(m) + kick;
      if (key === JSON.stringify({ g: 1, drag: 1, magnus: 1, spinDecay: 1, roll: 1 }) + 1) key = '';
      const play = sim.phase === PHASE.PLAY && !sim.shootout;
      for (const e of this.list) {
        for (const team of this.teams(e.tg)) {
          const base = team * 11;
          switch (e.code) {
            case 'sm': if (play) for (let i = base; i < base + 11; i++) spd[i] *= 0.5; break;
            case 'fr': if (play) for (let i = base; i < base + 11; i++) spd[i] = 0; break;
            case 'sh': for (let i = base; i < base + 11; i++) spd[i] *= 1.15; break;
            case 'gi': for (let i = base; i < base + 11; i++) spd[i] *= 0.88; break;
            case 'tu': if (play) {
              const ci = sim.human[team] && sim.ctrl[team] >= 0 ? sim.ctrl[team] : (sim.owner() && sim.owner().team === team ? sim.ball.owner : -1);
              if (ci >= 0) spd[ci] *= 1.5;
              break;
            }
          }
        }
      }
    }
    this.kickMul = kick;
    if (key !== this.physKey) { this.physKey = key; setPhysMods(key ? { ...m } : null); }
    // shrink / giant: reach via height (restored exactly when the effect ends; subs re-base)
    let scaled = false;
    for (const p of sim.players) {
      let s = 1;
      if (!clear) { if (this.has('sh', p.team)) s = 0.7; else if (this.has('gi', p.team)) s = 1.3; }
      if (p._admS == null) p._admS = 1;
      if (p._admS !== 1 && Math.abs(p.h - p._admH0 * p._admS) > 1e-9) p._admS = 1; // re-based by a substitution
      if (s !== p._admS) {
        if (p._admS === 1) p._admH0 = p.h;
        p.h = s === 1 ? p._admH0 : p._admH0 * s;
        p._admS = s;
      }
      if (s !== 1) scaled = true;
    }
    this._scaled = scaled;
  }

  // reversed controls for target human sides (returns a new inputs array)
  mapInputs(inputs) {
    if (!this.list.length) return inputs;
    let out = inputs;
    for (let team = 0; team < 2; team++) {
      const inp = inputs[team];
      if (!inp || !this.sim.human[team] || !this.has('re', team)) continue;
      if (out === inputs) out = [...inputs];
      const o = { ...inp };
      for (const k of ['mx', 'my', 'aimX', 'aimY', 'cx', 'cy']) if (typeof o[k] === 'number') o[k] = -o[k];
      out[team] = o;
    }
    return out;
  }

  // wall of keepers: the goal a target team attacks only has a narrow opening in the middle
  ballGuard() {
    if (!this.list.length) return;
    const sim = this.sim, b = sim.ball, p = b.p;
    for (const e of this.list) {
      if (e.code !== 'wk') continue;
      for (const team of this.teams(e.tg)) {
        const s = sim.dir[team];
        const u = s * p.x;
        const az = Math.abs(p.z);
        if (u > HL - 0.55 && u < HL + 0.6 && az > WALL_OPEN && az < GOAL.HW + 0.35 && p.y < GOAL.H + 0.25) {
          const g = sim.gk(1 - team);
          if (b.owner >= 0) { b.owner = -1; b.inHands = false; }
          p.x = s * (HL - 0.6);
          const vx = s * b.v.x;
          b.v.x = -s * Math.max(2, Math.abs(vx) * 0.45);
          b.v.z *= 0.5; b.v.y = Math.abs(b.v.y) * 0.4 + 1.2;
          b.w.x = b.w.y = b.w.z = 0;
          b.lastTouch = g.idx; b.lastTeam = 1 - team; b.intended = -1;
          sim.path = null; sim.pendingPass = null;
          if (vx > 3) sim.fxPush('post', { s: Math.round(vx) });
        }
      }
    }
  }
}
