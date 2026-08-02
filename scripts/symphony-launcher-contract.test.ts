import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

// `.pathname` leaves a URL-encoded path, so a checkout under a directory with a
// space or a non-ASCII character resolves nowhere and this suite cannot read the
// launchers it is supposed to hold to a contract.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OPERATOR_ROOT = join(REPO_ROOT, '.symphony', 'operator');
const AGENT_SOURCE = join(OPERATOR_ROOT, 'tenkacloud-symphony-agent');
const HOST_SOURCE = join(OPERATOR_ROOT, 'tenkacloud-symphony-host');

// The agent launcher refuses to start when any of these reaches it, so none of
// them can be handed to the coding agent even by an operator misconfiguration.
const FORBIDDEN_AMBIENT_SECRETS = [
  'SYMPHONY_TRACKER_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
];

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function sha256(path: string): string {
  const result = Bun.spawnSync(['shasum', '-a', '256', path]);
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().split(/\s+/)[0] ?? '';
}

interface AgentHarness {
  readonly root: string;
  readonly installed: string;
  readonly workspace: string;
  readonly capture: string;
  readonly auth: string;
  readonly env: Record<string, string>;
}

// The stub Docker answers `network inspect` from the network name, so one
// harness can model an internal network (`*-internal`), a network that still
// has a route off the host (anything else), and a network that does not exist
// (`*-missing`). `docker run` is recorded rather than executed, which is what
// lets a test assert that no container was ever started.
function installAgentLauncher(): AgentHarness {
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
  case "$5" in
    *-missing) exit 1 ;;
    *-internal) printf 'true\\n' ;;
    *) printf 'false\\n' ;;
  esac
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

  return {
    root,
    installed,
    workspace,
    capture,
    auth,
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
  };
}

function runLauncher(
  harness: AgentHarness,
  overrides: Record<string, string> = {}
) {
  return spawnSync('bash', [harness.installed], {
    cwd: harness.workspace,
    env: { ...harness.env, ...overrides },
    encoding: 'utf8',
  });
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

  // Naming a helper in the source proves nothing about whether it is still
  // called: deleting both `require_internal_network` call sites left the
  // substring assertion above green while every egress restriction was gone.
  // The cases below drive the launcher instead of reading it.
  it.each(FORBIDDEN_AMBIENT_SECRETS)(
    'fails closed before Docker when %s reaches the agent launcher',
    (name) => {
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
          PATH: `${fakeBin}:/usr/bin:/bin`,
          [name]: 'tc-canary-must-not-cross',
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(78);
      expect(result.stderr).toContain(
        `refusing to start because ${name} reached the agent launcher`
      );
      expect(existsSync(marker)).toBe(false);
    }
  );

  it('refuses a Docker network that is not internal, so egress cannot bypass the proxy', () => {
    const harness = installAgentLauncher();

    const routable = runLauncher(harness, {
      SYMPHONY_AGENT_NETWORK: 'agent-routable',
    });

    expect(routable.status).toBe(78);
    expect(routable.stderr).toContain(
      'Docker network agent-routable must be internal'
    );
    expect(existsSync(harness.capture)).toBe(false);
  });

  it('refuses a Docker network that does not exist instead of running unrestricted', () => {
    const harness = installAgentLauncher();

    const absent = runLauncher(harness, {
      SYMPHONY_BOOTSTRAP_NETWORK: 'bootstrap-missing',
    });

    expect(absent.status).toBe(78);
    expect(absent.stderr).toContain(
      'Docker network bootstrap-missing does not exist'
    );
    expect(existsSync(harness.capture)).toBe(false);
  });

  it('refuses a proxy URL that carries a credential or an unexpected scheme', () => {
    const harness = installAgentLauncher();

    const embeddedCredential = runLauncher(harness, {
      SYMPHONY_AGENT_PROXY: 'http://operator:s3cret@model-proxy:3128',
    });
    const unexpectedScheme = runLauncher(harness, {
      SYMPHONY_BOOTSTRAP_PROXY: 'socks5://bootstrap-proxy:1080',
    });

    expect(embeddedCredential.status).toBe(78);
    expect(embeddedCredential.stderr).toContain(
      'SYMPHONY_AGENT_PROXY must be a credential-free http://container-name:port URL'
    );
    expect(unexpectedScheme.status).toBe(78);
    expect(unexpectedScheme.stderr).toContain(
      'SYMPHONY_BOOTSTRAP_PROXY must be a credential-free http://container-name:port URL'
    );
    expect(existsSync(harness.capture)).toBe(false);
  });

  it('refuses a symlinked model credential so the copied file cannot be redirected', () => {
    const harness = installAgentLauncher();
    const link = join(harness.root, 'auth-link.json');
    symlinkSync(harness.auth, link);

    const result = runLauncher(harness, { SYMPHONY_MODEL_AUTH_FILE: link });

    expect(result.status).toBe(78);
    expect(result.stderr).toContain(
      'SYMPHONY_MODEL_AUTH_FILE must be a regular non-symlink file'
    );
    expect(existsSync(harness.capture)).toBe(false);
  });

  it('passes only explicit proxy and model-auth inputs to two restricted containers', () => {
    const harness = installAgentLauncher();

    const result = runLauncher(harness);

    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(harness.capture, 'utf8');
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
