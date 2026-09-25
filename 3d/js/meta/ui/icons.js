// FC-style line/filled icon set for UT tiles, admin tools and buttons. Plain SVG, no external assets.
// One consistent stroke width so every icon reads as part of the same family (not clip-art).
import { frag } from './dom.js';

const STROKE = 1.75;
const WRAP = (body, filled) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" ${filled ? 'class="filled"' : ''}>${body}</svg>`;

// Each entry: raw inner SVG markup (paths use currentColor via stroke/fill so CSS can recolor per-tile).
const RAW = {
  squad: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="9.2" r="2.6"/><path d="M6.5 18c1-3 3-4.4 5.5-4.4s4.5 1.4 5.5 4.4"/>',
  play: '<circle cx="12" cy="12" r="9.2"/><path d="M9.6 8.2 16 12l-6.4 3.8z" fill="currentColor" stroke="none"/>',
  store: '<path d="M4 8 5.5 4h13L20 8"/><path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M9 12a3 3 0 0 0 6 0"/>',
  sbc: '<rect x="3.5" y="3.5" width="8" height="8" rx="1.6"/><rect x="12.5" y="3.5" width="8" height="8" rx="1.6"/><rect x="3.5" y="12.5" width="8" height="8" rx="1.6"/><path d="m14.3 17 1.7 1.7L20.5 14"/>',
  objectives: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/>',
  market: '<path d="M4 10h16l-1.4 8.2a1.5 1.5 0 0 1-1.5 1.3H6.9a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  rivals: '<path d="M7 3v7a5 5 0 0 0 10 0V3"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/><path d="M12 15v3M9 21h6M9 18h6"/>',
  draft: '<path d="M12 3v13"/><path d="M6.5 9.5 12 4l5.5 5.5"/><rect x="4.5" y="16.5" width="15" height="4.5" rx="1.4"/>',
  evolutions: '<path d="M4 12a8 8 0 0 1 13.6-5.7M20 12a8 8 0 0 1-13.6 5.7"/><path d="M17.6 3.6v3.2h-3.2M6.4 20.4v-3.2h3.2"/>',
  club: '<path d="M12 3 4 6.5V12c0 5.2 3.6 8 8 9 4.4-1 8-3.8 8-9V6.5z"/><path d="M9 12l2.1 2.2L15.5 9.5"/>',
  admin: '<path d="M12 2 4 5v6c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5z"/><circle cx="12" cy="10.3" r="2.4"/><path d="M8.2 15.4c.9-2 2.1-3 3.8-3s2.9 1 3.8 3"/>',
  gifts: '<rect x="3.5" y="9" width="17" height="11" rx="1.4"/><path d="M3.5 13.2h17"/><path d="M12 9v11"/><path d="M8.4 9C6.6 9 5.6 8 5.6 6.6 5.6 5.4 6.5 4.6 7.6 4.6c1.7 0 3.2 1.6 4.4 4.4M15.6 9c1.8 0 2.8-1 2.8-2.4 0-1.2-.9-2-2-2-1.7 0-3.2 1.6-4.4 4.4"/>',
  season: '<path d="M8 3h8l-1 6-3 2-3-2z"/><path d="M9 21h6M12 11v6M6 5H4a1 1 0 0 0-1 1c0 2.6 2 4.3 4.3 4.6M18 5h2a1 1 0 0 1 1 1c0 2.6-2 4.3-4.3 4.6"/>',
  totw: '<path d="M12 3.5 14.6 9l6 .8-4.4 4 1.2 5.9L12 16.9l-5.4 2.8 1.2-5.9-4.4-4 6-.8z"/>',
  tactics: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.2"/><path d="M3.5 12h17M12 3.5v17"/><circle cx="7.4" cy="7.6" r="1.15" fill="currentColor" stroke="none"/><circle cx="16.6" cy="7.6" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="16.4" r="1.15" fill="currentColor" stroke="none"/>',
  custom: '<path d="M14.2 3.8 20.2 9.8 9.6 20.4 3.8 20.2 3.6 14.4z"/><path d="M12.6 5.4 18.6 11.4"/>',
  promo: '<path d="M12 3v3.2M12 17.8V21M4.6 12H3M21 12h-1.6M6 6l1.6 1.6M18 18l-1.6-1.6M18 6l-1.6 1.6M6 18l1.6-1.6"/><circle cx="12" cy="12" r="4.4"/>',
  event: '<path d="M6 3v4M18 3v4M4 8h16"/><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8.5 12.3 12 14.5l3.5-2.2v3l-3.5 2-3.5-2z"/>',
  draftpick: '<circle cx="12" cy="8" r="3.2"/><path d="M6 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><path d="M4 5.5 6 3.5M20 5.5 18 3.5"/>',
  chest: '<path d="M4 10 12 6l8 4"/><path d="M4 10v8.4a1.6 1.6 0 0 0 1.6 1.6h12.8a1.6 1.6 0 0 0 1.6-1.6V10"/><path d="M9 10v3.4a3 3 0 0 0 6 0V10"/>',
  coins: '<ellipse cx="9.2" cy="15" rx="5.4" ry="3.4"/><path d="M3.8 15v3.4c0 1.9 2.4 3.4 5.4 3.4s5.4-1.5 5.4-3.4V15"/><ellipse cx="14.4" cy="8.4" rx="5.2" ry="3.2"/><path d="M9.2 8.4v3.2"/>',
  infinite: '<path d="M7.2 8.4a3.6 3.6 0 1 0 0 7.2c2.4 0 3.4-1.6 4.8-3.6 1.4 2 2.4 3.6 4.8 3.6a3.6 3.6 0 1 0 0-7.2c-2.4 0-3.4 1.6-4.8 3.6-1.4-2-2.4-3.6-4.8-3.6z"/>',
  grant: '<circle cx="9" cy="8" r="3.2"/><path d="M3.6 19.4c0-3.4 2.4-5.9 5.4-5.9M14 4.2v6M11 7.2h6"/>',
  cardcreator: '<rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M7 15.5 9.7 12l2.4 2.6L15 11l3 4.5"/><circle cx="8.4" cy="8.4" r="1.4"/>',
  broadcast: '<path d="M12 15.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M7.8 8a5.9 5.9 0 0 0 0 8M16.2 8a5.9 5.9 0 0 1 0 8M4.6 5a9.6 9.6 0 0 0 0 14M19.4 5a9.6 9.6 0 0 1 0 14"/>',
  giveaway: '<rect x="3.5" y="9" width="17" height="11" rx="1.4"/><path d="M3.5 13.2h17M12 9v11"/><path d="M12 9c-4.6-.4-6-2-6-3.6a2 2 0 0 1 2-2c2.4 0 3.6 2.4 4 5.6M12 9c4.6-.4 6-2 6-3.6a2 2 0 0 0-2-2c-2.4 0-3.6 2.4-4 5.6"/><path d="M9.5 2.3 12 5.6l2.5-3.3" stroke-opacity=".001"/>',
  moderation: '<path d="M12 3 4.5 5.6v5.2c0 5.4 3.5 8.6 7.5 10.6 4-2 7.5-5.2 7.5-10.6V5.6z"/><path d="M9.4 12l1.9 2 3.6-4.4"/>',
  ban: '<circle cx="12" cy="12" r="8.6"/><path d="M6.2 17.8 17.8 6.2"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  key: '<circle cx="8" cy="15.5" r="4"/><path d="M11 12.5 19 4.5M16 7.5l2.2 2.2M13.4 10.1l2 2"/>',
  crown: '<path d="M3 18h18l-2-9-4.2 4-2.8-6-2.8 6L5 9z"/><path d="M3 20.5h18"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M12 3.6v2.5M12 17.9v2.5M20.4 12h-2.5M6.1 12H3.6M17.5 6.5l-1.8 1.8M8.3 15.7l-1.8 1.8M17.5 17.5l-1.8-1.8M8.3 8.3 6.5 6.5"/>',
  upload: '<path d="M12 15.5V4.5M8 8.3 12 4.2l4 4.1"/><path d="M4.5 15v3.6c0 1 .8 1.9 1.9 1.9h11.2c1 0 1.9-.8 1.9-1.9V15"/>',
  crop: '<path d="M6 3v14a1 1 0 0 0 1 1h14"/><path d="M18 21V7a1 1 0 0 0-1-1H3"/>',
  bell: '<path d="M6 10.5a6 6 0 0 1 12 0v3.7l1.6 2.6H4.4L6 14.2z"/><path d="M9.6 19.5a2.4 2.4 0 0 0 4.8 0"/>',
  tag: '<path d="M12.3 3.5h5.2a1 1 0 0 1 1 1v5.2a1 1 0 0 1-.3.7l-8 8a1 1 0 0 1-1.4 0l-5.2-5.2a1 1 0 0 1 0-1.4l8-8a1 1 0 0 1 .7-.3z"/><circle cx="15.4" cy="7.6" r="1.15" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.6" cy="10.6" r="6.6"/><path d="m20 20-4.6-4.6"/>',
  toggle: '<rect x="2.5" y="7.5" width="19" height="9" rx="4.5"/><circle cx="7.5" cy="12" r="3" fill="currentColor" stroke="none"/>',
  club_flag: '<path d="M5 21V4"/><path d="M5 4h13l-3.2 3.6L18 11H5"/>',
  swap: '<path d="M4 8h13.5M14 4.5 17.5 8 14 11.5"/><path d="M20 16H6.5M10 12.5 6.5 16l3.5 3.5"/>',
};

export const ICON_NAMES = Object.keys(RAW);

/** SVG markup string for an icon (used inside larger html templates). */
export function iconHtml(name, cls = '') {
  const body = RAW[name] || RAW.squad;
  return `<span class="pm-icon ${cls}" aria-hidden="true">${WRAP(body)}</span>`;
}

/** SVG icon as a DOM node. */
export function icon(name, cls = '') {
  return frag(iconHtml(name, cls));
}

/** Tile-art node for a hub/UT tile: a big soft-glow icon anchored bottom-right. */
export function tileIcon(name) {
  return frag(`<div class="pm-tile-art pm-tile-art--ico" aria-hidden="true">${iconHtml(name)}</div>`);
}
