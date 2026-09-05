import { describe, expect, test } from "bun:test";
import { decodeLedger } from "./ledger-codec.ts";
import { reconstruct } from "./shamir.ts";
import { allowedMethodsFor } from "./methods.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { startedMatch } from "./playtest.ts";
import type {
  Contract,
  CryptoBattleOp,
  CryptoBattleState,
  PublicArtifact,
  ShareArtifact,
} from "./types.ts";

/** Type-narrowing predicate: `PublicArtifact` is a `ShareArtifact | ProofArtifact` union since PR2 (PROVE artifacts). */
function isShareArtifact(a: PublicArtifact): a is ShareArtifact {
  return a.kind === "share";
}

const CTX = { eventId: "match-basic", teamIds: ["teamA", "teamB"] } as const;

/**
 * Leaks exactly `threshold` distinct shares for `teamId`, via synthetic
 * contracts injected straight into `state.contracts` (id-namespaced away
 * from the reducer's own `${teamId}-c${n}` scheme so nothing collides with
 * whatever tick() already issued). This is a test-only shortcut for
 * reaching "team X has leaked >= threshold shares" without stepping through
 * real contract-issuance timing. Module-scoped so both the "hunt" and the
 * hunt-replay-guard tests can share it.
 */
function leakThreshold(stateIn: ReturnType<typeof initialState>, teamId: string) {
  let state = stateIn;
  const team = state.teams[teamId];
  if (!team) throw new Error("unknown team");
  for (let i = 0; i < state.config.threshold; i += 1) {
    const contractId = `synthetic-${teamId}-${i}`;
    const shareIndex = team.shares[i % team.shares.length]?.index ?? 1;
    state = {
      ...state,
      contracts: [
        ...state.contracts,
        {
          id: contractId,
          teamId,
          kind: "standard" as const,
          points: state.config.scores.contract,
          leakPoints: state.config.scores.contractLeak,
          task: { kind: "reveal-share" as const, shareIndices: [shareIndex] },
          issuedAtMs: 0,
          expiresAtMs: state.config.contractTtlMs,
          status: "open" as const,
          privacyConstraint: "none" as const,
          allowedMethods: ["leak", "prove"] as const,
        },
      ],
    };
    state = applyOp(state, teamId, { kind: "leak", contractId });
  }
  return state;
}

describe("initialState", () => {
  test("creates one TeamState per team, score 0, generation 1", () => {
    const state = startedMatch(CTX);
    expect(Object.keys(state.teams).sort()).toEqual(["teamA", "teamB"]);
    for (const team of Object.values(state.teams)) {
      expect(team.score).toBe(0);
      expect(team.generation).toBe(1);
      expect(team.shares).toHaveLength(state.config.shareCount);
    }
  });

  test("each team's shares actually reconstruct that team's secret", () => {
    const state = startedMatch(CTX);
    for (const team of Object.values(state.teams)) {
      const some = team.shares
        .slice(0, state.config.threshold)
        .map((s) => ({ index: s.index, value: BigInt(s.value) }));
      expect(reconstruct(some, BigInt(state.config.prime))).toBe(BigInt(team.secret));
    }
  });

  test("config overrides merge onto defaults instead of replacing the whole object", () => {
    const state = startedMatch(CTX, { threshold: 4 });
    expect(state.config.threshold).toBe(4);
    expect(state.config.shareCount).toBe(DEFAULT_CONFIG.shareCount);
    expect(state.config.scores).toEqual(DEFAULT_CONFIG.scores);
  });

  /**
   * [Issue #677] A deployed match waits; it does not quietly begin.
   *
   * The belt used to start on the platform's first tick, a minute after the
   * event opened, so a match deployed for a later start was already issuing
   * Orders — and charging 15 points each when they lapsed — into an empty room.
   */
  test("phase starts at waiting, with no clock and no Orders", () => {
    const state = initialState(CTX);
    expect(state.phase).toBe("waiting");
    expect(state.startedAtMs).toBeUndefined();
    expect(state.nowMs).toBeUndefined();
    expect(tick(state, 60 * 60_000).contracts).toEqual([]);
  });

  test("a waiting match takes no expiry damage however long it waits", () => {
    // The whole point: an hour of nobody playing must cost nobody anything.
    const state = tick(initialState(CTX), 60 * 60_000);
    expect(state.phase).toBe("waiting");
    expect(state.startedAtMs).toBeUndefined();
    expect(Object.values(state.teams).map((t) => t.score)).toEqual([0, 0]);
  });

  test("START begins the match and hands over the first batch at once", () => {
    // Ticks are a minute apart, so a START that only armed the belt would leave
    // the player staring at an empty board for most of a minute.
    const state = startedMatch(CTX);
    expect(state.phase).toBe("build");
    expect(state.startedAtMs).toBe(0);
    expect(state.contracts.filter((c) => c.teamId === "teamA")).toHaveLength(
      DEFAULT_CONFIG.contractsPerIssue,
    );
  });

  test("START is refused once the match is under way", () => {
    const state = startedMatch(CTX);
    expect(validateOp(state, "teamB", { kind: "start" }).ok).toBe(false);
  });
});

