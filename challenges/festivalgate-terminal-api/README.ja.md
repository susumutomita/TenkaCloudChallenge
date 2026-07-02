# 入場端末の裏口 — 「社内限定」は認証ではない

> TenkaCloud Challenge · `challenges/festivalgate-terminal-api` · 難易度 3 · 約40分 · `verify` 採点

初中級エンジニア向けの、AWS不要なローカルAPIセキュリティ教材です。架空のイベント会社
FestivalGateの入場端末APIを使い、「内部API」の信頼境界、認証、DB最小権限、機密情報分離を
扱います。1つのDockerコンテナで動き、外部サービスへ接続しません。

## 起動するもの

| 場所 | 内容 |
| --- | --- |
| `127.0.0.1:18080` | FestivalGate入場端末API |
| `127.0.0.1:18081` | TenkaCloudが利用する`/verify` |

フラグと端末tokenはデプロイごとの`FLAG_SEED`から導出し、リポジトリには保存しません。
portはすべてループバック限定です。

## ストーリーとミッション

会場端末はチケット照会と入場処理にAPIを使います。端末用機能はtokenで保護されていますが、
`GET /internal/ops/summary`は「社内ネットワークからしか到達しない」という前提だけで運営情報を
守っています。外部の診断者として、その判定根拠と影響範囲を検証してください。

運営endpointには次の2つの設計不備があります。

- 呼び出し元が設定できる情報で「社内」を判定する。
- 端末系と運営・顧客・認証データの権限分離がなく、機密まで応答する。

フラグは`opsSecrets.gate_master_note`にあります。

## 攻略手順

1. `make local PROBLEM=festivalgate-terminal-api`で問題とPortalを起動します。
2. 運営endpointへ通常アクセスし、`403`を確認します。

   ```bash
   curl http://127.0.0.1:18080/internal/ops/summary
   ```

3. サーバーが何を根拠に「外部」と判断しているか考え、内部らしいhopを送ります。

   ```bash
   curl -H "X-Forwarded-For: 10.0.0.9" \
     http://127.0.0.1:18080/internal/ops/summary
   ```

4. 応答の`opsSecrets.gate_master_note`をPortalへ提出します。

| リクエスト | 結果 |
| --- | --- |
| headerなしの運営summary | `403` |
| 内部IPを名乗る`X-Forwarded-For`付き | 運営機密を`200`で返す |
| 正しい端末tokenでチケット照会 | 必要なチケット情報だけを`200`で返す |

## 根本原因と対策

- ネットワーク境界は認証ではない。各endpointで署名tokenやmTLSなど検証可能な資格情報を
  認証・認可し、private networkやWAFは補助防御として扱う。
- proxyが付与する転送headerを使う場合は、信頼するproxyからの値だけを受け入れ、外部入力を
  そのまま信頼しない。
- 端末用DB userは`tickets`に必要な操作だけを許可する。
- 運営設定、顧客PII、認証・reset情報を用途別のidentityやdatabaseへ分離する。
- rate limit、監査ログ、異常検知を組み合わせる。

## 初期化とコスト

`make local-down`でコンテナを削除すると初期状態へ戻ります。ローカルDockerのみで、
クラウド料金は発生しません。

## 関連ファイル

- `local/app/server.mjs` — 端末APIと`/verify`
- `local/docker-compose.yml` / `local/Dockerfile` — ループバック限定runtime
- `metadata.json` — 問題文、採点、ヒント
