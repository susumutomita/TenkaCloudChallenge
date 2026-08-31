/**
 * [Issue #645] Reloading a match that was persisted by an OLDER version.
 *
 * A match is long-lived and its state is persisted between dispatcher calls,
 * so a deploy mid-match hands the reducer rows this version never wrote. Every
 * version that adds a required contract field has to say what an older row
 * means; this file is where that answer is executed rather than assumed.
 *
 * The failure this prevents is not subtle: `projectTask` reading `.kind` off
 * an absent `task` throws, `myContracts` includes completed and expired rows,
 * and no later `tick` repairs them — so ONE pre-upgrade Order takes the whole
 * match's participant projection down, for every team, permanently.
 */

import { describe, expect, test } from "bun:test";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { Contract, CryptoBattleState } from "./types.ts";

/**
 * [Issue #652] Carries a match secret because production always does — the
 * coordination dispatcher issues one before `initialState` runs. Pinning it
 * also pins the Order belt, which derives from the seed: without it these
 * fixtures would silently change shape whenever the seed does.
 */
const CTX = {
  eventId: "migration-tests",
  teamIds: ["teamA", "teamB"],
  matchSecret: "migration-secret-1",
} as const;

/** A row as the pre-#645 version wrote it: share indices, no `task`. */
function toPre645(contract: Contract): Contract {
  const { task, ...rest } = contract as Contract & { task?: unknown };
  return {
    ...rest,
    requestedShareIndices:
      task && typeof task === "object" && "shareIndices" in task
        ? (task as { shareIndices: readonly number[] }).shareIndices
        : [1],
  } as unknown as Contract;
}

/** A row as the pre-#650 version wrote it: no privacy rule, no method list. */
function toPre650(contract: Contract): Contract {
  const { privacyConstraint, allowedMethods, ...rest } = toPre645(contract) as Contract & {
    privacyConstraint?: unknown;
    allowedMethods?: unknown;
  };
  return rest as unknown as Contract;
}

/**
 * Several issuance rounds, then every row rewritten in the older shape — the
 * belt cycles through privacy rules, so one round would not contain an Order
 * that permits LEAK.
 */
function legacyState(shape: (c: Contract) => Contract): CryptoBattleState {
  let state = tick(initialState(CTX), 0);
  for (let round = 1; round <= 5; round += 1) {
    state = tick(state, round * DEFAULT_CONFIG.contractIntervalMs);
  }
  expect(state.contracts.length).toBeGreaterThan(1);
  return { ...state, contracts: state.contracts.map(shape) };
}

describe("a match persisted before this version still loads", () => {
  for (const [label, shape] of [
    ["pre-#645 (no task)", toPre645],
    ["pre-#650 (no task, no privacy rule, no method list)", toPre650],
  ] as const) {
    describe(label, () => {
      test("projectForTeam does not throw, and every Order arrives as a share Order", () => {
        const state = legacyState(shape);
        const projection = projectForTeam(state, "teamA");
        expect(projection.myContracts.length).toBeGreaterThan(0);
        for (const order of projection.myContracts) {
          expect(order.task.kind).toBe("reveal-share");
          expect(order.allowedMethods.length).toBeGreaterThan(0);
        }
      });

      test("a legacy Order can still be fulfilled, so the match stays playable", () => {
        const state = legacyState(shape);
        // A pre-#645 row KEEPS its own privacy rule, so an Order that was
        // PROVE-only before the upgrade is PROVE-only after it. Pick one the
        // rule actually permits rather than assuming the migration relaxes
        // anything -- it must not.
        const order = projectForTeam(state, "teamA").myContracts.find(
          (c) => c.status === "open" && c.allowedMethods.includes("leak"),
        );
        if (!order) throw new Error("expected an open legacy order that allows LEAK");

        const op = { kind: "leak" as const, contractId: order.id };
        expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
        const next = applyOp(state, "teamA", op);
        // [Issue #659] LEAK pays the leak rate. A legacy Order has no `leakPoints`
        // of its own, so the migration backfills the configured default —
        // without it the score would become NaN on the first leak.
        expect(next.teams.teamA?.score).toBe(order.leakPoints);
        expect(Number.isNaN(next.teams.teamA?.score)).toBe(false);
      });

      test("tick carries the upgraded rows forward, so it is not redone forever", () => {
        const state = legacyState(shape);
        const next = tick(state, DEFAULT_CONFIG.contractIntervalMs);
        for (const contract of next.contracts) {
          expect(contract.task).toBeDefined();
          expect(contract.allowedMethods).toBeDefined();
        }
      });

      test("the migration moves no score and loses no history", () => {
        const state = legacyState(shape);
        const before = state.contracts.map((c) => `${c.id}:${c.points}:${c.status}`);
        const after = tick(state, 0).contracts.map((c) => `${c.id}:${c.points}:${c.status}`);
        expect(after).toEqual(before);
      });
    });
  }
});

