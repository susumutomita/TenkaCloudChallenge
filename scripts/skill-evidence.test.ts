import { expect, test } from "bun:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "../SCHEMA.json";
import challenge from "../challenges/hello-world/metadata.json";
import battle from "../battles/hello-world-battle/metadata.json";
import { checkSkillEvidence } from "./validate-problems";

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
test("optional declarations validate for a single answer and a successful probe", () => {
  for (const meta of [challenge, battle]) {
    expect(validate(meta)).toBe(true);
    expect(checkSkillEvidence(meta)).toEqual([]);
    const { skillEvidence: _, ...legacy } = meta;
    expect(validate(legacy)).toBe(true);
    expect(checkSkillEvidence(legacy)).toEqual([]);
  }
});
test("duplicate IDs and unsupported scorer sources cannot invent evidence", () => {
  expect(checkSkillEvidence({ ...challenge, skillEvidence: [...challenge.skillEvidence, ...challenge.skillEvidence] })).toHaveLength(1);
  for (const kind of ["multi-flag", "multi-verify", "coordination", "attack-detection", "phased-polling", undefined]) {
    expect(checkSkillEvidence({ ...challenge, scoring: { kind } })).toHaveLength(1);
  }
  expect(checkSkillEvidence({ ...battle, scoring: { kind: "flag" } })).toHaveLength(1);
});
test("empty, unknown, mistyped and hidden rule fields fail the schema", () => {
  for (const rule of [{}, { source: "unknown", result: "ok" }, { source: "flag", result: true }, { source: "flag", result: "ok", checkpointId: "unknown" }, { source: "flag", result: "ok", answer: "secret" }]) {
    expect(validate({ ...challenge, skillEvidence: [{ ...challenge.skillEvidence[0], rule }] })).toBe(false);
  }
  expect(validate({ ...challenge, skillEvidence: [] })).toBe(false);
  expect(validate({ ...challenge, skillEvidence: [{ ...challenge.skillEvidence[0], label: " " }] })).toBe(false);
});

test("supported scorer variants and authors retain independent contracts", () => {
  for (const kind of ["flag", "verify"]) {
    expect(checkSkillEvidence({ ...challenge, scoring: { kind } })).toEqual([]);
  }
  for (const kind of ["uptime", "uptime-flat", "uptime-multi"]) {
    expect(checkSkillEvidence({ ...battle, scoring: { kind } })).toEqual([]);
  }
  expect(validate({ ...challenge, authors: [{ name: "Example Author", profileUrl: "https://example.com/profile" }] })).toBe(true);
  expect(validate({ ...challenge, authors: [{ name: " " }] })).toBe(false);
  for (const extra of [{ individualId: "member" }, { level: "expert" }, { totalScore: 100 }]) {
    expect(validate({ ...challenge, skillEvidence: [{ ...challenge.skillEvidence[0], ...extra }] })).toBe(false);
  }
});
