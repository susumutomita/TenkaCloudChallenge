/**
 * Shared portal-plugin helpers for ac26-crypto-battle (Issue #486, PR4).
 *
 * `StatusPanel.tsx` and `RegistrationPanel.tsx` both need the exact same two
 * things: a live-polled, narrowed `CryptoBattleProjection` (StatusPanel to
 * render the 3 lanes; RegistrationPanel to populate its LEAK/PROVE contract
 * selects and its HUNT target/generation selects), and a human-readable
 * description of a `PortalCoordinationOutcome`. Factoring both out here
 * (rather than duplicating the polling `useEffect` + narrowing logic the way
 * `battles/microservice-migration-battle/portal/StatusPanel.tsx` inlines its
 * own single-purpose version) keeps there being exactly one place that has
 * to get the narrowing and the 30s-polling cadence right.
 *
 * Plain `.ts`, not `.tsx` -- deliberately: the participant-portal plugin
 * loader's glob only discovers `portal/*.tsx`
 * (`apps/participant-portal/src/plugins/loader.ts`), so this file is never
 * mistaken for a slot component. It IS still bundled into every `.tsx` that
 * imports it (same relative-import bundling Vite/esbuild already does for
 * `coordination/crypto-battle.ts`'s `../game/src/reducer.ts` import -- see
 * that file's header for the investigation into why that resolves).
 *
 * This module never imports anything from `../game/src/` beyond `types.ts`
 * (types only, erased on emit). In particular it never imports
 * `schnorr-prover.ts` / `shamir.ts` -- PROVE's proof and HUNT's
 * `recoveredSecret` are participant-computed *outside* the portal on
 * purpose (see `RegistrationPanel.tsx`'s header): that local computation is
 * this Battle's actual "compute cost" for those two moves, and the portal
 * would defeat that design if it did the math for you.
 */
import { useEffect, useState } from "react";
import type { PortalCoordinationClient, PortalCoordinationOutcome } from "@tenkacloud/portal-plugin-sdk";
import type { CryptoBattleProjection } from "../game/src/types.ts";

/** ADR-014 / polling-over-SSE: same cadence as microservice-migration-battle's StatusPanel. */
export const COORDINATION_POLL_MS = 30_000;

/**
 * `getProjection()` returns `unknown` on the SDK's `PortalCoordinationOutcome`
 * (the SDK is plugin-agnostic), so every problem's portal plugin must narrow
 * it to its own projection shape itself -- this is this problem's narrowing
 * function, structural rather than exhaustive (same shallow-but-sufficient
 * style as microservice-migration-battle's `isRouteDirectory`): it checks
 * that every top-level field `StatusPanel` / `RegistrationPanel` actually
 * read is present with the right JS type, not that every nested artifact is
 * individually well-formed. A narrowing failure here is treated as "unknown
 * data format" by both plugins (see `usePolledProjection` below), never a
 * crash and never a guess at a fabricated projection.
 *
 * `vault.huntedGenerations` and `vault.completedContractIds` are checked
 * too (both `Array.isArray`, not just present) -- `StatusPanel.tsx`'s
 * `VaultLane` reads `vault.huntedGenerations.length` / `.join(...)`
 * unconditionally, so a malformed/missing value here would previously pass
 * this guard and then throw inside the render, contradicting this file's
 * own "never a crash" guarantee above (Issue #486 PR4 review, medium #2).
 */
export function isCryptoBattleProjection(value: unknown): value is CryptoBattleProjection {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  // [Issue #677] "waiting" belongs on this list. It was added to `Phase` for the
  // deployed-but-unstarted match, and a guard that does not know a phase fails
  // closed on it -- which showed the participant "the match service is
  // unavailable" for a match that was simply waiting for them to press START.
  const phases = ["waiting", "build", "pressure", "endgame", "ended"];
  if (typeof v.phase !== "string" || !phases.includes(v.phase)) {
    return false;
  }
  if (typeof v.matchRemainingMs !== "number" && v.matchRemainingMs !== undefined) return false;
  // [Issue #645] The modulus is required, not optional. The FHE and MPC panels
  // cannot state a solvable problem without it, and a payload from a
  // pre-#645 dispatcher (a mixed-version rollout) would otherwise be accepted
  // and render `undefined` as the number to divide by. Failing closed here
  // surfaces `bad_projection` instead, which is what the participant needs to
  // see.
  if (typeof v.prime !== "string" || v.prime.length === 0) return false;
  // [Issue #682] Same fail-closed rule as `prime`: the exposure lane renders
  // "2 / 3" from this, and a payload without it would render "2 / undefined".
  if (typeof v.threshold !== "number" || !Number.isFinite(v.threshold) || v.threshold <= 0) {
    return false;
  }
  // [Issue #688] The waiting screen renders "1 / 2 準備完了" from this.
  const ready = v.ready as Record<string, unknown> | undefined;
  if (typeof ready !== "object" || ready === null) return false;
  if (typeof ready.count !== "number" || typeof ready.total !== "number") return false;
  if (typeof ready.me !== "boolean") return false;

  const vault = v.vault;
  if (typeof vault !== "object" || vault === null) return false;
  const vaultRecord = vault as Record<string, unknown>;
  if (typeof vaultRecord.teamId !== "string") return false;
  if (typeof vaultRecord.secret !== "string") return false;
  if (!Array.isArray(vaultRecord.shares)) return false;
  if (typeof vaultRecord.generation !== "number") return false;
  if (typeof vaultRecord.rotateCooldownRemainingMs !== "number") return false;
  if (!Array.isArray(vaultRecord.completedContractIds)) return false;
  if (!Array.isArray(vaultRecord.huntedGenerations)) return false;

  if (!Array.isArray(v.myContracts)) return false;
  // Deep-checked (unlike the shallow "just Array.isArray" style elsewhere in
  // this guard): `remainingMs` is the field this problem's live-time-display
  // bug lived in (see `ContractProjection.remainingMs`'s doc comment in
  // `../game/src/types.ts`) -- a malformed/missing value here must fail
  // closed to "unknown data format" rather than render `NaN`/`undefined`
  // arithmetic as a silently wrong countdown.
  if (v.myContracts.some((c) => typeof (c as { remainingMs?: unknown }).remainingMs !== "number")) return false;
  if (!Array.isArray(v.publicLedger)) return false;

  if (typeof v.teams !== "object" || v.teams === null) return false;
  if (typeof v.publicCommitments !== "object" || v.publicCommitments === null) return false;

  // [Issue #696] Same fail-closed rule as `prime` / `threshold`: the HUNT card
  // prints "N of M attempts left" and the miss banner prints the price from
  // these, and a payload from a dispatcher that predates them would otherwise
  // render `undefined` where the cost of a move belongs.
  if (typeof v.huntAttempts !== "object" || v.huntAttempts === null) return false;
  if (typeof v.wrongHuntCost !== "number" || !Number.isFinite(v.wrongHuntCost)) return false;
  if (v.lastHunt !== undefined) {
    const last = v.lastHunt as Record<string, unknown> | null;
    if (typeof last !== "object" || last === null) return false;
    if (last.outcome !== "hit" && last.outcome !== "miss") return false;
  }

  return true;
}

