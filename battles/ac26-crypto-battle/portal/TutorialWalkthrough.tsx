/** Optional local practice. Fixed examples only; no match client or real secrets. */
import { useState } from "react";
import ConceptExplanation from "./ConceptExplanation.tsx";

type Locale = "ja" | "en";
type Topic = "remainder" | "sharing" | "mpc" | "zk" | "fhe" | "caesar" | "commit";
interface PracticeCopy {
  readonly title: string;
  readonly purpose: string;
  readonly steps: readonly string[];
  readonly question: string;
  readonly result: string;
  readonly retry: string;
}
interface PracticeStep {
  readonly topic: Topic;
  readonly answer: string;
  readonly ja: PracticeCopy;
  readonly en: PracticeCopy;
}

export const PRACTICE_STEPS: readonly PracticeStep[] = [
  {
    topic: "remainder", answer: "1",
    ja: {
      title: "まず、答えを 0〜6 の数字に収める",
      purpose: "この練習の計算では、7 以上になったら 7 を引きます。数が大きくなり続けないようにするためです。暗号のお題でも、この計算を使います。",
      steps: ["3 + 5 = 8 です。", "8 は 7 以上なので、7 を 1 回引きます。", "8 − 7 = □。空欄に入る数字を下に書いてください。"],
      question: "8 − 7 の答え", result: "8 − 7 = 1。これが『8 を 7 で割った余り』です。mod 7 と書くこともあります。まだ 7 以上なら、もう一度 7 を引きます。", retry: "8 から 7 を引いてみてください。",
    },
    en: {
      title: "First, keep the result between 0 and 6",
      purpose: "In this practice, subtract 7 when a result reaches 7. This keeps the numbers small. The cryptography tasks use the same operation.",
      steps: ["3 + 5 = 8.", "8 is at least 7, so subtract 7 once.", "8 − 7 = □. Enter the missing number below."],
      question: "The result of 8 − 7", result: "8 − 7 = 1: the remainder when 8 is divided by 7. This is also written mod 7. Subtract 7 again if the result is still at least 7.", retry: "Subtract 7 from 8.",
    },
  },
  {
    topic: "sharing", answer: "1",
    ja: {
      title: "3 個のかけらから、秘密の数字を戻す",
      purpose: "秘密分散は、秘密を複数の数にして別々に持つ方法です。この見本では秘密 1 に『番号 × 番号』を足し、7 で割った余りをかけらにします。#1 は 2、#2 は 5、#3 は 3 になります。",
      steps: ["番号 #1・#2・#3 のかけらを戻す式は、3 × #1 − 3 × #2 + #3 です。この係数は、この 3 つの番号用です。", "値を入れると 3 × 2 − 3 × 5 + 3 = 6 − 15 + 3 = −6。", "マイナスになったので 7 を足します。−6 + 7 = □。"],
      question: "復元した秘密の数字", result: "秘密の 1 に戻りました。LEAK はかけらを公開する操作です。同じ秘密の異なるかけらが必要な数だけそろうと、相手がこのように秘密を戻せます。戻した秘密で得点する攻撃を HUNT と呼びます。2 個では決められない理由は、下の解説で追えます。", retry: "−6 に 7 を足すと、0 を 1 つ超えます。",
    },
    en: {
      title: "Recover a secret number from three shares",
      purpose: "Secret sharing splits a secret into numbers held separately. This example adds index × index to secret 1 and takes the remainder after division by 7. Shares #1, #2, #3 are 2, 5, 3.",
      steps: ["For indices #1, #2, #3, recover using 3 × #1 − 3 × #2 + #3. These coefficients belong to these three indices.", "Insert the values: 3 × 2 − 3 × 5 + 3 = 6 − 15 + 3 = −6.", "It is negative, so add 7: −6 + 7 = □."],
      question: "The recovered secret", result: "The secret is 1 again. LEAK publishes a share. Enough distinct shares of the same secret let an opponent recover it and score with an attack called HUNT. The explanation below shows why two shares do not determine it.", retry: "Add 7 to −6: you pass zero by one.",
    },
  },
  {
    topic: "mpc", answer: "6",
    ja: {
      title: "自分の数字を隠して、合計に参加する",
      purpose: "あなた・B・C の 3 人が、それぞれの数字を直接見せずに合計を出したい場面です。あなたの数字は 2。まず、他の人と内緒で共有した数を足し引きしてから提出します。この内緒の数を『覆面』と呼びます。",
      steps: ["あなたは C から受け取った覆面 1 を足し、B へ送った覆面 4 を引きます。", "あなたが出す小計は 2 + 1 − 4 = −1。小計は、あなたの側から提出する数のことです。", "−1 に 7 を足して、0〜6 に収めます。−1 + 7 = □。"],
      question: "あなたが提出する小計", result: "提出する小計は 6。ここからは答え合わせのため B と C の内緒の数も見せます。B の数は 3、C の数は 1、B→C の覆面は 2 とします。\nB は 3+4−2=5、C は 1+2−1=2 を出します。\n全部足すと 6+5+2=13、7 を引いて 6。元の合計 2+3+1=6 と同じです。\n覆面は一度足され、一度引かれて消えました。これが MPC（複数人で秘密を保って計算する方法）の例です。実際には各人は自分の数と関係する覆面だけを知ります。得られるのは合計を 7 で割った余りなので、例えば合計が 9 なら 2 になります。", retry: "−1 に 7 を足し、0〜6 に入る数を答えてください。",
    },
    en: {
      title: "Contribute to a total while hiding your input",
      purpose: "You, B and C want a total without directly showing your own inputs. Your input is 2. Add and subtract privately shared numbers, called masks, before submitting.",
      steps: ["Add the mask 1 received from C; subtract the mask 4 sent to B.", "Your subtotal, the number you submit, is 2 + 1 − 4 = −1.", "Add 7 to keep it between 0 and 6: −1 + 7 = □."],
      question: "Your submitted subtotal", result: "Submit 6. Let B's input be 3, C's be 1, and the B→C mask be 2. B submits 3+4−2=5 and C submits 1+2−1=2. Total: 6+5+2=13, then subtract 7 to get 6, matching 2+3+1=6. Each mask was added and subtracted once. This illustrates MPC, computing together while preserving privacy. Each person normally knows only their own input and related masks; all inputs are shown here for explanation. The result is the remainder of the total after division by 7: a total of 9 would give 2.", retry: "Add 7 to −1 and enter a number between 0 and 6.",
    },
  },
  {
    topic: "zk", answer: "2",
    ja: {
      title: "答えを別の数字に付け替えて見せる",
      purpose: "本番では数独の答えを使います。この練習では、その一行として 1〜4 が一度ずつ並んだ列を使います。『正しい解を持っている』と審判に確かめてもらいながら、元の解全体を相手チームへ直接渡したくありません。そこで、どのマスでも同じ表を使い、数字の呼び名を替えます。",
      steps: ["表は 1→3、2→1、3→4、4→2。矢印の先の数字へ読み替えます。", "元の行 2・1・3・4 は、1・3・4・□ になります。", "最後の元の数字は 4。表の 4→2 を見て、空欄を埋めてください。"],
      question: "付け替えた行の最後の数字", result: "1・3・4・2 になりました。元の行と同じく、1〜4 が一度ずつ現れます。本番は表を選び、4 マスを埋めます。ゲームの審判は元の解を知って照合し、相手へは付け替えた一行などの一部分を公開します。ZK（ゼロ知識証明）は答えを明かさず正しさを示す技術で、本来は検証する人にも答えを隠します。このゲームはその考え方を体験するモデルです。同じ表は再使用しないでください。同じ表で別の部分も見せると、相手が公開された部分をつなげられるからです。", retry: "4→2 は、4 を 2 に読み替える意味です。",
    },
    en: {
      title: "Show a solution with its digits renamed",
      purpose: "The match uses sudoku solutions; here we practise one row containing each of 1–4 once. Have the judge check that you hold a solution without directly handing the full original to another team. Use the same digit-renaming table in every cell.",
      steps: ["Table: 1→3, 2→1, 3→4, 4→2. Replace each digit with the digit after its arrow.", "Original row 2,1,3,4 becomes 1,3,4,□.", "The last original digit is 4. Use 4→2 to fill the hole."],
      question: "The last digit of the renamed row", result: "The result is 1,3,4,2, still containing 1–4 once each. In the match, choose a table and fill four cells. The trusted game judge knows the original and publishes one renamed group to others. ZK (zero-knowledge proof) demonstrates correctness without disclosing an answer, including to its verifier. This game teaches that idea with a simplified judge. Do not reuse a table: showing other parts with the same table lets an opponent connect the published pieces.", retry: "4→2 means replace 4 with 2.",
    },
  },
  {
    topic: "fhe", answer: "4",
    ja: {
      title: "中身を開けずに、暗号のまま足す",
      purpose: "中身を隠した数の組を『暗号文』と呼びます。ここでは (2,5) と (3,6) を受け取りました。中身を隠すために使う秘密の数が『鍵』です。鍵がなくても、左どうしと右どうしを足す計算はできます。",
      steps: ["左どうし：2 + 3 = 5。", "右どうし：5 + 6 = 11。7 以上なので、7 を引きます。", "答えは (5, □)。右の 11 − 7 を計算してください。"],
      question: "答えの暗号文の右の数字", result: "答えは (5,4)。ここからは答え合わせのため、見本の中身と鍵を見せます。中身は 1 と 3、別々の鍵は 2 と 1 です。\n隠す数は『鍵 × 元の暗号文の左』。1 個目は鍵 2 × 左 2 = 4、2 個目は鍵 1 × 左 3 = 3。中身に足すと右は 1+4=5、3+3=6 でした。\n足し合わせた右から隠す数を引くと 4−4−3=−3、7 を足して 4。中身の合計 1+3=4 が戻ります。ゲームでは判定側がこれを確かめます。得られるのは合計を 7 で割った余りなので、合計が 9 なら 2 です。\nこれが準同型暗号の足し算の考え方です。FHE（完全準同型暗号）は掛け算なども扱いますが、この教材は足し算のモデルです。", retry: "11 から 7 を引いてください。左の 5 はそのままです。",
    },
    en: {
      title: "Add encrypted numbers without opening them",
      purpose: "An encrypted pair hiding a number is a ciphertext. You receive (2,5) and (3,6). A key is a secret number used to hide the content. You can add the lefts and rights separately without the keys.",
      steps: ["Lefts: 2 + 3 = 5.", "Rights: 5 + 6 = 11. Subtract 7 because it is at least 7.", "Answer: (5,□). Calculate 11 − 7 for the right value."],
      question: "The right value of your answer", result: "The answer is (5,4). For explanation we now reveal the contents 1 and 3, with separate keys 2 and 1. A hiding number is key times the original ciphertext’s left: key 2 × left 2 = 4; key 1 × left 3 = 3. Adding to the contents gave rights 1+4=5 and 3+3=6. Subtract them from the right sum: 4−4−3=−3; add 7 to get 4, matching 1+3. The game judge performs this check. The result is the total’s remainder after division by 7; a total of 9 would give 2. This is homomorphic addition. FHE (fully homomorphic encryption) also handles multiplication; this is a teaching model of addition.", retry: "Subtract 7 from 11. The left value remains 5.",
    },
  },
  {
    topic: "caesar", answer: "1",
    ja: {
      title: "数字をずらして、暗号を作る",
      purpose: "最後は、暗号を作る操作です。0〜5 の数字を輪のように並べ、決めた数だけ先へずらします。このずらす数が『鍵』です。",
      steps: ["鍵は 3、元の数字は 4。まず 4 + 3 = 7。", "使う数字は 0〜5 なので、6 に達したら先頭へ戻ります。", "7 − 6 = □。これが暗号にした数字です。"],
      question: "4 を鍵 3 で暗号にした数字", result: "暗号にした数字は 1。これをシーザー暗号と呼びます。逆に 1−4=−3、6 を足すと鍵の 3 を求められます。元と暗号の組を公開すると、相手に鍵を復元される理由です。本番では『計算して答える』と『公開してすぐ答える（LEAK）』の得点・公開リスクを見て選びます。", retry: "7 から 6 を引いてください。",
    },
    en: {
      title: "Make a cipher by shifting digits",
      purpose: "Arrange digits 0–5 in a circle and move forward by a fixed amount. That shift amount is the key.",
      steps: ["Key 3, original digit 4: first calculate 4 + 3 = 7.", "The digits are 0–5. Wrap back to the start at 6.", "7 − 6 = □. This is the encrypted digit."],
      question: "Digit 4 encrypted with key 3", result: "The encrypted digit is 1. This is a Caesar cipher. An opponent can calculate 1−4=−3, then add 6 to recover key 3. That is why publishing an original/encrypted pair exposes the key. In the match, compare the score and disclosure cost of calculating an answer and publishing to answer immediately (LEAK).", retry: "Subtract 6 from 7.",
    },
  },
  {
    topic: "commit", answer: "2",
    ja: {
      title: "手を先に数字へ隠し、あとで開く",
      purpose: "じゃんけんの手を先に見せると、相手が勝つ手を選べます。そこで、グーを表す m=1 に隠す数 r=2 を混ぜ、先に数字だけを出します。この数字がコミットメントです。",
      steps: ["式は 4^m × 9^r を 23 で割った余り。4^1 は 4、9^2 は 9×9=81。81−23−23−23=12。", "4×12=48。23 を 2 回引くと、48−23−23=□。", "この余りが、手より先に相手へ見せる数字です。"],
      question: "先に封じる数字", result: "先に 2 を出します。両者の数字がそろったあとで、手 m=1 と隠す数 r=2 を審判へ渡すと、同じ計算で 2 になるか確かめてもらえます。審判は両者の開封をそろえて同時公開します。この順番を commit-reveal と呼びます。この小さな数では別の手への開け方も探せるので、後出しを防ぐには審判の同時公開が必要です。r は次回 0〜10 のくじから引き直します。", retry: "48−23=25。もう一度 23 を引いてください。",
    },
    en: {
      title: "Seal a hand in a number, then open it",
      purpose: "Showing your hand first lets an opponent counter it. Combine rock m=1 with hiding number r=2 and first send only a number: a commitment.",
      steps: ["Take the remainder of 4^m × 9^r after division by 23. 4^1=4; 9^2=81; 81−23−23−23=12.", "4×12=48. Subtract 23 twice: 48−23−23=□.", "This remainder is the number you show before your hand."],
      question: "The number to seal first", result: "Send 2 first. After both commitments arrive, give the judge m=1 and r=2. The same calculation must reproduce 2. The judge publishes both openings together. This order is commit-reveal. Tiny numbers permit alternative openings, so the judge's simultaneous publication is needed to prevent adapting after seeing the other hand. Next time, draw r again from 0–10.", retry: "48−23=25. Subtract 23 once more.",
    },
  },
];

