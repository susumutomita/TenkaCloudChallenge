# 余りで計算し、覆いの使い回しを見破る

> Advanced Cryptography Program 2026 の非公式・独立した companion です。講座運営者とは提携せず、承認も受けていません。問題文・コード・fixture は独自に作成しています。質問は TenkaCloud リポジトリへお願いします。

`ac26-bridge-clock` · track `advanced-cryptography-2026` · order 14 · difficulty 2 · 100点 · 想定30〜40分 · draft。

## 参加者の入口と完了

起動 → 証拠を確認 → n,u,v を見て加法の余りを計算し、add の3つ組を提出します。紙で開始でき、Pythonは任意です。8欄が全部正解になれば完了。本文・必要な式・一桁例は metadata の JA/EN instructions にあります。各欄のヒントは仕組み→式と例→Inspect名による入力手順の3段、1/1/2点（合計32点）です。誤答は各5点。

|ID|点|回答|
|---|---:|---|
|add|10|加法の2通りの余りと差|
|mul|10|乗法の2通りの余りと差|
|cover|10|原文に覆いを足した余り|
|uncover|10|同じ覆いを引いて戻る値|
|every|20|3つの候補を観測へ結ぶ覆いの値|
|count|10|全候補と対応する覆いの組の総数|
|reuse|10|2観測を再現する別原文a,bと共通覆いr。aはknown_firstと異なる|
|leak|20|1通目の原文も知る場合の2通目の復元|

前半は原文と覆いが見える練習、後半は別レコードです。後半の known_first も教材では最初から表示します。「観測だけを知る人」と「1通目も知る人」の比較であり、UIが後から初めて開示する手順ではありません。後半の実際の覆いと2通目は直接表示しません。

nは5〜9で、合成数も含みます。原文候補と覆いの一対一対応は加法の性質です。確率の主張には、覆いを全0..n−1から一様・原文と独立に選び、観測者には伏せ、1通に使う条件が必要です。固定fixtureはその無作為な実験を実証するものではありません。同じ覆いの2観測から分かるのは差の余りであり、通常の符号付き差との等式ではありません。

## 実装と採点境界

Workbench は公開 API、starter、公開テストのみを持ちます。fixture/期待値/hidden は非公開 verifier image、reference と mutation は author stage のみ。FLAG_SEED は verifier だけへ注入します。Workbench の保護した supervisor が内部経路から導出した署名鍵と公開 snapshot を取得し、子プロセスには公開 snapshot だけを渡します。既存 Schnorr の問題内境界を利用し、子のネットワーク・supervisor情報取得・残存プロセスを Linux で制限します。失敗した隔離は成功に変換しません。

回答は既存 /api/prepare → /verify の封印を通します。別起動の封印は拒否しますが、正しい数学的な値が他の起動と同じになることはあります。reuse は唯一の期待値との比較ではなく、本文の範囲・別原文・同一覆いの2式を検査します。順番の違う値、不足、余分な値、浮動小数、真偽値を整数へ丸めません。

127.0.0.1:18141 に公開するのは Workbench のみ。verifier:18151 は内部ネットワークのみ。両サービスは non-root/read-only/capabilitiesなし/no-new-privileges、CPU・メモリ・PID制限あり。ローカルホストやDocker管理者に対する秘匿は保証しません。自習用の honor-system 境界を完全な試験環境へ拡張する変更ではありません。

## 講義・ノートとの対応

講義 week0/slide.pdf の余り・時計（PDF6〜7ページ）、本人ノート week0 の時計と負の余り、week2 の加法的秘密分散を確認しました。出典の「大小が無いから隠れる」という短縮は採用せず、分布と観測者の知識条件を明記しました。源コードの場所と初読・再読結果は local/tests/hidden/READER.md に記録します。

## ローカル検証と終了

```sh
make inspect
make test
make test-one ID=reuse
make reference-test
make verifier-down
```

初期スターターの関数は未実装なので公開テストはFAILします。参加者はエディターで関数を実装して実行します。公開テストの前半は本文例、後半は本人の出力表示（正誤判定ではない）です。リスト/tuple は JSON 配列として出力され、その文字列を回答欄へコピーできます。reference-test は作問者専用で、14誤実装、20公開パラメータでの正答経路、構成の全別案・不正形式、Linux隔離と鍵のbootstrapを検査します。

別の専用起動で実HTTP境界を検査する場合：

```sh
FLAG_SEED=local-dev-seed docker compose -f local/docker-compose.yml -p ac26-bridge-clock-live-check up -d --build --wait
CLOCK_WORKBENCH_URL=http://127.0.0.1:18141 python3 -m unittest discover -s local/tests/hidden -p test_isolation.py -v
FLAG_SEED=local-dev-seed docker compose -f local/docker-compose.yml -p ac26-bridge-clock-live-check down
```

参加者用の実APIを通した確認結果は local/tests/hidden/READER.md に記録しています。親Portal全体、ブラウザ配置、実機、AWSは未確認です。第三者によるプレイは任意のリハーサルです。

## リソースとコスト

AWSリソースは作成しません。ローカルDockerのCPU・メモリ・ディスクとイメージ取得時の通信を使います。Composeはdownするまで動き、image/build cacheはその後もローカルディスクに残ります。
