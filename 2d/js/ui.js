// DOM menus: main menu, team select, settings (with key rebinding), how-to-play,
// pause, full-time stats and World Cup hub.
import { TEAMS, teamByCode, chooseKits } from './data.js';
import { ACTIONS, ACTION_LABELS, keyLabel, setBind, defaultBinds } from './keybinds.js';
import { input, applyBinds } from './input.js';
import { settings, saveSettings, GAMEPLAY_OPTIONS, GAMEPLAY_DEFAULTS } from './settings.js';
import { setMuted, sfx } from './audio.js';
import { standings, STAGE_LABEL, resultFor } from './tournament.js';

const root = () => document.getElementById('ui');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function hideUI() { const r = root(); r.innerHTML = ''; r.className = 'hidden'; }

function show(html, cls = '') {
  const r = root();
  r.className = 'screen ' + cls;
  r.innerHTML = html;
  r.scrollTop = 0;
  return r;
}

function on(r, sel, fn) { r.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => { sfx('click'); fn(e, el); })); }

// ---------- kit icons ----------
const iconCache = new Map();
export function kitIcon(kit, num = 10, size = 56) {
  const key = JSON.stringify(kit) + num + size;
  if (iconCache.has(key)) return iconCache.get(key);
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const g = c.getContext('2d');
  const s = size / 56;
  g.scale(s, s);
  const shirt = new Path2D('M18 6 L24 9 Q28 12 32 9 L38 6 L50 14 L45 24 L40 21 L40 50 L16 50 L16 21 L11 24 L6 14 Z');
  g.fillStyle = kit.shirt; g.fill(shirt);
  g.save(); g.clip(shirt);
  g.fillStyle = kit.sec;
  if (kit.pattern === 'stripes') for (let x = 14; x < 44; x += 8) g.fillRect(x, 0, 4, 56);
  else if (kit.pattern === 'checks') for (let x = 0; x < 56; x += 6) for (let y = 0; y < 56; y += 6) if (((x + y) / 6) % 2 === 0) g.fillRect(x, y, 6, 6);
  else { g.fillRect(6, 13, 8, 5); g.fillRect(42, 13, 8, 5); g.fillRect(22, 6, 12, 3); }
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.2; g.stroke(shirt);
  g.fillStyle = kit.num; g.font = 'bold 15px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), 28, 32);
  g.fillStyle = kit.shorts; g.fillRect(18, 51, 20, 4);
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

const stars = (r) => '★'.repeat(Math.max(1, Math.round((r - 60) / 6))).padEnd(5, '☆');

// ---------- main menu ----------
export function showMenu(h) {
  const r = show(`
    <div class="menu">
      <div class="logo"><span class="l1">TOUCHLINE</span><span class="l2">INTERNATIONAL SOCCER</span></div>
      <div class="menu-buttons">
        <button data-go="quick" class="primary">Quick Match</button>
        <button data-go="worldcup">World Cup</button>
        <button data-go="shootout">Penalty Shootout</button>
        <button data-go="fkpractice">Free-Kick Practice</button>
        <button data-go="cornerpractice">Corner Practice</button>
        <button data-go="versus">Local 2 Players</button>
        <button data-go="tutorial">Tutorial</button>
        <button data-go="howto">How to Play</button>
        <button data-go="settings">Settings</button>
      </div>
      <div class="foot">7-a-side · ${TEAMS.length} nations · Shot assist: ${esc(settings.gameplay.p1.shot)} · Passing: ${esc(settings.gameplay.p1.passGround)} · ${esc(settings.difficulty)}</div>
    </div>`, 'menu-screen');
  on(r, '[data-go]', (e, el) => h[el.dataset.go]());
}

// ---------- team select ----------
/**
 * mode: quick | versus | coop | worldcup | shootout | fkpractice
 * cb({home, away, coop}) with team objects.
 */
export function showTeamSelect(mode, cb, back) {
  const sides = mode === 'worldcup' || mode === 'fkpractice' || mode === 'cornerpractice' ? 1 : 2;
  let sel = [TEAMS[0], TEAMS[1]];
  let active = 0;
  let coop = false;
  const labels = mode === 'versus' ? ['P1', 'P2'] : ['YOU', 'CPU'];
  const title = { quick: 'Quick Match', versus: 'Local 2 Players', worldcup: 'World Cup — pick your nation', shootout: 'Penalty Shootout', fkpractice: 'Free-Kick Practice — pick your kit', cornerpractice: 'Corner Practice — pick your team', coop: 'Co-op' }[mode];
  const render = () => {
    const k = chooseKits(sel[0], sel[1]);
    const panel = (i) => `
      <div class="side ${active === i ? 'active' : ''}" data-side="${i}">
        <div class="side-label">${i === 0 ? (coop ? 'P1 + P2' : labels[0]) : labels[1]}${active === i ? ' · choosing' : ''}</div>
        <img src="${kitIcon(sides === 2 ? k.kits[i] : sel[i].home, i === 0 ? 10 : 9, 72)}" alt="">
        <div class="side-name">${esc(sel[i].name)}</div>
        <div class="stars">${stars(sel[i].rating)} <small>${sel[i].rating}</small></div>
        ${sides === 2 && i === 1 && k.awayUsesAway ? '<div class="note">Away kit (colour clash)</div>' : ''}
      </div>`;
    const r = show(`
      <div class="panel wide">
        <h2>${esc(title)}</h2>
        <div class="sides">${panel(0)}${sides === 2 ? '<div class="vs">VS</div>' + panel(1) : ''}</div>
        ${mode === 'versus' ? `<label class="chk"><input type="checkbox" id="coop" ${coop ? 'checked' : ''}> Co-op: P1 + P2 together vs CPU</label>` : ''}
        <div class="team-grid">
          ${TEAMS.map((t) => `<button class="team ${sel[active] === t ? 'sel' : ''}" data-code="${t.code}" title="${esc(t.name)}">
             <img src="${kitIcon(t.home, 10, 40)}" alt=""><span>${esc(t.name)}</span><small>${t.rating}</small></button>`).join('')}
        </div>
        <div class="row">
          <button data-act="back">Back</button>
          ${sides === 2 ? '<button data-act="random">Random opponent</button>' : ''}
          <button data-act="start" class="primary">Start</button>
        </div>
      </div>`);
    on(r, '[data-side]', (e, el) => { active = +el.dataset.side; render(); });
    on(r, '[data-code]', (e, el) => {
      sel[active] = teamByCode(el.dataset.code);
      if (sides === 2 && sel[0] === sel[1]) sel[1 - active] = TEAMS.find((t) => t !== sel[active]);
      if (sides === 2 && active === 0) active = 1;
      render();
    });
    on(r, '[data-act=back]', () => back());
    on(r, '[data-act=random]', () => { const pool = TEAMS.filter((t) => t !== sel[0]); sel[1] = pool[(Math.random() * pool.length) | 0]; render(); });
    on(r, '[data-act=start]', () => cb({ home: sel[0], away: sel[1], coop }));
    const cb2 = r.querySelector('#coop');
    if (cb2) cb2.addEventListener('change', () => { coop = cb2.checked; render(); });
  };
  render();
}

// ---------- settings ----------
/** Gameplay settings shown per player, grouped like FIFA's controller settings. */
const GP_GROUPS = [
  ['Passing', [
    ['passGround', 'Ground pass', { Assisted: 'Picks the team-mate nearest your aim (wide cone), auto power, leads him — only an interception stops it.', Semi: 'Narrower cone, the aim matters more; hold longer for a firmer pass; small skill-based error.', Manual: 'No targeting: exactly where you aim with the power you hold.' }],
    ['passThrough', 'Through ball', { Assisted: 'Played into space ahead of the runner your aim picks, perfectly weighted.', Semi: 'Narrower cone; hold time sets the weight of the ball.', Manual: 'Straight along your aim with the power you hold.' }],
    ['passLob', 'Lob / cross', { Assisted: 'Lofted onto the team-mate nearest your aim, landing in his stride.', Semi: 'Narrower cone; hold time sets the distance.', Manual: 'Lands where you aim; hold time sets the distance.' }],
  ]],
  ['Shooting', [
    ['shot', 'Shot assistance', { Assisted: 'Aim roughly at goal and the shot is always on target.', Precision: 'Exactly where you aim; on target it is faster and more accurate.', Manual: 'Exactly where you aim, full error from skill, power and pressure.' }],
    ['timedFinishing', 'Timed finishing', 'Tap Shoot again as the foot meets the ball: green = better shot, red = worse.'],
    ['shotError', 'Shot error realism', 'On: skill, sprinting and pressure affect accuracy. Off: only power does.'],
  ]],
  ['Defending', [
    ['defending', 'AI defending', { Assisted: 'The nearest team-mate presses or contains the carrier for you; others cut passing lanes.', Tactical: 'You do the work: team-mates hold shape and only contain when you are far away.' }],
    ['autoMarking', 'Auto marking', 'Team-mates track runners man-to-man (off: they hold their zones).'],
    ['autoTackle', 'Auto tackle', 'Your player pokes the ball away by himself when it is clearly there to win.'],
    ['autoClear', 'Auto clearances', 'In your own box under pressure your player clears first time.'],
  ]],
  ['Switching', [
    ['autoSwitch', 'Auto switching', { Auto: 'Switches to the best-placed player while defending and for high balls.', Air: 'Only switches for high balls (crosses, clearances, lobs).', Manual: 'Only when you press Switch (and to your pass receiver).' }],
    ['switchIndicator', 'Switch indicator', 'Marks the player the Switch button will select next.'],
    ['receiverLock', 'Pass receiver lock', 'Stay locked on the pass receiver until the ball arrives (no switching away).'],
  ]],
];

export function showSettings(back, inGame = false) {
  let note = '';
  let gpPl = 'p1';
  const render = () => {
    const opt = (v, cur, label = v) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
    const bindRows = (pl) => ACTIONS.filter((a) => !(pl === 'p2' && a === 'pause')).map((a) => `
      <div class="bind"><span>${esc(ACTION_LABELS[a])}</span>
        <button class="key" data-pl="${pl}" data-a="${a}">${esc(keyLabel(input.binds[pl][a]))}</button></div>`).join('');
    const r = show(`
      <div class="panel wide settings">
        <h2>Settings</h2>
        <div class="grid2">
          <label class="set"><span>Match length</span><select id="sLen">${[2, 4, 6, 8, 10].map((v) => opt(v, settings.matchMinutes, `${v} min`)).join('')}</select></label>
          <label class="set"><span>Difficulty</span><select id="sDiff">${['Easy', 'Normal', 'Hard', 'Legend'].map((v) => opt(v, settings.difficulty)).join('')}</select></label>
          <label class="set"><span>Penalty power</span><select id="sPen">${opt('hold', settings.penaltyPower, 'Hold to charge')}${opt('slider', settings.penaltyPower, 'Slider + KICK')}</select></label>
          <label class="set"><span>Camera zoom <b id="zv">${settings.zoom.toFixed(2)}</b></span><input id="sZoom" type="range" min="0.7" max="1.5" step="0.05" value="${settings.zoom}"></label>
          <label class="set"><span>Sound</span><input id="sSound" type="checkbox" ${settings.sound ? 'checked' : ''}></label>
          <label class="set"><span>Show aim line</span><input id="sAim" type="checkbox" ${settings.aimLine ? 'checked' : ''}></label>
        </div>
        <h3>Gameplay <small>assists are saved per player and apply immediately</small></h3>
        <div class="gptabs"><button data-gp="p1" class="${gpPl === 'p1' ? 'sel' : ''}">Player 1</button><button data-gp="p2" class="${gpPl === 'p2' ? 'sel' : ''}">Player 2</button><button data-act="gpreset">Defaults</button></div>
        <div class="gpgroups">${GP_GROUPS.map(([title, rows]) => `<div class="gpg"><h4>${esc(title)}</h4>${rows.map(([k, label, desc]) => {
          const g = settings.gameplay[gpPl];
          const ctl = GAMEPLAY_OPTIONS[k]
            ? `<select data-gpk="${k}">${GAMEPLAY_OPTIONS[k].map((v) => opt(v, g[k], v === 'Air' ? 'Air balls only' : v === 'Semi' ? 'Semi-assisted' : v)).join('')}</select>`
            : `<input type="checkbox" data-gpk="${k}" ${g[k] ? 'checked' : ''}>`;
          const d = typeof desc === 'string' ? desc : desc[g[k]];
          return `<label class="gprow"><span class="gpl">${esc(label)}</span>${ctl}<small>${esc(d)}</small></label>`;
        }).join('')}</div>`).join('')}</div>
        <h3>Controls <small>click a key, then press the new key (Esc cancels). Conflicts are swapped.</small></h3>
        <div class="binds"><div><h4>Player 1</h4>${bindRows('p1')}<p class="hint">Also: left mouse = pass, mouse = aim.</p></div><div><h4>Player 2</h4>${bindRows('p2')}</div></div>
        <div class="note" id="bindNote">${esc(note)}</div>
        <div class="row"><button data-act="reset">Reset controls to defaults</button><button data-act="back" class="primary">Done</button></div>
      </div>`);
    const upd = (id, fn) => r.querySelector(id).addEventListener('change', (e) => { fn(e.target); saveSettings(); render(); });
    upd('#sLen', (t) => { settings.matchMinutes = +t.value; });
    upd('#sDiff', (t) => { settings.difficulty = t.value; });
    r.querySelectorAll('[data-gpk]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.gpk;
      settings.gameplay[gpPl][k] = el.type === 'checkbox' ? el.checked : el.value;
      saveSettings(); render();
    }));
    on(r, '[data-gp]', (e, el) => { gpPl = el.dataset.gp; render(); });
    on(r, '[data-act=gpreset]', () => { settings.gameplay[gpPl] = { ...GAMEPLAY_DEFAULTS }; saveSettings(); note = `${gpPl.toUpperCase()} gameplay settings reset.`; render(); });
    upd('#sSound', (t) => { settings.sound = t.checked; setMuted(!t.checked); });
    upd('#sAim', (t) => { settings.aimLine = t.checked; });
    upd('#sPen', (t) => { settings.penaltyPower = t.value; });
    const z = r.querySelector('#sZoom');
    z.addEventListener('input', () => { settings.zoom = +z.value; r.querySelector('#zv').textContent = settings.zoom.toFixed(2); saveSettings(); });
    on(r, '.key', (e, el) => {
      r.querySelectorAll('.key').forEach((k) => k.classList.remove('waiting'));
      el.classList.add('waiting'); el.textContent = 'Press a key…';
      const pl = el.dataset.pl, a = el.dataset.a;
      input.capture = (code) => {
        if (code === 'Escape') { note = 'Rebinding cancelled.'; render(); return; }
        const res = setBind(input.binds, pl, a, code);
        applyBinds(res.binds);
        note = res.swapped
          ? `${keyLabel(code)} was used by ${res.conflict.player.toUpperCase()} "${ACTION_LABELS[res.conflict.action]}" — swapped (it now uses ${keyLabel(res.binds[res.conflict.player][res.conflict.action])}).`
          : `${pl.toUpperCase()} ${ACTION_LABELS[a]} → ${keyLabel(code)} (saved)`;
        render();
      };
    });
    on(r, '[data-act=reset]', () => { applyBinds(defaultBinds()); note = 'Controls reset to defaults.'; render(); });
    on(r, '[data-act=back]', () => { input.capture = null; back(); });
  };
  render();
}

