import assert from 'node:assert/strict';
import fs from 'node:fs';
import { vinsonBossYBounds } from '../core/vinsonbattle.js';
import { worldEdgeFeather } from '../ui/vinsonbattle.js';

const css=fs.readFileSync(new URL('../../../css/vinsonbattle.css',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../ui/vinsonbattle.js',import.meta.url),'utf8');
const preview=fs.readFileSync(new URL('../../../vinson-battle-preview.html',import.meta.url),'utf8');

assert.match(css,/@media\(max-width:900px\)[\s\S]*?\.vb-weapons button\{[^}]*min-height:44px/);
assert.match(css,/@media\(max-width:900px\)[\s\S]*?\.vb-touch button\{[^}]*height:44px[^}]*white-space:nowrap/);
assert.match(css,/grid-template-columns:repeat\(4,44px\) repeat\(3,minmax\(58px,72px\)\)/);
assert.doesNotMatch(ui,/Heal [×x]/,'compact Heal label stays on one line');

assert.deepEqual(vinsonBossYBounds(false),{min:470,max:575});
assert.deepEqual(vinsonBossYBounds(true),{min:490,max:520});
assert.ok(vinsonBossYBounds(false).min-240>220,'desktop hair clears bark row and bob');
assert.ok(vinsonBossYBounds(true).min-240>243,'compact hair clears raised bark row and bob');
assert.match(css,/@media\(max-height:450px\)\{\.vb-subtitle:not\(:empty\)\{top:64px/,'compact bark sits below HUD and above boss');

assert.equal(worldEdgeFeather(.5,.45),1,'face/hands remain fully opaque');
assert.equal(worldEdgeFeather(.5,.72),1,'clothing begins fully opaque');
assert.ok(worldEdgeFeather(.5,.9)>0&&worldEdgeFeather(.5,.9)<1,'bottom dissolves gradually');
assert.equal(worldEdgeFeather(.5,1),0,'bottom matte ends transparent');
assert.equal(worldEdgeFeather(0,.5),0,'side matte ends transparent');
assert.match(preview,/URLSearchParams\(location\.search\).*get\('seed'\)/,'review preview accepts deterministic seed');
console.log('Vinson prototype 10 layout, boss clearance and matte feather tests passed');
