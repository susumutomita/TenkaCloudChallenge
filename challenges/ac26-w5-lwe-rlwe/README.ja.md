# 符号 1 つと、その下流すべて

> このトラックは Advanced Cryptography Program 2026 の非公式・独立コンパニオンです。
> コース運営とは無関係で、承認も受けていません。問題文・コード・fixture・図はすべて独立に書いています。
> このトラックへの質問はコース運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 520 · **Chapter:** Week 5 / LWE and
RLWE · **Role:** `mechanism` · **想定時間:** 75〜105 分 · **配点:** 300 ·
**前提:** `ac26-w5-encoding-noise` · **Status:** draft

## 物語

同じ形で、算術だけが違う 2 つの暗号方式です。

```text
LWE    secret s は {0,1}^n            b = <a, s> + encode(m) + e   (mod q)
RLWE   secret S は R_q、係数は 0/1     B = A * S + encode(M) + E    (R_q の中)
```

どちらも「秘密に何かを掛けたもの＋符号化したメッセージ＋noise」です。
違うのは演算と積載量です。 **RLWE は長いベクトルの LWE ではありません。**
積が別の積で、 RLWE の暗号文 1 つは 1 個ではなく N 個のメッセージを運びます。

環は `R_q = Z_q[X] / (X^N + 1)` で、要点は 1 つです。

```text
X^N = -1
```

次数 N を越えて巻き戻る係数は**符号が反転して**戻ってきます。この符号 1 つが
negacyclic な積と cyclic な積の違いで、そして cyclic な環も立派な環です。
公理をすべて満たし、分配し、可換で、あなた自身のテストを喜んで通ります。
ただこの環ではないだけです。

## 自分の往復テストではなぜ捕まらないか

符号を反転した内積は、符号を反転した phase と打ち消し合います。
平文を自分の中に持っている暗号文は、本物より上手に復号します。 cyclic な環は自己整合的です。
どれも、同じコードで暗号化して復号するテストなら通ります。

そこで hidden test の往復はすべて**交差**させて走ります。こちらで暗号化して fixture 側で復号し、
その逆も行います。自己整合的なだけの方式はこれを越えられず、本当に正しい方式は何も気づきません。

間違った積は `fixtures.generate.cyclic_mul` として書き出してあります。反例を、
自分でわざと壊したコードにではなく、**明示された**弱点に対して作れるようにするためです。

## sample せず、渡す

`lwe_encrypt` と `rlwe_encrypt` は mask と noise を引数で受け取ります。
この問題の主題ではない CSPRNG を持ち込まずに、すべての実行を再現可能にするためです。
実装は本来どちらも sample します。そして 1 つの鍵の下で mask を 2 回使い回すのは近道ではなく破綻です。
2 つの暗号文を引き算すると mask の項が消え、 2 つの平文の差と少しの noise が残ります。

## 遊び方

```bash
make inspect                 # 環、 LWE の trace、 RLWE の trace、 boundary sample
make inspect MODE=lwe        # 片方ずつ
make inspect MODE=rlwe
make test                    # public test
make reset                   # starter/lwe.py を元に戻す
```

secret は表示しません。どちらの trace も secret 無しで読めますし、鍵を映す trace は
悪い反射を教えます。 `MODE=debug` で明示的に opt-in できます。

編集するファイルは `local/starter/lwe.py` の 1 つだけです。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点。

| Checkpoint | 配点 | 検査内容 |
|---|---:|---|
| `normalize` | 30 | `X^N = -1` で次数 < N へ畳む、係数を `[0, q)` へ、冪等性、**2 回**巻き戻ると符号が戻ること |
| `ring` | 45 | 加算・減算・negacyclic 乗算、 `X^(N-1)・X = -1`、分配則と交換則 |
| `lwe` | 40 | 交差させた往復、 phase と noise の報告、暗号文が `a` と `b` しか持たないこと |
| `rlwe` | 40 | 同じことを環で、そして定数項だけでなく N 係数すべて |
| `correspondence` | 30 | 構造化した対比。どちらの演算か、積載量はいくつか |
| `boundary` | 40 | どの noise が生き残るか、そして**与えられた順序で**最初に予算を越える sample |
| `transfer` | 30 | 見たことのない degree・modulus・dimension・secret で上記すべて |
| `defense` | 45 | 不正な暗号文 8 個を reject し、正しい 4 個を通す |

8 つのうち 5 つに hint があり、いずれもその checkpoint の 50% 上限の内側です。

## 対象外

具体的な security parameter の選定、 CSPRNG や constant-time 実装、 NTT / FFT、
そして実用の LWE / RLWE ライブラリはいずれも対象外です。
schoolbook 乗算は意図的で、 NTT は同じ符号規約を教えなければ動かない変換の裏に巻き戻りを隠します。

## これは安全ではない

n・N・q は全列挙できる大きさで、 secret は数個の sample から線形代数で復元できます。
機構の toy であって、困難性の toy ではありません。実運用パラメータについての主張は何も支えません。

## 出典との対応

Week 5 の教材は公開済みなので、 `courseAlignment` は `week5/README.md` を `lecture`、
`week5/problems/tfhe-toy-python/README.md` を `assignment` として pin しています。
`spoilerPolicy` は `independent-reimplementation` で、ここでの API・パラメータ生成・方式の記述は独自であり、
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

`make reference-test` が mutation suite を走らせます。 22 個の壊れた実装のほとんどは、
自分の暗号文を完璧に暗号化・復号します。 reference と違いが出るのは、
他の何かがそれに同意しなければならなくなったときだけです。

### 名前を付けておくべき fixture の不変条件

生成される secret は少なくとも 1 つ `1` を含むよう強制しています。これは飾りではありません。
全ゼロの secret では mask の項が消え、実装が secret に何をしたかに関わらず
`b = encode(m) + e` になります。強制する前に、**3 つの mutation がまさにこれで生き残りました**。
seed が `(0, 0, 0, 0, 0)` を引き、方式全体が「メッセージを符号化して noise を足す」に退化し、
どの誤った符号規約も同じことをするからです。
