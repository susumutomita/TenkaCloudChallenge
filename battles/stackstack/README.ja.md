# StackStack — Vibe to Production

> English: [README.md](./README.md)

天下クラウド株式会社 Platform Team、 月初の朝会。 加藤さんは辞めた。 AI Builder が生成した掲示板アプリが社内公開待ちになっている。 動くが、 本番品質ではない。 DB は空、 anonymous 投稿可、 rate limit なし、 audit なし、 まだ SQLite のまま。

> 佐々木 CTO 曰く: 「ホスティングしただけじゃ公開できない。 既存の統制リソースを使って、 今日中に本番品質まで持っていって」

君の仕事は次の 90〜120 分。 stack が作成済みのリソースとデータ / 設定変更だけを使って、 1 つの hosted app を production に上げる。 Lambda / ECS / App Runner / API Gateway / CloudFront などの CFn 管理外トップレベルリソースは作らない。

## 競技概要

| 項目         | 値                                                                  |
| ------------ | ------------------------------------------------------------------- |
| カテゴリ     | Battle (リアルタイム対戦)                                           |
| 難易度       | 4 / 5                                                               |
| 想定時間     | 90〜120 分                                                          |
| 採点方式     | `phased-polling` エンジン、 満たした gate ごとに **+100点/分** のフラット加点 (`production` = +600点/分) + 一度きり +30000 |

## デプロイされるもの

CloudFormation stack が、 ゲームで使うトップレベルリソースをすべて作る:

```text
Score Engine
   |
   v
ALB :80  -- 任意で associate --> WAF rate-limit WebACL
   |
   v
EC2 app host (SSM only, SSH 不要)
   |-- /healthz
   |-- /posture
   |-- /meta
   |-- /score
   |-- SQLite app.db (初期は wipe 済み)
   |-- helper scripts under /opt/tenkacloud/vibe/
   |
   |-- S3 backup bucket (seed-sqlite.sql / seed-postgres.sql)
   |-- S3 audit bucket
   `-- RDS PostgreSQL (db.t3.micro, Single-AZ) database
