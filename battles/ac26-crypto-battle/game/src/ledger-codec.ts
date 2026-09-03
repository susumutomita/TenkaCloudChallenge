/**
 * [Issue #679 / TenkaCloud#3152] The `publicLedger`'s PERSISTED form, kept
 * separate from its in-memory / participant-facing form.
 *
 * `CryptoBattleState` is one row, rewritten on every op (see reducer.ts's
 * header "WIRE BOUNDARY"), and `state-size.test.ts`'s worst case measured
 * `publicLedger` at 1081.4 KB of a 1644.7 KB row (99 teams) -- 65.7%, and
 * about half of THAT is repeated key names: `teamId` / `contractId` /
 * `generation` / `method` / `postedAtMs` / `shareIndex` / `value` /
 * `contractId` again, spelled out in full on every one of 5377 entries. This
 * module is the fix: it changes HOW that same information is written, never
 * WHAT is written -- ledger contents are never dropped (see this repo's
 * Issue #659 §10 on why persistence is the point of this Battle at all).
 *
 * `StoredArtifact` (this file) is `CryptoBattleState.publicLedger`'s actual
 * element type -- not a wire wrapper applied at a serialization boundary
 * outside the reducer. There is no such boundary: the platform dispatcher
 * persists whatever `CryptoBattleState` the reducer returns, byte for byte
 * (`coordination-state-schema.ts` on the TenkaCloud side reads/writes
 * `row.state` directly). So `reducer.ts` itself holds compact entries in
 * `state.publicLedger` between calls, and only ever expands them back to
 * `PublicArtifact` at the two boundaries that need the full shape:
 * `projectForTeam` (participant-facing projection) and `replay.ts` (the
 * post-match debrief). Everything else in `reducer.ts` -- including the HUNT
 * nonce-reuse scan -- reads the compact form directly where it can, so the
 * hot path never pays for a full-array decode it does not need.
 *
 * KEY MAP (values unchanged, only field names shrink):
 *
 * | PublicArtifact  | Stored | kinds it applies to     |
 * |-----------------|--------|--------------------------|
 * | `id`            | (none) | derived, see below       |
 * | `kind`          | `k`    | all                       |
 * | `teamId`        | `tm`   | all                       |
 * | `contractId`    | `c`    | all                       |
 * | `generation`    | `g`    | all                       |
 * | `method`        | `m`    | all                       |
 * | `postedAtMs`    | `t`    | all                       |
 * | `shareIndex`    | `i`    | share                     |
 * | `value`         | `v`    | share                     |
 * | `rung`          | `r`    | cipher-pair               |
 * | `plaintext`     | `p`    | cipher-pair               |
 * | `ciphertext`    | `x`    | cipher-pair               |
 * | `commitment`    | `o`    | proof                     |
 * | `challenge`     | `e`    | proof (Schnorr's own "e")  |
 * | `response`      | `z`    | proof (Schnorr's own "z = k + e*w") |
 * | `r`             | `r`    | ciphertext (ElGamal-style r, unrelated to cipher-pair's `r`=rung -- safe, the two never share a `k`) |
 * | `y`             | `y`    | ciphertext                |
 * | `partial`       | `v`    | partial (same "the one published number" role `v` plays for share) |
 * | `peerPartials`  | `pp`   | partial                   |
 * | `total`         | `s`    | partial (sum)             |
 *
 * The common fields (`kind`/`teamId`/`contractId`/`generation`/`method`/
 * `postedAtMs`) and share/cipher-pair's own keys are pinned by the design
 * doc this module implements (Issue #679). `teamId` -> `tm` in particular is
 * NOT optional: `contractId` cannot stand in for it, because Order retention
 * (`TERMINAL_ORDER_RETENTION_BATCHES`, reducer.ts) prunes completed/expired
 * Contracts out of `state.contracts` well before a match ends, so a reader
 * trying to recover "whose artifact is this" from `contractId` alone fails
 * for most of the ledger by the time anyone looks -- measured directly
 * against this package's own `state-size.test.ts` worst case: 4782 of 5377
 * entries' contracts (89%) are already gone. proof/ciphertext/partial's own
 * keys (`o`/`z`/`r`/`y`/`v`/`pp`/`s`) are this module's own choice -- the
 * design doc's table stops at share/cipher-pair and explicitly delegates
 * "read the construction site and derive the same kind of compact mapping"
 * for the rest; the choices above keep every kind's own key set collision-
 * free and, where a name already existed in `PublicArtifact` at one
 * character (`r`/`y` on `CiphertextArtifact`), keep it unchanged rather than
 * invent a shorter one that does not exist.
 */

