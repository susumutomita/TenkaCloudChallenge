import {useState} from 'react';
import {anamorphicPower,type AnamorphicTask} from '../game/src/anamorphic.ts';
export function AnamorphicWorksheet({task,locale,busy,wrongCost,onSubmit}:{task:AnamorphicTask;locale:'ja'|'en';busy:boolean;wrongCost:number;onSubmit:(answer:string)=>void}){
 const ja=locale==='ja',[values,setValues]=useState(['','','']);
 const field=(i:number,label:string)=><label>{label}<input aria-label={label} maxLength={1} inputMode="numeric" value={values[i]} onChange={e=>setValues(values.map((v,j)=>i===j?e.target.value:v))}/></label>;
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
 <h4>{ja?'3. 別の受信パケットを秘密の表で読む':'3. Decode a separate incoming packet using the secret lookup'}</h4>
 <p>{ja?`受信した組は (${task.candidates[task.receivedIndex]!.join(', ')})。上の表で同じ組を探し、秘密の判定ビットを入力します。通常鍵xだけではこの表は得られません。`:`The received pair is (${task.candidates[task.receivedIndex]!.join(', ')}). Find that pair in the lookup and enter its secret bit. The ordinary key x does not supply this table.`}</p>
 {field(2,ja?'受信した隠れたビット（0/1）':'Received hidden bit (0/1)')}
 <p>{ja?`不正解は最大 ${wrongCost} 点減点。期限内なら再提出できます。`:`Incorrect answers cost up to ${wrongCost} points. Retry before the deadline.`}</p>
 <button disabled={busy||!values.slice(0,2).every(v=>/^[1-6]$/.test(v))||!/^[01]$/.test(values[2]!)} onClick={()=>onSubmit(values.join(' '))}>{ja?'選択と復号を提出':'Submit selection and decryption'}</button>
 <details><summary>{ja?'なぜ普通の暗号文に見える？ 数学と限界':'Why does it resemble ordinary encryption? Mathematics and limits'}</summary>
 <p>{ja?'原論文5.1節では、暗号文cを秘密鍵Kの判定関数Fへ入れ、F(K,c)が送りたいビットになるまで通常の暗号化を繰り返します。受信者もF(K,c)を計算します。Fは鍵なしではランダムな判定と区別しにくい関数で、ここでは小さな秘密の表に置き換えています。':'Section5.1 of the paper repeatedly performs ordinary encryption until the secret function F(K,c) on ciphertext c matches the hidden bit. The receiver also computes F(K,c). Without K, F must resemble a random function. Here a small secret lookup replaces it.'}</p>
 <p>{ja?'6候補のうち3個を1にする秘密の表は20通り。特定の候補を1にする表は10通り。その表で受理した3候補を等確率で選ぶと、平均の確率は(10/20)×(1/3)=1/6で通常の等確率と一致します。これは1回の有限実験です。表が公開されれば、出ない候補から通信を見分けられます。':'There are20 balanced lookups assigning1 to three of six candidates. Ten assign1 to a particular candidate. Uniform selection among three accepted candidates gives average probability(10/20)×(1/3)=1/6, matching an ordinary uniform trial. This is a finite single-packet experiment. If the lookup is public, excluded outcomes distinguish the communication.'}</p>
 <p>{ja?'この教材は素数7のElGamal型の計算と秘密の表を使います。実用の安全性を持つ暗号・判定関数ではなく、複数通信を観測する攻撃への安全性も証明しません。実際は毎回独立した乱数で試します。画面は一連の試行を省略して並べた練習です。秘密データを余分に付け足す二重暗号化ではありません。':'This exercise uses ElGamal-style arithmetic modulo7 and a secret lookup. Neither gives practical encryption or PRF security, and no multi-packet security is claimed. Real trials use independent randomness each time; the displayed list is a compressed practice sequence. No extra encrypted payload is appended.'}</p>
 </details></section>;
}
