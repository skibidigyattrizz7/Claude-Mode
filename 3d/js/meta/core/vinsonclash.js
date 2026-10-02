// Normal pushing with two announced sequence moments. Mistakes stun, never a strike-limit defeat.
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:0));
function next(state){state.seed=(Math.imul(state.seed,1664525)+1013904223)>>>0;return state.seed/4294967296;}
function warn(state){
 const pool=['q','e','r','f'];state.keys=Array.from({length:4},()=>pool.splice(Math.floor(next(state)*pool.length),1)[0]);
 state.index=0;state.phase='warning';state.warning=2.2;state.remaining=3;state.events.push({type:'warning'});
}
export function createVinsonClash({seed=1}={}){
 return {progress:.38,elapsed:0,pulse:0,won:false,lost:false,winAge:0,threshold:0,thresholdAge:99,
 accepted:0,events:[],seed:seed>>>0,keys:[],index:0,remaining:0,stun:0,recovery:0,mistakes:0,
 phase:'push',warning:0,gates:[false,false],pressBudget:2,holdClock:0};
}
export function stepVinsonClash(state,dt,{key=null,presses=0,held=false}={}){
 const delta=clamp(dt,0,.05);state.events=[];
 if(state.won){state.winAge+=delta;state.pulse=Math.max(0,state.pulse-delta*4);return state;}if(state.lost)return state;
 state.elapsed+=delta;state.thresholdAge+=delta;state.pulse=Math.max(0,state.pulse-delta*4);
 const fail=()=>{state.mistakes++;state.progress-=.08;state.stun=1.15;state.phase='stunned';state.events.push({type:'stun'});};
 if(state.phase==='stunned'){
  state.stun=Math.max(0,state.stun-delta);if(!state.stun){state.phase='push';state.keys=[];state.events.push({type:'resume'});}
 }else if(state.phase==='warning'){
  // All old attack/ability input is ignored through this visible preparation window.
  state.warning=Math.max(0,state.warning-delta);if(!state.warning){state.phase='sequence';state.events.push({type:'sequenceReady'});}
 }else if(state.phase==='sequence'){
  state.remaining=Math.max(0,state.remaining-delta);
  // Attack spam is never a wrong sequence key. Only fresh Q/E/R/F choices count here.
  if(['q','e','r','f'].includes(key)){
   if(key===state.keys[state.index]){state.index++;state.accepted++;state.pulse=.5;
    if(state.index===state.keys.length){state.progress+=.10;state.phase='push';state.keys=[];state.pulse=1;state.events.push({type:'push',count:1});}
   }else fail();
  }
  if(state.phase==='sequence'&&state.remaining<=0)fail();
 }else{
  state.pressBudget=Math.min(2,state.pressBudget+delta*15);
  let pending=Math.max(0,Math.floor(presses))+(key==='j'?1:0);
  if(held){state.holdClock+=delta*5;pending+=Math.floor(state.holdClock);state.holdClock%=1;}else state.holdClock=0;
  const accepted=Math.min(pending,Math.floor(state.pressBudget));
  if(accepted){state.pressBudget-=accepted;state.accepted+=accepted;state.progress+=accepted*.020;state.pulse=1;state.events.push({type:'push',count:accepted});}
 }
 // Pause territorial drain during warnings and key entry: the mini-event deadline is the threat.
 if(['push','stunned'].includes(state.phase))state.progress=clamp(state.progress-(.028+Math.min(.02,state.elapsed*.0008))*delta);
 for(let i=0;i<2;i++)if(state.phase==='push'&&!state.gates[i]&&state.progress>=[.5,.8][i]){state.gates[i]=true;state.threshold=i+1;state.thresholdAge=0;warn(state);break;}
 if(state.progress<=0||state.elapsed>=75){state.lost=true;state.events.push({type:'lose'});}
 else if(state.progress>=1&&state.gates.every(Boolean)&&state.phase==='push'){state.progress=1;state.won=true;state.winAge=0;state.events.push({type:'win',progress:1});}
 return state;
}
export function vinsonClashX(progress){return 440+500*clamp(progress);}
