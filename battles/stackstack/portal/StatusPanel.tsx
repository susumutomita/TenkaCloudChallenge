/**
 * StackStack portal slot — Vibe to Production status display.
 *
 * The live posture comes from the app's /posture endpoint; this panel keeps the
 * participant oriented around URL registration and the five production gates.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

const GATES = [
  { key: "db_present", label: "DB", hint: "S3 backup restore completed" },
  { key: "auth_enabled", label: "Auth", hint: "anonymous submit is rejected" },
  { key: "rate_limited", label: "Rate", hint: "WAF WebACL is associated to the ALB" },
  { key: "audit_on", label: "Audit", hint: "audit events write to S3" },
  { key: "on_aurora", label: "Aurora", hint: "app queries the existing Aurora DB" },
];

export default function StatusPanel(props: PortalSlotProps) {
  const { endpoints, phases, disruptions } = props;
  const app = endpoints.find((ep) => ep.slot === "app");

  return (
    <section
      style={{
        border: "1px solid #d5dbdb",
        borderRadius: "8px",
        padding: "16px",
        background: "#fafafa",
      }}
    >
      <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>
        StackStack — Vibe to Production
      </h3>
      <p style={{ margin: "0 0 16px 0", color: "#5f6b7a", fontSize: "13px" }}>
        Register the AppUrlHint override, then use <code>/posture</code> as the source of truth.
        Production earns the one-time bonus only when every gate is true.
      </p>

      <div style={{ marginBottom: "16px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <tbody>
            <tr style={{ borderBottom: "1px solid #eaeded" }}>
              <th style={{ padding: "6px 8px", textAlign: "left", width: "140px" }}>
                Effective URL
              </th>
              <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: "12px" }}>
                {app?.effectiveUrl || "not registered"}
              </td>
            </tr>
            <tr>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Override</th>
              <td style={{ padding: "6px 8px" }}>
                {app?.overrideUrl ? (
                  <span style={{ color: "#1a7f37", fontWeight: 600 }}>registered</span>
                ) : (
                  <span style={{ color: "#9a6700" }}>waiting for AppUrlHint</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>
          Production gates
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "8px",
          }}
        >
          {GATES.map((gate) => (
            <div
              key={gate.key}
              style={{
                border: "1px solid #d5dbdb",
                borderRadius: "6px",
                padding: "10px",
                background: "#fff",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>{gate.label}</div>
              <div style={{ color: "#5f6b7a", fontSize: "12px" }}>{gate.hint}</div>
              <code style={{ display: "block", marginTop: "6px", fontSize: "12px" }}>
                {gate.key}
              </code>
            </div>
          ))}
        </div>
      </div>

      {phases.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>
            Phases
          </h4>
          <ul style={{ margin: "0", paddingLeft: "20px", fontSize: "13px" }}>
            {phases.map((p) => (
              <li key={p.name}>
                <strong>+{p.afterMinutes} min</strong> — {p.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {disruptions.length > 0 && (
        <div>
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#d13212" }}>
            Operator-fired disruptions
          </h4>
          <ul style={{ margin: "0", paddingLeft: "20px", fontSize: "13px" }}>
            {disruptions.map((d) => (
              <li key={d.id}>
                <strong>{d.name}</strong>
                {typeof d.defaultAfterMinutes === "number" && (
                  <span style={{ color: "#5f6b7a" }}> (+{d.defaultAfterMinutes} min default)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
