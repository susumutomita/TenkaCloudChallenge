import { describe, expect, test } from "bun:test";
import { deriveContractPlan, deriveTeamGeneration } from "./fixtures.ts";
import { reconstruct } from "./shamir.ts";

const CONFIG = { prime: 2n ** 61n - 1n, threshold: 3, shareCount: 5 } as const;

describe("deriveTeamGeneration", () => {
  test("is deterministic for the same seed/team/generation", () => {
    const a = deriveTeamGeneration("match-1", "teamA", 1, CONFIG);
    const b = deriveTeamGeneration("match-1", "teamA", 1, CONFIG);
    expect(a.secret).toBe(b.secret);
    expect(a.shares).toEqual(b.shares);
  });

  test("produces a valid (threshold, shareCount) Shamir split of its own secret", () => {
    const { secret, shares } = deriveTeamGeneration("match-1", "teamA", 1, CONFIG);
    expect(shares).toHaveLength(CONFIG.shareCount);
    expect(reconstruct(shares.slice(0, CONFIG.threshold), CONFIG.prime)).toBe(secret);
  });

  test("different teams get different secrets under the same seed/generation", () => {
    const a = deriveTeamGeneration("match-1", "teamA", 1, CONFIG);
    const b = deriveTeamGeneration("match-1", "teamB", 1, CONFIG);
    expect(a.secret).not.toBe(b.secret);
  });

  test("different generations for the same team get different secrets", () => {
    const gen1 = deriveTeamGeneration("match-1", "teamA", 1, CONFIG);
    const gen2 = deriveTeamGeneration("match-1", "teamA", 2, CONFIG);
    expect(gen1.secret).not.toBe(gen2.secret);
  });

  test("different match seeds get different secrets for the same team/generation", () => {
    const a = deriveTeamGeneration("match-1", "teamA", 1, CONFIG);
    const b = deriveTeamGeneration("match-2", "teamA", 1, CONFIG);
    expect(a.secret).not.toBe(b.secret);
  });
});

describe("deriveContractPlan", () => {
  test("is deterministic for the same (seed, team, sequenceIndex)", () => {
    const a = deriveContractPlan("match-1", "teamA", 0, CONFIG);
    const b = deriveContractPlan("match-1", "teamA", 0, CONFIG);
    expect(a).toEqual(b);
  });

  test("requested share index is always within [1, shareCount]", () => {
    for (let i = 0; i < 200; i += 1) {
      const plan = deriveContractPlan("match-1", "teamA", i, CONFIG);
      for (const idx of plan.requestedShareIndices) {
        expect(idx).toBeGreaterThanOrEqual(1);
        expect(idx).toBeLessThanOrEqual(CONFIG.shareCount);
      }
    }
  });

  test("both contract kinds appear over a long enough sequence", () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      kinds.add(deriveContractPlan("match-1", "teamA", i, CONFIG).kind);
    }
    expect(kinds.has("standard")).toBe(true);
    expect(kinds.has("rush")).toBe(true);
  });
});
