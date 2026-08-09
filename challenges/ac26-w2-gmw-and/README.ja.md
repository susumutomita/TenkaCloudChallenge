# 正しい AND は、まだ秘密ではない

> TenkaCloud のこのトラックは Advanced Cryptography Program 2026 の学習者向けに独立して作られた非公式の補助教材です。講座運営とは無関係で、公式教材の解答は含みません。

## なぜやるか

2 party が bit x と y の XOR share を持つ。どちらの入力も復元せず、x AND y の XOR share を作りたい。

4行すべての真理値表でも、それは証明できない。x と y を open し、平文 AND を計算して再 share すれば全行を通る。この問題は local read、OT session、cross-party operation、open を最終出力と分けて監査する。

前提にするものは Python、bitwise AND と XOR、XOR による復元。前問の OT construction は ideal fixture として支給し、ここでは Boolean MPC の構成に集中する。

## 実装するもの

`local/starter/gmw.py` を編集する。

```python
and_shared_bits(x_shares, y_shares, masks, ot_secrets)
```

引数の役割は講座 Part B の GMW operation と対応する。関数名、source、test、fixture、runtime は独立している。

## 書く前に展開する

```text
(x0 xor x1) AND (y0 xor y1)
  = x0*y0 xor x0*y1 xor x1*y0 xor x1*y1
```

`x0*y0` は party 0 だけ、`x1*y1` は party 1 だけで計算できる。残る2つの cross term が OT を必要とする。

`x0*y1` では party 0 が fresh mask r を選び `(r, r xor x0)` を送る。party 1 が y1 で選ぶ。party 0 の r と party 1 の選択値を XOR すると `x0*y1` になる。`x1*y0` は逆向きに、別の mask と session で行う。

支給 fixture の API は party-local read 用の `ot_secrets.local(shares, party)` と、1回の ideal transfer 用の `ot_secrets.transfer(session, sender_party, receiver_party, (message_0, message_1), choice)`。session 0 は party 0 から1、session 1 は party 1 から0へ使う。runtime には禁止された復元を監査する `open` もあるが、正しい gate は呼ばない。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが表示される。
2. **証拠を調べる**で展開式と deploy 固有の入力を読む。
3. Portal のエディタで `gmw.py` を編集する。
4. **公開テストを実行**で真理値表を確認する。
5. 各 checkpoint をそのまま提出する。Portal が現在の source を準備して送る。

## checkpoint

| checkpoint | 見るもの |
| --- | --- |
| truth-table | 4入力すべての復元 AND |
| cross-terms | 逆方向2本の OT message pair |
| output-sharing | fresh mask で share が変わり XOR は不変 |
| transcript | open なし、unscoped read なし、cross-owner 演算なし |
| privacy-audit | 構成証拠をまとめて検査 |
| transfer | 見ていない share と mask |

`make inspect` で式を読み、starter を編集して `make test` を使う。public suite は真理値表だけを見る。`make reference-test` は作問者専用。

## OT を fixture にする理由

前問が receiver request、sender encryption、receiver decryption を担当する。ここでも数式を作り直すと Boolean gate ではなく2回目の OT 問題になる。`IdealOt.transfer` は building block を支給し、composition audit に必要な session、direction、messages、choice、result だけを記録する。

## audit が本当の checkpoint である理由

mutation suite は壊れた gate を8種持つ。7種が完全な真理値表を通る。入力復元、cross-owner の直接積、OT 1回、session 再利用、mask 再利用、固定 slot への平文出力を transcript と privacy check がすべて落とす。

## Week 2 の対応づけ

Issue #412 が公開 Part B の要求を記録している。この問題の作成中に #419 が別途 `main` へ Week 2 の公開済み講義・課題 reference を確立した。この問題はその reference を再利用し `status: draft` のままとする。既存 pin は動かさない。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image も参加者の管理下にあります。`reference/` と `tests/hidden/` を通常の participant path から外すのは accidental delivery 防止であり、秘匿や改ざん耐性のためではありません。

verifier は提出を resource limit 内で実行し、要求された checkpoint だけを echo し、期待値を返さず、fixture を deployment seed から作ります。これは自習を支えますが、競技順位・試験・修了判定は**支えません**。

## コスト

ゼロです。クラウドアカウントも AWS resource も使いません。

## 作問者向け

`make reference-test` は `FINAL-OUTPUT-BLIND 7 of 8` を出し、8つの submission mutation と reconstruct-and-reshare verifier probe をすべて kill する必要がある。
