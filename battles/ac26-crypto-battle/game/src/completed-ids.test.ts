import { expect, test } from "bun:test";
import { compactCompletedContractIds, compactContractId, contractId } from "./ledger-codec.ts";
import {
  applyOp,
  initialState,
  migrateState,
  projectForTeam,
  tick,
  validateOp,
} from "./reducer.ts";
import { buildClearingOp } from "./playtest.ts";

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("completion migration preserves unfamiliar IDs and expands exact numeric IDs at the participant boundary", () => {
  const teamId = "a-c|😀";
  const ids = [
    `${teamId}-c0`,
    `${teamId}-c15`,
    `${teamId}-c01`,
    `${teamId}-c-1`,
    `${teamId}-c1e2`,
    `${teamId}-c9007199254740993`,
    "other-c15",
  ];
  const state = initialState({
    eventId: "complete-migration",
    teamIds: [teamId],
    matchSecret: "synthetic",
  });
  const old = {
    ...state,
    teams: { [teamId]: { ...state.teams[teamId]!, completedContractIds: ids } },
  };
  const before = json(old);
  const migrated = migrateState(json(old), 9);
  expect(migrated.teams[teamId]!.completedContractIds).toEqual([0, 15, ...ids.slice(2)]);
  expect(projectForTeam(json(migrated), teamId).vault.completedContractIds).toEqual(ids);
  expect(old).toEqual(before);
  expect(compactCompletedContractIds(teamId, migrated.teams[teamId]!.completedContractIds)).toBe(
    migrated.teams[teamId]!.completedContractIds,
  );
  for (const id of ids)
    expect(contractId({ tm: teamId, c: compactContractId(teamId, id) })).toBe(id);
  // A current-version row from the earlier PR revision can still carry strings.
  expect(tick(old, 0).teams[teamId]!.completedContractIds).toEqual(
    migrated.teams[teamId]!.completedContractIds,
  );
});

test("real individual completion writers store exact IDs compactly while projection and duplicate rejection stay unchanged", () => {
  const methods = new Set<string>();
  for (const minute of [1, 31, 61])
    for (const leak of [false, true]) {
      let state = tick(
        initialState({
          eventId: "completed-writers",
          teamIds: ["a", "b"],
          matchSecret: "synthetic",
        }),
        0,
      );
      state = tick(applyOp(state, "a", { kind: "start" }), minute * 60_000);
      for (const teamId of ["a", "b"])
        for (const order of projectForTeam(state, teamId).myContracts.filter(
          (c) => c.status === "open" && c.task.kind !== "rps-duel",
        )) {
          const op =
            leak && order.allowedMethods.includes("leak")
              ? { kind: "leak" as const, contractId: order.id }
              : buildClearingOp(
                  order,
                  projectForTeam(state, teamId).vault,
                  projectForTeam(state, teamId).prime,
                );
          if (!op) throw new Error("unhandled test Order");
          expect(validateOp(state, teamId, op)).toEqual({ ok: true });
          state = applyOp(state, teamId, op);
          methods.add(op.kind);
          expect(state.teams[teamId]!.completedContractIds).toContain(
            compactContractId(teamId, order.id),
          );
          expect(projectForTeam(json(state), teamId).vault.completedContractIds).toContain(
            order.id,
          );
          expect(validateOp(state, teamId, op).ok).toBe(false);
        }
    }
  expect(methods).toEqual(new Set(["leak", "cipher", "fhe", "mpc", "prove-sudoku"]));
});
