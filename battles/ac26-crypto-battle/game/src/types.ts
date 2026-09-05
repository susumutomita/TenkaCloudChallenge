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
 * PROVE (Issue #486 PR2, rebuilt as ZK sudoku in #709) is the `prove-sudoku`
 * op: a team hands the judge a relabelled copy of its 4x4 sudoku solution and
 * the judge publishes one row, column or box of it -- see `sudoku.ts` for the
 * scheme and why it replaced the Schnorr exchange.
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
 * `Number` silently loses precision above 2^53-1, well under `field.ts`'s
 * own 61-bit `P`). So every bigint that used to live in `CryptoBattleState` /
 * `CryptoBattleOp` (`TeamState.secret`, `TeamState.shares[].value`,
 * `CryptoBattleConfig.prime`, the hunt op's `recoveredSecret`) is a
 * stringified decimal here instead -- the same convention `ShareArtifact`
 * already used from PR1. `game/src`'s pure crypto modules (`field.ts`,
 * `shamir.ts`, `prng.ts`, `fixtures.ts`) are unaffected and keep working in
 * `bigint` internally -- only the shapes that cross the state/op boundary
 * changed; `reducer.ts` converts at that boundary (`BigInt(...)` on the way
 * in, `.toString()` on the way out). Sudoku grids are small integers (1..4)
 * and travel as plain JSON numbers.
 */

import type { CipherRung } from "./ladder.ts";
import type { StoredArtifact } from "./ledger-codec.ts";
import type { PrivacyConstraint, SubmissionMethod } from "./methods.ts";
import type { Permutation, SudokuGrid } from "./sudoku.ts";

// Re-exported so every consumer that already imports this module's shapes gets
// the Order vocabulary from the same place, rather than having to know that
// methods.ts is where a method is defined (Issue #645).
export type { PrivacyConstraint, SubmissionMethod };