describe("tick: phases", () => {
  test("START fixes startedAtMs; later ticks only advance nowMs", () => {
    const state = tick(startedMatch(CTX), 1000);
    expect(state.startedAtMs).toBe(0);
    expect(state.nowMs).toBe(1000);
    expect(state.phase).toBe("build");
  });

  test("crosses build -> pressure -> endgame -> ended as elapsed time grows", () => {
    let state = tick(startedMatch(CTX), 0);
    const b = DEFAULT_CONFIG.phaseBoundaries;
    expect(tick(state, b.buildToPressureMs - 1).phase).toBe("build");
    expect(tick(state, b.buildToPressureMs).phase).toBe("pressure");
    expect(tick(state, b.pressureToEndgameMs).phase).toBe("endgame");
    expect(tick(state, DEFAULT_CONFIG.matchDurationMs).phase).toBe("ended");
  });
});

describe("tick: contract issuance and expiry", () => {
  test("issues a whole batch per team at match start", () => {
    const state = tick(startedMatch(CTX), 0);
    const open = state.contracts.filter((c) => c.status === "open");
    // [Issue #659] Every team is handed `contractsPerIssue` Orders at once.
    // Asserted against the config rather than a literal, because the batch size
    // is the design's one tuning knob and a re-tune must not need a test edit.
    expect(open).toHaveLength(2 * DEFAULT_CONFIG.contractsPerIssue);
    for (const teamId of ["teamA", "teamB"]) {
      expect(open.filter((c) => c.teamId === teamId)).toHaveLength(
        DEFAULT_CONFIG.contractsPerIssue,
      );
    }
  });

  test("the next batch REPLACES the last one rather than piling on top of it", () => {
    let state = tick(startedMatch(CTX), 0);
    const firstBatch = state.contracts.map((c) => c.id);
    state = tick(state, DEFAULT_CONFIG.contractIntervalMs);

    // [Issue #659] "No prefetch" is the rule the whole scoring model rests on:
    // a team may never hold more than the batch in front of it. If Orders
    // accumulated, a team could leak from the backlog to free time for extra
    // PROVEs, and LEAK would beat PROVE at any point values.
    const open = state.contracts.filter((c) => c.status === "open");
    expect(open).toHaveLength(2 * DEFAULT_CONFIG.contractsPerIssue);
    expect(open.some((c) => firstBatch.includes(c.id))).toBe(false);

    // The old batch is retained (expired), not dropped -- scoring and the
    // participant's own board both need to see what lapsed.
    expect(state.contracts).toHaveLength(4 * DEFAULT_CONFIG.contractsPerIssue);
    for (const id of firstBatch) {
      expect(state.contracts.find((c) => c.id === id)?.status).toBe("expired");
    }
  });

  test("a tick that jumps far ahead catches up on every missed batch, bounded by match end", () => {
    const state = tick(startedMatch(CTX), DEFAULT_CONFIG.matchDurationMs * 10);
    // No batch is issued at or after matchEndAtMs, so the walk is finite. The
    // slots are all consumed rather than re-rolled -- freezing the sequence on
    // a dead slot would stop the belt for good -- and none of them lands as an
    // Order the team is charged for, because every deadline is already past.
    const teamA = state.teams.teamA;
    if (!teamA) throw new Error("expected teamA");
    const slots = DEFAULT_CONFIG.matchDurationMs / DEFAULT_CONFIG.contractIntervalMs;
    expect(teamA.issuedOrderCount).toBeGreaterThan(0);
    // [Issue #689] +1 for the onboarding Order, which is a batch of one.
    expect(teamA.issuedOrderCount).toBeLessThanOrEqual(
      slots * DEFAULT_CONFIG.contractsPerIssue + 1,
    );
    expect(state.contracts.filter((c) => c.status === "open")).toEqual([]);
    expect(state.phase).toBe("ended");
  });

  test("expires an open contract once its TTL passes, without touching completed ones", () => {
    let state = tick(startedMatch(CTX), 0);
    const contractId = state.contracts.find((c) => c.teamId === "teamA")?.id;
    if (contractId === undefined) throw new Error("expected a contract for teamA");
    state = applyOp(state, "teamA", { kind: "leak", contractId });
    state = tick(state, DEFAULT_CONFIG.contractTtlMs + 1);
    const completed = state.contracts.find((c) => c.id === contractId);
    expect(completed?.status).toBe("completed");
    const stillOpenForB = state.contracts.filter((c) => c.teamId === "teamB" && c.status === "expired");
    expect(stillOpenForB.length).toBeGreaterThan(0);
  });
});

