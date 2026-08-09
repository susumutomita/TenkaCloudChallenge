# 証明は valid だった。ただし、別の口座についての証明だった

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 650 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `assignment-companion` · **想定時間:** 60〜90 分 ·
**配点:** 300 · **必須前提:** `ac26-w6-zkvm-exploit-predicate` · **Status:** draft

## ストーリー

zkVM の proof が言うのは「あるプログラムのある run があって、この journal を出した」までです。
言うのはそれだけです。

**どの**プログラムかは言いません。**どの**入力についてかも言いません。**何を**主張しているのかも
言いません。それを言うのは guest の仕事で、bytes で、ちょうど 1 つの意味になるように言い切る
必要があります。言い方を間違えれば、完全に valid な proof が誰も意図していないものの証拠に
なります。

なのでここでは何も証明しません。回路も zkVM も Rust も出てきません。作るのは proof のまわりの
contract です。

```text
public statement   何が主張されているのか、何についてなのか
private witness    prover が知っていたもの
public journal     その run が公開するもの。永久に、全員に
```

`ac26-w6-zkvm-exploit-predicate` は「何を exploit と認めるか」を決めました。この問題は、proof
system が次に訊く質問を扱います。valid な proof が**ちょうど 1 つの statement の証拠であって
他の何の証拠でもない**ためには、guest の入出力について何が成り立っていなければならないか。

## 移動した 2 つ

**口座が public input になりました。** `price` / `spent` / `budget` は target spec に焼き込まれた
定数ではなく statement に載って旅をします。同じ compiled guest が世界中の口座について主張を
出せるので、「どの口座の話か」を決めるのは bind された statement だけです。

**整数意味論も public input になりました。** `semantics` profile は幅**と**桁溢れ時の挙動を
名指します。

```text
wrapping     2 ** width で法をとる — この exploit が必要とする machine
saturating   machine が保持できる最大値で頭打ちになる
checked      machine が trap して run が止まる
```

claim に witness が存在するのは 3 つのうち 1 つだけです。どれで走ったかを言わない journal は、
読み手が勝手に想定した machine についての proof です。

## この問題の中心にある 1 組

fixtures は毎 seed、**本物の口座を 2 つ**引きます。どちらも誰かが本当に主張しうる口座で、
どちらにも本物の exploit があります。長さ prefix の無い encoder に通すと、2 つは同じ bytes に
なります。

```text
left   price=53 spent=7  budget=272   ->  "53" "7"  "272"   ->  537272
right  price=5  spent=37 budget=272   ->  "5"  "37" "272"   ->  537272
```

つまり `left` について sealed された receipt が `right` に対して verify します。出てくるのは
**誰も触っていない口座が予算超過している証拠**で、それを手に入れるために何も forge していません。

これは malformed な statement が validator をすり抜ける話ではありません。**本物についての valid
な proof が、別の本物についての valid な proof になる**話で、その間ずっと暗号は 1 ミリも
壊れていません。

`naive_encode` も藁人形ではありません。field 順は固定、全 field 在り、何も落ちていません。
それでも encoding ではないのは、field の境界が出力の中に無いからです。長さ prefix はそのために
あります。

そして分けなければならないのはこの 1 組だけではありません。`domain` だけが違う 2 つ、
`guestVersion` だけが違う 2 つも別の statement です。この 2 つは「計算に影響しないから」という
理由で真っ先に落とされます。

## digest は「走る bytes」についてです

image record には実際に実行される `body` と、toolchain がその隣に書いた label が 2 つあります。
base image の兄弟が 4 つ渡され、それぞれ 1 か所だけ違います。

```text
rebuilt     同じ source path、比較演算子が 1 つ違う、stamp も新しい  -> 別の program
restamped   step は同じ、build stamp だけ違う                        -> 別の image
renamed     同じ bytes、別の path                                    -> 同じ program
relabelled  同じ bytes、別の imageId                                 -> 同じ program
```

`sourcePath` を digest する guest は再ビルドを base image だと言います。その 2 つは「合計が
ちょうど budget に着地する注文」について答えが違い、それは攻撃者が選ぶ注文そのものです。
`imageId` を digest する guest は同じ bytes の複製を別の program だと言い、何の問題も無い proof
が誰にも理由の分からない形で拒否されます。

`restamped` だけが恣意的に見えます。proving system が実際にそうしているのと同じに倒します
——**観測可能な変化が無いことは、監査の対象であって入力ではない**ので、再ビルドは別の image です。

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

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点です。

| Checkpoint | 配点 | 何を見るか |
|---|---:|---|
| `encoding` | 45 | 長さ prefix・固定幅・固定順で、family のどの 2 つも別の bytes になるか |
| `identity` | 30 | 走る bytes に対する digest か、隣の label に対する digest か |
| `ingestion` | 35 | statement 全部が public、witness 全部が private、transcript に何も残らないか |
| `reexec` | 45 | hint でなく再計算、名指されていない image に fail-closed、桁溢れ挙動 3 つ |
| `journal` | 35 | statement 全体への commitment と、読者がすでに計算できる測定値 1 つ |
| `replay` | 50 | 1 field ずれた statement へ差し出された receipt と、sealed 後に書き換えられた journal |
| `privacy` | 35 | 6 つの channel と、承認された名前が運ぶ承認されていない値 |
| `transfer` | 25 | 見たことのない口座・claim・protocol version で全部 |

