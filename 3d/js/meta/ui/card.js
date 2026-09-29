// FIFA-style player card component.
import { h, frag, esc } from './dom.js';
import { flagSVG, crestSVG, avatarSVG } from './art.js';
import { cardName } from '../core/players.js';
import { clubById } from '../core/data.js';
import { PLAYSTYLES, canonStyle } from '../core/physique.js';
import { psBadge, psIconSvg, ensurePsiStyles } from './playstyleicons.js';
import { leagueBadgeSVG } from './leaguebadge.js';
import { PROMOS, PROMO_BY_ID } from '../core/promos.js';
import { subStats } from '../core/substats.js';

const STAT_LABELS = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
const GK_LABELS = ['DIV', 'HAN', 'KIC', 'REF', 'SPD', 'POS'];
const SPECIAL_LABEL = { inform: 'IN-FORM', hero: 'HERO', legend: 'CLASSIC', lotg: 'LEGEND OF THE GAME', objective: 'PATHFINDER', secret: 'GLITCH' };
for (const pr of PROMOS) SPECIAL_LABEL[pr.id] = pr.tag;

// Promo colours live in ONE place (core/promos.js `colors`): expose them as CSS custom properties for the card
// (`.sp-<id>`), its packs (`.pm-pack--promo-<id>`) and promo hub sections, via one shared stylesheet. The
// per-campaign art (pattern, trim, name bar) is the `.sp-<id>` block in meta.css.
if (typeof document !== 'undefined' && !document.getElementById('pm-promo-vars')) {
  const css = PROMOS.map((pr) => `.pm-card.sp-${pr.id},.pm-pack--promo-${pr.id},.pm-promo--${pr.id}{--pa:${pr.colors[0]};--pb:${pr.colors[1]};--pc:${pr.colors[2]}}`).join('\n');
  const el = document.createElement('style');
  el.id = 'pm-promo-vars';
  el.textContent = css;
  document.head.appendChild(el);
}
// FC-style: nation flag, league badge and club crest side by side under OVR / position. Injected here
// (not in the shared stylesheets) so the card component owns its own face layout.
if (typeof document !== 'undefined' && !document.getElementById('pm-card-league-css')) {
  const el = document.createElement('style');
  el.id = 'pm-card-league-css';
  el.textContent = '.pm-card .pc-badges{gap:.12em;justify-content:center}'
    + '.pm-card .pc-badges .pc-flag{width:1.12em;height:.72em}'
    + '.pm-card .pc-badges .pc-crest{width:.84em;height:1em}'
    + '.pm-card .pc-league{width:.84em;height:.92em;display:block;flex:none;filter:drop-shadow(0 .03em .06em rgba(0,0,0,.35))}'
    + '.pm-card--xs .pc-league{display:none}'
    + '.pm-lgbadge{width:18px;height:20px;display:inline-block;vertical-align:middle;flex:none}';
  document.head.appendChild(el);
}

/** FC-style PlayStyle badge (inline SVG icon; PlayStyle+ = gold gem). Kept under its old name for callers. */
export function psBadgeHtml(ps) { return psBadge(ps); }

