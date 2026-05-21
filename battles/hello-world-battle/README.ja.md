# Hello World Battle (Sample)

> English: [README.md](./README.md)

Battle uptime scoring の **最小 sample** 問題。 EC2 1 台に nginx (frontend) と Python http.server (api) を起動するが、 デプロイ直後の `FrontendUrl` / `ApiUrl` Output は **空**。 競技者が Participant Portal の override 欄に自分のスタックの URL を貼り付けて初めて Health Check Lambda が probe を開始し、 両方が 200 を返すサイクルごとに +100 pt が入る。

| 項目         | 値                                       |
| ------------ | ---------------------------------------- |
| カテゴリ     | Battle (リアルタイム対戦)                |
| 難易度       | 1 / 5 (入門)                             |
| 想定時間     | 30 分                                    |
| status       | `ready`                                  |
| 採点方式     | `uptime-flat` (`pointsPerSuccess`: 100)  |

## 何をする問題か

天下クラウド株式会社、 2 日目。 加藤さんが production に残した小さな web stack (EC2 上で nginx + Python `/healthz`) を引き継いだ ── が、 同じアカウントには他チームの SRE がいて、 互いに相手のサービスを落とし合っている。

あなたの仕事:

1. Deploy 完了後、 Output の `Ec2HostHint` (= EC2 の公開 DNS 名) をコピー。
2. Participant Portal で `frontend` slot に `http://<host>`、 `api` slot に `http://<host>:8080` を貼り付けて override 保存。
3. ここから 1 分ごとに Health Check Lambda が probe を始め、 両方 200 を返したサイクル分だけ +100 pt。
4. 攻撃を受けて落とされたら SSM Session Manager で復旧 (SSH 不要)。

**Deploy しただけでは 1 点も入らない**。 URL を portal に登録した瞬間から Battle が始まる。

- **攻撃側**: 同じ EC2 / Security Group を弄って frontend や API を止める (例: `systemctl stop nginx`)
- **防御側**: SSM Session Manager で SSH 不要に入り、 サービスを再起動する

全操作は 1 EC2 内で完結するため cross-tenant 影響なし。

## デプロイされるもの

```
┌─────── EC2 t3.micro (Amazon Linux 2023, Public IP) ───────┐
│  nginx          :80   → /                                 │
│  python3 http.server :8080 → /healthz                     │
└────────────────────────────────────────────────────────────┘
       ▲
       │ FrontendUrl / ApiUrl Output は EMPTY
       │ 競技者が portal で URL を override すると probe 開始
       │ 両方 200 → +100 pt / cycle
```

- 専用 VPC (`10.99.0.0/16`) + 公開 subnet + IGW
- SSM Session Manager 用 InstanceRole (`AmazonSSMManagedInstanceCore`)
- `ParticipantViewerRole` (競技者が AWS Console を読み取り専用で AssumeRole する用)

## 採点

| 状態                                            | 1 cycle (1 分) |
| ----------------------------------------------- | -------------- |
| `FrontendUrl /` と `ApiUrl /healthz` が両方 200 | +100 pt        |
| いずれかが 200 以外 / timeout                   | 0 pt           |

詳細は [`metadata.json`](./metadata.json) の `scoring` フィールド参照。

## コスト

- EC2 t3.micro: AWS Free Tier 750 時間/月 (12 ヶ月) 内
- VPC / IGW / SG: 無料
- 1 セッション (~30 分) は Free Tier 範囲ならゼロ円

## 学習目的

- TenkaCloud の Battle uptime scoring engine が実 endpoint で動くことを確認する
- EC2 + nginx + Python の最小 web stack で health probe を受ける流れを体験する
- SSM Session Manager で SSH 不要に接続し、 サービスを start / stop する操作を覚える

## 関連ファイル

- [`metadata.json`](./metadata.json) — 問題メタデータ (UI / scoring engine 正本)
- [`template.yaml`](./template.yaml) — CFn ペライチ (competitor account に deploy する本体)
