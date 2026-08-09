# 選んだ番号は、送らない

> TenkaCloud のこのトラックは Advanced Cryptography Program 2026 の学習者向けに独立して作られた非公式の補助教材です。講座運営とは無関係で、公式教材の解答は含みません。

## なぜやるか

送信者は 16-bit の message を2通持つ。受信者は1通だけを受け取りたい。送信者には選んだ番号を知らせず、受信者はもう1通を読めないままにする。

ここでは最終出力テストが弱点になる。request に choice を入れ、2通を平文で返しても選んだ値は正しい。そこで配送、choice privacy、message privacy を別々に採点する。

前提にするものは Python、整数の累乗と余り、XOR。OT と離散対数はこの問題の中で定義する。

## 実装するもの

`local/starter/ot.py` の3関数を埋める。

- `make_receiver_request(sender_public, choice, receiver_secret)`
- `seal_sender_messages(sender_secret, request, message_0, message_1)`
- `open_receiver_message(sender_public, choice, receiver_secret, ciphertexts)`

引数の役割は講座 Part B の3操作と対応する。一方で関数名、コード、fixture、test、小さな parameter は独立して設計している。

## toy construction

素数 467、位数 233、generator 4 の部分群を使う。送信者の公開値を `A = g^a`、受信者の秘密指数を `b` とする。

```text
B = g^b * A^choice

sender branch 0 key = B^a
sender branch 1 key = (B / A)^a
receiver key        = A^b
```

choice 0 なら `A^b = B^a`、choice 1 なら `A^b = (B/A)^a`。一様な部分群要素へ固定値 A を掛けても同じ部分群を巡るため、request の分布は choice を語らない。

starter は `_pad(shared, branch)` を支給する。ASCII 文字列 `tc-ot-v1:{shared}:{branch}` の SHA-256 先頭16 bitを big-endian 整数にする関数である。branch `i` は `message_i XOR _pad(branch_key_i, i)` で封じ、選択 branch も同じ helper で開く。この pad mapping は問題仕様であり、学習者に推測させる手順ではない。

この parameter は全列挙でき、実用上安全ではない。ここでは全列挙できるからこそ、2つの request 分布を完全に比較できる。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが表示される。
2. **証拠を調べる**で construction と deploy 固有の入力を読む。
3. Portal のエディタで `ot.py` を編集する。
4. **公開テストを実行**で最終配送を確認する。
5. 各 checkpoint をそのまま提出する。Portal が現在の source を準備して送る。

## checkpoint

| checkpoint | 見るもの |
| --- | --- |
| request | request の代数的な形 |
| sender-encrypt | 2つの ciphertext branch |
| receiver-decrypt | 選択 branch の復号 |
| delivery | end-to-end の最終 message |
| choice-audit | request multiset の一致 |
| message-audit | 平文なし、public pad なし、A^b で反対 branch が開かない |
| transfer | 見ていない seed で全 suite |

`make inspect` で例を読み、starter を編集して `make test` を実行する。public test が見るのは最終配送だけ。`make reference-test` は作問者専用。

## audit を分ける理由

mutation suite は壊れた実装を8種持つ。そのうち6種は全 final-delivery case を通る。平文 protocol、choice 付き request、public value の pad、1つの receiver key で両 branch が開く実装、ciphertext 順序違反を audit が落とす。

## Week 2 の対応づけ

Issue #412 が公開された Part B の要求を記録している。この問題の作成中に #419 が別途 `main` へ Week 2 の公開済み講義・課題 reference を確立した。この問題はその reference を再利用し `status: draft` のままとする。既存 pin は動かさない。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image も参加者の管理下にあります。`reference/` と `tests/hidden/` を bind-mount しないのは通常経路へ作問者 artifact を混ぜないためで、秘匿や改ざん耐性のためではありません。

verifier は提出を resource limit 内で実行し、checkpoint id を fail closed で扱い、期待値を返さず、fixture を deployment seed から作ります。これは自習を支えますが、競技順位・試験・修了判定は**支えません**。

## コスト

ゼロです。クラウドアカウントも AWS resource も使いません。

## 作問者向け

`make reference-test` は `FINAL-OUTPUT-BLIND 6 of 8` を出し、8つの submission mutation と cleartext verifier probe をすべて kill する必要がある。
