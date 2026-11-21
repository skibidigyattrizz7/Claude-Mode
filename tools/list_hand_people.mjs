// Prints the HAND-WRITTEN real people (Icons, Stars, regulars; before any fut.gg data) as JSON:
// [{ id, person, name, card, nat, kind, pos }]. tools/fetch_futgg_players.py matches fut.gg cards against this list so that
// every existing card id (ic_/rs_/rp_) keeps its person slug. Usage: node tools/list_hand_people.mjs
import { handPeople } from '../3d/js/meta/core/realplayers.js';

console.log(JSON.stringify(handPeople(), null, 0));
