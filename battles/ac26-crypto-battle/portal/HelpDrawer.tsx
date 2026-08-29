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

/**
 * The `p = 0x...` line below MUST stay byte-for-byte equal to
 * `../game/src/group.ts`'s `MODP_2048_P` (RFC 3526 Group 14) -- copied from
 * that module's own hex chunks, not hand-transcribed from the RFC, and
 * cross-checked with `game/src/portal.test.ts`'s
 * "PROVE Python snippet's prime matches the real group constant" test
 * (`String(MODP_2048_P.toString(16)) === ` the hex this line embeds).
 * `derive` / `lp` / `fw` / the witness, nonce, and challenge construction
 * below are transcribed from `schnorr-witness.ts` / `schnorr-prover.ts` /
 * `schnorr-transcript.ts` and were run end-to-end (real Python, real
 * inputs) against `createProof` + `verifyProof` before shipping: identical
 * `commitment` / `response`, and the resulting proof verifies. This snippet
 * previously shipped with `p = <RFC 3526 Group 14 prime>`, a syntactically
 * invalid placeholder, despite "そのまま動く Python" / "runnable Python"
 * both promising otherwise -- this file's own claim was never executed
 * before this fix (part of the same onboarding-repair pass that fixed
 * `../game/src/types.ts`'s `matchRemainingMs` / `remainingMs` unit
 * mismatch -- see that file's doc comments).
 */
export const PYTHON_SNIPPET = String.raw`# PROVE -- everything below is public; only 'secret' is yours.
import hashlib
p = 0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aacaa68ffffffffffffffff  # RFC 3526 Group 14, 2048-bit
q, g = (p - 1) // 2, 4               # prime-order subgroup, generator
n = (p.bit_length() + 7) // 8

def derive(seed, label, counter, m):                      # the only hash rule used
    h = hashlib.sha256(f"{seed}|{label}|{counter}".encode()).digest()
    return int.from_bytes(h, "big") % m

lp = lambda t: len(t.encode()).to_bytes(4, "big") + t.encode()   # length-prefixed utf8
fw = lambda v: v.to_bytes(n, "big")                              # fixed width, left 0-pad

w = derive(str(secret), f"schnorr-witness:{team}", generation, q)
Y = pow(g, w, p)
r = derive(str(w), f"schnorr-nonce:{team}:{contract}", generation, q)
R = pow(g, r, p)
e = int.from_bytes(hashlib.sha256(
        lp("ac26-crypto-battle/prove/v1") + lp(team) + lp(contract)
        + lp(str(generation)) + fw(R) + fw(Y)).digest(), "big") % q
s = (r + e * w) % q
# submit {"commitment": str(R), "response": str(s)}

# HUNT -- Lagrange interpolation at x = 0 over P = 2**61 - 1
P = 2**61 - 1
def reconstruct(shares):             # shares: [(index, value), ...], threshold-many
    total = 0
    for xi, yi in shares:
        num = den = 1
        for xj, _ in shares:
            if xj != xi:
                num, den = num * -xj % P, den * (xi - xj) % P
        total = (total + yi * num * pow(den, P - 2, P)) % P
    return total`;

