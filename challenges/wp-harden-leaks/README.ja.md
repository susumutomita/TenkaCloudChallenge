# 後任の大掃除 — 外部スキャナが「クリーン」と言うまで漏れを塞げ

> TenkaCloud Challenge · `challenges/wp-harden-leaks` · 難易度 3 · 約40分 · `multi-verify` 採点 (4 チェックポイント・200点)

[`wp-exposed-backup`](../wp-exposed-backup/)（前任者の忘れ物）の**是正編**です。同じ Aoi
Corp の WordPress サイト、同じ実際の現行 WordPress + MariaDB をローカル Docker で起動しますが、
今度は漏れを*見つける*のではなく**塞ぐ**のが仕事です。すでに漏れているサイトを引き継ぎ、外部
スキャナが「クリーン」と判定するまで是正します。

ここでも要点は WordPress 本体の脆弱性ではありません ── ソフトウェアは正常で、漏れるのは運用
です。そして運用の是正とは、コードを書くことではなく、ファイルを消し、設定を切ることです。
4 つのうち 1 つは、**症状（ファイル）を消すこと**と**原因（設定）を止めること**の違いを学ばせる
ように作ってあります。

## discovery 版との違い

| | discovery（`wp-exposed-backup`） | 是正（この問題） |
| --- | --- | --- |
| 仕事 | 忘れ物を*見つけて*合言葉を読む | 漏れを*塞いで*外から届かなくする |
| 判定 | 合言葉を提出（文字列一致） | **外部スキャナ**が実サイトを HTTP で叩き、外から消えて初めて合格 |
| ごまかせる? | ── | 不可。提出する合言葉は無く、サイトの実挙動が唯一の証拠 |
| 仕掛け | ── | 1 つは、ファイルを消すだけだと**再生成**される |

## チェックポイント (multi-verify)

コンテナの中に入って各穴を塞ぐと、スキャナが実サイトを叩いて再判定します。塞がっていない再スキャンに
減点はないので、何度でも試してよいです。

| チェックポイント | こう塞ぐ | 配点 |
| --- | --- | ---: |
| `close-backup` | `GET /wp-content/backups/db-backup.sql` が DB ダンプを返さなくなる。 | 40 |
| `close-config` | `GET /wp-config.php.bak` が設定の控えを平文で返さなくなる。 | 40 |
| `close-listing` | `GET /internal/` が Apache のディレクトリ一覧を出さなくなる。 | 50 |
| `close-debug` | `GET /wp-content/debug.log` が消えたまま **── もう一度サイトを叩かれても** 戻らない。 | 70 |

`close-debug` の配点が一番高いのは意図的です。`wp-content/debug.log` を消しても塞がりません ──
`WP_DEBUG` が有効なままで、次のリクエストでログが書き直されるからです。発生源（デバッグ設定）を
止め、**それから**ファイルを消してください。

## 起動するもの

| 場所 | 内容 |
| --- | --- |
| **手元の Docker** | 実際の WordPress + MariaDB + ループバック採点 = 問題ランタイム |
| `127.0.0.1:18080` | 課題面（実際に動作する WordPress サイト） |
| `127.0.0.1:18081` | TenkaCloud が委譲する `/verify`（外部スキャナ） |

Compose は MariaDB・WordPress・初期化用 WP-CLI・スキャナの 4 コンテナで構成され、すべて private
network 上、公開はループバック 2 port のみです。

- **`db`** ── 実際の MariaDB、ダミーデータのみ。
- **`wordpress`** ── 実際の現行 WordPress（Apache + PHP）。ラッパ entrypoint が Apache 起動**前**に
  4 つの忘れ物（および、デバッグログを再生成する must-use plugin）を docroot へ投入するので、サイトが
  見えた瞬間にすでに漏れています。
- **`wpinit`** ── WordPress を実際にインストールし、少しコンテンツを入れる one-shot WP-CLI。
- **`verify`** ── ループバックの**スキャナ**。各チェックポイントで `http://wordpress/…` を compose
  ネットワーク越しに叩き、実応答で塞がったかを判定する。答えも合言葉も持たず、サイトの実挙動だけが証拠。

