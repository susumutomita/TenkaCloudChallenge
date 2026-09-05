/**
 * [Issue #709] The relabelling-reuse HUNT -- the successor of the nonce-reuse
 * HUNT, with the same rule from #645 behind it:
 *
 * > 正しく使った ZK / FHE / MPC を「頑張って破れ」というゲームにはしない。
 * > 誤用・漏洩・手抜きを暗号知識で見抜くことを HUNT にする。
 *
 * So there are two halves to test. A team that picks a fresh relabelling every
 * time (what `freshPermutation` does, and what the vault's used-list is for)
 * is not huntable this way — not "hard to hunt", not huntable, because the
 * evidence the judge requires does not exist on the ledger. A team that
 * reuses one is, and the attacker's whole derivation runs off public material:
 * the reveals, their tags, and the target's public puzzle.
 */

import { describe, expect, test } from "bun:test";
import { buildProveSudokuOp, buildSudokuHuntOp, startedMatch } from "./playtest.ts";
import { applyOp, DEFAULT_CONFIG, projectForTeam, tick, validateOp } from "./reducer.ts";
import { solutionsConsistentWith } from "./sudoku.ts";
import type { Contract, CryptoBattleState } from "./types.ts";

const CTX = { eventId: "pi-reuse-tests", teamIds: ["victim", "attacker"] } as const;
const VICTIM = "victim";
const ATTACKER = "attacker";

