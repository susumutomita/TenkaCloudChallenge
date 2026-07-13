import { afterEach, describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { startBusService } from './bus.mjs';
import { startEcuService } from './ecu.mjs';
import { startOtaService } from './ota.mjs';
import { startSigningService } from './signing.mjs';
import { startTcuService } from './tcu.mjs';

const CHECKPOINTS = [
  'signed-ordered-install',
  'package-rejection',
  'idempotent-resume',
  'known-good-rollback',
  'correlated-audit',
];

async function ready(server) {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('server port unavailable');
  return `http://127.0.0.1:${address.port}`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

describe('secure OTA HTTP and verifier flow', () => {
  const servers = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections();
            server.close(resolve);
          })
      )
    );
  });

  it('should fail the broken baseline and verify hardened behavior across real HTTP services', async () => {
    const signing = startSigningService(0);
    servers.push(signing);
    const signingUrl = await ready(signing);

    const ecuA = await startEcuService('ecu-a', 0, {
      signingUrl,
      dependencyUrls: {},
    });
    servers.push(ecuA);
    const ecuAUrl = await ready(ecuA);
    const ecuB = await startEcuService('ecu-b', 0, {
      signingUrl,
      dependencyUrls: { 'ecu-a': ecuAUrl },
    });
    servers.push(ecuB);
    const ecuBUrl = await ready(ecuB);

    const bus = startBusService(0, {
      targets: { 'ecu-a': ecuAUrl, 'ecu-b': ecuBUrl },
    });
    servers.push(bus);
    const busUrl = await ready(bus);
    const tcu = startTcuService(0, { busUrl });
    servers.push(tcu);
    const tcuUrl = await ready(tcu);
    const ota = startOtaService(0, 0, {
      signingUrl,
      tcuUrl,
      busUrl,
      ecuUrls: { 'ecu-a': ecuAUrl, 'ecu-b': ecuBUrl },
    });
    servers.push(ota.challenge, ota.verifier);
    const workshopUrl = await ready(ota.challenge);
    const verifierUrl = await ready(ota.verifier);

    for (const checkpointId of CHECKPOINTS) {
      const result = await request(`${verifierUrl}/verify`, {
        method: 'POST',
        body: { checkpointId, submission: 'VERIFY' },
      });
      expect(result).toMatchObject({
        status: 200,
        body: { checkpointId, correct: false },
      });
    }

    const hardened = await request(`${workshopUrl}/api/config`, {
      method: 'PATCH',
      body: {
        tcu: {
          dependencyOrder: true,
          resumeFromCheckpoint: true,
          maxRetries: 2,
          auditCorrelation: true,
        },
        ecu: {
          signatureMode: 'ed25519',
          versionPolicy: 'monotonic',
          dependencyCheck: true,
          rollbackOnHealthFailure: true,
        },
      },
    });
    expect(hardened.status).toBe(200);
    for (const ecuUrl of [ecuAUrl, ecuBUrl]) {
      const reset = await request(`${ecuUrl}/reset`, {
        method: 'POST',
        body: { preservePolicy: true },
      });
      expect(reset.status).toBe(200);
    }

    const sign = async (manifest, payload) => {
      const response = await request(`${signingUrl}/sign`, {
        method: 'POST',
        body: { manifest, payload, correlationId: 'integration-probe' },
      });
      expect(response.status).toBe(200);
      return response.body.package;
    };
    const wrongTargetPackage = await sign(
      { campaignId: 'wrong-target', ecuId: 'ecu-b', version: 2, dependsOn: [] },
      'ecu-b-v2'
    );
    const wrongTarget = await request(`${ecuAUrl}/install`, {
      method: 'POST',
      body: {
        package: wrongTargetPackage,
        correlationId: 'integration-probe',
        inventory: { 'ecu-a': 999, 'ecu-b': 999 },
      },
    });
    expect(wrongTarget).toMatchObject({
      status: 422,
      body: { reason: 'wrong_target' },
    });

    const dependencyPackage = await sign(
      {
        campaignId: 'spoofed-dependency',
        ecuId: 'ecu-b',
        version: 2,
        dependsOn: [{ ecuId: 'ecu-a', minVersion: 99 }],
      },
      'ecu-b-v2'
    );
    const spoofedDependency = await request(`${ecuBUrl}/install`, {
      method: 'POST',
      body: {
        package: dependencyPackage,
        correlationId: 'integration-probe',
        inventory: { 'ecu-a': 999, 'ecu-b': 999 },
      },
    });
    expect(spoofedDependency).toMatchObject({
      status: 422,
      body: { reason: 'dependency_not_satisfied' },
    });

    for (const checkpointId of CHECKPOINTS) {
      const result = await request(`${verifierUrl}/verify`, {
        method: 'POST',
        body: { checkpointId, submission: 'VERIFY' },
      });
      expect(result).toMatchObject({
        status: 200,
        body: { checkpointId, correct: true },
      });
    }

    const malformedRun = await request(`${workshopUrl}/run`, {
      method: 'POST',
      body: {},
    });
    const malformedInstall = await request(`${ecuAUrl}/install`, {
      method: 'POST',
      body: { package: {} },
    });
    const excessiveRetry = await request(`${workshopUrl}/api/config`, {
      method: 'PATCH',
      body: { tcu: { maxRetries: 6 } },
    });
    const invalidConfigBodies = [
      { tcu: 'not-an-object' },
      { tcu: { unexpectedControl: true } },
      { ecu: { unexpectedControl: true } },
      { unexpectedPlane: {} },
    ];
    for (const body of invalidConfigBodies) {
      const invalid = await request(`${workshopUrl}/api/config`, {
        method: 'PATCH',
        body,
      });
      expect(invalid.status).toBe(400);
    }
    const beforeAtomicPatch = await request(`${workshopUrl}/api/state`);
    const combinedInvalid = await request(`${workshopUrl}/api/config`, {
      method: 'PATCH',
      body: { tcu: { maxRetries: 1 }, ecu: { unexpectedControl: true } },
    });
    const afterAtomicPatch = await request(`${workshopUrl}/api/state`);
    expect(malformedRun.status).toBe(400);
    expect(malformedInstall.status).toBe(400);
    expect(excessiveRetry.status).toBe(400);
    expect(combinedInvalid.status).toBe(400);
    expect(afterAtomicPatch.body.tcu.policy).toEqual(
      beforeAtomicPatch.body.tcu.policy
    );

    const firstReset = await request(`${workshopUrl}/reset`, {
      method: 'POST',
    });
    const secondReset = await request(`${workshopUrl}/reset`, {
      method: 'POST',
    });
    expect(firstReset.status).toBe(200);
    expect(secondReset.status).toBe(200);
    expect(secondReset.body.state).toEqual(firstReset.body.state);
  }, 30_000);

  it('should fail loud when an internal reset or state response is unhealthy', async () => {
    const brokenComponent = createServer((request, response) => {
      response.writeHead(request.url === '/reset' ? 503 : 200, {
        'content-type': 'application/json',
      });
      response.end(request.url === '/reset' ? '{"reset":false}' : '{}');
    }).listen(0, '127.0.0.1');
    servers.push(brokenComponent);
    const brokenUrl = await ready(brokenComponent);

    const ota = startOtaService(0, 0, {
      signingUrl: brokenUrl,
      tcuUrl: brokenUrl,
      busUrl: brokenUrl,
      ecuUrls: { 'ecu-a': brokenUrl, 'ecu-b': brokenUrl },
    });
    servers.push(ota.challenge, ota.verifier);
    const workshopUrl = await ready(ota.challenge);

    const reset = await request(`${workshopUrl}/reset`, { method: 'POST' });
    const state = await request(`${workshopUrl}/api/state`);
    expect(reset).toMatchObject({
      status: 400,
      body: { error: 'runtime_reset_failed:tcu' },
    });
    expect(state).toMatchObject({
      status: 502,
      body: { error: 'runtime_state_failed:tcu' },
    });
  });

  it('should reject malformed TCU campaigns and failed bus fault injection', async () => {
    const signing = startSigningService(0);
    servers.push(signing);
    const signingUrl = await ready(signing);
    const ecuA = await startEcuService('ecu-a', 0, {
      signingUrl,
      dependencyUrls: {},
    });
    servers.push(ecuA);
    const ecuAUrl = await ready(ecuA);
    const ecuB = await startEcuService('ecu-b', 0, {
      signingUrl,
      dependencyUrls: { 'ecu-a': ecuAUrl },
    });
    servers.push(ecuB);
    const ecuBUrl = await ready(ecuB);
    const bus = startBusService(0, {
      targets: { 'ecu-a': ecuAUrl, 'ecu-b': ecuBUrl },
    });
    servers.push(bus);
    const busUrl = await ready(bus);

    const malformedTcu = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/reset') return response.end('{"reset":true}');
      if (request.url === '/state') {
        return response.end('{"policy":{},"lastCampaign":null}');
      }
      response.statusCode = 500;
      return response.end(
        '{"campaignId":"campaign-signed-ordered","status":"failed","events":[]}'
      );
    }).listen(0, '127.0.0.1');
    servers.push(malformedTcu);
    const malformedTcuUrl = await ready(malformedTcu);
    const campaignOta = startOtaService(0, 0, {
      signingUrl,
      tcuUrl: malformedTcuUrl,
      busUrl,
      ecuUrls: { 'ecu-a': ecuAUrl, 'ecu-b': ecuBUrl },
    });
    servers.push(campaignOta.challenge, campaignOta.verifier);
    const campaignWorkshop = await ready(campaignOta.challenge);
    const malformedCampaign = await request(`${campaignWorkshop}/run`, {
      method: 'POST',
      body: { scenario: 'signed-ordered' },
    });
    expect(malformedCampaign).toMatchObject({
      status: 400,
      body: { error: 'runtime_campaign_failed:tcu' },
    });

    const brokenBus = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/reset') return response.end('{"reset":true}');
      if (request.url === '/state') {
        return response.end('{"deliveries":[],"fault":{}}');
      }
      response.statusCode = 503;
      return response.end('{"fault":null}');
    }).listen(0, '127.0.0.1');
    servers.push(brokenBus);
    const brokenBusUrl = await ready(brokenBus);
    const tcu = startTcuService(0, { busUrl: brokenBusUrl });
    servers.push(tcu);
    const tcuUrl = await ready(tcu);
    const faultOta = startOtaService(0, 0, {
      signingUrl,
      tcuUrl,
      busUrl: brokenBusUrl,
      ecuUrls: { 'ecu-a': ecuAUrl, 'ecu-b': ecuBUrl },
    });
    servers.push(faultOta.challenge, faultOta.verifier);
    const faultWorkshop = await ready(faultOta.challenge);
    const failedFaultSetup = await request(`${faultWorkshop}/run`, {
      method: 'POST',
      body: { scenario: 'resume' },
    });
    expect(failedFaultSetup).toMatchObject({
      status: 400,
      body: { error: 'bus_fault_injection_failed' },
    });
  });
});