8 つのうち 7 つにヒント (14〜24 点)。全部開いても 300 点中 174 点が残ります。

## happy path は簡単なほうの半分です

この問題は 55 個の壊れた guest を同梱していて、そのうち **42 個は happy path で verify する
receipt を作り、別 program に差し出された receipt をちゃんと拒否します**——guest contract の
テストを書く人が最初に訊く 2 問です。`make reference-test` が毎回この数を測り直します。

その 2 つは上の問題文にそのまま書いてあるので誰も発見する必要がなく、その 2 問しか訊かない
テストスイートは 42 個の間違った contract に同意します。書いていないほう——本物の口座 2 つが
encoding を共有しうること、host の言い分が自信満々で間違っていること、verifier が読む journal
field は攻撃者が書く field であること、承認された名前は承認された値ではないこと——が、テスト
1 つではなく checkpoint がある理由です。

## host の言い分は入力であって答えではありません

`env.hints()` には host 自身の「この run はこうなったはずだ」が入っています。採点で作られる run
では、その全 field が間違っています。host は証明される側の当事者なので、その答えは guest の
仕事への入力であって代わりにはなりません。hint を採る guest は速くて、ほとんどの場合正しくて、
何も証明していません。

同じ理屈で、statement が名指していない image は**1 step も走らせる前に**拒否します。走らせてから
「どの program だったか」を報告した run は、文脈を外して引用できる run です。

## 生き残らせるのではなく落とした mutation が 1 つあります

`run_guest` が、計算した digest ではなく `statement["imageDigest"]` を報告するようにする改変は
**検出不能**です。2 つが違えば走らせる前に拒否するので、報告に到達する入力ではつねに等しく、
2 つの書き方を分離する入力が存在しません。実測でも 8 phase すべてを通過します。

区別が実在するのは 1 段上——2 つを等しくしているのは拒否そのもので、**その**拒否を壊す mutation
は即死します。検出不能なほうは書いたうえで survivor として出荷せず削除しました。説明のつく
`SURVIVED` 行は、「`SURVIVED` 行は説明がつけば無視してよい」を教えてしまうからです。

## この suite が証明できることと、できないこと

証明できるのは、この 8 checkpoint が同梱の 55 個の欠陥を捕まえること、reference が 8 つすべてを
通ること、出荷される starter が 1 つも通らないことです。証明できないのは「この contract に他の
穴が無い」ことで、誰も書き下さなかった欠陥は誰も測っていません。

## この先

Week 6 はここで終わりです。Week 7 の capstone は、actor と資産と信頼を名指して primitive を
1 つも名指さない brief から始まります。持ち越すのはこの問題が叩き込む習慣です——proof は bind
された statement ちょうど 1 つの証拠であり、その文を真にするものはすべて自分で書き下すものです。

## 対象外

実際の zkVM proof 生成と receipt verification、production の binary reproducibility system、
特定 zkVM の zero-knowledge 性、remote attestation。

## これは安全ではありません

幅は 7〜13 bit、口座は 1 つ、program は 4 step、receipt に seal はありません。seal の検証は
**まさに暗号がすでにやってくれる部分**なので対象外で、だからこそ seal が無ければ意味を持たない
binding のほうが対象内です。本物の zkVM では statement は program の ELF digest と public input
の列で、journal は proving system が commit する出力です。

## 出典との対応

Week 6 の資料は公開済みなので、`courseAlignment` は `week6/README.md` と
`week6/problems/zkvm-exploit/README.md` を commit `a3aa4b56fa88fbe803b57d320fbc87c1a203b480`
で pin しています。公式課題からの転載はありません。statement の形、image format、opcode 集合、
fixtures、disclosure、解答はすべて独自に書いており、公式課題は Rust、こちらは Python です。
主題——proof が 1 つのものについての証拠になるために guest が何を公開すべきか——は講座が名指す
ものであり、講座自身の README に書かれているので、あの課題の近道にはなりません。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image も
あなたの管理下にあるので、image の中身はあなたに対して秘匿されていません。
`reference/` と `tests/hidden/` を bind-mount しないのは、あなたの git checkout に
紛れ込ませないためであって、手が届かなくするためではありません。hidden checker が持つ
replay の判定や disclosure の答えも同じです。それを import した contract は何も bind して
いませんが、そうしないと決められるのはあなただけです。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。幅・口座・protocol namespace・guest build はこのデプロイの
seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロ。クラウドアカウントも AWS リソースも要りません。

## 作者向け

`make reference-test` が image の中で mutation suite を走らせます。55 個の壊れた guest と、
verifier 自身を狙った 1 個です。まず reference が 8 つの hidden phase すべてを通ることを確認し、
そのあと reference を 55 通りに壊して、そのうち何個が簡単な 2 問に正しく答えるかを表示します。
その数がこの README の引用元です——後の編集で checkpoint が安くなればその数が動き、主張のほうも
動かさなければなりません。
