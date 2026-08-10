/**
 * Unit tests for the db-a12-partition grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * states a participant's database can actually be in (measured against a real
 * Postgres 16 instance while authoring this drill — a 6-partition, 120,000-row
 * metrics.events, DELETE against 2024-01, DETACH+DROP against 2024-02); the
 * grader's job is to turn those states into a verdict, so the tests pin
 * exactly that mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

const DELETE_TARGET = "events_y2024m01";
const DETACH_TARGET = "events_y2024m02";
const BYSTANDERS = ["events_y2024m03", "events_y2024m04", "events_y2024m05", "events_y2024m06"];

function intactCatalog() {
  const catalog = {};
  for (const name of [DELETE_TARGET, DETACH_TARGET, ...BYSTANDERS]) {
    catalog[name] = { exists: true, attached: true };
  }
  return catalog;
}

function intactBystanderCounts() {
  return Object.fromEntries(BYSTANDERS.map((name) => [name, 20_000]));
}

/** The untouched starting state: seed.sql just ran, nothing has happened. */
class UntouchedClient {
  async partitionCatalog() {
    return intactCatalog();
  }
  async deleteTargetRowCount() {
    return 20_000;
  }
  async detachTargetRowCount() {
    return 20_000;
  }
  async bystanderRowCounts() {
    return intactBystanderCounts();
  }
}

/** The correct, real flow: 2024-01 emptied via row DELETE (still attached, 0
 * rows), 2024-02 DETACHed then DROPped, bystanders untouched. */
class GenuineFlowClient {
  async partitionCatalog() {
    const catalog = intactCatalog();
    catalog[DETACH_TARGET] = { exists: false, attached: false }; // dropped after detach
    return catalog;
  }
  async deleteTargetRowCount() {
    return 0;
  }
  async detachTargetRowCount() {
    return null; // dropped
  }
  async bystanderRowCounts() {
    return intactBystanderCounts();
  }
}

/** Same genuine flow, but 2024-02 was only DETACHed, never DROPped — the
 * design brief says either counts. */
class DetachedNotDroppedClient extends GenuineFlowClient {
  async partitionCatalog() {
    const catalog = intactCatalog();
    catalog[DETACH_TARGET] = { exists: true, attached: false }; // detached, still a standalone table
    return catalog;
  }
  async detachTargetRowCount() {
    return 20_000; // still physically there, just not attached anymore
  }
}

/** The wrong-method swap: the participant DETACHed 2024-01 (the DELETE
 * target) instead of running a real DELETE against it. */
class WrongMethodOnDeleteTargetClient extends GenuineFlowClient {
  async partitionCatalog() {
    const catalog = intactCatalog();
    catalog[DELETE_TARGET] = { exists: false, attached: false }; // detached+dropped instead
    catalog[DETACH_TARGET] = { exists: false, attached: false };
    return catalog;
  }
  async deleteTargetRowCount() {
    return null;
  }
}

/** 2024-01 still has rows — the participant hasn't run the DELETE yet (or
 * only deleted part of it). */
class DeleteTargetNotEmptiedClient extends UntouchedClient {
  async partitionCatalog() {
    const catalog = intactCatalog();
    catalog[DETACH_TARGET] = { exists: false, attached: false };
    return catalog;
  }
  async deleteTargetRowCount() {
    return 12_000;
  }
  async detachTargetRowCount() {
    return null;
  }
}

/** 2024-02 is still attached — the participant hasn't detached it yet. */
class DetachTargetStillAttachedClient extends GenuineFlowClient {
  async partitionCatalog() {
    const catalog = intactCatalog();
    catalog[DETACH_TARGET] = { exists: true, attached: true };
    return catalog;
  }
  async detachTargetRowCount() {
    return 20_000;
  }
}

/** A bystander month got detached by mistake even though the rest of the
 * flow was done correctly. */
class BystanderDetachedClient extends GenuineFlowClient {
  async partitionCatalog() {
    const catalog = intactCatalog();
    catalog[DETACH_TARGET] = { exists: false, attached: false };
    catalog["events_y2024m03"] = { exists: false, attached: false };
    return catalog;
  }
}

/** A bystander month lost rows by mistake (e.g. an over-broad DELETE). */
class BystanderRowsTouchedClient extends GenuineFlowClient {
  async bystanderRowCounts() {
    const counts = intactBystanderCounts();
    counts["events_y2024m04"] = 19_500;
    return counts;
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "old-partition-detached-or-dropped",
      "old-month-deleted-via-delete",
      "bystander-partitions-intact",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("old-partition-detached-or-dropped", () => {
  it("fails on the untouched starting state", async () => {
    expect((await CHECKS[0].run(new UntouchedClient())).passed).toBe(false);
  });

  it("passes when the partition was DROPped after DETACHing", async () => {
    expect((await CHECKS[0].run(new GenuineFlowClient())).passed).toBe(true);
  });

  it("passes when the partition was only DETACHed, never DROPped", async () => {
    expect((await CHECKS[0].run(new DetachedNotDroppedClient())).passed).toBe(true);
  });

  it("fails while the partition is still attached", async () => {
    expect((await CHECKS[0].run(new DetachTargetStillAttachedClient())).passed).toBe(false);
  });
});

describe("old-month-deleted-via-delete", () => {
  it("fails on the untouched starting state", async () => {
    expect((await CHECKS[1].run(new UntouchedClient())).passed).toBe(false);
  });

  it("passes on the genuine flow (attached, 0 rows)", async () => {
    const result = await CHECKS[1].run(new GenuineFlowClient());
    expect(result.passed).toBe(true);
  });

  it("fails when rows still remain", async () => {
    const result = await CHECKS[1].run(new DeleteTargetNotEmptiedClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("12000");
  });

  it("fails the wrong-method shortcut: DETACHing the delete target instead of DELETEing it", async () => {
    const result = await CHECKS[1].run(new WrongMethodOnDeleteTargetClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("attach");
  });
});

describe("bystander-partitions-intact", () => {
  it("passes on the untouched starting state (nothing has happened, bystanders trivially fine)", async () => {
    expect((await CHECKS[2].run(new UntouchedClient())).passed).toBe(true);
  });

  it("passes on the genuine flow", async () => {
    expect((await CHECKS[2].run(new GenuineFlowClient())).passed).toBe(true);
  });

  it("fails when a bystander partition got detached by mistake", async () => {
    const result = await CHECKS[2].run(new BystanderDetachedClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("events_y2024m03");
  });

  it("fails when a bystander partition lost rows", async () => {
    const result = await CHECKS[2].run(new BystanderRowsTouchedClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("19500");
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new GenuineFlowClient(), "old-partition-detached-or-dropped");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new GenuineFlowClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("the untouched starting state fails 2 of 3 checkpoints (bystanders trivially intact)", async () => {
    const client = new UntouchedClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([false, false, true]);
  });

  it("a fully solved, genuine flow passes all 3 checkpoints", async () => {
    const client = new GenuineFlowClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });

  it("detach-only (no drop) also passes all 3 checkpoints", async () => {
    const client = new DetachedNotDroppedClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });

  it("swapping methods (detaching the delete target) fails exactly the delete-target checkpoint", async () => {
    const client = new WrongMethodOnDeleteTargetClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, false, true]);
  });

  it("touching a bystander fails exactly the bystander checkpoint", async () => {
    const client = new BystanderRowsTouchedClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, true, false]);
  });
});
