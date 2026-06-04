# StackStack — AI → Production ラストワンマイル

> English: [README.md](./README.md)

天下クラウド株式会社 Platform Team、 月初の朝会。 加藤さんは先月辞めた。 引き継ぎ書は薄い。 一方で社内 100 人の AI Builder が Claude で量産したアプリが、 Platform チームのキューに積まれている。 5 つの統制軸 (auth / network / rate / audit / ux) はどれも未整備、 EC2 1 台に同居して動いている。

> 佐々木 CTO 曰く: 「これ、 公開していい状態に持っていって。 AI が書いた速さに、 Platform チームが追いつけてない。 他チームの Platform もみんな焦ってる」

君の仕事は次の 90〜120 分。 5 slot を順に managed runtime (Lambda + API GW / ECS Fargate / App Runner) に切り出し、 Participant Portal の Endpoint Override に新 URL を貼って加点を 100 → 1000 pt/cycle に上げていく。 きれいに分割した Platform Team が勝つ。

## 競技概要

| 項目         | 値                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------- |
| カテゴリ     | Battle (リアルタイム対戦)                                                                           |
| 難易度       | 4 / 5                                                                                               |
| 想定時間     | 90〜120 分                                                                                          |
| 採点方式     | `phased-polling` - EC2 = 100 pt / managed = 1,000 pt / 全 managed 移行 bonus +30,000 pt (1 回)     |

## 5 統制軸 (= 5 endpoint slot)

| slot      | 統制軸                              | 初期状態                            | hardened                                        |
| --------- | ----------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `auth`    | Authentication / Authorization      | naive Basic auth (EC2)              | Cognito / SSO via managed runtime               |
| `network` | Network controls (S3 / WAF / IAM)   | Public S3 + wildcard IAM            | OAC + scoped IAM                                |
| `rate`    | Rate limit / DoS protection         | 無制限の Flask                      | API GW throttle / Lambda concurrency cap        |
| `audit`   | Logging / Compliance                | 標準出力のみ                        | CloudTrail + Athena + WORM bucket               |
| `ux`      | User-facing availability            | EC2 1 台                            | Multi-AZ + ALB + Auto Scaling                   |

各 slot は `GET /meta` で現在の hosting を自己申告。 初期 deploy では全 slot が `ec2` を返し低スコア (100 pt/cycle/slot)。 managed runtime に再ホストして `/meta` が `lambda` / `ecs` / `apprunner` を返し始めると、 加点が 1000 pt/cycle に上がる。

## デプロイされるもの

各チームの AWS アカウントに 1 つの CloudFormation スタック:

```text
┌── EC2 (Amazon Linux 2023, t3.small) ─────────────────────────────┐
│  nginx :80                                                       │
│    │                                                              │
│    ├─ /auth/*    → 127.0.0.1:8081  (Python systemd、 自己申告 ec2) │
│    ├─ /network/* → 127.0.0.1:8082  (Python systemd、 自己申告 ec2) │
│    ├─ /rate/*    → 127.0.0.1:8083  (Python systemd、 自己申告 ec2) │
│    ├─ /audit/*   → 127.0.0.1:8084  (Python systemd、 自己申告 ec2) │
│    └─ /ux/*      → 127.0.0.1:8085  (Python systemd、 自己申告 ec2) │
└──────────────────────────────────────────────────────────────────┘
        ▲
        │ Score engine が 1 分毎に /<slot>/meta + /<slot>/score を probe
        │ slot 毎の effective URL = portal override ?? CFn Output (BaseUrl + /<slot>)
```

## 競技フロー

1. **Deploy 直後は EC2 同居 5-slot monolith**。 stack Outputs から `BaseUrl` (= EC2 public DNS) を取得。
2. **5 slot 全てに `BaseUrl` を貼る** (Participant Portal の Endpoint Override パネル)。 score engine が probe 開始 → 加点が始まる。
3. **1 つの slot を切り出す**。 同じ `/meta` (= `{platform: "lambda"|"ecs"|"apprunner", slot: ...}`) と `/score` (= 200 JSON) を返す最小サービスを書き、 Lambda + API GW / ECS Fargate / App Runner のいずれかに deploy する。
4. **そ slot の override URL を新 managed endpoint に切替**。 `/meta` の自己申告が変わるので、 score engine が managed tier 加点に切替える。
5. **時計と勝負する**。 30 分で production-ramp phase、 60 分で compliance-audit、 90 分で incident-response が来る。 5 slot 全部 managed なら +30,000 pt の bonus が 1 回入る。

