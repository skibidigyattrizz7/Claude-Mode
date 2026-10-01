import assert from 'node:assert/strict';
import { playVinsonPackCollapse, VINSON_PACK_BEATS } from '../ui/vinsonpackcollapse.js';
import { vinsonSpriteFrame, removeVinsonMatte } from '../ui/vinsonbattle.js';

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.dataset = {}; this.style = { setProperty() {} }; this.attributes = {};
    this.className = ''; this.classList = new FakeClassList(this); this.isConnected = false;
    this.animations = [];
  }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); child.updateConnected(); } }
  appendChild(child) { this.append(child); return child; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; this.updateConnected(); }
  updateConnected() { this.isConnected = !!this.parentNode?.isConnected; for (const child of this.children) child.updateConnected(); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); }
  removeAttribute(k) { delete this.attributes[k]; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  animate(frames, options) { this.animations.push({ frames, options }); return {}; }
  cloneNode(deep = false) { const e = new FakeElement(this.tagName); e.className = this.className; if (deep) for (const c of this.children) e.append(c.cloneNode(true)); return e; }
  getBoundingClientRect() { return { width: 0, height: 0, top: 0, bottom: 0 }; }
  getTotalLength() { return 100; }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(s => s.trim());
    return this.children.flatMap(child => [ ...(selectors.some(s => matches(child, s)) ? [child] : []), ...child.querySelectorAll(selector) ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { for (let e = this; e; e = e.parentNode) if (matches(e, selector)) return e; return null; }
}
class FakeClassList {
  constructor(el) { this.el = el; }
  add(...names) { const values = new Set(this.el.className.split(/\s+/).filter(Boolean)); names.forEach(n => values.add(n)); this.el.className = [...values].join(' '); }
  contains(name) { return this.el.className.split(/\s+/).includes(name); }
}
function matches(el, selector) {
  const cls = selector.match(/\.([\w-]+)/)?.[1];
  return !!cls && el.className.split(/\s+/).includes(cls);
}

class FakeClock {
  now = 0; nextId = 1; tasks = new Map();
  setTimeout(fn, delay) { const id = this.nextId++; this.tasks.set(id, { at: this.now + delay, fn }); return id; }
  clearTimeout(id) { this.tasks.delete(id); }
  advance(ms) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.tasks].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > end) break;
      this.tasks.delete(next[0]); this.now = next[1].at; next[1].fn();
    }
    this.now = end;
  }
}

