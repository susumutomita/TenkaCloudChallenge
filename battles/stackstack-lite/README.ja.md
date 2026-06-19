# StackStack Lite — Vibe to Production（入門）

> TenkaCloud Battle · `battles/stackstack-lite` · 難易度 2 · 約45〜60分 · phased-polling · レッドチームなし

## ストーリー

天下クラウド株式会社 Platform Team。加藤さんが AI で量産した掲示板アプリを残して退職した。EC2 1 台で
動いてはいるが、DB は空、認証なし（誰でも投稿できる）、監査ログもない。

佐々木 CTO「いきなり全部はいい。まずデータを戻して、認証を付けて、監査ログを出すところまで持っていって」

あなたの仕事: **既存のスタック所有リソースだけ**を使い（新規トップレベルリソースは作らない）、
**デプロイ → DB 復元 → 認証 → 監査** の 3 つの gate を満たして `production` に上げる。

これは [`battles/stackstack`](../stackstack/) の**入門版**。同じ「vibe to production」の世界を、EC2 1 台と
3 gate に絞ったもの（ALB / RDS / WAF / SSH 閉鎖 / レッドチームは無し）。

## デプロイされるもの

| リソース | 役割 |
| --- | --- |
| **EC2 app host**（public・nginx 経由 HTTP :80） | 掲示板アプリを動かす。score engine が直接 probe（ALB なし）。 |
| **S3 backup bucket** | DB 復元用の seed dump を保持。 |
| **S3 audit bucket** | 監査を有効化すると app がここに監査イベントを書く。 |
| **ParticipantViewerRole** | SSM Session Manager で host に入る／自スタック参照（Console）／バケット読取。新規リソース作成権限なし。 |

ALB・RDS・WAF・レッドチームは無し。S3 は custom resource が `delete-stack` 時に空にする（孤児ゼロ）。

## 解き方

host 操作はすべて **SSM Session Manager** シェル（`SsmStartSessionCommand`）で。先に
`source /etc/tenkacloud-vibe/runtime.env` で変数を読み込む。`vibe-status` でいつでも各 gate の現状と目的を確認。

1. **デプロイ**して URL を登録:
   ```bash
   sudo /opt/tenkacloud/vibe/deploy_app.sh
   ```
   `AppUrlHint` を Participant Portal の `app` endpoint override に貼ると採点開始。

2. **DB 復元**（`db_present`）:
   ```bash
   source /etc/tenkacloud-vibe/runtime.env
   aws s3 cp "s3://$BACKUP_BUCKET/seed-sqlite.sql" /tmp/seed-sqlite.sql --region "$AWS_REGION"
   sqlite3 "$SQLITE_DB" < /tmp/seed-sqlite.sql
   sudo systemctl restart tenkacloud-vibe
   ```

3. **認証を有効化**（`auth_enabled`）── `auth_required=true` と既定値でない `auth_token`:
   ```bash
   tmp=$(mktemp); jq '.auth_required=true | .auth_token="my-secret-42"' "$CONFIG_FILE" > "$tmp" && sudo mv "$tmp" "$CONFIG_FILE"
   sudo systemctl restart tenkacloud-vibe
   ```

4. **監査を有効化**（`audit_on`）── `audit_s3=true`:
   ```bash
   tmp=$(mktemp); jq '.audit_s3=true' "$CONFIG_FILE" > "$tmp" && sudo mv "$tmp" "$CONFIG_FILE"
   sudo systemctl restart tenkacloud-vibe
   ```

3 つの gate が true になると `/meta` の platform が `production` になり、加点が最大化＋一度きりの bonus。
posture は実状態計測なので、どの方法で状態を作っても gate が立つ。

## 採点

| | |
| --- | --- |
| 種別 | `phased-polling`（毎分 `/meta` + `/score` を probe） |
| posture-0 / 1 / 2 | 0 / 100 / 200 点/分 |
| production（3つ） | 400 点/分 ＋ 一度きり **+5000** bonus |
| 失敗ペナルティ | probe 失敗ごと −50（軽め） |
| ヒント | 3 段（0 / −100 / −150）。流れ → 具体コマンド → トラブルシュート |

## コスト

`t3.micro` EC2 1 台 + S3 バケット 2 つ（監査オブジェクトは 1 日で失効）+ 小さな cleanup Lambda。
ALB / RDS の時間課金なし。`delete-stack` でバケットを空にして全消去 ── 孤児なし。

## 学べること

- ローカルで動く AI 製アプリを本物のクラウド（EC2）にデプロイし、**新規トップレベルリソースを作らずに**
  最低限の本番品質へ。
- URL 登録・backup からの復元・アプリ認証・S3 監査書き込みを実状態チェックで検証。
- クラウド運用の最初の一歩（デプロイ → 復元 → 認証 → 監査）を、本家 [`stackstack`](../stackstack/)
  Battle の前段として練習。

## 関連ファイル

- [`template.yaml`](./template.yaml) — EC2 host + S3 バケット 2 つ（+ cleanup）、埋め込み vibe app、participant role。
- [`metadata.json`](./metadata.json) — カタログ項目・phased-polling 採点・ヒント。
- [`portal/StatusPanel.tsx`](./portal/StatusPanel.tsx) — 3 gate のステータスパネル。
- [`battles/stackstack`](../stackstack/) — 上級版（ALB / WAF / RDS / SSH / レッドチーム）。
