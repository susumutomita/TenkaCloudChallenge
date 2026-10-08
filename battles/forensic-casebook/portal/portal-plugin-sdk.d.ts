/** Types-only mirror of TenkaCloud/packages/portal-plugin-sdk/src/index.ts.
 * This declaration emits no code. The native host supplies the authoritative SDK;
 * the standalone practice harness supplies the same PortalSlotProps contract.
 */
declare module "@tenkacloud/portal-plugin-sdk" {
  import type { ComponentType } from "react";

  export type PortalLocale = "ja" | "en";

  /**
   * Common props every plugin slot receives. portal hands the problem's
   * deployment / scoring / phase state to the plugin in one shot.
   */
  export interface PortalSlotProps {
    readonly team: {
      readonly teamId?: string;
      readonly teamName: string;
      readonly eventId?: string;
    };
    readonly problemId: string;
    readonly jobId: string;
    readonly score: number;
    readonly locale: PortalLocale;
    readonly posture?: Readonly<Record<string, boolean>>;
    readonly platform?: string;
    readonly endpoints: readonly PortalEndpoint[];
    readonly phases: readonly PortalPhaseEntry[];
    readonly disruptions: readonly PortalDisruptionEntry[];
    /**
     * Issue #1420: public inter-team coordination info (`publicHint: true`
     * problems only). undefined for undeclared / non-public problems.
     */
    readonly coordination?: PortalCoordinationEntry;
    /**
     * Issue #1420: a client bound to the team's own credential, used to call
     * the coordination dispatcher. Only bound when portal has both a
     * dispatcher URL and a session; undefined when unwired or coordination
     * is disabled for this problem. A plugin calls
     * `coordinationClient?.submitOp(op)` to submit an op and
     * `coordinationClient?.getProjection()` to read its own team's
     * projection.
     */
    readonly coordinationClient?: PortalCoordinationClient;
    readonly nowIso: string;
    /** ISO 8601 scoring end time of the event; undefined when the event has no end time. */
    readonly eventEndsAt?: string;
  }

  /**
   * A coordination op's outcome -- mirrors the dispatcher's HTTP status as a
   * discriminated union. A plugin branches on `kind` (ok = projection
   * updated, rejected = show the reason, the rest = an infra-side condition).
   */
  export type PortalCoordinationOutcome =
    | { readonly kind: "ok"; readonly projection: unknown }
    | { readonly kind: "rejected"; readonly error: string }
    | { readonly kind: "conflict" }
    | { readonly kind: "unavailable" }
    | { readonly kind: "not_configured" }
    | { readonly kind: "unauthorized" };

  /**
   * A coordination client already bound to the team's credential (portal
   * injects it). A plugin never sees a URL or token directly.
   */
  export interface PortalCoordinationClient {
    readonly submitOp: (op: unknown) => Promise<PortalCoordinationOutcome>;
    readonly getProjection: () => Promise<PortalCoordinationOutcome>;
  }

  /** One endpoint slot's state. effective = override ?? default. */
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
    readonly description?: string;
    readonly publicHint?: boolean;
  }

  export interface PortalDisruptionEntry {
    readonly id: string;
    readonly name: string;
    readonly defaultAfterMinutes?: number;
    readonly description?: string;
    readonly publicHint?: boolean;
  }

  /** Issue #1420: the public-facing description of an inter-team coordination feature. */
  export interface PortalCoordinationEntry {
    readonly name?: string;
    readonly description?: string;
  }

  /** The component type a `portal/<SlotName>.tsx` file default-exports. */
  export type PortalSlotComponent = ComponentType<PortalSlotProps>;

  /** The reserved slot names portal and plugins both share, to catch typos. */
  export const PORTAL_SLOT_NAMES: readonly ["StatusPanel", "RegistrationPanel", "HelpDrawer"];
  export type PortalSlotName = (typeof PORTAL_SLOT_NAMES)[number];
}
