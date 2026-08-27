# 誰も持っていない 2 つの値を、1 round だけ話して掛ける

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 620 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `assignment-companion` · **想定時間:** 60〜90 分 ·
**配点:** 300 · **必須前提:** `ac26-w6-cosnark-linear`、`ac26-w2-beaver-mul` · **Status:** draft

## ストーリー

前の問題で作った co-SNARK prover の線形部分は、通信を 1 round も必要としませんでした。そこで出て
きた 2 つの sharing は、この問題では組み立て済みで渡されます。

```text
A = Σ_j a_j w_j        B = Σ_j b_j w_j        C = A × B        (mod p)
```

`[A]` と `[B]` は分散されたままです。和の積は積の和ではないので、局所演算をどう並べても `[C]` は
出ません。代価は通信 1 round で、それを 1 round に抑えるのが Beaver の trick です。

```text
[d] = [A] - [x]        [e] = [B] - [y]        どちらも local
d, e を open                                   1 round、2 値
[C] = [z] + d[y] + e[x] + de
```

コストは消えたのではなく、preprocessing へ移動しました。triple を作るのが高価で input に依存しない
部分で、online phase は独立な乗算がいくつ並んでいても 1 round です。全部が同じ round に相乗りする
からです。

## 支給されるものと、新しいところ

Week 2 の Beaver 乗算 (`ac26-w2-beaver-mul`) と前問の線形 layer は両方とも支給されます。どちらも
再実装しません。新しいのは、その 2 つが出会うことです。同じ trick が 1 つ上の layer に載ると、単体
protocol の性質ではなく co-SNARK の privacy になります。

runtime には 3 つ増えます。

```text
runtime.reserve_triple(triple)   triple を検めて消費する。2 度目は例外
runtime.open(round_id, sharing)  1 つの共有値を全員に開く。ここで唯一通信するもの
runtime.openings()               開示の記録: {"roundId", "shareIds", "maskedBy"}
runtime.consumed_triples()       これまでに消費した triple id
```

round は開示した値の数ではなく **distinct な `roundId`** です。だから「2 値を 1 round で」が主張では
なく測定になります。

`reconstruct` は相変わらずありません。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが表示される。
2. **証拠を調べる**で、この deploy 固有の fixture と公開された証拠を読む。
3. Portal のエディタで starter のソースを編集する。
4. **公開テストを実行**を押し、直接回答欄があれば証拠から埋める。
5. 各 checkpoint をそのまま提出する。Portal が現在のファイルと回答を準備して送る。

checkout、ターミナル、ローカルエディタ、別画面、コピペは不要です。code checkpoint は現在の
エディタ内容を使います。直接回答は現在の deploy seed へ結び付くため、別 deploy からコピーした
値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `plan` | 30 | triple 数・開示数・round 数・message 数を layer の幅の関数として出す |
| `triple` | 35 | triple を relation に照らして検め、一度だけ消費し、台帳を主張でなく読む |
| `masks` | 40 | 代入から `[d]` と `[e]` を出す。局所で、mask を祖先に持つ |
| `open` | 45 | 2 値を 1 round で。round 数は記憶でなく runtime から |
| `product` | 45 | `[C]` が `A × B` に復元し、公開定数 `de` を 1 party だけが畳む |
| `artifact` | 30 | 3 つの sharing と metadata だけ。平文も transcript も入れない |
| `audit` | 50 | 公開された値がすべて予約済み mask 下にあることを、開示記録から測る |
| `transfer` | 25 | 未知の体・party 数・witness 長で全部成立させる |

hint は 8 つ中 7 つにあります (各 12〜20)。全部開いても 300 点中 190 点が残ります。

## 正しい C は、見た目ほど何も保証しない

この問題は 31 個の壊れた実装を同梱していて、そのうち **24 個は全 shape で `C` を `A × B` に正しく
復元します**。`make reference-test` が毎回この数を測ります。

そのうち 1 つがこの問題の本題です。`[A]` と `[B]` をそのまま open すれば平文の `A` と `B` が手に
入ります。掛けて、答えを share し直す。出てくる `C` は全 seed・全 shape で完璧に正しく、round は
1 のまま、triple もちゃんと 1 つ消費されます。実測すると、これを落とす checkpoint は `audit`
**1 つだけ**です。

