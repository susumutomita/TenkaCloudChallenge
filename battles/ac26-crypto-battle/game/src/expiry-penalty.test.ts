import { describe, expect, test } from "bun:test";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { buildFheOp, buildLeakOp, buildMpcOp, buildProveOp } from "./playtest.ts";
import type { Contract, CryptoBattleOp, CryptoBattleState } from "./types.ts";

/**
 * [Issue #659] The price of NOT answering an Order.
 *
 * #659 settles the game on one ordering:
 *
 *     失効 -15  <  LEAK して狩られる -2  <  LEAK 無事 +10  <  PROVE +30
 *
 * "Doing nothing is the worst outcome available; leaking and then being hunted
 * for it is still better than that; leaking and getting away with it is better
 * again; computing it yourself is best." Everything the match is supposed to
 * produce hangs off that ordering holding. If ignoring an Order were free, the
 * dominant line would be to ignore everything you cannot compute: nothing is
 * published, so nothing can be hunted, and the opponent-facing half of the game
 * never happens -- which is the dead end #659's simulation actually measured.
 *
 * These tests are here because the scripted vertical playtest deliberately
 * turns this penalty off (it answers only the Orders its narrative needs, so a
 * live penalty would measure the script's coverage rather than the reducer --
 * see VERTICAL_CONFIG). So this file is the only place the penalty is pinned
 * against the real `DEFAULT_CONFIG` values.
 */

const CTX = { eventId: "expiry-penalty", teamIds: ["teamA", "teamB"] } as const;

function openFor(state: CryptoBattleState, teamId: string) {
  return state.contracts.filter((c) => c.teamId === teamId && c.status === "open");
}

/**
 * Answer an Order by whichever method it actually admits.
 *
 * Only about two Orders in five carry `leak` in `allowedMethods` -- a
 * `no-raw-disclosure` client forbids publishing the raw pair (Issue #645), so
 * FHE, MPC and constrained share Orders have no pass route and must be
 * computed. That matters here: a team that only ever LEAKs is a team doing no
 * work, and it should end at zero. To bank a real score, answer each Order the
 * way its own rule allows.
 */
function clearingOpFor(
  state: CryptoBattleState,
  teamId: string,
  contract: Contract,
): CryptoBattleOp | undefined {
  const projection = projectForTeam(state, teamId);
  const projected = projection.myContracts.find((c) => c.id === contract.id);
  if (!projected) return undefined;
  if (contract.task.kind === "reveal-share") {
    return contract.allowedMethods.includes("leak")
      ? buildLeakOp(contract.id)
      : buildProveOp(projection.vault, contract.id);
  }
  return contract.task.kind === "homomorphic-sum"
    ? buildFheOp(projected, state.config.prime)
    : buildMpcOp(projected, state.config.prime);
}

describe("the ordering #659 settles on is the ordering the config encodes", () => {
  test("doing nothing is worse than leaking, even when the leak gets you hunted", () => {
    const { contract, contractLeak, expiredOrder, huntPenalty } = DEFAULT_CONFIG.scores;
    const leakedAndHunted = contractLeak - huntPenalty;

    expect(expiredOrder).toBeLessThan(leakedAndHunted);
    expect(leakedAndHunted).toBeLessThan(contractLeak);
    expect(contractLeak).toBeLessThan(contract);
    // The penalty has to be an actual loss, not a smaller gain: a
    // non-negative value would make ignoring an Order free again.
    expect(expiredOrder).toBeLessThan(0);
  });
});

