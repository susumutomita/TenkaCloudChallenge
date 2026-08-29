/** Issue #641: first-viewport orientation for the live Battle status slot. */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

type Locale = "ja" | "en";

interface QuickRulesCopy {
  readonly title: string;
  readonly summary: string;
  readonly choice: string;
  readonly steps: readonly { readonly title: string; readonly body: string }[];
}

export const QUICK_RULES_COPY: Record<Locale, QuickRulesCopy> = {
  en: {
    title: "30-second rules",
    summary:
      "Earn points by processing requests. LEAK is immediate but publishes a secret fragment; PROVE takes local computation and publishes no fragment.",
    choice: "LEAK and PROVE are alternatives for the same request. HUNT and ROTATE are the attack and defence that follow.",
    steps: [
      { title: "1. Request arrives", body: "Check its points, requested index, and countdown." },
      { title: "2. Choose one", body: "LEAK now, or PROVE the same request safely." },
      { title: "3. Read public records", body: "Inspect the raw shares and proof transcripts." },
      { title: "4. Act on them", body: "HUNT another team or ROTATE your own generation." },
    ],
  },
  ja: {
    title: "30秒で分かるルール",
    summary:
      "依頼を処理して得点します。LEAK はすぐ終わりますが秘密の破片を公開し、PROVE はローカル計算が必要ですが破片を公開しません。",
    choice: "LEAK と PROVE は同じ依頼に対する二択です。HUNT と ROTATE は、その後の攻撃と防御です。",
    steps: [
      { title: "1. 依頼が届く", body: "得点、要求 index、残り時間を確認します。" },
      { title: "2. どちらかを選ぶ", body: "LEAK するか、同じ依頼を PROVE します。" },
      { title: "3. 公開記録を見る", body: "share と proof transcript の生データを確認します。" },
      { title: "4. 次の判断", body: "相手を HUNT するか、自分を ROTATE します。" },
    ],
  },
};

const panelStyle = {
  border: "2px solid #0972d3",
  borderRadius: "8px",
  padding: "12px",
  marginBottom: "12px",
  background: "#f1f8ff",
} as const;

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "8px",
  marginTop: "10px",
} as const;

const stepStyle = {
  border: "1px solid #b6d7f2",
  borderRadius: "6px",
  padding: "8px",
  background: "#fff",
  fontSize: "12px",
} as const;

export default function QuickRules({ locale }: Pick<PortalSlotProps, "locale">) {
  const copy = QUICK_RULES_COPY[locale === "ja" ? "ja" : "en"];
  return (
    <section style={panelStyle} aria-label="crypto-battle-quick-rules">
      <strong>{copy.title}</strong>
      <p style={{ margin: "4px 0", fontSize: "13px" }}>{copy.summary}</p>
      <p style={{ margin: "4px 0 0", fontSize: "13px" }}>
        <strong>{copy.choice}</strong>
      </p>
      <div style={gridStyle}>
        {copy.steps.map((step) => (
          <div key={step.title} style={stepStyle}>
            <strong>{step.title}</strong>
            <div style={{ marginTop: "3px" }}>{step.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
