# 同じ答えを返す 8 つの prover が、それぞれ別のことを言っている

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 630 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `transfer` · **想定時間:** 60〜90 分 ·
**配点:** 300 · **必須前提:** `ac26-w6-cosnark-linear`、`ac26-w6-cosnark-beaver` ·
**Status:** draft

## ストーリー

co-SNARK prover は前の 2 問で完成しました。線形部分は 0 round、乗算はちょうど 1 round。どちらも
この問題では答えのまま渡されます。

```text
A = Σ_j a_j w_j        B = Σ_j b_j w_j        C = A × B        (mod p)
```

渡されるのは、その上に乗った 8 つの実装 `S1`〜`S8` です。**8 つとも、全 seed・全 shape で `C` を
`A × B` に正しく復元します** — 96 通りの実行で 96 通りとも一致します。correctness test には区別が
付きません。それがこの問題の前提であって、ネタバレではありません。

違うのは、それぞれが何を、どの出口から外へ出すかです。

```text
artifact   次の段が受け取るもの
log        動きながら書き出す行
metrics    運用者が拾う名前付きの数
error      入力が壊れていたときに出るもの
```

correctness test が見るのは 1 番目の 1 field だけです。8 つのうち 3 つは残りの 3 つしか使いません。
1 つは 4 つのどれからも漏らさず、1 つは何も言わないまま全 party の share を読みます。

## 新しいところ

前問の runtime は `reconstruct` を渡しませんでした。あそこではそれが正しい既定でしたが、ここでは
違います。実在の MPC library は reconstruction も cross-party な debug hook も structured logging も
提供します。運用者が必要とするからです。取り上げてしまえば、この問題が扱いたい defect の class は
そもそも書けなくなり、監査対象になりません。

そこで `AuditRuntime` はそれらを渡し、何に到達したかを記録します。

```text
runtime.reached()     到達した capability: {"capability", "party", "operands"}
runtime.openings()    開示の記録:          {"roundId", "shareIds", "maskedBy"}
runtime.events()      操作の全 trace
```

operand の id だけで、**値は記録しません**。記録は transcript ではなく証拠です。capability に到達
すること自体は違反ではありません — `d` と `e` を公開するのは protocol です — 判断するのはあなたの
仕事です。

