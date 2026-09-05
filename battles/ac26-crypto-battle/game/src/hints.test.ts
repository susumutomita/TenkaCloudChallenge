import { describe, expect, test } from "bun:test";
import { type HintContext, HINT_LADDER, HINT_LEVELS, hintsFor } from "./hints.ts";
import { SUBSTRING_SAFE_FIELD } from "./playtest.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { ContractProjection, CryptoBattleProjection, CryptoBattleState, OrderTaskKind } from "./types.ts";

/**
 * [Issue #659 §9] The hint ladder: what it may contain, what it costs, and what
 * a team who has not paid can see of it.
 */

const CTX = { eventId: "hints", teamIds: ["teamA", "teamB"] } as const;

/**
 * A started match with one batch of Orders on every team's belt.
 *
 * [Issue #677] Started by the op a player sends, not by a tick. A match now
 * waits in `waiting` until someone presses START -- ticking an unstarted match
 * issues nothing, which is the whole point of that phase.
 */
function startedMatch(seed = "s".repeat(64)): CryptoBattleState {
  return applyOp(initialState({ ...CTX, matchSecret: seed }), "teamA", { kind: "start" });
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

/**
 * [Issue #712] The context a rung is rendered against: this Order and this
 * reader's vault, exactly as `projectHints` builds it.
 */
function ctxFor(projection: CryptoBattleProjection, order: ContractProjection): HintContext {
  return {
    allowedMethods: order.allowedMethods, exposedShareIndices: [], task: order.task,
    vault: projection.vault,
    prime: projection.prime,
    threshold: projection.threshold,
    shareCount: projection.vault.shares.length,
  };
}

/** Every Order kind, each rendered against a real Order of that kind. */
function oneOrderPerKind(): { projection: CryptoBattleProjection; order: ContractProjection }[] {
  let state = startedMatch();
  const seen = new Map<OrderTaskKind, { projection: CryptoBattleProjection; order: ContractProjection }>();
  for (let round = 0; round < 12 && seen.size < Object.keys(HINT_LADDER).length; round += 1) {
    const projection = projectForTeam(state, "teamA");
    for (const order of projection.myContracts) {
      if (!seen.has(order.task.kind)) seen.set(order.task.kind, { projection, order });
    }
    state = tick(state, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
  }
  return [...seen.values()];
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

  test("every rung ships both locales, rendered against a real Order of its kind", () => {
    const samples = oneOrderPerKind();
    expect(samples.map((s) => s.order.task.kind).sort()).toEqual([...kinds].sort());
    for (const { projection, order } of samples) {
      for (const spec of hintsFor(order.task.kind)) {
        const text = spec.text(ctxFor(projection, order));
        expect(text.ja.length).toBeGreaterThan(0);
        expect(text.en.length).toBeGreaterThan(0);
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
    const projection = projectForTeam(state, "teamA");
    const order = firstOpenOrder(state, "teamA");
    const serialized = JSON.stringify(projection);
    for (const spec of hintsFor(order.task.kind)) {
      const text = spec.text(ctxFor(projection, order));
      expect(serialized).not.toContain(text.ja);
      expect(serialized).not.toContain(text.en);
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

    const afterProjection = projectForTeam(state, "teamA");
    const after = orderById(state, "teamA", order.id);
    expect(after.hints[0]?.text).toEqual(hintsFor(order.task.kind)[0]?.text(ctxFor(afterProjection, after)));
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

describe("a hint carries nothing that belongs to another team [#712]", () => {
  /**
   * The rule changed shape in #712 and this test changed with it. A rung used
   * to be a constant of the task kind, pinned by rendering it under two seeds
   * and requiring byte-identical text. It is now rendered against the reader's
   * OWN Order and vault so the last rung can walk THEIR numbers -- so the
   * property to pin is no longer "carries nothing", it is "carries nothing of
   * anyone else's". Rendered in the big field, where a substring search over
   * two-digit values would report coincidences rather than leaks.
   */
  const buyAll = (state: CryptoBattleState, teamId: string) => {
    let next = state;
    const order = firstOpenOrder(next, teamId);
    for (let i = 0; i < HINT_LEVELS; i += 1) {
      next = applyOp(next, teamId, { kind: "reveal-hint", contractId: order.id });
    }
    return { state: next, order: orderById(next, teamId, order.id) };
  };

  test("rendering the same rung twice from the same state is identical", () => {
    const state = startedMatch();
    const a = buyAll(state, "teamA");
    const b = buyAll(state, "teamA");
    expect(a.order.hints.map((h) => h.text)).toEqual(b.order.hints.map((h) => h.text));
  });

  test("no rung ever quotes another team's secret or un-leaked shares", () => {
    let state = applyOp(
      initialState({ ...CTX, matchSecret: "n".repeat(64) }, SUBSTRING_SAFE_FIELD),
      "teamA",
      { kind: "start" },
    );
    const other = state.teams["teamB"];
    if (!other) throw new Error("test setup: expected teamB");
    for (let round = 0; round < 6; round += 1) {
      for (const order of projectForTeam(state, "teamA").myContracts.filter((c) => c.status === "open")) {
        let bought = state;
        for (let i = 0; i < HINT_LEVELS; i += 1) {
          bought = applyOp(bought, "teamA", { kind: "reveal-hint", contractId: order.id });
        }
        const texts = orderById(bought, "teamA", order.id).hints.map((h) => `${h.text?.ja}\n${h.text?.en}`).join("\n");
        expect(texts).not.toContain(other.secret);
        for (const share of other.shares) expect(texts).not.toContain(share.value);
      }
      state = tick(state, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
    }
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
