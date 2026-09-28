// Simple procedural league badges (owner request Sep 27: "show the league on the card like FC does"): a small
// rounded shield in the league's colour with its short code. Works for real leagues (LEAGUES[].badge/color) and
// the pseudo leagues of special cards (Icons, Legends, Heroes, Vault, Card Creator).
import { LEAGUE_BY_ID, leagueName } from '../core/data.js';

const PSEUDO = {
  ICN: { badge: 'ICN', color: '#d4af37', ink: '#111' },
  LEG: { badge: 'LEG', color: '#e9d9a6', ink: '#3a2a05' },
  HER: { badge: 'HER', color: '#27e1c1', ink: '#1a0f3a' },
  SEC: { badge: '???', color: '#ff2d55', ink: '#111' },
  FUT: { badge: 'UT', color: '#19f5a4', ink: '#0b0f1a' },
};

function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#fff';
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}

/** { code, color, ink, name } for a league id. */
export function leagueBadgeInfo(id) {
  const lg = LEAGUE_BY_ID[id];
  if (lg) return { code: lg.badge || lg.short || lg.id, color: lg.color || '#445', ink: inkFor(lg.color), name: lg.name };
  const p = PSEUDO[id];
  if (p) return { code: p.badge, color: p.color, ink: p.ink, name: leagueName(id) };
  return { code: String(id || '?').slice(0, 3).toUpperCase(), color: '#445', ink: '#fff', name: leagueName(id) };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Inline SVG league badge. */
export function leagueBadgeSVG(id, cls = 'pm-lgbadge') {
  const { code, color, ink, name } = leagueBadgeInfo(id);
  const fs = code.length >= 3 ? 8.6 : 11;
  return `<svg class="${esc(cls)}" viewBox="0 0 24 26" role="img" aria-label="${esc(name)}"><title>${esc(name)}</title>`
    + `<path d="M12 1l10 3.2v9.3c0 6-4.4 9.7-10 11.5C6.4 23.2 2 19.5 2 13.5V4.2z" fill="${esc(color)}" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/>`
    + `<path d="M12 3.2l8 2.6v7.6c0 4.8-3.5 7.8-8 9.3" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"/>`
    + `<text x="12" y="${code.length >= 3 ? 16.6 : 17.4}" text-anchor="middle" font-family="Bahnschrift,'Arial Narrow',system-ui,sans-serif" font-weight="800" font-size="${fs}" fill="${ink}" letter-spacing="-.2">${esc(code)}</text></svg>`;
}