/** What the platform dispatcher hands a CoordinationPlugin for one event. */
export interface CoordinationContext {
  readonly eventId: string;
  readonly teamIds: readonly string[];
  /**
   * [Issue #3172] teamId → 参加者に見せる表示名 (platform が roster から解決)。
   * 無い teamId は id へ fallback する。
   */
  readonly teamNames?: Readonly<Record<string, string>>;
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

/**
 * [Issue #677] `waiting` is the state a deployed match sits in until someone
 * starts it, and it exists because the alternative was destroying every match
 * that was not being played at that exact moment.
 *
 * Orders arrive six at a time every five minutes and cost 15 points each when
 * they lapse, so an unattended match bled 90 points per five minutes into a
 * score floored at zero. An organiser who deployed at 09:00 for a 10:30 start
 * had a room full of teams already buried before anyone opened the portal, and
 * the ninety-minute clock had run out an hour before the event began.
 */
export type Phase = "waiting" | "build" | "pressure" | "endgame" | "ended";

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
  /**
   * [Issue #696] What a WRONG HUNT costs the attacker.
   *
   * A wrong HUNT used to cost nothing at all: `validateOp` refused it and the
   * op never reached `applyOp`, so no state moved. That was survivable only
   * because the field was 2^61 - 1 and guessing was hopeless. Once the field is
   * small enough to interpolate by hand (`prime`), free retries turn HUNT into
   * a guessing game and break the problem's own North Star -- "cryptographic
   * correctness is never left to luck". A wrong HUNT is now an op that lands,
   * charges this, and burns one of `maxHuntAttemptsPerTarget`.
   */
  readonly wrongHunt: number;
  /**
   * [Issue #701, #709] What a wrong PROVE costs.
   *
   * Under the Schnorr exchange this was what made a 113-value challenge space
   * sound. The sudoku judge holds the whole solution, so a wrong grid never
   * verifies by luck -- the charge now exists so a team cannot use the judge as
   * a free checker for a grid it is not sure of, and so a submitted grid is a
   * move that happened rather than a request that was refused (see
   * `TeamState.lastProve`).
   */
  readonly wrongProve: number;
  /**
   * [Issue #659 §9] What each successive hint on an Order costs, by level —
   * `hintCosts[0]` for the first hint opened, `[1]` for the second, and so on.
   * Charged as a deduction (floored at 0, like `huntPenalty`), whether or not
   * the Order is ever answered.
   *
   * A LIST rather than one price because the levels are not worth the same: the
   * first says where to look, the last walks the first step of the calculation.
   * A flat price would either make the nudge too expensive to try or the walked
   * step too cheap to think about.
   *
   * The sum is bounded by the ordering the whole scoring model rests on
   * (#659 §15): a team that buys every hint and then computes the Order must
   * still finish above what LEAK would have paid them, or hints turn into a
   * roundabout way of making LEAK optimal again — the exact failure #659's
   * simulation found. `hints.test.ts` pins `contract - sum(hintCosts) >
   * contractLeak` against `DEFAULT_CONFIG`. Its length must match
   * `HINT_LEVELS`; a level with no price would be a free hint.
   */
  readonly hintCosts: readonly number[];
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
   * `teams x contractsPerIssue`, so raising it raises the per-team cost of the
   * persisted row and lowers how many teams a backend can hold.
   * `state-size.test.ts` measures both ceilings and OPERATOR.md records them.
   */
  readonly contractsPerIssue: number;
  /**
   * [Issue #695] How long (ms) after the ONE-Order opening batch the first full
   * batch arrives.
   *
   * The opening batch is a single Order on purpose (see `batchSize` in
   * `tick`): six at once, in five different methods, is a menu rather than a
   * first move. But pacing the batch AFTER it at the full `contractIntervalMs`
   * meant a player who answered that single Order watched an empty belt for
   * five minutes, which reads as a broken game rather than a slow one -- the
   * live two-team run reported exactly that ("次のオーダーがこない").
   *
   * Only the opening is shortened. Every batch from the second onward keeps
   * `contractIntervalMs`, so the no-prefetch rule that the LEAK/PROVE economy
   * rests on is untouched for the whole match. The one bounded exception is
   * that the opening Order (TTL `contractTtlMs`) is still open when the first
   * full batch lands, so a team holds `contractsPerIssue + 1` Orders for the
   * remainder of that TTL. One extra Order in the opening minutes does not
   * give LEAK the backlog it would need to dominate PROVE, and the opening
   * Order keeps the full TTL because charging a beginner `expiredOrder` for
   * missing a 60-second first move is the opposite of an onboarding.
   */
  readonly onboardingFollowUpMs: number;
  /**
   * [Issue #696] How many HUNT attempts one team gets against one target's one
   * generation, successful or not.
   *
   * This is what makes a hand-sized `prime` sound. Interpolating three shares
   * has to stay the cheapest way to a target's secret: with `prime` = 97 and
   * unlimited retries, submitting every field element costs a script two
   * seconds, so the cap -- not the modulus -- is what forces the arithmetic to
   * actually be done. Set it at or below `threshold` so a team can never buy
   * more attempts than the shares it would have needed anyway.
   */
  readonly maxHuntAttemptsPerTarget: number;
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
      /**
       * The symbols to encrypt, as VALUES — the pictures are added by
       * `projectTask` from the rung's alphabet.
       *
       * Stored as numbers rather than as the dice faces a participant sees for
       * a reason that is not micro-optimisation: the whole match is one
       * persisted row against a 400 KB item cap (see `state-size.test.ts`), and
       * a multi-byte glyph is roughly three times the cost of the value behind
       * it, on every Order and again on every published pair. Presentation
       * belongs to the projection anyway — everything derivable from the rung
       * registry is added there, the same way MPC's private inputs are derived
       * rather than stored.
       */
      readonly plaintext: readonly number[];
    }
  /**
   * [Issue #709] Show that you hold your sudoku solution, without showing it.
   *
   * Carries no payload: the team's puzzle is already public
   * (`CryptoBattleState.publicPuzzles`) and its solution is in its own vault.
   * The one thing the Order adds -- which row, column or box the judge will
   * open -- is derived from the Order id at judgement time and deliberately not
   * stated here, so a team relabels the whole grid rather than the four cells
   * it knows will be read.
   */
  | { readonly kind: "zk-sudoku" };

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
  /**
   * [Issue #659 §9] How many hints this Order's team has opened on it.
   *
   * A COUNT, not the list of levels, and not the text. Hints are opened in
   * ladder order, so the count says everything the list would — and the whole
   * match is one persisted row against a 400 KB item cap
   * (`state-size.test.ts`), where an array on every retained Order costs
   * multiples of what one small integer does. The text is never stored at all:
   * `projectForTeam` reads it from `hints.ts` by level.
   *
   * Absent rather than `0` on an Order nobody has bought a hint for, which is
   * most of them — the same reason `resolution` and `expiryCause` are optional.
   * Every read goes through `hintsRevealedOn`, so an Order persisted before
   * this field existed needs no migration: it simply has no hints open.
   */
  readonly hintsRevealed?: number;
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
 * LEGACY -- one entry in the Public Ledger from a Schnorr PROVE, which #709
 * retired. Nothing writes this shape any more; it stays so a match persisted
 * before #709 (rows live up to seven days) still decodes and still renders,
 * and so `ledger-codec.ts` never has to guess at an entry it does not know.
 * The transcript (`commitment` / `challenge` / `response`) carries no
 * cryptographic material a viewer could use to reconstruct anything.
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
  /**
   * [Issue #701] The challenge this transcript answered.
   *
   * Public by the time it is here -- the participant read it off their own
   * Order to compute the response. Publishing it is what makes the row a
   * TRANSCRIPT rather than two thirds of one: a reader can now check
   * `g^s == R * Y^e` themselves, and, more to the point, two transcripts that
   * reuse a commitment carry two different challenges, which is the pair of
   * linear equations `hunt-nonce` solves for the witness. With the challenge
   * bound to the match seed (#701) that pair is no longer derivable from public
   * material any other way, so without this field the nonce-reuse HUNT would
   * have quietly stopped being reachable by a participant.
   *
   * Optional so a row written before this version still decodes; the ledger
   * codec leaves it absent rather than inventing one.
   */
  readonly challenge?: string;
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
  /**
   * The published pair, as symbol VALUES. Rendered to pictures at the edge
   * (`ledgerPayload`, the board) from the rung's own alphabet — see
   * `OrderTask`'s `caesar-shift` arm on why presentation is not persisted.
   *
   * `pairsToBreak` is likewise not stored: it is a constant of the rung, and
   * `rungSpec(rung).pairsToBreak` is the one place that answers it.
   */
  readonly plaintext: readonly number[];
  readonly ciphertext: readonly number[];
  readonly postedAtMs: number;
}

