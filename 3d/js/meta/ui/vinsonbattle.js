// Health, telegraphs, subtitles and four attacks share the same fixed-step encounter.
import { createVinsonBattle, battleEyePositions } from '../core/vinsonbattle.js?v=vinson21';
import { sampleVinsonCinematic } from './vinsoncinematic.js?v=8';
import { maskWorldPieces, activeWorldPieces, drawSourceHands, drawEarthThrow, drawDodgeBox, drawTimingStrike, drawClash, drawArrival } from './vinsonfightfx.js?v=8';
import { load } from '../core/storage.js';

const W = 1280, H = 720;
const asset = (name) => new URL(`../../../assets/vinson/${name === 'world' ? 'world-cutout.webp?v=6' : `${name}.webp`}`, import.meta.url).href;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const names = { patel: 'Israeli Forever Patel', captain: 'Captain Israel', world: 'World-Ruler Vinson', phonk: 'Phonk Mode Vinson' };
const heroArt = (stage) => stage ? 'captain' : 'patel';
const bossArt = (stage) => stage ? 'phonk' : 'world';
const ATTACK_NAMES = { laserline: 'RED LASER EYES', bombcircle: 'THE HUMBLE BOMB', painring: 'ASSIGNING PAIN' };

function node(tag, cls, text) {
  const el = document.createElement(tag); el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function beam(ctx, x1, y1, x2, y2, color, width = 5, alpha = 1, coreColor = '#fff6e8') {
  ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 22;
  ctx.lineWidth = width * 4; ctx.globalAlpha = alpha * .15;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.stroke();
  ctx.shadowBlur = 0; ctx.strokeStyle = coreColor; ctx.lineWidth = Math.max(1, width * .25); ctx.stroke(); ctx.restore();
}
function star(ctx, x, y, radius, angle, alpha = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#bbe8ff'; ctx.lineWidth = Math.max(2, radius * .025); ctx.shadowColor = '#46a5ff'; ctx.shadowBlur = 24;
  for (const offset of [0, Math.PI]) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + offset + i * Math.PI * 2 / 3;
      const px = Math.cos(a) * radius, py = Math.sin(a) * radius;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}
function impactRings(ctx,x,y,pulse,t,reducedMotion=false,color='#ffc5a0') {
  if(pulse<=0)return;
  const p=clamp(pulse,0,1),base=18+p*78;
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.strokeStyle=color;ctx.shadowColor=color;ctx.shadowBlur=18;ctx.lineWidth=2+4*p;
  for(let i=0;i<3;i++){const phase=clamp(pulse*1.35-i*.2,0,1);if(!phase)continue;ctx.globalAlpha=(1-phase)*.72;ctx.beginPath();ctx.ellipse(x,y,base*phase,base*.48*phase,0,0,Math.PI*2);ctx.stroke();}
  ctx.globalAlpha=.55*p;ctx.lineWidth=1.5;for(let i=0;i<8;i++){const a=i*Math.PI/4+(reducedMotion?0:t*.18),r=base*(.72+(i%3)*.15);ctx.beginPath();ctx.moveTo(x+Math.cos(a)*r,y+Math.sin(a)*r);ctx.lineTo(x+Math.cos(a)*(r+12+4*p),y+Math.sin(a)*(r+12+4*p));ctx.stroke();}
  ctx.restore();
}
function renderHandSlam(ctx,h,t,reducedMotion) {
  const phase=clamp(h.elapsed/h.telegraph,0,1),active=clamp((h.elapsed-h.telegraph)/Math.max(.01,h.duration),0,1),radius=h.radius||112;
  const warningAlpha=active>0?Math.max(0,1-active*5):1;
  if(warningAlpha>0){
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=warningAlpha*(.1+.12*(reducedMotion?1:.5+.5*Math.sin(h.elapsed*8)));ctx.fillStyle='#ff3328';ctx.beginPath();ctx.ellipse(h.x,h.y,radius*(.9+.15*phase),radius*.4,0,0,Math.PI*2);ctx.fill();ctx.restore();
  ctx.save();ctx.strokeStyle='#ff5a50';ctx.globalAlpha=.9*warningAlpha;ctx.lineWidth=4;ctx.setLineDash([13,9]);ctx.beginPath();ctx.arc(h.x,h.y,radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(h.x-radius*.24,h.y);ctx.lineTo(h.x+radius*.24,h.y);ctx.moveTo(h.x,h.y-radius*.24);ctx.lineTo(h.x,h.y+radius*.24);ctx.stroke();ctx.restore();
  }
  if(active>0){const p=clamp(active*2.8,0,1)*(1-clamp((active-.35)*1.8,0,1));impactRings(ctx,h.x,h.y,p,t,reducedMotion,'#ff876d');ctx.save();ctx.globalAlpha=.65*p;ctx.fillStyle='#c95b46';for(let i=0;i<12;i++){const a=i*Math.PI/6+(reducedMotion?0:t*.12),r=radius*(.38+(i%3)*.12);ctx.fillRect(h.x+Math.cos(a)*r,h.y+Math.sin(a)*r,4,4);}ctx.restore();}
}
function renderHandCatch(ctx,h,t,reducedMotion) {
  const c=h.corridor||{x1:h.x1??80,y1:h.y1??420,x2:h.x2??1200,y2:h.y2??420,width:h.width??150};
  const dx=c.x2-c.x1,dy=c.y2-c.y1,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,cx=(c.x1+c.x2)/2,cy=(c.y1+c.y2)/2;
  const w=c.width||150,tele=clamp(h.elapsed/h.telegraph,0,1),close=clamp((h.elapsed-h.telegraph)/Math.max(.01,h.duration),0,1);
  // Mark the dangerous corridor while leaving the perpendicular exits conspicuously open.
  ctx.save();ctx.globalAlpha=.12+.12*tele;ctx.fillStyle='#ff251e';ctx.beginPath();ctx.moveTo(c.x1-uy*w/2,c.y1+ux*w/2);ctx.lineTo(c.x2-uy*w/2,c.y2+ux*w/2);ctx.lineTo(c.x2+uy*w/2,c.y2-ux*w/2);ctx.lineTo(c.x1+uy*w/2,c.y1-ux*w/2);ctx.closePath();ctx.fill();ctx.restore();
  ctx.save();ctx.strokeStyle='#ff6458';ctx.lineWidth=3;ctx.setLineDash([14,10]);for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(c.x1-uy*w*.5*side,c.y1+ux*w*.5*side);ctx.lineTo(c.x2-uy*w*.5*side,c.y2+ux*w*.5*side);ctx.stroke();}ctx.restore();
  ctx.save();ctx.globalAlpha=.8;ctx.fillStyle='#ffe3a5';ctx.font='bold 15px monospace';ctx.textAlign='center';ctx.fillText('DODGE ABOVE / BELOW THE RED LANE',cx,Math.max(170,cy-w*.58));ctx.textAlign='start';ctx.restore();
  if(close>.65)impactRings(ctx,cx,cy,clamp((close-.65)*2.8,0,1),t,reducedMotion,'#ff715e');
}
function laserRay(ctx,ray,t,ready,alpha) {
  if(!ready){beam(ctx,ray.x1,ray.y1,ray.x2,ray.y2,'#ff725f',3,alpha*.32);ctx.save();ctx.globalAlpha=.85;ctx.strokeStyle='#ffc0a6';ctx.setLineDash([15,12]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(ray.x1,ray.y1);ctx.lineTo(ray.x2,ray.y2);ctx.stroke();ctx.restore();return;}
  beam(ctx,ray.x1,ray.y1,ray.x2,ray.y2,'#fb291f',8,alpha,'#ff9680');
  const dx=ray.x2-ray.x1,dy=ray.y2-ray.y1;
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(let i=0;i<3;i++){const p=((t*(1.25+i*.22)+i/3)%1),x=ray.x1+dx*p,y=ray.y1+dy*p,r=4+(i%2)*2;ctx.globalAlpha=alpha*(.65-i*.12);ctx.shadowColor='#ff2d22';ctx.shadowBlur=18;ctx.fillStyle='#fff0d8';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=alpha*.8;ctx.strokeStyle='#ffbca4';ctx.lineWidth=2;for(let i=0;i<4;i++){const p=((t*1.7+i*.257)%1),x=ray.x1+dx*p,y=ray.y1+dy*p;ctx.beginPath();ctx.moveTo(x-7,y-3);ctx.lineTo(x+7,y+3);ctx.stroke();}
  ctx.restore();
}
// Frame only unused matte, keeping the full face, hands and planet in the source image.
export function vinsonSpriteFrame(key, sourceWidth, sourceHeight) {
  const rect=key==='patel'?[0,.23,1,.77]:[0,0,1,1];
  const width=key==='world'?292:key==='phonk'?230:key==='patel'?182:260;
  const height=key==='world'?240:key==='phonk'?240:key==='captain'?190:175;
  const [rx,ry,rw,rh]=rect, sw=sourceWidth*rw,sh=sourceHeight*rh;
  const scale=Math.min(width/sw,height/sh);
  return {sx:sourceWidth*rx,sy:sourceHeight*ry,sw,sh,dw:sw*scale,dh:sh*scale,width,height};
}
const matteCache=new WeakMap();
// Remove only near-white pixels connected to the outside. White teeth/eye effects stay intact.
export function removeVinsonMatte(pixels,width,height) {
  const seen=new Uint8Array(width*height),queue=new Uint32Array(width*height);let read=0,write=0;
  const add=(i)=>{
    if(seen[i])return;seen[i]=1;const p=i*4;
    if(Math.min(pixels[p],pixels[p+1],pixels[p+2])<220)return;
    queue[write++]=i;
  };
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}
  for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
  while(read<write){const i=queue[read++],x=i%width,y=Math.floor(i/width);pixels[i*4+3]=0;
    if(x)add(i-1);if(x+1<width)add(i+1);if(y)add(i-width);if(y+1<height)add(i+width);
  }
  return pixels;
}
function battlePortrait(image,key) {
  if(!['world','phonk','captain','patel'].includes(key))return image;
  if(matteCache.has(image))return matteCache.get(image);
  // World uses an authored transparent cutout. Threshold flood fills erased her
  // black hair, blindfold and clothing because those details touch the backdrop.
  if(key==='world'){matteCache.set(image,image);return image;}
  let art=image;
  try {
    const canvas=document.createElement('canvas'),scale=Math.min(1,512/image.naturalHeight);
    canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const c=canvas.getContext('2d',{willReadFrequently:true});
    c.drawImage(image,0,0,canvas.width,canvas.height);
    const pixels=c.getImageData(0,0,canvas.width,canvas.height);
    if(key!=='patel')removeVinsonMatte(pixels.data,canvas.width,canvas.height);
    else {for(let y=Math.floor(canvas.height*.84);y<canvas.height;y++){const fade=clamp((canvas.height-y)/(canvas.height*.16),0,1);for(let x=0;x<canvas.width;x++)pixels.data[(y*canvas.width+x)*4+3]*=fade*fade;}}
    c.putImageData(pixels,0,0);art=canvas;
  }catch{/* Readback unsupported: the original remains visible. */}
  matteCache.set(image,art);return art;
}
function sprite(ctx, image, key, x, y, t, alpha = 1, moving = false, hiddenPieces = []) {
  if (alpha <= 0) return;
  const frame=vinsonSpriteFrame(key,image?.naturalWidth||1,image?.naturalHeight||1);
  const {width,height}=frame;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = '#020a09'; ctx.beginPath(); ctx.ellipse(x, y + 12, width * .42, 14, 0, 0, Math.PI * 2); ctx.fill();
  if(key==='patel'){ctx.save();ctx.strokeStyle='#4a9ed5';ctx.globalAlpha=.28;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y+4,width*.33,10,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
  const bob = moving ? Math.sin(t * 15) * 4 : Math.sin(t * 2) * 2;
  ctx.translate(x, y + bob); ctx.rotate(moving ? Math.sin(t * 7.5) * .035 : 0);
  if (image?.complete && image.naturalWidth) {
    const art=battlePortrait(image,key);
    const {sx,sy,sw,sh,dw,dh}=vinsonSpriteFrame(key,art.naturalWidth||art.width,art.naturalHeight||art.height);
    ctx.globalCompositeOperation='source-over';
    if(key==='world'||key==='phonk'){
      ctx.shadowColor='#ff5148';ctx.shadowBlur=18;
    }
    if(key==='patel'){
      // Frame the original knight silhouette rather than its rectangular poster background.
      const contour=[[.42,.012],[.50,0],[.565,.03],[.59,.09],[.592,.17],[.577,.23],[.62,.29],[.70,.32],[.79,.40],[.87,.50],[.94,.70],[1,1],[0,1],[.115,.76],[.15,.48],[.29,.31],[.40,.285],[.38,.23],[.35,.13],[.36,.07]];
      ctx.beginPath();contour.forEach(([x,y],i)=>{const px=-dw/2+x*dw,py=-dh+y*dh;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);});ctx.closePath();ctx.clip();
    }
    if(key==='world'&&hiddenPieces.length)maskWorldPieces(ctx,{dw,dh},hiddenPieces);
    ctx.drawImage(art,sx,sy,sw,sh,-dw/2,-dh,dw,dh);
  } else {
    ctx.fillStyle = key === 'world' || key === 'phonk' ? '#871c20' : '#1c567e';
    ctx.fillRect(-width * .25, -height * .7, width * .5, height * .7);
    ctx.beginPath(); ctx.arc(0, -height * .75, 23, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function field(ctx,t,stage=0) {
  ctx.fillStyle=stage?'#130406':'#090b10';ctx.fillRect(0,0,W,H);
  const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#020305');sky.addColorStop(.6,stage?'#421018':'#242229');sky.addColorStop(1,'#060709');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
  // Broken columns frame the fighters, leaving the combat lanes unobstructed.
  for(let i=0;i<9;i++){
    const x=i*165-28,h=180+(i*97%130);ctx.fillStyle=i%2?'#121318':'#1c1920';
    ctx.beginPath();ctx.moveTo(x,420);ctx.lineTo(x,420-h);ctx.lineTo(x+29,420-h-12);ctx.lineTo(x+37,420-h+28);ctx.lineTo(x+64,420-h+18);ctx.lineTo(x+69,420);ctx.closePath();ctx.fill();
    ctx.fillStyle='#40313a';ctx.fillRect(x+8,420-h+40,3,h-40);
  }
  ctx.fillStyle='#0a090d';ctx.beginPath();ctx.moveTo(0,250);ctx.lineTo(W,250);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#44323a';ctx.lineWidth=1;
  for(let i=-6;i<14;i++){ctx.beginPath();ctx.moveTo(640+i*80,250);ctx.lineTo(640+i*200,H);ctx.stroke();}
  for(let i=0;i<7;i++){const y=250+Math.pow(i/6,1.7)*470;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  // Smouldering seams and slow airborne embers give depth without covering attack warnings.
  for(let i=0;i<24;i++){
    const x=(i*137+t*(4+i%3))%W,y=120+(i*71+t*(2+i%4))%520;
    ctx.fillStyle=stage?'#d34b3655':'#92645833';ctx.fillRect(x,y,2+i%2,2);
  }
  ctx.fillStyle=stage?'#96233118':'#61535c14';ctx.beginPath();ctx.ellipse(990,445,155,38,0,0,Math.PI*2);ctx.fill();
}
function health(ctx, s) {
  const bar = (x, actor, label, color) => {
    ctx.fillStyle = '#040809cc'; ctx.fillRect(x, 93, 380, 48);
    ctx.fillStyle = '#f4eee4'; ctx.font = 'bold 17px monospace'; ctx.fillText(label.toUpperCase(), x + 12, 112);
    ctx.fillStyle = '#34413b'; ctx.fillRect(x + 12, 121, 356, 7);
    ctx.fillStyle = color; ctx.fillRect(x + 12, 121, 356 * actor.hp / actor.maxHp, 7);
  };
  bar(80, s.hero, names[heroArt(s.stage)], '#88beed'); bar(820, s.boss, names[bossArt(s.stage)], '#d73d35');
}
function shieldAndSword(ctx, shot) {
  if (!shot.shield) return;
  ctx.save(); ctx.globalAlpha = shot.shield; ctx.translate(640, 510);
  ctx.scale(1, .35); ctx.fillStyle = '#7895a2'; ctx.strokeStyle = '#d7dde1'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(0, 0, 84, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#bd3935'; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(0, 0, 64, 0, Math.PI * 2); ctx.stroke(); star(ctx, 0, 0, 45, 0);
  ctx.strokeStyle = '#071015'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-16, -77); ctx.lineTo(9, -28); ctx.lineTo(-6, 0); ctx.lineTo(24, 33); ctx.lineTo(15, 78); ctx.stroke(); ctx.restore();
  if (!shot.sword) return;
  const p = shot.sword, fall = p * p, y = -360 + 790 * fall;
  ctx.save(); ctx.translate(645, Math.min(y, 430)); ctx.rotate(-.08);
  ctx.fillStyle = '#bdcbd3'; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(8, 0); ctx.lineTo(3, 122); ctx.lineTo(0, 150); ctx.lineTo(-6, 118); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b79b52'; ctx.fillRect(-31, -8, 62, 11); ctx.fillStyle = '#394855'; ctx.fillRect(-6, -48, 12, 40); ctx.restore();
}

/** Isolated render function for the arena, actors and smooth cinematics. */
export function drawVinsonBattle(ctx, state, images, t, { shot = null, camera = null, particles = [], trauma = 0, reducedMotion = false, visualHero = state.hero } = {}) {
  ctx.save(); ctx.clearRect(0, 0, W, H);
  const shake = reducedMotion ? 0 : trauma * trauma;
  const zoom = reducedMotion ? 1 : (camera?.zoom??shot?.zoom??1), focusX=reducedMotion?W/2:(camera?.x??shot?.focusX??W/2),focusY=reducedMotion?H/2:(camera?.y??shot?.focusY??H/2);
  ctx.translate(W / 2 - focusX*zoom + Math.sin(t * 31) * shake * 12, H / 2 - focusY*zoom + Math.sin(t * 43) * shake * 7);
  ctx.scale(zoom, zoom);
  field(ctx, t, shot?.villain==='phonk'?1:state.stage);
  if (!shot) {
    for (const h of state.hazards) {
      const ready = h.elapsed >= h.telegraph;
      const alpha = ready ? .95 : .28 + .18 * Math.sin(h.elapsed * 7);
      if(h.type==='handslam') { renderHandSlam(ctx,h,t,reducedMotion); }
      else if(h.type==='handcatch') { renderHandCatch(ctx,h,t,reducedMotion); }
      else if(h.type==='earththrow') { /* Draw source planet above its launch body. */ }
      else if (h.type === 'laserline') {
        const segments=h.segments||[];
        for(const ray of segments)laserRay(ctx,ray,t,ready,alpha);
      } else {
        const radius = h.type === 'bombcircle' ? h.radius : ready ? 30 + (h.elapsed - h.telegraph) * h.ringMax / h.duration : 30;
        ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = '#f76b50'; ctx.lineWidth = ready ? 9 : 3;
        ctx.beginPath(); ctx.arc(h.x, h.y, radius, 0, Math.PI * 2); ctx.stroke();
        if (h.type === 'bombcircle') { ctx.fillStyle = ready ? '#ff493551' : '#ed423121'; ctx.fill(); }
        ctx.restore();
      }
    }
    sprite(ctx, images[heroArt(state.stage)], heroArt(state.stage), visualHero.x, visualHero.y, t,
      state.hero.invulnerable > 0 ? .65 + .25*Math.sin(t*14) : 1, visualHero.moving);
    sprite(ctx, images[bossArt(state.stage)], bossArt(state.stage), state.boss.x, state.boss.y, t,1,true,activeWorldPieces(state.hazards));
    for(const h of state.hazards){
      if(h.type==='handslam'||h.type==='handcatch')drawSourceHands(ctx,h,state,images.world,t,reducedMotion);
      if(h.type==='earththrow')drawEarthThrow(ctx,h,state,images.world,t);
    }
    for(const h of state.hazards.filter(h=>h.type==='laserline'))for(const eye of (h.origins||[])) {
      const charged=clamp(h.elapsed/h.telegraph,0,1),flicker=reducedMotion?1:.82+.18*Math.sin(t*20+eye.x);
      ctx.save();ctx.globalCompositeOperation='lighter';ctx.shadowColor='#ff1e24';ctx.shadowBlur=14+charged*26;ctx.strokeStyle='#ff5c4b';ctx.globalAlpha=.3+charged*.5;ctx.lineWidth=2+charged*3;ctx.beginPath();ctx.arc(eye.x,eye.y,7+charged*9,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ff8170';ctx.globalAlpha=flicker;ctx.beginPath();ctx.arc(eye.x,eye.y,3+charged*3,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#ffb3a0';ctx.globalAlpha=.45+charged*.45;ctx.lineWidth=1.5;for(let i=0;i<4;i++){const a=i*Math.PI/2+(reducedMotion?0:t*.25);ctx.beginPath();ctx.moveTo(eye.x+Math.cos(a)*(10+charged*8),eye.y+Math.sin(a)*(10+charged*8));ctx.lineTo(eye.x+Math.cos(a)*(18+charged*18),eye.y+Math.sin(a)*(18+charged*18));ctx.stroke();}ctx.restore();
    }
    for (const p of state.projectiles) {
      if(p.effect==='returningShield'){
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(t*8);ctx.scale(1,.65);
        ctx.fillStyle='#18374e';ctx.strokeStyle='#c1e8ff';ctx.lineWidth=3;ctx.shadowColor='#70caff';ctx.shadowBlur=16;
        ctx.beginPath();ctx.arc(0,0,27,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.strokeStyle='#718faa';ctx.lineWidth=6;ctx.beginPath();ctx.arc(0,0,20,0,Math.PI*2);ctx.stroke();star(ctx,0,0,16,0);ctx.restore();
        beam(ctx,p.x-p.vx*.05,p.y-p.vy*.05,p.x,p.y,'#4dbdff',3,.45);continue;
      }
      if(p.effect==='groundShockwave'){
        const r=p.waveRadius||p.radius||30;ctx.save();ctx.strokeStyle='#a9dfff';ctx.lineWidth=5;ctx.shadowColor='#438fff';ctx.shadowBlur=16;ctx.globalAlpha=.8;
        ctx.beginPath();ctx.ellipse(p.x,p.y,r,r*.55,0,0,Math.PI*2);ctx.stroke();
        for(let i=0;i<12;i++){const a=i*Math.PI/6;ctx.beginPath();ctx.moveTo(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r*.55);ctx.lineTo(p.x+Math.cos(a)*(r+12),p.y+Math.sin(a)*(r+12)*.55);ctx.stroke();}ctx.restore();continue;
      }
      const rotation=p.type==='spinner'?t*10:Math.atan2(p.vy,p.vx)+t*.6;
      if(p.type==='eyes') {
        if(p.effect==='chargedEyeLance'){ctx.save();ctx.globalAlpha=.45;ctx.strokeStyle='#a0d8ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,22+Math.sin(t*10)*4,0,Math.PI*2);ctx.stroke();ctx.restore();}
        for(const eye of battleEyePositions(heroArt(state.stage),visualHero.x,visualHero.y))beam(ctx,eye.x,eye.y,p.x,p.y,'#168cff',p.effect==='chargedEyeLance'?8:3.5,.82,'#a8dcff');
      } else if(p.type==='spinner') {
        for(let i=1;i<=3;i++)star(ctx,p.x-p.vx*.018*i,p.y-p.vy*.018*i,18,rotation-i*.24,.18/i);
      } else if(p.type==='explosive') {
        ctx.save();ctx.fillStyle='#f7bf3820';ctx.beginPath();ctx.arc(p.x,p.y,28+Math.sin(t*12)*4,0,Math.PI*2);ctx.fill();ctx.restore();
      }
      star(ctx,p.x,p.y,p.type==='explosive'?23:p.type==='spinner'?20:16,rotation);
    }
  } else {
    sprite(ctx, images[shot.hero], shot.hero, 300, 470, t, shot.heroAlpha);
    sprite(ctx, images[shot.villain], shot.villain, 980, 470, t, shot.villainAlpha);
    drawArrival(ctx,shot,t,reducedMotion,star);
    if (shot.beams > 0) {
      drawClash(ctx,shot,t,reducedMotion,beam,star,battleEyePositions);
      if(shot.star&&shot.hero==='captain')star(ctx,shot.clashX??640,337,24+shot.star**3*850,reducedMotion?0:t*.85,shot.beams);
    }
    if(shot.impact>0)impactRings(ctx,shot.clashX??640,337,shot.impact,t,reducedMotion,'#ffd0ad');
    if(shot.star>0&&shot.hero==='captain'&&shot.time<11){
      // Fine speed lines make the finishing star feel fast without flashing the whole frame.
      ctx.save();ctx.globalAlpha=.2+.3*shot.star;ctx.strokeStyle='#ffe0ad';ctx.lineWidth=2;
      for(let i=0;i<12;i++){const y=215+i*30+(reducedMotion?0:(t*210+i*23)%32);ctx.beginPath();ctx.moveTo(790+i%4*22,y);ctx.lineTo(900+i%4*22,y-5);ctx.stroke();}ctx.restore();
    }
    shieldAndSword(ctx, shot);
  }
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1); ctx.fillStyle = p.color;
    if(p.kind==='blast'){ctx.strokeStyle='#ffc171';ctx.lineWidth=5*p.life/p.maxLife;ctx.beginPath();ctx.arc(p.x,p.y,(1-p.life/p.maxLife)*100,0,Math.PI*2);ctx.stroke();star(ctx,p.x,p.y,20+(1-p.life/p.maxLife)*60,t*2,p.life/p.maxLife);}
    else ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.restore(); ctx.globalAlpha = 1;
  if (!shot && ['fight','dodgebox','timing'].includes(state.phase)) {
    if(state.phase==='dodgebox')drawDodgeBox(ctx,state,images,t,sprite,beam);
    if(state.phase==='timing')drawTimingStrike(ctx,state,t);
    health(ctx,state);
  }
  if (shot) {
    ctx.fillStyle = '#020304'; ctx.fillRect(0, 0, W, 55); ctx.fillRect(0, H - 55, W, 55);
    if (shot.white) { ctx.fillStyle = `rgba(255,251,235,${shot.white})`; ctx.fillRect(0, 0, W, H); }
    if (shot.black) { ctx.fillStyle = `rgba(0,0,0,${shot.black})`; ctx.fillRect(0, 0, W, H); }
  }
}

/** One canvas, one RAF, one fixed-step clock. The account API owns win/reward authority. */
// Migration 021 admits Vinson-banned accounts for battle calls without owner release.
export async function registerVinsonBattleAttempt(online) {
  return online.vinson.battleStart();
}

export function launchVinsonBattle({ parent = document.body, online, onWin, onClaim, onClose, resumeRewards = false, seed = 1, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  if (document.querySelector('.vb-screen')) return null;
  const link = node('link', ''); link.rel = 'stylesheet'; link.href = new URL('../../../css/vinsonbattle.css?v=20', import.meta.url).href; document.head.append(link);
  const screen = node('section', 'vb-screen'); screen.setAttribute('role', 'dialog'); screen.setAttribute('aria-modal', 'true'); screen.setAttribute('aria-label', 'Fight Suppression');
  const stage = node('div', 'vb-stage'), canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  canvas.setAttribute('aria-label', 'Move to dodge the marked attacks, attack Vinson, and dodge with Space.'); stage.append(canvas);
  const top = node('div', 'vb-top'); top.append(node('strong', 'vb-title', 'FIGHT SUPPRESSION'));
  const closeButton = node('button', '', 'Return to Pitchside'); closeButton.onclick = close; top.append(closeButton); stage.append(top);
  const panel = node('div', 'vb-panel'), subtitle = node('div', 'vb-subtitle'); stage.append(panel, subtitle);
  const conversation=node('button','vb-dialogue');conversation.type='button';conversation.hidden=true;
  conversation.setAttribute('aria-label','Advance dialogue');
  const portrait=node('canvas','vb-dialogue-portrait');portrait.width=120;portrait.height=130;portrait.setAttribute('aria-hidden','true');
  const dialogueBody=node('div','vb-dialogue-body'),speakerLabel=node('strong','vb-dialogue-speaker'),lineText=node('p','vb-dialogue-line'),continueHint=node('span','vb-dialogue-continue','Click or press Enter');
  dialogueBody.append(speakerLabel,lineText,continueHint);conversation.append(portrait,dialogueBody);stage.append(conversation);
  conversation.onclick=advanceDialogue;
  const controls = node('div', 'vb-controls'); controls.append(node('span', 'vb-hint', 'WASD / arrows: move · J: attack · Q/E: ability · Space: dodge · H: heal'));
  let selectedWeapon='star';
  const weapons=node('div','vb-weapons');weapons.setAttribute('aria-label','Attack type');
  const weaponButtons=[];
  for(const [i,type,label] of [[1,'star','Star'],[2,'spinner','Spinning star'],[3,'explosive','Explosive star'],[4,'eyes','Eye lasers']]) {
    const b=node('button',type==='star'?'on':'',label);b.setAttribute('aria-pressed',type==='star'?'true':'false');
    b.onclick=()=>{if(!blockingDialogue)selectWeapon(type)};weaponButtons.push({b,type,i});weapons.append(b);
  }
  function selectWeapon(type){selectedWeapon=type;for(const item of weaponButtons){item.b.className=item.type===type?'on':'';item.b.setAttribute('aria-pressed',item.type===type?'true':'false');}}
  controls.append(weapons);
  const touch = node('div', 'vb-touch'); controls.append(touch);
  const buttons = [['left','←'],['up','↑'],['down','↓'],['right','→'],['dodge','Dodge'],['heal','Heal ×3'],['attack','Attack']];
  for (const [action, label] of buttons) {
    const b = node('button', '', label); b.dataset.action = action; b.setAttribute('aria-label', label);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); if(blockingDialogue){advanceDialogue();return;} held.add(action); b.setPointerCapture(e.pointerId); });
    for (const evt of ['pointerup','pointercancel','lostpointercapture']) b.addEventListener(evt, () => held.delete(action));
    touch.append(b);
  }
  screen.append(stage, controls); parent.append(screen);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    panel.append(node('h2', '', 'Canvas unavailable'), node('p', '', 'Return to Pitchside and try another browser.'));
    let exited = false;
    const exit = () => { if (exited) return; exited = true; screen.remove(); link.remove(); onClose?.(); };
    closeButton.onclick = exit; return { close: exit };
  }
  const compactArena=Number(globalThis.innerHeight)>0&&globalThis.innerHeight<=450;
  let battle = createVinsonBattle({ seed, compact:compactArena }), raf = 0, last = 0, clock = 0, accumulator = 0, closed = false;
  let mode = '', cinematicKind = '', cinematicTime = 0, trauma = 0, particles = [], nonce = null, victoryBusy = false, victoryConfirmed = false;
  let dialogue=null,lastDialogue=-10;
  const barkLast=new Map(),barkCount=new Map();
  let blockingDialogue=null,dialogueQueue=[],dialogueComplete=null;
  const acknowledgedDialogue=new Set();
  let camera={zoom:1,x:640,y:360};
  let audio = null, muted = false, viewHero = { x: 250, y: 425 }, oldFocus = document.activeElement;
  const held = new Set(), keys = new Set(), images = {};
  const originalOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';
  for (const key of ['patel','captain','world','phonk']) { const img = new Image(); img.src = asset(key); images[key] = img; void img.decode().catch(() => {}); }
  const mute = node('button', '', 'Sound on'); mute.onclick = () => { muted = !muted; mute.textContent = muted ? 'Sound off' : 'Sound on'; }; top.insertBefore(mute, closeButton);
  function say(speaker,text,key='generic') {
    if(blockingDialogue||clock-(barkLast.get(key)??-20)<10)return;
    barkLast.set(key,clock);dialogue={speaker,text,until:clock+2.6};lastDialogue=clock;
  }
  function showDialogue(lines,onComplete=null){
    dialogueQueue=lines.slice();dialogueComplete=onComplete;dialogue=null;subtitle.replaceChildren();
    held.clear();keys.clear();controls.classList.add('vb-controls-paused');nextDialogue();
  }
  function nextDialogue(){
    const line=dialogueQueue.shift();
    if(!line){blockingDialogue=null;conversation.hidden=true;controls.classList.remove('vb-controls-paused');const done=dialogueComplete;dialogueComplete=null;done?.();return;}
    blockingDialogue={...line,started:clock,revealed:reducedMotion};
    speakerLabel.textContent=line.speaker;portrait.dataset.actor=line.actor;portrait.dataset.painted='';paintDialoguePortrait();
    conversation.dataset.side=['world','phonk'].includes(line.actor)?'boss':'hero';
    lineText.textContent=reducedMotion?line.text:'';continueHint.textContent=reducedMotion?'Continue · Enter':'Click to reveal';
    conversation.hidden=false;conversation.focus();
  }
  function advanceDialogue(){
    if(!blockingDialogue)return;
    if(!blockingDialogue.revealed){blockingDialogue.revealed=true;lineText.textContent=blockingDialogue.text;continueHint.textContent='Continue · Enter';return;}
    nextDialogue();
  }
  function paintDialoguePortrait(){
    const key=portrait.dataset.actor,img=images[key];if(!img?.complete||!img.naturalWidth||portrait.dataset.painted===key)return;
    const context=portrait.getContext('2d');if(!context)return;
    const art=battlePortrait(img,key),w=art.naturalWidth||art.width,h=art.naturalHeight||art.height,scale=Math.min(120/w,130/h);
    context.clearRect(0,0,120,130);context.drawImage(art,(120-w*scale)/2,(130-h*scale)/2,w*scale,h*scale);portrait.dataset.painted=key;
  }
  function updateDialogue(){
    if(!blockingDialogue)return;paintDialoguePortrait();
    const count=reducedMotion?blockingDialogue.text.length:Math.floor((clock-blockingDialogue.started)*36);
    if(count>=blockingDialogue.text.length)blockingDialogue.revealed=true;
    lineText.textContent=blockingDialogue.revealed?blockingDialogue.text:blockingDialogue.text.slice(0,count);
    continueHint.textContent=blockingDialogue.revealed?'Continue · Enter':'Click to reveal';
  }
  function tone(kind) {
    if (muted || document.hidden) return;
    try {
      const settings = JSON.parse(localStorage.getItem('meta.settings') || '{}'), volume = clamp(Number(settings.volume ?? 70) / 100, 0, 1);
      if (!volume) return;
      const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
      audio ||= new Audio(); void audio.resume();
      const osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      osc.type = kind === 'hit' ? 'sawtooth' : 'sine'; osc.frequency.setValueAtTime(kind === 'hit' ? 130 : 460, now);
      osc.frequency.exponentialRampToValueAtTime(kind === 'hit' ? 34 : 170, now + .14);
      gain.gain.setValueAtTime(.06 * volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + .2);
      osc.connect(gain); gain.connect(audio.destination); osc.start(now); osc.stop(now + .22);
    } catch { /* muted/unavailable audio never affects gameplay */ }
  }
  function burst(x, y, color, count = 24) {
    for (let i = 0; i < count && particles.length < 220; i++) {
      const angle = i * 2.39996 + clock, speed = 70 + i % 7 * 24;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40, life: .6 + i % 5 * .12, maxLife: 1.1, color, size: 2 + i % 3 });
    }
  }
  function input() { return { x: Number(keys.has('d') || keys.has('arrowright') || held.has('right')) - Number(keys.has('a') || keys.has('arrowleft') || held.has('left')),
    y: Number(keys.has('s') || keys.has('arrowdown') || held.has('down')) - Number(keys.has('w') || keys.has('arrowup') || held.has('up')),
    weapon: selectedWeapon, attack: keys.has('j') || held.has('attack'), dodge: keys.has(' ') || held.has('dodge'), heal: keys.has('h') || held.has('heal'), advance: keys.has('enter') }; }
  function keydown(e) {
    if (e.key === 'Escape') { close(); return; }
    if(blockingDialogue && ['Enter',' ','j','J'].includes(e.key)){e.preventDefault();if(!e.repeat)advanceDialogue();return;}
    if(blockingDialogue && e.key!=='Tab'){e.preventDefault();return;}
    if(['q','e'].includes(e.key.toLowerCase())) { e.preventDefault();if(!e.repeat){const idx=weaponButtons.findIndex(w=>w.type===selectedWeapon);selectWeapon(weaponButtons[(idx+(e.key.toLowerCase()==='q'?3:1))%4].type);}return;}
    if(e.repeat&&['j','enter','h'].includes(e.key.toLowerCase())){e.preventDefault();return;}
    const choice=weaponButtons.find(w=>String(w.i)===e.key);if(choice){e.preventDefault();selectWeapon(choice.type);return;}
    if ([' ','w','a','s','d','j','h','enter','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase())) { e.preventDefault(); keys.add(e.key.toLowerCase()); }
    if (e.key === 'Tab') { const all = [...screen.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null); if (!all.length) return; const idx = all.indexOf(document.activeElement); e.preventDefault(); all[(idx + (e.shiftKey ? -1 : 1) + all.length) % all.length].focus(); }
  }
  function keyup(e) { keys.delete(e.key.toLowerCase()); }
  function blur() { keys.clear(); held.clear(); last = 0; accumulator = 0; }
  document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', blur);
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); if(blockingDialogue){advanceDialogue();return;} held.add('attack'); canvas.setPointerCapture(e.pointerId); });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type, () => held.delete('attack'));
  function showPanel(title, description, actions) {
    panel.replaceChildren(node('h2', '', title), node('p', '', description));
    const row = node('div', 'vb-actions');
    for (const [label, action] of actions) { const b = node('button', '', label); b.onclick = action; row.append(b); }
    panel.append(row); panel.hidden = false;
  }
  async function startFight() {
    if (victoryBusy || closed) return;
    victoryBusy = true;
    try {
      if (online && (!online.vinson?.battleStart || !online.vinson?.battleWin || !online.vinson?.claimBattleRewards)) {
        showPanel('Battle unavailable', 'The battle service is not ready yet. Return to Pitchside and try again later.', [['Return to Pitchside', close]]); return;
      }
      if (!nonce && online?.vinson?.battleStart) {
        const result = await registerVinsonBattleAttempt(online);
        if (closed) return;
        if (!result?.ok) { showPanel('Unable to start', 'Your fight could not start. If the Vinson escape service is still updating, try again shortly.', [['Retry', startFight]]); return; }
        nonce = result.nonce;
      }
      panel.hidden=true;mode='conversation';tone('fire');
      const lines=battle.state.stage?[
        {actor:'captain',speaker:'CAPTAIN ISRAEL',text:'Patel, this fight is for you.'},
        {actor:'phonk',speaker:'PHONK MODE VINSON',text:"I'll teach you the ways of mango."}
      ]:[
        {actor:'patel',speaker:'ISRAELI FOREVER PATEL',text:"I'll avenge my fallen Israelis once and for all."},
        {actor:'world',speaker:'WORLD-RULER VINSON',text:"That's too humble. I'm going to assign pain."},
        {actor:'patel',speaker:'ISRAELI FOREVER PATEL',text:'Then face me. Your reign ends here.'}
      ];
      showDialogue(lines,()=>{battle.step(0,{advance:true});mode='fight';held.clear();keys.clear();});
    } catch { showPanel('Connection interrupted', 'Try again when your connection returns.', [['Retry', startFight]]); }
    finally { victoryBusy = false; }
  }
  async function confirmVictory() {
    if (victoryBusy || closed) return;
    victoryBusy = true;
    showPanel('Victory', 'Confirming your victory and curse protection…', []);
    try {
      const result = onWin ? await onWin({ nonce }) : await online?.vinson?.battleWin?.({ nonce });
      if (closed) return;
      if (!result?.ok || !result.immune) {
        showPanel('Victory', result?.error === 'too_soon' ? `The server needs ${Math.max(1, Math.ceil(Number(result.retryAfter) || 60))} more seconds before confirming. Retry after that wait.` : 'Your victory could not be confirmed. Your curse and rewards have not changed.', [['Retry confirmation', confirmVictory], ['Return to Pitchside', close]]); return;
      }
      victoryConfirmed = true;
      showPanel('The curse is broken', 'Congratulations. Claim your three exclusive cards. Vinson can no longer curse this account.', [['Collect rewards', claimRewards], ['Return to Pitchside', close]]);
    } catch { if (!closed) showPanel('Victory', 'Connection interrupted. Retry to confirm victory and collect your rewards.', [['Retry confirmation', confirmVictory], ['Return to Pitchside', close]]); }
    finally { victoryBusy = false; }
  }
  async function claimRewards() {
    if (!victoryConfirmed || victoryBusy || closed) return;
    victoryBusy = true;
    try {
      const result = onClaim ? await onClaim() : await online?.vinson?.claimBattleRewards?.();
      if (closed) return;
      if (!result?.ok) { showPanel('Rewards pending', 'Your victory is confirmed. Retry collecting your rewards.', [['Retry collection', claimRewards], ['Return to Pitchside', close]]); return; }
      showPanel('Congratulations', 'Your World-Ruler Vinson, Phonk Mode Vinson and Captain Israel rewards are ready in your club.', [['Return to Pitchside', close]]);
      const rewards = node('div', 'vb-rewards');
      for (const key of ['world','phonk','captain']) { const tile = node('div', 'vb-reward'); const img = new Image(); img.src = asset(key); img.alt = names[key]; tile.append(img, node('span', '', names[key])); rewards.append(tile); }
      panel.insertBefore(rewards, panel.lastChild);
    } catch { if (!closed) showPanel('Rewards pending', 'Try again when your connection returns.', [['Retry collection', claimRewards], ['Return to Pitchside', close]]); }
    finally { victoryBusy = false; }
  }
  function animate(dt) {
    // A defeated arena is a held result frame. Do not advance animation clocks,
    // hazards or particles underneath the Suppressed decision panel.
    if(mode==='defeat')return;
    clock += dt;updateDialogue(); trauma = Math.max(0, trauma - dt * 1.8);
    particles = particles.filter(p => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 150 * dt; return p.life > 0; });
    if(blockingDialogue)return;
    if (cinematicKind) {
      cinematicTime += dt;
      const shot = sampleVinsonCinematic(cinematicKind, cinematicTime, { reducedMotion });
      const id=shot.text?`${cinematicKind}:${shot.dialogueId||shot.text}`:null;
      if(id && mode!=='result' && !acknowledgedDialogue.has(id) && shot.black<.8 && shot.white<.8){
        acknowledgedDialogue.add(id);
        const actor=shot.speaker==='CAPTAIN ISRAEL'?'captain':shot.speaker?.includes('PATEL')?'patel':shot.villain;
        showDialogue([{actor,speaker:shot.speaker||'',text:shot.text}]);return;
      }
      if (shot.done && cinematicKind === 'transition') { battle.next(); cinematicKind = ''; mode = ''; viewHero = { ...battle.state.hero }; }
      else if (shot.done && mode !== 'result') { mode = 'result'; subtitle.replaceChildren(); void confirmVictory(); }
      return;
    }
    const s = battle.step(dt, input());
    const attackButton=[...touch.children].find(b=>b.dataset.action==='attack');if(attackButton){attackButton.disabled=s.phase==='dodgebox';attackButton.textContent=s.phase==='timing'?'Strike':'Attack';}
    const healButton=[...touch.children].find(b=>b.dataset.action==='heal');if(healButton){healButton.textContent=`Heal ×${s.hero.heals}`;healButton.disabled=s.hero.heals===0||s.phase==='timing';}
    for(const item of weaponButtons){const labels=s.stage?{star:'Return shield',spinner:'Orbit stars',explosive:'Ground rupture',eyes:'Eye lance'}:{star:'Star',spinner:'Spinning star',explosive:'Explosive star',eyes:'Eye lasers'};item.b.textContent=labels[item.type];item.b.disabled=['dodgebox','timing'].includes(s.phase);}
    const target = s.hero; const k = 1 - Math.exp(-22 * dt);
    viewHero.x += (target.x - viewHero.x) * k; viewHero.y += (target.y - viewHero.y) * k;
    viewHero.moving = !!(input().x || input().y);
    for (const evt of s.events) {
      if (evt.type === 'hit') { trauma = Math.min(1, trauma + (evt.target === 'hero' ? .7 : .32)); const who = evt.target === 'hero' ? s.hero : s.boss; burst(who.x, who.y - 65, evt.target === 'hero' ? '#f67460' : '#a4d9ff'); tone('hit'); if(evt.weapon==='explosive')particles.push({kind:'blast',x:who.x,y:who.y-100,vx:0,vy:0,life:.6,maxLife:.6,size:0,color:'#ffbc70'}); }
      if(evt.type==='heal'){burst(s.hero.x,s.hero.y-55,'#99efc3',28);tone('fire');}
      if(evt.type==='boxStart'){keys.delete('j');held.delete('attack');say(names[bossArt(s.stage)].toUpperCase(),'You can fight again when you survive this.','box');}
      if(evt.type==='timingStart'){keys.delete('j');keys.delete('enter');held.delete('attack');tone('fire');}
      if(evt.type==='timingResult'){trauma=evt.result==='hit'?.6:.15;burst(s.boss.x,s.boss.y-100,evt.result==='hit'?'#c5e9ff':'#f05750',32);tone('hit');}
      if (evt.type === 'fire') { burst(evt.x, evt.y - 20, '#70bfff', 4); tone('fire'); }
      if(evt.type==='telegraph' && clock-lastDialogue>2.5) {
        const lines={
          laserline:s.stage?['You cannot outrun my eyes.','Face the light that ends you.']:['Look at me. This ends now.','My eyes have already found you.'],
          bombcircle:['Stay humble. Here comes the bomb.','The humble bomb leaves nowhere to hide.'],
          painring:["That's too humble. I'm going to assign pain.",'Pain has your name now.'],
          handslam:['Kneel. The weight of my world is coming down.','One hand is enough to end this.'],
          handcatch:['Run wherever you like. My hands will find you.','You are already in my grasp.'],
          earththrow:['You want my world? Then catch it.','The weight of the Earth is yours now.']
        };
        const pool=lines[evt.attack]||['You were warned.'],count=barkCount.get(evt.attack)||0;
        barkCount.set(evt.attack,count+1);say(names[bossArt(s.stage)].toUpperCase(),pool[count%pool.length],evt.attack);
      }
      if (evt.type === 'dodge') burst(evt.x, evt.y - 40, '#d3ebff', 18);
    }
    if (s.phase === 'transition' || s.phase === 'clash') {
      cinematicKind = s.phase === 'transition' ? 'transition' : 'finale'; cinematicTime = 0;dialogue=null;acknowledgedDialogue.clear(); panel.hidden = true; mode = cinematicKind; held.clear(); keys.clear(); tone('hit');
    } else if (s.phase !== mode) {
      mode = s.phase;
      if (mode === 'intro') showPanel(s.stage ? 'Captain Israel' : 'Fight Suppression', s.stage ? 'Captain Israel faces Phonk Mode Vinson.' : 'World-Ruler Vinson awaits. Face her and fight for your freedom.', [['Begin fight', startFight]]);
      else if (mode === 'defeat') {
        held.clear(); keys.clear(); particles.length=0; trauma=0; dialogue=null; subtitle.replaceChildren();
        controls.classList.add('vb-controls-paused');stage.classList.add('vb-stage-frozen');
        showPanel('Suppressed', 'Retry this stage. Your curse remains until you win and the victory is confirmed.', [['Retry stage', () => {
          nonce = null; battle.retry(); viewHero = { ...battle.state.hero }; mode = '';
          controls.classList.remove('vb-controls-paused');stage.classList.remove('vb-stage-frozen');panel.hidden=true;
        }], ['Return to Pitchside', close]]);
      }
    }
  }
  function frame(now) {
    if (closed) return;
    if (document.hidden) { last = 0; raf = requestAnimationFrame(frame); return; }
    const delta = last ? Math.min(.1, (now - last) / 1000) : 0; last = now; accumulator += delta;
    for (let i = 0; i < 6 && accumulator >= 1 / 60; i++) { animate(1 / 60); accumulator -= 1 / 60; }
    let shot = cinematicKind ? sampleVinsonCinematic(cinematicKind, cinematicTime, { reducedMotion }) : null;
    if(blockingDialogue){
      const boss=['world','phonk'].includes(blockingDialogue.actor);
      const noActors=shot&&shot.heroAlpha===0&&shot.villainAlpha===0;
      const target=noActors?{zoom:1,x:640,y:435}:{zoom:reducedMotion?1:1.65,x:boss?895:365,y:340};
      const k=1-Math.exp(-3.8*delta);camera.zoom+=(target.zoom-camera.zoom)*k;camera.x+=(target.x-camera.x)*k;camera.y+=(target.y-camera.y)*k;
      shot={...(shot||{}),time:cinematicTime,hero:heroArt(battle.state.stage),villain:bossArt(battle.state.stage),heroAlpha:1,villainAlpha:1,beams:shot?.beams||0,zoom:camera.zoom,focusX:camera.x,focusY:camera.y,black:0,white:0};
      // Preserve the visible characters of the exact story beat during its dialogue hold.
      if(cinematicKind){const source=sampleVinsonCinematic(cinematicKind,cinematicTime,{reducedMotion});shot.hero=source.hero;shot.villain=source.villain;shot.heroAlpha=source.heroAlpha;shot.villainAlpha=source.villainAlpha;}
    }else{
      const target={zoom:shot?.zoom||1,x:shot?.focusX||640,y:shot?.focusY||360},k=1-Math.exp(-4.5*delta);
      camera.zoom+=(target.zoom-camera.zoom)*k;camera.x+=(target.x-camera.x)*k;camera.y+=(target.y-camera.y)*k;
    }
    drawVinsonBattle(ctx, battle.state, images, clock, { shot, particles, trauma, reducedMotion, visualHero: viewHero, camera });
    const activeDialogue=dialogue&&clock<dialogue.until&&mode==='fight'?dialogue:null;
    const text = blockingDialogue || shot || mode==='result' ? '' : activeDialogue?.text || '';
    if (subtitle.dataset.text !== text) { subtitle.dataset.text = text; subtitle.replaceChildren(); if (text) subtitle.append(node('strong', '', activeDialogue?.speaker||''), node('p', '', text)); }
    raf = requestAnimationFrame(frame);
  }
  function close() {
    if (closed) return; closed = true; cancelAnimationFrame(raf);
    document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', blur);
    void audio?.close(); document.documentElement.style.overflow = originalOverflow; screen.remove(); link.remove(); oldFocus?.focus?.(); onClose?.();
  }
  if (resumeRewards) {
    mode = 'result'; victoryConfirmed = true; cinematicKind = 'finale'; cinematicTime = 26;
    showPanel('The curse is broken', 'Your victory is saved. Collect your three exclusive reward cards.', [['Collect rewards', claimRewards], ['Return to Pitchside', close]]);
  } else animate(0);
  closeButton.focus(); raf = requestAnimationFrame(frame);
  return { close, get state() { return battle.state; } };
}