function withBrowser(reducedMotion, run) {
  const saved = Object.fromEntries(['document', 'window', 'Image', 'MutationObserver', 'setTimeout', 'clearTimeout', 'getComputedStyle', 'innerHeight', 'CSS'].map(k => [k, globalThis[k]]));
  const clock = new FakeClock();
  class Observer { static instances = []; constructor(fn) { this.fn = fn; this.disconnected = false; Observer.instances.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  class FakeImage extends FakeElement { constructor() { super('img'); } set src(v) { this._src = v; } get src() { return this._src; } }
  const body = new FakeElement('body'); body.isConnected = true;
  const head = new FakeElement('head'); head.isConnected = true;
  const document = {
    body, head, hidden: false,
    createElement: tag => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    querySelector: selector => head.querySelector(selector),
  };
  globalThis.document = document; globalThis.window = {};
  globalThis.Image = FakeImage; globalThis.MutationObserver = Observer;
  globalThis.setTimeout = clock.setTimeout.bind(clock); globalThis.clearTimeout = clock.clearTimeout.bind(clock);
  globalThis.getComputedStyle = () => ({ background: 'black', length: 0, getPropertyValue: () => '' });
  globalThis.innerHeight = 900; globalThis.CSS = { supports: () => true };
  try { run({ body, head, document, clock, Observer }); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
}
function setupStage(body) {
  const overlay = new FakeElement('section'); overlay.className = 'pm-po'; body.append(overlay);
  const stage = new FakeElement('div'); overlay.append(stage);
  return { overlay, stage };
}

withBrowser(false, ({ body, clock, Observer }) => {
  const { stage } = setupStage(body); let exits = 0;
  const controller = playVinsonPackCollapse(stage, { reducedMotion: false, onExit: () => exits++ });
  const layer = body.querySelector('.vinson-pack-collapse');
  assert.ok(layer, 'collapse overlay is mounted');
  for (const beat of VINSON_PACK_BEATS.filter(b => b.action === 'punch')) {
    clock.advance(beat.at - clock.now);
    assert.equal(layer.dataset.hit, String(beat.hit), `hit ${beat.hit} executes at its scheduled beat`);
  }
  assert.equal(layer.querySelectorAll('.vinson-crack-leak').length > 0, true, 'late impacts add blood leaks');
  clock.advance(19200 - clock.now);
  assert.ok(layer.classList.contains('is-reaching'), 'the hand reach beat runs');
  const hand = layer.querySelector('.vinson-screen-hand');
  assert.equal(hand.querySelectorAll('.vinson-hand-finger').length, 5);
  assert.equal(hand.animations.length, 1, 'hand gets its reach animation');
  assert.ok(hand.querySelectorAll('.vinson-hand-finger').every(f => f.animations.length === 1), 'each finger gets a grip animation');
  clock.advance(22700 - clock.now);
  assert.equal(exits, 1, 'scheduled exit invokes callback once');
  assert.equal(layer.isConnected, false, 'scheduled exit removes the overlay');
  controller.cancel();
  assert.equal(exits, 1, 'cancel after exit remains idempotent');
  assert.equal(Observer.instances[0].disconnected, true);
  assert.equal(clock.tasks.size, 0, 'all scheduled timers are cleared at exit');
});

withBrowser(true, ({ body, clock, Observer }) => {
  const { stage } = setupStage(body); let exits = 0;
  const controller = playVinsonPackCollapse(stage, { reducedMotion: true, onExit: () => exits++ });
  const layer = body.querySelector('.vinson-pack-collapse');
  clock.advance(19200);
  const hand = layer.querySelector('.vinson-screen-hand');
  assert.equal(hand.style.opacity, '1', 'reduced motion keeps the hand visible as a static illustration');
  assert.equal(hand.style.transform, 'translate(-50%,4%) scale(.85)');
  assert.equal(hand.animations.length, 0, 'reduced motion skips the hand animation');
  assert.ok(hand.querySelectorAll('.vinson-hand-finger').every(f => f.animations.length === 0), 'reduced motion skips finger animation');
  controller.cancel(); controller.cancel();
  assert.equal(exits, 0, 'cancel does not call the exit callback');
  assert.equal(layer.isConnected, false, 'cancel removes the overlay');
  assert.equal(clock.tasks.size, 0, 'cancel clears every outstanding timer');
  assert.equal(Observer.instances[0].disconnected, true, 'cancel disconnects the DOM observer');
});

for (const [key, sourceWidth, sourceHeight, expected] of [
  ['world', 1200, 800, [276, 0, 600, 784, 292, 240]],
  ['patel', 1000, 1000, [0, 230, 1000, 770, 260, 250]],
  ['phonk', 800, 1200, [0, 0, 800, 1200, 230, 240]],
  ['captain', 640, 640, [0, 0, 640, 640, 260, 190]],
]) {
  const frame = vinsonSpriteFrame(key, sourceWidth, sourceHeight);
  assert.deepEqual([frame.sx, frame.sy, frame.sw, frame.sh, frame.width, frame.height], expected, `${key} crop uses expected source bounds and destination frame`);
  assert.ok(frame.sx >= 0 && frame.sy >= 0 && frame.sw > 0 && frame.sh > 0);
  assert.ok(frame.sx + frame.sw <= sourceWidth && frame.sy + frame.sh <= sourceHeight, `${key} crop stays within source image`);
  assert.ok(frame.dw <= frame.width + 1e-9 && frame.dh <= frame.height + 1e-9, `${key} image aspect fits its destination frame`);
  assert.ok(Math.abs(frame.dw / frame.dh - frame.sw / frame.sh) < 1e-9, `${key} preserves source crop aspect ratio`);
}
function rgbaGrid(rows) {
  const data = new Uint8ClampedArray(rows.length * rows[0].length * 4);
  rows.forEach((row, y) => [...row].forEach((cell, x) => {
    const color = cell === 'w' ? [255, 255, 255] : cell === 'n' ? [225, 230, 235] : [20, 25, 30];
    const i = (y * row.length + x) * 4; data.set([...color, 255], i);
  }));
  return data;
}
const whiteCenter = rgbaGrid(['wwwww', 'w...w', 'w.w.w', 'w...w', 'wwwww']);
removeVinsonMatte(whiteCenter, 5, 5);
assert.equal(whiteCenter[(0 * 5 + 0) * 4 + 3], 0, 'outside connected white matte becomes transparent');
assert.equal(whiteCenter[(2 * 5 + 2) * 4 + 3], 255, 'interior white detail remains opaque');
const darkBorder = rgbaGrid(['.....', '.nnn.', '.n.n.', '.nnn.', '.....']);
removeVinsonMatte(darkBorder, 5, 5);
assert.ok([...Array(25)].every((_, i) => darkBorder[i * 4 + 3] === 255), 'dark and near-white interior details remain opaque when the border is dark');
console.log('Vinson collapse lifecycle and sprite frame regressions passed');
