# 1 命令を、どこまで遅くできるか

`cs-foundations` 第 11 章。 発想の出発点は
[asm-hall-of-shame](https://github.com/xoreaxeaxeax/asm-hall-of-shame) ですが、
実装はすべて独自のものです。

## この問題が立っている落差

starter は壊れていません。 機械が最も速くできることを正直に測っており、baseline と
同じ命令なのでスコアは 1.00 前後になります。 public test は全部通ります。
どの public test も「その数値が大きいか」を訊いておらず、大きくすることが課題の全部です。

## 構成

```
local/starter/candidate.S     参加者が編集する 1 命令の行
local/reference/candidate.S   正解 (author image のみ)
local/harness/candidate.py    検証して固定 wrapper を作る safe builder
local/harness/measure.c       作者所有: 時計、warm-up、サンプリング、棄却
local/harness/arena.c         64 MiB の seed シャッフル済みポインタ環
local/harness/baseline.S      固定の比較対象
local/tests/hidden/check_candidate.py  先に逆アセンブル、後で計測
local/tests/public/           正直だが遅くない starter でも通るテスト
local/mutation.py             境界とスコアの回帰 probe
local/workbench/server.py     参加者の editor と証拠。 公開される唯一の port
```

## 採点の決め方

数値より先に形を見ます。 `candidate.S` は関数ではなく、許可された scalar integer 命令 1 行だけです。
対象は scalar 算術、move と read-only load、shift/rotate、bit scan、条件付き move/set、NOP で、
operand は GPR だけです。SIMD/x87、乱数、system-state、未知の命令は拒否します。shared safe
builder がその 1 行を作者所有 wrapper に埋め込み、ちょうど 64 回展開します。生成した
object を逆アセンブルし、同じ bytes の非制御フロー命令が 64 個であること、relocation・syscall・
特権命令・自前の計測命令・stall 命令・cache 操作を含まないことを確認します。参加者の元の
ファイル自体は link も実行もしません。メモリ operand は作者所有 arena の `(%r8)` だけを読み取り元に
でき、結果を明示的な GPR に置く必要があります。arena や harness state を書き換える store / read-modify-write は実行前に拒否します。
`%r15` は wrapper の call-frame guard 専用なので、提出命令では使用できません。

スコアは `candidate の robust サイクル / baseline の robust サイクル` で、どちらも同じ
host の同じプロセスで測ります。 だから閾値はノート PC でもサーバでも同じ意味を持ちます。
robust 統計量は「1 つの CPU に留まったサンプルの中央値」です。 移動したサンプルと、
事前に定めた倍率を超える割り込み相当の上側外れ値は加点対象ではなく棄却され、過半数を
保てなかった run は計測不能として拒否されます。

`generalize` は参加者が一度も測っていない seed で採点するので、特定の arena 形状に
合わせた解答は通らず、環そのものを辿る解答は通ります。

## 作問者向けコマンド

```bash
make build           # participant + verifier image
make test            # local/starter に対する public test
make inspect         # 参加者に見える証拠を表示
make reference-test  # reference が閾値を超え、すべての境界 probe が通る
make up / make down  # Compose lab をローカルで起動・停止
```

## host 要件

結果に意味があるのは **native amd64** かつ `rdtscp` / `constant_tsc` / `nonstop_tsc` / `clflush` を
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
