# 同じ答えを返す 8 つの prover が、 それぞれ別のことを言っている

## 前提

足し算・掛け算・割った余りと、Pythonの変数・if・for・関数・リスト・辞書を使います。暗号の用語と必要な規則はこの本文で説明します。

## 最初にすること

あなたは、秘密を扱う計算プログラムの監査担当です。8つの実装は答えが全部正しいのに、途中の秘密を外へ出すものがあります。**「証拠を確認」→ 許可された出力と実行記録を比べる → `prover.py` を編集 →「公開テストを実行」**から始めます。必要なら先に「起動」を押します。

最初は `classify` だけで進められます。下の分類表をコードにし、`classify` の「提出」を押してください。全8項目は同じファイルを採点します。直接の回答欄はありません。公開テストのPASSは形の確認、各「提出」の正解がその項目の完了です。不正解は15点、ヒントは1段2点（24段で48点）です。

```text
秘密を分けて持つ → 計算は正解 → 何を読み、何を外へ出した？
                                  ↓ 記録を監査
                           違反を報告 → 出力を直す
```

## 今回の仕組みと、使う言葉

- **秘密分散**は秘密を分けて持つ方法。1人分のデータが**シェア（share）**、1個の秘密について全員分を並べたものが **sharing** です。ここでは全員の数を足し、素数 `p` で割った余りが秘密になります。例：`p=7`、シェア2・4・3なら `2+4+3=9`、余り2。シェアの値と、それを識別する文字列のidは別です。
- **party**は計算に参加する1人（プログラム）。**MPC（秘密計算）**は、互いの入力を秘密にして協力して計算する技術。**ZK（ゼロ知識証明）**は秘密を渡さず主張を確認する証明。**co-SNARK**は秘密を分担した複数の参加者が共同で証明を作る方式です。この問題はその計算・記録の模型で、実際のSNARK証明や暗号としての安全性は採点しません。
- **witness**は秘密の入力の並び `w`。**relation**は確かめたい計算の条件で、ここでは公開の係数の並び `a,b` と組にします。同じ位置の数を掛けて足した数が `A,B`、答えが `C=A×B`。途中も最後も `p` で割った余りを使います。例：`w=[2,1], a=[1,2], b=[2,1], p=7` なら `A=1×2+2×1=4, B=2×2+1×1=5, C=20→6`。この計算は支給済みです。
- **マスク**は秘密を隠すためランダムに選ぶ数。**triple（三つ組）**は1回だけ使うマスク `x,y` と積 `z=x×y` を分けて持つ材料です。支給の `beaver_product` は `d=A−x, e=B−y` を**開示（open：全員が読める数に戻す）**し、1回の通信でCを作ります。**round**は開示をまとめる回、その名前は `round_id_for(row)` です。
- `d` だけではマスクを知らずAが分かりません。しかし **`A=(d+x) % p`** です（`%` はPythonの「割った余り」）。小例：`A=3,x=5,p=7` なら `d=−2→5`。dとxが両方漏れると `5+5=10→3`。この復元が6番の仕事です。
- **specimen**は実行して調べる対象 `S1`〜`S8`。**probe**は1回動かす関数。**runtime**は計算と操作の記録を提供する仕組み。**capability**は呼ばれた操作の種類（`open` 開示、`reconstruct` 復元、`peek` シェアを読む）。
- **channel**は外への出口で、`artifact`（次の処理への提出物）、`log`（作業記録）、`metrics`（名前付き計測値）、`error`（失敗記録）の4つ。**disclosure**は4出口の内容、**evidence**はそれと操作記録を合わせた証拠、**policy**は公開してよい名前と形の規則です。

`tuple`は値の並び（例 `("peek",)`）、`None`は該当なしです。`ValueError`は入力条件の違反、`TripleMisuse`は三つ組の再利用を知らせる例外です。例外は `raise ValueError("入力を確認")` のように出します。

## 無料のAPIと記録の読み方

`prover.py` の冒頭に必要な関数をimportしてあります。対象実装のソースや秘密の属性 `_value` は読まず、渡された記録を調べます。各操作は支給済みで、作り直す必要はありません。

