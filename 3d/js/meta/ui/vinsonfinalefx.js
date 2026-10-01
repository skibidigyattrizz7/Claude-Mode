const clamp=n=>Math.max(0,Math.min(1,n));
export function vinsonPentagramPoints(radius=210){return Array.from({length:5},(_,i)=>{const a=Math.PI/2+(i*2%5)*Math.PI*2/5;return {x:Math.cos(a)*radius,y:Math.sin(a)*radius};});}
function drawOriginalStruggleDomains(ctx,shot,t,reducedMotion,star){
  const p=shot.domainPower,border=shot.clashX??640;
  for(const [x,color,side] of [[300,'#73bdf6',-1],[980,'#e83855',1]]){
    ctx.save();ctx.beginPath();ctx.rect(side<0?0:border,180,side<0?border:1280-border,540);ctx.clip();
    const glow=ctx.createRadialGradient(x,450,25,x,450,520);glow.addColorStop(0,color+'38');glow.addColorStop(1,color+'00');ctx.globalAlpha=p;ctx.fillStyle=glow;ctx.fillRect(0,180,1280,540);
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.globalAlpha=p*.45;
    for(let i=0;i<3;i++){const r=150+i*65+(reducedMotion?0:Math.sin(t*1.3+i)*8);ctx.beginPath();ctx.ellipse(x,490,r,r*.48,0,0,Math.PI*2);ctx.stroke();}
    if(side<0){ctx.translate(x,490);ctx.scale(1,.48);star(ctx,0,0,220,reducedMotion?0:t*.2,p*.25);}
    ctx.restore();
  }
}
export function drawDomainClash(ctx,shot,t,reducedMotion,star){
  const p=shot.domainPower;if(!p)return;
  if(shot.postMashStruggle){drawOriginalStruggleDomains(ctx,shot,t,reducedMotion,star);return;}
  const border=shot.clashX??640;
  const pulse=shot.mashPulse||0,level=shot.mashThreshold||0;
  for(const [x,color,accent,side] of [[300,'#54bfff','#f2c66d',-1],[980,'#e32249','#120008',1]]){
    ctx.save();ctx.beginPath();ctx.rect(side<0?0:border,180,side<0?border:1280-border,540);ctx.clip();
    const glow=ctx.createRadialGradient(x,450,25,x,450,520);glow.addColorStop(0,color+'38');glow.addColorStop(1,color+'00');ctx.globalAlpha=p;ctx.fillStyle=glow;ctx.fillRect(0,180,1280,540);
    ctx.restore();ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=p*(.52+level*.1);
    for(let i=0;i<3;i++){
      const r=145+i*72+(reducedMotion?0:Math.sin(t*1.1+i)*6),spin=reducedMotion?0:t*(i%2?-.22:.16);
      ctx.save();ctx.translate(x,490);ctx.scale(1,.48);ctx.rotate(spin);ctx.lineWidth=(i===1?3:2)+pulse*2;
      ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
      for(let k=0;k<12;k++){const a=k*Math.PI/6,ri=r-9-(k%2)*5;ctx.beginPath();ctx.moveTo(Math.cos(a)*ri,Math.sin(a)*ri);ctx.lineTo(Math.cos(a)*(r+7),Math.sin(a)*(r+7));ctx.stroke();}
      ctx.restore();
    }
    if(side<0){ctx.save();ctx.translate(x,490);ctx.scale(1,.48);star(ctx,0,0,218,reducedMotion?0:t*.28,p*(.32+level*.08));ctx.restore();}
    else {ctx.save();ctx.translate(x,490);ctx.scale(1,.48);ctx.strokeStyle='#ff623d';ctx.lineWidth=4;ctx.globalAlpha=p*(.7-.35*(shot.mashProgress||0));
      const points=vinsonPentagramPoints(),length=5*Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
      ctx.setLineDash(p>=.999?[]:[length*p,length]);ctx.beginPath();points.forEach((point,i)=>{if(i)ctx.lineTo(point.x,point.y);else ctx.moveTo(point.x,point.y);});ctx.closePath();ctx.stroke();ctx.restore();}
    ctx.restore();
  }
  // Wavering seam, lifted floor fragments and bounded lightning make the two spaces collide.
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle='#fff3d0';ctx.shadowColor='#ffdfb4';ctx.shadowBlur=reducedMotion?0:14+10*pulse;ctx.lineWidth=3+level+pulse*3;
  ctx.beginPath();for(let i=0;i<=14;i++){const y=190+i*34,wave=reducedMotion?0:Math.sin(t*4+i*1.7)*(4+level*2);if(i)ctx.lineTo(border+wave,y);else ctx.moveTo(border+wave,y);}ctx.stroke();
  for(let i=0;i<3+level;i++){const y=265+i*85,a=Math.sin(t*2.7+i)*18;ctx.beginPath();ctx.moveTo(border-68,y+a);ctx.lineTo(border-18,y-12);ctx.lineTo(border+42,y+8-a*.3);ctx.stroke();}
  const sphere=22+(shot.mashProgress||0)*28+pulse*13;const energy=ctx.createRadialGradient(border,337,2,border,337,sphere);energy.addColorStop(0,'#fff');energy.addColorStop(.35,'#fff0b8');energy.addColorStop(1,'rgba(255,80,80,0)');ctx.fillStyle=energy;ctx.beginPath();ctx.arc(border,337,sphere,0,Math.PI*2);ctx.fill();ctx.restore();
  ctx.save();ctx.fillStyle='#b7a58a';ctx.globalAlpha=.55;for(let i=0;i<10;i++){const a=t*(reducedMotion?0:.35)+i*2.4,x=border+Math.cos(a)*(42+(i%3)*24),y=455+Math.sin(a*1.3)*55;ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.fillRect(-7,-3,14,6);ctx.restore();}ctx.restore();
}

