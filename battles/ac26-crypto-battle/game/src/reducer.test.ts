import { describe, expect, test } from "bun:test";
import { reconstruct } from "./shamir.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleOp } from "./types.ts";

const CTX = { eventId: "match-basic", teamIds: ["teamA", "teamB"] } as const;

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
      const some = team.shares.slice(0, state.config.threshold);
      expect(reconstruct(some, state.config.prime)).toBe(team.secret);
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
    expect(posted.teamId).toBe("teamA");
    expect(posted.generation).toBe(1);
    const teamShare = state.teams.teamA?.shares.find((s) => s.index === posted.shareIndex);
    if (!teamShare) throw new Error("expected a matching share on the team");
    expect(posted.value).toBe(teamShare.value.toString());
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
  /**
   * Leaks exactly `threshold` distinct shares for `teamId`, via synthetic
   * contracts injected straight into `state.contracts` (id-namespaced away
   * from the reducer's own `${teamId}-c${n}` scheme so nothing collides with
   * whatever tick() already issued). This is a test-only shortcut for
   * reaching "team X has leaked >= threshold shares" without stepping through
   * real contract-issuance timing.
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

  test("recovering the actual secret succeeds and moves both scores", () => {
    let state = tick(initialState(CTX), 0);
    state = leakThreshold(state, "teamB");
    const leaked = state.publicLedger.filter((a) => a.teamId === "teamB");
    const shares = leaked.map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
    const recoveredSecret = reconstruct(shares, state.config.prime);
    const teamB = state.teams.teamB;
    if (!teamB) throw new Error("expected teamB");
    expect(recoveredSecret).toBe(teamB.secret);

    const op: CryptoBattleOp = { kind: "hunt", targetTeamId: "teamB", generation: 1, recoveredSecret };
    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });

    const before = { attacker: state.teams.teamA?.score ?? 0, target: state.teams.teamB?.score ?? 0 };
    const next = applyOp(state, "teamA", op);
    expect(next.teams.teamA?.score).toBe(before.attacker + state.config.scores.huntBonus);
    expect(next.teams.teamB?.score).toBe(Math.max(0, before.target - state.config.scores.huntPenalty));
    expect(next.teams.teamB?.huntedGenerations).toContain(1);
  });

  test("a wrong guess is rejected by validateOp and never reaches applyOp", () => {
    const state = tick(initialState(CTX), 0);
    const wrong: CryptoBattleOp = { kind: "hunt", targetTeamId: "teamB", generation: 1, recoveredSecret: 0n };
    const result = validateOp(state, "teamA", wrong);
    expect(result.ok).toBe(false);
  });

  test("hunt penalty never drops a team's score below 0", () => {
    let state = tick(initialState(CTX), 0);
    state = leakThreshold(state, "teamB");
    const shares = state.publicLedger
      .filter((a) => a.teamId === "teamB")
      .map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
    const recoveredSecret = reconstruct(shares, state.config.prime);
    const next = applyOp(state, "teamA", {
      kind: "hunt",
      targetTeamId: "teamB",
      generation: 1,
      recoveredSecret,
    });
    expect(next.teams.teamB?.score).toBeGreaterThanOrEqual(0);
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
});

describe("projectForTeam", () => {
  test("includes the team's own vault with plain-string bigints", () => {
    const state = tick(initialState(CTX), 0);
    const projection = projectForTeam(state, "teamA");
    const teamA = state.teams.teamA;
    if (!teamA) throw new Error("expected teamA");
    expect(projection.vault.teamId).toBe("teamA");
    expect(projection.vault.secret).toBe(teamA.secret.toString());
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
