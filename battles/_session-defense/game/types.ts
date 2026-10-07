export const ACTIONS = {
  addAdmin: { damage: 40, privileged: true, stepUp: true, approval: true },
  unlink: { damage: 30, privileged: true, stepUp: true, approval: true },
  export: { damage: 20, privileged: false, stepUp: false, approval: false },
  spend: { damage: 10, privileged: false, stepUp: true, approval: false },
} as const;
export type Action = keyof typeof ACTIONS;
export const CONTROLS = { revoke: 2, stepUp: 3, approval: 2, leastPrivilege: 2, shortTTL: 1, strongLogin: 1, httpOnly: 1 } as const;
export type Control = keyof typeof CONTROLS;
export type Phase = "waiting" | "baseline" | "configure" | "contest" | "finished";
export interface Context { eventId: string; teamIds: readonly string[]; teamNames?: Readonly<Record<string,string>>; matchSecret?: string }
export interface Session { token: string; owner: string; round: number; expires: number; revoked: boolean }
export interface Grant { id: string; token: string; action: Action; round: number; expires: number; consumed: boolean; issuer: "owner" | "reviewer" }
export interface Event { round: number; phase: Phase; action: string; actor: string; result: string; damage: number; at: number }
export interface Result { round: number; defender: string; attacker: string; controls: Control[]; cost: number; damage: number; legitimate: boolean; attackPoints: number; defensePoints: number; reason: string }
export interface Desk { admins: string[]; customerLinked: boolean; exportedCopies: number; adBudget: number }
export interface State {
  schema: 1; eventId: string; secret: string; ids: string[]; names: Record<string,string>; ready: string[];
  revision: number; round: number; phase: Phase; now: number; deadline: number;
  scores: Record<string,number>; controls: Control[]; sessions: Session[]; grants: Grant[];
  leak: string; baselineDamage: number; damage: number; done: Action[]; tickets: number; legitimate: boolean; attackFinished: boolean; desk: Desk;
  events: Event[]; results: Result[]; receipts: Record<string,string>;
}
export type Op = { id: string; revision: number } & (
  { kind: "ready" } | { kind: "try"; action: Action; token: string; proof?: string; approval?: string } |
  { kind: "finish" } | { kind: "defend"; controls: Control[] } | { kind: "legitimate" }
);
export interface Projection {
  revision: number; round: number; phase: Phase; now: number; deadline: number; me: string;
  names: Record<string,string>; ready: string[]; scores: Record<string,number>; role: "attacker" | "defender";
  controls: Control[]; leak?: string; baselineDamage: number; damage: number; tickets: number;
  legitimate: boolean; attackFinished: boolean; desk: Desk; events: Event[]; results: Result[]; lateLeak: boolean;
}
