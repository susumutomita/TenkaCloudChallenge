/**
 * State / op / projection / config types for the PROVE / LEAK / HUNT Battle's
 * pure game model.
 *
 * `CoordinationContext` and the `ValidateResult` shape below intentionally
 * mirror what `@tenkacloud/coordination-plugin-sdk` expects a CoordinationPlugin
 * to consume/return (see AGENTS.md ADR-028 note in SCHEMA.json), which is why
 * `coordination/crypto-battle.ts` (PR3) wraps `reducer.ts`'s exports directly
 * without reshaping them. That SDK package does not exist in this repository
 * (TenkaCloudChallenge owns problem content, not platform packages -- see
 * this repo's AGENTS.md "Repository boundary") and MUST NOT be imported here.
 *
 * PROVE (Issue #486 PR2) is a `CryptoBattleOp` discriminant backed by a real
 * Fiat-Shamir Schnorr verifier (schnorr-verifier.ts) -- see that module and
 * schnorr-prover.ts / schnorr-witness.ts / schnorr-transcript.ts / group.ts
 * for the scheme.
 *
 * JSON-SAFETY INVARIANT (Issue #486 PR3 review fix): `CryptoBattleState` and
 * `CryptoBattleOp` MUST both round-trip cleanly through `JSON.stringify` /
 * `JSON.parse` -- no field anywhere in either type may be a raw `bigint`.
 * This is not a style preference: the platform dispatcher receives `op` as
 * plain parsed-JSON `unknown` off the wire (TenkaCloud's
 * `CoordinationOpBodySchema` is `{ op: z.unknown() }`, no shape validation
 * happens before it reaches this package's `validateOp`) and persists `state`
 * through backends that cannot carry a `bigint` either (Turso:
 * `JSON.stringify` throws on one outright; DynamoDB: round-tripping through
 * `Number` silently loses precision above 2^53-1, well under this package's
 * 2048-bit Schnorr group elements and even under `field.ts`'s own 61-bit
 * `P`). So every bigint that used to live in `CryptoBattleState` /
 * `CryptoBattleOp` (`TeamState.secret`, `TeamState.shares[].value`,
 * `CryptoBattleConfig.prime`, the hunt op's `recoveredSecret`) is a
 * stringified decimal here instead -- the same convention `SchnorrProof` /
 * `ShareArtifact` / `ProofArtifact` / `publicCommitments` already used from
 * PR1/PR2. `game/src`'s pure crypto modules (`field.ts`, `shamir.ts`,
 * `group.ts`, `schnorr-*.ts`, `prng.ts`, `fixtures.ts`) are unaffected and
 * keep working in `bigint` internally -- only the shapes that cross the
 * state/op boundary changed; `reducer.ts` converts at that boundary
 * (`BigInt(...)` on the way in, `.toString()` on the way out).
 */

import type { CipherRung } from "./ladder.ts";
import type { PrivacyConstraint, SubmissionMethod } from "./methods.ts";

// Re-exported so every consumer that already imports this module's shapes gets
// the Order vocabulary from the same place, rather than having to know that
// methods.ts is where a method is defined (Issue #645).
export type { PrivacyConstraint, SubmissionMethod };

/** What the platform dispatcher hands a CoordinationPlugin for one event. */
export interface CoordinationContext {
  readonly eventId: string;
  readonly teamIds: readonly string[];
  /**
   * [Issue #652] The platform's server-only secret for THIS match
   * (TenkaCloud#3133). High-entropy, never projected, never sent to a browser.
   *
   * Every hidden value in this Battle hangs off the match seed — each team's
   * secret and shares (`deriveTeamGeneration`), the Order belt
   * (`deriveContractPlan`), the FHE plaintexts and the MPC inputs and masks.
   * So the seed has to be something a participant cannot obtain.
   *
   * `ctx.eventId` is NOT that. It is a routing key: it appears in URLs and in
   * `PortalSlotProps.team.eventId`, i.e. in the participant's own browser, and
   * this repository is public so every derivation above is published. Seeding
   * from it means any participant can recompute any team's secret and win HUNT
   * without collecting a single share.
   *
   * Optional because the platform issues it only through the coordination
   * dispatcher; local play and unit tests run without one. See
   * `resolveMatchSeed` for what happens then, and why that path must never be
   * used for a real event.
   */
  readonly matchSecret?: string;
}

export type ValidateResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type Phase = "build" | "pressure" | "endgame" | "ended";

