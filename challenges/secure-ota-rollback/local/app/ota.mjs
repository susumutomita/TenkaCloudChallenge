import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { validateConfigPatch } from './configuration.mjs';
import { hasCorrelatedAudit, makeEvent } from './domain.mjs';
import { callJson, routeBody, sendHtml, sendJson } from './http.mjs';
import { hashPayload } from './security.mjs';

const PUBLIC_SCENARIOS = new Set([
  'signed-ordered',
  'tampered',
  'unsigned',
  'downgrade',
  'resume',
  'health-failure',
  'audit-trace',
]);

const CHECKPOINTS = new Set([
  'signed-ordered-install',
  'package-rejection',
  'idempotent-resume',
  'known-good-rollback',
  'correlated-audit',
]);

const WORKSHOP_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Northstar OTA Recovery Console</title>
  <style>
    body { font: 16px/1.55 system-ui, sans-serif; max-width: 72rem; margin: auto; padding: 2rem; color: #172033; }
    h1, h2 { line-height: 1.2; } code, pre { background: #eef2f8; border-radius: .35rem; }
    code { padding: .1rem .3rem; } pre { padding: 1rem; overflow: auto; }
    .warning { border-left: .35rem solid #d97706; padding-left: 1rem; }
  </style>
</head>
<body>
  <h1>Northstar OTA Recovery Console</h1>
  <p class="warning">Training tenant. Every service is isolated on a Docker-internal network.</p>
  <p>A rushed OTA handoff left several safety controls in permissive modes. Observe a scenario, inspect
  the state and audit trail, change the controls, then run the scenario again.</p>
  <h2>First observations</h2>
  <pre>curl -s http://127.0.0.1:18100/api/state
curl -s -X POST http://127.0.0.1:18100/run -H 'content-type: application/json' \
  -d '{"scenario":"signed-ordered"}'</pre>
  <h2>Endpoints</h2>
  <ul>
    <li><code>GET /api/state</code> — controls, ECU slots, bus delivery log, audit trace</li>
    <li><code>PATCH /api/config</code> — change TCU and ECU safety controls</li>
    <li><code>POST /run</code> — run one bounded scenario</li>
    <li><code>POST /reset</code> — restore the original broken state</li>
  </ul>
  <p>The participant portal submits <code>VERIFY</code> to the loopback verifier on port 18101.</p>
</body>
</html>`;

function activeVersion(ecuResult) {
  const state = ecuResult.state;
  return state.slots[state.activeSlot]?.version ?? -1;
}

function safetyState(ecuResult) {
  const { activeSlot, installCount, knownGoodSlot, slots } = ecuResult.state;
  return { activeSlot, installCount, knownGoodSlot, slots };
}

export function isCampaignResult(data, campaignId, httpStatus) {
  return (
    data?.campaignId === campaignId &&
    ['completed', 'failed'].includes(data.status) &&
    Array.isArray(data.events) &&
    ((httpStatus === 200 && data.status === 'completed') ||
      (httpStatus === 409 && data.status === 'failed'))
  );
}

export function startOtaService(
  challengePort = 8080,
  verifyPort = 8081,
  options = {}
) {
  const signingUrl =
    options.signingUrl ?? process.env.SIGNING_URL ?? 'http://signing:8080';
  const tcuUrl = options.tcuUrl ?? process.env.TCU_URL ?? 'http://tcu:8080';
  const busUrl = options.busUrl ?? process.env.BUS_URL ?? 'http://bus:8080';
  const ecuUrls = options.ecuUrls ?? {
    'ecu-a': process.env.ECU_A_URL ?? 'http://ecu-a:8080',
    'ecu-b': process.env.ECU_B_URL ?? 'http://ecu-b:8080',
  };
  let audit = [];
  let operationQueue = Promise.resolve();

  const serialized = (operation) => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => undefined);
    return result;
  };

  const resetRuntime = async (preservePolicy) => {
    const requests = [
      ['tcu', `${tcuUrl}/reset`, { preservePolicy }],
      ['bus', `${busUrl}/reset`, {}],
      ['ecu-a', `${ecuUrls['ecu-a']}/reset`, { preservePolicy }],
      ['ecu-b', `${ecuUrls['ecu-b']}/reset`, { preservePolicy }],
    ];
    const results = await Promise.allSettled(
      requests.map(([, url, body]) => callJson(url, { method: 'POST', body }))
    );
    for (const [index, result] of results.entries()) {
      if (
        result.status !== 'fulfilled' ||
        !result.value.ok ||
        result.value.data.reset !== true
      ) {
        throw new Error(`runtime_reset_failed:${requests[index][0]}`);
      }
    }
    audit = [];
  };

  const snapshot = async () => {
    const requests = [
      ['tcu', `${tcuUrl}/state`],
      ['bus', `${busUrl}/state`],
      ['ecu-a', `${ecuUrls['ecu-a']}/state`],
      ['ecu-b', `${ecuUrls['ecu-b']}/state`],
    ];
    const results = await Promise.allSettled(
      requests.map(([, url]) => callJson(url))
    );
    const validShapes = [
      (data) => data && typeof data.policy === 'object' && data.policy !== null,
      (data) =>
        data &&
        Array.isArray(data.deliveries) &&
        typeof data.fault === 'object',
      (data) =>
        data &&
        typeof data.policy === 'object' &&
        data.policy !== null &&
        typeof data.state === 'object' &&
        data.state !== null &&
        typeof data.state.slots === 'object' &&
        data.state.slots !== null,
      (data) =>
        data &&
        typeof data.policy === 'object' &&
        data.policy !== null &&
        typeof data.state === 'object' &&
        data.state !== null &&
        typeof data.state.slots === 'object' &&
        data.state.slots !== null,
    ];
    for (const [index, result] of results.entries()) {
      if (
        result.status !== 'fulfilled' ||
        !result.value.ok ||
        !validShapes[index](result.value.data)
      ) {
        throw new Error(`runtime_state_failed:${requests[index][0]}`);
      }
    }
    const [tcu, bus, ecuA, ecuB] = results.map((result) => result.value);
    return {
      tcu: tcu.data,
      bus: bus.data,
      ecus: { 'ecu-a': ecuA.data, 'ecu-b': ecuB.data },
      audit,
    };
  };

  const signedPackage = async (manifest, payload, correlationId) => {
    const result = await callJson(`${signingUrl}/sign`, {
      method: 'POST',
      body: { manifest, payload, correlationId },
    });
    if (!result.ok || !result.data.package) throw new Error('signing_failed');
    audit.push(result.data.event);
    return result.data.package;
  };

  const packageSet = async (campaignId, correlationId, options = {}) => {
    const ecuA = await signedPackage(
      {
        campaignId,
        ecuId: 'ecu-a',
        version: options.ecuAVersion ?? 2,
        dependsOn: [],
      },
      `ecu-a-firmware-v${options.ecuAVersion ?? 2}`,
      correlationId
    );
    const ecuB = await signedPackage(
      {
        campaignId,
        ecuId: 'ecu-b',
        version: options.ecuBVersion ?? 2,
        dependsOn: [
          { ecuId: 'ecu-a', minVersion: options.ecuADependency ?? 2 },
        ],
      },
      `ecu-b-firmware-v${options.ecuBVersion ?? 2}`,
      correlationId
    );
    return { ecuA, ecuB };
  };

  const runCampaign = async (campaignId, packages, correlationId) => {
    const result = await callJson(`${tcuUrl}/campaign`, {
      method: 'POST',
      timeoutMs: 10_000,
      body: { campaignId, packages, correlationId },
    });
    if (!isCampaignResult(result.data, campaignId, result.status)) {
      throw new Error('runtime_campaign_failed:tcu');
    }
    audit.push(...result.data.events);
    return result.data;
  };

  const runScenario = async (scenario) => {
    await resetRuntime(true);
    const correlationId = randomUUID();
    const campaignId = `campaign-${scenario}`;
    audit.push(
      makeEvent('ota', 'scenario_started', correlationId, {
        scenario,
        campaignId,
        result: 'started',
      })
    );
    let packages = [];

    if (['signed-ordered', 'audit-trace'].includes(scenario)) {
      const { ecuA, ecuB } = await packageSet(campaignId, correlationId);
      packages = [ecuB, ecuA];
    } else if (['resume', 'resume-limit'].includes(scenario)) {
      const { ecuA, ecuB } = await packageSet(campaignId, correlationId);
      packages = [ecuA, ecuB];
      const fault = await callJson(`${busUrl}/fault`, {
        method: 'POST',
        body: { ecuId: 'ecu-b', failures: scenario === 'resume' ? 1 : 3 },
      });
      if (!fault.ok || fault.data.fault?.ecuId !== 'ecu-b') {
        throw new Error('bus_fault_injection_failed');
      }
    } else if (scenario === 'health-failure') {
      const { ecuA } = await packageSet(campaignId, correlationId);
      packages = [ecuA];
      const fault = await callJson(`${ecuUrls['ecu-a']}/fault`, {
        method: 'POST',
        body: { bootFailures: 1 },
      });
      if (!fault.ok) throw new Error('boot_fault_injection_failed');
    } else if (scenario === 'downgrade') {
      const { ecuA } = await packageSet(campaignId, correlationId, {
        ecuAVersion: 0,
      });
      packages = [ecuA];
    } else if (scenario === 'unsigned') {
      const { ecuA } = await packageSet(campaignId, correlationId);
      packages = [{ ...ecuA, signature: '' }];
    } else if (scenario === 'tampered') {
      const { ecuA } = await packageSet(campaignId, correlationId);
      const payload = 'unapproved-firmware';
      packages = [
        {
          ...ecuA,
          payload,
          manifest: { ...ecuA.manifest, payloadHash: hashPayload(payload) },
        },
      ];
    } else {
      throw new Error('unknown_scenario');
    }

    const campaign = await runCampaign(campaignId, packages, correlationId);
    audit.push(
      makeEvent('ota', 'scenario_finished', correlationId, {
        scenario,
        campaignId,
        status: campaign.status,
        result: campaign.status,
      })
    );
    return { scenario, correlationId, campaign, state: await snapshot() };
  };

  const configure = async (body) => {
    validateConfigPatch(body);
    const results = [];
    if (body.tcu) {
      results.push(
        await callJson(`${tcuUrl}/policy`, { method: 'PATCH', body: body.tcu })
      );
    }
    if (body.ecu) {
      results.push(
        ...(await Promise.all(
          Object.values(ecuUrls).map((baseUrl) =>
            callJson(`${baseUrl}/policy`, { method: 'PATCH', body: body.ecu })
          )
        ))
      );
    }
    const failed = results.find((result) => !result.ok);
    if (failed) throw new Error(failed.data.error ?? 'policy_update_failed');
    return snapshot();
  };

  const verifySignedOrdered = async () => {
    const outcome = await runScenario('signed-ordered');
    const deliveredOrder = outcome.state.bus.deliveries
      .filter((entry) => entry.delivered)
      .map((entry) => entry.ecuId);
    const installed =
      outcome.campaign.status === 'completed' &&
      activeVersion(outcome.state.ecus['ecu-a']) === 2 &&
      activeVersion(outcome.state.ecus['ecu-b']) === 2 &&
      deliveredOrder.join(',') === 'ecu-a,ecu-b';

    const dependencyProbe = await signedPackage(
      {
        campaignId: 'dependency-probe',
        ecuId: 'ecu-b',
        version: 3,
        dependsOn: [{ ecuId: 'ecu-a', minVersion: 3 }],
      },
      'ecu-b-firmware-v3',
      outcome.correlationId
    );
    const probe = await callJson(`${busUrl}/deliver`, {
      method: 'POST',
      body: {
        package: dependencyProbe,
        inventory: { 'ecu-a': 999, 'ecu-b': 999 },
        correlationId: outcome.correlationId,
      },
    });
    const wrongTargetPackage = await signedPackage(
      {
        campaignId: 'wrong-target-probe',
        ecuId: 'ecu-b',
        version: 3,
        dependsOn: [],
      },
      'ecu-b-wrong-target-v3',
      outcome.correlationId
    );
    const wrongTarget = await callJson(`${ecuUrls['ecu-a']}/install`, {
      method: 'POST',
      body: {
        package: wrongTargetPackage,
        correlationId: outcome.correlationId,
      },
    });
    return (
      installed &&
      !probe.data.delivered &&
      probe.data.reason === 'dependency_not_satisfied' &&
      !wrongTarget.data.installed &&
      wrongTarget.data.reason === 'wrong_target'
    );
  };

  const verifyPackageRejection = async () => {
    for (const scenario of ['tampered', 'unsigned', 'downgrade']) {
      await resetRuntime(true);
      const before = safetyState((await snapshot()).ecus['ecu-a']);
      const outcome = await runScenario(scenario);
      const after = safetyState(outcome.state.ecus['ecu-a']);
      if (
        outcome.campaign.status !== 'failed' ||
        JSON.stringify(after) !== JSON.stringify(before)
      ) {
        return false;
      }
    }
    return true;
  };

  const verifyIdempotentResume = async () => {
    const resumed = await runScenario('resume');
    const ecuA = resumed.state.ecus['ecu-a'].state;
    const ecuB = resumed.state.ecus['ecu-b'].state;
    if (
      resumed.campaign.status !== 'completed' ||
      resumed.campaign.retryCycles !== 1 ||
      ecuA.installCount !== 1 ||
      ecuB.installCount !== 1
    ) {
      return false;
    }
    const bounded = await runScenario('resume-limit');
    return (
      bounded.campaign.status === 'failed' &&
      bounded.campaign.reason === 'retry_limit_reached'
    );
  };

  const verifyKnownGoodRollback = async () => {
    const outcome = await runScenario('health-failure');
    const ecu = outcome.state.ecus['ecu-a'].state;
    return (
      outcome.campaign.status === 'completed' &&
      ecu.activeSlot === 'A' &&
      ecu.knownGoodSlot === 'A' &&
      ecu.slots.A.version === 1 &&
      ecu.slots.B.version === 2 &&
      ecu.slots.B.healthy === false &&
      ecu.lastResult === 'rolled_back'
    );
  };

  const verifyCorrelatedAudit = async () => {
    const outcome = await runScenario('audit-trace');
    const steps = [
      { component: 'ota', action: 'scenario_started' },
      { component: 'signing', action: 'package_signed' },
      { component: 'signing', action: 'package_signed' },
      { component: 'tcu', action: 'campaign_started' },
      { component: 'bus', action: 'delivery_attempt' },
      { component: 'ecu-a', action: 'installed' },
      { component: 'bus', action: 'delivery_attempt' },
      { component: 'ecu-b', action: 'installed' },
      { component: 'tcu', action: 'campaign_completed' },
      { component: 'ota', action: 'scenario_finished' },
    ];
    const events = outcome.state.audit;
    const eventDetailsComplete = events.every((event) => {
      if (['signing', 'bus', 'ecu-a', 'ecu-b'].includes(event.component)) {
        return (
          typeof event.ecuId === 'string' && Number.isInteger(event.version)
        );
      }
      return true;
    });
    return (
      eventDetailsComplete &&
      hasCorrelatedAudit(
        events,
        ['signing', 'ota', 'tcu', 'bus', 'ecu-a', 'ecu-b'],
        {
          campaignId: outcome.campaign.campaignId,
          steps,
        }
      )
    );
  };

  const verifyCheckpoint = async (checkpointId, submission) => {
    if (!CHECKPOINTS.has(checkpointId)) {
      return {
        status: 400,
        body: { checkpointId, correct: false, error: 'unknown_checkpoint' },
      };
    }
    if (submission !== 'VERIFY') {
      return {
        status: 200,
        body: { checkpointId, correct: false, message: 'submit_VERIFY' },
      };
    }
    const checks = {
      'signed-ordered-install': verifySignedOrdered,
      'package-rejection': verifyPackageRejection,
      'idempotent-resume': verifyIdempotentResume,
      'known-good-rollback': verifyKnownGoodRollback,
      'correlated-audit': verifyCorrelatedAudit,
    };
    const correct = await checks[checkpointId]();
    return {
      status: 200,
      body: {
        checkpointId,
        correct,
        message: correct
          ? 'checkpoint_verified'
          : 'controls_or_behavior_still_incomplete',
      },
    };
  };

  const challenge = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://ota.local');
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(response, 200, { status: 'ok' });
    }
    if (request.method === 'GET' && url.pathname === '/') {
      return sendHtml(response, 200, WORKSHOP_HTML);
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      try {
        return sendJson(response, 200, await snapshot());
      } catch (error) {
        return sendJson(response, 502, {
          error:
            error instanceof Error ? error.message : 'runtime_state_failed',
        });
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/audit') {
      return sendJson(response, 200, { audit });
    }
    if (request.method === 'GET' && url.pathname === '/api/scenarios') {
      return sendJson(response, 200, { scenarios: [...PUBLIC_SCENARIOS] });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/config') {
      return routeBody(request, response, async (body) => {
        try {
          return sendJson(
            response,
            200,
            await serialized(() => configure(body))
          );
        } catch (error) {
          return sendJson(response, 400, {
            error: error instanceof Error ? error.message : 'invalid_config',
          });
        }
      });
    }
    if (request.method === 'POST' && url.pathname === '/run') {
      return routeBody(request, response, async (body) => {
        if (!PUBLIC_SCENARIOS.has(body.scenario)) {
          return sendJson(response, 400, { error: 'unknown_scenario' });
        }
        return sendJson(
          response,
          200,
          await serialized(() => runScenario(body.scenario))
        );
      });
    }
    if (request.method === 'POST' && url.pathname === '/reset') {
      return routeBody(request, response, async () =>
        sendJson(
          response,
          200,
          await serialized(async () => {
            await resetRuntime(false);
            return { reset: true, state: await snapshot() };
          })
        )
      );
    }
    return sendJson(response, 404, { error: 'not_found' });
  });

  const verifier = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://verifier.local');
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(response, 200, { status: 'ok' });
    }
    if (request.method === 'POST' && url.pathname === '/verify') {
      return routeBody(request, response, async (body) => {
        const result = await serialized(() =>
          verifyCheckpoint(body.checkpointId, body.submission)
        );
        return sendJson(response, result.status, result.body);
      });
    }
    return sendJson(response, 404, { error: 'not_found' });
  });

  return {
    challenge: challenge.listen(challengePort, '0.0.0.0'),
    verifier: verifier.listen(verifyPort, '0.0.0.0'),
  };
}
