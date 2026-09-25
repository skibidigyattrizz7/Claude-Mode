// Minimal fallback renderer implementing the render API (used only if render/index.js fails to
// load). Same API as render/index.js:
//   createRenderer(container, {home, away, stadium, quality}) ->
//     { render(view, dt), setCamera(mode), setControlled(ids), resize(), destroy(), domElement,
//       project(x,y,z), getCameraYaw() }
import * as THREE from '../../../vendor/three.module.min.js';
import { createRenderer as mkRenderer, buildStadium } from './stadium.js';
import { PITCH } from '../core/constants.js';

export function createRenderer(container, { home, away, stadium = 'day' }) {
  const { renderer, scene, camera } = mkRenderer(container, stadium);
  const st = buildStadium(scene, { home, away, stadium });
  const body = new THREE.CapsuleGeometry(0.26, 1.0, 4, 8);
  const headG = new THREE.SphereGeometry(0.13, 12, 8);
  const skin = new THREE.MeshLambertMaterial({ color: 0xc58c5c });
  const players = [];
  for (let i = 0; i < 22; i++) {
    const team = i < 11 ? home : away;
    const kit = i % 11 === 0 ? team.gkKit || team.kit : team.kit;
    const g = new THREE.Group();
    const b = new THREE.Mesh(body, new THREE.MeshLambertMaterial({ color: kit.primary }));
    b.position.y = 0.78; b.castShadow = true; g.add(b);
    const h = new THREE.Mesh(headG, skin); h.position.y = 1.68; h.castShadow = true; g.add(h);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.2), new THREE.MeshLambertMaterial({ color: kit.secondary }));
    nose.position.set(0, 1.2, 0.26); g.add(nose);
    scene.add(g);
    players.push(g);
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  ball.castShadow = true;
  scene.add(ball);
  const ringMat = [new THREE.MeshBasicMaterial({ color: 0x3fa9ff }), new THREE.MeshBasicMaterial({ color: 0xff4d4d })];
  const rings = [0, 1].map((i) => { const r = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 24), ringMat[i]); r.rotation.x = -Math.PI / 2; r.visible = false; scene.add(r); return r; });
  const arrows = [0, 1].map(() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.12); s.lineTo(1.6, -0.12); s.lineTo(1.6, -0.35); s.lineTo(2.3, 0); s.lineTo(1.6, 0.35); s.lineTo(1.6, 0.12); s.lineTo(0, 0.12);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); return m;
  });
  const trajGeo = new THREE.BufferGeometry();
  trajGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 80), 3));
  const traj = new THREE.Points(trajGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.25, transparent: true, opacity: 0.8 }));
  traj.visible = false; traj.frustumCulled = false; scene.add(traj);
  let mode = 'broadcast', ctrl = [-1, -1];
  const camPos = new THREE.Vector3(0, 22, 60), look = new THREE.Vector3();
  const seenFx = new Set();
  const tmp = new THREE.Vector3();
  function resize() {
    const w = container.clientWidth || 800, h = container.clientHeight || 450;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  return {
    domElement: renderer.domElement,
    setCamera(m) { mode = m; },
    setControlled(ids) { ctrl = ids; },
    resize,
    project(x, y, z) {
      tmp.set(x, y, z).project(camera);
      const w = container.clientWidth, h = container.clientHeight;
      return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, visible: tmp.z < 1 };
    },
    getCameraYaw() { const d = new THREE.Vector3(); camera.getWorldDirection(d); return Math.atan2(d.z, d.x); },
    render(view, dt) {
      if (!view) return;
      const P = view.p;
      for (let i = 0; i < 22; i++) {
        const g = players[i], o = i * 7;
        g.visible = !((view.so >> i) & 1);
        g.position.set(P[o], 0, P[o + 1]);
        g.rotation.y = Math.PI / 2 - P[o + 2];
        const anim = P[o + 3];
        g.rotation.x = anim === 3 || anim === 8 ? 1.2 : 0;
        g.rotation.z = anim === 5 ? -Math.sign(P[o + 5]) * 1.2 : 0;
        g.position.y = anim === 4 || anim === 12 ? Math.max(0, Math.sin(Math.min(1, P[o + 4] / 0.6) * Math.PI)) * 0.4 : 0;
      }
      ball.position.set(view.b[0], view.b[1], view.b[2]);
      const c = view.c || ctrl;
      for (let s = 0; s < 2; s++) {
        const i = c[s];
        const on = i >= 0 && view.local && view.local[s] && !view.replay;
        rings[s].visible = !!on;
        arrows[s].visible = false;
        if (!on) continue;
        rings[s].position.set(P[i * 7], 0.03, P[i * 7 + 1]);
        rings[s].material = ringMat[view.local[s] === 'p2' ? 1 : 0];
        const a = view.aim && view.aim[s];
        if (a) { arrows[s].visible = true; arrows[s].position.set(P[i * 7], 0.04, P[i * 7 + 1]); arrows[s].rotation.z = Math.atan2(-a.z, a.x); }
      }
      if (view.traj && view.traj.length) {
        const arr = trajGeo.attributes.position.array;
        const n = Math.min(80, view.traj.length / 3);
        for (let i = 0; i < 80; i++) { const k = Math.min(i, n - 1) * 3; arr[i * 3] = view.traj[k]; arr[i * 3 + 1] = view.traj[k + 1]; arr[i * 3 + 2] = view.traj[k + 2]; }
        trajGeo.attributes.position.needsUpdate = true; traj.visible = true;
      } else traj.visible = false;
      for (const f of view.fx || []) {
        if (seenFx.has(f.id)) continue;
        seenFx.add(f.id);
        if (f.k === 'net') st.hitNet(f.x, f.y, f.z, f.s);
      }
      const bx = view.b[0], bz = view.b[2];
      const excite = Math.max(0, 1 - (PITCH.HL - Math.abs(bx)) / 30) * 0.6 + (view.ph === 4 ? 1 : 0);
      st.update(dt, { x: bx, y: view.b[1], z: bz }, Math.min(1, excite + 0.1));
      // camera
      let tp, tl;
      if (view.replay) { const s = bx > 0 ? 1 : -1; tp = new THREE.Vector3(s * (PITCH.HL + 12), 6, bz * 0.5 + 14); tl = new THREE.Vector3(bx, 0.8, bz); }
      else if (mode === 'pro' && c.some((i) => i >= 0)) {
        const i = c[0] >= 0 ? c[0] : c[1];
        const d = (c[0] >= 0 ? view.dir : -view.dir) || 1;
        tp = new THREE.Vector3(P[i * 7] - d * 11, 6.5, P[i * 7 + 1]); tl = new THREE.Vector3(P[i * 7] + d * 10, 0, P[i * 7 + 1]);
      } else { tp = new THREE.Vector3(Math.max(-38, Math.min(38, bx * 0.75)), 23, 62); tl = new THREE.Vector3(bx, 0, bz * 0.55 - 3); }
      const k = Math.min(1, dt * 3.5);
      camPos.lerp(tp, k); look.lerp(tl, k);
      camera.position.copy(camPos); camera.lookAt(look);
      renderer.render(scene, camera);
    },
    destroy() {
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const m = o.material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); });
      });
      if (scene.background && scene.background.dispose) scene.background.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