```

アプリ本体は `~/vibe-app` に **ローカルビルド** として置かれ、 まだ起動していない。 まず `deploy_app.sh` でデプロイして稼働させる。 `RegisteredUrl` は意図的に空で、 Stack Output の `AppUrlHint` を Participant Portal の endpoint override に登録して初めて採点が始まる。

## Production gates

アプリは `GET /posture` を公開する。 値は自己申告 toggle ではなく実状態から測る。

| posture key    | 初期状態             | hardened state                                      |
| -------------- | -------------------- | --------------------------------------------------- |
| `db_present`   | SQLite に投稿なし    | S3 backup dump から既存 DB に復元                   |
| `auth_enabled` | anonymous POST 可    | app auth flag + non-default token で anonymous 拒否 |
| `rate_limited` | WAF 未 associate     | 既存 WebACL を既存 ALB に associate                 |
| `audit_on`     | audit write なし     | 既存 S3 audit bucket に audit event を実書き込み    |
| `on_rds`       | SQLite               | 既存 RDS PostgreSQL に posts を移行し app 接続先を切替 |
| `ssh_closed`   | tcp/22 が 0.0.0.0/0 に公開 | 加藤さんが残した public SSH ルールを発見して revoke (接続は SSM-only なので壊れない) |

`GET /meta` はこの posture から `posture-0`〜`posture-5`、 全 gate true なら `production` を返す。 採点は **フラット: 満たした gate 1 つにつき +100点/分**。 6 つの gate はどれも等しく価値があり、 どれを閉じても同じだけ加点される。

| Platform     | 満たした gate 数 | 点/分 |
| ------------ | ---------------- | ----- |
| `posture-0`  | 0                | 0     |
| `posture-1`  | 1                | 100   |
| `posture-2`  | 2                | 200   |
| `posture-3`  | 3                | 300   |
| `posture-4`  | 4                | 400   |
| `posture-5`  | 5                | 500   |
| `production` | 6 (全部)         | 600   |

`production` (全 6 gate) 到達で一度きり **+30000** bonus。 probe 失敗は 1 cycle ごとに **-100**、 応答が遅い (> 1500ms) と **-25**(フラット化後も据え置き)。 30 分の `production-ramp` phase 以降、 `posture-0/1/2` に留まるチームは degraded レート (半分: 0 / 50 / 100 点/分) に落ちる。 レッドチームに site を改ざんされる / backdoor を仕込まれる (`site_intact` / `no_backdoor` が false) と、 app は platform を `posture-2` に clamp し、 復旧するまで **200点/分** が上限になる。

## 競技フロー

1. `SsmStartSessionCommand` output で SSM Session Manager に入り、 `sudo /opt/tenkacloud/vibe/deploy_app.sh` でローカルビルドをデプロイ（サービス起動）。
2. Stack Output の `AppUrlHint` を `app` endpoint override に登録する。
3. データ復元:

   ```bash
   sudo /opt/tenkacloud/vibe/restore_database_from_s3.sh
   ```

4. auth 有効化。 出力された token は test post 用に控える:

   ```bash
   sudo python3 /opt/tenkacloud/vibe/set_auth_required.py true
   sudo systemctl restart tenkacloud-vibe
   ```

5. 既存 WAF WebACL を既存 ALB に紐付ける:

   ```bash
   source /etc/tenkacloud-vibe/runtime.env
   aws wafv2 associate-web-acl \
     --web-acl-arn "$WAF_WEB_ACL_ARN" \
     --resource-arn "$ALB_ARN" \
     --region "$AWS_REGION"
   ```

6. audit write を有効化:

   ```bash
   sudo python3 /opt/tenkacloud/vibe/set_audit_s3.py true
   sudo systemctl restart tenkacloud-vibe
   ```

7. SQLite から RDS PostgreSQL へ移行:

   ```bash
   sudo /opt/tenkacloud/vibe/migrate_to_rds.sh
   ```

8. app host の Security Group (`<NamePrefix>-app-sg`、 participant role で EC2 Console から見える) を点検し、 加藤さんが残した public SSH ルールを発見して revoke する。 実行は **participant credential** (CloudShell か `aws login`) で行う — instance role は意図的に SG を変更できない。 接続は SSM Session Manager 経由なので tcp/22 を閉じても何も壊れない:

   ```bash
   APP_SG_ID=$(aws ec2 describe-security-groups \
     --filters "Name=tag:Name,Values=<NamePrefix>-app-sg" \
     --query 'SecurityGroups[0].GroupId' --output text)
   aws ec2 revoke-security-group-ingress \
     --group-id "$APP_SG_ID" \
     --protocol tcp --port 22 --cidr 0.0.0.0/0
   ```

9. 各 step 後に `GET /posture` を確認する。 score engine は同じ状態を `/meta` と `/score` から読む。

## レッドチーム

運営は reversible な disruption だけを fire する。

| id                     | 何が起きる                                      | revert                         |
| ---------------------- | ----------------------------------------------- | ------------------------------ |
| `ai-wipes-database`    | SQLite / RDS の posts を空にする                 | S3 backup から復元             |
| `auth-setting-removed` | config を backup して auth を false に戻す       | backup config を復元           |
| `vibe-app-stopped`     | `tenkacloud-vibe` を停止                         | `tenkacloud-vibe` を start     |
| `site-defaced`         | 掲示板を改ざん (PWNED バナー)、 `site_intact`=false | 改ざんマーカーを除去           |
| `supply-chain-backdoor`| バックドア成果物を混入、 `no_backdoor`=false      | バックドア成果物を除去         |

すべて `action` delivery で、 metadata に `revert` を宣言している。 cloud fault を謳う effect-only disruption はない。

## コスト

ALB / EC2 / WAF / S3 / RDS PostgreSQL (db.t3.micro, Single-AZ) を事前作成する。 RDS は free-tier 対象の db.t3.micro Single-AZ なので追加コストは小さいが、 event stack は短時間で削除する。 参加者が CFn 外リソースを作らない設計なので、 teardown はこれだけ:

```bash
aws cloudformation delete-stack --stack-name <stack-name>
```

追加の cleanup pass は不要。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 問題メタデータ、 scoring、 phase、 disruption
- [`template.yaml`](./template.yaml) — stack-owned AWS resources と app bootstrap
- [`portal/StatusPanel.tsx`](./portal/StatusPanel.tsx) — dashboard plugin
- [`OPERATOR.md`](./OPERATOR.md) — operator runbook
- [`redteam/`](./redteam/) — disruption catalog と smoke test