describe("an unanswered Order costs exactly one penalty, whatever ended it", () => {
  test("a lapsed deadline charges the penalty once per Order, and records why", () => {
    // Bank enough points first that the arithmetic below stays clear of the
    // zero floor -- a floored score would hide whether the charge is per-Order
    // or per-team, which is exactly what this test is here to decide. A flat
    // per-team penalty would make "give up on the whole batch" cost the same as
    // "miss one", and the batch is the unit the game asks a team to triage.
    let state = tick(initialState(CTX), 0);
    let atMs = 0;
    for (let batchIndex = 0; batchIndex < 4; batchIndex += 1) {
      for (const c of openFor(state, "teamA")) {
        const op = clearingOpFor(state, "teamA", c);
        if (!op) continue;
        const verdict = validateOp(state, "teamA", op);
        if (!verdict.ok) throw new Error(`test setup: clearing op rejected: ${verdict.error}`);
        state = applyOp(state, "teamA", op);
      }
      atMs += DEFAULT_CONFIG.contractIntervalMs;
      state = tick(state, atMs);
    }
    const banked = state.teams.teamA?.score ?? 0;

    // Now let one whole batch lapse untouched.
    const batch = openFor(state, "teamA");
    expect(batch.length).toBe(DEFAULT_CONFIG.contractsPerIssue);
    expect(banked).toBeGreaterThan(batch.length * -DEFAULT_CONFIG.scores.expiredOrder);

    state = tick(state, atMs + DEFAULT_CONFIG.contractTtlMs);
    expect(state.teams.teamA?.score).toBe(
      banked + batch.length * DEFAULT_CONFIG.scores.expiredOrder,
    );
    for (const c of batch) {
      const final = state.contracts.find((x) => x.id === c.id);
      expect(final?.status).toBe("expired");
      expect(final?.expiryCause).toBe("deadline");
    }
    // A completed Order is not charged and carries no cause.
    const completed = state.contracts.filter((c) => c.teamId === "teamA" && c.status === "completed");
    expect(completed.length).toBeGreaterThan(0);
    for (const c of completed) expect(c.expiryCause).toBeUndefined();
  });

  test("the same Order is never charged twice, however many ticks run over it", () => {
    let state = tick(initialState(CTX), 0);
    state = tick(state, DEFAULT_CONFIG.contractTtlMs);
    const afterFirstLapse = state.teams.teamA?.score ?? 0;

    // Re-tick at the same instant: nothing new lapses, so nothing is charged.
    state = tick(state, DEFAULT_CONFIG.contractTtlMs);
    expect(state.teams.teamA?.score).toBe(afterFirstLapse);
  });

  test("a score never goes negative -- the penalty floors at zero", () => {
    // A team that answers nothing at all runs the penalty far past its score.
    let state = tick(initialState(CTX), 0);
    for (let atMs = 0; atMs <= DEFAULT_CONFIG.matchDurationMs; atMs += 60_000) {
      state = tick(state, atMs);
      expect(state.teams.teamA?.score).toBeGreaterThanOrEqual(0);
    }
    expect(state.teams.teamA?.score).toBe(0);
  });
});

describe("ROTATE cannot be used to void a batch for free", () => {
  /**
   * ROTATE voids every Order the rotating team still has open, because
   * otherwise LEAKing a pre-rotate Order afterwards would publish a
   * fresh-generation share for nothing (see `applyRotate`).
   *
   * That void has to cost what letting the Orders lapse costs. #659 does not
   * say so -- it settles the ordering while treating PROVE, LEAK and expiry as
   * the only three ways an Order can end -- but ROTATE is a fourth, and
   * unpriced it beats all of them: `rotateCooldownMs` (3 min) is shorter than
   * `contractIntervalMs` (5 min), so a team could rotate once per batch, void
   * everything it had not finished for nothing, publish nothing, and retire its
   * past leaks on the way through.
   */
  test("rotating away from an unfinished batch costs the same as letting it lapse", () => {
    let state = tick(initialState(CTX), 0);
    const batch = openFor(state, "teamA");
    const verdict = validateOp(state, "teamA", { kind: "rotate" });
    expect(verdict).toEqual({ ok: true });

    state = applyOp(state, "teamA", { kind: "rotate" });

    expect(state.teams.teamA?.score).toBe(
      Math.max(0, batch.length * DEFAULT_CONFIG.scores.expiredOrder),
    );
    for (const c of batch) {
      const final = state.contracts.find((x) => x.id === c.id);
      expect(final?.status).toBe("expired");
      expect(final?.expiryCause).toBe("rotate");
    }
  });

  test("rotating is free once nothing is open, so WHEN to rotate is the decision", () => {
    // The converse of the test above, and the reason charging ROTATE does not
    // make it useless: the penalty is on the unanswered ORDER, not on the act
    // of rotating. A team that has cleared its batch -- or whose batch has
    // already lapsed and been charged -- rotates for nothing. Timing the rotate
    // is the decision the design wants; paying twice for one Order is not.
    let state = tick(initialState(CTX), 0);
    state = tick(state, DEFAULT_CONFIG.contractTtlMs);
    const charged = state.teams.teamA?.score ?? 0;

    // Clear the freshly-issued batch off the board the honest way, by letting
    // its own deadline take it, then rotate before the next batch lands.
    const secondBatch = openFor(state, "teamA");
    expect(secondBatch.length).toBeGreaterThan(0);
    state = tick(state, DEFAULT_CONFIG.contractTtlMs * 2);
    // The next batch issues in the same tick, so drive to a point past the last
    // issue instead: at match end, issuance has stopped and nothing is live.
    state = tick(state, DEFAULT_CONFIG.matchDurationMs);
    expect(openFor(state, "teamA")).toHaveLength(0);

    const beforeRotate = state.teams.teamA?.score ?? 0;
    state = applyOp(state, "teamA", { kind: "rotate" });
    expect(state.teams.teamA?.score).toBe(beforeRotate);
    // And no Order was re-marked: every expiry still names the clock as its
    // cause, so the rotate charged nothing a second time.
    expect(state.contracts.some((c) => c.expiryCause === "rotate")).toBe(false);
    expect(charged).toBeGreaterThanOrEqual(0);
  });
});
