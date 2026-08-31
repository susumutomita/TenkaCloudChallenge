/** Issue #641: first-viewport orientation for the live Battle status slot. */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

type Locale = "ja" | "en";

interface QuickRulesCopy {
  readonly title: string;
  readonly summary: string;
  readonly choice: string;
}

export const QUICK_RULES_COPY: Record<Locale, QuickRulesCopy> = {
  en: {
    title: "Your first move",
    summary: "Pick one blue ORDER card. Then choose one of the two large buttons below it.",
    choice: "LEAK = score now, but publish a secret fragment. PROVE = do a calculation and keep the fragment protected.",
  },
  ja: {
    title: "最初にやること",
    summary: "青い ORDER カードを1枚選び、その下にある大きなボタンを1つ選びます。",
    choice: "LEAK = すぐ得点する代わりに秘密の破片を公開。PROVE = 計算して破片を守る。",
  },
};

const panelStyle = {
  border: "2px solid #0972d3",
  borderRadius: "8px",
  padding: "12px",
  marginBottom: "12px",
  background: "#f1f8ff",
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
    </section>
  );
}
