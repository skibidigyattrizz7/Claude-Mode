// FC-style PlayStyle icons as inline SVG (owner request, Sep 27). One original, simple glyph per PlayStyle,
// drawn on a 24x24 grid in `currentColor`, placed on a badge:
//   normal      -> dark rounded diamond, white glyph
//   PlayStyle+  -> gold gem/shield badge (flat top, pointed bottom), dark glyph
// Pure string builders (no DOM needed) so cards, lists, the detail view and the admin card creator can all
// share them; `ensurePsiStyles()` injects the badge CSS once (kept here so the global stylesheets stay untouched).
import { PLAYSTYLES, canonStyle } from '../core/physique.js';

const ball = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="1.7"/>`
  + `<path d="M${cx} ${cy - r * 0.45}l${r * 0.43} ${r * 0.31}-${r * 0.16} ${r * 0.5}h-${r * 0.54}l-${r * 0.16}-${r * 0.5}z" fill="currentColor"/>`;
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor"';
const head = (x, y, r = 2.2) => `<circle cx="${x}" cy="${y}" r="${r}" ${F}/>`;
const arrowHead = (x, y, ang, len = 4.5) => {
  const a1 = ang + 2.55, a2 = ang - 2.55;
  return `<path d="M${(x + Math.cos(a1) * len).toFixed(2)} ${(y + Math.sin(a1) * len).toFixed(2)}L${x} ${y}L${(x + Math.cos(a2) * len).toFixed(2)} ${(y + Math.sin(a2) * len).toFixed(2)}" ${S}/>`;
};

/** id -> inner SVG markup on a 24x24 grid. */
export const PS_GLYPHS = {
  // ---------- attack ----------
  finesse: ball(16, 8, 5.2) + `<path d="M2.5 22C2.5 15 5.5 11 10.2 9.6" ${S} stroke-width="2.8"/>` + `<path d="M5 22.5c.5-3.5 2-6 4.5-7.5" ${S} stroke-width="1.4" stroke-opacity=".7"/>`,
  power: ball(15.5, 12, 5.8) + `<path d="M2 8h5.5M1 12h6M2 16h5.5" ${S}/>` + `<path d="M21.5 5l1.5-2M22.5 12h1.5M21.5 19l1.5 2" ${S} stroke-width="1.6"/>`,
  chip: ball(19, 16.5, 3.4) + `<path d="M2.5 20Q8 -1 16 12" ${S} stroke-dasharray="2.2 2.2"/>` + `<path d="M2 22.5h20" ${S} stroke-width="1.5"/>`,
  deadball: ball(5.5, 18.5, 3.3) + `<path d="M8.5 15.5Q14 1 22 5" ${S}/>` + `<path d="M12.5 21v-5.5M15.5 21v-5.5M18.5 21v-5.5" ${S} stroke-width="2.4"/>`,
  trivela: `<path d="M3 5.5h6.5v5.5l6.5 2.5q2.3 1 1.3 3.3l-.3.7H5q-2 0-2-2z" ${F}/>` + `<path d="M17 12.5Q23 10 21 3.5" ${S}/>` + arrowHead(21, 3.5, -1.85, 4),
  lowdriven: ball(17.5, 15.5, 4.8) + `<path d="M1.5 12.5h8M3 16.5h7M1.5 20.5h8" ${S}/>` + `<path d="M11 22.5h12" ${S} stroke-width="1.4"/>`,
  powerheader: head(8, 9, 4) + `<path d="M1.5 23q0-8 6.5-8t6.5 8" ${F}/>` + ball(19, 6.5, 3.2) + `<path d="M13 8.5l2.3-.8" ${S}/>` + `<circle cx="19" cy="6.5" r="5.2" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1.6 1.6"/>`,
  acrobatic: head(4.5, 18.5, 2.3) + `<path d="M6.8 17.3L12 12.5M12 12.5L17.5 4.5M12 12.5l1.5-5.5M9.5 14.8l-3-5" ${S}/>` + ball(20.5, 3.8, 2.6) + `<path d="M2 22.5h20" ${S} stroke-width="1.4"/>`,
  gamechanger: ball(10.5, 13.5, 6) + `<path d="M19 1.5v5M16.5 4h5M21 10.5v3M19.5 12h3" ${S} stroke-width="1.8"/>` + `<path d="M16.5 20.5l2.2-2.2M18 23l3-1" ${S} stroke-width="1.6"/>`,
  // ---------- passing ----------
  incisive: `<circle cx="12" cy="4.5" r="2.4" ${F}/><circle cx="12" cy="19.5" r="2.4" ${F}/>` + `<path d="M2 12h19" ${S} stroke-width="2.4"/>` + arrowHead(21.5, 12, 0, 5),
  tikitaka: `<circle cx="12" cy="4" r="2.6" ${F}/><circle cx="4" cy="19" r="2.6" ${F}/><circle cx="20" cy="19" r="2.6" ${F}/>`
    + `<path d="M10.3 6.8L5.9 15.6M7 19h10M18.2 16.1L13.8 7.3" ${S} stroke-width="1.7"/>` + arrowHead(17, 19, 0, 3) + arrowHead(13.8, 7.3, -2.03, 3) + arrowHead(5.9, 15.6, 2.03, 3),
  pinged: `<path d="M8 12h12" ${S} stroke-width="2.6"/>` + arrowHead(21, 12, 0, 6) + `<path d="M2 7.5h6M1 12h4M2 16.5h6" ${S} stroke-width="1.7"/>`,
  longball: `<path d="M3 20Q11 -3 20.5 16" ${S} stroke-width="2.3"/>` + arrowHead(20.5, 16, 1.2, 5) + `<path d="M1.5 22.5h21" ${S} stroke-width="1.3"/>`,
  whipped: ball(4.5, 5, 3) + `<path d="M8 5.5Q21 6 19 19.5" ${S} stroke-width="2.3"/>` + arrowHead(19, 19.5, 1.72, 4.5),
  inventive: `<path d="M12 2.5a6.8 6.8 0 0 0-4 12.3V17h8v-2.2a6.8 6.8 0 0 0-4-12.3z" ${S}/>` + `<path d="M9 20h6M10.3 22.8h3.4" ${S}/>` + `<path d="M12 6.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z" ${F}/>`,
  // ---------- ball control ----------
  firsttouch: `<path d="M5 3v8a7 7 0 0 0 14 0V3" ${S} stroke-width="3.6" stroke-linecap="butt"/>` + `<path d="M3 4h4M17 4h4" ${S} stroke-width="3.4" stroke-linecap="butt"/>` + ball(12, 11, 3),
  technical: `<path d="M3 21L8 16 5 11 10 7.5 8 3.5" ${S} stroke-dasharray="2.4 1.8"/>` + `<path d="M13 19l2.5-4.5 2.5 4.5zM15 11l2.5-4.5L20 11z" ${F}/>` + ball(10.5, 3.2, 2.4),
  rapid: head(14.5, 3.6, 2.4) + `<path d="M13.5 7.2L11 13.5M11 13.5l4 3.2-1 5M11 13.5l-4.2 2.5-3-1M12.8 8.2l4.2 2.5M12.8 8.2l-4.3 1.6" ${S}/>` + ball(20, 19.2, 2.6) + `<path d="M1 5.5h4.5M1.5 9.5h3" ${S} stroke-width="1.5"/>`,
  flair: `<path d="M9 1.5l1.9 5.6 5.6 1.9-5.6 1.9L9 16.5l-1.9-5.6L1.5 9l5.6-1.9z" ${F}/>` + `<path d="M18 13l1.1 3.4 3.4 1.1-3.4 1.1L18 22l-1.1-3.4-3.4-1.1 3.4-1.1z" ${F}/>`,
  trickster: ball(12, 12, 3.6) + `<path d="M12 3.5A8.5 8.5 0 1 1 3.7 10" ${S} stroke-width="2.2"/>` + arrowHead(12, 3.5, -0.2, 4),
  pressproven: ball(12, 12, 4) + `<path d="M2 6l4.5 6L2 18M22 6l-4.5 6 4.5 6" ${S} stroke-width="2.3"/>`,
  // ---------- defending ----------
  anticipate: `<path d="M1.5 12Q12 1.5 22.5 12 12 22.5 1.5 12z" ${S}/>` + `<circle cx="12" cy="12" r="4.3" ${F}/>` + `<circle cx="13.4" cy="10.6" r="1.3" fill="var(--psi-bg,#1b2230)"/>`,
  intercept: `<path d="M1.5 17h21" ${S} stroke-dasharray="2.6 2.2" stroke-width="2"/>` + `<path d="M9.5 1.5v12a5.5 5.5 0 0 0 11 0V9" ${S} stroke-width="3"/>` + arrowHead(20.5, 8.5, -1.57, 4.2),
  block: `<path d="M12 1.8l8.5 3.2v6.2q0 7.6-8.5 11-8.5-3.4-8.5-11V5z" ${F}/>` + `<path d="M7.5 12h9" stroke="var(--psi-bg,#1b2230)" stroke-width="2.4" stroke-linecap="round"/>`,
  jockey: head(12, 3.5, 2.4) + `<path d="M12 6.5v6M12 8.5l-4.5 3M12 8.5l4.5 3M12 12.5l-4 2.5v3.5M12 12.5l4 2.5v3.5" ${S}/>` + `<path d="M2 21h5M17 21h5" ${S} stroke-width="1.8"/>` + arrowHead(2, 21, Math.PI, 3) + arrowHead(22, 21, 0, 3),
  slidetackle: head(4.5, 9.5, 2.3) + `<path d="M6 12.5l6.5 5 8 1.5M12.5 17.5l-1-5.5 4-2M8.5 14.3L6.5 18" ${S}/>` + ball(21, 14.5, 2.4) + `<path d="M1.5 22h21" ${S} stroke-width="1.4"/>`,
  bruiser: `<path d="M3.5 22V13Q3.5 5 10 5h2.5l1 3.5-3.5 1.5q1 3 5 2.2 3.5-1.5 5.5.8 1.5 2 1 5.5l-.5 3.5z" ${F}/>`,
  aerial: `<path d="M4 22.5V11h3.2v2.6h2.7V11h4.2v2.6h2.7V11H20v11.5z" ${F}/>` + ball(12, 4.5, 3.2),
  // ---------- physical ----------
  quickstep: `<path d="M3 5l7.5 7L3 19M11.5 5l7.5 7-7.5 7" ${S} stroke-width="2.8"/>` + `<path d="M21.5 4v16" ${S} stroke-width="2.4"/>`,
  relentless: `<rect x="2.5" y="6.5" width="17" height="11" rx="2" ${S}/><path d="M21 10v4" ${S} stroke-width="2.6"/>` + `<path d="M12 7.8l-4 4.9h3.2l-1.2 3.8 4-4.9h-3.2z" ${F}/>`,
  longthrow: ball(6, 4.5, 3) + `<path d="M2.5 13l2-5M9.5 13l-2-5M6 13v9" ${S}/>` + `<path d="M10 5Q19 3 21.5 17" ${S} stroke-dasharray="2.4 1.8"/>` + arrowHead(21.5, 17, 1.4, 4),
  enforcer: `<path d="M5 9.5q0-2 2-2h11q2.5 0 2.5 2.5v6q0 4.5-4.5 4.5H9.5q-4.5 0-4.5-4.5z" ${F}/>` + `<path d="M9 7.8v4.2M12.5 7.8v4.2M16 7.8v4.2" stroke="var(--psi-bg,#1b2230)" stroke-width="1.5"/>`
    + `<path d="M2 3l2.5 2.2M8 1.5v2.6M14 1.8l-1 2.4" ${S} stroke-width="1.6"/>`,
  // ---------- goalkeeping ----------
  farreach: `<path d="M6.5 22v-6.5L3 11.2q-1-1.6.6-2.3 1.2-.4 2 .8l2 2.6V3.5q0-1.4 1.3-1.4t1.3 1.4V10V2.2q0-1.4 1.3-1.4t1.3 1.4V10V3q0-1.4 1.3-1.4t1.3 1.4V10.5V5.5q0-1.4 1.3-1.4t1.3 1.4V15q0 3-2.5 4.5V22z" ${F}/>`,
  footwork: `<path d="M5.5 3.5q3-1 3.8 3.5.6 4-2.3 4.5-3 .4-3.5-3.3-.3-3.8 2-4.7zM4.8 13.2l3.8-.5.4 2.3q.3 2.2-1.8 2.4-2 .2-2.4-2z" ${F}/>`
    + `<path d="M15.5 7.5q3-1 3.8 3.5.6 4-2.3 4.5-3 .4-3.5-3.3-.3-3.8 2-4.7zM14.8 17.2l3.8-.5.4 2.3q.3 2.2-1.8 2.4-2 .2-2.4-2z" ${F}/>`,
  rushout: `<path d="M9 3H2.5v18H9" ${S} stroke-width="2.2"/>` + `<path d="M6 12h14" ${S} stroke-width="2.8"/>` + arrowHead(21, 12, 0, 6),
  crossclaimer: ball(12, 5.5, 4) + `<path d="M3.5 22v-6l-1.5-4q-.5-1.6 1-2 1.2-.2 1.8 1l1.7 3.5M20.5 22v-6l1.5-4q.5-1.6-1-2-1.2-.2-1.8 1l-1.7 3.5" ${S}/>` + `<path d="M6.5 14.5l2-3.5M17.5 14.5l-2-3.5" ${S}/>`,
  quickreflexes: `<path d="M13.5 1.5L5 13.5h6l-2 9 9.5-13h-6.3z" ${F}/>` + `<path d="M19.5 3l2.5-1.5M20.5 6.5l2.5.2M2 18l2.3-1M2.5 21.5l2-.3" ${S} stroke-width="1.5"/>`,
  deflector: `<path d="M8 2.5v19" ${S} stroke-width="3.2"/>` + `<path d="M22 19L11 12" ${S} stroke-dasharray="2.2 1.8"/>` + `<path d="M11 12L20.5 3.5" ${S}/>` + arrowHead(20.5, 3.5, -0.73, 4.5) + ball(19.5, 19.5, 2.4),
};

