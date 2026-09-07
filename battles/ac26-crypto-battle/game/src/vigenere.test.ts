import { artifactFields } from "./ledger-codec.ts";
import { EXPLANATIONS, orderCalculation } from "../../portal/ConceptExplanation.tsx";
import { deriveCipherKey } from "./fixtures.ts";
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMatch, submitOp, type MatchHost } from "../../dev/host.ts";
import { huntOptions, HuntWorkspace } from "../../portal/HuntPanel.tsx";
import VigenereMaterials from "../../portal/VigenereMaterials.tsx";
import { disclosurePreview } from "../../portal/OrderFocus.tsx";
import { decodeLedger, encodeLedger } from "./ledger-codec.ts";
import { encryptWithRung, exposedKeyPositions } from "./ladder.ts";
import { migrateState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { CipherPairArtifact, ContractProjection, CryptoBattleOp } from "./types.ts";

const MINUTE = 60_000;
function match(seed = "vigenere-regression") {
  return createMatch({ eventId: "vigenere-regression", teamIds: ["alpha", "bravo"], matchSecret: seed });
}
function advance(host: MatchHost, minute: number) {
  host.state = tick(host.state, minute * MINUTE);
}
function orderAt(host: MatchHost, team = "alpha"): ContractProjection & { task: Extract<ContractProjection["task"], { kind: "caesar-shift" }> } {
  const order = projectForTeam(host.state, team).myContracts.find(c => c.status === "open" && c.task.kind === "caesar-shift");
  if (!order || order.task.kind !== "caesar-shift") throw new Error("missing cipher Order");
  return { ...order, task: order.task };
}
function pairs(host: MatchHost): CipherPairArtifact[] {
  return projectForTeam(host.state, "alpha").publicLedger.filter((a): a is CipherPairArtifact => a.kind === "cipher-pair" && a.rung === "vigenere" && a.teamId === "bravo");
}
function leakAt(host: MatchHost, minute: number) {
  advance(host, minute);
  const order = orderAt(host, "bravo");
  expect(order.task.rung).toBe("vigenere");
  expect(submitOp(host, "bravo", { kind: "leak", contractId: order.id }, minute * MINUTE).kind).toBe("ok");
}

/** No expected-answer or key-derivation helper: this is the displayed worksheet. */
function answerOnScreen(order: ReturnType<typeof orderAt>): string[] {
  const keys = order.task.myKey;
  if (!Array.isArray(keys)) throw new Error("expected three keys on the screen");
  return order.task.plaintext.map((value, i) => {
    const sum = value + keys[((order.task.keyPosition ?? 0) + i) % 3]!;
    return String(sum >= 6 ? sum - 6 : sum);
  });
}

function readyHost() {
  const host = createMatch({ eventId: "vigenere-regression", teamIds: ["alpha", "bravo"], matchSecret: "vigenere-regression" }, { phaseBoundaries: { buildToPressureMs: 30 * MINUTE, pressureToEndgameMs: 75 * MINUTE } });
  for (const minute of [31, 41, 51]) leakAt(host, minute);
  return host;
}

describe("the Vigenère cycle, not a stronger-security claim", () => {
  test("a general long row repeats all three shifts; a full pair reveals all three", () => {
    const plain = [4, 5, 1, 0];
    const encrypted = encryptWithRung(plain, [1, 2, 3], "vigenere");
    expect(encrypted).toEqual([5, 1, 4, 1]);
    expect(encrypted.slice(0, 3).map((value, i) => (value - plain[i]! + 6) % 6)).toEqual([1, 2, 3]);
    expect(exposedKeyPositions([{ plaintext: plain, keyPosition: 0 }], "vigenere")).toEqual([0, 1, 2]);
    expect(encryptWithRung([5], [1, 2, 3], "vigenere", 1)).toEqual([1]);
  });

  test("the scheduled issue time fixes the rung, even on late tick and after reload", () => {
    const host = match();
    advance(host, 26);
    const previous = orderAt(host);
    expect(previous.task.rung).toBe("caesar");
    advance(host, 30);
    expect(orderAt(host).task).toEqual(previous.task); // open pre-boundary Order stays Caesar
    const onTime = tick(host.state, 31 * MINUTE);
    const delayed = tick(host.state, 33 * MINUTE);
    const expected = projectForTeam(onTime, "alpha").myContracts.find(c => c.task.kind === "caesar-shift" && c.status === "open")!;
    expect(expected.task).toMatchObject({ rung: "vigenere" });
    expect(projectForTeam(delayed, "alpha").myContracts.find(c => c.id === expected.id)?.task).toEqual(expected.task);
    expect(projectForTeam(JSON.parse(JSON.stringify(delayed)), "alpha")).toEqual(projectForTeam(delayed, "alpha"));
    expect(delayed.contracts.every(c => c.status !== "open" || c.expiresAtMs > 33 * MINUTE)).toBe(true);
  });

  test("one selected Order's three hints lead to a private correct submission within its real TTL", () => {
    for (const locale of ["ja", "en"] as const) {
      const host = match(`vigenere-${locale}`);
      advance(host, 31);
      const beforeHints = orderAt(host);
      for (const seconds of [5, 10, 15]) expect(submitOp(host, "alpha", { kind: "reveal-hint", contractId: beforeHints.id }, 31 * MINUTE + seconds * 1000).kind).toBe("ok");
      const order = orderAt(host);
      const hints = order.hints.map(h => h.text![locale]);
      expect(hints[0]).toContain(locale === "ja" ? "周期" : "period");
      expect(hints[1]).toContain("5+2=7→1");
      expect(hints[2]).toContain(locale === "ja" ? "= ？" : "= ?");
      const screen = renderToStaticMarkup(createElement(VigenereMaterials, { task: order.task, locale }));
      expect(screen).toContain(locale === "ja" ? "今回" : "this Order");
      expect(screen).toContain("4+3=7"); // an unpaid foothold, not the live answer
      expect(screen).toContain(locale === "ja" ? "現代の安全な暗号ではありません" : "not a modern secure cipher");
      const before = host.state.teams.alpha!.score;
      const ledger = host.state.publicLedger;
      expect(submitOp(host, "alpha", { kind: "cipher", contractId: order.id, answer: answerOnScreen(order) }, 31 * MINUTE + 120_000).kind).toBe("ok");
      expect(host.state.teams.alpha!.score - before).toBe(order.points);
      expect(host.state.publicLedger).toEqual(ledger);
      expect(host.state.contracts.find(c => c.id === order.id)).toMatchObject({ status: "completed", resolution: "cipher" });
      expect(submitOp(host, "alpha", { kind: "cipher", contractId: order.id, answer: answerOnScreen(order) }, 31 * MINUTE + 121_000).kind).toBe("rejected");
      expect(projectForTeam(host.state, "bravo").myContracts.some(c => c.id === order.id)).toBe(false);
    }
  });

  test("three repeated exposures of one position still leave two unknown shifts", () => {
    const host = createMatch({ eventId: "vigenere-regression", teamIds: ["alpha", "bravo"], matchSecret: "vigenere-regression" }, { phaseBoundaries: { buildToPressureMs: 30 * MINUTE, pressureToEndgameMs: 100 * MINUTE }, matchDurationMs: 105 * MINUTE });
    for (const minute of [31, 61, 91]) leakAt(host, minute);
    expect(pairs(host)).toHaveLength(3);
    expect(exposedKeyPositions(pairs(host), "vigenere")).toHaveLength(1);
    const option = huntOptions(projectForTeam(host.state, "alpha")).find(o => o.teamId === "bravo" && o.mode === "vigenere")!;
    expect(option.status).toBe("waiting");
    expect(option.detail.ja).toContain("1/3");
    // All 36 combinations of the two unpublished shifts fit these PUBLIC records.
    const known = pairs(host)[0]!;
    const position = known.keyPosition!;
    const shift = (known.ciphertext[0]! - known.plaintext[0]! + 6) % 6;
    let fits = 0;
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
      const key = [a, b]; key.splice(position, 0, shift);
      if (pairs(host).every(pair => encryptWithRung(pair.plaintext, key, "vigenere", pair.keyPosition).join() === pair.ciphertext.join())) fits++;
    }
    expect(fits).toBe(36);
    // Even the correct private key cannot bypass the PUBLIC material requirement.
    const targetKey = deriveCipherKey(host.state.seed, "bravo", 1, "vigenere");
    expect(submitOp(host, "alpha", { kind: "hunt-cipher", targetTeamId: "bravo", generation: 1, rung: "vigenere", recoveredKey: targetKey }, 91 * MINUTE).kind).toBe("rejected");
  });

  test("the server rejects all 216 keys without three public positions and isolates team/rung/generation", () => {
    const host = match(); advance(host, 31);
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
      expect(validateOp(host.state, "alpha", { kind: "hunt-cipher", targetTeamId: "bravo", generation: 1, rung: "vigenere", recoveredKey: [a, b, c] }).ok).toBe(false);
    }
    const ready = readyHost();
    const key = deriveCipherKey(ready.state.seed, "bravo", 1, "vigenere");
    const op = { kind: "hunt-cipher" as const, targetTeamId: "bravo", generation: 1, rung: "vigenere" as const, recoveredKey: key };
    expect(validateOp(ready.state, "alpha", op).ok).toBe(true);
    // Adversarial persisted records: unrelated entries must not unlock this target.
    for (const patch of [{ teamId: "alpha" }, { generation: 0 }, { rung: "caesar" as const }]) {
      const changed = decodeLedger(ready.state.publicLedger, ready.state.teams).map(a => a.kind === "cipher-pair" ? { ...a, ...patch } : a);
      expect(validateOp({ ...ready.state, publicLedger: encodeLedger(changed) }, "alpha", op).ok).toBe(false);
    }
    expect(submitOp(ready, "bravo", { kind: "rotate" }, 51 * MINUTE).kind).toBe("ok");
    expect(validateOp(ready.state, "alpha", { ...op, generation: 2 }).ok).toBe(false);
  });

  test("unpaid materials omit purchased guide text, which appears only through revealed hints", () => {
    const host = match(); advance(host, 31);
    const order = orderAt(host);
    expect(order.hints.every(h => h.text === undefined)).toBe(true);
    for (const locale of ["ja", "en"] as const) {
      const screen = renderToStaticMarkup(createElement(VigenereMaterials, { task: order.task, locale }));
      expect(screen).toContain("4+3=7");
      expect(screen).not.toContain(locale === "ja" ? "自分の値：鍵の列" : "Your values: key cycle");
      expect(screen).not.toContain("5+2=7→1");
      expect(screen).not.toContain("<details>");
      expect(JSON.stringify(EXPLANATIONS[locale].vigenere)).not.toContain("5+2=7→1");
      expect(orderCalculation(order.task, "97", locale)).toEqual([]);
    }
    for (let i = 0; i < 3; i++) expect(submitOp(host, "alpha", { kind: "reveal-hint", contractId: order.id }, 31 * MINUTE + i).kind).toBe("ok");
    const hint = orderAt(host).hints[2]!.text!;
    expect(hint.en).toContain("Your values: key cycle");
    expect(orderAt(host).hints[1]!.text!.en).toContain("original value and the key");
    expect(orderAt(host).hints[1]!.text!.en).not.toContain("operands");
  });

  test("distinct public positions give a hand-computed HUNT, then prevent repeat and retire on ROTATE", () => {
    const host = readyHost();
    const projection = projectForTeam(host.state, "alpha");
    const option = huntOptions(projection).find(o => o.teamId === "bravo" && o.mode === "vigenere")!;
    expect(option.status).toBe("ready");
    expect(option.detail.ja).toContain("1・2・3");
    const form = renderToStaticMarkup(createElement(HuntWorkspace, { target: option, projection, locale: "ja", submitting: false, onSubmit: async () => {} }));
    expect(form).toContain("鍵1 鍵2 鍵3（空白区切り）");
    const key = [0, 0, 0];
    for (const pair of pairs(host)) key[pair.keyPosition!] = (pair.ciphertext[0]! - pair.plaintext[0]! + 6) % 6;
    const op = { kind: "hunt-cipher" as const, targetTeamId: "bravo", generation: 1, rung: "vigenere" as const, recoveredKey: key };
    const before = host.state.teams.alpha!.score, victim = host.state.teams.bravo!.score;
    expect(submitOp(host, "alpha", op, 51 * MINUTE).kind).toBe("ok");
    expect(host.state.teams.alpha!.score - before).toBe(25);
    expect(host.state.teams.bravo!.score).toBe(Math.max(0, victim - 12));
    expect(submitOp(host, "alpha", op, 51 * MINUTE + 1).kind).toBe("rejected");
    expect(huntOptions(projectForTeam(host.state, "alpha")).find(o => o.teamId === "bravo" && o.mode === "vigenere")?.status).toBe("completed");
    const ledger = host.state.publicLedger;
    expect(submitOp(host, "bravo", { kind: "rotate" }, 51 * MINUTE + 2).kind).toBe("ok");
    expect(host.state.publicLedger).toEqual(ledger);
    expect(submitOp(host, "alpha", op, 51 * MINUTE + 3).kind).toBe("rejected");
    expect(huntOptions(projectForTeam(host.state, "alpha")).find(o => o.teamId === "bravo" && o.mode === "vigenere")?.status).toBe("waiting");
    advance(host, 61);
    expect(orderAt(host, "bravo").task.myKey).not.toEqual(key);
  });

  test("the disclosure preview counts new positions and expired Orders reject answers without repeated expiry", () => {
    const host = match(); advance(host, 31);
    const order = orderAt(host);
    expect(disclosurePreview(projectForTeam(host.state, "alpha"), order, "ja")).toContain("0 → 1/3");
    expect(submitOp(host, "alpha", { kind: "cipher", contractId: order.id, answer: answerOnScreen(order) }, 36 * MINUTE).kind).toBe("rejected");
    expect(host.state.contracts.find(c => c.id === order.id)?.status).toBe("expired");
    expect(tick(host.state, 36 * MINUTE)).toEqual(host.state);
  });

  test("malformed keys and answers are rejections, including unknown rungs", () => {
    const host = readyHost();
    const order = orderAt(host);
    for (const recoveredKey of [null, 2, [], [1, 2], [1, 2, 3, 4], [1, 2, 6], [1, 2, "3"], [1, 2, -1]]) {
      const op = JSON.parse(JSON.stringify({ kind: "hunt-cipher", targetTeamId: "bravo", generation: 1, rung: "vigenere", recoveredKey })) as CryptoBattleOp;
      expect(validateOp(host.state, "alpha", op).ok).toBe(false);
    }
    expect(validateOp(host.state, "alpha", { kind: "hunt-cipher", targetTeamId: "bravo", generation: 1, rung: "nope", recoveredKey: 0 } as unknown as CryptoBattleOp).ok).toBe(false);
    for (const answer of [null, 1, [1], [null], {}, "1"]) {
      expect(validateOp(host.state, "alpha", { kind: "cipher", contractId: order.id, answer } as unknown as CryptoBattleOp).ok).toBe(false);
    }
  });

  test("v6 migration preserves real Caesar data and new Vigenère survives compact ledger JSON", () => {
    const old = match(); advance(old, 1);
    const order = orderAt(old, "bravo");
    expect(submitOp(old, "bravo", { kind: "leak", contractId: order.id }, MINUTE).kind).toBe("ok");
    const bytes = JSON.stringify(old.state);
    const lifted = migrateState(JSON.parse(bytes), 6);
    expect(lifted).toEqual(old.state);
    expect(typeof orderAt({ ...old, state: lifted }).task.myKey).toBe("number");
    expect(lifted.endgameBooster).toEqual(old.state.endgameBooster);
    expect(lifted.publicLedger).toEqual(old.state.publicLedger);
    old.state = lifted; advance(old, 31);
    expect(orderAt(old).task.rung).toBe("vigenere");
    const host = readyHost();
    expect(encodeLedger(decodeLedger(JSON.parse(JSON.stringify(host.state.publicLedger)), host.state.teams), host.state.teams)).toEqual([...host.state.publicLedger]);
    expect(projectForTeam(JSON.parse(JSON.stringify(host.state)), "alpha")).toEqual(projectForTeam(host.state, "alpha"));
  });
});

