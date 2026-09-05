# 名前を出さずに、二票目を見分ける

> Advanced Cryptography Program 2026 に対応する非公式・独立教材です。
> 提携・公認ではありません。お問い合わせは TenkaCloud へ。

Week 6 / 順序655 / 難易度3 / 200点 / draft / 目安30〜45分。

あなたは学校の投票システムを点検する担当者です。二重投票を止める処理が、
正当な一票まで消す不具合を、小さな数と受付の記録で調べます。

## 参加者の進め方

1. 「証拠を確認」の `p =` から `attempts =` までの代入文を Python に貼ります。
   最初の印を計算し、`label` へ提出します。
2. 最初の六欄で式と受付規則を試します。エディタでは対応するコードを関数へ写し、
   最後の式を return します。「公開テストを実行」で自分の結果を確認できます。
3. 後半は自分で反例を作ります。`unchecked` は正しい二票を消す四件の受付順。
   `collision` は四方式の受理数を4・3・2・4にする五票です。条件を満たす別解も受理します。

前半六欄100点、後半二欄100点です。後半の完成コードは掲載しません。
必要な規則と小さな見本は無料。任意ヒントは各欄「仕組み → 見本 → 自分の画面での手順」
の3段、各2点、計48点です。誤答は10点減点です。

| 回答欄 | 確かめること | 点数 |
| --- | --- | ---: |
| label | 使用済みを見分ける印 | 20 |
| repeat | 投票内容を変えても同じ印 | 15 |
| scopes | 今回の二つの投票番号を比べる | 15 |
| accept | 確認してから使用済みにする | 20 |
| count | 受理後の記録を数える | 15 |
| message | 投票内容を印に混ぜるとどうなるか | 15 |
| unchecked | 正しい二票を消す受付順を作る | 50 |
| collision | 四方式を見分ける五票を作る | 50 |

## 模型と境界

印は「秘密の数を二乗して投票番号を足し、pで割った余り」。pは5か7です。
見学用に秘密の数を表示するので、誰が投票したかを隠しません。参加資格や本人の印・
投票内容の正しさを秘密を見せず確認する実際の仕組みは実装せず、`verified` で確認済みかを
受け取ります。後半の五票はすべて確認済みと仮定します。実際の匿名投票やZKの実装ではありません。

参加者イメージは公開テスト、スターター、Portal APIを含みます。`FLAG_SEED`、問題生成器、
模範解答、非公開テストは採点用または作者用イメージだけにあります。提出を開始回に結び付ける
識別値は認証ではなく、正誤は別の採点用コンテナが判定します。

実行コードへは取得済みの公開データだけを渡します。Linux seccompで通信、他プロセスの記述子、
親への停止要求やリソース制限変更を禁止し、子にも引き継ぎます。親のメモリ参照を禁止し、
実行終了時に残る子プロセスを終了します。CLIも同じ制限を使い、設定できなければ実行しません。

Workbenchの18167番は127.0.0.1へ公開し、採点用ポートは内部限定です。両コンテナは非root、
読み取り専用でリソースを制限します。Dockerを操作できる人は自分のイメージを調べられます。

## ローカル確認と終了

この問題のディレクトリで実行します。

```bash
make inspect
make test              # 未記入なら失敗するのが正常
make test-one ID=label
make verifier-down
```

編集したスターターは標準入力でDockerへ渡すため、ホストのPythonや共有パスは不要です。
inspect/testは採点用コンテナを残します。終了時に `make verifier-down` で停止します。
クラウドのリソースは作らず、停止までローカルのCPU・メモリを使用します。

作者は `make reference-test`、リポジトリ直下で `make install` と `make agent-gate` を実行します。
参加者役の読解と実API確認は `local/tests/hidden/READER.md`。実AWSと人によるイベントリハーサルは未実施です。

[Week 6 composition context](https://github.com/zk-tokyo/advanced-cryptography-2026/blob/bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732/week6/README.md).
[Semaphore concept reference](https://js.semaphore.pse.dev/functions/_semaphore_protocol_proof.generateProof.html).
The square formula is an independently authored teaching substitute, not a real nullifier hash.
