// Battle-only cards: separate resolver, never inserted into any ordinary/secret pack pool.
import { addResolver } from './players.js';
import { secretCard } from './secretcard.js';
export const VINSON_REWARD_IDS = ['vinson_reward_world', 'vinson_reward_phonk', 'vinson_reward_captain'];
const specs = [
  { id: VINSON_REWARD_IDS[0], name: 'World-Ruler Vinson', nat: 'USA', fullArt: 'assets/vinson/world.webp', hell: true, cardTag: 'WORLD RULER', person: 'secret_vinson' },
  { id: VINSON_REWARD_IDS[1], name: 'Phonk Mode Vinson', nat: 'USA', fullArt: 'assets/vinson/phonk.webp', evil: true, cardTag: 'PHONK MODE', artTheme: 'fire', person: 'secret_vinson' },
  { id: VINSON_REWARD_IDS[2], name: 'Captain Israel', nat: 'ISR', fullArt: 'assets/vinson/captain.webp', cardTag: 'WORLD SAVIOUR', person: 'vinson_captain' },
];
const cards = new Map(specs.map(spec => [spec.id, { ...structuredClone(secretCard()), ...spec,
  first: '', last: spec.name, photo: null, age: null, battleReward: true, special: 'secret', value: 0, wage: 0 }]));
export const getVinsonReward = id => cards.get(id) || null;
addResolver(getVinsonReward);
/** Consume an authenticated successful server result. Whitelist cards and avoid copies on retry/reload. */
export function applyVinsonRewardClaim(state, result) {
  if (!state || !result?.ok || !state.vinson?.battleWon || !Array.isArray(result.cards)) return false;
  if (!VINSON_REWARD_IDS.every(id => result.cards.includes(id))) return false;
  state.club ||= [];
  for (const id of VINSON_REWARD_IDS) if (!state.club.includes(id)) state.club.push(id);
  state.vinson.rewardsClaimed = true;
  return true;
}

// Server claim receipt and locally saved cards can arrive at different times.
export function hasPendingVinsonRewards(state) {
  return state?.vinson?.battleWon === true && (state.vinson.rewardsClaimed !== true ||
    !VINSON_REWARD_IDS.every(id => state.club?.includes(id)));
}
