# 部品はどれも正しい。 つないだものが正しくない

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。
> コースおよびその運営とは無関係で、 推奨も受けていません。 ここにある問題文・コード・
> fixtures・図はすべて独立に書かれています。 このトラックへの質問はコース運営ではなく
> TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 660 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `synthesis` · **想定時間:** 90〜120 分 · **Points:** 300 ·
**前提:** `ac26-w6-zkvm-witness-binding`, `ac26-w6-cosnark-privacy` · **Status:** draft

## 話

Week 6 のこれまでの 5 問は、 それぞれ **動く部品** を 1 つ作りました。 secret share の上の
prover、 何を証明したかを言い切る guest、 入力を一度も見ない評価。 この問題はそのあいだの
配線を扱います。 出発点は 1 行です。

```text
primitive が検証できるのは、 渡されたものの「形」だけである
```

これは primitive の欠陥ではありません。 primitive とはそういうものです。 MPC engine は届いた
ものが share であることを検証します。 それが secret のはずだったか、 相手が同じ field だと
思っているか、 復元してよいと open policy が言ったかは知りようがありません。 zkVM は guest が
走ったことを検証し、 その journal が読み手の持っている program についてのものかは検証しません。
FHE の評価は渡された鍵の下で正しく、 その鍵が間違っていたことは教えられません。

だから部品の test は全部通り、 architecture は壊れています。 それが **composition failure** で、
この問題はそれを 9 通りの角度から見ます。

## 暗号は 1 行も走りません

share も proof も ciphertext も出てきません。 走るのは typed graph です。

```text
node  1 つの計算と、 それがどこで走るか
edge  1 つの値が次の計算へ渡るところと、 その瞬間それが何であるか
```

edge は同時に 5 つのものであり、 それが framing された dialect を持ちます。

```text
representation  plaintext, secret-share, ciphertext, commitment, proof, journal
classification  public か secret か
algebra         どの field / modulus にいるか (該当する場合)
keyDomain       どの鍵の下にいるか (該当する場合)
identity        どの program / statement についてのものか (該当する場合)
serialization   どの framing で符号化されたか
```

architecture の絵は、 どの box がどの box と話すかを示します。 それは問いではありません。
問いは、 その値が flight 中に**何であるか**です。

## 3 段の contract

```text
LICENCE      その transformation が何を変えてよいか。 key-switch は keyDomain を変えてよい。
             carry は何も変えてよくない
policy       その node がその transformation を持つことをこの architecture が承認したか。
             secret を開いてよい operation であることと、 それを実行してよい node であることは
             別の事実です
obligations  この architecture が「どの wire に何を届ける」と約束したか
```

3 つのうち 2 つは、 残り 1 つでは見えない失敗のために存在します。

**licensed な変更が correct な変更とは限りません。** key switch は key domain を変えてよく、
それは**何に変えるべきかを間違えない**こととは別です。 FHE service は途中で 2 回鍵を切り替え
ます。 bootstrap は bootstrap に使った鍵の下に ciphertext を残し、 その次の switch が結果を
家に連れて帰ります。 どちらも licensed です。 client の鍵に着地しなければならないのは片方だけ
で、 licence 表はどちらかについて何も言いません。

**規則を破った box を承認し直せば、 contract は 1 手で満たされます。** それは repair では
ありません。 deployment に合わせて要求を下げたということで、 deployment が自分で合格基準を
書いたのと同じです。 policy が独立した段であり、 repair checkpoint の探索空間の外にあるのは
そのためです。

## 13 の deployment

毎 seed、 3 つの健全な architecture — MPC-backed prover、 zkVM proof of exploit、 FHE 評価
サービス — と、 そのどれかから**ちょうど 1 箇所だけ**変えた 13 の deployment が引かれます。

