// Which real EA card background (core/carddesigns.js CARD_DESIGNS, art in assets/cards/) a player card uses.
// designFor(p) -> key. Every normal card gets a design; only the CSS-drawn secret cards (glitch, cursed, hell,
// angel, full art) return null unless secretDesignFor() (carddesign-secret.js) names one. Pure logic, no DOM.
import { CARD_DESIGNS } from '../core/carddesigns.js';
import { PROMO_BY_ID } from '../core/promos.js';
import { secretDesignFor } from './carddesign-secret.js';

const LEVEL = { bronze: 1, silver: 2, gold: 3 };
// first key that exists in CARD_DESIGNS
const pick = (...keys) => keys.find((k) => k && CARD_DESIGNS[k]) || null;
// base cards: newest generation that has the level first, FIFA 23 always exists as the last resort
const GENS = ['fc27', 'fc26', 'fc25', 'fc24'];
const baseKeys = (rare, lv) => [...(rare ? GENS.filter((g) => g !== 'fc27') : GENS).map((g) => `${g}-${rare ? 1 : 0}-${lv}`), `f23-${rare ? 1 : 0}-${lv}`];

// Special (non-promo) card families -> a fitting design, newest art first, FIFA 23 as the fallback.
const TOTW = ['fc27-3-3', 'fc26-3-0', 'f23-3'];
const ICON = ['fc27-12-0', 'fc26-12-0', 'f23-12'];
const HERO = ['f23-72', 'fc26-72-0', 'f23-8'];
const LOTG = ['fc26-76-0', 'fc26-77-0', 'f23-3'];
const OBJECTIVE = ['fc26-87-0', 'f23-10'];

/** @param p player object (see core/players.js) @returns {string|null} key of CARD_DESIGNS */
export function designFor(p) {
  if (!p) return null;
  const secret = secretDesignFor(p);
  if (secret) return secret;
  // the CSS-drawn secret cards keep their own look
  if (p.cursed === true || p.evil === true || p.hell === true || p.angel === true || p.glitch === true || p.fullArt || p.special === 'secret') return null;
  const lv = LEVEL[p.tier] || 3;
  let key = null;
  if (p.totw || p.special === 'inform') key = pick(...TOTW);
  else {
    const promo = PROMO_BY_ID[p.promo || p.special];
    if (promo && promo.design) key = pick(promo.design);
    if (!key && (p.club === 'ICN' || p.special === 'legend')) key = pick(...ICON);
    else if (!key && p.special === 'hero') key = pick(...HERO);
    else if (!key && p.special === 'lotg') key = pick(...LOTG);
    else if (!key && p.special === 'objective') key = pick(...OBJECTIVE);
  }
  return key || pick(...baseKeys(!!p.rare || !!p.special, lv)) || pick(...baseKeys(false, lv));
}
