import { useState } from "react";

type Locale = "ja" | "en";
type Example = "cipher" | "share";

/** Basic rules use fixed, public examples only; never receive a team's vault or call a scoring API. */
export const LEAK_HUNT_RULES = {
  ja: {
    title: "LEAKからHUNTまでの基本ルール（無料）",
    goal: "HUNTで提出するのは、公開された値そのものではなく、そこから計算した相手の未公開の値です。",
    columns: ["方式", "相手に見える材料", "HUNTで入力する答え"],
    rows: [
      ["秘密分散", "LEAKしたかけらの番号と値", "かけらから復元した、元の秘密の数"],
      ["シーザー暗号", "LEAKした平文（元の数）と暗号文の対応", "ずらす数＝鍵。平文や暗号文ではない"],
      ["Vigenère暗号", "LEAKした平文と暗号文の対応・鍵の位置", "3つの位置の鍵を、鍵1・2・3の順で"],
      ["Rotor", "LEAKした元の4文字と暗号の4文字", "2つの車輪の初期位置 a・b"],
      ["RSA", "公開鍵 n・e。LEAKは不要", "nを掛け算で作れる、異なる素数2個"],
      ["じゃんけん", "過去の開封で使い回された隠す数と、今回の封じた数", "今回の手の予測。開封後に採点"],
    ],
    legacy: ["旧数独模型", "同じ印で公開された置き換え後のマス", "置き換え前の数独の解。LEAKではなく証明の公開を使う"],
    sample: "説明例を選ぶ",
    cipher: "シーザー：平文が見えているのに、何を当てる？",
    share: "秘密分散：かけらから、何を当てる？",
    disclaimer: "以下は固定の説明例です。今のお題の答えではありません。説明のためチームAの秘密も示しますが、対戦中に相手の秘密は表示されません。",
    steps: ["1. チームAが守るもの", "2. チームAがLEAK → 公開記録", "3. チームBが計算 → HUNTに提出"],
    cipherExample: [
      "鍵は3。平文2に鍵を足し、7で割った余りを暗号文にする。",
      "「平文2 → 暗号文5」が全チームに見える。鍵3は直接公開しない。",
      "5 − 2 = 3。鍵の欄に3を入力する。2や5を転記する操作ではない。",
    ],
    shareExample: [
      "元の秘密は1。これを5個のかけらに分ける。この例は7で割った余りを使う。",
      "同じチームの同じ組から、#1＝2、#2＝5、#3＝3が公開された。秘密1は直接公開しない。",
      "3×2 − 3×5 + 3 = −6。7を足して1。元の秘密の欄に1を入力する。",
    ],
    cipherRule: "暗号文 − 平文を計算し、画面にある文字の種類の数で割った余りが鍵です。例えば7で割るとき、−4は7を足して3。実際の方式・必要な組数はHUNTの材料欄で確認します。",
    shareRule: "この例は5個中3個で復元でき、2個だけでは元の秘密を特定できません。実戦の必要数は材料欄に従います。同じ相手・同じ世代（同じ組）の、異なる番号が必要です。同じ番号を何回公開しても1個。上の3・−3・1は番号1・2・3専用で、別の番号では画面の係数を使います。値×係数を全部足し、表示された割る数で割った余りを提出します。",
    finish: "対戦では相手チームと方式を選び、材料 → 式 → 回答欄の順に進みます。正しい値と一致すると成功し、得点・回数制限は対戦画面の表示に従います。",
    prove: "PROVEは、対応するお題でシェアを公開せずに完了する別の方法です。新規試合のSchnorrは専用の秘密の数xを使う計算模型で、シェアの値を知っているかは検査しません。RSAやじゃんけんなど、LEAK以外の公開を使うHUNTもあります。",
  },
  en: {
    title: "Basic rules: from LEAK to HUNT (free)",
    goal: "For HUNT, submit the opponent's unpublished value calculated from the evidence, not a copy of the published value.",
    columns: ["Method", "Evidence opponents can see", "Answer to enter in HUNT"],
    rows: [
      ["Secret sharing", "Indices and values of LEAKed shares", "The original secret reconstructed from the shares"],
      ["Caesar", "LEAKed plaintext (original number) and ciphertext pairs", "The shift: the key, not the plaintext or ciphertext"],
      ["Vigenère", "LEAKed pairs and their key positions", "Three shifts in key-position order 1, 2, 3"],
      ["Rotor", "Four original digits and four encrypted digits from LEAK", "The two initial wheel positions a and b"],
      ["RSA", "Public key n and e; no LEAK required", "Two distinct primes whose product is n"],
      ["Rock-paper-scissors", "A reused mask in past openings and the current sealed value", "A prediction of the current hand; scored after opening"],
    ],
    legacy: ["Legacy Sudoku model", "Relabelled cells opened under one repeated tag", "The original Sudoku solution; evidence comes from proof openings, not LEAK"],
    sample: "Choose a worked example",
    cipher: "Caesar: the plaintext is visible, so what do I recover?",
    share: "Secret sharing: what do the shares recover?",
    disclaimer: "These are fixed examples, not answers to your current Order. Team A's secret is shown only for this explanation; opponents' secrets are not displayed in a match.",
    steps: ["1. What Team A protects", "2. Team A uses LEAK → public record", "3. Team B calculates → submits to HUNT"],
    cipherExample: [
      "The key is 3. Add it to plaintext 2 and take the remainder after division by 7.",
      "Everyone sees ‘plaintext 2 → ciphertext 5’. The key 3 is not published directly.",
      "5 − 2 = 3. Enter 3 in the key field, not the already-visible 2 or 5.",
    ],
    shareExample: [
      "The original secret is 1, split into five shares. This example uses remainders after division by 7.",
      "Team A published #1=2, #2=5 and #3=3 from the same set. Secret 1 is not published directly.",
      "3×2 − 3×5 + 3 = −6. Add 7 to get 1. Enter 1 in the original-secret field.",
    ],
    cipherRule: "Subtract plaintext from ciphertext and take the remainder using the displayed alphabet size. With divisor 7, add 7 to −4 to get 3. Check the material panel for the actual method and required pair count.",
    shareRule: "This example needs three of five shares; two cannot determine the original secret. Use the actual match threshold shown in the evidence panel. Use distinct indices from the same opponent and generation (set). Repeating an index counts once. Factors 3, −3, 1 apply only to indices 1, 2, 3; otherwise use the displayed factors. Add value×factor for each share and submit the remainder using the displayed divisor.",
    finish: "In the match, choose an opponent and method, then follow evidence → formula → answer. A matching value succeeds; use the match display for points and attempt limits.",
    prove: "PROVE is an alternative on eligible Orders that does not publish a share. New matches use a Schnorr calculation model with a separate secret x; it does not check knowledge of a share's value. RSA and rock-paper-scissors also show why not every HUNT depends on LEAK.",
  },
} as const;

