import { describe, expect, test } from "bun:test";
import { reconstruct } from "./shamir.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleOp, PublicArtifact, ShareArtifact } from "./types.ts";

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
          requestedShareIndices: [shareIndex],
          issuedAtMs: 0,
          expiresAtMs: state.config.contractTtlMs,
          status: "open" as const,
        },
      ],
    };
    state = applyOp(state, teamId, { kind: "leak", contractId });
  }
  return state;
}

describe("initialState", () => {
  test("creates one TeamState per team, score 0, generation 1", () => {
    const state = initialState(CTX);
    expect(Object.keys(state.teams).sort()).toEqual(["teamA", "teamB"]);
    for (const team of Object.values(state.teams)) {
      expect(team.score).toBe(0);
      expect(team.generation).toBe(1);
      expect(team.shares).toHaveLength(state.config.shareCount);
    }
  });

  test("each team's shares actually reconstruct that team's secret", () => {
    const state = initialState(CTX);
    for (const team of Object.values(state.teams)) {
      const some = team.shares
        .slice(0, state.config.threshold)
        .map((s) => ({ index: s.index, value: BigInt(s.value) }));
      expect(reconstruct(some, BigInt(state.config.prime))).toBe(BigInt(team.secret));
    }
  });

  test("config overrides merge onto defaults instead of replacing the whole object", () => {
    const state = initialState(CTX, { threshold: 4 });
    expect(state.config.threshold).toBe(4);
    expect(state.config.shareCount).toBe(DEFAULT_CONFIG.shareCount);
    expect(state.config.scores).toEqual(DEFAULT_CONFIG.scores);
  });

  test("phase starts at build, clock is unset until the first tick", () => {
    const state = initialState(CTX);
    expect(state.phase).toBe("build");
    expect(state.startedAtMs).toBeUndefined();
    expect(state.nowMs).toBeUndefined();
  });
});

describe("tick: phases", () => {
  test("first tick fixes startedAtMs and stays in build", () => {
    const state = tick(initialState(CTX), 1000);
    expect(state.startedAtMs).toBe(1000);
    expect(state.nowMs).toBe(1000);
    expect(state.phase).toBe("build");
  });

  test("crosses build -> pressure -> endgame -> ended as elapsed time grows", () => {
    let state = tick(initialState(CTX), 0);
    const b = DEFAULT_CONFIG.phaseBoundaries;
    expect(tick(state, b.buildToPressureMs - 1).phase).toBe("build");
    expect(tick(state, b.buildToPressureMs).phase).toBe("pressure");
    expect(tick(state, b.pressureToEndgameMs).phase).toBe("endgame");
    expect(tick(state, DEFAULT_CONFIG.matchDurationMs).phase).toBe("ended");
  });
});

