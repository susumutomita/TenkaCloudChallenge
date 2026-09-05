/**
 * Issue #486 PR4: ac26-crypto-battle HelpDrawer plugin -- a 1-screen rules
 * reference for LEAK / PROVE / FHE / MPC / HUNT / ROTATE and the 3 lanes,
 * aimed at
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
 * [Issue #709] PROVE is a hand relabelling now, so the "runnable" half of this
 * snippet is HUNT's Lagrange interpolation, unchanged. The PROVE half is the
 * relabelling written out as three lines -- shown so a reader who wants to
 * check their sixteen cells against a program can, not because the move
 * needs one: the whole point of the rebuild is that it does not.
 * `game/src/portal.test.ts` executes the HUNT half against `shamir.ts`.
 */
export const PYTHON_SNIPPET = String.raw`# PROVE -- relabel your sudoku solution. No code needed; this is the same
# thing written for a machine so you can check your hand work.
solution = [1, 2, 3, 4,           # <- MY VAULT's 16 cells, row by row
            3, 4, 1, 2,
            2, 1, 4, 3,
            4, 3, 2, 1]
table = {1: 3, 2: 1, 3: 4, 4: 2}  # <- YOUR choice: each of 1-4 once on the right. Never the same one twice.
grid = [table[v] for v in solution]   # <- submit these 16 digits
#
# The judge holds your solution and checks grid == table(solution) for some
# table. It then publishes ONE row, column or box of grid, with a tag naming
# the table. One row of a relabelled grid is 1-4 in some order: it says
# nothing. Two groups with the SAME tag are two pieces of one relabelled grid,
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
  en: {
    title: "How this Battle works",
    detailToggle: "Vocabulary, the lanes, and the formulas",
    whatTitle: "What this game is",
    what: [
      "You hold one secret. It is split into five pieces (#1-#5 in MY VAULT).",
      "One property matters. Any three of the five reconstruct the secret. Two tell you nothing.",
      "That is the whole game.",
    ],
    whyTitle: "So there are four moves",
    whyIntro:
      "You want points, and points come from finishing Orders. There are two ways to finish one.",
    whyRows: [
      { name: "LEAK", how: "Publish one piece as it is", cost: "Fast — but everyone can see the piece" },
      { name: "PROVE", how: "Relabel your sudoku solution by hand and hand that over — a proof that shows nothing", cost: "The piece stays safe — but it costs you the relabelling" },
    ],
    whyThen:
      "LEAK three times and an opponent holds three of your pieces. Three is enough to rebuild the secret. Which is why:",
    whyRows2: [
      { name: "HUNT", how: "When someone has three pieces exposed, use them to take their points", cost: "" },
      { name: "ROTATE", how: "Throw your pieces away and remake them. Everything already published stops counting", cost: "" },
    ],
    summaryTitle: "In short",
    summary: [
      "LEAK is fast, but three of them and you are dead.",
      "PROVE is safe, but slow.",
      "When an opponent LEAKs three times, you hunt them.",
      "When you are the one exposed, you rotate.",
    ],
    summaryTail:
      "That is all of it. The game is how far you push your luck; the cryptography is what settles it.",
    goalTitle: "What you will have learned",
    goalIntro:
      "Three kinds of modern cryptography are built into the Orders. All three are what blockchains are made of, and you will have performed each of them by hand.",
    goals: [
      { name: "Homomorphic encryption", body: "Compute on numbers you cannot read. That is the add-without-decrypting Order." },
      { name: "Secure computation (MPC)", body: "Everyone learns the total, nobody learns anyone's number. That is the masked-subtotal Order." },
      { name: "Zero-knowledge proofs", body: "Prove you hold a solution without showing it. That is PROVE: relabel your sudoku, and the judge opens one row of the copy." },
    ],
    goalTail:
      "Older ciphers like Caesar show up too, but as the way in: meeting a breakable cipher first is what makes an unbreakable one worth something.",
    intro:
      "Vocabulary: a \"Contract\" (Order) here has nothing to do with CloudFormation or a blockchain contract — it just means a request addressed to your team. Every move below is a real cryptographic operation; nothing is simulated, and nothing scores on a guess.",
    lanesTitle: 'The 3 lanes (under "PROVE / LEAK / HUNT -- Status" above)',
    lanes: [
      { name: "Contract Queue", body: "Orders addressed to your team right now. Each names what it asks for -- a share, an encrypted addition, or a masked subtotal -- and which methods it accepts. Miss the deadline and one expires unclaimed." },
      { name: "My Vault", body: "Your team's current secret, this generation's shares, and your ROTATE cooldown. Only your team sees this." },
      { name: "Public Ledger", body: "Everything every team has ever published: LEAKed shares, opened sudoku groups from PROVE, FHE answers and MPC subtotals -- in the open, forever. Each row names the method that produced it and the Order it answers, and every team's public puzzle is listed below the table." },
    ],
    movesTitle: 'The moves (under "PROVE / LEAK / HUNT -- Submit a move" above)',
    moves: [
      {
        name: "LEAK",
        body: "Complete an open Contract by revealing the share(s) it asks for. Scores immediately. The revealed value is published to the Public Ledger forever -- it becomes ammunition for another team's HUNT.",
      },
      {
        name: "PROVE",
        body: "Complete an open Contract by handing over your 4x4 sudoku solution with every digit relabelled through a table you chose (1->3, 2->1, ...; each of 1-4 used exactly once on the right, so it is a swap and never a merge), done on paper -- this portal never relabels it for you. Pays MORE than LEAKing the same Contract; the relabelling is what you are being paid for. The judge checks the whole grid and publishes ONE row, column or box of your relabelled copy with a tag naming the table. One opened group is 1-4 in some order and tells nobody anything. Two or more opened groups under the SAME table can give the solution away: never reuse a table on one generation -- MY VAULT lists the ones you have spent.",
      },
      {
        name: "CIPHER",
        body: "Complete a cipher-ladder Order by encrypting the symbols it shows with your team's key, and submitting the result. The Order states the method in full -- that is deliberate: in real cryptography the algorithm is public and only the key is secret, so knowing HOW a team's cipher works never helps you. Nothing is published. LEAKing the same Order instead publishes the symbols next to their encrypted form, and a plaintext beside its ciphertext is what recovers a key -- how many such pairs your current rung survives is printed on the Order.",
      },
      {
        name: "FHE",
        body: "Complete an Order that hands you two LOCKED numbers and asks for the lock on their sum. Add the two pairs component by component, remainder p -- that is the whole operation, and it is the only method such an Order accepts. You never see either number, and neither does the Ledger: what is published is your answer, still locked. The judge unlocks it and compares.",
      },
      {
        name: "MPC",
        body: "Complete an Order where three offices each hold a private number and the client wants only the TOTAL. Publish your own masked subtotal -- your number plus the masks sent to you, minus the ones you sent, remainder p. The masks cancel across the three offices, so the total comes out right while no office's number is ever published. The Ledger shows all three subtotals and the total, and you can check the addition yourself.",
      },
      {
        name: "HUNT",
        body: "Reconstruct another team's secret from enough of their Public Ledger shares (via Lagrange interpolation, computed locally) and submit the recovered value. Only an exact match to their real secret scores. A wrong guess is not free: it costs you points, and it spends one of the small number of attempts you get against each team per generation -- the price and the attempts you have left are printed on the HUNT card before you submit. This Battle's threshold is currently 3 DISTINCT share indices of the same generation -- re-revealing an already-exposed index adds nothing. A second kind of HUNT exists for a team that reused a relabelling: two of their opened sudoku groups in one generation with the same tag are pieces of one relabelled grid, and lining them up against that team's public puzzle recovers the table and then the solution. The judge accepts that HUNT only once the same-tag groups pin one solution against the puzzle -- two usually do; if they still leave a choice, wait for the next one. A team that picks a fresh table every time never produces that -- misuse is what this punishes, not correct use.",
      },
      {
        name: "ROTATE",
        body: "Advance your own secret to a fresh generation. A HUNT needs threshold-many shares from the SAME generation, so every share you leaked before this point -- belonging to the old generation -- stops reconstructing anything real. Has a cooldown, and voids every currently-open Contract addressed to you.",
      },
    ],
    prereqTitle: "Before you start",
    prereq: [
      "PROVE is the ZK sudoku from the lecture, at 4x4: relabel the digits of your solution and hand over the copy; the judge opens one row of it. No arithmetic at all -- a table of four entries applied to sixteen cells.",
      "HUNT is Shamir reconstruction, the same one ac26-w2-secret-sharing builds. Do that one first and HUNT here is one Lagrange evaluation.",
    ],
    computeTitle: "Doing PROVE and HUNT yourself",
    computeIntro:
      "This portal never relabels a grid or reconstructs a secret for you -- doing it yourself is the real cost of each move. PROVE needs no code: a four-entry table applied to sixteen cells. HUNT is Lagrange interpolation at p = 97, three shares. Any language works, and so does paper; this is Python for concreteness.",
    computeCode: PYTHON_SNIPPET,
    computeNote:
      "Which row, column or box the judge opens after a PROVE is decided by the Order, not by you, so relabel the whole grid rather than the four cells you hope will be read. The real ZK sudoku commits every cell first and opens one group per challenge; here the judge holds your solution and does that check in one step.",
    scoringTitle: "Scoring, in short",
    scoring: [
      "Every method pays what the Order states -- LEAK, PROVE, FHE and MPC alike. No technique is worth extra just for being the harder path.",
      "HUNT only pays out on a genuine, verified reconstruction. A wrong guess costs points and one of your limited attempts against that team's generation, so guessing is a losing trade rather than a free one.",
      "ROTATE costs a cooldown, but retroactively devalues every share you leaked before it.",
    ],
  },
  ja: {
    title: "この Battle の遊び方",
    /*
      [Issue #659] 順序を逆にした。
      
      以前はここが「Contract という語の説明 → 3 レーン → 6 つの動作」で始まって
      いた。動作の一覧から入ると、2 文のあいだに知らない単語が 4 つ出てきて読め
      ない。先に**秘密の性質を 1 つ**置くと、4 つの動作は全部そこから導ける。
    */
    detailToggle: "用語・レーン・計算式などの詳しい説明",
    whatTitle: "このゲームは何か",
    what: [
      "あなたは秘密を 1 つ持っています。それは 5 個のかけら (share) に分けてあります (MY VAULT の #1〜#5)。",
      "大事な性質が 1 つ。5 個のうち 3 個そろうと、秘密が復元できます。2 個までなら何も分かりません。",
      "これがゲームの全部です。",
    ],
    whyTitle: "だから 4 つの動作がある",
    whyIntro:
      "点が欲しい。でも点を取るには仕事 (ORDER) をこなす必要がある。そこで 2 通りのやり方があります。",
    whyRows: [
      { name: "LEAK", how: "かけらを 1 個そのまま公開して提出", cost: "速い。でも公開したかけらが相手に見える" },
      { name: "PROVE", how: "数独の解の数字を手で付け替えて出す ── 何も見せない証明", cost: "かけらは安全。でも付け替えの手間が要る" },
    ],
    whyThen:
      "そして LEAK を 3 回やると、相手はあなたのかけらを 3 個手に入れます。3 個そろえば秘密が復元できる。そうなると:",
    whyRows2: [
      { name: "HUNT", how: "相手のかけらが 3 個そろったとき、それを使って相手から点を奪う", cost: "" },
      { name: "ROTATE", how: "危なくなったらかけらを捨てて作り直す。公開済みの 3 個が無効になる", cost: "" },
    ],
    summaryTitle: "つまり",
    summary: [
      "LEAK は速いが、3 回やったら殺される。",
      "PROVE は安全だが、遅い。",
      "相手が 3 回 LEAK したら、こちらが HUNT で刈る。",
      "自分が危なくなったら ROTATE で逃げる。",
    ],
    summaryTail:
      "これだけです。「どこまで欲張るか」のゲームで、暗号はその判定に使われています。",
    /*
      [Issue #659] 到達点を明示する。
      
      このバトルの目的は、遊び終えたときに現代暗号 ── 秘密計算・準同型暗号・
      ゼロ知識証明 ── が分かっていることです。プレイヤーは既に 3 つとも実際に
      やっているのに、それが何という技術かを一度も言われていませんでした。
      名前は成功した瞬間 (FastMovePanel の lesson) に出しますが、何に向かって
      いるのかはここで先に言う。
    */
    goalTitle: "このゲームで身につくもの",
    goalIntro:
      "ORDER には 3 種類の現代暗号が入っています。どれもブロックチェーンを支えている技術で、遊んでいるうちに実際に手を動かすことになります。",
    goals: [
      { name: "準同型暗号", body: "中身を読めないまま計算する。暗号文のまま足す ORDER がこれです。" },
      { name: "秘密計算 (MPC)", body: "全員の合計だけを知り、誰の数も知らない。覆面つき小計の ORDER がこれです。" },
      { name: "ゼロ知識証明", body: "解を見せずに「持っている」ことだけ証明する。PROVE がこれです。数独を付け替えて出すと、審判が写しの 1 行だけ開きます。" },
    ],
    goalTail:
      "シーザー暗号のような古い暗号も出てきますが、それは入口です。「破れる暗号」を先に体験しておくと、破れない暗号のありがたみが分かります。",
    intro:
      "用語: ここでの「Contract」(ORDER) は CloudFormation や blockchain の contract とは無関係で、単に「自チームへの依頼」という意味です。以下の操作はすべて実際の暗号計算であり、シミュレーションではありません。当て推量では得点になりません。",
    lanesTitle: "3 つのレーン (上の「PROVE / LEAK / HUNT — 状態」の中)",
    lanes: [
      { name: "Contract Queue", body: "今まさに自チーム宛に届いている依頼です。何を求められているか（share / 暗号文のまま足す / 覆面つき小計）と、使える方法がそれぞれ書いてあります。期限内に応じないと失効します。" },
      { name: "My Vault", body: "自チームの現行 secret、この世代の share、ROTATE クールダウンです。自チームにのみ表示されます。" },
      { name: "Public Ledger", body: "全チームがこれまでに公開したすべて — LEAK した share、PROVE で開かれた数独のグループ、FHE の答え、MPC の小計 — の永久に残る履歴です。各行にはどの方法で作られたか、どの依頼への応答かが並び、表の下には各チームの公開問題があります。" },
    ],
    movesTitle: "操作 (上の「PROVE / LEAK / HUNT — 操作を送信」の中)",
    moves: [
      {
        name: "LEAK",
        body: "Contract が要求する share を公開して即座に完了・得点します。公開した値は Public Ledger に永久に残り、相手チームの HUNT 材料になります。",
      },
      {
        name: "PROVE",
        body: "4×4 の数独の解を、自分で決めた表 (1→3、2→1、…。右側は 1〜4 を 1 回ずつ使う入れ替えで、まとめではありません) で全マス付け替えたものを出して Contract を完了します。付け替えは紙で行います (この portal は代わりに付け替えません)。同じ Contract を LEAK した場合よりも高い得点で、付け替えの手間に払われる点です。審判はマス目全体を検査し、付け替えた写しの 1 行・1 列・1 箱だけを、表を名指すタグ付きで公開します。1 グループだけなら 1〜4 の並び替えにすぎず、誰にも何も分かりません。同じ表で 2 グループ以上開くと、解が割れることがあります。同じ世代で表を使い回さないでください。使った表は MY VAULT に並びます。",
      },
      {
        name: "CIPHER",
        body: "梯子 Order の記号列を自チームの鍵で暗号化し、結果を提出して完了します。方式は Order にすべて書いてあります。これは意図的で、実際の暗号でも「方式は公開・鍵だけが秘密」だからです。相手の暗号の仕組みを知っていても、それだけでは何の役にも立ちません。何も公開されません。同じ Order を LEAK すると、記号列とその暗号文が対で公開されます。平文と暗号文が並ぶことが鍵の割れる材料であり、いまの段が何組まで耐えるかは Order に書かれています。",
      },
      {
        name: "FHE",
        body: "「鍵をかけたままの数字」が 2 つ届き、その合計に鍵をかけたものを求められる依頼を完了します。やることは 2 つ組を左どうし・右どうし足して p で割った余りを取るだけで、それがこの依頼で使える唯一の方法です。あなたは元の数字を 2 つとも見ませんし、Ledger にも載りません。載るのは鍵がかかったままのあなたの答えで、判定側がそれを開けて照合します。",
      },
      {
        name: "MPC",
        body: "3 つの拠点がそれぞれ自分の数字を持っていて、依頼主は合計だけを知りたい、という依頼を完了します。公開するのは自分の覆面つき小計 1 つ — 自分の数 + 受け取った覆面 − 送った覆面を p で割った余り — だけです。覆面は 3 拠点ぶんを足すと打ち消し合うので、どの拠点の数字も公開されないまま合計だけが正しく出ます。Ledger には 3 つの小計と合計が並ぶので、足し算は自分で確かめられます。",
      },
      {
        name: "HUNT",
        body: "相手チームの Public Ledger 上の share を十分な数集め、Lagrange 補間でローカルに secret を復元し、その値を提出します。実際の secret と厳密に一致した場合のみ得点します。外した HUNT はタダではありません。減点され、相手チームの世代ごとに決まっている少ない回数の持ち分を 1 回使います。減点の値と残り回数は、提出する前に HUNT カードに表示されます。このBattleの現在のしきい値は同じ世代の異なる index で 3 種類です — 同じ index を何度公開しても増えません。もう 1 種類の HUNT として、付け替えを使い回した相手を突く方法があります。同じ世代で同じタグの数独グループが 2 つあれば、それは 1 つの付け替えた写しの断片なので、そのチームの公開問題と突き合わせて表を割り、解を出せます。審判がこの HUNT を受け付けるのは、同じタグのグループで解が 1 つに絞れたときだけです。2 つで絞れることがほとんどですが、絞れなければ次の公開を待ってください。毎回新しい表を選ぶチームでは起こらないので、これが罰するのは誤用であって正しい利用ではありません。",
      },
      {
        name: "ROTATE",
        body: "自チームの secret を新しい世代に更新します。HUNT には同じ世代の share がしきい値分必要なので、この時点より前に漏洩した share (= 古い世代のもの) は、それ以降 secret の復元には使えなくなります。クールダウンがあり、実行すると現在 open な自チーム宛 contract はすべて無効化されます。",
      },
    ],
    prereqTitle: "始める前に",
    prereq: [
      "PROVE は講義の ZK 数独を 4×4 にしたものです。解の数字を付け替えて写しを出すと、審判が写しの 1 行だけ開きます。計算はありません。4 つの対応表を 16 マスに当てるだけです。",
      "HUNT は ac26-w2-secret-sharing が組み立てるのと同じ Shamir 復元です。あちらを先にやれば HUNT は Lagrange の 1 回評価です。",
    ],
    computeTitle: "PROVE と HUNT を自分でやる",
    computeIntro:
      "このポータルが代わりにマス目を付け替えたり secret を復元したりすることはありません — 自分でやること自体が各操作の本来のコストだからです。PROVE にプログラムは要りません。4 つの対応表を 16 マスに当てるだけです。HUNT は p = 97 での Lagrange 補間で、かけら 3 枚から求めます。言語は問いませんし、紙でも解けます。具体性のため Python で書いています。",
    computeCode: PYTHON_SNIPPET,
    computeNote:
      "PROVE のあとどの行・列・箱が開かれるかは Order が決め、あなたは選べません。だから読まれそうな 4 マスではなく、16 マス全部を付け替えてください。本物の ZK 数独は全マスを先に封じてから質問ごとに 1 グループ開きますが、ここでは審判があなたの解を持っているので、その検査を 1 手で済ませています。",
    scoringTitle: "スコアリング、要点だけ",
    scoring: [
      "どの方法でも、その依頼に書かれた得点がそのまま入ります — LEAK / PROVE / FHE / MPC のいずれも同じです。難しい方法だからといって多く得点することはありません。",
      "HUNT は検証済みの正しい復元でのみ得点します。外すと減点され、その相手・世代に対する残り回数も 1 回減るので、当て推量は損にしかなりません。",
      "ROTATE はクールダウンというコストを払いますが、それ以前に漏洩した share を遡ってすべて無価値にします。",
    ],
  },
} as const;

export default function HelpDrawer(props: PortalSlotProps) {
  const copy = COPY[props.locale === "ja" ? "ja" : "en"];
  return (
    <section style={panelStyle}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>{copy.title}</h3>

      {/*
        [Issue #659] The secret's one property comes FIRST, and the moves are
        derived from it.

        This used to open with a vocabulary note and a list of six moves, which
        put four unknown words in the reader's way before anything explained
        why any of them exist. Starting from "three of five rebuild the secret"
        makes every move follow: LEAK spends a piece, PROVE spends time
        instead, three pieces is death, ROTATE is the way out.
      */}
      <h4 style={sectionTitleStyle}>{copy.whatTitle}</h4>
      {copy.what.map((line) => (
        <p key={line} style={{ margin: "0 0 6px 0", fontSize: "13px" }}>{line}</p>
      ))}

      <h4 style={sectionTitleStyle}>{copy.whyTitle}</h4>
      <p style={{ margin: "0 0 8px 0", fontSize: "13px" }}>{copy.whyIntro}</p>
      {copy.whyRows.map((row) => (
        <div key={row.name} style={moveStyle}>
          <strong>{row.name}</strong>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px" }}>{row.how}</p>
          <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#5f6b7a" }}>{row.cost}</p>
        </div>
      ))}
      <p style={{ margin: "8px 0", fontSize: "13px" }}>{copy.whyThen}</p>
      {copy.whyRows2.map((row) => (
        <div key={row.name} style={moveStyle}>
          <strong>{row.name}</strong>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px" }}>{row.how}</p>
        </div>
      ))}

      <h4 style={sectionTitleStyle}>{copy.summaryTitle}</h4>
      <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px" }}>
        {copy.summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p style={{ margin: "8px 0 0 0", fontSize: "13px", color: "#5f6b7a" }}>{copy.summaryTail}</p>

      {/*
        [Issue #659] Where this is going, said before the reference material.
        The point of the Battle is that a player leaves understanding the three
        primitives blockchains are built on. They perform all three during a
        match; naming the destination up front is what turns "I followed the
        instructions" into "I know what I did".
      */}
      <h4 style={sectionTitleStyle}>{copy.goalTitle}</h4>
      <p style={{ margin: "0 0 8px 0", fontSize: "13px" }}>{copy.goalIntro}</p>
      {copy.goals.map((goal) => (
        <div key={goal.name} style={moveStyle}>
          <strong>{goal.name}</strong>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px" }}>{goal.body}</p>
        </div>
      ))}
      <p style={{ margin: "8px 0 0 0", fontSize: "13px", color: "#5f6b7a" }}>{copy.goalTail}</p>

      <details style={{ marginTop: "12px" }}>
        <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
          {copy.detailToggle}
        </summary>
        <div style={{ marginTop: "8px" }}>
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
        </div>
      </details>
    </section>
  );
}
