// Online lineup reveal: goalkeeper, then defence, midfield, attack, then the whole XI on a pitch.
// Pure DOM + CSS (css/lineup.css, Stadium overrides in css/theme-stadium.css). No engine or network imports:
// it is handed a team object the client already holds and a container to cover.
//
//   showLineupReveal({ team, container, shirtSVG, teamOvr, label, reduceMotion? }) -> Promise<'done'|'skipped'|'gone'>
//
// Skippable with a tap / click / any key (keys are swallowed while it shows, so they never reach the match
// underneath). Under prefers-reduced-motion it shows only the final XI, for a short beat.

const LINES = [
  { key: 'gk', label: 'Goalkeeper', pos: ['GK'], hold: 1700 },
  { key: 'def', label: 'Defence', pos: ['CB', 'LB', 'RB', 'LWB', 'RWB'], hold: 2300 },
  { key: 'mid', label: 'Midfield', pos: ['CM', 'CDM', 'CAM', 'LM', 'RM'], hold: 2300 },
  { key: 'att', label: 'Attack', pos: ['ST', 'CF', 'LW', 'RW'], hold: 2100 },
];
const FINAL_HOLD = 2000; // includes the 500 ms the pitch takes to fill
const REDUCED_HOLD = 2600;
const EXIT_MS = 280; // the row pans away (lineup.css lr-pan)
const SKIP_GUARD_MS = 350; // ignore input right after opening so the tap that started the match cannot skip it

const LEFT = new Set(['LB', 'LWB', 'LM', 'LW']);
const RIGHT = new Set(['RB', 'RWB', 'RM', 'RW']);
const lateral = (pos) => (LEFT.has(pos) ? 0 : RIGHT.has(pos) ? 2 : 1);
const ELITE = 88; // ratings at or above this get the accent colour

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

/** Group the starting XI into GK / DEF / MID / ATT (by position), each ordered left to right. */
export function groupLines(team) {
  const players = (team && Array.isArray(team.players) ? team.players : []).map((p, i) => ({ p, i }));
  return LINES.map((line) => {
    const list = players.filter(({ p }) => line.pos.includes(p.pos))
      .sort((a, b) => lateral(a.p.pos) - lateral(b.p.pos) || a.i - b.i)
      .map(({ p }) => p);
    const avg = list.length ? Math.round(list.reduce((s, p) => s + (Number(p.ovr) || 0), 0) / list.length) : 0;
    return { ...line, players: list, avg };
  }).filter((l) => l.players.length);
}

const surname = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length > 1 && parts[parts.length - 1].length > 2 ? parts[parts.length - 1] : String(name || '');
};

/**
 * Where each starter stands on the pitch. u = across (0 left .. 100 right), d = depth (0 own goal .. 100 opposition goal).
 * Teams list their XI as goalkeeper + the formation's rows in order (4-1-2-1-2 = 4, 1, 2, 1, 2), so the rows come
 * straight from the formation; if that does not add up, fall back to the position groups.
 */
export function pitchSlots(team, lines) {
  const ps = team.players;
  const nums = String(team.formation || '').split('-').map(Number);
  let rows;
  if (nums.length >= 2 && nums.every((n) => n > 0) && nums.reduce((a, b) => a + b, 0) === ps.length - 1) {
    rows = []; let at = 1;
    for (const n of nums) { rows.push(ps.slice(at, at + n)); at += n; }
  } else {
    rows = lines.filter((l) => l.key !== 'gk').map((l) => l.players);
  }
  const out = [{ p: ps[0], u: 50, d: 8 }];
  const R = rows.length;
  rows.forEach((row, ri) => {
    const sorted = row.map((p, i) => ({ p, i })).sort((a, b) => lateral(a.p.pos) - lateral(b.p.pos) || a.i - b.i);
    const n = sorted.length;
    const step = n > 1 ? Math.min(32, 84 / (n - 1)) : 0;
    const d = R > 1 ? 26 + ri * (62 / (R - 1)) : 60;
    sorted.forEach(({ p }, i) => out.push({ p, u: 50 + (i - (n - 1) / 2) * step, d }));
  });
  return out;
}

