/**
 * Post-match debrief / replay reconstruction (Issue #486 PR5, "120分
 * debrief / Replay" section).
 *
 * `buildReplay(state)` reconstructs a time-ordered list of `ReplayEvent`s
 * from a `CryptoBattleState` -- the worked example in Issue #486 is
 * literally a chronological move log ("34:10 Team A LEAK share #1", ...,
 * "58:01 Team B HUNT success"). `keyMoments(replay, state)` then annotates
 * that list with the specific causal moments a debrief facilitator would
 * want to point at ("this LEAK is what crossed the threshold", "this
 * ROTATE is what invalidated N leaks").
 *
 * **NOT for the live participant portal.** This module runs against the
 * FULL, trusted-side `CryptoBattleState` -- unlike `projectForTeam`
 * (reducer.ts's only sanctioned participant read path), it deliberately
 * does not redact team-vs-team, because a replay's entire purpose is to
 * show what happened across every team, after the fact. That is exactly
 * why it must never be wired into anything a participant sees mid-match
 * (`portal/StatusPanel.tsx` etc. -- see OPERATOR.md's "Portal UI wiring"
 * section on the "does not leak the answer" principle this would otherwise
 * violate outright). It is meant for the 105-120 min debrief window Issue
 * #486 describes, run by an organizer/facilitator after (or, at the
 * earliest, well into) the match -- see this repo's OPERATOR.md for the
 * organizer-facing framing.
 *
 * Even though this module CAN see everything in `state`, it never reads a
 * team's `secret` or any un-leaked `share` value -- only what already
 * became public during the match (`state.publicLedger`, `state.huntLog`)
 * plus non-secret bookkeeping (`score`, `generation`, phase timing derived
 * from `config`). `replay.test.ts`'s secret-non-leakage test pins this down
 * the same way `prove.test.ts` / `adversarial.test.ts` pin the equivalent
 * property for `projectForTeam`.
 *
 * **What cannot be reconstructed from `state` alone** (do not fabricate
 * these -- if a caller needs them, they need a wider trusted-side event log
 * this package does not keep):
 *   - **Failed HUNT attempts.** `validateOp` rejecting a hunt op leaves
 *     ZERO trace anywhere in `state` -- there is no "attempted, wrong
 *     guess" log, only `state.huntLog`'s successes (see that field's doc
 *     comment in types.ts for why it exists at all). A replay can show
 *     "Team B's HUNT succeeded here", never "Team B tried and missed at
 *     12:03".
 *   - **Failed / rejected LEAK or PROVE attempts.** Same reason -- only a
 *     COMPLETED contract shows up (as a `ShareArtifact` / `ProofArtifact`
 *     on the ledger); a rejected attempt (wrong team, already completed,
 *     bad proof) is invisible to this module.
 *   - **Every ROTATE timestamp except the most recent one per team.**
 *     `TeamState.lastRotateAtMs` is a single value, overwritten on every
 *     rotate -- if a team rotated 3 times, only the 3rd rotate's timestamp
 *     survives in state. `buildReplay` emits at most one "rotate" event per
 *     team (from `lastRotateAtMs`); its `detail.priorRotateCount` reports
 *     how many total rotates are implied by `generation - 1`, and its
 *     summary text says so explicitly when that count is more than 1,
 *     rather than silently under-reporting.
 *   - **"a team looked at the ledger and chose not to act."** No state
 *     anywhere records inspection/consideration, only completed moves.
 *   - **Expired-but-never-attempted contracts** are visible directly on
 *     `state.contracts` (status `"expired"`, real `expiresAtMs`) but are
 *     deliberately NOT synthesized into a `ReplayEvent` here -- Issue
 *     #486's own replay example, and PR5's `ReplayEvent` sketch, name only
 *     leak / prove / hunt-success / rotate / phase transitions as replay
 *     event kinds; an operator who wants expiry detail can read
 *     `state.contracts` directly.
 */

import type { CryptoBattleState, Phase } from "./types.ts";

interface ReplayEventBase {
  readonly atMs: number;
  readonly summary: { readonly ja: string; readonly en: string };
}

