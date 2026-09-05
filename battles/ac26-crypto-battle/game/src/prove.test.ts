/**
 * Reducer-level integration tests for PROVE (Issue #486 PR2, rebuilt as ZK
 * sudoku in #709): validateOp / applyOp wiring, wrong-grid / unrelabelled /
 * wrong-Order / wrong-generation handling, what a reveal publishes and what
 * it must not, and the Scoring MUST that PROVE pays more than LEAK for an
 * equal-value Order. The sudoku primitives themselves are covered in
 * sudoku.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { deriveSudokuSolution } from "./fixtures.ts";
import { applyOp, DEFAULT_CONFIG, projectForTeam, tick, validateOp } from "./reducer.ts";
import { buildProveSudokuOp, freshPermutation, startedMatch, SUBSTRING_SAFE_FIELD } from "./playtest.ts";
import { ALL_PERMUTATIONS, applyPermutation, CONSTRAINT_GROUPS, IDENTITY_PERMUTATION } from "./sudoku.ts";
import type { CryptoBattleState, CryptoBattleOp } from "./types.ts";

const CTX = { eventId: "prove-basic", teamIds: ["teamA", "teamB"] } as const;

/** The first Order on teamA's belt that PROVE can answer. */
function proveableOrder(state: CryptoBattleState) {
  const contract = state.contracts.find(
    (c) => c.teamId === "teamA" && c.status === "open" && c.allowedMethods.includes("prove"),
  );
  if (!contract) throw new Error("expected a PROVE-able contract for teamA");
  const team = state.teams.teamA;
  if (!team) throw new Error("expected teamA");
  return { contract, team };
}

