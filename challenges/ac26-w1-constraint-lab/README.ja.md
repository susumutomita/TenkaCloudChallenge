# 0 になるべき式の集まり

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 110 · **Chapter:** Week 1 / Arithmetic
Circuits · **Role:** `mechanism` · **想定時間:** 60〜90 分 · **配点:** 200
· **推奨前提:** `ac26-bridge-experiment`、`ac26-bridge-properties`

## ストーリー

新しい policy engine は if 文でアクセスを判断しません。判断を算術回路として表現します。そうすれば、
判断を下したサービスを信用しなくても、後から誰でも監査できるからです。

素晴らしい設計です。ただし monitor は 1 行しか出しません。`PASS` か `FAIL` かです。リクエストが拒否
され、誰かが「なぜ」と尋ねたとき、答えられる人がいません。あなたはその監査ツールを完成させます。

## この問題の主題

回路はプログラムではありません。**すべて 0 でなければならない式の集合**です。witness は各 signal へ
値を割り当てたものにすぎません。「この witness は回路を充足する」とは、すべての residual が 0 である
ということで、どれかが 0 でないとき、residual はどの主張が壊れたのかを教えてくれます。

制約は 5 種類、すべて `F_p` 上で評価します。

```text
mul      left * right - out
add      left + right - out
const    signal - value
boolean  signal * (signal - 1)
member   allowed の各要素との差の積
```

## 遊び方

Participant Portal で問題を起動すると、3 ファイルのエディタが問題文と同じ画面に表示されます。
証拠の確認、編集、公開テスト、residuals / boolean / membership / range の提出まで Portal 内で
完結します。first-broken は壊れた witness の trace を自分で読み、最初に違反した
constraint の id と非 0 の residual を JSON で Portal へ入力します。ホスト側のターミナルや checkout の
ファイル操作は必要ありません。

リポジトリから直接作問・検証する場合だけ、問題ディレクトリで次を実行できます。

```bash
make inspect              # 自分の field、circuit、正しい witness、壊れた witness
make test                 # 公開テスト
make test-one ID=trace    # 1 つだけ再実行する
make reset                # starter 3 ファイルを元に戻す
```

Portal のエディタまたは作問用 checkout で編集するのは 3 ファイルです。`local/starter/field.py` (F_p の演算)、
`local/starter/circuit.py` (residual と trace)、`local/starter/gadgets.py` (条件を制約へ変換)。

## 採点

5 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `residuals` | 45 | 3 つの hidden 素数、5 種類すべての kind を含む 6 本の回路を seed 由来の順で渡した評価器、壊れた witness の residual 行、signal 欠落 |
| `first-broken` | 40 | 公開の壊れた witness での最初の違反 `{ "constraintId": ..., "residual": ... }` |
| `boolean` | 35 | boolean gadget を参照 evaluator で field の**全要素**総当たり |
| `membership` | 30 | membership gadget を全要素で総当たり (許可集合サイズ 1〜5) |
| `range` | 50 | `range_constraints` / `range_witness`: 範囲内の各値が自分の witness で通り、範囲外の値は補助 signal のどの割り当てでも通らない (完全探索) — 幅 1〜2 / 3〜4 / 5〜6 bit で |

hint は 5 つ中 4 つにあります (15 / 15 / 10 / 10 + 10)。すべて開いても 200 点中 140 点が残ります。

gadget の 3 checkpoint は hidden checker の **参照 evaluator** (表の 5 kind しか知らない) で採点します。
participant 自身の `evaluate` は gadget の採点に使わないので、自分の evaluate だけが知っている kind は
通りません。range gadget に使えるのは `boolean` / `add` / `mul` / `const` のみ、本数は bits × 5 以下です。
`member` で 2^bits 個を列挙すると kind 規則で、積を手で並べると 3 bit 以上で本数上限で、幅の決め打ちは他の
幅で落ちます。範囲外が通らないことは witness 関数を信用せず、補助 signal の全割り当てを探索して判定します
(予算 20 万割り当て。超過は決定論的な message)。

