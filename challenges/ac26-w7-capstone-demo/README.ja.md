# 主張と、それを反証できる実験

複数 party が和だけを得る protocol を実装する。 難しいのは実装ではなく、 privacy を主張ではなく確率空間の全数え上げとして測ること、 そして見たことのない壊れ方を捕まえる test suite を書くこと。

Week 7 の 2 問目、 role は synthesis。 #246 で選定した primitive を、 実際に走る toy 実装と、 主張ごとに対応する実験の束へ落とす。

**randomness を明示的な tuple で受け取らせる**のが設計の芯。 `random` を呼ばせないので確率空間が有限かつ列挙可能になり、 privacy を 「同じ和・異なる honest 入力の 2 世界で coalition の view 分布が一致するか」 として **測定** できる。 標本ではなく全数え上げ (toy field で 3^6 = 729/世界/coalition) を要求する。 場は小さいが、 全空間は全空間であり、 実験の厳密さは変わらない。

**最大の落とし穴は coalition を 1 つしか調べないこと**。 randomness を一切引かない protocol は party 0 に対して完全に private でありながら party 2 に全入力を平文で渡す。 全 party に同じ randomness を配る変種も同じ形で抜ける。 hidden test は閾値未満の全 coalition を掃くので両方落ちる。

**mutation 21 件のうち 9 件は正しい和を返す**。 出力が合っていて transcript が漏らすもの、 両方まともに見えて transcript が実際の run と食い違うもの (公開値が受信の和でない / 総和が出力と一致しない) を含む。 `transcript` checkpoint はこの内部整合性を見る。

**閾値 (parties-1) は protocol の欠陥ではなく関数の限界**。 和から自分たちの入力を引けば残り 1 人分が出る。 scope に書かせ、 defect として扱わせない。

**`detect` は学習者の test suite 自体を採点する**。 hidden test は学習者自身の `run` を包んだ 9 種の broken protocol を渡す。 既知の悪い例を並べた関数では通らない。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- 設計で選んだ primitive を、 動く toy 実装へ落とせる。
- randomness を明示的に受け取る形にし、 確率空間を数え上げ可能にできる。
- privacy を主張ではなく、 2 つの世界の view 分布の一致として測れる。
- 1 つの coalition ではなく、 閾値未満の全 coalition を掃く必要を説明できる。
- 関数そのものが持つ限界 (閾値) を、 実装の欠陥と区別して書ける。
- 見たことのない壊れ方を捕まえる test suite を書ける。
- 各主張を、 実行された実験と限界へ 1 対 1 で対応づけられる。

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `scope` | 作ったものが何を保証しないかを書く | 30 |
| `correctness` | 見せていないパラメータで和が出る | 30 |
| `transcript` | transcript が自分の出力を再構成する | 40 |
| `privacy` | 見えるものが出力だけで決まると測る | 55 |
| `threshold` | どこから隠せなくなるかを言う | 40 |
| `detect` | 見たことのない壊れ方を捕まえる | 55 |
| `measure` | 実際の run から数える | 25 |
| `evidence` | 主張と実験を 1 対 1 で結ぶ | 25 |

## 解説

## 正しい答えは、正しい protocol の証拠ではない

出力が合っている実装はいくらでも壊れていられます。この問題の mutation のうち半分近くは、 和を正しく返します。

`transcript` checkpoint が見ているのはそこです。公開された値が、 その party が実際に受け取ったものの和になっているか。公開値の総和が、 報告された出力と一致するか。この 2 つを見ないと、 「出力だけ正しく返して transcript は別の run を記述している」実装が通ります。実装が結果を捏造する形として、 これはいちばんありふれています。

## privacy は測れる

privacy を「設計上そうなっている」と書くのは主張です。ここでは測ります。

同じ和を持ち、 honest な入力が違う 2 つの setting を用意する。randomness を全部数え上げて、 coalition の view を両方で集める。2 つの多重集合が一致すれば、 view は出力だけの関数です。これは近似ではなく定義そのものです。

数え上げが成立するのは randomness が明示的だからで、 だから契約が `random` を禁じています。標本では「全部の randomness について」を主張できません。

## 1 つの coalition は全部の coalition ではない

いちばん大事な失敗はここです。

randomness を一切引かない protocol を考えます。各 party の share は `[0, ..., 0, x]` になり、 最後の 1 人が全員の入力をそのまま受け取ります。party 0 から見ると受信は全部 0 で、 公開値も 2 つの世界で同じ。**party 0 に対しては完全に private です。** party 2 は全部知っています。

coalition を 1 つだけ調べる実験は、 この protocol を private だと報告します。全部の party に randomness を使い回す protocol も同じ形で抜けます。掃かないと捕まりません。

## 閾値は欠陥ではない

`parties - 1` 人が結託すると、 残り 1 人の入力が出ます。これは protocol の穴ではありません。**出力そのものが決めている限界** です。和から自分たちの入力を引けば、 残るのは 1 人分だけです。和を計算するどんな protocol もこれより良くはできません。

だから閾値は defect list ではなく scope に書きます。直せないものを直せるかのように書くほうが、 書かないより悪いです。

## 自分の suite が採点される

`detect` は、 見たことのない壊れた protocol を渡します。既知の悪い例を並べた関数は通りません。

壊れ方は 3 系統あって、 1 つの検査では 3 つとも捕まりません。出力が違う。出力は合っていて transcript が漏らす。両方まともに見えて transcript が実際の run と食い違う。3 番目を落とすのがいちばん多い。

## 次につながるところ

これが 7 週間の終点です。Week 1 の constraint から Week 6 の stack composition まで、 通して効いているのは 1 つ: **主張は、 それを反証できる実験と対にして初めて主張になる**。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
