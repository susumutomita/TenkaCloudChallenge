# Security Battle Royale

> English: [README.md](./README.md)

天下クラウド株式会社、 ある月曜の朝。 噂は聞くが顔は見たことのない前任 SRE の加藤さんが、 「Unicorn.Rentals」 を残していった。 去年の買収案件。 mysql + Flask + nginx が EC2 1 台に同居。 監視ダッシュボードは緑、 ただしコードは誰も読んでいない。

> 佐々木 CTO 曰く: 「攻撃来てる。 他チームのも一緒に来てる。 落とすな、 全部直すな、 とにかく 200 を返し続けて。 トリアージ」

この Battle は次の 60〜90 分。 score engine は frontend / api の 両方が 200 を返している 1 分ごとに +100 pt を入れる。 きれいな修正に対しては払われない。 多少漏らしてでも 200 を維持した方が点が伸びる設計。

## 競技概要

| 項目         | 値                                                |
| ------------ | ------------------------------------------------ |
| カテゴリ     | Battle (リアルタイム対戦)                         |
| 難易度       | 4 / 5                                            |
| 想定時間     | 60〜90 分                                         |
| 採点方式     | `uptime-multi` - 両方 200 で +100 pt、 片方落ちで 0 |

## デプロイされるもの

各チームの AWS アカウントに 1 つの CloudFormation スタックが入る:

```text
┌── EC2 (Amazon Linux 2023, t3.small) - IMDSv2 強制 ──────────┐
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│  │  nginx   │  │  Flask   │  │  mysql   │  ← docker compose  │
│  │  :80     │  │  :8080   │  │  :3306   │                    │
│  └──────────┘  └──────────┘  └──────────┘                    │
│       ▲              ▲                                       │
│       │              │                                       │
│  Ec2HostHint    Ec2HostHint:8080                             │
└──────────────────────────────────────────────────────────────┘
        ▲
        │ Score engine が 1 分毎に 2 endpoint を probe
        │ 両方 200 の cycle にだけ +100 pt
```

- 専用 VPC + 公開 subnet + IGW (チームごとに分離)
- 公開ポート: 80 (frontend) / 8080 (api)、 `AllowedCidr` で絞れる (default `0.0.0.0/0`)
- `DbPassword` は CFn parameter (NoEcho)、 deploy chain がランダム生成
- IMDSv2 強制 (`HttpTokens=required`、 hop-limit=1) - SSRF 系の漏洩が起きても instance role の credential は抜けない構成

## 競技フロー

1. **Deploy 直後はアプリは動いている、 加点は止まっている。** stack Outputs に `Ec2HostHint` (= public DNS) が出る。 `FrontendUrl` / `ApiUrl` は invariant #9 に従って空文字。
2. **Participant Portal の Endpoint Override に URL を貼る:**
   - `frontend` slot ← `http://<Ec2HostHint>`
   - `api` slot ← `http://<Ec2HostHint>:8080`
3. **Score engine が 2 endpoint を probe** (`/` と `/api/v1/apistatus`)。 両方 200 を返している cycle にだけ +100 pt。 どちらかが落ちると 0 pt。
4. **operator 側から定期的に攻撃 probe が飛んでくる。** アプリを止めずに直せ。 入力検証で塞げるものもあれば、 rate limit / 水平スケールが要るものもある。

200 を保ち続けたチームが勝つ。 完璧に直そうとしたチームは、 多くの場合落とす。

## ローカル開発

```bash
cd battles/security-battle-royale/local
docker compose up --build
# frontend: http://localhost:80
# api:      http://localhost:8080/api/v1/apistatus
```

`local/docker-compose.yaml` + `local/mysql-init.sql` で本番と同じ 3 コンテナ構成を再現。 `api/api.py` と `frontend/index.html` が本物のデプロイ対象そのもの。

## 採点

```
+100 pt   frontend と api の両方が 200 を返した 1 cycle (= 60 秒)
   0 pt   片方でも 200 以外 / timeout / 未登録
```

詳細は [`metadata.json`](./metadata.json) の `scoring` フィールド参照 (hint penalty 含む)。

## コスト

- EC2 t3.small × 90 分 ≈ $0.04
- VPC / SG / IGW: 無料
- 通信費: operator-side probe は微小

`aws cloudformation delete-stack` で stack を片付けて競技終了。

## 関連ファイル

- [`metadata.json`](./metadata.json) — 問題メタデータ
- [`template.yaml`](./template.yaml) — CFn ペライチ (competitor account にデプロイ)
- [`api/api.py`](./api/api.py) — Flask API (引き継ぐコードベース)
- [`frontend/index.html`](./frontend/index.html) — nginx が serve する静的ページ
- [`local/docker-compose.yaml`](./local/docker-compose.yaml) — ローカル再現
- [`redteam/`](./redteam/) — **operator only**。 platform が各チームに対して fire する攻撃 catalog。 プレイヤーが先に読むと Battle 体験が壊れる。
