# 同じ答えを返す 8 つの prover が、 それぞれ別のことを言っている

8 つの co-SNARK prover はどれも同じ `C = A × B` を返す。 違うのは何を、 どの出口から外へ出すかだけ。 最初の privacy violation を記録から特定し、 correctness と round 数を保ったまま塞ぐ。

Week 6 の 3 問目。 前の 2 問で作った co-SNARK prover は、 ここでは**支給される**。 線形部分 (`ac26-w6-cosnark-linear`) も、 1 round の乗算 (`ac26-w6-cosnark-beaver`) も、 答えのまま渡される。 この問題は `C` をもう一度計算する問題ではない。

```text
A = Σ_j a_j w_j        B = Σ_j b_j w_j        C = A × B        (mod p)
```

渡されるのは、 その上に乗った 8 つの prover 実装 `S1`〜`S8` である。 **8 つとも、 全 seed・全 shape で `C` を `A × B` に正しく復元する。** 並べても correctness test には区別が付かない。 それがこの問題の前提であって、 ネタバレではない。

違うのは、 それぞれが何を、 どの出口から外へ出すかである。

```text
artifact   次の段が受け取るもの
log        動きながら書き出す行
metrics    運用者が拾う名前付きの数
error      入力が壊れていたときに出るもの
```

correctness test が見るのは 1 番目の 1 field だけで、 8 つのうち 3 つは残りの 3 つしか使わない。 1 つは 4 つのどれも使わずに漏らし、 1 つは何も言わずに全 party の share を読む。

前問の runtime は `reconstruct` を渡さなかった。 この問題の `AuditRuntime` は**渡す**。 実在の MPC library は reconstruction も cross-party な debug hook も structured logging も提供する — 運用者が必要とするからで、 ここで取り上げてしまうと問題にしたい defect の class がそもそも書けなくなり、 監査対象にならない。 代わりに runtime は、 到達した capability を operand id とともに記録する。 **値は記録しない。** 記録は transcript ではなく証拠である。

specimen の id は不透明 (`S1`..`S8`) で、 2 つは `reconstruct` を綴らない名前で到達する。 `grep("reconstruct")` は何も見つけず、 capability の記録は見つける。 そこが `source-independent behavioral probe` の意味である。

採点の設計として、 この問題は 35 個の壊れた監査を同梱していて、 そのうち **29 個は 8 つの specimen 全部について 「これは clean か否か」 を正しく答える**。 `make reference-test` が毎回この数を測る。 異常に気づくことと、 何がどこから漏れたかを言うことは、 まったく別の難度である。

toy であることも明示しておく。 field は列挙可能な小さい素数、 party は 2〜5、 敵対者は不在、 triple は trusted dealer が配る。 そして `Share._value` は属性 1 つ分の距離にある — runtime は sandbox ではなく instrument で、 記録しているのは 「その計算が何を公開したか」 であって 「書いた人が何を見たか」 ではない。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- co-SNARK prover の public input / secret share / allowed open / secret intermediate / artifact / verifier-only を分類できる
- correct な relation を返しながら privacy が破れている実装を、 記録から検出できる
- capability の到達記録を読み、 名前を綴らない alias 経由の reconstruct を見つけられる
- authorized な d/e open と、 mask 無しの open・宣言外 round の open を区別できる
- party 境界を越えた share の読み取りを、 何も開示しない実装についても検出できる
- artifact / log / metrics / error の 4 channel すべてを policy に照らして検査できる
- 許可された名前が許可されていない中身を運んでいる場合を検出できる
- participant に見える view だけから、 本来非公開の値を導出する counterexample を提出できる
- 1 回の実行では現れない、 malformed input path の leakage を probe で引き出せる
- correctness・open set・round 数・artifact schema を同時に維持したまま leakage を塞げる
- primitive レベルの安全性が application レベルの privacy contract を自動的には与えないことを説明できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `classify` | どの値が、 誰のものか | 30 |
| `capability` | 1 回動かして分かることと、 分からないこと | 40 |
| `open-set` | 話してよかった値と、 そうでない値 | 40 |
| `cross-party` | 何も言わずに、 読むだけの実装 | 30 |
| `leakage` | 答えを見る test が、 見ていない 3 つの出口 | 45 |
| `evidence` | 漏れた値から、 秘密を組み立てる | 45 |
| `repair` | 同じ答えを返し、 何も言わない prover | 45 |
| `transfer` | 見たことのない設定と、 見たことのない実装で | 25 |

