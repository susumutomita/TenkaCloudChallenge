import {useState} from "react";
import {CURVE_POINTS,type Point} from "../game/src/ec.ts";
import type {OrderTaskProjection} from "../game/src/types.ts";
const show=(p:Point)=>p?`(${p[0]}, ${p[1]})`:"O";
export function EcWorksheet({task,locale,busy,onSubmit}:{task:Extract<OrderTaskProjection,{kind:"ec-add"}>;locale:"ja"|"en";busy:boolean;onSubmit:(answer:string)=>void}) {
 const [answer,setAnswer]=useState("");const ja=locale==="ja";const p=task.left,q=task.right;
 return <section className="tc-input-panel" aria-label="Elliptic curve worksheet">
 <h3>{ja?"楕円曲線：P + Q を手計算":"Elliptic curve: calculate P + Q"}</h3>
 <p>{ja?"点は(x,y)の組。ECDSA（電子署名の方式）でも使う点加算を体験します。署名全体を作る問題ではありません。":"A point is an (x,y) pair. This is point addition used in ECDSA digital signatures, not a complete signature."}</p>
 <p>{ja?"楕円曲線は、この式を満たす点の集まりです。Oは、足しても相手の点を変えない特別な点（無限遠点）です。":"An elliptic curve consists of points satisfying this equation. O is a special point, called the point at infinity: adding it leaves the other point unchanged."}</p>
 <p style={{fontSize:22}}>y² ≡ x³ + 2x + 3 (mod 7)　P={show(p)}　Q={show(q)}</p>
 <p>{ja?"mod 7 は7で割った余り。≡は左右の余りが等しいこと。すべて0〜6に直します。":"mod 7 means remainder after division by 7; ≡ means equal remainders. Keep all values in 0–6."}</p>
 <svg viewBox="0 0 180 180" role="img" aria-label={ja?"7×7の座標上の曲線の点。青がP、橙がQ。":"Curve points on a 7 by 7 grid. P is blue; Q is orange."} style={{width:180,maxWidth:"100%"}}>
 {Array.from({length:7},(_,i)=><g key={i}><path d={`M25 ${150-i*20}H150 M${30+i*20} 25V155`} stroke="#d4dce5"/><text x={30+i*20} y="175" fontSize="10">{i}</text><text x="8" y={153-i*20} fontSize="10">{i}</text></g>)}
 {CURVE_POINTS.filter((v):v is NonNullable<Point>=>v!==null).map(v=><circle key={v.join()} cx={30+v[0]*20} cy={150-v[1]*20} r="4" fill="#657080"/>)}
 {[p,q].map((v,i)=>v&&<g key={i}><circle cx={30+v[0]*20} cy={150-v[1]*20} r={i?7:5} fill="none" stroke={i?"#a65000":"#086bc1"} strokeWidth="2"/><text x={35+v[0]*20} y={140-v[1]*20} fontSize="12">{i?"Q":"P"}</text></g>)}
 </svg>
 {p===null||q===null?<p>{ja?"Oは足しても点を変えない単位元（無限遠点）。O+Q=Q、P+O=Pです。":"O is the identity (point at infinity): O+Q=Q and P+O=P."}</p>:p[0]===q[0]&&(p[1]+q[1])%7===0?<p>{ja?"xが同じで、yの和が0（mod7）。この2点は打ち消し合うので、答えは無限遠点 O です。":"Equal x and y values summing to 0 modulo7 cancel: the result is O, the point at infinity."}</p>:<>
 <h4>{ja?"① 傾き λ（ラムダ）を求める":"① Find the slope λ (lambda)"}</h4>
 <p style={{fontSize:20}}>{p[0]===q[0]?`λ = (3×${p[0]}² + 2) × (2×${p[1]})⁻¹`:`λ = (${q[1]} − ${p[1]}) × (${q[0]} − ${p[0]})⁻¹`} (mod 7)</p>
 <p>{ja?"⁻¹は逆元：掛けて7の余りが1になる相手です。分母を0〜6に直して下の表で探します。":"⁻¹ means inverse: multiplying the pair gives remainder1. Reduce the denominator to 0–6 and use this table."}</p>
 <table><tbody><tr><th>{ja?"数":"Number"}</th>{[1,2,3,4,5,6].map(x=><td key={x}>{x}</td>)}</tr><tr><th>{ja?"逆元":"Inverse"}</th>{[1,4,5,2,3,6].map(x=><td key={x}>{x}</td>)}</tr></tbody></table>
 <h4>{ja?"② x、次に y を計算":"② Calculate x, then y"}</h4>
 <p style={{fontSize:20}}>x = λ² − {p[0]} − {q[0]} (mod 7)<br/>y = λ × ({p[0]} − x) − {p[1]} (mod 7)</p>
 <details><summary>{ja?"なぜこの式？":"Why these equations?"}</summary><p>{ja?"直線と曲線の交点を求めてyの符号を反転した式です。同じ点を2回足す場合は、傾きに接線の式 (3x²+2)/(2y) を使います。実数の曲線の図とは違い、ここでは座標を7の余りに限定しています。":"These equations intersect a line with the curve and reflect y. Doubling uses the tangent slope (3x²+2)/(2y). Coordinates here are remainders modulo7 rather than real numbers."}</p></details>
 </>}
 <details><summary>{ja?"小さい例で計算を確認":"Worked example"}</summary><p>P=(2,1), Q=(3,1): λ=(1−1)×1⁻¹=0; x=0²−2−3=−5 → 2; y=0×(2−2)−1=−1 → 6. P+Q=(2,6).</p><p>{ja?"負の数には7を足し、7以上なら7を引いて、0〜6に直します。":"Add 7 to negative values or subtract 7 from values above6 until they lie in 0–6."}</p></details>
 <label>{ja?"答え：x と y を半角スペースで区切る（例：2 6）。無限遠点は O":"Answer: x space y (example: 2 6), or O for infinity"}<input aria-label="EC answer" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="x y / O" /></label>
 <button type="button" disabled={busy||!(/^[0-6] [0-6]$/.test(answer)||answer==="O")} onClick={()=>onSubmit(answer)}>{ja?"点を提出":"Submit point"}</button>
 </section>;
}