/** Advance until the victim has `count` open Orders it may PROVE, all open at once. */
function proveableOrders(state: CryptoBattleState, teamId: string, count: number): {
  state: CryptoBattleState;
  orders: readonly Contract[];
} {
  let current = state;
  for (let round = 0; round < 20; round += 1) {
    const open = current.contracts.filter(
      (c) => c.teamId === teamId && c.status === "open" && c.allowedMethods.includes("prove"),
    );
    if (open.length >= count) return { state: current, orders: open.slice(0, count) };
    current = tick(current, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
  }
  throw new Error(`could not find ${count} open PROVE-able orders for ${teamId}`);
}

/** Play the victim into a state where it has proved `times` Orders under ONE relabelling. */
function stateAfterReuse(
  times: number,
  pi: readonly number[] = [2, 3, 4, 1],
  ctx: { readonly eventId: string; readonly teamIds: readonly string[] } = CTX,
): CryptoBattleState {
  let state = tick(startedMatch(ctx), 0);
  let proved = 0;
  for (let round = 0; round < 20 && proved < times; round += 1) {
    for (const order of state.contracts.filter(
      (c) => c.teamId === VICTIM && c.status === "open" && c.allowedMethods.includes("prove"),
    )) {
      if (proved >= times) break;
      const op = buildProveSudokuOp(projectForTeam(state, VICTIM).vault, order.id, pi);
      expect(validateOp(state, VICTIM, op)).toEqual({ ok: true });
      state = applyOp(state, VICTIM, op);
      proved += 1;
    }
    if (proved < times) state = tick(state, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
  }
  expect(proved).toBe(times);
  return state;
}

describe("reuse is a real, and really exploitable, mistake", () => {
  test("the reveals carry equal tags, which the ledger shows everyone", () => {
    const state = stateAfterReuse(2);
    const reveals = projectForTeam(state, ATTACKER).publicLedger.filter(
      (a) => a.kind === "sudoku-reveal" && a.teamId === VICTIM,
    );
    expect(reveals).toHaveLength(2);
    const tags = new Set(reveals.map((a) => (a.kind === "sudoku-reveal" ? a.tag : "")));
    expect(tags.size).toBe(1);
  });

  test("the attacker recovers the solution from public material and the judge accepts it", () => {
    // Three reveals under one relabelling cover enough of π(S) to pin S
    // against the public puzzle for every seed this fixture reaches; the
    // builder returns undefined rather than guess if it ever did not.
    const state = stateAfterReuse(3);
    const before = projectForTeam(state, ATTACKER);
    const op = buildSudokuHuntOp(before, VICTIM);
    expect(op).toBeDefined();
    if (op?.kind !== "hunt-sudoku") throw new Error("expected a sudoku hunt op");
    expect(validateOp(state, ATTACKER, op)).toEqual({ ok: true });

    const next = applyOp(state, ATTACKER, op);
    expect(next.teams[ATTACKER]?.score).toBe(
      (state.teams[ATTACKER]?.score ?? 0) + DEFAULT_CONFIG.scores.huntBonus,
    );
    expect(next.teams[VICTIM]?.score).toBe(
      Math.max(0, (state.teams[VICTIM]?.score ?? 0) - DEFAULT_CONFIG.scores.huntPenalty),
    );
    expect(next.teams[VICTIM]?.sudokuHuntedGenerations).toEqual([1]);
    expect(next.teams[VICTIM]?.huntedGenerations).toEqual([]);
    expect(next.huntLog.at(-1)).toMatchObject({ attackerTeamId: ATTACKER, targetTeamId: VICTIM, via: "sudoku" });
    // The recovered grid IS the victim's solution -- asserted against the
    // victim's own vault, which the attacker never saw.
    expect(op.solution).toEqual([...projectForTeam(state, VICTIM).vault.sudokuSolution]);
    // The projection reports the hit, on the sudoku channel.
    expect(projectForTeam(next, ATTACKER).lastHunt).toEqual({ targetTeamId: VICTIM, generation: 1, outcome: "hit", via: "sudoku" });
  });

  test("the same recovery cannot be spent twice", () => {
    const state = stateAfterReuse(3);
    const op = buildSudokuHuntOp(projectForTeam(state, ATTACKER), VICTIM);
    if (op?.kind !== "hunt-sudoku") throw new Error("expected a sudoku hunt op");
    const once = applyOp(state, ATTACKER, op);
    const again = validateOp(once, ATTACKER, op);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already recovered");
  });

  test("a wrong solution lands, costs wrongHunt, and spends one of a separate budget", () => {
    const state = stateAfterReuse(2);
    const funded: CryptoBattleState = {
      ...state,
      teams: { ...state.teams, [ATTACKER]: { ...(state.teams[ATTACKER] as NonNullable<typeof state.teams.x>), score: 40 } },
    };
    const wrong = { kind: "hunt-sudoku" as const, targetTeamId: VICTIM, generation: 1, solution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] };
    const isRight = projectForTeam(state, VICTIM).vault.sudokuSolution.every((v, i) => v === wrong.solution[i]);
    if (isRight) throw new Error("test setup: the placeholder grid happens to be the solution");
    expect(validateOp(funded, ATTACKER, wrong)).toEqual({ ok: true });
    const next = applyOp(funded, ATTACKER, wrong);
    expect(next.teams[ATTACKER]?.score).toBe(40 - DEFAULT_CONFIG.scores.wrongHunt);
    const view = projectForTeam(next, ATTACKER);
    expect(view.lastHunt).toEqual({ targetTeamId: VICTIM, generation: 1, outcome: "miss", via: "sudoku" });
    expect(view.sudokuHuntAttempts[VICTIM]?.spent).toBe(1);
    // The Shamir budget is untouched.
    expect(view.huntAttempts[VICTIM]?.spent).toBe(0);
  });

  test("the budget runs out", () => {
    let state = stateAfterReuse(2);
    const wrong = { kind: "hunt-sudoku" as const, targetTeamId: VICTIM, generation: 1, solution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] };
    for (let i = 0; i < DEFAULT_CONFIG.maxHuntAttemptsPerTarget; i += 1) {
      expect(validateOp(state, ATTACKER, wrong)).toEqual({ ok: true });
      state = applyOp(state, ATTACKER, wrong);
    }
    const spent = validateOp(state, ATTACKER, wrong);
    expect(spent.ok).toBe(false);
    if (!spent.ok) expect(spent.error).toContain("no sudoku HUNT attempts left");
  });
});

