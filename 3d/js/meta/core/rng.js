// Seeded random number generation (DOM-free).

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  /** seed: number | string | null (null => Math.random) */
  constructor(seed = null) {
    if (seed === null || seed === undefined) this.f = Math.random;
    else this.f = mulberry32(typeof seed === 'number' ? seed : hashStr(seed));
  }
  next() { return this.f(); }
  range(a, b) { return a + this.f() * (b - a); }
  int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); }
  chance(p) { return this.f() < p; }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  normal(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.f();
    while (v === 0) v = this.f();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** entries: [[item, weight], ...] */
  weighted(entries) {
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.f() * total;
    for (const e of entries) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return entries[entries.length - 1][0];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.f() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  poisson(lambda) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.f(); } while (p > L);
    return k - 1;
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
