import { useState } from "react";
import { ECDSA_MULTIPLES, ENIGMA_WHEEL, type EvolutionTask } from "../game/src/evolution-model.ts";
export default function EvolutionWorksheet({task,locale,busy,wrongCost,onSubmit}: {task:EvolutionTask;locale:"ja"|"en";busy:boolean;wrongCost:number;onSubmit:(answer:string)=>void}) {
 const ja=locale==="ja"; const [values,setValues]=useState(["",""]);
 const signature=task.kind==="ecdsa-sign";
 return <section className="tc-input-panel">
  {task.kind==="enigma-encrypt" && <>
   <h3>{ja?"エニグマ：反射板で折り返す（一桁模型）":"Enigma: reflect and return (one-digit model)"}</h3>
   <p>{ja?"このお題は暗号化だけです。車輪を1進め、下の配線を往復して得た暗号文1個を提出すると完了です。":"This Order asks only for encryption. Advance the wheel once, follow the path out and back, and submit one ciphertext digit to complete it."}</p>
   <strong>{ja?"元の数":"Original"}: {task.plaintext[0]} · {ja?"初期位置":"Initial position"}: {task.initial} → {ja?"今回の位置":"Position for this character"}: {(task.initial+1)%4}</strong>
   <div style={{padding:12,background:"#eef5ff",margin:"12px 0"}}>{ja?"元の数 → 車輪を往路 → 反射板 → 車輪を復路 → 答え":"Original → wheel forward → reflector → wheel backward → answer"}</div>
   <p>{ja?"Wは車輪の変換表、Rは反射板の交換。W⁻¹は同じ表を右から左へ読む操作です。車輪を1進めると変換表も変わります。":"W is the wheel lookup, R the reflector swap, and W⁻¹ means reading the same table backward. Stepping changes the lookup."}</p><table><caption>{ja?"車輪Wの入力→出力（今回の位置）":"Wheel W input→output at this position"}</caption><tbody>{[0,1,2,3].map(m=><tr key={m}><th>{m}</th><td>→</td><td>{(ENIGMA_WHEEL[(m+task.initial+1)%4]!-(task.initial+1)%4+4)%4}</td></tr>)}</tbody></table>
   <p>{ja?"①表を左→右 ②反射板で0↔1、2↔3 ③同じ表を右→左。戻った数1個が答えです。":"①Read left→right ②Reflect0↔1,2↔3 ③Read the same table right→left. Submit the one returned digit."}</p>
   <p>{ja?"別の例：位置0の表が0→1、1→3、2→0、3→2なら、元の数0 → 往路1 → 反射0 → 復路2。答えは2です。":"Separate example: at position0, W maps0→1,1→3,2→0,3→2. Original0 → forward1 → reflected0 → backward2. Answer2."}</p><details><summary>{ja?"式と実機との違い":"Equation and machine boundary"}</summary><p>{ja?"mは元の数、cは答え、aは今回の位置。Pは位置0の配線[1,3,0,2]で、P[0]=1のように読みます。mod4は4で割った余りです。":"m is the original, c the answer, a the position. P is the position0 wiring [1,3,0,2], so P[0]=1. mod4 means remainder after dividing by4."}</p><p>Wₐ(m) = (P[(m+a) mod4]−a) mod4<br/>c = Wₐ⁻¹(R(Wₐ(m)))<br/>Wₐ⁻¹ R Wₐ Wₐ⁻¹ R Wₐ(m) = m</p><p>{ja?"反射板は2回通すと元に戻るため、往復全体も2回で元に戻ります。実機は26文字・複数ローター・プラグボード等を使います。この1ローター模型は往復配線と位置の変化を学ぶお題です。":"The reflector is its own inverse, so the whole round trip is too. Actual machines use26 letters, multiple rotors and a plugboard. This one-wheel model teaches the return path and stepping."}</p></details>
  </>}
  {task.kind==="rsa-decrypt" && <>
   <h3>{ja?"RSA：秘密鍵で平文へ戻す":"RSA: decrypt with a private key"}</h3>
   <p>{ja?"15で割った余りをmod15と書きます。cは暗号文の数、mは元の数です。":"mod15 means the remainder after division by15. c is the ciphertext number; m is the original number."}</p>
   <div style={{padding:12,background:"#eef5ff"}}>{ja?"暗号文":"Ciphertext"} c={task.ciphertext} → c<sup>{task.d}</sup> mod {task.n} → {ja?"平文 m = □":"Plaintext m = □"}</div>
   <p>{ja?"与えられた秘密鍵は(n=15,d=3)。公開鍵(n=15,e=3)で暗号化した一桁の数を戻します。":"Given private key(n=15,d=3), recover the one-digit number encrypted with public key(n=15,e=3)."}</p>
   <ol><li>c² = {task.ciphertext} × {task.ciphertext} mod15</li><li>m = c² × c mod15</li></ol>
   <p>{ja?"mod15は15で割った余り。掛けるたびに余りにして計算を小さくできます。このお題専用の鍵はHUNT対象外です。":"mod15 means remainder after division by15; reduce after each multiplication. This task-only key is outside HUNT."}</p>
   <p>{ja?"別の例：c=8なら、8×8=64 → 15で割った余り4。次に4×8=32 → 余り2。平文は2です。":"Separate example: c=8. 8×8=64 leaves4 modulo15; 4×8=32 leaves2. The plaintext is2."}</p><details><summary>{ja?"なぜ元に戻る？":"Why does it invert?"}</summary><p>15=3×5, e×d=3×3=9=1+8.<br/>m → m³ mod15 → (m³)³ mod15 = m.</p><p>{ja?"15と互いに素（共通の約数が1だけ）な数は8個あり、その8乗を15で割った余りは1です。3や5の倍数も、3と5それぞれの余りで確かめると元に戻ります。これはパディング（安全性のための符号化）を省いた教科書RSAです。実用RSAは大きな鍵と安全な符号化を使います。":"This is textbook RSA without padding. Practical RSA uses large keys and secure encoding."}</p></details>
  </>}
  {task.kind==="ecdsa-sign" && <>
   <h3>{ja?"ECDSA：一桁のメッセージ値に署名する":"ECDSA: sign a one-digit message value"}</h3>
   <p>{ja?"暗号化は中身を隠す操作。署名は、公開鍵でメッセージとの対応を検査できる数字を作る操作です。ハッシュはメッセージを短い数へ変換する処理です。ここでは変換済みの値hを受け取ります。":"Encryption hides content. Signing creates numbers checked against a message using a public key. A hash converts a message to a short value; h is supplied after that step."}</p>
   <p>{ja?"dはこのお題用の秘密鍵、kは今回の署名だけに使う数。nは出発点Gを繰り返し足して0役に戻る回数です。rとsの2個を計算してください。HUNT対象の鍵ではありません。":"d is this task's private key; k is a number used for this signature only. n counts additions of starting point G before returning to the point that acts as zero. Calculate r and s. This key is outside HUNT."}</p>
   <strong>h={task.hash}, d={task.d}, k={task.k}, n=7</strong>
   <p>{ja?"5で割った余りをmod5、7で割った余りをmod7と書きます。逆元j⁻¹はjと掛けて7で割った余りが1になる数です。":"mod5 and mod7 mean the remainders after division by5 and7. The inverse j⁻¹ is a number that multiplies j to leave remainder1 after division by7."}</p>
   <p>{ja?"点は(x,y)の組で、x座標は左の数。Gは出発点、jGは楕円曲線の足し算でGをj回足した点です。下の表に計算済みの点を示します。n=7は7回足すと足し算の出発状態に戻る回数です。":"A point is an (x,y) pair; its x coordinate is the left number. G is the starting point, jG adds G to itself j times using elliptic-curve addition. The table supplies these points. n=7 is the number of additions returning to the additive identity."}</p><div style={{overflowX:"auto"}}><table><caption>y²=x³+2x+1 (mod5), G=(0,1)</caption><thead><tr><th>j</th>{[1,2,3,4,5,6].map(j=><th key={j}>{j}</th>)}</tr></thead><tbody><tr><th>jG</th>{ECDSA_MULTIPLES.slice(1).map((p,i)=><td key={i}>({p![0]},{p![1]})</td>)}</tr><tr><th>j⁻¹ mod7</th>{[1,4,5,2,3,6].map((v,i)=><td key={i}>{v}</td>)}</tr></tbody></table></div>
   <div style={{padding:12,background:"#eef5ff",margin:"12px 0"}}>kG → {ja?"x座標":"x coordinate"} → r<br/>s = k⁻¹ × (h + d×r) mod7</div>
   <p>{ja?"逆元k⁻¹は表の最下段。kと掛けると7の余りが1になります。座標の計算はmod5、署名の計算はmod7です。":"Read inverse k⁻¹ in the last row: multiplying by k leaves remainder1 modulo7. Coordinates use modulo5; signature scalars use modulo7."}</p>
   <p>{ja?"別の例：h=1、d=2、k=2。表の2G=(1,3)からr=1、2の逆元は4。s=4×(1+2×1)=12 → 7で割った余り5。署名は(r,s)=(1,5)です。":"Separate example: h=1,d=2,k=2. Table2G=(1,3) gives r=1; inverse of2 is4. s=4×(1+2×1)=12 leaves5 modulo7. Signature(r,s)=(1,5)."}</p><details><summary>{ja?"公開鍵での検証と数学":"Public verification and mathematics"}</summary><p>{ja?"Qは公開鍵の点、wはsの逆元、u₁とu₂は点を何回足すかを決める数、Xは検証で得る点です。無限遠点は楕円曲線の足し算で0の役割をする特別な点です。":"Q is the public-key point; w is the inverse of s; u₁ and u₂ are point multipliers; X is the resulting verification point. The point at infinity acts as zero for point addition."}</p><p>Q=dG, w=s⁻¹ mod7, u₁=hw mod7, u₂=rw mod7.<br/>X=u₁G+u₂Q. {ja?"Xが無限遠点でなく、x座標 mod7 = rなら検証成功。":"Accept when X is not infinity and its x coordinate mod7 equals r."}</p><p>X = s⁻¹(h+rd)G = kG.</p><p>{ja?"この等式により、検証には秘密鍵dを渡す必要がありません。小さい曲線と配布済みkは手計算専用です。実用ではkを秘密にし、別の署名で使い回しません。":"This identity lets verification proceed without receiving d. The tiny curve and supplied one-use number are for hand calculation only. In practice these one-use numbers stay secret and are not reused."}</p></details>
  </>}
  {(signature?["r","s"]:[ja?"答えの数字1個":"One answer digit"]).map((label,i)=><label key={label} style={{display:"inline-flex",gap:8,margin:8}}>{label}<input aria-label={label} value={values[i]} inputMode="numeric" maxLength={1} style={{width:60}} onChange={e=>setValues(v=>v.map((old,j)=>i===j?e.target.value:old))}/></label>)}
  <p>{ja?`不正解は最大${wrongCost}点減点。期限内なら再提出できます。`:`Incorrect answers cost up to ${wrongCost} points. Retry before the deadline.`}</p>
  <button type="button" className="tc-submit-small" disabled={busy||!(signature?values:values.slice(0,1)).every(v=>/^[0-9]$/.test(v))} onClick={()=>onSubmit((signature?values:values.slice(0,1)).join(" "))}>{ja?"計算した答えを提出":"Submit calculated answer"}</button>
 </section>;
}
