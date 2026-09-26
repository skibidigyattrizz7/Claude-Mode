// Ball: textured sphere rolling with velocity, blob shadow, speed trail, landing marker.
import * as THREE from '../../../vendor/three.module.min.js';
import { BALL_R, G } from '../core/constants.js';
import { PHYS } from '../core/physics.js';
import { ballTexture, radialTexture, ringTexture } from './textures.js';

const VIS = 1.22; // slight visual up-scale for readability at broadcast distance
const TRAIL_N = 14;

export function buildBall(scene, q, track) {
  const r = BALL_R * VIS;
  const tex = track(ballTexture());
  const mat = track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0 }));
  const geo = track(new THREE.SphereGeometry(r, 24, 16));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = q.shadows;
  scene.add(mesh);
  // blob shadow
  const blobTex = track(radialTexture('rgba(0,0,0,0.6)', 'rgba(0,0,0,0)'));
  const blobGeo = track(new THREE.PlaneGeometry(1, 1)); blobGeo.rotateX(-Math.PI / 2);
  const blobMat = track(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const blob = new THREE.Mesh(blobGeo, blobMat); blob.renderOrder = 1;
  scene.add(blob);
  // trail ribbon
  const tpos = new Float32Array(TRAIL_N * 2 * 3), talpha = new Float32Array(TRAIL_N * 2);
  const tgeo = track(new THREE.BufferGeometry());
  tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
  tgeo.setAttribute('alpha', new THREE.BufferAttribute(talpha, 1));
  const tidx = [];
  for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; tidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  tgeo.setIndex(tidx);
  const tmat = track(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uOp: { value: 0 } },
    vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uOp; varying float vA; void main(){ gl_FragColor = vec4(vec3(1.0,0.98,0.9) * vA * uOp, 1.0); }',
  }));
  const trail = new THREE.Mesh(tgeo, tmat); trail.frustumCulled = false; trail.renderOrder = 3;
  scene.add(trail);
  const hist = [];
  // landing marker
  const lmTex = track(ringTexture('#ffffff'));
  const lmGeo = track(new THREE.PlaneGeometry(1, 1)); lmGeo.rotateX(-Math.PI / 2);
  const lmMat = track(new THREE.MeshBasicMaterial({ map: lmTex, transparent: true, depthWrite: false, color: 0xffe066, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const marker = new THREE.Mesh(lmGeo, lmMat); marker.renderOrder = 2; marker.visible = false;
  scene.add(marker);

  const q0 = new THREE.Quaternion(), axis = new THREE.Vector3(), prev = new THREE.Vector3();
  const baseMat = mat;
  let has = false, spin = new THREE.Vector3();
  const side = new THREE.Vector3(), dir = new THREE.Vector3(), cam2 = new THREE.Vector3();

  return {
    mesh,
    update(b, dt, t, camera, opts) {
      const [px, py, pz, vx, vy, vz] = b;
      // admin fun effects: giant / tiny / beach / bowling ball (visual size + material only)
      const sc = Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1;
      const want = opts.mat || baseMat;
      if (mesh.material !== want) mesh.material = want;
      mesh.scale.setScalar(sc);
      const rs = r * sc;
      const y = Math.max(rs, py - BALL_R + rs);
      mesh.position.set(px, y, pz);
      // rolling rotation: ω = v × up / r on the ground; keep last spin in the air
      const onGround = py < BALL_R + 0.05;
      if (onGround) spin.set(-vz / rs, 0, vx / rs);
      else spin.multiplyScalar(Math.exp(-dt * 0.4));
      const w = spin.length();
      if (w > 1e-4 && dt > 0) {
        axis.copy(spin).divideScalar(w);
        q0.setFromAxisAngle(axis, Math.min(w * dt, 1.2));
        mesh.quaternion.premultiply(q0);
      }
      // blob
      const h = Math.max(0, py - BALL_R);
      const s = rs * 3.2 * (1 + h * 0.35);
      blob.scale.set(s, 1, s);
      blob.position.set(px + h * 0.12, 0.012, pz + h * 0.05);
      blobMat.opacity = Math.max(0.12, 0.9 - h * 0.12);
      // trail
      const sp = Math.hypot(vx, vy, vz);
      if (!has || Math.hypot(px - prev.x, pz - prev.z) > 5) hist.length = 0;
      has = true; prev.set(px, y, pz);
      hist.unshift([px, y, pz]);
      if (hist.length > TRAIL_N) hist.length = TRAIL_N;
      const op = Math.min(1, Math.max(0, (sp - 17) / 12)) * (opts.trail ? 1 : 0);
      tmat.uniforms.uOp.value = op * 0.55;
      trail.visible = op > 0.01 && hist.length > 2;
      if (trail.visible) {
        cam2.copy(camera.position);
        for (let i = 0; i < TRAIL_N; i++) {
          const a = hist[Math.min(i, hist.length - 1)], bb = hist[Math.min(i + 1, hist.length - 1)];
          dir.set(a[0] - bb[0], a[1] - bb[1], a[2] - bb[2]);
          if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
          side.set(a[0] - cam2.x, a[1] - cam2.y, a[2] - cam2.z).cross(dir).normalize();
          const wd = r * 0.9 * (1 - i / TRAIL_N);
          tpos[i * 6] = a[0] + side.x * wd; tpos[i * 6 + 1] = a[1] + side.y * wd; tpos[i * 6 + 2] = a[2] + side.z * wd;
          tpos[i * 6 + 3] = a[0] - side.x * wd; tpos[i * 6 + 4] = a[1] - side.y * wd; tpos[i * 6 + 5] = a[2] - side.z * wd;
          const al = (1 - i / (TRAIL_N - 1)) * (i < hist.length ? 1 : 0);
          talpha[i * 2] = al; talpha[i * 2 + 1] = al;
        }
        tgeo.attributes.position.needsUpdate = true;
        tgeo.attributes.alpha.needsUpdate = true;
      }
      // landing prediction for lofted balls
      let show = false;
      if (opts.owner < 0 && py > 0.6 && Math.hypot(vx, vz) > 1.5) {
        // integrate gravity + quadratic drag (matches core PHYS.drag, ignores spin)
        let x = px, yy = py, z = pz, ux = vx, uy = vy, uz = vz, tl = 0;
        const h2 = 1 / 60, k = PHYS.drag, Gm = G * (opts.gm || 1);
        for (let i = 0; i < 300 && yy > BALL_R; i++) {
          const m = Math.sqrt(ux * ux + uy * uy + uz * uz) * k;
          ux -= m * ux * h2; uz -= m * uz * h2; uy -= (Gm + m * uy) * h2;
          x += ux * h2; yy += uy * h2; z += uz * h2; tl += h2;
        }
        if (tl > 0.3 && yy <= BALL_R) {
          marker.position.set(x, 0.02, z);
          const pulse = 1 + 0.12 * Math.sin(t * 10);
          const ms = (0.9 + Math.min(tl, 2) * 0.6) * pulse;
          marker.scale.set(ms, 1, ms);
          lmMat.opacity = 0.45 + 0.4 * Math.min(1, 0.6 / tl);
          show = opts.marker;
        }
      }
      marker.visible = show;
    },
  };
}
