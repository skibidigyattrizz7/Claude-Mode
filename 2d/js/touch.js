// Mobile controls: floating virtual joystick (left half) + action buttons (right side).
import { input, touchPress, touchRelease, setTouchModeFlag } from './input.js';

const BUTTONS = [
  { a: 'shoot', label: 'SHOOT', cls: 'big' },
  { a: 'pass', label: 'PASS' },
  { a: 'through', label: 'THRU' },
  { a: 'lob', label: 'LOB' },
  { a: 'sprint', label: 'SPRINT' },
  { a: 'tackle', label: 'TACKLE' },
  { a: 'slide', label: 'SLIDE' },
  { a: 'switch', label: 'SWITCH' },
  { a: 'skill', label: 'SKILL' },
];

let root = null, base = null, knob = null, zone = null;
let joyId = null, joyOrigin = null;
const R = 56;

/** A phone / tablet: the primary pointer is a finger (touch laptops with a mouse don't count). */
export function isTouchDevice() {
  try {
    const mm = (q) => window.matchMedia(q).matches;
    return mm('(pointer: coarse)') || ((navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && !mm('(any-pointer: fine)'));
  } catch (e) { return false; }
}

let curMode = 'none';

export function initTouch(onPause) {
  root = document.getElementById('touch');
  root.innerHTML = `
    <div id="joyZone"></div>
    <div id="joyBase" class="hidden"><div id="joyKnob"></div></div>
    <div id="tbtns">${BUTTONS.map((b) => `<button class="tbtn ${b.cls || ''}" data-a="${b.a}">${b.label}</button>`).join('')}</div>
    <button id="tpause" aria-label="Pause">II</button>`;
  base = root.querySelector('#joyBase'); knob = root.querySelector('#joyKnob'); zone = root.querySelector('#joyZone');
  const c = input.ctrls[0];

  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (joyId !== null) return;
    joyId = e.pointerId; joyOrigin = { x: e.clientX, y: e.clientY };
    try { zone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    base.style.left = e.clientX + 'px'; base.style.top = e.clientY + 'px';
    base.classList.remove('hidden');
    knob.style.transform = 'translate(-50%,-50%)';
    c.joy.active = true; c.joy.x = 0; c.joy.y = 0;
    setTouchModeFlag(true);
  });
  const move = (e) => {
    if (e.pointerId !== joyId) return;
    e.preventDefault();
    let dx = e.clientX - joyOrigin.x, dy = e.clientY - joyOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const m = Math.min(1, d / R);
    c.joy.x = d > 6 ? (dx / Math.max(1, Math.hypot(dx, dy))) * m : 0;
    c.joy.y = d > 6 ? (dy / Math.max(1, Math.hypot(dx, dy))) * m : 0;
  };
  const end = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null; c.joy.active = false; c.joy.x = c.joy.y = 0;
    base.classList.add('hidden');
  };
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);

  root.querySelectorAll('.tbtn').forEach((btn) => {
    const a = btn.dataset.a;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      btn.classList.add('on'); touchPress(0, a); setTouchModeFlag(true);
    });
    const up = (e) => { e.preventDefault(); btn.classList.remove('on'); touchRelease(0, a); };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', () => { if (btn.classList.contains('on')) { btn.classList.remove('on'); touchRelease(0, a); } });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  root.querySelector('#tpause').addEventListener('click', (e) => { e.preventDefault(); onPause(); });
}

/** 'match' shows joystick + buttons, 'kick' only pause (kick scene has its own UI), 'none' hides. */
export function setTouchMode(mode) {
  curMode = mode;
  refreshTouch();
}

/** Show / hide the on-screen controls for the current scene and input method. */
export function refreshTouch() {
  if (!root) return;
  const mode = curMode;
  const show = input.touchMode && mode !== 'none';
  root.classList.toggle('hidden', !show);
  root.classList.toggle('kickmode', mode === 'kick');
  if (!show) { const c = input.ctrls[0]; c.joy.active = false; joyId = null; base && base.classList.add('hidden'); }
}