/**
 * [Issue #709] One entry in the Public Ledger: the row, column or box the
 * judge opened after a successful PROVE.
 *
 * What is public here is exactly what ZK sudoku makes public: four cells of a
 * RELABELLED grid, plus which group they are. The digits are `π(S)`'s, not
 * `S`'s, and one group of a relabelled grid is a permutation of 1..4 whatever
 * the solution was -- so a single reveal says nothing about `S`. Two reveals
 * under the SAME relabelling start to say something, and `tag` is what makes
 * that reuse visible: equal tags, same π. See `fixtures.ts`'s
 * `derivePermutationTag` on why the tag reveals equality and nothing else.
 */
export interface SudokuRevealArtifact {
  readonly id: string;
  readonly teamId: string;
  readonly generation: number;
  readonly kind: "sudoku-reveal";
  readonly method: SubmissionMethod;
  readonly contractId: string;
  /** Which constraint group was opened: 0-3 rows, 4-7 columns, 8-11 boxes. */
  readonly group: number;
  /** The four digits of the RELABELLED grid in that group, in cell order. */
  readonly cells: readonly number[];
  /** Names the relabelling without revealing it -- equal tags, same π. */
  readonly tag: string;
  readonly postedAtMs: number;
}

export type PublicArtifact =
  | ShareArtifact
  | ProofArtifact
  | CiphertextArtifact
  | PartialArtifact
  | CipherPairArtifact
  | SudokuRevealArtifact;

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
  /** [Issue #3172] 表示名 (initialState 時点の roster 由来)。 未解決なら省略。 */
  readonly teamName?: string;
  readonly score: number;
  /** Increments on every successful ROTATE; shares/secret below are for THIS generation. */
  readonly generation: number;
  /** Stringified bigint -- see this file's header "JSON-SAFETY INVARIANT". */
  readonly secret: string;
  /** All `shareCount` shares for the current generation (only some may have been LEAKed). */
  readonly shares: readonly StoredShare[];
  readonly lastRotateAtMs: number | undefined;
  /**
   * [Issue #659] How many Orders have been ISSUED to this team, ever.
   *
   * The next Order's sequence index, and the counter that makes its id unique.
   * Held here rather than recomputed from `state.contracts.length`, which was
   * how `tick` used to get it: that made the id depend on how many Orders the
   * row still happens to contain, so anything that removes one -- pruning a
   * resolved Order, or a delayed tick skipping a slot whose deadline had
   * already passed -- rewound the counter and re-issued an id that already
   * existed. `validateOp` then resolved that id to the OLD row and refused a
   * live Order as "already completed".
   */
  readonly issuedOrderCount: number;
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
  /**
   * [Issue #709] This team's OWN generations whose sudoku solution an attacker
   * has recovered through a reused relabelling. Kept apart from
   * `huntedGenerations` for the same reason `cipherHuntedGenerations` is: a
   * different secret, broken a different way, and a participant has to be
   * able to tell which of theirs gave way. Absent on a row written before
   * #709; `migrateTeams` fills it in.
   */
  readonly sudokuHuntedGenerations?: readonly number[];
  /**
   * [Issue #709] This team's most recent PROVE, and whether the judge accepted
   * it. Same reason `lastHunt` exists: a wrong grid is a move that lands and is
   * charged, the SDK answers it `{ ok: true }` like a hit, and the projection
   * can only report what the state remembers.
   */
  readonly lastProve?: LastProve;
  /**
   * [Issue #696] This team's most recent Shamir HUNT, and whether it landed.
   *
   * Since #696 a wrong HUNT is a move that lands (charged, budget spent) rather
   * than a request `validateOp` refuses, so the plugin SDK answers it with the
   * same `{ ok: true }` it answers a hit with. The projection is a pure
   * function of state, so the only way the Portal can tell the two apart is
   * for the state to remember which one just happened. Absent on a row written
   * before this existed, and on a team that has never HUNTed -- both mean the
   * same thing: nothing to report.
   */
  readonly lastHunt?: LastHunt;
}

