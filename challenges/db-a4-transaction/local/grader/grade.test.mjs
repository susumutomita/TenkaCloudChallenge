/**
 * Unit tests for the db-a4-transaction grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the states
 * a participant's database can actually be in (measured against a real Postgres 16
 * instance while authoring this drill); the grader's job is to turn those states
 * into a verdict, so the tests pin exactly that mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

/** The untouched starting state: alice=3000, bob=10000, carol=7000, total=20000.
 * Nothing has happened yet. seed.sql seeds alice and bob via 2 SEPARATE INSERT
 * statements specifically so their xmin values differ from the very start — the
 * grader must not be able to pass updates-committed-atomically for free, by
 * coincidence, before the participant has done anything at all. */
class UntouchedClient {
  async totalBalanceCents() {
    return 20000;
  }
  async transferBalancesCents() {
    return { alice: 3000, bob: 10000 };
  }
  async transferXmins() {
    return { alice: "700", bob: "701" }; // 2 separate seed INSERT statements
  }
}

/** The participant ran the doomed 5000-cent demo transfer WITHOUT a transaction and
 * never cleaned up: bob's credit committed (autocommit), alice's debit then failed
 * the balance_cents >= 0 check and had no effect. Money materialized: total is now
 * 25000, not 20000. */
class UncleanedCorruptionClient {
  async totalBalanceCents() {
    return 25000;
  }
  async transferBalancesCents() {
    return { alice: 3000, bob: 15000 };
  }
  async transferXmins() {
    return { alice: "701", bob: "702" };
  }
}

/** The participant ran the doomed 5000-cent demo transfer INSIDE a transaction,
 * hit the same check violation, and ran ROLLBACK — nothing committed, so the table
 * is exactly back to the untouched state. This is the correct "atomicity protected
 * me" outcome of the demo step, but the drill's actual goal (the 1000-cent
 * transfer) has not happened yet. */
class ProtectedByRollbackClient extends UntouchedClient {}

/** The correct end state: alice sent bob 1000 cents as a single atomic unit (either
 * one multi-row UPDATE or BEGIN…COMMIT wrapping two statements) — same xmin on
 * both rows. */
class SolvedAtomicClient {
  async totalBalanceCents() {
    return 20000;
  }
  async transferBalancesCents() {
    return { alice: 2000, bob: 11000 };
  }
  async transferXmins() {
    return { alice: "955", bob: "955" };
  }
}

/** The right final numbers, but reached via two separate autocommit statements
 * (no BEGIN/COMMIT at all) — each gets its own transaction id, so xmin differs.
 * Every other checkpoint would look "solved"; this is the one that must still
 * catch it. */
class SolvedButNotAtomicClient {
  async totalBalanceCents() {
    return 20000;
  }
  async transferBalancesCents() {
    return { alice: 2000, bob: 11000 };
  }
  async transferXmins() {
    return { alice: "960", bob: "961" };
  }
}

/** Wrong amount transferred (e.g. participant sent 500 instead of 1000) — happens
 * to still conserve the total and even happens to be atomic, but is not the
 * transfer the drill asks for. */
class WrongAmountAtomicClient {
  async totalBalanceCents() {
    return 20000;
  }
  async transferBalancesCents() {
    return { alice: 2500, bob: 10500 };
  }
  async transferXmins() {
    return { alice: "970", bob: "970" };
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "total-balance-conserved",
      "transfer-applied-correctly",
      "updates-committed-atomically",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("total-balance-conserved", () => {
  it("passes on the untouched starting state", async () => {
    expect((await CHECKS[0].run(new UntouchedClient())).passed).toBe(true);
  });

  it("fails when the no-transaction demo corrupted the total and was never cleaned up", async () => {
    const result = await CHECKS[0].run(new UncleanedCorruptionClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("25000");
  });

  it("passes once ROLLBACK has undone the same doomed demo transfer", async () => {
    expect((await CHECKS[0].run(new ProtectedByRollbackClient())).passed).toBe(true);
  });

  it("passes on the fully solved state", async () => {
    expect((await CHECKS[0].run(new SolvedAtomicClient())).passed).toBe(true);
  });
});

describe("transfer-applied-correctly", () => {
  it("fails on the untouched starting state (no transfer happened yet)", async () => {
    expect((await CHECKS[1].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails on the uncleaned-corruption state (alice never actually lost anything)", async () => {
    expect((await CHECKS[1].run(new UncleanedCorruptionClient())).passed).toBe(false);
  });

  it("fails on a rolled-back demo (nothing committed, so no transfer happened)", async () => {
    expect((await CHECKS[1].run(new ProtectedByRollbackClient())).passed).toBe(false);
  });

  it("fails when the wrong amount was transferred", async () => {
    const result = await CHECKS[1].run(new WrongAmountAtomicClient());
    expect(result.passed).toBe(false);
  });

  it("passes once the exact 1000-cent transfer landed", async () => {
    expect((await CHECKS[1].run(new SolvedAtomicClient())).passed).toBe(true);
  });

  it("passes regardless of atomicity — this checkpoint only checks the numbers", async () => {
    expect((await CHECKS[1].run(new SolvedButNotAtomicClient())).passed).toBe(true);
  });
});

describe("updates-committed-atomically", () => {
  it("fails on the uncleaned-corruption state (two different transactions touched the rows)", async () => {
    expect((await CHECKS[2].run(new UncleanedCorruptionClient())).passed).toBe(false);
  });

  it("passes on the fully solved atomic state", async () => {
    const result = await CHECKS[2].run(new SolvedAtomicClient());
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("955");
  });

  it("fails when the right numbers were reached via two separate autocommit statements", async () => {
    const result = await CHECKS[2].run(new SolvedButNotAtomicClient());
    expect(result.passed).toBe(false);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new SolvedAtomicClient(), "total-balance-conserved");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new SolvedAtomicClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("the untouched starting state fails 2 of 3 checkpoints (total is trivially conserved)", async () => {
    const client = new UntouchedClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, false, false]);
  });

  it("a fully solved, atomic transfer passes all 3 checkpoints", async () => {
    const client = new SolvedAtomicClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });

  it("the right final numbers reached non-atomically fail exactly 1 of 3 checkpoints", async () => {
    const client = new SolvedButNotAtomicClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, true, false]);
  });
});
