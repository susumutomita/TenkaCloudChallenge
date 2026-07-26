import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { makeEvent } from './domain.mjs';
import { routeBody, sendJson } from './http.mjs';
import { createSignedPackage } from './security.mjs';

/**
 * Parse a request target without letting a malformed one end the process.
 *
 * `GET //` is a protocol-relative reference with no host, and `new URL` rejects
 * it. This app serves its challenge surface and its `/verify` scorer from one
 * process, so an unguarded parse in the handler takes both down over a stray
 * slash. Leading slashes are collapsed (which is what the client meant) and
 * anything still unparseable becomes a target the router will not match, so a
 * malformed request is a 404 rather than a crash.
 */
function requestUrl(target, base) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), base);
  } catch {
    return new URL("/__malformed_request__", base);
  }
}

export function startSigningService(port = 8080) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const server = createServer(async (request, response) => {
    const url = requestUrl(request.url, 'http://signing.local');
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(response, 200, { status: 'ok', algorithm: 'Ed25519' });
    }
    if (request.method === 'GET' && url.pathname === '/public-key') {
      return sendJson(response, 200, {
        algorithm: 'Ed25519',
        publicKey: publicKeyPem,
      });
    }
    if (request.method === 'POST' && url.pathname === '/sign') {
      return routeBody(request, response, async (body) => {
        if (
          !body.manifest ||
          typeof body.payload !== 'string' ||
          !body.correlationId
        ) {
          return sendJson(response, 400, {
            error: 'manifest_payload_and_correlation_required',
          });
        }
        const packageData = createSignedPackage(
          privateKey,
          body.manifest,
          body.payload
        );
        return sendJson(response, 200, {
          package: packageData,
          event: makeEvent('signing', 'package_signed', body.correlationId, {
            result: 'signed',
            campaignId: body.manifest.campaignId,
            ecuId: body.manifest.ecuId,
            version: body.manifest.version,
            algorithm: 'Ed25519',
          }),
        });
      });
    }
    return sendJson(response, 404, { error: 'not_found' });
  });
  return server.listen(port, '0.0.0.0');
}