/**
 * [Issue #645] Tick forward until `teamId` has an open Order matching `want`,
 * and return that state together with the Order.
 *
 * Which Orders forbid raw disclosure is derived from the seed, so "teamA's
 * first Order" is no longer interchangeable with "an Order teamA may LEAK" --
 * and how many ticks it takes to see one of each is a property of the seed, not
 * something a test should hard-code. Tests say which Order they need; this
 * plays the match until one is issued, and fails loudly rather than silently
 * testing whatever happened to be there.
 */
function orderMatching(
  want: (contract: Contract) => boolean,
  teamId = "teamA",
): { state: CryptoBattleState; order: Contract } {
  let state = tick(startedMatch(CTX), 0);
  for (let issued = 0; issued < 20; issued += 1) {
    const order = state.contracts.find(
      (c) => c.teamId === teamId && c.status === "open" && want(c),
    );
    if (order) return { state, order };
    state = tick(state, (issued + 1) * DEFAULT_CONFIG.contractIntervalMs);
  }
  throw new Error(`no matching open order for ${teamId} within 20 issuance rounds`);
}

const allowsLeak = (contract: Contract) => contract.allowedMethods.includes("leak");

describe("leak", () => {
  test("validateOp accepts an own open contract, rejects everything else", () => {
    const { state, order } = orderMatching(allowsLeak);
    const theirs = state.contracts.find(
      (c) => c.teamId === "teamB" && c.status === "open" && allowsLeak(c),
    );
    if (!theirs) throw new Error("expected an open LEAK-able order for teamB");

    expect(validateOp(state, "teamA", { kind: "leak", contractId: order.id })).toEqual({ ok: true });
    expect(validateOp(state, "teamA", { kind: "leak", contractId: theirs.id }).ok).toBe(false);
    expect(validateOp(state, "teamA", { kind: "leak", contractId: "does-not-exist" }).ok).toBe(false);
  });

  /**
   * [Issue #645] The Level-1 "technique-specified" Order. Its client will not
   * accept the underlying value being published, so LEAK is refused and the
   * message names the constraint -- a participant told only "not allowed"
   * learns nothing they can carry to the next Order.
   */
  test("validateOp refuses LEAK on an Order that forbids raw disclosure", () => {
    // [Issue #709] The belt no longer issues a PROVE-only SHARE Order (that
    // slot is the ZK sudoku Order, which LEAK cannot serve at all -- a
    // different refusal, see fhe.test.ts). The rule itself is still live code
    // (`allowedMethodsFor` applies it to every Order), so it is exercised here
    // on a share Order given the rule by hand: LEAK CAN do a share Order, and
    // this is the one refusal that is about the rule rather than the tool.
    const { state: open, order: share } = orderMatching(
      (c) => c.privacyConstraint === "none" && c.task.kind === "reveal-share",
    );
    const constrained: Contract = {
      ...share,
      privacyConstraint: "no-raw-disclosure",
      allowedMethods: allowedMethodsFor("reveal-share", "no-raw-disclosure"),
    };
    const state: CryptoBattleState = {
      ...open,
      contracts: open.contracts.map((c) => (c.id === share.id ? constrained : c)),
    };

    expect(constrained.allowedMethods).toEqual(["prove"]);
    const verdict = validateOp(state, "teamA", { kind: "leak", contractId: constrained.id });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("no-raw-disclosure");
    expect(verdict.error).toContain("PROVE");
  });

  /**
   * An unconstrained SHARE Order still accepts either method.
   *
   * [Issue #659] Selected by task kind as well as by constraint. The ladder
   * added a second unconstrained shape whose free choice is `leak` or `cipher`,
   * so "the first Order with no constraint" stopped identifying the one this
   * test is about -- see order-mix.test.ts, which asserts both shapes exist.
   */
  test("an unconstrained share Order accepts both methods", () => {
    const { order } = orderMatching(
      (c) => c.privacyConstraint === "none" && c.task.kind === "reveal-share",
    );
    expect(order.allowedMethods).toEqual(["leak", "prove"]);
  });

  test("applyOp posts the requested share(s) to the public ledger and pays out points", () => {
    // [Issue #659] LEAK now posts a share on a share Order and a
    // (plaintext, ciphertext) pair on a ladder Order, so this test names the
    // one it is about. `ladder.test.ts` covers the other.
    const { state, order: contract } = orderMatching(
      (c) => allowsLeak(c) && c.task.kind === "reveal-share",
    );
    const next = applyOp(state, "teamA", { kind: "leak", contractId: contract.id });

    // [Issue #659] LEAK pays the leak rate, not the full rate.
    expect(next.teams.teamA?.score).toBe(contract.leakPoints);
    expect(contract.leakPoints).toBeLessThan(contract.points);
    expect(next.publicLedger).toHaveLength(
      contract.task.kind === "reveal-share" ? contract.task.shareIndices.length : 0,
    );
    const posted = next.publicLedger[0];
    if (!posted) throw new Error("expected a posted artifact");
    // `next.publicLedger` holds the compact persisted form (`StoredArtifact`,
    // see ledger-codec.ts): `k`/`tm`/`g`/`i`/`v` below are that form's own
    // field names.
    if (posted.k !== "share") throw new Error("expected a share artifact");
    expect(posted.tm).toBe("teamA");
    expect(posted.g).toBe(1);
    const teamShare = state.teams.teamA?.shares.find((s) => s.index === posted.i);
    if (!teamShare) throw new Error("expected a matching share on the team");
    expect(posted.v).toBe(teamShare.value);
  });

  test("the same contract cannot be leaked twice", () => {
    const { state, order: contract } = orderMatching(allowsLeak);
    const op: CryptoBattleOp = { kind: "leak", contractId: contract.id };
    const next = applyOp(state, "teamA", op);
    expect(validateOp(next, "teamA", op).ok).toBe(false);
  });
});

