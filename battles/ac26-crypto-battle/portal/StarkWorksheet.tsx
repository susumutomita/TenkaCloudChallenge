import {useState} from 'react';
import {starkPolynomials,type StarkTask} from '../game/src/stark.ts';
export function StarkWorksheet({task,locale,busy,wrongCost,onSubmit}:{task:StarkTask;locale:'ja'|'en';busy:boolean;wrongCost:number;onSubmit:(answer:string)=>void}){
 const ja=locale==='ja',p=starkPolynomials(task),[values,setValues]=useState(['','','','']);
 const input=(i:number,label:string)=><label>{label}<input aria-label={label} inputMode="numeric" value={values[i]} onChange={e=>setValues(values.map((v,j)=>j===i?e.target.value:v))}/></label>;
 return <section className="tc-input-panel">
 <h3>{ja?'STARK：実行の記録と折り畳みを検査':'STARK: check an execution trace and a fold'}</h3>
 <p>{ja?'STARKは、計算が正しいことを小さな検査で確かめる証明方式です。あなたは検査役。ここでは「前の数を2乗する」計算の記録を調べます。全て7で割った余り（0〜6）にしてください。':'STARK is a proof system for checking computations through small checks. You are the inspector. Check a record of repeatedly squaring the previous value. Use remainders after division by 7, from 0 to 6.'}</p>
 <h4>{ja?'1. 実行表のずれを2個計算':'1. Calculate two execution mismatches'}</h4>
 <p>{ja?'実行表（トレース）は途中の数を順番に並べた記録です。次の数−前の数²が0なら、その一歩は一致します。例：2→4なら4−2²=0。2→5なら5−2²=1で不一致です。':'A trace records intermediate values in order. Next minus previous squared is zero when a step agrees. Example: 2→4 gives 4−2²=0; 2→5 gives 5−2²=1, a mismatch.'}</p>
 <div>{task.trace[0]} → {task.trace[1]} → {task.trace[2]}</div>
 {input(0,`${task.trace[1]} − ${task.trace[0]}² = □`)}{input(1,`${task.trace[2]} − ${task.trace[1]}² = □`)}
 <h4>{ja?'2. ずれを式へつなぐ':'2. Connect the mismatches to an equation'}</h4>
 <p>{ja?'多項式はXの整数乗を足した式です。Tは3個の記録をX=1,2,4で読み出せる式。Cは次の数と2乗との差を表す制約式です。この作り方をAIR（計算の規則を式にする表現）と呼びます。':'A polynomial sums whole-number powers of X. T returns the three recorded values at X=1,2,4. C expresses the difference between the next value and the square. AIR means expressing computation rules as algebraic constraints.'}</p>
 <p>T(X) = {p.trace[0]} + {p.trace[1]}X + {p.trace[2]}X²<br/>C(X) = T(2X) − T(X)²</p>
 <p>{ja?'Z=(X−1)(X−2)でCを割ります。商をQ、余りの式をRとするとC=ZQ+R。整数の割り算と同じ形です。検査する2か所でずれがなければRも0です。最後から最初への遷移は検査しません。':'Divide C by Z=(X−1)(X−2). Q is the quotient and R the remainder polynomial: C=ZQ+R, like integer division. If both checked transitions agree, R is zero. The last row is not required to wrap to the first.'}</p>
 <p>{ja?'上の2個の答えをu,vとするとR(X)=(2u−v)+(v−u)X。X=1でu、X=2でvになります。例：u=1,v=3なら定数2−3=−1、7を足して6。':'Call your two answers u and v. R(X)=(2u−v)+(v−u)X, giving u at X=1 and v at X=2. Example: u=1,v=3 gives constant 2−3=−1; add 7 to obtain 6.'}</p>
 {input(2,ja?'Rの定数：2×最初の答え−2番目の答え = □':'Constant of R: 2×first answer−second answer = □')}
 <h4>{ja?'3. 商を1回折り畳む':'3. Fold the quotient once'}</h4>
 <p>Q(X) = {p.quotient[0]} + {p.quotient[1]}X + {p.quotient[2]}X²</p>
 <p>{ja?'商の式は計算済みです。Q=q₀+q₁X+q₂X²で、q₀は定数、q₁はXに掛ける数、q₂はX²に掛ける数です。この3つを係数と呼びます。偶数乗の部分と奇数乗の部分に分け、Y=X²と置きます。検査側が指定する数βを奇数側に掛けて足すと、最高の乗数（次数）が2から1に下がります。これはFRIという低次数検査の1回の折り畳みです。':'The quotient expression is supplied. In Q=q₀+q₁X+q₂X², q₀ is the constant, q₁ multiplies X, and q₂ multiplies X². These three numbers are called coefficients. Split even and odd powers and write Y=X². Multiply the odd part by the verifier’s number β and add it to the even part. The highest power (degree) drops from two to one. This is one fold from the low-degree test FRI.'}</p>
 <p>{ja?'一般式：Q=q₀+q₁X+q₂X² → F(Y)=(q₀+βq₁)+q₂Y。qは上の係数です。例：Q=2+3X+4X²、β=2ならF=1+4Y（2+2×3=8の余り1）。':'Writing q for the coefficients: Q=q₀+q₁X+q₂X² → F(Y)=(q₀+βq₁)+q₂Y. Example: Q=2+3X+4X² and β=2 gives F=1+4Y because 2+2×3=8 has remainder 1.'}</p>
 {input(3,`β=${task.beta}：${p.quotient[0]} + ${task.beta}×${p.quotient[1]} = □`)}
 <p>{ja?`不正解は最大 ${wrongCost} 点減点。期限内なら再提出できます。`:`Incorrect answers cost up to ${wrongCost} points. Retry before the deadline.`}</p>
 <button disabled={busy||!values.every(v=>/^[0-6]$/.test(v))} onClick={()=>onSubmit(values.join(' '))}>{ja?'4個の計算を提出':'Submit four calculations'}</button>
 <p>{ja?'折り畳めてもRが0とは限りません。実行の正しさと折り畳みの正しさは別の検査です。':'A successful fold does not imply R is zero. Execution correctness and fold correctness are separate checks.'}</p>
 <details><summary>{ja?'本物のSTARKでさらに必要なこと':'What a full STARK additionally needs'}</summary><p>{ja?'本物では、ハッシュ（データを短い固定長の値に変える関数）で一覧を木の形にまとめるマークル木を使います。その要約を先に公開する約束をコミットメントと呼び、質問前に値を固定します。次にランダムな場所の値と確認用データを開き、何度も折り畳んで低次数を検査します。秘密を見せず正しさを示す性質をゼロ知識性と呼び、追加の乱数が必要です。この模型は全記録と式を表示し、割り切れる条件と1回の折り畳みを手計算します。コミットメント・ランダム質問・ゼロ知識化を実装したSTARKではありません。':'A hash maps data to a short fixed-length value. A Merkle tree combines these values in a tree; publishing its summary before questions is a commitment that binds the values. It opens randomly requested values with the neighboring summaries needed to check their path to the published summary and repeatedly folds to test low degree. Zero knowledge means showing correctness without revealing secrets; it additionally requires randomness. This model displays the full trace and equations and practices divisibility and one fold. It does not implement commitments, random queries or zero-knowledge masking.'}</p></details>
 </section>;
}
