// Procedural art: nation flags, club crests, player avatars and pack art (SVG strings; no images).
import { NATION_BY_CODE, SKIN, SKIN_TONES, clubById } from '../core/data.js';
import { contrastColor, luminance } from '../core/teams.js';
import { esc } from './dom.js';

let uid = 0;
const nid = (p) => `${p}${++uid}`;

function star(cx, cy, r, fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

export function flagSVG(code, cls = 'pm-flag') {
  const n = NATION_BY_CODE[code];
  if (!n) return `<svg class="${cls}" viewBox="0 0 30 20"><rect width="30" height="20" fill="#555"/></svg>`;
  const f = n.flag, c = f.c;
  let body = '';
  switch (f.t) {
    case 'h': { const hh = 20 / c.length; c.forEach((col, i) => { body += `<rect y="${(i * hh).toFixed(3)}" width="30" height="${(hh + 0.05).toFixed(3)}" fill="${col}"/>`; }); break; }
    case 'v': { const w = 30 / c.length; c.forEach((col, i) => { body += `<rect x="${(i * w).toFixed(3)}" width="${(w + 0.05).toFixed(3)}" height="20" fill="${col}"/>`; }); break; }
    case 'v2': body = `<rect width="12" height="20" fill="${c[0]}"/><rect x="12" width="18" height="20" fill="${c[1]}"/><circle cx="12" cy="10" r="3.6" fill="#FFD700"/><circle cx="12" cy="10" r="2.3" fill="${c[1]}" stroke="#fff" stroke-width=".6"/>`; break;
    case 'cross': body = `<rect width="30" height="20" fill="${c[0]}"/><rect x="12.5" width="5" height="20" fill="${c[1]}"/><rect y="7.5" width="30" height="5" fill="${c[1]}"/>`; break;
    case 'nordic': body = `<rect width="30" height="20" fill="${c[0]}"/><rect x="8" width="4" height="20" fill="${c[1]}"/><rect y="8" width="30" height="4" fill="${c[1]}"/>`; break;
    case 'nordic2': body = `<rect width="30" height="20" fill="${c[0]}"/><rect x="7.5" width="5" height="20" fill="${c[1]}"/><rect y="7.5" width="30" height="5" fill="${c[1]}"/><rect x="8.75" width="2.5" height="20" fill="${c[2]}"/><rect y="8.75" width="30" height="2.5" fill="${c[2]}"/>`; break;
    case 'swiss': body = `<rect width="30" height="20" fill="${c[0]}"/><rect x="13" y="4" width="4" height="12" fill="${c[1]}"/><rect x="9" y="8" width="12" height="4" fill="${c[1]}"/>`; break;
    case 'saltire': body = `<rect width="30" height="20" fill="${c[0]}"/><path d="M0 0L30 20M30 0L0 20" stroke="${c[1]}" stroke-width="3.4"/>`; break;
    case 'circle': body = `<rect width="30" height="20" fill="${c[0]}"/><circle cx="15" cy="10" r="6" fill="${c[1]}"/>`; break;
    case 'circle2': body = `<rect width="30" height="20" fill="${c[0]}"/><circle cx="15" cy="10" r="5" fill="${c[2]}"/><path d="M10 10a5 5 0 0 1 10 0a2.5 2.5 0 0 1-5 0a2.5 2.5 0 0 0-5 0z" fill="${c[1]}"/><g stroke="#000" stroke-width="1"><path d="M4 4l3 2M5 3l3 2M23 5l3-2M22 4l3-2M4 16l3-2M23 15l3 2"/></g>`; break;
    case 'brazil': body = `<rect width="30" height="20" fill="${c[0]}"/><polygon points="15,2.5 27.5,10 15,17.5 2.5,10" fill="${c[1]}"/><circle cx="15" cy="10" r="4.4" fill="${c[2]}"/><path d="M10.8 9.2q4.5-1.4 8.6 1.4" stroke="#fff" stroke-width=".7" fill="none"/>`; break;
    case 'usa': { for (let i = 0; i < 13; i++) body += `<rect y="${(i * 20 / 13).toFixed(3)}" width="30" height="${(20 / 13 + 0.05).toFixed(3)}" fill="${i % 2 ? c[1] : c[0]}"/>`; body += `<rect width="12" height="10.77" fill="${c[2]}"/>`; for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++) body += `<circle cx="${1.4 + k * 2.3}" cy="${1.4 + r * 2.6}" r=".45" fill="#fff"/>`; break; }
    case 'chile': body = `<rect width="30" height="10" fill="${c[0]}"/><rect y="10" width="30" height="10" fill="${c[1]}"/><rect width="10" height="10" fill="${c[2]}"/>${star(5, 5, 2.6, '#fff')}`; break;
    case 'czech': body = `<rect width="30" height="10" fill="${c[0]}"/><rect y="10" width="30" height="10" fill="${c[1]}"/><polygon points="0,0 15,10 0,20" fill="${c[2]}"/>`; break;
    case 'canada': body = `<rect width="30" height="20" fill="${c[1]}"/><rect width="7.5" height="20" fill="${c[0]}"/><rect x="22.5" width="7.5" height="20" fill="${c[0]}"/>${star(15, 10, 4.5, c[0])}`; break;
    case 'solid': default: body = `<rect width="30" height="20" fill="${c[0]}"/>`;
  }
  if (f.sun) body += `<circle cx="15" cy="10" r="2.2" fill="${f.sun}"/>`;
  if (f.star && f.t === 'solid') body += f.star === '#FFFFFF' ? `${star(8, 6, 2.5, '#fff')}${star(22, 13, 2.2, '#fff')}${star(7, 15, 1.4, '#fff')}` : star(15, 10, 4.4, 'none').replace('fill="none"', `fill="none" stroke="${f.star}" stroke-width="1"`);
  else if (f.star) body += star(15, 10, 2.8, f.star);
  if (f.crescent) body += `<circle cx="12.5" cy="10" r="5" fill="${f.crescent}"/><circle cx="13.8" cy="10" r="4" fill="${c[0]}"/>${star(18.5, 10, 2.1, f.crescent)}`;
  return `<svg class="${cls}" viewBox="0 0 30 20" preserveAspectRatio="none" role="img" aria-label="${esc(n.name)}">${body}<rect width="30" height="20" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".6"/></svg>`;
}

