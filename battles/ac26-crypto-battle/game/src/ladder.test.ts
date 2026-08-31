import { describe, expect, test } from "bun:test";
import {
  ALL_CIPHER_RUNGS,
  deriveCipherKey,
  derivePlaintext,
  encryptWithRung,
  parseAnswer,
  rungSpec,
  toSymbols,
} from "./ladder.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { Contract, CryptoBattleState } from "./types.ts";

/**
 * [Issue #659 §2/§5] The cipher ladder's first rung, end to end.
 *
 * What the ladder is for: the rest of the Battle teaches one break (three
 * Shamir shares reconstruct a secret) and teaches it once. The ladder varies
 * the number that matters -- how much a team can publish before its key is
 * gone -- so a player learns 「弱い暗号は一度の漏洩で死ぬ」 by leaking one pair
 * and losing the key ten seconds later, rather than by being told.
 *
 * These tests hold the rung to the three things that has to be true for that
 * to work: the arithmetic is the arithmetic a person does by hand, LEAK really
 * does hand over the key, and ROTATE really does take it back.
 */

const CTX = { eventId: "ladder-match", teamIds: ["teamA", "teamB"] } as const;
const RUNG = "caesar" as const;

function ladderOrder(state: CryptoBattleState, teamId: string): Contract {
  const order = state.contracts.find(
    (c) => c.teamId === teamId && c.status === "open" && c.task.kind === "caesar-shift",
  );
  if (!order) throw new Error("test setup: expected an open ladder Order");
  return order;
}

/**
 * The Order as its own team sees it.
 *
 * Everything a participant works from -- the pictures, the alphabet, the break
 * threshold, their own key -- lives on the PROJECTION. The stored task carries
 * only the rung and the plaintext values, so a test that reached into
 * `contract.task` for symbols would be reading the persistence format rather
 * than the game.
 */
function projected(state: CryptoBattleState, teamId: string, contractId: string) {
  const task = projectForTeam(state, teamId).myContracts.find((c) => c.id === contractId)?.task;
  if (task?.kind !== "caesar-shift") throw new Error("test setup: expected a ladder Order");
  return task;
}

/** The answer a participant would produce with pencil and paper. */
function answerByHand(state: CryptoBattleState, teamId: string, order: Contract): string[] {
  const task = projected(state, teamId, order.id);
  const { symbols, myKey } = task;
  return task.plaintext.map((symbol) => {
    const value = symbols.indexOf(symbol);
    return symbols[(value + myKey) % symbols.length] ?? "?";
  });
}

describe("the rung's arithmetic is the arithmetic a person does by hand", () => {
  test("shifting forward by the key and taking the remainder is the whole operation", () => {
    // Written out literally rather than by calling encryptWithRung, so this
    // asserts the rule a participant is asked to follow -- not that the
    // function agrees with itself.
    const modulus = rungSpec(RUNG).symbols.length;
    const plaintext = [0, 1, 2, 0, 5, 4];
    const key = 2;
    expect(encryptWithRung(plaintext, key, RUNG)).toEqual(
      plaintext.map((value) => (value + key) % modulus),
    );
  });

  test("a key of zero encrypts to itself, and that is a real (bad) key, not an error", () => {
    // Worth pinning because it is the rung's lesson in its purest form: a team
    // that draws 0 and leaks a pair has published its key in the clearest way
    // available. Designing it away would be designing away the point.
    expect(encryptWithRung([0, 3, 5], 0, RUNG)).toEqual([0, 3, 5]);
  });

  test("the Order shows pictures, never words, so neither language is favoured", () => {
    // #659 §3: the plaintext is symbols. A word-based Order would hand an
    // advantage to whoever speaks the language it was written in.
    const state = tick(initialState(CTX), 0);
    const task = projected(state, "teamA", ladderOrder(state, "teamA").id);
    for (const symbol of task.plaintext) {
      expect(task.symbols).toContain(symbol);
      expect(/[a-zA-Z0-9]/.test(symbol)).toBe(false);
    }
    expect(task.plaintext.length).toBe(rungSpec(RUNG).plaintextLength);
  });

  test("an answer may be typed as symbols or as their values -- a keyboard is not a handicap", () => {
    const { symbols } = rungSpec(RUNG);
    expect(parseAnswer([symbols[3] ?? "", symbols[0] ?? ""], RUNG)).toEqual([3, 0]);
    expect(parseAnswer(["3", "0"], RUNG)).toEqual([3, 0]);
    // And anything else is a rejected op, not a thrown one.
    expect(parseAnswer(["nope"], RUNG)).toBeUndefined();
    expect(parseAnswer([String(symbols.length)], RUNG)).toBeUndefined();
    expect(parseAnswer(["-1"], RUNG)).toBeUndefined();
  });
});

