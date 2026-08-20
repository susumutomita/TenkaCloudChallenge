/**
 * Issue #486 PR4: ac26-crypto-battle HelpDrawer plugin -- a 1-screen rules
 * reference for LEAK / PROVE / HUNT / ROTATE and the 3 lanes, aimed at
 * Issue #486's Gate 1 ("a first-time player can explain this within 5
 * minutes"). Purely static/informational: unlike StatusPanel and
 * RegistrationPanel, it needs no `coordinationClient` and does no polling --
 * every fact here is already public game-design knowledge (the same content
 * README.md / README.ja.md already describe to a participant before they
 * even open the portal), not per-match state.
 *
 * Content intentionally matches README.md / README.ja.md and does not
 * hardcode `threshold` / `shareCount` as numbers -- those are
 * `DEFAULT_CONFIG` playtest values in `../game/src/reducer.ts` that are
 * expected to move after a real playtest (see that file's doc comment and
 * `OPERATOR.md`'s "Config / balance knobs"), and README.md already avoids
 * hardcoding them for the same reason. A participant's own Vault lane
 * (`StatusPanel.tsx`) always shows their own actual `shareCount` (the length
 * of `vault.shares`) directly, so this text does not need to repeat it.
 *
 * Cloudscape is not imported -- see `StatusPanel.tsx`'s header. Plain HTML +
 * inline style.
 */

import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

const panelStyle = {
  border: "1px solid #d5dbdb",
  borderRadius: "8px",
  padding: "16px",
  background: "#fafafa",
} as const;

const sectionTitleStyle = { margin: "16px 0 8px 0", fontSize: "13px", color: "#414d5c" } as const;
const moveStyle = {
  border: "1px solid #eaeded",
  borderRadius: "6px",
  padding: "8px 10px",
  marginBottom: "8px",
  background: "#fff",
} as const;
const laneStyle = { margin: "0 0 6px 0", fontSize: "13px" } as const;

const COPY = {
  en: {
    title: "How this Battle works",
    intro:
      "Your team holds a secret, split into shares via Shamir threshold secret sharing. Every move below is a real cryptographic operation -- nothing here is simulated, and nothing scores on a guess.",
    lanesTitle: "The 3 lanes (StatusPanel)",
    lanes: [
      { name: "Contract Queue", body: "LEAK requests addressed to your team right now. Miss the deadline and one expires unclaimed." },
      { name: "My Vault", body: "Your team's current secret, this generation's shares, and your ROTATE cooldown. Only your team sees this." },
      { name: "Public Ledger", body: "Every share every team has ever LEAKed, and every proof every team has ever PROVEn -- in the open, forever." },
    ],
    movesTitle: "The 4 moves (RegistrationPanel)",
    moves: [
      {
        name: "LEAK",
        body: "Complete an open Contract by revealing the share(s) it asks for. Scores immediately. The revealed value is published to the Public Ledger forever -- it becomes ammunition for another team's HUNT.",
      },
      {
        name: "PROVE",
        body: "Complete an open Contract by submitting a Schnorr proof of knowledge instead of a share -- built locally beforehand (this portal never builds it for you). Pays exactly what LEAKing the same Contract would. Nothing that could reconstruct your secret goes public; only the proof transcript is recorded, for audit.",
      },
      {
        name: "HUNT",
        body: "Reconstruct another team's secret from enough of their Public Ledger shares (via Lagrange interpolation, computed locally) and submit the recovered value. Only an exact match to their real secret scores -- a wrong or partial guess does nothing.",
      },
      {
        name: "ROTATE",
        body: "Advance your own secret to a fresh generation. Every share you leaked before this point stops reconstructing anything real. Has a cooldown, and voids every currently-open Contract addressed to you.",
      },
    ],
    scoringTitle: "Scoring, in short",
    scoring: [
      "LEAK and PROVE pay identically for the same Contract -- PROVE is never worth extra just for being the harder path.",
      "HUNT only pays out on a genuine, verified reconstruction -- guessing never scores.",
      "ROTATE costs a cooldown, but retroactively devalues every share you leaked before it.",
    ],
  },
  ja: {
    title: "この Battle の遊び方",
    intro:
      "自チームは secret を持ち、Shamir しきい値秘密分散で share に分割して保持しています。以下の操作はすべて実際の暗号計算であり、シミュレーションではありません。当て推量では得点になりません。",
    lanesTitle: "3 つのレーン (StatusPanel)",
    lanes: [
      { name: "Contract Queue", body: "今まさに自チーム宛に届いている LEAK 依頼です。期限内に応じないと失効します。" },
      { name: "My Vault", body: "自チームの現行 secret、この世代の share、ROTATE クールダウンです。自チームにのみ表示されます。" },
      { name: "Public Ledger", body: "全チームがこれまでに LEAK した share と PROVE した proof の、永久に残る全公開履歴です。" },
    ],
    movesTitle: "4 つの操作 (RegistrationPanel)",
    moves: [
      {
        name: "LEAK",
        body: "Contract が要求する share を公開して即座に完了・得点します。公開した値は Public Ledger に永久に残り、相手チームの HUNT 材料になります。",
      },
      {
        name: "PROVE",
        body: "share の代わりに Schnorr 知識証明を提出して Contract を完了します。proof は事前にローカルで作成してください (この portal は代わりに作成しません)。同じ Contract を LEAK した場合と全く同じ得点です。secret を復元できる情報は一切公開されず、監査用に proof transcript のみが記録されます。",
      },
      {
        name: "HUNT",
        body: "相手チームの Public Ledger 上の share を十分な数集め、Lagrange 補間でローカルに secret を復元し、その値を提出します。実際の secret と厳密に一致した場合のみ得点します。誤った値や部分的な推測では何も起こりません。",
      },
      {
        name: "ROTATE",
        body: "自チームの secret を新しい世代に更新します。この時点より前に漏洩した share は、それ以降 secret の復元には使えなくなります。クールダウンがあり、実行すると現在 open な自チーム宛 contract はすべて無効化されます。",
      },
    ],
    scoringTitle: "スコアリング、要点だけ",
    scoring: [
      "同じ Contract であれば LEAK と PROVE は全く同じ得点です — PROVE だからといって難しい分だけ多く得点することはありません。",
      "HUNT は検証済みの正しい復元でのみ得点します — 当て推量は得点になりません。",
      "ROTATE はクールダウンというコストを払いますが、それ以前に漏洩した share を遡ってすべて無価値にします。",
    ],
  },
} as const;

export default function HelpDrawer(props: PortalSlotProps) {
  const copy = COPY[props.locale === "ja" ? "ja" : "en"];
  return (
    <section style={panelStyle}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>{copy.title}</h3>
      <p style={{ margin: 0, fontSize: "13px", color: "#5f6b7a" }}>{copy.intro}</p>

      <h4 style={sectionTitleStyle}>{copy.lanesTitle}</h4>
      {copy.lanes.map((lane) => (
        <p key={lane.name} style={laneStyle}>
          <strong>{lane.name}</strong> — {lane.body}
        </p>
      ))}

      <h4 style={sectionTitleStyle}>{copy.movesTitle}</h4>
      {copy.moves.map((move) => (
        <div key={move.name} style={moveStyle}>
          <strong>{move.name}</strong>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px" }}>{move.body}</p>
        </div>
      ))}

      <h4 style={sectionTitleStyle}>{copy.scoringTitle}</h4>
      <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px" }}>
        {copy.scoring.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
