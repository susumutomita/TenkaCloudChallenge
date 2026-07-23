/**
 * Unit tests for the wix-exposure-audit remediation / re-verification logic.
 *
 * These run with `bun test` against plain in-memory state — no HTTP, no Docker.
 * server.mjs can't be imported here (it opens two listeners as an import side
 * effect), so the order-gated decision logic lives in remediation.mjs
 * specifically so it stays testable (mirrors api-idor-demo/authorization.mjs).
 *
 * Regression coverage for issue #201:
 *   (a) the confirmation flag is NOT obtainable before all three settings close;
 *   (b) an early re-verification does not soft-lock and stays retryable;
 *   (c) the flag becomes obtainable after all three close + a re-verification.
 */
import { describe, expect, it } from "bun:test";
import { checkpointCorrect, remediationStatus, reverify } from "./remediation.mjs";

const FLAGS = {
  "preview-indexing": "TC{wixpreview_aaaa}",
  "shared-inbox": "TC{wixinbox_bbbb}",
  "stale-collaborator": "TC{wixagency_cccc}",
  "settings-remediation": "TC{wixverify_dddd}",
};

const allOpen = () => ({
  searchIndexing: true,
  inboxShareActive: true,
  agencyCollaboratorActive: true,
});
const allClosed = () => ({
  searchIndexing: false,
  inboxShareActive: false,
  agencyCollaboratorActive: false,
});

describe("remediationStatus (N of 3 progress report)", () => {
  it("should report 0 of 3 closed when nothing has been remediated", () => {
    const status = remediationStatus(allOpen());
    expect(status.closedCount).toBe(0);
    expect(status.total).toBe(3);
    expect(status.allClosed).toBe(false);
    expect(status.remaining).toHaveLength(3);
  });

  it("should count each closed control and shrink the remaining list", () => {
    const controls = { ...allOpen(), searchIndexing: false, inboxShareActive: false };
    const status = remediationStatus(controls);
    expect(status.closedCount).toBe(2);
    expect(status.allClosed).toBe(false);
    expect(status.remaining.map((step) => step.key)).toEqual(["agencyCollaboratorActive"]);
  });

  it("should report all closed only when every control is closed", () => {
    const status = remediationStatus(allClosed());
    expect(status.closedCount).toBe(3);
    expect(status.allClosed).toBe(true);
    expect(status.remaining).toEqual([]);
  });
});

describe("reverify (flag is emitted only after genuine re-verification)", () => {
  it("(a) should NOT emit the flag before all three are closed", () => {
    expect(reverify(allOpen(), FLAGS["settings-remediation"]).flag).toBeNull();
    const partial = { ...allClosed(), agencyCollaboratorActive: true };
    expect(reverify(partial, FLAGS["settings-remediation"]).flag).toBeNull();
  });

  it("(b) should be a pure, retryable progress report that never mutates state", () => {
    const controls = allOpen();
    const first = reverify(controls, FLAGS["settings-remediation"]);
    const second = reverify(controls, FLAGS["settings-remediation"]);
    // Same answer every time, and the controls object is untouched (no soft-lock).
    expect(first).toEqual(second);
    expect(first.flag).toBeNull();
    expect(first.closedCount).toBe(0);
    expect(controls).toEqual(allOpen());
  });

  it("(c) should emit the confirmation flag once all three are closed", () => {
    const result = reverify(allClosed(), FLAGS["settings-remediation"]);
    expect(result.allClosed).toBe(true);
    expect(result.flag).toBe(FLAGS["settings-remediation"]);
  });

  it("should stay retryable after remediation: re-running keeps emitting the flag", () => {
    const controls = allClosed();
    expect(reverify(controls, FLAGS["settings-remediation"]).flag).toBe(FLAGS["settings-remediation"]);
    expect(reverify(controls, FLAGS["settings-remediation"]).flag).toBe(FLAGS["settings-remediation"]);
  });
});

describe("checkpointCorrect (settings-remediation is double-gated)", () => {
  it("(a) should reject the confirmation flag before all three are closed", () => {
    // Even a player who already knows the per-deploy flag cannot pass early.
    expect(
      checkpointCorrect("settings-remediation", FLAGS["settings-remediation"], allOpen(), FLAGS),
    ).toBe(false);
    const partial = { ...allClosed(), inboxShareActive: true };
    expect(
      checkpointCorrect("settings-remediation", FLAGS["settings-remediation"], partial, FLAGS),
    ).toBe(false);
  });

  it("should reject the memorized literal VERIFY (no longer a valid answer)", () => {
    expect(checkpointCorrect("settings-remediation", "VERIFY", allClosed(), FLAGS)).toBe(false);
  });

  it("(c) should accept the confirmation flag once all three are closed", () => {
    expect(
      checkpointCorrect("settings-remediation", FLAGS["settings-remediation"], allClosed(), FLAGS),
    ).toBe(true);
  });

  it("(b) should not soft-lock: a wrong early submit leaves the correct answer reachable later", () => {
    const controls = allOpen();
    // Early wrong attempt.
    expect(
      checkpointCorrect("settings-remediation", FLAGS["settings-remediation"], controls, FLAGS),
    ).toBe(false);
    // Player then closes all three (state the server would hold) and retries.
    const closed = allClosed();
    expect(
      checkpointCorrect("settings-remediation", FLAGS["settings-remediation"], closed, FLAGS),
    ).toBe(true);
  });

  it("should still evaluate the three evidence checkpoints on their exact flag", () => {
    for (const id of ["preview-indexing", "shared-inbox", "stale-collaborator"]) {
      expect(checkpointCorrect(id, FLAGS[id], allOpen(), FLAGS)).toBe(true);
      expect(checkpointCorrect(id, "TC{wrong}", allOpen(), FLAGS)).toBe(false);
    }
  });

  it("should reject an unknown checkpoint id", () => {
    expect(checkpointCorrect("nope", FLAGS["preview-indexing"], allClosed(), FLAGS)).toBe(false);
  });
});
