# 分けても、まだ何も分からない

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 210 · **Chapter:** Week 2 / Additive Secret
Sharing · **Role:** `mechanism` · **想定時間:** 40〜60 分 · **配点:** 200
· **Status:** draft — 後述の「Week 2 の対応づけ」を参照

## ストーリー

5 人の監査人が、互いの帳簿の数字を知られずに合計を出す必要があります。ホワイトボードの計画は単純です。
各数値を人数分に分け、全部を足したときだけ意味を持つようにする、というものです。

分割はもう誰かが書いています。足せば正しく合います。そして、書かれているままでは役に立ちません。
「足せば合う」と「秘密を守る」の差が、この問題のすべてです。

## 考え方

`F_p` 上の加法的分散です。秘密 `s` を、和が `s` になる `n` 個の値にします。算術は 3 行で終わります。
これを暗号にしているのは、**そのうち任意の n-1 個が秘密と独立である**という性質のほうで、これは主張
するものではなく、示すものです。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが表示される。
2. **証拠を調べる**で、この deploy 固有の fixture と公開された証拠を読む。
3. Portal のエディタで starter のソースを編集する。
4. **公開テストを実行**を押し、直接回答欄があれば証拠から埋める。
5. 各 checkpoint をそのまま提出する。Portal が現在のファイルと回答を準備して送る。

checkout、ターミナル、ローカルエディタ、別画面、コピペは不要です。code checkpoint は現在の
エディタ内容を使います。直接回答は現在の deploy seed へ結び付くため、別 deploy からコピーした
値は拒否されます。

## 採点

5 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `share-and-reconstruct` | 50 | 4 つの設定での round trip、**および**自明な分割でないこと |
| `hides-the-secret` | 45 | 補完が field の**すべての**秘密に対して成功すること |
| `threshold` | 45 | 必要数と、2 つの証人 |
| `rerandomize` | 30 | 秘密が保たれ、全 share が動くこと |
| `transfer` | 30 | 未知の modulus と人数での再実行 |

hint は 5 個の checkpoint すべてに 3 段ずつあります (hint1 = 何をしたいのか / hint2 = どう考えるか / hint3 = 読めば解けるウォークスルー)。減点は各 checkpoint の配点の 50% 以内で、15 個すべてを開いても 200 点中 101 点が残ります。

## この問題を支える 2 つの checkpoint

**`hides-the-secret`** は field 全体を走査します。同じ n-1 個を持ったまま、**どの秘密に対しても**
辻褄の合う最後の 1 個を作れるなら、その n-1 個は秘密の証拠になっていません。これが「漏れない」の
実行可能な定義であり、どれだけ文章で説明するより強い証拠です。

**`threshold`** は数字だけでは通りません。必要数**と**、同じ n-1 個と両立する相異なる 2 つの秘密を
提出します。数を当てるのは簡単ですが、2 つの証人を作るのは理解が要ります。

## 公開テストが教えてくれないこと

公開テストは round trip を見ます。部分集合が何かを隠しているかは一度も問いません。そのため自明な
分割 (party 0 に秘密をそのまま渡し、残りを 0 にする) はきれいに通ります。party 0 は最初から全部
知っているのにです。hidden test はこのケースを名指しで落とします。

## Week 2 の対応づけ

Week 2 の教材は、`curriculum.md` が記録している commit の時点で**未公開**です。そのためこの問題は
`week2/README.md` を `kind: "placeholder"` で pin します。これは対応づけではなく、その commit 時点で
教材が存在しなかったという事実の記録です。`status` は `draft` のままです。

この pin があることで `bun run course:drift` は教材公開の日に `DRIFT` ではなく `PUBLISHED` を報告
できます。その後 Week 2 の course-sync issue が計画行とこの問題の対応づけを確定し、draft を外します。

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

`make reference-test` が mutation suite を実行します。壊した提出 6 種類と verifier を狙った 1 種類が
あります。そのうち 1 つ、`reconstruct` が剰余を忘れる変異は、**hidden test の初版では生き残りました**。
`check_roundtrip` が比較の前に learner の答えを正規化していたためです。現在は正準元であることを要求
しています。mutation suite が、提出ではなくテストのほうを検査した例です。