test("Vigenere wrong answers forfeit this Order's reward across retries, checkpoints and v7 migration", async () => {
  const { cipherFeedback, CipherScoring } = await import("../../portal/FastMovePanel.tsx");
  const { isCryptoBattleProjection } = await import("../../portal/coordination.ts");
  const host = match(); advance(host, 31);
  host.state = { ...host.state, teams: { ...host.state.teams, alpha: { ...host.state.teams.alpha!, score: 100 } } };
  const initial = orderAt(host), correct = answerOnScreen(initial), wrong = [String((Number(correct[0]) + 1) % 6)];
  const beforeLedger = JSON.stringify(host.state.publicLedger);
  const op = (answer: readonly string[]): CryptoBattleOp => ({ kind: "cipher", contractId: initial.id, answer });
  for (const answer of [[], ["6"], ["-1"], ["0", "1"], ["x"]]) {
    expect(submitOp(host, "alpha", op(answer), 31 * MINUTE).kind).toBe("rejected");
    expect(host.state.teams.alpha!.score).toBe(100);
    expect(orderAt(host).cipherFailed).toBeUndefined();
  }
  for (const locale of ["ja", "en"] as const) {
    const html = renderToStaticMarkup(createElement(CipherScoring, { order: initial, wrongCost: host.state.config.scores.wrongProve, locale }));
    expect(html).toContain(`+${initial.points}`); expect(html).toContain("−6");
  }
  expect(submitOp(host, "alpha", op(wrong), 31 * MINUTE + 1000).kind).toBe("ok");
  const projection = projectForTeam(host.state, "alpha");
  expect(projection.lastCipher).toEqual({ contractId: initial.id, outcome: "miss", points: -6 });
  expect(projection.myContracts.find(c => c.id === initial.id)).toMatchObject({ cipherFailed: true, status: "open", points: 0 });
  expect(cipherFeedback(projection, initial.id, "ja")).toMatchObject({ kind: "error" });
  expect(cipherFeedback(projection, initial.id, "ja").body).toContain("以後0点");
  expect(projectForTeam(host.state, "bravo").lastCipher).toBeUndefined();
  expect(JSON.stringify(projectForTeam(host.state, "bravo"))).not.toContain('"cipherFailed":true');
  expect(isCryptoBattleProjection(projection)).toBe(true);
  for (const bad of [null, {}, { ...projection.lastCipher, points: "-6" }, { ...projection.lastCipher, outcome: "ok" }]) expect(isCryptoBattleProjection({ ...projection, lastCipher: bad })).toBe(false);
  const { lastCipher: _mixed, ...mixed } = projection;
  expect(isCryptoBattleProjection(mixed)).toBe(true);
  expect(cipherFeedback(mixed, initial.id, "en").kind).toBe("error");
  // Even an older-version migration cannot resurrect a flag already present.
  host.state = migrateState(JSON.parse(JSON.stringify(host.state)), 7);
  expect(orderAt(host)).toMatchObject({ cipherFailed: true, points: 0 });
  for (let n = 0; n < 6; n++) {
    if (String(n) === correct[0]) continue;
    expect(submitOp(host, "alpha", op([String(n)]), 31 * MINUTE + 2000).kind).toBe("ok");
    expect(orderAt(host).points).toBe(0);
  }
  const beforeCorrect = host.state.teams.alpha!.score;
  expect(submitOp(host, "alpha", op(correct), 31 * MINUTE + 3000).kind).toBe("ok");
  expect(host.state.teams.alpha!.score).toBe(beforeCorrect);
  const done = projectForTeam(host.state, "alpha");
  expect(done.lastCipher).toEqual({ contractId: initial.id, outcome: "hit", points: 0 });
  expect(cipherFeedback(done, initial.id, "ja")).toMatchObject({ kind: "prove", reward: 0 });
  expect(host.state.contracts.find(c => c.id === initial.id)).toMatchObject({ status: "completed", cipherFailed: true });
  expect(submitOp(host, "alpha", op(correct), 31 * MINUTE + 4000).kind).toBe("rejected");
  expect(JSON.stringify(host.state.publicLedger)).toBe(beforeLedger);
  const completed = host.state;
  advance(host, 36);
  // Terminal completion is retained; no expiredOrder charge for this Order.
  expect(host.state.contracts.find(c => c.id === initial.id)?.status).toBe("completed");
  const control = tick({ ...completed, contracts: completed.contracts.filter(c => c.id !== initial.id) }, 36 * MINUTE);
  expect(host.state.teams.alpha!.score).toBe(control.teams.alpha!.score);
});

