# 予測してから走らせる

> Advanced Cryptography Program 2026 の独立・非公式な補助教材です。講義運営の承認や公式な採点を示すものではありません。

余りの計算を、予測→途中の誤り→実装→逆算→逆算できない条件→大量集計の順に調べます。必要な規則と小さい例は無料の問題文、各7欄のヒントは「仕組み→例→画面名の手順」の3段です。

最初の操作は **起動→証拠を確認→environmentを提出**。次にpredict枠を紙で追います。7欄で100点、誤答5点、ヒントは最初の3欄の1段目が1点、その他が2点で、全21個を開くと39点です。7欄のID・点数・採点方式は維持しています。

| 欄 | 提出するもの | 点 |
|---|---|---:|
| environment | 実行環境の合言葉（自動） | 10 |
| predict | 最後の数 | 10 |
| first-broken | 範囲外の値の位置（左端0） | 10 |
| generalize | advanceを書いたcounter.py | 20 |
| walkback | 指定範囲内の回数 | 15 |
| no-walkback | 同じstepと公約数を持つ新しい輪 | 15 |
| count-no-walkback | 包除原理を実装したcounter.py | 20 |

## 数学と学びの範囲

余りだけでは元の整数は一つに決まりませんが、余りを使うだけで秘密を守れるわけではありません。stepに逆元があれば範囲内の回数を戻せます。逆元がなければ複数の回数が同じ結果になり、これは楕円曲線での計算困難性とは別です。最後の課題は、素因数の個数を決め打ちせず、重複と区間の端を正しく扱う高速な関数を作ることです。

講義リポジトリのWeek 1 READMEとproof-of-exploitの公開説明（剰余の信号、満たすべき条件、正常例だけでなく反例を調べること）、作者ノートweek0の余り・逆元・零因子と、式・結果・理由を近接させる構成を照合しました。講義の解答や非公開テストは教材へ移植していません。courseAlignmentのweek1/diagnostic配置は維持し、対象外とされているweek0/slide.pdfへの引用は追加していません。

## 実行するもの

ComposeのWorkbenchとverifierの2コンテナです。公開ポートはWorkbenchの `127.0.0.1:18091` だけ。verifierは内部ネットワークで応答します。Workbenchイメージはstarter・公開テスト・表示処理のみで、fixture生成器・採点・referenceを含みません。seedはverifierだけへ注入し、Workbenchの親・healthcheck・提出コードへ渡しません。公開値はverifierから取得します。同じseedなら値は同じで、再起動だけで必ず変わるものではありません。

これは自習向けのlocal honor-systemです。リソース制限付きで実行しますが、**悪意ある提出コードを秘密から隔離するサンドボックス、競技順位や試験の安全性は保証しません**。コード採点はverifier内で実行され、Dockerの管理者も内部を調査できます。提出コードのネットワーク遮断や全ての子孫プロセスの停止も保証していません。

AWSリソースは作りません。起動中は手元のDockerのCPU・メモリ・ディスクを使います。作業後は自分で起動したCompose projectを `make verifier-down` で停止してください。

## ローカル検証

- `make test` / `make test-one ID=...`: starterの公開テスト。未完成のadvanceは失敗します。
- `make inspect`: 公開値を表示。Portalの合言葉は自動提出です。
- `make reference-test`: 正しい実装と14個のmutationをauthor imageで確認します。
- rootの `make install && make agent-gate`: metadataとカタログの検証。

実参加者HTTP経路と、hidden/referenceを読まない初回読解の飛躍・再読結果は `local/tests/hidden/READER.md` に記録します。実AWS・第三者参加者のプレイは未実施です。

Issue #716 の再読で、遅い関数の保存名と小例での比較手順を明記しました。証跡は `local/tests/hidden/READER.md`。参照検証で変異14件を検出し、公開プロセスの分離検証が成功。実workbenchが必要な2件はauthorターゲットではスキップです。
