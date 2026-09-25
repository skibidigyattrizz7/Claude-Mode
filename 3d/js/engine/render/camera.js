// Camera director: broadcast (high side-on tele), pro (behind controlled player), replay (low cinematic).
import * as THREE from '../../../vendor/three.module.min.js';
import { PITCH, PHASE } from '../core/constants.js';

const HL = PITCH.HL, HW = PITCH.HW;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// critically-damped spring toward target (per component)
function spring(cur, vel, target, dt, omega) {
  const x = omega * dt, exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel + omega * change) * dt;
  const nv = (vel - omega * temp) * exp;
  return [target + (change + temp) * exp, nv];
}

export class CameraDirector {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'broadcast';
    this.look = new THREE.Vector3(0, 0, 0); this.lookV = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, 22, 62); this.posV = new THREE.Vector3();
    this.fov = 26; this.fovV = 0;
    this.init = false;
    this.replayT = 0;
    this.replayGoal = 1;
    this.replaySide = 1;
    this.override = null;
  }
  setMode(m) {
    if (m !== this.mode) {
      this.mode = m;
      this.cut = true; // hard cut on mode change
      if (m === 'replay') this.replayT = 0;
    }
  }
  update(view, dt, ctx) {
    const cam = this.cam;
    if (this.override) {
      cam.position.copy(this.override.pos); cam.lookAt(this.override.look);
      if (this.override.fov && cam.fov !== this.override.fov) { cam.fov = this.override.fov; cam.updateProjectionMatrix(); }
      return;
    }
    const b = view.b;
    const bx = b[0], by = b[1], bz = b[2];
    const bvx = b[3], bvz = b[5];
    const bs = Math.hypot(b[3], b[4], b[5]);
    let lx, ly, lz, px, py, pz, fov, wLook = 3.2, wPos = 2.2;
    const mode = this.mode;
    if (mode === 'pro' && ctx.ctrlPos) {
      const c = ctx.ctrlPos; // {x,z,dir}
      const d = c.dir;
      const tx = clamp(c.x * 0.75 + bx * 0.25, -HL + 2, HL - 2);
      const tz = c.z * 0.7 + bz * 0.3;
      lx = tx + d * 9; ly = 0.8; lz = tz * 0.85;
      px = tx - d * 13; py = 6.2; pz = tz * 0.75;
      fov = 50; wLook = 3.5; wPos = 2.6;
    } else if (mode === 'replay') {
      this.replayT += dt;
      if (this.cut) { this.replayGoal = Math.sign(bx) || 1; this.replaySide = Math.sign(bz) || 1; }
      const g = this.replayGoal;
      const a = 0.9 + this.replayT * 0.06;
      const R = 17;
      px = g * (HL + 1.5) - g * Math.cos(a) * R * 0.9;
      pz = this.replaySide * (Math.sin(a) * R + 3);
      py = 1.7 + this.replayT * 0.12;
      lx = bx; ly = Math.max(0.6, by * 0.8); lz = bz;
      const dist = Math.hypot(px - bx, pz - bz);
      fov = clamp(30 + 400 / (dist + 20) - 8, 22, 42);
      wLook = 5; wPos = 1.2;
    } else {
      // broadcast tele camera on the near-side gantry
      const lead = 0.35;
      const tx = clamp(bx + bvx * lead, -HL + 8, HL - 8);
      const tz = clamp(bz * 0.45 + bvz * lead * 0.3, -HW * 0.55, HW * 0.55);
      lx = tx; ly = 0; lz = tz;
      px = tx * 0.86; py = 21; pz = HW + 33;
      const sp = clamp((bs - 6) / 20, 0, 1);
      const nearGoal = clamp((Math.abs(bx) - 30) / 18, 0, 1);
      fov = 21 + 7 * sp + 3 * nearGoal - (view.ph === PHASE.SETPIECE ? 1 : 0);
      if (view.ph === PHASE.GOAL) fov = 19;
      wLook = 2.6; wPos = 1.6;
    }
    if (!this.init || this.cut) {
      this.look.set(lx, ly, lz); this.pos.set(px, py, pz); this.fov = fov;
      this.lookV.set(0, 0, 0); this.posV.set(0, 0, 0); this.fovV = 0;
      this.init = true; this.cut = false;
    } else {
      let r;
      r = spring(this.look.x, this.lookV.x, lx, dt, wLook); this.look.x = r[0]; this.lookV.x = r[1];
      r = spring(this.look.y, this.lookV.y, ly, dt, wLook); this.look.y = r[0]; this.lookV.y = r[1];
      r = spring(this.look.z, this.lookV.z, lz, dt, wLook); this.look.z = r[0]; this.lookV.z = r[1];
      r = spring(this.pos.x, this.posV.x, px, dt, wPos); this.pos.x = r[0]; this.posV.x = r[1];
      r = spring(this.pos.y, this.posV.y, py, dt, wPos); this.pos.y = r[0]; this.posV.y = r[1];
      r = spring(this.pos.z, this.posV.z, pz, dt, wPos); this.pos.z = r[0]; this.posV.z = r[1];
      r = spring(this.fov, this.fovV, fov, dt, 1.5); this.fov = r[0]; this.fovV = r[1];
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 1e-3) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
