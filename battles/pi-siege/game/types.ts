import type { Cells } from "./math.ts";
export type Locale = "ja" | "en";
export interface Text { ja: string; en: string }
export type Round = 0 | 1 | 2 | 3;
export type Task =
  | { kind: "record"; p: number; q: number }
  | { kind: "table"; cells: Cells }
  | { kind: "terms"; ones: number }
  | { kind: "allocation"; n: number; d: number };
export interface Preview { id: string; task: Task; facts: Text[]; rows?: number }
export interface Claim {
  id: string; author: string; round: Round; task: Task;
  scope?: "finite" | "forever"; floor?: { n: number; d: number }; exponent?: number;
  status: "open" | "held" | "broken"; challenged: string[]; facts: Text[];
  rows?: number;
}
export interface Team {
  id: string; name: string; ready: boolean; score: number; tickets: number; passed: boolean;
  range: number; rows: number; grid: number; previews: Preview[]; claimed: boolean; feedback: Text[];
}
export interface Entry { round: Round; team: string; points: number; text: Text[] }
export interface Receipt { id: string; team: string; payload: string }
export interface State {
  schema: 2; phase: "waiting" | "playing" | "ended"; round: Round; revision: number;
  roster: string[]; teams: Record<string, Team>; turn: string; claims: Claim[]; ledger: Entry[]; receipts: Receipt[];
}
export interface Context { eventId: string; teamIds: readonly string[]; teamNames?: Readonly<Record<string, string>> }
export interface Projection {
  schema: 2; phase: State["phase"]; round: Round; revision: number; turn: string;
  me: Team; opponents: { id: string; name: string; score: number; ready: boolean; passed: boolean }[];
  claims: Claim[]; ledger: Entry[];
}
interface Envelope { requestId: string; revision: number; round: Round }
export type Op = Envelope & (
  | { kind: "ready" }
  | { kind: "upgrade" }
  | { kind: "inspect"; task: Task }
  | { kind: "publish"; sourceId: string; scope?: "finite" | "forever"; floor?: { n: number; d: number }; exponent?: number }
  | { kind: "audit"; claimId: string; reason: "scope" | "zero" | "floor" | "large" | "mixed" | "collision" | "error"; ones?: number; cost?: number }
  | { kind: "pass" }
);
export type Verdict = { ok: true } | { ok: false; error: string };