export interface ScoreRules {
  /**
   * [Issue #659] Points for completing a standard Order, by how it was fulfilled.
   *
   * LEAK and PROVE used to pay the same, which made LEAK strictly dominant: it
   * costs no computation, so an identical payout meant no reason ever to work.
   * PROVE must pay more, or the whole "compute or expose yourself" tension does
   * not exist.
   */
  readonly contract: number;
  /**
   * [Issue #659] Points for a standard Order fulfilled WITHOUT computing —
   * the participant let the system answer, publishing a plaintext/ciphertext
   * pair to the public record. Strictly below {@link contract}.
   */
  readonly contractLeak: number;
  /**
   * [Issue #659] Penalty for an Order that was issued to this team and expired
   * unanswered. Doing nothing has to be the WORST outcome — worse than leaking
   * and then being hunted for it — or ignoring Orders becomes a safe strategy
   * and the game stops.
   */
  readonly expiredOrder: number;
  /** Points for completing a "rush" LEAK contract (time-pressured, worth more). */
  readonly rushContract: number;
  /** Points an attacker earns for a successful HUNT (secret recovered and matched). */
  readonly huntBonus: number;
  /** Points a target loses when successfully HUNTed (floored at 0, never negative). */
  readonly huntPenalty: number;
}

export interface PhaseBoundaries {
  /** Elapsed match time (ms) at which "build" becomes "pressure". */
  readonly buildToPressureMs: number;
  /** Elapsed match time (ms) at which "pressure" becomes "endgame". */
  readonly pressureToEndgameMs: number;
}

/**
 * Tunable game parameters, fixed once at `initialState()` and immutable for
 * the rest of the match.
 *
 * These are the Issue #486 playtest seed values, not a locked-in balance
 * spec -- operators are expected to tune `scores` / cooldowns / intervals
 * after real playtests, the same way other Battles' `phases[].afterMinutes`
 * and `disruptions[]` timings get tuned (see other battles/*\/metadata.json).
 */
export interface CryptoBattleConfig {
  /** Stringified bigint -- see this file's header "JSON-SAFETY INVARIANT". */
  readonly prime: string;
  readonly threshold: number;
  readonly shareCount: number;
  readonly matchDurationMs: number;
  readonly phaseBoundaries: PhaseBoundaries;
  /** How often (ms) a fresh batch of Orders is issued per team. */
  readonly contractIntervalMs: number;
  /**
   * [Issue #659] How many Orders arrive per team per issue, all at once.
   *
   * This is the design's ONE tuning knob, and it decides whether the match is
   * a game at all. Set it so a fast team clears the batch and a slow team
   * overflows: too low and nobody ever has to LEAK, so nothing is ever
   * published and HUNT can never fire (the simulation in #659 measured
   * literally zero hunts at a batch of 1); too high and every team overflows,
   * so being fast stops paying.
   *
   * It CANNOT be derived. The plugin is handed team ids, never headcount, so
   * it cannot see that a team has three people. #659 sizes it from the paper
   * playtest as "team size + 1 to 2", and 6 is that figure for the standard
   * three-person team. A match with a different team size has to re-tune it.
   *
   * Raising it also costs storage. The whole match is one persisted row and
   * Orders are retained after they resolve, so the row grows with
   * `teams x contractsPerIssue x issues`; at 6 it caps a match at 8 teams on
   * the DynamoDB backend. `state-size.test.ts` measures where that line is.
   */
  readonly contractsPerIssue: number;
  /**
   * How long (ms) an issued Order stays "open" before it expires unclaimed.
   *
   * [Issue #659] Deliberately EQUAL to `contractIntervalMs`, which is the
   * "no prefetch" rule the rest of the scoring rests on: a batch lives exactly
   * until the next batch replaces it, so Orders cannot be stockpiled. A longer
   * TTL would let a team hold a backlog, and with a backlog LEAK always beats
   * PROVE no matter how the points are set -- leaking frees five minutes that
   * convert straight into another PROVE, so the leak's points are pure profit.
   * Raising this above the interval reintroduces that arbitrage.
   */
  readonly contractTtlMs: number;
  /**
   * How long (ms) a "rush" contract stays open. Shorter than `contractTtlMs`
   * so the extra `scores.rushContract` points are genuinely time-pressured,
   * not just a flat bonus with the same deadline as a standard contract.
   */
  readonly rushContractTtlMs: number;
  /** Minimum time (ms) between two ROTATE ops for the same team. */
  readonly rotateCooldownMs: number;
  readonly scores: ScoreRules;
}

