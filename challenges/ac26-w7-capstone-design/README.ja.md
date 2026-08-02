# 道具から決めない

brief には actor と asset と信頼関係しか書いていない。 primitive の名前は 1 つも出てこない。 そこから必要な性質を導き、 必要な分だけ選び、 境界に型をつけ、 前提が動いた brief にもう一度答える。

Week 7 の 1 問目、 role は synthesis。 Week 1〜6 の primitive を、 流行や library ではなく problem statement・adversary・公開可能情報・秘密情報・trust assumption から選ぶ設計問題として扱う。

設計を自由記述で書かせて LLM に採点させると、 読める文章と正しい設計の区別がつかない。 そこでこの問題は設計を **コード** として書かせる。 brief を入力に取り、 asset 分類・required property・alternative 比較・selection・typed data flow・attack plan・property matrix を返す 8 つの関数である。 いずれも brief の関数として書ける。

**採点の芯は最後の checkpoint にある**。 前提が 1 つ動いた brief (運営が信用できなくなる / 第三者が結果に依存し始める / 1 者欠けても完了しなければならない) 18 種と、 seed から生成されてどのファイルにも存在しない brief 12 種を渡す。 brief を読んで導出する実装なら 4 回呼ぶだけで通り、 答えを 1 度決めて書き込んだ実装はここだけ動かない。

**選定規則は 3 条件 + 1 優先規則**。 required を被覆する / この brief が用意していない相手を信用しない / 1 つ外すと被覆が壊れる。 そしてその前に、 暗号が不要な brief には暗号を選ばない。 6 つの brief のうち `shift-board` がそれで、 ここで primitive を選ぶ実装は落ちる。

**privacy と zero knowledge を分けてある**。 計算に参加する相手から隠すのが privacy、 自分で計算していない値を信じてもらうのが soundness、 信じてもらう値が隠したい値から導かれるときだけ zero knowledge。 `solvency-claim` は privacy を要求せず zero_knowledge を要求するbrief で、 両者を同一視した実装をここで落とす。

**最小性が満たす組を一意に決めるとは限らない**。 `delegated-scoring` は MPC でも FHE でも通る。 採点は reference の出力と一致するかではなく、 被覆・許容・最小の 3 条件だけを見る。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- 問題文を actor・asset・信頼関係へ分解してから道具を考えられる。
- 必要な security property を brief から導き、 不要なものを要求しない。
- 暗号を使わない案を含めて比較し、 何を買ったのかを言える。
- public / private / ciphertext / share / proof を辺の型として設計できる。
- 各 property に責任 component と観測可能な evidence を対応づけられる。
- 前提が変わった brief に、 設計を導出し直して答えられる。

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `assets` | 誰の何を、どこまで隠すのかを並べる | 30 |
| `requirements` | brief から必要な性質だけを取り出す | 45 |
| `alternatives` | 使わない場合を含めて並べる | 30 |
| `selection` | brief が要求した分だけ選ぶ | 50 |
| `architecture` | 何がどの形で境界を越えるかを書く | 45 |
| `attacks` | 壊れ方を、観測できる形で書く | 35 |
| `matrix` | 性質ごとに、誰が担うのかを書く | 35 |
| `revision` | 前提が 1 つ動いた brief に答える | 30 |

## 解説

## 道具から始めない

設計を 「ZK を使うか、 MPC を使うか」 から始めると、 その質問には答えが出る。 出た答えが問題に合っているかは、 別の話である。

この問題の brief は primitive の名前を 1 つも含んでいない。 含んでいるのは、 誰がいて、 何があって、 誰が何を知ってはいけなくて、 誰が自分で計算していない値を信じるか、 だけである。 そこから必要な property が決まり、 property から選択肢が決まる。 順序が逆になった設計は、 だいたい正しく動いて、 だいたい間違ったものを守っている。

## privacy と zero knowledge は別の欄

`balance` を lender に見せたくない。 これは privacy だろうか。

lender は計算に参加しない。 答えを読むだけである。 つまり 「計算する側から隠す」 話ではなく、 「自分で計算していない値を信じてもらう」 話になる。 前者が privacy、 後者が soundness であり、 信じてもらう値が隠したい値から導かれているときに初めて zero knowledge が要る。

soundness だけなら、 ただの署名でよい。 この 2 つを一緒にすると、 署名で済む場所に証明系を持ち込むことになる。

## 最小性が効く場所

選んだ組から 1 つ外してみて、 まだ全部の要求を満たしているなら、 その 1 つは何もしていない。 何もしていない primitive は無害ではない。 前提が 1 つ増え、 攻撃面が 1 つ増え、 説明すべきことが 1 つ増える。

`shift-board` は暗号を必要としない brief として入れてある。 秘密が無く、 誰も運営を疑っておらず、 誰も他人の計算結果に依存していない。 ここで primitive を選んだ設計は、 問題ではなく道具から始めている。

なお、 満たす最小の組は 1 つとは限らない。 `delegated-scoring` は MPC でも FHE でも通る。 採点は 「必要を満たし、 この brief が用意していない相手を信用せず、 何も余分でない」 かどうかだけを見る。

## non_goals は飾りではない

`PRIMITIVES` の各 option には `non_goals` がある。 FHE は鍵管理を無くさない。 復号鍵を持つ誰かがいて、 その誰かは脅威モデルの登場人物のままである。 MPC は結託の仮定を無くさない。 置き換えるだけである。 ZK は public input を隠さない。

property matrix で 「この component が privacy を担う」 と書くとき、 その component が実装している option が本当に privacy を提供するのかを見る。 提供しないものに委ねた設計は、 図の上では完成している。

## 導出した設計と、決めた設計

最後の checkpoint は、 前提が 1 つ動いた brief を渡す。 運営が信用できなくなる、 第三者が結果に依存し始める、 1 者が落ちても完了しなければならない。

brief を読んで導出する関数を書いていれば、 ここは 4 回呼ぶだけである。 どこか 1 つでも答えを書き込んでいれば、 そこだけが動かない。 設計文書が古くなるのはこれと同じ理由で、 違いは、 文書は自分が古いと言わないことである。

## 次につながるところ

Week 7 の実装 challenge は、 ここで作った property matrix と attack plan を、 実際に走る実験へ変換する。 evidence の欄に書いた実験 id が、 そこで実行されるものになる。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
