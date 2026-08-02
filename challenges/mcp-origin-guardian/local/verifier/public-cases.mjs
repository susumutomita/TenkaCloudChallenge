import { evaluateRequest, validatePolicy } from "../app/policy.mjs";

const APPROVED_POLICY = Object.freeze({
  canonicalOrigin: "https://mcp.example.test",
  developmentOrigin: "http://127.0.0.1:18110",
});

const PUBLIC_CASES = Object.freeze([
  {
    name: "canonical production request",
    expect: true,
    request: {
      environment: "production",
      host: "mcp.example.test",
      origin: "https://mcp.example.test",
      forwardedHost: "",
    },
  },
  {
    name: "explicit development loopback",
    expect: true,
    request: {
      environment: "development",
      host: "127.0.0.1:18110",
      origin: "http://127.0.0.1:18110",
      forwardedHost: "",
    },
  },
  {
    name: "attacker Host",
    expect: false,
    request: {
      environment: "production",
      host: "attacker.example",
      origin: "https://mcp.example.test",
      forwardedHost: "",
    },
  },
  {
    name: "cross-site Origin",
    expect: false,
    request: {
      environment: "production",
      host: "mcp.example.test",
      origin: "https://attacker.example",
      forwardedHost: "",
    },
  },
  {
    name: "forwarded authority override",
    expect: false,
    request: {
      environment: "production",
      host: "mcp.example.test",
      origin: "https://mcp.example.test",
      forwardedHost: "attacker.example",
    },
  },
]);

export function runPublicCases(policy) {
  const errors = validatePolicy(policy);
  if (errors.length > 0) return { correct: false, errors, cases: [] };
  if (
    policy.canonicalOrigin !== APPROVED_POLICY.canonicalOrigin ||
    policy.developmentOrigin !== APPROVED_POLICY.developmentOrigin
  ) {
    errors.push("policy does not select the lab's operator-approved authorities");
  }
  const cases = PUBLIC_CASES.map((item) => {
    const outcome = evaluateRequest(policy, item.request);
    return {
      name: item.name,
      passed: outcome.accepted === item.expect,
    };
  });
  if (cases.some((item) => !item.passed)) {
    errors.push("one or more published authority-boundary cases failed");
  }
  return { correct: errors.length === 0, errors, cases };
}
