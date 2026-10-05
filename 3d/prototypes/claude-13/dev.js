// Prototype 13: DEV MODE (owner, Oct 5): "a dev setting where you can alter everything about the game: chances of
// everything, the colors, dialogue, difficulty", plus an uploaded picture for each phase of the boss and the hero.
// Everything is saved in this browser (localStorage 'p13dev') as overrides on top of the defaults below, and applied
// before each fight. Empty field = the default.
import { STAGES, MODES, ABIL, ABIL_ORDER, FIN, FIN_NAMES, MISS, TUNE } from './sim.js?v=13z';
import { SCRIPT } from './script.js?v=13z';
import { P, CUSTOM } from './render.js?v=13z';

const KEY = 'p13dev';
const ROOTS = { STAGES, MODES, ABIL, FIN, FIN_NAMES, MISS, TUNE, SCRIPT, P };
const DEF = JSON.parse(JSON.stringify(ROOTS)); // the shipped values, for placeholders and RESET
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const set = (o, path, v) => { const ks = path.split('.'), last = ks.pop(), t = ks.reduce((a, k) => a[k], o); t[last] = v; };
let cfg = load();
function load() { try { const c = JSON.parse(localStorage.getItem(KEY) || '{}'); return { v: c.v || {}, img: c.img || {} }; } catch { return { v: {}, img: {} }; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); return true; } catch { return false; } }

// put every override on the live objects (the defaults first, so a cleared field goes back)
export function applyDev() {
  for (const path of Object.keys(cfg.v)) if (get(DEF, path) === undefined) delete cfg.v[path];
  walkDefaults((path) => set(ROOTS, path, cfg.v[path] ?? get(DEF, path)));
  for (const who of ['boss', 'hero']) for (const n of [1, 2, 3]) {
    const src = cfg.img[who + n];
    if (!src) { delete CUSTOM[who][n]; continue; }
    if (CUSTOM[who][n]?.src !== src) { const im = new Image(); im.src = src; CUSTOM[who][n] = im; }
  }
}
function walkDefaults(fn) { for (const sec of sections()) for (const g of sec.groups) for (const f of g.fields) fn(f.path); }

