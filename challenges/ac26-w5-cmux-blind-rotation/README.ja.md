# 誰も知らない角度で回す

> このトラックは Advanced Cryptography Program 2026 の非公式・独立コンパニオンです。
> コース運営とは無関係で、承認も受けていません。問題文・コード・fixture・図はすべて独立に書いています。
> このトラックへの質問はコース運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 540 · **Chapter:** Week 5 / CMUX and
Blind Rotation · **Role:** `mechanism` · **想定時間:** 75〜105 分 · **配点:** 300 ·
**前提:** `ac26-w5-rgsw-external` · **Status:** draft

## 物語

**暗号化された**ビットで 2 つの暗号文のどちらかを選びます。それを繰り返して、
計算の中の誰も知らない量だけ多項式を回します。コードも、鍵も、出力される trace も、
その角度を知りません。

環や RLWE や RGSW や external product を作り直すわけではありません。
`fixtures.generate` がすべて正しい形で提供します。それらは `ac26-w5-lwe-rlwe` と
`ac26-w5-rgsw-external` の成果物です。この問題は選択そのものと、その選択が積み上がる先です。

## CMUX は 1 行

```text
CMUX(c, ct0, ct1) = ct0 + ExternalProduct(c, ct1 - ct0)
```

external product が `RLWE(0) + mu * (ct1 - ct0)` を返すので、和は `mu` が 0 なら `ct0`、
1 なら `ct1` になります。この式のどこにも分岐はありません。

候補は毎回両方とも計算されます。これは無駄ではありません。必要な方だけ計算するには
どちらが必要かを知っている必要があり、あなたは知りません。

## 規約は固定

```text
plaintext_modulus = 4        delta = q // 4
X^(2N) = 1                   指数は N ではなく 2N を法として正規化する
X^N   = -1                   1 回巻けば符号が反転し、 2 回で戻る
phase = (body - sum(mask[i] * secret[i])) mod 2N
```

**2 ではなく 4 です。** negacyclic な回転は degree N を跨ぐたびに係数を反転しますが、
平文 modulus が 2 だとこの反転は見えません。 `-delta == delta (mod q)` だからです。
`X^N = -1` を完全に無視した実装が満点を取れてしまいます。 4 なら反転は
`m -> (-m) mod 4` として平文に出ます。

**N ではなく 2N です。** `X^(2N) = 1` なので指数の法はこちらです。 N で割った余りを取ると
落ちるのは「何回巻いたか」の偶奇、つまり符号です。 circular shift との差は全部そこにあります。

## blind rotation

LWE sample は `Z_(2N)` 上の `(mask, body)` で、すでに指数の法の中にあります。
`blind_rotate` は secret を一切渡されずに `X^(-phase) * accumulator` へ辿り着かなければ
なりません。 `body` は**公開値**で、秘密なのはビットだけ、そのビットは
`key[i] = RGSW(bit_i)` として届きます。

つまり最初の offset 回転に CMUX は要らず、各 mask 係数は対応する鍵の行を通して
条件付きに適用されます。ループを書く前に形を出してください。それがこの構成を
成立させているものです。

## 自分のテストではなぜ捕まらないか

`monomial_rotate` **と**ループの回転方向を両方逆にすると、ループを自分の
`conditional_rotate` と突き合わせるテストは通ります。 public test の最後の 1 つが
まさにそれで、何も証明していません。

そこで hidden test は、 phase から平文で回転を計算したモデルと比較します。
そのモデルはあなたの関数を 1 つも呼びません。

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

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点。

| Checkpoint | 配点 | 検査内容 |
|---|---:|---|
| `combine` | 25 | 両方の半分を足し引き、差の向き、短い係数列の padding |
| `cmux` | 45 | selector 0 で ct0、 1 で ct1 の平文。 selector を再暗号化しても結果が動かないこと |
| `constant` | 35 | 両方の候補を計算、鍵を全行読む、出力が入力のいずれとも不一致、復号ヘルパー未使用 |
| `rotate` | 40 | 符号付きの巻き戻り、指数の 2N 剰余、 0 と 2N で恒等、 N で符号反転、合成が加法的、暗号文の両半分 |
| `conditional` | 35 | 暗号化された 1 で回転、 0 で保持、候補の順序 |
| `blind` | 55 | あなたのコードを使わない平文モデルと一致、鍵を変えれば行き先も変わる、非正規化 sample の正規化 |
| `trace` | 35 | offset を含め step ごとに 1 レコード、最後が回転そのもの、公開 field が secret に依存しないこと |
| `transfer` | 30 | 見たことのない degree・dimension・base・modulus で上記すべて |

8 つのうち 7 つに hint があり、いずれもその checkpoint の 50% 上限の内側です。

## `constant` checkpoint が主張すること・しないこと

これは audit であって証明ではありません。あなたのコードが constant-time であることは
示せませんし、示そうともしていません。示すのは、選択が算術として行われたことです。
候補が両方とも計算され、 selector 暗号文が全行消費され、出力が入力のどちらでも作れない
暗号文であり、途中で復号ヘルパーに手が伸びていないこと。これらが算術による選択と
`if` の観測可能な差です。

## 退化ケース。これはバグではありません

mask の係数が 0 のとき、 2 つの候補は**同じ**暗号文になります。差はゼロ、その桁もゼロ、
external product はゼロ暗号文そのもの、出力は候補と bit 単位で一致します。
これは平文分岐ではありません。分岐する対象が最初から無かったということです。
mask の係数は `Z_(2N)` から引かれるので、これは 2N 回に 1 回起きます。まれではありません。
trace の検査も mutation suite もこれを織り込んでいます。

mutation の候補のうち 2 つは、まさにこの理由で生き残らせるのではなく**外しました**。
差がゼロ暗号文のとき `ct0` を返すことも、 mask 係数が 0 の step を飛ばすことも、
reference が既にやっていることです。殺せない項目を一覧に残すと
`SURVIVED` の行を無視してよいと教えることになります。

## 対象外

sample extraction と key switching (次の問題)、 programmable bootstrapping と HomNAND
(その次)、 modulus switching、 constant-time 保証、最適化された blind rotation。

## これは安全ではない

パラメータは全列挙できる大きさで、 secret は線形代数で復元できます。
機構の toy であって、困難性の toy ではありません。

## 出典との対応

Week 5 の教材は公開済みなので、 `courseAlignment` は `week5/README.md` を `lecture`、
`week5/problems/tfhe-toy-python/README.md` を `assignment` として pin しています。
`spoilerPolicy` は `independent-reimplementation` で、 API・パラメータ生成・記述は独自であり、
公式課題から関数名も fixture も skeleton も取っていません。

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

`make reference-test` が mutation suite を走らせます。 24 個の壊れた実装のうちいくつかは
`monomial_rotate` とループの両方で同時に間違っており、平文モデルまで来て初めて
reference と分かれます。