| 名前 | 入力 → 結果 |
|---|---|
| `probe(id)` | 対象を新しい状態で1回実行 → evidence |
| `probe(id, malformed_row(evidence.row))` | 行の長さの申告を壊して再実行 → 失敗時のevidence |
| `evidence.runtime.reached()` | 操作の順に `{"capability", "party", "operands"}`。partyは読んだシェアの持ち主、operandsはidの列。値は入りません |
| `evidence.runtime.openings()` | 開示の順に `{"roundId", "shareIds", "maskedBy"}`。maskedByは使ったマスクのidの列 |
| `evidence.row`, `evidence.setting` | 今回の行と設定。`setting["p"]` は割る数、`setting["parties"]` は人数 |
| `evidence.disclosure` | `.artifact`, `.metrics` は辞書。`.log` は記録の列。`.error` は記録1個か `None` |
| `serialized(disclosure)` | sharingを値のないid文字列の列にして、外部が受け取る形へ変換 |
| `is_sharing(value, parties)` | 実行中のvalueが人数分のShareオブジェクトか → True/False |
| `beaver_product(runtime,row,halves,triple)` | A・Bのsharingと未使用三つ組 → A/B/Cのsharing、d/e、tripleId/roundIdを含む辞書 |
| `clean_artifact(row, proof)` | proofから次の処理へ渡す辞書を作る。**公開自体はしません** |
| `sink.publish(artifact)` | artifactを公開。ほかは `sink.emit(event, **values)` / `sink.metric(name,value)` / `sink.fail(message, **values)` |

`log`は `{"event": 見出し, "values": 辞書}`、`error`は `{"message": 見出し, "values": 辞書}` です。監査するのはvaluesの項目名と値です。見出しの文面はこの模型の対象外です。

「証拠を確認」には設定、行、許可名、分類用の見本、きれいな1回の記録が出ます。`print(entry)` や `print(evidence.runtime.reached())` を自分の関数に入れて公開テストを実行すると、渡された記録を画面で読めます。`prover.py` の保存内容が全チェックポイントに送られます。

## 1〜4：記録の規則をコードにする

**1. `classify(entry,row)` → クラス名1個。** `origin`は relation / witness / triple / runtime、`form`は metadata（識別情報）/ element（整数）/ share / sharing、`audience`は everyone / participant / party / verifier（採点側）です。語彙外、または `opened` が `None` でも辞書でもなければ `ValueError`。次の表を上から確かめ、最初に合う分類を返します。

| 条件（上を優先） | 返す文字列 |
|---|---|
| audienceがverifier | `verifier-only` |
| openedがあり、下の「許可開示」の2条件を両方満たす | `allowed-open` |
| originがrelation、またはformがmetadata | `public-input` |
| formがshare | `secret-share` |
| formがsharing、かつaudienceがparticipant | `participant-artifact` |
| 残り | `secret-intermediate` |

**許可開示の規則：** `maskedBy`が空でない **かつ** `roundId == round_id_for(row)`。例：許可回が `r:mul` のとき、`{"roundId":"r:mul","maskedBy":["x"]}` は許可、同じ回で `maskedBy: []` は不許可です。これは記録上の許可規則であり、マスクがあるだけで一般の暗号安全性を証明する規則ではありません。

**2. `capability_audit(probe,id)` → 操作名のtuple。** 正常な行と `malformed_row` の行を1回ずつ調べ、両方で呼ばれた名前から `PROTOCOL_CAPABILITIES`（`open`だけ）を除きます。重複を除いて並べ替えます。例：`open, peek, peek` → `("peek",)`。

**3. `open_set_audit(evidence)` → 辞書のtuple。** 許可されない開示を元の順番で返します。各辞書は `roundId`, `shareIds`（tupleにする）, `masked`（maskedByが空でなければTrue）。無違反なら `()`。公開済みでも許可されたとは限りません。

**4. `cross_party_audit(evidence)` → `{"peeks", "parties", "crossed"}`。** reachedからpeekだけを数え、持ち主番号を重複なく並べます。`crossed`は持ち主が2種類以上かです。例：持ち主 `1,0,0` → `peeks=3, parties=(0,1), crossed=True`。この検査がFalseでも、全ての読み取りが秘密を守ると証明したことにはなりません。

## 5〜6：外へ出た内容を調べる

**5. `leakage_audit(evidence)` → `(出口,項目名)` のtuple。** 4出口をすべて調べます。`ALLOWED_NAMES`にない名前、または `SHARING_ONLY_NAMES`（A/B/C）が `is_sharing` を満たさない値を運ぶ項目を報告します。重複なく並べ替え、無違反なら `()`。例：artifactのCが整数なら `(("artifact","C"),)`。許可名は「証拠を確認」と定数で読めます。

