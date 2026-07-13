import { afterEach, describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { callJson } from './http.mjs';

describe('bounded internal HTTP client', () => {
  let server;

  afterEach(async () => {
    if (!server) return;
    await new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    });
    server = undefined;
  });

  it('should reject an oversized internal response', async () => {
    server = createServer((_request, response) => {
      const body = JSON.stringify({ payload: 'x'.repeat(300 * 1024) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(body);
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('test port unavailable');

    await expect(callJson(`http://127.0.0.1:${address.port}`)).rejects.toThrow(
      'response_body_too_large'
    );
  });
});
