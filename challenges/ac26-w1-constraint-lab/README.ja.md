# 0 になるべき式の集まり

> Advanced Cryptography Program 2026 の非公式・独立した補助教材です。講座や運営者とは
> 提携しておらず、承認も受けていません。問題文、コード、fixture、例は独自に作成しました。
> この問題への質問は TenkaCloud へお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 110 · **Chapter:** Week 1 / Arithmetic
Circuits · **Role:** `mechanism` · **想定時間:** 60〜90 分 · **配点:** 200
· **推奨前提:** `ac26-bridge-experiment`、`ac26-bridge-properties`

## 参加者の進め方

入場条件を調べるツールが「拒否」としか表示しません。各条件の計算結果を表示し、最初に
破れた条件を見つけられるようにします。Portal の **Start → Inspect evidence** を選ぶと、
割る数 `p`、順序付きの `circuit`、正しい値の割り当て `honestWitness`、壊れた割り当て
`brokenWitness` が出ます。壊れた値を先頭から代入し、最初の非 0 行を探しましょう。
`first-broken` は紙の計算から始められます。

式が 0 になる条件を **制約 (constraint)**、制約のリストを **回路 (circuit)** と呼びます。
変数が **signal**、その値を割り当てる辞書が **witness**、代入後の計算結果が **residual**
です。計算は素数 `p` で割った余り、0〜p−1 で行います。Python の `value % p` でこの範囲へ
戻す操作が正規化です。x=2,y=3、別に申告された和 z=5 なら `x+y−z=0`。z=6 なら −1 となり、
p=7 での余りは 6 なので条件が破れています。

| kind | 正規化する前の式 |
|---|---|
| `mul` | left × right − out |
| `add` | left + right − out |
| `const` | signal − value |
| `boolean` | b × (b − 1) |
| `member` | 許可された値 a ごとに (signal − a) を掛けた積 |

p が素数なら、積の余りが 0 のとき少なくとも一つの因子の余りが 0 です。この性質により
boolean は 0 と 1 だけ、member は列挙した値だけを許します。合成数では同じ議論が使えず、
たとえば 2×3 を 6 で割った余りは 0 です。本問は値を公開して直接代入する教材です。
暗号学的な証明の材料となる表現を扱いますが、値を隠す証明や短い証明そのものは実装しません。

Portal の `field.py`、`circuit.py`、`gadgets.py` を編集し、**Run public tests** を実行します。
コードの 4 問は各行から提出すると、エディタ内の 3 ファイルが送られます。`first-broken` は
`constraintId` と `residual` を持つ JSON、たとえば `{"constraintId":"row_id","residual":6}` を
自分の画面の値で入力します。trace のキーは `id`、答案では `constraintId` です。
全 5 問の正解で完了します。ホストのターミナルは必要ありません。

最後の range では 0/1 の桁を組み合わせます。3 桁、例の素数 p=11、値 5 なら桁は 1,0,1 で、
`(1×2+0)×2+1=5` です。各桁を boolean で制約し、2 倍と次の桁の追加を add で表し、最後の出力を
元の signal につなぎます。witness は `(value // 2**i) % 2` で桁を求め、中間値もすべて
割り当てます。1 桁なら元の signal の boolean だけで十分です。一般形は `3×bits−2` 本で、
`5×bits` 本の上限内です。必要な式は実装前に問題文で示しています。締めくくりでは、桁の
boolean 制約を一つ外すと、どう範囲外の値が通り得るかを考えます。

## 採点

| Checkpoint | 配点 | 検査すること |
|---|---:|---|
| `residuals` | 45 | 別の素数でも正規化、各 residual、trace の順序、signal 欠落時のエラーが正しい |
| `first-broken` | 40 | 公開例で最初に違反した行と、非 0 の正規化済み residual |
| `boolean` | 35 | 提出した制約が 0 と 1 だけを許す |
| `membership` | 30 | 提出した制約が指定された値だけを許す |
| `range` | 50 | 範囲内の各値に正しい witness があり、補助値をどう割り当てても範囲外が通らない |

誤答は 1 回 10 点減点です。全問に「仕組み → 小さい計算例 → 実画面・ファイル名での手順」の
3 段ヒントがあり、15 件をすべて開くと合計 60 点です。

gadget は提出コードとは別の、5 種類の kind を知る採点器で評価します。自分の評価器に独自の
kind を追加しても採点器は拡張されません。range は `boolean` / `add` / `mul` / `const` のみ、
`5×bits` 本以下です。幅は 1〜6 桁で、`2**bits < p` が成り立ちます。既存の厳密探索は、必要なら
範囲外の値を一つずつ固定する処理も含め、幅ごとに 20 万割り当ての上限を維持しています。
無拘束の補助値の水増しや、boolean の選択子で範囲外の値を一つ隠す構成を拒否し、正しい 2 倍の
鎖や定数の重みを使う構成を受理します。公開例が一つ通ることと、無効な割り当てをすべて防ぐことは
異なる性質です。

## 実行構成と境界

