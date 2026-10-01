import assert from 'node:assert/strict';
import { defaultSquad, createUTState } from '../core/ut.js';
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
  setAttribute(key, value) { this.attributes.set(key, String(value)); if (key === 'data-uttab') this.dataset.uttab = String(value); }
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
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
globalThis.window = {};
globalThis.localStorage = { getItem: () => null };
globalThis.sessionStorage = { getItem: () => null, setItem() {} };
const observers = new Set();
globalThis.MutationObserver = class { constructor(fn) { this.fn = fn; observers.add(this); } observe() {} disconnect() { observers.delete(this); } };
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
let saves = 0;
controller.attach({ ut: state, root, stack: [], refresh() {}, saveUT() { saves++; }, applyRestrictions() {} });
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

const homeTab = new Element('button'); homeTab.dataset.uttab = 'home'; root.append(homeTab);
const squadTab = new Element('button'); squadTab.dataset.uttab = 'squad'; root.append(squadTab);
assert.equal(controller.breakDoomControl(squadTab), true);
assert.equal(controller.breakDoomControl(homeTab), false);
await Promise.resolve();
assert.equal(squadTab.inert, true);
assert.equal(homeTab.inert, false, 'Home never becomes inert during Doom');
state.vinson.doomUntil = Date.now() + 2500;
controller.tick();
assert.equal(homeTab.classList.contains('vinson-tab-falling'), false, 'Home survives the final tab cascade');
state.vinson.doomUntil = Date.now() + 60_000;
// One click must neither break companion artwork nor every other identically labelled button.
const packs = [];
for (let i = 0; i < 2; i++) {
  const item = new Element('div'); item.className = 'pm-packitem';
  const art = new Element('div'); art.className = 'pm-pack';
  const action = new Element('button'); action.textContent = 'Open';
  item.append(art, action); root.append(item); packs.push({item,art,action});
}
listeners.get('click')({target:packs[0].action,preventDefault(){},stopImmediatePropagation(){}});
for (const observer of observers) observer.fn();
assert.equal(packs[0].action.classList.contains('vinson-control-broken'),true);
assert.equal(packs[0].art.classList.contains('vinson-control-broken'),false,'art waits for its own click');
assert.equal(packs[1].action.classList.contains('vinson-control-gone'),false,'same label elsewhere is independent');
assert.equal(packs[1].action.inert,false);
const panel = new Element('section'); panel.className = 'pm-panel';
const paragraph = new Element('p'); paragraph.textContent = 'One label';
const sibling = new Element('p'); sibling.textContent = 'Another label';
panel.append(paragraph,sibling); root.append(panel);
listeners.get('click')({target:paragraph,preventDefault(){},stopImmediatePropagation(){}});
assert.equal(paragraph.classList.contains('vinson-control-broken'),true);
assert.equal(panel.classList.contains('vinson-control-broken'),false);
assert.equal(sibling.classList.contains('vinson-control-broken'),false);
listeners.get('click')({target:panel,preventDefault(){},stopImmediatePropagation(){}});
assert.equal(panel.classList.contains('vinson-control-broken'),false,'empty panel cannot collapse its children');
// Restored art and price surfaces fracture independently from their siblings and containers.
for (const [tag, className, text] of [
  ['div', 'pm-pack', 'pack art'], ['div', 'pm-price', 'price label'], ['i', 'pm-coin', 'coin icon'], ['small', '', 'small detail'],
]) {
  const parent = new Element('div'), target = new Element(tag), sibling = new Element('span');
  parent.className = 'surface-parent'; target.className = className; target.textContent = text; sibling.textContent = `neighbor of ${text}`;
  parent.append(target, sibling); root.append(parent);
  listeners.get('click')({target,preventDefault(){},stopImmediatePropagation(){}});
  assert.equal(target.classList.contains('vinson-control-broken'), true, `${className || tag} breaks on its own click`);
  assert.equal(parent.classList.contains('vinson-control-broken'), false, `${className || tag} does not break its parent`);
  assert.equal(sibling.classList.contains('vinson-control-broken'), false, `${className || tag} leaves its sibling intact`);
}
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
const savesBeforePinRepair = saves;
state.squad.slots[9] = null;
controller.tick();
assert.equal(state.squad.slots[9], HELL_CARD_ID, 'tick restores Vinson if a refresh removed the pinned squad card');
assert.equal(saves, savesBeforePinRepair + 1, 'pin repair survives a cloud refresh');
ordinaryClick = click();
assert.equal(ordinaryClick.prevented, true, 'locked state blocks an arbitrary ordinary button action');
assert.equal(button.classList.contains('vinson-control-broken'), true, 'locked state fractures the clicked ordinary button');

