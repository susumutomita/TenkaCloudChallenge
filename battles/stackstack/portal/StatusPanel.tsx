/**
 * StackStack portal slot — production-readiness status for the competitor.
 *
 * The live state comes from the app's posture measurement. This panel keeps the
 * competitor oriented around their service URL, the six production checks, and
 * the three security checks that an incident can knock down. It deliberately
 * shows competitor-facing language only — no internal field names or scoring
 * mechanics.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

type LocalizedText = Readonly<{ en: string; ja: string }>;

// The six checks the app counts toward production. Each one that turns OK raises
// the per-minute score; all six OK earns the production bonus. `key` is the
// internal posture field used only to look up state — it is never shown.
const GATES = [
  {
    key: "db_present",
    label: { en: "Database", ja: "データベース" },
    hint: {
      en: "Restore the S3 backup into the database.",
      ja: "S3 に置かれたバックアップをデータベースに復元する。",
    },
  },
  {
    key: "auth_enabled",
    label: { en: "Sign-in required", ja: "ログイン必須化" },
    hint: {
      en: "Require sign-in so anonymous posting is rejected.",
      ja: "ログインを必須にして、匿名の投稿を拒否する。",
    },
  },
  {
    key: "rate_limited",
    label: { en: "Rate limiting", ja: "アクセス制限" },
    hint: {
      en: "Attach a WAF (a firewall that throttles abusive traffic) to the load balancer.",
      ja: "WAF (過剰・不正なアクセスを弾くファイアウォール) をロードバランサーに関連付ける。",
    },
  },
  {
    key: "audit_on",
    label: { en: "Audit logging", ja: "監査ログ" },
    hint: {
      en: "Make audit events write to storage (S3).",
      ja: "監査イベントがストレージ (S3) に記録されるようにする。",
    },
  },
  {
    key: "on_rds",
    label: { en: "Managed database", ja: "マネージド DB" },
    hint: {
      en: "Point the app at the managed database (RDS) instead of a local one.",
      ja: "アプリの参照先を、マネージドなデータベース (RDS) に切り替える。",
    },
  },
  {
    key: "ssh_closed",
    label: { en: "SSH closed", ja: "SSH を閉じる" },
    hint: {
      en: "Remove the public SSH rule (tcp/22) from the app's firewall (security group).",
      ja: "アプリのファイアウォール (セキュリティグループ) から、公開された SSH (tcp/22) の穴を消す。",
    },
  },
];

// Security checks. These are NOT counted toward the six, but while any is failing
// the app cannot reach production. Incidents fired during the match can knock
// them down; recover by restoring the site / removing the planted backdoor /
// requiring sign-in and deleting the spam.
const INTEGRITY = [
  {
    key: "site_intact",
    label: { en: "Site untampered", ja: "サイト無改ざん" },
    hint: {
      en: "The board has not been defaced.",
      ja: "掲示板が改ざんされていない。",
    },
  },
  {
    key: "no_backdoor",
    label: { en: "No backdoor", ja: "バックドアなし" },
    hint: {
      en: "No planted backdoor artifact remains.",
      ja: "仕込まれたバックドアが残っていない。",
    },
  },
  {
    key: "board_clean",
    label: { en: "No spam", ja: "スパムなし" },
    hint: {
      en: "No anonymous spam has landed (requiring sign-in blocks it).",
      ja: "匿名スパムが刺さっていない (ログイン必須化で防げる)。",
    },
  },
];

const COPY = {
  en: {
    title: "StackStack — Production Readiness",
    body: "Register your service URL, then work down the checks below — they are measured automatically. You reach the production bonus only when every check is OK and the board stays intact.",
    serviceUrl: "Service URL",
    notRegistered: "not registered yet",
    nextAction: "Next step",
    probePending: "Measuring… check back in a moment.",
    complete: "Production readiness is complete.",
    gates: "Production checks",
    integrity: "Security checks",
    done: "OK",
    todo: "to do",
    unknown: "measuring",
    phases: "Schedule",
    disruptions: "Incidents the operator can trigger",
  },
  ja: {
    title: "StackStack — 本番化ステータス",
    body: "自分のサービスの URL を登録したら、下のチェック項目を一つずつ満たしていきます (状態は自動で測定されます)。 すべての項目が OK になり、 掲示板が正常なときだけ本番化ボーナスに到達します。",
    serviceUrl: "サービス URL",
    notRegistered: "未登録",
    nextAction: "次の一手",
    probePending: "測定中… 少し待ってから見てください。",
    complete: "本番化は完了しています。",
    gates: "本番化チェック",
    integrity: "セキュリティチェック",
    done: "OK",
    todo: "未達",
    unknown: "測定中",
    phases: "スケジュール",
    disruptions: "運営が起こす障害",
  },
} as const;

export default function StatusPanel(props: PortalSlotProps) {
  const { endpoints, phases, disruptions, posture } = props;
  const locale = props.locale === "ja" ? "ja" : "en";
  const copy = COPY[locale];
  const app = endpoints.find((ep) => ep.slot === "app");
  const serviceUrl = app?.effectiveUrl || app?.overrideUrl || "";
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
      <p style={{ margin: "0 0 16px 0", color: "#5f6b7a", fontSize: "13px" }}>{copy.body}</p>

      <div style={{ marginBottom: "16px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <tbody>
            <tr>
              <th style={{ padding: "6px 8px", textAlign: "left", width: "140px" }}>
                {copy.serviceUrl}
              </th>
              <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: "12px" }}>
                {serviceUrl ? (
                  serviceUrl
                ) : (
                  <span style={{ color: "#9a6700" }}>{copy.notRegistered}</span>
                )}
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
              ? `${text(next.label, locale)} — ${text(next.hint, locale)}`
              : copy.complete}
        </div>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>{copy.gates}</h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "8px",
          }}
        >
          {GATES.map((gate) => (
            <PostureCard
              key={gate.key}
              check={gate}
              copy={copy}
              locale={locale}
              posture={posture}
            />
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
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#414d5c" }}>{copy.phases}</h4>
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
  check: { key: string; label: LocalizedText; hint: LocalizedText };
  copy: (typeof COPY)["en"];
  locale: keyof typeof COPY;
  posture: Readonly<Record<string, boolean>> | undefined;
  warning?: boolean;
}) {
  const state = posture?.[check.key];
  const status = state === true ? copy.done : state === false ? copy.todo : copy.unknown;
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
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>{text(check.label, locale)}</div>
        <div style={{ color: statusColor, fontSize: "12px", fontWeight: 700 }}>{status}</div>
      </div>
      <div style={{ color: "#5f6b7a", fontSize: "12px" }}>{text(check.hint, locale)}</div>
    </div>
  );
}

function text(value: LocalizedText, locale: keyof typeof COPY): string {
  return value[locale] ?? value.en;
}