export type ReplayEvent =
  | (ReplayEventBase & {
      readonly kind: "leak";
      readonly teamId: string;
      readonly detail: { readonly contractId: string; readonly shareIndex: number; readonly generation: number };
    })
  | (ReplayEventBase & {
      readonly kind: "prove";
      readonly teamId: string;
      readonly detail: { readonly contractId: string; readonly generation: number };
    })
  | (ReplayEventBase & {
      readonly kind: "hunt-success";
      readonly teamId: string;
      readonly detail: { readonly targetTeamId: string; readonly generation: number };
    })
  | (ReplayEventBase & {
      readonly kind: "rotate";
      readonly teamId: string;
      readonly detail: { readonly generation: number; readonly priorRotateCount: number };
    })
  | (ReplayEventBase & {
      readonly kind: "phase-change";
      readonly teamId?: undefined;
      readonly detail: { readonly phase: Phase };
    });

/**
 * Reconstruct a time-ordered `ReplayEvent[]` from `state` -- see this
 * module's header for exactly what is (and is not) reconstructable this
 * way. Pure: reads only its argument, same purity contract as `reducer.ts`
 * (see that file's header) -- calling this twice on the same `state`
 * returns deeply-equal results.
 */
export function buildReplay(state: CryptoBattleState): ReplayEvent[] {
  const events: ReplayEvent[] = [];

  for (const artifact of state.publicLedger) {
    if (artifact.kind === "share") {
      events.push({
        atMs: artifact.postedAtMs,
        teamId: artifact.teamId,
        kind: "leak",
        summary: {
          en: `Team ${artifact.teamId} LEAK share #${artifact.shareIndex} (generation ${artifact.generation})`,
          ja: `${artifact.teamId} が LEAK: share #${artifact.shareIndex} (世代 ${artifact.generation})`,
        },
        detail: { contractId: artifact.contractId, shareIndex: artifact.shareIndex, generation: artifact.generation },
      });
    } else {
      events.push({
        atMs: artifact.postedAtMs,
        teamId: artifact.teamId,
        kind: "prove",
        summary: {
          en: `Team ${artifact.teamId} PROVE contract ${artifact.contractId} (generation ${artifact.generation}) -- no secret material revealed`,
          ja: `${artifact.teamId} が PROVE: contract ${artifact.contractId} (世代 ${artifact.generation}) -- secret は非公開のまま`,
        },
        detail: { contractId: artifact.contractId, generation: artifact.generation },
      });
    }
  }

  for (const hunt of state.huntLog) {
    events.push({
      atMs: hunt.atMs,
      teamId: hunt.attackerTeamId,
      kind: "hunt-success",
      summary: {
        en: `Team ${hunt.attackerTeamId} HUNT success against ${hunt.targetTeamId} (generation ${hunt.generation})`,
        ja: `${hunt.attackerTeamId} が HUNT 成功: 対象 ${hunt.targetTeamId} (世代 ${hunt.generation})`,
      },
      detail: { targetTeamId: hunt.targetTeamId, generation: hunt.generation },
    });
  }

  for (const team of Object.values(state.teams)) {
    if (team.generation <= 1 || team.lastRotateAtMs === undefined) continue;
    const priorRotateCount = team.generation - 1;
    const multipleRotatesNote =
      priorRotateCount > 1
        ? " (this team rotated more than once; only this, the MOST RECENT rotate's timestamp, survives in state -- see replay.ts's header)"
        : "";
    const multipleRotatesNoteJa =
      priorRotateCount > 1 ? " (このチームは複数回 rotate しており、state に残るのは直近の rotate 時刻のみ)" : "";
    events.push({
      atMs: team.lastRotateAtMs,
      teamId: team.teamId,
      kind: "rotate",
      summary: {
        en: `Team ${team.teamId} ROTATE -> generation ${team.generation}${multipleRotatesNote}`,
        ja: `${team.teamId} が ROTATE -> 世代 ${team.generation}${multipleRotatesNoteJa}`,
      },
      detail: { generation: team.generation, priorRotateCount },
    });
  }

  if (state.startedAtMs !== undefined) {
    const boundaries: readonly { readonly atMs: number; readonly phase: Phase }[] = [
      { atMs: state.startedAtMs + state.config.phaseBoundaries.buildToPressureMs, phase: "pressure" },
      { atMs: state.startedAtMs + state.config.phaseBoundaries.pressureToEndgameMs, phase: "endgame" },
      { atMs: state.startedAtMs + state.config.matchDurationMs, phase: "ended" },
    ];
    for (const boundary of boundaries) {
      // Only include a transition that has actually elapsed by the match's
      // most recent tick -- these boundary timestamps are exact regardless
      // (derived analytically from config + startedAtMs, the same
      // computation reducer.ts's computePhase does), but a still-in-progress
      // match should not show a debrief entry for a phase it has not
      // reached yet.
      if (state.nowMs !== undefined && boundary.atMs <= state.nowMs) {
        events.push({
          atMs: boundary.atMs,
          kind: "phase-change",
          summary: {
            en: `Match phase -> ${boundary.phase}`,
            ja: `試合フェーズ -> ${boundary.phase}`,
          },
          detail: { phase: boundary.phase },
        });
      }
    }
  }

  // Array.prototype.sort is a stable sort (ES2019+, both V8 and
  // JavaScriptCore/Bun honor this) -- events pushed above in a fixed,
  // deterministic order (ledger, then hunts, then rotates, then phase
  // transitions) means same-atMs ties keep that same relative order on
  // every call, not just "some" order.
  return events.sort((a, b) => a.atMs - b.atMs);
}

