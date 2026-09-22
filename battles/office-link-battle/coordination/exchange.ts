import { createHmac, timingSafeEqual } from "node:crypto";

const LIMIT = 3;
const BONUS = 20;
interface Team {
  name: string;
  code: string;
  partners: string[];
  pending?: string;
}
export interface ExchangeState { teams: Record<string, Team> }
export interface ExchangeProjection {
  ready: boolean;
  code: string;
  bonus: number;
  limit: number;
  teams: { id: string; name: string; complete: boolean; waiting: boolean; selected: boolean; bonus: number }[];
}
interface Context { teamIds: readonly string[]; teamNames?: Readonly<Record<string, string>>; matchSecret?: string; eventId: string }
type Op = { kind: "exchange"; peer: string; code: string } | { kind: "cancel" };

export function initialState(ctx: Context): ExchangeState {
  return { teams: Object.fromEntries(ctx.teamIds.map(id => [id, {
    name: ctx.teamNames?.[id] ?? id,
    // The platform provides a secret only when persisting the first operation.
    code: ctx.matchSecret ? createHmac("sha256", ctx.matchSecret).update(JSON.stringify([ctx.eventId, id])).digest("hex").slice(0, 16) : "",
    partners: [],
  }])) };
}
function parseOp(value: unknown): Op | undefined {
  if (!value || typeof value !== "object" || !("kind" in value)) return;
  if (value.kind === "cancel") return { kind: "cancel" };
  if (value.kind === "exchange" && "peer" in value && typeof value.peer === "string" && "code" in value && typeof value.code === "string" && value.code.length <= 24)
    return { kind: "exchange", peer: value.peer, code: value.code.replaceAll(/[\s-]/g, "").toLowerCase() };
}
function completed(a: Team, aId: string, b: Team, bId: string) {
  return a.partners.includes(bId) || b.partners.includes(aId);
}
function validExchange(state: ExchangeState, teamId: string, op: Extract<Op, { kind: "exchange" }>): string | undefined {
  const me = state.teams[teamId];
  const peer = Object.hasOwn(state.teams, op.peer) ? state.teams[op.peer] : undefined;
  if (!peer || op.peer === teamId) return "choose_another_team";
  if (!peer.code) return "not_ready";
  if (completed(me, teamId, peer, op.peer)) return "already_exchanged";
  if (me.partners.length >= LIMIT && peer.partners.length >= LIMIT) return "bonus_limit";
  if (!/^[a-f0-9]{16}$/.test(op.code) || !timingSafeEqual(Buffer.from(op.code), Buffer.from(peer.code))) return "check_partner_code";
}
export function validateOp(state: ExchangeState, teamId: string, value: unknown): { ok: true } | { ok: false; error: string } {
  if (!Object.hasOwn(state.teams, teamId)) return { ok: false, error: "unknown_team" };
  const op = parseOp(value);
  if (!op) return { ok: false, error: "invalid_operation" };
  const error = op.kind === "exchange" ? validExchange(state, teamId, op) : undefined;
  return error ? { ok: false, error } : { ok: true };
}
export function applyOp(state: ExchangeState, teamId: string, value: unknown): ExchangeState {
  const validation = validateOp(state, teamId, value);
  if (!validation.ok) throw new Error(validation.error);
  const op = parseOp(value);
  if (!op) throw new Error("invalid_operation");
  const me = state.teams[teamId];
  if (op.kind === "cancel") return { teams: { ...state.teams, [teamId]: { ...me, pending: undefined } } };
  const peer = state.teams[op.peer];
  if (peer.pending !== teamId) return { teams: { ...state.teams, [teamId]: { ...me, pending: op.peer } } };
  // Only store rewarded partners: at most three entries per team, even when a
  // capped team helps late arrivals. Either side records a completed pair.
  return { teams: { ...state.teams,
    [teamId]: { ...me, pending: undefined, partners: me.partners.length < LIMIT ? [...me.partners, op.peer] : me.partners },
    [op.peer]: { ...peer, pending: undefined, partners: peer.partners.length < LIMIT ? [...peer.partners, teamId] : peer.partners },
  } };
}
export function teamScores(state: ExchangeState): Record<string, number> {
  return Object.fromEntries(Object.entries(state.teams).map(([id, team]) => [id, BONUS * team.partners.length]));
}
export function projectForTeam(state: ExchangeState, teamId: string): ExchangeProjection {
  const me = Object.hasOwn(state.teams, teamId) ? state.teams[teamId] : undefined;
  if (!me) throw new Error("unknown_team");
  return {
    ready: Boolean(me.code), code: me.code, bonus: me.partners.length * BONUS, limit: LIMIT * BONUS,
    teams: Object.entries(state.teams).filter(([id]) => id !== teamId).map(([id, peer]) => ({
      id, name: peer.name, complete: completed(me, teamId, peer, id), waiting: peer.pending === teamId,
      selected: me.pending === id, bonus: peer.partners.length * BONUS,
    })),
  };
}
