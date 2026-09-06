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
  const host = match();
  for (const minute of [31, 36, 41]) leakAt(host, minute);
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
      const wrong = answerOnScreen(order).map(n => String((Number(n) + 1) % 6));
      const beforeWrong = host.state;
      expect(validateOp(host.state, "alpha", { kind: "cipher", contractId: order.id, answer: wrong }).ok).toBe(false);
      expect(host.state).toBe(beforeWrong); // existing CIPHER retry semantics, unlike failed PROVE
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
    const host = match();
    for (const minute of [31, 46, 61]) leakAt(host, minute);
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
    expect(submitOp(host, "alpha", op, 41 * MINUTE).kind).toBe("ok");
    expect(host.state.teams.alpha!.score - before).toBe(25);
    expect(host.state.teams.bravo!.score).toBe(Math.max(0, victim - 12));
    expect(submitOp(host, "alpha", op, 41 * MINUTE + 1).kind).toBe("rejected");
    expect(huntOptions(projectForTeam(host.state, "alpha")).find(o => o.teamId === "bravo" && o.mode === "vigenere")?.status).toBe("completed");
    const ledger = host.state.publicLedger;
    expect(submitOp(host, "bravo", { kind: "rotate" }, 41 * MINUTE + 2).kind).toBe("ok");
    expect(host.state.publicLedger).toEqual(ledger);
    expect(submitOp(host, "alpha", op, 41 * MINUTE + 3).kind).toBe("rejected");
    expect(huntOptions(projectForTeam(host.state, "alpha")).find(o => o.teamId === "bravo" && o.mode === "vigenere")?.status).toBe("waiting");
    advance(host, 46);
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
    expect(encodeLedger(decodeLedger(JSON.parse(JSON.stringify(host.state.publicLedger))))).toEqual([...host.state.publicLedger]);
    expect(projectForTeam(JSON.parse(JSON.stringify(host.state)), "alpha")).toEqual(projectForTeam(host.state, "alpha"));
  });
});
