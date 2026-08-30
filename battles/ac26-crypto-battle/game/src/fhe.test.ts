/**
 * [Issue #645 Phase 2] The FHE slice, from the cipher up to the judge.
 *
 * The claims worth testing here are not "the code runs". They are the two
 * properties the Order depends on — the scheme is genuinely additively
 * homomorphic, and a ciphertext genuinely tells a reader nothing — plus the
 * trust boundary: a participant is handed ciphertexts and never a plaintext or
 * a key, and self-reporting earns nothing.
 */

import { describe, expect, test } from "bun:test";
import {
  addCiphertexts,
  decrypt,
  deriveFheKey,
  deriveFheOrderInputs,
  deriveFhePlaintexts,
  encrypt,
  expectedFheSum,
} from "./fhe.ts";
import { add, inv, mod, mul, P, sub } from "./field.ts";
import { buildFheOp } from "./playtest.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { ContractProjection, CryptoBattleState } from "./types.ts";

const CTX = { eventId: "fhe-tests", teamIds: ["teamA", "teamB"] } as const;
const SEED = "fhe-tests";
const ORDER = "teamA-c1";

/** Advance until `teamId` has an open Order of the given task kind. */
function orderWithTask(
  taskKind: "homomorphic-sum" | "masked-total",
  teamId = "teamA",
): { state: CryptoBattleState; order: ContractProjection } {
  let state = tick(initialState(CTX), 0);
  for (let issued = 0; issued < 20; issued += 1) {
    const order = projectForTeam(state, teamId).myContracts.find(
      (c) => c.status === "open" && c.task.kind === taskKind,
    );
    if (order) return { state, order };
    state = tick(state, (issued + 1) * DEFAULT_CONFIG.contractIntervalMs);
  }
  throw new Error(`no open ${taskKind} order for ${teamId} within 20 issuance rounds`);
}

describe("the cipher", () => {
  test("decrypts what it encrypted", () => {
    const key = deriveFheKey(SEED, ORDER, P);
    for (const plaintext of [0n, 1n, 12_345n, P - 1n]) {
      expect(decrypt(encrypt(plaintext, key, 7n, P), key, P)).toBe(mod(plaintext, P));
    }
  });

  /**
   * The property the whole Order rests on: adding two ciphertexts gives an
   * encryption of the sum of the plaintexts. Asserted over several pairs rather
   * than one, so a scheme that happened to work for a single convenient input
   * would not pass.
   */
  test("adding two ciphertexts encrypts the sum of their plaintexts", () => {
    const key = deriveFheKey(SEED, ORDER, P);
    const pairs: readonly (readonly [bigint, bigint])[] = [
      [3n, 4n],
      [0n, 99n],
      [P - 1n, 5n],
      [123_456_789n, 987_654_321n],
    ];
    for (const [a, b] of pairs) {
      const sum = addCiphertexts(encrypt(a, key, 11n, P), encrypt(b, key, 29n, P), P);
      expect(decrypt(sum, key, P)).toBe(add(a, b, P));
    }
  });

  /**
   * Executes the hiding argument rather than asserting it in prose: for ANY
   * candidate plaintext there is a key that makes the same ciphertext decrypt
   * to it. So the ciphertext carries no information about the real plaintext —
   * information-theoretically, not under an assumption.
   */
  test("a ciphertext is consistent with every possible plaintext", () => {
    const key = deriveFheKey(SEED, ORDER, P);
    const real = 42n;
    const r = 17n;
    const ciphertext = encrypt(real, key, r, P);

    for (const candidate of [0n, 1n, 999n, P - 7n]) {
      // k' = (y - m') / r  — exists for every m' because p is prime and r != 0.
      const candidateKey = mul(sub(ciphertext.y, candidate, P), inv(r, P), P);
      expect(decrypt(ciphertext, candidateKey, P)).toBe(mod(candidate, P));
    }
  });

  test("each Order gets its own key, so nothing learned about one unlocks another", () => {
    expect(deriveFheKey(SEED, "teamA-c1", P)).not.toBe(deriveFheKey(SEED, "teamA-c5", P));
    expect(deriveFheKey(SEED, "teamA-c1", P)).not.toBe(deriveFheKey("other-seed", "teamA-c1", P));
  });

  test("the key and the randomness are never zero", () => {
    // A zero key publishes the plaintext; zero randomness does the same. Both
    // are excluded at the source rather than left as a one-in-2^61 hole.
    for (let i = 0; i < 50; i += 1) {
      const key = deriveFheKey(SEED, `order-${i}`, P);
      expect(key).not.toBe(0n);
      for (const input of deriveFheOrderInputs(SEED, `order-${i}`, P)) {
        expect(input.r).not.toBe(0n);
      }
    }
  });
});

