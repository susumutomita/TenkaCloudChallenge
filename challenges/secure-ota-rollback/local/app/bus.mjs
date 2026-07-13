import { createServer } from 'node:http';
import { makeEvent } from './domain.mjs';
import { callJson, routeBody, sendJson } from './http.mjs';

const MAX_LOG_ENTRIES = 200;

export function startBusService(port = 8080, options = {}) {
  const targets = options.targets ?? {
    'ecu-a': process.env.ECU_A_URL ?? 'http://ecu-a:8080',
    'ecu-b': process.env.ECU_B_URL ?? 'http://ecu-b:8080',
  };
  let deliveries = [];
  let fault = { ecuId: '', failuresRemaining: 0 };

  const record = (entry) => {
    deliveries = [...deliveries.slice(-(MAX_LOG_ENTRIES - 1)), entry];
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://bus.local');
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(response, 200, { status: 'ok' });
    }
    if (request.method === 'GET' && url.pathname === '/state') {
      return sendJson(response, 200, { deliveries, fault });
    }
    if (request.method === 'POST' && url.pathname === '/reset') {
      deliveries = [];
      fault = { ecuId: '', failuresRemaining: 0 };
      return sendJson(response, 200, { reset: true });
    }
    if (request.method === 'POST' && url.pathname === '/fault') {
      return routeBody(request, response, async (body) => {
        if (
          !targets[body.ecuId] ||
          !Number.isInteger(body.failures) ||
          body.failures < 0 ||
          body.failures > 4
        ) {
          return sendJson(response, 400, { error: 'invalid_fault' });
        }
        fault = { ecuId: body.ecuId, failuresRemaining: body.failures };
        return sendJson(response, 200, { fault });
      });
    }
    if (request.method === 'POST' && url.pathname === '/deliver') {
      return routeBody(request, response, async (body) => {
        const ecuId = body.package?.manifest?.ecuId;
        if (!targets[ecuId] || !body.correlationId) {
          return sendJson(response, 400, { error: 'invalid_delivery' });
        }
        const busEvent = makeEvent(
          'bus',
          'delivery_attempt',
          body.correlationId,
          {
            campaignId: body.package.manifest.campaignId,
            ecuId,
            version: body.package.manifest.version,
            result: 'attempted',
          }
        );
        if (fault.ecuId === ecuId && fault.failuresRemaining > 0) {
          fault = { ...fault, failuresRemaining: fault.failuresRemaining - 1 };
          record({
            ecuId,
            correlationId: body.correlationId,
            delivered: false,
            transient: true,
          });
          return sendJson(response, 503, {
            delivered: false,
            transient: true,
            reason: 'simulated_bus_disconnect',
            events: [busEvent],
          });
        }

        const result = await callJson(`${targets[ecuId]}/install`, {
          method: 'POST',
          body: {
            package: body.package,
            correlationId: body.correlationId,
          },
        });
        const delivered = result.ok && result.data.installed === true;
        record({
          ecuId,
          correlationId: body.correlationId,
          delivered,
          transient: false,
          reason: result.data.reason ?? 'accepted',
        });
        return sendJson(response, 200, {
          delivered,
          transient: false,
          reason: result.data.reason ?? 'accepted',
          events: [busEvent, ...(result.data.event ? [result.data.event] : [])],
        });
      });
    }
    return sendJson(response, 404, { error: 'not_found' });
  });
  return server.listen(port, '0.0.0.0');
}
