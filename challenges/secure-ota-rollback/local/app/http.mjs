const BODY_LIMIT_BYTES = 64 * 1024;
const RESPONSE_LIMIT_BYTES = 256 * 1024;

export function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

export function sendHtml(response, status, body) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

export async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) throw new Error('request_body_too_large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function callJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 3_000
  );
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.body
        ? { 'content-type': 'application/json' }
        : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const declaredLength = Number(response.headers.get('content-length'));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > RESPONSE_LIMIT_BYTES
    ) {
      await response.body?.cancel();
      throw new Error('response_body_too_large');
    }

    const chunks = [];
    let responseBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        responseBytes += value.byteLength;
        if (responseBytes > RESPONSE_LIMIT_BYTES) {
          await reader.cancel();
          throw new Error('response_body_too_large');
        }
        chunks.push(Buffer.from(value));
      }
    }
    const text = Buffer.concat(chunks, responseBytes).toString('utf8');
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

export async function routeBody(request, response, handler) {
  try {
    return await handler(await readJson(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_request';
    return sendJson(
      response,
      message === 'request_body_too_large' ? 413 : 400,
      {
        error: message,
      }
    );
  }
}