/**
 * [Issue #659] The same class of failure as the Order migration above, one
 * level up: the CONFIG persisted with a match also predates fields the current
 * reducer reads.
 *
 * `mergeConfig` only ever runs inside `initialState`, so defaults are filled in
 * at the moment a match starts and never again. Every later read comes off the
 * persisted row, and a coordination row outlives the code that wrote it -- that
 * is exactly why the platform needed an explicit run-reset (#3126 / #3135).
 * Both fields added by #659 fail QUIETLY without a migration, which is what
 * makes them worth pinning: neither throws, so nothing surfaces until an
 * operator notices the match has gone wrong.
 */
describe("a config persisted before this version still drives a playable match", () => {
  /** A row written before #659: no batch size, no LEAK or expiry rates. */
  function legacyConfigState(): CryptoBattleState {
    const started = tick(initialState({ eventId: "legacy-config", teamIds: ["teamA", "teamB"] }), 0);
    const persisted = JSON.parse(JSON.stringify(started)) as CryptoBattleState;
    const config = persisted.config as unknown as Record<string, unknown>;
    const scores = config.scores as Record<string, unknown>;
    delete config.contractsPerIssue;
    delete scores.expiredOrder;
    delete scores.contractLeak;
    return persisted;
  }

  test("it keeps issuing Orders instead of quietly winding down", () => {
    // `contractsPerIssue` undefined makes the batch loop's bound `undefined`,
    // so it runs zero times. The match does not crash -- it simply stops
    // handing out work, and every team runs out of things to do.
    const before = legacyConfigState();
    const after = tick(before, DEFAULT_CONFIG.contractIntervalMs);
    expect(after.contracts.length).toBeGreaterThan(before.contracts.length);
    expect(after.config.contractsPerIssue).toBe(DEFAULT_CONFIG.contractsPerIssue);
  });

  test("an expiry charges a real penalty rather than turning the score into NaN", () => {
    // `score + undefined` is NaN, and NaN survives every later addition: the
    // team's total is unrecoverable for the rest of the match.
    const after = tick(legacyConfigState(), DEFAULT_CONFIG.contractTtlMs);
    const score = after.teams.teamA?.score;
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBe(0);
    expect(after.config.scores.expiredOrder).toBe(DEFAULT_CONFIG.scores.expiredOrder);
  });

  test("the repaired config is written back, so the migration is not redone forever", () => {
    const after = tick(legacyConfigState(), DEFAULT_CONFIG.contractIntervalMs);
    expect(after.config.scores.contractLeak).toBe(DEFAULT_CONFIG.scores.contractLeak);
    // Values the row DID carry are left exactly as they were found.
    expect(after.config.matchDurationMs).toBe(DEFAULT_CONFIG.matchDurationMs);
    expect(after.config.threshold).toBe(DEFAULT_CONFIG.threshold);
  });
});

/**
 * [Issue #659] A tick that catches up on missed batches must not take live
 * Orders down with the dead ones.
 *
 * `tick` replays every issue instant it missed, and an Order whose deadline has
 * already passed is not issued at all -- otherwise a stalled dispatcher would
 * hand each team a pile of Orders they never saw and then charge them
 * `expiredOrder` for every one.
 *
 * The slot is consumed either way. Leaving `sequenceIndex` where it was would
 * re-roll the identical plan on the next iteration of the same batch, and since
 * the Order belt is a pure function of that index it would be stale again and
 * skip again: the batch dies at its first dead slot, and once the index is
 * frozen on one, the belt never issues anything again.
 */
