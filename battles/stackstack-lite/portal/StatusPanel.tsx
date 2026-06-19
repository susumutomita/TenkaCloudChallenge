/**
 * StackStack Lite portal slot — Vibe to Production (intro) status display.
 *
 * The live posture comes from the app's /posture endpoint; this panel keeps the
 * participant oriented around URL registration and the three production gates.
 * (Until the SDK passes a locale, strings are English — see platform issue.)
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

// The three gates the app counts toward production. Each becoming true raises the
// per-minute score; all three true earns the production platform + a one-time bonus.
const GATES = [
  { key: "db_present", label: "DB", hint: "restore the S3 backup seed into the app DB" },
  { key: "auth_enabled", label: "Auth", hint: "enable app auth with a non-default token" },
  { key: "audit_on", label: "Audit", hint: "turn on audit writes to the S3 audit bucket" },
];

export default function StatusPanel(props: PortalSlotProps) {
  const { endpoints } = props;
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
        StackStack Lite — Vibe to Production (intro)
      </h3>
      <p style={{ margin: "0 0 16px 0", color: "#5f6b7a", fontSize: "13px" }}>
        Deploy the local build, register the AppUrlHint override, then run <code>vibe-status</code> on the
        host and use <code>/posture</code> as the source of truth. Production needs all three gates true.
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

      <div>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>
          Production gates
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
    </section>
  );
}
