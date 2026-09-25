// Stadium: two-tier stands, roofs, billboard crowd (instanced), LED boards, dugouts, floodlights, sky.
import * as THREE from '../../../vendor/three.module.min.js';
import { PITCH } from '../core/constants.js';
import { adStripTexture, skyTexture, makeCanvas, canvasTex, radialTexture } from './textures.js';

const HL = PITCH.HL, HW = PITCH.HW;
// stand placement (front edge distance)
const SIDE_Z = HW + 9;      // 43
const END_X = HL + 11;      // 63.5
// profile (local d = distance from stand front, y up)
const LOW = { d0: 0.3, y0: 1.3, rows: 20, dep: 0.78, rise: 0.38 };
const UP = { d0: 12.5, y0: 11.4, rows: 22, dep: 0.8, rise: 0.55 };
const LOW_END = { d: LOW.d0 + LOW.rows * LOW.dep, y: LOW.y0 + LOW.rows * LOW.rise };
const UP_END = { d: UP.d0 + UP.rows * UP.dep, y: UP.y0 + UP.rows * UP.rise };
const ROOF = { front: 3.5, back: UP_END.d + 2.5, yF: 30.5, yB: 28.5 };
const SIDE_LEN = 2 * (END_X + ROOF.back); // side stands run the full length incl. corners
const END_LEN = 2 * (SIDE_Z + ROOF.back); // ends also run into the corners (mitred bowl)

function lerp(a, b, t) { return a + (b - a) * t; }

