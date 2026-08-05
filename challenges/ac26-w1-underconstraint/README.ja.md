# 通るのに、守れていない

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 120 · **Chapter:** Week 1 / Underconstraint
· **Role:** `assignment-companion` · **想定時間:** 60〜90 分 · **配点:** 300
· **必須前提:** `ac26-w1-constraint-lab`

## ストーリー

プライバシーを保った資格確認回路が、production 投入まで 2 日というところで監査から差し戻されました。
派手な指摘ではありません。通常の利用者は正しく判定され、失効済みは拒否され、数値も合っています。
ただ、報告書のどこかに無視できない一文があります。**不正な witness を作れば、条件を丸ごと迂回できる
かもしれない。**

誰かが、ポリシーが本当に求めていた回路を組み直し、穴を見つけ、それが実在することを示し、正当な利用者の
アクセスを壊さずに塞がなければなりません。それが今日の午後の仕事です。

## ポリシー

```text
失効カウンタが 0 であり、かつ発行者が認識済みのときにのみアクセスを許可する
```

回路に比較はありません。「この signal は 0 か」は、prover が供給する補助 signal `inv` を使って
**制約として主張する**ものです。

```text
iszero_a:  value * inv + out - 1 = 0
iszero_b:  value * out           = 0
```

2 本とも必要です。片方だけでも嘘は通り、**どちらの嘘が通るかは残したほうで変わります**。deploy 済みの
回路はこのうち 1 本を欠いており、どちらが欠けているかは seed によって変わります。

## 遊び方

Participant Portal で問題を起動し、表示された **Browser Workbench** を開きます。`inspect`、
`policy.py` の編集、公開テスト、build / audit / exploit / repair / mutation-transfer の
提出データ生成までブラウザ内で完結します。root-cause は Workbench に表示される形式の JSON を
自分で組み立てて Portal へ入力します。ホスト側のターミナルや checkout のファイル操作は必要ありません。

リポジトリから直接作問・検証する場合だけ、問題ディレクトリで次を実行できます。

```bash
make inspect            # ポリシー、deploy 済み回路、正常な witness 2 種類
make test               # 公開テスト
make reset              # starter/policy.py を元に戻す
```

Workbench または checkout で編集するのは `local/starter/policy.py` の 1 ファイル、4 つの関数です。
`intended_circuit()`・`audit()`・`forge_witness()`・`repair()`。

## 採点

6 つの checkpoint を独立に採点します。誤答は 1 回 15 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `build` | 60 | 組んだ回路が正常系 2 種類を受理し、既知の forgery をすべて拒否する |
| `audit` | 50 | 欠落した制約をちょうど特定し、完全な回路には何も報告しない |
| `exploit` | 60 | witness が deploy 済み回路を充足し、intended 回路を充足しない |
| `root-cause` | 40 | 欠落 id と、操作した全 signal の変更前後の値を JSON で提出 |
| `repair` | 50 | forgery を拒否し、正常系 2 種類を維持し、制約を盛りすぎない |
| `mutation-transfer` | 40 | **別の**制約が欠けた回路でも audit と反例生成が成立する |

hint は 6 つ中 4 つにあります (20 / 25 / 20 / 15)。すべて開いても 300 点中 220 点が残ります。

## ここでの exploit の定義

forged witness は **deploy 済み回路を充足し、かつ intended 回路を充足しない**必要があります。この
構造的な定義が要点です。「欠けた制約が実際に効いていた」ことの定義そのものであり、2 本のどちらが
落ちていても同じ判定で機能します。まぐれでは満たせません。両方の回路を通る witness は、何も偽って
いないからです。

## 罠

**公開テストは starter の状態で全部通ります。** starter の回路は正常な witness 2 種類をどちらも受理
するので、形の検査はすべて緑になります。同時に is-zero gadget が丸ごと無いため、アクセスを決める
`ok` は何にも縛られていません。

これが `misconception.happy-path-proves-soundness` の自然な生息地です。underconstraint は正常系を
壊しません。だからこそ危険で、だからこそ測る方法は反例を作ることしかありません。

## 公式 Week 1 課題との関係

これは `assignment-companion` です。公式課題が必要とする読解と攻撃の習慣を、**別の業務ルールと別の
signal 名**で作り、公式課題自身の解答経路の手前で止まります。講座の式・fixture・solution は一切転載
していません (`GOVERNANCE.md` §2 および §4)。

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
あります。うち 2 つはこの問題が拾うために存在する失敗そのものです。2 通りの欠落のうち片方に固定した
反例と、intended 回路も充足してしまい何も示していない反例です。