export default function LeakHuntRules({ locale, legacySudoku = false }: { readonly locale: Locale; readonly legacySudoku?: boolean }) {
  const [example, setExample] = useState<Example>("cipher");
  const copy = LEAK_HUNT_RULES[locale];
  const exampleSteps = example === "cipher" ? copy.cipherExample : copy.shareExample;
  return <details className="tc-information-flow" open>
    <style>{`
      .tc-information-flow{background:#fff;color:#16212e;border:1px solid #b8c9db;border-radius:10px;padding:12px;margin:0 0 12px;font-size:14px;line-height:1.65;overflow-wrap:anywhere}
      .tc-information-flow>summary{cursor:pointer;font-weight:700;min-height:44px;display:list-item;align-content:center}
      .tc-information-flow p{margin:8px 0}.tc-flow-examples{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
      .tc-flow-examples button{font:inherit;min-height:44px;padding:8px 12px;border:1px solid #8394a9;border-radius:6px;background:#fff;color:#183650;cursor:pointer;text-align:left}
      .tc-flow-examples button[aria-pressed="true"]{background:#245986;color:#fff;border-color:#245986}
      .tc-information-flow button:focus-visible,.tc-information-flow summary:focus-visible{outline:3px solid #0972d3;outline-offset:3px}
      .tc-flow-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.tc-flow-steps>div{border:1px solid #bccdde;background:#f4f8fd;border-radius:8px;padding:12px}
      .tc-flow-note{color:#526277;font-size:12px}.tc-flow-table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;table-layout:fixed}
      .tc-flow-table th,.tc-flow-table td{text-align:left;vertical-align:top;border-bottom:1px solid #dce3ec;padding:8px}.tc-flow-table th:first-child{width:18%}
      @media(max-width:640px){.tc-flow-steps{grid-template-columns:1fr}.tc-flow-table{font-size:12px}.tc-flow-table th,.tc-flow-table td{padding:5px}.tc-information-flow{padding:10px}}
    `}</style>
    <summary>{copy.title}</summary>
    <p><strong>{copy.goal}</strong></p>
    <div className="tc-flow-examples" role="group" aria-label={copy.sample}>
      <button type="button" aria-pressed={example === "cipher"} onClick={() => setExample("cipher")}>{copy.cipher}</button>
      <button type="button" aria-pressed={example === "share"} onClick={() => setExample("share")}>{copy.share}</button>
    </div>
    <p className="tc-flow-note">{copy.disclaimer}</p>
    <div className="tc-flow-steps">{exampleSteps.map((text, index) => <div key={`${example}:${index}`}><strong>{copy.steps[index]}</strong><p>{text}</p></div>)}</div>
    <p>{example === "cipher" ? copy.cipherRule : copy.shareRule}</p>
    <details><summary>{locale === "ja" ? "全方式：公開材料とHUNTの回答を確認" : "All methods: evidence and HUNT answers"}</summary>
    <table className="tc-flow-table"><thead><tr>{copy.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
      <tbody>{[...copy.rows, ...(legacySudoku ? [copy.legacy] : [])].map(row => <tr key={row[0]}><th scope="row">{row[0]}</th><td>{row[1]}</td><td>{row[2]}</td></tr>)}</tbody>
    </table>
    <p className="tc-flow-note">{copy.prove}</p></details>
    <p>{copy.finish}</p>
  </details>;
}
