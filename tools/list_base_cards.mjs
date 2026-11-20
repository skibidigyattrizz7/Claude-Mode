// Prints every real BASE card of the game database (rs_ / rp_ / ic_ ids; no promo cards) as JSON:
// [{ id, person, name, card, nat, kind: 'icon' | 'base', pos, ovr, club }]. tools/build_real_promos.py matches the real promo cards to these.
import { getDB } from '../3d/js/meta/core/players.js';

const db = getDB();
const out = db.all.filter((p) => p.real && !p.promo && /^(rs|rp|ic)_/.test(p.id))
  .map((p) => ({ id: p.id, person: p.person, name: p.name, card: p.last || p.name, nat: p.nat, kind: p.id.startsWith('ic_') ? 'icon' : 'base', pos: p.pos, ovr: p.ovr, club: p.realClub || '' }));
console.log(JSON.stringify(out));
