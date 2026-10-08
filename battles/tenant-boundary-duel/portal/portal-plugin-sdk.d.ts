// Types only, from TenkaCloud packages/portal-plugin-sdk/src/index.ts (05ffed84).
// No platform package or runtime implementation is installed in the catalog.
declare module "@tenkacloud/portal-plugin-sdk" {
  export interface PortalCoordinationClient {
    submitOp(op: unknown): Promise<PortalCoordinationOutcome>;
    getProjection(): Promise<PortalCoordinationOutcome>;
  }
  export type PortalCoordinationOutcome =
    | { kind: "ok"; projection: unknown }
    | { kind: "rejected"; error: string }
    | { kind: "conflict" | "unavailable" | "not_configured" | "unauthorized" };
  export interface PortalSlotProps {
    team: { teamId?: string; teamName: string; eventId?: string };
    problemId: string;
    jobId: string;
    score: number;
    locale: "ja" | "en";
    endpoints: readonly unknown[];
    phases: readonly unknown[];
    disruptions: readonly unknown[];
    nowIso: string;
    eventEndsAt?: string;
    coordinationClient?: PortalCoordinationClient;
  }
}
