import assert from 'node:assert/strict';
import { launchVinsonBattle, drawVinsonBattle } from '../ui/vinsonbattle.js';

const context = new Proxy({}, { get(_target, key) {
  if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
  if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
  return () => {};
} });
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.hidden = false;
    this.listeners = {}; this.className = ''; this.classList = { add() {}, remove() {} }; }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); child.parent = this; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  removeEventListener(type) { delete this.listeners[type]; }
  focus() {}
  setPointerCapture() {}
  getContext() { return context; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelectorAll() { return []; }
}
const saved = Object.fromEntries(['document', 'window', 'Image', 'requestAnimationFrame', 'cancelAnimationFrame', 'innerWidth', 'innerHeight'].map(key => [key, globalThis[key]]));
const body = new Element('body'), head = new Element('head'), listeners = {};
let callback, now = 0;
globalThis.document = { body, head, hidden: false, documentElement: { style: {} }, createElement: tag => new Element(tag),
  querySelector: () => null, addEventListener: (type, cb) => { listeners[type] = cb; }, removeEventListener: type => { delete listeners[type]; } };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; } decode() { return Promise.resolve(); } };
globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
globalThis.cancelAnimationFrame = () => {};
const find = (node, cls) => node.className === cls ? node : node.children.map(child => find(child, cls)).find(Boolean);
const step = (n = 1) => { for (let i = 0; i < n; i++) { now += 17; callback(now); } };
const down = key => listeners.keydown({ key, repeat: false, preventDefault() {} });
const up = key => listeners.keyup({ key });
try {
  const battle = launchVinsonBattle({ reducedMotion: true });
  const screen = body.children[0], panel = find(screen, 'vb-panel'), dialogue = find(screen, 'vb-dialogue');
  await panel.children.at(-1).children[0].onclick();
  while (!dialogue.hidden) dialogue.onclick();
  assert.equal(battle.state.phase, 'fight');
  globalThis.innerWidth=390;globalThis.innerHeight=844;
  const beforePortrait=battle.state.time,priorHp=battle.state.hero.hp;
  step(120);assert.equal(battle.state.time,beforePortrait);assert.equal(battle.state.hero.hp,priorHp,'portrait pauses damage');
  globalThis.innerWidth=844;globalThis.innerHeight=390;step(2);
  const weapons = find(screen, 'vb-weapons').children;
  down('e'); assert.equal(weapons[1]['aria-pressed'], 'true'); up('e');
  down('q'); assert.equal(weapons[0]['aria-pressed'], 'true'); up('q');
  battle.state.hero.hp = 37;
  down('h'); step(3); assert.equal(battle.state.hero.hp, 69); assert.equal(battle.state.hero.heals, 2);
  step(100); assert.equal(battle.state.hero.heals, 2, 'held H spends once even past cooldown'); up('h'); step(2);
  battle.state.hero.hp = 37; down('h'); step(2); assert.equal(battle.state.hero.heals, 1); up('h');
  battle.state.hero.hp = 100000;
  battle.state.boss.hp = battle.state.boss.maxHp * .8 + 1;
  down('j');
  for (let i = 0; i < 300 && battle.state.phase !== 'dodgebox'; i++) step();
  assert.equal(battle.state.phase, 'dodgebox'); up('j');
  const attack = find(screen, 'vb-touch').children.find(button => button.dataset.action === 'attack');
  assert.equal(attack.disabled, true);
  const hp = battle.state.boss.hp;
  attack.listeners.pointerdown({ preventDefault() {}, pointerId: 1 }); step(5);
  assert.equal(battle.state.boss.hp, hp, 'touch attack cannot damage boss during box');
  attack.listeners.pointerup();
  for (let i = 0; i < 900 && battle.state.phase !== 'timing'; i++) step();
  assert.equal(battle.state.phase, 'timing'); assert.equal(attack.disabled, false);
  down('j'); step(2); assert.equal(battle.state.timing.resolved, true); up('j');
  assert.ok(['perfect', 'good', 'miss'].includes(battle.state.timing.score));
  step(2);
  battle.state.timing = { elapsed: 0, duration: 3, marker: 0, score: null, result: null, resolved: false, resolvedAt: null };
  battle.state._timingWasDown = false;
  down('Enter'); step(2); assert.equal(battle.state.timing.resolved, true, 'Enter also strikes'); up('Enter');
  for (const pattern of ['lanes', 'vertical', 'radial', 'beams']) {
    battle.state.box = { minX: 320, maxX: 960, minY: 320, maxY: 580, heroRadius: 7,
      duration: 10, elapsed: 1, pattern, wave: 2, bullets: [{ x: 500, y: 400, vx: 200, vy: 0, radius: 10,
        kind: pattern === 'beams' ? 'beam' : pattern }], preview: { safe: 2, pattern, remaining: .2 } };
    battle.state.phase = 'dodgebox';
    drawVinsonBattle(context, battle.state, {}, 1, { reducedMotion: true });
  }
  battle.close();
  console.log('Vinson keyboard, touch, heal, timing and four box renders passed');
} finally { for (const [key, value] of Object.entries(saved)) globalThis[key] = value; }
