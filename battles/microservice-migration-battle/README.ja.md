# Microservice Migration Battle

> English: [README.md](./README.md)

天下クラウド株式会社、 入社 1 ヶ月目。 先期、 引き継ぎミーティングの翌週に姿を消した前任の SRE が、 EC2 1 台に同居する 3 サービス (`users` / `orders` / `catalog`) のモノリスを残していった。 nginx の config だけが疲弊した顔で path を振り分けている。

> CTO 曰く: 「そろそろこれ、 サービスごとに別 hosting に分けてくれない? Lambda でも ECS Fargate でも App Runner でもいい。 とにかく 1 VM 同居をやめて。 他チームは昨日から動いてる」

この Battle はその移行作業そのもの。 持ち時間 90〜120 分、 Participant Portal に 3 つの slot、 そして登録された URL の hosting platform に応じて加点額が切り替わる score engine が用意されている。

## 競技概要

- カテゴリ: Battle (リアルタイム対戦)
- 難易度: 4 / 5
- 想定時間: 90 〜 120 分
- 学習目的:
  - モノリス → マイクロサービスへの段階的移行 (strangler fig パターン) を体験する
  - Lambda + API Gateway (= function-as-a-service) / ECS Fargate (= orchestrated container) / App Runner (= managed container) を実機で比較する
  - 残り時間と現スコアの両睨みで「次に切り出すサービス」を決める

## デプロイされるもの

各チームの AWS アカウントに 1 つの CloudFormation スタックがデプロイされる:

```text
┌─────────────── EC2 (t3.small, Amazon Linux 2023) ───────────────┐
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                       │
│  │  users   │  │  orders  │  │ catalog  │  ← docker compose      │
│  │  :3001   │  │  :3002   │  │  :3003   │     で同居             │
│  └──────────┘  └──────────┘  └──────────┘                       │
│         ▲             ▲             ▲                            │
│         └─────────────┴─────────────┘                            │
│                       │                                          │
│  ┌────────────────────────────────────────────┐                  │
│  │  nginx :80  →  /users/*   /orders/*        │                  │
│  │             →  /catalog/*                  │                  │
│  └────────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
                       ▲
                       │ Score engine が /users, /orders, /catalog を 1 分毎 probe
                       │ (URL は Participant Portal の Endpoint Override から拾う)
```

3 サービスはコード同型 (= ports と service 名だけ違う):

| service   | port | platform 自己申告 (`/meta`) | ハンドラ                       |
| --------- | ---- | --------------------------- | ------------------------------ |
| `users`   | 3001 | `ec2`                       | `/meta`, `/score`, `/healthz`  |
| `orders`  | 3002 | `ec2`                       | 同上                           |
| `catalog` | 3003 | `ec2`                       | 同上                           |

`GET /meta` で現在の hosting platform (`ec2` / `lambda` / `ecs` / `apprunner`) を自己申告する。 score engine はこの値で加点額を決める。

## 想定終形 (= 完全移行の一例)

```text
                ┌────────── Lambda + API Gateway ───────────┐
                │  /users   → handler (Hono on Lambda)        │
                └─────────────────────────────────────────────┘

                ┌────────── ECS Fargate Service ─────────────┐
                │  /orders  → ALB → Fargate Task (Container)  │
                └─────────────────────────────────────────────┘

                ┌────────── AWS App Runner ──────────────────┐
                │  /catalog → App Runner Service (Container)  │
                └─────────────────────────────────────────────┘
```

3 サービス × 3 hosting で 6 通り。 上は一例で、 割り当ては自由。

## 競技フロー

1. **Deploy 直後はモノリスが動いている。** `BaseUrl` は invariant #9 に従って空文字 (= deploy しただけでは加点が始まらない)。 stack の Outputs から `Ec2HostHint` (EC2 public DNS) をコピー。
2. **各 slot にパス付き URL を貼る** — `users` に `http://<Ec2HostHint>/users`、 `orders` に `http://<Ec2HostHint>/orders`、 `catalog` に `http://<Ec2HostHint>/catalog` — Participant Portal の Endpoint Override から。 (nginx は `/users/` `/orders/` `/catalog/` しかルートしないので、 素の `http://<host>` を貼ると `/meta` probe が 404 になり slot ごとに −100 減点。) URL が登録された slot から score engine が probe を始め、 EC2 加点が入り始める。
3. **1 サービスを切り出す。** 一番ラクな service を選び、 `services/<name>/Dockerfile` をそのまま container image にして Lambda + API GW / ECS Fargate / App Runner のいずれかに上げる。
4. **slot override の URL を新 managed endpoint に切替える。** `/meta` が `lambda` / `ecs` / `apprunner` を返すので、 score engine が managed tier 加点に切替える。
5. **残り 2 サービスも managed に切り出す。** 3 slot を全て EC2 から managed tier に乗せると (Lambda / ECS / App Runner の組み合わせは自由。 1 種ずつが推奨形) "production-ready" bonus が 1 回だけ入る。