// stepped seating deck with vertex colours
function stepsGeometry(len, prof, cTread, cRiser) {
  const pos = [], col = [], nor = [], idx = [];
  const quad = (p0, p1, p2, p3, n, c) => {
    const b = pos.length / 3;
    for (const p of [p0, p1, p2, p3]) { pos.push(...p); nor.push(...n); col.push(...c); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const x0 = -len / 2, x1 = len / 2;
  for (let r = 0; r < prof.rows; r++) {
    const d = prof.d0 + r * prof.dep, y = prof.y0 + r * prof.rise;
    const shade = 0.9 + 0.1 * ((r * 7919) % 5) / 5;
    const ct = cTread.map((c) => c * shade);
    // riser (vertical face toward pitch = -d)
    quad([x0, y - prof.rise, d], [x1, y - prof.rise, d], [x1, y, d], [x0, y, d], [0, 0, -1], cRiser);
    // tread
    quad([x0, y, d], [x1, y, d], [x1, y, d + prof.dep], [x0, y, d + prof.dep], [0, 1, 0], ct);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function quadGeo(p0, p1, p2, p3) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p3], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- crowd billboard atlas
const COLS = 8;
function crowdAtlas() {
  const CW = 64, CH = 128, W = CW * COLS, H = CH * 2;
  const cv = makeCanvas(W, H), g = cv.getContext('2d');
  const skins = ['#f1c7a5', '#d9a47f', '#b27a52', '#8a5634', '#5e3a22', '#e8b894', '#c68863', '#f5d0b5'];
  const hairs = ['#1b1210', '#3a2616', '#6b4a2e', '#c9a063', '#111', '#7a2e1a', '#555', '#2b1c14'];
  const SH = '#ff00ff';
  for (let row = 0; row < 2; row++) {
    for (let c = 0; c < COLS; c++) {
      const ox = c * CW, oy = row * CH;
      const wide = 0.85 + (c % 3) * 0.08;
      const cx = ox + CW / 2;
      // torso (shirt)
      g.fillStyle = SH;
      const tw = 34 * wide, th = 46;
      const ty = oy + 50;
      g.beginPath();
      g.moveTo(cx - tw / 2, ty + th); g.lineTo(cx - tw / 2, ty + 8); g.quadraticCurveTo(cx - tw / 2, ty, cx - tw / 2 + 8, ty);
      g.lineTo(cx + tw / 2 - 8, ty); g.quadraticCurveTo(cx + tw / 2, ty, cx + tw / 2, ty + 8); g.lineTo(cx + tw / 2, ty + th); g.closePath(); g.fill();
      // scarf on some
      if (c % 4 === 1) { g.fillStyle = '#ffffff'; g.fillRect(cx - 9, ty + 1, 18, 5); }
      // shading on shirt (keep magenta hue, darker)
      g.fillStyle = 'rgba(128,0,128,0.35)'; g.fillRect(cx - tw / 2, ty + th - 10, tw, 10);
      // legs (dark, mostly hidden by next row)
      g.fillStyle = ['#1d2433', '#2e2e2e', '#3b4a63', '#4a3a2a'][c % 4];
      g.fillRect(cx - tw / 2 + 2, ty + th, tw - 4, 26);
      // arms
      const skin = skins[c], hair = hairs[(c * 3) % 8];
      if (row === 0) {
        g.fillStyle = SH; g.fillRect(cx - tw / 2 - 7, ty + 4, 8, 22); g.fillRect(cx + tw / 2 - 1, ty + 4, 8, 22);
        g.fillStyle = skin; g.fillRect(cx - tw / 2 - 7, ty + 26, 7, 14); g.fillRect(cx + tw / 2, ty + 26, 7, 14);
      } else {
        g.fillStyle = SH; g.fillRect(cx - tw / 2 - 6, ty - 18, 8, 24); g.fillRect(cx + tw / 2 - 2, ty - 18, 8, 24);
        g.fillStyle = skin; g.fillRect(cx - tw / 2 - 6, ty - 36, 7, 19); g.fillRect(cx + tw / 2 - 1, ty - 36, 7, 19);
        g.beginPath(); g.arc(cx - tw / 2 - 2.5, ty - 38, 5, 0, 7); g.arc(cx + tw / 2 + 2.5, ty - 38, 5, 0, 7); g.fill();
      }
      // head
      g.fillStyle = skin; g.beginPath(); g.ellipse(cx, ty - 12, 11, 13, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = hair;
      if (c % 5 === 2) { g.fillStyle = SH; g.beginPath(); g.ellipse(cx, ty - 20, 12, 8, 0, Math.PI, 0); g.fill(); g.fillRect(cx - 12, ty - 21, 24, 4); } // cap in team colour
      else { g.beginPath(); g.ellipse(cx, ty - 18, 11.5, 8 + (c % 3) * 2, 0, Math.PI, 0); g.fill(); }
    }
  }
  const t = canvasTex(cv, {});
  return t;
}

const crowdVS = /* glsl */`
attribute float aPhase;
attribute float aTeam;
attribute float aVar;
uniform float uTime;
uniform vec3 uExcite;
uniform float uCols;
varying vec2 vUv;
varying vec3 vCol;
varying float vShade;
varying float vUp;
void main() {
  float ex = aTeam < 0.5 ? uExcite.x : (aTeam < 1.5 ? uExcite.y : uExcite.z);
  float ph = aPhase * 6.2831;
  float up = step(0.55, ex * (0.6 + 0.4 * fract(aPhase * 13.7)));
  // gentle bob, plus jumping when excited
  float bob = sin(uTime * 1.7 + ph) * 0.025 + ex * max(0.0, sin(uTime * (7.0 + fract(aPhase * 5.3) * 3.0) + ph)) * 0.42;
  vec4 wc = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  wc.y += bob;
  float sc = length(instanceMatrix[0].xyz);
  vec4 mv = viewMatrix * wc;
  mv.xy += position.xy * sc;
  gl_Position = projectionMatrix * mv;
  float col = floor(aVar);
  vUv = vec2((col + uv.x) / uCols, (uv.y + (1.0 - up)) * 0.5);
  vCol = instanceColor;
  vShade = 0.78 + 0.22 * fract(aPhase * 31.1);
  vUp = up;
}`;
const crowdFS = /* glsl */`
uniform sampler2D uMap;
uniform float uLight;
uniform vec3 uTint;
varying vec2 vUv;
varying vec3 vCol;
varying float vShade;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.45) discard;
  float m = clamp((min(t.r, t.b) - t.g) * 2.5, 0.0, 1.0);
  vec3 c = mix(t.rgb, vCol * (0.55 + 0.45 * t.r), m);
  gl_FragColor = vec4(c * vShade * uLight * uTint, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- build
export function buildStadium(scene, opts, q, track) {
  const night = opts.stadium === 'night';
  const group = new THREE.Group();
  scene.add(group);
  const stdMat = (c, o = {}) => { const m = track(new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05, ...o })); if (night) m.color.multiplyScalar(0.55); return m; };
  const concrete = stdMat(0x8d9096);
  const darkM = stdMat(0x1a1d24);
  const roofTop = stdMat(0xb8bcc2, { metalness: 0.3, roughness: 0.6 });
  const roofUnder = stdMat(0x5c6068, { side: THREE.DoubleSide });
  const seatsMat = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, color: night ? 0x777777 : 0xffffff }));
  const steelM = stdMat(0x9aa1ab, { metalness: 0.6, roughness: 0.4 });
  const home = opts.home?.kit?.primary || '#c00';
  const away = opts.away?.kit?.primary || '#00c';
  const cHome = new THREE.Color(home), cAway = new THREE.Color(away);
  const seatBase = new THREE.Color(0x1f3563);
  const riser = [0.35, 0.36, 0.38];
  const stands = [];
  const defs = [
    { name: 'near', pos: [0, 0, SIDE_Z], rot: 0, len: SIDE_LEN },
    { name: 'far', pos: [0, 0, -SIDE_Z], rot: Math.PI, len: SIDE_LEN },
    { name: 'endR', pos: [END_X, 0, 0], rot: Math.PI / 2, len: END_LEN },
    { name: 'endL', pos: [-END_X, 0, 0], rot: -Math.PI / 2, len: END_LEN },
  ];
  const fasciaTex = track(adStripTexture(3, 512, 64, 8));
  const fasciaMat = track(new THREE.MeshBasicMaterial({ map: fasciaTex, toneMapped: false, color: night ? 0xffffff : 0xdddddd }));
  const roofLightMat = track(new THREE.MeshBasicMaterial({ color: night ? 0xfff6e0 : 0x9aa0a8, toneMapped: !night }));
  const tread = [seatBase.r, seatBase.g, seatBase.b];
  const lowG = track(stepsGeometry(1, LOW, tread, riser));
  const upG = track(stepsGeometry(1, UP, tread, riser));
  for (const d of defs) {
    const s = new THREE.Group();
    s.position.set(...d.pos); s.rotation.y = d.rot;
    const L = d.len;
    // seating decks (unit length geometry scaled along x)
    const low = new THREE.Mesh(lowG, seatsMat); low.scale.x = L; low.receiveShadow = q.shadows; s.add(low);
    const up = new THREE.Mesh(upG, seatsMat); up.scale.x = L; up.receiveShadow = q.shadows; s.add(up);
    // front wall
    const fw = new THREE.Mesh(track(new THREE.BoxGeometry(L, LOW.y0, 0.3)), darkM); fw.position.set(0, LOW.y0 / 2 - LOW.rise / 2, 0.15); s.add(fw);
    // concourse back wall between tiers
    const cw = new THREE.Mesh(track(new THREE.BoxGeometry(L, UP.y0 - LOW_END.y, 0.4)), darkM); cw.position.set(0, (UP.y0 + LOW_END.y) / 2 - 1, LOW_END.d); s.add(cw);
    // upper tier fascia (LED ribbon)
    const fz = UP.d0 - 0.3;
    const fas = new THREE.Mesh(track(new THREE.PlaneGeometry(L, 1.5)), fasciaMat); fas.rotation.y = Math.PI; fas.position.set(0, UP.y0 - UP.rise - 0.8, fz - 0.01);
    const fTex = fasciaTex; fTex.repeat.set(SIDE_LEN / 60, 1);
    s.add(fas);
    const fasBack = new THREE.Mesh(track(new THREE.BoxGeometry(L, 2.2, 0.3)), darkM); fasBack.position.set(0, UP.y0 - UP.rise - 0.9, fz + 0.16); s.add(fasBack);
    // soffit under upper tier
    const sof = new THREE.Mesh(track(quadGeo([-L / 2, UP.y0 - 2.0, UP.d0], [L / 2, UP.y0 - 2.0, UP.d0], [L / 2, UP_END.y - 3, UP_END.d], [-L / 2, UP_END.y - 3, UP_END.d])), roofUnder);
    s.add(sof);
    // rear wall + outer wall
    const rh = ROOF.yB - UP_END.y + 1;
    const rw = new THREE.Mesh(track(new THREE.BoxGeometry(L, rh, 0.5)), concrete); rw.position.set(0, UP_END.y + rh / 2 - 1, UP_END.d + 0.25); s.add(rw);
    const ow = new THREE.Mesh(track(new THREE.BoxGeometry(L, ROOF.yB, 0.5)), concrete); ow.position.set(0, ROOF.yB / 2, ROOF.back - 0.3); s.add(ow);
    // roof: sloping slab
    const rdep = ROOF.back - ROOF.front;
    const roofG = track(new THREE.BoxGeometry(L, 0.7, Math.hypot(rdep, ROOF.yF - ROOF.yB)));
    const roof = new THREE.Mesh(roofG, [roofTop, roofTop, roofTop, roofUnder, roofTop, roofTop]);
    roof.position.set(0, (ROOF.yF + ROOF.yB) / 2, (ROOF.front + ROOF.back) / 2);
    roof.rotation.x = Math.atan2(ROOF.yF - ROOF.yB, rdep);
    roof.castShadow = q.roofShadow; roof.receiveShadow = false;
    s.add(roof);
    // roof front edge: truss + light strip
    const edge = new THREE.Mesh(track(new THREE.BoxGeometry(L, 1.8, 0.6)), steelM); edge.position.set(0, ROOF.yF - 0.2, ROOF.front); s.add(edge);
    const strip = new THREE.Mesh(track(new THREE.PlaneGeometry(L - 4, 0.5)), roofLightMat); strip.rotation.x = Math.PI / 2; strip.position.set(0, ROOF.yF - 1.15, ROOF.front + 0.6); s.add(strip);
    group.add(s);
    stands.push({ ...d, group: s });
  }

  // ---------------- crowd
  const atlas = track(crowdAtlas());
  const cmat = track(new THREE.ShaderMaterial({
    vertexShader: crowdVS, fragmentShader: crowdFS,
    uniforms: {
      uMap: { value: atlas }, uTime: { value: 0 }, uExcite: { value: new THREE.Vector3(0, 0, 0) }, uCols: { value: COLS },
      uLight: { value: night ? 0.42 : 0.95 }, uTint: { value: night ? new THREE.Color(0.95, 0.97, 1.05) : new THREE.Color(1.0, 0.98, 0.94) },
    },
  }));
  const cgeo = track(new THREE.PlaneGeometry(0.62, 1.24));
  cgeo.translate(0, 0.62, 0);
  const neutral = ['#1b1b1b', '#e9e9e9', '#26324a', '#5a5a5a', '#7a6a55', '#2f4f2f', '#8b1a1a', '#d8c9a8'].map((c) => new THREE.Color(c));
  const crowds = [];
  const rnd = mulberry(1234);
  const tmpM = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();
  for (const st of stands) {
    const L = st.len;
    const items = [];
    for (const prof of [LOW, UP]) {
      for (let r = 0; r < prof.rows; r++) {
        const y = prof.y0 + r * prof.rise;
        const d = prof.d0 + r * prof.dep + 0.3;
        for (let x = -L / 2 + 0.6; x < L / 2 - 0.6; x += q.crowdSpacing) {
          if (rnd() > q.crowdFill) continue;
          // skip seats behind corners that are hidden by end stands
          // corner overlap: keep the fan only if this stand's surface is the visible (higher) one here
          const other = st.name === 'near' || st.name === 'far' ? Math.abs(x) - END_X : Math.abs(x) - SIDE_Z;
          if (other > -0.5 && d < other) continue;
          items.push([x + (rnd() - 0.5) * 0.15, y - 0.1, d]);
        }
      }
    }
    const n = items.length;
    const inst = new THREE.InstancedMesh(cgeo, cmat, n);
    inst.frustumCulled = true;
    const ph = new Float32Array(n), tm = new Float32Array(n), vr = new Float32Array(n);
    const cosR = Math.cos(st.rot), sinR = Math.sin(st.rot);
    for (let i = 0; i < n; i++) {
      const [lx, ly, ld] = items[i];
      // world position of local (lx, ly, ld)
      const wx = st.pos[0] + lx * cosR + ld * sinR;
      const wz = st.pos[2] - lx * sinR + ld * cosR;
      const sc = 0.92 + rnd() * 0.16;
      tmpV.set(wx, ly, wz); tmpS.set(sc, sc, sc);
      tmpM.compose(tmpV, tmpQ, tmpS);
      inst.setMatrixAt(i, tmpM);
      // allegiance by end: home fans toward x<0 end, away toward x>0
      const bias = wx < 0 ? 0.72 : 0.28;
      const r1 = rnd();
      let team;
      if (r1 < 0.84) team = rnd() < bias ? 0 : 1; else team = 2;
      if (team === 0) tmpC.copy(rnd() < 0.8 ? cHome : new THREE.Color(opts.home?.kit?.secondary || '#fff'));
      else if (team === 1) tmpC.copy(rnd() < 0.8 ? cAway : new THREE.Color(opts.away?.kit?.secondary || '#fff'));
      else tmpC.copy(neutral[Math.floor(rnd() * neutral.length)]);
      tmpC.multiplyScalar(0.8 + rnd() * 0.3);
      inst.setColorAt(i, tmpC);
      ph[i] = rnd(); tm[i] = team; vr[i] = Math.floor(rnd() * COLS);
    }
    cgeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    const g2 = cgeo.clone(); track(g2);
    g2.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    g2.setAttribute('aTeam', new THREE.InstancedBufferAttribute(tm, 1));
    g2.setAttribute('aVar', new THREE.InstancedBufferAttribute(vr, 1));
    inst.geometry = g2;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
    crowds.push(inst);
  }

  // ---------------- LED boards
  const boardTex = track(adStripTexture(0, 512, 64, 8));
  const boardTex2 = track(adStripTexture(5, 512, 64, 8));
  const boardMat = track(new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false, color: night ? 0xffffff : 0xe8e8e8 }));
  const boardMat2 = track(new THREE.MeshBasicMaterial({ map: boardTex2, toneMapped: false, color: night ? 0xffffff : 0xe8e8e8 }));
  const boardBack = stdMat(0x15181e);
  const BH = 0.95;
  const STRIP_M = 8 * 7.3; // world metres per strip texture repeat
  const boards = [];
  const addBoard = (x0, z0, x1, z1, mat) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.Group();
    const face = new THREE.Mesh(track(new THREE.PlaneGeometry(len, BH)), mat);
    // uv scale per board for consistent panel size
    const uv = face.geometry.attributes.uv;
    const off = (x0 + z0) / STRIP_M;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / STRIP_M + off);
    face.position.y = BH / 2 + 0.02;
    g.add(face);
    const back = new THREE.Mesh(track(new THREE.BoxGeometry(len, BH + 0.04, 0.25)), boardBack);
    back.position.set(0, BH / 2 + 0.02, -0.14);
    back.castShadow = q.shadows; back.receiveShadow = q.shadows;
    g.add(back);
    // brace
    const br = new THREE.Mesh(track(new THREE.BoxGeometry(len, 0.08, 0.7)), boardBack); br.position.set(0, 0.04, -0.5); g.add(br);
    g.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    // orient face normal toward pitch centre
    const ang = Math.atan2(x1 - x0, z1 - z0); // direction along board
    g.rotation.y = ang - Math.PI / 2;
    // ensure the face points toward the pitch centre
    const nrm = new THREE.Vector3(0, 0, 1).applyEuler(g.rotation);
    if (nrm.x * -g.position.x + nrm.z * -g.position.z < 0) g.rotation.y += Math.PI;
    group.add(g);
    boards.push(g);
  };
  const BZ = HW + 4.2, BX = HL + 5.2;
  addBoard(-HL - 1, -BZ, HL + 1, -BZ, boardMat);             // far side
  addBoard(-HL - 1, BZ, -15, BZ, boardMat);                  // near side (gap for dugouts)
  addBoard(15, BZ, HL + 1, BZ, boardMat);
  for (const s of [-1, 1]) {
    addBoard(s * BX, -BZ + 3, s * BX, -6, boardMat2);
    addBoard(s * BX, 6, s * BX, BZ - 3, boardMat2);
    addBoard(s * BX, -5.2, s * BX, 5.2, boardMat2);
    // angled corner boards
    addBoard(s * (HL + 1), -BZ, s * BX, -BZ + 3, boardMat2);
    addBoard(s * (HL + 1), BZ, s * BX, BZ - 3, boardMat2);
  }

  // ---------------- dugouts & tunnel
  const glass = track(new THREE.MeshStandardMaterial({ color: 0x9fc4dd, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }));
  const benchM = stdMat(0x1c3f8c);
  const dugBase = stdMat(0x2a2d33);
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const L = 9;
    const floor = new THREE.Mesh(track(new THREE.BoxGeometry(L, 0.2, 2.8)), dugBase); floor.position.set(0, 0.1, 0); g.add(floor);
    const back = new THREE.Mesh(track(new THREE.BoxGeometry(L, 2.2, 0.15)), dugBase); back.position.set(0, 1.1, 1.35); g.add(back);
    const cano = new THREE.Mesh(track(new THREE.CylinderGeometry(2.4, 2.4, L, 20, 1, true, 0, Math.PI / 2)), glass);
    cano.rotation.z = Math.PI / 2; cano.rotation.x = 0; cano.position.set(0, 0.0, 1.35 - 0.02);
    cano.rotation.set(0, 0, Math.PI / 2);
    cano.rotateY(Math.PI);
    g.add(cano);
    const seats = new THREE.Mesh(track(new THREE.BoxGeometry(L - 0.6, 0.5, 0.6)), benchM); seats.position.set(0, 0.45, 0.9); g.add(seats);
    const sback = new THREE.Mesh(track(new THREE.BoxGeometry(L - 0.6, 0.7, 0.12)), benchM); sback.position.set(0, 0.9, 1.2); g.add(sback);
    for (const e of [-1, 1]) { const w = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 2.2, 2.6)), glass); w.position.set(e * L / 2, 1.1, 0.1); g.add(w); }
    g.position.set(s * 9.5, 0, HW + 5.6);
    group.add(g);
  }
  const tunnel = new THREE.Mesh(track(new THREE.BoxGeometry(5, 2.8, 3)), darkM); tunnel.position.set(0, 1.4, SIDE_Z - 1.2); group.add(tunnel);

  // ---------------- floodlight towers
  const lampCv = makeCanvas(128, 64), lg = lampCv.getContext('2d');
  lg.fillStyle = '#222'; lg.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
    const gr = lg.createRadialGradient(8 + i * 16, 8 + j * 16, 1, 8 + i * 16, 8 + j * 16, 7);
    gr.addColorStop(0, night ? '#ffffff' : '#d8dde2'); gr.addColorStop(1, night ? '#b8c8ff' : '#6d737b');
    lg.fillStyle = gr; lg.beginPath(); lg.arc(8 + i * 16, 8 + j * 16, 6.5, 0, 7); lg.fill();
  }
  const lampTex = track(canvasTex(lampCv, {}));
  const lampMat = track(new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: !night, color: night ? 0xffffff : 0xcccccc }));
  const towerMat = stdMat(0x7d838c, { metalness: 0.5, roughness: 0.5 });
  const towers = [];
  const glowTex = track(radialTexture('rgba(255,250,235,0.95)', 'rgba(255,240,210,0)', 128));
  const glowMat = track(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: night ? 0.9 : 0 }));
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    const x = xs * (END_X + 22), z = zs * (SIDE_Z + 22);
    const Ht = 58;
    const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.7, 1.3, Ht, 10)), towerMat);
    pole.position.set(x, Ht / 2, z); group.add(pole);
    const head = new THREE.Group();
    head.position.set(x, Ht + 2.5, z);
    head.lookAt(0, 0, 0);
    const panel = new THREE.Mesh(track(new THREE.BoxGeometry(11, 6, 0.6)), towerMat); head.add(panel);
    const face = new THREE.Mesh(track(new THREE.PlaneGeometry(10.4, 5.4)), lampMat); face.position.z = 0.31; head.add(face);
    group.add(head);
    if (night) {
      const glow = new THREE.Sprite(glowMat); glow.scale.set(34, 22, 1); glow.position.copy(head.position).multiplyScalar(0.985); group.add(glow);
    }
    towers.push(new THREE.Vector3(x, Ht + 2.5, z));
  }

  // ---------------- sky
  const skyT = track(skyTexture(night));
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(1400, 32, 16)), track(new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, depthWrite: false, fog: false })));
  sky.renderOrder = -10;
  group.add(sky);
  if (night) {
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = rnd() * Math.PI * 2, ph = 0.12 + rnd() * 1.2;
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * 1300; pos[i * 3 + 1] = Math.sin(ph) * 1300; pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * 1300;
    }
    const sg = track(new THREE.BufferGeometry()); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, track(new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false })));
    group.add(stars);
  }
  // distant skyline ring (day & night) — low boxes beyond stands
  {
    const bm = stdMat(night ? 0x0c0f16 : 0x8793a0, { roughness: 1 });
    const bg = track(new THREE.BoxGeometry(1, 1, 1));
    const cnt = 90;
    const inst = new THREE.InstancedMesh(bg, bm, cnt);
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * Math.PI * 2 + rnd() * 0.05;
      const r = 330 + rnd() * 160;
      const h = 15 + rnd() * 60, w = 20 + rnd() * 30;
      tmpM.compose(tmpV.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r), tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a), tmpS.set(w, h, w * 0.8));
      inst.setMatrixAt(i, tmpM);
    }
    group.add(inst);
  }

  let scroll = 0;
  return {
    group, towers, crowds, crowdMat: cmat,
    update(t, dt, excite) {
      cmat.uniforms.uTime.value = t;
      cmat.uniforms.uExcite.value.set(excite[0], excite[1], excite[2]);
      scroll += dt * 0.035;
      boardTex.offset.x = scroll;
      boardTex2.offset.x = -scroll * 1.2;
      fasciaTex.offset.x = scroll * 0.6;
    },
  };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STADIUM_DIMS = { SIDE_Z, END_X, LOW, UP, ROOF };