function card(p, shirtSVG, kit, i, renderCard) {
  // Owner (Sep 29): each line shows the real Ultimate Team card (design, rating, attributes) when the game can
  // draw it; the plain shirt tile stays as the fallback.
  if (renderCard) {
    let node = null;
    try { node = renderCard(p); } catch (e) { console.warn('[lineup] card render failed', e); }
    if (node) {
      // dealt face-down, then flipped over (see lineup.css lr-deal); the back is a plain branded card back
      const c = el('div', 'lr-card lr-card--full');
      c.style.setProperty('--i', String(i));
      if (Number(p.ovr) >= ELITE) c.classList.add('is-elite');
      const flip = el('div', 'lr-flip');
      const front = el('div', 'lr-face lr-front');
      front.append(node);
      const back = el('div', 'lr-face lr-back');
      back.append(el('span', 'lr-back-mark'));
      flip.append(front, back);
      c.append(flip);
      return c;
    }
  }
  const c = el('div', 'lr-card');
  c.style.setProperty('--i', String(i));
  if (Number(p.ovr) >= ELITE) c.classList.add('is-elite');
  const inner = el('div', 'lr-card-in');
  const top = el('div', 'lr-card-top');
  top.append(el('b', 'lr-ovr', p.ovr), el('span', 'lr-pos', p.pos));
  const art = el('div', 'lr-card-art');
  art.append(shirtSVG(kit, p.number, 96));
  inner.append(top, art, el('div', 'lr-name', surname(p.name)));
  c.append(inner);
  return c;
}

function pitchNode(p, shirtSVG, kit, u, d, order) {
  const n = el('div', 'lr-node');
  n.style.setProperty('--u', u.toFixed(1));
  n.style.setProperty('--d', d.toFixed(1));
  n.style.setProperty('--o', String(order));
  if (Number(p.ovr) >= ELITE) n.classList.add('is-elite');
  const art = el('div', 'lr-node-art');
  art.append(shirtSVG(kit, '', 64), el('b', 'lr-node-ovr', p.ovr));
  n.append(art, el('span', 'lr-node-name', surname(p.name)), el('span', 'lr-node-pos', p.pos));
  return n;
}

/** Pitch markings. Horizontal (goalkeeper on the left) or, for a portrait screen, vertical (goalkeeper at the bottom). */
function pitchSVG(vertical) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', vertical ? '0 0 68 105' : '0 0 105 68');
  s.setAttribute('preserveAspectRatio', 'none');
  s.setAttribute('class', `lr-pitch-lines${vertical ? ' is-v' : ' is-h'}`);
  s.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); s.append(n); };
  const rect = (x, y, w, h) => add('rect', vertical ? { x: y, y: 105 - x - w, width: h, height: w } : { x, y, width: w, height: h });
  rect(2, 2, 101, 64);
  add('line', vertical ? { x1: 2, y1: 52.5, x2: 66, y2: 52.5 } : { x1: 52.5, y1: 2, x2: 52.5, y2: 66 });
  add('circle', vertical ? { cx: 34, cy: 52.5, r: 8.6 } : { cx: 52.5, cy: 34, r: 8.6 });
  rect(2, 13.8, 16.5, 40.3); rect(2, 24.8, 5.5, 18.3);
  rect(86.5, 13.8, 16.5, 40.3); rect(95.5, 24.8, 5.5, 18.3);
  return s;
}

/**
 * @param {object} o
 * @param {object} o.team        sanitised team: { name, kit, formation, chemistry?, players:[11] }
 * @param {HTMLElement} o.container  element the overlay is appended to (covers it, position:absolute)
 * @param {(kit,number,size)=>SVGElement} o.shirtSVG
 * @param {(team)=>number} o.teamOvr
 * @param {string} [o.label]     small heading, default "Opponent lineup"
 * @param {boolean} [o.reduceMotion]
 * @param {(player)=>HTMLElement|null} [o.renderCard]  draws a full card for the line stages (null = shirt tile)
 */
