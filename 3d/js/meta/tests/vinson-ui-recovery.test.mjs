import assert from 'node:assert/strict';
import { defaultSquad } from '../core/ut.js';
import { HELL_CARD_ID } from '../core/secretcard.js';
import { startVinsonExperience } from '../ui/vinson.js';
import { cursedPack } from '../core/vinson.js';

class Classes {
  values = new Set();
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : !!force;
    if (on) this.add(name); else this.remove(name);
    return on;
  }
}

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.classList = new Classes(); this.dataset = {}; this.style = { setProperty() {} };
    this.attributes = new Map(); this.inert = false; this.textContent = ''; this.isConnected = false;
  }
  set className(value) { this.classList = new Classes(); String(value).split(/\s+/).filter(Boolean).forEach((x) => this.classList.add(x)); }
  get className() { return [...this.classList.values].join(' '); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...nodes) { for (const node of nodes) { if (!node) continue; node.parentNode = this; node.isConnected = this.isConnected; this.children.push(node); if (node.isConnected) node.children.forEach((child) => { child.isConnected = true; }); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; this.isConnected = false; }
  matches(selector) {
    return selector.split(',').some((part) => {
      const s = part.trim();
      if (s.startsWith('.')) return s.split(/\s+/).every((c) => c.startsWith('.') && this.classList.contains(c.slice(1)));
      if (s.startsWith('[role=')) return this.getAttribute('role') === s.slice(6, -1).replaceAll('"', '');
      if (s.startsWith('[data-uttab=')) return this.dataset.uttab === s.slice(12, -1).replaceAll('"', '');
      return s.toLowerCase() === this.tagName.toLowerCase();
    });
  }
  closest(selector) { for (let el = this; el; el = el.parentNode) if (el.matches(selector)) return el; return null; }
  contains(node) { for (let el = node; el; el = el.parentNode) if (el === this) return true; return false; }
  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => { for (const child of node.children) { if (child.matches(selector)) out.push(child); visit(child); } };
    visit(this); return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 30 }; }
}

const body = new Element('body'); body.isConnected = true;
const head = new Element('head'); head.isConnected = true;
const listeners = new Map();
globalThis.document = {
  body, head, hidden: true,
  createElement: (tag) => new Element(tag),
  createTextNode: (text) => Object.assign(new Element('#text'), { textContent: text }),
  querySelector: () => null,
  querySelectorAll: (selector) => body.querySelectorAll(selector),
  addEventListener: (type, fn) => listeners.set(type, fn),
  removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
};
globalThis.matchMedia = () => ({ matches: true });
globalThis.window = {};
globalThis.localStorage = { getItem: () => null };
globalThis.sessionStorage = { getItem: () => null, setItem() {} };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
const intervals = new Map(); let nextInterval = 0;
globalThis.setInterval = (fn, delay) => { const id = ++nextInterval; intervals.set(id, { fn, delay }); return id; };
globalThis.clearInterval = (id) => intervals.delete(id);

const button = new Element('button'); button.textContent = 'Open Squad';
const root = new Element('main'); root.append(button); body.append(root);
const state = { club: [], squad: defaultSquad(), vinson: { phase: 'doom', doomUntil: Date.now() + 60_000, phaseUntil: 0, pin: null } };
let remotePhase = 'doom', statusCalls = 0;
const online = {
  identityId: () => 'player-id',
  account: { current: () => ({ role: 'player' }), onChange() {} },
  vinson: {
    async status() { statusCalls++; return { ok: true, phase: remotePhase, deadline: remotePhase === 'doom' ? new Date(state.vinson.doomUntil).toISOString() : null, serverNow: new Date().toISOString() }; },
    async pull() { return { ok: true, phase: remotePhase }; },
    async lock() { return { ok: true, phase: 'locked' }; },
  },
};
const controller = startVinsonExperience(online, { initialState: state, ephemeral: true });
controller.attach({ ut: state, root, stack: [], refresh() {}, saveUT() {}, applyRestrictions() {} });
await controller.poll();

