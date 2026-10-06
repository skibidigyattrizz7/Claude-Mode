// Real EA SPORTS FC card data (fut.gg): indexes and helpers over the GENERATED core/futplayers.js. DOM-free.
// A row is turned into a plain card object (see futCard). Hand-written players (Icons, Stars, regulars) look their card up with
// futFor(person, kind) and take the real ratings / stats; rows with `isNew` become new cards (realplayers.js).
import { FUT_ROWS, FUT_GAME, FUT_ASOF } from './futplayers.js';

export { FUT_GAME, FUT_ASOF };

/** One generated row -> a card object. */
export function futCard(r) {
  return {
    slug: r[0], eaId: r[1], kind: r[2], isNew: r[3] === 1, game: r[4], name: r[5], card: r[6], nat: r[7], pos: r[8],
    alt: r[9].slice(), foot: r[10], wf: r[11], sm: r[12], ovr: r[13], face: r[14].slice(), dob: r[15], age: r[16],
    height: r[17], weight: r[18], lg: r[19], club: r[20], league: r[21], styles: r[22],
  };
}

export const FUT_CARDS = FUT_ROWS.map(futCard);

/** person slug -> { b, i, h } (base card / Icon / Hero) */
export const FUT_BY_PERSON = new Map();
for (const c of FUT_CARDS) {
  let e = FUT_BY_PERSON.get(c.slug);
  if (!e) FUT_BY_PERSON.set(c.slug, (e = {}));
  if (!e[c.kind]) e[c.kind] = c;
}

/** The card a hand-written player takes its real data from. `kind`: 'icon' rows only ever take an Icon (or Hero) card (a prime
 * Icon is never a current base card); Star / regular rows take the base card, else the Icon, else the Hero. */
export function futFor(person, kind) {
  const e = FUT_BY_PERSON.get(person);
  if (!e) return null;
  return kind === 'icon' ? e.i || e.h || null : e.b || e.i || e.h || null;
}

/** New cards to create: base cards (rs_<slug>) and Icons (ic_<slug>) that no hand-written player already covers. */
export const FUT_NEW_BASE = FUT_CARDS.filter((c) => c.isNew && c.kind === 'b');
export const FUT_NEW_ICONS = FUT_CARDS.filter((c) => c.isNew && c.kind === 'i');

/** 'YYYY-MM-DD|height|foot|weight' for core/bios.js (any person with a fut.gg card); the real EA card values. */
export function futBio(person) {
  const c = futFor(person, 'regular') || futFor(person, 'icon');
  return c ? { dob: c.dob || null, height: c.height || null, foot: c.foot, weight: c.weight || null } : null;
}
