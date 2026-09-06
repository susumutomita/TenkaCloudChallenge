import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HuntPanel, { HuntWorkspace, huntOptions } from "../../portal/HuntPanel.tsx";
import { FeedbackBanner, huntFeedback } from "../../portal/FastMovePanel.tsx";
import RpsDuel from "../../portal/RpsDuel.tsx";
import { buildScenario } from "../../dev/scenarios.ts";
import { applyOp, projectForTeam, validateOp } from "./reducer.ts";
import { buildHuntOp, buildSudokuHuntOp } from "./playtest.ts";
import type { CryptoBattleOp, CryptoBattleProjection, CryptoBattleState } from "./types.ts";

const props = (projection: CryptoBattleProjection) => ({ projection, locale: "ja" as const, submitting: false, onSubmit: async (_: CryptoBattleOp) => {} });
const render = (p: CryptoBattleProjection) => renderToStaticMarkup(createElement(HuntPanel, props(p)));
function view(s: CryptoBattleState) { return projectForTeam(s, "bravo"); }
function run(s: CryptoBattleState, team: string, op: CryptoBattleOp) {
  expect(validateOp(s, team, op)).toEqual({ ok: true });
  return applyOp(s, team, op);
}
function workspace(p: CryptoBattleProjection, mode: string) {
  const target = huntOptions(p).find(o => o.mode === mode)!;
  return renderToStaticMarkup(createElement(HuntWorkspace, { ...props(p), target }));
}

