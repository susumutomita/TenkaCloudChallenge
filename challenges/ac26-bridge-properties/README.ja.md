# 満たす性質、破る性質

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 20 · **Chapter:** Bridge 0 / Security
Properties · **Role:** `diagnostic` · **想定時間:** 30〜45 分 · **配点:** 200
· **推奨前提:** `ac26-bridge-experiment`

## ストーリー

3 つの toy verifier が監査に持ち込まれました。別々のチームが書き、すべて出荷済みで、すべてテストが
緑でした。あなたの仕事は「どれにバグがあるか」を言うことではありません。全部あります。**それぞれが
まだ何を保証していて、何をもう保証していないか**を述べ、その主張を証明することです。

この区別がすべてです。Week 1 以降、completeness・soundness・privacy・zero-knowledge は全員が意味を
共有している前提で使われます。定義の暗記は実物の protocol に触れた瞬間に崩れます。他の 2 つを保った
まま 1 つだけを壊してみせることは崩れません。

## 主張

3 つの verifier はどれも同じ statement を検査します。

```text
a*w + b == c (mod p) かつ lo <= w <= hi を満たす w を知っている
```

意図的に小さな整数演算だけです。proof system も library も使いません。考える対象がすべて 1 画面に
収まるので、難所は性質のほうであって配管ではありません。

## 遊び方

Participant Portal で問題を起動すると、理論説明と 2 つのエディタが問題文と同じ画面に表示されます。
証拠の確認、編集、公開テスト、5 checkpoint の提出まで Portal 内で完結します。ホスト側のターミナルや
checkout のファイル操作は必要ありません。

リポジトリから直接作問・検証する場合だけ、問題ディレクトリで次を実行できます。

```bash
make inspect                    # 自分の statement、各 verifier の検査内容、公開 transcript
make test                       # 公開テスト
make test-one ID=classify       # 1 つだけ再実行する
make reset                      # starter 2 ファイルを元に戻す
```

Portal のエディタまたは作問用 checkout で編集するのは 2 ファイルです。

- `local/starter/classify.py` — 各 verifier は complete か。sound か。private か。
- `local/starter/counterexamples.py` — `False` と書いた性質をすべて証明する。

## 採点

5 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 提出するもの |
|---|---:|---|
| `incompleteness` | 40 | 正当な witness でありながら reject される値 |
| `unsoundness` | 45 | 主張の範囲外なのに accept される witness |
| `privacy-leak` | 40 | transcript だけから復元した witness |
| `property-matrix` | 35 | 3 × 3 の分類表 |
| `transfer` | 40 | 自分の 2 ファイル。未知の instance で実行されます |

hint は 5 つ中 3 つにあります (15 / 15 / 12 + 8)。すべて開いても 200 点中 150 点が残ります。

## この問題を成立させている規則

**示せないラベルは数えません。**

verifier を unsound と書くのは 1 行です。hidden test は matrix の `False` すべてを対応する反例と
突き合わせるので、範囲内の値を unsoundness の証拠として出しても通りません。何も示していないからです。
逆に、matrix が矛盾していれば反例だけでも通りません。分類できない破壊は理解ではないからです。

`transfer` checkpoint は、**あなたの**分類と**あなたの**生成器を、見たことのない seed 由来の instance
に対して実行します。たまたま通った値は残りませんが、statement を解く式は残ります。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。compose stack のすべてのコンテナと
Docker デーモンを管理する人を、中身の閲覧から止める手立てはありません。ここにある境界は
秘匿ではなく誤配送の防止です。build して動かす Workbench コンテナには starter と公開テスト
しか入っておらず、fixture も hidden test も参照解答も verifier 本体も入っていません。
それらは Workbench がネットワーク越しに話す、公開されていない second container と、
`make reference-test` が build する author 専用 image にだけあります。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。手元のコンテナだけです。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した提出 6 種類に加え、verifier 自体を狙った
2 種類があり、すべて検出される必要があります。

後の週にも効く設計上の注意を 1 つ。不完全な verifier の欠陥は range 下限が strict なことですが、
witness が range の内側にある instance では正しい verifier と完全に同じ挙動をします。不完全性は
実在するのに観測できません。そのため `incompleteness` checkpoint は、正当な witness が `lo` に一致
する hidden boundary instance で提出した生成器を評価します。その答えを `inspect` に表示はしません。
性質が壊れていることと、それを示せることは別の問題であり、後者を成立させるのは学習者ではなく作問者の
責任です。

公開される 3 つの protocol 名は、deploy seed から選んで並べ替えた中立な alias です。別 deploy では
名前も順序も変わります。`P1` / `P2` / `P3` の位置を覚えるのではなく、観察した挙動を分類してください。