EC2 のまま放置すれば baseline。 きれいに分けたチームが勝つ設計。

## サービス仕様

各サービス共通の HTTP routes:

- `GET /meta` → `{ "service": "<name>", "platform": "ec2" | "lambda" | "ecs" | "apprunner", "version": "1.0.0" }`
- `GET /score` → `{ "score": <int> }`
- `GET /healthz` → `{ "ok": true, "service": "<name>" }`

### ローカル開発

```bash
cd battles/microservice-migration-battle/services
docker compose up --build
curl http://localhost/users/score
curl http://localhost/orders/score
curl http://localhost/catalog/score
```

## 採点ルール (1 slot × 1 probe cycle あたり)

| 状態                                       | Points        |
| ------------------------------------------ | ------------- |
| URL 未登録 / 200 以外 / timeout            | -100          |
| EC2 (通常)                                 | +100          |
| EC2 (中盤の degradation イベント発火後)    | +10           |
| Lambda + API Gateway                       | +1,000        |
| ECS Fargate                                | +1,000        |
| App Runner                                 | +1,000        |
| 遅延応答 (> 1.5 秒)                        | -10           |
| 全 3 slot を managed tier に載せた瞬間     | +5,000 (一回のみ) |

hosting tier は `GET /meta` の申告で決まり、 score engine はこれを読んで加点する。 実際に稼働している hosting を申告すること — EC2 に残したまま managed tier を騙るのは正当な戦略ではない。 応答時間ペナルティは tier に関係なく加算される。

## 各 hosting への移行ヒント

`services/<name>/Dockerfile` は 3 種 hosting にそのまま流用可能。 配線だけが異なる。

### Lambda + API Gateway

1. Hono を `hono/aws-lambda` adapter で wrap (handler を export)
2. esbuild で bundle、 または container image
3. `aws lambda create-function --package-type Image --code ImageUri=<ECR URI>`
4. API Gateway HTTP API → integration target に Lambda function
5. 環境変数 `PLATFORM=lambda` を設定 (= `/meta` の自己申告用)

### ECS Fargate

1. `docker build -t <ECR URI>:latest services/orders` → ECR push
2. Task Definition (CPU 256 / Memory 512、 container port 3002、 `PLATFORM=ecs`)
3. ECS Cluster + Service (1 task)、 ALB Target Group (= container port) に登録
4. ALB Listener Rule で `/orders/*` を Target Group に転送

### App Runner

1. `docker build -t <ECR URI>:latest services/catalog` → ECR push
2. App Runner Service (Source = ECR、 port 3003、 `PLATFORM=apprunner`)
3. 払い出された App Runner URL をそのまま slot override に登録

## hosting tradeoff (= なぜ 3 種を並行体験するか)

| 観点         | Lambda + API GW          | ECS Fargate                         | App Runner                          |
| ------------ | ------------------------ | ----------------------------------- | ----------------------------------- |
| 単位         | 関数 (event-driven)      | コンテナ + クラスタ管理             | コンテナ (managed)                  |
| スケール     | per-request, cold start  | per-task (Auto Scaling)             | per-request, auto                   |
| 設定の重さ   | 軽 (HTTP API 1 発)       | 重 (VPC / ALB / Service / TaskDef)  | 中 (URL 1 発、 VPC 不要)            |
| 主な学び     | event-driven, 非同期     | orchestration, 永続化, network      | managed container, source deploy    |

Lambda (関数) ↔ App Runner (managed container) ↔ ECS (orchestrated container) のスペクトラムを 1 競技で歩く設計。

## コスト

t3.small EC2 + 最小ネットワーク。 2 時間の競技あたり:

- EC2 t3.small: < $0.05
- score engine の probe 通信費: 微小
- 競技中に立てる ECR / Lambda 関数 / ECS Fargate task / App Runner service: 作った量に比例。 競技終了 1 時間以内に削除すれば < $1。

`aws cloudformation delete-stack` でスタックを片付けて競技終了。
