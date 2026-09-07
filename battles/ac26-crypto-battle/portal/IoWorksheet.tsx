import {useState} from 'react';
import type {IoTask,IoTable} from '../game/src/io.ts';
import {ioDistribution,ioTables,ioRotations} from '../game/src/io.ts';
export function IoWorksheet({task,locale,busy,wrongCost,onSubmit}:{task:IoTask;locale:'ja'|'en';busy:boolean;wrongCost:number;onSubmit:(answer:string)=>void}){
 const ja=locale==='ja';const [values,setValues]=useState(['','','','']);const tables=ioTables(task);const choices=[ioRotations(task.rotations?.[0]),ioRotations(task.rotations?.[1])];
 const field=(i:number,label:string)=><input aria-label={label} inputMode="numeric" maxLength={1} style={{width:70}} value={values[i]} onChange={e=>setValues(v=>v.map((x,j)=>i===j?e.target.value:x))}/>;
 // The two unfinished table cells stay unfinished in every rotated representation.
 const displayed=(table:IoTable,program:number,r:number)=>ioDistribution(table)[r]!.cells.map((v,i)=>(i-r+4)%4===task.missing[program]?'□':v).join(' ');
 return <section className="tc-input-panel" aria-label="iO definition worksheet">
  <h3>{ja?'識別不可能性難読化（iO）：元の計算を区別できる？':'Indistinguishability obfuscation (iO): can you tell the source?'}</h3>
  <p>{ja?'iOは、同じ大きさで、どの入力にも同じ答えを出すプログラムを変換したとき、変換結果からどちらが元かを効率よく区別できないという条件です。読みづらいコードにすることや暗号化とは別です。':'iO requires transformed programs with the same size and the same result on every input to be indistinguishable by efficient observers. This is different from making code unreadable or encrypting it.'}</p>
  <p>{ja?'ここでは入力を0・1・2・3だけに限定し、同じ3操作の計算AとBを比べます。すべて5で割った余りにします。まず表の□を2個埋めてください。':'Here the entire input set is 0, 1, 2, 3. Compare programs A and B, each with three arithmetic operations, taking remainders by 5. First fill the two missing table cells.'}</p>
  <div style={{display:'flex',gap:16,flexWrap:'wrap',background:'#eef5ff',color:'#16212e',padding:12}}>
   <span>A: x → ×{task.a} → +{task.b} → +0</span>
   <span>B: x → +{task.d} → ×{task.a} → +{task.c}</span>
  </div>
  <p>{ja?'式のa,b,c,dは矢印の計算に使う数です。A(x)=(a×x+b+0)の余り、B(x)=(a×(x+d)+c)の余り。例：a=2,b=1,x=3なら2×3+1=7、5を引いて余り2。Bでa=2,d=1,c=0,x=3なら2×(3+1)+0=8、余り3。':'The letters a,b,c,d name the numbers in the arrow diagrams. Formulas: A(x) is the remainder of a×x+b+0; B(x) is the remainder of a×(x+d)+c. Example: a=2,b=1,x=3 gives 2×3+1=7; subtract 5 to get remainder 2. For B with a=2,d=1,c=0,x=3, compute 2×(3+1)+0=8, remainder 3.'}</p>
  <table><thead><tr><th>x</th><th>A(x)</th><th>B(x)</th></tr></thead><tbody>{[0,1,2,3].map(x=><tr key={x}><th>{x}</th>{tables.map((t,i)=><td key={i}>{x===task.missing[i]?field(i,`iO ${i===0?'A':'B'} missing output`):t[x]}</td>)}</tr>)}</tbody></table>
  <label>{ja?'4行すべて同じ答え？ 同じなら1、違う行があれば0':'Same result on all four inputs? Enter 1 if yes, 0 otherwise'} {field(2,'iO equivalent')}</label>
  <h4>{ja?'答えを変えず、同じ形へ変換する':'Transform the representation while preserving answers'}</h4>
  <p>{ja?'入力0→3の答えを並べた表を真理値表と呼びます。元の式を捨て、この表だけを使います。下に示す候補から同じ確率でrを選び、表を右へr個回します。今回は正しい変換と、元の計算によって乱数の候補を変えてしまう不適切な変換を検査します。公開するのは「rと回した表」の組です。rは秘密鍵ではありません。':'A truth table lists the answers for every input from 0 through 3. Discard the source formula and keep this table. Choose r uniformly from the candidates shown below and rotate the table right by r places. Inspect both sound transformations and flawed candidates whose randomness depends on the source program. Publish both r and the rotated table; r is not a secret key.'}</p>
  <p>{ja?'例：[0,1,2,3]を右へ1個回すと[3,0,1,2]。入力x=2なら、位置(x+r)を4で割った余り＝3のマスを読むと2。位置は0から数えます。一般式：変換後の答え＝回した表[(x+r)の余り]。元と同じ答えを出すことが機能保存です。':'Example: rotating [0,1,2,3] right by 1 gives [3,0,1,2]. For x=2, read position (x+r) remainder 4 = 3 to obtain 2. Positions start at zero. In general evaluate by reading the rotated table at (x+r) remainder 4. Keeping the original answers is functional preservation.'}</p>
  <p>A: r: [{choices[0]!.join(', ')}] / B: r: [{choices[1]!.join(', ')}] — {ja?'各リストから等確率で選びます。':'Choose uniformly within each list.'}</p>
  <table><thead><tr><th>r</th><th>{ja?'Aから公開する表':'Table published from A'}</th><th>{ja?'Bから公開する表':'Table published from B'}</th><th>{ja?'Aの確率':'A probability'}</th><th>{ja?'Bの確率':'B probability'}</th></tr></thead><tbody>{[0,1,2,3].map(r=><tr key={r}><td>{r}</td><td>{displayed(tables[0],0,r)}</td><td>{displayed(tables[1],1,r)}</td>{choices.map((list,i)=><td key={i}>{list!.includes(r)?`1/${list!.length}`:'0'}</td>)}</tr>)}</tbody></table>
  <p>{ja?'□には上で計算した各プログラムの答えを入れて考えます。rも含む公開データ全体を比べ、AとBでどちらも確率が0でない共通の組を数えてください。例：同じ表でAのrが[0,1]、Bが[1,2,3]なら共通はr=1の1組です。r=0を見ればAだと分かるので、同じ機能でも区別できます。':'Use your calculated A and B outputs in the □ cells. Compare complete published data, including r, and count shared outcomes with nonzero probability on both sides. Example: equal tables with A rotations [0,1] and B rotations [1,2,3] share only r=1, so the count is 1. Seeing r=0 identifies A despite equal functions.'}</p>
  <label>{ja?'共通する組の個数（0〜4）':'Number of shared outcomes (0–4)'} {field(3,'iO shared outcomes')}</label>
  <p>{ja?'出る組と各確率がすべて同じなら、変換結果の分布（どの結果がどの確率で出るか）が一致します。その場合は元がAかBかを区別できません。共通する個数だけでは分布の一致は証明できません。機能が違う場合、iOは隠すことを要求しません。':'If the outcomes and their probabilities all match, the distributions—the possible outputs and their probabilities—are identical. Then the result cannot reveal whether A or B was the source. A shared-outcome count alone does not establish identical distributions. iO makes no such promise for different functions.'}</p>
  <p>{ja?`不正解は最大 ${wrongCost} 点減点。期限内なら再提出できます。`:`Incorrect answers cost up to ${wrongCost} points. Retry before the deadline.`}</p>
  <button disabled={busy||!values.slice(0,2).every(v=>/^[0-4]$/.test(v))||!/^[01]$/.test(values[2]!)||!/^[0-4]$/.test(values[3]!)} onClick={()=>onSubmit(values.join(' '))}>{ja?'計算と比較を提出':'Submit calculation and comparison'}</button>
  <details><summary>{ja?'本来の定義と、この模型の限界':'The general definition and this model’s limits'}</summary>
   <p>{ja?'C₀とC₁は同じサイズ・同じ機能のプログラム、Oは変換、Dは変換結果を見て0か1を答える判別手順、Prは確率です。縦棒は差の大きさ。「≈0」は、本来は安全性の設定を大きくすると効率的なDでも差を無視できるほど小さくできることを表します。この模型でも、乱数の選び方が元に依存すると差が0にならない例があります。':'C₀ and C₁ have the same size and function; O transforms them; D examines the transformed result and returns 0 or 1; Pr denotes probability. The bars mean the magnitude of the difference. In real iO, increasing the security parameter makes this difference negligible for efficient D. This model also includes counterexamples where source-dependent randomness makes the difference nonzero.'}</p>
   <p>|Pr[D(O(C₀))=1] − Pr[D(O(C₁))=1]| ≈ 0</p>
   <p>{ja?'この言語のサイズは算術操作3個です。ビットは0か1の値、回路は計算をつないだものです。入力をk個のビットへ増やすと真理値表は2ᵏ行必要になり、一般の回路に対して効率的ではありません。本物のiOの実装ではなく、機能保存と分布の条件を有限の入力で確認する模型です。元の名前A/Bを公開データに付ければ、計算が正しくても区別できてしまいます。':'Size in this toy language means three arithmetic operations. A bit is a value of 0 or 1; a circuit connects calculations. For k input bits the table needs 2ᵏ rows, so this is inefficient for general circuits. This is a finite model of correctness and distribution conditions, not a practical iO implementation. Appending the source label A/B would reveal the source even while preserving every answer.'}</p>
  </details>
 </section>;
}
