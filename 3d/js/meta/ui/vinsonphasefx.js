import {vinsonGravityRadius} from '../core/vinsonbattle.js?v=vinson31';
const clamp=n=>Math.max(0,Math.min(1,n));
// All danger geometry is taken from the seeded simulation, never random render data.
export function drawPhonkHazard(ctx,h,t,reducedMotion,beam){
  const age=h.elapsed-h.telegraph,ready=age>=0;
  ctx.save();
  if(h.type==='eclipsecross'){
    for(const s of h.segments)beam(ctx,s.x1,s.y1,s.x2,s.y2,ready?'#ff2456':'#ffba9d',ready?14:2,ready?.85:.4);
  }else if(h.type==='doomfall'){
    for(const spot of h.spots){
      const a=age-spot.delay;if(a>.65)continue;
      ctx.globalAlpha=a<0?.45:Math.max(0,1-a/.65);ctx.strokeStyle='#ff996b';ctx.lineWidth=a<0?2:5;
      ctx.setLineDash(a<0?[8,8]:[]);ctx.beginPath();ctx.arc(spot.x,spot.y,spot.radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      if(a<0&&a>-.45){const p=1+ a/.45,y=spot.y-(1-p)*320;beam(ctx,spot.x-40,y-110,spot.x,y,'#ff5538',8,.6);ctx.fillStyle='#ffe5ad';ctx.beginPath();ctx.arc(spot.x,y,12,0,Math.PI*2);ctx.fill();}
      if(a>=0){ctx.fillStyle='#ff2e4933';ctx.beginPath();ctx.arc(spot.x,spot.y,spot.radius*(1+a),0,Math.PI*2);ctx.fill();}
    }
  }else if(h.type==='gravitywell'){
    const r=vinsonGravityRadius(h);ctx.strokeStyle=ready?'#ff3858':'#b47081';ctx.lineWidth=ready?5:2;ctx.globalAlpha=ready?.85:.5;ctx.beginPath();ctx.arc(h.x,h.y,r,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<12;i++){const a=i*Math.PI/6+(reducedMotion?0:t*.8),inner=r*.75;ctx.globalAlpha=.4;ctx.beginPath();ctx.moveTo(h.x+Math.cos(a)*r,h.y+Math.sin(a)*r);ctx.lineTo(h.x+Math.cos(a+.18)*inner,h.y+Math.sin(a+.18)*inner);ctx.stroke();}
    ctx.globalAlpha=.4;ctx.fillStyle='#8c153a';ctx.beginPath();ctx.arc(h.x,h.y,19,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
export function drawStarAbility(ctx,p,t,reducedMotion,star,beam){
  const spin=reducedMotion?0:t*(p.effect==='starLattice'?4:1.5);
  if(p.effect==='constellation'||p.effect==='starLattice'){
    beam(ctx,p.x-p.vx*.04,p.y-p.vy*.04,p.x,p.y,'#9ae9ff',2,.4);
    star(ctx,p.x,p.y,p.effect==='starLattice'?19:14,spin);
    if(p.charge>0){ctx.save();ctx.strokeStyle='#aaf3ff';ctx.globalAlpha=.4;ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,25,0,Math.PI*2);ctx.stroke();ctx.restore();}
  }else{
    const domain=p.effect==='domainStar',radius=(domain?42:32)*(p.charge>0?clamp(1-p.charge/.5):1);
    star(ctx,p.x,p.y,radius,spin);star(ctx,p.x,p.y,radius*.65,-spin,.6);
    ctx.save();ctx.strokeStyle=domain?'#d8f9ff':'#ffe3a1';ctx.lineWidth=2;ctx.globalAlpha=.6;ctx.beginPath();ctx.arc(p.x,p.y,radius+12,0,Math.PI*2);ctx.stroke();ctx.restore();
    if(p.charge<=0)beam(ctx,p.x-p.vx*.12,p.y-p.vy*.12,p.x,p.y,domain?'#aaeaff':'#ffe0a1',8,.35);
  }
}
