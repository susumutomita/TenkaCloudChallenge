import { describe, expect, test } from "bun:test";
import { HINT_LADDER, HINT_LEVELS, hintsFor } from "./hints.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { ContractProjection, CryptoBattleState, OrderTaskKind } from "./types.ts";

/**
 * [Issue #659 §9] The hint ladder: what it may contain, what it costs, and what
 * a team who has not paid can see of it.
 */

const CTX = { eventId: "hints", teamIds: ["teamA", "teamB"] } as const;

/** A started match with one batch of Orders on every team's belt. */
function startedMatch(seed = "s".repeat(64)): CryptoBattleState {
  return tick(initialState({ ...CTX, matchSecret: seed }), 0);
}

function firstOpenOrder(state: CryptoBattleState, teamId: string): ContractProjection {
  const order = projectForTeam(state, teamId).myContracts.find((c) => c.status === "open");
  if (!order) throw new Error("test setup: expected an open Order after the first tick");
  return order;
}

/**
 * Puts points on a team's board. Every deduction in this reducer floors at 0,
 * so a test that starts a team at zero cannot tell "charged the right amount"
 * from "charged anything at all".
 */
function withScore(state: CryptoBattleState, teamId: string, score: number): CryptoBattleState {
  const team = state.teams[teamId];
  if (!team) throw new Error(`test setup: unknown team ${teamId}`);
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, score } } };
}

function orderById(state: CryptoBattleState, teamId: string, id: string): ContractProjection {
  const order = projectForTeam(state, teamId).myContracts.find((c) => c.id === id);
  if (!order) throw new Error(`test setup: Order ${id} is not on ${teamId}'s belt`);
  return order;
}

