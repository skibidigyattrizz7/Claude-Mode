import assert from 'node:assert/strict';
import { fracturePolygons, fractureElement } from '../ui/vinsonfracture.js';

const area = (polygon) => Math.abs(polygon.reduce((sum, p, i) => {
  const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.y - q.x * p.y;
}, 0)) / 2;
for (const [width, height] of [[120, 32], [99, 143], [390, 844], [1, 1]]) {
  for (const impact of [{ x: .46, y: .43 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: .24, y: .42 }]) {
    const pieces = fracturePolygons(width, height, impact);
    assert.ok(pieces.length >= 8 && pieces.length <= 9);
    assert.ok(Math.abs(pieces.reduce((sum, p) => sum + area(p), 0) - width * height) < width * height * 1e-8);
    for (const polygon of pieces) for (const p of polygon) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(p.x >= -1e-8 && p.x <= width + 1e-8 && p.y >= -1e-8 && p.y <= height + 1e-8);
    }
  }
}
assert.deepEqual(fracturePolygons(0, 30), []);

// Exercise actual clone construction, including media identity and SVG references, without a browser.
class Node {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = new Map(); this.textContent = '';
    this.style = { values: new Map(), setProperty: (name, value) => this.style.values.set(name, value) };
  }
  get id() { return this.attrs.get('id') || ''; }
  set id(value) { this.attrs.set('id', value); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  append(...nodes) { this.children.push(...nodes); }
  remove() { this.removed = true; }
  querySelectorAll(selector) {
    const nodes = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? nodes : nodes.filter((node) => node.tagName.toLowerCase() === selector);
  }
  cloneNode(deep) {
    const clone = new Node(this.tagName); clone.attrs = new Map(this.attrs); clone.textContent = this.textContent;
    clone.currentSrc = this.currentSrc; clone.src = this.src; clone.srcset = this.srcset;
    if (deep) clone.children = this.children.map((node) => node.cloneNode(true));
    return clone;
  }
  getBoundingClientRect() { return { left: 20, top: 40, width: 99, height: 143 }; }
}
const old = Object.fromEntries(['document', 'getComputedStyle', 'matchMedia', 'innerHeight', 'setTimeout'].map((key) => [key, globalThis[key]]));
try {
  const body = new Node('body');
  globalThis.document = { body, createElement: (tag) => new Node(tag) };
  globalThis.innerHeight = 844;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.setTimeout = () => 0;
  globalThis.getComputedStyle = (node) => {
    const css = ['color', 'background-image', 'fill'];
    css.getPropertyValue = (name) => ({ color: 'rgb(215, 200, 155)', 'background-image': 'none', fill: node.getAttribute('fill') || 'none' }[name]);
    return css;
  };
  const pack = new Node('div'); pack.id = 'original-pack'; pack.setAttribute('onclick', 'purchase()');
  const label = new Node('span'); label.textContent = 'WINTER WILDCARDS';
  const image = new Node('img'); image.currentSrc = 'https://example.test/actual-pack.webp'; image.src = image.currentSrc;
  const svg = new Node('svg'), gradient = new Node('linearGradient'), shape = new Node('path');
  gradient.id = 'foil'; shape.setAttribute('fill', 'url("#foil")'); svg.append(gradient, shape);
  pack.append(label, image, svg);
  const effect = fractureElement(pack, { x: 60, y: 85 });
  assert.equal(effect.children.length, 9);
  assert.equal(effect.inert, true);
  assert.equal(effect.getAttribute('aria-hidden'), 'true');
  const seenIds = new Set();
  for (const shard of effect.children) {
    const content = shard.children[0];
    assert.equal(content.querySelectorAll('img')[0].src, image.currentSrc, 'each fragment retains the actual artwork');
    assert.equal(content.querySelectorAll('span')[0].textContent, label.textContent, 'labels are not replaced');
    assert.equal(content.getAttribute('onclick'), null);
    const id = content.querySelectorAll('lineargradient')[0].id;
    assert.ok(!seenIds.has(id)); seenIds.add(id);
    assert.equal(content.querySelectorAll('path')[0].getAttribute('fill'), `url("#${id}")`, 'SVG foil remains connected to its own definition');
  }
  assert.equal(pack.id, 'original-pack'); assert.equal(gradient.id, 'foil');
  globalThis.matchMedia = () => ({ matches: true });
  assert.equal(fractureElement(pack), null, 'reduced motion skips the shatter');
} finally {
  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}
console.log('Vinson actual-element fracture regression passed');
