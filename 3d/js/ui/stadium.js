// Procedural "blurred stadium" menu backdrop. Painted ONCE into a tiny canvas (≈320×180), blurred in-canvas,
// then stretched to cover the screen by CSS — no images, no animation, no backdrop-filter, so it costs nothing
// per frame on a Chromebook. Floodlights, two tiers of crowd, LED boards and a striped pitch in perspective.

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Paint the stadium into `canvas`.
 * opts: { seed, accent (LED board colour), night (bool), w, h }
 */
export function paintStadium(canvas, { seed = 11, accent = '#cdfb3c', night = true, w = 320, h = 180 } = {}) {
  canvas.width = w; canvas.height = h;
  const out = canvas.getContext('2d');
  if (!out) return canvas;
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const c = src.getContext('2d');
  const R = rng(seed);
  const horizon = Math.round(h * 0.52); // top of the pitch

  // sky / roof shadow
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, night ? '#05070a' : '#1a2230');
  sky.addColorStop(1, night ? '#11151b' : '#2a3342');
  c.fillStyle = sky; c.fillRect(0, 0, w, horizon);

  // two stand tiers of crowd: tiny random blocks, darker toward the roof
  const crowd = ['#2a2f37', '#343a44', '#1d2127', '#3d434e', '#4a505b', '#262a31'];
  const kit = ['#c8ccd4', '#8a1f2a', '#1f3f8a', '#d9d9d9'];
  const tiers = [[Math.round(h * 0.12), Math.round(h * 0.29)], [Math.round(h * 0.31), horizon - Math.round(h * 0.05)]];
  for (const [y0, y1] of tiers) {
    for (let y = y0; y < y1; y += 2) {
      const shade = 0.45 + 0.55 * ((y - y0) / (y1 - y0));
      for (let x = 0; x < w; x += 2) {
        const pal = R() < 0.08 ? kit : crowd;
        c.globalAlpha = shade * (0.6 + R() * 0.4);
        c.fillStyle = pal[(R() * pal.length) | 0];
        c.fillRect(x, y, 2, 2);
      }
    }
    c.globalAlpha = 1;
    c.fillStyle = '#07090c'; c.fillRect(0, y1, w, 2); // tier edge
  }
  c.fillStyle = '#040506'; c.fillRect(0, 0, w, Math.round(h * 0.1)); // roof

  // LED advertising boards along the touchline
  const by = horizon - Math.round(h * 0.05);
  const bh = Math.round(h * 0.04);
  c.fillStyle = '#0c0e12'; c.fillRect(0, by, w, bh);
  for (let x = 0; x < w;) {
    const seg = 18 + ((R() * 30) | 0);
    const lit = R();
    c.fillStyle = lit < 0.25 ? accent : lit < 0.45 ? '#e9edf2' : '#1b1f26';
    c.globalAlpha = lit < 0.45 ? 0.55 : 1;
    c.fillRect(x + 1, by + 1, seg - 2, bh - 2);
    x += seg;
  }
  c.globalAlpha = 1;

  // pitch: mown stripes converging to a vanishing point far above the screen
  const top = horizon, vx = w / 2, n = 16;
  const g1 = night ? '#1d4a2a' : '#2b6a37', g2 = night ? '#173d23' : '#23592e';
  for (let i = -n; i < n; i++) {
    const xt0 = vx + i * (w / n) * 0.9, xt1 = vx + (i + 1) * (w / n) * 0.9;
    const xb0 = vx + i * (w / n) * 2.4, xb1 = vx + (i + 1) * (w / n) * 2.4;
    c.fillStyle = i & 1 ? g1 : g2;
    c.beginPath(); c.moveTo(xt0, top); c.lineTo(xt1, top); c.lineTo(xb1, h); c.lineTo(xb0, h); c.closePath(); c.fill();
  }
  // pitch lines
  c.strokeStyle = 'rgba(235,240,245,.55)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, top + 3); c.lineTo(w, top + 3); c.stroke();
  c.beginPath(); c.moveTo(vx, top + 3); c.lineTo(vx, h); c.stroke();
  c.beginPath(); c.ellipse(vx, top + (h - top) * 0.55, w * 0.13, (h - top) * 0.22, 0, 0, Math.PI * 2); c.stroke();

  // floodlight banks: bright cores + wide bloom
  const lights = [0.08, 0.3, 0.7, 0.92];
  for (const lx of lights) {
    const x = lx * w, y = h * 0.05;
    const bloom = c.createRadialGradient(x, y, 0, x, y, w * 0.28);
    bloom.addColorStop(0, 'rgba(255,250,235,.55)');
    bloom.addColorStop(0.25, 'rgba(220,230,255,.14)');
    bloom.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = bloom; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fffdf2'; c.fillRect(x - 5, y - 1.5, 10, 3);
  }
  // light pooling on the grass
  const pool = c.createRadialGradient(vx, h * 0.8, 0, vx, h * 0.8, w * 0.6);
  pool.addColorStop(0, 'rgba(255,255,255,.10)'); pool.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = pool; c.fillRect(0, top, w, h - top);

  // blur once (Safari ignores ctx.filter and just gets the soft upscale)
  try { out.filter = 'blur(2.2px)'; } catch { /* ignore */ }
  out.drawImage(src, 0, 0);
  out.filter = 'none';
  return canvas;
}

/** Mount a full-bleed stadium backdrop into `host` (a fixed, pointer-events:none layer). Returns the canvas. */
export function mountStadium(host, opts = {}) {
  if (!host || host.querySelector('canvas.stadium-bg')) return null;
  const cv = document.createElement('canvas');
  cv.className = 'stadium-bg';
  cv.setAttribute('aria-hidden', 'true');
  try { paintStadium(cv, opts); } catch (e) { console.warn('[pitchside] stadium backdrop failed', e); return null; }
  host.prepend(cv);
  return cv;
}