describe("prove: a relabelled solution", () => {
  test("the vault shows the solution and the puzzle shows eight of its cells", () => {
    const state = tick(startedMatch(CTX), 0);
    const mine = projectForTeam(state, "teamA");
    expect(mine.vault.sudokuSolution).toHaveLength(16);
    expect(mine.vault.usedPermutations).toEqual([]);
    const puzzle = mine.publicPuzzles.teamA;
    if (!puzzle) throw new Error("expected teamA's puzzle to be public");
    expect(puzzle.filter((v) => v !== 0)).toHaveLength(8);
    puzzle.forEach((v, i) => {
      if (v !== 0) expect(mine.vault.sudokuSolution[i]).toBe(v);
    });
    // The other team sees the puzzle and NOT the solution.
    const theirs = projectForTeam(state, "teamB");
    expect(theirs.publicPuzzles.teamA).toEqual(puzzle);
    expect(theirs.vault.sudokuSolution).not.toEqual(mine.vault.sudokuSolution);
  });

  test("a correctly relabelled grid completes the Order, pays the full rate, and opens one group", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const vault = projectForTeam(state, "teamA").vault;
    const pi = [2, 3, 4, 1] as const;
    const op = buildProveSudokuOp(vault, contract.id, pi);
    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });

    const next = applyOp(state, "teamA", op);
    expect(next.contracts.find((c) => c.id === contract.id)?.status).toBe("completed");
    expect(next.contracts.find((c) => c.id === contract.id)?.resolution).toBe("prove");
    expect(next.teams.teamA?.score).toBe(contract.points);
    expect(next.teams.teamA?.lastProve).toEqual({ contractId: contract.id, outcome: "hit" });

    const [reveal] = projectForTeam(next, "teamB").publicLedger;
    if (reveal?.kind !== "sudoku-reveal") throw new Error("expected a sudoku reveal on the ledger");
    expect(reveal.method).toBe("prove");
    expect(reveal.cells).toHaveLength(4);
    // The opened group is a group OF THE SUBMITTED GRID: its four cells are
    // the relabelled digits at that group's positions, and a permutation of
    // 1..4 -- which is why one reveal says nothing about the solution.
    const submitted = op.kind === "prove-sudoku" ? op.grid : [];
    const cells = CONSTRAINT_GROUPS[reveal.group] ?? [];
    expect(reveal.cells).toEqual(cells.map((i) => submitted[i] ?? -1));
    expect([...reveal.cells].sort()).toEqual([1, 2, 3, 4]);
    // And the vault now lists the relabelling as spent.
    expect(projectForTeam(next, "teamA").vault.usedPermutations).toEqual([[...pi]]);
  });

  test("a wrong grid lands, costs wrongProve, publishes nothing, and leaves the Order open", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    // A different, valid sudoku that is not a relabelling of teamA's solution.
    const solution = projectForTeam(state, "teamA").vault.sudokuSolution;
    const orbit = new Set(ALL_PERMUTATIONS.map((pi) => applyPermutation(solution, pi).join("")));
    const other = projectForTeam(state, "teamB").vault.sudokuSolution;
    const wrong = orbit.has(other.join("")) ? undefined : other;
    if (!wrong) throw new Error("test setup: teamB's solution happens to be a relabelling of teamA's");
    const funded = { ...state, teams: { ...state.teams, teamA: { ...(state.teams.teamA as never as object), score: 50 } as never } } as CryptoBattleState;

    const op: CryptoBattleOp = { kind: "prove-sudoku", contractId: contract.id, grid: [...wrong] };
    expect(validateOp(funded, "teamA", op)).toEqual({ ok: true });
    const next = applyOp(funded, "teamA", op);
    expect(next.teams.teamA?.score).toBe(50 - DEFAULT_CONFIG.scores.wrongProve);
    expect(next.teams.teamA?.lastProve).toEqual({ contractId: contract.id, outcome: "miss" });
    expect(next.publicLedger).toHaveLength(0);
    expect(next.contracts.find((c) => c.id === contract.id)?.status).toBe("open");
    // The projection tells the team it was a miss, with the price.
    const projected = projectForTeam(next, "teamA");
    expect(projected.lastProve?.outcome).toBe("miss");
    expect(projected.wrongProveCost).toBe(DEFAULT_CONFIG.scores.wrongProve);
  });

  test("the solution itself, unrelabelled, is refused before it can cost anything", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const vault = projectForTeam(state, "teamA").vault;
    const op = buildProveSudokuOp(vault, contract.id, IDENTITY_PERMUTATION);
    const verdict = validateOp(state, "teamA", op);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toMatch(/relabel/);
  });

  test("a malformed grid is refused by shape, not charged", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    for (const grid of [[], new Array(16).fill(0), new Array(15).fill(1), [...new Array(15).fill(1), 9]]) {
      const verdict = validateOp(state, "teamA", { kind: "prove-sudoku", contractId: contract.id, grid });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.error).toContain("16 cells");
    }
  });

  test("the same relabelling submitted twice is accepted twice -- reuse is a mistake the judge lets you make", () => {
    // The judge does not refuse reuse; the HUNT punishes it. Refusing it here
    // would delete the lesson (see pi-reuse.test.ts).
    let state = tick(startedMatch(CTX), 0);
    const pi = [3, 4, 1, 2] as const;
    let proved = 0;
    for (let round = 0; round < 8 && proved < 2; round += 1) {
      const order = state.contracts.find(
        (c) => c.teamId === "teamA" && c.status === "open" && c.allowedMethods.includes("prove"),
      );
      if (order) {
        const op = buildProveSudokuOp(projectForTeam(state, "teamA").vault, order.id, pi);
        expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
        state = applyOp(state, "teamA", op);
        proved += 1;
      } else {
        state = tick(state, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
      }
    }
    expect(proved).toBe(2);
    const tags = projectForTeam(state, "teamB").publicLedger
      .filter((a) => a.kind === "sudoku-reveal")
      .map((a) => (a.kind === "sudoku-reveal" ? a.tag : ""));
    expect(tags).toHaveLength(2);
    expect(tags[0]).toBe(tags[1]);
    expect(projectForTeam(state, "teamA").vault.usedPermutations).toEqual([[...pi]]);
  });

  test("freshPermutation never returns the identity or a spent relabelling", () => {
    let state = tick(startedMatch(CTX), 0);
    const used: string[] = [];
    for (let round = 0; round < 12; round += 1) {
      for (const order of state.contracts.filter(
        (c) => c.teamId === "teamA" && c.status === "open" && c.allowedMethods.includes("prove"),
      )) {
        const vault = projectForTeam(state, "teamA").vault;
        const pi = freshPermutation(vault);
        if (!pi) break;
        expect(pi.join("")).not.toBe("1234");
        expect(used).not.toContain(pi.join(""));
        used.push(pi.join(""));
        state = applyOp(state, "teamA", buildProveSudokuOp(vault, order.id, pi));
      }
      state = tick(state, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
    }
    expect(used.length).toBeGreaterThan(3);
  });
});