// ---------- how to play ----------
export function showHowTo(back) {
  const b1 = input.binds.p1, b2 = input.binds.p2;
  const row = (a) => `<tr><td>${esc(ACTION_LABELS[a])}</td><td><kbd>${esc(keyLabel(b1[a]))}</kbd>${a === 'pass' ? ' / left click' : ''}</td><td><kbd>${esc(keyLabel(b2[a]))}</kbd></td></tr>`;
  const r = show(`
    <div class="panel wide howto">
      <h2>How to Play</h2>
      <table class="ctl"><tr><th>Action</th><th>Player 1</th><th>Player 2</th></tr>${ACTIONS.map(row).join('')}</table>
      <div class="cols">
        <div>
          <h3>Attacking</h3>
          <ul>
            <li><b>Aim</b> with the mouse. If you haven't moved the mouse recently, aim follows your movement direction (keyboard-only play).</li>
            <li><b>Pass</b> (Assisted) picks the best teammate near your aim, weighs up interceptions, leads him and zips it firmly to his feet. <b>Semi</b>: narrower cone, hold for power. <b>Manual</b>: exactly along your aim with the power you hold. Control switches to the receiver, who runs onto the ball unless you clearly steer away. Separate settings for ground / through / lob.</li>
            <li><b>Through ball</b> plays into space ahead of a runner; <b>Lob</b> lofts it over the defence.</li>
            <li><b>Shoot</b>: hold to fill the power bar, release. Past the white mark = <b>Rocket</b> (fast but wild). While holding, tap <b>Lob</b> for a <b>chip</b> or <b>Through</b> for a <b>finesse</b> curler. Hold shoot as a ball arrives for a first-time <b>volley / header</b>.</li>
            <li>The dashed line + reticle on the goal mouth show where the shot will go (green = on target).</li>
            <li><b>Skill move</b>: no direction = step-over, sideways = roulette, backwards = drag-back, while sprinting = heel flick. Timed well, standing tackles can't touch you.</li>
          </ul>
          <h3>Shooting assist (Settings)</h3>
          <ul><li><b>Assisted</b>: broadly towards goal = always on target.</li><li><b>Precision</b>: exact aim; on target gives less error and +10% pace.</li><li><b>Manual</b>: exact aim, error from shooting skill, power, sprinting and pressure.</li><li><b>Timed finishing</b> (optional): tap Shoot again as the closing ring meets the player — green = better strike, red = worse.</li></ul>
        </div>
        <div>
          <h3>Defending</h3>
          <ul>
            <li><b>Standing tackle</b>: short poke. <b>Slide tackle</b>: long reach, you're committed and need time to get up.</li>
            <li>Win the ball first from the front = always clean, and shoulder-to-shoulder challenges are fair. Going through the man before the ball, or lunging in from behind (&gt;120°) on the player in possession and missing the ball = foul. Slide from behind = yellow card; two yellows = red.</li>
            <li><b>Jockey</b> (hold): face the carrier and side-step; with no direction your defender stays goal-side of him. On the ball the same key <b>shields</b> it with your body.</li>
            <li>Running alongside the carrier you can win a <b>shoulder challenge</b> — strength decides it.</li>
            <li><b>Switch</b> selects the teammate closest to the ball (the dashed ring shows who). Auto switching, AI defending, auto marking / tackle / clearances are in Settings.</li>
          </ul>
          <h3>Set pieces</h3>
          <ul>
            <li>Corners, goal kicks, throw-ins, indirect free kicks: aim the reticle (mouse or move keys), hold <b>Shoot</b> for power and release; <b>Pass</b> plays it short; <b>Lob</b>/<b>Through</b> add curve. The predicted flight is drawn.</li>
            <li>Direct free kicks near goal and penalties switch to a first-person view: aim the reticle on the goal, hold for power (or use the slider + KICK). Too much power can fly over the bar; aiming at the posts is risky. Free kicks add curve (Lob/Through) and type (Skill: driven / dipping / knuckle).</li>
            <li>As the keeper in a penalty: choose a spot and press Shoot/click to dive. Dive too early and the taker may see it.</li>
          </ul>
          <h3>Mobile</h3>
          <ul><li>Drag anywhere on the left half for the joystick. Buttons on the right: hold SHOOT to charge. Aim follows the joystick. In penalty / free-kick views drag to aim and use HOLD or the slider.</li></ul>
          <h3>Modes</h3>
          <ul>
            <li><b>Quick Match</b> vs the CPU, <b>World Cup</b> (16 nations, groups + knockouts, saved automatically), <b>Local 2 Players</b> (versus or co-op on one keyboard).</li>
            <li><b>Penalty Shootout</b>: first-person, you shoot and you keep. <b>Free-Kick Practice</b>: N = new spot, P = place the ball, curve + type, streaks. <b>Corner Practice</b>: endless corners against a live defence.</li>
          </ul>
          <h3>Other</h3>
          <ul><li>Stamina drains while sprinting; at full sprint you can't turn on the spot. Fast balls, sprinting and pressure make first touches heavier. Tap <b>Pass</b> during a throw-in / free-kick whistle to take it quickly. Esc pauses (match facts + instant replay). Replays and kick results can be skipped with any key.</li></ul>
        </div>
      </div>
      <div class="row"><button data-act="back" class="primary">Back</button></div>
    </div>`);
  on(r, '[data-act=back]', () => back());
}

