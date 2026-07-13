import { createServer } from 'node:http';
import { MAX_TCU_RETRIES, validateTcuPolicyPatch } from './configuration.mjs';
import {
  BROKEN_TCU_POLICY,
  makeEvent,
  nextDeliveryQueue,
  orderPackages,
} from './domain.mjs';
import { callJson, routeBody, sendJson } from './http.mjs';

function patchPolicy(current, patch) {
  validateTcuPolicyPatch(patch);
  return { ...current, ...patch };
}

export function startTcuService(port = 8080, options = {}) {
  const busUrl = options.busUrl ?? process.env.BUS_URL ?? 'http://bus:8080';
  let policy = { ...BROKEN_TCU_POLICY };
  let lastCampaign = null;

  const correlationFor = (rootCorrelationId, component, attempt = 0) =>
    policy.auditCorrelation
      ? rootCorrelationId
      : `${rootCorrelationId}:${component}:${attempt}`;

  const runCampaign = async (body) => {
    const packages = orderPackages(body.packages, policy);
    const completedEcus = new Set();
    const events = [
      makeEvent(
        'tcu',
        'campaign_started',
        correlationFor(body.correlationId, 'tcu'),
        {
          campaignId: body.campaignId,
          result: 'started',
        }
      ),
    ];
    let retryCycles = 0;
    let deliveryAttempts = 0;

    while (retryCycles <= Math.min(policy.maxRetries, MAX_TCU_RETRIES)) {
      const queue = nextDeliveryQueue(packages, completedEcus, policy);
      let interrupted = false;
      for (const packageData of queue) {
        deliveryAttempts += 1;
        const ecuId = packageData.manifest.ecuId;
        const correlationId = correlationFor(
          body.correlationId,
          ecuId,
          retryCycles
        );
        const delivery = await callJson(`${busUrl}/deliver`, {
          method: 'POST',
          body: {
            package: packageData,
            correlationId,
          },
        });
        events.push(...(delivery.data.events ?? []));
        if (delivery.data.delivered) {
          completedEcus.add(ecuId);
          continue;
        }
        if (!delivery.data.transient) {
          return {
            campaignId: body.campaignId,
            status: 'failed',
            reason: delivery.data.reason ?? 'permanent_rejection',
            completedEcus: [...completedEcus],
            retryCycles,
            deliveryAttempts,
            events,
          };
        }
        interrupted = true;
        break;
      }

      if (!interrupted) {
        events.push(
          makeEvent(
            'tcu',
            'campaign_completed',
            correlationFor(body.correlationId, 'tcu'),
            {
              campaignId: body.campaignId,
              result: 'completed',
            }
          )
        );
        return {
          campaignId: body.campaignId,
          status: 'completed',
          completedEcus: [...completedEcus],
          retryCycles,
          deliveryAttempts,
          events,
        };
      }

      retryCycles += 1;
      if (retryCycles > Math.min(policy.maxRetries, MAX_TCU_RETRIES)) break;
      if (!policy.resumeFromCheckpoint) completedEcus.clear();
    }

    events.push(
      makeEvent(
        'tcu',
        'campaign_aborted',
        correlationFor(body.correlationId, 'tcu'),
        {
          campaignId: body.campaignId,
          result: 'failed',
        }
      )
    );
    return {
      campaignId: body.campaignId,
      status: 'failed',
      reason: 'retry_limit_reached',
      completedEcus: [...completedEcus],
      retryCycles,
      deliveryAttempts,
      events,
    };
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://tcu.local');
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(response, 200, { status: 'ok' });
    }
    if (request.method === 'GET' && url.pathname === '/state') {
      return sendJson(response, 200, { policy, lastCampaign });
    }
    if (request.method === 'POST' && url.pathname === '/reset') {
      return routeBody(request, response, async (body) => {
        lastCampaign = null;
        if (!body.preservePolicy) policy = { ...BROKEN_TCU_POLICY };
        return sendJson(response, 200, { reset: true, policy });
      });
    }
    if (request.method === 'PATCH' && url.pathname === '/policy') {
      return routeBody(request, response, async (body) => {
        policy = patchPolicy(policy, body);
        return sendJson(response, 200, { policy });
      });
    }
    if (request.method === 'POST' && url.pathname === '/campaign') {
      return routeBody(request, response, async (body) => {
        if (
          !body.campaignId ||
          !body.correlationId ||
          !Array.isArray(body.packages)
        ) {
          return sendJson(response, 400, { error: 'invalid_campaign' });
        }
        try {
          lastCampaign = await runCampaign(body);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'campaign_error';
          lastCampaign = {
            campaignId: body.campaignId,
            status: 'failed',
            reason: message,
            events: [],
          };
        }
        return sendJson(
          response,
          lastCampaign.status === 'completed' ? 200 : 409,
          lastCampaign
        );
      });
    }
    return sendJson(response, 404, { error: 'not_found' });
  });
  return server.listen(port, '0.0.0.0');
}
