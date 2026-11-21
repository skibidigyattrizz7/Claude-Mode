import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1600, height: 760 } });
p.on('console', m => console.log(m.text())); p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://localhost:8765/3d/cardv2.tmp.html'); await p.waitForFunction(() => window.done); await p.waitForTimeout(600);
await p.screenshot({ path: '/tmp/claude-0/cardv2.png' }); await b.close();