// ---------- pause ----------
/** Compact match facts for the pause menu. */
function matchFacts(m) {
  const s = m.stats;
  const tot = s[0].poss + s[1].poss || 1;
  const pc = (t) => (s[t].passAtt ? Math.round((s[t].passCmp / s[t].passAtt) * 100) + '%' : '—');
  const rows = [
    ['Possession', Math.round((s[0].poss / tot) * 100) + '%', Math.round((s[1].poss / tot) * 100) + '%'],
    ['Shots (on target)', `${s[0].shots} (${s[0].onTarget})`, `${s[1].shots} (${s[1].onTarget})`],
    ['Pass accuracy', pc(0), pc(1)],
    ['Fouls', s[0].fouls, s[1].fouls],
    ['Corners', s[0].corners, s[1].corners],
  ];
  const min = m.noClock ? '' : ` · ${Math.min(90 + (m.added[1] || 0), Math.max(1, Math.ceil(m.clock / 60)))}'`;
  return `<div class="facts"><div class="fscore"><img src="${kitIcon(m.kits[0], 10, 28)}"> ${esc(m.teams[0].code)} <b>${m.score[0]} – ${m.score[1]}</b> ${esc(m.teams[1].code)} <img src="${kitIcon(m.kits[1], 9, 28)}"><small>${m.half === 1 ? '1st half' : '2nd half'}${min}</small></div>
    <table class="stats">${rows.map(([k, a, b]) => `<tr><td>${a}</td><th>${k}</th><td>${b}</td></tr>`).join('')}</table></div>`;
}