これは採点の抜け穴ではありません。`prove_product` の契約は「`C` が正しく、schedule が 1 round」で、
その実装は契約を完全に満たしています。満たしていないのは「公開された値が mask されたものだけだった」
ことで、それが載っているのは開示記録のほうです。

## audit が証明できることと、できないこと

証明できるのは、この runtime 上で公開された値がどれも予約済み triple mask の下にあり、refused read
が無く、triple が台帳の通りに消費されたことです。

証明**できない**のは「`A` や `B` を誰も見なかった」ことです。各 party の scope を開いて自分の share
を読むのは合法で、全 party 分やれば `A` が手に入ります。`Share._value` に至っては属性 1 つ分の距離
です。runtime は sandbox ではなく instrument で、記録しているのは「その計算が何を公開したか」であって
「書いた人が何を見たか」ではありません。

## mask が uniform なのは、ちょうど 1 回

「`d` と `e` を開いても `A` と `B` は漏れない」という主張は、`d = A - x` の `x` が uniform で、かつ
**1 度しか使われない**ことに全部乗っています。同じ `x` で 2 つの値を隠せば、その差が公開されます。
それ以外は何も壊れません。`C` は正しく出ます。だから「triple の再利用は性能の話」という誤解は生き
延びます。`reserve_triple` は 2 度目を docstring での注意ではなく例外にします。

## dealer が検算できて、本物の protocol ができないこと

`reserve_triple` は `z == x * y` を確認してから triple を渡します。**本物の protocol はこれができ
ません。** party は share しか持たず、積を確認することは 3 つとも再構成することで、それは mask を
破壊します。本物の preprocessing は triple をもう 1 つ潰して 1 つを検査する (sacrificing) か、
malicious-secure な protocol で triple を生成します。ここでは trusted dealer が自分の仕事を検算して
いるだけです。

## 次につながるところ

次の問題は同じ step を取り上げて、「ほかに何を開いたか」を訊きます。この問題が測るのは 2 つの開示が
mask されていたかどうかで、privacy の問題が訊くのはそれが**本当に 2 つだけ**だったか、1 つ多く開いた
prover が実際には何を公開したのか、です。

## 対象外

実際の proof encoding / verification、複数の乗算 layer の scheduling 最適化、malicious-secure triple、
network transport。

## これは安全ではない

体は列挙できる小さい素数、party は 2〜5、敵対者は semi-honest ですらなく単に不在で、triple は trusted
dealer が配ります。機構の toy です。

## 出典との対応

Week 6 の教材は上流で公開されているので、`courseAlignment` は `curriculum.md` が記録している commit
の `week6/README.md` と `week6/problems/co-snark-prove/README.md` を pin します。公式演習の template・
係数・fixture・解答は転載していません。relation も runtime も triple dealer も instrumentation も独自
に書いたもので、公式演習が支給する primitive はこの問題が土台にするものであって、この問題が採点する
コードではありません。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。Docker デーモンと compose stack の全 container を
管理する人に対しては、hidden material の閲覧を防げません。ここでの境界は誤配の防止であって、
その人に対する秘匿ではありません。あなたが build して動かす Workbench container が載せるのは
starter、public test、orientation printer、そして供給される共有レイヤ
（`participant/mpc.py` — share、triple、計装された runtime、`linear_halves`。これは前の 2 問の
答えであり、意図的に渡されています）だけです。seed 由来の導出、hidden test、reference、verifier は
載りません。それらは、Workbench が compose network ごしに参照する公開しない 2 つ目の container と、
`make reference-test` が build する作問者専用 image にだけ存在します。

そのため `make test`、`make test-one`、`make inspect` は先に verifier を起動します
（`make verifier-up` が自動で走ります）。`make inspect` はこのデプロイの setting・row・witness を、
ローカルで導出せずに compose network ごしに読みます。停止は `make verifier-down` です。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。
提出コードには時間・memory・process・output の上限をかけ、両 container は non-root、read-only、
privilege 無しで動き、公開されるのは Workbench の loopback だけです。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した提出 31 種類と verifier を狙った 1 種類が
あります。31 種類のうち何個が依然として `C` を `A × B` に復元するかを毎回印字します。この README が
引用しているのはその数で、後の変更で checkpoint が安くなればその数が動き、主張のほうを直します。