// In locked aftermath, section routes stay available on the first click while the exact control breaks.
for (const [className, label] of [['pm-uttab', 'Store'], ['pm-hx', 'Store hub']]) {
  const target = new Element('button'); target.className = className; target.textContent = label; root.append(target);
  let prevented = false, routeCalls = 0;
  listeners.get('click')({target,preventDefault(){prevented=true;},stopImmediatePropagation(){}});
  if (!prevented) routeCalls++;
  assert.equal(prevented, false, `${className} route is allowed on its first click`);
  assert.equal(routeCalls, 1, `${className} route handler gets its first click`);
  assert.equal(target.classList.contains('vinson-control-broken'), true, `${className} itself fractures`);
}

for (const [parentClass, label] of [['pm-packitem', 'Open'], ['pm-storeitem', 'Buy & Open']]) {
  const item = new Element('div'), action = new Element('button');
  item.className = parentClass; action.textContent = label; item.append(action); root.append(item);
  let prevented = false, ownHandlerCalls = 0;
  listeners.get('click')({target:action,preventDefault(){prevented=true;},stopImmediatePropagation(){}});
  if (!prevented) ownHandlerCalls++;
  assert.equal(prevented, false, `${label} is left to the pack flow handler`);
  assert.equal(ownHandlerCalls, 1, `${label} own handler receives the click`);
  assert.equal(action.classList.contains('vinson-control-broken'), true, `${label} button fractures after the click`);
}

const manager = new Element('section'); manager.className = 'pm-modal'; manager.setAttribute('aria-label', 'Pack manager');
const cancel = new Element('button'); cancel.className = 'pm-x'; cancel.textContent = 'Cancel'; manager.append(cancel); root.append(manager);
let cancelPrevented = false;
listeners.get('click')({target:cancel,preventDefault(){cancelPrevented=true;},stopImmediatePropagation(){}});
assert.equal(cancelPrevented, false, 'pack manager cancel remains unchanged in locked state');
assert.equal(cancel.classList.contains('vinson-control-broken'), false, 'pack manager cancel is not fractured');

remotePhase = 'lifted';
remoteTimer();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(state.vinson.phase, 'lifted', 'remote interval observes a later owner lift');
assert.equal(body.classList.contains('vinson-infected'), false);
controller.destroy();

// A server response received during an account-state replacement applies to the new Vinson-in-XI state.
const oldPollState = {club:[],squad:defaultSquad(),vinson:{phase:'banned',doomUntil:Date.now(),phaseUntil:0,pin:null}};
const latestPollState = {club:[],squad:defaultSquad(),vinson:{phase:'banned',doomUntil:Date.now(),phaseUntil:0,pin:null}};
latestPollState.squad.slots[9] = HELL_CARD_ID;
let releaseStatus;
const pendingStatus = new Promise(resolve => { releaseStatus = resolve; });
const replacementOnline = {...online,vinson:{status:()=>pendingStatus,pull:async()=>({ok:true,phase:'released'}),lock:async()=>({ok:true,phase:'locked'})}};
const replacementController = startVinsonExperience(replacementOnline,{initialState:oldPollState,ephemeral:true});
const replacementApp = {ut:oldPollState,root,stack:[],refresh(){},saveUT(){}};
replacementController.attach(replacementApp);
replacementApp.ut = latestPollState;
releaseStatus({ok:true,phase:'released'});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(oldPollState.vinson.phase,'banned','pending poll does not mutate the detached account state');
assert.equal(latestPollState.vinson.phase,'warn','released status warns the replacement state with Vinson in the XI');
replacementController.destroy();

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

// A cloud refresh during dynamic import must not silently cancel battle entry.
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
Element.prototype.getContext = () => null;
Element.prototype.addEventListener = function(type,fn) { this.events ||= new Map(); this.events.set(type,fn); };

