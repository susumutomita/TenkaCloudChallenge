import {useState} from 'react';
import type {ConstraintTask} from '../game/src/snark.ts';
export function SnarkWorksheet({task,locale,busy,wrongCost,onSubmit}:{task:ConstraintTask;locale:'ja'|'en';busy:boolean;wrongCost:number;onSubmit:(answer:string)=>void}) {
 const ja=locale==='ja';const [values,setValues]=useState(['','','','','']);const [a,b,c]=task.rows;
 const equations=[`${a[0]} + ${a[1]} − ${a[2]}`,`${b[0]} × ${b[1]} − ${b[2]}`,`${c[0]} + ${c[1]} − ${c[2]}`,`${a[2]} − ${c[0]}`,`${b[2]} − ${c[1]}`];
 return <section className="tc-input-panel" aria-label="SNARK constraint worksheet">
  <h3>{ja?'計算を式で確かめる：短い証明（SNARK）の準備':'Check computation with equations: prepare a short proof (SNARK)'}</h3>
  <p>{ja?'SNARKは計算の正しさを短い証明で示す方式です。ここでは、その準備として計算を「余りが0になる式」に直す算術化を体験します。秘密の値を教えず正しさを示す性質をゼロ知識（ZK）と呼びます。この表の検査だけでは、ゼロ知識や短い証明の生成は実現しません。':'A SNARK provides a short proof of a computation. This exercise covers arithmetization: translating computation into equations with zero remainder. Zero knowledge means showing correctness without revealing private values. Checking this table alone provides neither zero knowledge nor a short proof.'}</p>
  <p>{ja?'下の表は誰かが提出した計算です。正しいとは限りません。各行をゲートと呼び、L・Rが入力、Oが出力です。':'This is a proposed computation and may be wrong. Each row is a gate: L and R are inputs, O is its output.'}</p>
  <table><thead><tr><th>{ja?'行':'Row'}</th><th>{ja?'計算':'Operation'}</th><th>L</th><th>R</th><th>O</th></tr></thead><tbody>{task.rows.map((row,i)=><tr key={i}><th>{i+1}</th><td>{i===1?'×':'+'}</td>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table>
  <div style={{display:'flex',gap:12,flexWrap:'wrap',padding:12,background:'#eef5ff',color:'#16212e'}} aria-label={ja?'必要な配線':'Required wiring'}>
   <span>O₁ ({a[2]}) → L₃ ({c[0]})</span><span>O₂ ({b[2]}) → R₃ ({c[1]})</span>
  </div>
  <p>{ja?'矢印の両端は同じ値である必要があります（コピー制約）。各行の計算が合っていても、この配線が違えば全体は不正です。':'Each arrow must connect equal values: a copy constraint. Correct individual gates do not excuse incorrect wiring.'}</p>
  <p>{ja?'一般式：足し算 L+R−O、掛け算 L×R−O、配線は 出力−次の入力。7で割った余りを求めます。全5個が0なら、この表の計算と配線は整合します。':'General rules: addition L+R−O, multiplication L×R−O, and wire output−next input. Take each remainder by 7. All five must be zero for this table to be consistent.'}</p>
  <p>{ja?'例：足し算2+3−5=0は一致。掛け算3×4−4=8は7を引いて余り1なので不一致。出力5を入力6へつなぐと5−6=−1、7を足して余り6となり不一致。':'Example: addition 2+3−5=0 passes. Multiplication 3×4−4=8; subtract 7 to get remainder 1, so it fails. Wiring output5 to input6 gives 5−6=−1; add7 to get remainder6, a mismatch.'}</p>
  <strong>{ja?'5つの余りを入力（0〜6）':'Enter five remainders (0–6)'}</strong>
  {equations.map((eq,i)=><label key={i} style={{display:'flex',gap:12,alignItems:'center',margin:'8px 0'}}>{i<3?(ja?`行${i+1}`:`Row ${i+1}`):(ja?`配線${i-2}`:`Wire ${i-2}`)}: {eq} →
   <input aria-label={`SNARK remainder ${i+1}`} style={{width:70}} inputMode="numeric" maxLength={1} value={values[i]} onChange={e=>setValues(v=>v.map((x,j)=>i===j?e.target.value:x))}/>
  </label>)}
  <p>{ja?`不正解は最大 ${wrongCost} 点減点。入力は残り、期限内なら再提出できます。`:`Incorrect answers cost up to ${wrongCost} points. Inputs stay; retry before the deadline.`}</p>
  <button type="button" className="tc-submit-small" disabled={busy||!values.every(v=>/^[0-6]$/.test(v))} onClick={()=>onSubmit(values.join(' '))}>{ja?'検査結果を提出':'Submit check results'}</button>
  <details><summary>{ja?'SNARK全体との関係・数学の式':'Relation to SNARKs and the general equation'}</summary>
   <p>{ja?'Qは演算を選ぶ係数です。添字L/R/M/O/Cは左入力・右入力・掛け算・出力・定数の係数を区別します。mod 7は「7で割った余りで比べる」という表記です。':'The Q values are coefficients selecting the operation. Subscripts L/R/M/O/C distinguish coefficients of the left input, right input, multiplication, output and constant. mod 7 means compare remainders after division by 7.'}</p>
   <p>Q<sub>L</sub>L + Q<sub>R</sub>R + Q<sub>M</sub>LR + Q<sub>O</sub>O + Q<sub>C</sub> = 0 (mod 7)</p>
   <p>{ja?'Qは計算の種類を選ぶ係数です。足し算は(1,1,0,−1,0)、掛け算は(0,0,1,−1,0)。この5つの係数を使うと、同じ式で両方の計算を表せます。':'The Q coefficients select the operation. Addition uses (1,1,0,−1,0); multiplication uses (0,0,1,−1,0). One equation describes both.'}</p>
   <p>{ja?'PLONK（SNARKを作る方式の一つ）では、この表を多項式（数の累乗を足し合わせた式）にし、値を後から変えられないよう先に固定する仕組み（コミットメント）と、評価の証明を組み合わせます。評価とは式へ数を代入して答えを求めることです。評価の証明は、その答えが先に固定した式から得られたと確かめるためのものです。配線も多項式で検証します。このお題ではその前段のゲートと配線を直接検査し、表の値は隠していません。':'PLONK, one design for SNARKs, encodes the table as polynomials (sums of powers), then fixes the values in advance with commitments. Evaluation means substituting a number into an expression to obtain its result. An evaluation proof establishes that the claimed result comes from the expression fixed earlier. Wiring is also checked through polynomials. This worksheet directly checks the underlying gates and wires and does not hide the table.'}</p>
  </details>
 </section>;
}
