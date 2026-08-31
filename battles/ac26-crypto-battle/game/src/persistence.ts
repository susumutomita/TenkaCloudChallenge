/**
 * [Issue #659] What actually gets WRITTEN, as opposed to what the reducer works
 * with.
 *
 * ## Why this file exists
 *
 * The whole match — every team, every Order, the entire public record — is one
 * row, keyed `tenant x event x problem x run`, and it is read AND rewritten on
 * every single participant action. On the Turso backend that row rides in an
 * HTTP request body each time (`@libsql/client/http`); on DynamoDB a single
 * item is additionally capped at 400 KB.
 *
 * Measured before this file existed, at the platform's maximum of 99 teams
 * (`teams.max(99)`, from DynamoDB's 100-item TransactWrite limit): **4.49 MB**,
 * or 45.4 KB per team. Orders were 72% of it and the public record 24%. That is
 * not a tuning problem — a 4.5 MB read-modify-write per click is broken at any
 * item limit.
 *
 * ## The rule
 *
 * Persist only what cannot be recomputed. Everything in this Battle derives
 * from three things: the match `seed`, the `config`, and the choices
 * participants actually made. The first two are already in the row once; the
 * third is small. Everything else — an Order's task, its points, its deadline,
 * its allowed methods, a team's public commitment, the share value behind a
 * ledger entry — is a pure function of those, and storing it is storing the
 * same information tens of thousands of times.
 *
 * So the reducer keeps working with the full, convenient shapes, and this
 * module is the boundary: {@link compactState} on the way out,
 * {@link expandState} on the way in. Nothing else in the game has to know.
 *
 * ## What is dropped outright, and why that is safe
 *
 * Terminal Orders past a retention window. An Order that was answered has
 * already paid into `team.score`, and one that lapsed has already been charged
 * — the score is authoritative and is stored. The only thing a resolved Order
 * is still needed for is refusing a second submission against it, and
 * `completedSequences` keeps exactly that, as integers. Nothing reads an old
 * expired Order: `replay.ts` builds its debrief from the ledger and the hunt
 * log, not from `state.contracts`.
 *
 * The public record is NEVER pruned. #659 §10 makes the fact that it does not
 * disappear the source of LEAK's weight, and ROTATE is the only thing that may
 * devalue it. Compacting how a row is WRITTEN is not the same as deleting it,
 * so entries are stored by reference and rebuilt on read.
 */

import { deriveTeamGeneration } from "./fixtures.ts";
import type {
  Contract,
  CryptoBattleState,
  PublicArtifact,
  StoredShare,
  TeamState,
} from "./types.ts";

/**
 * How many issue intervals of terminal Orders to keep.
 *
 * Not zero: a participant's own board shows what just lapsed, and cutting that
 * to nothing would make an Order vanish the instant its deadline passed, with
 * no chance to see that it did. Two batches is enough to see the last round and
 * the one before it, and bounds the list at `contractsPerIssue x 3` per team
 * instead of letting it grow all match.
 */
export const TERMINAL_ORDER_RETENTION_BATCHES = 2;

/** The Order fields that are NOT recomputable from `(seed, teamId, sequence)`. */
export interface PersistedOrder {
  /** `${teamId}-c${sequence}` — carries the team and the sequence index. */
  readonly id: string;
  /**
   * Kept rather than derived from the schedule: a delayed tick skips slots
   * whose deadline already passed, so sequence index does not map cleanly back
   * to an issue instant (see `tick`).
   */
  readonly at: number;
  readonly st: Contract["status"];
  readonly re?: Contract["resolution"];
  readonly ec?: Contract["expiryCause"];
}

/** A ledger entry, by reference. Everything else is recomputed. */
export interface PersistedArtifact {
  readonly k: PublicArtifact["kind"];
  readonly c: string;
  readonly g: number;
  readonly t: number;
  /** `share` only: which index was published. Its VALUE is derived. */
  readonly i?: number;
  /** Payload that is genuinely participant-supplied and cannot be recomputed. */
  readonly p?: readonly string[];
}

/** The team fields that are not recomputable. */
export interface PersistedTeam {
  readonly score: number;
  readonly generation: number;
  readonly lastRotateAtMs?: number;
  /** Sequence indices of Orders this team completed — the double-submit guard. */
  readonly done: readonly number[];
  readonly hunted: readonly number[];
  readonly cipherHunted: Readonly<Record<string, readonly number[]>>;
}

/** Split `${teamId}-c${sequence}` back into its parts. */
export function splitOrderId(id: string): { teamId: string; sequence: number } | undefined {
  const at = id.lastIndexOf("-c");
  if (at < 0) return undefined;
  const sequence = Number(id.slice(at + 2));
  if (!Number.isInteger(sequence) || sequence < 0) return undefined;
  return { teamId: id.slice(0, at), sequence };
}

/** A team's shares for one generation, recomputed rather than stored. */
export function sharesFor(
  seed: string,
  teamId: string,
  generation: number,
  field: Parameters<typeof deriveTeamGeneration>[3],
): { readonly secret: string; readonly shares: readonly StoredShare[] } {
  const { secret, shares } = deriveTeamGeneration(seed, teamId, generation, field);
  return {
    secret: secret.toString(),
    shares: shares.map((s): StoredShare => ({ index: s.index, value: s.value.toString() })),
  };
}

/** Whether a persisted row is already in the compact shape. */
export function isCompact(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    Array.isArray((state as { orders?: unknown }).orders)
  );
}

export interface CompactState {
  readonly v: 2;
  readonly config: CryptoBattleState["config"];
  readonly seed: string;
  readonly nowMs: number | undefined;
  readonly startedAtMs: number | undefined;
  readonly nextContractAtMs: number | undefined;
  readonly orders: readonly PersistedOrder[];
  readonly ledger: readonly PersistedArtifact[];
  readonly teams: Readonly<Record<string, PersistedTeam>>;
  readonly successfulHunts: readonly string[];
  readonly huntLog: CryptoBattleState["huntLog"];
}

/** The team fields worth carrying; the rest are recomputed on read. */
export function compactTeam(team: TeamState, completedSequences: readonly number[]): PersistedTeam {
  return {
    score: team.score,
    generation: team.generation,
    ...(team.lastRotateAtMs === undefined ? {} : { lastRotateAtMs: team.lastRotateAtMs }),
    done: completedSequences,
    hunted: team.huntedGenerations,
    cipherHunted: team.cipherHuntedGenerations,
  };
}