/**
 * One ciphertext on the wire: both components are stringified decimals, the
 * same convention as every other bigint that crosses the state/op boundary --
 * see this file's header "JSON-SAFETY INVARIANT". `fhe.ts` works in `bigint`
 * internally and converts here.
 */
export interface StoredCiphertext {
  readonly r: string;
  readonly y: string;
}

/**
 * [Issue #645] What an Order actually asks for.
 *
 * #645's acceptance criteria require an Order to carry a task alongside its
 * deadline, points, privacy rule and methods. Before Phase 2 every Order asked
 * for the same thing -- reveal these share indices -- so the task was implicit
 * in a bare `requestedShareIndices` field. FHE and MPC Orders ask for something
 * else entirely and carry a different payload, so the task became a thing worth
 * naming.
 *
 * The task is what decides which methods could possibly serve an Order; the
 * privacy constraint then narrows that set further. Keeping them separate is
 * what makes "this Order accepts LEAK or PROVE, your call" and "this Order
 * accepts PROVE only, because the client will not have the raw value
 * published" two different sentences rather than one rule with two spellings --
 * see methods.ts's `allowedMethodsFor`.
 *
 * Every payload here is PUBLIC. An MPC Order's confidential material (the
 * team's own number and its masks) is deliberately absent: it is derived per
 * team in `projectForTeam` and never stored, so no ledger entry and no other
 * team's projection can carry it. See mpc.ts.
 */
export type OrderTask =
  | {
      readonly kind: "reveal-share";
      /** Which share indices the Order wants accounted for. */
      readonly shareIndices: readonly number[];
    }
  | {
      readonly kind: "homomorphic-sum";
      /** The ciphertexts to add. Public: they hide their plaintexts (fhe.ts). */
      readonly inputs: readonly StoredCiphertext[];
    }
  | {
      readonly kind: "masked-total";
      /** How many offices take part, including this team. */
      readonly partyCount: number;
    }
  /**
   * [Issue #659 §5] Encrypt this run of symbols with your team's key for the
   * named rung of the cipher ladder.
   *
   * Everything here is public, INCLUDING the algorithm — that is Kerckhoffs's
   * principle stated as a game rule (#659 §5). Hiding the method would only
   * mean five minutes spent guessing what to do, and it would teach the exact
   * misconception the ladder exists to remove. The key is the secret, and it is
   * the only secret.
   *
   * `pairsToBreak` is on the Order for the same reason `leakPoints` is: the
   * decision this Order asks for is "is passing on this worth what publishing a
   * pair costs me", and a team cannot weigh that without knowing how many pairs
   * their current rung survives.
   */
  | {
      readonly kind: "caesar-shift";
      readonly rung: CipherRung;
      /** The symbols to encrypt, as pictures — never words (#659 §3). */
      readonly plaintext: readonly string[];
      /** The rung's whole alphabet, in value order. Its length is the modulus. */
      readonly symbols: readonly string[];
      /** How many published pairs recover the key on this rung (#659 §2). */
      readonly pairsToBreak: number;
    };

export type OrderTaskKind = OrderTask["kind"];

export type ContractKind = "standard" | "rush";
export type ContractStatus = "open" | "completed" | "expired";

/**
 * One job on the belt. Participant-facing copy calls this an **Order**
 * (Issue #645): a `Contract` here is a piece of work with a deadline, a reward,
 * a stated privacy rule, and the set of methods that satisfy it -- nothing to
 * do with a smart contract or a CloudFormation stack. The internal type name is
 * unchanged on purpose (#646 non-goals), so a rename does not churn every
 * reducer test at the same time as the model grows.
 */
