# 暗号文からプログラムへ — なぜ LWE の次に RLWE が必要なのか

> このトラックは Advanced Cryptography Program 2026 の非公式・独立コンパニオンです。
> コース運営とは無関係で、承認も受けていません。問題文・コード・fixture・図はすべて独立に書いています。
> このトラックへの質問はコース運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 520 · **Chapter:** Week 5 / LWE and RLWE · **Role:** `mechanism` · **想定時間:** 75〜105 分 · **配点:** 300 · **前提:** `ac26-w5-encoding-noise` · **Status:** draft

## まず最終ゴールを固定する

この問題のゴールは「LWE と RLWE の定義を覚える」ことではありません。
Week 5 全体の最終ゴールは、**暗号文のままプログラムを実行すること**です。

```text
秘密の入力 m
    ↓ 暗号化
Enc(m)
    ↓
    ↓ クラウドが中身を見ずにプログラム f を実行
    ↓
Enc(f(m))
```

一般的なプログラムは論理ゲートへ分解でき、NAND だけでも任意の Boolean 回路を構成できます。
したがって Week 5 の具体的な到達点は、

```text
Enc(a), Enc(b)
    ↓ HomNAND
Enc(NAND(a,b))
```

を作ることです。

この問題は、その途中にある **「なぜ LWE から RLWE へ移る必要があるのか」** を体で理解するための問題です。

---

## ストーリー: LWE だけでは何が足りないのか

前の問題で、LWE の暗号文は概念的には

```text
b = <a, s> + encode(m) + e  (mod q)
```

で、暗号文どうしの加算などができることを確認しました。

しかし最終的に欲しいのは、単なる足し算ではありません。

```text
m を秘密のまま受け取り、f(m) を返したい
```

TFHE ではこの `f(m)` を **表引き**として考えます。

たとえば、

```text
f(0)=7, f(1)=4, f(2)=9, f(3)=1
```

なら、答えを並べておき、入力に対応する位置を先頭へ持ってくればよい。

```text
[7, 4, 9, 1]
      ↑ m=2

回転
  ↓

[9, 1, 7, 4]
 ↑
 f(2)
```

つまり欲しい計算は **「値に応じて表を回す」** です。

LWE の `(a,b)` だけでは、この「係数を並べた表」と「回転」を自然に表現しづらい。
そこで、値の入れ物を **多項式** に広げます。

```text
v(X) = 7 + 4X + 9X² + X³
```

この多項式を回転できる計算空間を得るために RLWE を導入します。

> **RLWE は突然出てくる別の暗号ではない。関数表を多項式として持ち、回転できるようにするための表現拡張。**

これがこの問題で一番重要な理解です。

---

## 有限体ではなく「有限の環」が主役

ここは Week 3/4 と混ざりやすいところです。

この問題で使うのは主に

```text
Z_q
R_q = Z_q[X] / (X^N + 1)
```

です。

`Z_q` は `q` が素数なら体ですが、`q` が合成数なら体ではありません。
それでも足し算・掛け算・分配則が使えるので **環**として計算できます。

この Week 5 を「有限体の暗号」と理解すると混乱します。

```text
Week 3/4
  有限体上の多項式・回路を使って「正しさを証明する」

Week 5
  mod q の環・多項式剰余環・格子暗号を使って「秘密のまま計算する」
```

見た目はどちらも `mod` ですが、役割が違います。

---

## LWE と RLWE は同じ設計図を使う

LWE:

```text
secret s は {0,1}^n
b = <a,s> + encode(m) + e   (mod q)
```

RLWE:

```text
secret S(X) は係数 0/1 の多項式
B(X) = A(X)S(X) + encode(M(X)) + E(X)   (R_q の中)
```

共通しているのは、

```text
秘密鍵で作るマスク + メッセージ + noise
```

です。

違うのは **計算の単位**です。

| | LWE | RLWE |
|---|---|---|
| 入れ物 | 数・ベクトル | 多項式 |
| 秘密鍵 | ベクトル `s` | 多項式 `S(X)` |
| 演算 | 内積・mod q | 多項式加算・negacyclic 乗算 |
| 目的 | noise と暗号文計算を最小形で見る | 回転・係数操作を可能にする |

RLWE は「長い LWE」ではありません。
**積の定義が変わるため、できる計算の形が変わります。**

---

## なぜ `X^N + 1` で割った余りを使うのか

環は

```text
R_q = Z_q[X] / (X^N + 1)
```

です。

つまり、

```text
X^N = -1
```

として計算します。

たとえば `N=4` で、

```text
V(X)=a0+a1X+a2X²+a3X³
```

に `X` を掛けると、

```text
X V(X)
= a0X + a1X² + a2X³ + a3X⁴
≡ -a3 + a0X + a1X² + a2X³
```

係数列では、

```text
[a0, a1, a2, a3]
    ↓ ×X
[-a3, a0, a1, a2]
```

です。

**多項式の掛け算が回転になる。**
これが後の Blind Rotation の土台です。

この問題で `negacyclic` の符号 1 つを厳密に扱う理由は、単なる数学の意地悪ではありません。
この符号を間違えると「回転」が違うものになり、その後の PBS 全体が壊れます。

---

## この問題を解いたあと、何につながるのか

この問題の出口は次です。

```text
LWE
  ↓
RLWE: 多項式に移る
  ↓
× X^k で係数を回転できる
  ↓
でも回転量 k = b - <a,s> には秘密鍵 s が入る
  ↓
秘密鍵を見せずに回したい
  ↓
RGSW + CMUX
  ↓
Blind Rotation
  ↓
Sample Extraction
  ↓
Key Switching
  ↓
Programmable Bootstrapping
  ↓
HomNAND
  ↓
NAND を組み合わせてプログラム
```

