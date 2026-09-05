/**
 * [Issue #709] Can a HUMAN actually perform the sudoku HUNT?
 *
 * §12c says a playability claim must come from what a participant can see, and
 * that play which reads repository internals "proves nothing about human
 * playability and must not be cited as if it did". `pi-reuse.test.ts` calls
 * `buildSudokuHuntOp` — shipped code, fed a projection. It proves the HUNT is
 * *implementable*. It cannot prove it is *playable*: the nonce-reuse HUNT this
 * replaces passed its own implementability test while two of its inputs
 * reached no participant surface at all.
 *
 * So this file imports NO hunt helper and NO sudoku helper. It:
 *
 *  1. renders the participant's own Status panel to HTML;
 *  2. scrapes the target's opened groups (group, digits, tag) and its public
 *     puzzle out of that HTML, and nothing else;
 *  3. does the reasoning the statement describes -- same tag means same
 *     relabelled grid; line its cells up against the puzzle; recover the
 *     table; undo it; fill the rest by the sudoku rule -- in plain code that
 *     mirrors what a person does on paper;
 *  4. submits it and expects the judge to accept.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusPanelBody } from "../../portal/StatusPanel.tsx";
import { buildProveSudokuOp, startedMatch } from "./playtest.ts";
import { applyOp, DEFAULT_CONFIG, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleState } from "./types.ts";

const CTX = { eventId: "hunt-playability", teamIds: ["victim", "attacker"] } as const;
const VICTIM = "victim";
const ATTACKER = "attacker";
const CARELESS_TABLE = [4, 3, 2, 1] as const;

/** The victim PROVEs three Orders with ONE relabelling -- the mistake. */
function stateAfterCarelessProofs(): CryptoBattleState {
  let state = tick(startedMatch(CTX), 0);
  let proved = 0;
  for (let round = 0; round < 20 && proved < 3; round += 1) {
    for (const order of state.contracts.filter(
      (c) => c.teamId === VICTIM && c.status === "open" && c.allowedMethods.includes("prove"),
    )) {
      if (proved >= 3) break;
      const op = buildProveSudokuOp(projectForTeam(state, VICTIM).vault, order.id, CARELESS_TABLE);
      expect(validateOp(state, VICTIM, op)).toEqual({ ok: true });
      state = applyOp(state, VICTIM, op);
      proved += 1;
    }
    if (proved < 3) state = tick(state, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
  }
  expect(proved).toBe(3);
  return state;
}

/* ------------------------------------------------------------------ *
 * Reading the screen -- the only channel this test is allowed to use.
 * ------------------------------------------------------------------ */

interface ScreenReveal {
  readonly teamId: string;
  readonly generation: string;
  readonly groupLabel: string;
  readonly cells: readonly number[];
  readonly tag: string;
}

function renderParticipantScreen(state: CryptoBattleState): string {
  return renderToStaticMarkup(
    createElement(StatusPanelBody, {
      projection: projectForTeam(state, ATTACKER),
      locale: "en" as const,
      elapsedSincePollMs: 0,
    }),
  );
}

/** Ledger rows, straight off the rendered table: team | gen | kind | order | detail | when. */
function revealsOnScreen(html: string): ScreenReveal[] {
  const rows: ScreenReveal[] = [];
  for (const [, body] of html.matchAll(/<tr>((?:<td[^>]*>.*?<\/td>)+)<\/tr>/g)) {
    const cells = [...(body ?? "").matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(([, cell]) =>
      (cell ?? "").replace(/<[^>]+>/g, "").trim(),
    );
    if (cells.length < 5) continue;
    const [teamId, generation, kind, , detail] = cells;
    if (!kind?.includes("sudoku") || !teamId || !generation || !detail) continue;
    // "row 2: 4 2 3 1 · relabelling a1b2c3d4e5f6"
    const match = detail.match(/^(\w+ \d): ([1-4]) ([1-4]) ([1-4]) ([1-4]) · relabelling ([0-9a-f]+)$/);
    if (!match) continue;
    rows.push({
      teamId,
      generation,
      groupLabel: match[1] ?? "",
      cells: [match[2], match[3], match[4], match[5]].map(Number),
      tag: match[6] ?? "",
    });
  }
  return rows;
}

/** The puzzle, straight off the rendered public-puzzles list: four rows, dots hidden. */
function puzzleOnScreen(html: string, teamId: string): number[] | undefined {
  const list = html.split("Public puzzles").at(1) ?? "";
  for (const [, rawTeam, rawGrid] of list.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    const name = (rawTeam ?? "").replace(/<[^>]+>/g, "").trim();
    if (name !== teamId && !name.startsWith(teamId)) continue;
    const text = (rawGrid ?? "").replace(/<[^>]+>/g, "").trim();
    return text.split(/\s+/).map((t) => (t === "." ? 0 : Number(t)));
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * The reasoning, as a person does it -- written out, not imported.
 * ------------------------------------------------------------------ */

/** "row 2" -> the four cell indices, exactly as the statement numbers them. */
function cellsOfGroup(label: string): number[] {
  const [kind, n] = label.split(" ");
  const i = Number(n) - 1;
  if (kind === "row") return [0, 1, 2, 3].map((c) => i * 4 + c);
  if (kind === "column") return [0, 1, 2, 3].map((r) => r * 4 + i);
  const br = i < 2 ? 0 : 2;
  const bc = i % 2 === 0 ? 0 : 2;
  return [br * 4 + bc, br * 4 + bc + 1, (br + 1) * 4 + bc, (br + 1) * 4 + bc + 1];
}

/** Every 4x4 grid that extends `known` (0 = unknown) under the sudoku rule. */
function completions(known: readonly number[]): number[][] {
  const groups = [
    ...[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => r * 4 + c)),
    ...[0, 1, 2, 3].map((c) => [0, 1, 2, 3].map((r) => r * 4 + c)),
    ...[0, 2].flatMap((br) => [0, 2].map((bc) => [br * 4 + bc, br * 4 + bc + 1, (br + 1) * 4 + bc, (br + 1) * 4 + bc + 1])),
  ];
  const out: number[][] = [];
  const grid = [...known];
  const ok = (cell: number, v: number) =>
    groups.every((g) => !g.includes(cell) || g.every((other) => other === cell || grid[other] !== v));
  const fill = (cell: number) => {
    if (cell === 16) {
      out.push([...grid]);
      return;
    }
    if (grid[cell] !== 0) {
      fill(cell + 1);
      return;
    }
    for (const v of [1, 2, 3, 4]) {
      if (!ok(cell, v)) continue;
      grid[cell] = v;
      fill(cell + 1);
      grid[cell] = 0;
    }
  };
  fill(0);
  return out;
}

describe("the sudoku HUNT is computable from the screen alone", () => {
  test("the opened groups, their tags and the target's puzzle are all on the screen", () => {
    const html = renderParticipantScreen(stateAfterCarelessProofs());
    const reveals = revealsOnScreen(html).filter((r) => r.teamId.startsWith(VICTIM));
    expect(reveals).toHaveLength(3);
    // The reuse is visible as the statement describes it: same team, same
    // generation, same tag.
    expect(new Set(reveals.map((r) => r.tag)).size).toBe(1);
    expect(new Set(reveals.map((r) => r.generation))).toEqual(new Set(["1"]));
    const puzzle = puzzleOnScreen(html, VICTIM);
    expect(puzzle).toBeDefined();
    expect(puzzle?.filter((v) => v !== 0)).toHaveLength(8);
  });

  test("a reader with only the screen recovers the solution, and the judge accepts it", () => {
    const state = stateAfterCarelessProofs();
    const html = renderParticipantScreen(state);
    const reveals = revealsOnScreen(html).filter((r) => r.teamId.startsWith(VICTIM));
    const puzzle = puzzleOnScreen(html, VICTIM);
    if (!puzzle) throw new Error("expected the victim's puzzle on screen");

    // 1. Same tag -> same relabelled grid. Pool the opened cells.
    const tag = reveals[0]?.tag;
    const relabelled = new Array<number>(16).fill(0);
    for (const reveal of reveals.filter((r) => r.tag === tag)) {
      cellsOfGroup(reveal.groupLabel).forEach((cell, at) => {
        relabelled[cell] = reveal.cells[at] ?? 0;
      });
    }
    // 2. Where the puzzle shows a digit at an opened cell, that is one row of
    //    the table: original digit -> relabelled digit.
    const table = new Array<number>(4).fill(0);
    puzzle.forEach((given, i) => {
      if (given !== 0 && relabelled[i] !== 0) table[given - 1] = relabelled[i] ?? 0;
    });
    // A missing fourth row of the table is forced by the other three.
    if (table.filter((v) => v !== 0).length === 3) {
      const missingFrom = table.indexOf(0);
      const missingTo = [1, 2, 3, 4].find((v) => !table.includes(v)) ?? 0;
      table[missingFrom] = missingTo;
    }
    expect(table.filter((v) => v !== 0)).toHaveLength(4);
    // 3. Undo the table on every opened cell, add the puzzle's givens, and
    //    finish the grid by the sudoku rule.
    const inverse = new Map(table.map((to, from) => [to, from + 1]));
    const known = puzzle.map((given, i) => (given !== 0 ? given : inverse.get(relabelled[i] ?? 0) ?? 0));
    const candidates = completions(known);
    expect(candidates).toHaveLength(1);
    const [solution] = candidates;
    if (!solution) throw new Error("unreachable");

    // 4. Submit. The judge holds the victim's real solution and agrees.
    const op = { kind: "hunt-sudoku" as const, targetTeamId: VICTIM, generation: 1, solution };
    expect(validateOp(state, ATTACKER, op)).toEqual({ ok: true });
    const before = state.teams[ATTACKER]?.score ?? 0;
    const after = applyOp(state, ATTACKER, op);
    expect(after.teams[ATTACKER]?.score).toBe(before + state.config.scores.huntBonus);
    expect(after.teams[VICTIM]?.sudokuHuntedGenerations).toEqual([1]);
    // Never read until now, and only to confirm the screen was enough.
    expect(solution).toEqual([...projectForTeam(state, VICTIM).vault.sudokuSolution]);
  });
});
