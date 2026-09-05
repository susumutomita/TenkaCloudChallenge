# 1 行打って、出た値を貼る — witness を戻さない co-SNARK prover

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 605 · **Chapter:** Week 6 / Drill:
co-SNARK on shares · **Role:** `mechanism` · **想定時間:** 40〜60 分 · **配点:** 200
· **Status:** draft — 新規 companion は人間のプレイ証拠（#465）が揃うまで draft

## これは何か

関数を書く問題ではありません。自分の `python3` を開き、Portal の「証拠を確認」に出た数を貼り、
**1 行打って、出た値を貼る**を 14 回繰り返します。14 行で co-SNARK の核を出します: 2 人の証明者が、
秘密の witness をどちらも全部は知らないまま、証明の部品 (A, B, C) を組みます。

```
1  (p, w)                        witness、答え合わせのため一度だけ         （回答欄なし）
2  (w0[1], w1[1])                各 wire の新しいシェア                    shares
3  reconstruct                   share を全員で足すと戻ることの確認         （回答欄なし）
4  秘密を変えて r0 を固定          share 1 枚は秘密を語らない               （回答欄なし）
5  A のシェア                    線形結合、シェアのまま各自で              ashares
6  (A 開示, A 直接計算)           シェアの上と平文の上が一致               aopen
7  (B_sh, B)                     A と同じ手順で B                          bshares
8  (シェアごとの積, A*B)          シェアごとの積は正解ではない              crossmul
9  a, b, c=a*b の確認             Beaver triple を一度だけ開く              （回答欄なし）
10 (d, e)                       唯一の通信                                beaveropen
11 C のシェア                    d, e と triple のシェアから組む           cshares
12 C を開く                     復元した積                                csum
13 展開公式                     なぜ正しく復元されるのか                   （回答欄なし）
14 候補 A と d                  d を見ても A が絞れない理由                （回答欄なし）
```

各行に「この行の意味」が付き、値が合うと「合ったら読む」が開きます。14 行のうち回答欄があるのは
8 行（platform の 1 問あたりの上限）。残り 6 行は一度だけの確認・答え合わせ・Beaver の下ごしらえ・
締めの種明かしです。

問題文が意図して運ぶ肝が 3 つあります:

- **線形結合（公開の係数を掛けて足すだけの計算）は、シェアのまま各自ローカルに完結する。** 各自が
  自分のシェアだけから計算し、誰も何も送りません。だから本物の SNARK 証明者の計算の大半（MSM・
  FFT）は co-SNARK の上で「ローカルで無料」になります。
- **シェアごとの積は正しい積ではない。** シェアの和を展開すると出る交差項を、シェアごとの掛け算は
  落としてしまいます。足し算と違って、掛け算には通信が要ります。
- **Beaver triple が、その 1 回の掛け算を 1 往復の通信だけで済ませる。** `d = A − a` と `e = B − b`
  という「三つ組自身の乱数でずらした値」だけを開けば、各自が A も B も相手のシェアも見ずに C の
  シェアを組めます。

## なぜ数が小さく、seed 由来なのか

体の法は 2〜3 桁の素数、witness は 2 wire、Beaver triple の 2 つの因数も同じくらい小さく、どの行も
1 画面の計算で済みます。手順は課題 `co-snark-prove` のもの、法・witness・両方の係数ベクトル・
Beaver triple はすべてこの deploy の `FLAG_SEED` から決まります。課題自身の数値例（法 97、
witness [3, 5]、係数 [1, 2] / [4, 1]、Beaver triple 5/9/45）と `tests/public.py` から引ける全組は
生成から除外してあるので、教材を写すだけでは解けません。1 行につき正解は 1 つ、通るのは自分の
Python が出した値だけです。

witness `w` は意図して見せています: あなたはプロトコルの外から見ている立場（作問者がメカニズムを
検証するときの視点）で、2 人の証明者のどちらかではありません。隠れているのは採点される値のほう
で、それを自分で出すのがこのドリルです。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが出る。
2. **「証拠を確認」**を押す。数が Python の代入文で出るので、まず `python3` に貼る。
3. 1 行目から順に打つ。回答欄のある行（2 行目が最初）は、出た値をその回答欄に貼って提出し、「合ったら読む」を読む。14 行目まで続ける。
   **回答欄は 1 行の入力欄です。**
4. Python を開けないとき: エディタの `co_snark_drill.py` の関数を埋めて**「公開テストを実行」**。
   この deploy の数での自分の関数の値が出る — REPL が出すのと同じ値です。

直接回答は現在の deploy seed に結び付くため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `shares` | 20 | 各 wire の新しく出てきたシェアの値 |
| `ashares` | 25 | A の線形結合、シェアのまま各自で |
| `aopen` | 20 | シェアの和と、w から直接計算した値の一致 |
| `bshares` | 25 | B のシェアと開いた B、A と同じ手順 |
| `crossmul` | 30 | シェアごとの積（誤り）と正しい A*B |
| `beaveropen` | 25 | 唯一の通信 — d と e |
| `cshares` | 30 | Beaver 補正込みの C のシェア |
| `csum` | 25 | C を開いた値 |

hint は各 checkpoint に 1 つ（減点 6）。その行で起きやすい打ち間違いを名指しします。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも compose stack の
全 image もあなたの管理下にあるので、その人物に対して中身を秘匿することはできません。ここでの
境界は誤配防止であり、その人物に対する秘匿ではありません。参加者用 Workbench image に入るのは
Portal editor API・starter・公開 test だけです。Week 5 の先行作（`ac26-w5-rotation-drill` /
`ac26-w5-negacyclic-drill`）と同じく、この問題の `fixtures/generate.py` は期待値を公開値と同じ
関数で導くため、module ごと別の非公開 verifier image にだけ載せます（Issue 537/543 option B2）。
Workbench はこの deploy の公開値を Compose 内部 network 上の verifier の `GET /public` から取得
します。`reference/` と `mutation.py` は `author` stage にだけ追加します。

host の `127.0.0.1:18163` に公開するのは Workbench だけで、verifier に host port はありません。
両 service は non-root、read-only filesystem、capabilities なし、no-new-privileges、
メモリ・PID 上限つきで動きます。checkpoint は echo した id しか加点できません。結果は期待値を
漏らしません。fixture はこの deploy の seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が一切管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した reference 12 種類（wire のシェアで
乱数を引くはずが足す、線形結合の係数を取り違える、crossmul の正解側を掛け算でなく足し算にする、
Beaver open の符号を逆にする、C のシェアで定数 d*e の補正を忘れる、展開公式から a*b の項を落とす、
…）を hidden suite が落とすこと — この deploy の seed に対してだけでなく、seed に依存しない
手計算で検証済みの具体例に対しても — と、verifier を狙った near-miss 12 種類（係数ベクトルを答え
と取り違える、Beaver の因数を開いた値と取り違える、別の行の値、長さの違う組、真偽値、別 deploy の
答え）を値の採点器が拒否することを確かめます。hidden suite は、このドリル群が共有する値の正規化
（int / bool / hex / str、単体とタプル）の契約自体も直接検査します。participant image に
`fixtures/` が無いため、`make test` と `make inspect` は Compose 経由で動き、公開値は verifier の
`GET /public` から来ます。
