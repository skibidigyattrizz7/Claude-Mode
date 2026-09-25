// DOM HUD overlay: scoreboard, clock, event banners, controlled player name + stamina, power bar,
// radar, set-piece hints, replay tag, fade cuts, pause menu with controls reference, stats panel.
import { PHASE, SP, PITCH, halfBase, halfLen, GOAL, BALL_R } from '../core/constants.js';
import { PLAYSTYLES } from '../core/playstyles.js';
import { MENTALITY } from '../core/tactics.js';

const CSS = `
.ps3d-root{position:absolute;inset:0;overflow:hidden;background:#0b1020;font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;user-select:none;-webkit-user-select:none}
.ps3d-root canvas{outline:none}
.ps3d-hud{position:absolute;inset:0;pointer-events:none;color:#fff;z-index:2}
.ps3d-sb{position:absolute;left:18px;top:16px;display:flex;align-items:stretch;height:34px;font-weight:700;font-size:17px;letter-spacing:.5px;box-shadow:0 3px 12px rgba(0,0,0,.45);border-radius:4px;overflow:hidden}
.ps3d-sb>div{display:flex;align-items:center;justify-content:center}
.ps3d-sb .bar{width:7px}
.ps3d-sb .code{background:linear-gradient(#1c2233,#10141f);padding:0 12px;min-width:44px}
.ps3d-sb .score{background:linear-gradient(#f4f5f7,#d7dbe2);color:#0d1220;padding:0 12px;font-size:19px;min-width:60px;font-variant-numeric:tabular-nums}
.ps3d-sb .clock{background:linear-gradient(#2a3350,#171d30);padding:0 12px;min-width:62px;font-variant-numeric:tabular-nums}
.ps3d-sb .added{background:#16a34a;padding:0 8px;display:none}
.ps3d-sb .half{background:#0f1422;color:#9fb0d0;font-size:12px;padding:0 8px}
.ps3d-banner{position:absolute;left:50%;top:18%;transform:translate(-50%,-50%) scale(.6);opacity:0;transition:transform .35s cubic-bezier(.2,1.4,.4,1),opacity .3s;text-align:center;white-space:nowrap}
.ps3d-banner.show{transform:translate(-50%,-50%) scale(1);opacity:1}
.ps3d-banner .big{font-size:64px;font-weight:900;font-style:italic;letter-spacing:3px;text-shadow:0 4px 0 rgba(0,0,0,.35),0 0 30px rgba(0,0,0,.4);padding:4px 34px;background:linear-gradient(90deg,transparent,rgba(10,16,34,.75) 20%,rgba(10,16,34,.75) 80%,transparent)}
.ps3d-banner .sub{font-size:20px;font-weight:600;margin-top:6px;text-shadow:0 2px 6px rgba(0,0,0,.8)}
.ps3d-banner.goal .big{color:#ffe14d}
.ps3d-banner.yellow .big{color:#ffd400}.ps3d-banner.red .big{color:#ff4444}
.ps3d-card{display:inline-block;width:22px;height:30px;border-radius:3px;vertical-align:middle;margin-right:12px;box-shadow:0 2px 6px rgba(0,0,0,.5)}
.ps3d-toast{position:absolute;left:50%;top:70px;transform:translateX(-50%);background:rgba(10,16,34,.82);border-left:4px solid #3fa9ff;padding:7px 18px;font-weight:700;font-size:16px;letter-spacing:1px;opacity:0;transition:opacity .25s;white-space:nowrap}
.ps3d-toast.show{opacity:1}
.ps3d-panel{position:absolute;bottom:18px;min-width:190px;background:rgba(10,16,34,.78);border-radius:6px;padding:7px 12px;font-size:14px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.4)}
.ps3d-panel.p1{left:18px;border-left:4px solid #3fa9ff}.ps3d-panel.p2{right:18px;border-left:4px solid #ff4d4d}
.ps3d-panel .nm{display:flex;justify-content:space-between;gap:10px}.ps3d-panel .nm span:first-child{color:#9fb6de;font-size:12px}
.ps3d-stam{height:6px;background:rgba(255,255,255,.15);border-radius:3px;margin-top:5px;overflow:hidden}
.ps3d-stam>div{height:100%;background:linear-gradient(90deg,#f5c542,#46d17a);width:100%}
.ps3d-tag{position:absolute;transform:translate(-50%,-100%);font-size:12px;font-weight:800;padding:2px 7px;border-radius:3px;background:rgba(10,16,34,.7);white-space:nowrap;display:none}
.ps3d-tag.p1{border-bottom:2px solid #3fa9ff}.ps3d-tag.p2{border-bottom:2px solid #ff4d4d}
.ps3d-pow{position:absolute;z-index:3;transform:translate(-50%,0);width:84px;height:9px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.7);border-radius:5px;overflow:hidden;display:none}
.ps3d-pow>div{height:100%;width:0;background:linear-gradient(90deg,#46d17a 0%,#f5c542 70%,#ff4d4d 90%);background-size:84px 100%}
.ps3d-pow>i{position:absolute;left:85%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.8)}
.ps3d-radar{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);border-radius:6px;background:rgba(18,60,30,.55);box-shadow:0 2px 10px rgba(0,0,0,.4)}
.ps3d-hint{position:absolute;left:50%;bottom:170px;transform:translateX(-50%);background:rgba(10,16,34,.82);padding:8px 16px;border-radius:6px;font-size:14px;font-weight:600;white-space:nowrap;display:none;text-align:center}
.ps3d-hint b{color:#ffe14d}
.ps3d-replay{position:absolute;right:20px;top:18px;display:none;font-weight:900;font-style:italic;font-size:22px;letter-spacing:2px;background:#c8102e;padding:4px 14px;border-radius:4px}
.ps3d-replay small{display:block;font-size:11px;font-style:normal;font-weight:600;letter-spacing:0;opacity:.85}
.ps3d-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .35s}
.ps3d-stats{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);background:rgba(10,16,34,.88);border-radius:8px;padding:14px 22px;min-width:320px;display:none;font-weight:700}
.ps3d-stats h3{margin:0 0 10px;text-align:center;letter-spacing:2px;font-size:16px;color:#9fb6de}
.ps3d-stats .row{display:grid;grid-template-columns:50px 1fr 50px;gap:10px;align-items:center;margin:6px 0;font-size:15px}
.ps3d-stats .row span:nth-child(2){text-align:center;color:#cfd8ea;font-size:13px;font-weight:600}
.ps3d-stats .row span:last-child{text-align:right}
.ps3d-menu{position:absolute;inset:0;background:rgba(4,8,18,.72);display:none;align-items:center;justify-content:center;pointer-events:auto;z-index:5}
.ps3d-menu .box{background:linear-gradient(#18203a,#0f1428);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:22px 26px;min-width:300px;max-width:92vw;max-height:88vh;overflow:auto;color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.6)}
.ps3d-menu h2{margin:0 0 14px;font-style:italic;letter-spacing:3px;text-align:center}
.ps3d-menu button{display:block;width:100%;margin:8px 0;padding:11px 14px;font-size:16px;font-weight:700;border:0;border-radius:6px;background:#26314f;color:#fff;cursor:pointer;text-align:left}
.ps3d-menu button:hover,.ps3d-menu button:focus{background:#3fa9ff;color:#081022;outline:none}
.ps3d-menu button.quit{background:#5a1a24}.ps3d-menu button.quit:hover{background:#ff4d4d}
.ps3d-menu table{border-collapse:collapse;font-size:13px;margin:6px 0 10px;width:100%}
.ps3d-menu td{padding:3px 8px;border-bottom:1px solid rgba(255,255,255,.07)}
.ps3d-menu td:first-child{color:#9fb6de}
.ps3d-menu kbd{background:#2b3656;border-radius:3px;padding:1px 6px;font-family:inherit;font-weight:700}
.ps3d-loading{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-weight:800;letter-spacing:3px;color:#9fb6de}
.ps3d-touch{position:absolute;inset:0;pointer-events:none;z-index:4}
.ps3d-joy{position:absolute;left:28px;bottom:28px;width:140px;height:140px;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35);pointer-events:auto;touch-action:none}
.ps3d-knob{position:absolute;left:42px;top:42px;width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none}
.ps3d-btns{position:absolute;right:18px;bottom:18px;display:grid;grid-template-columns:repeat(3,64px);gap:9px;pointer-events:auto;touch-action:none}
.ps3d-btns button{width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,.45);background:rgba(20,30,55,.55);color:#fff;font-weight:800;font-size:11px;touch-action:none}
.ps3d-btns button.big{background:rgba(200,16,46,.6)}.ps3d-btns button.wide{grid-column:span 3;width:100%;border-radius:32px;height:44px}
.ps3d-btns button.on{background:rgba(63,169,255,.8)}
.ps3d-tpause{position:absolute;right:16px;top:14px;width:44px;height:40px;border-radius:6px;border:0;background:rgba(10,16,34,.7);color:#fff;font-weight:900;pointer-events:auto}

.ps3d-hud.compact .ps3d-radar{transform:translateX(-50%) scale(.62);transform-origin:50% 100%}
.ps3d-hud.compact .ps3d-hint{bottom:100px;font-size:11px;padding:5px 10px}
.ps3d-hud.compact .ps3d-panel{transform:scale(.8);transform-origin:left bottom;min-width:170px}
.ps3d-hud.compact .ps3d-panel.p2{transform-origin:right bottom}
.ps3d-hud.compact .ps3d-sb{transform:scale(.8);transform-origin:left top}
.ps3d-hud.compact .ps3d-banner .big{font-size:40px}
.ps3d-hud.compact .ps3d-stats{transform:translate(-50%,-50%) scale(.8)}
.ps3d-hud.touch .ps3d-panel.p1{top:62px;bottom:auto;transform-origin:left top}
.ps3d-hud.touch .ps3d-radar{bottom:6px}
.ps3d-root.compact-touch .ps3d-btns{grid-template-columns:repeat(3,54px);gap:7px}
.ps3d-root.compact-touch .ps3d-btns button{width:54px;height:54px;font-size:10px}
.ps3d-root.compact-touch .ps3d-btns button.wide{height:38px}
.ps3d-next{position:absolute;transform:translate(-50%,-100%);font-size:13px;font-weight:900;color:#fff;opacity:.75;text-shadow:0 1px 3px #000;display:none}
.ps3d-timed{position:absolute;transform:translate(-50%,-100%);padding:2px 8px;border-radius:9px;font-size:11px;font-weight:900;letter-spacing:1px;display:none;color:#081022}
.ps3d-ps{margin-top:4px;display:flex;gap:3px;flex-wrap:wrap}
.ps3d-ps span{font-size:9px;font-weight:800;padding:1px 4px;border-radius:3px;background:rgba(63,169,255,.25);color:#cfe4ff;letter-spacing:.5px}
.ps3d-ps span.plus{background:rgba(255,212,0,.3);color:#ffe98a}
.ps3d-spov{position:absolute;inset:0;pointer-events:none}
.ps3d-contact{position:absolute;right:24px;bottom:150px;width:92px;height:118px;display:none;text-align:center;font-size:10px;font-weight:800;color:#cfd8ea}
.ps3d-contact .ball{position:relative;width:78px;height:78px;margin:0 auto 4px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,#d8dde6 60%,#9aa3b3);box-shadow:0 2px 10px rgba(0,0,0,.5)}
.ps3d-contact .dot{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#ff4d4d;box-shadow:0 0 0 2px #fff}
.ps3d-ticker{position:absolute;left:50%;top:108px;transform:translateX(-50%);max-width:70%;background:rgba(10,16,34,.72);padding:5px 14px;border-radius:14px;font-size:13px;font-weight:600;font-style:italic;opacity:0;transition:opacity .3s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ps3d-ticker.show{opacity:1}
.ps3d-pens{position:absolute;left:18px;top:56px;background:rgba(10,16,34,.82);border-radius:5px;padding:5px 10px;font-size:12px;font-weight:800;display:none}
.ps3d-pens .row{display:flex;align-items:center;gap:5px;margin:2px 0}
.ps3d-pens i{display:inline-block;width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.2)}
.ps3d-pens i.ok{background:#46d17a}.ps3d-pens i.no{background:#ff4d4d}
.ps3d-menu select,.ps3d-menu input[type=range]{background:#26314f;color:#fff;border:0;border-radius:4px;padding:4px;font-size:13px;max-width:100%}
.ps3d-menu .tm{font-size:13px;width:100%;border-collapse:collapse}
.ps3d-menu .tm td{padding:3px 6px}
.ps3d-menu .tm tr.sel{background:#3fa9ff;color:#081022}
.ps3d-menu .tm tr{cursor:pointer}
.ps3d-menu .tabs{display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap}
.ps3d-menu .tabs button{width:auto;display:inline-block;margin:0;padding:6px 10px;font-size:13px}
.ps3d-menu .tabs button.on{background:#3fa9ff;color:#081022}
.ps3d-menu label{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:5px 0;font-size:13px}
@media (max-width:700px){.ps3d-banner .big{font-size:40px}.ps3d-sb{transform:scale(.85);transform-origin:left top}.ps3d-hint{bottom:210px;font-size:12px}}
`;

