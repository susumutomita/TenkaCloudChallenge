import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const challengeRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(challengeRoot, path), 'utf8');

describe('secure-ota-rollback catalog contract', () => {
  it('should declare exactly five bilingual multi-verify checkpoints', () => {
    const metadata = JSON.parse(read('metadata.json'));
    const checks = metadata.scoring.checks;
    const englishChecks = metadata.i18n.en.checks;
    const checkpointIds = [
      'signed-ordered-install',
      'package-rejection',
      'idempotent-resume',
      'known-good-rollback',
      'correlated-audit',
    ];

    expect(metadata.runtime).toMatchObject({
      provider: 'docker',
      engine: 'compose',
    });
    expect(metadata.scoring.kind).toBe('multi-verify');
    expect(checks.map(({ id }) => id)).toEqual(checkpointIds);
    expect(englishChecks.map(({ id }) => id)).toEqual(checkpointIds);
    expect(checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    expect(new Set(metadata.relations.map(({ type }) => type))).toEqual(
      new Set(['teaches', 'covers', 'requires', 'assesses', 'related_to'])
    );

    const nodeIds = Object.values(metadata.nodes).flatMap((nodes) =>
      nodes.map(({ id }) => id)
    );
    for (const id of [
      'concept.digital-signature',
      'concept.version-metadata',
      'concept.idempotency',
      'concept.safe-state',
      'concept.audit-trail',
      'concept.linux-process-observation',
      'concept.service-network-observability',
      'misconception.encryption-implies-authenticity',
      'misconception.rollback-always-safe',
      'audience.oem-architect',
      'audience.ecu-supplier-engineer',
      'audience.ota-operator',
      'audience.soc-analyst',
    ]) {
      expect(nodeIds).toContain(id);
    }

    const answerFieldNames = [
      'signatureMode',
      'versionPolicy',
      'dependencyCheck',
      'rollbackOnHealthFailure',
      'dependencyOrder',
      'resumeFromCheckpoint',
      'maxRetries',
      'auditCorrelation',
    ];
    for (const check of [...checks, ...englishChecks]) {
      expect(check.hints).toHaveLength(3);
      const designPrincipleHint = check.hints.at(-1).content;
      for (const fieldName of answerFieldNames) {
        expect(designPrincipleHint).not.toContain(fieldName);
      }
    }
  });

  it('should isolate six bounded services without privileged access or host mounts', () => {
    const compose = read('local/docker-compose.yml');
    const dockerfile = read('local/Dockerfile');
    const signing = read('local/app/signing.mjs');
    const domain = read('local/app/domain.mjs');
    const metadata = JSON.parse(read('metadata.json'));

    for (const service of ['signing', 'ota', 'bus', 'tcu', 'ecu-a', 'ecu-b']) {
      expect(compose).toContain(`  ${service}:`);
    }
    expect(compose).toContain('127.0.0.1:18100:8080');
    expect(compose).toContain('127.0.0.1:18101:8081');
    expect(compose).toContain('internal: true');
    expect(compose).toContain('workshop-host:');
    expect(compose).toMatch(
      /com\.docker\.network\.bridge\.enable_ip_masquerade:\s+['"]false['"]/
    );
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('mem_limit:');
    expect(compose).not.toContain('privileged:');
    expect(compose).not.toMatch(/-\s+[.]{0,2}\//);
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toMatch(/^FROM node:22-alpine@sha256:[a-f0-9]{64}$/m);
    expect(metadata.runtime.secretEnv).toBeUndefined();
    expect(compose).not.toContain('signing-private');
    expect(compose).not.toContain('trust-public');
    expect(signing).not.toContain('writeFileSync');
    expect(signing).not.toContain('healthy');
    expect(domain).not.toContain('manifest.healthy');
  });

  it('should ship mirrored learner guidance, architecture, and a human review rubric', () => {
    const english = read('README.md');
    const japanese = read('README.ja.md');
    const facilitator = read('FACILITATOR.md');
    const facilitatorJapanese = read('FACILITATOR.ja.md');
    const diagram = read('diagram.svg');

    for (const document of [english, japanese]) {
      expect(document).toContain('/run');
      expect(document).toContain('/verify');
      expect(document).toContain('/reset');
      expect(document).toContain('RACI');
    }
    for (const document of [facilitator, facilitatorJapanese]) {
      expect(document).toContain('Threat model');
      expect(document).toContain('Residual risk');
      expect(document).toContain('100');
    }
    expect(diagram).toContain('Signing');
    expect(diagram).toContain('OTA Workshop');
    expect(diagram).toContain('TCU');
    expect(diagram).toContain('User-space Bus');
    expect(diagram).toContain('ECU A');
    expect(diagram).toContain('ECU B');
  });
});
