// Compact snapshot encoding (host -> guest) and interpolation into a render "view". DOM-free.
// A view is the uniform structure the renderer/HUD consume, for local, host, guest and replay.
//
// ============================ VIEW FORMAT (renderer contract) ============================
// World frame: x along pitch length (-52.5..52.5), z across (-34..34), y up, metres.
// Broadcast camera sits on the +z side looking toward -z (screen right = +x).
// Facing angle `face`: direction (cos face, sin face) in (x, z). A model whose local forward
// is +z needs rotation.y = PI/2 - face.
//   v      1
//   t      sim time (s)
//   ph     phase: PHASE.* from constants.js (KICKOFF 0, PLAY 1, STOP 2, SETPIECE 3, GOAL 4,
//          REPLAY 5, HALFTIME 6, FULLTIME 7)
//   spt    active set-piece type (SP.* : KICKOFF 0, THROW 1, CORNER 2, GOALKICK 3, FREEKICK 4,
//          PENALTY 5) or -1;  spk = team taking it (0 home / 1 away) or -1
//   h      half (1|2); cl clock seconds within half; ad added minutes (0 until shown)
//   sc     [homeGoals, awayGoals];  dir = attack direction of HOME (+1 => home attacks +x)
//   b      ball [px, py, pz, vx, vy, vz];  bo = owner player index or -1;  bh = 1 if in keeper's hands
//   p      players, stride 7: [x, z, face, anim, animT, animP, speed] * 22
//          index 0..10 = home (0 = GK), 11..21 = away (11 = GK), same order as team.players
//          anim = ANIM.* code (constants.js); animT = seconds since the action started;
//          animP = action parameter:
//            KICK: 0.4 pass / 0.7 lofted / 1 shot   WINDUP: power 0..1   HEAD/WALL: jump height (m)
//            DIVE: sign = world-z side of the dive (+1 => toward +z), |animP|-1 = hand height (m)
//                  (flight ~0.28-0.5 s, then lying on the ground until the action ends ~1.3 s)
//            CELEB: variant 0 arms up / 1 airplane / 2 knee slide
//            SKILL: kind%10 (0 step-over, 1 roulette, 2 ball roll, 3 heel-to-heel), +10 => to the left
//            SLIDE: animT continues past 0.72 s while getting up (to ~1.22 s)
//   so     bitmask of sent-off players (hide them);  yc = string of yellow-card counts per player
//   c      [homeCtrlIdx, awayCtrlIdx] human-controlled player per side (-1 if AI side)
//   stm    stamina 0..1 of the controlled players
//   st     [possHome%, shotsH, shotsA, onTargetH, onTargetA, passesH, passesA]
//   fx     recent effects (last 1.5 s), each {id, t, k, ...}; ids increase monotonically:
//          k='kick' {s: speed} | 'touch' | 'post' {s} | 'net' {x,y,z,s} (net ripple at impact point)
//          | 'goal' {team, pi, og} | 'save' {pi} | 'parry' {pi} | 'foul' {pi, pen} | 'card' {pi, c:'y'|'r'}
//          | 'offside' {pi} | 'whistle' {n: 0 start/1 stop/2 half/3 full} | 'cut' (teleport/camera cut)
//          | 'setpiece' {type, team} | 'sub' {team, i, bi} | 'added' {n} | 'halftime' | 'fulltime' | 'out'
//   subs   [[team, playerSlotIndex, benchIndex], ...] substitutions so far (bench = team.bench);
//          rv increments on every roster change (rebuild shirt number / name)
//   scr    scorers [[playerId, team, minute, ownGoal]];  gt time of last goal;  pt phase start time
//   fin    final result object (only at full time)
// Local-only fields added by index.js before calling renderer.render(view, dt) (not in snapshots):
//   aim     [ {x,z} | null, {x,z} | null ]  unit aim direction of each LOCAL human's controlled
//           player (draw a faint ground arrow), null when not applicable
//   pw      [0..1, 0..1] power of the kick button currently held by each local human (0 = none)
//   traj    null | flat [x,y,z, x,y,z, ...] predicted set-piece ball path (draw dotted line)
//   penAim  null | {x,y,z} penalty target point on the goal line (draw a reticle)
//   replay  true when this view is a replay frame (use the replay camera)
//   local   [ 'p1'|'p2'|null, 'p1'|'p2'|null ] which local human (if any) controls home / away on
//           THIS machine (colour the controlled-player indicator: p1 blue, p2 red)
// Optional renderer hooks used by the HUD if present (feature-detected):
//   renderer.project(x, y, z) -> {x, y, visible} CSS pixels relative to the container
//          (places the power bar / name label under/above the controlled player)
//   renderer.getCameraYaw() -> horizontal camera forward angle (rad, same convention as `face`)
//          used to make controls camera-relative in the pro camera
// ==========================================================================================
import { PHASE } from './constants.js';
import { r2, r1, wrapAngle, lerp } from './mathx.js';

const PSTRIDE = 7; // x, z, face, anim, animT, animP, speed