describe("a reuse that gave nothing away is not huntable either", () => {
  /**
   * The judge opens a group the generation has not had opened yet, so real
   * play never produces two reveals of one group under one tag. This builds
   * the case by hand -- the second reveal is a copy of the first under a new
   * Order id -- to pin that the gate asks for EVIDENCE, not only for a
   * repeated tag: two copies of one row pin no solution, and a HUNT on them
   * would be a guess against a limited budget.
   */
  test("two reveals of the SAME group under one tag do not open the HUNT", () => {
    // A seed whose victim puzzle allows more than one solution -- otherwise
    // the eight givens alone would pin it and no reveal could add or withhold
    // anything. Found by search; pinned here so the case is the one described.
    const ambiguous = { eventId: "pi-reuse-ambiguous-10", teamIds: ["victim", "attacker"] } as const;
    const state = stateAfterReuse(1, [2, 3, 4, 1], ambiguous);
    expect(solutionsConsistentWith(projectForTeam(state, ATTACKER).publicPuzzles[VICTIM] ?? []).length).toBeGreaterThan(1);
    const first = state.publicLedger.find((a) => a.k === "sudoku-reveal" && a.tm === VICTIM);
    if (first?.k !== "sudoku-reveal") throw new Error("expected one reveal on the ledger");
    const duplicated: CryptoBattleState = {
      ...state,
      publicLedger: [...state.publicLedger, { ...first, c: `${first.c}-again` }],
    };
    const view = projectForTeam(duplicated, ATTACKER);
    const tags = view.publicLedger
      .filter((a) => a.kind === "sudoku-reveal" && a.teamId === VICTIM)
      .map((a) => (a.kind === "sudoku-reveal" ? a.tag : ""));
    expect(tags).toHaveLength(2);
    expect(new Set(tags).size).toBe(1);
    expect(buildSudokuHuntOp(view, VICTIM)).toBeUndefined();

    const honest = {
      kind: "hunt-sudoku" as const,
      targetTeamId: VICTIM,
      generation: 1,
      solution: [...projectForTeam(duplicated, VICTIM).vault.sudokuSolution],
    };
    const verdict = validateOp(duplicated, ATTACKER, honest);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("do not yet pin one solution");
  });

  test("real play opens a different group each time, so a reuse is always informative", () => {
    const state = stateAfterReuse(3);
    const groups = projectForTeam(state, ATTACKER)
      .publicLedger.filter((a) => a.kind === "sudoku-reveal" && a.teamId === VICTIM)
      .map((a) => (a.kind === "sudoku-reveal" ? a.group : -1));
    expect(groups).toHaveLength(3);
    expect(new Set(groups).size).toBe(3);
  });
});

describe("correct use is not huntable", () => {
  test("a team that never reuses a relabelling has nothing to hunt", () => {
    // Built with the shipped builder, which reads the vault's used list.
    let state = tick(startedMatch(CTX), 0);
    let proved = 0;
    for (let round = 0; round < 12 && proved < 4; round += 1) {
      for (const order of state.contracts.filter(
        (c) => c.teamId === VICTIM && c.status === "open" && c.allowedMethods.includes("prove"),
      )) {
        if (proved >= 4) break;
        state = applyOp(state, VICTIM, buildProveSudokuOp(projectForTeam(state, VICTIM).vault, order.id));
        proved += 1;
      }
      if (proved < 4) state = tick(state, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
    }
    expect(proved).toBe(4);
    const view = projectForTeam(state, ATTACKER);
    const tags = view.publicLedger
      .filter((a) => a.kind === "sudoku-reveal" && a.teamId === VICTIM)
      .map((a) => (a.kind === "sudoku-reveal" ? a.tag : ""));
    expect(new Set(tags).size).toBe(tags.length);
    expect(buildSudokuHuntOp(view, VICTIM)).toBeUndefined();

    // Even the RIGHT solution is refused: the misuse is not on the record.
    const honest = {
      kind: "hunt-sudoku" as const,
      targetTeamId: VICTIM,
      generation: 1,
      solution: [...projectForTeam(state, VICTIM).vault.sudokuSolution],
    };
    const verdict = validateOp(state, ATTACKER, honest);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("has not reused");
  });

  test("a ROTATE retires the reused reveals: the old generation cannot be hunted, and the new one is clean", () => {
    let state = stateAfterReuse(3);
    state = tick(state, Math.max(state.nowMs ?? 0, DEFAULT_CONFIG.rotateCooldownMs));
    state = applyOp(state, VICTIM, { kind: "rotate" });
    expect(state.teams[VICTIM]?.generation).toBe(2);
    const view = projectForTeam(state, ATTACKER);
    // The old generation's reveals are still on the ledger, but the target is
    // on generation 2 now: the builder targets the current generation and
    // finds no reveals there.
    expect(buildSudokuHuntOp(view, VICTIM)).toBeUndefined();
    const stale = {
      kind: "hunt-sudoku" as const,
      targetTeamId: VICTIM,
      generation: 1,
      solution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
    };
    const verdict = validateOp(state, ATTACKER, stale);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("generation 2");
    // And the puzzle everyone sees moved with it.
    expect(view.publicPuzzles[VICTIM]).not.toEqual(projectForTeam(stateAfterReuse(1), ATTACKER).publicPuzzles[VICTIM]);
    expect(projectForTeam(state, VICTIM).vault.usedPermutations).toEqual([]);
  });

  test("a team cannot hunt itself", () => {
    const state = stateAfterReuse(2);
    const verdict = validateOp(state, VICTIM, {
      kind: "hunt-sudoku",
      targetTeamId: VICTIM,
      generation: 1,
      solution: [...projectForTeam(state, VICTIM).vault.sudokuSolution],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("own team");
  });
});
