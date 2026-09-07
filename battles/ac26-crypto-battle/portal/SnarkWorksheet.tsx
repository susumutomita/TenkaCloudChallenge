import {useState} from 'react';
import type {ConstraintTask} from '../game/src/snark.ts';
export function SnarkWorksheet({task,locale,busy,onSubmit}:{task:ConstraintTask;locale:'ja'|'en';busy:boolean;onSubmit:(answer:string)=>void}) {
 const ja=locale==='ja';const [values,setValues]=useState(['','','','','']);const [a,b,c]=task.rows;
 const equations=[`${a[0]} + ${a[1]} − ${a[2]}`,`${b[0]} × ${b[1]} − ${b[2]}`,`${c[0]} + ${c[1]} − ${c[2]}`,`${a[2]} − ${c[0]}`,`${b[2]} − ${c[1]}`];
 return <section className="tc-input-panel" aria-label="SNARK constraint worksheet">
  <h3>{ja?'SNARKの算術化：計算と配線を検査':'SNARK arithmetization: check gates and wires'}</h3>
  <p>{ja?'SNARKは計算の正しさを短い証明で示す方式です。ここでは、その準備として計算を「余りが0になる式」に直す算術化を体験します。値を隠すZKや短い証明の生成は、この表の検査だけでは実現しません。':'A SNARK provides a short proof of a computation. This exercise covers arithmetization: translating computation into equations with zero remainder. Checking this table alone provides neither zero knowledge nor a succinct proof.'}</p>
  <p>{ja?'下の表は誰かが提出した計算です。正しいとは限りません。各行をゲートと呼び、L・Rが入力、Oが出力です。':'This is a proposed computation and may be wrong. Each row is a gate: L and R are inputs, O is its output.'}</p>
  <table><thead><tr><th>{ja?'行':'Row'}</th><th>{ja?'計算':'Operation'}</th><th>L</th><th>R</th><th>O</th></tr></thead><tbody>{task.rows.map((row,i)=><tr key={i}><th>{i+1}</th><td>{i===1?'×':'+'}</td>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table>
  <div style={{display:'flex',gap:12,flexWrap:'wrap',padding:12,background:'#eef5ff',color:'#16212e'}} aria-label={ja?'必要な配線':'Required wiring'}>
   <span>O₁ ({a[2]}) → L₃ ({c[0]})</span><span>O₂ ({b[2]}) → R₃ ({c[1]})</span>
  </div>
  <p>{ja?'矢印の両端は同じ値である必要があります（コピー制約）。各行の計算が合っていても、この配線が違えば全体は不正です。':'Each arrow must connect equal values: a copy constraint. Correct individual gates do not excuse incorrect wiring.'}</p>
  <p>{ja?'一般式：足し算 L+R−O、掛け算 L×R−O、配線は 出力−次の入力。7で割った余りを求めます。全5個が0なら、この表の計算と配線は整合します。':'General rules: addition L+R−O, multiplication L×R−O, and wire output−next input. Take each remainder by 7. All five must be zero for this table to be consistent.'}</p>
  <p>{ja?'例：2+3−5=0 は一致。出力5を入力6へつなぐと5−6=−1、7を足して余り6となり不一致。':'Example: 2+3−5=0 passes. Wiring output5 to input6 gives 5−6=−1; add7 to get remainder6, a mismatch.'}</p>
  <strong>{ja?'5つの余りを入力（0〜6）':'Enter five remainders (0–6)'}</strong>
  {equations.map((eq,i)=><label key={i} style={{display:'flex',gap:12,alignItems:'center',margin:'8px 0'}}>{i<3?(ja?`行${i+1}`:`Row ${i+1}`):(ja?`配線${i-2}`:`Wire ${i-2}`)}: {eq} →
   <input aria-label={`SNARK remainder ${i+1}`} style={{width:70}} inputMode="numeric" maxLength={1} value={values[i]} onChange={e=>setValues(v=>v.map((x,j)=>i===j?e.target.value:x))}/>
  </label>)}
  <button type="button" disabled={busy||!values.every(v=>/^[0-6]$/.test(v))} onClick={()=>onSubmit(values.join(' '))}>{ja?'検査結果を提出':'Submit check results'}</button>
  <details><summary>{ja?'SNARK全体との関係・数学の式':'Relation to SNARKs and the general equation'}</summary>
   <p>Q<sub>L</sub>L + Q<sub>R</sub>R + Q<sub>M</sub>LR + Q<sub>O</sub>O + Q<sub>C</sub> = 0 (mod 7)</p>
   <p>{ja?'Qは計算の種類を選ぶ係数です。足し算は(1,1,0,−1,0)、掛け算は(0,0,1,−1,0)。この5つの係数を使うと、同じ式で両方の計算を表せます。':'The Q coefficients select the operation. Addition uses (1,1,0,−1,0); multiplication uses (0,0,1,−1,0). One equation describes both.'}</p>
   <p>{ja?'PLONK（SNARKを作る方式の一つ）では、この表を多項式（数の累乗を足し合わせた式）にし、値を後から変えられないコミットメントと評価の証明を組み合わせます。配線も多項式で検証します。このお題ではその前段のゲートと配線を直接検査し、表の値は隠していません。':'PLONK, one design for SNARKs, encodes the table as polynomials (sums of powers), then uses commitments that bind the values and proofs of their evaluations. Wiring is also checked through polynomials. This worksheet directly checks the underlying gates and wires and does not hide the table.'}</p>
  </details>
 </section>;
}