Compose は non-root・read-only の 2 サービスを起動します。Workbench の公開先は
`127.0.0.1:18093` のみです。verifier はポートを公開せず、内部ネットワークで通信します。
`FLAG_SEED` を受け取るのは verifier だけです。参加者 image には starter、公開テスト、adapter
が入り、fixture generator、hidden checker、参照解答は入りません。

公開テストと内部採点は、提出された関数を別の Linux process で実行します。信頼する親が
返された JSON の値を調べ、提出コードの標準出力を採点結果として扱いません。内部 checker の
制限付き subprocess と厳密探索は維持します。提出コードを実行する前に、worker へ source と
関数の入力だけを渡し、seed のない環境変数で起動し、ファイルの open、ネットワーク、プログラムの
実行、親への signal・resource limit 変更を拒否する制約を適用します。`/proc/1/environ` を含む
process 環境の読み取りも対象です。Linux 隔離を使えない場合は実行を拒否します。本問に必要な
標準ライブラリは先に読み込みますが、別ファイルを開く必要がある import は拒否されます。

値を返す通信には 15 秒の期限とフレーム・ログ上限があり、CPU・メモリ・process 数も制限します。
内部採点器の既存 20 秒上限も維持します。成功時も timeout 時も process group を終了させ、
子孫 process を残しません。コードの誤答 message は公開済みの性質に限り 1,900 文字まで、
手入力の誤答には理由を返しません。合成入力による実検証を行いましたが、あらゆる host・kernel
攻撃への保証ではありません。Docker の管理者は verifier を閲覧できます。参加者自身が Docker を
管理するローカル実行は、その管理者に対して秘密を隠しません。競技として運用する場合は、verifier の
管理権限を参加者へ渡さないことが前提です。

## ローカル検証と停止

作問者が問題ディレクトリで実行するコマンドです。

```bash
make inspect                   # 起動中の verifier から公開証拠を取得
make test                      # 編集した starter で公開テスト
make test-one ID=trace          # 公開テストを絞る
make reference-test            # 作問者用 mutation と Linux 境界テスト
python3 local/probes/range_exactness.py  # 厳密探索と総当たりの比較
make verifier-down             # 本問の Compose サービスと network を停止
```

配布 starter は修正前に落ちる状態です。`make reset` は starter 3 ファイルの編集を捨て、追跡済みの
内容へ戻します。`make reference-test` が作る author image は参照解答と hidden material を含むため、
参加者 image として配布しません。壊した実装と正しい range の対照例を含む mutation suite の後に、
実 Linux で境界を検査します。`range_exactness.py` は小さい乱数 gadget 400 件を総当たりと照合し、
正しい 3 構成も確認します。metadata/catalog の検証は、repository root の `make install` と
`make agent-gate` で別に行います。

作問者用の [読解記録](local/tests/hidden/READER.md) に、初読、変更していない読者コード、実 HTTP・
Portal 経路、境界の負例を記録しています。実 AWS イベントや独立した人間のプレーテストは主張しません。
公式 Week 1 課題へは、どの条件がどの式で縛られ、どの条件が足りないかを見る力をつなぎます。
講座の fixture や解答は転載していません。

## リソースと費用

本問のローカル実行で AWS リソースは作らず、AWS Region の指定もありません。想定 60〜90 分の間、
2 コンテナが手元の CPU・メモリ・一時ディスク・image/build cache を使います。サービスは
`make verifier-down` または platform の teardown まで動き続けます。停止後も Docker image と
build cache は残り、必要ならその所有者が別途削除します。固定の金額は主張しません。

## ファイル属性操作の隔離追加

Linuxの提出コード用filterで、ファイル・ディレクトリの作成、リンク、名前変更、削除、属性変更も拒否します。ファイルopenだけの禁止では、子の終了後にこれらの変更が残りました。問題内の回帰は実filterを16個の使い捨て子プロセスへ適用し、19操作のEPERMと、親が所有する一時fixtureの内容・一覧・権限・所有者・時刻・拡張属性が変わらないことを確認します。一時fixtureも最後に削除します。API・得点・数学的な正答条件・実行期限は変更せず、既存の正答コードと検査を維持します。before/afterの範囲とコマンドは `local/tests/hidden/READER.md` に記録しています。

## 計算用の道具と実行時間

計算に使える標準ライブラリ（Python に付属する道具）は `collections`, `decimal`, `fractions`, `functools`, `hashlib`, `hmac`, `itertools`, `json`, `math`, `operator`, `random`, `statistics`, `time`, `typing`。提出ファイル内で import できます。追加パッケージ、ファイルの読み書き、ネットワーク通信は使えません。提出コード全体の実行は15秒までです。


### ヒントの読者確認（Issue #716）

競技者向け本文・ヒント・starterだけを読む独立確認で、日本語のmemberの手順が許可値そのものを掛けるように読める問題を発見しました。各許可値aについて差(x−a)を掛ける表の式に合わせて修正しました。例のp=7、allowed=[2,5]では、x=2の積は0となります。確認者は非公開テスト・referenceを読んでおらず、実提出は行っていません。
