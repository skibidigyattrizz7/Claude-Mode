// Small math helpers. DOM-free.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const hypot2 = (x, z) => Math.sqrt(x * x + z * z);
export const dist2 = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function angleTo(from, to, maxStep) {
  const d = wrapAngle(to - from);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = f();
    while (v === 0) v = f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  f.range = (a, b) => a + (b - a) * f();
  f.pick = (arr) => arr[Math.floor(f() * arr.length) % arr.length];
  return f;
}
// distance from point p to segment a-b in xz plane; returns {d, t}
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.sqrt((px - cx) ** 2 + (pz - cz) ** 2), t };
}
export const r2 = (v) => Math.round(v * 100) / 100;
export const r1 = (v) => Math.round(v * 10) / 10;
