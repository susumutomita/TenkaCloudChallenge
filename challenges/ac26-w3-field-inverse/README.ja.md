# 曲線の前に、体を作る

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 310 · **Chapter:** Week 3 / Finite Fields
· **Role:** `mechanism` · **想定時間:** 45〜60 分 · **配点:** 200

## ストーリー

楕円曲線のスライドはどれも `F_p` 上の方程式から始まり、1 分で先へ進みます。体は前提だからです。この
問題はその 1 分を真面目にやります。正規化から `F_p` を組み上げ、最後の乗法逆元だけが本当の中身を
持っています。

## 何を実装するのか

```python
class Field:
    modulus: int
    def element(self, value: int) -> FieldElement: ...

class FieldElement:
    def __add__, __sub__, __mul__, __truediv__
    def inverse(self) -> FieldElement: ...

def egcd(a, b) -> (g, s, t)          # a*s + b*t == g == gcd(a, b)
def egcd_trace(a, b) -> [ {q, r, s, t}, ... ]
def non_invertible_element(modulus) -> int
```

異なる法の元同士は、黙って演算されてはいけません。

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

7 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `normalize` | 25 | 負値、法以上の値、冪等性、等価判定 |
| `arithmetic` | 30 | 加減乗、単位元、分配、可換、結合 |
| `egcd-trace` | 35 | step 列を 1 行ずつアルゴリズム自身のものと突き合わせ |
| `inverse` | 35 | 素体の全非零元と、`a / b * b == a` |
| `errors` | 25 | zero、零除算、法の混在 |
| `composite` | 25 | 最小の非可逆元。素数法では存在しないこと |
| `axioms` | 25 | 見たことのない素数上での公理 |

hint は 7 つ中 4 つにあり、いずれもその checkpoint の 50% 上限内です。

## この問題が譲らない 2 つの区別

**integer は field element ではありません。** `-5` と `p - 5` は同じ元を指しますが、`-5` は正規形では
ありません。element を作る時点で正規化しておけば、負の入力も法以上の入力も以降は同じ経路を通ります。

**`pow(a, p - 2, p)` は「逆元」ではありません。** `p` が素数のときは逆元です。合成数 `n` では
`pow(a, n - 2, n)` も数を返しますが、それは逆元ではなく、検算しない限り気づけません。拡張 Euclid は
係数と一緒に gcd を返すので、**逆元が存在しない**と言えます。この問題の mutation suite の 1 つ目は
まさに Fermat 版で、素数の checkpoint を全部通り、合成数の checkpoint だけで落ちます。

## なぜ trace を 1 行ずつ突き合わせるのか

trace checkpoint は当初、各行が `a*s + p*t = r` を満たすことと、最終行が gcd と逆元に一致すること
だけを見ていました。**最終行だけを返す**変異がそれを生き延びました。1 行だけの表は、その条件を
すべて満たすからです。

現在は step 数と各行の `(q, r, s, t)` を参照実装の列と突き合わせます。floor 除算なので列は一意に
決まり、正解はちょうど 1 つです。

## 標本ではなく全数

`inverse` は素体の全非零元を回します。標本ではないので、一部の値を特別扱いする戦略は成立しません。
`axioms` はさらに、逆元写像が非零元上の**全単射**であることを検査します。体では逆元は一意で、異なる
元が同じ逆元を持つことはありません。

## trace は constant-time ではありません

Workbench の `inspect` が出す trace は入力に依存して分岐し、step 数も入力で変わります。実際の鍵を扱うコード
では、その性質そのものが side-channel です。これはアルゴリズムを読むためのものであり、production
実装の手本ではありません。

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

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した実装 8 種類があります。Fermat 版は素数の
checkpoint を全部通り、最終行だけの trace は当初の checkpoint を生き延びました。後者が、列全体を
突き合わせるようになった理由です。
