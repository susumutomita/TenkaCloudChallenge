export interface Context {
  eventId: string;
  teamIds: readonly string[];
  teamNames?: Readonly<Record<string, string>>;
  matchSecret?: string;
}
export type Phase = "waiting" | "baseline" | "patch" | "retest" | "finished";
export type Action = "read" | "edit";
export interface Document {
  id: string;
  tenant: string;
  title: string;
  delegated: boolean;
  reads: number;
  edits: number;
}
export interface Log {
  round: number;
  phase: Phase;
  actorTenant: string;
  documentTenant: string;
  action: Action;
  requestTenant: string;
  allowed: boolean;
  grantValid: boolean;
  alert: boolean;
  damage: number;
}
export interface Checks {
  safe: number;
  safeTotal: number;
  work: number;
  workTotal: number;
  detect: number;
  detectTotal: number;
  failures: string[];
}
export interface Result {
  round: number;
  attacker: string;
  defender: string;
  attackPoints: number;
  defensePoints: number;
  damage: number;
  completed: boolean;
  checks?: Checks;
  authorize: string;
  detect: string;
}
export interface State {
  schema: 1;
  eventId: string;
  secret: string;
  ids: string[];
  names: Record<string, string>;
  ready: string[];
  revision: number;
  round: number;
  phase: Phase;
  now: number;
  deadline: number;
  scores: Record<string, number>;
  documents: Document[];
  authorize: string;
  detect: string;
  tickets: number;
  attempts: number;
  previews: number;
  baselineAttempted: boolean;
  damage: number;
  damaged: string[];
  attackFinished: boolean;
  checked: boolean;
  patched: boolean;
  checks?: Checks;
  preview?: { label: string; passed: boolean }[];
  logs: Log[];
  results: Result[];
  receipts: Record<string, string>;
}
export type Op = { id: string; revision: number } & (
  | { kind: "ready" }
  | { kind: "try"; documentId: string; action: Action; requestTenant: string }
  | { kind: "finish" }
  | { kind: "patch" | "preview"; authorize: string; detect: string }
  | { kind: "check" }
);
export interface Projection {
  revision: number;
  round: number;
  phase: Phase;
  now: number;
  deadline: number;
  me: string;
  role: "attacker" | "defender";
  names: Record<string, string>;
  scores: Record<string, number>;
  ready: string[];
  documents: Document[];
  actor: { tenant: string; role: string; active: boolean };
  authorize: string;
  detect: string;
  tickets: number;
  attempts: number;
  previews: number;
  damage: number;
  attackFinished: boolean;
  checked: boolean;
  checks?: Checks;
  preview?: { label: string; passed: boolean }[];
  logs: Log[];
  results: Result[];
}