// badge shapes (48x48 viewBox)
const DIAMOND = 'M24 2.8q1.6 0 2.8 1.2l17.2 17.2q2.4 2.8 0 5.6L26.8 44q-2.8 2.4-5.6 0L4 26.8q-2.4-2.8 0-5.6L21.2 4q1.2-1.2 2.8-1.2z';
const GEM = 'M10 5h28q1.5 0 2.4 1.2l5.3 8.3q1 1.7-.2 3.2L26 43q-2 2.3-4 0L2.5 17.7q-1.2-1.5-.2-3.2l5.3-8.3Q8.5 5 10 5z';

let uid = 0;
/**
 * SVG markup for a PlayStyle badge. `id` may be any known id or alias.
 * @param {string} id
 * @param {boolean} plus  PlayStyle+ (gold gem badge)
 * @param {{title?: boolean|string, cls?: string}} [opt]
 */
export function psIconSvg(id, plus = false, opt = {}) {
  const cid = canonStyle(id);
  const d = cid && PLAYSTYLES[cid];
  if (!d) return '';
  const glyph = PS_GLYPHS[cid] || `<text x="12" y="16" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">${d[2]}</text>`;
  const title = opt.title === false ? '' : `<title>${esc(typeof opt.title === 'string' ? opt.title : `${d[0]}${plus ? '+' : ''}`)}</title>`;
  const g = `g${++uid}`;
  const badge = plus
    ? `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe7a1"/><stop offset=".45" stop-color="#e6bd57"/><stop offset="1" stop-color="#a97b23"/></linearGradient></defs>`
      + `<path d="${GEM}" fill="url(#${g})" stroke="#5a3d06" stroke-width="1.4"/><path d="M10.5 8.2h27l4.3 6.8L24 38.8 6.2 15z" fill="none" stroke="#fff6cf" stroke-opacity=".55" stroke-width="1"/>`
    : `<path d="${DIAMOND}" fill="#1b2230" stroke="#d9e2f2" stroke-opacity=".55" stroke-width="1.4"/><path d="M24 7l17 17-17 17L7 24z" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1"/>`;
  const tf = plus ? 'translate(10.6 5.6) scale(1.12)' : 'translate(11.4 11.4) scale(1.05)';
  const color = plus ? '#241703' : '#ffffff';
  const bg = plus ? '#e6bd57' : '#1b2230';
  return `<svg class="psi-svg" viewBox="0 0 48 48" aria-hidden="${opt.title === false ? 'true' : 'false'}" role="img">${title}${badge}`
    + `<g transform="${tf}" style="color:${color};--psi-bg:${bg}">${glyph}</g></svg>`;
}

