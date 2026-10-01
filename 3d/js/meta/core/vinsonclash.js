// Deterministic input model for the final domain tug-of-war.
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:0));

export function createVinsonClash(){
  return {progress:.18,elapsed:0,pending:0,pressBudget:2,holdClock:0,pulse:0,
    won:false,winAge:0,threshold:0,thresholdAge:99,accepted:0,events:[]};
}

export function stepVinsonClash(state,dt,{presses=0,held=false}={}){
  const delta=clamp(dt,0,.05);
  state.events=[];
  if(state.won){state.winAge+=delta;state.pulse=Math.max(0,state.pulse-delta*4);return state;}
  state.elapsed+=delta;state.thresholdAge+=delta;
  state.pressBudget=Math.min(2,state.pressBudget+delta*15);
  state.pending=Math.min(4,state.pending+Math.max(0,Math.floor(presses)));
  if(held){
    state.holdClock+=delta*5;
    while(state.holdClock>=1){state.holdClock-=1;state.pending=Math.min(4,state.pending+1);}
  }else state.holdClock=0;
  const accepted=Math.min(state.pending,Math.floor(state.pressBudget));
  if(accepted){
    state.pending-=accepted;state.pressBudget-=accepted;state.accepted+=accepted;
    state.progress+=accepted*.026;state.pulse=1;
    state.events.push({type:'push',count:accepted,progress:state.progress});
  }
  const resistance=.054+Math.min(.036,state.elapsed*.0036);
  state.progress=clamp(state.progress-resistance*delta,.12,1);
  const nextThreshold=state.progress>=.8?2:state.progress>=.5?1:0;
  if(nextThreshold>state.threshold){
    state.threshold=nextThreshold;state.thresholdAge=0;
    state.events.push({type:'escalate',threshold:nextThreshold,progress:state.progress});
  }
  state.pulse=Math.max(0,state.pulse-delta*4);
  if(state.progress>=1){
    state.progress=1;state.won=true;state.winAge=0;
    state.events.push({type:'win',progress:1});
  }
  return state;
}

export function vinsonClashX(progress){return 440+500*clamp(progress);}