export interface Contract {
  readonly id: string;
  /** The team this Order was issued to (only that team may submit against it). */
  readonly teamId: string;
  readonly kind: ContractKind;
  /** Points for fulfilling this Order by computing it (PROVE / FHE / MPC). */
  readonly points: number;
  /**
   * [Issue #659] Points for fulfilling it by LEAK — letting the system answer
   * and publishing the pair. Carried on the Order rather than read from config
   * at submit time so the participant can see both numbers side by side and
   * make the trade knowingly.
   */
  readonly leakPoints: number;
  /** [Issue #645] What the Order asks for, and the public payload it needs. */
  readonly task: OrderTask;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: ContractStatus;
  /**
   * [Issue #645] The rule the Order's client imposes on what may become public.
   * `allowedMethods` is derived from it -- see methods.ts on why both are
   * stored: the constraint is the reason, the method list the consequence.
   */
  readonly privacyConstraint: PrivacyConstraint;
  /**
   * [Issue #645] Which submission methods fulfil this Order. A single-entry
   * list is a Level-1 "required method" Order. Always
   * `allowedMethodsFor(privacyConstraint)`; carried on the Order so a
   * projection can show it without the portal re-deriving game rules.
   */
  readonly allowedMethods: readonly SubmissionMethod[];
  /** Which method actually completed it, once one did. */
  readonly resolution?: SubmissionMethod;
  /**
   * [Issue #659] Why an `expired` Order ended, once one did.
   *
   * Two different things end an Order unanswered -- its deadline passing, and
   * its team ROTATE-ing away from the generation it was issued against -- and
   * both leave `status: "expired"`. They carry the same score penalty (see
   * `applyRotate`), so the distinction is not a scoring one; it exists so a
   * participant reading their own board can tell "the clock beat me" from "I
   * chose this", and so a reconciliation over final state can attribute each
   * penalty to its cause rather than inferring it from timestamps.
   */
  readonly expiryCause?: "deadline" | "rotate";
}

/**
 * A non-interactive Fiat-Shamir Schnorr proof, as PROVE submits it and as
 * the Public Ledger's `ProofArtifact` records it -- see schnorr-prover.ts /
 * schnorr-verifier.ts. Both fields are stringified bigints (same convention
 * as `ShareArtifact.value` below): a decimal `Contract.id`-sized JSON payload
 * stays JSON-safe without a bigint-aware serializer.
 */
export interface SchnorrProof {
  /** The Schnorr commitment R = g^k mod p. */
  readonly commitment: string;
  /** The response z = k + e*w mod group.order. */
  readonly response: string;
}

/** One entry in the Public Ledger: a share value a team chose to reveal via LEAK. */
export interface ShareArtifact {
  readonly id: string;
  readonly teamId: string;
  /** The team's secret generation this share belongs to (see ROTATE). */
  readonly generation: number;
  readonly kind: "share";
  /**
   * [Issue #645] Which method produced this artifact. Redundant with `kind`
   * while there are exactly two methods and each posts one artifact shape --
   * and deliberately recorded anyway, because #645's Public Ledger requirement
   * is that a reader can see WHICH METHOD a team used, and Phase 2's FHE
   * ciphertext is a third artifact whose shape does not name its method.
   * Recording it now means the ledger's contract does not change when it lands.
   */
  readonly method: SubmissionMethod;
  readonly shareIndex: number;
  /** Stringified bigint -- see reducer.ts on why the ledger stores strings. */
  readonly value: string;
  readonly contractId: string;
  readonly postedAtMs: number;
}

/**
 * One entry in the Public Ledger: an audit-only record that a team completed
 * a Contract via PROVE. Deliberately holds ONLY the proof transcript
 * (`commitment` / `response`) -- never a share value and never the secret or
 * witness those were derived from. Recording the transcript at all (rather
 * than nothing) is what makes a PROVE completion independently replay-
 * verifiable after the fact (Issue #486's trusted-verification minimum bar),
 * while the transcript itself carries no cryptographic material a viewer
 * could use to reconstruct anything (see schnorr.test.ts's secret-non-
 * leakage test).
 */
export interface ProofArtifact {
  readonly id: string;
  readonly teamId: string;
  /** The team's secret generation the proven public commitment Y belongs to. */
  readonly generation: number;
  readonly kind: "proof";
  /** [Issue #645] Which method produced this artifact -- see ShareArtifact. */
  readonly method: SubmissionMethod;
  readonly contractId: string;
  readonly commitment: string;
  readonly response: string;
  readonly postedAtMs: number;
}

/**
 * [Issue #645 Phase 2] One entry in the Public Ledger: the ciphertext a team
 * submitted for an FHE Order.
 *
 * Safe to publish, and that is the lesson. The value is an encryption under a
 * key only the judge holds, so a reader sees a number that carries no
 * information about the plaintexts it was computed from (see fhe.ts on why that
 * is information-theoretic rather than a hardness assumption). A participant
 * looking at this row learns that a team answered, and nothing about what the
 * answer was.
 */
export interface CiphertextArtifact {
  readonly id: string;
  readonly teamId: string;
  readonly generation: number;
  readonly kind: "ciphertext";
  readonly method: SubmissionMethod;
  readonly contractId: string;
  /** The submitted ciphertext's two components -- stringified decimals. */
  readonly r: string;
  readonly y: string;
  readonly postedAtMs: number;
}

