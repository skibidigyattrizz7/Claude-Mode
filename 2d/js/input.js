// Keyboard / mouse / touch input -> per-player controllers with held/pressed/released actions.
import { ACTIONS, loadBinds, saveBinds } from './keybinds.js';
import { defaultStorage } from './storage.js';

const storage = defaultStorage();

function makeCtrl(i) {
  const c = {
    idx: i,
    held: new Set(), pressed: new Set(), released: new Set(),
    touchHeld: new Set(),
    joy: { x: 0, y: 0, active: false },
    isHeld(a) { return c.held.has(a) || c.touchHeld.has(a); },
    wasPressed(a) { return c.pressed.has(a); },
    wasReleased(a) { return c.released.has(a); },
    move() {
      if (c.joy.active) return { x: c.joy.x, y: c.joy.y };
      let x = 0, y = 0;
      if (c.held.has('left')) x -= 1;
      if (c.held.has('right')) x += 1;
      if (c.held.has('up')) y -= 1;
      if (c.held.has('down')) y += 1;
      const l = Math.hypot(x, y);
      return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
    },
  };
  return c;
}

export const input = {
  binds: loadBinds(storage),
  ctrls: [makeCtrl(0), makeCtrl(1)],
  mouse: { x: 0, y: 0, movedAt: -1e9, down: false, pressed: false, released: false, rdown: false },
  touchMode: false,
  capture: null,          // rebinding callback: receives the next key code
  gameActive: false,      // prevent default browser behaviour for game keys
  anyPressed: false,
  codeMap: new Map(),
};

export function applyBinds(b, persist = true) {
  input.binds = b;
  input.codeMap = new Map();
  for (const [pl, idx] of [['p1', 0], ['p2', 1]]) {
    for (const a of ACTIONS) {
      const code = b[pl][a];
      if (!code) continue;
      if (!input.codeMap.has(code)) input.codeMap.set(code, []);
      input.codeMap.get(code).push({ idx, action: a });
    }
  }
  // releasing everything avoids stuck keys after a rebind
  for (const c of input.ctrls) c.held.clear();
  if (persist) saveBinds(storage, b);
}
applyBinds(input.binds, false);

export function mouseAimActive() {
  return !input.touchMode && performance.now() - input.mouse.movedAt < 2000;
}

export function clearEdges() {
  for (const c of input.ctrls) { c.pressed.clear(); c.released.clear(); }
  input.mouse.pressed = false; input.mouse.released = false;
  input.anyPressed = false;
}

export function touchPress(idx, a) {
  const c = input.ctrls[idx];
  if (!c.touchHeld.has(a)) c.pressed.add(a);
  c.touchHeld.add(a);
  input.anyPressed = true;
}
export function touchRelease(idx, a) {
  const c = input.ctrls[idx];
  if (c.touchHeld.has(a)) c.released.add(a);
  c.touchHeld.delete(a);
}

export function releaseAll() {
  for (const c of input.ctrls) {
    for (const a of c.held) c.released.add(a);
    c.held.clear(); c.touchHeld.clear(); c.joy.active = false; c.joy.x = c.joy.y = 0;
  }
  input.mouse.down = false;
}

const NO_DEFAULT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (input.capture) {
      e.preventDefault(); e.stopPropagation();
      const cb = input.capture; input.capture = null;
      cb(e.code);
      return;
    }
    input.anyPressed = true;
    const m = input.codeMap.get(e.code);
    if (m) {
      for (const { idx, action } of m) {
        const c = input.ctrls[idx];
        if (!c.held.has(action) && !e.repeat) c.pressed.add(action);
        c.held.add(action);
      }
    }
    // Escape always pauses for player 1 in addition to the bound key
    if (e.code === 'Escape' && !e.repeat) input.ctrls[0].pressed.add('pause');
    if (input.gameActive && (m || NO_DEFAULT.has(e.code))) e.preventDefault();
    else if (e.code === 'Tab' && input.gameActive) e.preventDefault();
  }, { capture: true });

  window.addEventListener('keyup', (e) => {
    const m = input.codeMap.get(e.code);
    if (m) {
      for (const { idx, action } of m) {
        const c = input.ctrls[idx];
        if (c.held.has(action)) c.released.add(action);
        c.held.delete(action);
      }
    }
  }, { capture: true });

  window.addEventListener('blur', releaseAll);

  window.addEventListener('mousemove', (e) => {
    input.mouse.x = e.clientX; input.mouse.y = e.clientY;
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0 || e.movementX === undefined) input.mouse.movedAt = performance.now();
    if (!e.sourceCapabilities || !e.sourceCapabilities.firesTouchEvents) input.touchMode = input.touchMode && false;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { input.mouse.down = true; input.mouse.pressed = true; input.anyPressed = true; }
    if (e.button === 2) input.mouse.rdown = true;
    input.mouse.x = e.clientX; input.mouse.y = e.clientY;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0 && input.mouse.down) { input.mouse.down = false; input.mouse.released = true; }
    if (e.button === 2) input.mouse.rdown = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('touchstart', () => { input.touchMode = true; input.anyPressed = true; }, { passive: true });
}
