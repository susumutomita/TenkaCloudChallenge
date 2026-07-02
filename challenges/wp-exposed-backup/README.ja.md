# 前任者のバックアップ — 動いているサイトでも情報は漏れる

> TenkaCloud Challenge · `challenges/wp-exposed-backup` · 難易度 2 · 約30分 · `verify` 採点

実際の現行WordPressとMariaDBをローカルDockerで起動する、AWS不要の教材です。
古いWordPressの既知脆弱性ではなく、前任者がDBバックアップを公開領域へ置いたまま
消し忘れたという、運用不備を扱います。

## 起動するもの

| 場所 | 内容 |
| --- | --- |
| `127.0.0.1:18080` | 実際に動作するWordPressサイト |
| `127.0.0.1:18081` | TenkaCloudが利用する`/verify` |

ComposeはMariaDB、WordPress、初期化用WP-CLI、採点サービスの4コンテナで構成されます。
フラグはデプロイごとの`FLAG_SEED`からコンテナ内で導出され、公開バックアップと採点サービスが
同じ値を利用します。portはすべてループバック限定です。

## ストーリーとミッション

会社サイトの運用を引き継いだところ、サイト自体は正常に動いています。しかし前任者が
移行作業中に作ったDBバックアップをWeb公開フォルダへ残していました。外部の利用者と同じ
目線で調査し、バックアップ内の`maintenance_notes`にある`TC{...}`を見つけてください。

## 攻略手順

1. `make local PROBLEM=wp-exposed-backup`で問題とPortalを起動します。
2. <http://127.0.0.1:18080/> が通常のWordPressサイトとして動くことを確認します。
3. <http://127.0.0.1:18080/robots.txt> を確認します。
4. 記載された公開パスからバックアップを取得します。

   ```bash
   curl http://127.0.0.1:18080/wp-content/backups/db-backup.sql
   ```

5. `maintenance_notes`行のフラグをPortalへ提出します。

| リクエスト | 結果 |
| --- | --- |
| `GET /` | 通常のWordPressサイトを`200`で返す |
| `GET /robots.txt` | バックアップ用ディレクトリを広告してしまう |
| `GET /wp-content/backups/db-backup.sql` | DBダンプとフラグを`200`で返す |

## 根本原因と対策

Webサーバーは公開領域に置かれたファイルを正常に配信しただけです。WordPress本体を攻撃した
わけではありません。

- DBダンプ、設定コピー、zip、`.bak`などをWeb到達可能な場所へ置かない。
- 移行前後にdocrootを監査し、テスト用・一時ファイルを削除する。
- `robots.txt`をアクセス制御に使わない。必要ならWebサーバー側で明示的に拒否する。
- WordPress本体、plugin、themeを更新し、不要なものを削除する。
- 非公開バックアップを取得し、復元テストまで実施する。

## 初期化とコスト

`docker compose down -v`または`make local-down`で永続volumeを削除し、次回起動時に初期状態へ
戻せます。ローカルDockerのみで、AWS料金は発生しません。

## 関連ファイル

- `local/docker-compose.yml` — 4サービスの構成
- `local/wordpress/` — WordPress imageと運用不備の投入処理
- `local/wpinit/init.sh` — WordPress初期化
- `local/verify/server.mjs` — ループバック採点
- `metadata.json` — 問題文、採点、ヒント
