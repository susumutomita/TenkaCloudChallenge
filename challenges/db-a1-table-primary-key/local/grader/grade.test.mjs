/**
 * Unit tests for the db-a1-table-primary-key grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * states a participant's database can actually be in; the grader's job is to
 * turn those states into a verdict, so the tests pin exactly that mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

/** The starting state: training.members does not exist yet. */
class EmptyClient {
  async membersPrimaryKeyColumns() {
    return null;
  }
  async membersRowCount() {
    return null;
  }
  async unkeyedDistinctEmailCount() {
    return 7;
  }
  async attemptDuplicateInsert() {
    return { rejected: false, reason: "no-rows" };
  }
}

/** A table exists but has no PRIMARY KEY at all (e.g. a plain CREATE TABLE).
 *  Distinct from EmptyClient: the relation itself exists, so
 *  membersPrimaryKeyColumns() must return `[]`, not `null` — conflating the
 *  two used to make /verify claim "training.members がまだ存在しない" (the
 *  table does not exist) even when it plainly did; see grade.mjs's `[] =
 *  table exists with no PRIMARY KEY at all` contract note. */
class NoPkClient {
  async membersPrimaryKeyColumns() {
    return [];
  }
  async membersRowCount() {
    return 7;
  }
  async unkeyedDistinctEmailCount() {
    return 7;
  }
  async attemptDuplicateInsert() {
    return { rejected: false, reason: "insert-succeeded" };
  }
}

/** A PRIMARY KEY exists but on the wrong column (e.g. a synthetic `id`, mirroring
 *  the predecessor's members_unkeyed mistake instead of fixing it). */
class WrongKeyClient {
  async membersPrimaryKeyColumns() {
    return ["id"];
  }
  async membersRowCount() {
    return 11; // copied everything, duplicates included
  }
  async unkeyedDistinctEmailCount() {
    return 7;
  }
  async attemptDuplicateInsert() {
    return { rejected: false, reason: "insert-succeeded" };
  }
}

/** The correct state: email is genuinely the primary key, data is deduplicated,
 *  and the engine actively rejects a duplicate. */
class SolvedClient {
  async membersPrimaryKeyColumns() {
    return ["email"];
  }
  async membersRowCount() {
    return 7;
  }
  async unkeyedDistinctEmailCount() {
    return 7;
  }
  async attemptDuplicateInsert() {
    return { rejected: true, sqlState: "23505" };
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "members-table-has-primary-key",
      "members-rows-loaded",
      "duplicate-insert-rejected",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("members-table-has-primary-key", () => {
  it("fails when the table does not exist yet", async () => {
    const result = await CHECKS[0].run(new EmptyClient());
    expect(result.passed).toBe(false);
  });

  it("fails when the table has no primary key", async () => {
    const result = await CHECKS[0].run(new NoPkClient());
    expect(result.passed).toBe(false);
  });

  it("fails when the primary key is on the wrong column", async () => {
    const result = await CHECKS[0].run(new WrongKeyClient());
    expect(result.passed).toBe(false);
  });

  it("passes when email is (part of) the primary key", async () => {
    const result = await CHECKS[0].run(new SolvedClient());
    expect(result.passed).toBe(true);
  });

  it("distinguishes 'table missing' from 'table exists with no PRIMARY KEY' in the message", async () => {
    // Regression test: membersPrimaryKeyColumns() used to return `null` for
    // BOTH states, so the "table missing" message was shown even when the
    // table genuinely existed and merely lacked a primary key. The two must
    // now produce different, individually accurate messages.
    const missingTable = await CHECKS[0].run(new EmptyClient());
    const existsNoPk = await CHECKS[0].run(new NoPkClient());
    expect(missingTable.passed).toBe(false);
    expect(existsNoPk.passed).toBe(false);
    expect(missingTable.detail).not.toBe(existsNoPk.detail);
    expect(missingTable.detail).toMatch(/存在しない/);
    expect(existsNoPk.detail).not.toMatch(/存在しない/);
  });
});

describe("members-rows-loaded", () => {
  it("fails when the table does not exist", async () => {
    const result = await CHECKS[1].run(new EmptyClient());
    expect(result.passed).toBe(false);
  });

  it("fails when duplicates were copied in as-is (row count != distinct count)", async () => {
    const result = await CHECKS[1].run(new WrongKeyClient());
    expect(result.passed).toBe(false);
  });

  it("passes when the row count matches the deduplicated source count", async () => {
    const result = await CHECKS[1].run(new SolvedClient());
    expect(result.passed).toBe(true);
  });
});

describe("duplicate-insert-rejected", () => {
  it("fails when there is nothing to probe against", async () => {
    const result = await CHECKS[2].run(new EmptyClient());
    expect(result.passed).toBe(false);
  });

  it("fails when a duplicate insert silently succeeds (no real constraint)", async () => {
    const result = await CHECKS[2].run(new NoPkClient());
    expect(result.passed).toBe(false);
  });

  it("passes when the engine rejects the duplicate with a unique violation", async () => {
    const result = await CHECKS[2].run(new SolvedClient());
    expect(result.passed).toBe(true);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new SolvedClient(), "members-table-has-primary-key");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new SolvedClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("a half-solved state (dedup done, PK missing) fails the PK and duplicate checks only", async () => {
    const client = new NoPkClient();
    const pk = await evaluateCheckpoint(client, "members-table-has-primary-key");
    const rows = await evaluateCheckpoint(client, "members-rows-loaded");
    const dup = await evaluateCheckpoint(client, "duplicate-insert-rejected");
    expect(pk.correct).toBe(false);
    expect(rows.correct).toBe(true); // NoPkClient's row/distinct counts happen to match
    expect(dup.correct).toBe(false);
  });
});
