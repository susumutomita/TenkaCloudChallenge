import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyCells, parseCells, SudokuInput, sudokuFillInGivens } from "../../portal/SudokuGrid.tsx";
import { ALL_SOLUTIONS, ALL_PERMUTATIONS, applyPermutation } from "./sudoku.ts";
import { startedMatch } from "./playtest.ts";
import { applyOp, projectForTeam, validateOp } from "./reducer.ts";

describe("four-cell sudoku PROVE", () => {
  test("every solution and table leaves each substitution to practise once", () => {
    for (const solution of ALL_SOLUTIONS) {
      for (const table of ALL_PERMUTATIONS) {
        const givens = sudokuFillInGivens(solution, table);
        const holes = givens.flatMap((cell, index) => cell === "" ? [index] : []);
        expect(holes).toHaveLength(4);
        expect(holes.map((index) => solution[index]).sort()).toEqual([1, 2, 3, 4]);
        expect(new Set(holes.map((index) => Math.floor(index / 4))).size).toBe(4);
        expect(parseCells(givens)).toBeUndefined();
        const filled = givens.map((cell, index) => cell || String(table[solution[index]! - 1]));
        expect(parseCells(filled)).toEqual(applyPermutation(solution, table));
      }
    }
  });

  test("shows twelve worked values and exactly four empty inputs", () => {
    const givens = sudokuFillInGivens(ALL_SOLUTIONS[0]!, [3, 1, 4, 2]);
    const html = renderToStaticMarkup(createElement(SudokuInput, {
      value: emptyCells(), givens, onChange: () => {}, ariaLabel: "exercise",
    }));
    expect(html.match(/<input /g)).toHaveLength(4);
    expect(html.match(/value=""/g)).toHaveLength(4);
    expect(html.match(/aria-label="exercise-\d+: [1-4]"/g)).toHaveLength(12);
  });

  test("the judge still scores the completed grid and charges a wrong hole", () => {
    const state = startedMatch({ eventId: "fill-in", teamIds: ["alpha", "bravo"] });
    const view = projectForTeam(state, "alpha");
    const order = view.myContracts.find((c) => c.status === "open" && c.allowedMethods.includes("prove"));
    if (!order) throw new Error("expected a PROVE Order");
    const table = [3, 1, 4, 2];
    const givens = sudokuFillInGivens(view.vault.sudokuSolution, table);
    const grid = givens.map((cell, index) => Number(cell || table[view.vault.sudokuSolution[index]! - 1]));
    const op = { kind: "prove-sudoku" as const, contractId: order.id, grid };
    expect(validateOp(state, "alpha", op)).toEqual({ ok: true });
    const hit = applyOp(state, "alpha", op);
    expect(hit.teams.alpha?.score).toBe(order.points);
    expect(projectForTeam(hit, "alpha").vault.usedPermutations).toContainEqual(table);
    const hole = givens.indexOf("");
    const wrongGrid = grid.map((cell, index) => index === hole ? cell % 4 + 1 : cell);
    const scoredState = { ...state, teams: { ...state.teams, alpha: { ...state.teams.alpha!, score: 40 } } };
    const miss = applyOp(scoredState, "alpha", { ...op, grid: wrongGrid });
    expect(miss.teams.alpha?.score).toBe(40 - state.config.scores.wrongProve);
    expect(projectForTeam(miss, "alpha").lastProve?.outcome).toBe("miss");
    expect(miss.contracts.find((c) => c.id === order.id)?.status).toBe("open");
    expect(miss.publicLedger).toEqual(state.publicLedger);
  });
});
