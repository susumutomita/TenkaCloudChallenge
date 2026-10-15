/** Issue #641: first-viewport orientation for the live Battle status slot. */
import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import LeakHuntRules from "./LeakHuntRules.tsx";

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
    summary: "Press “I'M READY”. The match starts when every team is ready. Choose an incoming Order, answer below it, and check your result and points.",
    choice: "LEAK lets the system answer and publishes that Order's specified information for every team: share indices/values for secret sharing, or plaintext/ciphertext pairs for encryption. It does not directly publish the original secret or cipher key. The public record is shared; your vault is private to your team.",
  },
  ja: {
    title: "お題を解いて得点する",
    explanation: "お題に答えて得点を競い、終了時にいちばん点が高いチームが勝ちます。自分の秘密の数字は守ります。公開した情報から相手に秘密を読み解かれると、相手も得点するからです。",
    summary: "「準備完了」を押します。全チームが準備完了になると試合が始まります。届いたお題を選び、その下で答え、結果と得点を確かめます。",
    choice: "LEAKは、自分で計算する代わりにシステムに答えてもらう操作です。秘密分散ならかけらの番号と値、暗号化なら平文（元の数）と暗号文の対応を、全チームに公開します。元の秘密や鍵を丸ごと渡す操作ではありません。相手も読める場所が「公開記録」で、自分だけの情報は「自分の保管庫」にあります。",
  },
};
const panelStyle = {
  border: "none", borderRadius: "8px", padding: "0", marginBottom: "8px", background: "#fff", color: "#16212e",
} as const;

export default function QuickRules({ locale }: Pick<PortalSlotProps, "locale">) {
  const selectedLocale = locale === "ja" ? "ja" : "en";
  const copy = QUICK_RULES_COPY[selectedLocale];
  return <section style={panelStyle} aria-label="crypto-battle-quick-rules">
    <strong>{copy.title}</strong>
    <p style={{ margin: "4px 0", fontSize: "13px" }}>{copy.explanation}</p>
    <p style={{ margin: "4px 0", fontSize: "13px" }}>{copy.summary}</p>
    <ol style={{ paddingLeft: 22, fontSize: 14, lineHeight: 1.8 }}>
      {(selectedLocale === "ja" ? ["届いたお題を見る。残り時間を見て、どれから解くか選ぶ。", "そのお題の入力欄で計算し、答えを送る。", "正解・得点を確かめ、次のお題へ進む。"] : ["Read the incoming Orders and choose using their deadlines.", "Calculate in the selected Order’s answer area and submit.", "Check the result and points, then choose the next Order."]).map(line => <li key={line}>{line}</li>)}
    </ol>
    <p style={{ fontSize: 13, lineHeight: 1.8 }}>{copy.choice}</p>
    <LeakHuntRules locale={selectedLocale} />
  </section>;
}
