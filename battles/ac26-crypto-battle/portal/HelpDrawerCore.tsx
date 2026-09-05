/** Optional reference. The first-screen explanation lives in StatusPanel. */
import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

export const PYTHON_SNIPPET = String.raw`# PROVE -- relabel your sudoku solution. No code needed; this is the same
# thing written for a machine so you can check your hand work.
solution = [1, 2, 3, 4,           # <- MY VAULT's 16 cells, row by row
            3, 4, 1, 2,
            2, 1, 4, 3,
            4, 3, 2, 1]
table = {1: 3, 2: 1, 3: 4, 4: 2}  # <- YOUR choice: each of 1-4 once on the right. Never the same one twice.
grid = [table[v] for v in solution]   # <- optional check of the full relabelled grid; the UI asks for four holes
#
# The judge holds your solution and checks grid == table(solution) for some
# table. It then publishes ONE row, column or box of grid, with a tag naming
# the table. One group alone does not determine the whole original solution.
# Two groups with the SAME tag are two pieces of one relabelled grid,
# and a hunter lines them up against your public puzzle to recover the table.

# HUNT -- Lagrange interpolation at x = 0
P = 97                         # the match's field, from the Order's "p"
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
  ja: {
    title: "この Battle の遊び方",
    intro: "お題（ORDER、データ上の名前は Contract）に答えて得点を競います。終了時の得点が高いチームが勝ちます。お題ごとに、入力する数・使える操作・得点・期限が違います。まず画面上部の『いまのお題』を読み、その直下で答えます。",
    firstTitle: "最初のお題で、選ぶ理由を知る",
    first: [
      "自分の秘密から作った数を『かけら（share）』と呼びます。番号はどのかけらかを区別する名前で、#1 の 1 がかけらの値という意味ではありません。",
      "『公開して答える（LEAK）』は、そのお題で求められたかけらを公開して、すぐ得点します。公開した数は『公開記録（PUBLIC LEDGER）』に残り、他のチームも読めます。",
      "『秘密を守って証明する（PROVE）』は、数独の数字を付け替える表を選び、残り 4 マスを埋めます。かけらを公開せずに得点します。付け替えた一行などの一部分は公開されるため、同じ表の使い回しには注意します。",
      "この二択は、かけらのお題の答え方です。別のお題では、暗号のまま足す・覆面を付ける・手を隠してじゃんけんする、など別の操作を使います。使える方法は各お題に表示されます。",
    ],
    evidenceTitle: "公開した情報は、どう使われる？",
    evidence: [
      "『世代』は、同じ秘密から作った一組のことです。例えば 3 個で戻る設定なら、同じ世代の異なる番号 #1・#2・#3 が公開されると秘密を戻せます。#1・#2・#1 は 2 個分です。必要な個数は画面の公開状況で確認します。",
      "相手の秘密を読み解いて得点する攻撃を HUNT と呼びます。外した HUNT はタダではありません。減点され、その相手・世代に使える試行回数も 1 回減ります。送信前に画面の減点と残り回数を確認します。",
      "じゃんけんで同じ隠す数を使った過去の2記録があれば、今回の手を開封前に予測できます。今回も同じ数だと仮定した予測なので、外れることもあります。かけらの HUNT と試行回数を共有します。予測は相手に見えず、両者の開封後に採点。時間切れで公開されなければ回数を返します。",
      "ROTATE は自分の秘密を作り直す操作です。新しい世代になるので、古いかけらとは混ぜられません。次に使うまでの待ち時間があり、秘密に結び付く未完了のお題は失効して減点されます。じゃんけんのお題は続きます。",
    ],
    movesTitle: "ほかのお題で、何を体験する？",
    moves: [
      { name: "CIPHER — 数字を暗号にする", body: "最初はシーザー暗号です。元の数字に秘密の鍵を足し、記号の個数で割った余りを答えます。答えは公開されません。同じお題を LEAK すると元と答えの組が公開され、鍵を読む材料になります。先の段ではお題に書かれた別の方式へ進みます。" },
      { name: "FHE — 暗号のまま足す", body: "準同型暗号は、中身を隠した暗号文のまま計算する技術です。左右 2 個の数字の組を受け取り、左どうし・右どうしを足して、各々の余りを提出します。完全準同型暗号（FHE）は掛け算も扱います。このゲームは足し算を体験するモデルです。" },
      { name: "MPC — 自分の数を隠して合計に参加する", body: "秘密計算（MPC）は、複数人で秘密を保って計算する方法です。各社の数を公開せず、合計を求めたい場面を体験します。自分の数に『受け取った覆面』を足し、『送った覆面』を引いて、余りを小計として提出します。覆面は内緒で共有する数で、全社を足すと打ち消し合います。得られる合計も、割る数で割った余りです。" },
      { name: "PROVE — 解を見せずに正しさを示す", body: "ゼロ知識証明（ZK）は、答えを明かさず正しさを示す技術です。このゲームでは、審判は元の数独の解を持ち、付け替えたマスを照合します。相手には一部分だけを見せます。本来の ZK は検証する人にも答えを隠しますが、この教材は審判を信頼するモデルです。" },
      { name: "DUEL — 相手とじゃんけんする", body: "手を先に見せると相手が勝つ手を選べるので、手と隠す数を混ぜた数字を先に出します。これをコミットメントと呼びます。両者が出したあとに手と隠す数を審判へ渡し、両開封を同時公開して勝敗を決めます。小さい数では別の手への開け方を探せるため、同時公開を守る審判が必要です。commit-reveal 自体は ZK 証明ではありません。" },
    ],
    placesTitle: "画面のどこを見る？",
    places: ["いまのお題：説明・入力欄・送信ボタンが一緒にあります。別のお題は『ほかのお題を選ぶ』から選びます。", "秘密の公開状況：自分や相手のかけらが、同じ世代で何個公開されたかを見ます。", "公開記録と自分の保管庫：相手も読める公開情報と、自分だけが読める秘密を確認できます。MY VAULT は自分の保管庫です。"],
    codeTitle: "任意：紙での計算を Python でも確かめる",
    codeIntro: "読む・遊ぶために、このコードを使う必要はありません。PROVE の表を適用する例と、任意の番号のかけらから戻す計算です。P は HUNT の画面にある割る数へ置き換えます。番号 #1・#2・#3 専用の短い式と、その理由は上部の『秘密のかけら』の解説で追えます。",
  },
  en: {
    title: "How this Battle works",
    intro: "Answer tasks called ORDERs (Contract in raw data) to score. The highest score at the end wins. Each Order states its inputs, permitted methods, points and deadline. Read the current Order at the top, then answer directly below it.",
    firstTitle: "Understand the first choice",
    first: [
      "A share is a number made from your secret. Its index identifies the piece: #1 does not mean the share’s value is 1.",
      "Publish to answer (LEAK) reveals the requested share and scores immediately. Everyone can read the value in the PUBLIC LEDGER.",
      "Prove while protecting the secret (PROVE) asks you to choose a digit-renaming table and fill four sudoku holes. It scores without revealing a share. A renamed group is published, so avoid reusing the same table.",
      "These are the two options for a share Order. Other Orders use encrypted addition, masks or hidden-hand duels. Each Order shows its allowed methods.",
    ],
    evidenceTitle: "What can an opponent do with published information?",
    evidence: [
      "A generation is a set made from the same secret. In a three-share setting, distinct indices #1, #2, #3 in one generation allow recovery. #1, #2, #1 count as two pieces. Check the displayed exposure threshold.",
      "Two past RPS openings with the same hiding number let you predict a current sealed hand. Reuse now is an assumption, not a guarantee. Predictions share the share-HUNT budget, stay private, and score after both openings. A timeout without publication refunds the attempt.",
      "HUNT scores by recovering an opponent’s secret. A wrong guess is not free: it costs points and one of your limited attempts against that team and generation. Check the cost and remaining attempts before submitting.",
      "ROTATE creates a new secret and generation. Old and new shares cannot be mixed. It has a waiting period before reuse and expires unfinished Orders tied to your secret, charging their expiry penalty. Rock-paper-scissors Orders continue.",
    ],
    movesTitle: "What do the other Orders teach?",
    moves: [
      { name: "CIPHER — Encrypt digits", body: "Start with Caesar: add your secret key to each digit and keep the remainder after division by the symbol count. Your answer is not published. LEAK instead publishes the original and answer together, giving others evidence to recover the key. Later rungs explain their own different methods." },
      { name: "FHE — Add encrypted values", body: "Homomorphic encryption allows computation on hidden values. Receive pairs, add lefts and rights separately, and submit the remainders. Fully homomorphic encryption (FHE) also supports multiplication; this game models addition." },
      { name: "MPC — Contribute without showing your input", body: "Secure computation (MPC) lets multiple parties compute while keeping inputs private. To contribute to a company total, add received masks to your input and subtract sent masks. A mask is a privately shared number; each is added and subtracted once across the companies. Submit your subtotal’s remainder. The combined result is also a remainder, not an unrestricted total." },
      { name: "PROVE — Show correctness without the solution", body: "Zero-knowledge proofs (ZK) demonstrate correctness without revealing an answer. Here a trusted judge holds the sudoku solution and checks renamed cells; opponents see one group. A full ZK protocol also hides the solution from the verifier. This is a trusted-judge teaching model." },
      { name: "DUEL — Play an opponent", body: "Showing your hand first lets an opponent counter it. First send a commitment, a number mixing your hand with a hiding number. After both commitments arrive, give the judge your opening. Both openings are published together to settle the duel. Tiny numbers permit alternative openings, so this model needs its judge to enforce simultaneous publication. Commit-reveal is not itself a ZK proof." },
    ],
    placesTitle: "Where should you look?",
    places: ["Current Order: instructions, answer fields and submission are together. Use Choose another Order to switch.", "Secret exposure: counts distinct shares published in each team’s current generation.", "Public record and your vault: inspect public evidence or your own private values. MY VAULT is visible only to your team."],
    codeTitle: "Optional: check your paper calculation with Python",
    codeIntro: "This code is optional. It applies a PROVE table and reconstructs from arbitrary share indices. Replace P with the divisor on your HUNT card. The short formula for indices #1, #2, #3 and why it works are explained in Secret shares at the top.",
  },
} as const;

export default function HelpDrawer(props: PortalSlotProps) {
  const copy = COPY[props.locale === "ja" ? "ja" : "en"];
  return <section style={{ color: "#16212e", background: "#fff", lineHeight: 1.8, fontSize: 14 }}>
    <h3>{copy.title}</h3><p>{copy.intro}</p>
    <h4>{copy.firstTitle}</h4>{copy.first.map(line => <p key={line}>{line}</p>)}
    <h4>{copy.evidenceTitle}</h4>{copy.evidence.map(line => <p key={line}>{line}</p>)}
    <h4>{copy.movesTitle}</h4>{copy.moves.map(move => <details key={move.name} style={{ borderTop: "1px solid #dce3ec", padding: "8px 0" }}><summary style={{ cursor: "pointer" }}>{move.name}</summary><p>{move.body}</p></details>)}
    <h4>{copy.placesTitle}</h4>{copy.places.map(line => <p key={line}>{line}</p>)}
    <details><summary style={{ cursor: "pointer" }}>{copy.codeTitle}</summary><p>{copy.codeIntro}</p><pre style={{ background: "#f3f6fa", color: "#16212e", overflowX: "auto", padding: 12, fontSize: 12 }}><code>{PYTHON_SNIPPET}</code></pre></details>
  </section>;
}
