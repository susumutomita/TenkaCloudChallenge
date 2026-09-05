/** Issue #641: first-viewport orientation for the live Battle status slot. */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

type Locale = "ja" | "en";

interface QuickRulesCopy {
  readonly title: string;
  readonly explanation: string;
  readonly summary: string;
  readonly choice: string;
}

export const QUICK_RULES_COPY: Record<Locale, QuickRulesCopy> = {
  en: {
    title: "How this problem works",
    explanation: "Score by answering the incoming tasks (ORDERs) while protecting fragments of your secret. Once enough fragments are public, another team can reconstruct your secret and score with HUNT.",
    // [Issue #677] Press START first. Nothing arrives until someone does, and a
    // player told to pick an Order from an empty belt has been sent to a screen
    // that cannot answer them.
    summary:
      "Start the match. Read the current Order, then use the answer area directly below it. Choose another Order from the list whenever you like.",
    choice: "LEAK = score now, but publish a secret fragment. PROVE = do a calculation and keep the fragment protected.",
  },
  ja: {
    title: "この問題の解説",
    explanation: "自分の秘密のかけらを守りながら、届くお題（ORDER）に答えて得点を競います。公開したかけらが一定数そろうと、相手は秘密を復元して HUNT で得点できます。",
    summary:
      "試合を始めたら「いまのお題」を読み、その直下で答えます。別のお題には「ほかのお題を選ぶ」から切り替えられます。",
    choice: "LEAK = すぐ得点する代わりに秘密のかけらを 1 個公開。PROVE = 計算してかけらを守る。",
  },
};

// [Issue #677] A panel that paints its own background states its own text
// colour too. Without this the text inherited the host page's colour, which on
// a dark host is white -- white on a pale blue card. The same omission has now
// been fixed three times in this problem's portal; see BOARD_CSS's header.
const panelStyle = {
  border: "1px solid #dce3ec",
  borderRadius: "8px",
  padding: "12px",
  marginBottom: "12px",
  background: "#fff",
  color: "#16212e",
} as const;

export default function QuickRules({ locale }: Pick<PortalSlotProps, "locale">) {
  const copy = QUICK_RULES_COPY[locale === "ja" ? "ja" : "en"];
  return (
    <section style={panelStyle} aria-label="crypto-battle-quick-rules">
      <strong>{copy.title}</strong>
      <p style={{ margin: "4px 0", fontSize: "13px" }}>{copy.explanation}</p>
      <p style={{ margin: "4px 0", fontSize: "13px" }}>{copy.summary}</p>
      <p style={{ margin: "4px 0 0", fontSize: "13px" }}>
        <strong>{copy.choice}</strong>
      </p>
    </section>
  );
}
