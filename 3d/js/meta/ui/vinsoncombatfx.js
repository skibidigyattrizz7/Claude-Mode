const clamp=n=>Math.max(0,Math.min(1,n));
export function drawVinsonBlackHole(ctx,h,t,reducedMotion){
  const age=h.elapsed-h.telegraph,ready=age>=0;
  const r=32+Math.max(0,age)*h.ringMax/h.duration;
  ctx.save();ctx.globalAlpha=ready?.9:.5;ctx.strokeStyle=ready?'#bc93ff':'#e4bfae';ctx.lineWidth=ready?5:2;
  ctx.setLineDash(ready?[]:[8,7]);ctx.beginPath();ctx.arc(h.x,h.y,ready?r:32,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  if(ready){ctx.fillStyle='#010106';ctx.shadowColor='#9960d7';ctx.shadowBlur=reducedMotion?0:16;ctx.beginPath();ctx.arc(h.x,h.y,22,0,Math.PI*2);ctx.fill();
    for(let i=0;i<9;i++){const a=i*Math.PI*2/9+(reducedMotion?0:t*2);ctx.globalAlpha=.35;ctx.beginPath();ctx.moveTo(h.x+Math.cos(a)*r,h.y+Math.sin(a)*r);ctx.quadraticCurveTo(h.x+Math.cos(a+.5)*r*.5,h.y+Math.sin(a+.5)*r*.5,h.x,h.y);ctx.stroke();}}
  ctx.restore();
}
export function drawVinsonSequence(ctx,state,t,reducedMotion){
  const s=state.sequence;if(!s)return;
  if(s.kind==='chains'){
    ctx.save();ctx.strokeStyle='#c1a78a';ctx.lineWidth=3;ctx.shadowColor='#891f33';ctx.shadowBlur=reducedMotion?0:8;
    for(const offset of [-14,14]){const x1=s.origin.x,y1=s.origin.y+offset,x2=state.hero.x,y2=state.hero.y-state.hero.bodyRise+offset;
      const count=Math.min(96,Math.max(4,Math.ceil(Math.hypot(x2-x1,y2-y1)/12)));
      for(let i=0;i<count;i++){const p=i/(count-1),x=x1+(x2-x1)*p,y=y1+(y2-y1)*p;ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(y2-y1,x2-x1));ctx.beginPath();ctx.ellipse(0,0,8,i%2?2:4,0,0,Math.PI*2);ctx.stroke();ctx.restore();}}
    ctx.restore();
  }
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.textAlign='center';ctx.fillStyle='rgba(5,5,9,.9)';ctx.fillRect(425,215,430,83);
  ctx.fillStyle=s.kind==='chains'?'#f4d6ac':'#ecafff';ctx.font='900 21px system-ui';ctx.fillText(s.kind==='chains'?'BREAK THE CHAINS':'KEEP CONTROL',640,242);
  ctx.font='900 29px monospace';
  for(let i=0;i<s.keys.length;i++){ctx.fillStyle=i<s.index?'#8fe1bf':i===s.index?'#fff0c6':'#8d869b';ctx.fillText(s.keys[i].toUpperCase(),580+i*60,278);}
  ctx.fillStyle='#f2b1ad';ctx.font='700 15px monospace';ctx.fillText(s.remaining.toFixed(1)+'s',818,278);ctx.restore();
}
export function drawVinsonCombo(ctx,state,t,reducedMotion){
  const c=state.combo;if(!c)return;
  const p=clamp(c.elapsed/c.duration),x=c.from.x+(c.target.x-c.from.x)*clamp(p/.55),y=c.from.y-50+(c.target.y-(c.from.y-50))*clamp(p/.55);
  ctx.save();ctx.fillStyle='rgba(2,5,12,.28)';ctx.fillRect(0,0,1280,720);
  ctx.strokeStyle='#e6f6ff';ctx.lineWidth=3;ctx.globalAlpha=.5;
  for(let i=0;i<12;i++){const sy=215+i*28;ctx.beginPath();ctx.moveTo(x-160-i%3*30,sy);ctx.lineTo(x-35,sy);ctx.stroke();}
  for(let i=0;i<3;i++){const a=-.85+i*.8+Math.sin(p*Math.PI)*.35,r=65+p*95;ctx.strokeStyle=i%2?'#ffe1a5':'#93dfff';ctx.lineWidth=(reducedMotion?3:5)*(1-p*.5);ctx.globalAlpha=.9;
    ctx.beginPath();ctx.arc(c.target.x,c.target.y,r,a,a+1.15);ctx.stroke();}
  ctx.restore();
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#f9ebc7';ctx.textAlign='center';ctx.font='900 25px Impact,system-ui';ctx.fillText('STARBREAKER · SPEED BLITZ',640,120);ctx.restore();
}