export function showLineupReveal({ team, container, shirtSVG, teamOvr, label = 'Opponent lineup', reduceMotion, renderCard = null } = {}) {
  return new Promise((resolve) => {
    if (!team || !container || !Array.isArray(team.players) || !team.players.length) { resolve('gone'); return; }
    const calm = reduceMotion != null ? reduceMotion : !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const kit = team.kit || {};
    const lines = groupLines(team);
    const ovr = teamOvr ? teamOvr(team) : 0;

    const root = el('div', 'lr');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', `${label}: ${team.name}`);
    root.tabIndex = -1;
    if (calm) root.classList.add('is-calm');
    root.style.setProperty('--kit1', kit.primary || '#cccccc');
    root.style.setProperty('--kit2', kit.secondary || '#555555');

    const head = el('div', 'lr-head');
    const headText = el('div', 'lr-head-text');
    headText.append(el('span', 'lr-kicker', label), el('b', 'lr-team', team.name));
    const skip = el('span', 'lr-skip', 'Tap or press any key to skip');
    head.append(headText, skip);

    const stage = el('div', 'lr-stage');
    const pips = el('ol', 'lr-pips');
    pips.setAttribute('aria-hidden', 'true');
    const pipEls = lines.map((l) => { const li = el('li', 'lr-pip'); li.append(el('i'), el('span', null, l.label)); pips.append(li); return li; });
    const xiPip = el('li', 'lr-pip'); xiPip.append(el('i'), el('span', null, 'Starting XI')); pips.append(xiPip);
    const live = el('div', 'lr-live');
    live.setAttribute('aria-live', 'polite');
    live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);';
    const spot = el('div', 'lr-spot');
    spot.setAttribute('aria-hidden', 'true');
    root.append(spot, head, stage, pips, live);
    container.append(root);

    let timer = 0;
    let finished = false;
    const openedAt = performance.now();

    const finish = (why) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', swallow, true);
      root.removeEventListener('pointerdown', onTap);
      root.removeEventListener('click', onTap);
      root.classList.add('is-leaving');
      const gone = () => { root.remove(); resolve(why); };
      if (calm) gone(); else setTimeout(gone, 220);
    };
    const skipNow = () => { if (performance.now() - openedAt >= SKIP_GUARD_MS) finish('skipped'); };
    const onTap = (e) => { e.preventDefault(); skipNow(); };
    const swallow = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };
    function onKey(e) { swallow(e); if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) skipNow(); }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', swallow, true);
    root.addEventListener('pointerdown', onTap);
    root.addEventListener('click', onTap);
    try { root.focus({ preventScroll: true }); } catch { /* ignore */ }

    const alive = () => !finished && root.isConnected;
    const later = (fn, ms) => { timer = setTimeout(() => { if (!alive()) { finish('gone'); return; } fn(); }, ms); };
    const setPip = (idx) => {
      pipEls.concat(xiPip).forEach((p, i) => { p.classList.toggle('on', i === idx); p.classList.toggle('done', i < idx); });
    };

    // ---- one line of the XI, big cards
    const showLine = (idx) => {
      const line = lines[idx];
      setPip(idx);
      live.textContent = `${line.label}: ${line.players.map((p) => `${p.name} ${p.ovr}`).join(', ')}`;
      const wrap = el('div', 'lr-line');
      wrap.dataset.line = line.key;
      wrap.style.setProperty('--n', String(line.players.length));
      const title = el('div', 'lr-line-title');
      const avgEl = el('span', 'lr-line-avg', calm ? line.avg : 0);
      title.append(el('span', 'lr-line-name', line.label), avgEl, el('small', 'lr-line-lbl', 'Line rating'));
      if (!calm) {
        const t0 = performance.now() + 150, dur = 650;
        const tick = (now) => {
          if (!alive() || !avgEl.isConnected) return;
          const k = Math.max(0, Math.min(1, (now - t0) / dur));
          avgEl.textContent = String(Math.round(line.avg * (1 - Math.pow(1 - k, 3))));
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
      const row = el('div', 'lr-cards');
      line.players.forEach((p, i) => row.append(card(p, shirtSVG, line.key === 'gk' ? (team.gkKit || kit) : kit, i, renderCard)));
      wrap.append(title, row);
      stage.replaceChildren(wrap);
      later(() => {
        wrap.classList.add('is-out');
        later(() => (idx + 1 < lines.length ? showLine(idx + 1) : showFinal()), EXIT_MS);
      }, line.hold);
    };

    // ---- the whole XI on a pitch, with the team name and rating
    const showFinal = () => {
      setPip(lines.length);
      root.classList.add('is-final');
      live.textContent = `${team.name}, rating ${ovr}, ${team.formation || ''}`;
      const wrap = el('div', 'lr-final');
      const info = el('div', 'lr-info');
      info.append(el('span', 'lr-info-lbl', 'Starting XI'), el('h2', 'lr-info-name', team.name));
      const stats = el('div', 'lr-stats');
      const stat = (v, l) => { const s = el('div', 'lr-stat'); s.append(el('b', null, v), el('span', null, l)); return s; };
      stats.append(stat(ovr, 'Rating'), stat(team.formation || '-', 'Formation'));
      if (Number.isFinite(team.chemistry)) stats.append(stat(team.chemistry, 'Chemistry'));
      info.append(stats, el('p', 'lr-go', 'Kick-off next'));
      const box = el('div', 'lr-pitchbox');
      const pitch = el('div', 'lr-pitch');
      box.append(pitch);
      pitch.append(pitchSVG(false), pitchSVG(true));
      const field = el('div', 'lr-field');
      let order = 0;
      for (const node of pitchSlots(team, lines)) {
        field.append(pitchNode(node.p, shirtSVG, node.p.pos === 'GK' ? (team.gkKit || kit) : kit, node.u, node.d, order++));
      }
      pitch.append(field);
      wrap.append(info, box);
      stage.replaceChildren(wrap);
      later(() => finish('done'), calm ? REDUCED_HOLD : FINAL_HOLD);
    };

    if (calm || !lines.length) showFinal(); else showLine(0);
  });
}
