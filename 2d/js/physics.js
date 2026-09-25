// Ball physics (pure). Handles flight with drag, gravity, bounce, Magnus curve,
// topspin dip, knuckle wobble, exact rolling resistance, posts/crossbar and nets.
import { PITCH, CY, GOAL, BALL_R, POST_R, PHYS } from './constants.js';

export function makeBall(x = PITCH.L / 2, y = PITCH.W / 2) {
  return { x, y, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, topspin: 0, knuckle: 0, kPhase: 0, rot: 0 };
}

export function placeBall(b, x, y, z = 0) {
  b.x = x; b.y = y; b.z = z;
  b.vx = b.vy = b.vz = 0; b.spin = b.topspin = b.knuckle = 0;
}

const CK = PHYS.ROLL_C / PHYS.ROLL_K;

/** Advance free ball state by dt (no world collisions). */
export function integrate(b, dt) {
  const hs = Math.hypot(b.vx, b.vy);
  const airborne = b.z > 0.004 || b.vz > 0.05;
  if (airborne) {
    const sp = Math.hypot(hs, b.vz);
    const k = PHYS.AIR_K * sp * dt;
    b.vx -= b.vx * k; b.vy -= b.vy * k; b.vz -= b.vz * k;
    if (hs > 0.5) {
      const ux = b.vx / hs, uy = b.vy / hs;
      let lat = PHYS.MAGNUS * b.spin * hs;               // sideways (curve)
      if (b.knuckle) {
        b.kPhase += dt * PHYS.KNUCKLE_FREQ;
        lat += PHYS.KNUCKLE * b.knuckle * hs * Math.sin(b.kPhase);
        b.vz += PHYS.KNUCKLE * 0.5 * b.knuckle * hs * Math.cos(b.kPhase * 1.37) * dt;
      }
      // (-uy, ux) is the right-hand side of travel in screen coordinates (y down)
      b.vx += -uy * lat * dt; b.vy += ux * lat * dt;
      b.vz -= PHYS.TOPSPIN * b.topspin * hs * dt;         // dip
    }
    b.vz -= PHYS.G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -PHYS.BOUNCE_MIN) {
        b.vz = -b.vz * PHYS.BOUNCE;
        b.vx *= PHYS.BOUNCE_FRICTION; b.vy *= PHYS.BOUNCE_FRICTION;
        b.spin *= 0.4; b.topspin *= 0.3; b.knuckle = 0;
      } else b.vz = 0;
    }
  } else {
    // Rolling: dv/dt = -C - K v, integrated exactly so pass planning matches.
    b.z = 0; b.vz = 0;
    if (hs > 1e-4) {
      const e = Math.exp(-PHYS.ROLL_K * dt);
      let ns = (hs + CK) * e - CK, ds;
      if (ns <= 0) {
        const ts = Math.log((hs + CK) / CK) / PHYS.ROLL_K;
        ds = (hs + CK) / PHYS.ROLL_K * (1 - Math.exp(-PHYS.ROLL_K * ts)) - CK * ts;
        ns = 0;
      } else {
        ds = (hs + CK) / PHYS.ROLL_K * (1 - e) - CK * dt;
      }
      let ux = b.vx / hs, uy = b.vy / hs;
      if (Math.abs(b.spin) > 0.05 && ns > 0.5) { // slight curl while rolling
        const ang = PHYS.MAGNUS * 0.25 * b.spin * dt;
        const c = Math.cos(ang), s = Math.sin(ang);
        const nx = ux * c - uy * s; uy = ux * s + uy * c; ux = nx;
      }
      b.x += ux * ds; b.y += uy * ds;
      b.vx = ux * ns; b.vy = uy * ns;
    } else { b.vx = 0; b.vy = 0; }
  }
  b.spin *= Math.exp(-PHYS.SPIN_DECAY * dt);
  b.topspin *= Math.exp(-PHYS.SPIN_DECAY * 0.5 * dt);
  b.rot += hs * dt / BALL_R;
}

/** Post centre coordinates for a goal side (0 => x=0, 1 => x=L). */
export function postsOf(side) {
  const gx = side === 0 ? 0 : PITCH.L;
  return { gx, out: side === 0 ? -1 : 1, y1: CY - GOAL.W / 2 - POST_R, y2: CY + GOAL.W / 2 + POST_R };
}