したがって、この問題でコードを書くときも「正しい RLWE を実装する」だけで終わらせません。
各 checkpoint で **その処理が最終的に何を可能にするか** を確認してください。

---

## 実装で見るべき 4 本の線

### 1. LWE: `phase` を取り出す

```text
b - <a,s> = encode(m) + e
```

noise が小さければメッセージへ戻せる。

### 2. RLWE: 同じ構造を係数ごとに持つ

```text
B - A*S = encode(M) + E
```

同じ思想を多項式へ持ち上げます。

### 3. `negacyclic_mul`: 回転規則を実装する

`X^N=-1` をコードに落とし込みます。
ここでの符号が Blind Rotation の意味を決めます。

### 4. correspondence: 「何が同じで何が変わったか」を言語化する

暗号式の形は同じ。
しかし表現と演算が変わり、**回転という新しい能力**を得ます。

---

## 自分の往復テストではなぜ捕まらないか

符号を間違えた積を使って暗号化し、同じ間違った積で復号すると、両方の間違いが打ち消し合うことがあります。

つまり、

```text
wrong encrypt
    ↓
wrong decrypt
    ↓
一見正しい
```

という自己整合が起きます。

そこで hidden test では往復を**交差**させます。
こちらで暗号化して fixture 側で復号し、その逆も行います。

間違った積は `participant.wrong_ring.cyclic_mul` として明示してあります。
`make inspect` でも同じ入力に対する cyclic / negacyclic の差を確認できます。

---

## sample せず、渡す

`lwe_encrypt` と `rlwe_encrypt` は mask と noise を引数で受け取ります。
この問題の主題ではない CSPRNG を持ち込まず、実行を再現可能にするためです。

実装は本来どちらも sample します。
また、同じ鍵の下で mask を使い回すと、暗号文の差から mask 項が消え、平文差と noise が残るため安全ではありません。

---

## Participant Portal での進め方

1. Participant Portal で問題を起動する。
2. **証拠を調べる**で、この deploy 固有の fixture と公開された証拠を読む。
3. Portal のエディタで starter のソースを編集する。
4. **公開テストを実行**を押す。
5. 各 checkpoint を提出する。

checkout、ターミナル、ローカルエディタ、別画面へのコピペは不要です。

---

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点。

| Checkpoint | 配点 | 検査内容 | ストーリー上の意味 |
|---|---:|---|---|
| `normalize` | 30 | `X^N=-1` で次数 < N へ畳む | 回転規則を作る |
| `ring` | 45 | negacyclic 乗算・分配則・交換則 | 多項式上で計算できる |
| `lwe` | 40 | phase・noise・交差往復 | 出発点の暗号文構造 |
| `rlwe` | 40 | 多項式版の暗号化・復号 | 回転可能な表現へ移る |
| `correspondence` | 30 | LWE/RLWE の対応 | なぜ拡張したか説明する |
| `boundary` | 40 | noise の許容範囲 | 計算を続ける限界 |
| `transfer` | 30 | 未知パラメータへの一般化 | 式ではなく構造を理解したか |
| `defense` | 45 | 不正暗号文を reject | 実装境界を守る |

8 つのうち 5 つに hint があり、いずれもその checkpoint の 50% 上限の内側です。

---

## この問題を終えたら自分の言葉で答える

次の 5 問がこの問題の本当の合格条件です。

1. 最終ゴールはなぜ RLWE の実装ではなく「暗号文のままプログラム」なのか。
2. LWE から RLWE へ移ると、何が新しくできるようになるのか。
3. `R_q = Z_q[X]/(X^N+1)` は必ず有限体なのか。なぜ「環」と呼ぶのが安全なのか。
4. `X` を掛けることが、なぜ係数の回転になるのか。
5. その回転が、なぜ次の Blind Rotation → PBS → HomNAND につながるのか。

---

## 対象外

具体的な security parameter の選定、CSPRNG、constant-time 実装、NTT / FFT、実用 LWE / RLWE ライブラリは対象外です。

schoolbook 乗算を使うのは、`X^N=-1` の符号規則を変換の裏へ隠さず、まず直接理解するためです。

---

## これは安全ではない

`n`・`N`・`q` は全列挙できる大きさで、secret は数個の sample から線形代数で復元できます。
この問題は **機構の toy** であって production security を主張しません。

---

## 出典との対応

Week 5 の教材は公開済みなので、`courseAlignment` は `week5/README.md` を `lecture`、`week5/problems/tfhe-toy-python/README.md` を `assignment` として pin しています。
`spoilerPolicy` は `independent-reimplementation` です。

---

## 保証範囲

ローカル実行は自習用の honor-system 検証です。
Workbench は starter・公開テスト・公開用の誤実装・表示コードを持ち、fixture・hidden test・verifier は採点側に分離しています。

verifier が保証するのは、提出コードが採点処理をハングさせたり、別 checkpoint の点を得たり、期待値を直接漏らしたりしないことです。
fixture は deploy seed 由来なので暗記した答えは持ち越せません。

競技順位・試験・修了判定には participant が管理しない verifier が必要で、[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

---

## コスト

ゼロ。クラウドアカウントも AWS リソースも不要です。

---

## 作問者向け

`make reference-test` が mutation suite を走らせます。
自己整合的な誤実装を捕まえるため、暗号化と復号の実装を交差させるテストを重視します。

生成される secret は少なくとも 1 つ `1` を含むよう強制します。
全ゼロ secret では mask 項が消え、方式全体が `encode(m)+noise` に退化し、誤った符号規約を検出しにくくなるためです。
