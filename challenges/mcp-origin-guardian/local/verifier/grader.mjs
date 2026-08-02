import { evaluateRequest, validatePolicy } from "../app/policy.mjs";

const EXPECTED = Object.freeze({
  canonicalOrigin: "https://mcp.example.test",
  developmentOrigin: "http://127.0.0.1:18110",
});

const CASES = Object.freeze([
  {
    name: "canonical production metadata",
    expect: true,
    metadata: "https://mcp.example.test",
    request: {
      environment: "production",
      host: "mcp.example.test",
      origin: "https://mcp.example.test",
      forwardedHost: "",
    },
  },
  {
    name: "case-insensitive Host only",
    expect: true,
    metadata: "https://mcp.example.test",
    request: {
      environment: "production",
      host: "MCP.EXAMPLE.TEST",
      origin: "https://mcp.example.test",
      forwardedHost: "",
    },
  },
  {
    name: "explicit development loopback",
    expect: true,
    metadata: "http://127.0.0.1:18110",
    request: {
      environment: "development",
      host: "127.0.0.1:18110",
      origin: "http://127.0.0.1:18110",
      forwardedHost: "",
    },
  },
  {
    name: "development authority in production",
    expect: false,
    request: {
      environment: "production",
      host: "127.0.0.1:18110",
      origin: "http://127.0.0.1:18110",
      forwardedHost: "",
    },
  },
  {
    name: "production authority in development",
    expect: false,
    request: {
      environment: "development",
      host: "mcp.example.test",
      origin: "https://mcp.example.test",
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
    name: "opaque Origin",
    expect: false,
    request: {
      environment: "production",
      host: "mcp.example.test",
      origin: "null",
      forwardedHost: "",
    },
  },
  {
    name: "missing Origin",
    expect: false,
    request: {
      environment: "production",
      host: "mcp.example.test",
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
  {
    name: "unknown environment",
    expect: false,
    request: {
      environment: "staging",
      host: "mcp.example.test",
      origin: "https://mcp.example.test",
      forwardedHost: "",
    },
  },
]);

export function gradePolicy(policy) {
  const errors = validatePolicy(policy);
  if (errors.length > 0) return { correct: false, errors, cases: [] };
  if (
    policy.canonicalOrigin !== EXPECTED.canonicalOrigin ||
    policy.developmentOrigin !== EXPECTED.developmentOrigin
  ) {
    errors.push("policy does not select the operator-approved authorities");
  }

  const cases = CASES.map((item) => {
    const outcome = evaluateRequest(policy, item.request);
    const metadataMatches =
      !item.expect ||
      (outcome.metadataResource === item.metadata &&
        outcome.resourceMetadataUrl === `${item.metadata}/.well-known/oauth-protected-resource`);
    return {
      name: item.name,
      passed: outcome.accepted === item.expect && metadataMatches,
    };
  });
  if (cases.some((item) => !item.passed)) {
    errors.push("one or more hidden authority-boundary cases failed");
  }
  return { correct: errors.length === 0, errors, cases };
}
