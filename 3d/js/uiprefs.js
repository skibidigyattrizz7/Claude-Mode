// Pitchside 3D — interface look preferences shared by the main Settings screen and Ultimate Team's Display
// button (owner, Sep 29: change colours without leaving UT). Stored in the same 'pitchside.settings' object as
// everything else; css/accent.css holds the preset colours, a custom colour rides on --user-acc* vars.
// Plain DOM, no imports, so both the main menu (main.js) and the meta layer can use it.

export const SETTINGS_KEY = 'pitchside.settings';
export const UI_STYLES = [['classic', 'Classic'], ['stadium', 'Stadium']];
// [id, label, swatch, ink]; 'default' keeps each interface style's own accent, 'custom' = any colour you pick
export const UI_ACCENTS = [['default', 'Theme default', '', ''], ['lime', 'Lime', '#cdfb3c', '#0b0d10'], ['orange', 'Orange', '#ff6a1f', '#0a0f14'], ['red', 'Red', '#ff4757', '#0a0f14'],
  ['gold', 'Gold', '#f5c542', '#0a0f14'], ['green', 'Green', '#34d987', '#06140d'], ['cyan', 'Cyan', '#22d3ee', '#04141a'], ['blue', 'Blue', '#4c8dff', '#050b16'],
  ['pink', 'Pink', '#ff4fa3', '#14050c'], ['white', 'White', '#eef2f6', '#0b0d10']];
const HEX = /^#[0-9a-f]{6}$/i;

function read() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { return {}; } }
function write(patch) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...read(), ...patch })); } catch { /* storage blocked */ } }
export function uiPrefs() {
  const s = read();
  return {
    // Stadium is the default (owner, Oct 1); a saved style counts only once the player picked it
    ui: s.uiPicked && UI_STYLES.some(([k]) => k === s.ui) ? s.ui : 'stadium',
    accent: s.accent === 'custom' || UI_ACCENTS.some(([k]) => k === s.accent) ? s.accent : 'default',
    accentCustom: HEX.test(s.accentCustom || '') ? s.accentCustom : '#ff6a1f',
  };
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => { const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** Text colour that stays readable on the accent (dark on light colours, white on dark ones). */
export const inkFor = (hex) => ((lum(hex) + 0.05) / 0.05 >= 1.05 / (lum(hex) + 0.05) ? '#0b0d10' : '#ffffff');
const mix = (hex, t) => '#' + rgb(hex).map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('');

/** Apply interface style + colour to <html> (also run on load by js/uistyle.js before first paint). */
export function applyUiPrefs(p = uiPrefs()) {
  const root = document.documentElement;
  if (p.ui === 'stadium') root.dataset.ui = 'stadium'; else delete root.dataset.ui;
  if (p.accent && p.accent !== 'default') root.dataset.accent = p.accent; else delete root.dataset.accent;
  if (p.accent === 'custom' && HEX.test(p.accentCustom)) {
    const [r, g, b] = rgb(p.accentCustom);
    root.style.setProperty('--user-acc', p.accentCustom);
    root.style.setProperty('--user-acc-ink', inkFor(p.accentCustom));
    root.style.setProperty('--user-acc-soft', `rgba(${r},${g},${b},.16)`);
    root.style.setProperty('--user-acc-hi', mix(p.accentCustom, 0.2));
  }
}

/** Colour swatches + a free colour picker. onChange(prefsPatch) after it has been saved and applied. */
export function accentPicker({ onChange = () => {}, label = 'UI colour' } = {}) {
  const p = uiPrefs();
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); } n.append(...kids); return n; };
  const id = `lbl-accent-${Math.random().toString(36).slice(2, 7)}`;
  const wrap = el('div', { class: 'field accent-field' }, el('div', { class: 'field-label', id }, label));
  const row = el('div', { class: 'accent-row', role: 'radiogroup', 'aria-labelledby': id });
  const btns = [];
  const mark = (on) => { for (const b of btns) { const sel = b.dataset.value === on; b.setAttribute('aria-checked', String(sel)); b.dataset.on = sel ? '1' : ''; } };
  const pick = (patch) => { write(patch); applyUiPrefs(uiPrefs()); mark(uiPrefs().accent); onChange(patch); };
  for (const [key, name, sw, ink] of UI_ACCENTS) {
    const b = el('button', { type: 'button', role: 'radio', class: `accent-sw${key === 'default' ? ' accent-sw--default' : ''}`, title: name, 'aria-label': name, 'data-value': key, onclick: () => pick({ accent: key }) });
    if (sw) { b.style.setProperty('--sw', sw); b.style.setProperty('--sw-ink', ink); }
    btns.push(b); row.append(b);
  }
  // any colour: a swatch that opens the browser's colour picker
  const input = el('input', { type: 'color', class: 'accent-custom-in', value: p.accentCustom, 'aria-label': 'Pick any colour' });
  const custom = el('label', { class: 'accent-sw accent-sw--custom', title: 'Pick any colour', role: 'radio', 'data-value': 'custom', tabindex: '-1' }, input);
  const paintCustom = (hex) => { custom.style.setProperty('--sw', hex); custom.style.setProperty('--sw-ink', inkFor(hex)); };
  paintCustom(p.accentCustom);
  input.addEventListener('input', () => { paintCustom(input.value); pick({ accent: 'custom', accentCustom: input.value }); });
  btns.push(custom); row.append(custom);
  wrap.append(row, el('small', { class: 'accent-hint' }, 'The last circle opens a colour picker for any colour.'));
  mark(p.accent);
  return wrap;
}

/** Classic / Stadium toggle (for the UT Display panel; the main Settings screen has its own segmented control). */
export function uiStylePicker({ onChange = () => {} } = {}) {
  const p = uiPrefs();
  const wrap = document.createElement('div'); wrap.className = 'field';
  const lbl = document.createElement('div'); lbl.className = 'field-label'; lbl.textContent = 'Interface style';
  const row = document.createElement('div'); row.className = 'accent-stylerow'; row.setAttribute('role', 'radiogroup');
  const btns = UI_STYLES.map(([key, name]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pm-chip'; b.textContent = name; b.setAttribute('role', 'radio');
    const set = (on) => { b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); };
    set(key === p.ui);
    b.addEventListener('click', () => { write({ ui: key, uiPicked: true }); applyUiPrefs(uiPrefs()); btns.forEach(([k, x]) => x.set(k === key)); onChange({ ui: key }); });
    b.set = set; row.append(b); return [key, b];
  });
  wrap.append(lbl, row);
  return wrap;
}
