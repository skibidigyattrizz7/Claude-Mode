// FIFA-style player card component.
import { h, frag, esc } from './dom.js';
import { flagSVG, crestSVG, avatarSVG } from './art.js';
import { cardName } from '../core/players.js';
import { clubById } from '../core/data.js';
import { PLAYSTYLES } from '../core/physique.js';

const STAT_LABELS = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
const GK_LABELS = ['DIV', 'HAN', 'KIC', 'REF', 'SPD', 'POS'];
const SPECIAL_LABEL = { inform: 'IN-FORM', hero: 'HERO', legend: 'CLASSIC', lotg: 'LEGEND OF THE GAME', objective: 'PATHFINDER' };

/** Small round PlayStyle badge (gold ring = PlayStyle+). */
export function psBadgeHtml(ps) {
  const d = PLAYSTYLES[ps.id];
  if (!d) return '';
  return `<i class="ps ps-${d[1]}${ps.plus ? ' plus' : ''}" title="${esc(d[0])}${ps.plus ? '+' : ''}">${d[2]}</i>`;
}

/** Detail list of PlayStyles with names and descriptions. */
export function playstyleList(p) {
  const list = (p.playstyles || []).filter((x) => PLAYSTYLES[x.id]);
  return h('div', { class: 'pm-pslist' },
    h('div', { class: 'pm-lbl' }, 'PlayStyles'),
    list.length ? list.map((x) => {
      const d = PLAYSTYLES[x.id];
      return h('div', { class: 'pm-psrow' }, frag(psBadgeHtml(x)), h('div', null, h('b', null, d[0] + (x.plus ? '+' : '')), h('small', { class: 'pm-dim' }, d[3])));
    }) : h('small', { class: 'pm-dim' }, 'None'));
}

export function cardClasses(p) {
  const c = ['pm-card', `t-${p.tier}`];
  if (p.rare) c.push('rare');
  if (p.special) c.push(`sp-${p.special}`);
  if (p.era === 'prime') c.push('era-prime');
  if (p.evo) c.push('is-evo');
  if (p.totw) c.push('is-totw');
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
  const ps = size === 'xs' ? '' : (p.playstyles || []).slice(0, 4).map(psBadgeHtml).join('');
  const others = [p.pos, ...(p.alt || [])].filter((x) => x !== posLabel).slice(0, 3);
  const altHtml = size === 'xs' || !others.length ? '' : `<div class="pc-alt" title="Also plays ${esc(others.join(', '))}">+${esc(others.join(' '))}</div>`;
  const html = `<div class="${cls.join(' ')}" data-pid="${esc(p.id)}">
    <div class="pc-in">
      <div class="pc-shine"></div>
      <div class="pc-side">
        <div class="pc-ovr">${p.ovr}</div>
        <div class="pc-pos">${esc(posLabel)}</div>
        ${altHtml}
        ${flagSVG(p.nat, 'pc-flag')}
        ${crestSVG(club, 'pc-crest')}
      </div>
      ${avatarSVG(p, 'pc-avatar')}
      ${ps ? `<div class="pc-ps">${ps}</div>` : ''}
      <div class="pc-name">${esc(cardName(p))}</div>
      ${statsHtml}
      ${p.special || p.evo ? `<div class="pc-tag">${p.totw ? 'TEAM OF THE WEEK' : p.special ? SPECIAL_LABEL[p.special] || '' : 'EVOLUTION'}</div>` : ''}
      ${p.era === 'prime' ? '<div class="pc-era">PRIME</div>' : ''}
      ${p.evo ? `<div class="pc-evo" title="Evolved ×${p.evo}">EVO${p.evo > 1 ? ` ${p.evo}` : ''}</div>` : ''}
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