ループバック以外には何も公開されず、`docker compose down -v`（または `make local-down`）で最初の
（漏れている）状態へ戻せます。

## ストーリー

Aoi Corp のコーポレートサイト（WordPress）の運用を引き継いだ。サイト自体は正常に動いている。だが
前任者が移行のときに「テスト用」「あとで消す」と言いながら、いくつもの運用ファイルや設定を公開
フォルダに残していた ── データ・DB 接続情報・内部メモが外部から読める。あなたの仕事は、現場の運用者と
同じように各穴を塞ぎ、サイトがクリーンだと証明することだ。

## 攻略手順

1. `make local PROBLEM=wp-harden-leaks` で問題・採点 API・Portal を起動する（初回は image の pull と
   WordPress インストールで少し時間がかかる）。
2. 任意の非空キーで Portal にログインすると、4 つのチェックポイントが見える。
3. サーバに入る: `docker compose exec wordpress bash`（公開ディレクトリは `/var/www/html`）。外から
   届く状態（`http://127.0.0.1:18080/`・`robots.txt`・`/internal/` …）と中のファイルを突き合わせ、
   各穴を塞ぐ。
4. 各チェックポイントの提出欄に任意の合図（例: `done`）を送って再スキャンする。塞がっていれば加点、
   まだなら「まだ外から届く」と返る。手が止まったらヒントを開く（最初は無料、考え方から具体コマンドへ）。

## 根本原因と対策

WordPress 本体は攻撃していない。対策はすべて運用側で、コードは触らない。

- **`close-backup`** → `.sql` ダンプを docroot から削除。バックアップを Web 到達可能な場所に置かない。
- **`close-config`** → `.bak` の控えを削除。平文で配信され認証情報が漏れる。漏れた認証情報はローテーション。
- **`close-listing`** → Apache のディレクトリ一覧を無効化（スコープ付き `Options +Indexes` を
  `a2disconf`、または `index.html` を置く、フォルダごと消す）。
- **`close-debug`** → `wp-config.php` の `WP_DEBUG` を**先に**無効化し、それから
  `wp-content/debug.log` を消す。有効なまま消しても再生成される ── 症状ではなく原因を止める。

**採点境界:** 4 つのチェックポイントは独立採点で、正誤は**コンテナ（スキャナ）**が実サイトを叩いて
決める（`POST /verify` が `checkpointId` を echo）。プラットフォームは `metadata.json` の配点だけを
持ち、コンテナから答えや点数を一切受け取らない ── 壊れた/悪意あるコンテナが自分で加点できない。動いて
いるサイトが安全とは限らない。重要なのは**外から届くかどうか**だ。

## 学習ゴール

- 動いているサイトを安全にするとは、コードを書くことではなく運用の是正（不要ファイルの削除・設定の停止）
  であることを、手を動かして体得する。
- 消すだけでは塞がらない穴がある ── 症状（ログ）は原因（デバッグ設定）を止めない限り戻る。スキャナが
  その違いを証明する。
- 公開フォルダの棚卸し・ディレクトリ一覧の無効化・デバッグ出力の停止が、コードを触らない基本の対策。

## 初期化とコスト

`docker compose down -v` または `make local-down` で永続 volume を削除し、次回起動時に初期状態へ
戻せる。ローカル Docker のみで、AWS 料金は発生しない。初回は WordPress と MariaDB の image を pull。

## 関連ファイル

- `local/docker-compose.yml` ── 4 サービスの構成
- `local/wordpress/` ── WordPress image と、4 つの漏れ＋`debug.log` 再生成 mu-plugin の投入処理
- `local/wpinit/init.sh` ── WordPress 初期化
- `local/verify/server.mjs` ── ループバックのスキャナ（`/verify`）。`http://wordpress/…` を叩いて各穴の
  塞がりを判定
- `metadata.json` ── 問題文、4 チェックポイント採点、チェックポイント別ヒント