describe("a delayed tick issues the Orders that are still live", () => {
  const GAP_MS = 3 * 60_000;

  test("a stale rush slot does not take the live standard slots behind it", () => {
    // Rush Orders expire in 2.5 min against a 5 min interval, so a 3-minute
    // dispatcher gap kills the rush slots and leaves the standard ones alive.
    let state = tick(initialState({ eventId: "delayed", teamIds: ["teamA"] }), 0);
    for (let batchIndex = 1; batchIndex <= 6; batchIndex += 1) {
      // [Issue #659] Count Orders that APPEARED, not the change in list length:
      // the same tick also prunes resolved and lapsed ones, so a delta is net
      // of both and can be negative while issuance is working perfectly.
      const before = new Set(state.contracts.map((c) => c.id));
      state = tick(state, batchIndex * DEFAULT_CONFIG.contractIntervalMs + GAP_MS);
      const issued = state.contracts.filter((c) => !before.has(c.id)).length;
      expect(issued).toBeGreaterThan(0);
      expect(issued).toBeLessThanOrEqual(DEFAULT_CONFIG.contractsPerIssue);
    }
  });

  test("no Order is ever issued already past its own deadline", () => {
    // The property the skip exists for: a team is only ever answerable for
    // Orders it had a chance to see.
    let state = tick(initialState({ eventId: "delayed-2", teamIds: ["teamA"] }), 0);
    for (let batchIndex = 1; batchIndex <= 8; batchIndex += 1) {
      const atMs = batchIndex * DEFAULT_CONFIG.contractIntervalMs + GAP_MS;
      const before = new Set(state.contracts.map((c) => c.id));
      state = tick(state, atMs);
      for (const c of state.contracts.filter((c) => !before.has(c.id))) {
        expect(c.expiresAtMs).toBeGreaterThan(atMs);
      }
    }
  });
});

/**
 * [Issue #659] The shape that actually shipped, and that the earlier tests in
 * this file could not produce.
 *
 * Every legacy fixture above builds its old row by deleting `task` and
 * `allowedMethods`. That trips `needsMigration` — but for the wrong reason, and
 * it hid a real gap: an Order written AFTER #645 (so it has both of those) but
 * BEFORE #659 (so it has no `leakPoints`) was judged not to need migrating, and
 * the backfill that exists to stop `score + undefined` never ran on it.
 *
 * This was found on the live development environment, where the deployed match
 * projected `leakPoints: undefined` on all 45 of its Orders — every one of them
 * a NaN waiting for someone to press LEAK.
 */
describe("an Order from between #645 and #659 still gets its leak rate", () => {
  /** A row with `task` and `allowedMethods` present, but no `leakPoints`. */
  function postTaskPreLeakRateState(): CryptoBattleState {
    const started = tick(initialState({ eventId: "mid-era", teamIds: ["teamA", "teamB"] }), 0);
    const persisted = JSON.parse(JSON.stringify(started)) as CryptoBattleState;
    for (const contract of persisted.contracts) {
      expect(contract.task).toBeDefined();
      expect(contract.allowedMethods).toBeDefined();
      delete (contract as unknown as Record<string, unknown>).leakPoints;
    }
    return persisted;
  }

  test("the projection never shows an undefined leak rate", () => {
    const projected = projectForTeam(postTaskPreLeakRateState(), "teamA");
    expect(projected.myContracts.length).toBeGreaterThan(0);
    for (const contract of projected.myContracts) {
      expect(contract.leakPoints).toBeDefined();
      expect(Number.isFinite(contract.leakPoints)).toBe(true);
    }
  });

  test("LEAKing one pays the leak rate instead of turning the score into NaN", () => {
    const state = postTaskPreLeakRateState();
    const leakable = state.contracts.find(
      (c) => c.teamId === "teamA" && c.status === "open" && c.allowedMethods.includes("leak"),
    );
    if (!leakable) throw new Error("test setup: expected a leakable Order");

    const after = applyOp(state, "teamA", { kind: "leak", contractId: leakable.id });
    const score = after.teams.teamA?.score;
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBe(DEFAULT_CONFIG.scores.contractLeak);
  });
});
