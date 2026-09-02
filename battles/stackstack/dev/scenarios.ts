import type { PortalLocale, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

export const SCENARIO_IDS = ["unregistered", "measuring", "partial", "ready", "incident"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const SCENARIO_LABELS: Record<ScenarioId, { ja: string; en: string }> = {
  unregistered: { ja: "1. URL 未登録", en: "1. URL not registered" },
  measuring: { ja: "2. 最初の測定待ち", en: "2. Waiting for first measurement" },
  partial: { ja: "3. 本番化の途中", en: "3. Hardening in progress" },
  ready: { ja: "4. 本番化完了", en: "4. Production ready" },
  incident: { ja: "5. 完了後に改ざんを検知", en: "5. Tampering after completion" },
};

const GATES_FALSE = {
  db_present: false,
  auth_enabled: false,
  rate_limited: false,
  audit_on: false,
  on_rds: false,
  ssh_closed: false,
} as const;

const GATES_TRUE = {
  db_present: true,
  auth_enabled: true,
  rate_limited: true,
  audit_on: true,
  on_rds: true,
  ssh_closed: true,
} as const;

const SAFE = { site_intact: true, no_backdoor: true, board_clean: true } as const;

export function scenarioProps(id: ScenarioId, locale: PortalLocale): PortalSlotProps {
  const common = {
    problemId: "stackstack",
    score: 0,
    locale,
    phases: [],
    disruptions: [],
    nowIso: "2026-08-31T00:00:00.000Z",
  } as const;

  if (id === "unregistered") {
    return {
      ...common,
      team: { teamId: "team-alpha", teamName: "Alpha", eventId: "local-preview" },
      jobId: "local-alpha",
      endpoints: [{ slot: "app", overridable: true }],
    };
  }

  if (id === "measuring") {
    return {
      ...common,
      team: { teamId: "team-alpha", teamName: "Alpha", eventId: "local-preview" },
      jobId: "local-alpha",
      endpoints: [{ slot: "app", overridable: true, effectiveUrl: "https://alpha.local.example" }],
    };
  }

  if (id === "partial") {
    return {
      ...common,
      team: { teamId: "team-alpha", teamName: "Alpha", eventId: "local-preview" },
      jobId: "local-alpha",
      platform: "posture-2",
      endpoints: [{ slot: "app", overridable: true, effectiveUrl: "https://alpha.local.example" }],
      posture: { ...GATES_FALSE, db_present: true, auth_enabled: true, ...SAFE },
    };
  }

  if (id === "ready") {
    return {
      ...common,
      team: { teamId: "team-bravo", teamName: "Bravo", eventId: "local-preview" },
      jobId: "local-bravo",
      platform: "production",
      endpoints: [{ slot: "app", overridable: true, effectiveUrl: "https://bravo.local.example" }],
      posture: { ...GATES_TRUE, ...SAFE },
    };
  }

  return {
    ...common,
    team: { teamId: "team-bravo", teamName: "Bravo", eventId: "local-preview" },
    jobId: "local-bravo",
    platform: "posture-2",
    endpoints: [{ slot: "app", overridable: true, effectiveUrl: "https://bravo.local.example" }],
    posture: { ...GATES_TRUE, ...SAFE, site_intact: false },
  };
}
