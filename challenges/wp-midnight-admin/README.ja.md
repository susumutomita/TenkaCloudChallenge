# 深夜の管理者 — 身に覚えのない管理者を、外から突き止める

> TenkaCloud Challenge · `challenges/wp-midnight-admin` · 難易度 3 · 約45分 · `multi-verify` 採点 (4 チェックポイント・200点)

実際の現行 WordPress と MariaDB をローカル Docker で起動する、AWS 不要の教材です。
WordPress の運用不備問題 (`wp-exposed-backup` = 発見、`wp-harden-leaks` = 是正) の
**インシデント対応**版です。置き忘れたファイルを探すのではなく、進行中のアカウント侵害
インシデントを調査します。夜間に見覚えのない管理者アカウントが増えたので、「誰が・どうやって・
何を残したか」を突き止めます。WordPress サイトを運用する人が対象です。**攻撃も CVE も、
管理者ログインも不要** ── すべての手がかりは外から観測できます。

## ストーリー

デザイン事務所 **さくらデザイン** の WordPress サイトを引き継いだ翌朝、監視ツールから
「見覚えのない管理者アカウントが夜間に増えた」という通知が届きます。サイト自体は正常に
動いています。あなたの仕事はサイトを攻撃することではなく、外部の利用者と同じ目線で、
4 つの独立した本物の運用シグナルからインシデントを調査することです (ログイン不要)。

## チェックポイント (multi-verify)

このインシデントは**4 つ**の独立したシグナルを残しており、それぞれ別の本物の WordPress 運用
シグナルで、別々の合言葉が入っています。合言葉を対応するチェックポイントに個別に提出し、
部分点を得ます。4 つすべてを提出すると満点です。正誤は**問題コンテナ**が判定し
(`POST /verify` に `checkpointId` を付けて委譲)、プラットフォームは答えを持たず点数だけを
保持します。

| チェックポイント | シグナル (見つけ方) | 配点 |
| --- | --- | ---: |
| `rogue-admin` | REST の利用者列挙 `GET /wp-json/wp/v2/users` (既定では未認証で可) に、誰も追加していない管理者 `media-sync` が並ぶ。その bio (`description`) に合言葉。 | 50 |
| `login-trail` | 公開領域のアクセスログ `/server-logs/access.log` に、`203.0.113.66` からの `POST /wp-login.php` 失敗の山と 1 回の成功。直後の `[tripwire]` 注記に合言葉。 | 50 |
| `orphan-plugin` | 放置プラグインの世界公開 `readme.txt` (`/wp-content/plugins/legacy-contact-form/readme.txt`) が古い `Tested up to` を露呈。運用 NOTE 行に合言葉。 | 50 |
| `spam-post` | 侵入者の SEO スパム投稿がコンテンツ一覧 `GET /wp-json/wp/v2/posts` に現れ、本文の HTML コメントに合言葉が隠れている。 | 50 |

4 つはインシデントの流れに対応します ── **誰が** (`rogue-admin`) → **どうやって**
(`login-trail`) → 調査中に見つかる別のリスク (`orphan-plugin`) → **何を残したか**
(`spam-post`)。

## 起動するもの

| 場所 | 内容 |
| --- | --- |
| **手元の Docker** | 実際の WordPress + MariaDB + ループバック採点 = 問題ランタイム |
| `127.0.0.1:18080` | 課題面 (実際に動作する WordPress サイト) |
| `127.0.0.1:18081` | TenkaCloud が委譲する `/verify` |

Compose は MariaDB・WordPress・初期化用 WP-CLI・採点サービスの 4 コンテナで構成され、
すべて private network 上、公開はループバック 2 port のみです。

- **`db`** — 実際の MariaDB (ダミーデータのみ)。
- **`wordpress`** — 実際の現行 WordPress (Apache + PHP)。ラッパーの entrypoint が、Apache 起動
  **前**に 2 つの**ファイル**シグナル (アクセスログ・放置プラグインの readme) を投入し、
  `/wp-json/` が応答するよう標準の WordPress rewrite を有効化します。
- **`wpinit`** — WordPress をインストールしコンテンツを投入する一発 WP-CLI。2 つの
  **WordPress コンテンツ**シグナル (身に覚えのない管理者の bio・スパム投稿) も投入します。
- **`verify`** — ループバック採点。4 つのチェックポイントのフラグを保持します。

フラグはデプロイごとの乱数 `FLAG_SEED` からコンテナ内で導出され、WordPress 側・wpinit・
採点サービスが同じ値を使うため、答えは repo に保存されません。ループバック外には何も
公開されず、`docker compose down -v` で初期状態へ戻せます。

## 攻略手順

1. `make local PROBLEM=wp-midnight-admin` で問題・採点 API・Portal を起動します
   (初回は image の pull と WordPress インストールで少し時間がかかります)。