/** PlayStyle+ first (FC order), then the rest in the player's own order. Aliases resolved, unknown ids dropped. */
export function sortedStyles(p) {
  const seen = new Set();
  const list = [];
  for (const x of p.playstyles || []) {
    const id = canonStyle(x && x.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push({ id, plus: !!x.plus });
  }
  return list.sort((a, b) => (b.plus ? 1 : 0) - (a.plus ? 1 : 0));
}

/** Detail list of ALL a player's PlayStyles: icon, name, PlayStyle+ tag and description. */
export function playstyleList(p) {
  ensurePsiStyles();
  const list = sortedStyles(p);
  const nPlus = list.filter((x) => x.plus).length;
  return h('div', { class: 'pm-pslist' },
    h('div', { class: 'pm-lbl' }, `PlayStyles${list.length ? ` (${list.length}${nPlus ? ` · ${nPlus} PlayStyle+` : ''})` : ''}`),
    list.length ? list.map((x) => {
      const d = PLAYSTYLES[x.id];
      return h('div', { class: `pm-psrow${x.plus ? ' is-plus' : ''}`, 'data-ps': x.id },
        frag(psIconSvg(x.id, x.plus, { title: false }).replace('<svg ', '<svg style="width:40px;height:40px;flex:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))" ')),
        h('div', null, h('b', null, d[0], x.plus ? h('span', { class: 'psi-plus-tag' }, 'PlayStyle+') : null), h('small', { class: 'pm-dim' }, d[3])));
    }) : h('small', { class: 'pm-dim' }, 'None'));
}

/** Every attribute: the six face stats, each with its full FC-style detail list (core/substats.js). */
export function attributeBlock(p) {
  if (typeof document !== 'undefined' && !document.getElementById('pm-subattr-css')) {
    const el = document.createElement('style');
    el.id = 'pm-subattr-css';
    el.textContent = '.pm-attrgroup{display:grid;gap:5px;align-content:start}'
      + '.pm-attrgroup .pm-attr{font-weight:600}'
      + '.pm-subattr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;align-items:baseline;font-size:12.5px;color:#aab2bf;padding-left:8px}'
      + '.pm-subattr b{font:700 14px/1 var(--font-display,system-ui);color:var(--txt,#fff)}'
      + '.pm-subattr b.hi{color:var(--good,#3fd08a)}.pm-subattr b.lo{color:#ff9aa5}'
      + '.pm-subattr i{grid-column:1/-1;height:3px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden}'
      + '.pm-subattr i::before{content:"";display:block;height:100%;width:var(--v);background:rgba(255,255,255,.55)}';
    document.head.appendChild(el);
  }
  const cls = (v) => (v >= 85 ? 'hi' : v >= 70 ? 'mid' : v < 50 ? 'lo' : '');
  // "The Shawky" (secretcard.js `glitch`): every number here is still a real, 1-99-safe value underneath
  // (see substats.js) — only the display reads "∞", same as the card face and rating.
  // THE NII (secretcard.js `cursed`) is the opposite: every number reads "-∞".
  const inf = p.glitch === true || p.cursed === true;
  const disp = (v) => (inf ? infLabel(p) : v);
  return h('div', { class: 'pm-attrs pm-attrs--full' }, subStats(p).map((g) => h('div', { class: 'pm-attrgroup', 'data-attr': g.key },
    h('div', { class: 'pm-attr' }, h('span', null, g.label), h('b', { class: cls(g.value) }, disp(g.value)), h('i', { style: { '--v': `${Math.min(99, g.value)}%` } })),
    g.subs.map((x) => h('div', { class: 'pm-subattr', 'data-attr': x.key }, h('span', null, x.label), h('b', { class: cls(x.value) }, disp(x.value)), h('i', { style: { '--v': `${x.value}%` } }))))));
}

// Real players show surname only (FIFA/FC convention: "Ronaldo", not "Cristiano Ronaldo"). Card Creator admin
// cards have no separate first/last name — the owner types one name for the card, so it must show in full
// ("pain man", not "man") rather than through cardName()'s last-word-only rule.
/** What an "infinite" number reads as: "∞" for the glitch secret cards, "-∞" for THE NII (cursed). */
export const infLabel = (p) => (p && p.cursed === true ? '-∞' : '∞');
/** Rough rendered width of an uppercase nameplate (wide M/W, narrow I/./-/space) so long names shrink instead of "…". */
/** Nameplate size class; the xs card's plate is relatively narrower, so it steps down sooner. */
function nameFit(n, size) { const w = nameWidth(n) / (size === 'xs' ? 0.8 : 1); return w > 12.8 ? ' pc-name--xxl' : w > 10.6 ? ' pc-name--xl' : w > 8.6 ? ' pc-name--long' : ''; }
function nameWidth(n) { let w = 0; for (const ch of String(n).toUpperCase()) w += /[MW]/.test(ch) ? 1.35 : /[IJ.\-' ]/.test(ch) ? 0.55 : 1; return w; }
function nameOnCard(p) { return p.customAdmin && typeof p.name === 'string' && p.name.trim() ? p.name.trim() : cardName(p); }

// Card fields can come from other players (market listings, shared squads, gifts): anything that goes into the
// HTML string below is escaped or forced to a number / a CSS-class-safe token.
const tok = (v) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
const num = (v, lo = 0, hi = 999) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };

export function cardClasses(p) {
  const c = ['pm-card', `t-${tok(p.tier)}`];
  if (p.cursed === true) c.push('is-cursed');
  if (p.evil === true) c.push('is-evil');
  if (p.fullArt) c.push('is-fullart');
  if (p.artTheme) c.push(`art-${tok(p.artTheme)}`);
  if (p.statText) c.push('has-stattext');
  if (p.rare) c.push('rare');
  if (p.special) c.push(`sp-${tok(p.special)}`);
  if (p.era === 'prime') c.push('era-prime');
  if (p.evo) c.push('is-evo');
  if (p.totw) c.push('is-totw');
  if (p.headliner) c.push('is-headliner');
  // Promo design: real promo cards carry `promo`; Admin card-creator cards only store the chosen design in
  // `special`, so any special that names a promo campaign renders in that campaign's design too.
  if (p.promo || PROMO_BY_ID[p.special]) c.push('is-promo');
  else if (p.club === 'ICN') c.push('is-icon');
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
  const upg = p.upg ? { level: num(p.upg.level, 0, 20), max: num(p.upg.max, 0, 20) } : null;
  const evo = num(p.evo, 0, 99);
  const club = opts.club || clubById(p.club) || { id: p.club, name: p.club, short: String(p.club).slice(0, 3), colors: { primary: '#445', secondary: '#99a' } };
  const vals = p.pos === 'GK' ? [p.gk.div, p.gk.han, p.gk.kic, p.gk.ref, p.gk.spd, p.gk.pos] : [p.stats.pac, p.stats.sho, p.stats.pas, p.stats.dri, p.stats.def, p.stats.phy];
  const labels = p.pos === 'GK' ? GK_LABELS : STAT_LABELS;
  // "The Shawky" (secretcard.js `glitch`): shown as "∞" everywhere on the face — the underlying numbers stay
  // finite/1-99 (market value, SBC rating math, sorting all use the real number, never this display string).
  const inf = p.glitch === true || p.cursed === true;
  // FUT order: left column PAC SHO PAS, right column DRI DEF PHY (the grid flows by column).
  // custom stat display for full-art secret cards: a glyph (the knight's ✡) or text with a superscript (E.L.I.J.A.H.'s ???^∞)
  const glyph = typeof p.statText === 'string' && p.statText.length <= 4 ? `${esc(p.statText)}${p.statSup ? `<sup>${esc(String(p.statSup).slice(0, 2))}</sup>` : ''}`
    : typeof p.statGlyph === 'string' && p.statGlyph.length <= 2 ? esc(p.statGlyph) : null;
  const statsHtml = size === 'xs' ? '' : `<div class="pc-stats">${vals.map((v, i) => `<div class="pc-stat"><b>${glyph || (inf ? infLabel(p) : num(v, 0, 999))}</b><span>${labels[i]}</span></div>`).join('')}</div>`;
  const posLabel = opts.pos || p.pos;
  const ps = size === 'xs' ? '' : sortedStyles(p).slice(0, 3).map((x) => psBadge(x)).join('');
  // Card Creator admin cards can carry more than 3 alt positions; the card face only has room for 3 badges,
  // but the hover title lists every one of them.
  const othersAll = [p.pos, ...(p.alt || [])].filter((x) => x !== posLabel);
  const others = othersAll.slice(0, 3);
  // cards that play every position (secret cards) say so instead of a clipped "+GK CB LB…" list
  const altHtml = size === 'xs' || !others.length ? '' : `<div class="pc-alt" title="Also plays ${esc(othersAll.join(', '))}">${othersAll.length >= 10 ? 'ANY POSITION' : `+${esc(others.join(' '))}${othersAll.length > 3 ? '…' : ''}`}</div>`;
  // Layers: .pc-in is the masked shield face (pattern + foil + shine stay clipped inside it); art and text sit
  // above it unclipped, so special cards can let the player break out of the top edge of the frame.
  const tag = p.fullArt ? String(p.cardTag || '') : (p.cursed === true || p.evil === true) && p.cardTag ? String(p.cardTag) : p.special || p.evo ? (p.totw ? (p.headliner ? 'TOTW HEADLINER' : 'TEAM OF THE WEEK') : p.special ? (Object.hasOwn(SPECIAL_LABEL, p.special) ? SPECIAL_LABEL[p.special] : '') : 'EVOLUTION') : '';
  const html = `<div class="${esc(cls.join(' '))}" data-pid="${esc(p.id)}">
    <div class="pc-in"><div class="pc-shine"></div></div>
    ${p.fullArt ? `<img class="pc-fullart" src="${esc(p.fullArt)}" alt="" />` : p.photo ? `<img class="pc-avatar pc-photo${p.photoCut ? ' pc-photo--cut' : ''}" src="${esc(p.photo)}" alt="" />` : avatarSVG(p, 'pc-avatar')}
    <div class="pc-side">
      <div class="pc-ovr${p.statText ? ' pc-ovr--text' : ''}">${p.statText ? glyph : inf ? infLabel(p) : num(p.ovr, 0, 999)}</div>
      <div class="pc-pos">${esc(posLabel)}</div>
      ${altHtml}
      <div class="pc-badges">${flagSVG(p.nat, 'pc-flag')}${p.league ? leagueBadgeSVG(p.league, 'pc-league') : ''}${crestSVG(club, 'pc-crest')}</div>
    </div>
    ${ps ? `<div class="pc-ps">${ps}</div>` : ''}
    ${p.customAdmin ? '<div class="pc-custom" title="Admin-created card">ADMIN CARD</div>' : ''}
    <div class="pc-name${nameFit(nameOnCard(p), size)}">${esc(nameOnCard(p))}</div>
    ${statsHtml}
    ${tag ? `<div class="pc-tag">${esc(tag)}</div>` : ''}
    ${upg && size !== 'xs' ? `<div class="pc-upg" title="Upgrades ${upg.level}/${upg.max}">${Array.from({ length: upg.max }, (_, i) => `<i class="${i < upg.level ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    ${p.era === 'prime' ? '<div class="pc-era">PRIME</div>' : ''}
    ${p.evo ? `<div class="pc-evo" title="Evolved ×${evo}">EVO${evo > 1 ? ` ${evo}` : ''}</div>` : ''}
  </div>`;
  const el = frag(html);
  el.setAttribute('aria-label', `${p.name}, ${inf ? 'infinity' : p.ovr} ${posLabel}`);
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
