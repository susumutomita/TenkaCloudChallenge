import { createServer } from 'node:http';
import { grade } from './grade.mjs';
if (!process.env.FLAG_SEED) throw new Error('FLAG_SEED required (local fixture seed; no external service)');
export const server = createServer(async (req, res) => {
  const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.method === 'GET' && req.url === '/healthz') return send(200, { status: 'ok' });
  if (req.method !== 'POST' || req.url !== '/verify') return send(404, { error: 'not_found' });
  try {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) return send(413, { correct: false }); }
    const data = JSON.parse(body);
    return send(200, { correct: grade(data?.submission, process.env.FLAG_SEED) });
  } catch { return send(400, { correct: false }); }
});
server.listen(Number(process.env.PORT ?? 8081), process.env.BIND ?? '127.0.0.1');
