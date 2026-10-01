import { createVinsonHand } from './vinsonhand.js';
import { fractureElement } from './vinsonfracture.js';
import { load } from '../core/storage.js';

// Absolute beats prevent timer drift from turning the sequence into simultaneous punches.
export const VINSON_PACK_BEATS = [
  { at:2500, action:'surfaces' }, { at:5300, action:'pane' },
  ...[6500,8300,10200,12200,14400,16800].map((at,i)=>({at,action:'punch',hit:i+1})),
  { at:19200, action:'reach' }, { at:21100, action:'black' }, { at:22700, action:'exit' },
];
const world = new URL('../../../assets/vinson/world.webp',import.meta.url).href;
const NS = 'http://www.w3.org/2000/svg';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function svg(tag,attrs={}) {
  const e=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs)) e.setAttribute(k,String(v));
  return e;
}
function div(cls) { const e=document.createElement('div');e.className=cls;return e; }
function animate(e,frames,opts) {
  try { return e.animate?.(frames,opts); } catch { return null; }
}
export function vinsonCrackPaths(hit) {
  const paths=[];
  // Branches get longer with each impact; every punch uses the same central fracture.
  for(let i=0;i<4+hit*2;i++) {
    const a=i*2.399963+hit*.12, length=35+hit*34+(i%3)*13;
    const x=500+Math.cos(a)*length,y=480+Math.sin(a)*length;
    const mx=500+Math.cos(a+.11)*length*.44,my=480+Math.sin(a+.11)*length*.44;
    paths.push('M500 480 L'+mx.toFixed(1)+' '+my.toFixed(1)+' L'+x.toFixed(1)+' '+y.toFixed(1));
    if(hit>2&&i%2===0) paths.push('M'+mx.toFixed(1)+' '+my.toFixed(1)+' l'+(Math.cos(a+.7)*length*.22).toFixed(1)+' '+(Math.sin(a+.7)*length*.22).toFixed(1));
  }
  return paths;
}
// Fixed, uneven shard outline: later hits enlarge the SAME wound, without rotating symmetry.
const SHARD_EDGE = [[1,.05],[.82,-.08],[.90,-.24],[.52,-.35],[.60,-.80],[.41,-.70],[.07,-1],[-.03,-.83],[-.49,-.84],[-.42,-.67],[-.91,-.52],[-.72,-.29],[-1,.09],[-.89,.28],[-.81,.59],[-.52,.54],[-.20,.95],[.01,.78],[.38,.88],[.47,.66],[.76,.54],[.68,.31]];
export function vinsonHolePoints(hit) {
  const radius=[0,0,0,0,5,19,47][clamp(hit,0,6)];
  return SHARD_EDGE.map(([x,y])=>[50+x*radius,48+y*radius*.92]);
}
function punchedHole(hit) {
  const points=vinsonHolePoints(hit);
  points.push(points[0]);
  return 'polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,'+points.map(([x,y])=>x.toFixed(2)+'% '+y.toFixed(2)+'%').join(',')+')';
}
function backgroundPane(overlay) {
  const pane=div('vinson-punch-pane'),style=getComputedStyle(overlay);
  pane.style.background=style.background;
  // Keep actual background artwork and live-canvas pixels, without duplicating the result UI.
  for(const source of overlay.querySelectorAll('.pm-po-bg,.pm-po-canvas,.pk2-canvas,.pm-po-rays')) {
    const copy=source.cloneNode(true),css=getComputedStyle(source);
    for(let i=0;i<css.length;i++) copy.style.setProperty(css[i],css.getPropertyValue(css[i]));
    copy.removeAttribute('id');copy.style.pointerEvents='none';copy.style.animation='none';
    if(source.tagName==='CANVAS') try { copy.getContext('2d')?.drawImage(source,0,0); } catch {}
    pane.append(copy);
  }
  return pane;
}
/** Runs only AFTER the cursed grid intercepted the first click and broke its buttons. */
export function playVinsonPackCollapse(stage,{onExit,reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches}={}) {
  if(!document.querySelector('link[data-vinson-pack-collapse]')) {
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('../../../css/vinsonpackcollapse.css?v=2',import.meta.url).href;
    css.dataset.vinsonPackCollapse='1';document.head.append(css);
  }
  const overlay=stage.closest('.pm-po') || stage;
  const layer=div('vinson-pack-collapse');layer.setAttribute('aria-hidden','true');layer.inert=true;
  const actor=div('vinson-punch-actor'),portrait=new Image();portrait.src=world;portrait.alt='';actor.append(portrait);
  const pane=backgroundPane(overlay),cracks=svg('svg',{viewBox:'0 0 1000 1000',preserveAspectRatio:'none',class:'vinson-punch-cracks'});
  const blood=svg('g',{class:'vinson-punch-blood'});cracks.append(blood);
  const hand=createVinsonHand();
  const black=div('vinson-punch-black');layer.append(actor,pane,cracks,hand,black);document.body.append(layer);
  let closed=false,audio=null;const timers=new Set(),dust=new Set();
  const volume=clamp(Number((load('meta.settings',{})||{}).volume ?? 70)/100,0,1);
  try { const Audio=window.AudioContext||window.webkitAudioContext;if(volume&&Audio){audio=new Audio();void audio.resume().catch(()=>{});} } catch {}
  function thud(hit) {
    if(!audio||audio.state!=='running'||document.hidden)return;
    try {
      const o=audio.createOscillator(),g=audio.createGain(),now=audio.currentTime;
      o.type='triangle';o.frequency.setValueAtTime(90+hit*6,now);o.frequency.exponentialRampToValueAtTime(28,now+.22);
      g.gain.setValueAtTime(.06*volume,now);g.gain.exponentialRampToValueAtTime(.001,now+.28);
      o.connect(g);g.connect(audio.destination);o.start(now);o.stop(now+.3);
    } catch {}
  }
  function later(fn,ms) { const t=setTimeout(()=>{timers.delete(t);if(!closed)fn();},ms);timers.add(t); }
  function finish(exit=false) {
    if(closed)return;closed=true;for(const t of timers)clearTimeout(t);timers.clear();
    observer.disconnect();for(const e of dust)e.remove();layer.remove();void audio?.close().catch(()=>{});if(exit)onExit?.();
  }
  const observer=new MutationObserver(()=>{if(!overlay.isConnected)finish();});
  observer.observe(document.body,{childList:true,subtree:true});
  function impact(hit) {
    layer.dataset.hit=String(hit);thud(hit);
    if(!reducedMotion) animate(layer,[{transform:'none'},{transform:'translate('+(-2-hit)+'px,'+(2+hit)+'px)'},{transform:'translate('+(3+hit)+'px,-2px)'},{transform:'none'}],{duration:220,easing:'ease-out'});
    for(const d of vinsonCrackPaths(hit)) {
      const path=svg('path',{d,fill:'none',stroke:hit>=4?'#bd5660':'#ddd2c9','stroke-width':hit>=5?1.8:1,'vector-effect':'non-scaling-stroke'});
      cracks.append(path);
      if(!reducedMotion) {
        const length=path.getTotalLength();path.style.strokeDasharray=length;path.style.strokeDashoffset=length;
        animate(path,[{strokeDashoffset:length},{strokeDashoffset:0}],{duration:450+hit*45,fill:'forwards',easing:'ease-out'});
      }
      if(hit>=4) {
        const leak=svg('path',{d,fill:'none',stroke:'#850912','stroke-width':2+hit,'stroke-linecap':'round',class:'vinson-crack-leak'});
        blood.append(leak);
      }
    }
    for(let i=0;i<(reducedMotion?0:14);i++) {
      const particle=div(hit>=4?'vinson-punch-chip':'vinson-punch-dust'),angle=i*2.39996,spread=14+hit*8;
      particle.style.left=(50+Math.cos(angle)*spread*.3)+'%';particle.style.top=(48+Math.sin(angle)*spread*.3)+'%';
      layer.append(particle);dust.add(particle);
      animate(particle,[{transform:'translate(0,0) rotate(0deg)',opacity:1},{transform:'translate('+(Math.cos(angle)*spread*7)+'px,'+(130+hit*45+i*13)+'px) rotate('+(90+i*27)+'deg)',opacity:0}],{duration:1400+i*35,fill:'forwards',easing:'cubic-bezier(.25,.1,.7,1)'});
      later(()=>{particle.remove();dust.delete(particle);},2000);
    }
    if(hit>=4) {
      for(let i=0;i<hit-2;i++) {
        const drip=svg('path',{d:'M'+(475+i*22)+' '+(486+i%2*14)+' q -7 35 1 '+(36+hit*16+i*7),fill:'none',stroke:'#950713','stroke-width':3+i%3,'stroke-linecap':'round',class:'vinson-hole-leak'});
        blood.append(drip);
      }
      const shape=punchedHole(hit);
      if(globalThis.CSS?.supports?.('clip-path',shape)) {
        const from=pane.style.clipPath||punchedHole(hit-1);
        pane.style.clipPath=shape;
        if(!reducedMotion)animate(pane,[{clipPath:from},{clipPath:shape}],{duration:650,fill:'forwards',easing:'cubic-bezier(.25,.7,.2,1)'});
      } else pane.style.opacity=String(clamp(1-(hit-3)*.25,.2,1));
    }
    if(hit===6) {
      layer.classList.add('is-open');actor.style.opacity='1';
      if(!reducedMotion)animate(actor,[{transform:'scale(.92)',filter:'brightness(.2)'},{transform:'scale(1)',filter:'brightness(1)'}],{duration:1600,fill:'forwards',easing:'ease-out'});
    }
  }
  function beat(b) {
    if(b.action==='surfaces') {
      const wrap=stage.querySelector('.pm-po-gridwrap');
      const visible=[...(wrap?.querySelectorAll('.pm-po-item,.pm-po-gridhead,.pm-po-hint')||[])].filter(e=>{
        const r=e.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0;
      }).slice(0,24);
      visible.forEach((e,i)=>{fractureElement(e,{delay:i%6*75});e.style.visibility='hidden';});
      const shroud=stage.querySelector('.vinson-po-aftermath');
      const words=shroud?.querySelector('.vinson-po-aftermath-card');
      if(words)fractureElement(words,{delay:200});
      shroud?.remove();
      later(()=>wrap?.remove(),1700);
    } else if(b.action==='pane') layer.classList.add('is-punching');
    else if(b.action==='punch')impact(b.hit);
    else if(b.action==='reach') {
      layer.classList.add('is-reaching');
      if(!reducedMotion)animate(hand,[{transform:'translate(-50%,50%) scale(.3)',opacity:0},{transform:'translate(-50%,4%) scale(.85)',opacity:1,offset:.55},{transform:'translate(-50%,-10%) scale(2.9)',opacity:1}],{duration:1900,fill:'forwards',easing:'cubic-bezier(.25,.2,.3,1)'});
      else {hand.style.opacity='1';hand.style.transform='translate(-50%,4%) scale(.85)';}
      if(!reducedMotion)for(const [i,finger] of [...hand.querySelectorAll('.vinson-hand-finger')].entries()) {
        animate(finger,[{transform:'rotate(0deg)'},{transform:'rotate('+finger.dataset.grip+'deg) scaleY(.84)'}],{delay:650+i*65,duration:1000,fill:'forwards',easing:'cubic-bezier(.5,0,.2,1)'});
      }
    } else if(b.action==='black')layer.classList.add('is-black');
    else if(b.action==='exit')finish(true);
  }
  for(const b of VINSON_PACK_BEATS)later(()=>beat(b),b.at);
  return {cancel:()=>finish()};
}