describe("the FHE Order's trust boundary", () => {
  test("the Order's public payload contains no plaintext and no key", () => {
    const { order } = orderWithTask("homomorphic-sum");
    if (order.task.kind !== "homomorphic-sum") throw new Error("unreachable");

    const published = JSON.stringify(order);
    const key = deriveFheKey(SEED, order.id, BigInt(DEFAULT_CONFIG.prime));
    // The Order is derived from the live state's seed, not SEED — so rather
    // than compare against constants, assert on the values that Order's own
    // derivation produces.
    const state = tick(initialState(CTX), 0);
    const liveKey = deriveFheKey(state.seed, order.id, BigInt(state.config.prime));
    const livePlaintexts = deriveFhePlaintexts(state.seed, order.id, BigInt(state.config.prime));

    expect(published).not.toContain(liveKey.toString());
    for (const plaintext of livePlaintexts) {
      expect(published).not.toContain(plaintext.toString());
    }
    expect(key).toBeGreaterThan(0n);
  });

  test("a correct homomorphic addition is accepted and scores the Order's points", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    const op = buildFheOp(order, state.config.prime);
    if (!op) throw new Error("expected buildFheOp to construct an op");

    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
    const next = applyOp(state, "teamA", op);
    expect(next.teams.teamA?.score).toBe(order.points);
    expect(next.contracts.find((c) => c.id === order.id)?.resolution).toBe("fhe");
  });

  test("the accepted ciphertext lands on the Public Ledger and carries no plaintext", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    const op = buildFheOp(order, state.config.prime);
    if (!op) throw new Error("expected buildFheOp to construct an op");
    const next = applyOp(state, "teamA", op);

    const entry = next.publicLedger.find((a) => a.kind === "ciphertext");
    expect(entry).toBeDefined();
    expect(entry?.method).toBe("fhe");

    const prime = BigInt(next.config.prime);
    const plaintexts = deriveFhePlaintexts(next.seed, order.id, prime);
    const serialized = JSON.stringify(next.publicLedger);
    for (const plaintext of plaintexts) {
      expect(serialized).not.toContain(plaintext.toString());
    }
    expect(serialized).not.toContain(expectedFheSum(next.seed, order.id, prime).toString());
  });

  /**
   * #645's judge rule: self-report earns nothing. A submission that is not the
   * encryption of the requested sum is refused even though it is a perfectly
   * well-formed ciphertext.
   */
  test("a wrong ciphertext is refused", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    if (order.task.kind !== "homomorphic-sum") throw new Error("unreachable");
    const first = order.task.inputs[0];
    if (!first) throw new Error("expected an input ciphertext");

    // One input alone decrypts to one plaintext, not the sum.
    const verdict = validateOp(state, "teamA", {
      kind: "fhe",
      contractId: order.id,
      ciphertext: first,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("does not decrypt to the requested sum");
  });

  test("a malformed ciphertext is rejected, not thrown on", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    // `parseCanonicalDecimal` is digits-only and length-bounded; it permits
    // leading zeros deliberately (the accepted value is re-serialized through
    // BigInt before it reaches the ledger), so "007" belongs in the accepted
    // test below, not here.
    for (const ciphertext of [
      { r: "1", y: "not-a-number" },
      { r: "-1", y: "1" },
      { r: "1", y: " 1" },
      { r: "1".repeat(701), y: "1" },
    ]) {
      const verdict = validateOp(state, "teamA", { kind: "fhe", contractId: order.id, ciphertext });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) throw new Error("unreachable");
      expect(verdict.error).toContain("canonical");
    }
  });

  test("a correct answer written with leading zeros is still accepted", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    const op = buildFheOp(order, state.config.prime);
    if (!op || op.kind !== "fhe") throw new Error("expected buildFheOp to construct an op");

    const padded = {
      kind: "fhe" as const,
      contractId: op.contractId,
      ciphertext: { r: `00${op.ciphertext.r}`, y: `00${op.ciphertext.y}` },
    };
    expect(validateOp(state, "teamA", padded)).toEqual({ ok: true });

    // And the ledger still records the canonical form, never the padding.
    const entry = applyOp(state, "teamA", padded).publicLedger.find((a) => a.kind === "ciphertext");
    expect(entry?.kind === "ciphertext" ? entry.r : "").toBe(op.ciphertext.r);
  });

  test("FHE cannot be used on a share Order, and LEAK cannot be used on an FHE Order", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    const leakVerdict = validateOp(state, "teamA", { kind: "leak", contractId: order.id });
    expect(leakVerdict.ok).toBe(false);

    const shareOrder = state.contracts.find(
      (c) => c.teamId === "teamA" && c.status === "open" && c.task.kind === "reveal-share",
    );
    if (!shareOrder) throw new Error("expected an open share order");
    const fheVerdict = validateOp(state, "teamA", {
      kind: "fhe",
      contractId: shareOrder.id,
      ciphertext: { r: "1", y: "1" },
    });
    expect(fheVerdict.ok).toBe(false);
  });

  test("another team's FHE Order is refused even with a correct answer", () => {
    const { state, order } = orderWithTask("homomorphic-sum", "teamB");
    const op = buildFheOp(order, state.config.prime);
    if (!op) throw new Error("expected buildFheOp to construct an op");

    const verdict = validateOp(state, "teamA", op);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("belongs to another team");
  });

  test("an expired FHE Order scores nothing", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    const op = buildFheOp(order, state.config.prime);
    if (!op) throw new Error("expected buildFheOp to construct an op");
    const contract = state.contracts.find((c) => c.id === order.id);
    if (!contract) throw new Error("expected the contract in state");

    const afterDeadline = tick(state, contract.expiresAtMs + 1);
    const verdict = validateOp(afterDeadline, "teamA", op);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("expired");
  });
});