export interface ProjectionPollState {
  /** The most recently narrowed-ok projection. `null` until the first successful poll. */
  readonly projection: CryptoBattleProjection | null;
  /**
   * The latest poll's non-"ok" condition, or `null` when the latest poll
   * succeeded and narrowed cleanly. `"bad_projection"` is this file's own
   * addition for a `kind: "ok"` outcome whose `projection` failed
   * `isCryptoBattleProjection` -- distinct from every `PortalCoordinationOutcome`
   * kind, which are all dispatcher/infra conditions, not a shape problem.
   */
  readonly status: PortalCoordinationOutcome["kind"] | "bad_projection" | null;
  /**
   * `Date.now()` (the portal's OWN wall clock, absolute epoch ms) at the
   * moment `projection` was last set. `null` until the first successful
   * poll. `matchRemainingMs` / `ContractProjection.remainingMs` are only
   * accurate as of that instant (they come from the dispatcher's
   * elapsed-since-event-start clock, not a wall clock -- see
   * `../game/src/types.ts`'s doc comments on those fields); a consumer that
   * wants a smoothly ticking countdown between 30s polls subtracts
   * `Date.now() - receivedAtWallMs` from the last-known remaining duration,
   * never `projection`'s own fields against a fresh absolute timestamp.
   */
  readonly receivedAtWallMs: number | null;
}

/**
 * Polls `client.getProjection()` every `COORDINATION_POLL_MS`
 * (ADR-014 / polling-over-SSE -- no SSE/WebSocket) and keeps the latest
 * successfully-narrowed projection in state. `client` may be `undefined`
 * (coordination not wired for this deployment/session); the hook then never
 * polls and always returns `{ projection: null, status: null }`, and every
 * caller is expected to render its whole coordination-dependent section as
 * fail-closed hidden in that case (see `StatusPanel.tsx` / `RegistrationPanel.tsx`).
 *
 * A failed or non-ok poll never clears a previously-good `projection` -- the
 * lanes keep showing the last known-good state (annotated with `status`)
 * rather than flashing to empty on one transient poll failure, the same
 * belt-and-suspenders choice microservice-migration-battle's `StatusPanel`
 * makes for its `directory` state.
 *
 * `client.getProjection()` itself can REJECT, not just resolve to a non-"ok"
 * outcome -- the SDK's real implementation is a plain `fetch`, so a network
 * failure (offline, DNS, CORS) throws rather than returning a
 * `PortalCoordinationOutcome`. Without the `try/catch` below, that would
 * both leave the UI silently stuck on its last state forever (no `status`
 * ever gets set, so no retry-hint copy ever shows) and log an unhandled
 * rejection to the console every `COORDINATION_POLL_MS` (Issue #486 PR4
 * review, low #4). Caught here and folded into the same `"unavailable"`
 * status the SDK itself would return for a live-but-erroring dispatcher --
 * the next scheduled poll naturally retries, same as any other transient
 * `"unavailable"`. (microservice-migration-battle's `StatusPanel.tsx` has
 * the identical unguarded-`await` structure; fixing it is out of scope for
 * this file and is left as a follow-up there.)
 */
export function usePolledProjection(client: PortalCoordinationClient | undefined): ProjectionPollState {
  const [projection, setProjection] = useState<CryptoBattleProjection | null>(null);
  const [status, setStatus] = useState<ProjectionPollState["status"]>(null);
  const [receivedAtWallMs, setReceivedAtWallMs] = useState<number | null>(null);

  useEffect(() => {
    if (!client) return;
    let active = true;
    const poll = async () => {
      let outcome: PortalCoordinationOutcome;
      try {
        outcome = await client.getProjection();
      } catch {
        if (active) setStatus("unavailable");
        return;
      }
      if (!active) return;
      if (outcome.kind === "ok") {
        if (isCryptoBattleProjection(outcome.projection)) {
          setProjection(outcome.projection);
          setStatus(null);
          setReceivedAtWallMs(Date.now());
        } else {
          setStatus("bad_projection");
        }
      } else {
        setStatus(outcome.kind);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), COORDINATION_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client]);

  return { projection, status, receivedAtWallMs };
}
