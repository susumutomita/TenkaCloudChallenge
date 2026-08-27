# 誰も witness を持たないまま、証明の半分を組み立てる

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 610 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `mechanism` · **想定時間:** 60〜90 分 · **配点:** 300
· **必須前提:** `ac26-w2-secret-sharing`、`ac26-w2-linear-shares` · **Status:** draft

## ストーリー

co-SNARK は、**どの prover も単独では持っていない** witness についての証明を作ります。witness は
party 間に秘密分散されていて、prover の計算そのものが MPC の上で走ります。

高くつきそうに聞こえますが、半分はただです。

```text
A = Σ_j a_j w_j        B = Σ_j b_j w_j        (mod p)
```

`a` と `b` は公開の係数ベクトル、`w` は分散された witness。加法的 sharing では

```text
Σ_j a_j * [w_j]_party  =  [Σ_j a_j * w_j]_party
```

が party ごとに**独立**に成り立ちます。公開定数倍も、同じ party が持つ share 同士の加算も、1 party
が単独でできることなので、co-SNARK prover の線形層は全部で 0 round です。これが崩れるのは乗算で、
それが次の問題です。

## 支給されるものと、変わったところ

Week 2 の加法的秘密分散と share 上の局所演算は支給されます。どちらも再実装しません。変わったのは
share の型です。

```text
Share.party    どの party が持っているか
Share.field    どの体の元か
Share.id       trace が値を言わずに operand を名指すための名前
```

Week 2 は sharing を `list[int]` として扱い、添字を引かせました。授業内容が算術ならそれで十分です。
**誰が何を読んでよいか**が授業内容になった時点で、share を int のままにしておくことはできません。

渡される runtime には `party_scope`、`value_of`、`add`、`mul_public`、`zero`、`events()`、
`violations()`、`ancestry()`、`issued()` があります。`reconstruct` はありません。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが表示される。
2. **証拠を調べる**で、この deploy 固有の fixture と公開された証拠を読む。
3. Portal のエディタで starter のソースを編集する。
4. **公開テストを実行**を押し、直接回答欄があれば証拠から埋める。
5. 各 checkpoint をそのまま提出する。Portal が現在のファイルと回答を準備して送る。

checkout、ターミナル、ローカルエディタ、別画面、コピペは不要です。code checkpoint は現在の
エディタ内容を使います。直接回答は現在の deploy seed へ結び付くため、別 deploy からコピーした
値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `relation` | 30 | 係数の正準形と、体を記述していない行の拒否 |
| `witness` | 30 | shape・party 順・field stamp・重複を、値を読まずに検める |
| `combine-a` | 40 | 局所演算だけで組み、witness を位置で引く |
| `combine-b` | 40 | 両半分をそれぞれの係数から。畳む前に witness を検める |
| `audit` | 50 | 結果が runtime 発行で、その party 自身の入力だけを祖先に持つ |
| `trace` | 45 | round・message・party を log から読み出す |
| `equivalence` | 40 | 全 4 shape で平文の関係式と一致し、再分散しても不変 |
| `transfer` | 25 | 未知の体・party 数・witness 長で全部成立させる |

hint は 8 つ中 7 つにあります (各 12〜20)。全部開いても 300 点中 188 点が残ります。

## 正しい A と B は、見た目ほど何も保証しない

この問題は 24 個の壊れた実装を同梱していて、そのうち **18 個は全 shape で A と B を正しく復元し
ます**。`make reference-test` が毎回この数を測ります。

内訳は 3 つ。**値は正しいが形が違う** — `-3` を、その元の正準な名前である `94` に直さずに relation
を保存する。**値は正しいが検めていない** — party 順が入れ替わった sharing や、同じ sharing が 2 箇所
に入った witness を、そのまま畳む。**値は正しいが自己申告が嘘** — `rounds: 0` を log ではなく信念
から返す。