describe("tick: contract issuance and expiry", () => {
  test("issues one open contract per team at match start", () => {
    const state = tick(initialState(CTX), 0);
    const open = state.contracts.filter((c) => c.status === "open");
    expect(open).toHaveLength(2);
    expect(new Set(open.map((c) => c.teamId))).toEqual(new Set(["teamA", "teamB"]));
  });

  test("issues another batch once contractIntervalMs elapses", () => {
    let state = tick(initialState(CTX), 0);
    state = tick(state, DEFAULT_CONFIG.contractIntervalMs);
    expect(state.contracts).toHaveLength(4);
  });

  test("a tick that jumps far ahead catches up on every missed batch, bounded by match end", () => {
    const state = tick(initialState(CTX), DEFAULT_CONFIG.matchDurationMs * 10);
    // No batch is issued at/after matchEndAtMs, so the count is finite and bounded.
    const perTeam = state.contracts.filter((c) => c.teamId === "teamA").length;
    expect(perTeam).toBeGreaterThan(0);
    expect(perTeam).toBeLessThan(1000);
  });

  test("expires an open contract once its TTL passes, without touching completed ones", () => {
    let state = tick(initialState(CTX), 0);
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

describe("leak", () => {
  test("validateOp accepts an own open contract, rejects everything else", () => {
    const state = tick(initialState(CTX), 0);
    const mine = state.contracts.find((c) => c.teamId === "teamA")?.id as string;
    const theirs = state.contracts.find((c) => c.teamId === "teamB")?.id as string;

    expect(validateOp(state, "teamA", { kind: "leak", contractId: mine })).toEqual({ ok: true });
    expect(validateOp(state, "teamA", { kind: "leak", contractId: theirs }).ok).toBe(false);
    expect(validateOp(state, "teamA", { kind: "leak", contractId: "does-not-exist" }).ok).toBe(false);
  });

  test("applyOp posts the requested share(s) to the public ledger and pays out points", () => {
    const state = tick(initialState(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract");
    const next = applyOp(state, "teamA", { kind: "leak", contractId: contract.id });

    expect(next.teams.teamA?.score).toBe(contract.points);
    expect(next.publicLedger).toHaveLength(contract.requestedShareIndices.length);
    const posted = next.publicLedger[0];
    if (!posted) throw new Error("expected a posted artifact");
    if (posted.kind !== "share") throw new Error("expected a share artifact");
    expect(posted.teamId).toBe("teamA");
    expect(posted.generation).toBe(1);
    const teamShare = state.teams.teamA?.shares.find((s) => s.index === posted.shareIndex);
    if (!teamShare) throw new Error("expected a matching share on the team");
    expect(posted.value).toBe(teamShare.value);
  });

  test("the same contract cannot be leaked twice", () => {
    const state = tick(initialState(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract");
    const op: CryptoBattleOp = { kind: "leak", contractId: contract.id };
    const next = applyOp(state, "teamA", op);
    expect(validateOp(next, "teamA", op).ok).toBe(false);
  });
});

describe("hunt", () => {
  test("recovering the actual secret succeeds and moves both scores", () => {
    let state = tick(initialState(CTX), 0);
    state = leakThreshold(state, "teamB");
    const leaked = state.publicLedger.filter((a) => a.teamId === "teamB").filter(isShareArtifact);
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
  });

  test("a wrong guess is rejected by validateOp and never reaches applyOp", () => {
    const state = tick(initialState(CTX), 0);
    const wrong: CryptoBattleOp = { kind: "hunt", targetTeamId: "teamB", generation: 1, recoveredSecret: "0" };
    const result = validateOp(state, "teamA", wrong);
    expect(result.ok).toBe(false);
  });

  test("hunt penalty never drops a team's score below 0", () => {
    let state = tick(initialState(CTX), 0);
    state = leakThreshold(state, "teamB");
    const shares = state.publicLedger
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
    let state = tick(initialState(ctx), 0);
    state = leakThreshold(state, "c");
    const shares = state.publicLedger
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
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/already hunted/);
      expect(result.error).toMatch(/does not match/);
    }
  });
});

describe("rotate", () => {
  test("advances generation and rederives secret/shares", () => {
    const state = tick(initialState(CTX), 0);
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
    let state = tick(initialState(CTX), 0);
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
    const state = tick(initialState(CTX), 0);
    const ownOpen = state.contracts.find((c) => c.teamId === "teamA" && c.status === "open");
    const otherOpen = state.contracts.find((c) => c.teamId === "teamB" && c.status === "open");
    if (!ownOpen || !otherOpen) throw new Error("expected an open contract for each team");

    const next = applyOp(state, "teamA", { kind: "rotate" });

    expect(next.contracts.find((c) => c.id === ownOpen.id)?.status).toBe("expired");
    expect(next.contracts.find((c) => c.id === otherOpen.id)?.status).toBe("open");
  });

  test("a pre-rotate contract can no longer be leaked after rotating (it would publish a new-generation share for free)", () => {
    let state = tick(initialState(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA" && c.status === "open");
    if (!contract) throw new Error("expected an open contract for teamA");

    state = applyOp(state, "teamA", { kind: "rotate" });

    expect(validateOp(state, "teamA", { kind: "leak", contractId: contract.id }).ok).toBe(false);
  });
});

describe("rush contracts", () => {
  test("expire sooner than standard contracts (rushContractTtlMs < contractTtlMs)", () => {
    let state = tick(initialState(CTX), 0);
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
    let state = tick(initialState(CTX), 0);
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
      requestedShareIndices: [1],
      issuedAtMs: state.nowMs ?? 0,
      expiresAtMs: (state.nowMs ?? 0) + state.config.contractTtlMs,
      status: "open" as const,
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
    const state = tick(initialState(CTX), 0);
    const projection = projectForTeam(state, "teamA");
    const teamA = state.teams.teamA;
    if (!teamA) throw new Error("expected teamA");
    expect(projection.vault.teamId).toBe("teamA");
    expect(projection.vault.secret).toBe(teamA.secret);
    expect(projection.vault.shares).toHaveLength(state.config.shareCount);
  });

  test("summarizes every team's public score/generation, including the caller's own", () => {
    const state = tick(initialState(CTX), 0);
    const projection = projectForTeam(state, "teamA");
    expect(Object.keys(projection.teams).sort()).toEqual(["teamA", "teamB"]);
  });

  test("throws for an unknown team id", () => {
    const state = tick(initialState(CTX), 0);
    expect(() => projectForTeam(state, "teamZ")).toThrow();
  });
});
