# どこまで押せるか

準同型暗号の暗号文はメッセージを環の上に置いて押しずらす。復号は「どの点に一番近かったか」で、正しさの問いはすべて「どこまで押せるか」に帰着する。その距離を実行前に計算する。

Week 5 の 1 問目。 Week 5 は依存の鎖がトラック中で最も長く、 ここでの noise 予算が LWE から PBS まで全部の土台になる。

モデルは 4 行で、 隠していることは何もない。 メッセージ m は [0, p) にあり、 scaling factor D が p 個のメッセージを環 q = p*D の上に広げ、 encode(m) = (m*D) mod q、 decode は c が一番近い encoding point のメッセージ。 p・D・q は checkpoint ごとに変わるので、 決め打ちしたものはどこかで外れる。

本当に難しいのは 3 つ。 1 つ目は同点の扱いで、 2 点のちょうど中間は切り上げると決めた時点で、 耐えられる noise 区間は対称ではなくなる。 delta が偶数なら中間点が存在して上端が 1 点分を失い、 奇数なら中間点が無いので対称になる。 同じ式から両方が出てくるので、 偶奇で分岐しないのが正しい書き方になる。

2 つ目は負の noise。 Python の % は正の法に対して非負を返すので特別扱いは要らず、 abs を取るのは別の関数になる。 3 つ目は巻き戻りで、 最後のメッセージの次の点は p ではなく 0。 p 個のうち 2 個だけがこれに気づく。

採点の設計として、 success_interval はパラメータに対して採点し、 participant 自身の decoder に対しては採点しない。 全 noise を試して測った区間は decoder が何をしていようとそれに一致するので、 間違った decoder と間違った区間が一緒に通ってしまう。 hidden test は両方を fixture から計算し、 decoder を区間に対して、 区間を decoder に対して、 別々に検査する。

これは安全ではない。 p と q は手で全列挙できる大きさで、 境界が見えるのはそのおかげだけ。 toy の正しさと production の安全性は別の主張で、 この問題は前者しか主張しない。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- message space・plaintext modulus p・ciphertext modulus q・scaling factor Δ を区別できる
- toy encoding / decoding を実装できる
- noise が encoded point を動かすことを環の上で説明できる
- centered representative と modular representative を往復できる
- rounding boundary を計算し、 decode 成功範囲を実行前に予測できる
- noise が境界を越えると correctness が失われることを反例で示せる
- toy parameter が security を持たないことを明示できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `encode` | メッセージを環の上に置く | 25 |
| `noise` | 押しずらして、 符号を見る | 30 |
| `decode` | 一番近い点を選ぶ | 30 |
| `interval` | 耐えられる幅を先に言う | 30 |
| `first-failure` | 最初に壊れる noise を見つける | 30 |
| `transfer` | 見たことのないパラメータで成立させる | 25 |
| `validate` | 使えないパラメータを断る | 30 |

## 解説

## 区間は対称ではない

2 点のちょうど中間の値をどちらに丸めるかは決めなければならない選択で、 この問題では切り上げに固定してある。 決めた時点で、 耐えられる noise 区間は対称ではなくなる。

delta が偶数なら中間点がちょうど存在し、 そこは切り上げられて隣のメッセージになるので、 上端は delta//2 ではなく delta//2 - 1 になる。 delta が奇数なら中間点が存在しないので区間は対称になる。 `(-(delta // 2), delta - delta // 2 - 1)` は両方を同じ式で出す。 偶奇で分岐する実装は、 片方の parity でしかテストしていないことを自白している。

## 測った区間は decoder に一致してしまう

success_interval を全 noise 値の試行で測ると、 decoder が何をしていようと測定結果はそれに一致する。 間違った decoder と間違った区間が矛盾なく揃うので、 両方が通ってしまう。 だから区間はパラメータから導き、 hidden test は decoder を fixture 由来の区間に対して、 区間を fixture 由来の decoder に対して、 別々に検査する。 予測と実測を別の checkpoint に分けてあるのも同じ理由。

## 負の noise は特別扱いを必要としない

Python の `%` は正の法に対して非負を返すので、 `(c + e) % q` は e が負でもそのまま正しい。 `abs(e)` を取るのは 「noise を足す」 とは別の関数で、 exact な点から始めた往復テストでは絶対に見えない。

## 巻き戻りに気づくのは 2 メッセージだけ

最後のメッセージの上に noise を足すと 0 に、 メッセージ 0 の下に足すと p-1 になる。 first_failure が `m+1` / `m-1` を返す実装は、 p 個のうち p-2 個で正しい。 残り 2 個が全部。

## noise は padding ではない

noise は安全性が依拠する対象であり、 正しさが消費する対象。 1 単位足すごとに困難性を買い、 余裕を払う。 「多いほど安全でコストは無い」 も 「ランダムな詰め物」 も、 どちらもこの二重の役割を落としている。 ここで計算する区間が、 Week 5 の残りが使っていく予算そのものになる。

## これは安全ではない

p と q は手で全列挙できる。 実運用のパラメータは格子問題の裏にメッセージを隠すが、 これは何の裏にも隠していない。 ここで correctness が確認できたことを production の security の証拠として読むのは、 この問題が教えようとしていることの正反対。

## 出典との対応

Week 5 の教材は公開済みなので、 courseAlignment は `week5/README.md` を lecture、 `week5/problems/tfhe-toy-python/README.md` を assignment として pin してある。 spoilerPolicy は independent-reimplementation で、 パラメータは seed から生成し encoding rule は問題文に全部書いてあるため、 公式課題の fixture や solution.py からは何も写していない。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
