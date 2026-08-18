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
import { RFC3526_GROUP14, groupPow } from "./group.ts";
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

describe("identity-element (unit) forgery is rejected [independent review, medium #1]", () => {
  test("a forged proof against Y=1 (the group identity) is rejected, even though g^z == R * 1^e trivially holds for ANY z once Y=1", () => {
    // This is the review's PoC shape: pick literally any response z, then
    // set the commitment R = g^z so the verification equation
    // g^z == R * Y^e == R * 1^e == R holds unconditionally, independent of
    // the challenge e or the "witness" behind Y. Without an explicit
    // identity rejection this is a complete forgery -- no witness for Y=1
    // needs to exist, or be known, at all.
    const teamId = "teamA";
    const contractId = "teamA-c0";
    const generation = 1;
    const forgedY = 1n;
    const z = 123456789012345678901234567890n;
    const forgedCommitment = groupPow(G.generator, z, G);
    const forgedProof = { commitment: forgedCommitment.toString(), response: z.toString() };

    // Sanity on the forgery itself, using the SAME challenge computation
    // verifyProof uses internally (not an approximation): this proves the
    // equation genuinely holds for Y=1 regardless of what `e` comes out to,
    // so a regression that removed the `<= 1n` guard would make
    // verifyProof's own arithmetic accept this forgery -- the assertion
    // below is what actually rejects it, not luck in picking z.
    const e = computeChallenge(
      { teamId, contractId, generation, commitmentR: forgedCommitment, publicY: forgedY },
      G,
    );
    const left = groupPow(G.generator, z, G);
    const right = (forgedCommitment * groupPow(forgedY, e, G)) % G.p;
    expect(left).toBe(right);

    expect(verifyProof(forgedY, forgedProof, { teamId, contractId, generation }, G)).toBe(false);
  });

  test("Y=0 is also rejected (never a valid group element)", () => {
    const forgedProof = { commitment: "2", response: "0" };
    expect(verifyProof(0n, forgedProof, { teamId: "teamA", contractId: "teamA-c0", generation: 1 }, G)).toBe(
      false,
    );
  });

  test("a proof whose commitment R is the group identity (1) is rejected, for consistency with the Y check", () => {
    const secret = 4242n;
    const generation = 1;
    const teamId = "teamA";
    const contractId = "teamA-c0";
    const y = derivePublicCommitment(secret, generation, teamId, G);
    const tampered = { commitment: "1", response: "0" };
    expect(verifyProof(y, tampered, { teamId, contractId, generation }, G)).toBe(false);
  });
});

