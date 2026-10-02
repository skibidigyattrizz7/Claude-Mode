// Seeded, timed ordered-key duel. Failure costs ground and a stun; defeat is real.
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:0));
function next(state){state.seed=(Math.imul(state.seed,1664525)+1013904223)>>>0;return state.seed/4294967296;}
function sequence(state){
  const pool=['q','e','r','f'];
  state.keys=Array.from({length:4},()=>pool.splice(Math.floor(next(state)*pool.length),1)[0]);
  state.index=0;state.remaining=Math.max(1.7,2.8-state.round*.16);state.round++;
}
export function createVinsonClash({seed=1}={}){
  const state={progress:.38,elapsed:0,pulse:0,won:false,lost:false,winAge:0,threshold:0,thresholdAge:99,
    accepted:0,events:[],seed:seed>>>0,round:0,keys:[],index:0,remaining:0,stun:0,recovery:0,mistakes:0};
  sequence(state);return state;
}
export function stepVinsonClash(state,dt,{key=null}={}){
  const delta=clamp(dt,0,.05);state.events=[];
  if(state.won){state.winAge+=delta;state.pulse=Math.max(0,state.pulse-delta*4);return state;}
  if(state.lost)return state;
  state.elapsed+=delta;state.thresholdAge+=delta;state.pulse=Math.max(0,state.pulse-delta*4);
  const fail=()=>{state.mistakes++;state.progress-=.13;state.stun=1.15;state.index=0;state.events.push({type:'stun',mistakes:state.mistakes});};
  if(state.stun>0){state.stun=Math.max(0,state.stun-delta);if(!state.stun)sequence(state);}
  else if(state.recovery>0){state.recovery=Math.max(0,state.recovery-delta);if(!state.recovery)sequence(state);}
  else {
    state.remaining=Math.max(0,state.remaining-delta);
    if(key){
      if(String(key).toLowerCase()===state.keys[state.index]){
        state.index++;state.accepted++;state.pulse=.5;state.events.push({type:'key',index:state.index});
        if(state.index===state.keys.length){state.progress+=.19;state.pulse=1;state.recovery=.55;state.events.push({type:'push',count:1,progress:state.progress});}
      }else fail();
    }
    if(!state.stun&&!state.recovery&&state.remaining<=0)fail();
  }
  state.progress=clamp(state.progress-(.015+Math.min(.014,state.elapsed*.0005))*delta);
  const threshold=state.progress>=.8?2:state.progress>=.5?1:0;
  if(threshold>state.threshold){state.threshold=threshold;state.thresholdAge=0;state.events.push({type:'escalate',threshold});}
  if(state.mistakes>=3||state.progress<=0||state.elapsed>=45){state.lost=true;state.events.push({type:'lose'});}
  else if(state.progress>=1){state.progress=1;state.won=true;state.winAge=0;state.events.push({type:'win',progress:1});}
  return state;
}
export function vinsonClashX(progress){return 440+500*clamp(progress);}
