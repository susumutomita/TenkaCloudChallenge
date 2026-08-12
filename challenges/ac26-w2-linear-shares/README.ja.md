# 誰とも話さずにできること

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 220 · **Chapter:** Week 2 / Local Linear
Operations · **Role:** `mechanism` · **想定時間:** 35〜50 分 · **配点:** 200
· **必須前提:** `ac26-w2-secret-sharing` · **Status:** draft — 後述の「Week 2 の対応づけ」を参照

## ストーリー

前回の監査人たちの仕組みは動きました。数字は分割され、誰も他人の数字を見ません。次に彼らがやりたい
のは、実際に**計算する**ことです。合計、加重合計、移動平均。

心配なのは、一手ごとに全員招集が要るのではないかということです。要りません。やりたいことの大半は、
各監査人が自分の手元の紙だけで済ませられ、それでも断片は正しい答えへ足し合わさります。どの手順が
それに当たるのかを正確に決めることが、この仕組みを理論から実用へ変えます。

## 操作カタログ

```text
add-shared      x の share, y の share  ->  x + y の share
sub-shared      x の share, y の share  ->  x - y の share
add-constant    x の share, 公開値 c    ->  x + c の share
mul-constant    x の share, 公開値 c    ->  x * c の share
negate-shared   x の share               ->  -x の share
mul-shared      x の share, y の share  ->  x * y の share
square-shared   x の share               ->  x * x の share
compare-shared  x の share, y の share  ->  比較結果
```

各 deploy は、この中からローカル操作を 2 つ、通信が要る操作を 2 つ選び、順序も変えて出題します。
固定の 4 行を覚えるのではなく、規則を分類してください。

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
| `add-shares` | 40 | 4 設定で和へ復元される |
| `add-constant` | 50 | `x + c` へ復元される。典型的な誤答を名指しで落とす |
| `mul-constant` | 35 | `x * c` へ復元される |
| `no-communication` | 40 | この deploy が選んだ 4 操作を 0 round / 非 0 round に分類 |
| `transfer` | 35 | 未知の設定と合成式での再実行 |

hint は 5 つ中 2 つにあります (20 / 15)。両方開いても 200 点中 165 点が残ります。

## 素直ではない 1 つ

全 party が自分の share に `c` を足すと、share の総和は **`x + n*c`** になります。正しくは 1 party
だけが定数を畳み込みます。

この誤りは隠れ方が巧妙で、注目に値します。

- `n = 1` では正解と**区別できません**。
- `n` が大きくても `c` の倍数だけのずれなので、固定の 1 設定を見るテストは偶然通してしまいます。

hidden test は `n ≥ 2` の 4 設定を回し、`x + n*c` という値を名指しで落とします。偶然すり抜けること
はありません。

ここで直される直感は「線形なのだから全員が同じことをすればよい」です。share 同士の加減算、符号反転、
公開定数倍では使えますが、公開定数の加算だけは 1 party が定数を畳み込む必要があります。

## なぜ 0 か非 0 かで採点するのか

`no-communication` は正の round 数の完全一致を求めません。乗算・二乗・比較が何 round かかるかは方式に
依存しますが、**そもそも通信が要るかどうか**は依存しません。採点は確定している部分にだけ賭けます。

## 次につながるところ

ここで引いた境界が、次の問題の動機そのものです。非線形操作に通信が要るなら、その一部を前処理へ
追い出せないか、という問いが自然に出てきます。Beaver triple は乗算についてそれを行います。

## Week 2 の対応づけ

Week 2 の教材は公開されました。公式演習は `toy-mpc` (Part A: 有限体上の加法的秘密分散と Beaver 乗算、
Part B: 1-out-of-2 OT と GMW 型の秘密 AND) です。`courseAlignment` は commit
`e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9` の `week2/README.md` を `lecture`、
`week2/problems/toy-mpc/README.md` を `assignment` として pin します。以前の `placeholder` pin からの
移動は、SYNC.md §3/§5 に従い教材を読んだ上で行いました。この問題は Part A の「share 上の通信不要な操作」の隣に置かれています。
公式演習の prose・template・test は転載しません (GOVERNANCE.md の independent-reimplementation)。
`status` はこの track の他の問題と同じく `draft` のままです。

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
あります。うち 2 つは定数の罠のニアミス形 (全 share へ畳み込む場合と、2 つの share へ畳み込む場合)
です。前者だけを捕まえるテストでは後者が通ってしまうためです。
