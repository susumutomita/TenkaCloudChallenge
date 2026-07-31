import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parse } from 'yaml';

export type WorkflowDocument = {
  config: Record<string, unknown>;
  prompt: string;
};

const EXPECTED_REPOSITORY = 'susumutomita/TenkaCloudChallenge';
const EXPECTED_TRACKER_SECRET = 'SYMPHONY_TRACKER_TOKEN';
const EXPECTED_AGENT_LAUNCHER = '/usr/local/libexec/tenkacloud-symphony-agent';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function valueAt(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    current = record(current)[segment];
  }
  return current;
}

function textAt(
  root: Record<string, unknown>,
  path: string[]
): string | undefined {
  const value = valueAt(root, path);
  return typeof value === 'string' ? value : undefined;
}

function booleanAt(
  root: Record<string, unknown>,
  path: string[]
): boolean | undefined {
  const value = valueAt(root, path);
  return typeof value === 'boolean' ? value : undefined;
}

function numberAt(
  root: Record<string, unknown>,
  path: string[]
): number | undefined {
  const value = valueAt(root, path);
  return typeof value === 'number' ? value : undefined;
}

function stringListAt(root: Record<string, unknown>, path: string[]): string[] {
  const value = valueAt(root, path);
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : [];
}

export function parseWorkflow(source: string): WorkflowDocument {
  if (!source.startsWith('---\n')) {
    throw new Error('WORKFLOW.md must start with YAML front matter');
  }

  const closing = source.indexOf('\n---\n', 4);
  if (closing < 0) {
    throw new Error('WORKFLOW.md front matter is not closed');
  }

  const parsed = parse(source.slice(4, closing));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('WORKFLOW.md front matter must be a map');
  }

  return {
    config: parsed as Record<string, unknown>,
    prompt: source.slice(closing + 5).trim(),
  };
}