/** [Issue #696] What a Shamir HUNT came to -- see `TeamState.lastHunt`. */
export type HuntOutcome = "hit" | "miss";

/** [Issue #696] One HUNT, as the attacker's own record of it. */
export interface LastHunt {
  readonly targetTeamId: string;
  readonly generation: number;
  readonly outcome: HuntOutcome;
  /** [Issue #709] Which secret was hunted. Absent means the Shamir secret. */
  readonly via?: "sudoku";
}

/** [Issue #709] One PROVE, as the proving team's own record of it. */
export interface LastProve {
  readonly contractId: string;
  readonly outcome: "hit" | "miss";
}

export interface CryptoBattleState {
  readonly config: CryptoBattleConfig;
  readonly seed: string;
  readonly phase: Phase;
  /** Wall-clock time of the most recent tick(); undefined before the first tick. */
  readonly nowMs: number | undefined;
  /** Wall-clock time the match started (= the first tick's eventNowMs). */
  readonly startedAtMs: number | undefined;
  /**
   * [Issue #688] Teams that have said they are ready, while the match waits.
   *
   * Absent on a state written before this existed; treated as empty, which puts
   * such a match back in the same place it already was — waiting for someone to
   * start it.
   */
  readonly readyTeamIds?: readonly string[];
  readonly nextContractAtMs: number | undefined;
  readonly contracts: readonly Contract[];
  /**
   * [Issue #679] The PERSISTED form of the Public Ledger -- `StoredArtifact`
   * (`ledger-codec.ts`), not `PublicArtifact`. This is a deliberate exception
   * to this file's usual rule that `CryptoBattleState` holds the game's own
   * shapes directly: the ledger is 65.7% of a full match's persisted row
   * (`state-size.test.ts`), and about half of that used to be repeated key
   * names. `reducer.ts` encodes an artifact right before appending it here
   * and decodes at the two boundaries that need the full shape
   * (`projectForTeam`, `replay.ts`) -- see `ledger-codec.ts`'s header for the
   * whole design and why nothing about `PublicArtifact` itself, or
   * `CryptoBattleProjection.publicLedger` below, changed.
   */
  readonly publicLedger: readonly StoredArtifact[];
  readonly teams: Readonly<Record<string, TeamState>>;
  /**
   * [Issue #709] Every team's current-generation sudoku PUZZLE -- the eight
   * given cells of its solution, 0 for a hidden cell -- keyed by teamId.
   * Public by construction (unlike `TeamState.secret` / `.shares`): derived
   * once per team at `initialState` and re-derived on every ROTATE (see
   * reducer.ts's `applyRotate`), so it always reflects the team's *current*
   * generation the same way `TeamState.generation` does. Lives at the state's
   * top level, not inside `TeamState`, specifically so it is unambiguous that
   * this field -- unlike everything else `TeamState` holds -- is always safe
   * to hand to every team via `projectForTeam`.
   *
   * Optional on the type only because a row written before #709 has none;
   * `withMigratedContracts` derives it on first read, so every reducer path
   * below sees it present.
   */
  readonly publicPuzzles?: Readonly<Record<string, SudokuGrid>>;
  /**
   * Replay guard: `JSON.stringify([attackerTeamId, targetTeamId, generation])`
   * for every successful HUNT. JSON-encoded (not `|`-joined) so a team id
   * that happens to contain `|` can never collide with a different triple.
   */
  readonly successfulHunts: readonly string[];
  /**
   * [Issue #696] Attempts spent per `attacker:target:generation`, successful or
   * not, against `config.maxHuntAttemptsPerTarget`.
   *
   * Separate from `successfulHunts` because they answer different questions:
   * that one says "this pairing is finished", this one says "this pairing has
   * spent N of its tries". A row written before this field existed migrates to
   * `{}` -- an older match played in a 2^61 - 1 field where retries were
   * pointless, so crediting it a full budget takes nothing away from anyone.
   */
  readonly huntAttempts: Readonly<Record<string, number>>;
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
  /** [Issue #709] Which secret fell. Absent means the Shamir secret. */
  readonly via?: "sudoku";
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
   * [Issue #709] A HUNT that exploits a REUSED RELABELLING rather than
   * collected shares: two of the target's sudoku reveals in one generation
   * carry the same tag, so their cells belong to one `π(S)`, and lining those
   * cells up against the target's public puzzle recovers π and then `S`. A
   * separate op kind rather than a variant of "hunt" so each carries exactly
   * the evidence its own check needs, and so neither branch has to ask which
   * kind of hunt it is looking at. The successor of the nonce-reuse HUNT.
   */
  | {
      readonly kind: "hunt-sudoku";
      readonly targetTeamId: string;
      readonly generation: number;
      /** The target's recovered solution: 16 cells, row-major, each 1..4. */
      readonly solution: readonly number[];
    }
  | {
      readonly kind: "hunt";
      readonly targetTeamId: string;
      readonly generation: number;
      /**
       * Stringified bigint -- see this file's header "JSON-SAFETY INVARIANT".
       * `validateOp`'s "hunt" branch parses this with `decimal.ts`'s
       * `parseCanonicalDecimal` (the untrusted-decimal-parsing gate every
       * submitted number goes through) and rejects a malformed value with
       * `{ ok: false }` rather than throwing.
       */
      readonly recoveredSecret: string;
    }
  /**
   * [Issue #659] The ciphertext this team computed for a ladder Order.
   *
   * A separate op from `prove-sudoku` because it carries different evidence:
   * PROVE hands over a relabelled grid that shows knowledge of the solution
   * without revealing it, while this hands over the ANSWER and relies on the
   * judge already holding the key to check it. Both publish nothing an attacker
   * can use, and that shared property is what makes them both "do the work
   * yourself" methods -- but merging them would mean one branch asking which
   * kind of evidence it was looking at, which is what `hunt-sudoku`'s comment
   * above already argues against.
   *
   * Accepts pictures or their numeric values (see `parseAnswer`): a keyboard
   * that cannot type a dice face must not be a scoring disadvantage.
   */
  | { readonly kind: "cipher"; readonly contractId: string; readonly answer: readonly string[] }
  /**
   * [Issue #688] This team is ready. The match starts when every team has said
   * so — not when the first one does.
   *
   * `start` alone made the first team to press it start the match for everyone,
   * including teams that had not opened the portal yet: their Orders began
   * arriving and lapsing at -15 each while nobody was there. That is #677's
   * failure again, caused this time by another team rather than by the clock.
   */
  | { readonly kind: "ready" }
  /**
   * [Issue #677] Starts the match. Until this arrives the belt issues nothing
   * and the clock does not run, so a deployed-but-unplayed match stays exactly
   * as it was deployed.
   *
   * It is an op rather than a platform hook because only the players know when
   * they are ready, and the platform has no gesture that means "the room is
   * seated". The first team to send it starts the match for everyone, which is
   * the same thing a referee's whistle does.
   */
  | { readonly kind: "start" }
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
  /**
   * [Issue #659 §9] Open the next hint on one of this team's own open Orders,
   * and pay for it.
   *
   * Carries no level. Hints come in ladder order and the Order already knows
   * how many are open, so a level on the wire would be a second copy of that
   * number for the reducer to disagree with — and a participant-supplied index
   * to bounds-check. "Open the next one" cannot be out of range and cannot skip
   * ahead to the cheapest-per-word level.
   *
   * The charge lands whether or not the Order is ever answered. That is the
   * decision the move exists to pose: an Order you were going to let expire is
   * a bad one to buy help on.
   */
  | { readonly kind: "reveal-hint"; readonly contractId: string }
  | { readonly kind: "rotate" }
  /**
   * [Issue #709] PROVE: the team's sudoku solution with every digit relabelled
   * by a permutation the team chose itself.
   *
   * One op, because the protocol is no longer interactive: the judge holds the
   * solution and checks the whole grid, so there is no challenge to wait for
   * and nothing a prover could grind. What the judge then PUBLISHES -- one row,
   * column or box of this grid -- is chosen by the Order id, which the team
   * could not steer. A grid that is not a relabelling of the team's solution
   * lands, charges `scores.wrongProve`, and publishes nothing; a grid that IS
   * the solution, unrelabelled, is refused before it can cost anything,
   * because submitting it would publish four real cells for no reason.
   */
  | { readonly kind: "prove-sudoku"; readonly contractId: string; readonly grid: readonly number[] };

/**
 * [Issue #659 §9] One rung of an Order's hint ladder, as its owner sees it.
 *
 * `text` is present only for a level this team has actually opened. That is the
 * whole enforcement of the price: the Portal bundle ships to the browser, so
 * anything compiled into it is free to whoever opens devtools, and only the
 * side holding the state can withhold something. See `hints.ts`.
 */
export interface HintProjection {
  /** 0-based position in the ladder; hints open in this order. */
  readonly level: number;
  /** Stable `<task kind>/<level+1>` identifier — see `hints.ts`'s `HintSpec`. */
  readonly id: string;
  /** What opening this level costs, from `ScoreRules.hintCosts`. */
  readonly cost: number;
  /** Present iff opened. Both locales; the Portal picks (`projectForTeam` has none). */
  readonly text?: Readonly<Record<"ja" | "en", string>>;
}

export interface VaultProjection {
  readonly teamId: string;
  readonly secret: string;
  readonly shares: readonly StoredShare[];
  readonly generation: number;
  readonly lastRotateAtMs: number | undefined;
  readonly rotateCooldownRemainingMs: number;
  readonly completedContractIds: readonly string[];
  readonly huntedGenerations: readonly number[];
  /**
   * [Issue #709] This team's own 4x4 sudoku solution for the current
   * generation -- 16 cells, row-major, each 1..4. The thing PROVE relabels.
   */
  readonly sudokuSolution: SudokuGrid;
  /**
   * [Issue #709] The relabellings this team has ALREADY used on reveals of
   * the current generation, oldest first, so it can avoid reusing one. There
   * are only 24, so a team that does not keep track will collide by accident;
   * this is the judge keeping track for them. Recovered by the trusted side
   * from the tags on the ledger (it holds the seed; nobody else can do this).
   */
  readonly usedPermutations: readonly Permutation[];
  /** [Issue #709] Generations whose solution an attacker recovered. */
  readonly sudokuHuntedGenerations: readonly number[];
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
      /**
       * The symbols to encrypt, as VALUES.
       *
       * Values rather than pictures because the Portal DRAWS them (see
       * `DieFace.tsx`): shipped as Unicode die faces they rendered as tofu on a
       * real participant's screen, which fails #659 §3's whole argument in the
       * worst way — the reader cannot see the Order at all. A drawn symbol
       * depends on no font.
       */
      readonly plaintext: readonly number[];
      /**
       * The rung's alphabet, in value order. Its length is the modulus.
       *
       * Kept as strings because this is what a participant may TYPE:
       * `parseAnswer` accepts either a face or its value, so the legend has to
       * show the characters the input will recognise.
       */
      readonly symbols: readonly string[];
      /** How many published pairs recover the key on this rung (#659 §2). */
      readonly pairsToBreak: number;
      /** THIS team's key for the rung, at its current generation. */
      readonly myKey: number;
    }
  /**
   * [Issue #709] Nothing to add: the solution is on the vault and the puzzle
   * is public. Kept as its own arm so a card can name the job.
   */
  | { readonly kind: "zk-sudoku" };

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
  /**
   * [Issue #659 §9] This Order's hint ladder, every level, with the text filled
   * in only for the levels this team has bought. Always the full ladder, so the
   * Portal can show what the NEXT hint costs before it is bought — a price the
   * player cannot see is not a price they can weigh.
   */
  readonly hints: readonly HintProjection[];
}

/**
 * [Issue #696] The reader's own HUNT budget against ONE other team's CURRENT
 * generation -- see `CryptoBattleProjection.huntAttempts`.
 */
export interface HuntBudgetProjection {
  /** The generation these attempts count against; a ROTATE starts a fresh one. */
  readonly generation: number;
  /** Attempts already spent, hit or miss. */
  readonly spent: number;
  /** `config.maxHuntAttemptsPerTarget`. */
  readonly max: number;
}

export interface TeamSummaryProjection {
  readonly teamId: string;
  /**
   * [Issue #3172] 表示名。 未解決なら teamId のまま (= 従来と同じ見え方)。
   * 試合開始後の改名は反映されない — ctx を受け取る hook が `initialState` だけのため。
   */
  readonly teamName: string;
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
  /**
   * [Issue #682] How many shares of one generation reconstruct a secret.
   *
   * On the projection for the same reason `prime` is: the Portal has to tell a
   * participant how close a team is to being hunted ("2 / 3"), and a threshold
   * it hardcoded would be a game rule the Portal was told out-of-band — exactly
   * what `prime`'s comment above argues against. It is public by construction:
   * the problem statement says three, and `config.threshold` is what every
   * `reconstruct` call already uses.
   */
  readonly threshold: number;
  /**
   * [Issue #688] While the match waits: how many teams have said they are
   * ready, out of how many. The waiting screen has to name what it is waiting
   * for — "1 / 2 準備完了" is the difference between a button that seems broken
   * and one that is obviously waiting for someone else.
   */
  readonly ready: { readonly count: number; readonly total: number; readonly me: boolean };
  readonly vault: VaultProjection;
  readonly myContracts: readonly ContractProjection[];
  readonly otherOpenContractCount: number;
  readonly publicLedger: readonly PublicArtifact[];
  readonly teams: Readonly<Record<string, TeamSummaryProjection>>;
  /**
   * [Issue #709] Every team's current-generation sudoku puzzle -- see
   * `CryptoBattleState.publicPuzzles`. Public by construction, safe for every
   * team to see, and the thing a hunter lines a reused relabelling up against.
   */
  readonly publicPuzzles: Readonly<Record<string, SudokuGrid>>;
  /**
   * [Issue #696] MY HUNT attempts against every OTHER team, keyed by that
   * team's id, for its current generation.
   *
   * The cap (`config.maxHuntAttemptsPerTarget`) is what makes a hand-sized
   * field sound, and a cap the player cannot see is a wall they walk into: the
   * Portal has to show "2 of 3 left" BEFORE the attempt is spent, and "-8, 1
   * left" after a miss. Deliberately only the reader's own attempts -- what
   * some third team has tried against a target is not on this record, the same
   * way `teams` carries scores and generations but not `huntAttempts`.
   */
  readonly huntAttempts: Readonly<Record<string, HuntBudgetProjection>>;
  /**
   * [Issue #709] MY sudoku-HUNT attempts against every other team, same shape
   * and same reason as `huntAttempts`. A separate budget: it is a different
   * secret, and spending three Shamir guesses must not lock out a legitimate
   * relabelling recovery (or the other way round).
   */
  readonly sudokuHuntAttempts: Readonly<Record<string, HuntBudgetProjection>>;
  /**
   * [Issue #696] What a wrong HUNT costs -- `config.scores.wrongHunt`. On the
   * projection for the same reason `threshold` is: the miss banner has to
   * print the real number, not one the Portal was told out-of-band.
   */
  readonly wrongHuntCost: number;
  /** [Issue #709] What a wrong PROVE costs -- `config.scores.wrongProve`. */
  readonly wrongProveCost: number;
  /**
   * [Issue #696] The reader's most recent Shamir HUNT, if any -- see
   * `TeamState.lastHunt`. This is the field that lets the Portal tell a hit
   * from a miss after an op the SDK answered `{ ok: true }` either way.
   * Never another team's: `projectForTeam` reads it off the reader's own row.
   */
  readonly lastHunt?: LastHunt;
  /** [Issue #709] The reader's most recent PROVE, if any -- see `TeamState.lastProve`. */
  readonly lastProve?: LastProve;
}
