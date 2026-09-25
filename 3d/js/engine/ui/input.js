// Local input devices -> raw InputState (screen-relative: mx +1 = screen right, my +1 = screen up).
// Keyboard (+ 'Mouse0'/'Mouse2' binds), Gamepad API (standard mapping) and a touch overlay
// (virtual joystick + action buttons) when 'ontouchstart' in window.
const ACTIONS = ['sprint', 'pass', 'through', 'lob', 'shoot', 'finesse', 'switchP', 'tackle', 'skill'];
const KICKS = ['pass', 'through', 'lob', 'shoot', 'finesse'];

export function emptyInput() {
  return { mx: 0, my: 0, aimX: 0, aimY: 0, sprint: false, pass: false, through: false, lob: false, shoot: false, shootPower: 0, switchP: false, tackle: false, skill: false, finesse: false };
}

export class InputManager {
  constructor(root, binds, { touch = false, onCommand } = {}) {
    this.root = root;
    this.binds = binds;
    this.onCommand = onCommand || (() => {});
    this.down = new Set();
    this.latch = new Map(); // consumer -> Set(codes pressed since last read)
    this.pads = [null, null];
    this.padPrev = [{}, {}];
    this.touchState = null;
    this.holdStart = { p1: {}, p2: {} };
    this.power = { p1: 0, p2: 0 };
    this.heldKick = { p1: null, p2: null };
    this.enabled = true;
    const bound = new Set();
    for (const slot of ['p1', 'p2']) for (const k in binds[slot]) bound.add(binds[slot][k]);
    bound.add('KeyC');
    this.bound = bound;
    this._kd = (e) => {
      if (!this.enabled || isTyping(e)) return;
      if (this.bound.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this._press(e.code);
    };
    this._ku = (e) => { this.down.delete(e.code); };
    this._blur = () => { this.down.clear(); };
    this._md = (e) => { if (!this.enabled) return; this._press('Mouse' + e.button); };
    this._mu = (e) => { this.down.delete('Mouse' + e.button); };
    this._cm = (e) => { if (this.bound.has('Mouse2')) e.preventDefault(); };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', this._blur);
    root.addEventListener('mousedown', this._md);
    window.addEventListener('mouseup', this._mu);
    root.addEventListener('contextmenu', this._cm);
    if (touch) this._buildTouch();
  }

  _press(code) {
    this.down.add(code);
    for (const s of this.latch.values()) s.add(code);
    const b = this.binds;
    if (code === b.p1.pause || code === b.p2.pause) this.onCommand('pause', code);
    else if (code === 'KeyC') this.onCommand('camera', code);
    else this.onCommand('any', code);
  }

  _isDown(code, latch) {
    return this.down.has(code) || (latch && latch.has(code));
  }

  // Poll gamepads once per frame
  poll() {
    const list = (navigator.getGamepads && navigator.getGamepads()) || [];
    const pads = [];
    for (const p of list) if (p && p.connected) pads.push(p);
    for (let i = 0; i < 2; i++) {
      const p = pads[i] || null;
      this.pads[i] = p;
      if (!p) continue;
      const prev = this.padPrev[i];
      const btn = (k) => !!(p.buttons[k] && (p.buttons[k].pressed || p.buttons[k].value > 0.5));
      const start = btn(9), back = btn(8);
      if (start && !prev.start) this.onCommand('pause', 'pad');
      if (back && !prev.back) this.onCommand('camera', 'pad');
      const any = [0, 1, 2, 3, 5].some(btn);
      if (any && !prev.any) this.onCommand('any', 'pad');
      prev.start = start; prev.back = back; prev.any = any;
    }
  }

  /**
   * Raw input for a local slot ('p1' | 'p2'). `consumer` identifies who reads (each consumer gets
   * key presses that happened since its previous read, so taps shorter than a frame are not lost).
   */
  read(slot, consumer = 'frame') {
    const key = slot + ':' + consumer;
    let latch = this.latch.get(key);
    if (!latch) { latch = new Set(); this.latch.set(key, latch); }
    const b = this.binds[slot];
    const out = emptyInput();
    if (this.enabled) {
      const d = (k) => this._isDown(b[k], latch);
      out.mx = (d('right') ? 1 : 0) - (d('left') ? 1 : 0);
      out.my = (d('up') ? 1 : 0) - (d('down') ? 1 : 0);
      for (const a of ACTIONS) out[a] = d(a);
      // gamepad
      const pad = this.pads[slot === 'p1' ? 0 : 1];
      if (pad) {
        const ax = (i) => { const v = pad.axes[i] || 0; return Math.abs(v) < 0.2 ? 0 : v; };
        const btn = (k) => !!(pad.buttons[k] && (pad.buttons[k].pressed || pad.buttons[k].value > 0.4));
        if (ax(0) || ax(1)) { out.mx = ax(0); out.my = -ax(1); }
        if (btn(14)) out.mx = -1; if (btn(15)) out.mx = 1; if (btn(12)) out.my = 1; if (btn(13)) out.my = -1;
        const rx = ax(2), ry = ax(3);
        if (Math.hypot(rx, ry) > 0.75) out.skill = true;
        out.pass ||= btn(0); out.lob ||= btn(1); out.shoot ||= btn(2); out.through ||= btn(3);
        out.switchP ||= btn(4); out.finesse ||= btn(5); out.tackle ||= btn(6) || btn(1); out.sprint ||= btn(7);
        out.skill ||= btn(11) || btn(10);
      }
      // touch (player 1 only)
      if (slot === 'p1' && this.touchState) {
        const t = this.touchState;
        if (t.mx || t.my) { out.mx = t.mx; out.my = t.my; }
        for (const a of ACTIONS) out[a] ||= !!t[a];
      }
      const l = Math.hypot(out.mx, out.my);
      if (l > 1) { out.mx /= l; out.my /= l; }
    }
    latch.clear();
    if (consumer === 'frame') this._holds(slot, out);
    out.shootPower = this.power[slot] && (out.shoot || out.finesse) ? this.power[slot] : 0;
    return out;
  }

  _holds(slot, inp) {
    const now = performance.now() / 1000;
    const hs = this.holdStart[slot];
    let best = 0, which = null;
    for (const k of KICKS) {
      if (inp[k]) {
        if (hs[k] == null) hs[k] = now;
        const full = k === 'pass' || k === 'through' ? 0.9 : 1.0;
        const pw = Math.min(1, (now - hs[k]) / full);
        if (pw >= best) { best = pw; which = k; }
      } else hs[k] = null;
    }
    this.power[slot] = best;
    this.heldKick[slot] = which;
  }

  _buildTouch() {
    const r = this.root;
    const wrap = document.createElement('div');
    wrap.className = 'ps3d-touch';
    wrap.innerHTML = `
      <div class="ps3d-joy"><div class="ps3d-knob"></div></div>
      <div class="ps3d-btns">
        <button data-a="shoot" class="big">SHOOT</button>
        <button data-a="pass">PASS</button>
        <button data-a="through">THRU</button>
        <button data-a="lob">LOB</button>
        <button data-a="finesse">CURL</button>
        <button data-a="tackle">TACKLE</button>
        <button data-a="switchP">SWITCH</button>
        <button data-a="skill">SKILL</button>
        <button data-a="sprint" class="wide">SPRINT</button>
      </div>
      <button class="ps3d-tpause" data-cmd="pause">II</button>`;
    r.appendChild(wrap);
    this.touchEl = wrap;
    const st = (this.touchState = { mx: 0, my: 0 });
    const joy = wrap.querySelector('.ps3d-joy'), knob = wrap.querySelector('.ps3d-knob');
    let joyId = null, cx = 0, cy = 0;
    const R = 55;
    const moveJoy = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      st.mx = dx / R; st.my = -dy / R;
      if (Math.hypot(st.mx, st.my) < 0.15) { st.mx = 0; st.my = 0; }
    };
    this._ts = (e) => {
      for (const t of e.changedTouches) {
        const el = t.target;
        if (joy.contains(el) || el === joy) {
          joyId = t.identifier;
          const rect = joy.getBoundingClientRect();
          cx = rect.left + rect.width / 2; cy = rect.top + rect.height / 2;
          moveJoy(t.clientX, t.clientY);
          e.preventDefault();
        } else if (el.dataset && el.dataset.a) {
          st[el.dataset.a] = t.identifier + 1;
          el.classList.add('on');
          this.onCommand('any', 'touch');
          e.preventDefault();
        } else if (el.dataset && el.dataset.cmd) {
          this.onCommand(el.dataset.cmd, 'touch');
          e.preventDefault();
        }
      }
    };
    this._tm = (e) => {
      for (const t of e.changedTouches) if (t.identifier === joyId) { moveJoy(t.clientX, t.clientY); e.preventDefault(); }
    };
    this._te = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) { joyId = null; st.mx = 0; st.my = 0; knob.style.transform = ''; }
        for (const a of ACTIONS) if (st[a] === t.identifier + 1) {
          st[a] = 0;
          const b = wrap.querySelector(`[data-a="${a}"]`);
          if (b) b.classList.remove('on');
        }
      }
    };
    wrap.addEventListener('touchstart', this._ts, { passive: false });
    wrap.addEventListener('touchmove', this._tm, { passive: false });
    wrap.addEventListener('touchend', this._te);
    wrap.addEventListener('touchcancel', this._te);
  }

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('blur', this._blur);
    this.root.removeEventListener('mousedown', this._md);
    window.removeEventListener('mouseup', this._mu);
    this.root.removeEventListener('contextmenu', this._cm);
    if (this.touchEl) {
      this.touchEl.removeEventListener('touchstart', this._ts);
      this.touchEl.removeEventListener('touchmove', this._tm);
      this.touchEl.removeEventListener('touchend', this._te);
      this.touchEl.removeEventListener('touchcancel', this._te);
      this.touchEl.remove();
    }
    this.down.clear();
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