describe("hunt", () => {
  test("recovering the actual secret succeeds and moves both scores", () => {
    let state = tick(startedMatch(CTX), 0);
    state = leakThreshold(state, "teamB");
    const leaked = decodeLedger(state.publicLedger).filter((a) => a.teamId === "teamB").filter(isShareArtifact);
    const shares = leaked.map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
    const recoveredSecret = reconstruct(shares, BigInt(state.config.prime));
    const teamB = state.teams.teamB;
    if (!teamB) throw new Error("expected teamB");
    expect(recoveredSecret).toBe(BigInt(teamB.secret));

    const op: CryptoBattleOp = {
      kind: "hunt",
      targetTeamId: "teamB",
      generation: 1,
      recoveredSecret: recoveredSecret.toString(),
    };
    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });

    const before = { attacker: state.teams.teamA?.score ?? 0, target: state.teams.teamB?.score ?? 0 };
    const next = applyOp(state, "teamA", op);
    expect(next.teams.teamA?.score).toBe(before.attacker + state.config.scores.huntBonus);
    expect(next.teams.teamB?.score).toBe(Math.max(0, before.target - state.config.scores.huntPenalty));
    expect(next.teams.teamB?.huntedGenerations).toContain(1);
    // huntLog (Issue #486 PR5) is timestamped from the real match clock, not
    // a silent `?? 0` fallback -- see applyHunt's own comment.
    if (state.nowMs === undefined) throw new Error("expected state.nowMs to be set after tick()");
    expect(next.huntLog).toEqual([
      { attackerTeamId: "teamA", targetTeamId: "teamB", generation: 1, atMs: state.nowMs },
    ]);
  });

  test("is rejected before any tick() has run, even with the target's ACTUAL secret as the guess [reachability fix]", () => {
    // Before the first tick(), validateOp's "hunt" branch used to check
    // nothing about state.nowMs at all -- unlike "rotate"'s cooldown guard,
    // nothing else in the hunt branch reads it either, so a hunt supplying
    // the CORRECT secret directly (not reconstructed via Lagrange
    // interpolation from leaked shares, which requires a Contract, which
    // requires a tick()) used to validate and apply before the match clock
    // had ever started. This pins the fix: rejected outright, the same way
    // "rotate" already was.
    const state = initialState(CTX);
    expect(state.nowMs).toBeUndefined();
    const teamB = state.teams.teamB;
    if (!teamB) throw new Error("expected teamB");
    const op: CryptoBattleOp = {
      kind: "hunt",
      targetTeamId: "teamB",
      generation: 1,
      recoveredSecret: teamB.secret,
    };
    const result = validateOp(state, "teamA", op);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not started/);
    }
    // applyOp itself throws loudly (never a silent, untimestamped huntLog
    // entry) if handed this op anyway, without going through validateOp first.
    expect(() => applyOp(state, "teamA", op)).toThrow();
  });

  // [Issue #696] The REVERSE of what this pinned before, and deliberately so.
  // It used to require `validateOp` to refuse a wrong guess, which made a miss
  // cost nothing and leave no trace -- survivable only while the field was
  // 2^61 - 1 and guessing was hopeless. In a field a participant interpolates
  // by hand, a free retry is cheaper than the interpolation, so the miss has to
  // be a move that lands: it is charged, it burns budget, and it is NOT
  // recorded as a successful hunt.
  test("a wrong guess lands, costs the attacker, and spends one attempt", () => {
    const state = tick(startedMatch(CTX), 0);
    const wrong: CryptoBattleOp = { kind: "hunt", targetTeamId: "teamB", generation: 1, recoveredSecret: "0" };
    expect(validateOp(state, "teamA", wrong).ok).toBe(true);

    const scored = { ...state, teams: { ...state.teams, teamA: { ...state.teams.teamA!, score: 40 } } };
    const next = applyOp(scored, "teamA", wrong);
    expect(next.teams.teamA?.score).toBe(40 - DEFAULT_CONFIG.scores.wrongHunt);
    expect(next.successfulHunts).toEqual([]);
    expect(Object.values(next.huntAttempts)).toEqual([1]);
  });

  // [Issue #696] The two knobs that only make sense together. Shrinking the
  // field is what makes an Order hand-solvable; the cap is the entire reason
  // that is still sound. A future change that moves one without the other
  // fails here rather than in a live match.
  test("a hand-sized field is guarded by a cap that makes scanning it cost more than it pays", () => {
    const prime = Number(DEFAULT_CONFIG.prime);
    expect(prime).toBeLessThan(1000);
    expect(DEFAULT_CONFIG.maxHuntAttemptsPerTarget).toBeLessThanOrEqual(DEFAULT_CONFIG.threshold);
    // The budget cannot cover the field, so scanning is not a plan at all...
    expect(DEFAULT_CONFIG.maxHuntAttemptsPerTarget).toBeLessThan(prime);
    // ...and one blind try is a losing trade on its own: its expected payout is
    // `huntBonus / prime`, which has to stay under what the miss costs. This is
    // the inequality that keeps interpolating the shares the cheaper route, and
    // it is the one that breaks first if `prime` is lowered further.
    expect(DEFAULT_CONFIG.scores.huntBonus / prime).toBeLessThan(DEFAULT_CONFIG.scores.wrongHunt);
  });

  // [Issue #696] A miss has to be TELLABLE, not just charged. The plugin SDK
  // answers a landed op with `{ ok: true }` whether it hit or missed, and the
  // projection is a pure function of state -- so unless the state records the
  // outcome, the Portal has nothing to read and calls a -8 a SUCCESS (which
  // is exactly what shipped). These pin the record and the projection of it.
  test("a miss is written to the attacker's row as a miss, and the projection says so", () => {
    const state = tick(startedMatch(CTX), 0);
    const wrong: CryptoBattleOp = { kind: "hunt", targetTeamId: "teamB", generation: 1, recoveredSecret: "0" };
    const next = applyOp(state, "teamA", wrong);
    expect(next.teams.teamA?.lastHunt).toEqual({ targetTeamId: "teamB", generation: 1, outcome: "miss" });

    const view = projectForTeam(next, "teamA");
    expect(view.lastHunt).toEqual({ targetTeamId: "teamB", generation: 1, outcome: "miss" });
    expect(view.huntAttempts.teamB).toEqual({
      generation: 1,
      spent: 1,
      max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget,
    });
    expect(view.wrongHuntCost).toBe(DEFAULT_CONFIG.scores.wrongHunt);
  });

  test("a hit is written as a hit, and it spends an attempt too", () => {
    let state = tick(startedMatch(CTX), 0);
    state = leakThreshold(state, "teamB");
    const shares = decodeLedger(state.publicLedger)
      .filter((a) => a.teamId === "teamB")
      .filter(isShareArtifact)
      .map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
    const recoveredSecret = reconstruct(shares, BigInt(state.config.prime));
    const next = applyOp(state, "teamA", {
      kind: "hunt",
      targetTeamId: "teamB",
      generation: 1,
      recoveredSecret: recoveredSecret.toString(),
    });
    expect(next.teams.teamA?.lastHunt).toEqual({ targetTeamId: "teamB", generation: 1, outcome: "hit" });
    expect(projectForTeam(next, "teamA").lastHunt?.outcome).toBe("hit");
    expect(projectForTeam(next, "teamA").huntAttempts.teamB?.spent).toBe(1);
  });

  test("the budget on the projection is MINE against each OTHER team, never anyone else's", () => {
    const state = tick(startedMatch(CTX), 0);
    const wrong: CryptoBattleOp = { kind: "hunt", targetTeamId: "teamB", generation: 1, recoveredSecret: "0" };
    const next = applyOp(state, "teamA", wrong);

    // teamA sees its own spend against teamB, and no row for itself.
    const attacker = projectForTeam(next, "teamA");
    expect(Object.keys(attacker.huntAttempts)).toEqual(["teamB"]);

    // teamB sees a full budget against teamA -- it has not hunted -- and
    // nothing about what teamA has tried against it: no lastHunt, and its own
    // row absent from its own view.
    const target = projectForTeam(next, "teamB");
    expect(Object.keys(target.huntAttempts)).toEqual(["teamA"]);
    expect(target.huntAttempts.teamA).toEqual({
      generation: 1,
      spent: 0,
      max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget,
    });
    expect(target.lastHunt).toBeUndefined();
    expect("lastHunt" in target).toBe(false);
  });

  test("the projected budget follows the target's CURRENT generation, so a ROTATE starts it fresh", () => {
    let state = tick(startedMatch(CTX), 0);
    const wrong: CryptoBattleOp = { kind: "hunt", targetTeamId: "teamB", generation: 1, recoveredSecret: "0" };
    state = applyOp(state, "teamA", wrong);
    expect(projectForTeam(state, "teamA").huntAttempts.teamB?.spent).toBe(1);

    state = applyOp(state, "teamB", { kind: "rotate" });
    expect(projectForTeam(state, "teamA").huntAttempts.teamB).toEqual({
      generation: 2,
      spent: 0,
      max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget,
    });
    // The record of the last HUNT is not rewritten by the target's move.
    expect(projectForTeam(state, "teamA").lastHunt).toEqual({ targetTeamId: "teamB", generation: 1, outcome: "miss" });
  });

  test("the attempt budget runs out, so the field cannot be scanned", () => {
    let state: CryptoBattleState = tick(startedMatch(CTX), 0);
    const wrong: CryptoBattleOp = { kind: "hunt", targetTeamId: "teamB", generation: 1, recoveredSecret: "0" };
    for (let i = 0; i < DEFAULT_CONFIG.maxHuntAttemptsPerTarget; i += 1) {
      expect(validateOp(state, "teamA", wrong).ok).toBe(true);
      state = applyOp(state, "teamA", wrong);
    }
    const exhausted = validateOp(state, "teamA", wrong);
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) expect(exhausted.error).toMatch(/no HUNT attempts left/);

    // The budget is per (attacker, target, generation): an untouched pairing is
    // unaffected, so one exhausted target never locks a team out of the match.
    expect(validateOp(state, "teamB", { ...wrong, targetTeamId: "teamA" }).ok).toBe(true);
  });

  test("hunt penalty never drops a team's score below 0", () => {
    let state = tick(startedMatch(CTX), 0);
    state = leakThreshold(state, "teamB");
    const shares = decodeLedger(state.publicLedger)
      .filter((a) => a.teamId === "teamB")
      .filter(isShareArtifact)
      .map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
    const recoveredSecret = reconstruct(shares, BigInt(state.config.prime));
    const next = applyOp(state, "teamA", {
      kind: "hunt",
      targetTeamId: "teamB",
      generation: 1,
      recoveredSecret: recoveredSecret.toString(),
    });
    expect(next.teams.teamB?.score).toBeGreaterThanOrEqual(0);
  });

  test("the replay key is JSON-encoded, not '|'-joined, so a '|' in a team id cannot false-collide", () => {
    // Under the old `${a}|${b}|${gen}` key, huntKey("a|b", "c", 1) and
    // huntKey("a", "b|c", 1) both stringify to the same "a|b|c|1" -- two
    // unrelated (attacker, target, generation) triples colliding on one
    // replay-guard entry. JSON.stringify([a, b, gen]) keeps each element
    // quoted/escaped independently, so they cannot collide.
    const ctx = { eventId: "pipe-collision", teamIds: ["a|b", "c", "a", "b|c"] };
    let state = tick(startedMatch(ctx), 0);
    state = leakThreshold(state, "c");
    const shares = decodeLedger(state.publicLedger)
      .filter((a) => a.teamId === "c")
      .filter(isShareArtifact)
      .map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
    const recoveredSecret = reconstruct(shares, BigInt(state.config.prime));

    // "a|b" successfully hunts "c" generation 1 -- this records a replay-guard
    // entry that, under the old scheme, would stringify identically to
    // ("a", "b|c", 1) below.
    state = applyOp(state, "a|b", {
      kind: "hunt",
      targetTeamId: "c",
      generation: 1,
      recoveredSecret: recoveredSecret.toString(),
    });

    // "a" now attempts to hunt the UNRELATED team "b|c" with a deliberately
    // wrong guess. If the keys falsely collided, this would be rejected as
    // "already hunted" (the bug); with the fix it is rejected for the
    // correct, unrelated reason -- the secret does not match.
    const result = validateOp(state, "a", {
      kind: "hunt",
      targetTeamId: "b|c",
      generation: 1,
      recoveredSecret: "0",
    });
    // [Issue #696] A wrong secret is no longer refused here -- it is a move
    // that lands and is charged. What this test is actually about is the key,
    // so the assertion is the one that still speaks to a collision: the
    // unrelated pairing is NOT turned away as "already hunted".
    expect(result.ok).toBe(true);
  });
});

