// Top-down renderer: stadium, pitch markings, goals and nets, players with kits and
// numbers, ball with height, aim indicators, set-piece arcs, scoreboard, minimap, banners.
import { PITCH, CX, CY, GOAL, BOX, SIX, PEN_SPOT, CIRCLE_R, CORNER_R, POST_R, SHOT_TYPES } from './constants.js';
import { clamp, fmtClock, luminance, TAU } from './util.js';
import { aimPointOnGoal, snapInsideFrame, isOnTarget } from './shooting.js';
import { choosePassTarget, PASS_CONES } from './passing.js';
import { simulatePath } from './physics.js';
import { predictSetPiece, SP_LABEL } from './setpieces.js';
import { keyLabel } from './keybinds.js';

const SKIN = ['#f1c7a5', '#d9a47c', '#b07850', '#8a5a3c', '#5e3d27'];
const HAIR = ['#2b1d14', '#4a3222', '#111111', '#7a5230', '#c9a15a'];
export const P_COLORS = ['#35e0ff', '#ff9f1c'];
/** Sprites are drawn larger than life so players read clearly from the broadcast camera. */
const PS = 1.55, BS = 1.3;

// ---------- camera ----------
export function makeCamera() { return { x: CX, y: CY, scale: 20, w: 1, h: 1 }; }

export function updateCamera(cam, target, dt, w, h, zoom, snap = false) {
  cam.w = w; cam.h = h;
  const k = snap ? 1 : 1 - Math.exp(-dt * 4);
  const ts = clamp((Math.sqrt(w * h) / 36) * zoom, 7, 52);
  cam.scale = snap || !cam.scale ? ts : cam.scale + (ts - cam.scale) * (1 - Math.exp(-dt * 3));
  cam.x += (target.x - cam.x) * k;
  cam.y += (target.y - cam.y) * k;
  const hw = w / 2 / cam.scale, hh = h / 2 / cam.scale, mg = 8;
  cam.x = PITCH.L + 2 * mg < 2 * hw ? CX : clamp(cam.x, -mg + hw, PITCH.L + mg - hw);
  cam.y = PITCH.W + 2 * mg < 2 * hh ? CY : clamp(cam.y, -mg + hh, PITCH.W + mg - hh);
}

export const w2s = (cam, x, y) => ({ x: (x - cam.x) * cam.scale + cam.w / 2, y: (y - cam.y) * cam.scale + cam.h / 2 });
export const s2w = (cam, sx, sy) => ({ x: (sx - cam.w / 2) / cam.scale + cam.x, y: (sy - cam.h / 2) / cam.scale + cam.y });

// ---------- stadium background (pre-rendered once) ----------
let stadium = null;
const ST_M = 22, ST_PX = 10;
function buildStadium() {
  const c = document.createElement('canvas');
  c.width = Math.round((PITCH.L + ST_M * 2) * ST_PX); c.height = Math.round((PITCH.W + ST_M * 2) * ST_PX);
  const g = c.getContext('2d');
  g.fillStyle = '#1b2230'; g.fillRect(0, 0, c.width, c.height);
  // crowd dots
  const cols = ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#ffb703', '#fb8500', '#8ecae6', '#e9c46a', '#2a9d8f', '#f4a261', '#d62828', '#ffffff'];
  for (let i = 0; i < 52000; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height;
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.globalAlpha = 0.35 + Math.random() * 0.5;
    g.fillRect(x, y, 3, 3);
  }
  g.globalAlpha = 1;
  // tier rings
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
  for (let r = 11; r < ST_M; r += 3.5) {
    g.strokeRect((ST_M - r) * ST_PX, (ST_M - r) * ST_PX, (PITCH.L + r * 2) * ST_PX, (PITCH.W + r * 2) * ST_PX);
  }
  // concourse / track around the grass
  g.fillStyle = '#2d3a2e';
  g.fillRect((ST_M - 9.5) * ST_PX, (ST_M - 9.5) * ST_PX, (PITCH.L + 19) * ST_PX, (PITCH.W + 19) * ST_PX);
  // ad boards
  const ads = ['TOUCHLINE', 'KICKOFF COLA', 'NET SWISH', 'CURVE+', 'GOALDEN', 'STRIPE AIR'];
  const adCol = ['#0b3d91', '#c1121f', '#2b9348', '#6a4c93', '#f77f00', '#1d3557'];
  g.font = `bold ${Math.round(ST_PX * 0.8)}px Arial`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const drawBoard = (x, y, w, h, vertical) => {
    const n = Math.max(1, Math.floor((vertical ? h : w) / (12 * ST_PX)));
    for (let i = 0; i < n; i++) {
      g.fillStyle = adCol[(i + (vertical ? 2 : 0)) % adCol.length];
      if (vertical) g.fillRect(x, y + (h / n) * i, w, h / n - 2); else g.fillRect(x + (w / n) * i, y, w / n - 2, h);
      g.save();
      g.fillStyle = '#fff';
      if (vertical) { g.translate(x + w / 2, y + (h / n) * (i + 0.5)); g.rotate(-Math.PI / 2); g.fillText(ads[i % ads.length], 0, 0); }
      else g.fillText(ads[(i + 3) % ads.length], x + (w / n) * (i + 0.5), y + h / 2);
      g.restore();
    }
  };
  const bo = ST_M - 6, bw = 1.1;
  drawBoard((bo) * ST_PX, (bo - bw) * ST_PX, (PITCH.L + 12) * ST_PX, bw * ST_PX, false);
  drawBoard((bo) * ST_PX, (ST_M + PITCH.W + 6) * ST_PX, (PITCH.L + 12) * ST_PX, bw * ST_PX, false);
  drawBoard((bo - bw) * ST_PX, (ST_M - 6) * ST_PX, bw * ST_PX, (PITCH.W + 12) * ST_PX, true);
  drawBoard((ST_M + PITCH.L + 6) * ST_PX, (ST_M - 6) * ST_PX, bw * ST_PX, (PITCH.W + 12) * ST_PX, true);
  return c;
}

