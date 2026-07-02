# Cloudflare Workers Profile API — 5段階セキュリティ採点

> TenkaCloud Challenge · `challenges/cloudflare-api-security` · 難易度 3 · 約60〜90分 · `flag` 採点

意図的に不備を入れたプロフィールAPIを自分のCloudflare Workers無料アカウントへ
デプロイし、修正後のURLをTenkaCloud側Evaluator Lambdaから5段階で外部検証する問題です。
全チェックを通過すると、Evaluatorだけが保持するフラグ`TC{...}`を返します。

## ストーリー

天下クラウドの新人SREとして、退職した前任者が残したプロフィールAPIを引き継ぎました。
スターターにはOWASP API Security Top 10由来の不備があります。外部採点をすべて通るよう
修正してください。

## 起動するもの

| 場所 | 内容 |
| --- | --- |
| 自分のCloudflare無料アカウント | Workers上のプロフィールAPI |
| TenkaCloud AWSアカウント | Evaluator Lambda、スターター用S3、SSMブリーフィング、閲覧ロール |

## 5段階の採点

| 段階 | 検証内容 |
| --- | --- |
| 0 | `GET /healthz`が`200`と`{"status":"ok"}`を返す |
| 1 | 不正なIDを`400`/`404`で拒否し、5xxや内部情報を漏らさない |
| 2 | 無効トークンは`401`、本人は読め、他人のIDは`403` |
| 3 | エラー本文にstack、path、tokenなどを含めない |
| 4 | 反復実行しても防御動作が変わらない |

フラグは全段階を通過した場合だけ返され、`NamePrefix`から推測できません。

## 攻略手順

1. CloudShellでSSMのブリーフィングを取得します。

   ```bash
   aws ssm get-parameter --name /<NamePrefix>/briefing \
     --query Parameter.Value --output text
   ```

2. S3からスターターを取得して展開します。
3. `wrangler login`後に`wrangler deploy`し、`*.workers.dev` URLを控えます。
4. `index.js`の`// VULN:`箇所を修正します。
   - 無効な認証情報を`401`で拒否
   - `:id`形式を検証
   - 他ユーザーの読み取りを`403`で拒否
   - catch時は内部情報を含まない一般的なエラーを返す
5. 再デプロイ後、`./evaluate.sh <NamePrefix> https://<name>.workers.dev`を実行します。
6. 全段階通過時の`TC{...}`をPortalへ提出します。

## Evaluatorが期待するAPI契約

| リクエスト | 期待結果 |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok"}` |
| トークンなし・無効で`GET /api/profile` | `401` |
| `token-alice`で`GET /api/profile` | aliceのプロフィールを`200` |
| aliceが`GET /api/profile/alice` | `200` |
| aliceが`GET /api/profile/bob` | `403` |
| 不正なID | `400`/`404`、5xxや内部情報漏えいなし |

デモトークンは`token-alice`と`token-bob`です。

## 採点

| 項目 | 値 |
| --- | --- |
| 種別 | `flag` |
| 配点 | 400 |
| 誤答ペナルティ | 0 |
| ヒント | 3段階 |

## Evaluator自身のSSRF対策

競技者がURLを入力するため、EvaluatorはHTTPSのみ、`*.workers.dev`サブドメインのみを許可し、
redirectを追跡せず、接続・読み取りtimeoutと応答サイズ上限を適用します。これによりprivate
addressやmetadata endpointへの到達を防ぎます。

## コスト

Cloudflare Workers無料枠とAWS無料枠内で動作し、stack削除でAWS側リソースを除去できます。