describe("the ladder itself", () => {
  const kinds = Object.keys(HINT_LADDER) as OrderTaskKind[];

  test("every task kind has a ladder of exactly HINT_LEVELS rungs", () => {
    // Not a tautology over the Record type: the type requires a key per kind,
    // it does not require the value to be non-empty or evenly sized. An Order
    // with fewer hints than its neighbour would make the price of help depend
    // on which job you happened to draw.
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(hintsFor(kind)).toHaveLength(HINT_LEVELS);
    }
  });

  test("hint ids name their kind and their 1-based level", () => {
    for (const kind of kinds) {
      hintsFor(kind).forEach((spec, level) => {
        expect(spec.id).toBe(`${kind}/${level + 1}`);
      });
    }
  });

  test("every rung ships both locales", () => {
    for (const kind of kinds) {
      for (const spec of hintsFor(kind)) {
        expect(spec.text.ja.length).toBeGreaterThan(0);
        expect(spec.text.en.length).toBeGreaterThan(0);
      }
    }
  });

  test("hint ids are unique across the whole registry", () => {
    const ids = kinds.flatMap((kind) => hintsFor(kind).map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("what hints may cost [#659 §15]", () => {
  const { hintCosts, contract, contractLeak } = DEFAULT_CONFIG.scores;

  test("there is a price for every rung", () => {
    expect(hintCosts).toHaveLength(HINT_LEVELS);
    for (const cost of hintCosts) expect(cost).toBeGreaterThan(0);
  });

  test("later rungs never cost less than earlier ones", () => {
    // The ladder runs nudge -> rule -> first step. A cheaper last rung would
    // make skipping to it the obvious play, and the first two dead weight.
    for (let i = 1; i < hintCosts.length; i += 1) {
      expect(hintCosts[i]).toBeGreaterThanOrEqual(hintCosts[i - 1] ?? 0);
    }
  });

  test("buying the whole ladder still leaves computing the Order worth more than leaking it", () => {
    // The load-bearing one. #659's confirmed ordering is
    //   失効 -15 < LEAK して狩られる -2 < LEAK 無事 +10 < PROVE +30
    // and hints are a deduction against the right-hand end of it. Priced past
    // this line, a team that needs help is better off leaking than learning --
    // which is the "LEAK is always optimal" failure the whole scoring model was
    // rebuilt to remove.
    const total = hintCosts.reduce((a, b) => a + b, 0);
    expect(contract - total).toBeGreaterThan(contractLeak);
  });
});

describe("a hint is withheld until it is paid for", () => {
  test("an unbought rung projects its price and no text", () => {
    const order = firstOpenOrder(startedMatch(), "teamA");
    expect(order.hints).toHaveLength(HINT_LEVELS);
    order.hints.forEach((hint, level) => {
      expect(hint.level).toBe(level);
      expect(hint.cost).toBe(DEFAULT_CONFIG.scores.hintCosts[level] ?? -1);
      expect(hint.text).toBeUndefined();
    });
  });

  test("no unbought hint's text appears anywhere in the projection", () => {
    // The redaction argued for in `projectHints`: the text ships from the
    // state side precisely so a browser cannot read it for free, which is only
    // true if it is genuinely absent from the payload.
    const state = startedMatch();
    const order = firstOpenOrder(state, "teamA");
    const serialized = JSON.stringify(projectForTeam(state, "teamA"));
    for (const spec of hintsFor(order.task.kind)) {
      expect(serialized).not.toContain(spec.text.ja);
      expect(serialized).not.toContain(spec.text.en);
    }
  });

  test("buying one rung reveals exactly that rung and charges exactly its price", () => {
    // Started with points on the board: a team at 0 would floor (see the
    // floor test below) and hide the size of the charge behind the clamp.
    let state = withScore(startedMatch(), "teamA", 30);
    const order = firstOpenOrder(state, "teamA");
    const before = projectForTeam(state, "teamA").teams["teamA"]?.score ?? 0;
    const op = { kind: "reveal-hint" as const, contractId: order.id };

    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
    state = applyOp(state, "teamA", op);

    const after = orderById(state, "teamA", order.id);
    expect(after.hints[0]?.text).toEqual(hintsFor(order.task.kind)[0]?.text);
    expect(after.hints[1]?.text).toBeUndefined();
    expect(after.hints[2]?.text).toBeUndefined();
    expect(projectForTeam(state, "teamA").teams["teamA"]?.score).toBe(
      before - (DEFAULT_CONFIG.scores.hintCosts[0] ?? 0),
    );
  });

  test("rungs open in order, and the ladder runs out", () => {
    let state = startedMatch();
    const order = firstOpenOrder(state, "teamA");
    const op = { kind: "reveal-hint" as const, contractId: order.id };

    for (let level = 0; level < HINT_LEVELS; level += 1) {
      expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
      state = applyOp(state, "teamA", op);
      const seen = orderById(state, "teamA", order.id).hints.filter((h) => h.text !== undefined);
      expect(seen).toHaveLength(level + 1);
    }

    const exhausted = validateOp(state, "teamA", op);
    expect(exhausted.ok).toBe(false);
    expect(exhausted.ok === false && exhausted.error).toContain("no hints left");
  });

  test("the charge lands even on an Order that then expires unanswered", () => {
    // The decision the move exists to pose (#659 §9): help you buy and do not
    // use is help you paid for. Nothing refunds it.
    // Against a control that did everything else identically, so the only
    // difference between the two final scores is the hint. Started well above
    // the floor because letting a whole batch expire is worth -15 apiece.
    const opened = withScore(startedMatch(), "teamA", 500);
    const order = firstOpenOrder(opened, "teamA");
    const bought = applyOp(opened, "teamA", { kind: "reveal-hint", contractId: order.id });
    expect(projectForTeam(bought, "teamA").teams["teamA"]?.score).toBe(
      500 - (DEFAULT_CONFIG.scores.hintCosts[0] ?? 0),
    );

    const afterExpiry = (s: CryptoBattleState) =>
      projectForTeam(tick(s, DEFAULT_CONFIG.contractIntervalMs), "teamA").teams["teamA"]?.score ?? 0;
    expect(orderById(tick(bought, DEFAULT_CONFIG.contractIntervalMs), "teamA", order.id).status).toBe(
      "expired",
    );
    // Nothing refunds it: the Order it was bought for was never answered.
    expect(afterExpiry(opened) - afterExpiry(bought)).toBe(DEFAULT_CONFIG.scores.hintCosts[0] ?? 0);
  });
});

describe("who may buy a hint, and on what", () => {
  test("not on another team's Order", () => {
    const state = startedMatch();
    const order = firstOpenOrder(state, "teamA");
    const result = validateOp(state, "teamB", { kind: "reveal-hint", contractId: order.id });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("belongs to another team");
  });

  test("not on an Order that is no longer open", () => {
    let state = startedMatch();
    const order = firstOpenOrder(state, "teamA");
    state = tick(state, DEFAULT_CONFIG.contractIntervalMs);
    const result = validateOp(state, "teamA", { kind: "reveal-hint", contractId: order.id });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("not open");
  });

  test("not on an Order that does not exist", () => {
    const state = startedMatch();
    const result = validateOp(state, "teamA", { kind: "reveal-hint", contractId: "nope" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("not found");
  });

  test("a score at the floor stays at the floor", () => {
    // Same convention as every other deduction in reducer.ts (`applyHunt`,
    // `applyExpiryPenalties`): penalties floor at 0 rather than running a team
    // negative.
    let state = startedMatch();
    const order = firstOpenOrder(state, "teamA");
    expect(projectForTeam(state, "teamA").teams["teamA"]?.score).toBe(0);
    state = applyOp(state, "teamA", { kind: "reveal-hint", contractId: order.id });
    expect(projectForTeam(state, "teamA").teams["teamA"]?.score).toBe(0);
  });
});

describe("a hint carries nothing that belongs to the match", () => {
  test("the same rung reads identically under a different seed and a different team", () => {
    // Executes the rule the module header states: hint text is a constant of
    // the task kind. Anything seed-derived -- a key, a plaintext, a private
    // input, an expected answer -- could not survive this comparison, because
    // every such value differs between these two matches.
    const buyAll = (state: CryptoBattleState, teamId: string) => {
      let next = state;
      const order = firstOpenOrder(next, teamId);
      for (let i = 0; i < HINT_LEVELS; i += 1) {
        next = applyOp(next, teamId, { kind: "reveal-hint", contractId: order.id });
      }
      return orderById(next, teamId, order.id);
    };

    const left = buyAll(startedMatch("a".repeat(64)), "teamA");
    const right = buyAll(startedMatch("b".repeat(64)), "teamB");
    // Same batch position in both matches, so the same task kind -- if that
    // ever stops holding, this test should fail loudly rather than compare
    // two different ladders and pass for the wrong reason.
    expect(right.task.kind).toBe(left.task.kind);
    expect(right.hints.map((h) => h.text)).toEqual(left.hints.map((h) => h.text));
  });
});

describe("a match persisted before hints existed", () => {
  test("a config with no price list is backfilled rather than charging NaN", () => {
    const started = startedMatch();
    const { hintCosts: _dropped, ...scoresWithoutHints } = started.config.scores;
    const legacy = {
      ...started,
      config: { ...started.config, scores: scoresWithoutHints },
    } as unknown as CryptoBattleState;

    const order = firstOpenOrder(legacy, "teamA");
    expect(validateOp(legacy, "teamA", { kind: "reveal-hint", contractId: order.id })).toEqual({
      ok: true,
    });
    const after = applyOp(legacy, "teamA", { kind: "reveal-hint", contractId: order.id });
    expect(Number.isNaN(after.teams["teamA"]?.score)).toBe(false);
  });

  test("an Order with no hintsRevealed field opens its first rung, not its second", () => {
    const started = startedMatch();
    const order = firstOpenOrder(started, "teamA");
    const legacy: CryptoBattleState = {
      ...started,
      contracts: started.contracts.map((c) => {
        const { hintsRevealed: _absent, ...rest } = c;
        return rest;
      }),
    };
    const after = applyOp(legacy, "teamA", { kind: "reveal-hint", contractId: order.id });
    const projected = orderById(after, "teamA", order.id);
    expect(projected.hints[0]?.text).toBeDefined();
    expect(projected.hints[1]?.text).toBeUndefined();
  });
});
