import { SchnorrModelNotice } from "./SchnorrModelNotice.tsx";
import { useState } from "react";
/** Fixed seminar example; never reads a player's witness or submits a move. */
export function SchnorrLesson({locale}:{locale:"ja"|"en"}) {
  const [step,setStep]=useState(0);const ja=locale==="ja";
  const titles=ja?["誰が、何を知っている？","手計算と検証式","秘密なしでも同じ会話を作れる","秘密を守ることと、不正を見分けること"]:["Who knows what?","Calculate and verify","Simulate without the secret","Privacy and detecting false claims"];
  const equation={fontSize:22,lineHeight:1.8,overflowWrap:"anywhere" as const};
  return <section aria-label="Schnorr lesson" style={{background:"#f4f8fd",color:"#172d46",padding:16,borderRadius:8}}>
    <SchnorrModelNotice locale={locale}/>
    <h4>{step+1}/4 · {titles[step]}</h4>
    <p>{ja?"mod は割った余り、≡ は左右の余りが等しいという意味です。g は繰り返し掛ける数、p は余りを取る割る数です。":"mod means remainder; ≡ means equal remainders. g is the repeated base and p is the modulus (divisor)."}</p>
    {step===0&&<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
        <div><strong>{ja?"あなたの端末だけ":"Your browser only"}</strong><p>x = 7 · r = 3</p><p>{ja?"x：知っていると示す数。r：今回だけの乱数。どちらも送らない。":"x is your witness; r is fresh randomness. Neither is sent."}</p></div>
        <div><strong>{ja?"検証者に送る":"Sent to the verifier"}</strong><p>y = 2<sup>7</sup> mod 23 = 13</p><p>a = 2<sup>3</sup> mod 23 = 8</p></div>
      </div>
      <p style={equation}>{ja?"あなた":"You"} ── (y, a) ──→ {ja?"検証者":"Verifier"}</p>
      <p>{ja?"主張は「公開値 y = 2ˣ に対応する x を知っている」。シェアや数独の解を知る証明とは別のお題です。":"The claim is knowledge of x for public y = 2ˣ, separate from knowing a share or Sudoku solution."}</p>
    </>}
    {step===1&&<>
      <p>{ja?"a を固定した後、検証者が e = 5 を返す。":"After a is fixed, the verifier returns e = 5."}</p>
      <p style={equation}>z = (r + e × x) mod 11<br/>= (3 + 5 × 7) mod 11 = 5</p>
      <p>{ja?"あなた → z = 5 → 検証者。左右が同じかを検査する。":"You → z = 5 → verifier. Compare both sides."}</p>
      <table><thead><tr><th>{ja?"左辺":"Left"}</th><th>{ja?"右辺":"Right"}</th></tr></thead><tbody><tr><td>2<sup>5</sup> mod 23 = 9</td><td>8 × 13<sup>5</sup> mod 23 = 9</td></tr></tbody></table>
      <p style={equation}>g<sup>z</sup> = g<sup>r+ex</sup> = g<sup>r</sup>(g<sup>x</sup>)<sup>e</sup> = a y<sup>e</sup> (mod p)</p>
      <p>{ja?"この例は g=2、p=23、同じ値に戻るまで掛ける回数（群の位数）q=11。2¹¹ mod23=1なので、指数は11で余りを取れます。検証式に x や r はありません。":"Here g=2, p=23 and q=11 multiplications to return to 1 (the group order). Since 2¹¹ mod23=1, exponents reduce modulo 11. Verification contains neither x nor r."}</p>
    </>}
    {step===2&&<>
      <p>{ja?"「式に x がない」だけでは不十分。x を知らない人でも同じ確率で各結果が出る会話（同じ分布）を作れることを示します。":"The absence of x in the check is insufficient. Someone without x can generate the same probabilities for each transcript (its distribution)."}</p>
      <p style={equation}>e, z {ja?"を先に選ぶ":"first"} → a = g<sup>z</sup> y<sup>−e</sup> → (a, e, z)</p>
      <p>{ja?"例：y=13、e=5、z=9。2⁹ mod23=6、13⁵ mod23=4。4×6を23で割った余りが1。この6を4の逆元と呼び、 a=6×6 mod23=13。":"Example: y=13, e=5, z=9. 2⁹ mod23=6; 13⁵ mod23=4. 4×6 has remainder 1 modulo 23. This makes 6 the inverse of 4, so a=6×6 mod23=13."}</p>
      <p style={equation}>2<sup>9</sup> mod 23 = 6 = 13 × 13<sup>5</sup> mod 23</p>
      <p>{ja?"各 e に対し z=r+ex は r の各値が重複せず z の各値に対応します（一対一）。r が均等なら z も均等。本物と模擬会話の分布は同じで、公開値 y 以上の情報を与えません。":"For each e, z=r+ex maps each r to a unique z, covering all z values (a bijection). Uniform r gives uniform z. Real and simulated transcripts have identical distributions and reveal nothing beyond y."}</p>
    </>}
    {step===3&&<>
      <p>{ja?"実際は a → e → z の順番。e を見てから a を作り直せません。同じ a に異なる e で答えられるなら、秘密を取り出せます。":"Real order is a → e → z: a cannot change after e. Two different challenges answered for the same a yield the witness."}</p>
      <p style={equation}>x = (z − z′)(e − e′)<sup>−1</sup> mod q</p>
      <p>{ja?"例：(e,z)=(5,5) と (2,6)。3の逆元は4なので x=(5−6)×4 mod11=7。rを使い回してはいけない理由でもあります。":"Example: (e,z)=(5,5) and (2,6). The inverse of 3 is 4; x=(5−6)×4 mod11=7. Never reuse r."}</p>
      <p>{ja?"決められた手順で質問を均等に選ぶ検証者を「正直な検証者」と呼びます。この相手へのゼロ知識がHVZKです。公開値y以上を漏らさない性質と、秘密を知らずに通ることが難しい性質は別です。この模型では秘密の候補が最大11通りしかなく、後者の安全性はありません。同じ小さな数で何回繰り返しても、この候補の少なさは解消しません。実用には、公開値から秘密を求める計算が十分難しくなる大きさが必要です。Verify成功は秘密の復元ではなく、HUNTの得点にはしません。":"An honest verifier follows the protocol and draws the challenge uniformly. ZK for this verifier is called HVZK. Revealing nothing beyond y and making false claims hard to pass are different properties. With at most 11 possible secrets, this model does not provide the latter security. Repeating rounds over the same tiny group does not fix that small search space. Practical parameters must make recovering a secret from its public value computationally infeasible. Verification does not recover the secret or award HUNT points."}</p>
    </>}
    <nav style={{display:"flex",gap:12}}><button type="button" disabled={step===0} onClick={()=>setStep(step-1)}>{ja?"前へ":"Previous"}</button><button type="button" disabled={step===3} onClick={()=>setStep(step+1)}>{ja?"次へ":"Next"}</button></nav>
  </section>;
}
