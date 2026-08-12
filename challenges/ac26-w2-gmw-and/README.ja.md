# 選ばなかった方は、開かない

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 260 · **Chapter:** Week 2 / Boolean MPC
· **Role:** `mechanism` · **想定時間:** 50〜70 分 · **配点:** 200
· **Status:** draft — 後述の「Week 2 の対応づけ」を参照

## ストーリー

2 つの party が、2 つの秘密ビットの XOR シェアを持っていて、互いのシェアを知られずに AND が
必要になりました。XOR はただでした——mod 2 の線形演算なので手元で終わります。AND を展開すると
4 つの項が現れ、そのうち 2 つは因子が 2 つの party に割れています。手元の計算をいくら重ねても、
足りない半分は出てきません。

誰かがもう試しています。その下書きは転送を丸ごと省いて、各 party に自分のシェアを AND
させました。正しい答えを返すことが多いので、できあがったように見えます——そして今夜の記録された
run が 1 つ、`inspect` の出力の中で監査を待っています。

## 考え方

トイ群上の 1-out-of-2 Oblivious Transfer は、2 つの約束を同時に守ります。**sender はどちらが
選ばれたか知れない**。**receiver は選んだ 1 通しか読めない**。普通の通信ではどちらかが必ず
破れます。この 2 つの約束はどちらも「乱数がどこから来るか」の性質だと分かります——checkpoint の
1 つでは、乱数の範囲から 0 を除いただけの「硬化」した receiver を、あなた自身が破ります。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが表示される。
2. **証拠を調べる**で、この deploy の群、監査対象 sender の公開値、壊れた下書きの記録された run を読む。
3. Portal のエディタで starter のソースを編集する。
4. **公開テストを実行**を押し、直接回答欄は自分の推論から埋める。
5. 各 checkpoint をそのまま提出する。Portal が現在のファイルと回答を準備して送る。

checkout、ターミナル、ローカルエディタ、別画面、コピペは不要です。code checkpoint は現在の
エディタ内容を使います。直接回答は現在の deploy seed へ結び付くため、別 deploy からコピーした
値は拒否されます。

## 採点

5 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `ot-request` | 40 | request が choice を編み込み、b = 0 を受け、不正な入力を拒否すること |
| `ot-round-trip` | 50 | 選んだ枝が両 choice で開き、**かつ**もう片方が閉じたままなこと |
| `choice-leak` | 35 | 0 を捨てたときに選択を確定させる request 値の対 |
| `gmw-and` | 45 | 16 パターン全て、シェアごとの view、OT 実行回数ちょうど 2 回 |
| `cross-term-audit` | 30 | OT を省いた近道が壊れるパターンを、走らせる前に言うこと |

hint は 5 つ中 3 つにあります (20 / 20 / 15)。すべて開いても 200 点中 145 点が残ります。

## この問題を支える 2 つの checkpoint

**`choice-leak`** は「乱数の範囲」の問いを具体にしたものです。b が 0..q-1 の全部から引かれる限り、
request の分布は両 choice とも部分群全体で、通信路は何も言いません。0 という 1 点を除くと、
各 choice が出せる request から 1 つずつ欠けます——その request を観測したら選択が確定します。
提出するのは向きまで正しい対です。片方の値だけなら問題文の 1 文から拾えますが、対を作るには
それぞれの集合がなぜその点を失ったかが見えている必要があります。

**`gmw-and`** は合計ではなくシェアごとに採点します。2 つの出力シェアの XOR は項の再分配に対して
不変なので、「AND が合っている」だけの検査では、マスクを逆の party のシェアで打ち消した実装が
見えません。各出力シェアはその party が実際に持つ view から計算できなければならず、さらに hidden
test は OT のセッション数を数えるので、机の向こうを覗いてローカルに AND するシミュレーションは
回数 0 で落ちます。

## 公開テストが教えてくれないこと

公開テストは round trip 1 回と AND 1 パターンを走らせるだけです。request が何を漏らすか、
選ばなかった枝が閉じたままか、近道がどのパターンで壊れるかは一度も問いません。starter の encrypt
は両方のメッセージを同じ鍵で封をします。round trip は緑で、receiver は選ばなかったメッセージを
読めてしまいます。それを見るのは wrong-branch 検査だけで、mutation suite がそれを固定しています。

## Week 2 の対応づけ

Week 2 の教材は公開されています。公式演習は `toy-mpc` (Part A: 有限体上の加法的秘密分散と Beaver
乗算、Part B: 1-out-of-2 OT と GMW 型の秘密 AND) です。`courseAlignment` は commit
`e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9` の `week2/README.md` を `lecture`、
`week2/problems/toy-mpc/README.md` を `assignment` として pin します。この問題は **Part B**——OT と
GMW AND の段——の隣に置かれ、これで週が揃います。先行する 5 問の companion は Part A を扱って
います。API・fixture・test はすべて独自に設計し、公式演習の prose・template・test は転載しません
(GOVERNANCE.md の independent-reimplementation)。`status` はこの track の他の問題と同じく `draft` の
ままです。

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

`make reference-test` が mutation suite を実行します。壊した実装 7 種類、組み合わせ変異 1 種類、
verifier を狙った 3 種類があります。要になるのは組み合わせ変異です——request が choice を無視し、
**かつ**両方の枝が鍵を共有する実装は、両 choice で round trip が緑になります。round trip しか
見ない suite はこれを出荷してしまうので、suite は `check_round_trip` がこれを通し、
`check_wrong_branch` だけが殺すことを明示的に固定しています。もう 1 つの罠はマスクの入れ替えです。
どちらのマスクをどちらのシェアで打ち消すかを逆にしても z0 ^ z1 は全パターンで正しいままです。
hidden test が各シェアを party の view に対して採点し、全 seed でマスク不一致の対を追加で走らせるのは
そのためです。
