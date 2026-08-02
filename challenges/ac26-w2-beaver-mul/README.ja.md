# 掛け算だけが話を必要とする

shared 値同士の掛け算だけは手元で終わらない。前処理で作った三つ組を使って、通信を 1 round に押し込む。最後の項が他の 3 つと違う扱いを要求する。

Week 2 の 3 問目。 前問で引いた 「通信が要る操作 / 要らない操作」 の境界を受け、 唯一残った乗算を Beaver triple で処理する。

前処理で c = a*b を満たす三つ組 (a, b, c) を share しておくと、 入力に依存しない準備だけで乗算が

    d = x - a,  e = y - b   (local)
    open d, open e          (1 round)
    x*y = c + d*b + e*a + d*e

に分解できる。 前 3 項は share に対して線形なので各 party が自分の行を計算するだけで済むが、 d*e は protocol の途中で現れる公開定数であり、 1 party だけが畳み込む。 全員が足すと x*y + (n-1)*d*e の share になる。 これは ac26-w2-linear-shares の add-constant と同じ規則が、 見落としやすい位置で再登場したもの。

この誤りは d か e が 0 の設定では正解と区別できないため、 fixture 生成側で d != 0 かつ e != 0 を強制している (観測可能性のための選択であり、 実運用の mask 分布ではない)。 hidden test は誤答の総和を名指しで落とす。

Week 2 の教材は pinned commit 時点で未公開のため courseAlignment.sources は持たず、 status は draft のままにする (#219 が公開を検出した時点で確定する)。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- 前処理済み三つ組で秘密を mask し、差分を安全に公開できる
- 公開された d と e から x*y の share を線形結合で組み立てられる
- 公開スカラー d*e を 1 party だけが畳み込む理由を説明できる
- Beaver 乗算に必要な通信が 1 round であることを述べられる
- 前処理が乗算コストを消すのではなく offline へ移すだけであることを説明できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `mask` | 秘密を前処理済みの値で隠す | 40 |
| `open` | 隠した差分を公開する | 30 |
| `combine` | 公開された 2 つの値から積を組み立てる | 65 |
| `protocol` | 通しで走らせて必要な round を述べる | 30 |
| `transfer` | 見たことのない設定でも成立させる | 35 |

## 解説

## 前処理が何を動かしたか

Beaver triple (a, b, c) は c = a*b を満たすだけで、 x にも y にも依存しない。 だから event の前に、 あるいは暇な時間に、 いくらでも作り置きできる。 online phase に残るのは masking (local) と d, e の open (1 round) と線形結合 (local) だけになる。 乗算の総コストが消えたのではなく、 入力に依存しない部分が offline へ移った。

## なぜ d と e を公開してよいのか

d = x - a の a は前処理で作られた一様な値で、 誰も clear では持っていない。 だから d は x を one-time mask で隠したものであり、 公開しても x は漏れない。 triple を 2 回使い回すと同じ a が 2 つの秘密を隠すことになり、 この性質は壊れる。 三つ組が 1 回の乗算ごとに 1 つ必要なのはこのためで、 offline のコストがそのまま乗算回数に比例する。

## 最後の項

c + d*b + e*a までは share に対して線形なので、 各 party が自分の行を計算すればよい。 d*e だけは share ではなく公開されたスカラーで、 1 party だけが畳み込む。 全員が足すと総和は x*y + (n-1)*d*e になる。 前問の add-constant とまったく同じ規則だが、 protocol の途中に現れるぶん見落としやすい。

この誤りは n=1 では正解と一致し、 d か e が 0 の設定でも一致する。 hidden test の fixture が d != 0, e != 0 を強制しているのは、 誤答が観測できない設定を排除するため。 観測可能性のための選択であり、 実際の mask 分布ではない。

## round 数

d と e は同時に open できるので、 1 回の Beaver 乗算に必要な通信は 1 round。 0 ではない — 前処理は round を 0 にはしない。 深さ D の乗算回路は D round になり、 これが MPC の遅延がゲート数ではなく乗算深さで決まる理由になる。

## 次につながるところ

乗算が組めたことで、 任意の算術回路が MPC で評価できるようになった。 残るのは 「何を公開すると何が漏れるか」 で、 それが Week 2 の最後の 2 問。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
