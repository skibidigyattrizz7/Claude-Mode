// Controlled-player markers: ground ring + arrow + name tag sprite. Home = blue-ish, away = red-ish.
import * as THREE from '../../../vendor/three.module.min.js';
import { ringTexture, labelTexture } from './textures.js';

const COLORS = ['#3aa0ff', '#ff4a4a'];

export function buildMarkers(scene, track) {
  const rt = track(ringTexture('#ffffff'));
  const ringGeo = track(new THREE.PlaneGeometry(1.5, 1.5)); ringGeo.rotateX(-Math.PI / 2);
  const coneGeo = track(new THREE.ConeGeometry(0.16, 0.32, 3)); coneGeo.rotateX(Math.PI);
  const items = COLORS.map((c) => {
    const ringMat = track(new THREE.MeshBasicMaterial({ map: rt, color: c, transparent: true, depthWrite: false, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false }));
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.renderOrder = 2;
    const arrowMat = track(new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    const arrow = new THREE.Mesh(coneGeo, arrowMat);
    const spMat = track(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    const sprite = new THREE.Sprite(spMat); sprite.renderOrder = 10; sprite.center.set(0.5, 0);
    ring.visible = arrow.visible = sprite.visible = false;
    scene.add(ring, arrow, sprite);
    return { ring, arrow, sprite, spMat, color: c, key: '', tex: null };
  });
  const cache = new Map();
  return {
    update(slot, rig, name, t, camera, colorIdx = slot) {
      const it = items[slot];
      if (!rig) { it.ring.visible = it.arrow.visible = it.sprite.visible = false; return; }
      const col = COLORS[colorIdx] || COLORS[slot];
      if (it.color !== col) { it.color = col; it.ring.material.color.set(col); it.arrow.material.color.set(col); it.key = ''; }
      const x = rig.root.position.x, z = rig.root.position.z;
      it.ring.visible = it.arrow.visible = it.sprite.visible = true;
      it.ring.position.set(x, 0.025, z);
      it.ring.rotation.y = t * 1.5;
      const hh = rig.headHeight();
      it.arrow.position.set(x, hh + 0.45 + Math.sin(t * 5) * 0.06, z);
      it.arrow.rotation.y = t * 2;
      if (name !== it.key) {
        it.key = name;
        const k = it.color + '|' + name;
        let tex = cache.get(k);
        if (!tex) { tex = track(labelTexture(name, { accent: it.color })); cache.set(k, tex); }
        it.spMat.map = tex; it.spMat.needsUpdate = true;
      }
      // constant-ish screen size: scale with distance
      const d = camera.position.distanceTo(it.arrow.position);
      const s = Math.max(1.6, d * 0.045) * (camera.fov / 30);
      it.sprite.scale.set(s, s * 0.25, 1);
      it.sprite.position.set(x, hh + 0.7, z);
    },
  };
}
