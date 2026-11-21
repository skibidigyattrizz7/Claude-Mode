import assert from 'node:assert/strict';
import {launchVinsonBattle} from '../ui/vinsonbattle.js';
const context=new Proxy({}, {get(o,key){if(key==='createLinearGradient')return()=>({addColorStop(){}});if(key==='getImageData')return()=>({data:new Uint8ClampedArray(4)});return()=>{};}});
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.hidden=false;this.listeners={};this.className='';this.classList={add(){},remove(){}};}
 append(...items){for(const i of items){this.children.push(i);i.parent=this;}}
 replaceChildren(...items){this.children=[];this.append(...items);}
 insertBefore(i,b){this.children.splice(this.children.indexOf(b),0,i);i.parent=this;}
 setAttribute(){} addEventListener(t,fn){this.listeners[t]=fn;} removeEventListener(t){delete this.listeners[t];} focus(){} setPointerCapture(){}
 getContext(){return context;} remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
 querySelectorAll(){return[];}
}
const originals=Object.fromEntries(['document','window','Image','requestAnimationFrame','cancelAnimationFrame'].map(k=>[k,globalThis[k]]));
const body=new Element('body'),head=new Element('head');let callback;
globalThis.document={body,head,documentElement:{style:{}},createElement:t=>new Element(t),querySelector:()=>null,addEventListener(){},removeEventListener(){}};
globalThis.window={addEventListener(){},removeEventListener(){}};
globalThis.Image=class {constructor(){this.complete=true;this.naturalWidth=1;this.naturalHeight=1;}decode(){return Promise.resolve();}};
globalThis.requestAnimationFrame=fn=>{callback=fn;return 1};globalThis.cancelAnimationFrame=()=>{};
const find=(root,cls)=>root.className===cls?root:root.children.map(c=>find(c,cls)).find(Boolean);
try{
 const battle=launchVinsonBattle({reducedMotion:true});const screen=body.children[0];
 const panel=find(screen,'vb-panel'),dialogue=find(screen,'vb-dialogue');
 await panel.children.at(-1).children[0].onclick();
 assert.equal(dialogue.hidden,false,'begin fight opens clickable story conversation');
 assert.equal(battle.state.phase,'intro','simulation waits during dialogue');
 for(let i=1;i<=300;i++)callback(i*17);
 assert.equal(battle.state.time,0,'waiting cannot advance combat or take damage');
 assert.match(find(screen,'vb-dialogue-line').textContent,/avenge/);
 dialogue.onclick();assert.match(find(screen,'vb-dialogue-line').textContent,/assign pain/);
 dialogue.onclick();assert.match(find(screen,'vb-dialogue-line').textContent,/Your reign ends/);
 dialogue.onclick();assert.equal(dialogue.hidden,true);assert.equal(battle.state.phase,'fight');
 battle.close();assert.equal(body.children.length,0);assert.equal(head.children.length,0);
 const typed=launchVinsonBattle({reducedMotion:false}),typedScreen=body.children[0],typedPanel=find(typedScreen,'vb-panel');
 await typedPanel.children.at(-1).children[0].onclick();
 const typedDialogue=find(typedScreen,'vb-dialogue'),typedLine=find(typedScreen,'vb-dialogue-line');
 assert.equal(typedLine.textContent,'','normal motion starts typewriter without skipping the line');
 typedDialogue.onclick();assert.match(typedLine.textContent,/avenge/,'first click reveals the whole current line');
 assert.equal(typed.state.phase,'intro');
 typedDialogue.onclick();assert.equal(typedLine.textContent,'','second click advances to next line');
 typed.close();
 console.log('Vinson clickable dialogue pause, reveal, advance and cleanup tests passed');
}finally{for(const[k,v]of Object.entries(originals))globalThis[k]=v;}