import type { CipherRung } from "./ladder.ts";
import type { SubmissionMethod } from "./methods.ts";
import type {
  CipherPairArtifact,
  CiphertextArtifact,
  CryptoBattleState,
  PartialArtifact,
  ProofArtifact,
  PublicArtifact,
  ShareArtifact,
} from "./types.ts";

/**
 * Fields every `StoredArtifact` kind carries, PLUS the `d` escape hatch.
 *
 * `d` is never set by `encodeArtifact` below when {@link deriveArtifactId}
 * reconstructs the entry's real `PublicArtifact.id` exactly -- which, as of
 * this module, is every kind reducer.ts constructs (see `deriveArtifactId`'s
 * doc comment for how that was verified, and `ledger-codec.test.ts`'s "no
 * entry needs `d`" test, which re-checks it live against every artifact a
 * real match produces, not just this comment's claim). It exists so a FUTURE
 * id template change in reducer.ts that this module's derivation formula
 * does not know about fails safe -- the id is kept, never silently dropped
 * (Issue #679's design doc: "推測で落とさないこと"). Encoded as `d` (short:
 * this is the rare-to-never path, so it still pays the compact-key rent),
 * and NEVER written as `d: undefined` -- `encodeArtifact` uses a conditional
 * spread specifically so an absent id-mismatch never becomes a present
 * `undefined` key (which would make `JSON.stringify` round-trips and
 * `toEqual` disagree about whether the field exists).
 */
interface StoredArtifactBase {
  readonly tm: string;
  readonly c: string;
  readonly g: number;
  readonly m: SubmissionMethod;
  readonly t: number;
  readonly d?: string;
}

export interface StoredShareArtifact extends StoredArtifactBase {
  readonly k: "share";
  readonly i: number;
  readonly v: string;
}

export interface StoredCipherPairArtifact extends StoredArtifactBase {
  readonly k: "cipher-pair";
  readonly r: CipherRung;
  readonly p: readonly number[];
  readonly x: readonly number[];
}

export interface StoredProofArtifact extends StoredArtifactBase {
  readonly k: "proof";
  readonly o: string;
  /** [Issue #701] The challenge `e`. Absent on a row written before #701. */
  readonly e?: string;
  readonly z: string;
}

export interface StoredCiphertextArtifact extends StoredArtifactBase {
  readonly k: "ciphertext";
  readonly r: string;
  readonly y: string;
}

export interface StoredPartialArtifact extends StoredArtifactBase {
  readonly k: "partial";
  readonly v: string;
  readonly pp: readonly string[];
  readonly s: string;
}

/**
 * `CryptoBattleState.publicLedger`'s actual element type -- see this file's
 * header. One variant per `PublicArtifact` kind, discriminated on `k` the
 * same way `PublicArtifact` discriminates on `kind`.
 */
export type StoredArtifact =
  | StoredShareArtifact
  | StoredCipherPairArtifact
  | StoredProofArtifact
  | StoredCiphertextArtifact
  | StoredPartialArtifact;

/**
 * Reconstructs `PublicArtifact.id` from a `StoredArtifact` that carries no
 * `d` -- the whole reason `id` can be dropped from the persisted form at
 * all. Each arm below is copied from the ONE place in reducer.ts that ever
 * builds that kind's `id` (verified by reading, not inferred):
 *
 *   - "share":       reducer.ts `applyLeak`        -- `` `${contract.id}-share${shareIndex}` ``
 *   - "cipher-pair": reducer.ts `applyLadderLeak`   -- `` `${contract.id}-pair` ``
 *   - "proof":       reducer.ts `applyProve`        -- `` `${contract.id}-proof` ``
 *   - "ciphertext":  reducer.ts `applyFhe`           -- `` `${contract.id}-ciphertext` ``
 *   - "partial":     reducer.ts `applyMpc`           -- `` `${contract.id}-partial` ``
 *
 * Every one of these five is the ONLY construction site for its
 * `PublicArtifact` kind in `game/src` (confirmed: `grep -n 'kind: "<kind>"'
 * across game/src/*.ts, non-test, returns exactly one hit per kind, all in
 * reducer.ts) -- so there is exactly one template to match per kind, not a
 * family of call sites that could disagree with each other. Whether any of
 * these five templates ever CHANGED in the past (a `git log -S` question)
 * was not checked, and does not matter for correctness either way: an
 * in-flight v1 row an id template changed under would still migrate cleanly,
 * because `encodeArtifact`'s live comparison (see below) keeps `d` on any
 * entry whose real id does not match this function's current formula --
 * nothing from before this module existed can silently lose its id, whether
 * or not the template ever moved.
 */