export function showPause(h, m = null) {
  const r = show(`
    <div class="panel small">
      <h2>Paused</h2>
      ${m ? matchFacts(m) : ''}
      <div class="menu-buttons">
        <button data-act="resume" class="primary">Resume</button>
        ${h.replay ? '<button data-act="replay">Instant replay</button>' : ''}
        ${h.restart ? '<button data-act="restart">Restart</button>' : ''}
        <button data-act="settings">Settings</button>
        <button data-act="quit">Quit to menu</button>
      </div>
    </div>`, 'overlay');
  on(r, '[data-act=resume]', () => h.resume());
  if (h.restart) on(r, '[data-act=restart]', () => h.restart());
  if (h.replay) on(r, '[data-act=replay]', () => h.replay());
  on(r, '[data-act=settings]', () => h.settings());
  on(r, '[data-act=quit]', () => h.quit());
}

// ---------- full time ----------
export function showFulltime(m, h) {
  const s = m.stats;
  const tot = s[0].poss + s[1].poss || 1;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const rows = [
    ['Possession', Math.round((s[0].poss / tot) * 100) + '%', Math.round((s[1].poss / tot) * 100) + '%'],
    ['Shots', s[0].shots, s[1].shots],
    ['On target', s[0].onTarget, s[1].onTarget],
    ['Passes completed', `${s[0].passCmp}/${s[0].passAtt} (${pct(s[0].passCmp, s[0].passAtt)})`, `${s[1].passCmp}/${s[1].passAtt} (${pct(s[1].passCmp, s[1].passAtt)})`],
    ['Fouls', s[0].fouls, s[1].fouls],
    ['Corners', s[0].corners, s[1].corners],
    ['Yellow / red', `${s[0].yellows} / ${s[0].reds}`, `${s[1].yellows} / ${s[1].reds}`],
  ];
  const scorers = (t) => m.goals.filter((g) => g.team === t).map((g) => `${esc(g.name)}${g.og ? ' (OG)' : ''} ${g.min}'`).join(', ');
  const r = show(`
    <div class="panel">
      <h2>Full Time</h2>
      <div class="final">
        <div><img src="${kitIcon(m.kits[0], 10, 56)}"><b>${esc(m.teams[0].name)}</b><small>${scorers(0)}</small></div>
        <div class="fs">${m.score[0]} – ${m.score[1]}</div>
        <div><img src="${kitIcon(m.kits[1], 9, 56)}"><b>${esc(m.teams[1].name)}</b><small>${scorers(1)}</small></div>
      </div>
      ${h.extra ? `<p class="note">${esc(h.extra)}</p>` : ''}
      <table class="stats">${rows.map(([k, a, b]) => `<tr><td>${a}</td><th>${k}</th><td>${b}</td></tr>`).join('')}</table>
      <div class="row">
        ${h.cont ? `<button data-act="cont" class="primary">${esc(h.contLabel || 'Continue')}</button>` : ''}
        ${h.rematch ? '<button data-act="rematch">Rematch</button>' : ''}
        <button data-act="menu">Main menu</button>
      </div>
    </div>`, 'overlay');
  if (h.cont) on(r, '[data-act=cont]', () => h.cont());
  if (h.rematch) on(r, '[data-act=rematch]', () => h.rematch());
  on(r, '[data-act=menu]', () => h.menu());
}

