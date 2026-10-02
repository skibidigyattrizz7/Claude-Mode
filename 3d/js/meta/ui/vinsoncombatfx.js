import {drawFlagStar} from './vinsonweaponart16.js?v=16';
const clamp=n=>Math.max(0,Math.min(1,n));
export function drawVinsonBlackHole(ctx,h,t,reducedMotion){
  const age=h.elapsed-h.telegraph,ready=age>=0;
  const r=32+Math.max(0,age)*h.ringMax/h.duration;
  ctx.save();ctx.globalAlpha=ready?.9:.5;ctx.strokeStyle=ready?'#bc93ff':'#e4bfae';ctx.lineWidth=ready?5:2;
  ctx.setLineDash(ready?[]:[8,7]);ctx.beginPath();ctx.arc(h.x,h.y,ready?r:32,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  if(ready){ctx.fillStyle='#010106';ctx.shadowColor='#9960d7';ctx.shadowBlur=0;ctx.beginPath();ctx.arc(h.x,h.y,22,0,Math.PI*2);ctx.fill();
    for(let i=0;i<9;i++){const a=i*Math.PI*2/9+(reducedMotion?0:t*2);ctx.globalAlpha=.35;ctx.beginPath();ctx.moveTo(h.x+Math.cos(a)*r,h.y+Math.sin(a)*r);ctx.quadraticCurveTo(h.x+Math.cos(a+.5)*r*.5,h.y+Math.sin(a+.5)*r*.5,h.x,h.y);ctx.stroke();}}
  ctx.restore();
}
export function drawVinsonSequence(ctx,state,t,reducedMotion){
  const s=state.sequence;if(!s)return;
  if(s.kind==='chains' && !(s.warning>0)){
    ctx.save();ctx.strokeStyle='#c1a78a';ctx.lineWidth=3;ctx.shadowColor='#891f33';ctx.shadowBlur=0;
    for(const offset of [-14,14]){const x1=s.origin.x,y1=s.origin.y+offset,x2=state.hero.x,y2=state.hero.y-state.hero.bodyRise+offset;
      const count=Math.min(96,Math.max(4,Math.ceil(Math.hypot(x2-x1,y2-y1)/12)));
      for(let i=0;i<count;i++){const p=i/(count-1),x=x1+(x2-x1)*p,y=y1+(y2-y1)*p;ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(y2-y1,x2-x1));ctx.beginPath();ctx.ellipse(0,0,8,i%2?2:4,0,0,Math.PI*2);ctx.stroke();ctx.restore();}}
    ctx.restore();
  }
  // Keycaps follow Patel without crossing the top HUD or leaving the camera frame.
  const cx=640,cy=180; // Dedicated warning row above actors, below the health bars.
  ctx.save();ctx.textAlign='center';ctx.fillStyle='rgba(5,5,9,.9)';ctx.fillRect(cx-174,cy-45,348,132);
  ctx.fillStyle=s.kind==='chains'?'#f4d6ac':'#ecafff';ctx.font='900 25px system-ui';ctx.fillText(s.warning>0?'GET READY · '+s.warning.toFixed(1)+'s':s.kind==='chains'?'BREAK THE CHAINS':'KEEP CONTROL',cx,cy-12);
  for(let i=0;i<s.keys.length;i++){const x=cx-100+i*100;ctx.fillStyle=i<s.index?'#183d33':i===s.index?'#433426':'#15151c';ctx.fillRect(x-35,cy,70,66);ctx.strokeStyle=i===s.index?'#fff0c6':'#8d869b';ctx.lineWidth=2;ctx.strokeRect(x-35,cy,70,66);ctx.fillStyle=i<s.index?'#8fe1bf':i===s.index?'#fff0c6':'#bbb4c7';ctx.font='900 44px monospace';ctx.fillText(s.keys[i].toUpperCase(),x,cy+49);}
  ctx.fillStyle='#f2b1ad';ctx.font='700 17px monospace';ctx.fillText(s.warning>0?'WAIT FOR THE SIGNAL':s.remaining.toFixed(1)+'s',cx,cy+84);ctx.restore();
}
export function drawVinsonCombo(ctx,state,t,reducedMotion){
  const c=state.combo;if(!c)return;
  const p=clamp(c.elapsed/c.duration),x=c.from.x+(c.target.x-c.from.x)*clamp(p/.55),y=c.from.y-50+(c.target.y-(c.from.y-50))*clamp(p/.55);
  ctx.save();ctx.fillStyle='rgba(2,5,12,.28)';ctx.fillRect(0,0,1280,720);
  ctx.strokeStyle='#e6f6ff';ctx.lineWidth=3;ctx.globalAlpha=.5;
  for(let i=0;i<12;i++){const sy=215+i*28;ctx.beginPath();ctx.moveTo(x-160-i%3*30,sy);ctx.lineTo(x-35,sy);ctx.stroke();}
  for(let i=0;i<3;i++){const a=-.85+i*.8+Math.sin(p*Math.PI)*.35,r=65+p*95;ctx.strokeStyle=i%2?'#ffe1a5':'#93dfff';ctx.lineWidth=(reducedMotion?3:5)*(1-p*.5);ctx.globalAlpha=.9;
    ctx.beginPath();ctx.arc(c.target.x,c.target.y,r,a,a+1.15);ctx.stroke();}
  // Three visual routes share the same three-press, damage-capped finisher rules.
  const variant=c.variant||0,phase=clamp(c.elapsed/2.2),radius=95,centre={x:c.target.x,y:c.target.y};
  const points=Array.from({length:6},(_,i)=>({x:centre.x+Math.cos(-Math.PI/2+i*Math.PI/3)*radius,y:centre.y+Math.sin(-Math.PI/2+i*Math.PI/3)*radius}));
  ctx.globalAlpha=.85;ctx.lineJoin='round';
  if(variant===0){
    const route=[0,2,4,0,3,5,1,3],travel=phase*7;
    for(const [color,width] of [['#ffffff',6],['#0038b8',3]]){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(points[route[0]].x,points[route[0]].y);for(let i=0;i<7;i++){const a=points[route[i]],b=points[route[i+1]],f=clamp(travel-i);if(f>0)ctx.lineTo(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f);}ctx.stroke();}
  }else if(variant===1){
    for(let i=0;i<Math.ceil(phase*6);i++)drawFlagStar(ctx,points[i].x,points[i].y,18,reducedMotion?0:t*.4,.9);
    const current=points[Math.min(5,Math.floor(phase*6))];ctx.strokeStyle='#b9d4ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(c.from.x,c.from.y-50);ctx.lineTo(current.x,current.y);ctx.stroke();
  }else{
    const rise=Math.sin(phase*Math.PI)*115;drawFlagStar(ctx,centre.x,centre.y-rise,35+phase*50,reducedMotion?0:t*.45,.9);
  }
  if(c.beat==='impact'&&c.quality===2){const fade=1-clamp(c.beatTime/.65);ctx.globalAlpha=fade;ctx.fillStyle='#d8e6ff33';ctx.fillRect(centre.x-28,0,56,centre.y);drawFlagStar(ctx,centre.x,centre.y,95+clamp(c.beatTime/.65)*35,reducedMotion?0:t*.45,fade);}
  // Two distinct strikes: crossing blades, then a short starburst at the contact point.
  if(c.presses>=2){const hit=clamp(c.beatTime/.35),r=85+hit*70;ctx.globalAlpha=1-hit*.7;ctx.strokeStyle='#e6f9ff';ctx.lineWidth=8;
    for(const sign of [-1,1]){ctx.beginPath();ctx.moveTo(c.target.x-r,c.target.y-sign*r*.55);ctx.lineTo(c.target.x+r,c.target.y+sign*r*.55);ctx.stroke();}}
  if(c.quality===2&&c.beat==='impact'){ctx.strokeStyle='#aee5ff';ctx.lineWidth=4;ctx.globalAlpha=1-clamp(c.beatTime/.65);
    for(let i=0;i<6;i++){const a=i*Math.PI/3,r=40+c.beatTime*240;ctx.beginPath();ctx.moveTo(c.target.x+Math.cos(a)*r*.4,c.target.y+Math.sin(a)*r*.4);ctx.lineTo(c.target.x+Math.cos(a)*r,c.target.y+Math.sin(a)*r);ctx.stroke();}}
  ctx.restore();
}