export function checkPracticeAnswer(index: number, value: string): boolean {
  return /^[0-9]$/.test(value.trim()) && PRACTICE_STEPS[index]?.answer === value.trim();
}

const buttonStyle = { cursor: "pointer", padding: "8px 12px", border: "1px solid #b4c5da", borderRadius: 7, background: "#fff", color: "#315f91", fontSize: 13 } as const;

export default function TutorialWalkthrough({ locale }: { readonly locale: Locale }) {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState<"correct" | "wrong" | null>(null);
  const step = PRACTICE_STEPS[index]!;
  const copy = step[locale];
  const move = (next: number) => { setIndex(next); setAnswer(""); setVerdict(null); };
  if (!visible) return <div aria-label="crypto-battle-tutorial-collapsed">
    <button type="button" aria-expanded={false} style={buttonStyle} onClick={() => setVisible(true)}>{locale === "ja" ? "練習する（任意）" : "Practice (optional)"}</button>
  </div>;
  return <section aria-label="crypto-battle-tutorial" style={{ border: "1px solid #b4c5da", borderRadius: 10, padding: 18, color: "#16212e", background: "#fff", marginTop: 10 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <strong>{locale === "ja" ? "小さい数字で、暗号の計算を練習する" : "Practice cryptography with small numbers"}</strong>
      <button type="button" style={buttonStyle} aria-expanded={true} onClick={() => setVisible(false)}>{locale === "ja" ? "練習を閉じる" : "Close practice"}</button>
    </div>
    <p style={{ fontSize: 12, color: "#526277" }}>{locale === "ja" ? "1 回に埋めるのは数字 1 つ。計算したあとに、その計算を使う理由を確かめます。本番の得点には影響しません。" : "Fill one digit at a time, then see why that calculation is useful. Practice does not affect your match score."}</p>
    <p style={{ fontSize: 12, color: "#315f91" }}>{index + 1} / {PRACTICE_STEPS.length}</p>
    <h3 style={{ fontSize: 19, margin: "8px 0" }}>{copy.title}</h3>
    <p style={{ fontSize: 14, lineHeight: 1.8 }}>{copy.purpose}</p>
    <ol style={{ paddingLeft: 24, fontSize: 14, lineHeight: 1.9 }}>{copy.steps.map((line) => <li key={line}>{line}</li>)}</ol>
    <form onSubmit={(event) => { event.preventDefault(); setVerdict(checkPracticeAnswer(index, answer) ? "correct" : "wrong"); }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
        {copy.question}
        <input aria-label={copy.question} inputMode="numeric" maxLength={1} value={answer} onChange={(event) => { setAnswer(event.target.value); setVerdict(null); }} style={{ width: 64, padding: 9, fontSize: 18, background: "#fff", color: "#16212e", border: "1px solid #8298b3", borderRadius: 7 }} />
        <button type="submit" disabled={!answer.trim()} style={{ ...buttonStyle, background: "#315f91", color: "#fff" }}>{locale === "ja" ? "答えを確かめる" : "Check my answer"}</button>
      </label>
    </form>
    <div aria-live="polite" style={{ fontSize: 14, lineHeight: 1.8 }}>
      {verdict === "wrong" && <p style={{ color: "#a33223" }}>{copy.retry}</p>}
      {verdict === "correct" && <div style={{ marginTop: 14, padding: 14, background: "#edf7f0", borderRadius: 8 }}><strong>{locale === "ja" ? "正解。何ができた？" : "Correct. What did you achieve?"}</strong><p style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>{copy.result}</p></div>}
    </div>
    <div style={{ display: "flex", gap: 8, margin: "14px 0", flexWrap: "wrap" }}>
      {index > 0 && <button type="button" style={buttonStyle} onClick={() => move(index - 1)}>{locale === "ja" ? "前の計算へ" : "Previous calculation"}</button>}
      {verdict === "correct" && (index + 1 < PRACTICE_STEPS.length
        ? <button type="button" style={buttonStyle} onClick={() => move(index + 1)}>{locale === "ja" ? "次の計算へ" : "Next calculation"}</button>
        : <button type="button" style={buttonStyle} onClick={() => { setVisible(false); move(0); }}>{locale === "ja" ? "練習を終えて、お題へ戻る" : "Finish practice and return to the Order"}</button>)}
    </div>
    <ConceptExplanation key={step.topic} topic={step.topic} locale={locale} />
  </section>;
}
