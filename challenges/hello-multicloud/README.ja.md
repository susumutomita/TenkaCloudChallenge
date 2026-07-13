# Hello Multicloud — 4 provider Composite Runtime スモークテスト

> TenkaCloud Challenge · `challenges/hello-multicloud` · 難易度 1 · 約 10 分 ·
> `composite-probe` 採点

TenkaCloud Composite Runtime の最小 4 provider サンプルです。1 つの問題定義から
AWS、Google Cloud、Azure、さくらのクラウドへ展開し、4 endpoint がすべて HTTP 200 を
返す場合だけ採点します。

この問題は **draft** です。non-AWS credential、GCP source staging、1 回限りの live deploy
検証が完了するまでは event で利用しないでください。

## 起動するもの

| target | provider / engine | リソース | 採点 route |
| --- | --- | --- | --- |
| `aws-hello` | AWS / CloudFormation | Lambda Function URL | `AwsHelloUrl` + `/` |
| `gcp-hello` | GCP / Infrastructure Manager | scale-to-zero Cloud Run service | `GcpHelloUrl` + `/` |
| `azure-hello` | Azure / Bicep | scale-to-zero Container App | `AzureHelloUrl` + `/healthz` |
| `sakura-hello` | さくらのクラウド / AppRun | scale-to-zero AppRun application | `BaseUrl` + `/healthz` |

Azure と Sakura は同じ digest-pinned workload を実行します。この workload の公開 readiness
契約は `GET /healthz` です。root route が AWS/GCP と同じ hello payload を返すとは
説明しません。

## 前提条件

- team ごとの GCP WIF、Azure、さくらのクラウド deploy credential
- platform 側の non-AWS composite runtime adapter 対応
- `gcp/terraform/` を GCS へ stage した `gs://` source
- この sample の anonymous HTTPS probe を許可する各 cloud policy

## プレイヤーの流れ

1. `hello-multicloud`をデプロイします。
2. `aws-hello`、`gcp-hello`、`azure-hello`、`sakura-hello` が `COMPLETE` になるまで待ちます。
3. target ごとに名前空間化された output を確認します。
4. AWS/GCP の URL は `/`、Azure/Sakura の URL は `/healthz` を probe します。
5. すべての request が HTTP 200 を返すことを確認します。

## 採点

`scoring.kind` は `composite-probe`、条件は `success: all` です。metadata は各 target を
実際の output key と HTTP path に binding します。1 target でも未完了、失敗、異常なら
100 点を加算しません。

## Simulator overlay

`simulation.json` は `sakura/application.json` から導出できない Sakura data-plane behavior
だけを追加します。対象は HTTP `Request`、採点 `Probe`、`BaseUrl` に binding する
digest-pinned workload です。AWS、GCP、Azure の requirement は IaC から導出します。

## 削除とコスト

Composite teardown では 4 target の deployment をすべて削除します。各 resource は
scale-to-zero または request-based billing ですが、cloud account、logging、organization
固有の料金は operator が確認してください。

## 関連ファイル

- `metadata.json` — composite runtime と採点契約
- `template.yaml` — AWS target
- `gcp/terraform/main.tf` — GCP target
- `azure/main.bicep` — Azure target
- `sakura/application.json` — Sakura AppRun target
- `simulation.json` — Sakura のみを補う最小 simulation overlay