const fightState = { club: [], squad: defaultSquad(), vinson: {phase:'banned',doomUntil:Date.now(),phaseUntil:0,pin:null} };
const fightOnline = {...online,vinson:{status:async()=>({ok:false})}};
const fightController = startVinsonExperience(fightOnline,{initialState:fightState,ephemeral:true});
const fightApp = {ut:fightState,root,stack:[],refresh(){},saveUT(){}};
fightController.attach(fightApp);
const opening = fightController.openBattle();
assert.equal(await fightController.openBattle(),false,'only one module load/launch runs at a time');
fightApp.ut = structuredClone(fightState);
assert.equal(await opening, true, 'same-account state replacement must not cancel opening');
assert.equal(body.querySelectorAll('.vb-screen').length,1,'battle or usable fallback is displayed');
fightController.destroy();
const closingController = startVinsonExperience(fightOnline,{initialState:structuredClone(fightState),ephemeral:true});
const closingOpen = closingController.openBattle();
closingController.destroy();
assert.equal(await closingOpen,false,'destroy during module loading cannot spawn an orphan modal');

// Exercise the real tab handler without the document capture listener.
globalThis.Node = Element;
document.getElementById = () => null;
const {utTabs, guardVinsonDoomAction} = await import('../ui/utview.js');
let navigated = 0, shattered = 0;
const tabState = createUTState(); tabState.vinson = {phase:'doom'};
const tabApp = {ut:tabState,root,online,vinson:{breakDoomControl(){shattered++;}},popTo(){navigated++;},push(){navigated++;},toast(){}};
const guardedTarget = new Element('button');
let guardPrevented = false, guardStopped = false;
assert.equal(guardVinsonDoomAction(tabApp,{currentTarget:guardedTarget,preventDefault(){guardPrevented=true;},stopImmediatePropagation(){guardStopped=true;}}),true,'direct Doom guard rejects a Squad action');
assert.equal(guardPrevented,true); assert.equal(guardStopped,true); assert.equal(shattered,1,'direct guard breaks only its requested target');
const nav = utTabs(tabApp,'home');
const realSquad = nav.children.find(el=>el.dataset.uttab==='squad');
realSquad.events.get('click')({currentTarget:realSquad});
assert.equal(navigated,0,'Squad handler cannot bypass Doom when capture is absent');
assert.equal(shattered,2,'blocked Squad still requests the fracture animation');
const realHome = nav.children.find(el=>el.dataset.uttab==='home');
realHome.events.get('click')({currentTarget:realHome});
assert.equal(shattered,2,'Home stays exempt');
const {MetaApp} = await import('../ui/app.js');
const appStack = [{utHome:true}], appPush = {ut:tabState,online,stack:appStack,runCleanup(){throw Error('blocked Doom navigation must return before cleanup');},render(){throw Error('blocked Doom navigation must return before render');}};
MetaApp.prototype.push.call(appPush,{utHome:false});
assert.equal(appStack.length,1,'App.prototype.push cannot navigate away from the home squad tile during Doom');

// Once the player is unbanned, the earned fight remains available while the squad curse advances.
for (const phase of ['freed','warn','consequence','locked']) {
  const stateAfterUnban = {club:[],squad:defaultSquad(),vinson:{phase,doomUntil:0,phaseUntil:Date.now()+60_000,pin:null}};
  const experience = startVinsonExperience(fightOnline,{initialState:stateAfterUnban,ephemeral:true});
  experience.attach({ut:stateAfterUnban,root,stack:[],refresh(){},saveUT(){}});
  const host = body.children.find(el=>el.id==='vinson-experience');
  const fightLink = host?.querySelector('.vinson-fight-link');
  assert.ok(fightLink, `fight button is rendered in ${phase} after unban`);
  let openCalls = 0;
  const openBattle = experience.openBattle.bind(experience);
  experience.openBattle = (...args) => { openCalls++; return openBattle(...args); };
  await fightLink.onclick();
  assert.equal(openCalls,1,`fight button invokes openBattle in ${phase}`);
  assert.equal(fightLink.textContent,'Fight Suppression',`fight button recovers after a successful ${phase} launch`);
  experience.destroy();
}
for (const [stateAfterUnban, onlineAccount, label] of [
  [{club:[],squad:defaultSquad(),vinson:{phase:'freed'}},{current:()=>({role:'owner'})},'owner'],
  [{club:[],squad:defaultSquad(),vinson:{phase:'lifted'}},{current:()=>({role:'player'})},'lifted'],
  [{club:[],squad:defaultSquad()},{current:()=>({role:'player'})},'no curse'],
]) {
  const experience = startVinsonExperience({...fightOnline,account:onlineAccount},{initialState:stateAfterUnban,ephemeral:true});
  experience.attach({ut:stateAfterUnban,root,stack:[],refresh(){},saveUT(){}});
  assert.equal(await experience.openBattle(),false,`battle stays unavailable for ${label}`);
  experience.destroy();
}
console.log('Vinson UI release recovery regression passed');
