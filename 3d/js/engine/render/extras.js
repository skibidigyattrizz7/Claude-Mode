// Local-only overlays (aim arrow, set-piece trajectory, penalty reticle) and night floodlight shadows.
import * as THREE from '../../../vendor/three.module.min.js';
import { makeCanvas, canvasTex, ringTexture } from './textures.js';

const LOCAL_COL = { p1: '#3aa0ff', p2: '#ff4a4a' };

function arrowTexture() {
  const W = 64, H = 256, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, H, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(W * 0.36, H); g.lineTo(W * 0.36, H * 0.3); g.lineTo(W * 0.06, H * 0.3); g.lineTo(W * 0.5, 0); g.lineTo(W * 0.94, H * 0.3); g.lineTo(W * 0.64, H * 0.3); g.lineTo(W * 0.64, H); g.closePath();
  g.fill();
  return canvasTex(cv, {});
}
function dotTexture() {
  const S = 32, cv = makeCanvas(S, S), g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return canvasTex(cv, {});
}

export function buildOverlays(scene, track) {
  // aim arrows (one per side)
  const aTex = track(arrowTexture());
  const aGeo = track(new THREE.PlaneGeometry(0.6, 1)); aGeo.rotateX(-Math.PI / 2); aGeo.translate(0, 0, -0.5); // tip toward -z (local), tail at origin
  const arrows = [0, 1].map(() => {
    const m = track(new THREE.MeshBasicMaterial({ map: aTex, transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const mesh = new THREE.Mesh(aGeo, m); mesh.visible = false; mesh.renderOrder = 3;
    scene.add(mesh);
    return mesh;
  });
  // trajectory dots
  const MAXP = 256;
  const tPos = new Float32Array(MAXP * 3);
  const tGeo = track(new THREE.BufferGeometry());
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tGeo.setDrawRange(0, 0);
  const tMat = track(new THREE.PointsMaterial({ map: track(dotTexture()), size: 0.32, sizeAttenuation: true, transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.85, toneMapped: false }));
  const traj = new THREE.Points(tGeo, tMat); traj.frustumCulled = false; traj.renderOrder = 4; traj.visible = false;
  scene.add(traj);
  // penalty reticle (vertical, on the goal plane)
  const rTex = track(ringTexture('#ffffff'));
  const rMat = track(new THREE.MeshBasicMaterial({ map: rTex, transparent: true, depthWrite: false, color: 0xffe14d, side: THREE.DoubleSide, toneMapped: false }));
  const ret = new THREE.Mesh(track(new THREE.PlaneGeometry(0.75, 0.75)), rMat); ret.visible = false; ret.renderOrder = 5;
  scene.add(ret);
  const tmp = new THREE.Vector3();
  return {
    update(view, rigs, t, controlled) {
      const aim = view.aim, pw = view.pw || [0, 0], local = view.local || [null, null];
      for (let s = 0; s < 2; s++) {
        const a = arrows[s];
        const idx = controlled[s];
        const dir = aim && aim[s];
        if (!dir || idx < 0 || !rigs[idx] || !rigs[idx].root.visible || view.replay) { a.visible = false; continue; }
        const r = rigs[idx].root.position;
        const p = Math.max(0, Math.min(1, pw[s] || 0));
        const len = 1.6 + p * 3.2;
        a.visible = true;
        a.position.set(r.x + dir.x * 0.55, 0.03, r.z + dir.z * 0.55);
        a.rotation.y = Math.atan2(-dir.x, -dir.z);
        a.scale.set(1 + p * 0.3, 1, len);
        const base = new THREE.Color(LOCAL_COL[local[s]] || (s === 0 ? LOCAL_COL.p1 : LOCAL_COL.p2));
        a.material.color.copy(base).lerp(new THREE.Color(p > 0.85 ? '#ff5533' : '#ffe14d'), p * 0.85);
        a.material.opacity = 0.45 + 0.4 * p;
      }
      // trajectory
      const tr = view.traj;
      if (tr && tr.length >= 6 && !view.replay) {
        const n = Math.min(MAXP, Math.floor(tr.length / 3));
        let k = 0;
        // dash animation: skip alternating points shifted over time
        const phase = Math.floor(t * 12) % 2;
        for (let i = 0; i < n; i++) {
          if ((i + phase) % 2) continue;
          tPos[k * 3] = tr[i * 3]; tPos[k * 3 + 1] = Math.max(0.05, tr[i * 3 + 1]); tPos[k * 3 + 2] = tr[i * 3 + 2];
          k++;
        }
        tGeo.setDrawRange(0, k);
        tGeo.attributes.position.needsUpdate = true;
        traj.visible = k > 0;
      } else traj.visible = false;
      // penalty reticle
      const pa = view.penAim;
      if (pa && !view.replay) {
        ret.visible = true;
        ret.position.set(pa.x - Math.sign(pa.x || 1) * 0.05, Math.max(0.2, pa.y), pa.z);
        ret.rotation.set(0, Math.PI / 2, t * 0.8);
        const s = 1 + 0.08 * Math.sin(t * 8);
        ret.scale.set(s, s, 1);
      } else ret.visible = false;
      tmp.set(0, 0, 0);
    },
  };
}

// Four faint floodlight shadows per figure (the classic "X" under players at night games).
export function buildNightShadows(scene, towers, count, track) {
  const cv = makeCanvas(32, 128), g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(16, 64, 13, 64, 0, 0, Math.PI * 2); g.fill();
  const tex = track(canvasTex(cv, {}));
  const nq = count * towers.length;
  const pos = new Float32Array(nq * 4 * 3), uv = new Float32Array(nq * 4 * 2), idx = [];
  for (let q = 0; q < nq; q++) {
    uv.set([0, 1, 1, 1, 1, 0, 0, 0], q * 8);
    const b = q * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geo = track(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 1;
  scene.add(mesh);
  return {
    update(figs) { // figs: [{x, z, h, vis}]
      let q = 0;
      for (const f of figs) {
        for (const tw of towers) {
          const o = q * 12;
          if (!f.vis) { pos.fill(0, o, o + 12); q++; continue; }
          let dx = f.x - tw.x, dz = f.z - tw.z;
          const d = Math.hypot(dx, dz) || 1;
          dx /= d; dz /= d;
          const L = Math.min(7, f.h * d / tw.y) * 1.0 + 0.2, w = 0.28;
          const px = -dz * w, pz = dx * w;
          const x0 = f.x - dx * 0.15, z0 = f.z - dz * 0.15, x1 = f.x + dx * L, z1 = f.z + dz * L;
          pos[o] = x0 + px; pos[o + 1] = 0.02; pos[o + 2] = z0 + pz;
          pos[o + 3] = x0 - px; pos[o + 4] = 0.02; pos[o + 5] = z0 - pz;
          pos[o + 6] = x1 - px; pos[o + 7] = 0.02; pos[o + 8] = z1 - pz;
          pos[o + 9] = x1 + px; pos[o + 10] = 0.02; pos[o + 11] = z1 + pz;
          q++;
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
