import assert from 'node:assert/strict';
import { launchVinsonBattle, registerVinsonBattleAttempt } from '../ui/vinsonbattle.js';

class FakeElement {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map(); this.dataset = {}; this.style = {}; this.hidden = false; }
  append(...children) { for (const child of children) { this.children.push(child); child.parentNode = this; } }
  appendChild(child) { this.append(child); return child; }
  insertBefore(child, before) { const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, child); child.parentNode = this; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute() {}
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== fn)); }
  setPointerCapture() {}
  focus() { globalThis.document.activeElement = this; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tagName === tag.toUpperCase() ? [child] : []), ...child.querySelectorAll(tag)]); }
  getContext() { return null; }
}

testNoContextReturnsUsableCleanup();
const calls = [];
const api = {vinson:{status:async()=>{calls.push('status');return {ok:true,phase:'locked'};},
  battleStart:async()=>{calls.push('start');return {ok:true,nonce:'account-attempt'};}}};
assert.equal((await registerVinsonBattleAttempt(api)).nonce,'account-attempt');
assert.deepEqual(calls,['status','start'],'refresh cached ban before requesting a nonce');
api.vinson.status=async()=>({ok:false,error:'offline'});
assert.equal((await registerVinsonBattleAttempt(api)).error,'offline');
assert.equal(calls.length,2,'failed status must not register a fight');
console.log('3 Vinson battle UI tests passed');

function testNoContextReturnsUsableCleanup() {
  const oldDocument = globalThis.document;
  const oldMatchMedia = globalThis.matchMedia;
  const parent = new FakeElement('main'), head = new FakeElement('head');
  const fakeDocument = {
    body: parent, head, documentElement: { style: {} }, activeElement: null,
    createElement: tag => new FakeElement(tag), querySelector: () => null,
  };
  globalThis.document = fakeDocument; globalThis.matchMedia = () => ({ matches: false });
  let closed = 0;
  try {
    const controller = launchVinsonBattle({ parent, reducedMotion: true, onClose: () => closed++ });
    assert.ok(controller);
    assert.equal(parent.children.length, 1, 'screen should render a recoverable canvas-unavailable message');
    assert.equal(head.children.length, 1, 'battle stylesheet should load for the fallback panel');
    controller.close(); controller.close();
    assert.equal(parent.children.length, 0);
    assert.equal(head.children.length, 0);
    assert.equal(closed, 1, 'fallback close should be idempotent like the normal renderer close');
  } finally {
    globalThis.document = oldDocument; globalThis.matchMedia = oldMatchMedia;
  }
}
