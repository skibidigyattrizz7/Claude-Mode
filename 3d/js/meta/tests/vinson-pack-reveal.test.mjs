import assert from 'node:assert/strict';
class Element {
  children = []; attrs = {}; listeners = {}; style = { setProperty() {} }; dataset = {};
  constructor(tag) { this.tagName = tag; }
  get firstChild() { return this.children[0]; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  setAttribute(k,v) { this.attrs[k] = v; }
  addEventListener(k,fn) { this.listeners[k] = fn; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
const { makeGrid } = await import('../ui/packopen_common.js');
globalThis.Node = Element;
globalThis.document = { createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('#text'), { textContent: text }) };
let reveals = 0, sold = 0, sent = 0;
const opts = { onReveal: () => reveals++, sellValue: () => 0, onSend: () => sent++, onSell: () => sold++ };
const grid = makeGrid(new Element('div'), {name:'Test pack'}, [], opts, () => {});
assert.equal(reveals, 0, 'constructing the pack summary before Open must not trigger the curse');
grid.render();
assert.equal(reveals, 1, 'entering the actual revealed summary starts the curse');
grid.render();
assert.equal(reveals, 1, 'rerendering cannot reset its countdown');
assert.equal(sold, 0); assert.equal(sent, 0);
console.log('Vinson reveal timing regression passed');