function deriveArtifactId(stored: StoredArtifact): string {
  switch (stored.k) {
    case "share":
      return `${stored.c}-share${stored.i}`;
    case "cipher-pair":
      return `${stored.c}-pair`;
    case "proof":
      return `${stored.c}-proof`;
    case "ciphertext":
      return `${stored.c}-ciphertext`;
    case "partial":
      return `${stored.c}-partial`;
    default: {
      const exhaustive: never = stored;
      throw new Error(`deriveArtifactId: unknown stored artifact ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * One `PublicArtifact` -> its persisted `StoredArtifact` form. See this
 * file's header for the key map.
 *
 * `derivedId`'s comparison against `artifact.id` is the live half of this
 * module's "never drop an id we cannot reconstruct" guarantee: it runs on
 * EVERY artifact this package ever encodes, not just in a test.
 */
export function encodeArtifact(artifact: PublicArtifact): StoredArtifact {
  const base = {
    tm: artifact.teamId,
    c: artifact.contractId,
    g: artifact.generation,
    m: artifact.method,
    t: artifact.postedAtMs,
  };
  let withoutId: StoredArtifact;
  switch (artifact.kind) {
    case "share":
      withoutId = { ...base, k: "share", i: artifact.shareIndex, v: artifact.value };
      break;
    case "cipher-pair":
      withoutId = {
        ...base,
        k: "cipher-pair",
        r: artifact.rung,
        p: artifact.plaintext,
        x: artifact.ciphertext,
      };
      break;
    case "proof":
      withoutId = {
        ...base,
        k: "proof",
        o: artifact.commitment,
        ...(artifact.challenge === undefined ? {} : { e: artifact.challenge }),
        z: artifact.response,
      };
      break;
    case "ciphertext":
      withoutId = { ...base, k: "ciphertext", r: artifact.r, y: artifact.y };
      break;
    case "partial":
      withoutId = {
        ...base,
        k: "partial",
        v: artifact.partial,
        pp: artifact.peerPartials,
        s: artifact.total,
      };
      break;
    default: {
      const exhaustive: never = artifact;
      throw new Error(`encodeArtifact: unknown artifact ${JSON.stringify(exhaustive)}`);
    }
  }
  const derivedId = deriveArtifactId(withoutId);
  return derivedId === artifact.id ? withoutId : { ...withoutId, d: artifact.id };
}

/** `readonly PublicArtifact[]` -> `StoredArtifact[]`, entry by entry. */
export function encodeLedger(entries: readonly PublicArtifact[]): StoredArtifact[] {
  return entries.map(encodeArtifact);
}

/** One `StoredArtifact` -> the `PublicArtifact` it was encoded from. */
export function decodeArtifact(stored: StoredArtifact): PublicArtifact {
  const id = stored.d ?? deriveArtifactId(stored);
  const { tm: teamId, c: contractId, g: generation, m: method, t: postedAtMs } = stored;
  switch (stored.k) {
    case "share":
      return { id, kind: "share", teamId, contractId, generation, method, postedAtMs, shareIndex: stored.i, value: stored.v };
    case "cipher-pair":
      return {
        id,
        kind: "cipher-pair",
        teamId,
        contractId,
        generation,
        method,
        postedAtMs,
        rung: stored.r,
        plaintext: stored.p,
        ciphertext: stored.x,
      } satisfies CipherPairArtifact;
    case "proof":
      return {
        id,
        kind: "proof",
        teamId,
        contractId,
        generation,
        method,
        postedAtMs,
        commitment: stored.o,
        ...(stored.e === undefined ? {} : { challenge: stored.e }),
        response: stored.z,
      } satisfies ProofArtifact;
    case "ciphertext":
      return {
        id,
        kind: "ciphertext",
        teamId,
        contractId,
        generation,
        method,
        postedAtMs,
        r: stored.r,
        y: stored.y,
      } satisfies CiphertextArtifact;
    case "partial":
      return {
        id,
        kind: "partial",
        teamId,
        contractId,
        generation,
        method,
        postedAtMs,
        partial: stored.v,
        peerPartials: stored.pp,
        total: stored.s,
      } satisfies PartialArtifact;
    default: {
      const exhaustive: never = stored;
      throw new Error(`decodeArtifact: unknown stored artifact ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** `readonly StoredArtifact[]` -> `PublicArtifact[]`, entry by entry. */
export function decodeLedger(stored: readonly StoredArtifact[]): PublicArtifact[] {
  return stored.map(decodeArtifact);
}

/**
 * [TenkaCloud Issue #3150] Lifts a v1-schema `CryptoBattleState` (the shape
 * this package wrote before this module existed: `publicLedger` as full
 * `PublicArtifact[]`) to v2 (`publicLedger` as `StoredArtifact[]`).
 *
 * Wired as `coordination/crypto-battle.ts`'s `migrateState`, alongside
 * `stateSchemaVersion: 2` -- see that file and TenkaCloud's
 * `packages/coordination-plugin-sdk/src/index.ts` for the platform contract
 * this fulfills: `migrateState` is REQUIRED once `stateSchemaVersion` is
 * declared (a plugin that skips it is rejected at load, before any row is
 * touched), must be a pure function of `(state, fromVersion)` with no `ctx`,
 * and a thrown error must leave the row completely untouched (no
 * `initialState`, no write, no reset) rather than risk repairing it wrong --
 * so this function THROWS on anything it does not recognize instead of
 * trying to patch it up. It performs exactly one transformation --
 * `publicLedger: encodeLedger(v1.publicLedger)` -- and spreads every other
 * field unchanged; it is deliberately not where Contract-shape repairs
 * happen (that is `tick()`'s own job, see `migration.test.ts`), so a
 * migration failure and a self-repair failure are never the same failure.
 *
 * The one case this package can actually be asked to migrate is
 * `fromVersion === 1` (there has never been a schema version before this
 * one), so that is the only case handled; anything else throws rather than
 * guess at an intermediate shape nothing ever wrote.
 */
/**
 * `method` の無い #650 以前の artifact に `method` を戻す。
 *
 * `PublicArtifact.method` は #650 (`3838e52`, 2026-08-30) で入りました。 それ以前に書かれた行の
 * share / proof はこのフィールドを持ちません。 型の上では必須なので素通りしますが、 portal は
 * `entry.method === "leak" && entry.kind === "share"` で「晒された share」を判定しており
 * (`portal/GameBoard.tsx`)、 `undefined` は `protected` 側に落ちます -- **晒したはずの share が
 * 守られているように見える**。 行の TTL は 7 日なので、 #650 の直後しばらくはこの形の行が実在します。
 *
 * 補完は推測ではありません。 `method` を欠きうる kind は `share` (#490) と `proof` (#492) だけで、
 * `cipher-pair` (#661) / `ciphertext` / `partial` (#651) はいずれも #650 より後に入っています。
 * そして #650 以前は share の出所が LEAK、 proof の出所が PROVE の 1 経路ずつしかありません。
 *
 * ここ (移行) でだけ行い、 `encodeArtifact` は忠実なままにしてあります。 encode は「今ある値を
 * そのまま書く」のが仕事で、 古い形の解釈は移行の仕事だからです。
 */
function normalizePreMethodArtifact(artifact: PublicArtifact): PublicArtifact {
  if ((artifact as { readonly method?: unknown }).method !== undefined) return artifact;
  if (artifact.kind === "share") return { ...artifact, method: "leak" };
  if (artifact.kind === "proof") return { ...artifact, method: "prove" };
  return artifact;
}

export function migrateStateV1(state: unknown, fromVersion: number): CryptoBattleState {
  if (fromVersion !== 1) {
    throw new Error(
      `ledger-codec: migrateStateV1 cannot migrate from schema version ${fromVersion} (only v1 -> v2 is defined)`,
    );
  }
  if (typeof state !== "object" || state === null) {
    throw new Error("ledger-codec: migrateStateV1 received a non-object v1 state");
  }
  const v1 = state as { readonly publicLedger?: unknown } & Record<string, unknown>;
  if (!Array.isArray(v1.publicLedger)) {
    throw new Error("ledger-codec: migrateStateV1: v1 state is missing a publicLedger array");
  }
  return {
    ...v1,
    publicLedger: encodeLedger(
      (v1.publicLedger as readonly PublicArtifact[]).map(normalizePreMethodArtifact),
    ),
  } as unknown as CryptoBattleState;
}
