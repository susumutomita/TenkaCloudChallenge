import { describe, expect, test } from "bun:test";
import {
  affectedProblemIds,
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
      evidenceUrl: "https://github.com/susumutomita/TenkaCloudChallenge/issues/463#issuecomment-1",
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
    expect(() => parsePlayabilityEvidence("<!-- tenkacloud-playability-v1\n{not-json}\n-->")).toThrow(
      "valid JSON",
    );
  });
});

describe("problem change classification", () => {
  const metadata = new Map([
    ["base:challenges/promoted/metadata.json", JSON.stringify({ id: "promoted", status: "draft" })],
    ["head:challenges/promoted/metadata.json", JSON.stringify({ id: "promoted", status: "ready" })],
    ["head:challenges/shipped/metadata.json", JSON.stringify({ id: "shipped", status: "ready" })],
    ["head:challenges/in-progress/metadata.json", JSON.stringify({ id: "in-progress", status: "draft" })],
  ]);
  const readAtRef = (ref: "base" | "head", path: string) => metadata.get(`${ref}:${path}`);

  test("finds added problem roots and draft-to-ready promotions", () => {
    const changes = classifyProblemChanges(
      [
        "A\tchallenges/new-problem/metadata.json",
        "M\tchallenges/promoted/metadata.json",
        "A\tscripts/asm-worst-case-latency.test.ts",
        "M\tREADME.md",
      ].join("\n"),
      readAtRef,
      "test(asm-worst-case-latency): define playable MVP contract",
    );

    expect(changes).toEqual({
      addedProblemIds: ["new-problem"],
      promotedReadyProblemIds: ["promoted"],
      participantFacingReadyProblemIds: [],
      contractOnlyProblemIds: ["asm-worst-case-latency"],
    });
  });

  // Regression fixture for the #463 (2026-08-13) comment: PR #473 rewrote hints and
  // starter material for 6 already-`status: ready` problems, and the gate at the time
  // reported "no new problem or ready promotion" and let it through untouched. This
  // is the shape it must now catch: no metadata.json change at all, only participant
  // -facing files, on a problem that is already `status: ready`.
  test("catches a participant-facing rewrite of an already-ready problem (PR #473 shape)", () => {
    const changes = classifyProblemChanges(
      [
        "M\tchallenges/shipped/README.md",
        "M\tchallenges/shipped/README.ja.md",
        "M\tchallenges/shipped/local/starter/solution.py",
      ].join("\n"),
      readAtRef,
    );

    expect(changes.participantFacingReadyProblemIds).toEqual(["shipped"]);
    expect(changes.addedProblemIds).toEqual([]);
    expect(changes.promotedReadyProblemIds).toEqual([]);
  });

  test("does not flag participant-facing edits to a problem that is still draft", () => {
    const changes = classifyProblemChanges(
      ["M\tchallenges/in-progress/README.md", "M\tchallenges/in-progress/local/starter/solution.py"].join(
        "\n",
      ),
      readAtRef,
    );

    expect(changes.participantFacingReadyProblemIds).toEqual([]);
  });

  test("does not double-report a brand-new problem's own README/starter as a separate finding", () => {
    const changes = classifyProblemChanges(
      [
        "A\tchallenges/new-problem/metadata.json",
        "A\tchallenges/new-problem/README.md",
        "A\tchallenges/new-problem/local/starter/solution.py",
      ].join("\n"),
      () => JSON.stringify({ status: "draft" }),
    );

    expect(changes.addedProblemIds).toEqual(["new-problem"]);
    expect(changes.participantFacingReadyProblemIds).toEqual([]);
  });

  test("does not treat verifier/reference (non participant-facing) edits as requiring evidence", () => {
    const changes = classifyProblemChanges(
      [
        "M\tchallenges/shipped/local/verifier/server.py",
        "M\tchallenges/shipped/local/reference/counter.py",
      ].join("\n"),
      readAtRef,
    );

    expect(changes.participantFacingReadyProblemIds).toEqual([]);
  });

  test("ignores ordinary edits and refuses malformed problem metadata", () => {
    expect(classifyProblemChanges("M\tchallenges/existing/README.md", () => undefined)).toEqual({
      addedProblemIds: [],
      promotedReadyProblemIds: [],
      participantFacingReadyProblemIds: [],
      contractOnlyProblemIds: [],
    });

    expect(() =>
      classifyProblemChanges("M\tchallenges/broken/metadata.json", (ref) => (ref === "base" ? "{}" : "{")),
    ).toThrow("cannot parse");
  });
});