2. 任意の非空キーで Portal にログインすると、4 つのチェックポイントが見えます。
3. <http://127.0.0.1:18080/> が通常の WordPress サイトとして動くことを確認します。
   WordPress 本体は攻めません。外から「誰が → どうやって → 何を残したか」を調査します。
4. 各シグナルを見つけ、合言葉を対応するチェックポイントへ提出します。

   ```bash
   curl http://127.0.0.1:18080/wp-json/wp/v2/users                                   # rogue-admin (media-sync の description を読む)
   curl http://127.0.0.1:18080/server-logs/access.log                                # login-trail (失敗の山 + 1 回の成功 + [tripwire] 行)
   curl http://127.0.0.1:18080/wp-content/plugins/legacy-contact-form/readme.txt      # orphan-plugin (NOTE 行)
   curl http://127.0.0.1:18080/wp-json/wp/v2/posts                                   # spam-post (content.rendered の HTML コメント)
   ```

   環境で pretty permalink が使えない場合、REST は
   `http://127.0.0.1:18080/?rest_route=/wp/v2/users` や `.../?rest_route=/wp/v2/posts` でも
   取得できます。

| リクエスト | 結果 |
| --- | --- |
| `GET /` | 通常の WordPress サイトを `200` で返す |
| `GET /wp-json/wp/v2/users` | 投稿者一覧。見覚えのない `media-sync` とその bio に `rogue-admin` のフラグ |
| `GET /server-logs/access.log` | アクセスログ。総当たりの山・1 回の成功・`[tripwire]` 行に `login-trail` のフラグ |
| `GET /wp-content/plugins/legacy-contact-form/readme.txt` | 放置プラグインの readme に `orphan-plugin` のフラグ |
| `GET /wp-json/wp/v2/posts` | コンテンツ一覧。スパム投稿の本文コメントに `spam-post` のフラグ |

## 根本原因と対策、そして採点境界

WordPress 本体のコードに欠陥は見つかりません。弱い / 使い回しの管理者パスワードが総当たりで
破られ、侵入者が自分を管理者にしてスパムを残し、サイトはその一部始終を語るシグナルを静かに
配信し続けていた ── それだけです。対策はすべて運用側で、コードは触りません。

- **`rogue-admin`** → 身に覚えのない管理者アカウントを削除し、全管理者を棚卸しする。
  (追加の防御として) 不要なら REST の利用者一覧の外部公開を制限・監視する。
- **`login-trail`** → 弱い / 使い回しのパスワードをやめる。ログイン試行を監視・制限する
  (回数・IP 制限)。破られた資格情報をローテーションする。ログを docroot の外に出す。
- **`orphan-plugin`** → 使っていない / 放置されたプラグインを削除し、残すものは最新に保つ。
  放置プラグインは idle でも攻撃面になる。
- **`spam-post`** → 不正な投稿を削除し、管理者乗っ取り後は資格情報をローテーションして
  MFA + 最小権限を徹底する。
- **予期しない管理者アカウントはインシデントの最重要シグナル**であり、その多くは、ログイン
  する前に「外から」気づける ── 日頃から利用者・ログ・プラグイン・投稿を棚卸ししていれば。

**採点境界:** 4 つのチェックポイントは独立採点で、正誤は**コンテナ**が決めます
(`POST /verify` が `checkpointId` を echo)。プラットフォームは `metadata.json` の配点だけを
持ち、コンテナから答えや点数を一切受け取りません ── 壊れた / 悪意あるコンテナが自分で加点
することはできません。動いているサイトが安全なサイトとは限りません。重要なのは**外から届くか
どうか**です。

## 学習ゴール

- 予期しない管理者アカウントがインシデントの最重要シグナルであることを、実際の環境で体感する。
- WordPress が REST API で利用者一覧を外部公開しうること・アクセスログからブルートフォースと
  成功ログインを読み分けられること・入っているプラグインを棚卸しできること ── 一つの
  インシデントを外から再構成する 4 つの別々の観察であることを確かめる。
- アカウント削除・資格情報のローテーション・MFA / 最小権限・不要プラグインの削除・利用者一覧の
  公開制限が、コードを触らない基本の対策であることを理解する。

## 初期化とコスト

`docker compose down -v` または `make local-down` で永続 volume を削除し、次回起動時に初期状態へ
戻せます。ローカル Docker のみで、AWS 料金は発生しません。

## 関連ファイル

- `local/docker-compose.yml` — 4 サービスの構成
- `local/wordpress/` — WordPress image と、2 つのファイルシグナル投入 + rewrite 有効化
- `local/wpinit/init.sh` — WordPress 初期化 + コンテンツ投入 + 身に覚えのない管理者・スパム投稿
- `local/verify/server.mjs` — ループバック採点 (各チェックポイントを判定)
- `metadata.json` — 問題文、4 チェックポイント採点、チェックポイント別ヒント
