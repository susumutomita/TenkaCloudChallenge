import { SchnorrLesson } from "./SchnorrLesson.tsx";
import { useEffect, useState } from "react";
import type { ContractProjection, CryptoBattleOp } from "../game/src/types.ts";
import { power } from "../game/src/schnorr.ts";

/** The only private randomness stays in the participant browser. */
export function SchnorrProof({order,teamId,locale,busy,onSubmit}:{order:ContractProjection;teamId:string;locale:"ja"|"en";busy:boolean;onSubmit:(op:CryptoBattleOp)=>void}) {
  const proof=order.schnorr!;
  const ja=locale==="ja";
  const [secret,setSecret]=useState<number|null>(null);
  const [nonce,setNonce]=useState<number|null>(null);
  const [a,setA]=useState("");
  const [z,setZ]=useState("");
  const storageKey=`tc-schnorr:${teamId}:${order.id}`;
  useEffect(()=>{
    if(proof.pending) {
      if(secret!==null && nonce!==null && power(2,secret)===proof.pending.y && power(2,nonce)===proof.pending.a) return;
      setSecret(null); setNonce(null); setZ("");
      let stored: string | null = null;
      try { stored=sessionStorage.getItem(storageKey); } catch { return; }
      if(stored) {
        try {
          const saved=JSON.parse(stored);
          if(Number.isInteger(saved.x)&&saved.x>=1&&saved.x<=10&&Number.isInteger(saved.r)&&saved.r>=0&&saved.r<11&&power(2,saved.r)===proof.pending.a&&power(2,saved.x)===proof.pending.y) {
            setNonce(saved.r);setSecret(saved.x);
          }
        } catch { /* No usable local witness: show the recovery guidance below. */ }
      }
      return;
    }
    const draw=()=>{const bytes=new Uint8Array(1);do {crypto.getRandomValues(bytes);} while(bytes[0]!>=253);return bytes[0]!%11;};
    const x=Array.from({length:11},(_,i)=>i).find(i=>power(2,i)===proof.y);
    setSecret(x??null);setNonce(draw());
  },[storageKey,proof.y,proof.pending?.a,proof.pending?.y]);
  const matchesPending = nonce!==null && secret!==null && (!proof.pending || (power(2,nonce)===proof.pending.a && power(2,secret)===proof.pending.y));
  const valid=(v:string)=>/^\d+$/.test(v)&&Number(v)<=10;
  const correctCommitment = nonce !== null && /^\d+$/.test(a) && Number(a) === power(2,nonce);
  const commit=()=>{
    if(nonce===null||secret===null||!correctCommitment)return;
    try { sessionStorage.setItem(storageKey,JSON.stringify({x:secret,r:nonce})); } catch { /* Current tab can continue using its witness. */ }
    onSubmit({kind:"schnorr-commit",contractId:order.id,y:proof.y,a:Number(a)});
  };
  return <section className="tc-input-panel" aria-label="Schnorr zero-knowledge proof">
    <h3>{ja?"ゼロ知識証明（Schnorr）：秘密の数を知っていると示す":"Zero-knowledge proof (Schnorr): show knowledge of a secret"}</h3>
    <p>{ja?"あなたは x を知っています。検証者は y だけを使い、x を受け取らずに応答を検査します。":"You know x. The verifier checks your response using y, without receiving x."}</p>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}} aria-label={ja?"証明の順番":"Proof sequence"}>
      <strong>{ja?"あなた：a を送る":"You send a"}</strong><span>→</span><strong>{ja?"検証者：e を返す":"Verifier sends e"}</strong><span>→</span><strong>{ja?"あなた：z を計算して送る":"You calculate and send z"}</strong>
    </div>
    <p><strong>{ja?"自分だけの数":"Private witness"}: x = {secret??"…"}</strong>　{ja?"公開値":"Public value"}: y = 2<sup>{secret??"…"}</sup> mod 23 = {secret===null?proof.pending?.y:power(2,secret)}</p>
    <p>{ja?"この教材は小さい数なので、公開値 y から表で x を探せます。実用ではこの探索が困難になる大きさを使います。":"This tiny model finds x from public y using a power table. Practical parameters make this search infeasible."}</p>
    <p>{ja?"≡ は「左右を割った余りが等しい」という記号です。":"≡ means both sides have the same remainder."}</p>
    <p>{ja?"mod は「割った余り」。指数・応答は11で、掛け算の結果は23で余りを取ります。":"mod means remainder. Reduce exponents/responses modulo 11 and group products modulo 23."}</p>
    {!proof.pending ? <>
      <h4>{ja?"送信 1 / 2：2をr回掛け、23で割った余りを送る":"Submission 1 / 2: multiply 2 by itself r times, then send the remainder modulo 23"}</h4>
      <p>{ja?"最初の送信だけでは完了しません。次に届く数を使って、もう一度計算します。":"The first submission does not complete the Order. Use the number returned for one more calculation."}</p>
      <p>{ja?"今回だけの内緒の乱数":"Fresh private random number"}: r = {nonce??"…"}</p>
      <p style={{fontSize:24}}>a = 2<sup>{nonce??"r"}</sup> mod 23 = □</p>
      <table><caption>{ja?"掛け算を確かめる表（2⁰ = 1）":"Power table (2⁰ = 1)"}</caption><tbody>
        <tr><th>r</th>{Array.from({length:11},(_,i)=><td key={i}>{i}</td>)}</tr>
        <tr><th>2<sup>r</sup> mod 23</th>{Array.from({length:11},(_,i)=><td key={i}>{power(2,i)}</td>)}</tr>
      </tbody></table>
      <label>{ja?"計算した余り a（0〜22）":"Calculated remainder a (0–22)"} <input aria-label="Schnorr a" inputMode="numeric" value={a} onChange={e=>setA(e.target.value)} /></label>
      {a !== "" && !correctCommitment && <p role="alert">{ja?"表の r の列を確認してください。a が式の答えと違います。送る前に直せます。":"Check the r column: a does not match the equation. Correct it before sending."}</p>}
      <p>{ja?"式の答えを入力すると、次へ進めます。":"Enter the equation’s answer to continue."}</p>
      <button type="button" className="tc-submit-small" disabled={busy||secret===null||!correctCommitment} onClick={commit}>{ja?"① 計算結果を送って、次へ":"① Send calculation and continue"}</button>
    </> : proof.pending.used ? <p role="status">{(proof.pending.outcome === "hit" || (!proof.pending.outcome && order.status === "completed")) ? (ja?"検証成功：秘密を送らずに証明できました。":"Verification passed: you proved knowledge without sending the secret.") : (ja?"検証失敗：送った応答は検証式を満たしませんでした。この証明には再回答できません。":"Verification failed: your response did not satisfy the equation. This proof cannot be retried.")}</p> : <>
      <div className="tc-schnorr-progress" role="status"><strong>{ja?"1回目の送信が完了。あと1回で証明完了です。":"First submission complete. One more submission finishes the proof."}</strong></div>
      <h4>{ja?"送信 2 / 2：届いたeを使って、最後の答えを計算":"Submission 2 / 2: calculate the final answer using the returned e"}</h4>
      <p>a = {proof.pending.a} → <strong>e = {proof.pending.e}</strong></p>
      {!matchesPending ? <p role="alert">{ja?"この端末に開始時の乱数 r がありません。証明を開始したタブで続けてください。":"The original private r is missing. Continue in the tab where you started."}</p> : <>
        <h4>{ja?"掛けて、足して、11で割った余りを入力":"Multiply, add, then enter the remainder modulo 11"}</h4>
        <p style={{fontSize:24}}>z = (r + e × x) mod 11<br/>= ({nonce} + {proof.pending.e} × {secret??"…"}) mod 11 = □</p>
        <label>{ja?"計算した余り z（0〜10）":"Calculated remainder z (0–10)"} <input aria-label="Schnorr z" inputMode="numeric" value={z} onChange={e=>setZ(e.target.value)} /></label>
        <p>{ja?"0も答えとして入力できます。数字を入力すると送信できます。":"Zero is a valid answer. Enter a number to enable submission."}</p>
        <button type="button" className="tc-submit-small" disabled={busy||!valid(z)} onClick={()=>onSubmit({kind:"schnorr-response",contractId:order.id,z:Number(z)})}>{ja?`② 証明を完了する · 正解で+${order.points}点`:`② Complete proof · +${order.points} if correct`}</button>
      </>}
    </>}
    <p>{ja?"検証する式（x と r は使いません）":"Verification (does not use x or r)"}: <strong>2<sup>z</sup> ≡ a × y<sup>e</sup> (mod 23)</strong></p>
    {order.hints.filter(h=>h.text).length>=3 && <aside role="note"><strong>{ja?"購入済みヒント③・今回の数字":"Purchased hint 3 · your current values"}</strong><p>{!proof.pending ? (ja?`まず表の r=${nonce??"…"} の列を見て、下の数を a 欄に入力します。`:`Find r=${nonce??"…"} in the table and enter the number below it in a.`) : nonce===null ? (ja?"開始したタブで乱数を確認してください。":"Find the private randomness in the original tab.") : (ja?`まず ${proof.pending.e} × ${secret}、次に ${nonce} を足します。その結果から11を引き、0〜10になるまで繰り返して z 欄へ入力します。`:`Multiply ${proof.pending.e} × ${secret}, add ${nonce}, then subtract 11 until the result is 0–10. Enter it in z.`)}</p></aside>}
    <details><summary>{ja?"なぜこれがゼロ知識？ 図と式で確認":"Why zero knowledge? Follow the equations"}</summary>
      <SchnorrLesson locale={locale}/>
    </details>
  </section>;
}
