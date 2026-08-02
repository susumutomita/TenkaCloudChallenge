# 証明は valid だった。 ただし、 別の口座についての証明だった

zkVM が証明するのは 「そのプログラムが走った」 ことだけである。 **どの**プログラムか、 **どの**入力についてか、 **何を**主張しているのかは、 guest が bytes で言い切るしかない。 その contract — public statement・private witness・public journal — を書く。

Week 6 の 5 問目、 そして `ac26-w6-zkvm-exploit-predicate` の続きである。 前問は **exact exploit predicate** を決めた。 この問題はその predicate を、 zkVM guest として成立する **public / private input contract** に仕上げる。

暗号の側は最初から scope 外である。 proof は 1 つも生成しない。 やるのは、 proof system が**何も証明してくれない 2 つの半分**を自分で塞ぐことだけである。

```text
public statement   その proof が何についての主張なのか
public journal     その run が公開したもの。 永久に、 全員に
```

暗号が保証するのは 「ある program の ある run に対応する journal である」 ことだけで、 **どの** program か、 **どの** 入力か、 **どの** claim かは何ひとつ言っていない。 それを言うのは guest の仕事で、 言い方を間違えれば完全に valid な proof が別物の証拠になる。

## 前問から移動した 2 つ

口座 (`price` / `spent` / `budget`) は target spec に焼き込まれた定数ではなく **public input** になった。 同じ compiled guest が世界中の口座について主張を出せるので、 「どの口座の話か」 を決めるのは bind された statement だけである。

整数意味論も public input になった。 `semantics` profile は幅**と**桁溢れ時の挙動を名指し、 同じ image が profile 違いで別の machine になる。

```text
wrapping     2 ** width で法をとる — exploit が存在する唯一の machine
saturating   最大値で頭打ちになる
checked      trap して run が止まる
```

exploit が存在するのは 3 つのうち 1 つだけである。 どれで走ったかを言わない journal は、 読み手が勝手に想定した machine についての proof である。

## この問題の中心にある 1 組

fixtures は毎 seed、 **本物の口座 2 つ**を引く。 どちらにも本物の exploit がある。 長さ prefix の無い encoder に通すと、 2 つは同じ bytes になる — `"53" + "7"` と `"5" + "37"` は同じ 3 文字だからである。

これは malformed な statement がすり抜ける話ではない。 **片方についての valid な proof が、 もう片方についての valid な proof になる**という話で、 その間ずっと暗号は 1 ミリも壊れていない。 canonical serialization を 「書式の作法」 だと思っている guest が落ちるのはここである。

## 採点の設計

この問題は 55 個の壊れた guest を同梱していて、 そのうち **42 個は 「happy path が verify し、 別 program に差し出した receipt を拒否する」 という誰でも書く 2 問に正しく答える**。 `make reference-test` が毎回この数を測り直す。 その 2 つは問題文にそのまま書いてあるので誰も発見する必要がない。 残りが checkpoint になっているのはそのためである。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- public statement と private witness を明示的な型として分離できる
- canonical serialization の必要性を、 実際に衝突する 2 つの statement で示せる
- field 順・長さ prefix・整数幅・endianness・domain 分離を固定した serializer を書ける
- target identity を source path 文字列ではなく実行される bytes へ bind できる
- witness を public argument / 環境変数 / log へ出さずに guest へ渡せる
- host が供給した結果を信じず、 guest 内で target execution を再計算できる
- statement が名指していない image を、 1 step も走らせる前に拒否できる
- wrapping / saturating / checked を statement が名指す profile として扱える
- statement digest・target digest・claim result・guest version を 1 つの journal へ commit できる
- public measurement の条件を 「読み手がすでに計算できること」 として言える
- receipt が別 target / 別 claim / 別 semantics / 別 protocol version へ replay されるのを拒否できる
- journal の便宜 field を証拠として読まず、 commitment と照合できる
- witness が journal・stdout・stderr・error・trace・一時ファイルへ漏れていないか監査できる
- 承認された名前が承認されていない値を運んでいる開示を検出できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `encoding` | 同じ statement は同じ bytes、 違う statement は違う bytes | 45 |
| `identity` | どのプログラムの話かを、 走る bytes で名指す | 30 |
| `ingestion` | witness を通す扉は 1 つだけ | 35 |
| `reexec` | host の言い分は入力であって答えではない | 45 |
| `journal` | 公開してよいのは、 読者がすでに計算できるものだけ | 35 |
| `replay` | その receipt は、 その statement の証拠か | 50 |
| `privacy` | 承認された名前は、 承認ではない | 35 |
| `transfer` | 見たことのない target・claim・protocol version で | 25 |

## 解説

## 暗号が証明しないもの

zkVM の proof が言うのは 「ある program の ある run があって、 この journal を出した」 までです。 **どの** program か、 **どの** 入力についてか、 **何を** 主張しているのかは、 guest が bytes で言い切るしかありません。 この問題の 8 checkpoint はすべてその 「言い切り」 の話で、 暗号の話は 1 つもありません。

## 中心にあるのは 1 組の口座です

fixtures は毎 seed、 本物の口座を 2 つ引きます。 どちらにも本物の exploit があります。 長さ prefix の無い encoder に通すと 2 つは同じ bytes になります。

```text
left   price=53 spent=7  budget=272   ->  "53" "7"  "272"
right  price=5  spent=37 budget=272   ->  "5"  "37" "272"
```

