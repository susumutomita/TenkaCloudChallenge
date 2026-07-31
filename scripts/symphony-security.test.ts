import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { redactBytes, redactTree } from './symphony-log-redactor';
import { parseWorkflow, validateProductionWorkflow } from './symphony-security';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const WORKFLOW_PATH = join(REPO_ROOT, '.symphony', 'WORKFLOW.md');
const REDACTOR_PATH = join(REPO_ROOT, 'scripts', 'symphony-log-redactor.ts');
const SECURE_WORKFLOW = readFileSync(WORKFLOW_PATH, 'utf8');

function replaceRequired(
  source: string,
  needle: string,
  replacement: string
): string {
  expect(source).toContain(needle);
  return source.replace(needle, replacement);
}

describe('Symphony production workflow security', () => {
  it('accepts the repository workflow and proves the test is non-vacuous', () => {
    const parsed = parseWorkflow(SECURE_WORKFLOW);

    expect(parsed.prompt).toContain('make symphony-agent-gate');
    expect(parsed.prompt).toContain(
      'must run the complete networked `make agent-gate`'
    );
    expect(parsed.prompt).toContain(
      'Do not create, switch, rename, push, or delete branches'
    );
    expect(validateProductionWorkflow(parsed)).toEqual([]);
  });

  it('rejects a raw, ambiguously named GitHub token', () => {
    const insecure = replaceRequired(
      SECURE_WORKFLOW,
      'token: $SYMPHONY_TRACKER_TOKEN',
      'token: $GITHUB_TOKEN'
    );

    expect(validateProductionWorkflow(parseWorkflow(insecure))).toContain(
      'tracker.provider.token must resolve only from $SYMPHONY_TRACKER_TOKEN'
    );
  });

  it('rejects repository-controlled hooks because they inherit the orchestrator context', () => {
    const insecure = replaceRequired(
      SECURE_WORKFLOW,
      'hooks: {}',
      'hooks:\n  after_create: echo "$SYMPHONY_TRACKER_TOKEN"'
    );

    expect(validateProductionWorkflow(parseWorkflow(insecure))).toContain(
      'hooks must be empty; workspace preparation belongs to the immutable agent launcher'
    );
  });

  it('rejects a repository-local coding-agent launcher', () => {
    const insecure = replaceRequired(
      SECURE_WORKFLOW,
      'command: /usr/local/libexec/tenkacloud-symphony-agent',
      'command: .symphony/operator/tenkacloud-symphony-agent'
    );

    expect(validateProductionWorkflow(parseWorkflow(insecure))).toContain(
      'codex.command must be the operator-installed absolute launcher path'
    );
  });

  it('rejects automatic approval, full filesystem access, and tool network access', () => {
    const automatic = replaceRequired(
      SECURE_WORKFLOW,
      'approval_policy: on-request',
      'approval_policy: never'
    );
    const fullAccess = replaceRequired(
      SECURE_WORKFLOW,
      'type: workspaceWrite',
      'type: dangerFullAccess'
    );
    const networked = replaceRequired(
      SECURE_WORKFLOW,
      'networkAccess: false',
      'networkAccess: true'
    );

    expect(validateProductionWorkflow(parseWorkflow(automatic))).toContain(
      'codex.approval_policy must be on-request'
    );
    expect(validateProductionWorkflow(parseWorkflow(fullAccess))).toContain(
      'codex.turn_sandbox_policy.type must be workspaceWrite'
    );
    expect(validateProductionWorkflow(parseWorkflow(networked))).toContain(
      'codex.turn_sandbox_policy.networkAccess must be false'
    );
  });

  it('rejects a short startup timeout and a normally completing handoff', () => {
    const shortTimeout = replaceRequired(
      SECURE_WORKFLOW,
      'read_timeout_ms: 900000',
      'read_timeout_ms: 5000'
    );
    const retryingHandoff = replaceRequired(
      SECURE_WORKFLOW,
      'handoff_mode: approval-block-then-human-unlabel',
      'handoff_mode: normal-completion'
    );

    expect(validateProductionWorkflow(parseWorkflow(shortTimeout))).toContain(
      'codex.read_timeout_ms must allow at least 15 minutes for cold bootstrap'
    );
    expect(
      validateProductionWorkflow(parseWorkflow(retryingHandoff))
    ).toContain(
      'security.lifecycle.handoff_mode must block retries until a human removes agent:ready'
    );
  });

  it('rejects missing external isolation, proxy-only egress, and secret declarations', () => {
    const noIsolation = replaceRequired(
      SECURE_WORKFLOW,
      'boundary: external-container',
      'boundary: workspace-only'
    );
    const directEgress = replaceRequired(
      SECURE_WORKFLOW,
      'mode: proxy-only',
      'mode: direct'
    );
    const undeclaredSecret = replaceRequired(
      SECURE_WORKFLOW,
      '    - SYMPHONY_TRACKER_TOKEN',
      '    - SOMETHING_ELSE'
    );

    expect(validateProductionWorkflow(parseWorkflow(noIsolation))).toContain(
      'security.isolation.boundary must be external-container'
    );
    expect(validateProductionWorkflow(parseWorkflow(directEgress))).toContain(
      'security.egress.mode must be proxy-only'
    );
    expect(
      validateProductionWorkflow(parseWorkflow(undeclaredSecret))
    ).toContain(
      'security.tracker_secret_environment_names must declare SYMPHONY_TRACKER_TOKEN'
    );
  });

  it('rejects a prompt that lets high-risk work auto-merge', () => {
    const insecure = replaceRequired(
      SECURE_WORKFLOW,
      'High-risk changes must stop at human review and protected checks. This runtime never merges',
      'High-risk changes may merge automatically. This runtime never merges'
    );

    expect(validateProductionWorkflow(parseWorkflow(insecure))).toContain(
      'prompt must require high-risk work to stop for human review'
    );
  });
});

