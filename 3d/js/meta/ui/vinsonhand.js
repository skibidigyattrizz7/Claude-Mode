const NS='http://www.w3.org/2000/svg';
function svg(tag,attrs={}) {
  const e=document.createElementNS(NS,tag);
  for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));
  return e;
}
/** Lightweight articulated palm, lit from the upper left of the portrait. */
export function createVinsonHand() {
  const hand=svg('svg',{viewBox:'0 0 400 500',class:'vinson-screen-hand'}),defs=svg('defs');
  const skin=svg('linearGradient',{id:'vinson-hand-skin',x1:'0%',y1:'10%',x2:'100%',y2:'65%'});
  for(const [offset,color]of [['0%','#e1a38a'],['25%','#b77055'],['52%','#75412f'],['80%','#38201b'],['100%','#160b0b']])skin.append(svg('stop',{offset,'stop-color':color}));
  const palm=svg('radialGradient',{id:'vinson-hand-palm',cx:'35%',cy:'30%',r:'70%'});
  for(const [offset,color]of [['0%','#bc8165'],['50%','#764530'],['100%','#25110e']])palm.append(svg('stop',{offset,'stop-color':color}));
  defs.append(skin,palm);hand.append(defs);
  hand.append(svg('path',{d:'M105 500 L102 324 C94 282 113 219 152 209 C182 197 226 204 255 242 C278 272 278 334 267 387 L282 500 Z',fill:'url(#vinson-hand-palm)',stroke:'#42231c','stroke-width':2}));
  const fingers=[
    ['M120 291 C91 280 62 251 47 218 C39 196 58 183 72 201 L128 248 Z',120,280,-15],
    ['M119 249 L109 108 C108 81 134 77 140 105 L154 231 Z',135,245,12],
    ['M154 223 L154 55 C154 29 181 29 187 54 L196 225 Z',175,225,7],
    ['M196 228 L210 78 C214 51 241 59 240 83 L231 240 Z',214,235,-8],
    ['M228 256 L252 130 C258 105 281 113 277 141 L263 281 Z',244,267,-17],
  ];
  fingers.forEach(([d,x,y,angle],i)=>{
    const finger=svg('g',{class:'vinson-hand-finger','data-grip':angle});
    finger.style.transformOrigin=x+'px '+y+'px';finger.style.transformBox='view-box';
    finger.append(svg('path',{d,fill:'url(#vinson-hand-skin)',stroke:'#492b23','stroke-width':2}));
    const tips=[[58,210],[123,109],[169,56],[225,80],[266,134]][i];
    finger.append(svg('ellipse',{cx:tips[0],cy:tips[1],rx:8,ry:13,fill:'#d6af99',opacity:.6,transform:'rotate('+(-12+i*6)+' '+tips.join(' ')+')'}));
    hand.append(finger);
  });
  hand.append(svg('path',{d:'M125 277 Q160 261 204 280 M133 293 Q171 303 199 325 M165 236 Q151 277 173 337 M206 245 Q244 285 221 338 M125 383 Q180 370 257 389 M130 402 Q191 384 263 410',fill:'none',stroke:'#2e1713','stroke-width':3,opacity:.7,'stroke-linecap':'round'}));
  hand.append(svg('path',{d:'M120 330 Q131 367 128 474 M156 216 Q176 231 187 255 M150 281 Q172 270 194 285',fill:'none',stroke:'#daa184','stroke-width':5,opacity:.35,'stroke-linecap':'round'}));
  return hand;
}