describe("CIPHER: the team does the work and nothing is published", () => {
  test("the hand-computed answer is accepted, pays the full rate, and posts nothing", () => {
    let state = tick(initialState(CTX), 0);
    const order = ladderOrder(state, "teamA");
    const ledgerBefore = state.publicLedger.length;

    const op = { kind: "cipher" as const, contractId: order.id, answer: answerByHand(state, "teamA", order) };
    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
    state = applyOp(state, "teamA", op);

    expect(state.teams.teamA?.score).toBe(order.points);
    expect(order.points).toBeGreaterThan(order.leakPoints);
    expect(state.publicLedger).toHaveLength(ledgerBefore);
    expect(state.contracts.find((c) => c.id === order.id)?.resolution).toBe("cipher");
  });

  test("a wrong answer is refused, and the refusal does not walk you to the right one", () => {
    const state = tick(initialState(CTX), 0);
    const order = ladderOrder(state, "teamA");
    const correct = answerByHand(state, "teamA", order);
    const wrong = [...correct];
    const { symbols } = rungSpec(RUNG);
    wrong[0] = symbols[(symbols.indexOf(correct[0] ?? "") + 1) % symbols.length] ?? "";

    const verdict = validateOp(state, "teamA", { kind: "cipher", contractId: order.id, answer: wrong });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    // Naming the wrong position would turn a hand calculation into a guessing
    // loop against the judge.
    expect(verdict.error).not.toContain("position");
    expect(verdict.error).not.toContain("0");
  });

  test("another team's key does not answer your Order", () => {
    const state = tick(initialState(CTX), 0);
    const order = ladderOrder(state, "teamA");
    const task = projected(state, "teamA", order.id);
    const theirKey = projected(state, "teamB", ladderOrder(state, "teamB").id).myKey;
    const { symbols } = task;
    const withTheirKey = task.plaintext.map(
      (s) => symbols[(symbols.indexOf(s) + theirKey) % symbols.length] ?? "",
    );
    const mine = answerByHand(state, "teamA", order);
    // Only meaningful while the two keys actually differ.
    if (JSON.stringify(withTheirKey) === JSON.stringify(mine)) return;
    expect(validateOp(state, "teamA", { kind: "cipher", contractId: order.id, answer: withTheirKey }).ok).toBe(false);
  });

  test("a malformed answer is rejected rather than thrown on", () => {
    const state = tick(initialState(CTX), 0);
    const order = ladderOrder(state, "teamA");
    for (const answer of [["nope"], [], ["1", "2"]]) {
      expect(validateOp(state, "teamA", { kind: "cipher", contractId: order.id, answer }).ok).toBe(false);
    }
  });
});

describe("LEAK: the pair goes public, and on this rung the pair IS the key", () => {
  test("leaking publishes the plaintext next to its ciphertext, and pays the leak rate", () => {
    let state = tick(initialState(CTX), 0);
    const order = ladderOrder(state, "teamA");
    state = applyOp(state, "teamA", { kind: "leak", contractId: order.id });

    expect(state.teams.teamA?.score).toBe(order.leakPoints);
    const posted = state.publicLedger.at(-1);
    if (posted?.kind !== "cipher-pair") throw new Error("expected a cipher pair on the ledger");
    expect(posted.teamId).toBe("teamA");
    expect(posted.rung).toBe(RUNG);
    if (order.task.kind !== "caesar-shift") throw new Error("expected a ladder Order");
    expect(posted.plaintext).toEqual(order.task.plaintext);
    // Rendered through the rung's alphabet, which is where presentation lives.
    expect(toSymbols(posted.ciphertext, posted.rung)).toEqual(answerByHand(state, "teamA", order));
  });

  test("one published pair really does hand over the key -- one subtraction, from the ledger alone", () => {
    // The claim the whole rung rests on, computed the way an opponent would:
    // from the PUBLIC record, with no access to the victim's state.
    let state = tick(initialState(CTX), 0);
    const order = ladderOrder(state, "teamA");
    state = applyOp(state, "teamA", { kind: "leak", contractId: order.id });

    const pair = state.publicLedger.find((a) => a.kind === "cipher-pair");
    if (pair?.kind !== "cipher-pair") throw new Error("expected a cipher pair");
    const modulus = rungSpec(pair.rung).symbols.length;
    // (c - p) mod n, from the first column. That is the entire attack.
    const recovered = ((pair.ciphertext[0] ?? 0) - (pair.plaintext[0] ?? 0) + modulus) % modulus;

    const op = { kind: "hunt-cipher" as const, targetTeamId: "teamA", generation: 1, rung: pair.rung, recoveredKey: recovered };
    expect(validateOp(state, "teamB", op)).toEqual({ ok: true });
    // And it is genuinely the key the judge derived, not a coincidence.
    expect(recovered).toBe(deriveCipherKey(state.seed, "teamA", 1, pair.rung));
  });
});

