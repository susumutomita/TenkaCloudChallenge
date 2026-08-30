/**
 * Issue #645 Phase 1: the submission-method registry.
 *
 * An Order is a job with a deadline, a reward, and a rule about what may become
 * public. A METHOD is a way to fulfil one. Today there are two, both built on
 * the cryptography this Battle already ships:
 *
 *   LEAK  — publish the raw share the Order asks for. Fast, and it puts secret
 *           material on the Public Ledger where anyone can use it.
 *   PROVE — publish a Schnorr transcript instead. Costs local computation and
 *           publishes nothing an attacker can rebuild the secret from.
 *
 * #645's later phases add FHE and MPC. This module is the seam that makes that
 * additive: a new method is a new entry here, a new arm on `CryptoBattleOp`,
 * and a new branch in `reducer.ts`'s `validateOp` / `applyOp`. Nothing about
 * Order issuance, deadlines, scoring, or the ledger has to learn about it.
 *
 * Phase 1 deliberately adds NO new cryptography. The point is to find out
 * whether the abstraction is natural while the pieces underneath are still ones
 * we can fully verify — #645: 「まず抽象化が自然か検証する」.
 *
 * ## Why the trusted check does not live here
 *
 * Each method's validation stays in `reducer.ts`'s `validateOp` switch, next to
 * the state it needs (`publicCommitments` for PROVE, the team's own shares for
 * LEAK) and inside the same exhaustive `never` check that makes a forgotten
 * method a compile error. Moving the checks into function values on the records
 * below would buy uniformity and cost that exhaustiveness, plus it would let a
 * method ship with a validator that closes over nothing and always returns
 * `{ ok: true }` — a self-report, which #645's judge rules exist to forbid.
 * What lives here is the part that genuinely is data: which methods exist, and
 * what each one publishes.
 */

/**
 * A way to fulfil an Order. Extensible by design — #645's Phase 2 adds `"fhe"`,
 * Phase 3 `"mpc"`. Every consumer switches exhaustively, so adding one fails to
 * compile until each site has decided what it means.
 */
export type SubmissionMethod = "leak" | "prove";

/**
 * What an Order forbids being made public.
 *
 * `"none"` — anything goes; pick the method you like. Fast to serve, and LEAK
 *   is usually the cheap answer.
 * `"no-raw-disclosure"` — the Order's client will not accept the underlying
 *   value being published. Only methods that publish nothing reconstructable
 *   qualify, which today means PROVE alone. This is #645's Level-1
 *   "技術指定 Order": the constraint is stated, and exactly one method meets it.
 *
 * Stored on the Order rather than derived from `allowedMethods` because the
 * constraint is the REASON and the method list is the consequence. A
 * participant who reads only "PROVE only" learns a rule; one who reads "the
 * client will not accept the raw value published" learns why, and can carry
 * that to an Order whose allowed set they have not seen before.
 */
export type PrivacyConstraint = "none" | "no-raw-disclosure";

/** What the platform knows about one method, independent of any Order. */
export interface SubmissionMethodSpec {
  readonly method: SubmissionMethod;
  /**
   * Whether fulfilling an Order this way puts material on the Public Ledger
   * that someone could rebuild the secret from.
   *
   * This is the single fact that decides which Orders a method may serve, and
   * it is a property of the CRYPTOGRAPHY, not a policy knob: a Schnorr
   * transcript carries no witness (see `schnorr.test.ts`'s non-leakage test),
   * while a Shamir share is a point on the secret's polynomial.
   */
  readonly publishesRawSecretMaterial: boolean;
}

export const SUBMISSION_METHODS: Readonly<Record<SubmissionMethod, SubmissionMethodSpec>> = {
  leak: { method: "leak", publishesRawSecretMaterial: true },
  prove: { method: "prove", publishesRawSecretMaterial: false },
};

/** Every method the platform knows, in a stable order. */
export const ALL_SUBMISSION_METHODS: readonly SubmissionMethod[] = ["leak", "prove"];

/** Whether `method` may be used on an Order carrying `constraint`. */
export function methodSatisfiesConstraint(
  method: SubmissionMethod,
  constraint: PrivacyConstraint,
): boolean {
  if (constraint === "none") return true;
  return !SUBMISSION_METHODS[method].publishesRawSecretMaterial;
}

/**
 * The methods an Order with `constraint` accepts, in {@link
 * ALL_SUBMISSION_METHODS} order.
 *
 * Derived rather than authored so a new method automatically becomes available
 * on every Order it legitimately satisfies — and, just as importantly, is
 * automatically excluded from the ones it does not. An authored list would let
 * a Phase-2 FHE method be added to `SUBMISSION_METHODS` and silently never be
 * offered, or worse, be offered on an Order it violates.
 */
export function allowedMethodsFor(constraint: PrivacyConstraint): readonly SubmissionMethod[] {
  return ALL_SUBMISSION_METHODS.filter((method) => methodSatisfiesConstraint(method, constraint));
}