/** Inline badge element markup (<i class="psi">) used on cards / lists / chips. */
export function psBadge(ps, extraCls = '') {
  const cid = canonStyle(ps && ps.id);
  const d = cid && PLAYSTYLES[cid];
  if (!d) return '';
  ensurePsiStyles();
  const label = `${d[0]}${ps.plus ? '+' : ''}`;
  return `<i class="psi psi-${cid}${ps.plus ? ' plus' : ''}${extraCls ? ` ${extraCls}` : ''}" title="${esc(label)}" aria-label="${esc(label)}" data-ps="${cid}">${psIconSvg(cid, !!ps.plus, { title: false })}</i>`;
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const CSS = `
.psi{display:inline-block;flex:none;width:26px;height:26px;line-height:0;font-style:normal;vertical-align:middle;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45))}
.psi .psi-svg{width:100%;height:100%;display:block;overflow:visible}
.psi.plus{filter:drop-shadow(0 0 3px rgba(245,197,66,.55)) drop-shadow(0 1px 1.5px rgba(0,0,0,.5))}
.pc-ps .psi{width:1.18em;height:1.18em}
.pm-card--lg .pc-ps .psi{width:1.1em;height:1.1em}
.pm-psrow .psi{width:40px;height:40px}
.pm-cardmeta-ps .psi,.pm-prow-ps .psi{width:20px;height:20px}
.pm-cardmeta-ps,.pm-prow-ps{align-items:center}
.pm-psrow .psi-plus-tag{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;font:700 11px/1.3 var(--font-display,system-ui);letter-spacing:.05em;color:#241703;background:linear-gradient(180deg,#fbe7a1,#d9a93c);vertical-align:middle}
.pm-psrow:has(.psi) b::after{content:none}
.pm-chip.psi-chip{display:inline-flex;align-items:center;gap:6px;padding-left:6px}
.pm-chip.psi-chip .psi{width:22px;height:22px}
.pm-chip.psi-chip.is-plus{box-shadow:inset 0 0 0 2px #e6bd57}
.psi-legend{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin:4px 0 8px;font-size:12px;opacity:.85}
.psi-legend .psi{width:22px;height:22px;margin-right:4px}
`;
/** Inject the badge stylesheet once (no-op outside a browser). */
export function ensurePsiStyles() {
  if (typeof document === 'undefined' || document.getElementById('pm-psi-css')) return;
  const el = document.createElement('style');
  el.id = 'pm-psi-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}
