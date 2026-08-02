import { describe, expect, it } from "bun:test";
import { evaluateRequest, validatePolicy } from "../challenges/mcp-origin-guardian/local/app/policy.mjs";

const policy = {
  canonicalOrigin: "https://mcp.example.test",
  developmentOrigin: "http://127.0.0.1:18110",
};

describe("MCP canonical-origin challenge contract", () => {
  it("accepts only the configured production origin and emits canonical metadata", () => {
    expect(validatePolicy(policy)).toEqual([]);
    const ok = evaluateRequest(policy, {
      environment: "production",
      host: "mcp.example.test",
      origin: "https://mcp.example.test",
      forwardedHost: "",
    });
    expect(ok.accepted).toBe(true);
    expect(ok.metadataResource).toBe("https://mcp.example.test");
    expect(ok.resourceMetadataUrl).toBe(
      "https://mcp.example.test/.well-known/oauth-protected-resource",
    );
  });

  it("accepts the explicit loopback origin only in development", () => {
    const development = evaluateRequest(policy, {
      environment: "development",
      host: "127.0.0.1:18110",
      origin: "http://127.0.0.1:18110",
      forwardedHost: "",
    });
    const production = evaluateRequest(policy, {
      environment: "production",
      host: "127.0.0.1:18110",
      origin: "http://127.0.0.1:18110",
      forwardedHost: "",
    });
    expect(development.accepted).toBe(true);
    expect(development.metadataResource).toBe("http://127.0.0.1:18110");
    expect(production.accepted).toBe(false);
  });

  it.each([
    { environment: "production", host: "attacker.example", origin: "https://mcp.example.test", forwardedHost: "" },
    { environment: "production", host: "mcp.example.test", origin: "https://attacker.example", forwardedHost: "" },
    { environment: "production", host: "mcp.example.test", origin: "null", forwardedHost: "" },
    {
      environment: "production",
      host: "mcp.example.test",
      origin: "https://mcp.example.test",
      forwardedHost: "attacker.example",
    },
    {
      environment: "staging",
      host: "mcp.example.test",
      origin: "https://mcp.example.test",
      forwardedHost: "",
    },
  ])("fails closed for untrusted request authority %#", (request) => {
    expect(evaluateRequest(policy, request).accepted).toBe(false);
  });

  it.each([
    "http://mcp.example.test",
    "https://user@mcp.example.test",
    "https://mcp.example.test/path",
    "https://mcp.example.test?tenant=other",
    "$request",
  ])("rejects a non-canonical production value: %s", (canonicalOrigin) => {
    expect(validatePolicy({ ...policy, canonicalOrigin })).not.toEqual([]);
  });

  it.each([
    "https://127.0.0.1:18110",
    "http://0.0.0.0:18110",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:18110/path",
    "$request",
  ])("rejects an unsafe development value: %s", (developmentOrigin) => {
    expect(validatePolicy({ ...policy, developmentOrigin })).not.toEqual([]);
  });

  it("is non-vacuous: changing a security decision changes the result vector", () => {
    const accepted = [
      evaluateRequest(policy, {
        environment: "production",
        host: "mcp.example.test",
        origin: "https://mcp.example.test",
        forwardedHost: "",
      }).accepted,
      evaluateRequest(policy, {
        environment: "production",
        host: "attacker.example",
        origin: "https://mcp.example.test",
        forwardedHost: "",
      }).accepted,
      evaluateRequest(policy, {
        environment: "development",
        host: "127.0.0.1:18110",
        origin: "http://127.0.0.1:18110",
        forwardedHost: "",
      }).accepted,
    ];
    expect(accepted).toEqual([true, false, true]);
  });
});
