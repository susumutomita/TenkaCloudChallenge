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

// Issue #523: `PARTICIPANT_FACING_SUBPATHS` only ever looked at *which files*
// changed. A PR that rewrites a hint (or `instructions`/`shortDescription`/
// `name`/a checkpoint `label`) purely inside an already-`status: ready`
// problem's `metadata.json` — touching no README, starter, workbench, or
// portal file at all — reported "no participant-facing change", the same
// class of gap PR #473 exploited one directory level up. These fixtures pin
// the field-level fix: it must compare metadata.json *values*, not just
// notice that the file changed.
describe("problem change classification — metadata.json field-level participant-facing diff (Issue #523)", () => {
  const readyMetadata = (hints: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: "shipped-hints",
      status: "ready",
      name: "Shipped",
      shortDescription: "A shipped problem.",
      instructions: "Read the evidence and submit the flag.",
      scoring: { kind: "flag", flagOutputKey: "Flag", points: 100, hints },
      ...extra,
    });

  test("positive: flags a hints-only rewrite inside metadata.json of an already-ready problem", () => {
    const metadata = new Map([
      ["base:challenges/shipped-hints/metadata.json", readyMetadata(["generic hint"])],
      ["head:challenges/shipped-hints/metadata.json", readyMetadata(["the flag equals the DB password"])],
    ]);
    const changes = classifyProblemChanges("M\tchallenges/shipped-hints/metadata.json", (ref, path) =>
      metadata.get(`${ref}:${path}`),
    );

    expect(changes.participantFacingReadyProblemIds).toEqual(["shipped-hints"]);
    expect(changes.promotedReadyProblemIds).toEqual([]);
    expect(changes.addedProblemIds).toEqual([]);
  });

  test("negative (PR #520 shape): a nodes/relations-only addition to an already-ready problem is not flagged", () => {
    const metadata = new Map([
      ["base:challenges/shipped-hints/metadata.json", readyMetadata(["generic hint"])],
      [
        "head:challenges/shipped-hints/metadata.json",
        readyMetadata(["generic hint"], {
          nodes: { concepts: [{ id: "concept.foo", description: "author-facing graph node" }] },
          relations: [{ type: "covers", source: "problem.shipped-hints", target: "concept.foo" }],
          courseAlignment: {
            courseId: "advanced-cryptography-program",
            edition: "2026",
            week: 3,
            role: "mechanism",
            spoilerPolicy: "independent-reimplementation",
          },
        }),
      ],
    ]);
    const changes = classifyProblemChanges("M\tchallenges/shipped-hints/metadata.json", (ref, path) =>
      metadata.get(`${ref}:${path}`),
    );

    expect(changes.participantFacingReadyProblemIds).toEqual([]);
    expect(changes.promotedReadyProblemIds).toEqual([]);
  });

  test("negative: a hints rewrite on a problem that is still status: draft is not flagged", () => {
    const draftMetadata = (hints: unknown) =>
      JSON.stringify({
        id: "in-progress-hints",
        status: "draft",
        scoring: { kind: "flag", flagOutputKey: "Flag", points: 100, hints },
      });
    const metadata = new Map([
      ["base:challenges/in-progress-hints/metadata.json", draftMetadata(["old hint"])],
      ["head:challenges/in-progress-hints/metadata.json", draftMetadata(["a completely different hint"])],
    ]);
    const changes = classifyProblemChanges("M\tchallenges/in-progress-hints/metadata.json", (ref, path) =>
      metadata.get(`${ref}:${path}`),
    );

    expect(changes.participantFacingReadyProblemIds).toEqual([]);
  });

  test("negative: an author-only field change (learningGoals) on an already-ready problem is not flagged", () => {
    const metadata = new Map([
      ["base:challenges/shipped-hints/metadata.json", readyMetadata(["generic hint"], { learningGoals: ["old goal"] })],
      [
        "head:challenges/shipped-hints/metadata.json",
        readyMetadata(["generic hint"], { learningGoals: ["old goal", "a new goal added"] }),
      ],
    ]);
    const changes = classifyProblemChanges("M\tchallenges/shipped-hints/metadata.json", (ref, path) =>
      metadata.get(`${ref}:${path}`),
    );

    expect(changes.participantFacingReadyProblemIds).toEqual([]);
  });
});

// Coordinator follow-up on Issue #523: `publicHint` gates participant
// visibility in three places in SCHEMA.json (`phases[]`, `disruptions[]`,
// `interTeamCoordination`), all with the same "true reveals name+description
// on the participant Portal's StatusPanel, default hides" policy. This is not
// hypothetical — `hello-world-battle`'s `disruptions[0]` and
// `microservice-migration-battle`'s `interTeamCoordination` both currently
// carry `publicHint: true` on `status: ready` problems, so their text is
// already on a live participant Portal.
describe("problem change classification — publicHint-gated text (disruptions/phases/interTeamCoordination)", () => {
  const readyWithDisruption = (description: string, publicHint: boolean | undefined) =>
    JSON.stringify({
      id: "battle-with-disruption",
      status: "ready",
      name: "Battle With Disruption",
      shortDescription: "A battle with a disruption.",
      instructions: "Keep the service up.",
      disruptions: [
        {
          id: "content-swap",
          name: "Content swap",
          eventDetailType: "tenkacloud.disruption.content-swap",
          description,
          ...(publicHint === undefined ? {} : { publicHint }),
        },
      ],
    });

  test("positive: rewriting a publicHint:true disruption's description on a ready problem is flagged", () => {
    const metadata = new Map([
      ["base:battles/battle-with-disruption/metadata.json", readyWithDisruption("A generic disruption warning.", true)],
      [
        "head:battles/battle-with-disruption/metadata.json",
        readyWithDisruption("The disruption swaps in the file containing the admin password.", true),
      ],
    ]);
    const changes = classifyProblemChanges("M	battles/battle-with-disruption/metadata.json", (ref, path) =>
      metadata.get(`${ref}:${path}`),
    );

    expect(changes.participantFacingReadyProblemIds).toEqual(["battle-with-disruption"]);
  });

  test("negative: rewriting the same field on the same problem is not flagged while publicHint stays false/absent", () => {
    const metadata = new Map([
      ["base:battles/battle-with-disruption/metadata.json", readyWithDisruption("A generic disruption warning.", undefined)],
      [
        "head:battles/battle-with-disruption/metadata.json",
        readyWithDisruption("The disruption swaps in the file containing the admin password.", undefined),
      ],
    ]);
    const changes = classifyProblemChanges("M	battles/battle-with-disruption/metadata.json", (ref, path) =>
      metadata.get(`${ref}:${path}`),
    );

    expect(changes.participantFacingReadyProblemIds).toEqual([]);
  });

  // This is the base/head OR case: the description text never changes, but
  // flipping publicHint from false/absent to true newly exposes it on the
  // participant Portal. A projection that only looked at head's publicHint
  // (or only at whether the text itself changed) would miss this.
  test("positive: flipping publicHint from false/absent to true is flagged even with unchanged text", () => {
    const metadata = new Map([
      ["base:battles/battle-with-disruption/metadata.json", readyWithDisruption("A generic disruption warning.", undefined)],
      ["head:battles/battle-with-disruption/metadata.json", readyWithDisruption("A generic disruption warning.", true)],
    ]);
    const changes = classifyProblemChanges("M	battles/battle-with-disruption/metadata.json", (ref, path) =>
      metadata.get(`${ref}:${path}`),
    );

    expect(changes.participantFacingReadyProblemIds).toEqual(["battle-with-disruption"]);
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