## 解説

## 正しい答えは、 正しい prover の証拠にならない

8 つの specimen は全 seed・全 shape で `C` を `A × B` に復元します。 96 通りの実行で 96 通りとも一致します。 correctness test をいくら足しても、 このうち 7 つが何をしているかは 1 bit も見えません。

そして監査の側にも同じ落とし穴があります。 この問題は 35 個の壊れた監査を同梱していて、 そのうち **29 個は 8 つの specimen 全部について 「clean か否か」 を正しく答えます**。 `make reference-test` が毎回この数を測り、 数が動いたら数のほうを直します。 **異常に気づくことは簡単で、 何がどこから漏れたかを言うことは難しい。** 8 個の checkpoint が exact な pair と exact な値を要求するのは、 その差が実務での差だからです。

## 4 つの出口のうち、 correctness test は 1 つしか見ない

`artifact` は次の段が受け取るもので、 test が読むのもそこです。 `log`・`metrics`・`error` は誰も読みません。 8 つのうち 3 つはその 3 つしか使いません。

log は**構造化**されています。 `emit(event, **values)` で、 1 行は `{"event", "values"}` です。 policy の対象になるのは `values` の**名前**であって、 event 名でも message の文面でもありません。 これは意図的な設計です: 先に文字列へ潰してしまえば、 この問題は正規表現の練習になってしまいます。 その代わり、 message の文面に秘密を書く実装はこの監査では捕まりません — 保証範囲の外です。

## 許可された名前は、 許可ではない

`ALLOWED_NAMES` に `A` / `B` / `C` は入っています。 **sharing として。** ある実装は allowlist のど真ん中にある名前 `C` に、 sharing の代わりに整数を入れて publish します。 名前だけを見る scan は何も見つけません。 `SHARING_ONLY_NAMES` はそのために存在する 2 つ目の規則で、 `is_sharing(value, parties)` が `Share._value` に手を伸ばさずに 「中身が何か」 を訊くための道具です。

## 開示されたからといって、 開示してよかったわけではない

1 回の Beaver 乗算が許可する開示はちょうど 2 つ、 mask された `d` と `e` で、 どちらも乗算自身の round id の下です。 開示が authorized なのは**両方**成り立つときだけです。

- 祖先に予約済みの triple mask がある (`maskedBy` が空でない)、 かつ
- `roundId` が relation の宣言した round である

前者を欠く開示は、 何にも隠されていない値を公開しました。 後者を欠く開示は、 relation が宣言していない round で mask された値を公開しました — mask を、 それが引かれた相手ではない値に使ったということで、 triple の再利用と同じ defect が変装しているだけです。 `maskedBy` だけを見る監査は後者を通し、 round だけを見る監査は前者を通します。

同じ述語が checkpoint `classify` と `open-set` の両方で要ります。 これは節約ではなく、 「その 2 つは同じ問いだ」 という主張です。 実測でも、 `_authorized` を片方だけの規則に壊すと 2 つの checkpoint が同時に落ちます。

## 何も言わずに漏らす実装

ある specimen は 4 つの channel のどれにも何も出しません。 disclosure は clean な prover のものと 1 byte も違いません。 そのうえで全 party の share を `peek` します。 何も process の外へ出ないので、 **開示の監査には原理的に見えません。** capability の監査には見えます。

これが 「secret sharing という primitive を使っているから prover 全体が private」 という誤解の実体です。 primitive は正しく動いていて、 その上の application が privacy contract を持っていないだけです。

