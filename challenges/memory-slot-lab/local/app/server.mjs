import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/model.mjs': ['model.mjs', 'text/javascript; charset=utf-8'] };
export const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  const file = req.method === 'GET' && files[req.url];
  if (!file) { res.writeHead(404); return res.end('not found'); }
  try { const data = await readFile(new URL(file[0], import.meta.url)); res.writeHead(200, { 'content-type': file[1], 'x-content-type-options': 'nosniff' }); res.end(data); }
  catch { res.writeHead(500); res.end('file unavailable'); }
});
server.listen(Number(process.env.PORT ?? 8080), process.env.BIND ?? '127.0.0.1');
