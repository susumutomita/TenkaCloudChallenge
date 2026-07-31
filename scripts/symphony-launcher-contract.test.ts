import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const OPERATOR_ROOT = join(REPO_ROOT, '.symphony', 'operator');
const AGENT_SOURCE = join(OPERATOR_ROOT, 'tenkacloud-symphony-agent');
const HOST_SOURCE = join(OPERATOR_ROOT, 'tenkacloud-symphony-host');

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function sha256(path: string): string {
  const result = Bun.spawnSync(['shasum', '-a', '256', path]);
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().split(/\s+/)[0] ?? '';
}

describe('operator launcher source contract', () => {
  it.each([AGENT_SOURCE, HOST_SOURCE])('%s has valid Bash syntax', (path) => {
    const result = spawnSync('bash', ['-n', path], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });

  it('host launcher clears ambient variables and redacts the tracker canary', () => {
    const source = readFileSync(HOST_SOURCE, 'utf8');

    expect(source).toContain('/usr/bin/env -i');
    expect(source).toContain('GITHUB_TOKEN GH_TOKEN AWS_ACCESS_KEY_ID');
    expect(source).toContain('"$EXPECTED_REDACTOR" --stream');
    expect(source).toContain('"$EXPECTED_REDACTOR" --prepare');
    expect(source).toContain(
      'SYMPHONY_REDACTION_SECRETS_FILE="$redaction_secrets_file"'
    );
    expect(source).toContain(
      '"$EXPECTED_REDACTOR" --tree "$raw_logs_root" "$redacted_run_root/internal"'
    );
    expect(source).toContain('require_operator_file');
    expect(source).toContain('require_operator_config');
    expect(source).toContain('canonical_private_directory');
    expect(source).toContain('require_tmpfs');
    expect(source).toContain(
      'readonly EXPECTED_WORKFLOW="/etc/tenkacloud-symphony/WORKFLOW.md"'
    );
    expect(source).not.toContain('eval ');
  });

  it('agent launcher enforces a pinned image and hardened Docker boundary', () => {
    const source = readFileSync(AGENT_SOURCE, 'utf8');

    for (const required of [
      '@sha256:',
      '--read-only',
      '--pull never',
      '--cap-drop ALL',
      '--security-opt no-new-privileges',
      '--pids-limit 512',
      '--memory 4g',
      '--network "$SYMPHONY_AGENT_NETWORK"',
      'require_internal_network',
      'SYMPHONY_AGENT_PROXY',
      'bun install --cwd battles/microservice-migration-battle/services',
      'git -c core.hooksPath=/dev/null switch -c "$issue_branch"',
    ]) {
      expect(source).toContain(required);
    }
    expect(source).not.toContain('/var/run/docker.sock');
    expect(source).not.toContain('--network host');
    expect(source).not.toContain('--privileged');
  });

  it('fails closed before Docker when a tracker canary reaches the agent launcher', () => {
    const markerRoot = mkdtempSync(join(tmpdir(), 'symphony-secret-'));
    const marker = join(markerRoot, 'docker-called');
    const fakeBin = join(markerRoot, 'bin');
    mkdirSync(fakeBin);
    writeExecutable(
      join(fakeBin, 'docker'),
      `#!/bin/sh\nprintf called > "${marker}"\nexit 0\n`
    );

    const result = spawnSync('bash', [AGENT_SOURCE], {
      cwd: markerRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:/usr/bin:/bin`,
        SYMPHONY_TRACKER_TOKEN: 'tc-canary-must-not-cross',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(78);
    expect(result.stderr).toContain(
      'refusing to start because SYMPHONY_TRACKER_TOKEN reached the agent launcher'
    );
    expect(existsSync(marker)).toBe(false);
  });

  it('passes only explicit proxy and model-auth inputs to two restricted containers', () => {
    const root = mkdtempSync(join(tmpdir(), 'symphony-agent-'));
    const fakeBin = join(root, 'bin');
    const workspace = join(root, 'workspace');
    const capture = join(root, 'docker-args');
    const auth = join(root, 'auth.json');
    const installed = join(root, 'tenkacloud-symphony-agent');
    mkdirSync(fakeBin);
    mkdirSync(workspace);
    mkdirSync(join(workspace, '.git'));
    writeFileSync(auth, '{"auth":"synthetic-model-credential"}\n', {
      mode: 0o600,
    });

    writeExecutable(
      join(fakeBin, 'git'),
      `#!/bin/sh
case "$*" in
  "remote get-url origin")
    printf '%s\\n' 'https://github.com/susumutomita/TenkaCloudChallenge.git'
    exit 0
    ;;
  "check-ref-format --branch agent/symphony-workspace")
    exit 0
    ;;
  "symbolic-ref --quiet --short HEAD")
    printf '%s\\n' main
    exit 0
    ;;
  "show-ref --verify --quiet refs/heads/agent/symphony-workspace")
    exit 1
    ;;
  "-c core.hooksPath=/dev/null switch -c agent/symphony-workspace")
    exit 0
    ;;
esac
exit 64
`
    );
    writeExecutable(
      join(fakeBin, 'docker'),
      `#!/bin/sh
if [ "$1 $2 $3" = "network inspect --format" ]; then
  printf 'true\\n'
  exit 0
fi
printf '%s\\n' "$*" >> "${capture}"
exit 0
`
    );

    const source = readFileSync(AGENT_SOURCE, 'utf8')
      .replace(
        'readonly EXPECTED_SELF="/usr/local/libexec/tenkacloud-symphony-agent"',
        `readonly EXPECTED_SELF="${installed}"`
      )
      .replace(
        'readonly SAFE_PATH="/usr/bin:/bin:/usr/local/bin"',
        `readonly SAFE_PATH="${fakeBin}:/usr/bin:/bin"`
      );
    writeExecutable(installed, source);

    const result = spawnSync('bash', [installed], {
      cwd: workspace,
      env: {
        HOME: root,
        PATH: `${fakeBin}:/usr/bin:/bin`,
        SYMPHONY_AGENT_LAUNCHER_SHA256: sha256(installed),
        SYMPHONY_AGENT_IMAGE: `registry.invalid/codex@sha256:${'a'.repeat(64)}`,
        SYMPHONY_BOOTSTRAP_NETWORK: 'bootstrap-internal',
        SYMPHONY_BOOTSTRAP_PROXY: 'http://bootstrap-proxy:3128',
        SYMPHONY_AGENT_NETWORK: 'agent-internal',
        SYMPHONY_AGENT_PROXY: 'http://model-proxy:3128',
        SYMPHONY_MODEL_AUTH_FILE: auth,
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(capture, 'utf8');
    expect(calls.split('\n').filter(Boolean)).toHaveLength(2);
    expect(calls).toContain('--network bootstrap-internal');
    expect(calls).toContain('--network agent-internal');
    expect(calls).toContain(
      'bun install --cwd battles/microservice-migration-battle/services'
    );
    expect(calls).toMatch(/\nrun -i --rm .*--network agent-internal/s);
    expect(calls).toContain('--read-only');
    expect(calls).toContain('--cap-drop ALL');
    expect(calls).toContain('HTTP_PROXY=http://model-proxy:3128');
    expect(calls).not.toContain('synthetic-model-credential');
    expect(calls).not.toContain('SYMPHONY_TRACKER_TOKEN');
    expect(calls).not.toContain('GITHUB_TOKEN');
  });
});