// A curse triggered during a pull must not strand the user on its item-assignment screen.
const packGrid = new Element('div'); packGrid.className = 'pm-po-gridwrap';
const packClose = new Element('button'); packClose.textContent = 'Close';
packGrid.append(packClose); root.append(packGrid);
const packEvent = { target: packClose, prevented: false, stopped: false,
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
listeners.get('click')(packEvent);
assert.equal(packEvent.prevented, false, 'initial doom allows pack assignment and close');
assert.equal(packClose.classList.contains('vinson-control-broken'), false);
packGrid.remove();

const click = () => {
  const event = { target: button, clientX: 10, clientY: 10, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  listeners.get('click')(event);
  return event;
};

const doomedClick = click();
assert.equal(doomedClick.prevented, true, 'doom still blocks a normal action');
assert.equal(button.classList.contains('vinson-control-broken'), true);
await Promise.resolve();
assert.equal(button.inert, true, 'doom makes the control inert after its first click');

remotePhase = 'released';
await controller.poll();
assert.equal(state.vinson.phase, 'freed');
assert.equal(button.classList.contains('vinson-control-broken'), false, 'release removes broken class');
assert.equal(button.classList.contains('vinson-control-gone'), false, 'release removes gone class');
assert.equal(button.classList.contains('vinson-tab-falling'), false, 'release removes falling class');
assert.equal(button.inert, false, 'release restores ordinary control interaction');
assert.equal(root.classList.contains('vinson-ui-falling'), false);
assert.equal(body.classList.contains('vinson-infected'), false, 'freed UI is no longer marked infected');
let ordinaryClick = click();
assert.equal(ordinaryClick.prevented, false, 'freed state permits ordinary button actions');
assert.equal(button.classList.contains('vinson-control-broken'), false);

const remoteTimer = [...intervals.values()].find((interval) => interval.delay === 12_000)?.fn;
assert.equal(typeof remoteTimer, 'function', '12-second remote poll timer is installed');
const beforeRemotePoll = statusCalls;
remoteTimer();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(statusCalls, beforeRemotePoll + 1, 'remote interval continues polling in freed phase');

state.squad.slots[9] = HELL_CARD_ID;
controller.onSquadChange();
assert.equal(state.vinson.phase, 'warn', 'a freed but still cursed squad starts its warning');
assert.match(document.querySelectorAll('.vinson-timer')[0]?.textContent || '', /05 seconds/);
ordinaryClick = click();
assert.equal(ordinaryClick.prevented, false, 'warning permits ordinary button actions');
assert.equal(button.classList.contains('vinson-control-broken'), false);

state.vinson.phaseUntil = Date.now() - 1;
controller.tick();
assert.equal(state.vinson.phase, 'consequence');
ordinaryClick = click();
assert.equal(ordinaryClick.prevented, false, 'consequence permits ordinary button actions');

state.vinson.phaseUntil = Date.now() - 1;
controller.tick();
assert.equal(state.vinson.phase, 'locked');
assert.equal(cursedPack(state), true, 'the locked squad still carries its cursed-pack state');
ordinaryClick = click();
assert.equal(ordinaryClick.prevented, false, 'locked permits ordinary button actions');
assert.equal(button.classList.contains('vinson-control-broken'), false);

remotePhase = 'lifted';
remoteTimer();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(state.vinson.phase, 'lifted', 'remote interval observes a later owner lift');
assert.equal(body.classList.contains('vinson-infected'), false);
controller.destroy();

// Mods have no owner exemption, including when the first pull RPC fails.
delete state.vinson;
const modOnline = { ...online, account: { current: () => ({ role: 'mod' }), onChange() {} },
  vinson: { async status() { return { ok: false }; }, async pull() { throw new Error('offline'); } } };
const modController = startVinsonExperience(modOnline, { initialState: state, ephemeral: true });
await modController.onPull();
assert.equal(state.vinson.phase, 'doom', 'mod pull starts doom even without a server response');
assert.equal(body.classList.contains('vinson-infected'), true, 'mod receives curse presentation');
const deadline = state.vinson.doomUntil;
await modController.onPull();
assert.equal(state.vinson.doomUntil, deadline, 'multiple resolutions cannot restart the timer');
modController.destroy();

delete state.vinson;
const ownerController = startVinsonExperience({ ...online, account: { current: () => ({ role: 'owner' }) } }, { initialState: state, ephemeral: true });
await ownerController.onPull();
assert.equal(state.vinson, undefined, 'only the owner is exempt from a pull');
ownerController.destroy();

console.log('Vinson UI release recovery regression passed');
