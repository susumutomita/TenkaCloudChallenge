import { evaluateTrustPolicy, requestContext, validatePolicy } from "../app/engine.mjs";

const cases = Object.freeze([
  {
    name: "production environment token",
    expected: true,
    request: requestContext({
      id: "production-environment",
      extraClaims: { repository: "tenkacloud/production-app", environment: "Production" },
    }),
  },
  {
    name: "wrong audience",
    expected: false,
    request: requestContext({ id: "wrong-audience", aud: "https://example.invalid" }),
  },
  {
    name: "same owner, different repository",
    expected: false,
    request: requestContext({ id: "other-repository", sub: "repo:tenkacloud/preview-app:environment:Production" }),
  },
  {
    name: "branch job without the environment",
    expected: false,
    request: requestContext({ id: "branch", sub: "repo:tenkacloud/production-app:ref:refs/heads/main" }),
  },
  {
    name: "pull request job",
    expected: false,
    request: requestContext({ id: "pull-request", sub: "repo:tenkacloud/production-app:pull_request" }),
  },
  {
    name: "missing subject claim",
    expected: false,
    request: requestContext({ id: "missing-subject", sub: undefined }),
  },
]);

export function runPublicCases(policy) {
  const errors = validatePolicy(policy);
  if (errors.length > 0) return { correct: false, errors, cases: [] };
  const results = cases.map((item) => {
    const verdict = evaluateTrustPolicy(policy, item.request);
    return {
      name: item.name,
      expected: item.expected ? "allow" : "deny",
      actual: verdict.allowed ? "allow" : "deny",
      passed: verdict.allowed === item.expected,
      reasons: verdict.reasons,
    };
  });
  return {
    correct: results.every((item) => item.passed),
    errors: results.every((item) => item.passed) ? [] : ["one or more public claim cases failed"],
    cases: results,
  };
}