specimen の id は不透明で、2 つは capability をそれを綴らない名前で呼び出します。
`grep("reconstruct")` は何も見つけません。capability の記録は見つけます。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` でこの deploy 固有の fixture と公開された証拠を読む。
3. 画面内のエディタで starter のソースを編集する。
4. `test` で公開テストを実行し、直接回答欄があれば証拠から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Participant Portal へ貼る。

checkout、ターミナル、ローカルエディタは不要です。code checkpoint は編集したソースを提出します。
直接回答は `prepare` が現在の deploy seed へ結び付けるため、別 deploy からコピーした値は拒否されます。

## 採点

8 個の checkpoint を独立に採点します。不正解は 1 回 15 点減点です。

| Checkpoint | 配点 | 見るもの |
|---|---:|---|
| `classify` | 30 | descriptor の catalog を 6 class へ。開示済みなのに秘密のままの entry が 2 つ |
| `capability` | 40 | 到達した capability 全部。1 つは 2 回目の malformed な probe が要る |
| `open-set` | 40 | mask **と** 宣言 round。片方だけの規則はそれぞれ別の実装を通す |
| `cross-party` | 30 | party 境界を越えた読み取り。disclosure が完全に clean な実装で |
| `leakage` | 45 | 4 channel すべてを、name policy **と** kind policy の両方に照らす |
| `evidence` | 45 | serialize された disclosure から秘密を導出し、取得元の pair を名指す |
| `repair` | 45 | correctness・open set・round 数・schema・失敗時の無開示を同時に |
| `transfer` | 25 | 見たことのない設定と、見たことのない実装で全部 |

hint は 8 つのうち 7 つ (12〜18 点)。全部開けても 300 点中 190 点が残ります。

## 気づくのは簡単で、何が漏れたかを言うのは難しい

この問題は 35 個の壊れた監査を同梱していて、そのうち **29 個は 8 つの specimen 全部について
「clean か否か」を正しく答えます**。`make reference-test` が毎回この数を測ります。

checkpoint が exact な pair と exact な値を要求するのは、そのためです。正しい prover を間違った
理由で指した監査は finding ではなく偶然で、次の実装では生き延びません。

実測すると、各 checkpoint は自分の defect を捕まえる唯一の checkpoint です (別 seed で全部を
再実行する `transfer` を除く)。1 つだけ 2 つ同時に落ちるものがあります。`_authorized` を「mask が
あったか」だけ、あるいは「round が正しかったか」だけに壊すと `classify` **と** `open-set` が
両方落ちます。その 2 つは同じ問いを訊いているからです。

## 開示されたからといって、開示してよかったわけではない

1 回の Beaver 乗算が許可する開示はちょうど 2 つ、mask された `d` と `e` で、どちらも乗算自身の
round id の下です。開示が authorized なのは**両方**成り立つときだけです。

- 祖先に予約済みの triple mask がある (`maskedBy` が空でない)、かつ
- `roundId` が relation の宣言した round である

前者を欠く開示は、何にも隠されていない値を公開しました。後者を欠く開示は、mask を、それが引かれた
相手ではない値に使いました。triple の再利用が変装しているだけです。

## 監査が証明できることと、できないこと

証明できるのは、この runtime 上で公開された値がどれも予約済み mask の下にあり、到達した capability
が protocol のものだけで、4 つの channel のどれにも policy 外の名前が出ていないことです。

証明できないのは「誰も `A` を見なかった」ことです。`Share._value` は属性 1 つ分の距離にあり、
マシンも image もあなたのものです。runtime は sandbox ではなく instrument で、記録しているのは
「その計算が何を公開したか」であって「書いた人が何を見たか」ではありません。

限界を 2 つ、暗黙にせず書いておきます。log の policy 対象は構造化された record の中の **field 名**
なので、message の文面に秘密を書く実装はここでは捕まりません。先に文字列へ潰してしまえば、この問題
は正規表現の練習になっていました。もう 1 つ、他の party へ開示されたが channel には出ていない値は、
設計上 disclosure の監査からは見えません — それは `leakage` ではなく `open-set` の担当です。

## この先

Week 6 の残りは MPC を離れて stack の zkVM 側へ行きます。持ち越されるのはこの問題の問いです。
primitive が正しいことと system が約束を守ることは別の主張で、誰もが書くテストが見ているのは
片方だけです。

## 対象外

formal simulation-based proof、timing / cache side channel、malicious-secure MPC compiler、
実際の SNARK proof の privacy 解析。

## これは安全ではありません

field は列挙できる小さい素数、party は 2〜5、敵対者は semi-honest ですらなく不在、triple は trusted
dealer が配ります。機構の toy です。

## 出典との対応

Week 6 の教材は上流で公開されているので、`courseAlignment` は `curriculum.md` が記録している commit
の `week6/README.md` と `week6/problems/co-snark-prove/README.md` を pin します。公式演習の template・
係数・fixture・解答は転載していません。relation も runtime も specimen も disclosure sink も policy も
独自に書いたもので、公式演習が支給する primitive はこの問題が監査する対象であって、この問題が採点する
コードではありません。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image も
あなたの管理下にあるので、 image の中身はあなたに対して秘匿されていません。
`reference/` と `tests/hidden/` を bind-mount しないのは、あなたの git checkout に
紛れ込ませないためであって、手が届かなくするためではありません。hidden checker が読む
ground truth も同じです。それを import した監査は何も監査していませんが、そうしないと
決められるのはあなただけです。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した監査 35 種類と verifier を狙った 1 種類が
あります。35 種類のうち何個が依然として全 specimen の verdict を正しく答えるかを毎回印字します。この
README が引用しているのはその数で、後の変更で checkpoint が安くなればその数が動き、主張のほうを
直します。