describe("rotate", () => {
  test("advances generation and rederives secret/shares", () => {
    const state = tick(startedMatch(CTX), 0);
    const before = state.teams.teamA;
    if (!before) throw new Error("expected teamA");
    const next = applyOp(state, "teamA", { kind: "rotate" });
    const after = next.teams.teamA;
    if (!after) throw new Error("expected teamA");
    expect(after.generation).toBe(before.generation + 1);
    expect(after.secret).not.toBe(before.secret);
    expect(after.lastRotateAtMs).toBe(0);
  });

  test("is rejected while on cooldown, accepted again after it elapses", () => {
    let state = tick(startedMatch(CTX), 0);
    state = applyOp(state, "teamA", { kind: "rotate" });
    state = tick(state, state.config.rotateCooldownMs - 1);
    expect(validateOp(state, "teamA", { kind: "rotate" }).ok).toBe(false);

    state = tick(state, state.config.rotateCooldownMs);
    expect(validateOp(state, "teamA", { kind: "rotate" })).toEqual({ ok: true });
  });

  test("is rejected before any tick() has run -- on the very first attempt, not just a second one", () => {
    // Before the first tick(), state.nowMs and every team's lastRotateAtMs
    // are both undefined. That used to make the cooldown check vacuously
    // pass (nothing to compare against), letting a team ROTATE repeatedly
    // before the match clock ever advances.
    const state = initialState(CTX);
    expect(state.nowMs).toBeUndefined();
    const first = validateOp(state, "teamA", { kind: "rotate" });
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error).toMatch(/not started/);
    }
    // A second attempt (still no tick()) is rejected for the same reason,
    // not because a first rotate silently "succeeded" and started a cooldown.
    expect(validateOp(state, "teamA", { kind: "rotate" }).ok).toBe(false);
  });
});