describe("breaking a rung costs what breaking a rung is worth", () => {
  function brokenMatch() {
    let state = tick(initialState(CTX), 0);
    const order = ladderOrder(state, "teamA");
    state = applyOp(state, "teamA", { kind: "leak", contractId: order.id });
    const key = deriveCipherKey(state.seed, "teamA", 1, RUNG);
    const op = { kind: "hunt-cipher" as const, targetTeamId: "teamA", generation: 1, rung: RUNG, recoveredKey: key };
    return { state, op, leakPoints: order.leakPoints };
  }

  test("the attacker earns the RUNG's bonus, far below a Shamir hunt's", () => {
    const { state, op } = brokenMatch();
    const before = state.teams.teamB?.score ?? 0;
    const after = applyOp(state, "teamB", op);
    expect(after.teams.teamB?.score).toBe(before + rungSpec(RUNG).huntBonus);
    // #659 §2: 「弱い相手は安く狩れて、強い相手は狩れない」 is a judgement about
    // whether a target is worth your five minutes. Paying a one-subtraction
    // break the same 25 as five minutes of Lagrange interpolation would make
    // the bottom rung the only thing anyone ever hunts.
    expect(rungSpec(RUNG).huntBonus).toBeLessThan(DEFAULT_CONFIG.scores.huntBonus);
  });

  test("the victim pays the full penalty, so 「LEAK して狩られる」 stays worse than not leaking", () => {
    const { state, op, leakPoints } = brokenMatch();
    const after = applyOp(state, "teamB", op);
    // Cheap to break is not cheap to lose: the key is gone either way.
    expect(after.teams.teamA?.score).toBe(Math.max(0, leakPoints - DEFAULT_CONFIG.scores.huntPenalty));
    expect(leakPoints - DEFAULT_CONFIG.scores.huntPenalty).toBeLessThan(0);
    // ...and still ahead of letting the Order lapse, which is the confirmed
    // ordering 「失効 -15 < LEAK して狩られる -2」.
    expect(leakPoints - DEFAULT_CONFIG.scores.huntPenalty).toBeGreaterThan(
      DEFAULT_CONFIG.scores.expiredOrder,
    );
  });

  test("the break is recorded per rung, and never as a secret reconstruction that did not happen", () => {
    const { state, op } = brokenMatch();
    const after = applyOp(state, "teamB", op);
    expect(after.teams.teamA?.cipherHuntedGenerations[RUNG]).toEqual([1]);
    // The Shamir secret was never touched. Folding this into
    // `huntedGenerations` would report a reconstruction that never occurred.
    expect(after.teams.teamA?.huntedGenerations).toEqual([]);
  });

  test("the same rung cannot be broken twice by the same attacker on one generation", () => {
    const { state, op } = brokenMatch();
    const after = applyOp(state, "teamB", op);
    expect(validateOp(after, "teamB", op).ok).toBe(false);
  });

  test("a wrong key is refused, and so is hunting yourself", () => {
    const { state, op } = brokenMatch();
    const wrongKey = (op.recoveredKey + 1) % rungSpec(RUNG).symbols.length;
    expect(validateOp(state, "teamB", { ...op, recoveredKey: wrongKey }).ok).toBe(false);
    expect(validateOp(state, "teamA", op).ok).toBe(false);
  });

  test("a malformed key is rejected rather than compared as NaN", () => {
    const { state, op } = brokenMatch();
    for (const recoveredKey of [-1, 1.5, rungSpec(RUNG).symbols.length, Number.NaN]) {
      expect(validateOp(state, "teamB", { ...op, recoveredKey }).ok).toBe(false);
    }
  });
});