// ---------- pitch ----------
function drawPitch(ctx) {
  const L = PITCH.L, W = PITCH.W;
  // grass with mowed stripes
  const G = 4.6;   // grass run-off beyond the lines (the ad boards sit just behind it)
  ctx.fillStyle = '#2f8a3a';
  ctx.fillRect(-G, -G, L + 2 * G, W + 2 * G);
  const n = 14, sw = L / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#3a9a45' : '#338d3e';
    ctx.fillRect(i * sw, -G, sw, W + 2 * G);
  }
  ctx.fillStyle = '#338d3e'; ctx.fillRect(-G, -G, G, W + 2 * G);
  ctx.fillStyle = '#3a9a45'; ctx.fillRect(L, -G, G, W + 2 * G);
  // subtle cross mow
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let j = 0; j < W; j += 9) ctx.fillRect(-G, j, L + 2 * G, 4.5);

  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 0.14;
  ctx.lineJoin = 'miter';
  ctx.strokeRect(0, 0, L, W);
  ctx.beginPath(); ctx.moveTo(CX, 0); ctx.lineTo(CX, W); ctx.stroke();
  ctx.beginPath(); ctx.arc(CX, CY, CIRCLE_R, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(CX, CY, 0.22, 0, TAU); ctx.fill();
  for (const side of [0, 1]) {
    const gx = side === 0 ? 0 : L, s = side === 0 ? 1 : -1;
    // penalty area & goal area
    ctx.strokeRect(side === 0 ? 0 : L - BOX.D, CY - BOX.W / 2, BOX.D, BOX.W);
    ctx.strokeRect(side === 0 ? 0 : L - SIX.D, CY - SIX.W / 2, SIX.D, SIX.W);
    // penalty spot
    ctx.beginPath(); ctx.arc(gx + s * PEN_SPOT, CY, 0.2, 0, TAU); ctx.fill();
    // D arc outside the box
    const a = Math.acos((BOX.D - PEN_SPOT) / CIRCLE_R);
    ctx.beginPath();
    if (side === 0) ctx.arc(PEN_SPOT, CY, CIRCLE_R, -a, a);
    else ctx.arc(L - PEN_SPOT, CY, CIRCLE_R, Math.PI - a, Math.PI + a);
    ctx.stroke();
  }
  // corner arcs
  const corners = [[0, 0, 0], [L, 0, Math.PI / 2], [L, W, Math.PI], [0, W, -Math.PI / 2]];
  for (const [x, y, a0] of corners) { ctx.beginPath(); ctx.arc(x, y, CORNER_R, a0, a0 + Math.PI / 2); ctx.stroke(); }
  // corner flags
  for (const [x, y] of corners) {
    ctx.fillStyle = '#ffd60a';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (x ? -0.9 : 0.9) * 0.4, y - 0.6); ctx.lineTo(x, y - 0.5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 0.1, 0, TAU); ctx.fill();
  }
}

