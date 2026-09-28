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

function addStyle() {
  if (typeof document === 'undefined' || document.getElementById('ps3d-gc-css')) return;
  const s = document.createElement('style');
  s.id = 'ps3d-gc-css';
  s.textContent = CSS;
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
  }

  hide() { this._clear(); this.el.classList.remove('show'); }

  dispose() {
    this.disposed = true;
    this._clear();
    this.el.remove();
  }
}
