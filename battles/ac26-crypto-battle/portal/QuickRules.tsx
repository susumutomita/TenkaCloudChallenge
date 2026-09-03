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
    // [Issue #677] Press START first. Nothing arrives until someone does, and a
    // player told to pick an Order from an empty belt has been sent to a screen
    // that cannot answer them.
    summary:
      "Press START THE MATCH. Orders arrive at once; pick one blue ORDER card, then choose one of the two large buttons below it.",
    choice: "LEAK = score now, but publish a secret fragment. PROVE = do a calculation and keep the fragment protected.",
  },
  ja: {
    title: "最初にやること",
    summary:
      "「試合を始める」を押します。すぐに ORDER が届くので、青い ORDER カードを1枚選び、その下にある大きなボタンを1つ選びます。",
    choice: "LEAK = すぐ得点する代わりに秘密のかけらを 1 個公開。PROVE = 計算してかけらを守る。",
  },
};

// [Issue #677] A panel that paints its own background states its own text
// colour too. Without this the text inherited the host page's colour, which on
// a dark host is white -- white on a pale blue card. The same omission has now
// been fixed three times in this problem's portal; see BOARD_CSS's header.
const panelStyle = {
  border: "2px solid #0972d3",
  borderRadius: "8px",
  padding: "12px",
  marginBottom: "12px",
  background: "#f1f8ff",
  color: "#16212e",
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
