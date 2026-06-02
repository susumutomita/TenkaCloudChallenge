/**
 * ADR-012 Phase 5 / ADR-028 (#1420): microservice-migration-battle 専用 StatusPanel plugin。
 *
 * 自チームの 3 slot (users / orders / catalog) の effective URL を 1 panel にまとめて表示する。
 * portal の標準 StatusPanel ではなく本 plugin が render される (= metadata.dashboard.slots.StatusPanel で指名済)。
 *
 * #1420 で **inter-team coordination の live route directory** を追加。 `props.coordination` は
 * metadata.interTeamCoordination の公開情報 (= 静的 announcement)、 `props.coordinationClient` は
 * dispatcher を team の credential で叩く live client (= portal が束縛、 plugin は URL/token 非保持)。
 * coordinationClient.getProjection() で全チームの公開 route directory を取得し、 30s polling で更新する
 * (= SSE/WebSocket は使わない、 ADR-014 / polling-over-SSE 方針)。 未配線 (= client undefined) の
 * 環境では section ごと出さない (= fail-closed、 belt-and-suspenders)。
 *
 * phases / disruptions の predicted timing は競技上 spoiler なので、 metadata 側で
 * publicHint=false にしてあり、 props.phases / props.disruptions は通常空配列で渡される。
 * 念のため `.length > 0` ガードで section ごと出さない構造にしている (belt-and-suspenders)。
 *
 * 設計判断: Cloudscape は使わない (= Phase 5 MVP は plugin bundle が
 * peer-dep を持たない build-time integration、 Cloudscape import は portal 本体側で発生する
 * ため plugin 側で直接 import すると bundle 二重化する)。 plain HTML + inline style で書く。
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { useEffect, useState } from "react";

/** router.ts (coordination plugin) が共有する service 名。 projection の列順をここで固定する。 */
const SERVICES = ["users", "orders", "catalog"] as const;

/**
 * router.ts の projectForTeam が返す形 (= `{ directory: teamId → (service → url) }`)。 SDK は
 * projection を `unknown` で渡す (= plugin 非依存) ので、 本 plugin が自分の router 形に narrow する。
 */
interface RouteDirectory {
  readonly directory: Record<string, Partial<Record<string, string>>>;
}

function isRouteDirectory(value: unknown): value is RouteDirectory {
  return (
    typeof value === "object" &&
    value !== null &&
    "directory" in value &&
    typeof (value as { directory: unknown }).directory === "object" &&
    (value as { directory: unknown }).directory !== null
  );
}

const COORDINATION_POLL_MS = 30_000;

export default function StatusPanel(props: PortalSlotProps) {
  const { endpoints, phases, disruptions, coordination, coordinationClient } = props;
  const myTeamId = props.team.teamId;

  // live route directory (= 全チームの公開 route)。 coordinationClient が無ければ fetch しない。
  const [directory, setDirectory] = useState<RouteDirectory["directory"] | null>(null);
  // dispatcher 側の非-ok outcome (= unavailable / not_configured / unauthorized) を operator に見せる。
  const [coordStatus, setCoordStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!coordinationClient) return;
    let active = true;
    const poll = async () => {
      const outcome = await coordinationClient.getProjection();
      if (!active) return;
      if (outcome.kind === "ok" && isRouteDirectory(outcome.projection)) {
        setDirectory(outcome.projection.directory);
        setCoordStatus(null);
      } else if (outcome.kind !== "ok") {
        setCoordStatus(outcome.kind);
      }
    };
    void poll();
    // ADR-014 / polling-over-SSE: 一定間隔で directory を引き直す (= SSE/WebSocket は使わない)。
    const timer = setInterval(() => void poll(), COORDINATION_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [coordinationClient]);

  const teamIds = directory ? Object.keys(directory).sort() : [];

  return (
    <section
      style={{
        border: "1px solid #d5dbdb",
        borderRadius: "8px",
        padding: "16px",
        background: "#fafafa",
      }}
    >
      <h3 style={{ margin: "0 0 12px 0", fontSize: "16px" }}>Microservice Migration — Status</h3>
      <p style={{ margin: "0 0 16px 0", color: "#5f6b7a" }}>
        users / orders / catalog の 3 endpoint の現在 routing 先を表示します。
        endpoint を override 登録すると、 platform の scoring engine が新 URL を probe します。
      </p>

      <div style={{ marginBottom: "16px" }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>Endpoint slots</h4>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #d5dbdb", textAlign: "left" }}>
              <th style={{ padding: "4px 8px" }}>Slot</th>
              <th style={{ padding: "4px 8px" }}>Effective URL</th>
              <th style={{ padding: "4px 8px" }}>Override?</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep) => (
              <tr key={ep.slot} style={{ borderBottom: "1px solid #eaeded" }}>
                <td style={{ padding: "4px 8px", fontWeight: 500 }}>{ep.label ?? ep.slot}</td>
                <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: "12px" }}>
                  {ep.effectiveUrl ?? "—"}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {ep.overrideUrl ? "yes (override)" : "no (default)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {coordination && coordinationClient && (
        <div style={{ marginBottom: "16px" }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#0972d3" }}>
            {coordination.name ?? "サービスルーター"} (inter-team)
          </h4>
          {coordination.description && (
            <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#5f6b7a" }}>
              {coordination.description}
            </p>
          )}
          {coordStatus && (
            <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#d13212" }}>
              coordination: {coordStatus}
            </p>
          )}
          {directory && teamIds.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #d5dbdb", textAlign: "left" }}>
                  <th style={{ padding: "4px 8px" }}>Team</th>
                  {SERVICES.map((svc) => (
                    <th key={svc} style={{ padding: "4px 8px" }}>
                      {svc}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamIds.map((teamId) => {
                  const routes = directory[teamId] ?? {};
                  const isMe = teamId === myTeamId;
                  return (
                    <tr key={teamId} style={{ borderBottom: "1px solid #eaeded" }}>
                      <td style={{ padding: "4px 8px", fontWeight: isMe ? 700 : 400 }}>
                        {isMe ? `${teamId} (you)` : teamId}
                      </td>
                      {SERVICES.map((svc) => (
                        <td
                          key={svc}
                          style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: "12px" }}
                        >
                          {routes[svc] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            !coordStatus && (
              <p style={{ margin: "0", fontSize: "13px", color: "#5f6b7a" }}>
                まだ登録された route はありません。
              </p>
            )
          )}
        </div>
      )}

      {phases.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>
            Upcoming phases
          </h4>
          <ul style={{ margin: "0", paddingLeft: "20px", fontSize: "13px" }}>
            {phases.map((p) => (
              <li key={p.name}>
                <strong>+{p.afterMinutes} 分</strong> — {p.name}
                {p.description && <span style={{ color: "#5f6b7a" }}>: {p.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {disruptions.length > 0 && (
        <div>
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#d13212" }}>Disruptions</h4>
          <ul style={{ margin: "0", paddingLeft: "20px", fontSize: "13px" }}>
            {disruptions.map((d) => (
              <li key={d.id}>
                {typeof d.defaultAfterMinutes === "number" && (
                  <strong>+{d.defaultAfterMinutes} 分</strong>
                )}{" "}
                {d.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
