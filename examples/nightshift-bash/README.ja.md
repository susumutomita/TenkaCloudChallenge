# NIGHTSHIFT — 夜間バッチを守れ

Bash Battle v0.1.0。**調べる → 無害に実証する → 業務を止めずに直す → 再起動で確かめる**、3ミッションの実践演習です。

参加者の操作、アプリ、採点器はBashとLinuxコマンドだけ。Python、Node.js、AWSアカウント、攻撃フレームワークは不要です。安全に変更できる使い捨て環境をDockerで用意します。「Bash内蔵コマンドだけ」という意味ではありません。

**この版は単体CLI版です。TenkaCloudに登録・統合済みではありません。2026-09-27にmacOS/ColimaのDocker 29.6.1でビルドと統合テスト48項目が成功し、模範修復の1,000点を確認しました。最新の検証範囲は [検証記録](docs/PR-VERIFICATION.md) にあります。**

**Portalへのカタログ登録は対象外です。** 未対応ランタイムを宣言しないため `metadata.json` は置いておらず、Portalの問題一覧には登録されません。ネイティブ連携は別途実装が必要です。英語の問題文は `START-HERE.en.md`、英語ヒントは `./gameday.sh hint 1 1 en` で開けます。

## まず起動する

ホストにはBash、Docker Engine / Docker Desktopと一般的なUnixコマンドが必要です。macOS、Linux、WindowsではWSL2上のBashを想定しています。DockerのLinuxコンテナを使います。Docker Composeは不要です。

リポジトリのルートから、問題のフォルダに移動して実行します。

```bash
cd examples/nightshift-bash
./gameday.sh doctor
./gameday.sh start team1
./gameday.sh shell team1
```

初回の`start`はイメージをビルドします。ベースイメージとOSパッケージを取得するネットワーク接続が必要です。**起動後の演習コンテナはネットワークなし**で動きます。

コンテナ内で、次を実行してください。

```bash
cat /srv/nightshift/START-HERE.md
id
ls -la /srv/nightshift
cat /srv/nightshift/logs/batch.log
```

`nano`で編集できます。`exit`でホストに戻ります。問題と9段階のヒントは `runtime/participant/` にあります。模範解答は `tests/` に分けてあり、参加者イメージには含みません。

## 進め方

前半はauditorという低権限ユーザーで調査します。問題文で指定された3つの証拠ファイルを作ったら、ホストに戻って提出します。

```bash
./gameday.sh submit team1
./gameday.sh score team1
```

調査が終わったら運営がフェーズを切り替えます。この時点で調査得点は確定し、後から追加できません。開き直したシェルは修復用のoperatorです。既存のauditorシェルがrootやoperatorに変わるわけではありません。

```bash
./gameday.sh repair team1 --yes
./gameday.sh shell team1
```

修復後にホストで採点します。

```bash
./gameday.sh score team1
./gameday.sh score team1 --json
```

**採点中は実際にバッチサービスが再起動します。** 成功する修復は、さらにもう一度再起動して確かめます。OSやDockerコンテナの再起動ではありません。採点中は編集を止めてください。テスト用の無害なコマンドを一時配置し、可能な場合は元の内容・権限へ戻します。検査用の注文とログは演習内に残ります。

修復点は「安全な状態」だけでなく「正常な業務処理」がすべて成立する場合に付与されます。以前取った点を永久に積み上げる方式ではなく、修復・業務点は採点時の状態で上下します。

## 3ミッションと配点

| ミッション | 前半の発見・実証 | 後半の修復 |
| --- | ---: | ---: |
| 予定外の読者：バックアップが誰から読めるか | 100 | 150 |
| いつもと違う実行者：誰のコマンドを実行しているか | 100 | 150 |
| 戻ってしまう設定：再起動後も修復が保たれるか | 100 | 100 |

正常な注文処理100点、重複処理の防止100点、不正注文の拒否100点を加え、満点は1,000点です。起動しただけでは0点です。正常な精算には、運営が保持する実行ごとのキーと整合するチェックサムが必要です。

正常な注文には、単価0や先頭に0が付いた10進数も含みます。不正な個数・価格・列数は拒否記録を残します。これは模擬バッチの整合性検査であり、実決済用の署名実装や暗号方式の推奨ではありません。

