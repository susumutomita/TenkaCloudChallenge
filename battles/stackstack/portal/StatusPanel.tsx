/**
 * StackStack portal slot — Vibe to Production status display.
 *
 * The live posture comes from the app's /posture endpoint; this panel keeps the
 * participant oriented around URL registration, the five production gates, and
 * the two integrity checks that a security incident can knock down.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

// The five gates the app counts toward production. Each becoming true raises the
// per-minute score; all five true earns the production platform.
const GATES = [
  { key: "db_present", label: "DB", hint: "S3 backup restore completed" },
  { key: "auth_enabled", label: "Auth", hint: "anonymous submit is rejected" },
  { key: "rate_limited", label: "Rate", hint: "WAF WebACL is associated to the ALB" },
  { key: "audit_on", label: "Audit", hint: "audit events write to S3" },
  { key: "on_rds", label: "RDS", hint: "app queries the existing RDS DB" },
];

// Integrity posture keys. These are NOT counted toward the five gates, but while
// either is false the app cannot be production (the red-team defacement and
// supply-chain backdoor disruptions trip these). Restore the site / remove the
// backdoor to climb back to production.
const INTEGRITY = [
  { key: "site_intact", label: "Site", hint: "board is not defaced (site-defaced disruption)" },
  {
    key: "no_backdoor",
    label: "No backdoor",
    hint: "no supply-chain artifact present (supply-chain-backdoor disruption)",
  },
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
        Production earns the one-time bonus only when every gate is true and the board stays
        intact — a defacement or supply-chain backdoor drops you out of production until you
        recover.
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

      <div style={{ marginBottom: "16px" }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>
          Production integrity
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "8px",
          }}
        >
          {INTEGRITY.map((check) => (
            <div
              key={check.key}
              style={{
                border: "1px solid #f0c2a0",
                borderRadius: "6px",
                padding: "10px",
                background: "#fff8f3",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>{check.label}</div>
              <div style={{ color: "#5f6b7a", fontSize: "12px" }}>{check.hint}</div>
              <code style={{ display: "block", marginTop: "6px", fontSize: "12px" }}>
                {check.key}
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