このうち 1 つがこの問題の本題です。各 sharing を足して `w` を復元し、平文で `A` と `B` を計算して
share し直す実装は、全 seed・全 shape で完璧な `A` と `B` を返します。実測すると、これを落とす
checkpoint は `audit` **1 つだけ**です。

## audit が証明できることと、できないこと

証明できるのは、結果の share が runtime によって発行され、その ancestry がその party 自身の入力
share にしか行き着かず、refused read が 1 件も無いことです。これは本物の性質で、上の shortcut は
ここで落ちます。

証明**できない**のは「witness が一度も組み立てられなかった」ことです。各 party の scope を順に開いて
自分の share を読むのは合法で、全 party 分やれば `w` が手に入ります。そのあと正直に畳めば trace は
完全に無害に見えます。`Share._value` に至っては属性 1 つ分の距離です。runtime は sandbox ではなく
instrument で、記録しているのは「その計算が何を消費したか」であって「書いた人が何を見たか」では
ありません。

これは演習の穴ではありません。本物の MPC の transcript が示すのは protocol の message pattern で
あって、ある party の運用者が入力の写しを持っていなかったことではない。この 2 つを混同すると
「MPC を使ったのだから漏れない」という結論に着地します。

## 0 round は答えであって、測定ではない

1 行も書く前から答えは分かっているので、`rounds: 0` と書いて返す報告には点がありません。`trace`
checkpoint は毎回、通信 event の入った log を渡します。1 round で 3 通運んだ log、2 round で 5 通の
log、何も運ばなかった round、この行の委員会の外の party からの message。log を読んでいれば全部
通ります。

## 次につながるところ

次の問題は乗算です。和の積は積の和ではないので、party は masked value を交換しなければなりません。
co-SNARK が払うコストは全部そこにあり、だからこそここで引く境界を正確に引く価値があります。

## 対象外

実際の SNARK proof 生成、malicious-secure MPC、network transport、prover 性能最適化。

## これは安全ではない

体は列挙できる小さい素数、party は 2〜5、敵対者は semi-honest ですらなく単に不在で、通信路も
committed randomness も preprocessing もありません。機構の toy です。

## 出典との対応

Week 6 の教材は上流で公開されているので、`courseAlignment` は `curriculum.md` が記録している commit
の `week6/README.md` と `week6/problems/co-snark-prove/README.md` を pin します。公式演習の template・
係数・fixture・解答は転載していません。relation も runtime も instrumentation も独自に書いたもので、
公式演習が支給する秘密分散 primitive はこの問題が土台にするものであって、この問題が採点するコード
ではありません。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。 Docker デーモンと compose stack の
全コンテナを持っている人に対して、隠された材料の閲覧を防ぐことはできません。ここでの境界は
誤配防止であって、その人に対する秘匿ではありません。あなたが build して動かす Workbench
コンテナが持つのは starter、公開テスト、`make inspect` の表示、そして支給される sharing 層
(`participant/mpc.py` — share、計測付き runtime、participant facade。 これは先行 2 問の答えで、
意図して渡しています) だけです。 seed 導出、隠しテスト、reference solution、verifier は
**入っていません**。それらは Workbench が compose network 越しに叩く、公開されない 2 つ目の
コンテナと、`make reference-test` が build する author 専用 image にしかありません。

そのため `make test` / `make test-one` / `make inspect` は先に verifier を起動します
(`make verifier-up` が自動で走ります)。`make inspect` はこのデプロイの setting・行・witness を
ローカルで導出せず、compose network 越しに verifier から読みます。停止は `make verifier-down` です。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。
提出は時間・メモリ・プロセス数・出力量の上限つきで実行され、両コンテナとも非 root・read-only・
特権なしで動き、host に公開されるのは Workbench だけ、しかも loopback だけです。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した提出 24 種類と verifier を狙った 1 種類が
あります。24 種類のうち何個が依然として正しい `A` と `B` を復元するかを毎回印字します。この README が
引用しているのはその数で、後の変更で checkpoint が安くなればその数が動き、主張のほうを直します。