describe("new-problem / ready-promotion / participant-facing gate", () => {
  // This is the exact regression this Issue exists to prevent: #476 removed the
  // whole gate because it kept a legitimately in-progress Draft PR permanently red.
  // The fix is not "never fail" — it is "do not fail while Draft", because GitHub
  // already refuses to merge a Draft PR regardless of this check's result.
  test("does not fail an unrelated Draft PR", () => {
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

  test("does not fail a Draft PR that touches a brand-new problem or a RED-only scope test", () => {
    expect(
      evaluatePlayabilityGate({
        draft: true,
        body: "",
        labels: [],
        addedProblemIds: ["new-problem"],
        promotedReadyProblemIds: [],
        contractOnlyProblemIds: ["asm-worst-case-latency"],
      }),
    ).toEqual([]);
  });

  test("requires the human-owned label even with complete evidence, once non-Draft", () => {
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

  test("blocks the same PR once it is marked ready for review without evidence (#459/#472/#475 shape)", () => {
    expect(
      evaluatePlayabilityGate({
        draft: false,
        body: "",
        labels: [],
        addedProblemIds: ["ac26-w3-ntt-roots"],
        promotedReadyProblemIds: [],
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining("playtest-verified"), expect.stringContaining("evidence")]),
    );
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

  test("blocks a participant-facing rewrite of an already-ready problem without evidence (#473 shape)", () => {
    expect(
      evaluatePlayabilityGate({
        draft: false,
        body: "",
        labels: ["playtest-verified"],
        addedProblemIds: [],
        promotedReadyProblemIds: [],
        participantFacingReadyProblemIds: ["shipped"],
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
    ).toEqual([expect.stringContaining("starterFailed"), expect.stringContaining("evidenceUrl")]);
  });

  // Regression fixture for the #463 (2026-08-14) comment: PR #472 merged with the
  // evidence block still holding the documentation's literal example values. The
  // parser alone accepted that (it is syntactically valid JSON matching the schema),
  // so the placeholder/template values themselves must be rejected by content.
  test("rejects an evidence block that is still the unfilled documentation template (#472 shape)", () => {
    const templateCopy = {
      schemaVersion: 1,
      problems: [
        {
          id: "new-problem",
          tester: "@github-handle",
          completedAt: "2026-08-12T12:00:00Z",
          blind: true,
          starterFailed: true,
          solutionPassed: true,
          negativeCasesPassed: true,
          cleanupPassed: true,
          evidenceUrl: "https://github.com/susumutomita/TenkaCloudChallenge/issues/123#issuecomment-456",
        },
      ],
    };

    expect(
      evaluatePlayabilityGate({
        draft: false,
        body: bodyWithEvidence(templateCopy),
        labels: ["playtest-verified"],
        addedProblemIds: ["new-problem"],
        promotedReadyProblemIds: [],
      }),
    ).toEqual([expect.stringContaining("tester"), expect.stringContaining("evidenceUrl")]);
  });

  test("rejects a future completedAt", () => {
    const future = structuredClone(completeEvidence);
    future.problems[0].completedAt = "2999-01-01T00:00:00Z";

    expect(
      evaluatePlayabilityGate({
        draft: false,
        body: bodyWithEvidence(future),
        labels: ["playtest-verified"],
        addedProblemIds: ["new-problem"],
        promotedReadyProblemIds: [],
      }),
    ).toEqual([expect.stringContaining("completedAt")]);
  });
});

describe("affectedProblemIds", () => {
  test("de-duplicates and sorts across all four detection axes", () => {
    expect(
      affectedProblemIds({
        addedProblemIds: ["b"],
        promotedReadyProblemIds: ["a"],
        participantFacingReadyProblemIds: ["a"],
        contractOnlyProblemIds: ["c"],
      }),
    ).toEqual(["a", "b", "c"]);
  });

  test("is empty when nothing changed", () => {
    expect(
      affectedProblemIds({
        addedProblemIds: [],
        promotedReadyProblemIds: [],
      }),
    ).toEqual([]);
  });
});