describe("rotate expires this team's own open contracts", () => {
  test("marks every pre-rotate OPEN contract addressed to this team as expired; other teams' contracts are untouched", () => {
    const state = tick(startedMatch(CTX), 0);
    const ownOpen = state.contracts.find((c) => c.teamId === "teamA" && c.status === "open");
    const otherOpen = state.contracts.find((c) => c.teamId === "teamB" && c.status === "open");
    if (!ownOpen || !otherOpen) throw new Error("expected an open contract for each team");

    const next = applyOp(state, "teamA", { kind: "rotate" });

    expect(next.contracts.find((c) => c.id === ownOpen.id)?.status).toBe("expired");
    expect(next.contracts.find((c) => c.id === otherOpen.id)?.status).toBe("open");
  });

  test("a pre-rotate contract can no longer be leaked after rotating (it would publish a new-generation share for free)", () => {
    let state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA" && c.status === "open");
    if (!contract) throw new Error("expected an open contract for teamA");

    state = applyOp(state, "teamA", { kind: "rotate" });

    expect(validateOp(state, "teamA", { kind: "leak", contractId: contract.id }).ok).toBe(false);
  });
});

describe("rush contracts", () => {
  test("expire sooner than standard contracts (rushContractTtlMs < contractTtlMs)", () => {
    let state = tick(startedMatch(CTX), 0);
    for (let guard = 0; guard < 500 && !state.contracts.some((c) => c.kind === "rush"); guard += 1) {
      state = tick(state, (state.nowMs ?? 0) + state.config.contractIntervalMs);
    }
    const rush = state.contracts.find((c) => c.kind === "rush");
    const standard = state.contracts.find((c) => c.kind === "standard");
    if (!rush || !standard) {
      throw new Error("expected both a rush and a standard contract to have been issued");
    }

    expect(rush.expiresAtMs - rush.issuedAtMs).toBe(state.config.rushContractTtlMs);
    expect(standard.expiresAtMs - standard.issuedAtMs).toBe(state.config.contractTtlMs);
    expect(rush.expiresAtMs - rush.issuedAtMs).toBeLessThan(standard.expiresAtMs - standard.issuedAtMs);
  });
});

