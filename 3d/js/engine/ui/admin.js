// Admin fun-effects UI: active-effect chips + scoreboard renames (every client, driven by view.ae),
// and the hidden Admin menu (only when createMatch opts.adminLevel is set): key ` or \, crown on touch.
import { ADMIN_EFFECTS, ADMIN_BY_CODE } from '../core/admin.js';

const CSS = `
.ps3d-adm-chips{position:absolute;left:18px;top:58px;display:flex;flex-wrap:wrap;gap:5px;max-width:46vw;pointer-events:none;z-index:3}
.ps3d-adm-chips span{background:rgba(120,40,160,.82);border:1px solid rgba(255,215,0,.7);color:#fff;font-size:11px;font-weight:800;letter-spacing:.5px;padding:2px 7px;border-radius:10px;white-space:nowrap}
.ps3d-adm-chips span b{color:#ffe14d;font-weight:800;margin-left:4px}
.ps3d-hud.compact~.ps3d-adm-chips{top:48px}
.ps3d-adm-crown{position:absolute;right:68px;top:14px;width:44px;height:40px;border-radius:6px;border:0;background:rgba(120,40,160,.75);color:#ffe14d;font-size:20px;pointer-events:auto;z-index:4}
.ps3d-adm{position:absolute;inset:0;background:rgba(10,4,24,.62);display:none;align-items:center;justify-content:center;pointer-events:auto;z-index:6}
.ps3d-adm .box{background:linear-gradient(#2a1840,#140c26);border:1px solid rgba(255,215,0,.45);border-radius:10px;padding:16px 18px;width:min(760px,94vw);max-height:90vh;overflow:auto;color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.6);font-size:13px}
.ps3d-adm h2{margin:0 0 4px;font-style:italic;letter-spacing:3px;color:#ffe14d;font-size:20px}
.ps3d-adm .sub{color:#c9b6e6;margin-bottom:10px}
.ps3d-adm .opts{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;background:rgba(255,255,255,.06);padding:8px 10px;border-radius:8px;margin-bottom:10px}
.ps3d-adm label{display:flex;gap:6px;align-items:center;color:#d8c9f0;font-weight:600}
.ps3d-adm select,.ps3d-adm input{background:#1d1233;color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:5px;padding:4px 6px;font:inherit}
.ps3d-adm input[type=number]{width:56px}.ps3d-adm input[type=text]{width:130px}
.ps3d-adm .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:7px}
.ps3d-adm .grid button{text-align:left;border:0;border-radius:7px;padding:8px 10px;background:#3a2358;color:#fff;cursor:pointer;font:inherit;font-weight:800;line-height:1.2}
.ps3d-adm .grid button small{display:block;font-weight:500;color:#cdbbe8;font-size:11px;margin-top:2px}
.ps3d-adm .grid button:hover,.ps3d-adm .grid button:focus{background:#ffd400;color:#1a0f2e;outline:none}
.ps3d-adm .grid button:hover small,.ps3d-adm .grid button:focus small{color:#3a2358}
.ps3d-adm .grid button.owner{background:#6a1a2a}
.ps3d-adm .grid button:disabled{opacity:.4;cursor:not-allowed}
.ps3d-adm .status{min-height:18px;margin:8px 0 0;color:#ffe14d;font-weight:700}
.ps3d-adm .warn{background:#6a1a2a;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-weight:700}
.ps3d-adm .close{float:right;border:0;background:#3a2358;color:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-weight:800}
`;
let styleRefs = 0, styleEl = null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isTyping = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };

