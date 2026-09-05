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
    explanation: "Answer each task (ORDER) to earn points. Protect your secret numbers: other teams can score by recovering them from what you publish. The highest score at the end wins.",
    // [Issue #677] Press START first. Nothing arrives until someone does, and a
    // player told to pick an Order from an empty belt has been sent to a screen
    // that cannot answer them.
    summary:
      "Start the match. Read the current Order, then use the answer area directly below it. Choose another Order from the list whenever you like.",
    choice: "For the first Order, “Publish to answer” earns points immediately and shows one secret share. “Prove while protecting the secret” uses your separate sudoku solution. Choose a digit table and fill four cells so the judge can check that you hold that solution, earning points without publishing the share.",
  },
  ja: {
    title: "この問題の解説",
    explanation: "お題に答えて得点を競い、終了時にいちばん点が高いチームが勝ちます。自分の秘密の数字は守ります。公開した情報から相手に秘密を読み解かれると、相手も得点するからです。",
    summary:
      "試合を始めたら「いまのお題」を読み、その直下で答えます。別のお題には「ほかのお題を選ぶ」から切り替えられます。",
    choice: "最初のお題は「公開して答える」ならすぐ得点し、秘密から作った数（かけら）を1個公開します。「秘密を守って証明する」なら、別に持っている数独の正しい解を使います。表を選んで4マスを埋め、審判に「その解を持っている」と確かめてもらうことで、かけらを公開せずに得点します。",
  },
};

// [Issue #677] A panel that paints its own background states its own text
// colour too. Without this the text inherited the host page's colour, which on
// a dark host is white -- white on a pale blue card. The same omission has now
// been fixed three times in this problem's portal; see BOARD_CSS's header.
const panelStyle = {
  border: "1px solid #dce3ec",
  borderRadius: "8px",
  padding: "10px",
  marginBottom: "8px",
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
      <details style={{ fontSize: 13 }}><summary style={{ cursor: "pointer", color: "#315f91" }}>{locale === "ja" ? "最初のお題の選び方" : "Your first Order’s two options"}</summary><p>{copy.choice}</p></details>
    </section>
  );
}