## その他のコマンド

```bash
./gameday.sh hint 1 1
./gameday.sh hint 2 3
./gameday.sh tick team1
./gameday.sh reboot team1
./gameday.sh shell team1 auditor
./gameday.sh status team1
./gameday.sh start team2
```

ヒントは各問題3段階、今回は無料です。`tick`は処理を1回呼び出します。通常は5秒おきにデモ注文が投入されます。`reboot`はバッチサービスだけを再起動します。複数チームは名前を変えて起動し、コンテナ・キー・状態を分離します。

終了時は、この演習のコンテナと状態だけを削除します。

```bash
./gameday.sh down team1 --yes
```

最初からやり直す場合は次を実行します。**証拠・得点・編集・履歴を削除し、新しいキーで作り直します。** 必要な履歴は先に保存してください。

```bash
./gameday.sh reset team1 --yes
```

イメージは`down`後も残ります。不要なら、すべての演習を終了した後に `docker image rm nightshift-bash:0.1.0` で削除します。`docker system prune`は使いません。

## 実装構成

```text
nightshift-bash/
├── gameday.sh                 起動・提出・権限切替・採点・リセット
├── Dockerfile                 参加者用イメージ（解答と採点器を除外）
├── lib/docker.sh              ホスト側Docker操作
├── host/score.sh              ホスト側の得点・証拠管理
├── host/check-state.sh        非公開の状態検証器
├── runtime/                   コンテナ内の信頼済み制御スクリプト
│   ├── seed/app/              意図的に問題を含む模擬アプリ
│   └── participant/           問題文と段階的ヒント
├── tests/                     統合テスト、運営専用の模範解答
└── docs/                      運営・安全境界・検証・TenkaCloud連携メモ
```

得点の正本はホスト側の `.state/<team>/score.json`、履歴は `history.jsonl` です。実行ごとの秘密値もこのディレクトリに保存します。`.state` は公開・配布しないでください。JSON出力の値は `docs/SCORING.md` を参照してください。

## テスト

Dockerで配布用イメージをビルドし、専用のテストチームで検証します。

```bash
./gameday.sh test
```

Linux root環境でユーザー名前空間とUID範囲のマッピングが許可されていれば、Dockerを使わない**テスト専用**の別経路もあります。

```bash
sudo bash tests/run.sh namespace
```

この経路は手元のLinuxバイナリを一時rootfsへコピーし、ユーザー・マウント・PID・ネットワーク名前空間を分けます。ホストに演習用ユーザーを作成しません。ただしDockerfileのビルド、Docker固有の制限、対話ターミナル、`ps`等の`/proc`依存機能の検証にはなりません。

## 運営と安全境界

60分・2〜4人/チームを想定した進行案は `docs/OPERATOR.ja.md`。自動イベントタイマー、全チームのWeb順位表、遠隔シェルの認証配布はこの版にはありません。

参加者には演習コンテナ内の非rootシェルだけを渡します。ホスト、Docker daemon、CLI、`.state`、採点器を操作できる人は運営です。**この一式を同じホストユーザーで実行する自主練では、不正防止の信頼境界は成立しません。**

コンテナは外部ネットワークなし、ホストのbind mountなし、Dockerソケットなし、ルートファイルシステムは読み取り専用です。UID切替用の小さなroot監督プロセスが動きますが、編集可能なアプリや起動スクリプトは必ず非rootとして実行します。プロセス数・メモリ・CPU・書き込み領域に上限があります。

ただし、コンテナを任意の悪意あるコードに対する絶対的な隔離と扱わないでください。外部参加者に渡す本番イベントでは専用VMや使い捨てホストを使い、事前リハーサルをしてください。セキュリティ境界と未検証事項は `docs/SECURITY.md` にあります。

## 書籍との関係

『侵入技術入門 ―bashで学ぶ攻撃者の技法』の公開目次にある、ローカル情報収集、権限、PATH、起動設定という題材を参考にした独自の演習です。本文やサンプルコードの転載ではなく、公式教材・公認コンテンツでもありません。

参考： https://www.oreilly.co.jp/books/9784814401512/

Apache-2.0。ライセンス本文は [リポジトリのLICENSE](../../LICENSE)。
