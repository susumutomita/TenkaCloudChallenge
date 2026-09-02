# 1 行打って、出た値を貼る — 時計の世界と、繰り返してはいけない覆い

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 14 · **Chapter:** Bridge 0 /
Clock Arithmetic and Covers · **Role:** `diagnostic` · **想定時間:** 30〜40 分 ·
**配点:** 100 · **Status:** draft — 新規 companion は人間のプレイ証拠（#465）が揃うまで draft

## これは何か

`ac26-bridge-unknown-x` の直後に置く、難易度 2 の 2 段目です。この先の週の計算は全部
「割ったあまりだけの世界」— 一周 n の時計の上 — で行われるので、住む前にその世界を下見します。
自分の `python3` を開き、Portal の「証拠を確認」に出た数を貼り、**1 行打って、出た値を貼る**を
10 回繰り返します。

```
1  (u % n, v % n)              時計に載せる                       （回答欄なし）
2  足し算を両方の順で           差は 0                             add
3  掛け算を両方の順で           まだ 0 — 計算できる場所            mul
4  (secret + cover) % n        でたらめな覆いで隠す                cover
5  (covered - cover) % n       同じ覆いが引き戻す                  uncover
6  表 t を作り 3 か所読む       候補ごとに覆い 1 本 — 平ら          every
7  sum(t)                      n 候補に n 本: 絞れるものが無い      count
8  同じ覆いで 2 通目            使い回しが始まる                    reuse
9  (covered - covered2) % n    覆いが打ち消え、本物の差が漏れる     leak
10 leak == 本物の差            いちばん古い失敗を、自分の手で      （回答欄なし）
```

山は 6〜7 行目です。どの候補の秘密にも、観測を作る覆いがちょうど 1 本ずつある — だから観測から
絞れるものは**無い**。これを perfect secrecy という語を出さずに、本人の数え上げで出します。
最後の 2 行はわざと覆いを使い回し、one-time pad という語を出さずに、秘密どうしの差が漏れる
ことを起こします。10 行のうち回答欄は 8 行（platform の 1 問あたりの上限）です。

## なぜ数が小さく、seed 由来なのか

時計は 12〜24 目盛りなので、6 行目の覆いの表は内包表記 1 つで作れて、目で読めます。u と v は
n より大きく引かれ、wrap が必ず見えます。cover は covered が secret や 0 に一致しないよう
引き直され、second は観測値が画面上の数と衝突しないよう引き直されます（衝突を許すと約 20 分の 1
の deploy が代入文の読み取りだけで解けます — `generate.py` の docstring 参照）。`every` 行が
写せる形でなく 3 点読みなのは、n が画面に出ているためです。問題文の例（n = 10）は生成範囲外
（n ≥ 12）。1 行につき正解は 1 つ、通るのは自分の Python が出した値だけです。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが出る。
2. **「証拠を確認」**を押す。数が Python の代入文で出るので、まず `python3` に貼る。
3. 1 行目、2 行目と順に打ち、出た値をその回答欄に貼る。10 行目まで続ける。
   **回答欄は 1 行の入力欄です。**
4. Python を開けないとき: エディタの `clock_drill.py` の関数を埋めて**「公開テストを実行」**。
   この deploy の数での自分の関数の値が出る — REPL が出すのと同じ値です。

直接回答は現在の deploy seed に結び付くため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 5 点減点です。

| Checkpoint | 配点 | 証拠の種類 | 何を検査するか |
|---|---:|---|---|
| `add` | 10 | construct | 足し算が wrap と両立 — 差 0 |
| `mul` | 10 | construct | 掛け算が wrap と両立 — 差 0 |
| `cover` | 10 | construct | (secret + cover) % n — 相手が見る唯一の数 |
| `uncover` | 10 | construct | (covered − cover) % n — 秘密が戻る |
| `every` | 20 | trace | 候補 3 つでの覆いの本数 — どこも同じ |
| `count` | 10 | trace | 表の合計 — 候補 1 つに覆い 1 本 |
| `reuse` | 10 | construct | 使い回した覆いの下の 2 つの観測値 |
| `leak` | 20 | counterexample | その差 — 覆いが消え、本物の差が漏れる |

hint は各 checkpoint に 1 つ（減点 3〜5）。その行で起きやすい打ち間違いを名指しします。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも compose stack の
全 image もあなたの管理下にあるので、その人物に対して中身を秘匿することはできません。ここでの
境界は誤配防止であり、その人物に対する秘匿ではありません。参加者用 Workbench image に入るのは
Portal editor API・starter・公開 test だけです。この問題の `fixtures/generate.py` は期待値を
公開値と同じ関数で導くため、module ごと別の非公開 verifier image にだけ載せます（Issue 537/543
option B2）。Workbench はこの deploy の公開値を Compose 内部 network 上の verifier の
`GET /public` から取得します。`reference/` と `mutation.py` は `author` stage にだけ追加します。

host の `127.0.0.1:18141` に公開するのは Workbench だけで、verifier に host port はありません。
両 service は non-root、read-only filesystem、capabilities なし、no-new-privileges、
メモリ・PID 上限つきで動きます。checkpoint は echo した id しか加点できません。結果は期待値を
漏らしません。fixture はこの deploy の seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が一切管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した reference 10 種類（wrap を
取らない、add / mul の左辺だけ wrap を忘れる、覆いを引くべき所で足す、表を wrap なしで数える、
差の向きを逆にする、…）を hidden suite が落とすこと、verifier を狙った near-miss 12 種類
（覆った数の欄に secret、本数の欄に候補そのもの、wrap 前の和、長さの違う組、真偽値、別 deploy
の答え）を値の採点器が拒否することを確かめます。participant image に `fixtures/` が無いため、
`make test` と `make inspect` は Compose 経由で動き、公開値は verifier の `GET /public` から
来ます。
