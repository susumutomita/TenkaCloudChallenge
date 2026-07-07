# 前任者の忘れ物 — 動いているサイトでも情報は漏れる

> TenkaCloud Challenge · `challenges/wp-exposed-backup` · 難易度 3 · 約45分 · `multi-verify` 採点 (4 チェックポイント・200点)

実際の現行 WordPress と MariaDB をローカル Docker で起動する、AWS 不要の教材です。
古い WordPress の既知脆弱性ではなく、前任者が移行作業中に**複数の運用ファイルを公開領域へ
置いたまま消し忘れた**という、最も典型的な運用不備を扱います。

SaaS (Wix) 版の運用不備問題の WordPress 版です。メッセージは同じ ── ソフトウェアは正常で、
漏れるのは設定と運用です。

## チェックポイント (multi-verify)

前任者が残した忘れ物は**4 つ**あり、それぞれ別々のよくある設定ミスで、別々の合言葉が
入っています。合言葉を対応するチェックポイントに個別に提出し、部分点を得ます。4 つすべてを
提出すると満点です。正誤は**問題コンテナ**が判定し (`POST /verify` に `checkpointId` を付けて
委譲)、プラットフォームは答えを持たず点数だけを保持します。

| チェックポイント | 攻撃面 (見つけ方) | 配点 |
| --- | --- | ---: |
| `public-backup` | 公開フォルダに残った DB ダンプ `/wp-content/backups/db-backup.sql` (`robots.txt` が案内)。 | 60 |
| `exposed-config` | エディタの控え `wp-config.php.bak` が**平文で配信** (PHP は `.php` しか実行しない)。DB 接続情報と ops token が漏れる。 | 60 |
| `debug-log` | 本番で `WP_DEBUG_LOG` が付けっぱなし。`wp-content/debug.log` が誰でも読め、内部メモが記録されている。 | 40 |
| `dir-listing` | `/internal/` に Apache のディレクトリ一覧 (Indexes) が残り、引き継ぎメモが一覧表示される。 | 40 |

4 つとも「公開領域に置き忘れる」という同じ習慣から生まれます。ここが学びどころで、
1 つのバグを 4 分割したものではなく、**別々の対策**が必要な別々の不備です。

## 起動するもの

| 場所 | 内容 |
| --- | --- |
| **手元の Docker** | 実際の WordPress + MariaDB + ループバック採点 = 問題ランタイム |
| `127.0.0.1:18080` | 課題面 (実際に動作する WordPress サイト) |
| `127.0.0.1:18081` | TenkaCloud が委譲する `/verify` |

Compose は MariaDB・WordPress・初期化用 WP-CLI・採点サービスの 4 コンテナで構成され、
すべて private network 上、公開はループバック 2 port のみです。WordPress コンテナは
Apache 起動**前**に 4 つの忘れ物を docroot へ投入するので、サイトが見えた瞬間に課題面が
揃います。フラグはデプロイごとの乱数 `FLAG_SEED` からコンテナ内で導出され、WordPress 側と
採点サービスが同じ値を使うため、答えは repo に保存されません。

## ストーリーとミッション

会社サイトの運用を引き継いだところ、サイト自体は正常に動いています。しかし前任者が
移行作業中に「テスト用」「あとで消す」と言いながら、いくつもの運用ファイルを公開フォルダへ
残していました。外部の利用者と同じ目線で、4 つの忘れ物を一つずつ見つけてください。

## 攻略手順

1. `make local PROBLEM=wp-exposed-backup` で問題・採点 API・Portal を起動します
   (初回は image の pull と WordPress インストールで少し時間がかかります)。
2. 任意の非空キーで Portal にログインすると、4 つのチェックポイントが見えます。
3. <http://127.0.0.1:18080/> が通常の WordPress サイトとして動くことを確認します。
   WordPress 本体は攻めません。<http://127.0.0.1:18080/robots.txt> は
   `/wp-content/backups/` と `/internal/` を「隠したつもり」で案内しています。