`peek` の記録は、 読んだ party ではなく **share を持っている party** の id を刻みます。 それで足ります: 2 party 分の share を 1 つの party が全部持っていることはないので、 owner が 2 種類以上現れた時点で誰かが境界を越えています。 逆に、 自分の share を 2 回読んだだけの run は越えていません — peek の数と owner の数は別の数字です。

## 1 回動かして分かることと、 分からないこと

ある specimen は happy path では完璧です。 宣言された width と係数ベクトルが食い違う row を渡したときだけ、 例外 handler が失敗時の状態を error に詰めます。 1 回しか動かさない監査は、 これを clean と報告します。 clean だからです — そうでなくなるまでは。

checkpoint `capability` だけが `probe` を渡され、 何回動かすかを監査側に決めさせるのはそのためです。 残りの 7 つは 1 回の run を渡して 「これは何を言っているか」 を訊きます。

## 漏れた値から秘密を組み立てる

漏れとは 「見て分かる数」 ではありません。 **目の前にあるものだけを使って何かを導ける数**です。 この問題の disclosure には 3 種類の導出があります。

1. 秘密がそのまま、 秘密らしくない名前の下に出ている (`prover.left_half` は運用者が alert を張りたかった数です)
2. sharing が平文のまま出ている — 加法的 share は足せば元に戻ります
3. **秘密らしくない値が、 policy が明示的に許可している値と同じ record に出ている**

3 番目が本題です。 flag される field は `x` で、 それ自体は秘密に見えません。 秘密は、 それを `d` と組み合わせたときに出てきます — そして `d` は policy が許可している公開値です。 前問の `d = A - x` がそのまま `A = d + x` になります。 「漏れを見つけること」 と 「そこから秘密を導くこと」 は別の技能で、 だから checkpoint も別です。

この checkpoint では `serialized` された disclosure が渡されます。 sharing はすでに不透明な share id の列になっていて、 `Share._value` も `reconstruct` も使えません。 checker は runtime を見ていて、 答えるために capability へ到達した提出は別の問いに答えたことになります。

## 修復して、 同時に全部を満たす

`private_prover` は支給された `beaver_product` の上に書きます。 満たすべきものは同時に成立します: `C` が `A × B` に復元し、 開示は 2 つでどちらも authorized、 round は 1、 `open` 以外の capability に到達せず、 4 つの channel のどれにも policy 外のものを出さない。

何も publish しなければ 4 つは満たせます。 そして 1 つ目で落ちます。 **何も言わない prover は private ではなく、 ただ役に立たないだけです。**

もう 1 つ採点されるものがあり、 それは 「何か別のことが既に壊れているときにしか起きない」 がゆえに間違えやすい部分です。 triple を消費済みの runtime が渡され、 `reserve_triple` が拒否して呼び出しが失敗します。 失敗させてください。 失敗を debug できるように失敗時の状態を人前に出す handler は、 火曜日に private だった prover が水曜日に private でなくなる最も一般的な経路です。

## 監査が証明できることと、 できないこと

証明できるのは、 この runtime 上で公開された値がどれも予約済み mask の下にあり、 到達した capability が protocol のものだけで、 4 つの channel に policy 外の名前が出ていないことです。

証明できないのは 「誰も `A` を見なかった」 ことです。 `Share._value` は属性 1 つ分の距離にあり、 参加者は machine も image も持っています。 runtime は sandbox ではなく instrument です。 記録が証明できるのは `reached()` と `openings()` と `Disclosure` が言っていることちょうどであって、 それ以上ではありません。

## toy と production の差

field は列挙できる小さい素数、 party は 2〜5、 敵対者は不在、 triple は trusted dealer が配ります。 本物の co-SNARK では、 ここで 「policy」 と呼んでいるものは serialization schema と log の schema と metric の cardinality 制限として実装され、 その全部が review の対象になります。 この問題が主張しているのは 「その review を機械で回せる形に落とせる」 ことであって、 「落としたものが完全である」 ことではありません。

## 対象外

formal simulation-based proof、 timing / cache side channel、 malicious-secure MPC compiler、 実際の SNARK proof の privacy 解析。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