let styleRefs = 0, styleEl = null;
function addStyle() {
  if (styleRefs++ === 0) { styleEl = document.createElement('style'); styleEl.textContent = CSS; document.head.appendChild(styleEl); }
}
function removeStyle() {
  if (--styleRefs === 0 && styleEl) { styleEl.remove(); styleEl = null; }
}

export function keyName(code) {
  if (!code) return '?';
  const map = { ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Space: 'Space', Mouse0: 'Left click', Mouse2: 'Right click', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', NumpadDecimal: 'Num .', Enter: 'Enter' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(root, { home, away, binds, slots, onResume, onCamera, onQuit, onReplay, onTactic, teamInfo, gameplay, touch = false }) {
    addStyle();
    this.root = root;
    this.touch = touch;
    this.home = home; this.away = away; this.binds = binds; this.slots = slots;
    const h = (this.el = el('div', 'ps3d-hud' + (touch ? ' touch' : ''), root));
    const sb = el('div', 'ps3d-sb', h);
    el('div', 'bar', sb).style.background = home.kit.primary;
    this.hCode = el('div', 'code', sb, esc(home.short || home.id));
    this.scoreEl = el('div', 'score', sb, '0 - 0');
    this.aCode = el('div', 'code', sb, esc(away.short || away.id));
    el('div', 'bar', sb).style.background = away.kit.primary;
    this.clockEl = el('div', 'clock', sb, '00:00');
    this.addedEl = el('div', 'added', sb, '+0');
    this.banner = el('div', 'ps3d-banner', h);
    this.toastEl = el('div', 'ps3d-toast', h);
    this.panels = [el('div', 'ps3d-panel p1', h), el('div', 'ps3d-panel p2', h)];
    for (const p of this.panels) { p.innerHTML = '<div class="nm"><span></span><span></span></div><div class="ps3d-stam"><div></div></div>'; p.style.display = 'none'; }
    this.tags = [el('div', 'ps3d-tag p1', h), el('div', 'ps3d-tag p2', h)];
    this.pows = [el('div', 'ps3d-pow', h, '<div></div><i></i>'), el('div', 'ps3d-pow', h, '<div></div><i></i>')];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.radar = el('canvas', 'ps3d-radar', h);
    this.radarW = 210; this.radarH = 136;
    this.radar.width = this.radarW * dpr; this.radar.height = this.radarH * dpr;
    this.radar.style.width = this.radarW + 'px'; this.radar.style.height = this.radarH + 'px';
    this.rctx = this.radar.getContext('2d');
    this.rctx.scale(dpr, dpr);
    this.hint = el('div', 'ps3d-hint', h);
    this.replayEl = el('div', 'ps3d-replay', h, 'REPLAY<small>press any button to skip</small>');
    this.fadeEl = el('div', 'ps3d-fade', h);
    this.stats = el('div', 'ps3d-stats', h);
    this.loading = el('div', 'ps3d-loading', h, 'LOADING STADIUM…');
    this.nexts = [el('div', 'ps3d-next', h, '▼'), el('div', 'ps3d-next', h, '▼')];
    this.timedEl = el('div', 'ps3d-timed', h);
    this.timedT = 0;
    this.spov = el('canvas', 'ps3d-spov', h);
    this.spctx = this.spov.getContext('2d');
    this.contact = el('div', 'ps3d-contact', h, '<div class="ball"><div class="dot"></div></div>CONTACT');
    this.tickerEl = el('div', 'ps3d-ticker', h);
    this.tickerT = 0;
    this.pensEl = el('div', 'ps3d-pens', h);
    this.pensKey = '';
    // pause menu
    this.menu = el('div', 'ps3d-menu', root);
    this.menuBox = el('div', 'box', this.menu);
    this.onResume = onResume; this.onCamera = onCamera; this.onQuit = onQuit;
    this.onReplay = onReplay || (() => {}); this.onTactic = onTactic || (() => null); this.teamInfo = teamInfo || null;
    this.gameplay = gameplay || [{}, {}];
    this.queue = [];
    this.bannerT = 0;
    this.toastT = 0;
    this.lastScore = '';
    this.lastClock = '';
    this.statsT = 0;
    this.camMode = 'broadcast';
  }

  // timed finishing indicator: q 0 green / 1 amber / 2 red
  timed(q, pi) {
    const col = ['#46d17a', '#f5c542', '#ff4d4d'][q] || '#f5c542';
    this.timedEl.textContent = ['GREEN', 'AMBER', 'RED'][q] || '';
    this.timedEl.style.background = col;
    this.timedPi = pi; this.timedT = 1.1;
  }
  ticker(text) {
    this.tickerEl.textContent = text;
    this.tickerEl.classList.add('show');
    this.tickerT = 3.2;
  }

  setLoaded() { if (this.loading) { this.loading.remove(); this.loading = null; } }

  // big banner: {text, sub, cls, dur, card}
  bannerMsg(text, sub = '', cls = '', dur = 2.4, card = null) {
    this.queue.push({ text, sub, cls, dur, card });
    if (this.queue.length > 4) this.queue.shift();
  }
  toast(text, color = '#3fa9ff', dur = 1.8) {
    this.toastEl.textContent = text;
    this.toastEl.style.borderLeftColor = color;
    this.toastEl.classList.add('show');
    this.toastT = dur;
  }
  fade() {
    const f = this.fadeEl;
    f.style.transition = 'none';
    f.style.opacity = '0.9';
    void f.offsetWidth;
    f.style.transition = 'opacity .4s';
    f.style.opacity = '0';
  }
  showStats(view, title, dur = 3.5) {
    const st = view.st || [50, 0, 0, 0, 0, 0, 0];
    const row = (a, label, b) => `<div class="row"><span>${a}</span><span>${label}</span><span>${b}</span></div>`;
    this.stats.innerHTML = `<h3>${esc(title)}</h3>` +
      row(esc(this.home.short), `${view.sc[0]} - ${view.sc[1]}`, esc(this.away.short)) +
      row(st[0] + '%', 'Possession', 100 - st[0] + '%') + row(st[1], 'Shots', st[2]) + row(st[3], 'On target', st[4]) + row(st[5], 'Passes', st[6]);
    this.stats.style.display = 'block';
    this.statsT = dur;
  }

  update(view, ctx) {
    const dt = ctx.dt;
    const compact = this.root.clientHeight < 560 || this.root.clientWidth < 760;
    if (compact !== this.compact) {
      this.compact = compact;
      this.el.classList.toggle('compact', compact);
      this.root.classList.toggle('compact-touch', compact && this.touch);
    }
    if (!view) return;
    // scoreboard (always the live state, also during replays)
    const lv = ctx.live || view;
    const sc = `${lv.sc[0]} - ${lv.sc[1]}`;
    if (sc !== this.lastScore) { this.scoreEl.textContent = sc; this.lastScore = sc; }
    const total = halfBase(lv.h) + lv.cl;
    const mm = Math.floor(total / 60), ss = Math.floor(total % 60);
    const clk = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    if (clk !== this.lastClock) { this.clockEl.textContent = clk; this.lastClock = clk; }
    if (lv.pk) { this.addedEl.style.display = 'flex'; this.addedEl.textContent = 'PENS'; }
    else if (lv.ad > 0 && lv.cl >= halfLen(lv.h) - 1) { this.addedEl.style.display = 'flex'; this.addedEl.textContent = '+' + lv.ad; }
    else this.addedEl.style.display = 'none';
    // banners
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.remove('show');
    } else if (this.queue.length && this.bannerT > -0.25) {
      this.bannerT -= dt;
    } else if (this.queue.length) {
      const b = this.queue.shift();
      const card = b.card ? `<span class="ps3d-card" style="background:${b.card}"></span>` : '';
      this.banner.className = 'ps3d-banner ' + b.cls;
      this.banner.innerHTML = `<div class="big">${card}${esc(b.text)}</div>${b.sub ? `<div class="sub">${esc(b.sub)}</div>` : ''}`;
      void this.banner.offsetWidth;
      this.banner.classList.add('show');
      this.bannerT = b.dur;
    }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.remove('show'); }
    if (this.tickerT > 0) { this.tickerT -= dt; if (this.tickerT <= 0) this.tickerEl.classList.remove('show'); }
    this._pens(lv);
    if (this.statsT > 0) { this.statsT -= dt; if (this.statsT <= 0) this.stats.style.display = 'none'; }
    // replay tag
    this.replayEl.style.display = ctx.replay ? 'block' : 'none';
    // controlled player panels / tags / power
    const live = !ctx.replay && view.ph !== PHASE.HALFTIME && view.ph !== PHASE.FULLTIME;
    for (let s = 0; s < 2; s++) {
      const slot = ctx.local[s];
      const panel = this.panels[slot === 'p2' ? 1 : 0];
      const idx = view.c ? view.c[s] : -1;
      const tag = this.tags[slot === 'p2' ? 1 : 0], pow = this.pows[slot === 'p2' ? 1 : 0];
      if (!slot || idx < 0) continue;
      panel.style.display = live ? 'block' : 'none';
      const pd = ctx.playerData(idx);
      const nm = panel.firstChild;
      const label = `${pd.number ?? ''}  ${pd.name || ''}`;
      if (nm.dataset.v !== label) { nm.children[0].textContent = slot === 'p2' ? 'PLAYER 2' : 'PLAYER 1'; nm.children[1].textContent = label; nm.dataset.v = label; }
      panel.children[1].firstChild.style.width = Math.round((view.stm ? view.stm[s] : 1) * 100) + '%';
      // PlayStyle badges of the controlled player
      const psKey = (pd.playstyles || []).map((e) => (typeof e === 'string' ? e : e && e.id) + (e && e.plus ? '+' : '')).join(',');
      if (panel.dataset.ps !== psKey) {
        panel.dataset.ps = psKey;
        let box = panel.querySelector('.ps3d-ps');
        if (!box) box = el('div', 'ps3d-ps', panel);
        box.innerHTML = (pd.playstyles || []).slice(0, 4).map((e) => { const id = typeof e === 'string' ? e : e && e.id; const lab = PLAYSTYLES[id]; return lab ? `<span class="${e && e.plus ? 'plus' : ''}" title="${esc(id)}">${lab}${e && e.plus ? '+' : ''}</span>` : ''; }).join('');
      }
      const x = view.p[idx * 7], z = view.p[idx * 7 + 1];
      // the renderer draws the name / indicator above the controlled player itself
      tag.style.display = 'none';
      const pw = ctx.power ? ctx.power[s] : 0;
      if (pw > 0 && live) {
        const pf = ctx.project ? ctx.project(x, -0.1, z) : null;
        pow.style.display = 'block';
        if (pf && pf.visible) { pow.style.left = pf.x + 'px'; pow.style.top = pf.y + 12 + 'px'; }
        else { pow.style.left = '50%'; pow.style.top = this.compact ? 'calc(100% - 150px)' : 'calc(100% - 232px)'; }
        pow.firstChild.style.width = Math.round(pw * 100) + '%';
      } else pow.style.display = 'none';
    }
    // hide unused
    const usedSlots = new Set(ctx.local.filter(Boolean));
    if (!usedSlots.has('p1')) { this.panels[0].style.display = 'none'; this.tags[0].style.display = 'none'; this.pows[0].style.display = 'none'; }
    if (!usedSlots.has('p2')) { this.panels[1].style.display = 'none'; this.tags[1].style.display = 'none'; this.pows[1].style.display = 'none'; }
    // next-player indicator (who the switch key would select)
    for (let s = 0; s < 2; s++) {
      const ne = this.nexts[s];
      const slot = ctx.local[s];
      const ni = view.ns ? view.ns[s] : -1;
      const show = live && slot && ni >= 0 && ni !== view.c[s] && ctx.project && view.ph === PHASE.PLAY && (!ctx.gp || ctx.gp[s].nextPlayerIndicator !== false);
      if (!show) { ne.style.display = 'none'; continue; }
      const pf = ctx.project(view.p[ni * 7], 2.25, view.p[ni * 7 + 1]);
      if (!pf || !pf.visible) { ne.style.display = 'none'; continue; }
      ne.style.display = 'block'; ne.style.left = pf.x + 'px'; ne.style.top = pf.y + 'px';
      ne.style.color = slot === 'p2' ? '#ff8a8a' : '#8fd0ff';
    }
    // timed-finishing pill
    if (this.timedT > 0 && ctx.project && this.timedPi != null) {
      this.timedT -= dt;
      const i = this.timedPi;
      const pf = ctx.project(view.p[i * 7], 2.6, view.p[i * 7 + 1]);
      this.timedEl.style.display = pf && pf.visible && this.timedT > 0 ? 'block' : 'none';
      if (pf) { this.timedEl.style.left = pf.x + 'px'; this.timedEl.style.top = pf.y + 'px'; }
    } else this.timedEl.style.display = 'none';
    this._setPieceOverlay(view, ctx, live);
    // set-piece hint
    this._hint(view, ctx);
    this._radar(view, ctx);
  }

  // shootout tally under the scoreboard
  _pens(v) {
    const pk = v.pk;
    const key = pk ? JSON.stringify(pk) : '';
    if (key === this.pensKey) return;
    this.pensKey = key;
    if (!pk) { this.pensEl.style.display = 'none'; return; }
    const row = (team, name) => {
      const k = pk[team] || [];
      const n = Math.max(5, k.length, (pk[1 - team] || []).length);
      let dots = '';
      for (let i = 0; i < n; i++) dots += `<i class="${k[i] === 1 ? 'ok' : k[i] === 0 ? 'no' : ''}"></i>`;
      return `<div class="row"><span style="width:38px">${esc(name)}</span>${dots}<b style="margin-left:6px">${k.reduce((a, b) => a + b, 0)}</b></div>`;
    };
    this.pensEl.innerHTML = row(0, this.home.short || 'HOM') + row(1, this.away.short || 'AWY');
    this.pensEl.style.display = 'block';
  }

  // penalties / free kicks: shrinking timing ring under the ball + ball contact-point diagram
  _setPieceOverlay(view, ctx, live) {
    const cv = this.spov, g = this.spctx;
    const W = this.root.clientWidth, H = this.root.clientHeight;
    const sa = view.sa;
    const mine = sa && live && view.spk >= 0 && ctx.local[view.spk] && view.ph === PHASE.SETPIECE;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    g.clearRect(0, 0, W, H);
    if (!mine || !ctx.project) { this.contact.style.display = 'none'; return; }
    const [type, , , kx, ky, ring, cross] = sa;
    const bx = view.b[0], bz = view.b[2];
    if (cross || type === SP.FREEKICK || type === SP.PENALTY || type === SP.CORNER) {
      // timing ring on the ground around the ball: smallest = best moment to strike
      const r = 0.35 + ring * 1.5;
      const pts = [];
      for (let k = 0; k <= 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        const pf = ctx.project(bx + Math.cos(a) * r, 0.03, bz + Math.sin(a) * r);
        if (!pf) return;
        pts.push(pf);
      }
      g.lineWidth = 3;
      g.strokeStyle = ring < 0.15 ? '#46d17a' : ring < 0.45 ? '#f5c542' : 'rgba(255,255,255,.85)';
      g.beginPath();
      pts.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      const inner = [];
      for (let k = 0; k <= 30; k++) { const a = (k / 30) * Math.PI * 2; inner.push(ctx.project(bx + Math.cos(a) * 0.35, 0.03, bz + Math.sin(a) * 0.35)); }
      g.lineWidth = 1.5; g.strokeStyle = 'rgba(70,209,122,.8)';
      g.beginPath(); inner.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
    }
    // crosshair on the goal mouth (drawn over everything so the keeper never hides it)
    if (cross) {
      const gx = (view.spk === 0 ? view.dir : -view.dir) * PITCH.HL;
      const c = ctx.project(gx, sa[2], sa[1]);
      if (c && c.visible) {
        const R = 13;
        g.lineWidth = 2.5; g.strokeStyle = '#ffe14d'; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 4;
        g.beginPath(); g.arc(c.x, c.y, R, 0, Math.PI * 2); g.stroke();
        g.beginPath();
        g.moveTo(c.x - R - 6, c.y); g.lineTo(c.x - 4, c.y); g.moveTo(c.x + 4, c.y); g.lineTo(c.x + R + 6, c.y);
        g.moveTo(c.x, c.y - R - 6); g.lineTo(c.x, c.y - 4); g.moveTo(c.x, c.y + 4); g.lineTo(c.x, c.y + R + 6);
        g.stroke();
        g.shadowBlur = 0;
      }
    }
    // ball contact point (free kicks with the crosshair)
    if (cross && type === SP.FREEKICK) {
      this.contact.style.display = 'block';
      const dot = this.contact.querySelector('.dot');
      dot.style.left = 39 + kx * 32 + 'px';
      dot.style.top = 39 - ky * 32 + 'px';
      const lab = Math.abs(kx) < 0.22 && Math.abs(ky) < 0.22 ? 'KNUCKLE' : `${kx > 0.22 ? 'CURL L ' : kx < -0.22 ? 'CURL R ' : ''}${ky > 0.22 ? 'DIP' : ky < -0.22 ? 'LIFT' : ''}`;
      this.contact.lastChild.textContent = lab.trim();
    } else this.contact.style.display = 'none';
  }

  _hint(view, ctx) {
    let txt = '';
    if (!ctx.replay && view.ph === PHASE.SETPIECE && view.spt === SP.PENALTY && view.spk >= 0 && !ctx.local[view.spk] && ctx.local[1 - view.spk]) {
      const b = this.binds[ctx.local[1 - view.spk]];
      txt = `KEEPER — hold a direction as the kick is struck to dive (towards the taker = high) · <b>${esc(keyName(b.up))}${esc(keyName(b.left))}${esc(keyName(b.down))}${esc(keyName(b.right))}</b>`;
    } else if (!ctx.replay && (view.ph === PHASE.SETPIECE || view.ph === PHASE.KICKOFF) && view.spk >= 0 && ctx.local[view.spk] && view.c[view.spk] >= 0) {
      const b = this.binds[ctx.local[view.spk]];
      const k = (a) => `<b>${esc(keyName(b[a]))}</b>`;
      switch (view.spt) {
        case SP.PENALTY: txt = `PENALTY — move the crosshair (movement / right stick / mouse) · hold ${k('shoot')} for power, release when the ring is smallest`; break;
        case SP.FREEKICK: txt = view.sa && view.sa[6]
          ? `FREE KICK — crosshair: movement / mouse · contact ${k('switchP')} ${k('tackle')} ${k('skill')} ${k('jockey')} · hold ${k('shoot')} / ${k('finesse')}, release on the small ring · ${k('lob')} cross, ${k('pass')} pass`
          : `FREE KICK — aim with movement · curve ${k('switchP')} / ${k('tackle')} · ${k('lob')} long, ${k('pass')} pass (tap ${k('pass')} during the whistle = quick)`; break;
        case SP.CORNER: txt = `CORNER — aim with movement · curve ${k('switchP')} / ${k('tackle')} · hold ${k('lob')} to cross, ${k('pass')} short`; break;
        case SP.THROW: txt = `THROW-IN — aim with movement · ${k('pass')} short, ${k('lob')} long (tap ${k('pass')} during the whistle = quick throw)`; break;
        case SP.GOALKICK: txt = `GOAL KICK — aim with movement · ${k('pass')} short, ${k('lob')} long`; break;
        case SP.KICKOFF: txt = `KICK-OFF — ${k('pass')} to pass`; break;
      }
    }
    if (txt !== this.hintTxt) { this.hint.innerHTML = txt; this.hint.style.display = txt ? 'block' : 'none'; this.hintTxt = txt; }
  }

  _radar(view, ctx) {
    const g = this.rctx, W = this.radarW, H = this.radarH;
    const pad = 6;
    const sx = (W - pad * 2) / PITCH.L, sz = (H - pad * 2) / PITCH.W;
    const X = (x) => pad + (x + PITCH.HL) * sx, Z = (z) => pad + (z + PITCH.HW) * sz;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1;
    g.strokeRect(X(-PITCH.HL), Z(-PITCH.HW), PITCH.L * sx, PITCH.W * sz);
    g.beginPath(); g.moveTo(X(0), Z(-PITCH.HW)); g.lineTo(X(0), Z(PITCH.HW)); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), 9.15 * sx, 0, Math.PI * 2); g.stroke();
    for (const s of [-1, 1]) g.strokeRect(s > 0 ? X(PITCH.HL - 16.5) : X(-PITCH.HL), Z(-20.16), 16.5 * sx, 40.32 * sz);
    const P = view.p;
    const cols = [this.home.kit.primary, this.away.kit.primary];
    for (let i = 0; i < 22; i++) {
      if ((view.so >> i) & 1) continue;
      const team = i < 11 ? 0 : 1;
      const x = X(P[i * 7]), z = Z(P[i * 7 + 1]);
      g.fillStyle = cols[team];
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.beginPath(); g.arc(x, z, 3.3, 0, Math.PI * 2); g.fill(); g.stroke();
      const s = i < 11 ? 0 : 1;
      if (view.c && view.c[s] === i && ctx.local[s]) {
        g.strokeStyle = ctx.local[s] === 'p2' ? '#ff4d4d' : '#3fa9ff'; g.lineWidth = 2;
        g.beginPath(); g.arc(x, z, 6, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1;
      }
    }
    g.fillStyle = '#fff'; g.strokeStyle = '#000';
    g.beginPath(); g.arc(X(view.b[0]), Z(view.b[2]), 2.6, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  showMenu(show, info = {}) {
    this.menu.style.display = show ? 'flex' : 'none';
    if (!show) return;
    this.camMode = info.camera || this.camMode;
    this._menuMain(info);
  }
  _menuMain(info) {
    const b = this.menuBox;
    b.innerHTML = '<h2>PAUSED</h2>';
    const btn = (label, fn, cls = '') => { const e = el('button', cls, b, esc(label)); e.addEventListener('click', fn); return e; };
    const first = btn('Resume', () => this.onResume());
    const camBtn = btn(`Camera: ${this.camMode === 'pro' ? 'Pro (behind player)' : 'Broadcast'}`, () => {
      this.camMode = this.onCamera();
      camBtn.textContent = `Camera: ${this.camMode === 'pro' ? 'Pro (behind player)' : 'Broadcast'}`;
    });
    if (this.teamInfo && (info.localSides || []).length) btn('Team management', () => this._menuTeam(info, info.localSides[0], 'subs'));
    btn('Instant replay', () => this.onReplay());
    btn('Controls', () => this._menuControls(info));
    btn('Quit match', () => this.onQuit(), 'quit');
    setTimeout(() => first.focus(), 0);
  }
  // In-match team management: substitutions, formation / positions, tactics, set-piece takers, mentality
  _menuTeam(info, side, tab) {
    const b = this.menuBox;
    const ti = this.teamInfo(side);
    if (!ti) return;
    const team = side === 0 ? this.home : this.away;
    const send = (cmd) => { const r = this.onTactic(side, cmd); setTimeout(() => this._menuTeam(info, side, tab), 30); return r; };
    b.innerHTML = `<h2>TEAM · ${esc(team.short || team.name)}</h2>`;
    const tabs = el('div', 'tabs', b);
    for (const [k, lab] of [['subs', 'Subs'], ['shape', 'Formation'], ['tac', 'Tactics'], ['sp', 'Set pieces']]) {
      const t = el('button', tab === k ? 'on' : '', tabs, lab);
      t.addEventListener('click', () => this._menuTeam(info, side, k));
    }
    if ((info.localSides || []).length > 1) {
      const o = el('button', '', tabs, 'Other side');
      o.addEventListener('click', () => this._menuTeam(info, info.localSides.find((x) => x !== side), tab));
    }
    const body = el('div', '', b);
    if (tab === 'subs') {
      body.innerHTML = `<div style="font-size:12px;color:#9fb6de;margin-bottom:4px">Subs used ${ti.subsMade}/${ti.maxSubs}${ti.pending.length ? ` · ${ti.pending.length} waiting for a stoppage` : ''}. Pick a player, then a substitute.</div>`;
      const tbl = el('table', 'tm', body);
      this._subOut = this._subOut ?? null;
      for (const p of ti.players) {
        if (p.role === 'GK' && false) continue;
        const tr = el('tr', this._subOut === p.i ? 'sel' : '', tbl, `<td>${esc(p.role || p.pos)}</td><td>${esc(p.name)}</td><td>${p.ovr ?? ''}</td><td>${Math.round((p.stam ?? 1) * 100)}%</td><td>${p.rating != null ? p.rating.toFixed(1) : ''}</td>`);
        if (p.sentOff) tr.style.opacity = 0.4;
        else tr.addEventListener('click', () => { this._subOut = p.i; this._menuTeam(info, side, tab); });
      }
      el('div', '', body, '<div style="margin:8px 0 4px;font-weight:800">Bench</div>');
      const tb = el('table', 'tm', body);
      for (const q of ti.bench) {
        const tr = el('tr', '', tb, `<td>${esc(q.pos)}</td><td>${esc(q.name)}</td><td>${q.ovr ?? ''}</td>`);
        if (q.used) tr.style.opacity = 0.35;
        else tr.addEventListener('click', () => { if (this._subOut == null) return; send({ k: 'sub', i: this._subOut, bi: q.bi }); this._subOut = null; });
      }
    } else if (tab === 'shape') {
      const lab = el('label', '', body, 'Formation ');
      const sel = el('select', '', lab);
      for (const f of ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-1-2-1-2']) { const o = el('option', '', sel, f); o.value = f; if (f === ti.formation) o.selected = true; }
      sel.addEventListener('change', () => send({ k: 'formation', f: sel.value }));
      el('div', '', body, '<div style="margin:8px 0 4px;font-size:12px;color:#9fb6de">Swap positions: click two players.</div>');
      const tbl = el('table', 'tm', body);
      for (const p of ti.players) {
        if (p.i === 0) continue;
        const tr = el('tr', this._swapA === p.i ? 'sel' : '', tbl, `<td>${esc(p.role || '')}</td><td>${esc(p.name)}</td>`);
        tr.addEventListener('click', () => {
          if (this._swapA == null) { this._swapA = p.i; this._menuTeam(info, side, tab); }
          else { const a = this._swapA; this._swapA = null; if (a !== p.i) send({ k: 'swap', i: a, j: p.i }); else this._menuTeam(info, side, tab); }
        });
      }
      const m = ti.tac && ti.tac.mentality != null ? ti.tac.mentality : 0;
      el('div', '', body, `<div style="margin-top:8px">Mentality: <b>${MENTALITY[m + 2] || 'BALANCED'}</b></div>`);
      const mr = el('div', 'tabs', body);
      el('button', '', mr, '◀ More defensive').addEventListener('click', () => send({ k: 'ment', d: -1 }));
      el('button', '', mr, 'More attacking ▶').addEventListener('click', () => send({ k: 'ment', d: 1 }));
    } else if (tab === 'tac') {
      const t = ti.tac || {};
      const pick = (label, key, opts) => {
        const l = el('label', '', body, esc(label));
        const s = el('select', '', l);
        for (const o of opts) { const e = el('option', '', s, o); e.value = o; if ((t[key] || opts[0]) === o) e.selected = true; }
        s.addEventListener('change', () => send({ k: 'set', tactics: { [key]: s.value } }));
      };
      const slider = (label, key, lo, hi) => {
        const l = el('label', '', body, `${esc(label)} <b>${t[key] ?? Math.round((lo + hi) / 2)}</b>`);
        const r = el('input', '', l); r.type = 'range'; r.min = lo; r.max = hi; r.value = t[key] ?? Math.round((lo + hi) / 2);
        r.addEventListener('change', () => send({ k: 'set', tactics: { [key]: +r.value } }));
      };
      pick('Defensive style', 'defensiveStyle', ['balanced', 'pressAfterLoss', 'constantPressure', 'dropBack']);
      slider('Width', 'width', 1, 10); slider('Depth', 'depth', 1, 10);
      pick('Build-up', 'buildUp', ['balanced', 'shortPassing', 'longBall', 'counter']);
      pick('Chance creation', 'chanceCreation', ['balanced', 'possession', 'directPassing', 'forwardRuns']);
      slider('Players in box', 'playersInBox', 1, 10); slider('Corners', 'corners', 1, 5); slider('Free kicks', 'freeKicks', 1, 5);
      el('div', '', body, `<div style="font-size:12px;color:#9fb6de;margin-top:6px">Quick tactics: keys 1–4 (presets from your team's tactics), − / = mentality, gamepad LB + d-pad.</div>`);
    } else {
      const tk = (ti.tac && ti.tac.setPieceTakers) || {};
      for (const [key, lab] of [['fk', 'Free kicks'], ['pen', 'Penalties'], ['cornerL', 'Left corners'], ['cornerR', 'Right corners'], ['captain', 'Captain']]) {
        const l = el('label', '', body, esc(lab));
        const s = el('select', '', l);
        el('option', '', s, 'Auto').value = '';
        for (const p of ti.players) { if (p.i === 0 && key !== 'captain') continue; const o = el('option', '', s, esc(p.name)); o.value = p.id; if (tk[key] === p.id) o.selected = true; }
        s.addEventListener('change', () => send({ k: 'takers', takers: { [key]: s.value || undefined } }));
      }
    }
    const back = el('button', '', b, 'Back');
    back.addEventListener('click', () => this._menuMain(info));
    setTimeout(() => back.focus(), 0);
  }

  _menuControls(info) {
    const b = this.menuBox;
    const rows = (slot) => {
      const k = this.binds[slot];
      const r = (label, key) => `<tr><td>${label}</td><td><kbd>${esc(keyName(k[key]))}</kbd></td></tr>`;
      return `<table>${r('Move up', 'up')}${r('Move down', 'down')}${r('Move left', 'left')}${r('Move right', 'right')}${r('Sprint', 'sprint')}${r('Ground pass (hold = power)', 'pass')}${r('Through ball', 'through')}${r('Lob / cross', 'lob')}${r('Shoot (hold = power)', 'shoot')}${r('Finesse shot', 'finesse')}${r('Switch player', 'switchP')}${r('Tackle (hold / double tap = slide)', 'tackle')}${r('Skill move (+ direction)', 'skill')}${r('Jockey / shield (hold)', 'jockey')}${r('Control keeper (hold)', 'keeper')}${r('Pause', 'pause')}</table>
      <table><tr><td>Chip shot</td><td><kbd>${esc(keyName(k.switchP))}</kbd> + <kbd>${esc(keyName(k.shoot))}</kbd></td></tr>
      <tr><td>Low driven (tap) / power shot (hold)</td><td><kbd>${esc(keyName(k.finesse))}</kbd> + <kbd>${esc(keyName(k.shoot))}</kbd></td></tr>
      <tr><td>Trivela · flair pass</td><td><kbd>${esc(keyName(k.jockey))}</kbd> + <kbd>${esc(keyName(k.shoot))}</kbd> · <kbd>${esc(keyName(k.jockey))}</kbd> + <kbd>${esc(keyName(k.pass))}</kbd></td></tr>
      <tr><td>Controlled sprint</td><td><kbd>${esc(keyName(k.jockey))}</kbd> + <kbd>${esc(keyName(k.sprint))}</kbd></td></tr>
      <tr><td>Keeper dive (while controlling keeper)</td><td><kbd>${esc(keyName(k.tackle))}</kbd></td></tr></table>`;
    };
    const slots = [...new Set((this.slots || []).filter(Boolean))];
    if (!slots.length) slots.push('p1');
    b.innerHTML = '<h2>CONTROLS</h2>' + slots.map((s) => `<div style="font-weight:800;margin-top:6px">${s === 'p2' ? 'Player 2' : 'Player 1'}</div>${rows(s)}`).join('') +
      `<div style="font-weight:800;margin-top:6px">Gamepad</div><table>
        <tr><td>Pass / Through / Lob / Shoot</td><td><kbd>A</kbd> <kbd>Y</kbd> <kbd>B</kbd> <kbd>X</kbd></td></tr>
        <tr><td>Finesse · Sprint · Switch · Jockey</td><td><kbd>RB</kbd> <kbd>RT</kbd> <kbd>LB</kbd> <kbd>LT</kbd></td></tr>
        <tr><td>Tackle (hold = slide) · Keeper</td><td><kbd>B</kbd> <kbd>L3</kbd></td></tr>
        <tr><td>Set-piece crosshair · contact point</td><td>right stick · d-pad</td></tr>
        <tr><td>Skill move · Camera · Pause</td><td><kbd>R3</kbd> <kbd>Back</kbd> <kbd>Start</kbd></td></tr></table>
      <table><tr><td>Toggle camera</td><td><kbd>C</kbd></td></tr><tr><td>Quick tactics · mentality</td><td><kbd>1</kbd>–<kbd>4</kbd> · <kbd>-</kbd> <kbd>=</kbd></td></tr><tr><td>Set pieces</td><td>move = aim, curve = switch/tackle keys, hold kick key for power</td></tr></table>`;
    const back = el('button', '', b, 'Back');
    back.addEventListener('click', () => this._menuMain(info));
    setTimeout(() => back.focus(), 0);
  }

  dispose() {
    this.el.remove();
    this.menu.remove();
    removeStyle();
  }
}
