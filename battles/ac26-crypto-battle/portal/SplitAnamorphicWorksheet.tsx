import {useState} from 'react';
import {anamorphicPower,type AnamorphicTask} from '../game/src/anamorphic.ts';
export function SplitAnamorphicWorksheet({task,locale,busy,wrongCost,onSubmit}:{task:AnamorphicTask;locale:'ja'|'en';busy:boolean;wrongCost:number;onSubmit:(answer:string)=>void}) {
 const [answer,setAnswer]=useState('');const ja=locale==='ja',mode=task.exercise!;
 const title=ja?{encrypt:'暗号化：送りたいビットに合う暗号文を選ぶ',decrypt:'復号：暗号文から元の数を求める',probability:'確率：受理されるくじを数える'}[mode]:{encrypt:'Encrypt: select a ciphertext for your bit',decrypt:'Decrypt: recover the original number',probability:'Probability: count accepted tickets'}[mode];
 const label=ja?{encrypt:'送る候補の番号（1〜6）',decrypt:'元の数 m（1〜6）',probability:'受理されるくじの合計（3〜9）'}[mode]:{encrypt:'Candidate number (1–6)',decrypt:'Original number m (1–6)',probability:'Accepted ticket total (3–9)'}[mode];
 const [a,b]=task.candidates[0]!;
 return <section className="tc-input-panel">
  <h3>{title}</h3><p>{ja?'アナモルフィック暗号の一桁模型です。このお題は数字1個を提出すれば完了・得点です。':'A small anamorphic-encryption model. Submit one number to complete and score this Order.'}</p>
  {mode==='encrypt'&&<>
   <p>{ja?'通常のメッセージを暗号化した候補から、追加の秘密の表で送りたいビット（0か1）になるものを選びます。暗号文の計算は済んでいます。':'These ciphertext candidates already encrypt an ordinary message. Use the additional secret lookup to select one encoding your intended bit (0 or 1).'}</p>
   <div className="tc-schnorr-progress">{ja?'送りたいビット':'Intended bit'} {task.targetBit} → {ja?'秘密の表で上から探す':'scan the secret lookup'} → {ja?'最初に一致する候補番号を提出':'submit the first matching candidate number'}</div>
   <table><thead><tr><th>{ja?'候補番号':'Candidate'}</th><th>{ja?'暗号文 (a,b)':'Ciphertext (a,b)'}</th><th>{ja?'秘密の表のビット':'Secret lookup bit'}</th></tr></thead><tbody>{task.candidates.map((c,i)=><tr key={i}><td>{i+1}</td><td>({c.join(', ')})</td><td>{task.secretBits[i]}</td></tr>)}</tbody></table>
   <p>{ja?'例：送りたいビットが1、表が0, 1, 1なら、最初に一致する2番を送ります。復号は別のお題です。':'Example: for bit1 and lookup0,1,1, send candidate2, the first match. Decryption is a separate Order.'}</p>
  </>}
  {mode==='decrypt'&&<>
   <div className="tc-schnorr-progress">{ja?'与えられた暗号文':'Given ciphertext'} ({a}, {b}) → {ja?'通常鍵':'Ordinary key'} x={task.ordinaryKey} → {ja?'元の数':'Original'} m=□</div>
   <p>{ja?'aをx回掛け、7で割った余りをsとします。s×mを7で割った余りがbになるmを1〜6から探します。暗号化の計算は不要です。':'Multiply a by itself x times and take the remainder by7 to obtain s. Find m from1 to6 so that s×m leaves remainder b. No encryption calculation is required.'}</p>
   <p>s = {a}<sup>{task.ordinaryKey}</sup> mod 7<br/>({anamorphicPower(a,task.ordinaryKey)} × m) mod 7 = {b}</p>
   <p>{ja?'mod 7は「7で割った余り」です。例：s=4、b=5なら、4×3=12の余りが5なのでm=3。答えは3です。':'mod7 means remainder after division by7. Example: s=4,b=5; 4×3=12 leaves5, so submit m=3.'}</p>
  </>}
  {mode==='probability'&&<>
   <p>{ja?`秘密の表が${task.targetBit}になる行だけを選び、くじの枚数を足します。暗号化・復号の計算は不要です。`:`Select rows whose secret lookup equals${task.targetBit}, then add their ticket counts. No encryption or decryption is required.`}</p>
   <table><thead><tr><th>{ja?'候補番号':'Candidate'}</th><th>{ja?'秘密のビット':'Secret bit'}</th><th>{ja?'くじの枚数':'Tickets'}</th></tr></thead><tbody>{task.tickets.map((n,i)=><tr key={i}><td>{i+1}</td><td>{task.secretBits[i]}</td><td>{n}</td></tr>)}</tbody></table>
   <p>{ja?'受理後の確率＝その候補の枚数 ÷ 受理される枚数の合計。今回は分母だけを求めます。例：受理される枚数が1、2、3なら合計6枚。':'After rejection sampling, probability = this candidate’s tickets / total accepted tickets. Submit only the denominator. Example: accepted counts1,2,3 total6.'}</p>
  </>}
  <label>{label}<input aria-label={label} inputMode="numeric" maxLength={1} value={answer} onChange={e=>setAnswer(e.target.value)}/></label>
  <p>{ja?`不正解は最大${wrongCost}点減点。期限内なら再提出できます。`:`Incorrect answers cost up to${wrongCost} points. Retry before the deadline.`}</p>
  <button className="tc-submit-small" disabled={busy||!(mode==='probability'?/^[3-9]$/:/^[1-6]$/).test(answer)} onClick={()=>onSubmit(answer)}>{ja?'この答えを提出して完了':'Submit this answer to complete'}</button>
  <p>{ja?'秘密の表は送信者と受信者が共有する追加情報です。通常鍵だけではこの表を読めません。この小さい表と数は手計算用で、実用の安全性はありません。':'The lookup is additional secret information shared by sender and receiver. The ordinary key does not supply it. These tiny numbers and lookup are for hand calculation, without practical security.'}</p>
 </section>;
}
