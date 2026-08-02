# 掛け算は 5 回、通信は 1 回

複数組織が件数と深刻度を出さずに加重リスクスコアだけを得る。Week 2 の 4 問を 1 つの application へ束ねる。乗算の数と round の数は同じではない。

Week 2 の総合問題、 role は synthesis。 share・線形演算・Beaver 乗算・open policy を個別に実装して終わりにせず、 複数 party の秘密入力から非線形な集計値だけを公開する小さな MPC application へ統合する。

式は score = Σ_i (count_i * severity_i) + bias (bias は公開、 mod p)。 積の両側が秘密なので、 組織数 k に対して乗算が k 回必要になる。 一方 d と e の open は互いに独立なので、 全部まとめて 1 round に収まる。

**この 2 つの数が違う**ことがこの問題の中心。 乗算ごとに open する実装は正しく、 privacy も保たれ、 latency だけが k 倍になる。 主張ではなく実測で採点するため、 開示経路を `io.open_batch()` 1 つに絞り、 呼び出し回数を round として数える。

triple の使い回しも同様に correctness では捕まらない。 Beaver は任意の妥当な triple で正しく動くため、 同じ triple を全積に使ってもスコアは合う。 壊れるのは privacy で、 同じ mask a が複数の秘密を覆うと transcript から秘密の差が出る。 hidden test は open された値の多重集合を、 供給された triple が含意する mask 差と厳密に照合するので、 使い回しはここで落ちる。

checkpoint は 8 つで、 correctness・privacy・communication cost を別々に採点する。 1 つの verdict にまとめると、 学習者が作ったのが 「正しいが高い」 のか 「正しいが漏れる」 のか 「安全だが誤り」 なのかを区別できないため。

Week 2 の教材は pinned commit 時点で未公開のため sources は placeholder pin であり、 status は draft のままにする (#219 が公開を検出した時点で確定する)。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- application 式を線形部分と乗算部分へ分解できる
- 必要な Beaver triple 数と communication round 数を実装前に見積もれる
- round 数が乗算の数ではなく乗算の深さで決まることを説明できる
- secret-shared input から途中値を公開せずに結果を計算できる
- triple の使い回しが correctness ではなく privacy を壊すことを説明できる
- correctness、privacy、communication cost を別々に検証できる
- 公開すると決めた最終出力から不可避に漏れる情報を説明できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `plan` | 書く前にコストを見積もる | 35 |
| `share-inputs` | 秘密を分割する | 30 |
| `linear` | 公開された定数を足す | 30 |
| `multiply` | 秘密同士の積を組み上げる | 55 |
| `result` | 関係が成り立つことを示す | 35 |
| `privacy` | mask 差以外を公開しない | 40 |
| `cost` | 見積もりと実測を一致させる | 35 |
| `transfer` | 見たことのない設定でも成立させる | 40 |

## 解説

## 式を分解する

score = Σ_i (count_i * severity_i) + bias。 総和は線形、 bias の加算も線形 (ただし 1 party だけが畳み込む)、 秘密同士の積だけが線形でない。 だから組織数 k に対して Beaver 乗算が k 回、 triple が k 個要る。

## round が k ではなく 1 である理由

k 個の積の d と e は、 どれも他の積の結果に依存しない。 だから全部を 1 回の open にまとめられる。 乗算ごとに open する実装は正しく、 privacy も保たれ、 latency だけが k 倍になる。

これが 「round 数 = 乗算数」 という誤解の実演で、 実際には round 数は乗算の**深さ**で決まる。 この式の深さは 1 なので、 幅がいくら増えても round は 1 のまま。 深さ D の回路なら D round になる。

## triple 使い回しが correctness で捕まらない理由

Beaver 乗算は c = a*b を満たす任意の triple で正しく動く。 同じ triple を全積に使ってもスコアは合う。 壊れるのは privacy で、 同じ a が x_1 と x_2 の両方を覆うと、 open された d_1 - d_2 = x_1 - x_2 がそのまま秘密の差になる。

hidden test は open された値の多重集合を、 供給された triple が含意する mask 差と厳密に照合する。 blacklist ではなく完全一致なので、 「別の triple の d を出した」 も 「余計に何か出した」 も同じ検査で落ちる。 1 回の乗算に 1 つの triple が要るのはこのためで、 offline コストが乗算回数に比例するのもこのため。

## 3 つを別々に採点する理由

実装は 「正しいが高い」 「正しいが漏れる」 「安全だが誤り」 のいずれにもなり得る。 1 つの verdict にまとめると、 学習者は自分がどれを作ったのか分からない。 correctness・privacy・cost を別 checkpoint にしてあるのはそのため。

## 固定期待値ではなく関係で検査する

result checkpoint は 3 つの関係を検査する。 randomness を変えて share し直してもスコアは動かない、 組織の順序を反転してもスコアは動かない、 1 組織の count を Δ 動かすとスコアは Δ * severity だけ動く。 1 回の出力を覚えても関係は満たせない。

## 最終出力から不可避に漏れるもの

score を公開すると決めた時点で、 score から導けることは漏れる。 k=1 なら score - bias がその組織の積そのもの。 k が小さく severity の範囲が狭ければ、 count の候補は絞れる。 MPC が保証するのは 「計算過程から追加で漏れない」 ことであって、 「出力から何も分からない」 ことではない。 後者が要るなら別の仕組み (出力の摂動、 閾値化) が要る。

## 次につながるところ

application 式を線形部分と乗算部分へ分解し、 コストを事前に見積もり、 実測と突き合わせる — この 3 つは Week 6 の co-SNARK でそのまま使う。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