連結すると両方 `537272` です。 だから `left` について sealed された receipt が `right` に対して verify します。 **誰も触っていない口座が予算超過している証拠**が、 何も forge せずに手に入るということです。

`naive_encode` は藁人形ではありません。 field 順は固定、 全 field 在り、 何も落ちていません。 それでも encoding ではないのは、 field の境界が出力の中に無いからです。 長さ prefix はそこにあります。

そして分けなければならないのは、 この 1 組だけではありません。 `domain` だけが違う 2 つ、 `guestVersion` だけが違う 2 つも別の statement です。 この 2 つは 「計算に影響しないから」 という理由で真っ先に落とされます。

## digest は 「走る bytes」 についてです

image record には toolchain が書いた label が 2 つ (`sourcePath` / `imageId`) と、 実際に走る `body` があります。 4 つの兄弟のうち 2 つは base と同じ program で、 2 つは違います。

```text
rebuilt     同じ source path、 比較演算子が 1 つ違う、 stamp も新しい  -> 別の program
restamped   step は同じ、 build stamp だけ違う                        -> 別の image
renamed     同じ bytes、 別の path                                    -> 同じ program
relabelled  同じ bytes、 別の imageId                                 -> 同じ program
```

`sourcePath` を digest する guest は `rebuilt` を base だと言います。 その 2 つは 「合計がちょうど budget に着地する注文」 について答えが違い、 それは攻撃者が選ぶ注文そのものです。 `imageId` を digest する guest は `relabelled` を別物だと言い、 何の問題も無い proof が誰にも理由の分からない形で拒否されます。

`restamped` だけが判断です。 proving system が実際にそうしているのと同じに倒します — **観測可能な変化が無いことは、 監査の対象であって入力ではない**ので、 再ビルドは別の image です。

## host の言い分は入力であって答えではありません

`env.hints()` には host 自身の 「この run はこうなったはずだ」 が入っています。 採点で渡される hint は自信満々で、 詳細で、 全部間違っています。 host は証明される側の当事者です。 hint を採る guest は速くて、 ほとんどの場合正しくて、 何も証明していません。

同じ理屈で、 statement が名指していない image を渡されたら**1 step も走らせる前に**拒否します。 走らせてから 「どの program だったか」 を報告した run は、 文脈を外して引用できる run です。

## journal に入れてよい測定値の条件

1 つだけあります。 **読み手がすでに計算できるもの**であることです。 「小さいから」 でも 「ただの数字だから」 でもありません。

witness とともに変わる cycle 数は測定値ではなく、 解像度を落とした witness です。 そして journal は run より長生きします — debug の都合で足して release で外す、 という扱いができる唯一できない場所です。

## journal の field は、 読むものではなく照合するものです

journal には statement の digest のほかに `imageDigest` と `guestVersion` が入っています。 これは statement を持っていない読み手のための便宜で、 **証拠ではありません**。 書いておくのは無料で、 信じるのは高くつきます。

採点では、 誰も replay していない receipt の journal 側だけを後から書き換えたものが渡されます。 digest は合っていて、 journal は statement と違うことを言っています。 **verifier が読む journal field は、 攻撃者が書く journal field です。**

そして `claimResult` が `False` の receipt は、 何も証明していない run についての正しい journal です。 それを claim の証拠として受理するのが、 いちばん静かな入口です。

## 承認された名前は承認ではありません

privacy audit の policy は 2 段です。 1 段目は `PUBLIC_NAMES` — 出してよい名前の一覧です。 2 段目は、 **承認された名前が承認された値を運んでいるか**です。

`spent` は公開してよい名前です。 しかし machine 自身の total が `spent` という名前を着て出てくるのは別の開示で、 price は公開かつ可逆なので、 それは 1 回の modular inverse を残しただけの quantity です。 名前しか見ない scan はここで何も見つけません。

10 個の run のうち 2 個は何も漏らしていません。 そのうち 1 個は**うるさい** — 全 channel を数字で埋めます。 その 2 つに leak を報告するのは、 残り 8 つを見逃すのと同じだけ間違いです。 **つねに何かを見つける監査は、 読んでいるのではありません。**

## 実測

この問題は 55 個の壊れた guest を同梱していて、 そのうち **42 個は 「happy path が verify し、 別 program に差し出した receipt を拒否する」 に正しく答えます**。 `make reference-test` が毎回測り直します。 その 2 つは問題文にそのまま書いてあるカテゴリで、 誰も発見する必要がありません。

## 監査が証明できることと、 できないこと

証明できるのは、 同梱された 55 個の欠陥をこの 8 checkpoint が捕まえること、 そして reference が全部を通ることです。 証明できないのは 「この contract に他の穴が無い」 ことです。

## toy と production の差

幅は 7〜13 bit、 口座は 1 つ、 program は 4 step、 receipt には seal がありません。 seal の検証は**まさに暗号がすでにやってくれる部分**なので scope 外で、 seal が無ければ意味を持たない binding のほうが scope 内です。 本物の zkVM では statement は program の ELF digest と public input の列で、 journal は proving system が commit する出力です。 主張しているのは 「binding は exact な contract として書ける」 ことであって、 「書いたものが完全である」 ことではありません。

## 対象外

実際の zkVM proof 生成と receipt verification、 production の binary reproducibility system、 特定 zkVM の zero-knowledge 性、 remote attestation。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
