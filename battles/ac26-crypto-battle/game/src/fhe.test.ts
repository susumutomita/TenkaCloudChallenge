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
  decryptOrderSum,
  deriveFheInputKeys,
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
    const key = deriveFheKey(SEED, ORDER, 0, P);
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
    // Under the two inputs' COMBINED mask, since each input has its own key.
    const [k1, k2] = [deriveFheKey(SEED, ORDER, 0, P), deriveFheKey(SEED, ORDER, 1, P)];
    const pairs: readonly (readonly [bigint, bigint])[] = [
      [3n, 4n],
      [0n, 99n],
      [P - 1n, 5n],
      [123_456_789n, 987_654_321n],
    ];
    const [r1, r2] = [11n, 29n];
    for (const [a, b] of pairs) {
      const sum = addCiphertexts(encrypt(a, k1, r1, P), encrypt(b, k2, r2, P), P);
      const maskSum = add(mul(k1, r1, P), mul(k2, r2, P), P);
      expect(sub(sum.y, maskSum, P)).toBe(add(a, b, P));
    }
  });

  /**
   * Executes the hiding argument rather than asserting it in prose: for ANY
   * candidate plaintext there is a key that makes the same ciphertext decrypt
   * to it. So the ciphertext carries no information about the real plaintext —
   * information-theoretically, not under an assumption.
   */
  test("a ciphertext is consistent with every possible plaintext", () => {
    const key = deriveFheKey(SEED, ORDER, 0, P);
    const real = 42n;
    const r = 17n;
    const ciphertext = encrypt(real, key, r, P);

    for (const candidate of [0n, 1n, 999n, P - 7n]) {
      // k' = (y - m') / r  — exists for every m' because p is prime and r != 0.
      const candidateKey = mul(sub(ciphertext.y, candidate, P), inv(r, P), P);
      expect(decrypt(ciphertext, candidateKey, P)).toBe(mod(candidate, P));
    }
  });

  test("each Order gets its own keys, so nothing learned about one unlocks another", () => {
    expect(deriveFheKey(SEED, "teamA-c1", 0, P)).not.toBe(deriveFheKey(SEED, "teamA-c5", 0, P));
    expect(deriveFheKey(SEED, "teamA-c1", 0, P)).not.toBe(
      deriveFheKey("other-seed", "teamA-c1", 0, P),
    );
  });

  test("each INPUT gets its own key", () => {
    // The property the joint-hiding test below depends on. A shared key makes
    // `r2*y1 - r1*y2` a publicly computable function of `(m1, m2)` alone.
    const keys = deriveFheInputKeys(SEED, ORDER, P);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  /**
   * The JOINT hiding statement, and the test whose absence let a wrong claim
   * ship: for any candidate PAIR of plaintexts there is a key pair producing
   * exactly the published ciphertexts. The single-ciphertext test above passes
   * under a shared key too, so it could never have caught the leak.
   */
  test("the published pair is consistent with every possible pair of plaintexts", () => {
    const inputs = deriveFheOrderInputs(SEED, ORDER, P);
    const [c1, c2] = inputs;
    if (!c1 || !c2) throw new Error("expected two inputs");

    for (const [m1, m2] of [
      [0n, 0n],
      [1n, 2n],
      [999n, 4n],
      [P - 5n, 7n],
    ] as const) {
      const k1 = mul(sub(c1.y, m1, P), inv(c1.r, P), P);
      const k2 = mul(sub(c2.y, m2, P), inv(c2.r, P), P);
      expect(decrypt(c1, k1, P)).toBe(mod(m1, P));
      expect(decrypt(c2, k2, P)).toBe(mod(m2, P));
    }
  });

  /**
   * The same claim stated as the attack it defeats. With a shared key the
   * quantity below is a function of `(m1, m2)` only, which pins the pair to a
   * line; with independent keys it also carries `r1*r2*(k1-k2)`, so it pins
   * nothing. Executed against BOTH schemes so the difference is visible rather
   * than asserted.
   */
  test("the shared-key linear relation does not hold for the shipped scheme", () => {
    const plaintexts = deriveFhePlaintexts(SEED, ORDER, P);
    const [m1, m2] = plaintexts;
    if (m1 === undefined || m2 === undefined) throw new Error("expected two plaintexts");
    const [r1, r2] = [11n, 29n];

    // The scheme as it would be with ONE key: the relation holds exactly.
    const shared = deriveFheKey(SEED, ORDER, 0, P);
    const s1 = encrypt(m1, shared, r1, P);
    const s2 = encrypt(m2, shared, r2, P);
    expect(sub(mul(r2, s1.y, P), mul(r1, s2.y, P), P)).toBe(
      sub(mul(r2, m1, P), mul(r1, m2, P), P),
    );

    // The shipped scheme: it does not.
    const [k1, k2] = deriveFheInputKeys(SEED, ORDER, P);
    if (k1 === undefined || k2 === undefined) throw new Error("expected two keys");
    const i1 = encrypt(m1, k1, r1, P);
    const i2 = encrypt(m2, k2, r2, P);
    expect(sub(mul(r2, i1.y, P), mul(r1, i2.y, P), P)).not.toBe(
      sub(mul(r2, m1, P), mul(r1, m2, P), P),
    );
  });

  test("the key and the randomness are never zero", () => {
    // A zero key publishes the plaintext; zero randomness does the same. Both
    // are excluded at the source rather than left as a one-in-2^61 hole.
    for (let i = 0; i < 50; i += 1) {
      for (const key of deriveFheInputKeys(SEED, `order-${i}`, P)) {
        expect(key).not.toBe(0n);
      }
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
    // The Order is derived from the live state's seed, not SEED — so rather
    // than compare against constants, assert on the values that Order's own
    // derivation produces.
    const state = tick(initialState(CTX), 0);
    const prime = BigInt(state.config.prime);
    const liveKeys = deriveFheInputKeys(state.seed, order.id, prime);
    const livePlaintexts = deriveFhePlaintexts(state.seed, order.id, prime);

    for (const key of liveKeys) {
      expect(published).not.toContain(key.toString());
    }
    for (const plaintext of livePlaintexts) {
      expect(published).not.toContain(plaintext.toString());
    }
    expect(decryptOrderSum(
      { r: 0n, y: expectedFheSum(state.seed, order.id, prime) },
      state.seed,
      order.id,
      prime,
    )).not.toBe(expectedFheSum(state.seed, order.id, prime));
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