export function showMessage(title, text, buttons) {
  const r = show(`
    <div class="panel small">
      <h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="menu-buttons">${buttons.map((b, i) => `<button data-i="${i}" class="${i === 0 ? 'primary' : ''}">${esc(b.label)}</button>`).join('')}</div>
    </div>`, 'overlay');
  on(r, '[data-i]', (e, el) => buttons[+el.dataset.i].fn());
}

// ---------- World Cup hub ----------
export function showWorldCup(t, h) {
  const nf = h.nextFixture;
  const user = t.user;
  const team = (c) => `<span class="tm ${c === user ? 'me' : ''}"><img src="${kitIcon(teamByCode(c).home, '', 20)}">${esc(c)}</span>`;
  const groups = t.groups.map((g, gi) => `
    <div class="grp"><h4>Group ${g.name}</h4>
      <table><tr><th></th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>
      ${standings(t, gi).map((r, i) => `<tr class="${i < 2 ? 'q' : ''}"><td>${team(r.code)}</td><td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td><td>${r.GD}</td><td><b>${r.Pts}</b></td></tr>`).join('')}
      </table></div>`).join('');
  const tie = (stage, pair) => {
    if (!pair) return '<div class="tie tbd">TBD</div>';
    const res = resultFor(t, stage, pair[0], pair[1]);
    const sc = res ? `${res.home === pair[0] ? res.hg : res.ag} – ${res.home === pair[0] ? res.ag : res.hg}${res.pens ? ` (p: ${esc(res.pens)})` : ''}` : 'vs';
    return `<div class="tie">${team(pair[0])} <b>${sc}</b> ${team(pair[1])}</div>`;
  };
  const col = (stage, n) => `<div class="kcol"><h4>${STAGE_LABEL[stage]}</h4>${Array.from({ length: n }, (_, i) => tie(stage, t.ko[stage][i])).join('')}</div>`;
  const status = t.stage === 'done'
    ? (t.champion === user ? `${esc(teamByCode(user).name)} are WORLD CHAMPIONS!` : `Champions: ${esc(teamByCode(t.champion).name)}`)
    : t.out ? `${esc(teamByCode(user).name)} have been eliminated.` : nf ? `Next: ${esc(nf.label)} — ${esc(teamByCode(nf.home).name)} vs ${esc(teamByCode(nf.away).name)}` : '';
  const r = show(`
    <div class="panel wide wc">
      <h2>World Cup <small>${esc(STAGE_LABEL[t.stage])}</small></h2>
      <p class="status">${status}</p>
      <div class="row">
        ${nf ? '<button data-act="play" class="primary">Play match</button>' : ''}
        ${!nf && t.stage !== 'done' ? '<button data-act="sim" class="primary">Simulate next round</button>' : ''}
        <button data-act="menu">Main menu</button>
        <button data-act="abandon">Abandon tournament</button>
      </div>
      <div class="groups">${groups}</div>
      <div class="bracket">${col('qf', 4)}${col('sf', 2)}${col('final', 1)}</div>
    </div>`);
  if (nf) on(r, '[data-act=play]', () => h.play());
  on(r, '[data-act=sim]', () => h.sim());
  on(r, '[data-act=menu]', () => h.menu());
  on(r, '[data-act=abandon]', () => h.abandon());
}