/**
 * [Issue #645 Phase 3] One entry in the Public Ledger: the masked partial a
 * team published for an MPC Order.
 *
 * Also safe to publish, for a different reason: the value is the team's own
 * number plus and minus masks nobody else holds, so it is consistent with every
 * possible input (see mpc.ts). Publishing it is what lets the client add the
 * three partials and learn the total while no office's number is ever exposed.
 */
export interface PartialArtifact {
  readonly id: string;
  readonly teamId: string;
  readonly generation: number;
  readonly kind: "partial";
  readonly method: SubmissionMethod;
  readonly contractId: string;
  /** The published masked partial -- a stringified decimal. */
  readonly partial: string;
  /**
   * [Issue #645 Phase 3] The other two offices' published partials, and the
   * total all three sum to.
   *
   * Without these the Order stopped one step short of its own story: the team
   * published its masked subtotal, scored, and the outcome the client wanted
   * — the total, obtained without any office revealing its number — was never
   * produced anywhere in the runtime. The statement promises that outcome, so
   * the runtime owes it.
   *
   * Safe to publish, by the same argument that makes `partial` safe: a partial
   * is consistent with every possible input (see mpc.ts), and the total is
   * precisely what the client is entitled to learn. Neither an input nor a
   * mask appears here, and `mpc.test.ts` scans the serialized ledger to keep
   * it that way.
   */
  readonly peerPartials: readonly string[];
  /** `partial + peerPartials`, in the field. The client's answer. */
  readonly total: string;
  readonly postedAtMs: number;
}

/**
 * [Issue #659 §2] A (plaintext, ciphertext) pair, published because its team
 * chose to LEAK a ladder Order instead of computing it.
 *
 * This is the ladder's whole economy in one record. LEAK on a ladder Order does
 * not publish a share; it publishes the ANSWER, and an answer next to its
 * question is exactly the material that recovers a key. How much of the key it
 * gives away depends on the rung, which is why `pairsToBreak` rides along: a
 * reader looking at the public record can count how many pairs a team has out
 * and know whether that team is already broken.
 *
 * `plaintext` and `ciphertext` are the pictures, not the values, so the record
 * reads the same to a participant as the Order did (#659 §3).
 */
export interface CipherPairArtifact {
  readonly id: string;
  readonly teamId: string;
  readonly generation: number;
  readonly kind: "cipher-pair";
  readonly method: SubmissionMethod;
  readonly contractId: string;
  readonly rung: CipherRung;
  readonly plaintext: readonly string[];
  readonly ciphertext: readonly string[];
  /** How many pairs recover the key on this rung -- see the doc above. */
  readonly pairsToBreak: number;
  readonly postedAtMs: number;
}

export type PublicArtifact =
  | ShareArtifact
  | ProofArtifact
  | CiphertextArtifact
  | PartialArtifact
  | CipherPairArtifact;

/**
 * A Shamir share as it lives in `CryptoBattleState` / `CryptoBattleProjection`
 * -- `value` is a stringified bigint (see this file's header "JSON-SAFETY
 * INVARIANT"), unlike `shamir.ts`'s own `Share`, which stays `bigint` because
 * it is that module's pure internal computation type, never part of the
 * state/op wire shape directly.
 */
export interface StoredShare {
  readonly index: number;
  readonly value: string;
}

/**
 * Per-team private state, held only by the trusted pure-model runtime (the
 * platform dispatcher Lambda), never sent to a participant directly --
 * `projectForTeam` is the only sanctioned read path, and it redacts every
 * other team's `secret` / `shares` (see reducer.ts + adversarial test #5).
 */
export interface TeamState {
  readonly teamId: string;
  readonly score: number;
  /** Increments on every successful ROTATE; shares/secret below are for THIS generation. */
  readonly generation: number;
  /** Stringified bigint -- see this file's header "JSON-SAFETY INVARIANT". */
  readonly secret: string;
  /** All `shareCount` shares for the current generation (only some may have been LEAKed). */
  readonly shares: readonly StoredShare[];
  readonly lastRotateAtMs: number | undefined;
  readonly completedContractIds: readonly string[];
  /** This team's OWN generations that some attacker has successfully HUNTed. */
  readonly huntedGenerations: readonly number[];
  /**
   * [Issue #659] This team's OWN generations whose LADDER key an attacker has
   * recovered, per rung.
   *
   * Kept apart from `huntedGenerations` because the two mean different things
   * and a participant has to be able to tell them apart: one says the team's
   * Shamir secret was reconstructed from three published shares, the other says
   * a cipher key was recovered from published pairs. Folding a Caesar break
   * into `huntedGenerations` would report a secret reconstruction that never
   * happened -- and once the ladder has rungs a team can climb, "which rung of
   * mine is broken" is the question they need answered, not "am I broken".
   */
  readonly cipherHuntedGenerations: Readonly<Record<string, readonly number[]>>;
}

