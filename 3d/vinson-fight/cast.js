import {vinsonRenderCache} from './portrait-cache.js?v=vf1';
export const WORLD_PIECES={
  left:{anchor:[.23,.61],points:[[.13,.78],[.13,.71],[.145,.64],[.145,.58],[.16,.54],[.155,.49],[.17,.46],[.20,.46],[.217,.43],[.219,.402],[.246,.389],[.285,.4],[.301,.423],[.298,.453],[.281,.481],[.307,.497],[.319,.526],[.302,.549],[.298,.576],[.28,.621],[.253,.66],[.219,.701],[.188,.767],[.168,.794]]},
  right:{anchor:[.715,.62],points:[[.548,.418],[.533,.403],[.552,.395],[.582,.413],[.62,.433],[.654,.455],[.658,.431],[.669,.413],[.70,.407],[.729,.423],[.744,.45],[.739,.483],[.776,.485],[.795,.51],[.787,.548],[.766,.572],[.798,.621],[.8,.67],[.776,.731],[.74,.792],[.716,.821],[.687,.798],[.688,.771],[.714,.731],[.715,.693],[.682,.711],[.659,.691],[.662,.655],[.69,.625],[.668,.574],[.653,.526],[.625,.504],[.597,.457]]},
  earth:{anchor:[.468,.609],radius:.172}
};

export const CAST = {world:null,phonk:null,patel:null,secret:null};
export async function installCast(custom,ImageType=globalThis.Image){
 if(!ImageType)return;
 const urls={world:new URL('../assets/vinson/world-cutout.webp',import.meta.url).href,phonk:new URL('../assets/vinson/phonk.webp',import.meta.url).href,patel:new URL('../assets/vinson/patel.webp',import.meta.url).href,secret:new URL('./assets/secret-boss.png',import.meta.url).href};
 // fix (owner video, Oct 6): on a slow connection a photo could miss the 4 s wait and then never show. Now the fight
 // starts after at most 4 s, and any photo that arrives later is put in as soon as it loads.
 const apply=()=>{for(let phase=1;phase<=3;phase++){if(!custom.hero[phase]?._dev)custom.hero[phase]=CAST.patel;if(!custom.boss[phase]?._dev)custom.boss[phase]=CAST[phase===1?'world':phase===2?'phonk':'secret'];}}; // a DEV MODE picture (_dev) is never replaced
 await Promise.all(Object.entries(urls).map(([key,url])=>new Promise(resolve=>{const img=new ImageType();const timer=setTimeout(resolve,4000);img.onload=()=>{clearTimeout(timer);if(img.naturalWidth){CAST[key]=img;apply();}resolve();};img.onerror=()=>{clearTimeout(timer);resolve();};img.src=url;})));
 apply();
}
// Draw source hands at the simulator's existing positions; never advance or rewrite those positions.
export function drawPhotoHand(ctx,image,key,x,y,rotation=0){
 const crop=vinsonRenderCache.get(image,key,WORLD_PIECES[key]);if(!crop)return false;
 const scale=94/Math.max(crop.width,crop.height);
 ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.scale(scale,scale);ctx.drawImage(crop.canvas,-crop.anchorX,-crop.anchorY);ctx.restore();return true;
}
export function drawCastBoss(ctx,image,phase){
 if(!image?.naturalWidth)return false;
 const ih=250,iw=Math.min(330,ih*image.naturalWidth/image.naturalHeight);
 ctx.save();
 if(phase===1){ctx.beginPath();ctx.rect(-iw/2,-ih+30,iw,ih);for(const key of ['left','right']){WORLD_PIECES[key].points.forEach(([x,y],i)=>{const px=-iw/2+x*iw,py=-ih+30+y*ih;i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.closePath();}ctx.clip('evenodd');}
 // Keep the supplied secret portrait intact; crop its lower document out of the combat frame.
 if(phase===3){const contour=[[.40,.05],[.55,.06],[.64,.15],[.67,.3],[.64,.47],[.65,.64],[.72,.8],[1,1],[0,1],[0,.89],[.15,.78],[.26,.67],[.23,.52],[.20,.35],[.23,.19],[.31,.10]];ctx.beginPath();contour.forEach(([x,y],i)=>{i?ctx.lineTo(-iw/2+x*iw,-220+y*250):ctx.moveTo(-iw/2+x*iw,-220+y*250)});ctx.closePath();ctx.clip();ctx.drawImage(image,0,0,image.naturalWidth,image.naturalHeight*.88,-iw/2,-220,iw,250);}
 else ctx.drawImage(phase===2?portraitArt(image):image,-iw/2,-220,iw,250);
 ctx.restore();return true;
}
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

const matteCache=new WeakMap();
export function portraitArt(image){
 if(matteCache.has(image))return matteCache.get(image);
 let art=image;
 try{const c=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(1,1):document.createElement('canvas');const scale=Math.min(1,512/image.naturalHeight);c.width=Math.round(image.naturalWidth*scale);c.height=Math.round(image.naturalHeight*scale);const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(image,0,0,c.width,c.height);const pixels=g.getImageData(0,0,c.width,c.height);removeVinsonMatte(pixels.data,c.width,c.height);g.putImageData(pixels,0,0);art=c;}catch{}matteCache.set(image,art);return art;
}
export function clipPatel(ctx,iw,ih){
 const contour=[[.42,.012],[.50,0],[.565,.03],[.59,.09],[.592,.17],[.577,.23],[.62,.29],[.70,.32],[.79,.40],[.87,.50],[.94,.70],[1,1],[0,1],[.115,.76],[.15,.48],[.29,.31],[.40,.285],[.38,.23],[.35,.13],[.36,.07]];
 ctx.beginPath();contour.forEach(([x,y],i)=>{const px=-iw/2+x*iw,py=-ih+6+y*ih;i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.closePath();ctx.clip();
}