**6. `leakage_evidence(disclosure,setting)` → `{"value", "from"}` または `None`。** この入力は `serialized` 済みですが、辞書ではなく `.artifact`, `.log`, `.metrics`, `.error` の4属性を持つオブジェクトのままです。各sharingの中身だけがid文字列の列になります。4出口をartifact→log→metrics→errorの順、各辞書の項目順に調べ、最初に復元できた違反項目を返します。fromはその `(出口,項目名)` です。復元できない文字列やid列は飛ばします。

| 違反項目の形 | 復元する式（最後にpで割った余り） | 1桁の例 p=7 |
|---|---|---|
| 空でない整数の列 | 全て足す | [2,4,3] → 9 → 2 |
| 整数で、**同じ記録**に整数dがある | その整数 + d | 5とd=5 → 10 → 3 |
| 整数で、同じ記録に整数dがない | その整数 | 3 → 3 |

2行目の整数は、この問題のデータではマスクです。dと組にして秘密を復元できます。表を上から確かめます。True/Falseは数に数えません。serialized後のA/B/Cについては、空でないid文字列の列が正しい形です。合法な項目から値を推測してはいけません。どの違反項目からも復元できなければ `None` です。

読み方の例（`p=7`）。この形の `disclosure` が関数へ渡されます。

```python
disclosure.artifact  # {"C": ("share:0", "share:1")}
disclosure.log      # ({"event": "作業記録", "values": {"d": 5, "mask": 5}},)
disclosure.metrics  # {}
disclosure.error    # None
```

`C`はid列なので復元しません。`d`は許可名。`mask`は許可外で、同じ `disclosure.log[0]["values"]` に整数dがあるので、`(5+5) % 7 = 3`。結果は `{"value": 3, "from": ("log", "mask")}` です。artifact・metricsではその辞書、log・errorでは各記録の `values` が「同じ記録」です。別のログ行のdは使いません。

## 7〜8：直し、組み合わせた欠陥でも確かめる

**7. `private_prover(runtime,row,halves,triple,sink)`。** 支給関数で1回計算し、そのproofを返し、`clean_artifact(row,proof)`をsinkへ公開します。返値のA/B/Cと公開artifactは同じ今回の計算を表し、CはA×Bに戻る必要があります。識別情報は渡されたrow/triple/roundのものです。開示は許可されたd/eの2個だけ、通信は1回、reconstruct/peekは使いません。ログ等は任意ですが5番の規則を守ります。**三つ組が消費済みなら `TripleMisuse` をそのまま外へ伝え、4出口には何も追加しません。**

**8. `transfer`。** 新しい関数は不要です。同じ監査を、1つの実行に複数の欠陥を組み合わせた未知の実装へ適用します。正常時だけでなく失敗時も調べます。`leakage_evidence`だけは最初の復元可能な1件、他は各関数が約束した全件を返せることが終点です。id、人数、p、係数、違反項目の名前を見本の値に固定しないでください。

## この監査の限界

値を何も出さないプログラムは正しい修復ではありません。次の処理が使うartifactは必要です。一方、正しい答えだけを公開できても、操作記録や失敗時の出口から漏れることがあります。この模型は記録された操作と4出口を監査します。未記録の属性読み取り、時間の差、ログ見出しへの秘密の書き込みは保証しません。


## 作者・運営者向け

8項目は30・40・40・30・45・45・45・25点、合計300点。不正解は各15点。各項目は「仕組み → 小さい入出力例 → 実ファイルの手順」の3ヒントで、各2点、全24段で48点です。

`local/mutation.py`は参照解を意図的に壊し、採点が拒否することを確認します。単なる「漏れる/漏れない」が合っていても、出典・複数の違反・共有された出力・失敗時の挙動が違えば通りません。最終項目は前7項目の単純な再実行ではなく、未知の実装に正常系と失敗系の複数の欠陥を組み合わせます。件数は実行ごとに出力します。

### 実行環境と境界

ローカルDocker Composeの2サービスです。参加者のWorkbenchは起動・証拠・編集・公開テストと提出APIを持ち、採点は非公開ポートのverifierへ転送します。`local/participant`には支給の計算模型・記録・対象実装だけを置き、`fixtures`、hidden tests、reference、seedの導出は参加者イメージへコピーしません。作者用イメージにだけ全材料を置きます。

