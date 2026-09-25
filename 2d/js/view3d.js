// Pseudo-3D perspective renderer for the first-person penalty / free-kick view.
// World coordinates are the pitch coordinates (x along the pitch, y across, z up).
import { PITCH, CY, GOAL, BOX, SIX, PEN_SPOT, CIRCLE_R, POST_R } from './constants.js';
import { clamp, TAU } from './util.js';

const NEAR = 0.35;

export class View3D {
  constructor() { this.eye = { x: 0, y: 0, z: 1.5 }; this.F = 800; this.w = 1; this.h = 1; this.cx = 0; this.cy = 0; this.crowd = null; }

  /** Camera at `eye` looking at `look`. `fit` = fraction of screen width the goal mouth should span. */
  setup(w, h, eye, look, fit = 0.52, opts = {}) {
    this.w = w; this.h = h; this.eye = eye;
    let fx = look.x - eye.x, fy = look.y - eye.y, fz = look.z - eye.z;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    this.f = { x: fx, y: fy, z: fz };
    const rl = Math.hypot(fx, fy);
    this.r = { x: -fy / rl, y: fx / rl, z: 0 };
    // up = f x r
    const r = this.r;
    this.u = { x: fy * r.z - fz * r.y, y: fz * r.x - fx * r.z, z: fx * r.y - fy * r.x };
    const D = Math.hypot(PITCH.L - eye.x, CY - eye.y);
    this.F = clamp((fit * w * D) / GOAL.W, h * 0.9, h * 3.2);
    this.cx = w / 2; this.cy = h * (opts.cyFrac || 0.5);
    // widen the lens if needed so `opts.keep` (e.g. the ball at the taker's feet) stays on screen
    if (opts.keep) {
      const c = this.toCam(opts.keep);
      const room = (opts.maxY || 0.9) * h - this.cy;
      if (c.z > NEAR && c.y < 0 && room > 0) this.F = Math.max(h * 0.55, Math.min(this.F, room / (-c.y / c.z)));
    }
  }

  toCam(p) {
    const dx = p.x - this.eye.x, dy = p.y - this.eye.y, dz = p.z - this.eye.z;
    return { x: dx * this.r.x + dy * this.r.y + dz * this.r.z, y: dx * this.u.x + dy * this.u.y + dz * this.u.z, z: dx * this.f.x + dy * this.f.y + dz * this.f.z };
  }
  camToScreen(c) { return { x: this.cx + (this.F * c.x) / c.z, y: this.cy - (this.F * c.y) / c.z, s: this.F / c.z, d: c.z }; }
  project(p) { const c = this.toCam(p); if (c.z < NEAR) return null; return this.camToScreen(c); }

  /** Inverse projection of a screen point onto the vertical plane x = planeX. */
  unprojectToPlaneX(sx, sy, planeX) {
    const cxv = (sx - this.cx) / this.F, cyv = -(sy - this.cy) / this.F;
    const dir = {
      x: this.f.x + this.r.x * cxv + this.u.x * cyv,
      y: this.f.y + this.r.y * cxv + this.u.y * cyv,
      z: this.f.z + this.r.z * cxv + this.u.z * cyv,
    };
    if (Math.abs(dir.x) < 1e-6) return null;
    const t = (planeX - this.eye.x) / dir.x;
    if (t <= 0) return null;
    return { y: this.eye.y + dir.y * t, z: this.eye.z + dir.z * t };
  }

