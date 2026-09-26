import { SchnorrLesson } from "./SchnorrLesson.tsx";
import { useEffect, useState } from "react";
import type { ContractProjection, CryptoBattleOp } from "../game/src/types.ts";
import { power } from "../game/src/schnorr.ts";

/** Private values stay in this tab; the player calculates each result. */
export function SchnorrResponseSteps({r,x,e,locale}:{r:number;x:number;e:number;locale:"ja"|"en"}) {
  const ja=locale==="ja";
  return <ol aria-label={ja?"zを計算する順番":"Steps to calculate z"} style={{display:"grid",gap:12,paddingInlineStart:28}}>
    <li>{ja?"掛ける":"Multiply"}<div style={{fontSize:24}}>{e} × {x} = □①</div></li>
    <li>{ja?"①の答えに足す":"Add to answer ①"}<div style={{fontSize:24}}>□① + {r} = □②</div></li>
    <li>{ja?"11で割った余りを出す":"Find the remainder after dividing by 11"}<div style={{fontSize:24}}>□② ÷ 11 → {ja?"余り":"remainder"} = z</div><small>{ja?"②が11未満なら、そのまま。11以上なら、11を引いて0〜10になるまで繰り返します。":"If ② is below 11, keep it. Otherwise subtract 11 repeatedly until it is 0–10."}</small></li>
    <li><strong>{ja?"余りを「計算した余り z」欄に入力して送る":"Enter the remainder in “Calculated remainder z” and submit"}</strong></li>
  </ol>;
}

/** Every input of z stays on screen for free; only the worked procedure is hint 3. */
export function SchnorrResponseValues({r,x,e,locale}:{r:number;x:number;e:number;locale:"ja"|"en"}) {
  const ja=locale==="ja";
  return <dl aria-label={ja?"zの計算に使う数":"Values used to calculate z"} style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"4px 12px"}}>
    <dt><strong>r = {r}</strong></dt><dd>{ja?`送信1で使った今回だけの乱数（a = 2${sup(r)} mod 23 = ${power(2,r)}）。この端末だけが持ち、送りません。`:`The fresh random number from submission 1 (a = 2${sup(r)} mod 23 = ${power(2,r)}). Only this browser has it; it is not sent.`}</dd>
    <dt><strong>e = {e}</strong></dt><dd>{ja?"検証者から届いた質問の数。":"The challenge number returned by the verifier."}</dd>
    <dt><strong>x = {x}</strong></dt><dd>{ja?"自分だけの数（秘密）。送りません。":"Your private number (the secret). It is not sent."}</dd>
  </dl>;
}
const SUPERSCRIPT="⁰¹²³⁴⁵⁶⁷⁸⁹";
function sup(n:number){return String(n).split("").map(d=>SUPERSCRIPT[Number(d)]).join("");}

export function SchnorrResponseGuide({r,x,e,locale,hints}:{r:number;x:number;e:number;locale:"ja"|"en";hints:ContractProjection["hints"]}) {
  const ja=locale==="ja";
  return <>
    <p>z = (r + e × x) mod 11 — {ja?"r + e × x を11で割った余り":"the remainder of r + e × x divided by 11"}</p>
    {hints.filter(h=>h.text).length>=3 && <aside>
      <strong>{ja?"ヒント③：今回の数字で計算":"Hint 3: calculate with your values"}</strong>
      <SchnorrResponseSteps r={r} x={x} e={e} locale={locale} />
    </aside>}
  </>;
}

