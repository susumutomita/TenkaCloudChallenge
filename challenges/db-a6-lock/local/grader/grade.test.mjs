/**
 * Unit tests for the db-a6-lock grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * states a participant's database can actually be in (measured against a real
 * Postgres 16 instance while authoring this drill); the grader's job is to turn
 * those states into a verdict, so the tests pin exactly that mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, findGenuineLockWait, isKnownCheckpoint } from "./grade.mjs";

/** The untouched starting state: widget=300, gadget=120 (local/db/seed.sql),
 * nothing has happened yet — no audit log entries at all. */
class UntouchedClient {
  async stockQuantities() {
    return { widget: 300, gadget: 120 };
  }
  async lockWaitLog() {
    return [];
  }
}

/**
 * The correct, real flow: blocker (pid 100) opens `begin; update ... -100;`,
 * then `select pg_sleep(5);` before COMMIT — so its own audit entry's
 * stmt_started_at (1000) is long before its TRUE commit time (6000). Waiter
 * (pid 200) is launched via `\! ... &` shortly after (stmt_started_at 1050,
 * while blocker's transaction is still open), blocks on the row lock, and only
 * completes once blocker commits (committed_at 6050) — its own single-statement
 * transaction commits immediately once unblocked.
 */
class GenuineLockWaitClient {
  async stockQuantities() {
    return { widget: 150, gadget: 120 };
  }
  async lockWaitLog() {
    return [
      { backendPid: 100, txid: "701", stmtStartedAtMs: 1000, committedAtMs: 6000 },
      { backendPid: 200, txid: "702", stmtStartedAtMs: 1050, committedAtMs: 6050 },
    ];
  }
}

/** The laziest shortcut: two ordinary autocommit UPDATEs run back-to-back in the
 * SAME psql session (no BEGIN at all, no second connection) — both entries carry
 * the SAME backend_pid, and both are fast. Reaches the exact right numbers with
 * no lock contention whatsoever. */
class SameSessionShortcutClient {
  async stockQuantities() {
    return { widget: 150, gadget: 120 };
  }
  async lockWaitLog() {
    return [
      { backendPid: 100, txid: "701", stmtStartedAtMs: 1000, committedAtMs: 1005 },
      { backendPid: 100, txid: "702", stmtStartedAtMs: 1010, committedAtMs: 1015 },
    ];
  }
}

/** Two DIFFERENT sessions, but genuinely sequential — the second one starts only
 * AFTER the first already committed, so there is no lock contention (nothing to
 * wait for). Same right numbers, still not the exercise this drill asks for. */
class SequentialNoContentionClient {
  async stockQuantities() {
    return { widget: 150, gadget: 120 };
  }
  async lockWaitLog() {
    return [
      { backendPid: 100, txid: "701", stmtStartedAtMs: 1000, committedAtMs: 1010 },
      { backendPid: 200, txid: "702", stmtStartedAtMs: 2000, committedAtMs: 2010 },
    ];
  }
}

/** An attempted forgery: the second session embeds `pg_sleep()` inside its OWN
 * UPDATE statement to look slow, but never actually contends for the row (it
 * starts well after the first session already committed). The raw duration
 * alone would look identical to a genuine wait; the overlap check catches it
 * because the "blocker"'s true commit (1010) does not fall inside the
 * "waiter"'s window ([5000, 10000]). */
class SelfInflictedSleepClient {
  async stockQuantities() {
    return { widget: 150, gadget: 120 };
  }
  async lockWaitLog() {
    return [
      { backendPid: 100, txid: "701", stmtStartedAtMs: 1000, committedAtMs: 1010 },
      { backendPid: 200, txid: "702", stmtStartedAtMs: 5000, committedAtMs: 10000 },
    ];
  }
}

/** Only the blocker ever ran (never cleaned up / waiter never actually launched):
 * one audit entry, right numbers not reached (widget stuck at 200). */
class OnlyBlockerRanClient {
  async stockQuantities() {
    return { widget: 200, gadget: 120 };
  }
  async lockWaitLog() {
    return [{ backendPid: 100, txid: "701", stmtStartedAtMs: 1000, committedAtMs: 1010 }];
  }
}

/** gadget got touched by mistake (e.g. a copy-pasted WHERE clause targeting the
 * wrong id) even though the blocker/waiter dance on widget was otherwise done
 * correctly. */
class GadgetTouchedClient extends GenuineLockWaitClient {
  async stockQuantities() {
    return { widget: 150, gadget: 70 };
  }
}

/** The blocker's transaction is still open (never committed or rolled back) at
 * the moment of grading — pg_xact_commit_timestamp has nothing to report yet,
 * so its entry's committedAtMs is null and must not crash the matcher. */