describe("prove: the Order gate", () => {
  test("another team's Order is refused", () => {
    const state = tick(startedMatch(CTX), 0);
    const theirs = state.contracts.find(
      (c) => c.teamId === "teamB" && c.status === "open" && c.allowedMethods.includes("prove"),
    );
    if (!theirs) throw new Error("expected a PROVE-able Order for teamB");
    const verdict = validateOp(state, "teamA", buildProveSudokuOp(projectForTeam(state, "teamA").vault, theirs.id));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("belongs to another team");
  });

  test("an Order PROVE cannot serve is refused as incapability, not as a bad grid", () => {
    let state = tick(startedMatch(CTX), 0);
    let fhe = state.contracts.find((c) => c.teamId === "teamA" && c.status === "open" && c.task.kind === "homomorphic-sum");
    for (let round = 0; round < 5 && !fhe; round += 1) {
      state = tick(state, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
      fhe = state.contracts.find((c) => c.teamId === "teamA" && c.status === "open" && c.task.kind === "homomorphic-sum");
    }
    if (!fhe) throw new Error("expected an FHE Order");
    const verdict = validateOp(state, "teamA", buildProveSudokuOp(projectForTeam(state, "teamA").vault, fhe.id));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("cannot perform");
  });

  test("a proof built for the old generation fails after ROTATE", () => {
    let state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const oldVault = projectForTeam(state, "teamA").vault;
    const stale = buildProveSudokuOp(oldVault, contract.id, [2, 1, 4, 3]);
    state = tick(state, DEFAULT_CONFIG.rotateCooldownMs);
    state = applyOp(state, "teamA", { kind: "rotate" });
    // The Order was voided by the rotate; take a fresh one and submit the
    // OLD grid against it.
    state = tick(state, state.nextContractAtMs ?? DEFAULT_CONFIG.contractIntervalMs);
    const fresh = proveableOrder(state).contract;
    const op: CryptoBattleOp = { ...stale, contractId: fresh.id } as CryptoBattleOp;
    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
    const next = applyOp(state, "teamA", op);
    expect(next.teams.teamA?.lastProve?.outcome).toBe("miss");
    // The new generation's solution really is different.
    expect(projectForTeam(state, "teamA").vault.sudokuSolution).not.toEqual(oldVault.sudokuSolution);
    expect(deriveSudokuSolution(state.seed, "teamA", 2)).toEqual(projectForTeam(state, "teamA").vault.sudokuSolution);
  });
});

describe("prove: what stays hidden", () => {
  test("no team's solution reaches another team's projection, and a reveal carries the relabelled digits only", () => {
    // Big field so the share-material substring checks stay meaningful; the
    // sudoku checks are structural and hold at any modulus.
    let state = tick(startedMatch({ ...CTX, matchSecret: "prove-hidden-secret" }, SUBSTRING_SAFE_FIELD), 0);
    const { contract } = proveableOrder(state);
    const vault = projectForTeam(state, "teamA").vault;
    const pi = [4, 3, 2, 1] as const;
    state = applyOp(state, "teamA", buildProveSudokuOp(vault, contract.id, pi));

    const theirs = projectForTeam(state, "teamB");
    expect(theirs.vault.teamId).toBe("teamB");
    expect(theirs.vault.sudokuSolution).not.toEqual(vault.sudokuSolution);
    const reveal = theirs.publicLedger.find((a) => a.kind === "sudoku-reveal");
    if (reveal?.kind !== "sudoku-reveal") throw new Error("expected a reveal");
    const cells = CONSTRAINT_GROUPS[reveal.group] ?? [];
    // Each published digit is π applied to the solution's digit -- never the
    // solution's digit itself, unless π happens to fix it, which [4,3,2,1]
    // never does.
    cells.forEach((cell, at) => {
      expect(reveal.cells[at]).toBe(pi[(vault.sudokuSolution[cell] ?? 1) - 1]);
      expect(reveal.cells[at]).not.toBe(vault.sudokuSolution[cell]);
    });
    // The serialized projection of the other team holds no 16-digit run equal
    // to teamA's solution.
    expect(JSON.stringify(theirs)).not.toContain(JSON.stringify(vault.sudokuSolution));
    // The match seed never leaves the trusted side.
    expect(JSON.stringify(theirs)).not.toContain(state.seed);
  });
});

describe("prove: the scoring MUST", () => {
  test("PROVE pays the Order's full rate, which is above what LEAK pays for the same Order", () => {
    const state = tick(startedMatch(CTX), 0);
    const order = state.contracts.find(
      (c) => c.teamId === "teamA" && c.status === "open" && c.task.kind === "reveal-share",
    );
    if (!order) throw new Error("expected a share Order");
    expect(order.allowedMethods).toEqual(["leak", "prove"]);
    const proved = applyOp(state, "teamA", buildProveSudokuOp(projectForTeam(state, "teamA").vault, order.id));
    const leaked = applyOp(state, "teamA", { kind: "leak", contractId: order.id });
    expect(proved.teams.teamA?.score).toBe(order.points);
    expect(leaked.teams.teamA?.score).toBe(order.leakPoints);
    expect(order.points).toBeGreaterThan(order.leakPoints);
  });
});
