import {SplitAnamorphicWorksheet} from './SplitAnamorphicWorksheet.tsx';
import {useState} from 'react';
import {anamorphicPower,type AnamorphicTask} from '../game/src/anamorphic.ts';
export function AnamorphicWorksheet({task,locale,busy,wrongCost,onSubmit}:{task:AnamorphicTask;locale:'ja'|'en';busy:boolean;wrongCost:number;onSubmit:(answer:string)=>void}){
 const ja=locale==='ja',[values,setValues]=useState(['','','']);
 const field=(i:number,label:string)=><label>{label}<input aria-label={label} maxLength={1} inputMode="numeric" value={values[i]} onChange={e=>setValues(values.map((v,j)=>i===j?e.target.value:v))}/></label>;
 if(task.exercise)return <SplitAnamorphicWorksheet task={task} locale={locale} busy={busy} wrongCost={wrongCost} onSubmit={onSubmit}/>;
 return <section className="tc-input-panel">
 <h3>{ja?'アナモルフィック暗号：通常の通信で隠れたビットを送る':'Anamorphic encryption: a hidden bit inside ordinary communication'}</h3>
 <p>{ja?'通常の復号鍵を監視者に渡しても、追加の秘密を持つ相手には別のメッセージを送る考え方です。ビットは0か1。あなたは送信者と秘密の受信者を体験します。':'The idea is to send another message to a receiver with additional secret information even when a monitor holds the ordinary decryption key. A bit is 0 or 1. You act as the sender and the private receiver.'}</p>
 <div style={{display:'flex',gap:16,flexWrap:'wrap',padding:12,background:'#eef5ff',color:'#16212e'}}>
 <span>{ja?'送信者：候補を選ぶ':'Sender: selects a candidate'} → (a,b)</span>
 <span>{ja?`監視者：通常鍵 x=${task.ordinaryKey} → 通常の数`:`Monitor: ordinary key x=${task.ordinaryKey} → ordinary message`}</span>
 <span>{ja?'受信者：秘密の判定表 → 隠れたビット':'Receiver: secret lookup → hidden bit'}</span>
 </div>
 <h4>{ja?'1. 送る候補を選ぶ':'1. Select a candidate to send'}</h4>
 <p>{ja?`同じ通常メッセージを異なる乱数で暗号化した候補です。秘密の判定表は送信者と受信者だけが共有します。上から試し、判定が送りたいビット ${task.targetBit} になる最初の番号を入力します。合わなければ次を試す方法が「選び直し」です。表は今回の候補だけを示します。`:`These candidates encrypt the same ordinary message with different randomness. Only sender and receiver share the lookup. Scan from the top and enter the first trial whose secret bit equals the intended bit ${task.targetBit}. Trying again on a mismatch is rejection sampling. This lookup covers only this packet’s candidates.`}</p>
 <table><thead><tr><th>{ja?'試行番号':'Trial'}</th><th>(a,b)</th><th>{ja?'秘密の判定ビット':'Secret lookup bit'}</th></tr></thead><tbody>{task.candidates.map((c,i)=><tr key={i}><td>{i+1}</td><td>({c.join(', ')})</td><td>{task.secretBits[i]}</td></tr>)}</tbody></table>
 {field(0,ja?'送る試行番号（1〜6）':'Trial to send (1–6)')}
 <h4>{ja?'2. 監視者の通常復号を計算':'2. Calculate the monitor’s ordinary decryption'}</h4>
 <p>{ja?'選んだ行のaをx回掛けて7で割った余りをsとします。s×mを7で割った余りがbになるmを探します。mが通常メッセージです。例：a=2,x=2ならs=4。b=5なら4×3=12の余り5なのでm=3。':'From your chosen row, multiply a by itself x times and take the remainder by 7 to obtain s. Find m such that s×m has remainder b. That m is the ordinary message. Example: a=2,x=2 gives s=4; if b=5, then4×3=12 has remainder5, so m=3.'}</p>
 <table><thead><tr><th>a</th><th>{ja?`aを${task.ordinaryKey}回掛けた余りs`:`s = a to power ${task.ordinaryKey}, remainder7`}</th></tr></thead><tbody>{[1,2,3,4,5,6].map(a=><tr key={a}><td>{a}</td><td>{anamorphicPower(a,task.ordinaryKey)}</td></tr>)}</tbody></table>
 {field(1,ja?'通常のメッセージm（1〜6）':'Ordinary message m (1–6)')}
 <h4>{ja?'3. 応用：乱数くじに偏りがあったら？':'3. Transfer: what if the random draw is biased?'}</h4>
 <p>{ja?'今度は試行番号を書いたくじを、下の枚数ずつ袋に入れます。毎回1枚を等確率で引き、袋に戻します。目的のビットと違えば引き直します。枚数が多い番号ほど出やすくなります。':'Now put the indicated number of tickets for each trial into a bag. Draw a ticket uniformly, replace it, and retry when its bit does not match the target. A trial with more tickets is more likely.'}</p>
 <table><thead><tr><th>{ja?'試行番号':'Trial'}</th><th>{ja?'くじの枚数':'Tickets'}</th></tr></thead><tbody>{task.tickets.map((n,i)=><tr key={i}><td>{i+1}</td><td>{n}</td></tr>)}</tbody></table>
 <p>{ja?`選び直した後の確率＝その番号の枚数 ÷ 受理される番号の枚数の合計。秘密ビットが${task.targetBit}の行だけを上の表で見つけ、そのくじの枚数を足します。求めるのは分母の合計です。例：受理される2行が1枚と3枚なら、合計4枚。前者が出る確率は1/4、後者は3/4です。`:`After retries, probability = that trial's tickets / total tickets for accepted trials. Find only rows with secret bit ${task.targetBit} above and sum their ticket counts. Enter this denominator. Example: accepted rows with1 and3 tickets have total4; their probabilities are1/4 and3/4.`}</p>
 {field(2,ja?'受理されるくじの合計（3〜9）':'Total accepted tickets (3–9)')}
 <p>{ja?`不正解は最大 ${wrongCost} 点減点。期限内なら再提出できます。`:`Incorrect answers cost up to ${wrongCost} points. Retry before the deadline.`}</p>
 <button type="button" className="tc-submit-small" disabled={busy||!values.slice(0,2).every(v=>/^[1-6]$/.test(v))||!/^[3-9]$/.test(values[2]!)} onClick={()=>onSubmit(values.join(' '))}>{ja?'選択・復号・確率を提出':'Submit selection, decryption and probability'}</button>
 <details><summary>{ja?'なぜ普通の暗号文に見える？ 数学と限界':'Why does it resemble ordinary encryption? Mathematics and limits'}</summary>
 <p>{ja?'原論文5.1節では、暗号文cを秘密鍵Kの判定関数Fへ入れ、F(K,c)が送りたいビットになるまで通常の暗号化を繰り返します。受信者もF(K,c)を計算します。Fは鍵なしではランダムな判定と区別しにくい関数で、ここでは小さな秘密の表に置き換えています。':'Section5.1 of the paper repeatedly performs ordinary encryption until the secret function F(K,c) on ciphertext c matches the hidden bit. The receiver also computes F(K,c). Without K, F must resemble a random function. Here a small secret lookup replaces it.'}</p>
 <p>{ja?'6候補のうち3個を1にする秘密の表は20通り。特定の候補を1にする表は10通り。その表で受理した3候補を等確率で選ぶと、平均の確率は(10/20)×(1/3)=1/6で通常の等確率と一致します。これは1回の有限実験です。表が公開されれば、出ない候補から通信を見分けられます。':'There are20 balanced lookups assigning1 to three of six candidates. Ten assign1 to a particular candidate. Uniform selection among three accepted candidates gives average probability(10/20)×(1/3)=1/6, matching an ordinary uniform trial. This is a finite single-packet experiment. If the lookup is public, excluded outcomes distinguish the communication.'}</p>
 <p>{ja?'応用の意味：ある候補だけ2枚、残り5候補は1枚のくじなら、通常はその候補が2/7で出ます。しかし、その候補を受理する秘密表は10/20、受理くじは2+1+1=4枚なので、平均の送信確率は(10/20)×(2/4)=1/4です。2/7と一致しません。この模型では、乱数くじを変えると「普通の暗号文と同じ分布」という先ほどの計算が壊れます。':'Transfer: give one candidate2 tickets and the other five1 each. Its ordinary probability is2/7. But10/20 secret tables accept it, each with2+1+1=4 accepted tickets, so its average sending probability is(10/20)×(2/4)=1/4, different from2/7. Changing randomness breaks this toy model’s earlier distribution calculation.'}</p>
 <p>{ja?'ElGamalは公開鍵で暗号化し、秘密鍵で復号する方式の一つです。この教材はその形の計算を素数7で行います。PRF（擬似ランダム関数）は、鍵を知らない人にはランダムな関数と区別しにくい関数です。秘密の表はその代わりに使う模型です。実用の安全性を持つ暗号・判定関数ではなく、複数通信を観測する攻撃への安全性も証明しません。実際は毎回独立した乱数で試します。画面は一連の試行を省略して並べた練習です。秘密データを余分に付け足す二重暗号化ではありません。':'ElGamal is a public-key encryption scheme: a public key encrypts and a private key decrypts. This exercise uses its arithmetic shape modulo7. A PRF (pseudorandom function) is hard to distinguish from a random function without its key; the secret lookup is a toy substitute. Neither gives practical encryption or PRF security, and no multi-packet security is claimed. Real trials use independent randomness each time; the displayed list is a compressed practice sequence. No extra encrypted payload is appended.'}</p>
 </details></section>;
}
