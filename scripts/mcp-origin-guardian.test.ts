import { describe, expect, it } from "bun:test";
import { evaluateRequest, validatePolicy } from "../challenges/mcp-origin-guardian/local/app/policy.mjs";

const production = {
  canonicalOrigin: "https://mcp.example.test",
  allowDevLoopback: false,
};

describe("MCP canonical-origin challenge contract", () => {
  it("accepts only the configured production origin and emits canonical metadata", () => {
    expect(validatePolicy(production)).toEqual([]);
    const ok = evaluateRequest(production, {
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

  it.each([
    { host: "attacker.example", origin: "https://mcp.example.test", forwardedHost: "" },
    { host: "mcp.example.test", origin: "https://attacker.example", forwardedHost: "" },
    { host: "mcp.example.test", origin: "null", forwardedHost: "" },
    {
      host: "mcp.example.test",
      origin: "https://mcp.example.test",
      forwardedHost: "attacker.example",
    },
  ])("fails closed for untrusted request authority %#", (request) => {
    expect(evaluateRequest(production, request).accepted).toBe(false);
  });

  it.each([
    "http://mcp.example.test",
    "https://user@mcp.example.test",
    "https://mcp.example.test/path",
    "https://mcp.example.test?tenant=other",
    "$request",
  ])("rejects a non-canonical production value: %s", (canonicalOrigin) => {
    expect(
      validatePolicy({ canonicalOrigin, allowDevLoopback: false }),
    ).not.toEqual([]);
  });

  it("keeps the localhost exception behind explicit development mode", () => {
    const disabled = evaluateRequest(production, {
      host: "127.0.0.1:18110",
      origin: "http://127.0.0.1:18110",
      forwardedHost: "",
    });
    const enabled = evaluateRequest(
      { canonicalOrigin: "https://mcp.example.test", allowDevLoopback: true },
      {
        host: "127.0.0.1:18110",
        origin: "http://127.0.0.1:18110",
        forwardedHost: "",
      },
    );
    expect(disabled.accepted).toBe(false);
    expect(enabled.accepted).toBe(true);
    expect(enabled.metadataResource).toBe("http://127.0.0.1:18110");
  });

  it("is non-vacuous: changing any security decision breaks at least one case", () => {
    const accepted = [
      evaluateRequest(production, {
        host: "mcp.example.test",
        origin: "https://mcp.example.test",
        forwardedHost: "",
      }).accepted,
      evaluateRequest(production, {
        host: "attacker.example",
        origin: "https://mcp.example.test",
        forwardedHost: "",
      }).accepted,
    ];
    expect(accepted).toEqual([true, false]);
  });
});
