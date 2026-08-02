# 何をハッシュに入れ忘れたか

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 330 · **Chapter:** Week 3 / Sigma Protocol
and Fiat–Shamir · **Role:** `assignment-companion` · **想定時間:** 75〜105 分 · **配点:** 300
· **必須前提:** `ac26-w3-ec-group`

## ストーリー

`x` を渡さずに、`x` を知っていることを相手に納得させたい。3 手でできます。

```text
P = xG                        主張
R = kG                        commitment
e                             challenge
z = k + e*x  (mod n)          response
zG == R + eP                  verifier が確認する式
```

Fiat–Shamir は `e` を transcript から計算することで対話を取り除きます。問題はそこから始まります。
**何をハッシュに入れるかを自分で決める**ことになるからです。

## 入れ忘れたものは守られない

| challenge から落としたもの | 成り立たなくなること |
|---|---|
| message | 1 つの署名が任意の message に付く |
| public key | 署名を別の鍵へ付け替えられる |
| commitment | Fiat–Shamir が Fiat–Shamir でなくなる |
| domain | 別プロトコル用の署名がここでも通る |

どれも正常系には現れません。sign して verify すれば、毎回通ります。この問題の 10 個の mutation の
うち 5 個がこの型で、だから checkpoint はそこを直接攻めます。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` でこの deploy 固有の fixture と公開された証拠を読む。
3. 画面内のエディタで starter のソースを編集する。
4. `test` で公開テストを実行し、直接回答欄があれば証拠から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Participant Portal へ貼る。

checkout、ターミナル、ローカルエディタは不要です。code checkpoint は編集したソースを提出します。
直接回答は `prepare` が現在の deploy seed へ結び付けるため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `keygen` | 30 | `P = xG`、使えない secret と public key の拒否 |
| `sigma` | 40 | commitment と response。正しい法で |
| `transcript` | 35 | 正直な transcript の受理と、改変されたものの拒否 |
| `serialization` | 40 | 往復、非正規形の拒否、連結の一意性 |
| `fiat-shamir` | 45 | 4 つの binding input すべてがハッシュ入力を変える |
| `sign-verify` | 40 | 正直な署名が通り、実サイズの群で改変が落ちる |
| `cross-protocol` | 40 | 反例の構成と、それへの耐性 |
| `transfer` | 30 | 同じコードが secp256k1 で動く |

hint は 8 つ中 6 つにあり、いずれもその checkpoint の 50% 上限内です。

## 反例の checkpoint

`fixtures.generate.weak_challenge` は commitment、public key、message をハッシュし、domain を
**見ません**。これは fixtures 側にあり、あなたのファイルにはありません。「自分で弱くしたコードを
自分で破りました」は答えにならないからです。

あなたは、1 つの署名が 2 つの domain で同時に通る witness を構成します。そのうえで、あなた自身の
`challenge` はその 2 つの domain で異なるバイト列をハッシュしなければなりません。攻撃を作れることと、
自分がそれに耐えることは別の主張であり、この checkpoint は両方を要求します。

## length prefix と、なぜ隣接させるのか

可変長フィールドを長さ無しで連結すると、`('ab', 'cd')` と `('a', 'bcd')` が同じバイト列になります。
異なる 2 つの主張が 1 つの証明を共有します。

参照実装は domain と message を**隣接**させています。間に固定長の点表現を挟む並びでも原理的には
不健全ですが、衝突には点のバイト列が偶然揃う必要が出てきます。するとレビューで「実際には起きない
から length prefix は飾り」と自分を納得させられてしまいます。隣接させれば衝突は決定的です。

## 群位数と確率

toy 群の位数は 29〜43 です。Schnorr の偽造成功確率は `1/n` なので、「message を 1 byte 変えて
verify」は**正しい実装でも** 40 回に 1 回通ります。これはパラメータの性質であって欠陥ではなく、
この問題を書いている最中に実際に踏みました。

そこで検査を分けてあります。

- **受理側**（正直な署名が通る）は toy 群。決定的だからです。
- **拒否側**（改変された署名が落ちる）は secp256k1。`1/n` が到達不能だからです。
- **「binding input を変えると challenge が変わる」** は toy 群では *preimage* を比較します。
  preimage 同士は `1/n` で衝突しますが、ハッシュ入力が変わること自体は決定的だからです。

確率で落ちるテストは、学習者に「たまに落ちるので再実行する」を教えます。それは flake ではなく採点の
失敗です。

## 署名は暗号化ではありません

検証式が成立しても、機密性については何も言えません。message は隠れておらず、verifier がすでに持って
いる前提で、署名はそれに対する主張です。

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

`make reference-test` が mutation suite を実行します。壊した実装 10 種類があり、半分は sign と verify
が完璧に通り、攻撃者に対してだけ壊れています。length prefix の mutation は、参照実装の preimage が
可変長 2 フィールドを隣接させている理由そのものです。点を間に挟んだ並びでは、この mutation が生き
残りました。
