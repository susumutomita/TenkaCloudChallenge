import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  decodeSubmission,
  encodeSubmission,
  evaluateRequest,
  validatePolicy,
} from "../challenges/mcp-origin-guardian/local/app/policy.mjs";
import { gradePolicy } from "../challenges/mcp-origin-guardian/local/verifier/grader.mjs";
import { runPublicCases } from "../challenges/mcp-origin-guardian/local/verifier/public-cases.mjs";

const policy = {
  canonicalOrigin: "https://mcp.example.test",
  developmentOrigin: "http://127.0.0.1:18110",
};
const localRoot = join(import.meta.dir, "../challenges/mcp-origin-guardian/local");

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
    { environment: "production", host: "mcp.example.test", origin: "https://mcp.example.test", forwardedHost: "attacker.example" },
    { environment: "staging", host: "mcp.example.test", origin: "https://mcp.example.test", forwardedHost: "" },
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

  it("keeps public feedback useful while the hidden verifier remains authoritative", () => {
    expect(runPublicCases(policy).correct).toBe(true);
    expect(gradePolicy(policy).correct).toBe(true);
    expect(gradePolicy({ ...policy, canonicalOrigin: "https://attacker.example" }).correct).toBe(false);
    expect(gradePolicy({ ...policy, developmentOrigin: "http://localhost:18110" }).correct).toBe(false);
  });

  it("round-trips a bounded policy submission without a fixed flag", () => {
    const submission = encodeSubmission(policy);
    expect(decodeSubmission(submission)).toEqual(policy);
    expect(decodeSubmission("not-base64url")).toBeNull();
    expect(decodeSubmission("a".repeat(2049))).toBeNull();
  });

  it("is non-vacuous: changing a security decision changes the result vector", () => {
    const accepted = [
      evaluateRequest(policy, { environment: "production", host: "mcp.example.test", origin: "https://mcp.example.test", forwardedHost: "" }).accepted,
      evaluateRequest(policy, { environment: "production", host: "attacker.example", origin: "https://mcp.example.test", forwardedHost: "" }).accepted,
      evaluateRequest(policy, { environment: "development", host: "127.0.0.1:18110", origin: "http://127.0.0.1:18110", forwardedHost: "" }).accepted,
    ];
    expect(accepted).toEqual([true, false, true]);
  });
});

describe("MCP Origin Guardian image boundary", () => {
  it("builds participant and verifier from disjoint Docker targets", () => {
    const dockerfile = readFileSync(join(localRoot, "Dockerfile"), "utf8");
    const participant = dockerfile
      .split("FROM base AS participant", 2)[1]
      ?.split("FROM base AS verifier", 1)[0];
    expect(participant).toBeDefined();
    expect(participant).toContain("COPY --chown=node:node app/ ./app/");
    expect(participant).not.toContain("verifier/");
    expect(dockerfile).toContain("COPY --chown=node:node verifier/ ./verifier/");

    const compose = readFileSync(join(localRoot, "docker-compose.yml"), "utf8");
    expect(compose).toContain("target: participant");
    expect(compose).toContain("target: verifier");
    expect(compose).toContain('"127.0.0.1:18110:8080"');
    expect(compose).toContain('"127.0.0.1:18111:8081"');
    expect(compose.match(/seccomp=\.\/seccomp-no-connect\.json/g)).toHaveLength(2);
    expect(compose).toContain("- participant");
    expect(compose).toContain("- verifier");

    const seccomp = JSON.parse(
      readFileSync(join(localRoot, "seccomp-no-connect.json"), "utf8"),
    ) as {
      defaultAction: string;
      syscalls: Array<{ names: string[]; action: string; errnoRet?: number }>;
    };
    expect(seccomp.defaultAction).toBe("SCMP_ACT_ALLOW");
    expect(seccomp.syscalls).toContainEqual({
      names: ["connect", "sendto", "sendmsg", "sendmmsg"],
      action: "SCMP_ACT_ERRNO",
      errnoRet: 1,
    });
  });

  it("derives verifier origins instead of hard-coding one host port", () => {
    const participantServer = readFileSync(join(localRoot, "app/server.mjs"), "utf8");
    const verifierServer = readFileSync(join(localRoot, "verifier/server.mjs"), "utf8");
    expect(participantServer).toContain("port+1");
    expect(participantServer).toContain("app\\\\.github\\\\.dev");
    expect(participantServer).not.toContain('const verifierOrigin=location.hostname');
    expect(verifierServer).toContain("isAllowedWorkbenchOrigin");
    expect(verifierServer).toContain("verifierPort === originPort + 1");
    expect(verifierServer).toContain("app\\.github\\.dev");
  });

  it("does not leave public or hidden grading in participant-copied source", () => {
    const appRoot = join(localRoot, "app");
    expect(readdirSync(appRoot).sort()).toEqual(["policy.mjs", "server.mjs"]);
    for (const file of readdirSync(appRoot)) {
      const source = readFileSync(join(appRoot, file), "utf8");
      expect(source).not.toContain("gradePolicy");
      expect(source).not.toContain("runPublicCases");
      expect(source).not.toContain("APPROVED_POLICY");
      expect(source).not.toContain("hidden authority-boundary");
      expect(source).not.toContain("operator-approved authorities");
    }

    const publicCases = readFileSync(join(localRoot, "verifier/public-cases.mjs"), "utf8");
    const hiddenGrader = readFileSync(join(localRoot, "verifier/grader.mjs"), "utf8");
    const verifierServer = readFileSync(join(localRoot, "verifier/server.mjs"), "utf8");
    expect(publicCases).toContain("runPublicCases");
    expect(publicCases).toContain("APPROVED_POLICY");
    expect(hiddenGrader).toContain("gradePolicy");
    expect(hiddenGrader).toContain("missing Origin");
    expect(verifierServer).toContain("/public-test");
    expect(verifierServer).toContain("/prepare");
    expect(verifierServer).toContain("maxHeaderSize");
  });
});
