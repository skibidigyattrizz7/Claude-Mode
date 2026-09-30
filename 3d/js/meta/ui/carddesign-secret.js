// Which real EA SPORTS card design (assets/cards/<key>.webp, see core/carddesigns.js) each secret / admin card wears
// (owner, Sep 30: "use the real FIFA / FC designs, not the bs u made"; non-commercial fan game, EA art allowed).
// carddesign.js `designFor(p)` calls `secretDesignFor(p)` first: a design key means "use this EA background",
// null means "not one of ours, carry on with the normal designs". DOM-free (node-testable).
//
// The look that makes each card special (glow, glitch flicker, the infinity display, HELL seal, cursed red) is
// restyled in css/cards-secret.css on top of the EA background.
//
// ONE-LINE SWITCH TO CUSTOM ART (owner may supply ChatGPT-made art): add the file to CARD_DESIGNS as
// 'custom-<name>' (assets/cards/custom-shawky.webp ...) and it is used automatically, no code change; or repoint a
// family by editing its line in SECRET_DESIGNS below. Family names: shawky cursed evil hell angel eman elijah rabbi admin.
import { CARD_DESIGNS } from '../core/carddesigns.js';
import { PROMO_BY_ID } from '../core/promos.js';

export const SECRET_DESIGNS = {
  shawky: 'f22-51',    // FIFA 22 Flashback: green and teal digital tearing, the glitch look (all the infinity glitch cards)
  cursed: 'f23-149',   // FIFA 23 Rulebreakers red: cracked, torn dark rock (THE NII / AryeetyMensah)
  evil: 'f23-159',    // FIFA 23 dark red crystal (Evil Perlita, Evil Nickerson: cursed twins)
  hell: 'fc24-116',   // FC 24 magma and fire (Evil Vinson)
  angel: 'f23-12',     // FIFA 23 Icon white marble and gold (Pain Man)
  eman: 'f23-125',     // FIFA 23 black and orange (E-Man; his picture is a dark fire portrait)
  elijah: 'fc26-33-0', // FC 26 storm with fire lightning (E.L.I.J.A.H., the final form)
  rabbi: 'fc26-65-0',  // FC 26 blue and silver (Rabbi Patel, the knight picture)
  admin: 'fc27-3-3',   // FC 27 black and gold premium (Card Creator cards and the top-100 admin cards)
};

/** The design key for a family: the owner's custom art if it was added to CARD_DESIGNS, else the EA design above. */
function keyFor(family) {
  const custom = `custom-${family}`;
  if (CARD_DESIGNS[custom]) return custom;
  const k = SECRET_DESIGNS[family];
  return CARD_DESIGNS[k] ? k : null;
}

/** Card Creator / admin cards: an admin who picked a design (promo campaign or a base special like In-Form) keeps it. */
function isPlainAdmin(p) {
  if (!(p.customAdmin === true || p.special === 'admin')) return false;
  return !(p.promo || PROMO_BY_ID[p.special] || (p.customAdmin === true && p.special));
}

/** family name of a secret / admin card, or null when p is a normal card */
export function secretFamily(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.hell === true) return 'hell';
  if (p.angel === true) return 'angel';
  if (p.evil === true) return 'evil';
  if (p.cursed === true) return 'cursed';
  if (p.fullArt) {
    if (p.id === 'secret_knight') return 'rabbi';
    if (p.id === 'secret_eman') return 'eman';
    if (p.id === 'secret_elijah') return 'elijah';
    return p.artTheme === 'fire' ? 'elijah' : 'rabbi';
  }
  if (p.glitch === true || p.secret === true || p.special === 'secret') return 'shawky';
  if (isPlainAdmin(p)) return 'admin';
  return null;
}

/** EA design key for a secret / admin card, or null (not ours, or an admin card that chose its own promo design). */
export function secretDesignFor(p) {
  const fam = secretFamily(p);
  return fam ? keyFor(fam) : null;
}
