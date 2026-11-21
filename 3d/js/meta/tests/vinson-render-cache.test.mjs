import assert from 'node:assert/strict';
import { VinsonRenderCache } from '../ui/vinsonrendercache.js';
import { WORLD_PIECES, drawClash } from '../ui/vinsonfightfx.js';

const canvases = [];
const makeCanvas = (width,height) => {
  const calls = [];
  const ctx = new Proxy({}, { get(_target,key) {
    if (key === 'drawImage') return (...args) => calls.push(['drawImage',...args]);
    if (key === 'scale' || key === 'translate' || key === 'arc' || key === 'lineTo' || key === 'moveTo')
      return (...args) => calls.push([key,...args]);
    return () => {};
  }});
  const canvas = { width,height,calls,getContext: () => ctx };
  canvases.push(canvas);
  return canvas;
};
const cache = new VinsonRenderCache(makeCanvas);
const image = { naturalWidth: 2000,naturalHeight: 1800,complete: true };
const left = cache.get(image,'left',WORLD_PIECES.left);
assert.equal(cache.get(image,'left',WORLD_PIECES.left),left,'same source and piece reuse the exact cached crop');
assert.equal(canvases.length,1,'only one canvas is created for repeated frames');
assert.equal(left.canvas.calls.filter(c => c[0] === 'drawImage').length,1,'source photo is rasterized once');
assert.ok(Math.max(left.width,left.height) <= 512,'cached photo crop is bounded to 512 pixels');
assert.ok(left.anchorX > 0 && left.anchorX < left.width);
assert.ok(left.anchorY > 0 && left.anchorY < left.height);

// The crop's anchor maps back to the original normalized anchor, including downsampling.
const boundsX = Math.min(...WORLD_PIECES.left.points.map(p=>p[0]));
const boundsY = Math.min(...WORLD_PIECES.left.points.map(p=>p[1]));
const expectedX = (WORLD_PIECES.left.anchor[0]-boundsX) * image.naturalWidth * left.factor;
const expectedY = (WORLD_PIECES.left.anchor[1]-boundsY) * image.naturalHeight * left.factor;
assert.ok(Math.abs(left.anchorX-expectedX) < 1, 'left hand anchor remains aligned after cropping and scaling');
assert.ok(Math.abs(left.anchorY-expectedY) < 1, 'left hand vertical anchor remains aligned after cropping and scaling');

const earth = cache.get(image,'earth',WORLD_PIECES.earth);
assert.notEqual(earth,left,'different source piece gets its own contour crop');
assert.equal(cache.get(image,'earth',WORLD_PIECES.earth),earth,'earth crop is reused on later frames');
assert.ok(Math.abs(earth.width-earth.height) <= 1,'earth crop retains the width-based pixel circle on a non-square source');
assert.ok(Math.abs(earth.anchorX-earth.width/2) <= 1,'earth anchor stays centered horizontally in its crop');
assert.ok(Math.abs(earth.anchorY-earth.height/2) <= 1,'earth anchor stays centered vertically in its crop');
assert.equal(canvases.length,2);

let stars = 0;
const clashCtx = new Proxy({}, { get(_target,key) { return key === 'save' || key === 'restore' ? () => {} : () => {}; },
  set(target,key,value) { target[key]=value; return true; } });
const clash = (hero,domainPower) => drawClash(clashCtx,{hero,villain:'boss',beams:.5,domainPower},0,true,()=>{},()=>stars++,()=>[]);
clash('captain',.8);
assert.equal(stars,0,'captain domain clash leaves the central emblem to its dedicated final effect');
clash('patel',.8); clash('captain',0);
assert.equal(stars,2,'all other clash stars retain the original draw path');
console.log('Vinson render cache tests passed');