/** The only private randomness stays in the participant browser. */
export function SchnorrProof({order,teamId,locale,busy,onSubmit}:{order:ContractProjection;teamId:string;locale:"ja"|"en";busy:boolean;onSubmit:(op:CryptoBattleOp)=>void}) {
  const proof=order.schnorr!;
  const ja=locale==="ja";
  const [secret,setSecret]=useState<number|null>(null);
  const [nonce,setNonce]=useState<number|null>(null);
  const [a,setA]=useState("");
  const [z,setZ]=useState("");
  const [commitError,setCommitError]=useState(false);
  const storageKey=`tc-schnorr:${teamId}:${order.id}`;
  useEffect(()=>{
    setCommitError(false);
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
  const valid=(v:string,max=10)=>/^\d+$/.test(v)&&Number(v)<=max;
  const commit=()=>{
    if(busy||nonce===null||secret===null||!valid(a,22))return;
    if(Number(a)!==power(2,nonce)) { setCommitError(true); return; }
    setCommitError(false);
    try { sessionStorage.setItem(storageKey,JSON.stringify({x:secret,r:nonce})); } catch { /* Current tab can continue using its witness. */ }
    onSubmit({kind:"schnorr-commit",contractId:order.id,y:proof.y,a:Number(a)});
  };
  return <section className="tc-input-panel" aria-label="Schnorr zero-knowledge proof">
    <h3>{ja?"ゼロ知識証明（Schnorr）の計算模型":"Zero-knowledge proof (Schnorr) calculation model"}</h3>
    <p className="tc-schnorr-progress">{ja ? `このお題は2回の送信で1つの証明を作ります。最後の応答が正しければ完了・+${order.points}点です。` : `Two submissions form one proof. A correct final response completes this Order for +${order.points} points.`}</p>
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
      <label>{ja?"計算した余り a（0〜22）":"Calculated remainder a (0–22)"} <input aria-label="Schnorr a" inputMode="numeric" value={a} onChange={e=>{setA(e.target.value);setCommitError(false);}} /></label>
      {a !== "" && !valid(a,22) && <p role="alert">{ja?"0〜22の整数を1個入力してください。":"Enter one integer from 0 to 22."}</p>}
      {commitError && <p role="alert">{ja?"計算が合いません。2をr回掛け、23で割った余りをもう一度確認してください。まだ送信されておらず、減点もありません。":"The calculation does not match. Multiply 2 by itself r times and check the remainder modulo 23 again. Nothing was sent and no points were deducted."}</p>}
      <p>{ja?"数字を入力してボタンを押すと計算を確認します。合っていればaを送信し、次の数eを受け取ります。":"Enter a number and press the button to check it. If it matches, a is sent and you receive the next number e."}</p>
      <button type="button" className="tc-submit-small" disabled={busy||secret===null||nonce===null||!valid(a,22)} onClick={commit}>{ja?"① 計算結果を確認して、次へ":"① Check calculation and continue"}</button>
    </> : proof.pending.used ? <p role="status">{(proof.pending.outcome === "hit" || (!proof.pending.outcome && order.status === "completed")) ? (ja?"模型の検証式が一致しました。秘密を知っていたことを保証する結果ではありません。":"The model equation matched. This result does not certify prior knowledge of the secret.") : (ja?"検証失敗：送った応答は検証式を満たしませんでした。この証明には再回答できません。":"Verification failed: your response did not satisfy the equation. This proof cannot be retried.")}</p> : <>
      <div className="tc-schnorr-progress" role="status"><strong>{ja?"1回目の送信が完了。あと1回で証明完了です。":"First submission complete. One more submission finishes the proof."}</strong></div>
      <h4>{ja?"送信 2 / 2：届いたeを使って、最後の答えを計算":"Submission 2 / 2: calculate the final answer using the returned e"}</h4>
      <p>a = {proof.pending.a} → <strong>e = {proof.pending.e}</strong></p>
      {!matchesPending ? <p role="alert">{ja?"この端末に開始時の乱数 r がありません。証明を開始したタブで続けてください。":"The original private r is missing. Continue in the tab where you started."}</p> : <>
        <h4>{ja?"掛けて、足して、11で割った余りを入力":"Multiply, add, then enter the remainder modulo 11"}</h4>
        <SchnorrResponseValues r={nonce!} x={secret!} e={proof.pending.e} locale={locale} />
        <SchnorrResponseGuide r={nonce!} x={secret!} e={proof.pending.e} locale={locale} hints={order.hints} />
        <label>{ja?"計算した余り z（0〜10）":"Calculated remainder z (0–10)"} <input aria-label="Schnorr z" inputMode="numeric" value={z} onChange={e=>setZ(e.target.value)} /></label>
        <p>{ja?"0も答えとして入力できます。数字を入力すると送信できます。":"Zero is a valid answer. Enter a number to enable submission."}</p>
        <button type="button" className="tc-submit-small" disabled={busy||!valid(z)} onClick={()=>onSubmit({kind:"schnorr-response",contractId:order.id,z:Number(z)})}>{ja?`② 証明を完了する · 正解で+${order.points}点`:`② Complete proof · +${order.points} if correct`}</button>
      </>}
    </>}
    <p>{ja?"検証する式（x と r は使いません）":"Verification (does not use x or r)"}: <strong>2<sup>z</sup> ≡ a × y<sup>e</sup> (mod 23)</strong></p>
    {!proof.pending && order.hints.filter(h=>h.text).length>=3 && <aside role="note"><strong>{ja?"ヒント③：今回の数字で計算":"Hint 3: calculate with your values"}</strong>
      <ol>
        <li>{ja?`今回の r は ${nonce??"…"}。`:`Your r is ${nonce??"…"}.`}</li>
        <li>{ja?`2を${nonce??"r"}回掛ける（0回なら1）。`:`Multiply 2 by itself ${nonce??"r"} times (zero times means 1).`}</li>
        <li>{ja?"その数を23で割った余りを求める。":"Find the remainder after dividing that number by 23."}</li>
        <li>{ja?"余りを「計算した余り a」欄へ入力し、「① 計算結果を確認して、次へ」を押す。":"Enter the remainder in “Calculated remainder a” and press “① Check calculation and continue”."}</li>
      </ol>
    </aside>}
    <details><summary>{ja?"なぜこれがゼロ知識？ 図と式で確認":"Why zero knowledge? Follow the equations"}</summary>
      <SchnorrLesson locale={locale}/>
    </details>
  </section>;
}