describe("match end", () => {
  test("rejects leak / hunt / rotate once the match has ended, even for a contract that is still open by its own TTL", () => {
    let state = tick(startedMatch(CTX), 0);
    state = tick(state, DEFAULT_CONFIG.matchDurationMs);
    expect(state.phase).toBe("ended");

    // Inject a contract that is still "open" by its own TTL (issued exactly
    // at match end) so this isolates the match-end guard from the
    // pre-existing per-contract TTL expiry -- every REAL contract would
    // already be expired by its own deadline long before matchDurationMs,
    // which would make the assertion below pass for the wrong reason.
    const stillOpenContract = {
      id: "synthetic-still-open",
      teamId: "teamA",
      kind: "standard" as const,
      points: state.config.scores.contract,
          leakPoints: state.config.scores.contractLeak,
      task: { kind: "reveal-share" as const, shareIndices: [1] },
      issuedAtMs: state.nowMs ?? 0,
      expiresAtMs: (state.nowMs ?? 0) + state.config.contractTtlMs,
      status: "open" as const,
      privacyConstraint: "none" as const,
      allowedMethods: ["leak", "prove"] as const,
    };
    state = { ...state, contracts: [...state.contracts, stillOpenContract] };

    expect(validateOp(state, "teamA", { kind: "leak", contractId: stillOpenContract.id }).ok).toBe(false);
    expect(
      validateOp(state, "teamA", { kind: "hunt", targetTeamId: "teamB", generation: 1, recoveredSecret: "0" })
        .ok,
    ).toBe(false);
    expect(validateOp(state, "teamA", { kind: "rotate" }).ok).toBe(false);
  });
});

describe("projectForTeam", () => {
  test("includes the team's own vault with plain-string bigints", () => {
    const state = tick(startedMatch(CTX), 0);
    const projection = projectForTeam(state, "teamA");
    const teamA = state.teams.teamA;
    if (!teamA) throw new Error("expected teamA");
    expect(projection.vault.teamId).toBe("teamA");
    expect(projection.vault.secret).toBe(teamA.secret);
    expect(projection.vault.shares).toHaveLength(state.config.shareCount);
  });

  test("summarizes every team's public score/generation, including the caller's own", () => {
    const state = tick(startedMatch(CTX), 0);
    const projection = projectForTeam(state, "teamA");
    expect(Object.keys(projection.teams).sort()).toEqual(["teamA", "teamB"]);
  });

  test("throws for an unknown team id", () => {
    const state = tick(startedMatch(CTX), 0);
    expect(() => projectForTeam(state, "teamZ")).toThrow();
  });
});