## 公開テストでは落ちない 4 つの間違い

1. **`-1` は 0 ではなく、`p-1` も 0 ではありません。** 両者は同じ元です。引き算の結果をそのまま返す
   評価器は、中間値が負になった瞬間に壊れます。
2. **signal を `flag` と名付けても boolean にはなりません。** 値を縛るのは制約だけです。boolean
   checkpoint が field 全体を走査するのはこのためで、`2` だけを試す test なら「`b < 2` を検査する」
   実装でも通ってしまいます。
3. **正しい witness が 1 つ通っても何も示せません。** 制約が足りない回路でも、正直な witness では
   全 residual が 0 になります。`allowed[0]` だけを固定する membership gadget は、公開例がたまたま
   その値のときに通ります。
4. **自分の witness を通す range gadget が、何でも通すこともあります。** 公開テストは *自分の* witness を
   *自分の* 制約に代入して 0 を見るだけです。桁の boolean 制約を落としても、桁の和を signal に
   つながなくても、それは成り立ったまま——そのくせ、どんな値にも通る補助値の置き方ができています。
   両者を分けるのは全割り当ての探索だけで、hidden verifier がそれをやるのはそのためです。

## 公式 Week 1 課題との関係

これは `mechanism` 問題です。公式課題が前提とする読解力を作り、意図的にその手前で止まります。公式課題
は underconstraint を突きますが、そのためには「どの条件がどの式になっているか」を見られる必要があり、
それがここで作る trace です。講座の式・fixture・solution は一切転載していません (`GOVERNANCE.md` §2)。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。compose stack のすべてのコンテナと
Docker デーモンを管理する人を、中身の閲覧から止める手立てはありません。ここにある境界は
秘匿ではなく誤配送の防止です。build して動かす Workbench コンテナには starter と公開テスト
しか入っておらず、fixture も hidden test も参照解答も verifier 本体も入っていません。
それらは Workbench がネットワーク越しに話す、公開されていない second container と、
`make reference-test` が build する author 専用 image にだけあります。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。手元のコンテナだけです。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した提出 17 種類と、verifier 本体を通す near-miss
6 種類があり、すべて検出される必要があります。特定の規則を狙う mutation (架空の kind、id 順に並べ直した
trace、符号が逆の residual、`member` での列挙、積の鎖、signal につながない桁の和、探索予算を使い切らせる
自由 signal の水増し) は、無関係な理由ではなく *その規則の* message で殺されたことまで assert します。
壊れた constraint の位置と residual はどちらも seed 由来です。constraint 名の暗記でも二択でも、別 deploy へ
答えを持ち越せません。

hidden 回路は公開回路に 6 本目の signal `tier` への `member` 制約を足したもので、5 種類すべての kind を
使います。`trace` / `first_broken` には seed 由来の順 (identity と逆順は除く) で渡すので、id でソートする
実装は問題文の約束どおり落ちます。hidden label ごとに壊れる kind が違い (算術 / member / boolean)、
最初の違反の期待値は渡した順の上で参照 evaluator から導きます。

range の幅は label ごとに 1〜2 / 3〜4 / 5〜6 bit で、毎 deploy が「足し算の鎖が要らない 1 bit」と
「桁ごとの 2 倍の鎖 (6 bit で 26 本) が bits × 5 の上限すれすれになる最大幅」の両方を踏みます。その構成も、
2 のべきを `const` で置いて `mul` / `add` する構成も通ります。reference は Horner 形 (3 × bits − 2 本) です。
2^6 = 64 は `PRIMES` のどの素数より小さいので、`2^bits < p` に field ごとの上限は要りません。

`transfer` (別 seed で全 suite を再実行) は wave 5 で外しました。写経だけで取れる checkpoint だったため
です。hidden label はもともと、画面に出ない field・順序・幅で採点しています。
