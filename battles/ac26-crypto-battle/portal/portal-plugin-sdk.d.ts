/**
 * Local, TYPES-ONLY ambient declaration of `@tenkacloud/portal-plugin-sdk`'s
 * public API (Issue #486, PR4).
 *
 * SOURCE OF TRUTH: TenkaCloud's `packages/portal-plugin-sdk/src/index.ts`.
 * If that package's `PortalSlotProps` / `PortalCoordinationOutcome` /
 * `PortalCoordinationClient` / `PortalEndpoint` / `PortalPhaseEntry` /
 * `PortalDisruptionEntry` / `PortalCoordinationEntry` / `PortalSlotComponent`
 * / `PORTAL_SLOT_NAMES` shapes change, this file (and every `portal/*.tsx`
 * plugin, and `game/src/portal.test.ts`'s fake `PortalCoordinationClient`)
 * must be updated to match.
 *
 * TenkaCloudChallenge does NOT and MUST NOT depend on the real
 * `@tenkacloud/portal-plugin-sdk` package -- this repo owns problem content,
 * not platform packages (see this repo's `AGENTS.md`, "Repository
 * boundary"). This file exists ONLY so `tsc` can resolve the bare import in
 * `portal/StatusPanel.tsx` / `portal/RegistrationPanel.tsx` /
 * `portal/HelpDrawer.tsx` when typechecking locally (see
 * `../game/tsconfig.json`'s `include`); it contributes zero runtime code (an
 * ambient `declare module` block erases completely on emit) and is never
 * bundled or shipped. At runtime, on the TenkaCloud side, the real SDK is
 * what actually type-checks and executes these plugins -- the participant
 * portal (`apps/participant-portal`) discovers `portal/*.tsx` via a Vite
 * `import.meta.glob` build-time integration (see
 * `apps/participant-portal/src/plugins/loader.ts`'s header), the same
 * mechanism `battles/microservice-migration-battle/portal/*.tsx` (the
 * pre-existing precedent this PR follows) already relies on.
 *
 * Same pattern as `coordination/coordination-plugin-sdk.d.ts` (PR3) for
 * `@tenkacloud/coordination-plugin-sdk` -- see that file's header for the
 * fuller rationale, which applies here unchanged.
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
