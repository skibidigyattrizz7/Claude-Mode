// Goal scorer card: after a goal, the scorer's player card slides in at the bottom-left with a
// broadcast-style name plate under it (solid dark plate, team-colour accent bar, condensed name),
// stays ~4.5 s (through the goal replay) and slides out again.
//
// Card art: inside the full app (meta.css loaded) the real FUT-style card from meta/ui/card.js is
// used when the scorer's id resolves in the player DB (UT, career, national teams...). Otherwise
// (engine test pages, foreign/online cards the DB doesn't know) a simple kit-coloured card is built
// from what the engine has: name, OVR, position, shirt number.
//
// Works for local and online (guest) matches alike: it's driven by the 'goal' fx in the view,
// which the guest gets through the snapshot.
import { luminance } from '../core/kits.js';

const SHOW_DELAY = 0.45; // s after the ball crosses the line (lets the GOAL banner land first)
const SHOW_FOR = 4.6;    // s on screen
const SIDES = ['home', 'away'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEX = /^#[0-9a-f]{6}$/i;
const lum = (c) => { try { return luminance(c); } catch { return 0.5; } };

/** Surname for the card face ("R. Alves" -> "Alves", "Vinicius" -> "Vinicius"). */
export function cardSurname(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const parts = s.split(/\s+/);
  return parts.length > 1 && /\.$/.test(parts[0]) ? parts.slice(1).join(' ') : parts[parts.length - 1];
}

/**
 * Pure: everything the overlay needs from a 'goal' fx.
 * fx      {team: scoring side 0|1, pi: player index 0..21 (0-10 home), og: 0|1}
 * pd      the match player at fx.pi ({id, name, number, pos, ovr})
 * teams   [home, away] contract teams (resolved kits)
 * minute  display minute (already capped)
 */
export function goalCardInfo(fx, pd, teams, minute) {
  const f = fx || {};
  const p = pd || {};
  const pi = Number.isFinite(+f.pi) ? +f.pi : -1;
  // which team the player plays for (for an own goal that's NOT the scoring team)
  const side = pi >= 0 ? (pi < 11 ? 0 : 1) : (f.team === 1 ? 1 : 0);
  const scoring = f.team === 0 || f.team === 1 ? f.team : side;
  const og = !!f.og || side !== scoring;
  const team = (teams && teams[side]) || {};
  const kit = team.kit || {};
  const primary = HEX.test(kit.primary || '') ? kit.primary : '#3a4150';
  const secondary = HEX.test(kit.secondary || '') ? kit.secondary : (lum(primary) > 0.5 ? '#111111' : '#ffffff');
  // accent bar sits on a near-black plate: a (near-)black kit uses its secondary colour instead
  const accent = lum(primary) < 0.14 && lum(secondary) >= 0.14 ? secondary : primary;
  const ovr = +p.ovr > 0 ? Math.max(1, Math.min(99, Math.round(+p.ovr))) : null;
  const name = String(p.name || '').trim() || 'Unknown';
  const m = Number.isFinite(+minute) ? Math.max(1, Math.round(+minute)) : null;
  return {
    id: p.id != null ? String(p.id) : null,
    name,
    surname: cardSurname(name),
    number: p.number != null && p.number !== '' ? String(p.number) : '',
    pos: String(p.pos || ''),
    ovr,
    side,
    sideName: SIDES[side],
    scoringSide: scoring,
    og,
    label: og ? 'OWN GOAL' : 'GOAL',
    minute: m,
    teamShort: String(team.short || team.id || '').slice(0, 4).toUpperCase(),
    accent,
    kit: { primary, secondary, ink: lum(primary) > 0.55 ? '#0b0d10' : '#ffffff' },
  };
}

const CSS = `
.ps3d-gc{position:absolute;left:18px;bottom:132px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;pointer-events:none;
  transform-origin:left bottom;transform:translateX(calc(-100% - 40px));visibility:hidden;transition:transform .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear .22s}
.ps3d-gc.show{transform:none;visibility:visible;transition:transform .24s cubic-bezier(.15,.9,.25,1.05),visibility 0s}
.ps3d-gc .gc-card{width:140px;height:196px;position:relative;flex:none}
.ps3d-gc .gc-card .pm-card{font-size:14px}
.ps3d-gc .gc-plate{display:flex;align-items:stretch;min-width:150px;max-width:260px;background:#0e1014;box-shadow:0 4px 14px rgba(0,0,0,.5);border-radius:3px;overflow:hidden}
.ps3d-gc .gc-bar{width:6px;flex:none}
.ps3d-gc .gc-txt{padding:6px 12px 7px 10px;min-width:0}
.ps3d-gc .gc-name{font:700 22px/1.05 "Barlow Condensed","Bahnschrift","Roboto Condensed","Arial Narrow",sans-serif;letter-spacing:.3px;text-transform:uppercase;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ps3d-gc .gc-meta{display:flex;gap:8px;align-items:center;margin-top:3px;font:600 13px/1 "Barlow Condensed","Bahnschrift","Roboto Condensed","Arial Narrow",sans-serif;letter-spacing:.8px;color:#aeb6c2;text-transform:uppercase;white-space:nowrap}
.ps3d-gc .gc-meta b{color:#fff;font-weight:700}
.ps3d-gc .gc-meta .og{background:#d0213a;color:#fff;padding:2px 5px;border-radius:2px;font-weight:700}
/* simple card when the real card art isn't available (engine-only pages, unknown cards) */
.ps3d-gc .gc-simple{position:absolute;inset:0;background:var(--gk1);color:var(--gk3);clip-path:polygon(0 5%,7% 0,93% 0,100% 5%,100% 91%,50% 100%,0 91%);font-family:"Barlow Condensed","Bahnschrift","Roboto Condensed","Arial Narrow",sans-serif;overflow:hidden}
.ps3d-gc .gc-simple .ovr{position:absolute;left:16px;top:14px;font-size:40px;font-weight:700;line-height:.9}
.ps3d-gc .gc-simple .pos{position:absolute;left:18px;top:52px;font-size:17px;font-weight:600;letter-spacing:.5px}
.ps3d-gc .gc-simple .num{position:absolute;right:12px;top:40px;font-size:62px;letter-spacing:-1px;font-weight:700;line-height:1;color:var(--gk2);opacity:.9}
.ps3d-gc .gc-simple .nm{position:absolute;left:0;right:0;bottom:0;height:62px;background:#0e1014;color:#fff;text-align:center;padding-top:10px;border-top:3px solid var(--gk2);font-size:20px;font-weight:700;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ps3d-gc.compact{transform-origin:left bottom}
.ps3d-gc.compact.show{transform:scale(.8)}
.ps3d-gc.compact:not(.show){transform:translateX(calc(-100% - 40px)) scale(.8)}
/* touch: ~60% scale, kept clear of the joystick (bottom-left) */
.ps3d-gc.touch{left:max(28px,calc(env(safe-area-inset-left) + 16px));bottom:max(182px,calc(env(safe-area-inset-bottom) + 170px))}
.ps3d-gc.touch.show{transform:scale(.6)}
.ps3d-gc.touch:not(.show){transform:translateX(calc(-100% - 40px)) scale(.6)}
.ps3d-gc.touch.short{left:max(184px,calc(env(safe-area-inset-left) + 172px));bottom:max(14px,calc(env(safe-area-inset-bottom) + 8px))}
.ps3d-gc.touch.short:not(.show){transform:translateY(calc(100% + 40px)) scale(.6)}
@media (prefers-reduced-motion:reduce){.ps3d-gc,.ps3d-gc.show{transition:none}}
`;

// Signature goal celebrations for specific cards (owner request, Sep 29). Rabbi Patel (secretcard.js
// 'secret_knight'): the Israeli flag fills the screen, its Star of David spins, then the star expands until the
// empty hexagon in its middle swallows the screen, as the exit before the replay / celebration ends.
const FLAG_GOAL_IDS = new Set(['secret_knight']);
const FLAG_T = { in: 0.25, spinEnd: 3.1, out: 4.2 }; // s after the goal
const CELEB_IMGS = [['l', 'bibi-call.webp'], ['t', 'tel-aviv-impressed.webp'], ['b', 'bibi-impressed.webp']];
const STAR = '<svg class="gcf-star" viewBox="-50 -50 100 100" aria-hidden="true"><g fill="none" stroke="#0038b8" stroke-width="6" stroke-linejoin="miter">'
  + '<path d="M0 -40 34.64 20 -34.64 20Z"/><path d="M0 40 -34.64 -20 34.64 -20Z"/></g></svg>';
const FLAG_CSS = `
.gcf{position:absolute;inset:0;z-index:6;pointer-events:none;overflow:hidden;background:#fff;opacity:0;transition:opacity .35s ease}
.gcf.on{opacity:1}.gcf.gone{opacity:0;transition:opacity .3s ease}
.gcf::before,.gcf::after{content:"";position:absolute;left:0;right:0;height:11%;background:#0038b8;transition:transform .7s cubic-bezier(.6,0,.9,.4)}
.gcf::before{top:9%}.gcf::after{bottom:9%}
.gcf.exit::before{transform:translateY(-240%)}.gcf.exit::after{transform:translateY(240%)}
.gcf-star{position:absolute;left:50%;top:50%;width:min(40vh,40vw);height:min(40vh,40vw);transform:translate(-50%,-50%) rotate(0) scale(1)}
.gcf.on .gcf-star{animation:gcf-spin 2.6s linear infinite}
.gcf-img{position:absolute;z-index:2;display:block;border-radius:10px;border:3px solid #fff;box-shadow:0 10px 26px rgba(0,0,0,.35);opacity:0}
.gcf-img.l{left:calc(50% - min(20vh,20vw) - 3vw);top:50%;height:min(36vh,36vw);translate:-100% -50%}
.gcf-img.t{left:50%;top:calc(50% - min(20vh,20vw) - 2vh);height:min(24vh,26vw);translate:-50% -100%}
.gcf-img.b{left:50%;top:calc(50% + min(20vh,20vw) + 2vh);height:min(26vh,30vw);translate:-50% 0}
.gcf.on .gcf-img{animation:gcf-pop .5s cubic-bezier(.2,.8,.2,1) both}
.gcf.on .gcf-img.t{animation-delay:.25s}.gcf.on .gcf-img.b{animation-delay:.5s}
.gcf.exit .gcf-img{animation:gcf-away .35s ease-in both}
@keyframes gcf-pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
@keyframes gcf-away{from{opacity:1}to{opacity:0;transform:scale(.85)}}
@keyframes gcf-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.gcf.on .gcf-star{animation:none}.gcf.on .gcf-img{animation:none;opacity:1}}
`;

function addStyle() {
  if (typeof document === 'undefined' || document.getElementById('ps3d-gc-css')) return;
  const s = document.createElement('style');
  s.id = 'ps3d-gc-css';
  s.textContent = CSS + FLAG_CSS;
  document.head.appendChild(s);
}

/** The app's card styles are on the page (full app, not the engine test harness). */
function metaCardCss() {
  try { return !!document.querySelector('link[rel="stylesheet"][href*="meta.css"]'); } catch { return false; }
}

export class GoalCard {
  /**
   * parent  element to mount in (the HUD layer, so the pause menu still covers it)
   * opts    { home, away, touch }
   */
  constructor(parent, { home, away, touch = false } = {}) {
    addStyle();
    this.touch = !!touch;
    this.parent = parent;
    this.el = document.createElement('div');
    this.el.className = 'ps3d-gc' + (this.touch ? ' touch' : '');
    this.el.setAttribute('aria-live', 'polite');
    parent.appendChild(this.el);
    this.timers = [];
    this.meta = null;
    this.disposed = false;
    // Resolve real cards up front (during the stadium load), never mid-match.
    if (metaCardCss()) {
      const ids = [home, away].flatMap((t) => [...((t && t.players) || []), ...((t && t.bench) || [])]).map((p) => p && p.id).filter(Boolean);
      Promise.all([import('../../meta/ui/card.js'), import('../../meta/core/players.js')]).then(([card, players]) => {
        if (this.disposed) return;
        const cards = new Map();
        for (const id of ids) {
          try { const p = players.getPlayer(id); if (p && p.stats && p.gk) cards.set(String(id), p); } catch { /* unknown id */ }
        }
        this.meta = { playerCard: card.playerCard, cards };
      }).catch((e) => console.warn('[pitchside-engine] goal card art unavailable', e && e.message));
    }
  }

  _cardEl(info) {
    const box = document.createElement('div');
    box.className = 'gc-card';
    const p = this.meta && info.id ? this.meta.cards.get(info.id) : null;
    if (p) {
      try { box.appendChild(this.meta.playerCard(p, { size: 'md' })); return box; } catch (e) { console.warn('[pitchside-engine] goal card render failed', e); }
    }
    box.innerHTML = `<div class="gc-simple" style="--gk1:${info.kit.primary};--gk2:${info.kit.secondary};--gk3:${info.kit.ink}">`
      + `${info.ovr ? `<div class="ovr">${info.ovr}</div>` : ''}<div class="pos">${esc(info.pos)}</div>`
      + `${info.number ? `<div class="num">${esc(info.number)}</div>` : ''}<div class="nm">${esc(info.surname)}</div></div>`;
    return box;
  }

  _clear() { for (const t of this.timers) clearTimeout(t); this.timers.length = 0; }

  show(info) {
    if (this.disposed || !info) return;
    this._clear();
    const el = this.el;
    el.classList.remove('show');
    const root = this.parent;
    const w = root.clientWidth || 1366, h = root.clientHeight || 768;
    el.classList.toggle('compact', !this.touch && (h < 560 || w < 760));
    el.classList.toggle('short', this.touch && h < 600);
    const minute = info.minute ? `<b>${info.minute}'</b>` : '';
    el.innerHTML = '';
    el.appendChild(this._cardEl(info));
    const plate = document.createElement('div');
    plate.className = 'gc-plate';
    plate.innerHTML = `<div class="gc-bar" style="background:${info.accent}"></div><div class="gc-txt">`
      + `<div class="gc-name">${esc(info.name)}</div>`
      + `<div class="gc-meta">${info.og ? '<span class="og">OG</span>' : ''}<span>${info.label}</span>${minute}${info.teamShort ? `<span>${esc(info.teamShort)}</span>` : ''}</div></div>`;
    el.appendChild(plate);
    el.setAttribute('aria-label', `${info.label}: ${info.name}${info.minute ? `, ${info.minute} minutes` : ''}`);
    this.timers.push(setTimeout(() => el.classList.add('show'), SHOW_DELAY * 1000));
    this.timers.push(setTimeout(() => el.classList.remove('show'), (SHOW_DELAY + SHOW_FOR) * 1000));
    if (!info.og && info.id && FLAG_GOAL_IDS.has(info.id)) this._flagGoal();
  }

  /** Rabbi Patel's goal: flag in, spinning Star of David, then the star expands out through its hexagon. */
  _flagGoal() {
    if (this.fx) this.fx.remove();
    const fx = document.createElement('div');
    fx.className = 'gcf';
    fx.innerHTML = STAR;
    // owner's photos around the star (Sep 30): left, top, bottom
    for (const [cls, file] of CELEB_IMGS) {
      const img = document.createElement('img');
      img.className = `gcf-img ${cls}`; img.alt = ''; img.decoding = 'async';
      img.src = new URL(`../../../assets/celebration/${file}`, import.meta.url).href;
      fx.appendChild(img);
    }
    this.parent.appendChild(fx);
    this.fx = fx;
    const star = fx.firstChild;
    this.timers.push(setTimeout(() => fx.classList.add('on'), FLAG_T.in * 1000));
    this.timers.push(setTimeout(() => {
      // freeze the spin where it is, then zoom from that angle (inline styles, so the zoom always animates)
      const m = getComputedStyle(star).transform;
      let deg = 0;
      const mm = /matrix\(([^,]+),\s*([^,]+)/.exec(m || '');
      if (mm) deg = Math.round(Math.atan2(+mm[2], +mm[1]) * 180 / Math.PI);
      star.style.animation = 'none';
      star.style.transform = `translate(-50%,-50%) rotate(${deg}deg) scale(1)`;
      void star.getBoundingClientRect();
      star.style.transition = 'transform 1s cubic-bezier(.55,0,.8,.2)';
      star.style.transform = `translate(-50%,-50%) rotate(${deg + 30}deg) scale(30)`;
      fx.classList.add('exit');
    }, FLAG_T.spinEnd * 1000));
    this.timers.push(setTimeout(() => fx.classList.add('gone'), FLAG_T.out * 1000));
    this.timers.push(setTimeout(() => { fx.remove(); if (this.fx === fx) this.fx = null; }, (FLAG_T.out + 0.4) * 1000));
  }

  hide() { this._clear(); this.el.classList.remove('show'); if (this.fx) { this.fx.remove(); this.fx = null; } }

  dispose() {
    this.disposed = true;
    this._clear();
    if (this.fx) { this.fx.remove(); this.fx = null; }
    this.el.remove();
  }
}
