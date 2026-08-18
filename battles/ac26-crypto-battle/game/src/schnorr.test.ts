/**
 * Unit tests for PROVE's Fiat-Shamir Schnorr scheme (Issue #486 PR2):
 * group.ts, schnorr-witness.ts, schnorr-transcript.ts, schnorr-prover.ts,
 * and schnorr-verifier.ts. Reducer-level PROVE-op integration (validateOp /
 * applyOp / replay / scoring parity) lives in prove.test.ts, following this
 * package's existing split between per-module unit tests (field.test.ts,
 * shamir.test.ts, prng.test.ts, fixtures.test.ts) and the game-level
 * adversarial contract (adversarial.test.ts).
 *
 * Every 2048-bit modular exponentiation here costs low-double-digit
 * milliseconds (measured on this machine: ~13ms for a full createProof, and
 * again for a verifyProof). This file keeps its total proof-op count in the
 * low tens for that reason, deliberately reusing the smallest fixed set of
 * (secret, generation, teamId, contractId) combinations across assertions
 * rather than sweeping large ranges the way field.test.ts / shamir.test.ts
 * do over their much cheaper small-prime-field arithmetic.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { RFC3526_GROUP14 } from "./group.ts";
import { deriveWitness, derivePublicCommitment } from "./schnorr-witness.ts";
import { challengePreimage, computeChallenge, type ChallengeInput } from "./schnorr-transcript.ts";
import { createProof } from "./schnorr-prover.ts";
import { verifyProof } from "./schnorr-verifier.ts";

const G = RFC3526_GROUP14;

describe("RFC3526_GROUP14", () => {
  test("p = 2*order + 1 (order is the safe prime's large cofactor)", () => {
    expect(G.p).toBe(2n * G.order + 1n);
  });

  test("the generator g=4 has order exactly `order` in the group (4^order mod p === 1, 4 !== 1)", () => {
    function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
      let result = 1n;
      let b = base % mod;
      let e = exp;
      while (e > 0n) {
        if (e & 1n) result = (result * b) % mod;
        b = (b * b) % mod;
        e >>= 1n;
      }
      return result;
    }
    expect(G.generator).not.toBe(1n);
    expect(modPow(G.generator, G.order, G.p)).toBe(1n);
  });
});

describe("deriveWitness / derivePublicCommitment", () => {
  test("deterministic: same (secret, generation, teamId) always derives the same witness", () => {
    const a = deriveWitness(42n, 1, "teamA", G);
    const b = deriveWitness(42n, 1, "teamA", G);
    expect(a).toBe(b);
  });

  test("different generation derives a different witness (overwhelmingly likely)", () => {
    expect(deriveWitness(42n, 1, "teamA", G)).not.toBe(deriveWitness(42n, 2, "teamA", G));
  });

  test("different teamId derives a different witness for the same secret (overwhelmingly likely)", () => {
    expect(deriveWitness(42n, 1, "teamA", G)).not.toBe(deriveWitness(42n, 1, "teamB", G));
  });

  test("the witness is always in the canonical range [0, group.order)", () => {
    const w = deriveWitness(123456789012345n, 3, "teamZ", G);
    expect(w >= 0n && w < G.order).toBe(true);
  });

  test("derivePublicCommitment is g^deriveWitness(...) mod p, landing in [1, p)", () => {
    const secret = 987654321n;
    const w = deriveWitness(secret, 1, "teamA", G);
    const y = derivePublicCommitment(secret, 1, "teamA", G);
    let expected = 1n;
    let base = G.generator % G.p;
    let e = w;
    while (e > 0n) {
      if (e & 1n) expected = (expected * base) % G.p;
      base = (base * base) % G.p;
      e >>= 1n;
    }
    expect(y).toBe(expected);
    expect(y > 0n && y < G.p).toBe(true);
  });
});

describe("createProof / verifyProof round trip", () => {
  test("a proof created for the real secret/generation/team/contract verifies against the matching public commitment", () => {
    const cases: readonly { secret: bigint; generation: number; teamId: string; contractId: string }[] = [
      { secret: 111n, generation: 1, teamId: "teamA", contractId: "teamA-c0" },
      { secret: 222n, generation: 1, teamId: "teamB", contractId: "teamB-c0" },
      { secret: 333n, generation: 4, teamId: "teamA", contractId: "teamA-c7" },
    ];
    for (const c of cases) {
      const proof = createProof(c.secret, c.generation, c.teamId, c.contractId, G);
      const y = derivePublicCommitment(c.secret, c.generation, c.teamId, G);
      expect(
        verifyProof(y, proof, { teamId: c.teamId, contractId: c.contractId, generation: c.generation }, G),
      ).toBe(true);
    }
  });

  test("createProof is deterministic: same inputs always produce the exact same proof (no Date.now()/Math.random())", () => {
    const a = createProof(555n, 2, "teamA", "teamA-c3", G);
    const b = createProof(555n, 2, "teamA", "teamA-c3", G);
    expect(a).toEqual(b);
  });

  test("a proof built from a DIFFERENT team's secret does not verify against this team's public commitment", () => {
    const teamASecret = 111n;
    const teamBSecret = 222n;
    const generation = 1;
    const contractId = "teamA-c0";
    // teamB's proof tool, asked (adversarially, or by a bug) to prove
    // teamA's statement using teamB's own secret -- the witness underneath
    // is for teamB, so it must not check out against teamA's Y.
    const wrongProof = createProof(teamBSecret, generation, "teamA", contractId, G);
    const teamAY = derivePublicCommitment(teamASecret, generation, "teamA", G);
    expect(verifyProof(teamAY, wrongProof, { teamId: "teamA", contractId, generation }, G)).toBe(false);
  });
});

describe("invalid proof is rejected, never thrown", () => {
  const secret = 4242n;
  const generation = 1;
  const teamId = "teamA";
  const contractId = "teamA-c0";
  const y = derivePublicCommitment(secret, generation, teamId, G);
  const statement = { teamId, contractId, generation };
  const validProof = createProof(secret, generation, teamId, contractId, G);

  test("response off by one is rejected", () => {
    const tampered = { ...validProof, response: (BigInt(validProof.response) + 1n).toString() };
    expect(verifyProof(y, tampered, statement, G)).toBe(false);
  });

  test("response off by minus one is rejected", () => {
    const tampered = { ...validProof, response: (BigInt(validProof.response) - 1n).toString() };
    expect(verifyProof(y, tampered, statement, G)).toBe(false);
  });

  test("a tampered commitment is rejected", () => {
    const tampered = { ...validProof, commitment: (BigInt(validProof.commitment) + 1n).toString() };
    expect(verifyProof(y, tampered, statement, G)).toBe(false);
  });

  test("a non-numeric commitment/response is rejected, not thrown", () => {
    expect(() => verifyProof(y, { commitment: "not-a-number", response: validProof.response }, statement, G)).not
      .toThrow();
    expect(verifyProof(y, { commitment: "not-a-number", response: validProof.response }, statement, G)).toBe(false);
    expect(verifyProof(y, { commitment: validProof.commitment, response: "" }, statement, G)).toBe(false);
  });

  test("an out-of-range response (>= group.order) is rejected", () => {
    const tooLarge = { ...validProof, response: (G.order + 5n).toString() };
    expect(verifyProof(y, tooLarge, statement, G)).toBe(false);
  });
});

describe("Fiat-Shamir binding: length-prefixing prevents adjacent-field re-splitting", () => {
  test("(teamId='ab', contractId='cd') and (teamId='a', contractId='bcd') produce different challenges, despite concatenating to identical bytes without a length prefix", () => {
    // The premise this test pins: naive concatenation collides.
    expect(`${"ab"}${"cd"}`).toBe(`${"a"}${"bcd"}`);

    const commitmentR = 999n;
    const publicY = 12345n;
    const generation = 1;
    const inputA: ChallengeInput = { teamId: "ab", contractId: "cd", generation, commitmentR, publicY };
    const inputB: ChallengeInput = { teamId: "a", contractId: "bcd", generation, commitmentR, publicY };

    expect(challengePreimage(inputA, G).equals(challengePreimage(inputB, G))).toBe(false);
    expect(computeChallenge(inputA, G)).not.toBe(computeChallenge(inputB, G));
  });
});

describe("module separation: schnorr-verifier.ts never imports secret-side material", () => {
  test("no import statement in schnorr-verifier.ts references schnorr-witness.ts, schnorr-prover.ts, deriveWitness, or a `secret` symbol", () => {
    const source = readFileSync(new URL("./schnorr-verifier.ts", import.meta.url), "utf8");
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(importLines.length).toBeGreaterThan(0); // sanity: the file does import *something* (group.ts, field.ts, ...)

    for (const line of importLines) {
      expect(line).not.toMatch(/schnorr-witness/);
      expect(line).not.toMatch(/schnorr-prover/);
      expect(line).not.toMatch(/\bderiveWitness\b/);
      expect(line).not.toMatch(/\bderivePublicCommitment\b/);
      // A bare `secret` import binding (as opposed to the English word
      // appearing in prose elsewhere in the file, which is fine and
      // expected in this module's trust-boundary doc comments).
      expect(line).not.toMatch(/\bsecret\b/);
    }
  });
});
