# Hello Multicloud — Composite Runtimeスモークテスト

> TenkaCloud Challenge · `challenges/hello-multicloud` · 難易度 1 · 約10分 · `composite-probe` 採点

TenkaCloud Composite Runtimeの最小E2Eサンプルです。1つの問題定義からAWS Lambda
Function URLとGoogle Cloud Runへ展開し、両方がHTTP 200を返す場合だけ採点します。

この問題は現在 **draft** です。platformは複数targetを正規化・実行できますが、
Google Cloud Infrastructure Managerが要求するGCS URIへ`gcp/terraform/`をstageする処理が
まだ自動化されていません。staging経路の完成とlive deploy確認まではイベントで利用しないで
ください。

## 起動するもの

| target | provider / engine | リソース |
| --- | --- | --- |
| `aws-hello` | AWS / CloudFormation | 静的helloを返すLambda Function URL |
| `gcp-hello` | GCP / Infrastructure Manager | scale-to-zeroのCloud Run hello service |

AWS側はLambda無料枠内、GCP側は最大1 instanceかつscale-to-zeroで、通常のスモークテスト
trafficをCloud Run無料枠内に抑えます。

## 前提条件

- teamごとのGCP WIF設定（audience、service account email、project ID、region）
- platformの`nonAwsRuntime` feature flag
- `gcp/terraform/`をGCSへstageした`gs://` source
- public Cloud Run invocationを許可するGCP organization policy

## プレイヤーの流れ

1. `hello-multicloud`をデプロイします。
2. `aws-hello`と`gcp-hello`が両方`COMPLETE`になるまで待ちます。
3. targetごとに名前空間化されたoutputsを確認します。
4. 両方のURLを`curl`し、HTTP 200を確認します。
5. `composite-probe`は両targetが健康な場合だけ100点を加算します。

## 採点

`scoring.kind`は`composite-probe`、条件は`success: all`です。AWS targetの
`AwsHelloUrl`とGCP targetの`GcpHelloUrl`をprobeし、片方でも未完了・失敗・異常なら
加点しません。

## 削除

Composite teardownではCloudFormation stackとInfrastructure Manager deploymentの両方を
削除し、各target rowが削除済みの終端状態になることを確認します。

## コスト

LambdaとCloud Runの無料枠内では実質0円です。GCP project、logging、organization固有の
料金は運営者が確認してください。

## 関連ファイル

- `metadata.json` — composite runtimeと採点契約
- `template.yaml` — AWS target
- `gcp/terraform/main.tf` — GCP target。GCS staging自動化待ち
