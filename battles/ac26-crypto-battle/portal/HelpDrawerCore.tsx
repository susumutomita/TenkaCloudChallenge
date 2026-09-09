/** Optional reference. The first-screen explanation lives in StatusPanel. */
import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";

export const PYTHON_SNIPPET = String.raw`# Legacy Sudoku model -- relabel your sudoku solution. No code needed; this is the same
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
    firstTitle: "お題ごとに、何をする？",
    first: [
      "シェア（share）は、秘密分散で配る番号と数の組です。秘密分散のお題だけで使います。MPCでも使う方法はありますが、このゲームのMPCは隠す乱数を足し引きする別の方式です。",
      "『公開して答える（LEAK）』は、そのお題で求められたかけらを公開して、すぐ得点します。公開した数は『公開記録（PUBLIC LEDGER）』に残り、他のチームも読めます。",
      "新しい試合のPROVEはゼロ知識証明（Schnorr）。aを先に固定し、検証者から届くeを使ってzを手計算します。秘密xと乱数rは端末内に残ります。旧試合は数独模型のままです。",
      "LEAKとPROVEを選べるお題では「シェアを公開する」か「別の秘密xについて証明する」かを選びます。Schnorrはシェアの正しさを証明するものではありません。暗号化・準同型の足し算・MPC・じゃんけんにはそれぞれ別の入力欄があります。",
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
      {name:"ITEM — AWSの鍵で復号して横取り",body:"運営が有効にした試合だけの追加ルールです。AWSの値を読み、1桁を復号するとアイテムを1個獲得。相手を選んで使うと、実際の残点から最大10点を自分へ移します。獲得・使用・同じ相手の被害は各1試合1回。通常の3問枠と締切減点を使い、ROTATEでは防げません。"},
      { name: "CIPHER — 数字を暗号にする", body: "最初はシーザー暗号です。元の数字に秘密の鍵を足し、記号の個数で割った余りを答えます。答えは公開されません。同じお題を LEAK すると元と答えの組が公開され、鍵を読む材料になります。先の段ではお題に書かれた別の方式へ進みます。" },
      { name: "IO — 識別不可能性難読化（iO）の条件を比べる", body: "全4入力で計算AとBが同じ答えを出すか、変換後の分布（どの公開結果が、それぞれ何割の確率で出るか）が同じかを比較します。空欄2個、同じ機能なら1・違えば0、共通する公開データの組の個数を提出します。全入力を列挙する模型なので、一般の効率的なiOではありません。" },
      {name:"ANAMORPHIC — 通常鍵と追加秘密",body:"暗号文の選択・通常鍵による復号・くじの確率は別々のお題です。表示された1つの作業を終え、数字1個を提出すると得点します。小さい数の選び直し模型であり、実用の安全性はありません。"},
      {name:"STARK — 実行表と折り畳みを検査",body:"STARKは、計算全体をやり直すより小さな検査で正しさを確かめる証明方式です。まず、計算の各段階の数を並べた表で「前の数を2乗する」規則を調べます。次に、画面にある式の数字を組み合わせ、式を短くする計算をします。これを折り畳みと呼びます。4欄を7で割った余りで提出してください。この教材は、質問より前にデータを固定する仕組みや、秘密を見せず正しさを示す仕組みまでは実装していません。"},
      {name:"ENIGMA / RSA / ECDSA — 暗号と署名",body:"エニグマは反射板で折り返す一桁の模型。RSA復号は与えられた秘密鍵で元の数字を戻すお題です。ECDSAはメッセージ値から署名r・sを計算します。これらのお題用の鍵はHUNT対象ではありません。署名は中身を隠す暗号化とは目的が違います。"},
      {name:"SNARK — 計算と配線を検査",body:"SNARKは計算の正しさを短い証明で示す方式です。この準備として、計算を正しければ0になる式へ直す「算術化」を扱います。3行の計算と2本の配線の差を7で割った余りにして、5欄に入力します。全て0なら整合しています。不正な表でもその検出結果が正しければ得点します。この表の検査だけでは、短い証明や、秘密を見せず正しさを示すゼロ知識の仕組みは実現しません。"},
      { name: "EC — 楕円曲線の点を足す", body: "楕円曲線は、決めた式を満たす座標(x,y)の集まりです。画面の式と逆元の表でP+Qを求め、xとyを半角スペースで区切って提出します。ECDSAという電子署名でも使う計算ですが、この問題は署名全体ではなく、7で割った余りで行う点加算です。" },
      { name: "FHE — 暗号のまま足す", body: "準同型暗号は、中身を隠した暗号文のまま計算する技術です。左右 2 個の数字の組を受け取り、左どうし・右どうしを足して、各々の余りを提出します。完全準同型暗号（FHE）は掛け算も扱います。このゲームは足し算を体験するモデルです。" },
      { name: "MPC — 自分の数を隠して合計に参加する", body: "秘密計算（MPC）は、複数人で秘密を保って計算する方法です。各社の数を公開せず、合計を求めたい場面を体験します。自分の数に『受け取った覆面』を足し、『送った覆面』を引いて、余りを小計として提出します。覆面は内緒で共有する数で、全社を足すと打ち消し合います。得られる合計も、割る数で割った余りです。" },
      { name: "PROVE — ゼロ知識証明（Schnorr）", body: "公開値yに対応する秘密xを知ることを示します。a→e→zの順に会話し、検証者は2ᶻ ≡ a×yᵉ (mod23)を確認。秘密xは受け取りません。図と式の解説で、なぜ秘密を増やさないかを確かめられます。小さい数のHVZK教材で、旧試合の数独模型とは別方式です。" },
      { name: "DUEL — 相手とじゃんけんする", body: "手を先に見せると相手が勝つ手を選べるので、手と隠す数を混ぜた数字を先に出します。これをコミットメントと呼びます。両者が出したあとに手と隠す数を審判へ渡し、両開封を同時公開して勝敗を決めます。小さい数では別の手への開け方を探せるため、同時公開を守る審判が必要です。commit-reveal 自体は ZK 証明ではありません。" },
    ],
    placesTitle: "画面のどこを見る？",
    places: ["いまのお題：説明・入力欄・送信ボタンが一緒にあります。別のお題は『ほかのお題を選ぶ』から選びます。", "秘密の公開状況：自分や相手のかけらが、同じ世代で何個公開されたかを見ます。", "公開記録と自分の保管庫：相手も読める公開情報と、自分だけが読める秘密を確認できます。MY VAULT は自分の保管庫です。"],
    codeTitle: "任意：紙での計算を Python でも確かめる",
    codeIntro: "読む・遊ぶために、このコードを使う必要はありません。旧試合の数独模型に表を適用する例と、任意の番号のかけらから戻す計算です。P は HUNT の画面にある割る数へ置き換えます。番号 #1・#2・#3 専用の短い式と、その理由は上部の『秘密のかけら』の解説で追えます。",
  },
  en: {
    title: "How this Battle works",
    intro: "Answer tasks called ORDERs (Contract in raw data) to score. The highest score at the end wins. Each Order states its inputs, permitted methods, points and deadline. Read the current Order at the top, then answer directly below it.",
    firstTitle: "What does each Order ask you to do?",
    first: [
      "A share is an indexed value distributed by secret sharing. It belongs to the secret-sharing task. Some MPC protocols use shares; this game instead uses cancelling random masks for MPC.",
      "Publish to answer (LEAK) reveals the requested share and scores immediately. Everyone can read the value in the PUBLIC LEDGER.",
      "New-match PROVE uses Schnorr zero-knowledge proof: fix a, receive e, then hand-calculate z. Private x and r stay in your browser. Legacy matches retain the Sudoku model.",
      "Where both are offered, choose between publishing a share and proving knowledge of a separate x. Schnorr does not certify the share. Encryption, homomorphic addition, MPC and duels have separate inputs.",
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
      {name:"ITEM — Decrypt with an AWS key to transfer points",body:"Optional operator-enabled rule. Read the AWS value and decrypt one digit to acquire one item. Choose an opponent to transfer up to10 actual points. Acquire, use and victim eligibility are each once per match. It occupies one of the three Order slots and uses the normal deadline penalty. ROTATE does not defend against it."},
      { name: "CIPHER — Encrypt digits", body: "Start with Caesar: add your secret key to each digit and keep the remainder after division by the symbol count. Your answer is not published. LEAK instead publishes the original and answer together, giving others evidence to recover the key. Later rungs explain their own different methods." },
      { name: "IO — Compare indistinguishability obfuscation (iO) conditions", body: "Compare A and B on all four inputs, then compare the distributions of their transformed tables (which public results can occur and the probability of each). Submit two missing outputs, 1 for equivalent functions or 0 otherwise, and the shared outcome count. Enumerating every input is a finite model, not efficient general-purpose iO." },
      {name:"ANAMORPHIC — Ordinary key and additional secret",body:"Ciphertext selection, ordinary decryption and ticket probability are separate Orders. Finish the displayed task and submit one number to score. This tiny rejection-sampling model has no practical cryptographic security."},
      {name:"STARK — Check the trace and fold",body:"STARK is a proof system that checks correctness with less work than repeating the entire computation. Inspect a table listing each step and check that each next value squares the previous one. Then combine the numbers in the supplied expression to shorten it; this calculation is called folding. Submit four remainders after division by7. This exercise does not implement binding the data before questions or proving correctness while hiding secrets."},
      {name:"ENIGMA / RSA / ECDSA — Encryption and signatures",body:"Enigma uses a one-digit reflector model. RSA decryption recovers an original using the supplied private key. ECDSA calculates signature r and s for a message value. These worksheet keys are outside HUNT. Signatures have a different purpose from encryption that hides content."},
      {name:"SNARK — Check gates and wires",body:"A SNARK provides a short proof of correct computation. Here translate calculations into expressions that must be zero, a preparation called arithmetization. Enter five remainders after division by7 for three calculations and two connections. All zero means consistent. Correctly detecting a corrupt table earns points too. Checking this table alone does not produce a short proof or hide private values while showing correctness (zero knowledge)."},
      { name: "EC — Add elliptic curve points", body: "An elliptic curve is a set of coordinate pairs satisfying an equation. Use the displayed formula and inverse table to find P+Q; submit x space y. ECDSA digital signatures use point addition, but this exercise only covers addition modulo7, not a complete signature." },
      { name: "FHE — Add encrypted values", body: "Homomorphic encryption allows computation on hidden values. Receive pairs, add lefts and rights separately, and submit the remainders. Fully homomorphic encryption (FHE) also supports multiplication; this game models addition." },
      { name: "MPC — Contribute without showing your input", body: "Secure computation (MPC) lets multiple parties compute while keeping inputs private. To contribute to a company total, add received masks to your input and subtract sent masks. A mask is a privately shared number; each is added and subtracted once across the companies. Submit your subtotal’s remainder. The combined result is also a remainder, not an unrestricted total." },
      { name: "PROVE — Schnorr zero-knowledge proof", body: "Zero-knowledge proofs show knowledge of x for public y through a→e→z. The verifier checks 2ᶻ ≡ a×yᵉ (mod23), without receiving x. The diagram guide explains why transcripts reveal no additional information. This is a tiny-parameter HVZK exercise, separate from legacy Sudoku matches." },
      { name: "DUEL — Play an opponent", body: "Showing your hand first lets an opponent counter it. First send a commitment, a number mixing your hand with a hiding number. After both commitments arrive, give the judge your opening. Both openings are published together to settle the duel. Tiny numbers permit alternative openings, so this model needs its judge to enforce simultaneous publication. Commit-reveal is not itself a ZK proof." },
    ],
    placesTitle: "Where should you look?",
    places: ["Current Order: instructions, answer fields and submission are together. Use Choose another Order to switch.", "Secret exposure: counts distinct shares published in each team’s current generation.", "Public record and your vault: inspect public evidence or your own private values. MY VAULT is visible only to your team."],
    codeTitle: "Optional: check your paper calculation with Python",
    codeIntro: "This code is optional. It applies a legacy Sudoku table and reconstructs from arbitrary share indices. Replace P with the divisor on your HUNT card. The short formula for indices #1, #2, #3 and why it works are explained in Secret shares at the top.",
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
