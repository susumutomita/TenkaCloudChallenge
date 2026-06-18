/**
 * StackStack portal slot — Vibe to Production status display.
 *
 * The live posture comes from the app's /posture endpoint; this panel keeps the
 * participant oriented around URL registration, the six production gates, and
 * the two integrity checks that a security incident can knock down.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

type LocalizedText = Readonly<{ en: string; ja: string }>;

// The six gates the app counts toward production. Each becoming true raises the
// per-minute score; all six true earns the production platform.
const GATES = [
  {
    key: "db_present",
    label: "DB",
    hint: {
      en: "S3 backup restore completed",
      ja: "S3 backup dump を復元済み",
    },
  },
  {
    key: "auth_enabled",
    label: "Auth",
    hint: {
      en: "anonymous submit is rejected",
      ja: "匿名投稿が拒否されている",
    },
  },
  {
    key: "rate_limited",
    label: "Rate",
    hint: {
      en: "WAF WebACL is associated to the ALB",
      ja: "WAF WebACL を ALB に関連付け済み",
    },
  },
  {
    key: "audit_on",
    label: "Audit",
    hint: {
      en: "audit events write to S3",
      ja: "監査イベントが S3 に書き込まれる",
    },
  },
  {
    key: "on_rds",
    label: "RDS",
    hint: {
      en: "app queries the existing RDS DB",
      ja: "既存 RDS DB を参照している",
    },
  },
  {
    key: "ssh_closed",
    label: "SSH",
    hint: {
      en: "no public tcp/22 rule remains on the app SG",
      ja: "app SG に public tcp/22 ルールが残っていない",
    },
  },
];

// Integrity posture keys. These are NOT counted toward the six gates, but while
// either is false the app cannot be production (the red-team defacement and
// supply-chain backdoor disruptions trip these). Restore the site / remove the
// backdoor to climb back to production.
const INTEGRITY = [
  {
    key: "site_intact",
    label: "Site",
    hint: {
      en: "board is not defaced (site-defaced disruption)",
      ja: "掲示板が改ざんされていない",
    },
  },
  {
    key: "no_backdoor",
    label: "No backdoor",
    hint: {
      en: "no supply-chain artifact present (supply-chain-backdoor disruption)",
      ja: "backdoor 成果物が残っていない",
    },
  },
];

const COPY = {
  en: {
    title: "StackStack - Vibe to Production",
    body:
      "Register the AppUrlHint override, then use /posture as the source of truth. Production earns the one-time bonus only when every gate is true and the board stays intact.",
    effectiveUrl: "Effective URL",
    notRegistered: "not registered",
    override: "Override",
    registered: "registered",
    waitingOverride: "waiting for AppUrlHint",
    platform: "Measured platform",
    platformPending: "waiting for probe",
    nextAction: "Next action",
    probePending: "Waiting for the next posture probe.",
    complete: "Production posture is complete.",
    gates: "Production gates",
    integrity: "Production integrity",
    done: "OK",
    todo: "TODO",
    unknown: "unknown",
    phases: "Phases",
    disruptions: "Operator-fired disruptions",
  },
  ja: {
    title: "StackStack - 本番化ステータス",
    body:
      "AppUrlHint を override に登録し、/posture の実測値を見ながら本番化を進めます。全 gate が true で、かつ掲示板が正常なときだけ production bonus に到達します。",
    effectiveUrl: "有効 URL",
    notRegistered: "未登録",
    override: "Override",
    registered: "登録済み",
    waitingOverride: "AppUrlHint 待ち",
    platform: "実測 platform",
    platformPending: "probe 待ち",
    nextAction: "次の一手",
    probePending: "次回の posture probe を待っています。",
    complete: "本番化 posture は完了しています。",
    gates: "Production gate",
    integrity: "Production integrity",
    done: "OK",
    todo: "未達",
    unknown: "未測定",
    phases: "Phase",
    disruptions: "運営が発火する障害",
  },
} as const;

export default function StatusPanel(props: PortalSlotProps) {
  const { endpoints, phases, disruptions, platform, posture } = props;
  const locale = props.locale === "ja" ? "ja" : "en";
  const copy = COPY[locale];
  const app = endpoints.find((ep) => ep.slot === "app");
  const next = [...GATES, ...INTEGRITY].find((check) => posture?.[check.key] === false);

  return (
    <section
      style={{
        border: "1px solid #d5dbdb",
        borderRadius: "8px",
        padding: "16px",
        background: "#fafafa",
      }}
    >
      <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>{copy.title}</h3>
      <p style={{ margin: "0 0 16px 0", color: "#5f6b7a", fontSize: "13px" }}>
        {copy.body}
      </p>

      <div style={{ marginBottom: "16px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <tbody>
            <tr style={{ borderBottom: "1px solid #eaeded" }}>
              <th style={{ padding: "6px 8px", textAlign: "left", width: "140px" }}>
                {copy.effectiveUrl}
              </th>
              <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: "12px" }}>
                {app?.effectiveUrl || copy.notRegistered}
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #eaeded" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>{copy.override}</th>
              <td style={{ padding: "6px 8px" }}>
                {app?.overrideUrl ? (
                  <span style={{ color: "#1a7f37", fontWeight: 600 }}>{copy.registered}</span>
                ) : (
                  <span style={{ color: "#9a6700" }}>{copy.waitingOverride}</span>
                )}
              </td>
            </tr>
            <tr>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>{copy.platform}</th>
              <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: "12px" }}>
                {platform ?? copy.platformPending}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginBottom: "16px",
          border: "1px solid #d5dbdb",
          borderRadius: "6px",
          padding: "10px",
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>{copy.nextAction}</div>
        <div style={{ color: "#414d5c", fontSize: "13px" }}>
          {!posture
            ? copy.probePending
            : next
              ? `${next.label}: ${text(next.hint, locale)}`
              : copy.complete}
        </div>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>
          {copy.gates}
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "8px",
          }}
        >
          {GATES.map((gate) => (
            <PostureCard key={gate.key} check={gate} copy={copy} locale={locale} posture={posture} />
          ))}
        </div>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>
          {copy.integrity}
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "8px",
          }}
        >
          {INTEGRITY.map((check) => (
            <PostureCard
              key={check.key}
              check={check}
              copy={copy}
              locale={locale}
              posture={posture}
              warning
            />
          ))}
        </div>
      </div>

      {phases.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>
            {copy.phases}
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
            {copy.disruptions}
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

function PostureCard({
  check,
  copy,
  locale,
  posture,
  warning = false,
}: {
  check: { key: string; label: string; hint: LocalizedText };
  copy: (typeof COPY)["en"];
  locale: keyof typeof COPY;
  posture: Readonly<Record<string, boolean>> | undefined;
  warning?: boolean;
}) {
  const state = posture?.[check.key];
  const status =
    state === true ? copy.done : state === false ? copy.todo : copy.unknown;
  const border =
    state === true ? "#b7dfc5" : state === false ? "#f0c2a0" : warning ? "#f0c2a0" : "#d5dbdb";
  const background =
    state === true ? "#f3fcf6" : state === false ? "#fff8f3" : warning ? "#fff8f3" : "#fff";
  const statusColor = state === true ? "#1a7f37" : state === false ? "#9a6700" : "#5f6b7a";

  return (
    <div
      style={{
        border: `1px solid ${border}`,
        borderRadius: "6px",
        padding: "10px",
        background,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>{check.label}</div>
        <div style={{ color: statusColor, fontSize: "12px", fontWeight: 700 }}>{status}</div>
      </div>
      <div style={{ color: "#5f6b7a", fontSize: "12px" }}>{text(check.hint, locale)}</div>
      <code style={{ display: "block", marginTop: "6px", fontSize: "12px" }}>{check.key}</code>
    </div>
  );
}

function text(value: LocalizedText, locale: keyof typeof COPY): string {
  return value[locale] ?? value.en;
}