export function initialsOf(name, short) {
  const skip = new Set(['FC', 'AC', 'AS', 'US', 'SS', 'SC', 'SV', 'CD', 'UD', 'SD', 'CF', 'RC', 'CA', 'TSV', 'VFR', '1.', 'DE', 'DEL', 'DO', 'DA', 'LA']);
  const words = String(name).split(/[\s-]+/).filter((w) => !skip.has(w.toUpperCase()));
  const ini = words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return ini.length >= 2 ? ini : (short || ini || '?').slice(0, 3);
}

const BADGE_PATHS = {
  shield: 'M4 3H36V21C36 33 28.5 41 20 45.5C11.5 41 4 33 4 21Z',
  round: 'M20 3A21 21 0 1 1 19.99 3Z',
  diamond: 'M20 2L38 24L20 46L2 24Z',
  hex: 'M20 2L37.5 12.5V35.5L20 46L2.5 35.5V12.5Z',
  classic: 'M3 4L8 1H32L37 4V16C37 30 30 40 20 46C10 40 3 30 3 16Z',
};
/** Custom UT badge: { shape, c1, c2, c3, text, stripe } */
export function badgeSVG(b, cls = 'pm-crest', label = 'Club badge') {
  const d = BADGE_PATHS[b.shape] || BADGE_PATHS.shield;
  const cid = nid('bd');
  const text = esc(String(b.text || '').slice(0, 3));
  const fs = text.length >= 3 ? 11 : 14;
  const band = b.stripe ? `<rect x="0" y="18" width="40" height="10" fill="${b.c2}"/>` : `<path d="M0 30L40 14V48H0Z" fill="${b.c2}" opacity=".9"/>`;
  return `<svg class="${cls}" viewBox="0 0 40 48" role="img" aria-label="${esc(label)}"><defs><clipPath id="${cid}"><path d="${d}"/></clipPath></defs>`
    + `<g clip-path="url(#${cid})"><rect width="40" height="48" fill="${b.c1}"/>${band}</g>`
    + `<path d="${d}" fill="none" stroke="${b.c3 || '#fff'}" stroke-width="2.2"/>`
    + `<text x="20" y="26" dy="${fs / 3}" text-anchor="middle" font-size="${fs}" font-weight="900" fill="${b.c3 || '#fff'}" stroke="${b.c1}" stroke-width=".7" paint-order="stroke" font-family="Arial Black,Arial,sans-serif">${text}</text></svg>`;
}