class StillOpenTransactionClient {
  async stockQuantities() {
    return { widget: 300, gadget: 120 };
  }
  async lockWaitLog() {
    return [{ backendPid: 100, txid: "701", stmtStartedAtMs: 1000, committedAtMs: null }];
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "gadget-untouched",
      "widget-qty-correct",
      "row-lock-wait-observed",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("gadget-untouched", () => {
  it("passes on the untouched starting state", async () => {
    expect((await CHECKS[0].run(new UntouchedClient())).passed).toBe(true);
  });

  it("passes on the fully solved state", async () => {
    expect((await CHECKS[0].run(new GenuineLockWaitClient())).passed).toBe(true);
  });

  it("fails when gadget was touched by mistake", async () => {
    const result = await CHECKS[0].run(new GadgetTouchedClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("70");
  });
});

describe("widget-qty-correct", () => {
  it("fails on the untouched starting state", async () => {
    expect((await CHECKS[1].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails when only the blocker's debit ever landed", async () => {
    expect((await CHECKS[1].run(new OnlyBlockerRanClient())).passed).toBe(false);
  });

  it("passes once both debits landed, regardless of how they got there", async () => {
    expect((await CHECKS[1].run(new GenuineLockWaitClient())).passed).toBe(true);
    expect((await CHECKS[1].run(new SameSessionShortcutClient())).passed).toBe(true);
    expect((await CHECKS[1].run(new SequentialNoContentionClient())).passed).toBe(true);
  });
});

describe("findGenuineLockWait", () => {
  it("finds the overlap in a genuine lock wait", () => {
    const found = findGenuineLockWait([
      { backendPid: 100, stmtStartedAtMs: 1000, committedAtMs: 6000 },
      { backendPid: 200, stmtStartedAtMs: 1050, committedAtMs: 6050 },
    ]);
    expect(found).not.toBeNull();
    expect(found.waiter.backendPid).toBe(200);
    expect(found.blocker.backendPid).toBe(100);
  });

  it("returns null for empty or single-entry logs", () => {
    expect(findGenuineLockWait([])).toBeNull();
    expect(
      findGenuineLockWait([{ backendPid: 100, stmtStartedAtMs: 1000, committedAtMs: 1010 }]),
    ).toBeNull();
  });

  it("returns null when both entries share the same backend (no second session at all)", () => {
    expect(
      findGenuineLockWait([
        { backendPid: 100, stmtStartedAtMs: 1000, committedAtMs: 1005 },
        { backendPid: 100, stmtStartedAtMs: 1010, committedAtMs: 1015 },
      ]),
    ).toBeNull();
  });

  it("returns null for two different sessions with no temporal overlap", () => {
    expect(
      findGenuineLockWait([
        { backendPid: 100, stmtStartedAtMs: 1000, committedAtMs: 1010 },
        { backendPid: 200, stmtStartedAtMs: 2000, committedAtMs: 2010 },
      ]),
    ).toBeNull();
  });

  it("returns null for a self-inflicted long duration with no real contention", () => {
    expect(
      findGenuineLockWait([
        { backendPid: 100, stmtStartedAtMs: 1000, committedAtMs: 1010 },
        { backendPid: 200, stmtStartedAtMs: 5000, committedAtMs: 10000 },
      ]),
    ).toBeNull();
  });

  it("ignores entries with no known commit timestamp instead of crashing", () => {
    expect(
      findGenuineLockWait([{ backendPid: 100, stmtStartedAtMs: 1000, committedAtMs: null }]),
    ).toBeNull();
  });
});

describe("row-lock-wait-observed", () => {
  it("fails on the untouched starting state", async () => {
    expect((await CHECKS[2].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails when the transaction is still open (no commit timestamp yet)", async () => {
    expect((await CHECKS[2].run(new StillOpenTransactionClient())).passed).toBe(false);
  });

  it("fails for the same-session shortcut (no second backend at all)", async () => {
    const result = await CHECKS[2].run(new SameSessionShortcutClient());
    expect(result.passed).toBe(false);
  });

  it("fails for two sessions with no real temporal overlap", async () => {
    expect((await CHECKS[2].run(new SequentialNoContentionClient())).passed).toBe(false);
  });

  it("fails for a self-inflicted long duration with no real contention", async () => {
    expect((await CHECKS[2].run(new SelfInflictedSleepClient())).passed).toBe(false);
  });

  it("passes on the genuine lock-wait state", async () => {
    const result = await CHECKS[2].run(new GenuineLockWaitClient());
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("200");
    expect(result.detail).toContain("100");
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new GenuineLockWaitClient(), "gadget-untouched");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new GenuineLockWaitClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("the untouched starting state fails 2 of 3 checkpoints (gadget is trivially untouched)", async () => {
    const client = new UntouchedClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, false, false]);
  });

  it("a fully solved, genuinely-blocked scenario passes all 3 checkpoints", async () => {
    const client = new GenuineLockWaitClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });

  it("the right final numbers reached without any real contention fail exactly 1 of 3 checkpoints", async () => {
    const client = new SameSessionShortcutClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, true, false]);
  });

  it("a forged self-sleep duration with the right final numbers still fails the lock-wait checkpoint", async () => {
    const client = new SelfInflictedSleepClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, true, false]);
  });
});
