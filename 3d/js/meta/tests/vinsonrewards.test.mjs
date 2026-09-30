import assert from 'node:assert/strict';
import {getVinsonReward,VINSON_REWARD_IDS,applyVinsonRewardClaim} from '../core/vinsonrewards.js';
import { getPlayer } from '../core/players.js';
import {lift,reconcileServer} from '../core/vinson.js';
for (const id of VINSON_REWARD_IDS) { const p=getVinsonReward(id);assert.equal(getPlayer(id),p);assert.equal(p.battleReward,true);assert.equal(p.secret,true);assert.ok(p.fullArt); }
const s={club:[],vinson:{phase:'lifted',battleWon:true,immune:true,rewardsClaimed:false}};
assert.equal(applyVinsonRewardClaim(s,{ok:false,cards:VINSON_REWARD_IDS}),false);
assert.equal(s.club.length,0);
assert.equal(applyVinsonRewardClaim(s,{ok:true,cards:[VINSON_REWARD_IDS[0]]}),false);
assert.equal(applyVinsonRewardClaim(s,{ok:true,claimed:true,cards:VINSON_REWARD_IDS}),true);
assert.equal(s.club.length,3);
assert.equal(applyVinsonRewardClaim(s,{ok:true,claimed:false,cards:VINSON_REWARD_IDS}),true);
assert.equal(s.club.length,3);
lift(s);assert.equal(s.vinson.immune,true);assert.equal(s.vinson.rewardsClaimed,true);
const restored={club:[],vinson:{phase:'locked'}};reconcileServer(restored,{ok:true,phase:'lifted',immune:true,battleWon:true,rewardsClaimed:false});
assert.equal(restored.vinson.battleWon,true);assert.equal(restored.vinson.rewardsClaimed,false);
assert.equal(applyVinsonRewardClaim({club:[],vinson:{phase:'locked'}},{ok:true,cards:VINSON_REWARD_IDS}),false);
console.log('Vinson reward and immunity recovery regressions passed');
