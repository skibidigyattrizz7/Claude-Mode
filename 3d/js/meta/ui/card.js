// FIFA-style player card component.
import { h, frag, esc } from './dom.js';
import { flagSVG, crestSVG, avatarSVG } from './art.js';
import { cardName } from '../core/players.js';
import { clubById } from '../core/data.js';

const STAT_LABELS = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
const GK_LABELS = ['DIV', 'HAN', 'KIC', 'REF', 'SPD', 'POS'];
const SPECIAL_LABEL = { inform: 'IN-FORM', hero: 'HERO', legend: 'LEGEND' };

export function cardClasses(p) {
  const c = ['pm-card', `t-${p.tier}`];
  if (p.rare) c.push('rare');
  if (p.special) c.push(`sp-${p.special}`);
  return c;
}

/**
 * @param p player object
 * @param opts { size: 'xs'|'sm'|'md'|'lg', pos: override position label, club: club object for crest, onClick, extra: Node, tag }
 */
export function playerCard(p, opts = {}) {
  const size = opts.size || 'sm';
  const cls = cardClasses(p);
  cls.push(`pm-card--${size}`);
  if (opts.className) cls.push(opts.className);
  const club = opts.club || clubById(p.club) || { id: p.club, name: p.club, short: String(p.club).slice(0, 3), colors: { primary: '#445', secondary: '#99a' } };
  const vals = p.pos === 'GK' ? [p.gk.div, p.gk.han, p.gk.kic, p.gk.ref, p.gk.spd, p.gk.pos] : [p.stats.pac, p.stats.sho, p.stats.pas, p.stats.dri, p.stats.def, p.stats.phy];
  const labels = p.pos === 'GK' ? GK_LABELS : STAT_LABELS;
  const statsHtml = size === 'xs' ? '' : `<div class="pc-stats">${vals.map((v, i) => `<div class="pc-stat"><b>${v}</b><span>${labels[i]}</span></div>`).join('')}</div>`;
  const posLabel = opts.pos || p.pos;
  const html = `<div class="${cls.join(' ')}" data-pid="${esc(p.id)}">
    <div class="pc-in">
      <div class="pc-shine"></div>
      <div class="pc-side">
        <div class="pc-ovr">${p.ovr}</div>
        <div class="pc-pos">${esc(posLabel)}</div>
        ${flagSVG(p.nat, 'pc-flag')}
        ${crestSVG(club, 'pc-crest')}
      </div>
      ${avatarSVG(p, 'pc-avatar')}
      <div class="pc-name">${esc(cardName(p))}</div>
      ${statsHtml}
      ${p.special ? `<div class="pc-tag">${SPECIAL_LABEL[p.special]}</div>` : ''}
    </div>
  </div>`;
  const el = frag(html);
  el.setAttribute('aria-label', `${p.name}, ${p.ovr} ${posLabel}`);
  if (opts.extra) el.appendChild(opts.extra);
  if (opts.onClick) {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.addEventListener('click', () => opts.onClick(p, el));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(p, el); } });
  }
  return el;
}

export function emptyCard(label, size = 'xs') {
  return h('div', { class: `pm-card pm-card--${size} pm-card--empty` }, h('div', { class: 'pc-in' }, h('div', { class: 'pc-plus' }, '+'), h('div', { class: 'pc-emptypos' }, label)));
}
