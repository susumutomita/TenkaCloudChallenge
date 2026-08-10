/**
 * Unit tests for the db-challenge-blocked-transaction grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * states a participant's database can actually be in (measured against a
 * real Postgres 16 instance while authoring this Challenge); the grader's
 * job is to turn those states into a verdict, so the tests pin exactly that
 * mapping.
 *
 * Extra emphasis vs. a plain "did the write complete" check: several fakes
 * specifically model the "there was never really a problem" and
 * "resolved the wrong session" near-misses this Challenge has to reject.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

const SEED_BALANCE = 100000;
const RESOLVED_BALANCE = 95000; // 100000 - 5000 (waiter); blocker's -10000 never lands (rolled back)

/** The untouched starting state: incident just started, blocker holding the
 * lock, waiter still pending, participant has done nothing yet. */
class UntouchedClient {
  async accountBalanceCents() {
    return SEED_BALANCE;
  }
  async originalBlockerStillActive() {
    return true;
  }
  async waiterWaitMs() {
    return null; // waiter has not completed yet
  }
}

/** The correct, real flow: participant identified the true blocker via
 * pg_blocking_pids() and terminated it. The waiter, which had genuinely been
 * pending for a while, then completed. */
class GenuinelyResolvedClient {
  async accountBalanceCents() {
    return RESOLVED_BALANCE;
  }
  async originalBlockerStillActive() {
    return false;
  }
  async waiterWaitMs() {
    return 8400; // comfortably realistic diagnosis time
  }
}

/** The participant terminated the HARMLESS DECOY connection instead of the
 * real blocker (a plausible mistake if they don't actually use
 * pg_blocking_pids() and just guess). The real blocker is still there, the
 * waiter is still stuck. */
class KilledTheDecoyInsteadClient {
  async accountBalanceCents() {
    return SEED_BALANCE;
  }
  async originalBlockerStillActive() {
    return true; // the REAL blocker never got touched
  }
  async waiterWaitMs() {
    return null;
  }
}

/** "There was never really a problem": a hypothetical bug (or a container
 * that restarted at just the right moment) where the waiter's write went
 * through almost instantly with no real contention — the final numbers look
 * right, but no genuine block-then-resolve ever happened. Must NOT pass. */
class NoRealContentionClient {
  async accountBalanceCents() {
    return RESOLVED_BALANCE;
  }
  async originalBlockerStillActive() {
    return false;
  }
  async waiterWaitMs() {
    return 3; // near-instant — nothing to have waited on
  }
}

/** The blocker is gone and the wait was genuine, but the final balance is
 * wrong — e.g. only the blocker's debit landed somehow (should be
 * structurally impossible given participant has no UPDATE grant, but the
 * checkpoint must still catch it defensively). */
class WrongFinalBalanceClient {
  async accountBalanceCents() {
    return 90000; // as if BOTH -10000 and -5000 landed
  }
  async originalBlockerStillActive() {
    return false;
  }
  async waiterWaitMs() {
    return 8400;
  }
}

/** No blocker has ever been recorded yet (a boot-timing edge case — the
 * grader must not crash on it). */
class NoBlockerRecordedYetClient {
  async accountBalanceCents() {
    return SEED_BALANCE;
  }
  async originalBlockerStillActive() {
    return null;
  }
  async waiterWaitMs() {
    return null;
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "blocking-session-cleared",
      "genuine-wait-then-resolution",
      "stuck-write-completed",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("blocking-session-cleared", () => {
  it("fails on the untouched starting state", async () => {
    expect((await CHECKS[0].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails when the participant terminated the decoy instead of the real blocker", async () => {
    expect((await CHECKS[0].run(new KilledTheDecoyInsteadClient())).passed).toBe(false);
  });

  it("fails gracefully (not throw) when no blocker has been recorded yet", async () => {
    const result = await CHECKS[0].run(new NoBlockerRecordedYetClient());
    expect(result.passed).toBe(false);
  });

  it("passes once the original blocker's backend is confirmed gone", async () => {
    expect((await CHECKS[0].run(new GenuinelyResolvedClient())).passed).toBe(true);
  });
});

describe("genuine-wait-then-resolution", () => {
  it("fails on the untouched starting state (write never completed)", async () => {
    expect((await CHECKS[1].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails for the 'there was never really a problem' near-instant completion", async () => {
    const result = await CHECKS[1].run(new NoRealContentionClient());
    expect(result.passed).toBe(false);
  });

  it("passes for a completion with a genuinely long pending wait", async () => {
    expect((await CHECKS[1].run(new GenuinelyResolvedClient())).passed).toBe(true);
  });
});

describe("stuck-write-completed", () => {
  it("fails on the untouched starting state", async () => {
    expect((await CHECKS[2].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails when the final balance is wrong even if the blocker is gone and the wait was genuine", async () => {
    expect((await CHECKS[2].run(new WrongFinalBalanceClient())).passed).toBe(false);
  });

  it("passes once the balance reflects exactly the waiter's debit", async () => {
    const result = await CHECKS[2].run(new GenuinelyResolvedClient());
    expect(result.passed).toBe(true);
    expect(result.detail).toContain(String(RESOLVED_BALANCE));
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new GenuinelyResolvedClient(), "stuck-write-completed");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new GenuinelyResolvedClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("the untouched starting state fails all 3 checkpoints", async () => {
    const client = new UntouchedClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(false);
    }
  });

  it("killing the decoy instead of the real blocker fails all 3 checkpoints", async () => {
    const client = new KilledTheDecoyInsteadClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(false);
    }
  });

  it("'there was never really a problem' fails at least the genuine-wait checkpoint even though the balance is right", async () => {
    const client = new NoRealContentionClient();
    const verdicts = Object.fromEntries(
      await Promise.all(CHECKS.map(async (c) => [c.id, (await evaluateCheckpoint(client, c.id)).correct])),
    );
    expect(verdicts["stuck-write-completed"]).toBe(true);
    expect(verdicts["blocking-session-cleared"]).toBe(true);
    expect(verdicts["genuine-wait-then-resolution"]).toBe(false);
  });

  it("a genuinely resolved incident passes all 3 checkpoints", async () => {
    const client = new GenuinelyResolvedClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });
});
