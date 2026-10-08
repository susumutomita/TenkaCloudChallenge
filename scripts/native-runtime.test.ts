import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNativeCoordinationRefs } from "./validate-problems";

test("native coordination validates real matching plugin paths without inventing a container verifier", () => {
  const dir = mkdtempSync(join(tmpdir(), "native-catalog-"));
  try {
    mkdirSync(join(dir, "coordination"));
    writeFileSync(join(dir, "coordination/plugin.ts"), "export default {};\n");
    const meta = {
      category: "Battle",
      instructions: "調査する",
      description: "運営向け",
      i18n: {
        en: { instructions: "Investigate", description: "Operator context" },
      },
      runtime: {
        provider: "local",
        engine: "bun",
        entry: "coordination/plugin.ts",
      },
      interTeamCoordination: { plugin: "coordination/plugin.ts" },
    };
    expect(checkNativeCoordinationRefs(dir, meta).errors).toEqual([]);
    for (const extra of [
      { category: "Challenge" },
      { scoring: { kind: "verify" } },
      { cfnTemplate: "template.yaml" },
      { cfnParameters: {} },
      { phases: [{ name: "ignored", afterMinutes: 1, effect: { scorePathOverride: "/fake" } }] },
      { endpoints: [{ slot: "main", default: { from: "cfn-output", key: "MissingUrl" } }] },
      { disruptions: [{ id: "ignored", name: "Ignored", eventDetailType: "test", action: { kind: "lambda-invoke", targetRef: "MissingFunction", revert: { afterSeconds: 60 } } }] },
      { interTeamCoordination: {} },
    ])
      expect(
        checkNativeCoordinationRefs(dir, { ...meta, ...extra }).errors.length,
      ).toBeGreaterThan(0);
    for (const path of [
      "coordination/missing.ts",
      "coordination/../plugin.ts",
      "/tmp/plugin.ts",
      "coordination/plugin.js",
    ])
      expect(
        checkNativeCoordinationRefs(dir, {
          ...meta,
          runtime: { ...meta.runtime, entry: path },
          interTeamCoordination: { plugin: path },
        }).errors.length,
      ).toBeGreaterThan(0);
    expect(
      checkNativeCoordinationRefs(dir, {
        ...meta,
        runtime: { ...meta.runtime, entry: "coordination/other.ts" },
      }).errors.length,
    ).toBeGreaterThan(0);
    expect(
      checkNativeCoordinationRefs(dir, {
        ...meta,
        runtime: { ...meta.runtime, verifyUrl: "http://127.0.0.1:1234/verify" },
      }).errors.length,
    ).toBeGreaterThan(0);
    for (const extra of [{ terminal: { service: "participant" } }, { secretEnv: ["TOKEN"] }, { challengeEndpoints: { main: "http://127.0.0.1:1234/" } }, { compatibility: { nativeArchitectures: ["amd64"] } }])
      expect(checkNativeCoordinationRefs(dir, { ...meta, runtime: { ...meta.runtime, ...extra } }).errors.length).toBeGreaterThan(0);
    symlinkSync(dir, join(dir, "coordination/ancestor"));
    expect(checkNativeCoordinationRefs(dir, { ...meta, runtime: { ...meta.runtime, entry: "coordination/ancestor/coordination/plugin.ts" }, interTeamCoordination: { plugin: "coordination/ancestor/coordination/plugin.ts" } }).errors.length).toBeGreaterThan(0);
    symlinkSync("plugin.ts", join(dir, "coordination/link.ts"));
    expect(
      checkNativeCoordinationRefs(dir, {
        ...meta,
        runtime: { ...meta.runtime, entry: "coordination/link.ts" },
        interTeamCoordination: { plugin: "coordination/link.ts" },
      }).errors.length,
    ).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("schema permits portless native Battles while preserving public runtime port requirements", async () => {
  const { default: Ajv } = await import("ajv");
  const { default: addFormats } = await import("ajv-formats");
  const { readFileSync } = await import("node:fs");
  const root = new URL("../", import.meta.url);
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(new URL("SCHEMA.json", root), "utf8")));
  const native = JSON.parse(readFileSync(new URL("battles/forensic-casebook/metadata.json", root), "utf8"));
  const legacy = JSON.parse(readFileSync(new URL("battles/hello-world-battle/metadata.json", root), "utf8"));
  expect(validate(native)).toBe(true);
  expect(validate(legacy)).toBe(true);
  expect(validate({ ...legacy, exposedPorts: [] })).toBe(false);
  expect(validate({ ...native, exposedPorts: [{ port: 1, name: "fake" }] })).toBe(false);
  expect(validate({ ...native, category: "Challenge" })).toBe(false);
  expect(validate({ ...native, runtime: { ...native.runtime, engine: "compose" } })).toBe(false);
});