/** Goal nets (behind the line) — drawn under the players. */
function drawNets(ctx) {
  for (const side of [0, 1]) {
    const gx = side === 0 ? 0 : PITCH.L, out = side === 0 ? -1 : 1;
    const x0 = Math.min(gx, gx + out * GOAL.D), y0 = CY - GOAL.W / 2;
    ctx.fillStyle = 'rgba(230,240,255,0.12)';
    ctx.fillRect(x0, y0, GOAL.D, GOAL.W);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    for (let y = y0; y <= y0 + GOAL.W + 1e-6; y += 0.3) { ctx.moveTo(x0, y); ctx.lineTo(x0 + GOAL.D, y); }
    for (let x = x0; x <= x0 + GOAL.D + 1e-6; x += 0.3) { ctx.moveTo(x, y0); ctx.lineTo(x, y0 + GOAL.W); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.06;
    ctx.strokeRect(x0, y0, GOAL.D, GOAL.W);
  }
}

/** Goal frame (posts + crossbar) — drawn above the players since it is 2.44 m high. */
function drawFrames(ctx) {
  for (const side of [0, 1]) {
    const gx = side === 0 ? 0 : PITCH.L;
    const y1 = CY - GOAL.W / 2 - POST_R, y2 = CY + GOAL.W / 2 + POST_R;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.18;
    ctx.beginPath(); ctx.moveTo(gx + 0.5, y1 + 0.6); ctx.lineTo(gx + 0.5, y2 + 0.6); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.16;
    ctx.beginPath(); ctx.moveTo(gx, y1); ctx.lineTo(gx, y2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (const y of [y1, y2]) { ctx.beginPath(); ctx.arc(gx, y, 0.14, 0, TAU); ctx.fill(); }
  }
}

// ---------- players ----------
function kitFill(ctx, kit, rx, ry) {
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.closePath();
  ctx.fillStyle = kit.shirt; ctx.fill();
  ctx.clip();
  ctx.fillStyle = kit.sec;
  if (kit.pattern === 'stripes') { for (let y = -ry; y < ry; y += 0.24) ctx.fillRect(-rx, y, rx * 2, 0.11); }
  else if (kit.pattern === 'checks') { for (let x = -rx; x < rx; x += 0.16) for (let y = -ry; y < ry; y += 0.16) if (((Math.round(x / 0.16) + Math.round(y / 0.16)) & 1) === 0) ctx.fillRect(x, y, 0.16, 0.16); }
  else if (kit.pattern === 'hoops') { for (let x = -rx; x < rx; x += 0.2) ctx.fillRect(x, -ry, 0.09, ry * 2); }
  else { ctx.fillRect(-rx, -ry, 0.08, ry * 2); }           // collar trim at the back
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.04;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.stroke();
}

function drawPlayer(ctx, m, p) {
  const kit = m.kitOf(p);
  const skin = SKIN[(p.id * 7) % SKIN.length], hair = HAIR[(p.id * 3) % HAIR.length];
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(PS, PS);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0.16, 0.2, 0.5, 0.36, 0, 0, TAU); ctx.fill();
  let ang = p.facing;
  const st = p.state;
  if (st === 'dive') ang = p.facing + (p.dive ? p.dive.dir : 1) * Math.PI / 2 * (p.team === 0 ? 1 : 1);
  ctx.rotate(ang);
  if (st === 'down' || st === 'slide' || st === 'dive') {
    // stretched / lying body
    const lying = st === 'down';
    ctx.fillStyle = kit.socks;
    ctx.beginPath(); ctx.ellipse(lying ? -0.55 : 0.55, 0.12, 0.28, 0.08, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(lying ? -0.55 : 0.5, -0.12, 0.28, 0.08, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = kit.shorts;
    ctx.beginPath(); ctx.ellipse(lying ? -0.25 : 0.22, 0, 0.18, 0.2, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.scale(1.6, 1); kitFill(ctx, kit, 0.2, 0.34); ctx.restore();
    if (st === 'dive') {
      ctx.fillStyle = kit.shirt;
      ctx.fillRect(-0.9, -0.08, 0.6, 0.16);
      ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.arc(-0.95, 0, 0.1, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(lying ? 0.45 : -0.42, 0, 0.16, 0, TAU); ctx.fill();
    ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(lying ? 0.47 : -0.44, 0, 0.12, 0, TAU); ctx.fill();
    ctx.restore();
    return;
  }
  // legs (run cycle)
  const sw = Math.sin(p.anim) * 0.3 * Math.min(1, Math.hypot(p.vx, p.vy) / 3 + 0.05);
  ctx.fillStyle = kit.socks;
  ctx.beginPath(); ctx.ellipse(sw, 0.13, 0.15, 0.08, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-sw, -0.13, 0.15, 0.08, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(sw + 0.13, 0.13, 0.06, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(-sw + 0.13, -0.13, 0.06, 0, TAU); ctx.fill();
  ctx.fillStyle = kit.shorts;
  ctx.beginPath(); ctx.ellipse(-0.02, 0, 0.16, 0.26, 0, 0, TAU); ctx.fill();
  // arms
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(-sw * 0.7, 0.42, 0.075, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(sw * 0.7, -0.42, 0.075, 0, TAU); ctx.fill();
  if (p.role === 'GK') {
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath(); ctx.arc(-sw * 0.7 + 0.05, 0.44, 0.08, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(sw * 0.7 + 0.05, -0.44, 0.08, 0, TAU); ctx.fill();
  }
  // torso
  kitFill(ctx, kit, 0.22, 0.38);
  ctx.fillStyle = kit.sec;
  ctx.beginPath(); ctx.arc(0, 0.36, 0.09, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -0.36, 0.09, 0, TAU); ctx.fill();
  // head
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0.04, 0, 0.16, 0, TAU); ctx.fill();
  ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(-0.01, 0, 0.14, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
  ctx.restore();
}

function drawBall(ctx, b) {
  const r = (0.21 + b.z * 0.025) * BS;
  // shadow on the ground
  ctx.fillStyle = `rgba(0,0,0,${clamp(0.35 - b.z * 0.04, 0.08, 0.35)})`;
  ctx.beginPath(); ctx.ellipse(b.x + 0.05 + b.z * 0.25, b.y + 0.06 + b.z * 0.3, 0.2 * BS, 0.15 * BS, 0, 0, TAU); ctx.fill();
  const y = b.y - b.z * 0.55;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(b.x, y, r, 0, TAU); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(b.x, y, r, 0, TAU); ctx.clip();
  ctx.fillStyle = '#1b1b1b';
  const ph = b.rot % TAU;
  for (let i = 0; i < 3; i++) {
    const a = ph + i * 2.1;
    ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * r * 0.55, y + Math.sin(a * 0.7) * r * 0.5, r * 0.28, 0, TAU); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.03;
  ctx.beginPath(); ctx.arc(b.x, y, r, 0, TAU); ctx.stroke();
}

// ---------- aim helpers ----------
function drawAim(ctx, m, h, settings) {
  const p = h.player;
  if (!p || m.owner !== p || !p.aimDir) return;
  const side = m.attackSide(p.team);
  const gx = side === 1 ? PITCH.L : 0;
  const aim = p.aimDir;
  const toward = (gx - p.x) * aim.x > 0;
  const dGoal = Math.abs(gx - p.x);
  const col = P_COLORS[h.ctrl];
  if (toward && dGoal < 45) {
    let y = aimPointOnGoal(m.ball, aim, side);
    if (y == null) return;
    let z = 0.8;
    const mode = m.gp(h).shot;
    const ang = Math.acos(clamp((aim.x * (gx - p.x) + aim.y * (CY - p.y)) / Math.hypot(gx - p.x, CY - p.y), -1, 1));
    if (mode === 'Assisted' && ang < 0.87) { const s = snapInsideFrame(y, z, 0.25); y = s.y; }
    const on = isOnTarget(y, z);
    // dashed aim line
    ctx.setLineDash([0.5, 0.4]);
    ctx.strokeStyle = on ? 'rgba(120,255,160,0.8)' : 'rgba(255,120,120,0.7)';
    ctx.lineWidth = 0.09;
    ctx.beginPath(); ctx.moveTo(m.ball.x, m.ball.y); ctx.lineTo(gx, y); ctx.stroke();
    ctx.setLineDash([]);
    // reticle on the goal mouth
    const rc = on ? '#7dffa0' : '#ff7b7b';
    ctx.strokeStyle = rc; ctx.lineWidth = 0.1;
    ctx.beginPath(); ctx.arc(gx, y, 0.55, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx - 0.8, y); ctx.lineTo(gx + 0.8, y); ctx.moveTo(gx, y - 0.8); ctx.lineTo(gx, y + 0.8); ctx.stroke();
  } else {
    // short direction arrow
    ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 0.1;
    const ex = p.x + aim.x * 3, ey = p.y + aim.y * 3;
    ctx.beginPath(); ctx.moveTo(p.x + aim.x * 0.8, p.y + aim.y * 0.8); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex - aim.x * 0.6 - aim.y * 0.4, ey - aim.y * 0.6 + aim.x * 0.4);
    ctx.lineTo(ex - aim.x * 0.6 + aim.y * 0.4, ey - aim.y * 0.6 - aim.x * 0.4); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    ctx.globalAlpha = 1;
  }
  // likely pass receiver (with the player's ground-pass assistance; none in Manual)
  const pm = m.gp(h).passGround;
  const C = PASS_CONES[pm];
  const sel = C ? choosePassTarget(p, m.mates(p.team), m.opps(p.team), aim, 'ground', m.attackDir(p.team), { cone: C.ground * Math.PI / 180, wide: C.wide * Math.PI / 180, alignW: C.alignW }) : null;
  if (sel) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.arc(sel.mate.x, sel.mate.y, 0.75 * PS, 0, TAU); ctx.stroke();
  }
}

function drawArc(ctx, pts, color) {
  if (!pts || pts.length < 2) return;
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.1;
  ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
  for (let i = 0; i < pts.length; i += 2) {
    const q = pts[i];
    const z = Math.min(q.z, 8);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(q.x, q.y - z * 0.55, 0.12 + z * 0.015, 0, TAU); ctx.fill();
  }
}

// ---------- main draw ----------
export function drawMatch(ctx, m, cam, settings) {
  const w = cam.w, h = cam.h, s = cam.scale;
  if (!stadium) stadium = buildStadium();
  ctx.fillStyle = '#10151d'; ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2 - cam.x * s, h / 2 - cam.y * s);
  ctx.scale(s, s);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(stadium, -ST_M, -ST_M, PITCH.L + ST_M * 2, PITCH.W + ST_M * 2);
  drawPitch(ctx);
  drawNets(ctx);

  // set piece aim arc
  if (m.state === 'setpiece' && m.sp && m.sp.phase === 'aim' && m.sp.human) {
    const pr = predictSetPiece(m);
    if (pr) {
      const b = { x: pr.from.x, y: pr.from.y, z: pr.from.z, vx: pr.v.vx, vy: pr.v.vy, vz: pr.v.vz, spin: pr.spin, topspin: 0, knuckle: 0, kPhase: 0, rot: 0 };
      drawArc(ctx, simulatePath(b, 3, (bb, t) => t > 0.2 && bb.z <= 0.02, 3), 'rgba(255,255,255,0.85)');
    }
    const a = m.sp.aim;
    ctx.strokeStyle = P_COLORS[m.sp.human.ctrl]; ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.arc(a.x, a.y, 0.8, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x - 1.2, a.y); ctx.lineTo(a.x + 1.2, a.y); ctx.moveTo(a.x, a.y - 1.2); ctx.lineTo(a.x, a.y + 1.2); ctx.stroke();
  }

  // control rings under humans
  for (const hh of m.humans) {
    const p = hh.player; if (!p || p.sentOff) continue;
    ctx.strokeStyle = P_COLORS[hh.ctrl]; ctx.lineWidth = 0.1;
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 0.05, 0.7 * PS, 0.55 * PS, 0, 0, TAU); ctx.stroke();
  }
  // switch indicator: who the Switch button would pick next
  if (m.state === 'play') {
    for (const hh of m.humans) {
      const q = hh.next;
      if (!q || q === hh.player || q.sentOff || !m.gp(hh).switchIndicator) continue;
      ctx.save();
      ctx.strokeStyle = P_COLORS[hh.ctrl]; ctx.globalAlpha = 0.75; ctx.lineWidth = 0.08;
      ctx.setLineDash([0.35, 0.25]);
      ctx.beginPath(); ctx.ellipse(q.x, q.y + 0.05, 0.7 * PS, 0.55 * PS, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }
  // jockey / shield stance: a short arc in front of the controlled player
  for (const hh of m.humans) {
    const p = hh.player; if (!p || !(p.jockey || p.shield)) continue;
    ctx.strokeStyle = p.shield ? 'rgba(255,209,102,0.85)' : 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.12;
    const a = p.shield ? p.facing + Math.PI : p.facing;
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.25, a - 0.6, a + 0.6); ctx.stroke();
  }
  // pass target marker
  if (m.pass && m.pass.receiver && m.state === 'play') {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(m.pass.target.x, m.pass.target.y, 0.4, 0, TAU); ctx.fill();
  }
  if (settings.aimLine && m.state === 'play') for (const hh of m.humans) drawAim(ctx, m, hh, settings);

  // depth-sorted players and ball
  const items = m.players.filter((p) => !p.sentOff || p.y < 0).map((p) => ({ y: p.y, p }));
  const ball = m.ball;
  items.push({ y: ball.y + (ball.z > 0.8 ? 100 : 0.01), ball: true });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) { if (it.ball) drawBall(ctx, ball); else drawPlayer(ctx, m, it.p); }
  drawFrames(ctx);
  ctx.restore();

  // ---- screen-space overlays on players: numbers, markers, bars ----
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fs = Math.max(9, Math.round(s * 0.42 * PS * 0.85));
  ctx.font = `bold ${fs}px Arial, sans-serif`;
  for (const p of m.players) {
    if (p.state === 'down' || p.state === 'dive' || p.state === 'slide') continue;
    const q = w2s(cam, p.x, p.y);
    if (q.x < -20 || q.y < -20 || q.x > w + 20 || q.y > h + 20) continue;
    const kit = m.kitOf(p);
    ctx.lineWidth = Math.max(2, fs * 0.18);
    ctx.strokeStyle = luminance(kit.num) > 0.5 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)';
    ctx.strokeText(String(p.num), q.x - s * 0.06 * PS, q.y);
    ctx.fillStyle = kit.num;
    ctx.fillText(String(p.num), q.x - s * 0.06 * PS, q.y);
    if (p.yellows > 0 && !p.sentOff) { ctx.fillStyle = '#ffd60a'; ctx.fillRect(q.x + s * 0.35 * PS, q.y - s * 0.6 * PS, s * 0.18 * PS, s * 0.25 * PS); }
  }
  for (const hh of m.humans) {
    const p = hh.player; if (!p || p.sentOff) continue;
    const q = w2s(cam, p.x, p.y);
    const col = P_COLORS[hh.ctrl];
    const top = q.y - s * 1.05 * PS;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(q.x, top + 7); ctx.lineTo(q.x - 7, top - 3); ctx.lineTo(q.x + 7, top - 3); ctx.closePath(); ctx.fill();
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.fillText('P' + (hh.ctrl + 1), q.x, top - 11);
    // stamina bar
    const bw = 34;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(q.x - bw / 2, q.y + s * 0.75 * PS, bw, 4);
    ctx.fillStyle = p.stamina > 0.3 ? '#8cff66' : '#ff6b6b';
    ctx.fillRect(q.x - bw / 2, q.y + s * 0.75 * PS, bw * p.stamina, 4);
    // power bar
    if (p.charging) {
      const pw = 56, ph = 9, px = q.x - pw / 2, py = top - 32;
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(px - 2, py - 2, pw + 4, ph + 4);
      const g = ctx.createLinearGradient(px, 0, px + pw, 0);
      g.addColorStop(0, '#5cff7a'); g.addColorStop(0.7, '#ffe14d'); g.addColorStop(1, '#ff4040');
      ctx.fillStyle = g; ctx.fillRect(px, py, pw * p.charge, ph);
      ctx.fillStyle = '#fff'; ctx.fillRect(px + pw * 0.9, py - 2, 1.5, ph + 4);
      const type = p.shotMod || (p.charge >= 0.9 ? 'power' : 'driven');
      ctx.font = 'bold 10px Arial, sans-serif';
      ctx.fillText(SHOT_TYPES[type].label.toUpperCase(), q.x, py - 8);
    }
    // pass power (Semi / Manual passing)
    if (p.passHold) {
      const pw = 56, ph = 7, px = q.x - pw / 2, py = top - 30;
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(px - 2, py - 2, pw + 4, ph + 4);
      ctx.fillStyle = '#6ec8ff'; ctx.fillRect(px, py, pw * Math.min(1, p.passHold.t), ph);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial, sans-serif';
      ctx.fillText({ ground: 'PASS', through: 'THROUGH', lob: 'LOB' }[p.passHold.kind], q.x, py - 7);
    }
    // timed finishing: the ring closes on the moment of contact
    if (p.windup) {
      const k = clamp(1 - p.windup.t / p.windup.contact, 0, 1);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(q.x, q.y, 12 + 26 * k, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(125,255,160,0.9)';
      ctx.beginPath(); ctx.arc(q.x, q.y, 12, 0, TAU); ctx.stroke();
    }
  }
  // timed finishing result (stays on the shooter even after control moves on)
  for (const p of m.players) {
    if (!p.timedFx || p.timedFx.grade === 'none') continue;
    const q = w2s(cam, p.x, p.y), top = q.y - s * 1.05 * PS;
    const good = p.timedFx.grade === 'perfect';
    ctx.globalAlpha = clamp(1.2 - p.timedFx.t, 0, 1);
    ctx.fillStyle = good ? '#7dffa0' : '#ff6b6b';
    ctx.beginPath(); ctx.arc(q.x, top - 24, 6, 0, TAU); ctx.fill();
    ctx.font = 'bold 12px Arial, sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
    const label = { perfect: 'PERFECT TIMING', early: 'TOO EARLY', late: 'TOO LATE' }[p.timedFx.grade];
    ctx.strokeText(label, q.x, top - 38); ctx.fillText(label, q.x, top - 38);
    ctx.globalAlpha = 1;
  }
  drawHUD(ctx, m, cam, settings);
}

// ---------- HUD ----------
function chip(ctx, x, y, kit, w = 14, h = 20) {
  ctx.fillStyle = kit.shirt; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = kit.sec; ctx.fillRect(x + w * 0.66, y, w * 0.34, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function drawScoreboard(ctx, m, x = 14, y = 14) {
  const H = 30;
  ctx.save();
  ctx.font = 'bold 16px "Arial Narrow", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  const segW = [78, 58, 78, 70];
  const total = segW.reduce((a, b) => a + b, 0);
  ctx.fillStyle = 'rgba(8,14,28,0.88)'; ctx.fillRect(x, y, total, H);
  ctx.fillStyle = '#e8eefc';
  // home
  chip(ctx, x + 6, y + 5, m.kits[0]);
  ctx.fillStyle = '#e8eefc';
  ctx.textAlign = 'left'; ctx.fillText(m.teams[0].code, x + 26, y + H / 2 + 1);
  // score
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x + segW[0], y, segW[1], H);
  ctx.fillStyle = '#0b1220'; ctx.textAlign = 'center';
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillText(`${m.score[0]} - ${m.score[1]}`, x + segW[0] + segW[1] / 2, y + H / 2 + 1);
  // away
  ctx.font = 'bold 16px "Arial Narrow", Arial, sans-serif';
  ctx.fillStyle = '#e8eefc'; ctx.textAlign = 'right';
  ctx.fillText(m.teams[1].code, x + segW[0] + segW[1] + segW[2] - 26, y + H / 2 + 1);
  chip(ctx, x + segW[0] + segW[1] + segW[2] - 20, y + 5, m.kits[1]);
  // clock
  const cx = x + segW[0] + segW[1] + segW[2];
  ctx.fillStyle = '#16a34a'; ctx.fillRect(cx, y, segW[3], H);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  const halfCap = m.half === 1 ? 45 * 60 : 90 * 60;
  const shown = m.noClock ? 0 : Math.min(m.clock, halfCap);
  ctx.fillText(m.noClock ? '--:--' : fmtClock(shown), cx + segW[3] / 2, y + H / 2 + 1);
  // half + added time
  ctx.fillStyle = 'rgba(8,14,28,0.88)'; ctx.fillRect(x, y + H, 44, 18);
  ctx.font = 'bold 11px Arial, sans-serif'; ctx.fillStyle = '#c9d6ff';
  ctx.fillText(m.half === 1 ? '1ST' : '2ND', x + 22, y + H + 9);
  const add = m.added[m.half - 1];
  if (add != null && m.clock >= halfCap) {
    ctx.fillStyle = '#e11d48'; ctx.fillRect(cx, y + H, 40, 18);
    ctx.fillStyle = '#fff'; ctx.fillText('+' + add, cx + 20, y + H + 9);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial';
    ctx.fillText(fmtClock(m.clock - halfCap).replace(/^0/, '+'), cx + 58, y + H + 9);
  }
  ctx.restore();
}

/** HUD elements shrink on small (phone) screens. */
export const hudScale = (w, h) => clamp(Math.min(w / 1000, h / 560), 0.62, 1);

function drawMinimap(ctx, m, cam) {
  const mw = Math.min(170, cam.w * 0.2, 175 * hudScale(cam.w, cam.h)), mh = mw * PITCH.W / PITCH.L;
  const x = cam.w - mw - 14, y = 14;
  // fade the minimap when the action (ball / controlled players) is underneath it
  let hidden = false;
  const pts = [m.ball, ...m.humans.map((hh) => hh.player).filter(Boolean)];
  for (const p of pts) {
    const q = w2s(cam, p.x, p.y);
    if (q.x > x - 40 && q.x < x + mw + 40 && q.y > y - 40 && q.y < y + mh + 50) hidden = true;
  }
  const A = hidden ? 0.22 : 1;
  ctx.save();
  ctx.globalAlpha = 0.85 * A;
  ctx.fillStyle = 'rgba(20,70,30,0.85)'; ctx.fillRect(x, y, mw, mh);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, mw - 1, mh - 1);
  ctx.beginPath(); ctx.moveTo(x + mw / 2, y); ctx.lineTo(x + mw / 2, y + mh); ctx.stroke();
  const sx = mw / PITCH.L, sy = mh / PITCH.W;
  ctx.strokeRect(x, y + (CY - BOX.W / 2) * sy, BOX.D * sx, BOX.W * sy);
  ctx.strokeRect(x + mw - BOX.D * sx, y + (CY - BOX.W / 2) * sy, BOX.D * sx, BOX.W * sy);
  // camera view
  const hw = cam.w / 2 / cam.scale, hh = cam.h / 2 / cam.scale;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(x + (cam.x - hw) * sx, y + (cam.y - hh) * sy, hw * 2 * sx, hh * 2 * sy);
  ctx.globalAlpha = A;
  for (const p of m.players) {
    if (p.sentOff) continue;
    const kit = m.kitOf(p);
    ctx.fillStyle = kit.shirt;
    ctx.beginPath(); ctx.arc(x + p.x * sx, y + p.y * sy, p.human >= 0 ? 4 : 3, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.human >= 0 ? P_COLORS[p.human] : 'rgba(0,0,0,0.6)'; ctx.lineWidth = p.human >= 0 ? 2 : 1;
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x + m.ball.x * sx, y + m.ball.y * sy, 2.5, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawPlayerPanel(ctx, m, hh, x, y, alignRight) {
  const p = hh.player; if (!p) return;
  ctx.save();
  const w = 190, h = 38;
  const px = alignRight ? x - w : x;
  ctx.fillStyle = 'rgba(8,14,28,0.8)'; ctx.fillRect(px, y, w, h);
  ctx.fillStyle = P_COLORS[hh.ctrl]; ctx.fillRect(px, y, 5, h);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`P${hh.ctrl + 1}  #${p.num} ${p.name}`, px + 12, y + 5);
  ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(px + 12, y + 25, w - 24, 6);
  ctx.fillStyle = p.stamina > 0.3 ? '#8cff66' : '#ff6b6b'; ctx.fillRect(px + 12, y + 25, (w - 24) * p.stamina, 6);
  ctx.restore();
}

function drawBanners(ctx, m, w, h) {
  let y = h * 0.22;
  for (const b of m.banners) {
    const a = clamp(Math.min(b.t / 0.2, (b.dur - b.t) / 0.3), 0, 1);
    const big = b.text === 'GOAL!';
    ctx.save();
    ctx.globalAlpha = a;
    const bw = big ? Math.min(w * 0.8, 560) : Math.min(w * 0.7, 380), bh = big ? 92 : 58;
    const x = w / 2 - bw / 2;
    const slide = (1 - Math.min(1, b.t / 0.25)) * 60;
    ctx.translate(slide, 0);
    ctx.fillStyle = 'rgba(8,14,28,0.88)'; ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = b.color; ctx.fillRect(x, y, 8, bh); ctx.fillRect(x + bw - 8, y, 8, bh);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `italic 900 ${big ? 48 : 26}px Arial, sans-serif`;
    ctx.fillText(b.text, w / 2, y + (b.sub ? bh * 0.38 : bh / 2));
    if (b.sub) { ctx.font = `bold ${big ? 17 : 14}px Arial, sans-serif`; ctx.fillStyle = '#cfd8ff'; ctx.fillText(b.sub, w / 2, y + bh * 0.77); }
    ctx.restore();
    y += bh + 10;
  }
}

function drawSetPieceHUD(ctx, m, w, h, binds) {
  const sp = m.sp;
  if (!sp || m.state !== 'setpiece') return;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8,14,28,0.8)';
  const label = SP_LABEL[sp.type] + ' — ' + m.teams[sp.team].name;
  ctx.font = 'bold 15px Arial';
  const tw = ctx.measureText(label).width + 30;
  ctx.fillRect(w / 2 - tw / 2, h - 118, tw, 26);
  ctx.fillStyle = '#fff'; ctx.fillText(label, w / 2, h - 105);
  if (sp.human && sp.phase === 'aim') {
    const b = binds[sp.human.ctrl === 0 ? 'p1' : 'p2'];
    const hint = sp.type === 'throw'
      ? `Aim: mouse/move · ${keyLabel(b.pass)}${sp.human.ctrl === 0 ? '/click' : ''}: short throw · Hold ${keyLabel(b.shoot)}: long throw`
      : `Aim: mouse/move · Hold ${keyLabel(b.shoot)}: power, release to kick · ${keyLabel(b.pass)}${sp.human.ctrl === 0 ? '/click' : ''}: short pass · ${keyLabel(b.lob)}/${keyLabel(b.through)}: curve`;
    ctx.font = '13px Arial';
    const hw = Math.min(w - 20, ctx.measureText(hint).width + 24);
    ctx.fillStyle = 'rgba(8,14,28,0.7)'; ctx.fillRect(w / 2 - hw / 2, h - 86, hw, 22);
    ctx.fillStyle = '#e6ecff'; ctx.fillText(hint, w / 2, h - 75, w - 30);
    // power + curve
    const pw = 200, px = w / 2 - pw / 2, py = h - 56;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(px - 3, py - 3, pw + 6, 18);
    const g = ctx.createLinearGradient(px, 0, px + pw, 0);
    g.addColorStop(0, '#5cff7a'); g.addColorStop(0.7, '#ffe14d'); g.addColorStop(1, '#ff4040');
    ctx.fillStyle = g; ctx.fillRect(px, py, pw * sp.power, 12);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.fillText('POWER', px - 30, py + 6);
    if (sp.type !== 'throw') {
      const cy = py + 22;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(px - 3, cy - 3, pw + 6, 14);
      ctx.fillStyle = '#8ecae6'; ctx.fillRect(px + pw / 2, cy, (pw / 2) * sp.curve, 8);
      ctx.fillStyle = '#fff'; ctx.fillRect(px + pw / 2 - 1, cy - 2, 2, 12);
      ctx.fillText('CURVE', px - 30, cy + 4);
    }
  }
  ctx.restore();
}

export function drawHUD(ctx, m, cam, settings, binds) {
  const w = cam.w, h = cam.h;
  const k = hudScale(w, h);
  ctx.save(); ctx.scale(k, k); drawScoreboard(ctx, m); ctx.restore();
  drawMinimap(ctx, m, cam);
  m.humans.forEach((hh, i) => {
    ctx.save(); ctx.translate(i === 0 ? 14 : w - 14, h - 12); ctx.scale(k, k);
    drawPlayerPanel(ctx, m, hh, 0, -40, i === 1);
    ctx.restore();
  });
  drawSetPieceHUD(ctx, m, w, h, drawHUD.binds || { p1: {}, p2: {} });
  if (m.state === 'replay' || m.state === 'ireplay') {
    const label = m.state === 'ireplay' ? 'INSTANT REPLAY' : 'REPLAY';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, 36); ctx.fillRect(0, h - 36, w, 36);
    ctx.font = 'italic 900 20px Arial';
    const lw = ctx.measureText(label).width;
    ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(w - lw - 34, 18, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, w - lw - 20, 19);
    ctx.font = '12px Arial'; ctx.textAlign = 'center'; ctx.fillText('Press any key / tap to skip', w / 2, h - 18);
  }
  drawBanners(ctx, m, w, h);
}