11 個は 11 の boundary class をちょうど 1 つずつ踏みます。 12 個目は licensed な operation を、
承認されていない node に置きます。 13 個目は **contract を 1 つも破りません**。 すべての境界が
成立し、 破られた約束もなく、 primitive が消費できない形を握らされています。 contract が
design review の代わりにならないことを 1 つの deployment で言い切るためにあり、 repair
checkpoint が「すべての contract が成立する」ことと「すべての部品が渡されたものを実行できる」
ことを別々に要求する理由でもあります。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` でこの deploy 固有の fixture と公開された証拠を読む。
3. 画面内のエディタで starter のソースを編集する。
4. `test` で公開テストを実行し、直接回答欄があれば証拠から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Participant Portal へ貼る。

checkout、ターミナル、ローカルエディタは不要です。code checkpoint は編集したソースを提出します。
直接回答は `prepare` が現在の deploy seed へ結び付けるため、別 deploy からコピーした値は拒否されます。

## 採点

8 checkpoint、 独立採点。 誤答は 1 回 15 点。

| Checkpoint | Points | 見るもの |
|---|---:|---|
| `dataflow` | 45 | 各 wire が運ぶよう pin されているものと、 primitive の保証が終わる場所 |
| `properties` | 30 | 各 end-to-end property と、 それを担う wire の対応 |
| `contracts` | 50 | licence・obligation・authorisation・trust・cost の違反を正しい class で |
| `diagnosis` | 30 | 値が届く順で最初に破れた boundary |
| `counterexample` | 45 | どの部品も満足したまま 1 つの property を落とす 1 箇所の変更 |
| `repair` | 45 | 要求を書き換えずに戻す、 最小の変更 |
| `selection` | 30 | brief に対する primitive・公開範囲・trust・主要 cost |
| `transfer` | 25 | 見たことのない field・statement・program・brief で全部 |

8 個中 7 個にヒント (14〜24)。 全部開いても 300 中 174 が残ります。

## checkpoint が 9 でなく 8 である理由

Issue #244 は 9 つ要求しています。 multi-verify の上限は 8 で、 catalog 側の `SCHEMA.json` と
platform 側の `packages/problem-sdk` の両方で強制され、 **9 個目は truncate されず scoring
object ごと破棄されます**。 つまり 9 つ宣言すると残りの 8 つも一緒に落ち、 問題が採点不能に
なります。 そこで 9 つのうち 2 つを 1 つの checkpoint に束ねました。

隣り合っていたからではありません。 「どの wire が何を運んでいるか」 と 「primitive の保証が
どこで終わるか」 は、 同じ typed graph を読む 1 つの行為です。 hidden phase は 8 checkpoint の
裏に 9 つあり、 2 つ動くのは `dataflow` だけです。

## 簡単なほうの半分

この問題は 53 個の壊れた stack を同梱していて、 そのうち **47 個は architecture checker の
test を書く人が最初に書く 2 問に正しく答えます** — 健全な architecture には何も出さず、
壊れた architecture には何か出すか。 `make reference-test` が毎回この数を測り直します。

どちらも問題文にそのまま書いてあるので誰も発見する必要がなく、 その 2 つしか訊かない suite は
47 個の間違ったモデルと意見が一致します。 書いていないほう —「最初」が id 順ではなく値が届く順
であること、 assumption が満たされなくなった瞬間に primitive は何も vouch しなくなること、
どの wire も担っていない property が 1 つあること、 違反した node を承認するのは repair では
ないこと — が、 test 1 本ではなく checkpoint がある理由です。

## primitive の保証が終わる場所

primitive は、 自分の**内側**で走らせた計算について correctness と privacy を保証します。 強い
保証で、 かつ狭い保証です。 primitive の上に載った application コードは、 銀行の金庫が建物から
持ち出したものを守るのと同じ程度にしか守られていません。 host orchestration は何にも守られて
いません。 そして assumption が満たされなかった保証は保証ではありません — primitive は
受け取った値と produce した値について vouch するので、 そのどちらかで contract が破れていれば
何も vouch していません。

primitive の box を緑に塗った architecture 図は、 この問題が計算させるものを主張しています。

## 残さずに消した規則が 1 つあります

初期のモデルには、 wire の両側で値が無い attribute を飛ばす規則がありました。 値が持っていない
attribute についての contract は contract ではない、 という理屈です。 読み物としては通ります。
そして答えを 1 つも変えません — key domain が無い edge は、 その class の 2 つの property を
必ず別の class 経由ですでに持っているからです。 つまり、 守っているところも破っているところも
誰にも観測できない規則でした。

消しました。 モデルは何かを決める規則だけを持ちます。 何も決めない規則は、 読み手の時間を使う
コメントです。

## 監査が証明できることと、 できないこと

証明できるのは、 同梱された 53 個の欠陥をこの 8 checkpoint が捕まえること、 reference が 8 つ
すべてを通ること、 出荷される starter が 1 つも通らないことです。 証明できないのは 「このモデル
に他の穴が無い」 ことです。 誰も書き下さなかった欠陥は、 誰も測っていない欠陥です。

## この先

Week 6 はここで終わり、 Week 7 の capstone は actor と asset と trust を名指して primitive を
1 つも名指さない brief から始まります。 引き継がれるのはこの問題が仕込む習慣です。 部品が動く
ことは議論の始まりであって、 終わりではありません。

## 対象外

実際の MPC / zkVM / FHE の実行、 特定 protocol の security proof、 proof system の soundness、
実運用の鍵管理、 network レベルの可用性。

## これは安全ではありません

node は 8〜9 個、 edge は 7〜9 本、 attribute は 5 つ、 boundary class は 11 個です。 実際の
stack では node は数百あり、 attribute はその中の proof system と ciphertext scheme の
パラメータすべてで、 boundary class はその deployment が書き下した数だけあります。 主張して
いるのは 「境界の contract は exact な規則として書ける」 ことであって、 「ここに書いたものが
完全である」 ことではありません。

## Source alignment

Week 6 の資料は公開されているので、 `courseAlignment` は `week6/README.md` を commit
`5e80999306608a45aecf9a0e4e3394a0b62f34d2` で pin しています。 公式資料からは何も再現していま
せん。 graph モデル、 attribute の集合、 licence と policy の表、 3 つの architecture、 13 の
deployment、 brief、 解答はすべて独立に書かれています。 主題 — primitive の内側で走る計算と
その上で走る計算、 そしてそれらが出会うところで何が壊れるか — はコース自身の README が名指して
いるものなので、 ここに課題の近道はありません。

## 保証範囲

ローカルモードは **自習向けの honor-system 検証** です。 マシンも Docker daemon も image も
あなたのものなので、 image の中にあるものはどれも手の届かないところにはありません。
`reference/` と `tests/hidden/` を bind-mount していないのは、 あなたの git checkout に紛れ
込ませないためであって、 遠ざけるためではありません。 hidden checker が突き合わせる ground
truth 関数も同じです — それを import したモデルは何もモデル化しておらず、 そうしないと決められる
のはあなただけです。

verifier が保証するのはもっと狭く、 そして本物です。 提出物は verifier を hang させたり
crash させたりできません。 checkpoint は echo した id しか credit できません。 結果は期待値を
漏らしません。 そして各 case が働く field、 proof が主張する statement、 journal が名指す
program、 6 つの brief はこの deployment の seed から引かれるので、 暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。 競技順位・試験・修了判定は**支えません** — それには参加者が
運用しない verifier が要り、 [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271)
で追跡しています。

## コスト

ゼロ。 クラウドアカウントも AWS リソースも不要です。

## 作問者向け

`make reference-test` は image の中で mutation suite を回します。 53 個の壊れた stack と、
verifier 自身を狙った 1 個です。 まず reference が 9 つの hidden phase をすべて通ることを確認し、
次に reference を 53 通りに壊して、 そのうち何個が簡単なほうの 2 問に正しく答えるかを表示します。
その数がこの README が引用している数字です。 あとの編集で checkpoint が安くなればその数字が動き、
主張のほうも一緒に動かさなければなりません。
