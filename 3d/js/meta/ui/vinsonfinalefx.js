const clamp=n=>Math.max(0,Math.min(1,n));
const domainTiles=new Map();
function surface(key,size,paint){
  if(domainTiles.has(key))return domainTiles.get(key);
  try{const c=typeof OffscreenCanvas==='function'?new OffscreenCanvas(size,size):globalThis.document?.createElement('canvas');if(!c)return null;c.width=c.height=size;const g=c.getContext('2d');if(!g)return null;paint(g,size);domainTiles.set(key,c);return c;}catch{return null;}
}
function glow(ctx,x,y,r,color,alpha){
  const tile=surface('glow'+color,256,(g,n)=>{const gradient=g.createRadialGradient(n/2,n/2,0,n/2,n/2,n/2);gradient.addColorStop(0,color);gradient.addColorStop(1,color+'00');g.fillStyle=gradient;g.fillRect(0,0,n,n);});
  ctx.save();ctx.globalAlpha=alpha;if(tile)ctx.drawImage(tile,x-r,y-r,r*2,r*2);else{ctx.fillStyle=color;ctx.globalAlpha=alpha*.15;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}ctx.restore();
}
function cachedFloor(ctx,x,side,t,p,level,pulse,reducedMotion){
  const color=side<0?'#54bfff':'#e32249';
  // One compact atlas per side instead of six large transparent rotating surfaces.
  const tile=surface('floor-atlas'+side,384,g=>{g.translate(192,192);g.scale(.6,.6);g.strokeStyle=color;
    for(let i=0;i<3;i++){const r=145+i*72;g.lineWidth=i===1?3:2;g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.stroke();
      for(let k=0;k<12;k++){const a=k*Math.PI/6,ri=r-9-(k%2)*5;g.beginPath();g.moveTo(Math.cos(a)*ri,Math.sin(a)*ri);g.lineTo(Math.cos(a)*(r+7),Math.sin(a)*(r+7));g.stroke();}}});
  if(!tile)return false;
  ctx.save();ctx.translate(x,490);ctx.scale(1,.48);ctx.globalAlpha=p*(.52+level*.1+pulse*.12);ctx.rotate(reducedMotion?0:t*.16*side);ctx.drawImage(tile,-320,-320,640,640);ctx.restore();return true;
}
export function vinsonDomainWallX(y,shot,t,reducedMotion=false){
  const border=shot.clashX??640,pressure=((shot.mashProgress??.5)-.5)*72;
  const bend=-pressure*Math.min(1,((y-337)/360)**2);
  return border+bend+(reducedMotion?0:Math.sin(t*2.5+y*.025)*3);
}
function clipTerritory(ctx,side,shot,t,reducedMotion){
  const edge=side<0?0:1280;ctx.beginPath();ctx.moveTo(edge,0);
  for(let i=0;i<=18;i++){const y=i*40;ctx.lineTo(vinsonDomainWallX(y,shot,t,reducedMotion),y);}
  ctx.lineTo(edge,720);ctx.closePath();ctx.clip();
}
export function vinsonPentagramPoints(radius=210){return Array.from({length:5},(_,i)=>{const a=Math.PI/2+(i*2%5)*Math.PI*2/5;return {x:Math.cos(a)*radius,y:Math.sin(a)*radius};});}
function drawOriginalStruggleDomains(ctx,shot,t,reducedMotion,star){
  const p=shot.domainPower,border=shot.clashX??640;
  for(const [x,color,side] of [[300,'#73bdf6',-1],[980,'#e83855',1]]){
    ctx.save();ctx.beginPath();ctx.rect(side<0?0:border,180,side<0?border:1280-border,540);ctx.clip();
    glow(ctx,x,450,520,color,p*.22);
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
    ctx.save();clipTerritory(ctx,side,shot,t,reducedMotion);
    glow(ctx,x,450,520,color,p*.22);
    // A curved territorial wall gives each domain volume instead of a flat floor halo.
    ctx.strokeStyle=color;ctx.lineWidth=3;ctx.globalAlpha=p*.58;
    for(let j=0;j<3;j++){
      const radius=430+j*48,lean=reducedMotion?0:Math.sin(t*.7+j)*5;
      ctx.beginPath();ctx.ellipse(x+lean,490,radius,radius*.84,0,Math.PI,Math.PI*2);ctx.stroke();
    }
    ctx.globalAlpha=p*.32;ctx.lineWidth=2;
    for(let j=0;j<9;j++){
      const px=x-420+j*105,height=190+80*Math.sin(j*.8),flow=reducedMotion?0:Math.sin(t*1.1+j)*9;
      if(side<0){
        ctx.strokeStyle='#d8b76a';ctx.beginPath();ctx.moveTo(px,520);ctx.quadraticCurveTo(px+flow,350,px+flow*.5,520-height);ctx.stroke();
      }else{
        ctx.strokeStyle='#ff4051';ctx.beginPath();ctx.moveTo(px,520);ctx.lineTo(px-12+flow,480);ctx.lineTo(px+10+flow,440);ctx.lineTo(px-8,520-height);ctx.stroke();
      }
    }
    ctx.restore();ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=p*(.52+level*.1);
    if(!cachedFloor(ctx,x,side,t,p,level,pulse,reducedMotion))for(let i=0;i<3;i++){
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
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle='#fff3d0';ctx.shadowColor='#ffdfb4';ctx.shadowBlur=0;ctx.lineWidth=3+level+pulse*3;
  ctx.beginPath();for(let i=0;i<=14;i++){const y=190+i*34,wall=vinsonDomainWallX(y,shot,t,reducedMotion);if(i)ctx.lineTo(wall,y);else ctx.moveTo(wall,y);}ctx.stroke();
  for(let i=0;i<3+level;i++){const y=265+i*85,a=Math.sin(t*2.7+i)*18;ctx.beginPath();ctx.moveTo(border-68,y+a);ctx.lineTo(border-18,y-12);ctx.lineTo(border+42,y+8-a*.3);ctx.stroke();}
  const sphere=22+(shot.mashProgress||0)*28+pulse*13;glow(ctx,border,337,sphere,'#ffba5f',.28);ctx.restore();
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
  ctx.translate(640,102);ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#fff4df';ctx.font='900 25px Impact,system-ui,sans-serif';ctx.fillText(shot.clashStun>0?'STUNNED · VINSON PUSHES BACK':shot.clashMode==='warning'?'GET READY · KEY SEQUENCE IN '+shot.clashWarning.toFixed(1)+'s':shot.clashMode==='sequence'?'NOW · PRESS THE KEYS IN ORDER':'MASH J / CLICK / TAP · PUSH BACK',0,0);
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#c9c5bb';ctx.font='700 24px system-ui,sans-serif';ctx.textAlign='center';ctx.fillText(shot.clashMode==='push'?'Tap repeatedly. Holding alone cannot beat Vinson.':'Wrong sequence keys stun you. Attack spam is ignored.',640,158);
  if(shot.clashStun>0){ctx.fillStyle='#ff8a8a';ctx.font='900 28px monospace';ctx.fillText(shot.clashStun.toFixed(1)+'s',640,232);}
  else if(shot.clashRecovery>0){ctx.fillStyle='#bee8ff';ctx.font='900 25px monospace';ctx.fillText('PUSH!',640,232);}
  else if(['sequence','warning'].includes(shot.clashMode)){for(let i=0;i<(shot.clashKeys||[]).length;i++){const x=532+i*72;ctx.fillStyle=i<shot.clashKeyIndex?'#173c35':i===shot.clashKeyIndex?'#254457':'#141a22';ctx.fillRect(x-28,183,56,58);ctx.strokeStyle=i===shot.clashKeyIndex?'#d4f4ff':'#71818c';ctx.lineWidth=2;ctx.strokeRect(x-28,183,56,58);ctx.fillStyle=i<shot.clashKeyIndex?'#89ddba':'#ecf7ff';ctx.font='900 36px monospace';ctx.fillText(shot.clashKeys[i].toUpperCase(),x,214);}ctx.font='900 24px monospace';ctx.fillStyle='#ffb5a5';ctx.fillText(shot.clashMode==='warning'?'WAIT':(shot.clashTimeLeft||0).toFixed(1)+'s',812,214);}
  if(shot.mashThresholdAge<2.2){const captain=shot.mashThreshold===1;ctx.textAlign=captain?'left':'right';ctx.fillStyle=captain?'#d8f2ff':'#ff8b91';ctx.font='900 27px Impact,system-ui';ctx.fillText(captain?'FOR EVERYONE WE LOST.':'I ASSIGN YOUR END.',captain?55:1225,285);}

  ctx.restore();
}
export function drawThrownSword(ctx,shot,t,reducedMotion){
  const p=clamp(shot.throwSword);if(!p||shot.time>8.9)return;
  const x=365+615*p,y=330-120*Math.sin(p*Math.PI),rotation=Math.atan2(-120*Math.PI*Math.cos(p*Math.PI),615)-Math.PI/2;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);
  ctx.shadowColor='#def5ff';ctx.shadowBlur=0;ctx.fillStyle='#d2e2e9';
  ctx.beginPath();ctx.moveTo(-7,-90);ctx.lineTo(7,-90);ctx.lineTo(5,-10);ctx.lineTo(0,12);ctx.lineTo(-5,-10);ctx.closePath();ctx.fill();
  ctx.fillStyle='#c4a05c';ctx.fillRect(-23,-98,46,8);ctx.fillStyle='#263647';ctx.fillRect(-5,-130,10,32);ctx.restore();
}

export function warmVinsonDomains(){
  const tile=surface('warm',2,()=>{});if(tile)drawDomainClash(tile.getContext('2d'),{domainPower:1,clashX:640},0,true,()=>{});
}
