# 何をハッシュに入れ忘れたか

Sigma protocol を対話的に走らせ、Fiat-Shamir で署名へ変換する。ハッシュに入れ忘れたものは 1 つも守られない。domain separator を落とすと、1 つの署名が 2 つのプロトコルで通る。

Week 3 の 3 問目、 role は assignment-companion。 群は前問で作ったものを与え、 participant が書くのは protocol と serialization と Fiat-Shamir 変換に絞ってある。

この問題の主題は 「何をハッシュに入れるか」 と 「どう並べるか」 の 2 点で、 どちらも正常系では一切現れない。 domain・message・commitment・public key のどれを落としても sign と verify は完璧に動く。 だから checkpoint はそこを直接攻める。

cross-protocol checkpoint は ASSESSMENT.md が assignment-companion に要求する counterexample 型で、 participant は 「1 つの署名が 2 つの domain で通る」 witness を構成する。 弱い challenge (domain separator を落としたもの) は fixtures 側に固定してあり、 participant 自身の弱いコードを攻める答えは成立しない。

serialization は length prefix の有無を検査する。 参照実装は可変長 2 フィールド (domain と message) を**隣接**させてある。 固定長の点表現を間に挟むと、 length prefix を落としても衝突には点の並びの偶然が要るようになり、 「prefix は飾り」 と自分を納得させられてしまうため。 隣接させてあることで ('ab','cd') と ('a','bcd') が決定的に衝突する。

**群位数と確率の扱い**: toy 群は n が 29〜43 しかない。 Schnorr の偽造成功確率は 1/n なので、 「message を 1 byte 変えて verify」 は正しい実装でも 40 回に 1 回通る。 したがって拒否側の assertion は secp256k1 で回し、 toy 群では受理側と、 ハッシュ入力 (preimage) が変わることだけを検査する。 preimage の比較は決定的で、 challenge 値の比較は 1/n で衝突するため。 この設計自体を writeup で説明している。

secret key と nonce は show.py が出力しない。 protocol が守る対象そのものであり、 それを表示する lab は逆のことを教えるため。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- public key P = xG と secret key x の関係を説明できる
- commitment・challenge・response の 3 手を実装できる
- verifier equation の左辺と右辺を点として突き合わせられる
- Fiat-Shamir で challenge を transcript から導出できる
- domain・message・commitment・public key の binding が要る理由を反例で示せる
- 可変長フィールドの連結が曖昧になる条件を説明できる
- 署名が message を隠すものではないと説明できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `keygen` | 鍵を作り、使えない鍵を断る | 30 |
| `sigma` | 3 手を実装する | 40 |
| `transcript` | 検証式の両辺を突き合わせる | 35 |
| `serialization` | 一意な符号化を書く | 40 |
| `fiat-shamir` | challenge を transcript から作る | 45 |
| `sign-verify` | 署名して検証する | 40 |
| `cross-protocol` | domain を落とすと何が起きるか示す | 40 |
| `transfer` | 実運用パラメータでも動かす | 30 |

## 解説

## 入れ忘れたものは守られない

challenge に含めなかったものは、 署名が何も主張していないものになる。 message を入れなければ同じ署名が任意の message に付く。 public key を入れなければ鍵の付け替えができる。 commitment を入れなければ Fiat-Shamir が Fiat-Shamir でなくなる。 domain を入れなければ、 別のプロトコル用の署名がこちらでも通る。

どれも正常系では起きない。 sign して verify すれば全部通る。 mutation suite の 10 個中 5 個がこの型で、 だから checkpoint は正常系を確認したあと直接そこを攻める。

## cross-protocol counterexample

domain separator を落とした challenge を fixtures 側に固定してある (`weak_challenge`)。 participant はそれに対して 1 つの署名が 2 つの domain で通る witness を構成する。 弱い challenge を participant 自身に書かせないのは、 「自分の弱いコードを自分で破る」 が答えになってしまわないようにするため。

そのうえで、 participant 自身の challenge が 2 つの domain で**異なるバイト列をハッシュする**ことを検査する。 攻撃を作れることと、 自分の実装がそれを防いでいることは別の主張であり、 両方が要る。

## length prefix と隣接

可変長フィールドを長さ無しで連結すると、 ('ab', 'cd') と ('a', 'bcd') が同じバイト列になる。 異なる 2 つの主張に 1 つの証明が付く。

参照実装は domain と message を**隣接**させてある。 間に固定長の点表現を挟む並びでも原理的には不健全だが、 衝突には点の並びの偶然が要るようになり、 レビューで 「実際には起きないから prefix は飾り」 と結論できてしまう。 隣接させれば衝突は決定的で、 その議論の余地が無い。

## 群位数と確率

toy 群は位数が 29〜43 しかない。 Schnorr の偽造成功確率は 1/n なので、 「message を 1 byte 変えて verify」 は**正しい実装でも** 40 回に 1 回通る。 これはコードの欠陥ではなくパラメータの性質であり、 実際に作問中に踏んだ。

したがって:

- 受理側 (正直な署名が通る) は toy 群で検査する。 決定的だから。
- 拒否側 (改変した署名が落ちる) は secp256k1 で検査する。 1/n が無視できるから。
- 「binding input を変えると challenge が変わる」 は toy 群では **preimage** を比較する。 challenge 値は 1/n で衝突するが、 ハッシュ入力が変わることは決定的だから。

テストが確率で落ちる設計は、 学習者に 「たまに落ちるので再実行する」 を教えてしまう。 それは採点の失敗である。

## 署名は暗号化ではない

検証式が成立しても message は隠れていない。 message は verifier が持っている前提であり、 署名はそれに対する主張である。 「valid な式 = 機密性」 は成り立たない。

## 次につながるところ

次の問題は nonce 再利用。 ここで z = k + e*x を書いたので、 同じ k で 2 つの署名を作ると連立方程式になり x が解けることが直接見える。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