/** Collide the ball with both goal frames and nets. Pushes event strings into `events`. */
export function collideGoals(b, events) {
  for (let side = 0; side < 2; side++) {
    const { gx, out, y1, y2 } = postsOf(side);
    if (Math.abs(b.x - gx) > GOAL.D + 1.5) continue;
    const r = BALL_R + POST_R;
    // Posts (vertical cylinders)
    if (b.z < GOAL.H + POST_R) {
      for (const py of [y1, y2]) {
        const dx = b.x - gx, dy = b.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < r * r) {
          const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d;
          b.x = gx + nx * r; b.y = py + ny * r;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= (1 + PHYS.POST_E) * vn * nx; b.vy -= (1 + PHYS.POST_E) * vn * ny;
            b.spin *= -0.3;
            if (events && -vn > 2) events.push('post');
          }
        }
      }
    }
    // Crossbar (horizontal cylinder along y at height GOAL.H)
    if (b.y > y1 && b.y < y2) {
      const dx = b.x - gx, dz = b.z - GOAL.H;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1e-6, nx = dx / d, nz = dz / d;
        b.x = gx + nx * r; b.z = GOAL.H + nz * r;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= (1 + PHYS.POST_E) * vn * nx; b.vz -= (1 + PHYS.POST_E) * vn * nz;
          if (events && -vn > 2) events.push('bar');
        }
      }
    }
    // Inside the net: back, side and roof netting absorb the ball.
    const depth = (b.x - gx) * out;
    if (depth > 0 && depth < GOAL.D + 0.6 && Math.abs(b.y - CY) < GOAL.W / 2 && b.z < GOAL.H) {
      if (depth > GOAL.D - BALL_R) {
        b.x = gx + out * (GOAL.D - BALL_R);
        if (b.vx * out > 0) {
          if (events && Math.abs(b.vx) > 3) events.push('net');
          b.vx = -b.vx * 0.03; b.vy *= 0.4; b.vz *= 0.35; b.spin = 0; b.knuckle = 0;
        }
      }
      const lim = GOAL.W / 2 - BALL_R;
      if (Math.abs(b.y - CY) > lim) {
        const s = Math.sign(b.y - CY);
        b.y = CY + s * lim;
        if (b.vy * s > 0) { if (events && Math.abs(b.vy) > 3) events.push('net'); b.vy = -b.vy * 0.15; b.vx *= 0.6; }
      }
      if (b.z > GOAL.H - BALL_R) { b.z = GOAL.H - BALL_R; if (b.vz > 0) b.vz = -b.vz * 0.1; }
      if (depth > 0.25) { b.vx *= 0.975; b.vy *= 0.975; } // ball tangled in the netting
    } else if (depth > 0 && depth < GOAL.D && Math.abs(b.y - CY) < GOAL.W / 2 + POST_R &&
               b.z >= GOAL.H && b.z < GOAL.H + BALL_R && b.vz < 0) {
      // Landing on the roof netting from above
      b.z = GOAL.H + BALL_R; b.vz = -b.vz * 0.2; b.vx *= 0.5; b.vy *= 0.5;
    }
  }
}

/** Advance the ball with collisions, substepping fast balls to avoid tunnelling. */
export function stepBallWorld(b, dt, events) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  const n = Math.min(10, Math.max(1, Math.ceil((sp * dt) / 0.05)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    integrate(b, h);
    collideGoals(b, events);
  }
}

/** Simulate a free ball (copy) and return sampled points until stopFn or maxT. */
export function simulatePath(ball, maxT = 3, stopFn = null, every = 4, withGoals = false) {
  const b = { ...ball };
  const pts = [];
  const dt = PHYS.DT;
  let t = 0, i = 0;
  while (t < maxT) {
    if (withGoals) { integrate(b, dt); collideGoals(b, null); } else integrate(b, dt);
    t += dt; i++;
    if (i % every === 0) pts.push({ x: b.x, y: b.y, z: b.z, t });
    if (stopFn && stopFn(b, t)) { pts.push({ x: b.x, y: b.y, z: b.z, t }); break; }
    if (Math.hypot(b.vx, b.vy) < 0.05 && b.z <= 0) break;
  }
  return pts;
}

/**
 * Solve launch velocity so a free ball kicked from `from` with horizontal speed `hs`
 * (plus spin/topspin) passes through `target` (x,y at height z). Iterative shooting method
 * using the real integrator, so curve and drag are accounted for.
 */
export function solveKick(from, target, hs, opts = {}) {
  const spin = opts.spin || 0, topspin = opts.topspin || 0;
  const fz = from.z || 0;
  const dx = target.x - from.x, dy = target.y - from.y;
  const D = Math.hypot(dx, dy) || 0.01;
  const ux = dx / D, uy = dy / D;
  let ang = Math.atan2(dy, dx);
  let t0 = D / hs;
  let vz = (target.z - fz + 0.5 * PHYS.G * t0 * t0) / t0;
  if (target.z < 0.25 && !opts.loft) vz = Math.max(0, vz * 0.6);
  let tHit = t0;
  const aerial = target.z >= 0.25 || !!opts.loft;
  for (let it = 0; it < 12; it++) {
    const b = { x: from.x, y: from.y, z: fz, vx: Math.cos(ang) * hs, vy: Math.sin(ang) * hs, vz, spin, topspin, knuckle: 0, kPhase: 0, rot: 0 };
    let t = 0, reached = false, landed = -1;
    while (t < 6) {
      integrate(b, PHYS.DT); t += PHYS.DT;
      const p = (b.x - from.x) * ux + (b.y - from.y) * uy;
      if (p >= D) { reached = true; break; }
      // an aerial ball must still be in the air when it gets there (drag shortens the flight)
      if (aerial && b.z <= 0 && t > 0.05) { landed = p; break; }
      if (Math.hypot(b.vx, b.vy) < 0.3) break;
    }
    if (landed >= 0) { vz = vz * (1.04 + 0.6 * (D - landed) / D) + 0.2; continue; }
    if (!reached) { hs *= 1.1; continue; }
    tHit = t;
    const lat = (b.x - from.x) * -uy + (b.y - from.y) * ux; // + means right of line
    ang -= Math.atan2(lat, D);
    const ez = b.z - target.z;
    if (aerial) vz -= ez / Math.max(0.2, t) * 0.9;
    if (Math.abs(lat) < 0.02 && Math.abs(ez) < 0.03) break;
  }
  return { vx: Math.cos(ang) * hs, vy: Math.sin(ang) * hs, vz: Math.max(0, vz), spin, topspin, t: tHit };
}
