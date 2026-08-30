declare module "@tenkacloud/portal-plugin-sdk" {
  export type PortalLocale = "ja" | "en";

  export interface PortalEndpoint {
    readonly slot: string;
    readonly overridable: boolean;
    readonly label?: string;
    readonly description?: string;
    readonly defaultUrl?: string;
    readonly overrideUrl?: string;
    readonly effectiveUrl?: string;
  }

  export interface PortalPhaseEntry {
    readonly name: string;
    readonly afterMinutes: number;
  }

  export interface PortalDisruptionEntry {
    readonly id: string;
    readonly name: string;
    readonly defaultAfterMinutes?: number;
  }

  export interface PortalSlotProps {
    readonly team: { readonly teamId?: string; readonly teamName: string; readonly eventId?: string };
    readonly problemId: string;
    readonly jobId: string;
    readonly score: number;
    readonly locale: PortalLocale;
    readonly posture?: Readonly<Record<string, boolean>>;
    readonly platform?: string;
    readonly endpoints: readonly PortalEndpoint[];
    readonly phases: readonly PortalPhaseEntry[];
    readonly disruptions: readonly PortalDisruptionEntry[];
    readonly nowIso: string;
  }
}
