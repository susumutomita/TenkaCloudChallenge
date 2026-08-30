/**
 * Issue #644: the browser half of the local development harness.
 *
 * Renders the REAL `../portal/*.tsx` slot components — the same three files
 * `../metadata.json`'s `dashboard.slots` declares, imported unmodified — against
 * a fake portal host. Nothing about the game is re-implemented here; this file
 * only supplies what the participant portal would supply: `PortalSlotProps` and
 * a `PortalCoordinationClient`.
 *
 * The dev toolbar is intentionally ugly and unlike the game's own styling. A
 * screenshot of this page must never be mistaken for the participant portal,
 * and no control here may look like part of the problem.
 *
 * NOT A TRUST BOUNDARY — see README.md. The seat selector switches teams with
 * no credential at all, which is precisely what the real portal never does.
 */

import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  PortalCoordinationClient,
  PortalCoordinationOutcome,
  PortalLocale,
  PortalSlotProps,
} from "@tenkacloud/portal-plugin-sdk";
import HelpDrawer from "../portal/HelpDrawer.tsx";
import RegistrationPanel from "../portal/RegistrationPanel.tsx";
import StatusPanel from "../portal/StatusPanel.tsx";
import { SCENARIO_LABELS, type ScenarioId } from "./scenarios.ts";

interface SessionInfo {
  readonly scenarioId: ScenarioId;
  readonly scenarios: readonly ScenarioId[];
  readonly teamIds: readonly string[];
  readonly eventId: string;
  readonly nowMs: number;
  readonly running: boolean;
  readonly version: number;
}

async function postJson(path: string, body: unknown): Promise<SessionInfo> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as SessionInfo;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The panels re-poll when the `client` object's identity changes (see
 * `../portal/coordination.ts`'s `usePolledProjection`). Production polls every
 * 30 seconds, which is right for a live match over the internet and far too
 * slow to develop against — so the harness mints a fresh client whenever
 * anything could have moved the board, and every mounted panel refreshes at
 * once. The polling code itself is untouched; only its input identity changes.
 */
function useCoordinationClient(
  team: string,
  revision: number,
  onWrite: () => void,
): PortalCoordinationClient {
  return useMemo<PortalCoordinationClient>(
    () => ({
      async getProjection() {
        const response = await fetch(`/api/projection?team=${encodeURIComponent(team)}`);
        return (await response.json()) as PortalCoordinationOutcome;
      },
      async submitOp(op) {
        const response = await fetch(`/api/op?team=${encodeURIComponent(team)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(op),
        });
        const outcome = (await response.json()) as PortalCoordinationOutcome;
        // A rejected op still moves the clock (the host ticks before it
        // validates), so refresh either way rather than only on success.
        onWrite();
        return outcome;
      },
    }),
    // `revision` is the whole point of this dependency list: it is what makes
    // the identity change. biome-ignore lint/correctness/useExhaustiveDependencies: intentional identity bump
    [team, revision, onWrite],
  );
}

function DevToolbar(props: {
  readonly session: SessionInfo;
  readonly team: string;
  readonly locale: PortalLocale;
  readonly onTeam: (team: string) => void;
  readonly onLocale: (locale: PortalLocale) => void;
  readonly onScenario: (id: ScenarioId) => void;
  readonly onAdvance: (ms: number) => void;
  readonly onRunning: (running: boolean) => void;
}) {
  const { session, team, locale } = props;
  return (
    <>
      <div className="dev-chrome">
        <strong>DEV HARNESS</strong>
        <label>
          scenario
          <select
            value={session.scenarioId}
            onChange={(event) => props.onScenario(event.target.value as ScenarioId)}
          >
            {session.scenarios.map((id) => (
              <option key={id} value={id}>
                {SCENARIO_LABELS[id]?.[locale] ?? id}
              </option>
            ))}
          </select>
        </label>
        <label>
          seat
          <select value={team} onChange={(event) => props.onTeam(event.target.value)}>
            {session.teamIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          locale
          <select
            value={locale}
            onChange={(event) => props.onLocale(event.target.value as PortalLocale)}
          >
            <option value="ja">ja</option>
            <option value="en">en</option>
          </select>
        </label>
        <label>
          clock {formatClock(session.nowMs)}
          <button type="button" onClick={() => props.onAdvance(30_000)}>
            +30s
          </button>
          <button type="button" onClick={() => props.onAdvance(60_000)}>
            +1m
          </button>
          <button type="button" onClick={() => props.onAdvance(5 * 60_000)}>
            +5m
          </button>
          <button type="button" onClick={() => props.onRunning(!session.running)}>
            {session.running ? "⏸ pause" : "▶ run"}
          </button>
        </label>
      </div>
      <div className="dev-banner">
        ローカル開発用プレビューです。競技の信頼境界ではなく、ここでのスコアは公式記録ではありません。
        {" / "}
        Local development preview. Not the competition trust boundary; no score here is official.
      </div>
    </>
  );
}

function Harness() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [team, setTeam] = useState("alpha");
  const [locale, setLocale] = useState<PortalLocale>("ja");
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/session");
    setSession((await response.json()) as SessionInfo);
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While the clock runs, keep the toolbar's readout and the panels honest.
  // Paused is the default, so this timer normally does nothing.
  useEffect(() => {
    if (!session?.running) return;
    const timer = setInterval(() => void refresh(), 1_000);
    return () => clearInterval(timer);
  }, [session?.running, refresh]);

  const onWrite = useCallback(() => {
    void refresh();
  }, [refresh]);
  const client = useCoordinationClient(team, revision, onWrite);

  const slotProps = useMemo<PortalSlotProps>(
    () => ({
      team: { teamId: team, teamName: team, eventId: session?.eventId },
      problemId: "ac26-crypto-battle",
      jobId: "local-dev-harness",
      score: 0,
      locale,
      endpoints: [],
      phases: [],
      disruptions: [],
      coordinationClient: client,
      // The panels render a live countdown from this; a frozen value would make
      // every deadline look stuck.
      nowIso: new Date().toISOString(),
    }),
    [team, locale, client, session?.eventId],
  );

  if (!session) return <p style={{ padding: 16 }}>loading…</p>;

  return (
    <>
      <DevToolbar
        session={session}
        team={team}
        locale={locale}
        onTeam={(next) => {
          setTeam(next);
          setRevision((current) => current + 1);
        }}
        onLocale={(next) => {
          setLocale(next);
          setRevision((current) => current + 1);
        }}
        onScenario={async (id) => {
          setSession(await postJson("/api/scenario", { id }));
          setRevision((current) => current + 1);
        }}
        onAdvance={async (advanceMs) => {
          setSession(await postJson("/api/clock", { advanceMs }));
          setRevision((current) => current + 1);
        }}
        onRunning={async (running) => {
          setSession(await postJson("/api/clock", { running }));
          setRevision((current) => current + 1);
        }}
      />
      <div className="dev-slots">
        {/*
          The three slots `../metadata.json` declares, in the order the portal
          stacks them. Anything else under `../portal/` reaches the screen the
          same way it does in production: as an import of one of these three.
        */}
        <section className="dev-slot">
          <h2>StatusPanel</h2>
          <StatusPanel {...slotProps} />
        </section>
        <section className="dev-slot">
          <h2>RegistrationPanel</h2>
          <RegistrationPanel {...slotProps} />
        </section>
        <section className="dev-slot">
          <h2>HelpDrawer</h2>
          <HelpDrawer {...slotProps} />
        </section>
      </div>
    </>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("dev harness: #root is missing from index.html");
createRoot(container).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
