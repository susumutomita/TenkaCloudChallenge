import type { Contract, CryptoBattleConfig, CryptoBattleState, MatchDurationRejection } from "./types.ts";

/**
 * [Issue #926] The match length the platform reports (TenkaCloud#3453), and
 * how this Battle follows it.
 *
 * The platform closes the match when its `eventNowMs` clock reaches the
 * reported length. The local host even stops that clock there. So this match
 * ends at that same instant, however late the teams pressed START: the battle
 * runs `length - startedAtMs`, and its phases split that span into thirds.
 * With no report the match keeps its configured length, counted from START.
 *
 * A report applies from the tick that carries it, after the clock has been
 * replayed up to that tick under the length already in force. Ticks that carry
 * an unchanged length change nothing, so the polling cadence stays immaterial
 * (#897). A boundary the match has already crossed stays where it was, and a
 * boundary or end that would now lie in the past is crossed at this tick.
 */
export const MIN_MATCH_DURATION_MS = 5 * 60_000;
export const MAX_MATCH_DURATION_MS = 240 * 60_000;

type MatchTiming = Pick<CryptoBattleConfig, "matchDurationMs" | "phaseBoundaries">;

function readMatchDuration(value: unknown):
  | { readonly ok: true; readonly durationMs: number }
  | { readonly ok: false; readonly rejection: MatchDurationRejection } {
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, rejection: "not-a-number" };
  if (value < MIN_MATCH_DURATION_MS || value > MAX_MATCH_DURATION_MS) return { ok: false, rejection: "out-of-range" };
  return { ok: true, durationMs: value };
}

function battleTiming(state: CryptoBattleState, platformDurationMs: number): MatchTiming {
  const start = state.startedAtMs;
  const length = Math.max(0, platformDurationMs - (start ?? 0));
  const target = [Math.floor(length / 3), Math.floor((2 * length) / 3), length] as const;
  const { phaseBoundaries, matchDurationMs } = state.config;
  const current = [phaseBoundaries.buildToPressureMs, phaseBoundaries.pressureToEndgameMs, matchDurationMs] as const;
  const elapsed = start === undefined ? undefined : (state.nowMs ?? start) - start;
  const [buildToPressureMs, pressureToEndgameMs, end] = target.map((ms, i) =>
    elapsed === undefined ? ms : current[i]! <= elapsed ? current[i]! : Math.max(elapsed, ms));
  return { matchDurationMs: end!, phaseBoundaries: { buildToPressureMs: buildToPressureMs!, pressureToEndgameMs: pressureToEndgameMs! } };
}

/** Open Orders keep the deadline they would have had under the new end. */
function rescheduled(state: CryptoBattleState, config: CryptoBattleConfig): Partial<Pick<CryptoBattleState, "contracts" | "endgameLightning">> {
  const start = state.startedAtMs;
  if (start === undefined) return {};
  const oldEnd = start + state.config.matchDurationMs;
  const newEnd = start + config.matchDurationMs;
  const deadline = (order: Contract) => Math.min(newEnd, order.expiresAtMs === oldEnd
    ? order.issuedAtMs + (order.kind === "rush" ? config.rushContractTtlMs : config.contractTtlMs)
    : order.expiresAtMs);
  const moved = new Map<string, number>();
  const contracts = state.contracts.map((order) => {
    const expiresAtMs = order.status === "open" ? deadline(order) : order.expiresAtMs;
    if (expiresAtMs === order.expiresAtMs) return order;
    moved.set(order.id, expiresAtMs);
    return { ...order, expiresAtMs };
  });
  if (moved.size === 0) return {};
  const lightning = state.endgameLightning;
  if (lightning?.status !== "awarded") return { contracts };
  const cards = Object.fromEntries(Object.entries(lightning.cards).map(([teamId, card]) => {
    const expiresAtMs = card.status === "armed" ? moved.get(card.contractId) : undefined;
    return [teamId, expiresAtMs === undefined ? card : { ...card, expiresAtMs }];
  }));
  return { contracts, endgameLightning: { ...lightning, cards } };
}

/**
 * Applies one platform report. `undefined` is no report and changes nothing; a
 * value outside 5..240 minutes keeps the length in force and records why.
 * An ended match ignores reports: its clock has already run out.
 */
export function withMatchDuration(state: CryptoBattleState, reported: unknown): CryptoBattleState {
  if (reported === undefined || state.phase === "ended") return state;
  const read = readMatchDuration(reported);
  if (!read.ok) {
    return state.matchDurationRejection === read.rejection ? state : { ...state, matchDurationRejection: read.rejection };
  }
  const { matchDurationRejection: _accepted, ...rest } = state;
  const accepted = state.platformMatchDurationMs === read.durationMs && state.matchDurationRejection === undefined
    ? state : { ...rest, platformMatchDurationMs: read.durationMs };
  return retimed(accepted, read.durationMs);
}

/** At START the accepted length, if any, divides the span left after START. */
export function startedTiming(state: CryptoBattleState): CryptoBattleState {
  return state.platformMatchDurationMs === undefined ? state : retimed(state, state.platformMatchDurationMs);
}

function retimed(state: CryptoBattleState, platformDurationMs: number): CryptoBattleState {
  const timing = battleTiming(state, platformDurationMs);
  const { matchDurationMs, phaseBoundaries } = state.config;
  if (timing.matchDurationMs === matchDurationMs
    && timing.phaseBoundaries.buildToPressureMs === phaseBoundaries.buildToPressureMs
    && timing.phaseBoundaries.pressureToEndgameMs === phaseBoundaries.pressureToEndgameMs) return state;
  const config = { ...state.config, ...timing };
  return { ...state, ...rescheduled(state, config), config };
}

/** What the waiting screen shows: how long the match can still run if it starts now. */
export function waitingRemainingMs(state: CryptoBattleState): number {
  return state.platformMatchDurationMs === undefined
    ? state.config.matchDurationMs
    : Math.max(0, state.platformMatchDurationMs - (state.nowMs ?? 0));
}
