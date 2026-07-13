import { createServer } from 'node:http';
import { validateEcuPolicyPatch } from './configuration.mjs';
import {
  applyToInactiveSlot,
  createEcuState,
  currentVersion,
  makeEvent,
} from './domain.mjs';
import { callJson, routeBody, sendJson } from './http.mjs';
import { BROKEN_ECU_POLICY, packageVerdict } from './security.mjs';

function patchPolicy(current, patch) {
  validateEcuPolicyPatch(patch);
  return { ...current, ...patch };
}

export async function startEcuService(ecuId, port = 8080, options = {}) {
  const signingUrl =
    options.signingUrl ?? process.env.SIGNING_URL ?? 'http://signing:8080';
  const dependencyUrls = options.dependencyUrls ?? {
    'ecu-a': process.env.ECU_A_URL ?? 'http://ecu-a:8080',
    'ecu-b': process.env.ECU_B_URL ?? 'http://ecu-b:8080',
  };
  let state = createEcuState(ecuId);
  let policy = { ...BROKEN_ECU_POLICY };
  let bootFailuresRemaining = 0;
  const keyResponse = await callJson(`${signingUrl}/public-key`);
  if (
    !keyResponse.ok ||
    keyResponse.data.algorithm !== 'Ed25519' ||
    typeof keyResponse.data.publicKey !== 'string'
  ) {
    throw new Error('signing_public_key_unavailable');
  }
  const publicKey = keyResponse.data.publicKey;

  const dependencyInventory = async (packageData) => {
    const inventory = { [ecuId]: currentVersion(state) };
    if (
      !policy.dependencyCheck ||
      !Array.isArray(packageData?.manifest?.dependsOn)
    ) {
      return inventory;
    }
    for (const dependency of packageData.manifest.dependsOn) {
      const baseUrl = dependencyUrls[dependency?.ecuId];
      if (!baseUrl) continue;
      try {
        const result = await callJson(`${baseUrl}/state`);
        if (result.ok && result.data.state) {
          inventory[dependency.ecuId] = currentVersion(result.data.state);
        }
      } catch {
        inventory[dependency.ecuId] = -1;
      }
    }
    return inventory;
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${ecuId}.local`);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(response, 200, { status: 'ok', ecuId });
    }
    if (request.method === 'GET' && url.pathname === '/state') {
      return sendJson(response, 200, {
        state,
        policy,
        fault: { bootFailuresRemaining },
      });
    }
    if (request.method === 'POST' && url.pathname === '/reset') {
      return routeBody(request, response, async (body) => {
        state = createEcuState(ecuId);
        bootFailuresRemaining = 0;
        if (!body.preservePolicy) policy = { ...BROKEN_ECU_POLICY };
        return sendJson(response, 200, {
          reset: true,
          state,
          policy,
          fault: { bootFailuresRemaining },
        });
      });
    }
    if (request.method === 'POST' && url.pathname === '/fault') {
      return routeBody(request, response, async (body) => {
        if (
          !Number.isInteger(body.bootFailures) ||
          body.bootFailures < 0 ||
          body.bootFailures > 1
        ) {
          return sendJson(response, 400, { error: 'invalid_boot_fault' });
        }
        bootFailuresRemaining = body.bootFailures;
        return sendJson(response, 200, { fault: { bootFailuresRemaining } });
      });
    }
    if (request.method === 'PATCH' && url.pathname === '/policy') {
      return routeBody(request, response, async (body) => {
        policy = patchPolicy(policy, body);
        return sendJson(response, 200, { policy });
      });
    }
    if (request.method === 'POST' && url.pathname === '/install') {
      return routeBody(request, response, async (body) => {
        if (!body.package || !body.correlationId) {
          return sendJson(response, 400, {
            error: 'package_and_correlation_required',
          });
        }
        const verdict = packageVerdict(body.package, publicKey, {
          ecuId,
          currentVersion: currentVersion(state),
          inventory: await dependencyInventory(body.package),
          policy,
        });
        if (!verdict.accepted) {
          state = { ...state, lastResult: verdict.reason };
          return sendJson(response, 422, {
            installed: false,
            reason: verdict.reason,
            event: makeEvent(ecuId, 'package_rejected', body.correlationId, {
              result: 'rejected',
              reason: verdict.reason,
              campaignId: body.package.manifest.campaignId,
              ecuId,
              version: body.package.manifest.version,
            }),
            state,
          });
        }
        const bootHealthy = bootFailuresRemaining === 0;
        if (bootFailuresRemaining > 0) bootFailuresRemaining -= 1;
        state = applyToInactiveSlot(
          state,
          body.package.manifest,
          policy.rollbackOnHealthFailure,
          bootHealthy
        );
        return sendJson(response, 200, {
          installed: true,
          rolledBack: state.lastResult === 'rolled_back',
          event: makeEvent(ecuId, state.lastResult, body.correlationId, {
            result: state.lastResult,
            ecuId,
            version: body.package.manifest.version,
            campaignId: body.package.manifest.campaignId,
            activeSlot: state.activeSlot,
            bootHealthy,
          }),
          state,
        });
      });
    }
    return sendJson(response, 404, { error: 'not_found' });
  });
  return server.listen(port, '0.0.0.0');
}
