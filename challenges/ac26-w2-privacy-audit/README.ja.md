# 答えは合っている。それだけだ

7 つの実装がすべて正しい合計を返す。うち 4 つは途中で何かを漏らしている。correctness test は全部通る。監査器を書いて、最初の違反を特定する。

Week 2 の 4 問目、 role は transfer。 correctness と privacy は別の性質であり、 前者の test をいくら足しても後者は保証されない、 を実装で確認する。

題材は 3 party の加重合計 MPC。 program は Python source ではなく操作列 (op list) として与えられ、 runtime が実行して観測可能な event 列を出す。 これが本問題の設計上の要で、 `reconstruct` という語を grep する監査器は rename・wrapper・helper で破れるが、 実際に実行された操作を読む監査器は破れない。 program を code ではなく data にしたことで、 その違いを採点できる。

7 実装すべてが正しい合計を返す。 4 つが違反 (secret の open / 他 party の share 読み取り / log への raw 値 / error message への secret) を持ち、 3 つは clean。 clean 側には偽陽性の罠を 2 つ置いてある — 仕様上 public な値を log に出す実装と、 自分自身の slot を読む party。 「全部怪しい」 と言う監査器は本物を全部見つけた上で不合格になる。

checkpoint は 7 つ。 allowed open 集合の導出、 3 種類の違反検出、 transcript からの秘密復元 (counterexample)、 修復、 rename + 並べ替え + 未知 seed での再監査。 修復は 「消せば漏れない」 を排除するため、 仕様が許す観測がすべて残っていることまで検査する。

threat model は honest-but-curious、 collusion なし。 実運用の security 主張はせず、 toy simulator で観測できる leakage contract だけを評価する。

Week 2 の教材は pinned commit 時点で未公開のため sources は placeholder pin であり、 status は draft のままにする (#219 が公開を検出した時点で確定する)。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- correctness test だけでは privacy を保証できないことを実装で確認できる
- protocol 仕様から公開してよい値の集合を導ける
- secret の open、cross-party read、log / error への漏洩を区別して検出できる
- 仕様上 public な値の露出を違反と誤判定しない
- transcript から秘密を復元して漏洩の害を示せる
- 違反だけを取り除き、正当な観測を残したまま修復できる
- 同じ view でも threat model の仮定が変われば判定が変わることを説明できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `allowed-opens` | 仕様から公開してよい値を挙げる | 35 |
| `opened-secret` | 公開してよくない値の公開を見つける | 45 |
| `cross-party` | 他人の手元を覗いた場所を見つける | 45 |
| `log-leak` | log と失敗経路から漏れた値を見つける | 45 |
| `transcript` | 漏れた transcript から秘密を復元する | 40 |
| `repair` | 漏れだけを取り除く | 50 |
| `mutation` | 名前を変えられても同じ判定を出す | 40 |

## 解説

## correctness test では捕まらないもの

7 実装すべてが正しい合計を返す。 correctness test を何本足しても、 このうちどれが安全かは 1 ビットも分からない。 privacy は出力の性質ではなく、 計算の途中に何が観測可能になったかの性質だから。

## 4 種類の違反

- **opened-a-secret**: 中間値 (部分和) を open する。 mask が掛かっていないので、 transcript を読んだ者はその値を知る。
- **cross-party-read**: ある party が別の party の raw share slot を読む。 何も open されず transcript は綺麗なので、 access trace を見ない限り分からない。
- **leaked-in-log**: log 行に raw な private 値が入る。 log は threat model の外ではない。
- **leaked-in-error**: error path が secret を含む。 正常系は完全に綺麗で、 だからこそ correctness review を通過する。

## 偽陽性の 2 つ

「怪しいものは全部挙げる」 監査器は、 本物の違反を全部見つけた上で不合格になる。 clean な実装のうち 1 つは仕様上 public な weight を log に出し、 もう 1 つは party が自分自身の slot を読む。 どちらも違反ではない。 何が公開されてよいかは仕様が決めるのであって、 操作の種類が決めるのではない。

## なぜ program が code ではなく data なのか

`reconstruct` という語を grep する監査器は、 rename・wrapper・helper 経由の呼び出しで破れる。 本問題の program は操作列として与えられ、 runtime が実行した操作そのものが観測対象になる。 mutation checkpoint は全 label を rename し、 独立な open を並べ替え、 未知の seed で回す。 protocol は変わっていないので判定も変わってはならない。 label の文字列や event の index を覚えた監査器は、 ここで自分自身と矛盾する。

## counterexample が要る理由

「余計に open している」 と指摘するだけでは、 それが害だったことを示していない。 transcript には部分和と合計の両方があり、 差は最後の party の加重寄与で、 weight は公開かつ可逆。 引き算 1 回と逆元 1 回で、 その party の private 値がそのまま出る。 漏洩の主張は、 復元して初めて主張になる。

## 修復の条件

「観測を全部消す」 も漏れないし、 合計も返る。 それを修復と呼ばないために、 採点は仕様が許す観測がすべて残っていることまで見る。 修復とは、 違反だけをちょうど取り除くこと。

## threat model

ここでは honest-but-curious、 collusion なしを仮定している。 同じ view でも、 collusion を許した瞬間に安全性の判定は変わる。 判定は仮定に対して行うものであって、 コードに対して行うものではない。

## 次につながるところ

この分離 — 正しい出力と、 途中の観測可能性 — は Week 6 の co-SNARK privacy audit でそのまま使う。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