describe("input format/size validation before BigInt parsing [independent review, medium #2]", () => {
  const secret = 4242n;
  const generation = 1;
  const teamId = "teamA";
  const contractId = "teamA-c0";
  const y = derivePublicCommitment(secret, generation, teamId, G);
  const statement = { teamId, contractId, generation };
  const validProof = createProof(secret, generation, teamId, contractId, G);

  test('a "0x10" hex-literal-style string is rejected, never parsed as hex', () => {
    const tampered = { ...validProof, response: "0x10" };
    expect(verifyProof(y, tampered, statement, G)).toBe(false);
  });

  test("a decimal string far longer than this group could ever need (300,000 digits) is rejected fast, without a slow BigInt() parse", () => {
    // BigInt() parsing is superlinear in input length: on this machine (Bun
    // / JavaScriptCore) a 300,000-digit string measures ~565ms to parse
    // directly, vs sub-millisecond for the regex format/length check to
    // reject it outright. (300,000 rather than a much larger figure like
    // 5,000,000: JavaScriptCore enforces its own hard BigInt size cap well
    // under 400,000 decimal digits and simply throws past it, which a
    // pre-regex `try { BigInt(...) } catch` would ALSO reject quickly --
    // that would make this assertion pass whether or not the fix is
    // present, defeating the point of a regression test. 300,000 digits
    // stays under that cap, so the slow, uncapped parse path is the only
    // thing standing between "guarded" and "unguarded" here.)
    const hugeDigits = "1".repeat(300_000);
    const tampered = { ...validProof, response: hugeDigits };
    const startMs = performance.now();
    const result = verifyProof(y, tampered, statement, G);
    const elapsedMs = performance.now() - startMs;
    expect(result).toBe(false);
    expect(elapsedMs).toBeLessThan(100);
  });

  test("a leading '+' sign is rejected", () => {
    const tampered = { ...validProof, response: `+${validProof.response}` };
    expect(verifyProof(y, tampered, statement, G)).toBe(false);
  });

  test("embedded/trailing whitespace is rejected", () => {
    const tampered = { ...validProof, response: `${validProof.response} ` };
    expect(verifyProof(y, tampered, statement, G)).toBe(false);
  });

  test("a leading '-' sign is rejected (no negative field is ever valid)", () => {
    const tampered = { ...validProof, commitment: `-${validProof.commitment}` };
    expect(verifyProof(y, tampered, statement, G)).toBe(false);
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

/**
 * Strips `/* ... *\/` block comments (including doc comments) and `// ...`
 * line comments from `source`. Run BEFORE any import/re-export extraction
 * below -- without this, a doc comment's own prose (this file's trust-
 * boundary comments legitimately say "import", "secret", "deriveWitness",
 * etc.) could be mistaken for real import syntax by a regex scanning raw
 * source text, either as a false positive (a forbidden word appears in
 * prose) or, worse, by letting a non-greedy `[\s\S]*?from` match start
 * inside a comment and skip past -- or swallow -- a real statement while
 * hunting for its own "from" clause.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Extracts every `import ... from "..."` and `export ... from "..."`
 * statement's full text and module specifier from `source` (after
 * `stripComments`). Matches across newlines (`[\s\S]*?`, non-greedy) so a
 * statement wrapped across multiple lines --
 * `import {\n  x,\n} from "./y.ts";` -- is still found as ONE statement;
 * the previous version of this check only matched `import` at the start of
 * a single physical line, so a wrapped import's `from "..."` clause (on a
 * later line) never got inspected at all. `export ... from "..."`
 * re-exports are included on purpose: a re-export can leak a forbidden
 * specifier or binding just as effectively as a direct import.
 */
function extractImportAndReexportStatements(source: string): readonly { text: string; specifier: string }[] {
  const withoutComments = stripComments(source);
  const pattern = /\b(?:import|export)\b[\s\S]*?from\s*["']([^"']+)["']/g;
  const statements: { text: string; specifier: string }[] = [];
  for (let match = pattern.exec(withoutComments); match !== null; match = pattern.exec(withoutComments)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      statements.push({ text: match[0], specifier });
    }
  }
  return statements;
}

describe("module separation: schnorr-verifier.ts never imports secret-side material", () => {
  test("no import/re-export statement in schnorr-verifier.ts references schnorr-witness.ts, schnorr-prover.ts, deriveWitness, derivePublicCommitment, or a `secret` symbol", () => {
    const source = readFileSync(new URL("./schnorr-verifier.ts", import.meta.url), "utf8");
    const statements = extractImportAndReexportStatements(source);
    expect(statements.length).toBeGreaterThan(0); // sanity: the file does import *something* (group.ts, field.ts, ...)

    for (const { text, specifier } of statements) {
      expect(specifier).not.toMatch(/schnorr-witness/);
      expect(specifier).not.toMatch(/schnorr-prover/);
      expect(text).not.toMatch(/\bderiveWitness\b/);
      expect(text).not.toMatch(/\bderivePublicCommitment\b/);
      // A bare `secret` import binding (as opposed to the English word
      // appearing in prose elsewhere in the file, which is fine and
      // expected in this module's trust-boundary doc comments -- and which
      // `stripComments` above has already removed from `source` anyway).
      expect(text).not.toMatch(/\bsecret\b/);
    }
  });

  test("the extraction helper catches a multi-line import and a re-export, not just a same-line import", () => {
    const wrappedImport = 'import {\n  deriveWitness,\n  derivePublicCommitment,\n} from "./schnorr-witness.ts";\n';
    const reexport = 'export { deriveWitness } from "./schnorr-witness.ts";\n';
    for (const snippet of [wrappedImport, reexport]) {
      const statements = extractImportAndReexportStatements(snippet);
      expect(statements).toHaveLength(1);
      const [stmt] = statements;
      if (!stmt) throw new Error("expected exactly one statement");
      expect(stmt.specifier).toBe("./schnorr-witness.ts");
      expect(stmt.text).toMatch(/deriveWitness/);
    }
  });

  test("the extraction helper ignores import/export/from/secret mentioned only in comments", () => {
    const commented =
      "/**\n * MUST NEVER import a team's secret from schnorr-witness.ts (deriveWitness).\n */\nimport { mul } from \"./field.ts\";\n";
    const statements = extractImportAndReexportStatements(commented);
    expect(statements).toHaveLength(1);
    const [stmt] = statements;
    if (!stmt) throw new Error("expected exactly one statement");
    expect(stmt.specifier).toBe("./field.ts");
  });
});
