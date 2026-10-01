const clamp=n=>Math.max(0,Math.min(1,n));
export function drawDomainClash(ctx,shot,t,reducedMotion,star){
  const p=shot.domainPower;if(!p)return;
  const border=shot.clashX??640;
  for(const [x,color,side] of [[300,'#73bdf6',-1],[980,'#e83855',1]]){
    ctx.save();ctx.beginPath();ctx.rect(side<0?0:border,180,side<0?border:1280-border,540);ctx.clip();
    const glow=ctx.createRadialGradient(x,450,25,x,450,520);glow.addColorStop(0,color+'38');glow.addColorStop(1,color+'00');ctx.globalAlpha=p;ctx.fillStyle=glow;ctx.fillRect(0,180,1280,540);
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.globalAlpha=p*.45;
    for(let i=0;i<3;i++){const r=150+i*65+(reducedMotion?0:Math.sin(t*1.3+i)*8);ctx.beginPath();ctx.ellipse(x,490,r,r*.48,0,0,Math.PI*2);ctx.stroke();}
    if(side<0){ctx.translate(x,490);ctx.scale(1,.48);star(ctx,0,0,220,reducedMotion?0:t*.2,p*.25);}
    ctx.restore();
  }
}
export function drawThrownSword(ctx,shot,t,reducedMotion){
  const p=clamp(shot.throwSword);if(!p||shot.time>8.9)return;
  const x=365+615*p,y=330-120*Math.sin(p*Math.PI),rotation=Math.atan2(-120*Math.PI*Math.cos(p*Math.PI),615)-Math.PI/2;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);
  ctx.shadowColor='#def5ff';ctx.shadowBlur=reducedMotion?0:12;ctx.fillStyle='#d2e2e9';
  ctx.beginPath();ctx.moveTo(-7,-90);ctx.lineTo(7,-90);ctx.lineTo(5,-10);ctx.lineTo(0,12);ctx.lineTo(-5,-10);ctx.closePath();ctx.fill();
  ctx.fillStyle='#c4a05c';ctx.fillRect(-23,-98,46,8);ctx.fillStyle='#263647';ctx.fillRect(-5,-130,10,32);ctx.restore();
}
