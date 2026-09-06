# 秘密を送らずに確かめる — Schnorrの順番を試す

Advanced Cryptography Program 2026 の非公式・独立した自習教材です。講義運営者の承認・提携を示すものではありません。文章・例・実装は独自に作成しています。

Week 3 / order 305、8欄、200点、40〜60分を想定。status は draft のままです。

## 参加者の道筋

Participant Portal で「起動」→「証拠を確認」。最初はpとtだけを見て、tに掛けるとpで割った余りが1になる整数を探し、`field-inv` へ提出します。正解表示が最初の成功、全8欄の正解が完了です。紙とPortalの入力欄で解けます。

| 欄 | 入力 | 点数 | 役割 |
|---|---|---:|---|
| field-inv | 整数 | 15 | 余りによる割り算の道具 |
| add-points | [X,Y] | 25 | 異なる2点を足す |
| double | [X,Y] | 20 | 同じ点を足す |
| order | 整数 | 25 | Gの倍数表と一周の回数を作る |
| response | 整数 | 25 | 質問に答える |
| verify | [X,Y] | 30 | 公開の点で両辺を照合 |
| nonce-reuse | 整数 | 30 | 異なる質問への2応答から秘密を取り出す |
| transfer | [Rx,Ry,s] | 30 | 質問が先に分かる場合の記録を構成 |

各欄に仕組み→一般式と一桁例→Inspect名を使う手順の3段ヒント。1段2点、24段合計48点。誤答1回10点。必要な式と例は無料本文にもあります。従来の最後のID `transfer` は維持し、別曲線での応答計算から、公開式に合う複数の構成解を受理する課題へ変更しました。

任意の `schnorr_drill.py` は計算メモです。紙で解く場合は配布時のファイルを残したまま提出できます。関数を埋めて「公開テストを実行」すると見本のPASS/FAILと、その関数が今回の数で計算した値が出ます。テスト成功と採点は別で、回答欄へ提出して得点を確認します。外部Pythonは不要です。

## 数と意味

座標の素数は5または7、Gの位数も5または7です。点の加算を7回以内で一周でき、その表を後の計算で再利用します。数が小さいため、別環境の答えが偶然一致することもあります。値の由来でなく、その環境の数学に合っているかを検査します。

最後は `R=sG−efP2` を使い、秘密が与えられていない公開鍵の受理記録を構成します。これは質問を見てからRを決める実験であり、Rを先に固定する正規の対話で秘密を知っていることを示す証拠ではありません。実際の署名のハッシュ処理や確率分布の証明は含みません。この極小の曲線は総当たりで逆算でき、実用の秘密を守りません。

講義 Week 3 のスライド54〜60（乗法記法の対話・抽出・simulator）と61〜62（署名化との区別）、公式課題 `schnorr-from-scratch` の点加算を確認しました。作者ノート `advanced-cryptography-note/week3/index.html` の `ec_add`、`sigma_response`、`sigma_verify`、simulatorの説明を併せて確認し、式・小例・理由を隣接させる形式へ写しています。講義の公式課題の大きい固定テスト値は利用しません。

## Runtime と検証の境界

Composeは参加者Workbenchと非公開verifierを別コンテナで起動します。ホストへ公開するのは `127.0.0.1:18132` のWorkbenchだけ。参加者イメージはstarter・公開テスト・表示処理で、生成器、期待値、非公開チェック、referenceは含みません。seedを渡すのはverifierコンテナだけです。Workbenchは子プロセスから親を読めないよう保護してから、verifierの内部 `/workbench-key` で派生した封印鍵と、公開値を取得します。子へ渡すのは公開値のスナップショットだけで、鍵やverifier接続先は渡しません。公開proxyには鍵の取得経路がなく、Tiniやhealthcheckの環境にもseedや鍵を残しません。Linuxのsyscall制限で提出コードのネットワーク接続を拒否します。最後の構成はverifierが公開検証式で独立に確認し、一つの参考解との一致にはしません。

各回答は `/api/prepare` で問題・採点欄に結び付けた提出を作り、`/verify` へ送ります。verifierは問題・欄・署名を照合します。コンテナはnon-root、read-only、capability削除、CPU/メモリ/PID上限、内部ネットワークを使います。Docker管理者自身からの秘密保護は保証しません。

AWSリソースは作りません。ローカルDockerはホストのCPU・メモリ・ディスクを消費します。`make verifier-down` でこの問題のComposeを停止します。イベント環境の削除はプラットフォームの責任です。

## 作者の確認

このディレクトリで:

```sh
make reference-test
make test STARTER_FILE=local/reference/schnorr_drill.py
```

`reference-test` は誤った実装のmutationと、2曲線の手計算表・構成解の全探索・不正入力の回帰、鍵の起動時取得、Linuxのseed・親プロセス・ネットワーク隔離を実行します。

`make test` は一時的なCLI用コンテナで、Workbenchのサーバーは公開しません。実Composeの検査は、18132番ポートが空いている状態で、次の順に両サービスを起動・検査・停止します。

```sh
FLAG_SEED=local-dev-seed docker compose -f local/docker-compose.yml -p ac26-schnorr-live-check up -d --build --wait
SCHNORR_WORKBENCH_URL=http://127.0.0.1:18132 python3 -m unittest discover -s local/tests/hidden -p test_isolation.py -v
FLAG_SEED=local-dev-seed docker compose -f local/docker-compose.yml -p ac26-schnorr-live-check down
make verifier-down
```

Tiniやhealthcheckを含む全プロセスの環境を検査し、値は出力しません。Linux専用の子プロセス検査は `make reference-test` 内で実行します。macOSで上のコマンドを使った場合はその部分だけスキップされます。metadataはカタログrootの `make install && make agent-gate` で検証します。独立読解と実参加者APIの記録は `local/tests/hidden/READER.md` に保存します。実AWS・第三者参加者の確認は未実施で、ローカル検証と区別します。