export function drawClashHUD(ctx,shot,t,reducedMotion){
  if(!shot.interactiveClash)return;
  const p=clamp(shot.mashProgress),pulse=shot.mashPulse||0;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle='rgba(4,7,11,.86)';ctx.fillRect(340,76,600,82);
  ctx.strokeStyle='#f2ead7';ctx.lineWidth=2;ctx.strokeRect(385,126,510,14);
  ctx.fillStyle='#2f99db';ctx.fillRect(387,128,506*p,10);
  ctx.fillStyle='#9f1f33';ctx.fillRect(387+506*p,128,506*(1-p),10);
  ctx.fillStyle='#fff4cf';ctx.fillRect(385+506*p-2,123,4,20);
  const scale=reducedMotion?1:1+pulse*.08+.025*Math.sin(t*7);
  ctx.translate(640,102);ctx.scale(scale,scale);ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#fff4df';ctx.font='900 25px Impact,system-ui,sans-serif';ctx.fillText('MASH J / CLICK / TAP!',0,0);
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#c9c5bb';ctx.font='700 12px system-ui,sans-serif';ctx.textAlign='center';ctx.fillText('Hold J or hold the screen for accessible push',640,151);
  if(shot.mashThresholdAge<2.2){
    const lines=shot.mashThreshold===1?['CAPTAIN: HOLD THE LINE.','VINSON: YOU STILL CANNOT WIN.']:['CAPTAIN: FOR EVERYONE WE LOST.','VINSON: I ASSIGN YOUR END.'];
    ctx.fillStyle='#fff1d0';ctx.font='900 17px Impact,system-ui,sans-serif';ctx.fillText(lines[0],640,188);
    ctx.fillStyle='#ff8b91';ctx.fillText(lines[1],640,211);
  }
  ctx.restore();
}
export function drawThrownSword(ctx,shot,t,reducedMotion){
  const p=clamp(shot.throwSword);if(!p||shot.time>8.9)return;
  const x=365+615*p,y=330-120*Math.sin(p*Math.PI),rotation=Math.atan2(-120*Math.PI*Math.cos(p*Math.PI),615)-Math.PI/2;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);
  ctx.shadowColor='#def5ff';ctx.shadowBlur=reducedMotion?0:12;ctx.fillStyle='#d2e2e9';
  ctx.beginPath();ctx.moveTo(-7,-90);ctx.lineTo(7,-90);ctx.lineTo(5,-10);ctx.lineTo(0,12);ctx.lineTo(-5,-10);ctx.closePath();ctx.fill();
  ctx.fillStyle='#c4a05c';ctx.fillRect(-23,-98,46,8);ctx.fillStyle='#263647';ctx.fillRect(-5,-130,10,32);ctx.restore();
}