// ------------------------------------------------------------------ what can be edited
const PH = [1, 2, 3], PHN = (n) => n === 3 ? 'SECRET PHASE' : 'PHASE ' + n;
function dialogueFields() {
  const out = [], line = (path, label) => out.push({ path, label, type: 'text', long: true });
  const scene = (key, title) => (SCRIPT[key] || []).forEach((l, i) => line(`SCRIPT.${key}.${i}.text`, `${title} ${i + 1} · ${l.name || (l.who === 'boss' ? 'BOSS' : 'HERO')}`));
  const groups = [];
  const g = (title, fill) => { out.length = 0; fill(); groups.push({ title, fields: out.slice() }); };
  g('INTRO', () => scene('intro', 'Line'));
  g('PHASE 2 START', () => scene('reborn', 'Line'));
  g('BEFORE THE PHASE 2 CLASH', () => scene('domain', 'Line'));
  g('SECRET PHASE START', () => scene('totality', 'Line'));
  for (const n of PH) g(`CLASH ${n}: STOP-AND-READ`, () => (SCRIPT.clashBeats?.[n] || []).forEach((l, i) => line(`SCRIPT.clashBeats.${n}.${i}.text`, `Line ${i + 1} · ${l.who === 'boss' ? 'BOSS' : 'HERO'}`)));
  for (const n of PH) g(`CLASH ${n}: SHOUTS WHILE PUSHING`, () => { (SCRIPT.push?.[n] || []).forEach((l, i) => line(`SCRIPT.push.${n}.${i}.text`, `Push ${i + 1} · ${l.who === 'boss' ? 'BOSS' : 'HERO'}`)); (SCRIPT.struggle?.[n] || []).forEach((l, i) => line(`SCRIPT.struggle.${n}.${i}.text`, `Struggle ${i + 1} · ${l.who === 'boss' ? 'BOSS' : 'HERO'}`)); });
  g('BOSS LINES WHEN A SURVIVE BOX OPENS', () => (SCRIPT.boxLines || []).forEach((_, i) => line(`SCRIPT.boxLines.${i}`, `Box line ${i + 1}`)));
  return groups;
}
function sections() {
  const num = (path, label, step = 1, min = 0) => ({ path, label, type: 'num', step, min });
  const pct = (path, label) => ({ path, label, type: 'pct' }); // stored 0..1, shown as %
  const col = (path, label) => ({ path, label, type: 'color' });
  const txt = (path, label) => ({ path, label, type: 'text' });
  return [
    { id: 'look', title: 'LOOK', groups: [
      { title: 'PICTURES (PNG WITH A SEE-THROUGH BACKGROUND LOOKS BEST)', fields: [], images: true },
      { title: 'CAMERA', fields: [num('TUNE.view', 'Camera zoom (smaller = everything smaller)', .05, .5)] },
      ...PH.map((n) => ({ title: `${PHN(n)} COLOURS`, fields: [col(`P.${n}.hero`, 'Hero and ability colour'), col(`P.${n}.bar`, 'Boss health bar'), col(`P.${n}.name`, 'Boss name'), col(`P.${n}.tele`, 'Attack warnings'), col(`P.${n}.boss`, 'Boss accent')] })),
    ] },
    { id: 'names', title: 'NAMES', groups: [
      { title: 'BOSS AND HERO NAMES', fields: PH.flatMap((n) => [txt(`STAGES.${n}.boss`, `Boss · ${PHN(n)}`), txt(`STAGES.${n}.hero`, `Hero · ${PHN(n)}`)]) },
      ...PH.map((n) => ({ title: `ABILITY NAMES · ${PHN(n)}`, fields: ABIL_ORDER.map((a, i) => txt(`ABIL.${a}.names.${n}`, `Key ${i + 1}`)) })),
      { title: 'FINISHER NAMES', fields: FIN_NAMES.map((_, i) => txt(`FIN_NAMES.${i}`, `Finisher ${i + 1}`)) },
    ] },
    { id: 'talk', title: 'DIALOGUE', groups: dialogueFields() },
    { id: 'diff', title: 'DIFFICULTY', groups: [
      ...PH.map((n) => ({ title: `BOSS · ${PHN(n)}`, fields: [num(`STAGES.${n}.bossHp`, 'Boss HP', 100, 1), num(`STAGES.${n}.dmg`, 'Boss damage ×', .05), num(`STAGES.${n}.speed`, 'Boss attack speed ×', .05, .1), num(`STAGES.${n}.gap`, 'Seconds between attacks', .05, .1), pct(`STAGES.${n}.dodge`, 'Boss dodge chance')] })),
      { title: 'HERO', fields: [num('TUNE.heroMax', 'Hero max HP', 5, 1), num('TUNE.heal', 'HP per heal', 1), num('TUNE.heals', 'Heals per phase', 1), num('TUNE.healCap', 'Most heals you can hold', 1), num('TUNE.slashDmg', 'Slash damage ×', .1), num('TUNE.abilDmg', 'Ability damage ×', .1), num('TUNE.abilCd', 'Ability cooldown ×', .1, .05)] },
      ...['normal', 'hard', 'extreme'].map((m) => ({ title: `MODE · ${m.toUpperCase()}`, fields: [num(`MODES.${m}.hp`, 'Boss HP ×', .05, .05), num(`MODES.${m}.dmg`, 'Boss damage ×', .05), num(`MODES.${m}.speed`, 'Boss speed ×', .05, .1), num(`MODES.${m}.dodge`, 'Boss dodge ×', .1)] })),
    ] },
    { id: 'odds', title: 'CHANCES', groups: [
      { title: 'FINISHERS', fields: [...PH.map((n) => pct(`FIN.chance.${n}`, `Finisher chance per hit · ${PHN(n)}`)), pct('TUNE.hell', 'STAR OF HELL chance'), num('FIN.mult', 'Finisher damage ×', .5), num('FIN.cooldown', 'Seconds between finishers', 1), ...PH.map((n) => num(`FIN.qte.${n}`, `Seconds to type the keys · ${PHN(n)}`, .1, .5))] },
      { title: 'MISS CHANCE OF YOUR ATTACKS', fields: Object.keys(MISS).map((k) => pct(`MISS.${k}`, k.toUpperCase())) },
    ] },
    { id: 'abil', title: 'ABILITIES', groups: PH.map((n) => ({ title: `${PHN(n)} · DAMAGE AND COOLDOWN`, fields: ABIL_ORDER.flatMap((a) => [num(`ABIL.${a}.dmg.${n}`, `${DEF.ABIL[a].names[n]} damage`, 1), num(`ABIL.${a}.cd.${n}`, `${DEF.ABIL[a].names[n]} cooldown (s)`, .1, .05)]) })) },
  ];
}

