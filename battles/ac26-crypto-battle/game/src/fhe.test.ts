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
import { deriveBigInt } from "./prng.ts";
import { buildFheOp, startedMatch } from "./playtest.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { Contract, ContractProjection, CryptoBattleState } from "./types.ts";

/**
 * Is `key` a value `deriveFheKey` can actually produce?
 *
 * The hiding argument does not just need a `k'` to exist algebraically — it
 * needs that `k'` to be a key the derivation could have emitted. Otherwise the
 * candidate plaintext is ruled out and "every candidate is consistent" is
 * false, which is exactly what the zero-exclusion did.
 *
 * The range being the whole field is not asserted here (no sample over F_p
 * could show it); it is pinned by the two tests below — one stating
 * `deriveFheKey` IS the raw derivation with no remapping, the other showing
 * every residue reachable over a small prime through the same code path.
 */
function canBeEmittedAsKey(key: bigint, p: bigint): boolean {
  return key >= 0n && key < p;
}

const CTX = { eventId: "fhe-tests", teamIds: ["teamA", "teamB"] } as const;
const SEED = "fhe-tests";
const ORDER = "teamA-c1";

/** Advance until `teamId` has an open Order of the given task kind. */
function orderWithTask(
  taskKind: "homomorphic-sum" | "masked-total",
  teamId = "teamA",
): { state: CryptoBattleState; order: ContractProjection } {
  let state = tick(startedMatch(CTX), 0);
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

    // `ciphertext.y` is the candidate that needs k' = 0. An earlier version
    // remapped a derived 0 to 1, which ruled that candidate out entirely -- so
    // it is tested by name, not left to a sample that would never hit it.
    for (const candidate of [0n, 1n, 999n, P - 7n, ciphertext.y]) {
      // k' = (y - m') / r  — exists for every m' because p is prime and r != 0.
      const candidateKey = mul(sub(ciphertext.y, candidate, P), inv(r, P), P);
      expect(decrypt(ciphertext, candidateKey, P)).toBe(mod(candidate, P));
      // ...and the argument only holds if that k' is a key the derivation can
      // actually EMIT. Solving for k' without asking this is precisely how the
      // zero-exclusion bias went unnoticed.
      expect(canBeEmittedAsKey(candidateKey, P)).toBe(true);
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

  /**
   * The two zeros are NOT symmetric, and treating them as if they were is what
   * broke the hiding claim.
   *
   * `r` is published, so a reader can see `r = 0` and conclude `y` is the
   * plaintext: excluding it is real protection. `k` is never published, so
   * `k = 0` is unobservable — excluding it protects nothing and costs the
   * property, because it makes one candidate plaintext impossible and another
   * twice as likely.
   */
  test("the randomness is never zero, because it is published", () => {
    for (let i = 0; i < 50; i += 1) {
      for (const input of deriveFheOrderInputs(SEED, `order-${i}`, P)) {
        expect(input.r).not.toBe(0n);
      }
    }
  });

  test("the key is the raw derivation, with no remapping that would bias it", () => {
    // Stated as an identity rather than sampled: over F_p no sample would ever
    // hit the excluded value, which is why the old bias survived a 50-order
    // loop that asserted the opposite of what it should have.
    for (let i = 0; i < 20; i += 1) {
      for (const index of [0, 1]) {
        expect(deriveFheKey(SEED, `order-${i}`, index, P)).toBe(
          deriveBigInt(SEED, `fhe-key:order-${i}`, index, P),
        );
      }
    }
  });

  test("a zero key really is reachable, so the hiding argument is not vacuous", () => {
    // Over F_p a zero key is a ~2^-61 event and no test could observe it. Over
    // a small prime it is common, and the derivation is the same code path.
    const small = 7n;
    const keys = new Set<bigint>();
    for (let i = 0; i < 200; i += 1) keys.add(deriveFheKey(SEED, `small-${i}`, 0, small));
    expect(keys.has(0n)).toBe(true);
    // And every residue is reachable -- no value is missing and none is being
    // stood in for by another.
    expect(keys.size).toBe(Number(small));
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
    const state = tick(startedMatch(CTX), 0);
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

    const entry = next.publicLedger.find((a) => a.k === "ciphertext");
    expect(entry).toBeDefined();
    expect(entry?.m).toBe("fhe");

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

    // One input alone is not the sum. Both of its components are wrong, and
    // the first-component check catches it first -- deliberately, because that
    // half is public (both inputs are on the Order card), so saying so reveals
    // nothing the participant could not already verify themselves.
    const single = validateOp(state, "teamA", {
      kind: "fhe",
      contractId: order.id,
      ciphertext: first,
    });
    expect(single.ok).toBe(false);

    // With the first component RIGHT, the decrypt-and-compare is what rejects
    // a wrong plaintext -- exercising that path on its own rather than relying
    // on a submission that happens to be wrong in both halves.
    const op = buildFheOp(order, state.config.prime);
    if (!op || op.kind !== "fhe") throw new Error("expected buildFheOp to construct an op");
    const prime = BigInt(state.config.prime);
    const verdict = validateOp(state, "teamA", {
      kind: "fhe",
      contractId: order.id,
      ciphertext: { r: op.ciphertext.r, y: ((BigInt(op.ciphertext.y) + 1n) % prime).toString() },
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("does not decrypt to the requested sum");
  });

  /**
   * The Order asks for a componentwise addition of a PAIR. The judge's
   * decrypt-and-compare only ever constrains `y`, because the Order's mask
   * total is fixed and so exactly one `y` is accepted -- which leaves `r`
   * free unless the judge checks it separately. Left unchecked, `(0, y1+y2)`
   * passed: half the procedure, and a ledger row that is not the sum of the
   * two public pairs.
   */
  test("the right y with the wrong r is refused -- both components are checked", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    if (order.task.kind !== "homomorphic-sum") throw new Error("unreachable");
    const op = buildFheOp(order, state.config.prime);
    if (!op || op.kind !== "fhe") throw new Error("expected buildFheOp to construct an op");

    // The correct answer's first component IS the sum of the Order's own
    // first components -- there is no other route to a valid submission.
    const prime = BigInt(state.config.prime);
    const summedR = order.task.inputs.reduce((acc, input) => (acc + BigInt(input.r)) % prime, 0n);
    expect(op.ciphertext.r).toBe(summedR.toString());

    for (const wrongR of ["0", "1", ((summedR + 1n) % prime).toString()]) {
      if (wrongR === op.ciphertext.r) continue;
      const verdict = validateOp(state, "teamA", {
        kind: "fhe",
        contractId: order.id,
        ciphertext: { r: wrongR, y: op.ciphertext.y },
      });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) throw new Error("unreachable");
      expect(verdict.error).toContain("first component");
    }
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
    const entry = applyOp(state, "teamA", padded).publicLedger.find((a) => a.k === "ciphertext");
    expect(entry?.k === "ciphertext" ? entry.r : "").toBe(op.ciphertext.r);
  });

  /**
   * Refused, and refused for the RIGHT REASON. A single message covering both
   * causes told a participant that FHE "does not satisfy privacy constraint
   * none" on an unconstrained share Order — but FHE satisfies `none` fine; it
   * simply cannot do the job. "This Order does not accept LEAK" is a rule and
   * "LEAK cannot do this job" is a fact, and #645 exists to teach the
   * difference, so the refusal has to state which one it is.
   */
  test("a method that cannot do the job is refused as incapable, not as a privacy violation", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    const leakVerdict = validateOp(state, "teamA", { kind: "leak", contractId: order.id });
    expect(leakVerdict.ok).toBe(false);
    if (leakVerdict.ok) throw new Error("unreachable");
    expect(leakVerdict.error).toContain("cannot perform");
    expect(leakVerdict.error).toContain("homomorphic-sum");

    // Specifically an UNCONSTRAINED share Order: that is the case where
    // blaming a privacy rule is most obviously wrong, since the Order imposes
    // none. The belt cycles, so advance until one is open.
    let current = state;
    let shareOrder: Contract | undefined;
    for (let round = 0; round < 20 && !shareOrder; round += 1) {
      shareOrder = current.contracts.find(
        (c) =>
          c.teamId === "teamA" &&
          c.status === "open" &&
          c.task.kind === "reveal-share" &&
          c.privacyConstraint === "none",
      );
      if (!shareOrder) current = tick(current, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
    }
    if (!shareOrder) throw new Error("expected an open unconstrained share order");
    const fheVerdict = validateOp(current, "teamA", {
      kind: "fhe",
      contractId: shareOrder.id,
      ciphertext: { r: "1", y: "1" },
    });
    expect(fheVerdict.ok).toBe(false);
    if (fheVerdict.ok) throw new Error("unreachable");
    expect(fheVerdict.error).toContain("cannot perform");
    // The load-bearing half: it must NOT blame a privacy rule that this Order
    // does not even impose.
    expect(fheVerdict.error).not.toContain("privacy constraint");
  });

  /**
   * A rule violation still reads as a rule violation — the split must not
   * relabel everything as incapability.
   */
  test("a method the rule forbids is still refused as a privacy violation", () => {
    const { state } = orderWithTask("homomorphic-sum");
    let current = state;
    let strictShare: Contract | undefined;
    for (let round = 0; round < 20 && !strictShare; round += 1) {
      strictShare = current.contracts.find(
        (c) =>
          c.teamId === "teamA" &&
          c.status === "open" &&
          c.task.kind === "reveal-share" &&
          c.privacyConstraint === "no-raw-disclosure",
      );
      if (!strictShare) current = tick(current, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
    }
    if (!strictShare) throw new Error("expected an open PROVE-only share order");

    const verdict = validateOp(current, "teamA", { kind: "leak", contractId: strictShare.id });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    // LEAK *can* do a share Order; what it cannot do is satisfy this rule.
    expect(verdict.error).toContain("privacy constraint");
    expect(verdict.error).not.toContain("cannot perform");
  });

  /**
   * The Order asks for the remainder after dividing by the modulus. Both
   * comparisons in the judge reduce mod p, so without this an answer shifted
   * by p scored while skipping that step — and `applyFhe` then wrote a value
   * that is not a field element onto the Public Ledger.
   */
  test("components shifted by the modulus are refused, so the remainder step cannot be skipped", () => {
    const { state, order } = orderWithTask("homomorphic-sum");
    const op = buildFheOp(order, state.config.prime);
    if (!op || op.kind !== "fhe") throw new Error("expected buildFheOp to construct an op");
    const prime = BigInt(state.config.prime);

    for (const shifted of [
      { r: (BigInt(op.ciphertext.r) + prime).toString(), y: op.ciphertext.y },
      { r: op.ciphertext.r, y: (BigInt(op.ciphertext.y) + prime).toString() },
      {
        r: (BigInt(op.ciphertext.r) + prime).toString(),
        y: (BigInt(op.ciphertext.y) + prime).toString(),
      },
    ]) {
      const verdict = validateOp(state, "teamA", {
        kind: "fhe",
        contractId: order.id,
        ciphertext: shifted,
      });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) throw new Error("unreachable");
      expect(verdict.error).toContain("reduced");
    }

    // And the reduced answer is still accepted -- the check rejects unreduced
    // values, not correct ones.
    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
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
