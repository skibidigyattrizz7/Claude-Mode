import assert from 'node:assert/strict';
import { isVinsonPortrait, vinsonDialogueCamera } from '../ui/vinsonbattle.js';
assert.equal(isVinsonPortrait(390,844),true);
assert.equal(isVinsonPortrait(844,390),false);
assert.equal(isVinsonPortrait(1280,720),false);
for(const actor of ['patel','world','phonk','captain']) {
 const c=vinsonDialogueCamera(actor);
 const chestY=actor==='world'?430-130:435-90;
 const screenY=360+(chestY-c.y)*c.zoom;
 assert.ok(screenY>=70 && screenY<280, `${actor} is framed above the lower panel`);
 assert.equal(vinsonDialogueCamera(actor,true).zoom,1);
}
console.log('Vinson portrait and dialogue camera geometry passed');
