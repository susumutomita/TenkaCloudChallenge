import { useState } from "react";
import { SudokuBoard, SUDOKU_CSS } from "./SudokuGrid.tsx";
import MpcMaskDiagram from "./MpcMaskDiagram.tsx";

export default function ConceptDiagram({ kind, locale }: { readonly kind: "fhe" | "zk" | "relabel" | "sharing" | "mpc"; readonly locale: "ja" | "en" }) {
  const ja = locale === "ja";
  const [digit, setDigit] = useState(2);
  const solution = [2,1,3,4,3,4,1,2,4,3,2,1,1,2,4,3];
  const table = [3,1,4,2];
  const lit = solution.flatMap((n, i) => n === digit ? [i] : []);
  if (kind === "fhe") return <figure aria-label={ja ? "暗号配送のしくみ" : "Encrypted delivery mechanism"} style={{margin:"14px 0"}}>
    <figcaption>{ja ? "中身は開けず、暗号文をまとめて届ける" : "Combine ciphertexts without opening their contents"}</figcaption>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
      {(ja ? ["🔒 暗号文A ＋ 🔒 暗号文B\nあなたには中身も鍵も見えない", "あなた：左どうし・右どうしを足す\n↓ 合計を隠した暗号文を送る", "🔑 判定側：元の入力と各鍵で確認\n中身の合計と一致する？"] : ["🔒 Ciphertext A + 🔒 Ciphertext B\nYou see neither contents nor keys", "You: add each column separately\n↓ Send the encrypted total", "🔑 Judge: use original inputs and keys\nDoes the hidden total match?"]).map((label,index)=><div key={label} style={{display:"contents"}}>{index>0&&<b aria-hidden="true">→</b>}<div style={{flex:"1 1 180px",border:"2px solid #85aac6",borderRadius:12,padding:14,whiteSpace:"pre-line",background:"#edf6ff",color:"#183650"}}>{label}</div></div>)}
    </div>
    <p>{ja ? "あなたの計算＝暗号文の加算。鍵を使う確認＝判定側の仕事。" : "Your operation adds ciphertexts. Checking with keys belongs to the judge."}</p>
  </figure>;
  if (kind === "mpc") return <MpcMaskDiagram locale={locale} />;
  const nodes = kind === "zk" ? (ja ? ["証明する人\n秘密を知っている", "証明だけを送る\n秘密は送らない", "確認する人\n正しさを確かめる"] : ["Prover\nKnows a secret", "Send a proof\nKeep the secret", "Verifier\nChecks the claim"]) : (ja ? ["秘密分散\n秘密から複数の数を作る", "シェア（share）\n番号と数の組", "必要な個数を集める\n元の秘密を戻せる"] : ["Secret sharing\nCreate several numbers", "A share\nAn index and a value", "Collect enough shares\nRecover the secret"]);
  return <figure style={{ margin: "14px 0" }} aria-label={ja ? "しくみの図" : "Mechanism diagram"}>
    <style>{SUDOKU_CSS}</style>
    {kind === "relabel" ? <>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>{table.map((to, from) => <button type="button" key={from} aria-pressed={digit === from+1} onClick={() => setDigit(from+1)} style={{ padding: "8px 14px", border: "1px solid #789cce", borderRadius: 8, color: "#183b66", background: digit === from+1 ? "#ffe9ac" : "#fff", fontSize: 18 }}>{from+1} → {to}</button>)}</div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div><figcaption>{ja ? "元の数独" : "Original sudoku"}</figcaption><SudokuBoard cells={solution} lit={lit} size={34} /></div>
        <b style={{ fontSize: 24 }}>{digit} → {table[digit-1]}</b>
        <div><figcaption>{ja ? "付け替えた数独" : "Renamed sudoku"}</figcaption><SudokuBoard cells={solution.map(n => table[n-1]!)} lit={lit} size={34} /></div>
      </div>
      <p style={{ fontSize: 12 }}>{ja ? "上の矢印を押すと、対応するマスが光ります。位置は動かしません。" : "Select an arrow to highlight matching cells. Positions stay the same."}</p>
    </> : <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{nodes.map((node, i) => <div key={node} style={{ display: "contents" }}>{i > 0 && <b aria-hidden="true">→</b>}<div style={{ flex: "1 1 140px", padding: 14, border: "1px solid #abc5e5", borderRadius: 10, background: "#fff", whiteSpace: "pre-line", textAlign: "center", lineHeight: 1.8 }}>{node}</div></div>)}</div>}
  </figure>;
}