/** club: {id, name, short, colors:{primary, secondary}, badge?} or club id */
export function crestSVG(club, cls = 'pm-crest') {
  if (typeof club === 'string') club = clubById(club) || { id: club, name: club, short: club.slice(0, 3), colors: { primary: '#445', secondary: '#aab' } };
  if (club.badge) return badgeSVG(club.badge, cls, club.name);
  const { primary: p, secondary: s } = club.colors;
  const cid = nid('cc');
  const shield = 'M4 3H36V21C36 33 28.5 41 20 45.5C11.5 41 4 33 4 21Z';
  if (club.id === 'LEG') {
    return `<svg class="${cls}" viewBox="0 0 40 48" role="img" aria-label="Legends"><path d="${shield}" fill="#F4E8C1" stroke="#B8860B" stroke-width="2.4"/>${star(20, 22, 11, '#B8860B')}</svg>`;
  }
  if (club.id === 'ICN') {
    return `<svg class="${cls}" viewBox="0 0 40 48" role="img" aria-label="Legends of the Game"><path d="${shield}" fill="#111" stroke="#D4AF37" stroke-width="2.4"/><path d="M11 30l3-12 6 7 6-7 3 12z" fill="#D4AF37"/><circle cx="14" cy="17" r="1.6" fill="#D4AF37"/><circle cx="20" cy="23" r="1.6" fill="#D4AF37"/><circle cx="26" cy="17" r="1.6" fill="#D4AF37"/><rect x="11" y="31.5" width="18" height="2.6" fill="#D4AF37"/></svg>`;
  }
  if (club.id === 'HER') {
    return `<svg class="${cls}" viewBox="0 0 40 48" role="img" aria-label="Heroes"><path d="${shield}" fill="#3A1C71" stroke="#27E1C1" stroke-width="2.4"/><text x="20" y="30" text-anchor="middle" font-size="20" font-weight="900" fill="#27E1C1" font-family="Arial Black,Arial,sans-serif">H</text></svg>`;
  }
  let h = 0; for (const ch of String(club.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const variant = h % 5;
  let pat = '';
  if (variant === 0) pat = `<rect x="0" y="16" width="40" height="9" fill="${s}"/>`;
  else if (variant === 1) pat = `<rect x="20" y="0" width="20" height="48" fill="${s}"/>`;
  else if (variant === 2) pat = `<path d="M0 8L40 36V48L0 20Z" fill="${s}"/>`;
  else if (variant === 3) pat = `<path d="M0 18L20 30L40 18V26L20 38L0 26Z" fill="${s}"/>`;
  else pat = `<rect x="9" width="5" height="48" fill="${s}"/><rect x="18" width="5" height="48" fill="${s}"/><rect x="27" width="5" height="48" fill="${s}"/>`;
  const ini = initialsOf(club.name, club.short);
  const txtCol = variant === 1 || variant === 4 ? (luminance(p) > 0.5 ? '#111' : '#fff') : contrastColor(p);
  const fs = ini.length >= 3 ? 11 : 14;
  const outline = luminance(s) > 0.8 && luminance(p) > 0.8 ? '#333' : s;
  const textStroke = variant === 1 || variant === 4 ? `stroke="${luminance(p) > 0.5 ? '#fff' : '#000'}" stroke-width=".8" paint-order="stroke"` : '';
  return `<svg class="${cls}" viewBox="0 0 40 48" role="img" aria-label="${esc(club.name)}"><defs><clipPath id="${cid}"><path d="${shield}"/></clipPath></defs>`
    + `<g clip-path="url(#${cid})"><rect width="40" height="48" fill="${p}"/>${pat}</g>`
    + `<path d="${shield}" fill="none" stroke="${outline}" stroke-width="2.4"/><path d="M8 6.5H32" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>`
    + `<text x="20" y="${variant === 0 ? 24 : 26}" dy="${fs / 3}" text-anchor="middle" font-size="${fs}" font-weight="900" letter-spacing="-.5" fill="${txtCol}" ${textStroke} font-family="Arial Black,Arial,sans-serif">${esc(ini)}</text></svg>`;
}

const HAIR_COLS = { no: ['#e8d18a', '#c9a15b', '#8a6a3b'], de: ['#3b2a1e', '#8a6a3b', '#c9a15b'], nl: ['#c9a15b', '#3b2a1e', '#8a6a3b'], en: ['#2a1d15', '#6b4a2b', '#c9a15b', '#9b4a24'] };

/** Player avatar (stylised bust). */
export function avatarSVG(p, cls = 'pm-avatar') {
  const nat = NATION_BY_CODE[p.nat];
  const region = nat ? nat.region : 'en';
  const skins = SKIN[region] || SKIN.en;
  const look = p.look ?? 0;
  const skin = Number.isInteger(p.skin) && SKIN_TONES[p.skin] ? SKIN_TONES[p.skin] : skins[look % skins.length];
  const hairCols = HAIR_COLS[region] || ['#1a1310', '#2a1d15', '#3b2a1e'];
  const hair = hairCols[(look >> 3) % hairCols.length];
  const club = clubById(p.club);
  const shirt = club ? club.colors.primary : '#334';
  const trim = club ? club.colors.secondary : '#99a';
  const style = Number.isInteger(p.hair) ? p.hair % 7 : (look >> 5) % 7;
  let hairPath = '';
  if (style === 0) hairPath = `<path d="M18 22c0-9 6-13 12-13s12 4 12 13c-2-4-6-6-12-6s-10 2-12 6z" fill="${hair}"/>`;
  else if (style === 1) hairPath = `<path d="M18.5 21c1-7 5.5-10.5 11.5-10.5S40.5 14 41.5 21c-3-3-7-4-11.5-4s-8.5 1-11.5 4z" fill="${hair}" opacity=".85"/>`;
  else if (style === 2) hairPath = '';
  else if (style === 3) hairPath = `<ellipse cx="30" cy="17" rx="14" ry="11" fill="${hair}"/>`;
  else if (style === 4) hairPath = `<path d="M17 30c-2-14 4-21 13-21s15 7 13 21c-1-6-2-10-3-12-3 2-7 3-10 3s-7-1-10-3c-1 2-2 6-3 12z" fill="${hair}"/>`;
  else if (style === 5) hairPath = `<path d="M26 8c2-2 6-2 8 0l1 10h-10z" fill="${hair}"/><path d="M19 22c1-4 3-6 5-7M41 22c-1-4-3-6-5-7" stroke="${hair}" stroke-width="1.4" fill="none"/>`;
  else hairPath = `<path d="M18 20c1-8 6-12 12-12 7 0 12 4 12 11-4-3-9-5-15-4-3 0-6 2-9 5z" fill="${hair}"/>`;
  const beard = (look >> 2) % 4 === 0 ? `<path d="M21.5 30c1 7 4.5 10 8.5 10s7.5-3 8.5-10c-2 3-5 4-8.5 4s-6.5-1-8.5-4z" fill="${hair}" opacity=".75"/>` : '';
  return `<svg class="${cls}" viewBox="0 0 60 60" aria-hidden="true">`
    + `<path d="M4 60c1-10 8-15 17-17l9 5 9-5c9 2 16 7 17 17z" fill="${shirt}"/>`
    + `<path d="M21 43l9 7 9-7" fill="none" stroke="${trim}" stroke-width="2.4"/>`
    + `<rect x="25.5" y="34" width="9" height="10" rx="3" fill="${skin}"/>`
    + `<ellipse cx="30" cy="25" rx="11" ry="13" fill="${skin}"/>`
    + `<ellipse cx="18.8" cy="26" rx="1.8" ry="3" fill="${skin}"/><ellipse cx="41.2" cy="26" rx="1.8" ry="3" fill="${skin}"/>`
    + `${beard}${hairPath}`
    + `<path d="M25 24.5h3.5M31.5 24.5H35" stroke="rgba(0,0,0,.55)" stroke-width="1.3" stroke-linecap="round"/>`
    + `<path d="M27.5 32q2.5 1.4 5 0" stroke="rgba(0,0,0,.35)" stroke-width="1" fill="none" stroke-linecap="round"/>`
    + `</svg>`;
}
