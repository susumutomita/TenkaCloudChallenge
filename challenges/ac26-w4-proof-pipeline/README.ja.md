# 9 層ある 1 個の箱

> このトラックは Advanced Cryptography Program 2026 の非公式・独立コンパニオンです。
> コース運営とは無関係で、承認も受けていません。問題文・コード・fixture・図はすべて独立に書いています。
> このトラックへの質問はコース運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 430 · **Chapter:** Week 4 / Proof
System Pipeline · **Role:** `transfer` · **想定時間:** 60〜90 分 · **配点:** 300 ·
**前提:** `ac26-w4-arithmetization`, `ac26-w4-commit-open` · **Status:** draft — 「Week 4
の対応づけ」を参照。

## 物語

「SNARK」「STARK」はプロトコル名ではなく族の名前です。 1 個のブラックボックスとして扱うと
「succinct だから速い」「transparent だから何も仮定しない」といった文が出てきますが、
どちらも別々の軸を混同しています。

そこでこの問題は proof system を作りません。 2 つを **stage graph** として渡し、壊します。

```text
input-boundary → arithmetization → polynomial → commitment
               → transcript → opening → [low-degree] → verifier
```

**run** は 1 回の実行の記録です。何を commit したか、challenge を引く前に何を吸収したか、
verifier が実際にどの opening を検証したか。層ごとに 1 つ contract を書き、
そのうち 1 つだけが壊れた run を診断します。

## 2 つの pipeline は同じ形ではない

|  | A | B |
|---|---|---|
| family | circuit 指向・succinct | trace 指向・transparent |
| setup | trusted、回路ごと | transparent、なし |
| 依拠する仮定 | SRS を残さないこと、pairing の困難性 | 衝突困難ハッシュ、random oracle |
| stage 数 | 8 | 9 |
| 追加の層 | — | `low-degree`（`opening` と `verifier` の間） |
| 最小 query 数 | 1 | 8 |

どちらも実在 scheme の実装ではなく、実在 scheme の名前も付けていません。重要なのは
**A から決め打ちしたものは B で必ず外れる**ことです。stage 名も、層の順序も、query の下限も、
そもそも存在する artifact も違います。hidden check はすべて両方に対して走ります。

## 罠になっているフィールド

`run["commitment_ok"]` はこの問題のすべての run で `True` です。正常な run でも壊れた run でも。
commitment が成功したという事実は、prover が何かに commit したことを言うだけです。
commit した中身が制約系を満たすかについては何も言わず、
verifier が opening を検証したかについても何も言いません。

これを読む contract は public test を通り、`constraints` checkpoint で落ちます。

## 最悪ではなく最初

input boundary が 1 つ壊れると、opening も transcript も verifier も壊れて見えます。
`first_fault` が返すのは**最初**の層です。opening を指す診断は、
正しく仕事をしていた stage を直しに人を送り出すからです。

`repair` が変えてよいのは run の**フィールド 1 つだけ**、fault が壊したそのフィールドです。
これがなければ通ってしまう 2 つの近道を、この制約が塞いでいます。

- definition から正常な run を組み直すと、すべての contract を満たしたうえで証拠が消える。
- verdict を `reject` にすると、すべての contract が一度に黙る。

ただし verdict を倒すことが**正解の修復**である fault が 1 つだけあります。それがどれかを見つけ、
なぜ例外なのかを説明できることが、この checkpoint の大部分です。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` でこの deploy 固有の fixture と公開された証拠を読む。
3. 画面内のエディタで starter のソースを編集する。
4. `test` で公開テストを実行し、直接回答欄があれば証拠から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Participant Portal へ貼る。

checkout、ターミナル、ローカルエディタは不要です。code checkpoint は編集したソースを提出します。
直接回答は `prepare` が現在の deploy seed へ結び付けるため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点。

| Checkpoint | 配点 | 検査内容 |
|---|---:|---|
| `graph` | 30 | artifact ごとの producer と consumer、setup を含むこと、dangling の検出 |
| `wiring` | 35 | verifier が入力を受け取ること、prover 専用 artifact が漏れないこと、setup material の一致 |
| `constraints` | 40 | 未充足の制約があるのに accept したこと、commitment が渡されたものを束縛すること |
| `transcript` | 45 | challenge が消費するものを、引く前にすべて吸収したこと |
| `opening` | 40 | 必要な opening を件数ではなく名前で検証、pipeline ごとの query 下限、low-degree は在る側だけ |
| `assumptions` | 30 | setup の種別、transparency、そして両方とも仮定リストが空でないこと |
| `cost` | 30 | 支持されない 4 claim を落とし、支持される 4 claim を残す |
| `diagnose` | 50 | 9 種類の fault で最初の層を特定し、1 フィールドだけ直す |

8 つのうち 5 つに hint があり、いずれもその checkpoint の 50% 上限の内側です。

## claim は何のためにあるか

Workbench の `inspect` が出す 8 つの claim のうち 4 つが支持されません。どれも恣意的な誤りではなく、
名前の付いた誤解に対応しています。

- 「A は succinct だから prover が速い」 — proof size と prover コストは別の軸。
- 「B は transparent だから何も仮定しない」 — transparency は **setup** の性質。
  B は衝突困難ハッシュと random oracle を必要とし続ける。
- 「A の setup は一度きりの ceremony だから何も仮定しない」 — 同じ混同の裏返し。
- 「B の proof は A より小さい」 — polylogarithmic は constant より小さくない。

残る 4 つは正しいので、全部を落とす実装は profile を読む実装より高い点にはなりません。

## 対象外

Groth16 / PLONK / STARK の完全実装、benchmark の実測値、setup ceremony、
proof generation service はいずれも対象外です。ここでのコストはすべて**宣言されたクラス**であって
測定値ではなく、この問題が行う比較は宣言クラス同士の比較だけです。

## Week 4 の対応づけ

Week 4 の教材は pin した commit 時点で未公開です。 `courseAlignment` は `week4/README.md` を
`kind: "placeholder"` で pin し、role は `transfer` にしてあります。
`GOVERNANCE.md` §6 が未公開週に許す 2 つの role のうちの 1 つです。
公式課題が何を要求するかについては何も主張していません。 #229 で教材公開時に更新します。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image も
あなたの管理下にあるので、 image の中身はあなたに対して秘匿されていません。
`reference/` と `tests/hidden/` を bind-mount しないのは、あなたの git checkout に
紛れ込ませないためであって、手が届かなくするためではありません。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロ。クラウドアカウントも AWS リソースも不要です。

## 作問者向け

`make reference-test` が mutation suite を走らせます。 19 個の壊れた実装は、どれも typo ではなく
もっともらしい読み違いです。ほとんどが public test と正常な run を通り、
壊れた pipeline か、A ではなく B のときにだけ違いが出ます。

mutation の候補のうち 2 つは、生き残らせるのではなく**外しました**。 prover 専用集合から
`verdict` を除く操作（`verdict` を公開する run はそもそも無いので判定が変わらない）と、
`dangling_artifacts` の出力を sort する操作（hidden test は比較前に sort する）です。
結果を変えられない mutation は網羅性の証拠になりませんし、殺せない mutation を一覧に残すと
`SURVIVED` の行を無視してよいと教えることになります。
