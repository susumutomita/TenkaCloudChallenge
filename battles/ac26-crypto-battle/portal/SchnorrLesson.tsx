import { SchnorrModelNotice } from "./SchnorrModelNotice.tsx";
import { useState, type ReactNode } from "react";
import { SCHNORR, power } from "../game/src/schnorr.ts";

/**
 * Fixed seminar example; never reads a player's witness or submits a move.
 * Every number is derived from the same power() the verifier uses, so the
 * worked arithmetic cannot drift from the protocol.
 */
const { p, q, g } = SCHNORR;
const X = 7, R = 3, E = 5;
const Y = power(g, X);
const A = power(g, R);
const Z = (R + E * X) % q;
const YE = power(Y, E);
const GZ = power(g, Z);
/** Without r the response would be e × x alone. */
const Z_NO_R = E * X % q;
/** Simulator: choose e and z first. y^(q−e) is the number that turns y^e back into 1. */
const SIM_E = E, SIM_Z = 9;
const SIM_GZ = power(g, SIM_Z);
const SIM_YE = power(Y, SIM_E);
const SIM_INV = power(Y, q - SIM_E);
const SIM_A = SIM_GZ * SIM_INV % p;
/** Extraction: the same a answered for a second challenge. */
const E2 = 2;
const Z2 = (R + E2 * X) % q;
const DZ = ((Z - Z2) % q + q) % q;
const DE = ((E - E2) % q + q) % q;
const DE_INV = Array.from({ length: q }, (_, i) => i).find((i) => DE * i % q === 1)!;
const EXTRACTED = DZ * DE_INV % q;
const mod = (n: number, m: number) => ((n % m) + m) % m;

export const SCHNORR_LESSON_EXAMPLE = { X, R, E, Y, A, Z, SIM_E, SIM_Z, SIM_A, E2, Z2, EXTRACTED } as const;

