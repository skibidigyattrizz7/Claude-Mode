import {vinsonEarthPosition,vinsonBoxGap} from '../core/vinsonbattle.js?v=vinson31';
import {vinsonRenderCache} from './vinsonrendercache.js';
// Source-image pieces, bounded boss effects and readable challenge overlays.
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const mix=(a,b,p)=>a+(b-a)*p;
const ease=p=>{p=clamp(p);return p*p*(3-2*p);};
// Normalized contours follow the actual hands around the globe in world.webp.
export const WORLD_PIECES={
  left:{anchor:[.23,.61],points:[[.13,.78],[.13,.71],[.145,.64],[.145,.58],[.16,.54],[.155,.49],[.17,.46],[.20,.46],[.217,.43],[.219,.402],[.246,.389],[.285,.4],[.301,.423],[.298,.453],[.281,.481],[.307,.497],[.319,.526],[.302,.549],[.298,.576],[.28,.621],[.253,.66],[.219,.701],[.188,.767],[.168,.794]]},
  right:{anchor:[.715,.62],points:[[.548,.418],[.533,.403],[.552,.395],[.582,.413],[.62,.433],[.654,.455],[.658,.431],[.669,.413],[.70,.407],[.729,.423],[.744,.45],[.739,.483],[.776,.485],[.795,.51],[.787,.548],[.766,.572],[.798,.621],[.8,.67],[.776,.731],[.74,.792],[.716,.821],[.687,.798],[.688,.771],[.714,.731],[.715,.693],[.682,.711],[.659,.691],[.662,.655],[.69,.625],[.668,.574],[.653,.526],[.625,.504],[.597,.457]]},
  earth:{anchor:[.468,.609],radius:.172}
};
function trace(ctx,piece,w,h,ox=0,oy=0){
  if(piece.radius){ctx.moveTo(ox+(piece.anchor[0]+piece.radius)*w,oy+piece.anchor[1]*h);ctx.arc(ox+piece.anchor[0]*w,oy+piece.anchor[1]*h,piece.radius*w,0,Math.PI*2);return;}
  piece.points.forEach(([x,y],i)=>{const px=ox+x*w,py=oy+y*h;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();
}
export function maskWorldPieces(ctx,frame,hidden){
  ctx.beginPath();ctx.rect(-frame.dw/2,-frame.dh,frame.dw,frame.dh);
  for(const key of hidden)trace(ctx,WORLD_PIECES[key],frame.dw,frame.dh,-frame.dw/2,-frame.dh);
  ctx.clip('evenodd');
}
function piece(ctx,image,key,x,y,scale,rotation=0,alpha=1){
  if(!image?.complete||!image.naturalWidth)return;
  const p=WORLD_PIECES[key],crop=vinsonRenderCache.get(image,key,p);
  if(!crop)return;
  const drawScale=scale/crop.factor;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.scale(drawScale,drawScale);ctx.translate(-crop.anchorX,-crop.anchorY);
  ctx.globalAlpha=alpha;ctx.drawImage(crop.canvas,0,0,crop.width,crop.height);ctx.restore();
}
export function activeWorldPieces(hazards){
  const result=new Set();
  for(const h of hazards){if(h.type==='handslam')result.add(h.handKey||'left');if(h.type==='handcatch'){result.add('left');result.add('right');}if(h.type==='earththrow')result.add('earth');}
  return [...result];
}
export function drawSourceHands(ctx,h,state,image,t,reducedMotion=false){
  const b=state.boss,tele=clamp(h.elapsed/h.telegraph),active=clamp((h.elapsed-h.telegraph)/h.duration);
  const baseScale=240/(image?.naturalHeight||932),left={x:b.x-65,y:b.y-100},right={x:b.x+65,y:b.y-100};
  if(h.type==='handslam'){
    const key=h.handKey||'left',origin=key==='right'?right:left;
    const raised={x:mix(origin.x,h.x,ease(tele)),y:mix(origin.y,h.y-175,ease(tele))};
    const down=ease(active/.27),returning=ease((active-.58)/.42),x=mix(raised.x,origin.x,returning),y=mix(mix(raised.y,h.y,down),origin.y,returning);
    const scale=baseScale*(1+tele*.65)*(1-returning*.4);
    // The source fingers visibly leave Vinson, rise, strike and retract.
    ctx.save();ctx.globalAlpha=.18*(1-returning);ctx.fillStyle='#f33928';ctx.beginPath();ctx.ellipse(h.x,h.y,65+30*down,18+9*down,0,0,Math.PI*2);ctx.fill();ctx.restore();
    piece(ctx,image,key,x,y,scale,(key==='right'?-1:1)*(-.2+down*.36),1);
    if(active>.26&&active<.62){const p=(active-.26)/.36;ctx.save();ctx.strokeStyle='#ffad75';ctx.globalAlpha=(1-p)*.8;ctx.lineWidth=4*(1-p)+1;ctx.beginPath();ctx.ellipse(h.x,h.y,30+p*135,12+p*42,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
  }else if(h.type==='handcatch'){
    const c=h.corridor,cx=(c.x1+c.x2)/2,cy=c.y1,close=ease(active/.55),back=ease((active-.7)/.3);
    const spread=210*(1-close)+48,scale=baseScale*(1+tele*.38)*(1-back*.25);
    for(const [key,origin,side] of [['left',left,-1],['right',right,1]]){
      const staged={x:mix(origin.x,cx+side*285,ease(tele)),y:mix(origin.y,cy,ease(tele))};
      const x=mix(mix(staged.x,cx+side*spread,close),origin.x,back),y=mix(staged.y,origin.y,back);
      piece(ctx,image,key,x,y,scale,side*(.25-close*.3),1);
    }
  }
}
export function drawEarthThrow(ctx,h,state,image,t){
  const source=h.source||{x:state.boss.x,y:state.boss.y-96},target=h.target||{x:h.x,y:h.y};
  const tele=clamp(h.elapsed/h.telegraph),active=clamp((h.elapsed-h.telegraph)/h.duration),flying=h.elapsed>=h.telegraph;
  const {x,y}=vinsonEarthPosition({...h,source,target});
  const radius=h.radius||48,scale=(radius/(WORLD_PIECES.earth.radius*(image?.naturalWidth||1094)))* 1;
  ctx.save();ctx.strokeStyle='#f7904a';ctx.lineWidth=3;ctx.globalAlpha=flying?.8:.35;ctx.setLineDash(flying?[]:[10,12]);ctx.beginPath();ctx.arc(target.x,target.y,radius+15,0,Math.PI*2);ctx.stroke();ctx.restore();
  if(flying){ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle='#ff772b';ctx.lineWidth=radius*.9;ctx.globalAlpha=.13;ctx.beginPath();ctx.moveTo(x+(source.x-target.x)*.13,y+(source.y-target.y)*.13);ctx.lineTo(x,y);ctx.stroke();ctx.restore();}
  piece(ctx,image,'earth',x,y,scale,t*.9,.98);
}
export function drawDodgeBox(ctx,state,images,t,drawSprite,drawBeam){
  const b=state.box;if(!b)return;
  ctx.save();ctx.fillStyle='#02050bd9';ctx.fillRect(0,175,1280,545);
  ctx.fillStyle='#080d15';ctx.fillRect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY);
  ctx.strokeStyle='#ece8db';ctx.lineWidth=4;ctx.strokeRect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY);
  ctx.strokeStyle='#9c282b';ctx.lineWidth=1;ctx.strokeRect(b.minX-8,b.minY-8,b.maxX-b.minX+16,b.maxY-b.minY+16);
  ctx.fillStyle='#f5e9dc';ctx.font='bold 23px monospace';ctx.textAlign='center';ctx.fillText(`SURVIVE  ${Math.max(0,Math.ceil(b.duration-b.elapsed))}`,640,b.minY-20);
  ctx.font='14px monospace';ctx.fillStyle='#b5c5d0';ctx.fillText('MOVE / DODGE · NO ATTACKS IN THE BOX',640,b.maxY+28);
  if(b.preview){
    const preview=b.preview,gapPoint=vinsonBoxGap(b,preview),laneHeight=(b.maxY-b.minY)/5,laneWidth=(b.maxX-b.minX)/5;
    ctx.save();ctx.strokeStyle='#98bbcf';ctx.fillStyle='#aecddd';ctx.globalAlpha=.75;ctx.lineWidth=2;ctx.setLineDash([7,7]);
    if(preview.pattern==='vertical'){const x=gapPoint.x-laneWidth/2;ctx.strokeRect(x+8,b.minY+4,laneWidth-16,b.maxY-b.minY-8);}
    else if(preview.pattern==='radial'){
      // Point at the real escape gap: the skipped spokes are gap..gap+2 (core spawn), centred on gap+1.
      const x=(b.minX+b.maxX)/2,y=(b.minY+b.maxY)/2,mid=gapPoint.angle,half=gapPoint.half,r=Math.max(b.maxX-b.minX,b.maxY-b.minY);
      ctx.save();ctx.beginPath();ctx.rect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY);ctx.clip();
      ctx.fillStyle='#aecddd';ctx.globalAlpha=.16;ctx.beginPath();ctx.moveTo(x,y);ctx.arc(x,y,r,mid-half,mid+half);ctx.closePath();ctx.fill();
      ctx.globalAlpha=.75;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(mid-half)*r,y+Math.sin(mid-half)*r);ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(mid+half)*r,y+Math.sin(mid+half)*r);ctx.stroke();ctx.restore();}
    else{const y=gapPoint.y-laneHeight/2;ctx.strokeRect(b.minX+4,y+4,b.maxX-b.minX-8,laneHeight-8);}
    ctx.setLineDash([]);ctx.globalAlpha=1;ctx.strokeStyle='#d9f7ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(gapPoint.x,gapPoint.y,10,0,Math.PI*2);ctx.stroke();
    ctx.font='12px monospace';ctx.fillStyle='#d9f7ff';ctx.textAlign='center';ctx.fillText('NEXT MAIN WAVE GAP · DODGE AIMED SHOTS',640,b.maxY+46);
    ctx.restore();
  }
  ctx.beginPath();ctx.rect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY);ctx.clip();
  for(const p of b.bullets){
    const ready=(p.age||0)>=(p.telegraph||0);
    if(!ready){
      // Thin fixed aim guides, never a moving hitbox during the warning.
      const speed=Math.hypot(p.vx,p.vy)||1, length=p.kind==='aimed'?110:55;
      ctx.save();ctx.globalAlpha=.4;ctx.strokeStyle='#efb2a0';ctx.lineWidth=1.5;ctx.setLineDash([5,7]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+p.vx/speed*length,p.y+p.vy/speed*length);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#f8d7bb';ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();ctx.restore();continue;
    }
    if(p.kind==='beam'){
      drawBeam(ctx,p.x-(p.vx||0)*.065,p.y-(p.vy||0)*.065,p.x,p.y,'#ff514b',p.radius*1.6,.75);
    }else if(p.type==='laser'||p.type==='lane'){
      const ray=p.segment||p;drawBeam(ctx,ray.x1??p.x,ray.y1??b.minY,ray.x2??p.x,ray.y2??b.maxY,ready?'#ff3436':'#ba7976',ready?8:2,ready?.85:.35);
    }else{ctx.globalAlpha=1;ctx.fillStyle='#ffb4a0';ctx.beginPath();ctx.arc(p.x,p.y,p.radius||7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f7372e';ctx.globalAlpha=.2;ctx.beginPath();ctx.arc(p.x,p.y,(p.radius||7)*1.55,0,Math.PI*2);ctx.fill();}
  }
  ctx.shadowBlur=0;
  // Same source character at a smaller box scale, with a precise visible hurtbox.
  ctx.save();ctx.translate(state.hero.x,state.hero.y);ctx.scale(state.stage?.23:.32,state.stage?.23:.32);drawSprite(ctx,images[state.stage?'captain':'patel'],state.stage?'captain':'patel',0,0,t,state.hero.invulnerable>0?.55:1,true);ctx.restore();
  // Precise foot-level hurtbox: no blue ring or glowing disc over the actor.
  ctx.shadowBlur=0;ctx.strokeStyle='#f1e6ce';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(state.hero.x-4,state.hero.y);ctx.lineTo(state.hero.x+4,state.hero.y);ctx.moveTo(state.hero.x,state.hero.y-4);ctx.lineTo(state.hero.x,state.hero.y+4);ctx.stroke();ctx.restore();
}
export function drawTimingStrike(ctx,state,t){
  const m=state.timing;if(!m)return;
  const x=270,y=state.compact?380:500,w=740,marker=clamp(m.marker);
  ctx.save();ctx.fillStyle='#02050be6';ctx.fillRect(220,y-115,840,205);
  ctx.fillStyle='#edf0e8';ctx.font='bold 31px monospace';ctx.textAlign='center';ctx.fillText(m.resolved?(m.result||'STRIKE').toUpperCase():'TIME YOUR COUNTER',640,y-82);
  ctx.fillStyle='#b8c3c9';ctx.font='17px monospace';ctx.fillText(m.resolved?'The fight resumes…':'PRESS J / ENTER / ATTACK AT THE CENTER',640,y-45);
  ctx.fillStyle='#111923';ctx.fillRect(x,y,w,40);ctx.strokeStyle='#d6d8ce';ctx.lineWidth=2;ctx.strokeRect(x,y,w,40);
  ctx.fillStyle='#ae4e34';ctx.fillRect(x+w*.36,y,w*.28,40);ctx.fillStyle='#f1d980';ctx.fillRect(x+w*.455,y,w*.09,40);
  ctx.fillStyle='#f4f5e7';ctx.fillRect(x+w*.49,y,w*.02,40);ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x+w*marker,y-15);ctx.lineTo(x+w*marker,y+55);ctx.stroke();
  if(m.resolved){const p=clamp(m.elapsed-(m.resolvedAt||0));ctx.globalAlpha=1-p*.6;ctx.strokeStyle=m.result==='dodged'?'#ff7376':'#8ad7ff';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(620-p*160,y-120);ctx.lineTo(660+p*160,y-185);ctx.stroke();}
  ctx.restore();
}
export function drawClash(ctx,shot,t,reducedMotion,drawBeam,drawStar,eyePositions){
  const x=shot.clashX??640,y=337,power=shot.clashPower??shot.beams;
  const wiggle=reducedMotion?0:Math.sin(t*24)*power*5;
  for(const eye of eyePositions(shot.villain,980,470))drawBeam(ctx,eye.x,eye.y,x,y+wiggle,'#ff3426',10+power*12,shot.beams);
  for(const eye of eyePositions(shot.hero,300,470))drawBeam(ctx,eye.x,eye.y,x,y+wiggle,'#278cff',9+power*11,shot.beams);
  if(!(shot.hero==='captain'&&shot.domainPower))drawStar(ctx,x,y,25+power*27,reducedMotion?0:t*1.4,shot.beams);
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=shot.beams;ctx.strokeStyle='#ffedd3';ctx.lineWidth=2;
  for(let i=0;i<18;i++){const a=i*2.39996+(reducedMotion?0:t*.75),r=25+((t*140+i*17)%100)*power;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*r,y+Math.sin(a)*r);ctx.lineTo(x+Math.cos(a)*(r+12+power*22),y+Math.sin(a)*(r+12+power*22));ctx.stroke();}
  ctx.fillStyle='#fffbe9';ctx.beginPath();ctx.arc(x,y,shot.domainPower?5+power*9:8+power*19,0,Math.PI*2);ctx.fill();ctx.restore();
}
export function drawArrival(ctx,shot,t,reducedMotion,drawStar){
  if(!shot.arrival&&!shot.skyBeam&&!shot.arrivalStar)return;
  const x=300,y=465,alpha=shot.skyBeam||0;
  ctx.save();ctx.globalCompositeOperation='lighter';
  const light=ctx.createLinearGradient(x,-40,x,y);light.addColorStop(0,'#c5e6ff00');light.addColorStop(.65,'#79b9ff55');light.addColorStop(1,'#f8fcffe6');
  ctx.globalAlpha=alpha;ctx.fillStyle=light;ctx.beginPath();ctx.moveTo(x-18,-40);ctx.lineTo(x+18,-40);ctx.lineTo(x+115,y);ctx.lineTo(x-115,y);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#c7e6ff';ctx.lineWidth=2;for(let i=0;i<7;i++){const py=y-((t*110+i*73)%520);ctx.globalAlpha=alpha*(.3+i%3*.15);ctx.beginPath();ctx.moveTo(x-10-i*11,py);ctx.lineTo(x-10-i*11,py-35);ctx.stroke();}
  ctx.restore();
  ctx.save();ctx.translate(x,y);ctx.scale(1,.36);drawStar(ctx,0,0,75+20*(shot.arrivalStar||0),reducedMotion?0:(shot.arrivalSpin||0),shot.arrivalStar||0);ctx.restore();
  if(shot.arrival){drawStar(ctx,x,y-100,48, reducedMotion?0:-(shot.arrivalSpin||0)*.4,Math.sin(clamp(shot.arrival)*Math.PI)*.5);}
}