describe('Symphony canary redaction', () => {
  it('redacts every binary occurrence without treating token text as a regular expression', () => {
    const canary = Buffer.from('tc_canary_123');
    const output = Buffer.from(`before ${canary} middle ${canary} after`);

    expect(redactBytes(output, canary).toString()).toBe(
      'before [REDACTED] middle [REDACTED] after'
    );
  });

  it('redacts both the live stream and the persisted runtime log tree', () => {
    const directory = mkdtempSync(join(tmpdir(), 'symphony-canary-'));
    const raw = join(directory, 'raw');
    const redacted = join(directory, 'redacted');
    const auth = join(directory, 'auth.json');
    const secretsFile = join(raw, '.redaction-secrets.json');
    const trackerCanary = `tc_canary_${crypto.randomUUID().replaceAll('-', '')}`;
    const modelCanary = `model_${crypto.randomUUID().replaceAll('-', '')}`;
    const refreshCanary = `refresh_${crypto.randomUUID().replaceAll('-', '')}`;
    mkdirSync(join(raw, 'log'), { recursive: true });
    mkdirSync(redacted);
    writeFileSync(
      auth,
      JSON.stringify({
        tokens: { access_token: modelCanary, refresh_token: refreshCanary },
      }),
      { mode: 0o600 }
    );

    const prepare = spawnSync(
      'bun',
      ['run', REDACTOR_PATH, '--prepare', auth, secretsFile],
      {
        env: {
          ...process.env,
          SYMPHONY_REDACTION_SECRET: trackerCanary,
        },
        encoding: 'utf8',
      }
    );
    expect(prepare.status, prepare.stderr).toBe(0);
    const secrets = (
      JSON.parse(readFileSync(secretsFile, 'utf8')) as string[]
    ).map((value) => Buffer.from(value));

    writeFileSync(
      join(raw, 'log', 'symphony.log'),
      Buffer.concat([
        Buffer.from([0, 1, 2]),
        Buffer.from(
          ` tracker=${trackerCanary} model=${modelCanary} refresh=${refreshCanary}`
        ),
      ])
    );

    redactTree(raw, redacted, secrets, secretsFile);
    const persisted = readFileSync(join(redacted, 'log', 'symphony.log'));
    expect(persisted.indexOf(trackerCanary)).toBe(-1);
    expect(persisted.indexOf(modelCanary)).toBe(-1);
    expect(persisted.indexOf(refreshCanary)).toBe(-1);
    expect(persisted.toString()).toContain(
      'tracker=[REDACTED] model=[REDACTED] refresh=[REDACTED]'
    );
    expect(() =>
      readFileSync(join(redacted, '.redaction-secrets.json'))
    ).toThrow();

    const stream = spawnSync('bun', ['run', REDACTOR_PATH, '--stream'], {
      env: {
        ...process.env,
        SYMPHONY_REDACTION_SECRETS_FILE: secretsFile,
      },
      input: `first ${trackerCanary} second ${modelCanary} third ${refreshCanary}\n`,
      encoding: 'utf8',
    });
    expect(stream.status, stream.stderr).toBe(0);
    expect(stream.stdout).toBe(
      'first [REDACTED] second [REDACTED] third [REDACTED]\n'
    );
  });
});