export type KeyMomentKind = "threshold-crossed" | "rotate-invalidated-leaks";

/**
 * A debrief-only annotation over a `buildReplay` timeline -- see this
 * module's header: never surface these (or `buildReplay`'s output) through
 * the live participant portal.
 */
export interface KeyMoment {
  readonly atMs: number;
  readonly teamId: string;
  readonly kind: KeyMomentKind;
  readonly summary: { readonly ja: string; readonly en: string };
  readonly detail: Readonly<Record<string, number>>;
}

/**
 * Annotate `replay` with the two causal moments Issue #486's "120分
 * debrief" section asks a facilitator to be able to point at:
 *   - **"この leak で threshold を超えた"** -- for each (team, generation),
 *     the specific LEAK event whose arrival first brought that
 *     generation's distinct-leaked-share-index count up to
 *     `state.config.threshold`. Emitted whether or not any HUNT actually
 *     followed -- it marks when a team BECAME exploitable, independent of
 *     whether an opponent capitalized on it.
 *   - **"この rotate で N 枚の leak が無効化された"** -- for each ROTATE
 *     event, exactly how many distinct share indices from the generation
 *     immediately before it are now worthless for reconstructing the new
 *     secret (an exact count from `state.publicLedger`, not an estimate).
 *
 * Takes `replay` (not just `state`) because a key moment is defined
 * relative to the SAME timeline a debrief already renders -- this function
 * walks `replay`'s own "leak" / "rotate" entries (already time-ordered by
 * `buildReplay`) rather than re-deriving a second, potentially
 * out-of-sync timeline from `state.publicLedger` directly.
 */
export function keyMoments(replay: readonly ReplayEvent[], state: CryptoBattleState): KeyMoment[] {
  const moments: KeyMoment[] = [];

  const seenIndicesByTeamGeneration = new Map<string, Set<number>>();
  for (const event of replay) {
    if (event.kind !== "leak") continue;
    const key = `${event.teamId}:${event.detail.generation}`;
    const seen = seenIndicesByTeamGeneration.get(key) ?? new Set<number>();
    const alreadyCrossed = seen.size >= state.config.threshold;
    seen.add(event.detail.shareIndex);
    seenIndicesByTeamGeneration.set(key, seen);
    if (!alreadyCrossed && seen.size === state.config.threshold) {
      moments.push({
        atMs: event.atMs,
        teamId: event.teamId,
        kind: "threshold-crossed",
        summary: {
          en: `Team ${event.teamId}'s generation-${event.detail.generation} secret became reconstructable here -- ${state.config.threshold} distinct shares are now public`,
          ja: `${event.teamId} の世代 ${event.detail.generation} secret がここで復元可能になった (公開 share が ${state.config.threshold} 枚に到達)`,
        },
        detail: { generation: event.detail.generation, threshold: state.config.threshold },
      });
    }
  }

  for (const event of replay) {
    if (event.kind !== "rotate") continue;
    const priorGeneration = event.detail.generation - 1;
    const invalidated = new Set(
      state.publicLedger
        .filter((a) => a.kind === "share" && a.teamId === event.teamId && a.generation === priorGeneration)
        .map((a) => (a.kind === "share" ? a.shareIndex : -1)),
    );
    moments.push({
      atMs: event.atMs,
      teamId: event.teamId,
      kind: "rotate-invalidated-leaks",
      summary: {
        en: `Team ${event.teamId}'s ROTATE invalidated ${invalidated.size} previously-leaked generation-${priorGeneration} share(s) for reconstructing its new secret`,
        ja: `${event.teamId} の ROTATE により、世代 ${priorGeneration} で公開済みの share ${invalidated.size} 枚を新 secret の復元手段として無効化した`,
      },
      detail: { invalidatedShareCount: invalidated.size, priorGeneration, newGeneration: event.detail.generation },
    });
  }

  return moments.sort((a, b) => a.atMs - b.atMs);
}
