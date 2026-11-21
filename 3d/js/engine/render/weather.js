import * as THREE from '../../../vendor/three.module.min.js';
import { PITCH } from '../core/constants.js';

// One instanced draw for precipitation plus a transparent rain sheen.
// Does not mutate existing pitch materials, lighting, stadium or scene fog.
export function createWeather(scene, { type = 'clear', count } = {}) {
  if (!['clear', 'rain', 'snow'].includes(type)) type = 'clear';
  const group = new THREE.Group(); group.name = 'pitchside-weather';
  let disposed = false, particles, sheen, geometry, material;
  const n = type === 'clear' ? 0 : Math.min(600, Math.max(0, Math.floor(Number.isFinite(count) ? count : type === 'rain' ? 480 : 320)));
  const positions = new Float32Array(n * 3);
  const dummy = new THREE.Object3D(); let time = 0;
  if (n) {
    geometry = new THREE.PlaneGeometry(1, 1);
    material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { snow: { value: type === 'snow' ? 1 : 0 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform float snow; varying vec2 vUv; void main(){float d=length(vUv-0.5);float a=mix((1.0-abs(vUv.y*2.0-1.0))*0.4,1.0-smoothstep(0.22,0.5,d),snow);gl_FragColor=vec4(mix(vec3(0.73,0.84,0.93),vec3(1.0),snow),a*0.7);}',
    });
    particles = new THREE.InstancedMesh(geometry, material, n); particles.frustumCulled = false;
    particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(particles);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (Math.random() - 0.5) * PITCH.L;
      positions[i * 3 + 1] = Math.random() * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * PITCH.W;
    }
  }
  if (type === 'rain') {
    sheen = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.L, PITCH.W), new THREE.MeshStandardMaterial({ color: '#a7b8c3', transparent: true, opacity: 0.12, roughness: 0.13, metalness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    sheen.rotation.x = -Math.PI / 2; sheen.position.y = 0.009; group.add(sheen);
  }
  if (group.children.length) scene.add(group);
  function update(dt) {
    if (disposed || !particles) return;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0; time += dt;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      positions[j + 1] -= dt * (type === 'rain' ? 15 : 1.1 + (i % 5) * 0.12);
      positions[j] += dt * (type === 'rain' ? 2.3 : Math.sin(time + i) * 0.6);
      if (positions[j + 1] < 0) positions[j + 1] += 14;
      if (positions[j] > PITCH.HL) positions[j] -= PITCH.L;
      if (positions[j] < -PITCH.HL) positions[j] += PITCH.L;
      dummy.position.fromArray(positions, j); dummy.rotation.set(0, (i % 4) * Math.PI / 4, type === 'rain' ? -0.15 : time * 0.2 + i);
      dummy.scale.set(type === 'rain' ? 0.025 : 0.1, type === 'rain' ? 0.8 : 0.1, 1);
      dummy.updateMatrix(); particles.setMatrixAt(i, dummy.matrix);
    }
    particles.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { type, count: n, update, dispose() {
    if (disposed) return; disposed = true; scene.remove(group);
    particles?.dispose(); geometry?.dispose(); material?.dispose();
    sheen?.geometry.dispose(); sheen?.material.dispose();
  } };
}
