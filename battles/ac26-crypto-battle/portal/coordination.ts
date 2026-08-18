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
 */
export function isCryptoBattleProjection(value: unknown): value is CryptoBattleProjection {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (typeof v.phase !== "string" || !["build", "pressure", "endgame", "ended"].includes(v.phase)) {
    return false;
  }

  const vault = v.vault;
  if (typeof vault !== "object" || vault === null) return false;
  const vaultRecord = vault as Record<string, unknown>;
  if (typeof vaultRecord.teamId !== "string") return false;
  if (typeof vaultRecord.secret !== "string") return false;
  if (!Array.isArray(vaultRecord.shares)) return false;
  if (typeof vaultRecord.generation !== "number") return false;
  if (typeof vaultRecord.rotateCooldownRemainingMs !== "number") return false;

  if (!Array.isArray(v.myContracts)) return false;
  if (!Array.isArray(v.publicLedger)) return false;

  if (typeof v.teams !== "object" || v.teams === null) return false;
  if (typeof v.publicCommitments !== "object" || v.publicCommitments === null) return false;

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
 */
export function usePolledProjection(client: PortalCoordinationClient | undefined): ProjectionPollState {
  const [projection, setProjection] = useState<CryptoBattleProjection | null>(null);
  const [status, setStatus] = useState<ProjectionPollState["status"]>(null);

  useEffect(() => {
    if (!client) return;
    let active = true;
    const poll = async () => {
      const outcome = await client.getProjection();
      if (!active) return;
      if (outcome.kind === "ok") {
        if (isCryptoBattleProjection(outcome.projection)) {
          setProjection(outcome.projection);
          setStatus(null);
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

  return { projection, status };
}