const COPY = {
  en: {
    title: "How this Battle works",
    intro:
      "Your team holds a secret, split into shares via Shamir threshold secret sharing. Every move below is a real cryptographic operation -- nothing here is simulated, and nothing scores on a guess. The core decision, every time a Contract arrives: LEAK for easy points but give away a share, or PROVE for the same points and give away nothing.",
    lanesTitle: 'The 3 lanes (under "PROVE / LEAK / HUNT -- Status" above)',
    lanes: [
      { name: "Contract Queue", body: "LEAK requests addressed to your team right now. Miss the deadline and one expires unclaimed." },
      { name: "My Vault", body: "Your team's current secret, this generation's shares, and your ROTATE cooldown. Only your team sees this." },
      { name: "Public Ledger", body: "Every share every team has ever LEAKed, and every proof every team has ever PROVEn -- in the open, forever." },
    ],
    movesTitle: 'The 4 moves (under "PROVE / LEAK / HUNT -- Submit a move" above)',
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
        body: "Reconstruct another team's secret from enough of their Public Ledger shares (via Lagrange interpolation, computed locally) and submit the recovered value. Only an exact match to their real secret scores -- a wrong or partial guess does nothing. This Battle's threshold is currently 3 DISTINCT share indices of the same generation -- re-revealing an already-exposed index adds nothing.",
      },
      {
        name: "ROTATE",
        body: "Advance your own secret to a fresh generation. A HUNT needs threshold-many shares from the SAME generation, so every share you leaked before this point -- belonging to the old generation -- stops reconstructing anything real. Has a cooldown, and voids every currently-open Contract addressed to you.",
      },
    ],
    prereqTitle: "Before you start",
    prereq: [
      "PROVE is the same non-interactive Schnorr proof as the ac26-w3-schnorr challenge -- same challenge preimage, same framing. Do that one first and PROVE here is the same six lines.",
      "HUNT is Shamir reconstruction, the same one ac26-w2-secret-sharing builds. Do that one first and HUNT here is one Lagrange evaluation.",
    ],
    computeTitle: "Computing PROVE and HUNT yourself",
    computeIntro:
      "This portal never computes a proof or a reconstruction for you -- doing it yourself is the real cost of each move. Everything you need is below: the group is a published standard (RFC 3526 Group 14) and the derivation is one hash rule applied four times. Any language works; this is Python for concreteness.",
    computeCode: PYTHON_SNIPPET,
    computeNote:
      "The 2048-bit modulus is not an obstacle -- pow(g, w, p) is one call at any size. What matters is the exact framing: every variable-length field is length-prefixed so that no two different statements can hash to the same challenge.",
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
      "自チームは secret を持ち、Shamir しきい値秘密分散で share に分割して保持しています。以下の操作はすべて実際の暗号計算であり、シミュレーションではありません。当て推量では得点になりません。Contract が届くたびの核心の判断は、楽に稼げるが share を渡す LEAK か、同じ得点だが何も渡さない PROVE かです。",
    lanesTitle: "3 つのレーン (上の「PROVE / LEAK / HUNT — 状態」の中)",
    lanes: [
      { name: "Contract Queue", body: "今まさに自チーム宛に届いている LEAK 依頼です。期限内に応じないと失効します。" },
      { name: "My Vault", body: "自チームの現行 secret、この世代の share、ROTATE クールダウンです。自チームにのみ表示されます。" },
      { name: "Public Ledger", body: "全チームがこれまでに LEAK した share と PROVE した proof の、永久に残る全公開履歴です。" },
    ],
    movesTitle: "4 つの操作 (上の「PROVE / LEAK / HUNT — 操作を送信」の中)",
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
        body: "相手チームの Public Ledger 上の share を十分な数集め、Lagrange 補間でローカルに secret を復元し、その値を提出します。実際の secret と厳密に一致した場合のみ得点します。誤った値や部分的な推測では何も起こりません。このBattleの現在のしきい値は同じ世代の異なる index で 3 種類です — 同じ index を何度公開しても増えません。",
      },
      {
        name: "ROTATE",
        body: "自チームの secret を新しい世代に更新します。HUNT には同じ世代の share がしきい値分必要なので、この時点より前に漏洩した share (= 古い世代のもの) は、それ以降 secret の復元には使えなくなります。クールダウンがあり、実行すると現在 open な自チーム宛 contract はすべて無効化されます。",
      },
    ],
    prereqTitle: "始める前に",
    prereq: [
      "PROVE は ac26-w3-schnorr と同じ非対話型 Schnorr 証明です。challenge の preimage も framing も同一なので、あちらを先にやれば PROVE はここでも同じ 6 行です。",
      "HUNT は ac26-w2-secret-sharing が組み立てるのと同じ Shamir 復元です。あちらを先にやれば HUNT は Lagrange の 1 回評価です。",
    ],
    computeTitle: "PROVE と HUNT を自分で計算する",
    computeIntro:
      "このポータルが代わりに proof や復元を計算することはありません — 自分で計算すること自体が各操作の本来のコストだからです。必要なものは下に全部あります。群は公開標準 (RFC 3526 Group 14) で、導出は 1 つのハッシュ規則を 4 回使うだけです。言語は問いません。具体性のため Python で書いています。",
    computeCode: PYTHON_SNIPPET,
    computeNote:
      "2048 bit は障害になりません — pow(g, w, p) は桁数に関係なく 1 呼び出しです。効いてくるのは framing の厳密さで、可変長の項はすべて長さ前置されており、異なる主張が同じ challenge にハッシュされないようになっています。",
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

      <h4 style={sectionTitleStyle}>{copy.prereqTitle}</h4>
      <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px" }}>
        {copy.prereq.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <h4 style={sectionTitleStyle}>{copy.computeTitle}</h4>
      <p style={{ margin: "0 0 8px 0", fontSize: "13px" }}>{copy.computeIntro}</p>
      <pre
        style={{
          margin: "0 0 8px 0",
          padding: "10px",
          background: "#f4f4f4",
          borderRadius: "4px",
          fontSize: "12px",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        <code>{copy.computeCode}</code>
      </pre>
      <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#5f6b7a" }}>{copy.computeNote}</p>

      <h4 style={sectionTitleStyle}>{copy.scoringTitle}</h4>
      <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px" }}>
        {copy.scoring.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