export interface CryptoBattleState {
  readonly config: CryptoBattleConfig;
  readonly seed: string;
  readonly phase: Phase;
  /** Wall-clock time of the most recent tick(); undefined before the first tick. */
  readonly nowMs: number | undefined;
  /** Wall-clock time the match started (= the first tick's eventNowMs). */
  readonly startedAtMs: number | undefined;
  readonly nextContractAtMs: number | undefined;
  readonly contracts: readonly Contract[];
  readonly publicLedger: readonly PublicArtifact[];
  readonly teams: Readonly<Record<string, TeamState>>;
  /**
   * Every team's current-generation Schnorr public commitment
   * `Y = g^w mod p` (stringified bigint), keyed by teamId -- PROVE's
   * verifier checks a submitted proof against this. Public by construction
   * (unlike `TeamState.secret` / `.shares`): derived once per team at
   * `initialState` and re-derived on every ROTATE (see reducer.ts's
   * `applyRotate`), so it always reflects the team's *current* generation
   * the same way `TeamState.generation` does. Lives at the state's top
   * level, not inside `TeamState`, specifically so it is unambiguous that
   * this field -- unlike everything else `TeamState` holds -- is always safe
   * to hand to every team via `projectForTeam`.
   */
  readonly publicCommitments: Readonly<Record<string, string>>;
  /**
   * Replay guard: `JSON.stringify([attackerTeamId, targetTeamId, generation])`
   * for every successful HUNT. JSON-encoded (not `|`-joined) so a team id
   * that happens to contain `|` can never collide with a different triple.
   */
  readonly successfulHunts: readonly string[];
  /**
   * Ordered log of successful HUNTs, WITH a timestamp (Issue #486 PR5,
   * `replay.ts`). `successfulHunts` above deliberately carries only the
   * replay-guard KEY, no `atMs` -- it cannot answer "when did this HUNT
   * succeed?" on its own, and every other `PublicArtifact` on the ledger
   * already has a `postedAtMs` a debrief/replay can use, but a HUNT posts no
   * ledger artifact at all (see reducer.ts's `applyHunt`). This field exists
   * purely so `replay.ts`'s post-match debrief (Issue #486's "120分 debrief
   * / Replay" -- the worked example is literally "58:01 Team B HUNT
   * success") can be honest about hunt timing instead of omitting it or
   * guessing. Purely additive: `validateOp`'s replay guard still reads only
   * `successfulHunts` above, never this field -- see `applyHunt`.
   */
  readonly huntLog: readonly HuntLogEntry[];
}

/** One entry in `CryptoBattleState.huntLog` -- see that field's doc comment. */
export interface HuntLogEntry {
  readonly attackerTeamId: string;
  readonly targetTeamId: string;
  readonly generation: number;
  readonly atMs: number;
}