提出するのは`prover.py`だけです。採点処理は時間・メモリ・プロセス・出力量を制限します。不正解の説明は公開済みの契約の違反を示し、秘密の正答は返しません。ローカルDockerの管理者から採点材料を隠せる構成ではないため、自習では名誉制です。競技では参加者が管理しないverifierが必要です。

模型のシェアは小さい素数の数です。記録は全てのメモリ読み取りを捕捉せず、文字列の見出しに秘密を書くことも監査しません。`maskedBy`とroundの条件は教材内の記録規則であり、一般のMPCやSNARKの安全性証明ではありません。

### ローカル検証・片付け

```bash
make inspect                    # 設定・記録・分類見本
make test                       # 現在のstarterで公開テスト
make test-one ID=classify        # 1項目に絞る
make reference-test             # 作者用の参照解とmutation
make verifier-down              # 起動したサービスを停止・削除
```

初期starterは未実装なので公開テストの一部はFAILです。公開テストのPASSは採点の正解を意味しません。`make test`と`make inspect`は必要なverifierを起動します。実AWSのデプロイや第三者参加者テストの実施を、この文書は主張しません。

### 資料との関係・費用

Advanced Cryptography Program 2026の非公式・独立教材です。コース運営とは無関係で、質問はTenkaCloudへお願いします。`courseAlignment`は`curriculum.md`が記録するcommitのWeek6資料とco-SNARK演習を参照します。文章・模型・実装・fixtureは独自です。

ローカル実行はクラウド資源を作りません。Dockerホストの実行資源だけを使い、想定演習時間は60〜90分です。クラウド運営時のホスト料金はプラットフォーム構成に依存します。演習後は上の停止コマンドを実行してください。

## 採点を親プロセスに置く実行境界（Issue 837）

既存の checkpoint 判定は信頼する親が実行します。提出 Python は制限された別の Linux worker で動き、
境界を渡るのは型付きの値です。出力した採点結果や早期終了では得点になりません。使用する箇所で
tuple/list・整数/真偽値・bytes・辞書キーの区別を維持します。worker にはファイル・ネットワーク・signal・
memory・出力・process の制限を設け、提出全体の上限 12 秒を Workbench proxy の 15 秒より短くします。
image は non-root、Compose と作者 runner は init ありです。これは検査した対策の範囲で、あらゆる
隔離の欠陥や副経路を排除したという保証ではありません。

変更後の Linux Docker で、論理変異 51 件と別枠の既存採点偽装プローブ 1 件を検出し、実行境界回帰 11 件も成功しました。
境界回帰は参考解の全 8 項目、正しい別解、出力・終了による偽装、非公開ファイル・親 signal の拒否、
型保持、入れ子の上限、non-root、待ち時間の整合を確認します。ネイティブの変異検査は採点の論理、
別の境界回帰は実行隔離の確認であり、区別しています。

non-root の実 Workbench HTTP で config・Inspect・starter を取得しました。未完成の starter の初回提出は
失敗し、作者の参考解は公開 7 テストと prepare・verifier proxy 経由の全 8 項目に合格しました。
同じ提出経路で出力・終了による偽装も拒否しました。カタログは 116 件有効です。これは作者検査と提出経路の
証拠で、初見参加者の自力成功を示すものではありません。ブラウザ操作・配備先での得点反映・デプロイは未実施です。

Runtime と Share の値は親に保持します。参照権限を呼び出しごとに区切り、提供 API の操作を実際の runtime に送ります。前の呼び出しの権限は再利用できません。監査 probe は親で対象を動かして記録のコピーを返し、修復時の公開は親の Sink に記録します。

採点時も公開APIのPython型の関係を維持します。isinstanceで型を確認する正しい実装と、全8項目の参考解が評価経路を通過しています。

### Supported computation imports / 計算用の標準ライブラリ

Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
This list covers optional standard-library helpers. Imports already supplied by the starter (including __future__ and problem APIs) are also supported. Other optional imports and file/network access are not supported in grading.
この一覧は追加できる標準ライブラリです。スターターに最初からあるimport（__future__や教材のAPIなど）も、そのまま使えます。それ以外の追加importとファイル・通信操作には採点時は対応しません。