export class AdminUi {
  // opts: { hud, home, away, level, mode: 'local'|'relay'|'blocked', bySide: 0|1, touch, apply(id, params) -> {ok,error?}, playerName(idx), onOpen(open) }
  constructor(root, opts) {
    if (!styleRefs++) { styleEl = document.createElement('style'); styleEl.textContent = CSS; document.head.appendChild(styleEl); }
    this.root = root; this.o = opts; this.hud = opts.hud;
    this.chips = document.createElement('div');
    this.chips.className = 'ps3d-adm-chips';
    root.appendChild(this.chips);
    this.chipKey = '';
    this.names = ['', ''];
    this.open = false;
    this.level = opts.level || null;
    if (!this.level) return;
    this.el = document.createElement('div');
    this.el.className = 'ps3d-adm';
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.toggle(false); });
    this._kd = (e) => {
      if (e.code === 'Backquote' || e.code === 'Backslash') {
        if (isTyping(e) && e.target.type === 'text') return;
        e.preventDefault(); e.stopPropagation();
        this.toggle();
      } else if (this.open && e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.toggle(false); }
    };
    window.addEventListener('keydown', this._kd, true);
    if (opts.touch) {
      this.crown = document.createElement('button');
      this.crown.className = 'ps3d-adm-crown';
      this.crown.textContent = '♛';
      this.crown.title = 'Admin';
      this.crown.addEventListener('click', (e) => { e.preventDefault(); this.toggle(); });
      this.crown.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      root.appendChild(this.crown);
    }
    this.params = { target: 'opponent', seconds: 20, count: 3, name: 'NOOBS', player: -1, home: 0, away: 0, homeName: '', awayName: '' };
    this._build();
  }

  toggle(show = !this.open) {
    if (!this.el || show === this.open) return;
    this.open = show;
    this.el.style.display = show ? 'flex' : 'none';
    if (show) this._refreshPlayers();
    if (this.o.onOpen) this.o.onOpen(show);
    if (show) setTimeout(() => { const b = this.el.querySelector('.grid button:not(:disabled)'); if (b) b.focus(); }, 0);
  }

  _build() {
    const o = this.o;
    const list = ADMIN_EFFECTS.filter((e) => !e.ownerOnly || this.level === 'owner');
    const blocked = o.mode === 'blocked';
    this.el.innerHTML = `<div class="box">
      <button class="close" data-close>Close</button>
      <h2>♛ ADMIN</h2>
      <div class="sub">${this.level === 'owner' ? 'Owner' : 'Moderator'} fun effects &middot; temporary, this match only &middot; both players see an "ADMIN EFFECT" notice</div>
      ${blocked ? '<div class="warn">Admin effects only work when you host</div>' : ''}
      <div class="opts">
        <label>Target <select data-k="target"><option value="opponent">Opponent</option><option value="mine">My team</option><option value="everyone">Everyone</option></select></label>
        <label>Seconds <input type="number" data-k="seconds" min="1" max="120" value="20"></label>
        <label>Vanish count <input type="number" data-k="count" min="1" max="6" value="3"></label>
        <label>Name <input type="text" data-k="name" maxlength="16" value="NOOBS"></label>
        <label>Red card <select data-k="player"><option value="-1">Random</option></select></label>
      </div>
      <div class="opts">
        <label>Edit score <input type="number" data-k="home" min="0" max="99" value="0"> - <input type="number" data-k="away" min="0" max="99" value="0"></label>
        <label>Names <input type="text" data-k="homeName" maxlength="16" placeholder="${esc(o.home.short || 'HOME')}"> <input type="text" data-k="awayName" maxlength="16" placeholder="${esc(o.away.short || 'AWAY')}"></label>
      </div>
      <div class="grid"></div>
      <div class="status"></div>
    </div>`;
    const grid = this.el.querySelector('.grid');
    for (const e of list) {
      const b = document.createElement('button');
      if (e.ownerOnly) b.className = 'owner';
      b.innerHTML = `${esc(e.label)}<small>${esc(e.desc)}</small>`;
      b.disabled = blocked;
      b.addEventListener('click', () => this._apply(e));
      grid.appendChild(b);
    }
    this.statusEl = this.el.querySelector('.status');
    this.el.querySelector('[data-close]').addEventListener('click', () => this.toggle(false));
    for (const inp of this.el.querySelectorAll('[data-k]')) {
      inp.addEventListener('change', () => { this.params[inp.dataset.k] = inp.type === 'number' || inp.dataset.k === 'player' ? +inp.value : inp.value; if (inp.dataset.k === 'target') this._refreshPlayers(); });
      inp.addEventListener('input', () => { this.params[inp.dataset.k] = inp.type === 'number' || inp.dataset.k === 'player' ? +inp.value : inp.value; });
      inp.addEventListener('keydown', (ev) => ev.stopPropagation());
    }
  }

  _refreshPlayers() {
    const sel = this.el && this.el.querySelector('[data-k="player"]');
    if (!sel) return;
    const team = this.params.target === 'mine' ? this.o.bySide : 1 - this.o.bySide;
    const cur = String(this.params.player);
    sel.innerHTML = '<option value="-1">Random</option>';
    for (let i = 1; i < 11; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = (this.o.playerName && this.o.playerName(team * 11 + i)) || `#${i + 1}`;
      sel.appendChild(opt);
    }
    sel.value = [...sel.options].some((x) => x.value === cur) ? cur : '-1';
  }

  _apply(def) {
    const p = this.params;
    const params = { target: p.target, seconds: p.seconds };
    if (def.id === 'vanish') params.count = p.count;
    if (def.id === 'rename') params.name = p.name;
    if (def.id === 'redcard') params.player = p.player;
    if (def.id === 'editscore') Object.assign(params, { home: p.home, away: p.away, homeName: p.homeName, awayName: p.awayName });
    let r;
    try { r = this.o.apply(def.id, params); } catch { r = { ok: false, error: 'failed' }; }
    const msg = r && r.ok ? (r.sent ? `Sent to host: ${def.label}` : `Applied: ${def.label}`) : `Not applied: ${(r && r.error) || 'failed'}`;
    this.statusEl.textContent = msg;
    if (r && r.ok && (def.id === 'end' || def.id === 'win')) this.toggle(false);
  }

  // every frame (all clients): chips for active effects, scoreboard renames
  update(view) {
    const ae = (view && view.ae) || [];
    const key = ae.map((a) => `${a[0]}${a[1]}${Math.ceil(a[2])}${a[0] === 'rn' ? a[3] : ''}`).join('|');
    if (key !== this.chipKey) {
      this.chipKey = key;
      const sh = [this.o.home.short || 'HOM', this.o.away.short || 'AWY'];
      this.chips.innerHTML = ae.map((a) => {
        const d = ADMIN_BY_CODE[a[0]];
        if (!d) return '';
        const who = d.scope === 'team' && a[1] !== 2 ? ` ${sh[a[1]]}` : '';
        return `<span>♛ ${esc(d.label.toUpperCase())}${esc(who)}<b>${Math.ceil(a[2])}s</b></span>`;
      }).join('');
    }
    const nm = ['', ''];
    for (const a of ae) if (a[0] === 'rn' && typeof a[3] === 'string') { if (a[1] !== 1) nm[0] = a[3]; if (a[1] !== 0) nm[1] = a[3]; }
    const hud = this.hud;
    for (let s = 0; s < 2; s++) {
      if (nm[s] === this.names[s]) continue;
      this.names[s] = nm[s];
      const el = s === 0 ? hud.hCode : hud.aCode;
      const team = s === 0 ? this.o.home : this.o.away;
      if (el) { el.textContent = nm[s] || team.short || team.id || ''; el.style.color = nm[s] ? '#ffe14d' : ''; }
    }
  }

  dispose() {
    if (this._kd) window.removeEventListener('keydown', this._kd, true);
    if (this.el) this.el.remove();
    if (this.crown) this.crown.remove();
    this.chips.remove();
    if (!--styleRefs && styleEl) { styleEl.remove(); styleEl = null; }
  }
}
