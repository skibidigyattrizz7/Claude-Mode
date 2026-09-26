// Dev/test only: serves the mock backend over HTTP so separate browser contexts share one "server".
// node 3d/js/net/tests/mockserver.mjs [port]   ->  open /3d/index.html?mockServer=http://127.0.0.1:<port>
// Admin codes for the mock: 'mock-full' / 'mock-super' (or MOCK_FULL / MOCK_SUPER env).
import http from 'node:http';
import { createMockBackend, memoryStore } from '../mockbackend.js';

const port = Number(process.argv[2] || process.env.PORT || 8202);
const be = createMockBackend(memoryStore());
be.setAdminCodes({ full: process.env.MOCK_FULL || 'mock-full', super: process.env.MOCK_SUPER || 'mock-super' });
const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const m = /^\/rpc\/([a-z_]{1,40})$/.exec(req.url || '');
  if (req.method !== 'POST' || !m) { res.writeHead(404, cors); res.end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 3e6) req.destroy(); });
  req.on('end', async () => {
    let args = {};
    try { args = JSON.parse(body || '{}'); } catch { /* ignore */ }
    const out = await be.call(m[1], args);
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
server.listen(port, '127.0.0.1', () => console.log(`mock backend on http://127.0.0.1:${port}`));