for (const ending of ["leak", "rotate", "deadline"] as const) test(`failed CIPHER stays failed on ${ending}, never awards the old reward on resend`, () => {
  const host = match(); advance(host, 31);
  const order = orderAt(host), answer = answerOnScreen(order);
  expect(submitOp(host, "alpha", { kind: "cipher", contractId: order.id, answer: [String((Number(answer[0]) + 1) % 6)] }, 31 * MINUTE).kind).toBe("ok");
  const before = host.state.teams.alpha!.score;
  if (ending === "leak") {
    expect(submitOp(host, "alpha", { kind: "leak", contractId: order.id }, 31 * MINUTE + 1).kind).toBe("ok");
    expect(host.state.teams.alpha!.score - before).toBe(order.leakPoints);
  } else if (ending === "rotate") expect(submitOp(host, "alpha", { kind: "rotate" }, 31 * MINUTE + 1).kind).toBe("ok");
  else advance(host, 36);
  expect(host.state.contracts.find(c => c.id === order.id)?.cipherFailed).toBe(true);
  const score = host.state.teams.alpha!.score;
  const now = ending === "deadline" ? 36 * MINUTE : 31 * MINUTE + 2;
  expect(submitOp(host, "alpha", { kind: "cipher", contractId: order.id, answer }, now).kind).toBe("rejected");
  expect(host.state.teams.alpha!.score).toBe(score);
});
