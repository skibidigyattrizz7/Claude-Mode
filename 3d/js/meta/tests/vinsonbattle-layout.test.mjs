import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../../../css/vinsonbattle.css',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../ui/vinsonbattle.js',import.meta.url),'utf8');

assert.match(css,/\.vb-stage\s*>\s*canvas\s*\{/,'arena sizing must not enlarge the dialogue portrait canvas');
assert.doesNotMatch(css,/\.vb-stage\s+canvas\s*\{/,'no descendant canvas rule may affect portrait sizing');
assert.match(css,/grid-template-columns:[^;}]*minmax\(28ch,1fr\)/,'dialogue reserves a readable text column');
assert.match(css,/\.vb-dialogue-portrait[^}]*max-width:120px[^}]*max-height:130px/,'dialogue portrait is capped');
assert.match(css,/\.vb-subtitle:not\(:empty\)[^}]*top:[^}]*pointer-events:none[^}]*white-space:nowrap/,'combat bark is a nonblocking one-line HUD strip');
assert.doesNotMatch(ui,/vb-taunt-dismiss/,'combat barks have no blocking dismiss control');
assert.match(ui,/until:clock\+2\.6/,'combat barks clear quickly');
assert.match(ui,/barkLast\.get\(key\)[^<]*<10/,'each attack bark has a repeat cooldown');
console.log('Vinson responsive dialogue and nonblocking bark layout tests passed');
