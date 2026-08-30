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
        expect(next.teams.teamA?.score).toBe(order.points);
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