describe("HUNT public evidence → target status → worksheet → verdict", () => {
  test("zero and insufficient evidence show what to wait for, without unusable forms", () => {
    for (const scenario of ["fresh", "ledger-filling"] as const) {
      const p = view(buildScenario(scenario).host.state), html = render(p);
      expect(html).toContain("材料待ち");
      expect(html).toContain("同じ番号の重複は1個");
      expect(html).toContain("必要な総数は固定ではありません");
      expect(html).not.toContain("fast-hunt-secret");
      expect(html).not.toContain("相手の数独の解");
      expect(workspace(p, "share")).toBe("");
      expect(workspace(p, "sudoku")).toBe("");
    }
  });
  test("threshold counts distinct current-generation indices only", () => {
    const p = view(buildScenario("hunt-reachable").host.state);
    const option = huntOptions(p).find(o => o.mode === "share")!;
    expect(option.status).toBe("ready");
    expect(render(p)).toContain("秘密のかけらの材料・計算へ");
    const { completedHunts: _newField, ...legacy } = p;
    expect(render(legacy)).toContain("攻撃済み状態を更新中");
    expect(render(legacy)).not.toContain("秘密のかけらの材料・計算へ");
    expect(workspace(legacy, "share")).toBe("");
    const html = workspace(p, "share");
    expect(html).toContain("fast-hunt-secret");
    expect(html).toContain("+25 点");
    expect(html).toContain("不正解 −8 点");
    expect(html).toContain("残り 3 回");
    expect(html).toContain("小さな例");
    const share = p.publicLedger.find(a => a.kind === "share" && a.teamId === "alpha")!;
    const duplicate = { ...p, publicLedger: [share, share, share] };
    expect(huntOptions(duplicate).find(o => o.mode === "share")?.status).toBe("waiting");
    const retired = view(buildScenario("after-rotate").host.state);
    expect(huntOptions(retired).find(o => o.mode === "share")?.status).toBe("waiting");
    expect(render(retired)).toContain("旧世代 1 の材料は使いません");
  });
  test("a real miss consumes one attempt and a real hit closes only that reader's attack", () => {
    let state = buildScenario("hunt-reachable").host.state;
    const op = buildHuntOp(view(state), "alpha", { prime: state.config.prime, threshold: state.config.threshold })!;
    if (op.kind !== "hunt") throw new Error("expected share HUNT");
    const wrong = { ...op, recoveredSecret: String((BigInt(op.recoveredSecret) + 1n) % BigInt(state.config.prime)) };
    const before = view(state).teams.bravo!.score;
    state = run(state, "bravo", wrong);
    expect(view(state).lastHunt?.outcome).toBe("miss");
    expect(view(state).teams.bravo!.score).toBe(Math.max(0, before - state.config.scores.wrongHunt));
    expect(huntOptions(view(state)).find(o => o.mode === "share")?.left).toBe(2);
    const score = view(state).teams.bravo!.score;
    state = run(state, "bravo", op);
    expect(view(state).teams.bravo!.score).toBe(score + state.config.scores.huntBonus);
    const feedback = huntFeedback(view(state), "alpha", "ja");
    expect(feedback.reward).toBe(state.config.scores.huntBonus);
    const result = renderToStaticMarkup(createElement(FeedbackBanner, { feedback: { ...feedback, attempt: 2, total: view(state).teams.bravo!.score }, locale: "ja" }));
    expect(result).toContain("+25");
    expect(result).toContain("現在のスコア");
    expect(huntOptions(view(state)).find(o => o.mode === "share")?.status).toBe("completed");
    expect(workspace(view(state), "share")).toBe("");
    expect(projectForTeam(state, "alpha").completedHunts).toEqual([]);
    expect(view(state).completedHunts).toEqual([{ targetTeamId: "alpha", generation: 1, via: "share" }]);
  });
  test("three actual wrong attacks close the workspace at the real budget limit", () => {
    let state = buildScenario("hunt-reachable").host.state;
    const op = buildHuntOp(view(state), "alpha", { prime: state.config.prime, threshold: state.config.threshold })!;
    if (op.kind !== "hunt") throw new Error("expected share HUNT");
    const wrong = { ...op, recoveredSecret: String((BigInt(op.recoveredSecret) + 1n) % BigInt(state.config.prime)) };
    for (let i = 0; i < state.config.maxHuntAttemptsPerTarget; i++) state = run(state, "bravo", wrong);
    expect(huntOptions(view(state)).find(o => o.mode === "share")?.status).toBe("exhausted");
    expect(render(view(state))).toContain("回数切れ");
    expect(workspace(view(state), "share")).toBe("");
    expect(validateOp(state, "bravo", wrong).ok).toBe(false);
  });
  test("older projections never reopen a successful share, sudoku or cipher attack", () => {
    for (const mode of ["share", "sudoku", "caesar"] as const) {
      const state = buildScenario(mode === "sudoku" ? "pi-reuse" : "hunt-reachable").host.state;
      const p = view(state);
      const pair = huntOptions(p).find(o => o.mode === "caesar")?.cipher?.pairs[0];
      const op = mode === "sudoku" ? buildSudokuHuntOp(p, "alpha") : mode === "share" ? buildHuntOp(p, "alpha", { prime: state.config.prime, threshold: state.config.threshold })
        : pair ? { kind: "hunt-cipher" as const, targetTeamId: "alpha", generation: 1, rung: "caesar" as const, recoveredKey: (pair.ciphertext[0]! - pair.plaintext[0]! + 6) % 6 } : undefined;
      if (!op) throw new Error(`missing ${mode} fixture`);
      const after = view(run(state, "bravo", op));
      expect(huntOptions(after).find(o => o.mode === mode)?.status).toBe("completed");
      const { completedHunts: _missingFromOlderDispatcher, ...legacy } = after;
      expect(huntOptions(legacy).find(o => o.mode === mode)?.status).toBe("unknown");
      expect(workspace(legacy, mode)).toBe("");
      expect(render(legacy)).toContain("攻撃済み状態を更新中");
    }
  });
  test("sudoku worksheet uses public tag reuse, and a participant-computed answer is adjudicated", () => {
    const state = buildScenario("pi-reuse").host.state, p = view(state);
    expect(huntOptions(p).find(o => o.mode === "sudoku")?.status).toBe("ready");
    expect(render(p)).toContain("材料を確認して解く");
    expect(render(p)).not.toContain("解が1つです");
    const html = workspace(p, "sudoku");
    expect(html).toContain("元の公開問題 A");
    expect(html).toContain("同じ印の公開マス B");
    expect(html).toContain("相手の数独の解");
    const op = buildSudokuHuntOp(p, "alpha")!;
    expect(op).toBeDefined();
    const after = run(state, "bravo", op);
    expect(huntOptions(view(after)).find(o => o.mode === "sudoku")?.status).toBe("completed");
    const reveals = p.publicLedger.filter(a => a.kind === "sudoku-reveal");
    const one = { ...p, publicLedger: reveals.slice(0, 1) };
    expect(huntOptions(one).find(o => o.mode === "sudoku")?.status).toBe("waiting");
    // Three records with different tags cannot be treated as three shares.
    const differentTags = { ...p, publicLedger: reveals.map((r, i) => ({ ...r, tag: `different-${i}` })) };
    expect(huntOptions(differentTags).find(o => o.mode === "sudoku")?.status).toBe("waiting");
  });
  test("RPS readiness requires two completed duels with equal r and a current sealed target", () => {
    let state = buildScenario("rps-reuse").host.state;
    const p = projectForTeam(state, "alpha"), target = huntOptions(p).find(o => o.mode === "rps")!;
    expect(target.status).toBe("ready");
    expect(workspace(p, "rps")).toContain("今回も同じ隠す数");
    state = run(state, "alpha", { kind: "hunt-rps", targetTeamId: "bravo", duelId: target.rps!.duelId, predictedHand: 2 });
    expect(huntOptions(projectForTeam(state, "alpha")).find(o => o.mode === "rps")?.status).toBe("pending");
    const a = state.contracts.find(c => c.teamId === "alpha" && c.task.kind === "rps-duel" && c.task.duelId === target.rps!.duelId)!;
    const b = state.contracts.find(c => c.teamId === "bravo" && c.task.kind === "rps-duel" && c.task.duelId === target.rps!.duelId)!;
    state = run(state, "alpha", { kind: "rps-commit", contractId: a.id, commitment: 13 });
    state = run(state, "bravo", { kind: "rps-open", contractId: b.id, hand: 2, randomness: 2 });
    state = run(state, "alpha", { kind: "rps-open", contractId: a.id, hand: 1, randomness: 1 });
    const settled = projectForTeam(state, "alpha");
    expect(settled.rpsHunt?.lastResult).toMatchObject({ outcome: "hit", points: 25 });
    expect(huntOptions(settled).find(o => o.mode === "rps")?.status).toBe("completed");
    expect(render(settled)).toContain("次の対戦の受付を待ちます");
  });
});

test("#739: projection and actual RPS component distinguish opponent waiting from ready", () => {
  let state = buildScenario("rps-order").host.state;
  const order = (team: string) => projectForTeam(state, team).myContracts.find(c => c.status === "open" && c.task.kind === "rps-duel")!;
  state = run(state, "alpha", { kind: "rps-commit", contractId: order("alpha").id, commitment: 13 });
  const renderDuel = () => renderToStaticMarkup(createElement(RpsDuel, { order: order("alpha"), opponentName: "bravo", locale: "ja", submitting: false, onSubmit: async () => {} }));
  expect(order("alpha").task).toMatchObject({ opponentCommitted: false });
  expect(renderDuel()).toContain("相手が封じるのを待っています");
  expect(renderDuel()).toContain("約30秒ごと");
  expect(renderDuel()).toMatch(/disabled="">手を審判へ渡す/);
  state = run(state, "bravo", { kind: "rps-commit", contractId: order("bravo").id, commitment: 13 });
  expect(order("alpha").task).toMatchObject({ opponentCommitted: true });
  expect(renderDuel()).toContain("開封できます");
  expect(order("alpha").task).not.toHaveProperty("opponentOpening");
});