## 時間進行 (phases)

| 時刻   | phase              | 内容                                                                                                    |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------- |
| 0 分   | start              | 全 slot が EC2 同居、 baseline ≈ 500 pt/min (= 全 slot 登録済の場合)                                    |
| 30 分  | production-ramp    | EC2 のまま残っている **全 slot** が degradedPoints (10 pt) に切替。 「公開期限を逃した」 シミュレーション |
| 60 分  | compliance-audit   | 同じ engine effect が累積。 「Legal の PII 監査に間に合わなかった」 文脈                                |
| 90 分  | incident-response  | score engine が `/score?legacy=true` を probe。 slow path (= 2 秒 sleep) を取り除いて再 deploy しないと応答時間ペナルティが累積 |

各 phase は EC2 のまま残っている **全 slot に対して** 効く。 「ux だけ移して残り 4 slot は EC2 のまま」 だと 30 分後に 4 slot が一斉に degrade する設計。

## レッドチーム (ランダム組織イベント / disruptions)

放置のコストを実感させるため、 運営のレッドチームが任意タイミングで組織イベントを fire する (= 競技者は制御できない)。 前半 3 つは採点側ペナルティ、 後半 2 つは **EC2 への実障害注入**:

| id                    | name                              | 影響                                                  |
| --------------------- | --------------------------------- | ------------------------------------------------------- |
| `ceo-5000-users`      | CEO が明日 5000 人デモを要求      | `ux` が EC2 のままのチームに cycle ごと追加減点         |
| `mfa-mandate`         | Security Team が MFA 必須化       | `auth` が EC2 のままのチームに cycle ごと追加減点       |
| `legal-pii-found`     | Legal が PII 検出                 | `audit` が EC2 のままのチームに cycle ごと追加減点      |
| `env-credential-leak` | `.env` 流出                       | EC2 上の `auth` サービスを停止 → probe 5xx (= 加点 0 + failurePenalty 累積) |
| `ai-committed-secret` | Claude が秘密鍵を git commit      | EC2 上の `network` + `audit` を連動停止 → 両方 5xx     |

実障害系への対策は 2 つ:

- **移行済みなら無傷。** レッドチームが触るのは EC2 だけで、 override 先の URL には手を出さない。 この非対称性こそがゲームの肝。
- **EC2 に残っていたら** SSM で接続 (`SsmStartSessionCommand` stack output) して `sudo systemctl start tenkacloud-slot-<slot>`。 早く直すほど損失が小さい。 ADR-029 に従い自動復旧が常に予約されるため、 永続障害にはならない。

## 全 managed 移行ボーナス

5 slot 全てが `lambda` / `ecs` / `apprunner` のいずれかに乗ると **+30,000 pt** が 1 回入る (= 'production-ready' 認定)。 1 つでも EC2 が残っていると bonus は付かない。 部分移行で稼ぐ戦略より、 全 slot 完走を狙った方が点が伸びる設計。

## 自分で作るもの

`services/` scaffold は意図的に同梱していない。 各 slot の managed runtime 用サービスを書くこと自体が課題の一部 (= AI Builder も scaffold を残してくれない)。 必要な契約は:

- `GET /meta` → `{ "platform": "lambda" | "ecs" | "apprunner", "slot": "<slot-name>" }`
- `GET /score` → 任意 JSON で 200
- score engine から到達可能 (= public URL、 または到達できる private URL)

EC2 上の参照実装は `template.yaml` UserData の Python stub。

## コスト

- EC2 t3.small × 2h ≈ $0.04
- 自分で立てる managed runtime: 立てた数に比例。 終了 1 時間以内に削除すれば < $2
- 通信費: 微小

`aws cloudformation delete-stack` + 自分で作った Lambda / ECS / App Runner / ECR / API GW を手動 sweep。

## operator 向け

[OPERATOR.md](./OPERATOR.md) - 発火スケジュール、 deploy smoke test、 6 チーム同時開催の注意点。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 問題メタデータ (slot / scoring / phase / disruption の正本)
- [`template.yaml`](./template.yaml) — CFn ペライチ
- [`portal/StatusPanel.tsx`](./portal/StatusPanel.tsx) — 5-axis subscore + phase + disruption を可視化する dashboard plugin
- [`OPERATOR.md`](./OPERATOR.md) — 運用 runbook
- [`redteam/`](./redteam/) — disruption catalog の解説 + 事前 smoke test (operator 向け)
