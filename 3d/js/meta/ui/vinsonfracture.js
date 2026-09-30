// Break the visible DOM itself into glass fragments. No substitute artwork or captions.
export function fracturePolygons(width, height, impact = { x: .46, y: .43 }) {
  if (!(width > 0 && height > 0)) return [];
  const clamp = (n) => Math.max(.04, Math.min(.96, n));
  const points = [[.12, .14], [.49, .06], [.91, .2], [.79, .58], [.9, .91], [.43, .86], [.07, .74], [.24, .42], [clamp(impact.x), clamp(impact.y)]];
  const seeds = points.map(([x, y]) => ({ x: x * width, y: y * height }))
    .filter((p, i, all) => all.slice(0, i).every((q) => Math.hypot(p.x - q.x, p.y - q.y) > .01));
  return seeds.map((a) => {
    let polygon = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
    for (const b of seeds) {
      if (a === b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const limit = (b.x * b.x + b.y * b.y - a.x * a.x - a.y * a.y) / 2;
      const distance = (p) => p.x * dx + p.y * dy - limit;
      const clipped = [];
      for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i], q = polygon[(i + 1) % polygon.length];
        const dp = distance(p), dq = distance(q);
        if (dp <= 0) clipped.push(p);
        if ((dp <= 0) !== (dq <= 0)) {
          const t = dp / (dp - dq);
          clipped.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
        }
      }
      polygon = clipped;
    }
    return polygon;
  }).filter((polygon) => polygon.length >= 3);
}

let fractureId = 0;
function localIds(root, suffix) {
  const nodes = [root, ...root.querySelectorAll('*')];
  const ids = new Map();
  for (const node of nodes) if (node.id) { const previous = node.id; node.id = `${previous}-${suffix}`; ids.set(previous, node.id); }
  for (const node of nodes) for (const attr of [...node.attributes]) {
    if (/^on/i.test(attr.name)) { node.removeAttribute(attr.name); continue; }
    let value = attr.value;
    if (value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
    value = value.replace(/url\((["']?)([^)'"\s]+)\1\)/g, (whole, quote, url) => {
      const id = url.slice(url.lastIndexOf('#') + 1);
      return url.includes('#') && ids.has(id) ? `url("#${ids.get(id)}")` : whole;
    });
    if (value !== attr.value) node.setAttribute(attr.name, value);
  }
}

function snapshot(target, bounds) {
  const copy = target.cloneNode(true);
  const originals = [target, ...target.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  originals.forEach((source, i) => {
    const clone = copies[i], css = getComputedStyle(source);
    clone.removeAttribute('autofocus');
    for (let index = 0; index < css.length; index++) {
      const property = css[index];
      clone.style.setProperty(property, css.getPropertyValue(property));
    }
    clone.style.setProperty('animation', 'none', 'important');
    clone.style.setProperty('transition', 'none', 'important');
    clone.style.setProperty('pointer-events', 'none', 'important');
    if (source.tagName === 'IMG' && source.currentSrc) {
      clone.srcset = ''; clone.src = source.currentSrc;
    }
    if ('value' in source) clone.value = source.value;
    if ('checked' in source) clone.checked = source.checked;
    if (source.tagName === 'CANVAS') {
      try { clone.getContext('2d')?.drawImage(source, 0, 0); } catch { /* optional canvas layer */ }
    }
  });
  Object.assign(copy.style, { position: 'absolute', inset: '0', width: `${bounds.width}px`, height: `${bounds.height}px`,
    margin: '0', boxSizing: 'border-box', transform: 'none', visibility: 'visible', opacity: '1' });
  return copy;
}

/** Returns an effect node for lifecycle cleanup; the original control retains its normal handlers. */
export function fractureElement(target, { x, y, delay = 0 } = {}) {
  if (!target || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  const bounds = target.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  // Pack grids may contain hundreds of controls; only visible fragments need DOM copies.
  if (bounds.top >= innerHeight || bounds.top + bounds.height <= 0 ||
    bounds.left >= (globalThis.innerWidth || Infinity) || bounds.left + bounds.width <= 0) return null;
  const clamp = (n) => Math.max(.04, Math.min(.96, n));
  const impact = { x: Number.isFinite(x) ? clamp((x - bounds.left) / bounds.width) : .46,
    y: Number.isFinite(y) ? clamp((y - bounds.top) / bounds.height) : .43 };
  const effect = document.createElement('div'); effect.className = 'vinson-fracture';
  effect.setAttribute('aria-hidden', 'true'); effect.inert = true;
  Object.assign(effect.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  const frozen = snapshot(target, bounds);
  const serial = ++fractureId;
  const polygons = fracturePolygons(bounds.width, bounds.height, impact);
  for (const [i, polygon] of polygons.entries()) {
    const shard = document.createElement('div'); shard.className = 'vinson-shard';
    shard.style.clipPath = `polygon(${polygon.map((p) => `${p.x / bounds.width * 100}% ${p.y / bounds.height * 100}%`).join(',')})`;
    const cx = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
    const cy = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;
    shard.style.setProperty('--sx', `${(cx / bounds.width - impact.x) * Math.min(bounds.width, 440) * 1.2}px`);
    shard.style.setProperty('--sy', `${Math.max(300, innerHeight - bounds.top + bounds.height + 90)}px`);
    shard.style.setProperty('--kick-y', `${-12 - (i * 13 % 33)}px`);
    shard.style.setProperty('--turn', `${(i % 2 ? 1 : -1) * (17 + i * 9)}deg`);
    shard.style.transformOrigin = `${cx}px ${cy}px`;
    shard.style.animationDelay = `${delay + i % 3 * 18}ms`;
    const fragment = frozen.cloneNode(true);
    localIds(fragment, `vf${serial}-${i}`);
    // cloneNode does not copy a canvas bitmap, so transfer it from the frozen snapshot.
    const canvases = frozen.querySelectorAll('canvas');
    fragment.querySelectorAll('canvas').forEach((canvas, index) => {
      try { canvas.getContext('2d')?.drawImage(canvases[index], 0, 0); } catch { /* optional */ }
    });
    shard.append(fragment); effect.append(shard);
  }
  document.body.append(effect);
  setTimeout(() => effect.remove(), delay + 1500);
  return effect;
}