  /** Clip a 3D polygon against the near plane and return screen points. */
  polyScreen(pts) {
    const cs = pts.map((p) => this.toCam(p));
    const out = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length];
      const ain = a.z >= NEAR, bin = b.z >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR });
      }
    }
    return out.map((c) => this.camToScreen(c));
  }

  fillPoly(ctx, pts, style) {
    const s = this.polyScreen(pts);
    if (s.length < 3) return;
    ctx.fillStyle = style;
    ctx.beginPath(); s.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill();
  }

  line(ctx, a, b, width, style) {
    let ca = this.toCam(a), cb = this.toCam(b);
    if (ca.z < NEAR && cb.z < NEAR) return;
    if (ca.z < NEAR) { const t = (NEAR - ca.z) / (cb.z - ca.z); ca = { x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t, z: NEAR }; }
    if (cb.z < NEAR) { const t = (NEAR - cb.z) / (ca.z - cb.z); cb = { x: cb.x + (ca.x - cb.x) * t, y: cb.y + (ca.y - cb.y) * t, z: NEAR }; }
    const sa = this.camToScreen(ca), sb = this.camToScreen(cb);
    ctx.strokeStyle = style;
    ctx.lineWidth = Math.max(0.6, width * (sa.s + sb.s) / 2);
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
  }

  polyline(ctx, pts, width, style) { for (let i = 0; i < pts.length - 1; i++) this.line(ctx, pts[i], pts[i + 1], width, style); }

  buildCrowd() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#20283a'; g.fillRect(0, 0, 256, 256);
    const cols = ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#ffb703', '#fb8500', '#8ecae6', '#e9c46a', '#2a9d8f', '#ffffff', '#d62828'];
    for (let y = 2; y < 256; y += 6) {
      for (let x = 1; x < 256; x += 4) {
        g.fillStyle = cols[(Math.random() * cols.length) | 0];
        g.globalAlpha = 0.5 + Math.random() * 0.5;
        g.beginPath(); g.arc(x + Math.random() * 2, y + Math.random() * 2, 1.4, 0, TAU); g.fill();
      }
    }
    return c;
  }

  drawBackground(ctx, t = 0) {
    const w = this.w, h = this.h;
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, '#0a1330'); sky.addColorStop(1, '#27406e');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    if (!this.crowd) this.crowd = this.buildCrowd();
    if (!this.pattern) this.pattern = ctx.createPattern(this.crowd, 'repeat');
    const L = PITCH.L, W = PITCH.W;
    // stands: behind the goal and both sides (vertical-ish sloped planes)
    const stands = [
      [{ x: L + 12, y: -40, z: 0 }, { x: L + 12, y: W + 40, z: 0 }, { x: L + 30, y: W + 40, z: 22 }, { x: L + 30, y: -40, z: 22 }],
      [{ x: -10, y: -12, z: 0 }, { x: L + 12, y: -12, z: 0 }, { x: L + 30, y: -30, z: 22 }, { x: -10, y: -30, z: 22 }],
      [{ x: -10, y: W + 12, z: 0 }, { x: L + 12, y: W + 12, z: 0 }, { x: L + 30, y: W + 30, z: 22 }, { x: -10, y: W + 30, z: 22 }],
    ];
    for (const s of stands) this.fillPoly(ctx, s, this.pattern);
    // tier lines
    for (let z = 3; z < 22; z += 4) {
      const k = z / 22;
      this.line(ctx, { x: L + 12 + 18 * k, y: -40, z }, { x: L + 12 + 18 * k, y: W + 40, z }, 0.25, 'rgba(0,0,0,0.35)');
    }
    // flashes in the crowd
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 6; i++) {
      if (Math.random() < 0.3) {
        const p = this.project({ x: L + 14 + Math.random() * 14, y: Math.random() * W, z: 2 + Math.random() * 14 });
        if (p) ctx.fillRect(p.x, p.y, 2, 2);
      }
    }
    // roof shadow line + floodlight glow
    const glow = ctx.createRadialGradient(w * 0.15, h * 0.05, 0, w * 0.15, h * 0.05, h * 0.5);
    glow.addColorStop(0, 'rgba(255,255,230,0.25)'); glow.addColorStop(1, 'rgba(255,255,230,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  }

  drawGround(ctx) {
    const L = PITCH.L, W = PITCH.W;
    // track surround
    this.fillPoly(ctx, [{ x: -10, y: -12, z: 0 }, { x: L + 12, y: -12, z: 0 }, { x: L + 12, y: W + 12, z: 0 }, { x: -10, y: W + 12, z: 0 }], '#2d3a2e');
    this.fillPoly(ctx, [{ x: -6, y: -6, z: 0 }, { x: L + 6, y: -6, z: 0 }, { x: L + 6, y: W + 6, z: 0 }, { x: -6, y: W + 6, z: 0 }], '#338d3e');
    const n = 14, sw = L / n;
    for (let i = 0; i < n; i++) {
      if (i % 2) continue;
      this.fillPoly(ctx, [{ x: i * sw, y: -6, z: 0 }, { x: (i + 1) * sw, y: -6, z: 0 }, { x: (i + 1) * sw, y: W + 6, z: 0 }, { x: i * sw, y: W + 6, z: 0 }], '#3a9a45');
    }
    // ad boards behind the goal and along the side
    const cols = ['#0b3d91', '#c1121f', '#2b9348', '#6a4c93', '#f77f00'];
    const words = ['TOUCHLINE', 'KICKOFF COLA', 'NET SWISH', 'CURVE+', 'GOALDEN'];
    for (let i = 0; i < 10; i++) {
      const y0 = -10 + i * 7.4, y1 = y0 + 7.2;
      const q = [{ x: L + 4, y: y0, z: 0 }, { x: L + 4, y: y1, z: 0 }, { x: L + 4, y: y1, z: 0.9 }, { x: L + 4, y: y0, z: 0.9 }];
      this.fillPoly(ctx, q, cols[i % cols.length]);
      const c = this.project({ x: L + 4, y: (y0 + y1) / 2, z: 0.45 });
      if (c && c.s > 6) {
        ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(c.s * 0.55)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(words[i % words.length], c.x, c.y);
      }
    }
    for (const yb of [-3.5, W + 3.5]) {
      for (let i = 0; i < 9; i++) {
        const x0 = L - 70 + i * 8.5, x1 = x0 + 8.3;
        this.fillPoly(ctx, [{ x: x0, y: yb, z: 0 }, { x: x1, y: yb, z: 0 }, { x: x1, y: yb, z: 0.9 }, { x: x0, y: yb, z: 0.9 }], cols[(i + 2) % cols.length]);
      }
    }
  }

  drawLines(ctx) {
    const L = PITCH.L, W = PITCH.W, lw = 0.12, st = 'rgba(255,255,255,0.9)';
    const seg = (a, b) => this.line(ctx, { x: a[0], y: a[1], z: 0.001 }, { x: b[0], y: b[1], z: 0.001 }, lw, st);
    seg([L, 0], [L, W]); seg([L - 50, 0], [L, 0]); seg([L - 50, W], [L, W]);
    seg([L - BOX.D, CY - BOX.W / 2], [L - BOX.D, CY + BOX.W / 2]);
    seg([L - BOX.D, CY - BOX.W / 2], [L, CY - BOX.W / 2]); seg([L - BOX.D, CY + BOX.W / 2], [L, CY + BOX.W / 2]);
    seg([L - SIX.D, CY - SIX.W / 2], [L - SIX.D, CY + SIX.W / 2]);
    seg([L - SIX.D, CY - SIX.W / 2], [L, CY - SIX.W / 2]); seg([L - SIX.D, CY + SIX.W / 2], [L, CY + SIX.W / 2]);
    // D arc
    const a = Math.acos((BOX.D - PEN_SPOT) / CIRCLE_R);
    const arc = [];
    for (let i = 0; i <= 24; i++) {
      const t = Math.PI - a + (2 * a * i) / 24;
      arc.push({ x: L - PEN_SPOT + Math.cos(t) * CIRCLE_R, y: CY + Math.sin(t) * CIRCLE_R, z: 0.001 });
    }
    this.polyline(ctx, arc, lw, st);
    // penalty spot
    const ps = this.project({ x: L - PEN_SPOT, y: CY, z: 0 });
    if (ps) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ps.x, ps.y, ps.s * 0.12, ps.s * 0.04, 0, 0, TAU); ctx.fill(); }
  }

  /** Back net, side nets and roof (drawn before the posts / keeper). */
  drawNet(ctx, bulge = null) {
    const L = PITCH.L, y1 = CY - GOAL.W / 2, y2 = CY + GOAL.W / 2, D = GOAL.D, H = GOAL.H, bh = 1.9;
    const st = 'rgba(235,240,255,0.5)';
    // subtle fill
    this.fillPoly(ctx, [{ x: L + D, y: y1, z: 0 }, { x: L + D, y: y2, z: 0 }, { x: L + D, y: y2, z: bh }, { x: L + D, y: y1, z: bh }], 'rgba(255,255,255,0.06)');
    const bx = (y, z) => {
      let x = L + D;
      if (bulge) { const d = Math.hypot(y - bulge.y, z - bulge.z); x += Math.max(0, 0.6 - d) * bulge.k; }
      return x;
    };
    for (let y = y1; y <= y2 + 1e-6; y += 0.3) {
      const pts = [];
      for (let z = 0; z <= bh + 1e-6; z += 0.3) pts.push({ x: bx(y, z), y, z });
      pts.push({ x: L, y, z: H });
      this.polyline(ctx, pts, 0.02, st);
    }
    for (let z = 0; z <= bh + 1e-6; z += 0.3) {
      const pts = [];
      for (let y = y1; y <= y2 + 1e-6; y += 0.3) pts.push({ x: bx(y, z), y, z });
      this.polyline(ctx, pts, 0.02, st);
    }
    // sides & roof
    for (const y of [y1, y2]) {
      for (let x = L; x <= L + D + 1e-6; x += 0.3) this.line(ctx, { x, y, z: 0 }, { x, y, z: H - ((x - L) / D) * (H - bh) }, 0.02, st);
      for (let z = 0; z <= bh; z += 0.3) this.line(ctx, { x: L, y, z }, { x: L + D, y, z }, 0.02, st);
    }
    for (let y = y1; y <= y2 + 1e-6; y += 0.3) this.line(ctx, { x: L, y, z: H }, { x: L + D, y, z: bh }, 0.02, st);
    for (let x = L; x <= L + D + 1e-6; x += 0.3) this.line(ctx, { x, y: y1, z: H - ((x - L) / D) * (H - bh) }, { x, y: y2, z: H - ((x - L) / D) * (H - bh) }, 0.02, st);
  }

  drawPosts(ctx) {
    const L = PITCH.L, y1 = CY - GOAL.W / 2 - POST_R, y2 = CY + GOAL.W / 2 + POST_R;
    const sh = 'rgba(0,0,0,0.25)';
    this.line(ctx, { x: L + 0.05, y: y1 + 0.3, z: 0 }, { x: L + 0.05, y: y2 + 0.3, z: 0 }, 0.14, sh);
    this.line(ctx, { x: L, y: y1, z: 0 }, { x: L, y: y1, z: GOAL.H }, 0.13, '#f4f4f4');
    this.line(ctx, { x: L, y: y2, z: 0 }, { x: L, y: y2, z: GOAL.H }, 0.13, '#f4f4f4');
    this.line(ctx, { x: L, y: y1, z: GOAL.H }, { x: L, y: y2, z: GOAL.H }, 0.13, '#f4f4f4');
  }

  drawBall(ctx, b, rot = 0) {
    const sh = this.project({ x: b.x, y: b.y, z: 0 });
    if (sh) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, sh.s * 0.12, sh.s * 0.04, 0, 0, TAU); ctx.fill(); }
    const p = this.project(b);
    if (!p) return;
    const r = Math.max(1.5, p.s * 0.11);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.clip();
    ctx.fillStyle = '#1b1b1b';
    for (let i = 0; i < 4; i++) {
      const a = rot + i * 1.57;
      ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * r * 0.6, p.y + Math.sin(a) * r * 0.45, r * 0.3, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = Math.max(0.5, r * 0.08);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
  }

  /**
   * Draw a standing-figure billboard. `feet` and `head` are world points (the body axis);
   * pose: 'stand' | 'wall' | 'keeper' | 'dive' | 'run'; back=true shows the number on the back.
   */
  drawFigure(ctx, feet, head, kit, opts = {}) {
    const a = this.project(feet), b = this.project(head);
    if (!a || !b) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const s = len / 1.8;                       // pixels per metre along the body
    if (s < 0.5) return;
    const ang = Math.atan2(b.x - a.x, -(b.y - a.y));
    const skin = opts.skin || '#d9a47c', hair = opts.hair || '#2b1d14';
    ctx.save();
    ctx.translate(a.x, a.y); ctx.rotate(ang); ctx.scale(s, s);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 0.45, 0.08, 0, 0, TAU); ctx.fill();
    const run = opts.run || 0;
    const legA = Math.sin(run) * 0.35;
    // legs
    const leg = (x, sw) => {
      ctx.save(); ctx.translate(x, -0.92); ctx.rotate(sw);
      ctx.fillStyle = kit.shorts; ctx.fillRect(-0.09, 0, 0.18, 0.28);
      ctx.fillStyle = skin; ctx.fillRect(-0.075, 0.28, 0.15, 0.2);
      ctx.fillStyle = kit.socks; ctx.fillRect(-0.08, 0.48, 0.16, 0.38);
      ctx.fillStyle = '#111'; ctx.fillRect(-0.09, 0.84, 0.22, 0.08);
      ctx.restore();
    };
    leg(-0.11, opts.pose === 'dive' ? 0.25 : legA);
    leg(0.11, opts.pose === 'dive' ? -0.1 : -legA);
    // shorts
    ctx.fillStyle = kit.shorts; ctx.fillRect(-0.24, -1.0, 0.48, 0.2);
    // torso
    ctx.save();
    ctx.beginPath(); ctx.moveTo(-0.26, -1.48); ctx.lineTo(0.26, -1.48); ctx.lineTo(0.23, -0.92); ctx.lineTo(-0.23, -0.92); ctx.closePath();
    ctx.fillStyle = kit.shirt; ctx.fill(); ctx.clip();
    ctx.fillStyle = kit.sec;
    if (kit.pattern === 'stripes') for (let x = -0.26; x < 0.3; x += 0.13) ctx.fillRect(x, -1.5, 0.06, 0.6);
    else if (kit.pattern === 'checks') for (let x = -0.26; x < 0.3; x += 0.1) for (let y = -1.5; y < -0.9; y += 0.1) if (((Math.round(x * 10) + Math.round(y * 10)) & 1) === 0) ctx.fillRect(x, y, 0.1, 0.1);
    else ctx.fillRect(-0.26, -1.5, 0.52, 0.05);
    ctx.restore();
    if (opts.back && opts.num != null) {
      ctx.fillStyle = kit.num; ctx.font = 'bold 0.3px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(opts.num), 0, -1.18);
      if (opts.name) { ctx.font = 'bold 0.08px Arial'; ctx.fillText(opts.name, 0, -1.4); }
    } else if (opts.num != null) {
      ctx.fillStyle = kit.num; ctx.font = 'bold 0.12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(opts.num), 0.1, -1.36);
    }
    // arms
    const arm = (side, angle) => {
      ctx.save(); ctx.translate(side * 0.27, -1.44); ctx.rotate(angle);
      ctx.fillStyle = kit.shirt; ctx.fillRect(-0.07, 0, 0.14, 0.22);
      ctx.fillStyle = skin; ctx.fillRect(-0.06, 0.22, 0.12, 0.3);
      ctx.fillStyle = opts.gloves ? '#f5f5f5' : skin; ctx.beginPath(); ctx.arc(0, 0.56, opts.gloves ? 0.08 : 0.055, 0, TAU); ctx.fill();
      ctx.restore();
    };
    const pose = opts.pose || 'stand';
    if (pose === 'keeper') { arm(-1, 0.9 + (opts.sway || 0)); arm(1, -0.9 + (opts.sway || 0)); }
    else if (pose === 'dive') { arm(-1, Math.PI - 0.25); arm(1, Math.PI + 0.25); }
    else if (pose === 'wall') { arm(-1, -0.5); arm(1, 0.5); }
    else if (pose === 'jump') { arm(-1, Math.PI - 0.4); arm(1, Math.PI + 0.4); }
    else { arm(-1, 0.15 + legA * 0.5); arm(1, -0.15 - legA * 0.5); }
    // head
    ctx.fillStyle = skin; ctx.fillRect(-0.05, -1.56, 0.1, 0.1);
    ctx.beginPath(); ctx.arc(0, -1.66, 0.12, 0, TAU); ctx.fill();
    ctx.fillStyle = hair; ctx.beginPath();
    if (opts.back) ctx.arc(0, -1.66, 0.125, 0, TAU); else ctx.arc(0, -1.69, 0.12, Math.PI, TAU);
    ctx.fill();
    ctx.restore();
  }
}
