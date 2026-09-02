/**
 * Issue #644: the in-memory coordination host the local harness runs on.
 *
 * This is the ONLY part of the harness that resembles platform code, and it is
 * deliberately tiny: read state, dispatch, optimistic-lock write, project. Every
 * line of game meaning — what a LEAK does, whether a HUNT is legal, what a team
 * may see — comes from `../game/src/reducer.ts`, unchanged. Nothing about the
 * match is re-implemented here, so a local preview cannot drift from production
 * behaviour; if it did, the drift would be in five lines of plumbing rather than
 * a parallel copy of the game.
 *
 * ## Why it imports the reducer and not `../coordination/crypto-battle.ts`
 *
 * That file is the plugin the platform actually loads, but it is compiled
 * against `@tenkacloud/coordination-plugin-sdk`, which exists in this
 * repository only as a types-only ambient `.d.ts`
 * (`../coordination/coordination-plugin-sdk.d.ts`) — importing it at RUNTIME
 * would fail, and vendoring the real package is exactly what this repository's
 * AGENTS.md "Repository boundary" forbids. So the harness composes the same five
 * hooks directly, the same way every test under `../game/src` already does. The
 * six-line wrapper itself is covered by `../game/src/coordination-plugin.test.ts`
 * against a mocked SDK; it carries no logic this harness could exercise anyway.
 *
 * ## Fidelity, and where it stops
 *
 * `dispatch` / `runTick` / `projectSafely` below reproduce the SDK helpers'
 * documented semantics (see that `.d.ts`), and `version` reproduces the
 * dispatcher's optimistic lock. What this harness does NOT reproduce, and must
 * never be read as evidence about:
 *
 *   - authentication, team-login-key resolution, or tenant isolation
 *   - DynamoDB / Turso persistence and its conflict behaviour under real
 *     concurrency
 *   - the scheduled tick cadence (here the clock advances on request)
 *   - CloudFormation deployment of the problem's `template.yaml`
 *
 * See README.md for the trust-boundary statement that governs all of it.
 */

import {
  applyOp,
  initialState,
  projectForTeam,
  tick,
  validateOp,
} from "../game/src/reducer.ts";
import type {
  CoordinationContext,
  CryptoBattleConfig,
  CryptoBattleOp,
  CryptoBattleProjection,
  CryptoBattleState,
} from "../game/src/types.ts";

export type DispatchResult =
  | { readonly ok: true; readonly state: CryptoBattleState }
  | { readonly ok: false; readonly error: string };

/**
 * `validateOp` then `applyOp`, never `applyOp` alone — the same order the SDK's
 * `dispatchOp` enforces. Getting this backwards in a harness would let a move
 * the real platform rejects "work locally", which is the single most misleading
 * thing a preview can do.
 */
export function dispatch(
  state: CryptoBattleState,
  teamId: string,
  op: CryptoBattleOp,
): DispatchResult {
  const verdict = validateOp(state, teamId, op);
  if (!verdict.ok) return { ok: false, error: verdict.error };
  return { ok: true, state: applyOp(state, teamId, op) };
}

/** Mirror of the SDK's `runTick` (the plugin's `tick` is optional there). */
export function runTick(state: CryptoBattleState, eventNowMs: number): CryptoBattleState {
  return tick(state, eventNowMs);
}

/**
 * Mirror of the SDK's `safeProjectForTeam`: a throwing `projectForTeam` must not
 * take the whole surface down, and must not invent a projection either. The
 * caller supplies the fallback so this file never fabricates game data.
 */
export function projectSafely(
  state: CryptoBattleState,
  teamId: string,
  fallback: CryptoBattleProjection | Record<string, never>,
): CryptoBattleProjection | Record<string, never> {
  try {
    return projectForTeam(state, teamId);
  } catch {
    return fallback;
  }
}

/**
 * One match's worth of in-memory state, plus the optimistic-lock version the
 * real dispatcher keeps. Held in a plain object rather than a module-level
 * variable so the tests can drive several matches at once.
 */
export interface MatchHost {
  readonly ctx: CoordinationContext;
  state: CryptoBattleState;
  version: number;
}

export function createMatch(
  ctx: CoordinationContext,
  config?: Partial<CryptoBattleConfig>,
): MatchHost {
  return { ctx, state: initialState(ctx, config), version: 0 };
}

export type SubmitOutcome =
  | { readonly kind: "ok"; readonly projection: unknown }
  | { readonly kind: "rejected"; readonly error: string };

/**
 * The write path: advance the clock, dispatch, bump the version, project.
 *
 * The tick runs BEFORE the op, matching production ordering — a contract that
 * expired while the participant was typing must already be `expired` when their
 * LEAK is validated, not after. Without this the harness would accept moves the
 * live dispatcher rejects.
 */
export function submitOp(
  host: MatchHost,
  teamId: string,
  op: CryptoBattleOp,
  eventNowMs: number,
): SubmitOutcome {
  host.state = runTick(host.state, eventNowMs);
  const result = dispatch(host.state, teamId, op);
  if (!result.ok) return { kind: "rejected", error: result.error };
  host.state = result.state;
  host.version += 1;
  return { kind: "ok", projection: projectSafely(host.state, teamId, {}) };
}

/** The read path: advance the clock, then project. No write, no version bump. */
export function readProjection(
  host: MatchHost,
  teamId: string,
  eventNowMs: number,
): SubmitOutcome {
  host.state = runTick(host.state, eventNowMs);
  return { kind: "ok", projection: projectSafely(host.state, teamId, {}) };
}
