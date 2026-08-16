# 1 命令を、どこまで遅くできるか

`cs-foundations` 第 11 章。 発想の出発点は
[asm-hall-of-shame](https://github.com/xoreaxeaxeax/asm-hall-of-shame) ですが、
実装はすべて独自のものです。

## この問題が立っている落差

starter は壊れていません。 機械が最も速くできることを正直に測っており、baseline と
同じ命令なのでスコアはちょうど 1.00 になります。 public test は全部通ります。
どの public test も「その数値が大きいか」を訊いておらず、大きくすることが課題の全部です。

## 構成

```
local/starter/candidate.S     参加者が編集する 1 枚
local/reference/candidate.S   正解 (author image のみ)
local/harness/measure.c       作者所有: 時計、warm-up、サンプリング、棄却
local/harness/arena.c         64 MiB の seed シャッフル済みポインタ環
local/harness/baseline.S      固定の比較対象
local/verifier/grader.py      先に逆アセンブル、後で計測
local/tests/public/           正直だが遅くない starter でも通るテスト
local/mutation.py             grader を 8 通り壊す
local/workbench/server.py     参加者の editor と証拠。 公開される唯一の port
```

## 採点の決め方

数値より先に形を見ます。 計測区間を逆アセンブルし、制御フローでない命令がちょうど 1 個で
あること、syscall・特権命令・自前の計測命令・stall 命令・cache 操作を含まないことを
確認してから、初めて build して実行します。

スコアは `candidate の robust サイクル / baseline の robust サイクル` で、どちらも同じ
host の同じプロセスで測ります。 だから閾値はノート PC でもサーバでも同じ意味を持ちます。
robust 統計量は「1 つの CPU に留まったサンプルの中央値」です。 移動したサンプルは加点
対象ではなく棄却され、過半数を保てなかった run は計測不能として拒否されます。

`generalize` は参加者が一度も測っていない seed で採点するので、特定の arena 形状に
合わせた解答は通らず、環そのものを辿る解答は通ります。

## 作問者向けコマンド

```bash
make build           # participant + verifier image
make test            # local/starter に対する public test
make inspect         # 参加者に見える証拠を表示
make reference-test  # reference が閾値を超え、8 つの mutation がすべて死ぬ
make up / make down  # Compose lab をローカルで起動・停止
```

## host 要件

結果に意味があるのは **native amd64** かつ `rdtscp` / `constant_tsc` / `nonstop_tsc` を
持つ host だけです。 `runtime.compatibility` がこれを宣言し、platform はそれ以外の host
での起動を拒否します。 emulation は普通に動いてしまい、無意味な数値を出します。
動かないことより悪い状態です。

## 保証範囲

local modeはself-pacedなhonor-system verificationである。participantはmachine、Docker daemon、imageを管理する。
通常のparticipant imageはreference candidateとmutation suiteを含まず、
graderは別imageである。それでもDockerを管理する人はauthor stageをbuildして中を読める。この分離は誤配を
防ぎ、悪意あるhost ownerから秘匿するものではない。submissionには時間・memory・process・output capをかける。
containerはnon-root、read-only、privilege無しで動き、masqueradeされたoutbound networkを持たない。

競技順位・試験・修了判定は**支えません**。その用途にはparticipantが管理しないverifierが必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271)で追跡している。

## 証明したこと

何かを速くしたのではない。 1 命令のコストが opcode ではなく依存関係と到達するメモリの
性質で決まること、そして「普通の場合」と「最悪の場合」の差が手元のハードウェアで 2 桁倍
あることを示した。