// ------------------------------------------------------------------ the screen
export function openDev(onClose) {
  const root = document.getElementById('dev');
  let tab = 'look';
  const close = () => { applyDev(); root.hidden = true; root.replaceChildren(); onClose && onClose(); };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const status = el('div', 'devStatus');
  const say = (t) => { status.textContent = t; };
  function draw() {
    root.replaceChildren();
    const head = el('div', 'devHead');
    head.append(el('h2', '', 'DEV MODE'), el('p', 'devNote', 'Changes save in this browser and apply from the next fight. Leave a field empty for the default.'));
    const tabs = el('div', 'devTabs');
    for (const sec of sections()) { const b = el('button', 'devTab' + (sec.id === tab ? ' on' : ''), sec.title); b.type = 'button'; b.onclick = () => { tab = sec.id; draw(); }; tabs.append(b); }
    const body = el('div', 'devBody');
    const sec = sections().find((x) => x.id === tab);
    for (const g of sec.groups) {
      const box = el('section', 'devGroup'); box.append(el('h3', '', g.title));
      if (g.images) box.append(imageGrid());
      const grid = el('div', 'devGrid');
      for (const f of g.fields) grid.append(field(f));
      if (g.fields.length) box.append(grid);
      body.append(box);
    }
    const foot = el('div', 'devFoot');
    const btn = (t, fn, cls = 'ghost') => { const b = el('button', cls, t); b.type = 'button'; b.onclick = fn; foot.append(b); return b; };
    btn('DONE', close, 'big');
    btn('RESET THIS TAB', () => { walkSection(sec, (p) => delete cfg.v[p]); if (tab === 'look') cfg.img = {}; save(); applyDev(); draw(); say('This tab is back to the defaults.'); });
    btn('RESET EVERYTHING', () => { if (!confirm('Reset every dev change, pictures included?')) return; cfg = { v: {}, img: {} }; save(); applyDev(); draw(); say('Everything is back to the defaults.'); });
    btn('EXPORT', () => { const a = el('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg)], { type: 'application/json' })); a.download = 'eclipse-dev-settings.json'; a.click(); });
    btn('IMPORT', () => { const inp = el('input'); inp.type = 'file'; inp.accept = 'application/json,.json'; inp.onchange = async () => { try { const c = JSON.parse(await inp.files[0].text()); cfg = { v: c.v || {}, img: c.img || {} }; say(save() ? 'Imported.' : 'Imported, but too big to keep after a reload.'); applyDev(); draw(); } catch { say('That file is not a dev settings file.'); } }; inp.click(); });
    foot.append(status);
    root.append(head, tabs, body, foot);
    tabs.querySelector('.on')?.focus();
  }
  function walkSection(sec, fn) { for (const g of sec.groups) for (const f of g.fields) fn(f.path); }
  function field(f) {
    const wrap = el('label', 'devField' + (f.long ? ' long' : '')), lab = el('span', 'devLabel', f.label), def = get(DEF, f.path);
    let inp;
    if (f.type === 'color') { inp = el('input'); inp.type = 'color'; inp.value = cfg.v[f.path] ?? def; }
    else if (f.long) { inp = el('textarea'); inp.rows = 2; inp.placeholder = def; inp.value = cfg.v[f.path] ?? ''; }
    else { inp = el('input'); inp.type = f.type === 'text' ? 'text' : 'number'; if (f.type !== 'text') { inp.step = f.type === 'pct' ? 1 : f.step; inp.min = f.type === 'pct' ? 0 : f.min; if (f.type === 'pct') inp.max = 100; inp.inputMode = 'decimal'; }
      const shown = (v) => f.type === 'pct' ? +(v * 100).toFixed(2) : v;
      inp.placeholder = shown(def); inp.value = cfg.v[f.path] != null ? shown(cfg.v[f.path]) : ''; }
    const changed = cfg.v[f.path] != null; if (changed) wrap.classList.add('changed');
    inp.addEventListener(f.type === 'color' ? 'input' : 'change', () => {
      const raw = inp.value.trim();
      if (raw === '' || (f.type === 'color' && raw.toLowerCase() === String(def).toLowerCase())) delete cfg.v[f.path];
      else if (f.type === 'num' || f.type === 'pct') { let v = Number(raw); if (!Number.isFinite(v)) { inp.value = ''; delete cfg.v[f.path]; } else { if (f.type === 'pct') v = Math.min(100, Math.max(0, v)) / 100; else v = Math.max(f.min ?? 0, v); cfg.v[f.path] = v; } }
      else cfg.v[f.path] = raw;
      wrap.classList.toggle('changed', cfg.v[f.path] != null);
      say(save() ? 'Saved.' : 'Could not save: this browser is out of space.'); applyDev();
    });
    inp.addEventListener('keydown', (e) => e.stopPropagation()); // typing here never moves the hero or pauses
    wrap.append(lab, inp);
    return wrap;
  }
  function imageGrid() {
    const grid = el('div', 'devImgs');
    for (const who of ['boss', 'hero']) for (const n of PH) {
      const k = who + n, cell = el('div', 'devImg'), pic = el('div', 'devPic');
      if (cfg.img[k]) { const im = el('img'); im.src = cfg.img[k]; im.alt = ''; pic.append(im); } else pic.append(el('span', '', 'DEFAULT'));
      const up = el('button', 'ghost', cfg.img[k] ? 'CHANGE' : 'UPLOAD'); up.type = 'button';
      up.onclick = () => { const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { cfg.img[k] = await shrink(f); say(save() ? 'Picture saved.' : 'Picture too big to keep: try a smaller one.'); applyDev(); draw(); } catch { say('Could not read that picture.'); } }; inp.click(); };
      cell.append(el('div', 'devImgT', `${who === 'boss' ? 'BOSS' : 'HERO'} · ${PHN(n)}`), pic, up);
      if (cfg.img[k]) { const rm = el('button', 'ghost', 'REMOVE'); rm.type = 'button'; rm.onclick = () => { delete cfg.img[k]; save(); applyDev(); draw(); say('Picture removed.'); }; cell.append(rm); }
      grid.append(cell);
    }
    return grid;
  }
  root.hidden = false; draw();
}
// keep saves small: longest side 512 px, PNG keeps a see-through background
function shrink(file) {
  return new Promise((res, rej) => { const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { const s = Math.min(1, 512 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/png')); };
    im.onerror = rej; im.src = url; });
}