4. 各忘れ物を見つけ、合言葉を対応するチェックポイントへ提出します。

   ```bash
   curl http://127.0.0.1:18080/wp-content/backups/db-backup.sql   # public-backup
   curl http://127.0.0.1:18080/wp-config.php.bak                  # exposed-config
   curl http://127.0.0.1:18080/wp-content/debug.log               # debug-log
   curl http://127.0.0.1:18080/internal/                          # dir-listing (一覧から handover.txt を開く)
   ```

| リクエスト | 結果 |
| --- | --- |
| `GET /` | 通常の WordPress サイトを `200` で返す |
| `GET /robots.txt` | `/wp-content/backups/` と `/internal/` を広告してしまう ← 手がかり |
| `GET /wp-content/backups/db-backup.sql` | DB ダンプと `public-backup` のフラグ |
| `GET /wp-config.php.bak` | 設定ファイルの控えが平文で、`exposed-config` のフラグ |
| `GET /wp-content/debug.log` | デバッグログと `debug-log` のフラグ |
| `GET /internal/` | ディレクトリ一覧 → `handover.txt` に `dir-listing` のフラグ |

## 根本原因と対策、そして採点境界

Web サーバーは公開領域のファイルを正常に配信しただけで、WordPress 本体を攻撃したわけでは
ありません。対策はすべて運用側で、コードは触りません。

- **`public-backup`** → `.sql` ダンプや `.zip` エクスポートを Web 到達可能な場所へ置かない。
  移行前後に docroot を監査し、一時ファイルを削除する。
- **`exposed-config`** → `wp-config.php` のエディタ控え (`.bak` / `.save` / `~`) を docroot に
  残さない。平文で配信され認証情報が漏れる。漏れた認証情報は必ずローテーションする。
- **`debug-log`** → 本番では `WP_DEBUG` / `WP_DEBUG_LOG` を**切る**。`wp-content/debug.log` を
  Web 到達可能な場所に置かない。
- **`dir-listing`** → Apache のディレクトリ一覧を無効化する (`Options -Indexes`)。一覧可能な
  フォルダは中身をすべて晒す。
- **`robots.txt` はアクセス制御ではない。** Disallow は「見に来て」と教えるだけ。必要なら
  Web サーバー側で明示的に拒否する。

**採点境界:** 4 つのチェックポイントは独立採点で、正誤は**コンテナ**が決めます
(`POST /verify` が `checkpointId` を echo)。プラットフォームは `metadata.json` の配点だけを持ち、
コンテナから答えや点数を一切受け取りません ── 壊れた/悪意あるコンテナが自分で加点することは
できません。動いているサイトが安全なサイトとは限りません。重要なのは**外から届くかどうか**です。

## 学習ゴール

- WordPress は PHP・DB・認証・設定の上で動き、初期設定の放置には実際の影響があることを体感する。
- バックアップ・設定の控え・デバッグログ・ディレクトリ一覧は、同じ「公開領域に置く」習慣から
  生まれる 4 つの別々の不備であることを確かめる。
- 公開フォルダの見直し・不要ファイルの削除・ディレクトリ一覧の無効化・デバッグ出力の停止が、
  コードを触らない基本の対策であることを理解する。

## 初期化とコスト

`docker compose down -v` または `make local-down` で永続 volume を削除し、次回起動時に初期状態へ
戻せます。ローカル Docker のみで、AWS 料金は発生しません。

## 関連ファイル

- `local/docker-compose.yml` — 4 サービスの構成
- `local/wordpress/` — WordPress image と 4 つの忘れ物の投入処理
- `local/wpinit/init.sh` — WordPress 初期化
- `local/verify/server.mjs` — ループバック採点 (各チェックポイントを判定)
- `metadata.json` — 問題文、4 チェックポイント採点、チェックポイント別ヒント
