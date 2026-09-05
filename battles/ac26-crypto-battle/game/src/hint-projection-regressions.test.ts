import { describe, expect, test } from "bun:test";
import { disclosurePreview } from "../../portal/OrderFocus.tsx";
import { mpcWorksheet } from "../../portal/MpcWorksheet.tsx";
import { FAST_MOVE_COPY } from "../../portal/FastMovePanel.tsx";
import { HINT_LADDER, type HintContext } from "./hints.ts";
import { applyOp, initialState, projectForTeam, tick } from "./reducer.ts";
import type { CryptoBattleState } from "./types.ts";

const context = { eventId: "hint-review", teamIds: ["a", "b"], matchSecret: "n".repeat(64) };
function started(threshold = 3) { return applyOp(initialState(context, { threshold }), "a", { kind: "start" }); }
function bought(state: CryptoBattleState, id: string) {
  for (let i = 0; i < 3; i++) state = applyOp(state, "a", { kind: "reveal-hint", contractId: id });
  return projectForTeam(state, "a");
}
function shareOrder(state: CryptoBattleState) {
  const order = state.contracts.find(c => c.teamId === "a" && c.task.kind === "reveal-share");
  if (!order) throw new Error("fixture has no share Order");
  return order;
}

describe("reviewed hint projection boundaries", () => {
  test("already public shares add zero; repeating the requested index does not create false danger", () => {
    let state = started();
    const first = shareOrder(state);
    state = applyOp(state, "a", { kind: "leak", contractId: first.id });
    if (first.task.kind !== "reveal-share") throw new Error("expected share task");
    const repeat = { ...first, id: "a-repeat", hintsRevealed: 0, task: { ...first.task, shareIndices: [...first.task.shareIndices, ...first.task.shareIndices] } };
    state = { ...state, contracts: [...state.contracts, repeat] };
    const p = bought(state, repeat.id);
    const order = p.myContracts.find(c => c.id === repeat.id)!;
    expect(order.hints[2]!.text!.ja).toContain("1 + 0 = 1");
    expect(disclosurePreview(p, order, "ja")).toContain("1 → 1 個");
    // Public shares of another team or of a retired generation must not count.
    const entry = p.publicLedger.find(e => e.kind === "share")!;
    const noisy = { ...p, publicLedger: [...p.publicLedger, { ...entry, id: "other", teamId: "b", shareIndex: 2 }, { ...entry, id: "old", generation: 0, shareIndex: 3 }] };
    expect(disclosurePreview(noisy, order, "ja")).toContain("1 → 1 個");
  });

  test("a protected share Order's final hint directs PROVE, and does not tell the player to press LEAK", () => {
    let state = started();
    const first = shareOrder(state);
    state = { ...state, contracts: state.contracts.map(c => c.id === first.id ? { ...c, privacyConstraint: "no-raw-disclosure", allowedMethods: ["prove"] } : c) };
    const p = bought(state, first.id);
    const text = p.myContracts.find(c => c.id === first.id)!.hints[2]!.text!;
    expect(text.ja).toContain("LEAK を受け付けません");
    expect(text.ja).not.toContain("LEAK を押すだけ");
    expect(text.ja).toContain("4 マス");
    expect(text.en).toContain("does not accept LEAK");
    expect(p.vault.sudokuSolution).toHaveLength(16);
  });

  test("threshold four describes the cubic match formula and labels the fixed three-share example separately", () => {
    const state = started(4);
    const p = bought(state, shareOrder(state).id);
    const hints = p.myContracts[0]!.hints;
    expect(hints[0]!.text!.ja).toContain("異なる番号が 4 個");
    expect(hints[0]!.text!.ja).toContain("全 97 通り");
    expect(hints[1]!.text!.ja).toContain("係数3 × 番号 × 番号 × 番号");
    expect(hints[1]!.text!.ja).toContain("『3 個で戻る・割る数 7』");
  });

  test("MPC hint and free worksheet keep exact mask totals beyond Number precision", () => {
    const p = projectForTeam(tick(started(), 60_000), "a");
    const task = { kind: "masked-total" as const, partyCount: 3, myInput: "5", incomingMasks: ["2305843009213693949", "3"], outgoingMasks: ["2305843009213693948", "1"] };
    const ctx: HintContext = { task, vault: p.vault, prime: "2305843009213693951", threshold: 3, shareCount: 5, allowedMethods: ["mpc"], exposedShareIndices: [] };
    const hint = HINT_LADDER["masked-total"][2]!.text(ctx);
    expect(hint.ja).toContain("2305843009213693949 + 3 = 2305843009213693952");
    expect(hint.ja).toContain("2305843009213693948 + 1 = 2305843009213693949");
    expect(hint.en).toContain("2305843009213693950");
    const worksheet = mpcWorksheet(task, ctx.prime, "ja");
    expect(worksheet[2]!.calculation).toBe("5 + 2305843009213693952 − 2305843009213693949 = □");
    expect(worksheet[3]!.note).toContain("0〜2305843009213693950");
  });

  test("the live MPC worksheet spells out the reported screen without filling the final answer", () => {
    const steps = mpcWorksheet({ kind: "masked-total", partyCount: 3, myInput: "95", incomingMasks: ["72", "42"], outgoingMasks: ["11", "87"] }, "97", "ja");
    expect(steps.map(step => step.calculation)).toEqual(["72 + 42 = 114", "11 + 87 = 98", "95 + 114 − 98 = □", "③ の答えを 97 で割った余り → 下の回答欄"]);
  });

  test("card and hint call the same concepts by the same names", () => {
    const p = projectForTeam(tick(started(), 60_000), "a");
    const task = p.myContracts.find(c => c.task.kind === "masked-total")!.task;
    const ctx: HintContext = { task, vault: p.vault, prime: p.prime, threshold: p.threshold, shareCount: 5, allowedMethods: ["mpc"], exposedShareIndices: [] };
    const fhe = HINT_LADDER["homomorphic-sum"][0]!.text(ctx).ja;
    for (const noun of ["判定側", "中身", "隠す数"]) {
      expect(FAST_MOVE_COPY.ja.fheWhy).toContain(noun);
      expect(fhe).toContain(noun);
    }
    expect(fhe).toContain("FHE");
    const mpc = HINT_LADDER["masked-total"][0]!.text(ctx).ja;
    for (const noun of ["覆面", "拠点", "小計"]) {
      expect(FAST_MOVE_COPY.ja.mpcWhy).toContain(noun);
      expect(mpc).toContain(noun);
    }
    expect(HINT_LADDER["masked-total"][2]!.text(ctx).ja).toContain(FAST_MOVE_COPY.ja.mpcAnswer);
  });
});
