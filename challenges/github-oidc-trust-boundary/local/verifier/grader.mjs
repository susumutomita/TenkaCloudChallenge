import {
  ACTION,
  AUDIENCE_KEY,
  evaluateTrustPolicy,
  OBSERVATIONS,
  PROVIDER_ARN,
  requestContext,
  SUBJECT_KEY,
  TARGET_AUDIENCE,
  TARGET_SUBJECT,
  validatePolicy,
} from "../app/engine.mjs";
import { REFERENCE_POLICY } from "./reference.mjs";

export const CHECKPOINT_IDS = Object.freeze([
  "observe",
  "audience",
  "repository",
  "environment",
  "pull-request",
  "replay",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function statement(policy) {
  return policy.trustPolicy.Statement[0];
}

function conditionFor(policy, key) {
  const found = [];
  for (const operator of ["StringEquals", "StringLike"]) {
    const value = statement(policy).Condition?.[operator]?.[key];
    if (typeof value === "string") found.push({ operator, value });
  }
  return found.length === 1 ? found[0] : null;
}

function withSubmittedCondition(policy, key) {
  const projected = clone(REFERENCE_POLICY);
  const candidate = conditionFor(policy, key);
  const target = statement(projected);
  delete target.Condition.StringEquals[key];
  if (Object.keys(target.Condition.StringEquals).length === 0) delete target.Condition.StringEquals;
  if (candidate) {
    target.Condition[candidate.operator] ??= {};
    target.Condition[candidate.operator][key] = candidate.value;
  }
  return projected;
}

function exactMatrix(policy, matrix) {
  return matrix.every(({ request, expected }) => evaluateTrustPolicy(policy, request).allowed === expected);
}

function gradeObserve(policy) {
  return OBSERVATIONS.every((item) => policy.diagnosis.includes(item)) && policy.diagnosis.length === OBSERVATIONS.length;
}

function gradeAudience(policy) {
  const projected = withSubmittedCondition(policy, AUDIENCE_KEY);
  return exactMatrix(projected, [
    { request: requestContext({ id: "aud-good" }), expected: true },
    { request: requestContext({ id: "aud-wrong", aud: "https://example.invalid" }), expected: false },
    { request: requestContext({ id: "aud-missing", aud: undefined }), expected: false },
    { request: requestContext({ id: "aud-array", aud: [TARGET_AUDIENCE] }), expected: false },
    { request: requestContext({ id: "aud-case", aud: "STS.AMAZONAWS.COM" }), expected: false },
  ]);
}

function gradeRepository(policy) {
  const projected = withSubmittedCondition(policy, SUBJECT_KEY);
  return exactMatrix(projected, [
    { request: requestContext({ id: "repo-good" }), expected: true },
    {
      request: requestContext({ id: "repo-other", sub: "repo:tenkacloud/preview-app:environment:Production" }),
      expected: false,
    },
    {
      request: requestContext({ id: "owner-other", sub: "repo:other-org/production-app:environment:Production" }),
      expected: false,
    },
    {
      request: requestContext({ id: "repo-prefix", sub: "repo:tenkacloud/production-app-copy:environment:Production" }),
      expected: false,
    },
    {
      request: requestContext({ id: "repo-encoded", sub: "repo:tenkacloud%2Fproduction-app:environment:Production" }),
      expected: false,
    },
  ]);
}

function gradeEnvironment(policy) {
  const projected = withSubmittedCondition(policy, SUBJECT_KEY);
  return exactMatrix(projected, [
    { request: requestContext({ id: "env-good" }), expected: true },
    {
      request: requestContext({ id: "env-staging", sub: "repo:tenkacloud/production-app:environment:Staging" }),
      expected: false,
    },
    {
      request: requestContext({ id: "env-case", sub: "repo:tenkacloud/production-app:environment:production" }),
      expected: false,
    },
    {
      request: requestContext({ id: "env-branch", sub: "repo:tenkacloud/production-app:ref:refs/heads/main" }),
      expected: false,
    },
    {
      request: requestContext({ id: "env-pr", sub: "repo:tenkacloud/production-app:pull_request" }),
      expected: false,
    },
  ]);
}

export const HIDDEN_MATRIX = Object.freeze([
  {
    id: "approved-caller-environment",
    expected: true,
    request: requestContext({
      id: "approved-caller-environment",
      extraClaims: {
        repository: "tenkacloud/production-app",
        environment: "Production",
        job_workflow_ref: "tenkacloud/platform/.github/workflows/deploy.yml@refs/heads/main",
      },
    }),
  },
  {
    id: "untrusted-caller-approved-reusable-workflow",
    expected: false,
    request: requestContext({
      id: "untrusted-caller-approved-reusable-workflow",
      sub: "repo:tenkacloud/preview-app:environment:Production",
      extraClaims: {
        repository: "tenkacloud/preview-app",
        environment: "Production",
        job_workflow_ref: "tenkacloud/platform/.github/workflows/deploy.yml@refs/heads/main",
      },
    }),
  },
  {
    id: "fork-pull-request",
    expected: false,
    request: requestContext({
      id: "fork-pull-request",
      sub: "repo:tenkacloud/production-app:pull_request",
      extraClaims: { repository: "tenkacloud/production-app", event_name: "pull_request", head_ref: "fork/change" },
    }),
  },
  {
    id: "branch-without-environment",
    expected: false,
    request: requestContext({ id: "branch-without-environment", sub: "repo:tenkacloud/production-app:ref:refs/heads/main" }),
  },
  {
    id: "wrong-audience",
    expected: false,
    request: requestContext({ id: "wrong-audience", aud: "vault.example.test" }),
  },
  {
    id: "multiple-audiences",
    expected: false,
    request: requestContext({ id: "multiple-audiences", aud: [TARGET_AUDIENCE, "vault.example.test"] }),
  },
  {
    id: "missing-subject",
    expected: false,
    request: requestContext({ id: "missing-subject", sub: undefined }),
  },
  {
    id: "wrong-provider",
    expected: false,
    request: requestContext({ id: "wrong-provider", providerArn: `${PROVIDER_ARN}-copy` }),
  },
  {
    id: "wrong-action",
    expected: false,
    request: requestContext({ id: "wrong-action", action: `${ACTION}:Other` }),
  },
  {
    id: "wrong-issuer",
    expected: false,
    request: requestContext({ id: "wrong-issuer", iss: "https://token.example.invalid" }),
  },
]);

function gradePullRequest(policy) {
  return exactMatrix(policy, HIDDEN_MATRIX);
}

function gradeReplay(policy) {
  const permutations = [
    HIDDEN_MATRIX,
    [...HIDDEN_MATRIX].reverse(),
    [...HIDDEN_MATRIX.slice(3), ...HIDDEN_MATRIX.slice(0, 3)],
    [...HIDDEN_MATRIX, ...HIDDEN_MATRIX],
  ];
  const baseline = HIDDEN_MATRIX.map((item) => ({
    id: item.id,
    allowed: evaluateTrustPolicy(policy, item.request).allowed,
    expected: item.expected,
  }));
  if (!baseline.every((item) => item.allowed === item.expected)) return false;
  const expectedById = new Map(baseline.map((item) => [item.id, item.allowed]));
  return permutations.every((matrix) =>
    matrix.every((item) => evaluateTrustPolicy(policy, item.request).allowed === expectedById.get(item.id)),
  );
}

const graders = Object.freeze({
  observe: gradeObserve,
  audience: gradeAudience,
  repository: gradeRepository,
  environment: gradeEnvironment,
  "pull-request": gradePullRequest,
  replay: gradeReplay,
});

export function gradeCheckpoint(policy, checkpointId) {
  const errors = validatePolicy(policy);
  if (errors.length > 0 || !CHECKPOINT_IDS.includes(checkpointId)) {
    return { checkpointId, correct: false, errors: errors.length ? errors : ["unknown checkpoint"] };
  }
  const correct = graders[checkpointId](policy) === true;
  return {
    checkpointId,
    correct,
    errors: correct ? [] : [`${checkpointId} still has a hidden counterexample`],
  };
}

export function gradeAll(policy) {
  const checks = CHECKPOINT_IDS.map((checkpointId) => gradeCheckpoint(policy, checkpointId));
  return { correct: checks.every((item) => item.correct), checks };
}