// Build a view from a live simulation (full precision, shared objects are copied).
export function viewFromSim(sim) {
  const ps = sim.players;
  const p = new Array(ps.length * PSTRIDE);
  let so = 0;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i], o = i * PSTRIDE;
    p[o] = q.x; p[o + 1] = q.z; p[o + 2] = q.face; p[o + 3] = q.anim; p[o + 4] = q.animT; p[o + 5] = q.animP; p[o + 6] = q.speed;
    if (q.sentOff) so |= 1 << i;
  }
  const b = sim.ball;
  const tot = sim.stats.poss[0] + sim.stats.poss[1] || 1;
  return {
    v: 1,
    t: sim.t,
    ph: sim.phase,
    spt: sim.sp && !sim.sp.done ? sim.sp.type : -1,
    spk: sim.sp && !sim.sp.done ? sim.sp.team : -1,
    h: sim.half,
    cl: sim.clock,
    ad: sim.addedSet ? sim.added : 0,
    sc: [sim.score[0], sim.score[1]],
    dir: sim.dir[0],
    b: [b.p.x, b.p.y, b.p.z, b.v.x, b.v.y, b.v.z],
    bo: b.owner,
    bh: b.inHands ? 1 : 0,
    p,
    so,
    yc: sim.players.map((q) => q.yellow).join(''),
    c: [sim.human[0] ? sim.ctrl[0] : -1, sim.human[1] ? sim.ctrl[1] : -1],
    stm: [sim.ctrl[0] >= 0 ? sim.players[sim.ctrl[0]].stam : 1, sim.ctrl[1] >= 0 ? sim.players[sim.ctrl[1]].stam : 1],
    st: [Math.round((sim.stats.poss[0] / tot) * 100), sim.stats.shots[0], sim.stats.shots[1], sim.stats.sot[0], sim.stats.sot[1], sim.stats.passes[0], sim.stats.passes[1]],
    fx: sim.fx.filter((f) => sim.t - f.t < 1.5),
    subs: sim.subs,
    rv: sim.rosterVer,
    scr: sim.scorers.map((s) => [s.playerId, s.team === 'home' ? 0 : 1, s.minute, s.ownGoal ? 1 : 0]),
    gt: sim.goalT || 0,
    pt: sim.phaseT,
    fin: sim.result || null,
  };
}

// Compact, JSON-safe snapshot (floats rounded to 2 dp).
export function encodeSnapshot(sim) {
  const v = viewFromSim(sim);
  v.t = r2(v.t);
  v.cl = r1(v.cl);
  v.b = v.b.map(r2);
  v.p = v.p.map((x, i) => (i % PSTRIDE === 3 ? x : r2(x)));
  v.stm = v.stm.map(r2);
  v.gt = r2(v.gt);
  v.pt = r2(v.pt);
  v.fx = v.fx.map((f) => {
    const o = {};
    for (const k in f) o[k] = typeof f[k] === 'number' ? r2(f[k]) : f[k];
    return o;
  });
  if (!v.fin) delete v.fin;
  if (!v.subs.length) delete v.subs;
  return v;
}

// Interpolate two views (a older, b newer) at fraction f -> new view object.
export function lerpView(a, b, f) {
  if (!a) return b;
  if (!b) return a;
  f = Math.max(0, Math.min(1, f));
  const out = { ...b };
  out.t = lerp(a.t, b.t, f);
  out.cl = b.cl >= a.cl ? lerp(a.cl, b.cl, f) : b.cl;
  // teleports (set-piece cuts) must not be interpolated
  const cut = b.ph !== a.ph && (b.ph === PHASE.SETPIECE || b.ph === PHASE.KICKOFF);
  const bb = new Array(6);
  const bj = Math.hypot(b.b[0] - a.b[0], b.b[2] - a.b[2]) > 6;
  for (let i = 0; i < 6; i++) bb[i] = cut || bj ? b.b[i] : lerp(a.b[i], b.b[i], f);
  out.b = bb;
  const p = new Array(b.p.length);
  for (let i = 0; i < b.p.length; i += PSTRIDE) {
    const jump = cut || Math.hypot(b.p[i] - a.p[i], b.p[i + 1] - a.p[i + 1]) > 4;
    p[i] = jump ? b.p[i] : lerp(a.p[i], b.p[i], f);
    p[i + 1] = jump ? b.p[i + 1] : lerp(a.p[i + 1], b.p[i + 1], f);
    p[i + 2] = jump ? b.p[i + 2] : a.p[i + 2] + wrapAngle(b.p[i + 2] - a.p[i + 2]) * f;
    p[i + 3] = b.p[i + 3];
    p[i + 4] = b.p[i + 3] === a.p[i + 3] && b.p[i + 4] >= a.p[i + 4] ? lerp(a.p[i + 4], b.p[i + 4], f) : b.p[i + 4];
    p[i + 5] = b.p[i + 5];
    p[i + 6] = lerp(a.p[i + 6], b.p[i + 6], f);
  }
  out.p = p;
  return out;
}

export const P_STRIDE = PSTRIDE;