export type CryptoBattleOp =
  | { readonly kind: "leak"; readonly contractId: string }
  /**
   * [Issue #645 Phase 2] The ciphertext this team computed for an FHE Order.
   * The judge decrypts it and compares against the hidden expected sum -- a
   * participant never learns the plaintexts, and self-reporting "I did the
   * addition" earns nothing.
   */
  | {
      readonly kind: "fhe";
      readonly contractId: string;
      readonly ciphertext: StoredCiphertext;
    }
  /**
   * [Issue #645 Phase 3] The masked partial this team publishes for an MPC
   * Order. Stringified decimal, parsed through the same untrusted-decimal gate
   * as every other participant-supplied number.
   */
  | { readonly kind: "mpc"; readonly contractId: string; readonly partial: string }
  /**
   * [Issue #645 Phase 5] A HUNT that exploits nonce reuse rather than collected
   * shares: two of the target's proof transcripts on the Public Ledger share a
   * commitment, which solves for the witness behind their public commitment Y.
   * A separate op kind rather than a variant of "hunt" so each carries exactly
   * the evidence its own check needs, and so neither branch has to ask which
   * kind of hunt it is looking at.
   */
  | {
      readonly kind: "hunt-nonce";
      readonly targetTeamId: string;
      readonly generation: number;
      /** The recovered Schnorr witness w, satisfying g^w = Y. Stringified decimal. */
      readonly recoveredWitness: string;
    }
  | {
      readonly kind: "hunt";
      readonly targetTeamId: string;
      readonly generation: number;
      /**
       * Stringified bigint -- see this file's header "JSON-SAFETY INVARIANT".
       * `validateOp`'s "hunt" branch parses this with `schnorr-verifier.ts`'s
       * `parseCanonicalDecimal` (the same untrusted-decimal-parsing gate
       * PROVE's proof fields already go through) and rejects a malformed
       * value with `{ ok: false }` rather than throwing.
       */
      readonly recoveredSecret: string;
    }
  /**
   * [Issue #659] The ciphertext this team computed for a ladder Order.
   *
   * A separate op from `prove` because it carries different evidence: PROVE
   * hands over a Schnorr transcript that proves knowledge of the Shamir secret
   * without revealing it, while this hands over the ANSWER and relies on the
   * judge already holding the key to check it. Both publish nothing an attacker
   * can use, and that shared property is what makes them both "do the work
   * yourself" methods -- but merging them would mean one branch asking which
   * kind of evidence it was looking at, which is what `hunt-nonce`'s comment
   * above already argues against.
   *
   * Accepts pictures or their numeric values (see `parseAnswer`): a keyboard
   * that cannot type a dice face must not be a scoring disadvantage.
   */
  | { readonly kind: "cipher"; readonly contractId: string; readonly answer: readonly string[] }
  /**
   * [Issue #659 §2] A HUNT that breaks a ladder key rather than reconstructing
   * a Shamir secret.
   *
   * The evidence is the key itself. What it took to get there is the rung's
   * business, not the judge's: on Caesar it is one subtraction against a single
   * published pair, higher up it is a period to spot or a modulus to factor,
   * and eventually there is no way at all. The judge only ever checks whether
   * the key is right -- deliberately, so a team that simply GUESSES on a
   * six-symbol alphabet has its one-in-six chance. Making the ladder harder to
   * break is the defence; policing how an attacker thought is not.
   */
  | {
      readonly kind: "hunt-cipher";
      readonly targetTeamId: string;
      readonly generation: number;
      readonly rung: CipherRung;
      /** The recovered key, as a symbol value. */
      readonly recoveredKey: number;
    }
  | { readonly kind: "rotate" }
  | { readonly kind: "prove"; readonly contractId: string; readonly proof: SchnorrProof };

export interface VaultProjection {
  readonly teamId: string;
  readonly secret: string;
  readonly shares: readonly StoredShare[];
  readonly generation: number;
  readonly lastRotateAtMs: number | undefined;
  readonly rotateCooldownRemainingMs: number;
  readonly completedContractIds: readonly string[];
  readonly huntedGenerations: readonly number[];
}

/**
 * [Issue #645] The task as its OWNER sees it.
 *
 * Identical to {@link OrderTask} except for `masked-total`, which gains the
 * confidential inputs that team -- and only that team -- needs to compute its
 * partial. Those are derived in `projectForTeam`, never stored, so there is no
 * field anywhere in `CryptoBattleState` that a future ledger change could leak
 * by accident.
 */
export type OrderTaskProjection =
  | { readonly kind: "reveal-share"; readonly shareIndices: readonly number[] }
  | { readonly kind: "homomorphic-sum"; readonly inputs: readonly StoredCiphertext[] }
  | {
      readonly kind: "masked-total";
      readonly partyCount: number;
      /** This office's confidential number -- stringified decimal. */
      readonly myInput: string;
      /** Masks the other offices sent to this one. */
      readonly incomingMasks: readonly string[];
      /** Masks this office sent to the others. */
      readonly outgoingMasks: readonly string[];
    }
  /**
   * [Issue #659] The ladder Order, plus the one thing the team may see that the
   * public Order does not carry: their own key. It is theirs already -- the
   * whole task is to encrypt WITH it -- and a projection is only ever handed to
   * the team it belongs to (see `projectForTeam`), so this is the same
   * boundary `vault.secret` already sits on.
   */
  | {
      readonly kind: "caesar-shift";
      readonly rung: CipherRung;
      readonly plaintext: readonly string[];
      readonly symbols: readonly string[];
      readonly pairsToBreak: number;
      /** THIS team's key for the rung, at its current generation. */
      readonly myKey: number;
    };

