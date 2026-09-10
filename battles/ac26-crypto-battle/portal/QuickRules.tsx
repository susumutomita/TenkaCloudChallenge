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
    title: "Solve Orders to score",
    explanation: "Answer each task (ORDER) to earn points. Protect your secret numbers: other teams can score by recovering them from what you publish. The highest score at the end wins.",
    // [Issue #677] Press START first. Nothing arrives until someone does, and a
    // player told to pick an Order from an empty belt has been sent to a screen
    // that cannot answer them.
    summary:
      "Press “I'M READY”. The match starts when every team is ready. Choose an incoming Order, answer below it, and check your result and points.",
    choice: "LEAK scores immediately by publishing the indicated information. Everyone can read it in the public record. Your vault contains information only you can see.",
  },
  ja: {
    title: "お題を解いて得点する",
    explanation: "お題に答えて得点を競い、終了時にいちばん点が高いチームが勝ちます。自分の秘密の数字は守ります。公開した情報から相手に秘密を読み解かれると、相手も得点するからです。",
    summary:
      "「準備完了」を押します。全チームが準備完了になると試合が始まります。届いたお題を選び、その下で答え、結果と得点を確かめます。",
    choice: "公開して答える LEAK は速く得点できますが、表示された情報を相手へ渡します。相手も読める場所が「公開記録」です。自分だけの情報は「自分の保管庫」にあります。",
  },
};

// [Issue #677] A panel that paints its own background states its own text
// colour too. Without this the text inherited the host page's colour, which on
// a dark host is white -- white on a pale blue card. The same omission has now
// been fixed three times in this problem's portal; see BOARD_CSS's header.
const panelStyle = {
  border: "none",
  borderRadius: "8px",
  padding: "0",
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
      <ol style={{ paddingLeft: 22, fontSize: 14, lineHeight: 1.8 }}>
        {(locale === "ja" ? ["届いたお題を見る。残り時間を見て、どれから解くか選ぶ。", "そのお題の入力欄で計算し、答えを送る。", "正解・得点を確かめ、次のお題へ進む。"] : ["Read the incoming Orders and choose using their deadlines.", "Calculate in the selected Order’s answer area and submit.", "Check the result and points, then choose the next Order."]).map(line => <li key={line}>{line}</li>)}
      </ol>
      <p style={{ fontSize: 13, lineHeight: 1.8 }}>{copy.choice}</p>
      <h3 style={{ fontSize: 16 }}>{locale === "ja" ? "相手の公開情報は、攻撃の材料" : "Public evidence gives you an attack"}</h3>
      <p style={{ fontSize: 13, lineHeight: 1.8 }}>{locale === "ja" ? "HUNT は、相手の公開情報から秘密を計算して当てる攻撃です。相手を選び、材料があといくつ必要かを確認します。材料がそろったら、式で計算して答えを送ります。" : "HUNT is an attack that recovers a secret from an opponent’s public evidence. Choose the opponent and check what evidence is missing. When it is ready, calculate using the formula and submit."}</p>
    </section>
  );
}