export function validateProductionWorkflow(
  workflow: WorkflowDocument
): string[] {
  const { config, prompt } = workflow;
  const errors: string[] = [];

  if (textAt(config, ['tracker', 'kind']) !== 'github') {
    errors.push('tracker.kind must be github');
  }
  if (textAt(config, ['tracker', 'provider', 'repo']) !== EXPECTED_REPOSITORY) {
    errors.push(`tracker.provider.repo must be ${EXPECTED_REPOSITORY}`);
  }
  if (
    textAt(config, ['tracker', 'provider', 'token']) !==
    `$${EXPECTED_TRACKER_SECRET}`
  ) {
    errors.push(
      `tracker.provider.token must resolve only from $${EXPECTED_TRACKER_SECRET}`
    );
  }
  if (
    !stringListAt(config, ['tracker', 'required_labels']).includes(
      'agent:ready'
    )
  ) {
    errors.push('tracker.required_labels must include agent:ready');
  }

  const hooks = valueAt(config, ['hooks']);
  if (
    hooks === null ||
    typeof hooks !== 'object' ||
    Array.isArray(hooks) ||
    Object.keys(hooks as Record<string, unknown>).length !== 0
  ) {
    errors.push(
      'hooks must be empty; workspace preparation belongs to the immutable agent launcher'
    );
  }

  if (textAt(config, ['codex', 'command']) !== EXPECTED_AGENT_LAUNCHER) {
    errors.push(
      'codex.command must be the operator-installed absolute launcher path'
    );
  }
  if (!isAbsolute(textAt(config, ['codex', 'command']) ?? '')) {
    errors.push('codex.command must be absolute');
  }
  if (textAt(config, ['codex', 'approval_policy']) !== 'on-request') {
    errors.push('codex.approval_policy must be on-request');
  }
  if ((numberAt(config, ['codex', 'read_timeout_ms']) ?? 0) < 900_000) {
    errors.push(
      'codex.read_timeout_ms must allow at least 15 minutes for cold bootstrap'
    );
  }
  if (textAt(config, ['codex', 'thread_sandbox']) !== 'workspace-write') {
    errors.push('codex.thread_sandbox must be workspace-write');
  }
  if (
    textAt(config, ['codex', 'turn_sandbox_policy', 'type']) !==
    'workspaceWrite'
  ) {
    errors.push('codex.turn_sandbox_policy.type must be workspaceWrite');
  }
  if (
    booleanAt(config, ['codex', 'turn_sandbox_policy', 'networkAccess']) !==
    false
  ) {
    errors.push('codex.turn_sandbox_policy.networkAccess must be false');
  }

  if (booleanAt(config, ['security', 'production_intended']) !== true) {
    errors.push('security.production_intended must be true');
  }
  if (
    !stringListAt(config, [
      'security',
      'tracker_secret_environment_names',
    ]).includes(EXPECTED_TRACKER_SECRET)
  ) {
    errors.push(
      `security.tracker_secret_environment_names must declare ${EXPECTED_TRACKER_SECRET}`
    );
  }
  if (
    textAt(config, ['security', 'isolation', 'boundary']) !==
    'external-container'
  ) {
    errors.push('security.isolation.boundary must be external-container');
  }
  if (
    textAt(config, ['security', 'isolation', 'launcher_path']) !==
    EXPECTED_AGENT_LAUNCHER
  ) {
    errors.push(
      `security.isolation.launcher_path must be ${EXPECTED_AGENT_LAUNCHER}`
    );
  }
  if (textAt(config, ['security', 'egress', 'mode']) !== 'proxy-only') {
    errors.push('security.egress.mode must be proxy-only');
  }
  if (booleanAt(config, ['security', 'egress', 'direct_network']) !== false) {
    errors.push('security.egress.direct_network must be false');
  }
  if (
    booleanAt(config, ['security', 'egress', 'internal_network_required']) !==
    true
  ) {
    errors.push('security.egress.internal_network_required must be true');
  }
  if (
    textAt(config, ['security', 'credentials', 'tracker_scope']) !==
    'issues-read-only'
  ) {
    errors.push('security.credentials.tracker_scope must be issues-read-only');
  }
  if (
    textAt(config, ['security', 'credentials', 'agent_repository_write']) !==
    'none'
  ) {
    errors.push('security.credentials.agent_repository_write must be none');
  }
  if (
    textAt(config, ['security', 'credentials', 'model_credential']) !==
    'separate-read-only-file'
  ) {
    errors.push(
      'security.credentials.model_credential must be separate-read-only-file'
    );
  }
  if (
    booleanAt(config, ['security', 'logging', 'exact_secret_redaction']) !==
    true
  ) {
    errors.push('security.logging.exact_secret_redaction must be true');
  }
  if (
    textAt(config, ['security', 'lifecycle', 'handoff_mode']) !==
    'approval-block-then-human-unlabel'
  ) {
    errors.push(
      'security.lifecycle.handoff_mode must block retries until a human removes agent:ready'
    );
  }

  if (
    !prompt.includes('make symphony-agent-gate') ||
    !prompt.includes('must run the complete networked `make agent-gate`')
  ) {
    errors.push(
      'prompt must separate the offline Symphony gate from the operator networked gate'
    );
  }
  if (
    !prompt.includes('launcher has already created') ||
    !prompt.includes('Do not create, switch, rename, push, or delete branches')
  ) {
    errors.push(
      'prompt must keep Git branch mutation outside the approval-blocked agent'
    );
  }
  if (
    !prompt.includes(
      'Never run deploy, destroy, release, force-push, or secret-management commands'
    )
  ) {
    errors.push('prompt must retain the destructive-operation prohibition');
  }
  if (
    !prompt.includes(
      'High-risk changes must stop at human review and protected checks. This runtime never merges'
    )
  ) {
    errors.push('prompt must require high-risk work to stop for human review');
  }
  if (
    !prompt.includes(
      'External and integration validation that was not run must be reported as skipped'
    )
  ) {
    errors.push('prompt must report skipped external validation as skipped');
  }
  if (prompt.includes('\n```bash\ncodex exec review --base origin/main\n```')) {
    errors.push('prompt must not require an offline nested Codex review');
  }
  if (
    !prompt.includes(
      'Symphony handoff ready; remove agent:ready before operator review'
    ) ||
    !prompt.includes('Do not finish normally')
  ) {
    errors.push(
      'prompt must enter an approval-blocked handoff before human unlabeling'
    );
  }

  return errors;
}

function main(): void {
  const workflowPath = resolve(process.argv[2] ?? '.symphony/WORKFLOW.md');
  const workflow = parseWorkflow(readFileSync(workflowPath, 'utf8'));
  const errors = validateProductionWorkflow(workflow);
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`symphony-security: ${error}`);
    }
    process.exit(1);
  }
  console.log(
    `symphony-security: secure production contract accepted (${workflowPath})`
  );
}

if (import.meta.main) {
  main();
}