export function SchnorrLesson({locale,initialStep=0}:{locale:"ja"|"en";initialStep?:number}) {
  const [step,setStep]=useState(initialStep);const ja=locale==="ja";
  const t=(jaText:ReactNode,enText:ReactNode)=>ja?jaText:enText;
  const equation={fontSize:20,lineHeight:1.8,overflowWrap:"anywhere" as const};
  const box={background:"#ffffff",border:"1px solid #c9d7e8",borderRadius:6,padding:"8px 12px",margin:"8px 0"};
  const table={borderCollapse:"collapse" as const,margin:"8px 0",overflowX:"auto" as const,display:"block"};
  const cell={border:"1px solid #c9d7e8",padding:"2px 8px",textAlign:"center" as const};
  const steps:{title:ReactNode;body:ReactNode}[]=[
    {title:t("誰が、何を知っていて、何を示したい？","Who knows what, and what is being shown?"),body:<>
      <p>{t("登場人物は2人です。","There are two parties.")}</p>
      <ul>
        <li><strong>{t("証明者（あなた）","Prover (you)")}</strong>：{t(`秘密の数 x を知っている。例では x = ${X}。`,`Knows a secret number x. In this example x = ${X}.`)}</li>
        <li><strong>{t("検証者（相手）","Verifier")}</strong>：{t(`x は知らない。知っているのは公開値 y = ${g}ˣ を ${p} で割った余りだけ。例では y = ${Y}。`,`Does not know x. Knows only the public value y, the remainder of ${g}ˣ divided by ${p}. Here y = ${Y}.`)}</li>
      </ul>
      <p>{t("あなたが示したいことは「y を作った x を、自分は本当に知っている」です。","You want to show: “I really know the x that produced y.”")}</p>
      <div style={box}>
        <p><strong>{t("単純な方法 1：x をそのまま送る","Naive idea 1: just send x")}</strong><br/>{t(`検証者は ${g}ˣ mod ${p} を計算して y と比べれば確かめられます。でも x が相手に渡ってしまいます。`,`The verifier can compute ${g}ˣ mod ${p} and compare it with y, but now the verifier has x.`)}</p>
        <p><strong>{t("単純な方法 2：「知っています」と言うだけ","Naive idea 2: just say “I know it”")}</strong><br/>{t("x は漏れませんが、知らない人も同じことを言えるので、何も確かめられません。","Nothing leaks, but anyone can say that, so nothing is checked.")}</p>
      </div>
      <p>{t("ゼロ知識証明は、この2つの間を狙います。","A zero-knowledge proof aims between the two:")}</p>
      <ol>
        <li>{t("x を知っている人は必ず検査に通る（完全性）。","Someone who knows x always passes the check (completeness).")}</li>
        <li>{t("x を知らない人はほとんど通れない（健全性）。","Someone who does not know x almost never passes (soundness).")}</li>
        <li>{t("検査を通しても、検証者は x について y 以上のことを何も知らない（ゼロ知識性）。","Passing the check teaches the verifier nothing about x beyond y (zero knowledge).")}</li>
      </ol>
      <p>{t("このあとの画面で、この3つを1つずつ式で確かめます。","The following pages check each of the three with equations.")}</p>
    </>},
    {title:t("道具：割った余り・累乗・表","Tools: remainders, powers, and the table"),body:<>
      <p>{t(`「a mod m」は a を m で割った余りです。例：${2**5} mod ${p} = ${2**5%p}（${2**5} = ${p} × 1 + ${2**5%p}）。`,`“a mod m” is the remainder of a divided by m. Example: ${2**5} mod ${p} = ${2**5%p} (${2**5} = ${p} × 1 + ${2**5%p}).`)}</p>
      <p>{t("「A ≡ B (mod m)」は「A と B を m で割った余りが等しい」という意味の記号です。例：32 ≡ 9 (mod 23)。","“A ≡ B (mod m)” means A and B have the same remainder when divided by m. Example: 32 ≡ 9 (mod 23).")}</p>
      <p>{t(`「${g}ʳ」は ${g} を r 回掛けた数（累乗）で、r を指数と呼びます。0回掛けたら 1 と決めます。文章の中では g^r のように ^ で書くこともあります。`,`“${g}ʳ” means ${g} multiplied by itself r times (a power); r is the exponent. Multiplying zero times gives 1. Inline text may write it as g^r.`)}</p>
      <p>{t(`途中で何度 ${p} で割った余りに置き換えても、最後の余りは変わりません。だから大きな数を作らず、1回掛けるごとに余りを取れます。`,`Replacing an intermediate result by its remainder mod ${p} never changes the final remainder, so you can take the remainder after every multiplication.`)}</p>
      <table style={table}><caption>{t(`${g} を k 回掛けて ${p} で割った余り`,`${g} multiplied k times, remainder mod ${p}`)}</caption><tbody>
        <tr><th style={cell}>k</th>{Array.from({length:q+2},(_,k)=><td key={k} style={cell}>{k}</td>)}</tr>
        <tr><th style={cell}>{g}<sup>k</sup> mod {p}</th>{Array.from({length:q+2},(_,k)=><td key={k} style={cell}>{power(g,k)}</td>)}</tr>
      </tbody></table>
      <p>{t(`表を見ると ${g}${"¹¹"} mod ${p} = ${power(g,q)}。${q} 回掛けると 1 に戻り、そこから同じ並びを繰り返します。`,`The table shows ${g}¹¹ mod ${p} = ${power(g,q)}: after ${q} multiplications the value returns to 1 and the row repeats.`)}</p>
      <div style={box}>
        <p><strong>{t("この問題で使う3つの決まり","Three rules used throughout")}</strong></p>
        <p style={equation}>① g<sup>m</sup> × g<sup>n</sup> = g<sup>m+n</sup>　② (g<sup>m</sup>)<sup>n</sup> = g<sup>m×n</sup></p>
        <p>{t(`①の例：2³ × 2² = 8 × 4 = 32 = 2⁵。掛けた回数が足し算になります。②の例：(2²)³ = 4 × 4 × 4 = 64 = 2⁶。`,`① example: 2³ × 2² = 8 × 4 = 32 = 2⁵ — the counts add. ② example: (2²)³ = 4 × 4 × 4 = 64 = 2⁶.`)}</p>
        <p>{t(`③ 指数は ${q} で割った余りに置き換えてよい：${q} 回掛けるごとに 1 に戻るからです。例：2¹³ = 2¹¹ × 2² なので、2¹³ mod ${p} = 1 × 4 = ${power(g,13)}。`,`③ Exponents may be reduced mod ${q}, because every ${q} multiplications return to 1. Example: 2¹³ = 2¹¹ × 2², so 2¹³ mod ${p} = 1 × 4 = ${power(g,13)}.`)}</p>
      </div>
      <p>{t(`だからこのお題では、掛け算の結果（y, a）は ${p} で、指数に入る数（r, e, x, z）は ${q} で余りを取ります。`,`That is why group values (y, a) are reduced mod ${p} while exponents (r, e, x, z) are reduced mod ${q}.`)}</p>
    </>},
    {title:t("手順：3回のやりとりを数で追う","The protocol: follow three messages with numbers"),body:<>
      <p>{t(`例：x = ${X}、公開値 y = ${g}${"⁷"} mod ${p} = ${Y}。`,`Example: x = ${X}, public value y = ${g}⁷ mod ${p} = ${Y}.`)}</p>
      <ol style={{display:"grid",gap:8}}>
        <li><strong>{t("約束（コミット）","Commit")}</strong>：{t(`あなたは 0〜${q-1} から乱数 r を1つ選ぶ（例 r = ${R}）。a = ${g}ʳ mod ${p} = ${A} を送る。r は送らない。`,`You pick a random r from 0–${q-1} (here r = ${R}) and send a = ${g}ʳ mod ${p} = ${A}. r is not sent.`)}</li>
        <li><strong>{t("質問（チャレンジ）","Challenge")}</strong>：{t(`a を受け取った後で、検証者が 0〜${q-1} から e を選んで返す（例 e = ${E}）。`,`After receiving a, the verifier picks e from 0–${q-1} and returns it (here e = ${E}).`)}</li>
        <li><strong>{t("応答","Response")}</strong>：{t(`あなたは z = (r + e × x) mod ${q} を送る。`,`You send z = (r + e × x) mod ${q}.`)}<br/><span style={equation}>z = ({R} + {E} × {X}) mod {q} = {R + E*X} mod {q} = {Z}</span></li>
      </ol>
      <p>{t("検証者は受け取った a, e, z と公開値 y だけで次を確かめます。","The verifier checks, using only a, e, z and the public y:")}</p>
      <p style={equation}>g<sup>z</sup> ≡ a × y<sup>e</sup> (mod {p})</p>
      <table style={table}><thead><tr><th style={cell}>{t("左辺","Left")}</th><th style={cell}>{t("右辺","Right")}</th></tr></thead><tbody><tr>
        <td style={cell}>{g}<sup>{Z}</sup> mod {p} = {GZ}</td>
        <td style={cell}>{A} × {Y}<sup>{E}</sup> mod {p} = {A} × {YE} mod {p} = {A*YE%p}</td>
      </tr></tbody></table>
      <p>{t(`${Y}${"⁵"} の計算：${Y}² = ${Y*Y} → ${Y*Y%p}、${Y}⁴ ≡ ${Y*Y%p}² = ${(Y*Y%p)**2} → ${power(Y,4)}、${Y}⁵ ≡ ${power(Y,4)} × ${Y} = ${power(Y,4)*Y} → ${YE}（→ は ${p} で割った余り）。`,`Computing ${Y}⁵: ${Y}² = ${Y*Y} → ${Y*Y%p}, ${Y}⁴ ≡ ${Y*Y%p}² = ${(Y*Y%p)**2} → ${power(Y,4)}, ${Y}⁵ ≡ ${power(Y,4)} × ${Y} = ${power(Y,4)*Y} → ${YE} (→ means remainder mod ${p}).`)}</p>
      <p>{t("順番が大事です。a を先に送って固定し、そのあとで e が決まります。なぜ大事かは「ずるを見分ける」のページで分かります。","Order matters: a is fixed first, and only then is e chosen. The page on catching cheaters shows why.")}</p>
    </>},
    {title:t("なぜ検証式が成り立つ？（完全性）","Why does the check pass? (completeness)"),body:<>
      <p>{t("x を知っている人の z なら、いつでも左右が一致することを、道具の決まり①②③だけで示します。","Using only rules ①②③, we show that the equation always holds when z was computed from the real x.")}</p>
      <p style={equation}>
        g<sup>z</sup> ≡ g<sup>r + e×x</sup>　{t("（③より、指数の余りを戻しても mod 23 の値は同じ）","(rule ③: restoring the exponent preserves its remainder mod 23)")}<br/>
        　= g<sup>r</sup> × g<sup>e×x</sup>　{t("（①）","(rule ①)")}<br/>
        　= g<sup>r</sup> × (g<sup>x</sup>)<sup>e</sup>　{t("（②）","(rule ②)")}<br/>
        　≡ a × y<sup>e</sup> (mod {p})　{t("（a と y は、それぞれ gʳ と gˣ の余り）","(a and y are the remainders of gʳ and gˣ)")}
      </p>
      <p>{t(`数で確認：g^z = 2^${Z}、そして r + e×x = ${R} + ${E}×${X} = ${R+E*X}。2^${R+E*X} = 2^${R} × (2^${X})^${E} ≡ ${A} × ${Y}^${E} (mod ${p})。${R+E*X} を ${q} で割った余りが ${Z} なので、③より 2^${R+E*X} と 2^${Z} は同じ余り ${GZ} になります。`,`Check with numbers: r + e×x = ${R} + ${E}×${X} = ${R+E*X}. 2^${R+E*X} = 2^${R} × (2^${X})^${E} ≡ ${A} × ${Y}^${E} (mod ${p}). Since ${R+E*X} leaves remainder ${Z} mod ${q}, rule ③ gives 2^${R+E*X} and 2^${Z} the same remainder ${GZ}.`)}</p>
      <div style={box}>{t("検証者の式に x と r は出てきません。検証者は a、e、z、y という自分が受け取った（または公開の）数だけで検査できます。ただし「式に x がない」ことだけでは、z から x が漏れないとは言えません。次のページで確かめます。","Neither x nor r appears in the verifier's equation: it uses only a, e, z and y. But “x is not in the equation” does not by itself mean z leaks nothing about x. The next page checks that.")}</div>
    </>},
    {title:t("なぜ r を足すの？（x を隠すしくみ）","Why add r? (how x stays hidden)"),body:<>
      <p><strong>{t("もし r を足さなかったら","What if r were not added?")}</strong></p>
      <p>{t(`z = e × x mod ${q} を送ることになります。例：z = ${E} × ${X} mod ${q} = ${Z_NO_R}。検証者は e = ${E} を知っているので、「${E} × □ を ${q} で割った余りが ${Z_NO_R}」になる □ を 0〜${q-1} で探すと、□ = ${X} だけが当てはまり、x がばれます。`,`You would send z = e × x mod ${q}, e.g. ${E} × ${X} mod ${q} = ${Z_NO_R}. The verifier knows e = ${E}, so trying □ = 0…${q-1} in “${E} × □ has remainder ${Z_NO_R} mod ${q}” finds only □ = ${X}: x leaks.`)}</p>
      <p><strong>{t("r を足すと","With r added")}</strong></p>
      <p>{t(`ここでは公開値 y と約束 a をいったん除き、e = ${E} と z = ${Z} の2つだけを見ます。そこで「もし x が □ だったら、r はいくつだったはずか」を全部の候補で計算してみます（r = (z − e × □) mod ${q}、負なら ${q} を足す）。`,`For this step, set aside public y and commitment a and look only at e = ${E} and z = ${Z}. For every candidate □ for x, compute which r would have produced this z: r = (z − e × □) mod ${q} (add ${q} while negative).`)}</p>
      <table style={table}><tbody>
        <tr><th style={cell}>{t("x の候補 □","candidate x □")}</th>{Array.from({length:q},(_,i)=><td key={i} style={cell}>{i}</td>)}</tr>
        <tr><th style={cell}>{t("そのときの r","matching r")}</th>{Array.from({length:q},(_,i)=><td key={i} style={{...cell,fontWeight:i===X?700:400}}>{mod(Z-E*i,q)}</td>)}</tr>
      </tbody></table>
      <p>{t(`どの候補にも、ちょうど1つの r が対応し、r の値は 0〜${q-1} が1回ずつ出ます（本物は x = ${X}, r = ${R}）。r は0〜${q-1}を同じ確率（1/${q}ずつ）で選んだ乱数なので、この2つの数だけでは候補を絞れません。ただし実際の検証者は y と a も見ます。記録全体は次のページで確かめます。`,`Each candidate has exactly one matching r, and the r values cover 0–${q-1} once each (the real pair is x = ${X}, r = ${R}). Because r was drawn with equal probability 1/${q} for each value, these two numbers alone do not narrow the candidates. The verifier also sees y and a; the next page checks the whole transcript.`)}</p>
      <p>{t(`言いかえると、e を決めたとき z = (r + e × x) mod ${q} は r を ${q} 通りの z にずれなく一対一で移します。r が「どの値も同じ確率」（一様）なら、z も一様になり、x がいくつでも z の出方は同じです。`,`Put differently, for a fixed e, z = (r + e × x) mod ${q} maps the ${q} values of r one-to-one onto the ${q} values of z. If r is uniform (every value equally likely), z is uniform too, and its distribution is the same whatever x is.`)}</p>
      <div style={box}>{t("だから r は毎回新しく選び、送らず、2回使わないことが必須です（理由は「ずるを見分ける」のページ）。","So r must be fresh every time, never sent, and never reused (see the page on catching cheaters).")}</div>
    </>},
    {title:t("ゼロ知識の意味：秘密なしで同じ会話を作れる","What zero knowledge means: the same conversation without the secret"),body:<>
      <p>{t("前のページは z 1つだけを見ました。検証者が手に入れるのは会話の記録 (a, e, z) の3つ組です。ゼロ知識性は次のように決めます。","The previous page looked at z alone. What the verifier actually keeps is the transcript (a, e, z). Zero knowledge is defined like this:")}</p>
      <div style={box}>{t("x を知らない人が y だけから、本物と同じ確率で (a, e, z) を作れるなら、その会話から検証者が x について学べることは何もない。自分ひとりで作れるものを受け取っても、新しい知識は増えないからです。この作り手をシミュレーターと呼びます。","If someone who does not know x can produce (a, e, z) from y alone, with exactly the same probabilities as a real run, then the verifier learns nothing about x from the conversation: receiving something you could have made yourself adds no knowledge. This maker is called a simulator.")}</div>
      <p><strong>{t("シミュレーターの作り方：順番を逆にする","The simulator: reverse the order")}</strong></p>
      <p>{t(`e と z を先に 0〜${q-1} から選び、検証式が合うように a を後から決めます。`,`Pick e and z first from 0–${q-1}, then choose a so the equation holds.`)}</p>
      <p style={equation}>a = g<sup>z</sup> × (y<sup>e</sup> {t("を 1 に戻す数","undone")}) = g<sup>z</sup> × y<sup>{q}−e</sup> mod {p}</p>
      <p>{t(`「y^e を 1 に戻す数」は、y^e に掛けて ${p} で割った余りが 1 になる数で、逆元と呼びます。y は ${q} 回掛けると 1 に戻るので、y^e × y^(${q}−e) = y^${q} ≡ 1。つまり y をあと ${q}−e 回掛けた数が逆元です。`,`“The number that undoes y^e” is the one whose product with y^e has remainder 1 mod ${p}; it is called the inverse. Since y returns to 1 after ${q} multiplications, y^e × y^(${q}−e) = y^${q} ≡ 1, so y multiplied ${q}−e more times is the inverse.`)}</p>
      <p>{t(`例：公開値 y = ${Y} は固定。e = ${SIM_E}、z = ${SIM_Z} を先に選ぶ。`,`Example: keep public y = ${Y} fixed; pick e = ${SIM_E} and z = ${SIM_Z} first.`)}</p>
      <ol>
        <li>{g}<sup>{SIM_Z}</sup> mod {p} = {SIM_GZ}</li>
        <li>{Y}<sup>{SIM_E}</sup> mod {p} = {SIM_YE}{t("、逆元は ","; its inverse is ")}{Y}<sup>{q-SIM_E}</sup> mod {p} = {SIM_INV}{t(`（確認：${SIM_YE} × ${SIM_INV} = ${SIM_YE*SIM_INV} = ${p} × ${Math.floor(SIM_YE*SIM_INV/p)} + 1）`,` (check: ${SIM_YE} × ${SIM_INV} = ${SIM_YE*SIM_INV} = ${p} × ${Math.floor(SIM_YE*SIM_INV/p)} + 1)`)}</li>
        <li>a = {SIM_GZ} × {SIM_INV} mod {p} = {SIM_A}</li>
        <li>{t("検査：","Check: ")}{g}<sup>{SIM_Z}</sup> mod {p} = {SIM_GZ}、a × y<sup>e</sup> mod {p} = ({SIM_A} × {SIM_YE}) mod {p} = {SIM_A*SIM_YE%p}　{t("一致","match")}</li>
      </ol>
      <p><strong>{t("本物と同じ確率になる理由（数えてみる）","Why the probabilities match (count them)")}</strong></p>
      <ul>
        <li>{t(`検証式を満たす (a, e, z) は、e と z を決めると a がちょうど1つに決まるので、全部で ${q} × ${q} = ${q*q} 通り。`,`For each (e, z) exactly one a satisfies the check, so there are ${q} × ${q} = ${q*q} valid transcripts.`)}</li>
        <li>{t(`本物：r と e がそれぞれ ${q} 通り均等。前のページより r と z は一対一なので、${q*q} 通りの (a, e, z) が 1/${q*q} ずつ出る。`,`Real run: r and e are each uniform over ${q} values; since r ↔ z is one-to-one, each of the ${q*q} transcripts appears with probability 1/${q*q}.`)}</li>
        <li>{t(`シミュレーター：e と z がそれぞれ ${q} 通り均等なので、同じ ${q*q} 通りが 1/${q*q} ずつ出る。`,`Simulator: e and z are each uniform, so the same ${q*q} transcripts each appear with probability 1/${q*q}.`)}</li>
      </ul>
      <p>{t("出てくる記録の種類も確率も同じなので、記録だけを見て本物かシミュレーターかは見分けられません。これがゼロ知識です。","Same set, same probabilities: no one can tell a real transcript from a simulated one. That is zero knowledge.")}</p>
      <div style={box}>{t("シミュレーターは e を見てから a を決める「順番のずる」をしています。本物の会話では a を先に固定するので、このずるはできません。だからシミュレーターが作れても、証明が誰でも通るわけではありません。","The simulator cheats on order: it picks a after seeing e. In a real run a is fixed first, so this trick is unavailable — being simulatable does not make the proof passable by anyone.")}</div>
    </>},
    {title:t("ずるを見分ける（健全性）","Catching cheaters (soundness)"),body:<>
      <p>{t("x を使わずに通る作戦を1つ考えます。a を送る前に e を予想し、その e でシミュレーターを使います。実際の e は a の後に均等に選ばれるので、この予想が当たる確率は 1/11 です。この模型では表から x を探す近道もあり、攻撃全体の成功率が 1/11 以下だという保証ではありません。","Consider one strategy without x: guess e before sending a and use the simulator for that guess. The real e is uniform and arrives after a, so the guess succeeds with probability 1/11. In this tiny model an attacker can also look x up; 1/11 is not a bound on all attacks.")}</p>
      <p><strong>{t("違う質問にも答えられるなら？","What if two different challenges can be answered?")}</strong></p>
      <p>{t("同じ a に対して、2つの違う e に正しく答えられる人がいたとします。","Suppose someone can answer the same a correctly for two different challenges:")}</p>
      <p style={equation}>z = r + e × x,　z′ = r + e′ × x　(mod {q})</p>
      <p>{t("上から下を引くと r が消えます。","Subtracting removes r:")}</p>
      <p style={equation}>z − z′ = (e − e′) × x　→　x = (z − z′) × (e − e′){t("の逆元","⁻¹")} (mod {q})</p>
      <p>{t(`ここでの逆元は「掛けて ${q} で割った余りが 1 になる数」です。`,`Here the inverse is the number whose product has remainder 1 mod ${q}.`)}</p>
      <p>{t(`例：同じ r = ${R} で (e, z) = (${E}, ${Z}) と (${E2}, ${Z2}) に答えた。z − z′ = ${Z} − ${Z2} → ${DZ}（負なので ${q} を足した）、e − e′ = ${DE}。${DE} × ${DE_INV} = ${DE*DE_INV} = ${q} + 1 なので ${DE} の逆元は ${DE_INV}。x = ${DZ} × ${DE_INV} mod ${q} = ${EXTRACTED}。`,`Example: with the same r = ${R}, answers (e, z) = (${E}, ${Z}) and (${E2}, ${Z2}). z − z′ = ${Z} − ${Z2} → ${DZ} (add ${q} since negative), e − e′ = ${DE}. ${DE} × ${DE_INV} = ${DE*DE_INV} = ${q} + 1, so the inverse of ${DE} is ${DE_INV}. x = ${DZ} × ${DE_INV} mod ${q} = ${EXTRACTED}.`)}</p>
      <p>{t("つまり「2つ以上の e に答えられる」なら、その人の答えから x を計算できる＝その人は x を知っているのと同じです。これを特別健全性と呼びます。秘密を計算しにくい実用の設定では、秘密を知る証拠としてこの性質を使います。","So anyone able to answer two or more challenges effectively knows x, because x can be computed from their answers. This is special soundness. In practical groups where computing the secret is hard, this property supports a proof of knowledge.")}</p>
      <div style={box}>
        <p>{t("大事な結果が2つあります。","Two important consequences:")}</p>
        <ul>
          <li>{t("r を使い回すと、上の計算で誰でも x を取り出せます。r は毎回新しく選びます。","Reusing r lets anyone extract x with the calculation above. Always draw a fresh r.")}</li>
          <li>{t("毎回1つの e を予想する作戦では、独立に k 回繰り返すと、全部当て続ける確率は (1/11)ᵏ に下がります。ただし次のページのとおり、この模型の小さな数では別の近道があります。","For the strategy of guessing one e each time, k independent rounds give probability (1/11)ᵏ of guessing every challenge. But see the next page: in this tiny model there is a shortcut.")}</li>
        </ul>
      </div>
    </>},
    {title:t("この模型の限界と、実際に使うとき","Limits of this model, and real use"),body:<>
      <p>{t("決められた手順どおりに e を均等に選ぶ検証者を「正直な検証者」と呼びます。前のページまでのゼロ知識は、この相手に対するもので HVZK（Honest-Verifier Zero Knowledge）と呼びます。a を見てから e をわざと選ぶ検証者まで考えるには、さらに工夫が要ります。","A verifier that follows the protocol and draws e uniformly is called an honest verifier. The zero knowledge shown so far holds against such a verifier and is called HVZK (Honest-Verifier Zero Knowledge). Handling a verifier who chooses e after looking at a needs more work.")}</p>
      <p>{t("公開値 y 以上を漏らさない性質（ゼロ知識性）と、秘密を知らずに通ることが難しい性質（健全性）は別物です。","Revealing nothing beyond y (zero knowledge) and making it hard to pass without the secret (soundness) are different properties.")}</p>
      <div style={box}>{t(`この模型では秘密の候補が最大11通りしかなく、道具のページの表で y から x を探せます。だから、x を知らなかった人も表で x を見つけてから正しく答えられ、健全性の安全はありません。同じ小さな数で何回繰り返しても、この候補の少なさは解消しません。Verify成功は秘密の復元ではなく、HUNTの得点にはしません。`,`With at most 11 possible secrets, the table on the tools page finds x from y. Anyone can look x up and then answer correctly, so this model provides no soundness security. Repeating rounds over the same tiny group does not fix that small search space. Verification does not recover the secret or award HUNT points.`)}</div>
      <p><strong>{t("実際に使う大きさ","Real-world sizes")}</strong></p>
      <p>{t("実用では、検証された大きな数の組を使います。整数の掛け算を使う方式と、楕円曲線の点の足し算を使う方式では、必要な大きさが違います。23や11を単に256ビットの数へ変えれば安全になる、という意味ではありません。", "Practical systems use validated large groups. Finite-field multiplication and elliptic-curve point addition require different parameter sizes. Simply replacing 23 and 11 with 256-bit numbers does not make this model secure.")}</p>
      <p>{t("Schnorr署名では、質問 e を、約束 a・公開鍵・署名する文章などからハッシュ関数で計算します。ハッシュ関数は入力から決まった長さの値を作る計算です。安全な仕様は入力の区別や乱数の作り方も定めており、この教材の式だけをそのまま署名に使うことはできません。", "Schnorr signatures derive e from the commitment, public key and message using a hash function, which maps inputs to fixed-length values. Secure specifications also define input separation and nonce generation; this lesson alone is not a signature implementation.")}</p>
      <p>{t("仕様を読む：", "Specifications: ")}<a href="https://www.rfc-editor.org/rfc/rfc8235.html">RFC 8235</a> · <a href="https://bips.dev/340/">BIP 340</a></p>
    </>},
  ];
  const last=steps.length-1;
  return <section aria-label="Schnorr lesson" style={{background:"#f4f8fd",color:"#172d46",padding:16,borderRadius:8}}>
    <SchnorrModelNotice locale={locale}/>
    <h4>{step+1}/{steps.length} · {steps[step]!.title}</h4>
    <p style={{fontSize:14}}>{t(`この解説の例：g = ${g}（繰り返し掛ける数）、p = ${p}（掛け算の結果の余りを取る数）、q = ${q}（指数の余りを取る数）。`,`Example parameters: g = ${g} (the repeated base), p = ${p} (modulus for products), q = ${q} (modulus for exponents).`)}</p>
    {steps[step]!.body}
    <nav style={{display:"flex",gap:12,flexWrap:"wrap"}}>
      <button type="button" disabled={step===0} onClick={()=>setStep(step-1)}>{t("前へ","Previous")}</button>
      <button type="button" disabled={step===last} onClick={()=>setStep(step+1)}>{t("次へ","Next")}</button>
    </nav>
  </section>;
}
