import assert from 'node:assert/strict';
import { launchVinsonBattle } from '../ui/vinsonbattle.js';
import { startVinsonSequence } from '../core/vinsonbattle.js';

const context = new Proxy({}, { get(_target, key) {
  if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
  if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
  return () => {};
} });
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = { setProperty() {} };
    this.hidden = false; this.listeners = {}; this.className = ''; this.attributes = {};
    const classes = new Set();
    this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
  }
  get lastChild() { return this.children.at(-1); }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  insertBefore(child, before) { const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parent = this; }
  setAttribute(key, value) { this.attributes[key] = value; this[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  removeEventListener(type) { delete this.listeners[type]; }
  focus() { globalThis.document.activeElement = this; }
  setPointerCapture() {}
  getContext() { return context; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelectorAll() { return []; }
}

const saved = Object.fromEntries(['document', 'window', 'Image', 'requestAnimationFrame', 'cancelAnimationFrame', 'innerWidth', 'innerHeight', 'matchMedia', 'localStorage'].map(key => [key, globalThis[key]]));
const body = new Element('body'), head = new Element('head'), listeners = {};
const storage = new Map([['vinson-ending13-seen', '1']]);
let callback, now = 0;
globalThis.document = { body, head, hidden: false, activeElement: null, documentElement: { style: {} }, createElement: tag => new Element(tag),
  querySelector: selector => selector === '.vb-screen' ? body.children[0] || null : null,
  addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: type => { delete listeners[type]; } };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; } decode() { return Promise.resolve(); } };
globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: true });
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
const find = (node, cls) => node?.className === cls ? node : node?.children.map(child => find(child, cls)).find(Boolean);
const step = (n = 1) => { for (let i = 0; i < n; i++) { now += 17; callback(now); } };
const down = key => listeners.keydown({ key, repeat: false, preventDefault() {} });
const up = key => listeners.keyup({ key });
const tap = key => { down(key); up(key); };
const dismissDialogue = conversation => { let guard = 0; while (!conversation.hidden && guard++ < 8) conversation.onclick(); assert.ok(conversation.hidden, 'dialogue can be dismissed by click'); };
const bootFight = async () => {
  const battle = launchVinsonBattle({ reducedMotion: true });
  const screen = body.children[0], panel = find(screen, 'vb-panel'), conversation = find(screen, 'vb-dialogue');
  await panel.lastChild.children[0].onclick();
  dismissDialogue(conversation);
  return { battle, screen, conversation };
};

try {
  // The live clash cannot be skipped; J taps win it, then the finale resumes and pauses for its own dialogue.
  {
    const battle = launchVinsonBattle({ previewEnding: true, reducedMotion: true, onWin: async () => ({ ok: true, immune: true }) });
    const screen = body.children[0], conversation = find(screen, 'vb-dialogue'), skip = find(screen, 'vb-top').children.find(node => node.textContent === 'Skip ending');
    step(140);
    const pausedTime=battle.state.time;
    assert.equal(conversation.hidden,true,'dialogue follows the mash instead of duplicating before it');
    assert.equal(skip.hidden, true);
    step(80);
    assert.equal(skip.hidden, true, 'saved ending still cannot skip an active clash');
    skip.onclick(); step(1);
    assert.equal(battle.state.time, pausedTime, 'skip cannot advance the live clash or battle state');

    for (let i = 0; i < 1800 && skip.hidden; i++) {
      if (i % 8 === 0) tap('j');
      step(1);
    }
    assert.equal(skip.hidden, false, 'repeated J taps eventually win and resume the finale');
    assert.equal(battle.state.time, pausedTime, 'cinematic clash never advances the arena battle');
    const spoken=[];
    for(let i=0;i<2000&&!find(screen,'vb-panel').children.some(child=>child.textContent==='The curse is broken');i++){
      step(1);
      if(!conversation.hidden){const line=find(screen,'vb-dialogue-body').children[1].textContent;spoken.push(line);tap('j');assert.equal(conversation.hidden,false,'J never skips story dialogue');dismissDialogue(conversation);}
      await Promise.resolve();
    }
    assert.ok(spoken.some(line=>line.includes('shield cannot protect')),'original threat survives after the mash');
    assert.ok(spoken.some(line=>line.includes('everything I have')),'original resolve survives after the mash');
    assert.ok(spoken.some(line=>line.includes('Grumpy Patel')),'unmasked identity reveal survives');
    assert.ok(find(screen,'vb-panel').children.some(child=>child.textContent==='The curse is broken'));
    battle.close();
  }

  // The accessible hold-to-push route also wins the interactive finale clash.
  {
    const battle = launchVinsonBattle({ previewEnding: true, reducedMotion: true, onWin: async () => ({ ok: true, immune: true }) });
    const screen = body.children[0], conversation = find(screen, 'vb-dialogue'), skip = find(screen, 'vb-top').children.find(node => node.textContent === 'Skip ending');
    step(140);assert.equal(conversation.hidden,true);
    down('j'); step(1800); up('j');
    assert.equal(skip.hidden, false, 'holding J wins once story dialogue no longer pauses the clash');
    assert.equal(battle.state.time, 0, 'hold accessibility remains cinematic and does not step combat');
    battle.close();
  }

  // Ordered keyboard sequence tokens are consumed only on keydown; touch buttons feed the same queue.
  {
    const { battle, screen } = await bootFight();
    startVinsonSequence(battle.state, 'inversion');
    battle.state.sequence.keys = ['q', 'e', 'r'];
    step(1);
    for (const key of ['q', 'e', 'r']) { down(key); step(1); up(key); step(1); }
    assert.equal(battle.state.sequence, null, 'Q/E/R keyboard tokens escape the sequence');
    startVinsonSequence(battle.state, 'chains');
    battle.state.sequence.keys = ['f', 'q', 'e'];
    step(1);
    const dock = find(screen, 'vb-sequence-keys');
    for (const key of ['f', 'q', 'e']) {
      dock.children.find(button => button.textContent.toLowerCase() === key).onclick();
      step(1);
    }
    assert.equal(battle.state.sequence, null, 'touch sequence buttons escape through the same input queue');

    // The C action consumes an offer once and applies its finisher after the animation.
    battle.state.comboOffer = 5; battle.state.thresholdIndex = 4;
    const hp = battle.state.boss.hp;
    down('c'); step(1); up('c');
    assert.ok(battle.state.combo, 'C starts the offered combo');
    for (let i = 0; i < 80 && battle.state.combo; i++) step(1);
    assert.equal(battle.state.boss.hp, hp - 210);
    battle.close();
  }
  console.log('Vinson UI14 ending, clash, ordered sequence and combo regressions passed');
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}