export interface ContractProjection {
  readonly id: string;
  readonly kind: ContractKind;
  readonly points: number;
  /** [Issue #659] What LEAK pays instead — always below {@link points}. */
  readonly leakPoints: number;
  /**
   * [Issue #645] What this Order asks for, plus anything the OWNING team needs
   * to do it. For an MPC Order that includes confidential material (the team's
   * own number and its masks) -- safe because `projectForTeam` only ever puts
   * an Order in `myContracts` for the team it was issued to, so this shape
   * cannot reach anyone else. See mpc.ts.
   */
  readonly task: OrderTaskProjection;
  readonly status: ContractStatus;
  /** [Issue #645] The stated rule -- what the Order will not have published. */
  readonly privacyConstraint: PrivacyConstraint;
  /** [Issue #645] The methods that satisfy it. One entry = a required method. */
  readonly allowedMethods: readonly SubmissionMethod[];
  /**
   * Ms remaining until this contract expires, AS OF the state's last
   * `tick()` -- a duration, not a timestamp. `Contract.expiresAtMs` (which
   * this is derived from in `projectForTeam`) lives on the same clock as
   * `tick(state, eventNowMs)`'s `eventNowMs`, which TenkaCloud's dispatcher
   * documents as `nowMs - eventStartMs` (elapsed ms since the event started,
   * NOT a Unix epoch ms) -- see `CryptoBattleState.nowMs`'s doc comment.
   * Handing a raw `expiresAtMs` to a portal that subtracts its own
   * wall-clock `Date.now()` (an absolute epoch ms, off by a factor of
   * roughly 10^9 from an elapsed-ms duration) silently produces a deeply
   * negative number that every duration-formatting helper clamps to zero --
   * this repo's own `StatusPanel.tsx` did exactly that before this field
   * existed, rendering every live contract's deadline as a permanent
   * "0:00" regardless of how much time was actually left. Shipping a
   * pre-computed duration instead removes the unit mismatch at its source;
   * the portal only adds its own wall-clock elapsed-since-last-poll delta on
   * top (`coordination.ts`'s `receivedAtWallMs`) to animate a smooth
   * per-second countdown between 30s polls, never a second subtraction
   * against an absolute clock.
   */
  readonly remainingMs: number;
}

export interface TeamSummaryProjection {
  readonly teamId: string;
  readonly score: number;
  readonly generation: number;
  readonly huntedGenerationCount: number;
}

/**
 * What one team is allowed to see. Built exclusively from `state` by
 * `projectForTeam` -- never hand-assembled elsewhere, so there is exactly one
 * place that has to get the redaction right.
 */
export interface CryptoBattleProjection {
  readonly phase: Phase;
  /**
   * [Issue #645] The modulus every calculation in this Battle runs over,
   * as a stringified decimal.
   *
   * Public by construction — it is in the problem statement, in the reference
   * code, and in `field.ts`'s exported `P`. It is on the projection because a
   * participant cannot perform an FHE addition or an MPC subtotal without it,
   * and because leaving it off led to the workaround `playtest.ts`'s
   * `PublicHuntParams` exists to be: a game rule the portal had to be told
   * out-of-band. Nothing about knowing `p` weakens anything; every scheme here
   * is public-parameter by design.
   */
  readonly prime: string;
  /**
   * Ms remaining until the match ends, AS OF the state's last `tick()` --
   * `undefined` before the first tick (match not started). Same
   * duration-not-timestamp rationale as `ContractProjection.remainingMs`
   * above: `CryptoBattleState.startedAtMs` lives on `tick()`'s
   * elapsed-since-event-start clock, not an absolute epoch, so this field
   * is computed here rather than exposing `startedAtMs` /
   * `state.config.matchDurationMs` for the portal to (mis)combine with its
   * own wall clock.
   */
  readonly matchRemainingMs: number | undefined;
  readonly vault: VaultProjection;
  readonly myContracts: readonly ContractProjection[];
  readonly otherOpenContractCount: number;
  readonly publicLedger: readonly PublicArtifact[];
  readonly teams: Readonly<Record<string, TeamSummaryProjection>>;
  /** Every team's current-generation Schnorr public commitment -- see CryptoBattleState's field of the same name. Public by construction, safe for every team to see. */
  readonly publicCommitments: Readonly<Record<string, string>>;
}
