// Prints the distinct real persons in the card database as JSON: [{ person, name, nat, icon }].
// Used by tools/fetch_player_photos.py. Usage: node tools/list_real_people.mjs > people.json
import { getDB } from '../3d/js/meta/core/players.js';

const seen = new Map();
for (const p of getDB().all) {
  if (p.real !== true) continue;
  if (String(p.id).startsWith('pr_')) continue; // promo copies share the base card's person
  const person = p.person || p.baseId || p.id;
  const prev = seen.get(person);
  if (prev) { prev.icon = prev.icon || p.club === 'ICN'; continue; }
  seen.set(person, { person, name: p.name, nat: p.nat, icon: p.club === 'ICN' });
}
console.log(JSON.stringify([...seen.values()], null, 1));