describe("ROTATE defends the ladder, the same way it defends the secret", () => {
  test("rotating changes the key, so a published pair stops being worth anything", () => {
    let state = tick(initialState(CTX), 0);
    const order = ladderOrder(state, "teamA");
    state = applyOp(state, "teamA", { kind: "leak", contractId: order.id });
    const oldKey = deriveCipherKey(state.seed, "teamA", 1, RUNG);

    state = applyOp(state, "teamA", { kind: "rotate" });
    const newGeneration = state.teams.teamA?.generation ?? 1;
    expect(newGeneration).toBe(2);

    // #659 §10: the record still shows the pair, but it belongs to a key nobody
    // uses. This works only because the ladder key is derived per generation --
    // if it were not, `applyRotate` would silently fail to defend the rung it
    // is most needed on.
    const stale = { kind: "hunt-cipher" as const, targetTeamId: "teamA", generation: 1, rung: RUNG, recoveredKey: oldKey };
    expect(validateOp(state, "teamB", stale).ok).toBe(false);
    // And the old key is not the new one, so replaying it against the new
    // generation fails too.
    const newKey = deriveCipherKey(state.seed, "teamA", newGeneration, RUNG);
    if (newKey !== oldKey) {
      expect(
        validateOp(state, "teamB", { ...stale, generation: newGeneration }).ok,
      ).toBe(false);
    }
  });
});

describe("a match persisted before the ladder existed still loads", () => {
  test("a team row with no cipherHuntedGenerations survives a break", () => {
    // Third new required field in three slices. Without the backfill,
    // `applyHuntCipher` reads `[rung]` off undefined and takes the match down.
    let state = tick(initialState(CTX), 0);
    const order = ladderOrder(state, "teamA");
    state = applyOp(state, "teamA", { kind: "leak", contractId: order.id });
    const persisted = JSON.parse(JSON.stringify(state)) as CryptoBattleState;
    for (const team of Object.values(persisted.teams)) {
      delete (team as unknown as Record<string, unknown>).cipherHuntedGenerations;
    }

    const migrated = tick(persisted, state.nowMs ?? 0);
    const key = deriveCipherKey(migrated.seed, "teamA", 1, RUNG);
    const op = { kind: "hunt-cipher" as const, targetTeamId: "teamA", generation: 1, rung: RUNG, recoveredKey: key };
    expect(validateOp(migrated, "teamB", op)).toEqual({ ok: true });
    expect(applyOp(migrated, "teamB", op).teams.teamA?.cipherHuntedGenerations[RUNG]).toEqual([1]);
  });
});

describe("the registry is shaped for the rungs that come next", () => {
  /**
   * [Issue #659 §3] A rung's symbols must actually RENDER, or the whole
   * language-neutrality argument fails in the worst way: a participant sees
   * tofu boxes and cannot read the Order at all.
   *
   * Found by playing the harness. #659 §3 leads with じゃんけん (✊ ✌️ 🖐) as
   * the flagship symbol set, and measuring glyph widths in the browser showed
   * those three have NO glyph there while ⚀-⚅ do. The fragile ones share a
   * shape: astral-plane code points and emoji-presentation sequences (✌️ is
   * U+270C followed by U+FE0F), which depend on an emoji font being present.
   * Dice faces are single BMP symbol characters and ride the ordinary text
   * font.
   *
   * A font check cannot run here, so this pins the property that predicts it:
   * one BMP code point per symbol, no variation selectors, no ZWJ sequences.
   * A future rung that reaches for emoji fails here rather than in a match.
   */
  test("every symbol is a single BMP code point, so it does not need an emoji font", () => {
    for (const rung of ALL_CIPHER_RUNGS) {
      for (const symbol of rungSpec(rung).symbols) {
        expect([...symbol]).toHaveLength(1);
        const code = symbol.codePointAt(0) ?? 0;
        expect(code).toBeLessThanOrEqual(0xffff);
        // U+FE0F (emoji presentation) and U+200D (ZWJ) are what make a
        // "single character" render as several fonts' worth of guesswork.
        expect(symbol).not.toContain("\uFE0F");
        expect(symbol).not.toContain("\u200D");
      }
    }
  });

  test("every declared rung is fully specified, so adding one cannot half-land", () => {
    for (const rung of ALL_CIPHER_RUNGS) {
      const spec = rungSpec(rung);
      expect(spec.symbols.length).toBeGreaterThan(2);
      expect(new Set(spec.symbols).size).toBe(spec.symbols.length);
      expect(spec.pairsToBreak).toBeGreaterThan(0);
      expect(spec.plaintextLength).toBeGreaterThan(0);
      expect(spec.huntBonus).toBeGreaterThan(0);
      // The rung has to be able to encrypt and render its own alphabet.
      const plaintext = derivePlaintext("seed", "c0", rung);
      expect(toSymbols(encryptWithRung(plaintext, 1, rung), rung)).toHaveLength(plaintext.length);
    }
  });
});
