import { describe, expect, test } from "bun:test";
import {
  classifyProblemChanges,
  evaluatePlayabilityGate,
  parsePlayabilityEvidence,
} from "./check-pr-playability";

const completeEvidence = {
  schemaVersion: 1,
  problems: [
    {
      id: "new-problem",
      tester: "@human-reviewer",
      completedAt: "2026-08-12T12:00:00Z",
      blind: true,
      starterFailed: true,
      solutionPassed: true,
      negativeCasesPassed: true,
      cleanupPassed: true,
      evidenceUrl:
        "https://github.com/susumutomita/TenkaCloudChallenge/issues/463#issuecomment-1",
    },
  ],
};

const bodyWithEvidence = (value: unknown = completeEvidence) =>
  `## Playability evidence

<!-- tenkacloud-playability-v1
${JSON.stringify(value)}
-->
`;

describe("playability evidence parser", () => {
  test("parses the one machine-readable evidence block", () => {
    expect(parsePlayabilityEvidence(bodyWithEvidence())).toEqual(completeEvidence);
  });

  test("fails closed when the block is missing, duplicated, or malformed", () => {
    expect(() => parsePlayabilityEvidence("none")).toThrow("missing");
    expect(() =>
      parsePlayabilityEvidence(`${bodyWithEvidence()}
${bodyWithEvidence()}`),
    ).toThrow("exactly one");
    expect(() =>
      parsePlayabilityEvidence(
        "<!-- tenkacloud-playability-v1\n{not-json}\n-->",
      ),
    ).toThrow("valid JSON");
  });
});

describe("problem change classification", () => {
  const metadata = new Map([
    [
      "base:challenges/promoted/metadata.json",
      JSON.stringify({ id: "promoted", status: "draft" }),
    ],
    [
      "head:challenges/promoted/metadata.json",
      JSON.stringify({ id: "promoted", status: "ready" }),
    ],
  ]);

  test("finds added problem roots and draft-to-ready promotions", () => {
    const changes = classifyProblemChanges(
      [
        "A\tchallenges/new-problem/metadata.json",
        "M\tchallenges/promoted/metadata.json",
        "A\tscripts/asm-worst-case-latency.test.ts",
        "M\tREADME.md",
      ].join("\n"),
      (ref, path) => metadata.get(`${ref}:${path}`),
      "test(asm-worst-case-latency): define playable MVP contract",
    );

    expect(changes).toEqual({
      addedProblemIds: ["new-problem"],
      promotedReadyProblemIds: ["promoted"],
      contractOnlyProblemIds: ["asm-worst-case-latency"],
    });
  });

  test("ignores ordinary edits and refuses malformed problem metadata", () => {
    expect(
      classifyProblemChanges("M\tchallenges/existing/README.md", () => undefined),
    ).toEqual({
      addedProblemIds: [],
      promotedReadyProblemIds: [],
      contractOnlyProblemIds: [],
    });

    expect(() =>
      classifyProblemChanges(
        "M\tchallenges/broken/metadata.json",
        (ref) => (ref === "base" ? "{}" : "{"),
      ),
    ).toThrow("cannot parse");
  });
});

describe("new-problem and ready-promotion gate", () => {
  test("does not make an unrelated Draft PR red", () => {
    expect(
      evaluatePlayabilityGate({
        draft: true,
        body: "",
        labels: [],
        addedProblemIds: [],
        promotedReadyProblemIds: [],
      }),
    ).toEqual([]);
  });

  test("blocks a Draft or RED-only new problem", () => {
    expect(
      evaluatePlayabilityGate({
        draft: true,
        body: "",
        labels: [],
        addedProblemIds: ["new-problem"],
        promotedReadyProblemIds: [],
        contractOnlyProblemIds: ["asm-worst-case-latency"],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Draft"),
        expect.stringContaining("playtest-verified"),
        expect.stringContaining("evidence"),
      ]),
    );
  });

  test("requires the human-owned label even with complete evidence", () => {
    expect(
      evaluatePlayabilityGate({
        draft: false,
        body: bodyWithEvidence(),
        labels: [],
        addedProblemIds: ["new-problem"],
        promotedReadyProblemIds: [],
      }),
    ).toEqual([expect.stringContaining("playtest-verified")]);
  });

  test("accepts a completed attestation for every affected problem", () => {
    expect(
      evaluatePlayabilityGate({
        draft: false,
        body: bodyWithEvidence(),
        labels: ["playtest-verified"],
        addedProblemIds: ["new-problem"],
        promotedReadyProblemIds: [],
      }),
    ).toEqual([]);
  });

  test("blocks a ready promotion without evidence", () => {
    expect(
      evaluatePlayabilityGate({
        draft: false,
        body: "",
        labels: ["playtest-verified"],
        addedProblemIds: [],
        promotedReadyProblemIds: ["promoted"],
      }),
    ).toEqual([expect.stringContaining("evidence")]);
  });

  test("requires evidence for every problem in a multi-problem change", () => {
    expect(
      evaluatePlayabilityGate({
        draft: false,
        body: bodyWithEvidence(),
        labels: ["playtest-verified"],
        addedProblemIds: ["new-problem", "second-problem"],
        promotedReadyProblemIds: [],
      }),
    ).toEqual([expect.stringContaining("second-problem")]);
  });

  test("rejects vacuous or non-GitHub evidence fields", () => {
    const invalid = structuredClone(completeEvidence);
    invalid.problems[0].starterFailed = false;
    invalid.problems[0].evidenceUrl = "https://example.com/trust-me";

    expect(
      evaluatePlayabilityGate({
        draft: false,
        body: bodyWithEvidence(invalid),
        labels: ["playtest-verified"],
        addedProblemIds: ["new-problem"],
        promotedReadyProblemIds: [],
      }),
    ).toEqual([
      expect.stringContaining("starterFailed"),
      expect.stringContaining("evidenceUrl"),
    ]);
  });
});
