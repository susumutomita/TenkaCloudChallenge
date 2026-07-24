# 金曜深夜のパッチ当て — 食い止め、 直し、 止めない

> TenkaCloud Challenge · `challenges/wp2shell-friday-night-patch` · 難易度 4 · 約 75 分 · `multi-flag` 採点 (7 flags、 300 点)

[`wp2shell-local-lab`](../wp2shell-local-lab/) (安全なローカルのリハーサル) と対になる、 **実際の AWS インシデント**側の問題。 根本原因もシミュレータのアプリも同じだが、 今回は API Gateway + Lambda を WAFv2 WebACL の背後に本当にデプロイした状態で起きる。 そして事業からの要求はひとつ ── **対応の間、 サイトを止めないこと。**

## ストーリー

金曜 17:30。 監視から、 Example Co の本番の WordPress 風サイトへの不審な REST API トラフィックの通知が届く。 証拠が示すのは、 まさに wp2shell-local-lab で安全に予行演習したのと同じ経路だ ── 未認証のバッチリクエストのすり抜けが、 文字列連結による SQL クエリに繋がっている。 侵入者は 3 つのものを残していった ── 無害な居座り用の目印、 不正な管理者、 改変されたテーマファイル。 これを検知するはずだった WAF のルールは、 今は `Count` (検知・記録のみ) になっていて、 まだ何も遮断していない。

あなたの仕事: 調査し、 今すぐ封じ込め、 根本原因を直し、 後片付けをし、 資格情報をローテーションし、 そのすべてを証明する ── サイトを一度もオフラインにすることなく。

## 何がデプロイされるか

| リソース | 役割 |
| --- | --- |
| **`RestApi`** (API Gateway、 REGIONAL) | 公開されている 「本番サイト」 ── `{proxy+}` で `AppFunction` にルーティングする。 |
| **`AppFunction`** (Lambda、 Python) | アプリ本体一式: 模擬 REST サーフェス (wp2shell-local-lab と同じバッチ経路 + クエリ構築のロジックを Python + SQLite に移植)、 CloudFormation の証拠シード用カスタムリソース、 そして各チェックポイントの合言葉を得るための `grade` アクション。 |
| **`WafWebAcl`** (WAFv2、 REGIONAL) | ルール 1 つ (`SqliMatchStatement` + `/wp-json/batch/v1` へのパス一致)、 今は `Count`。 API ステージに紐付け済み。 |
| **`EvidenceBucket`** (非公開 S3、 バージョニング有効) | デプロイ時に `incident-log.json` を仕込み済み ── 時系列・実際の不審なリクエスト・調査結果。 |
| SSM の設定/データ (`/<prefix>/config/*`、 `/<prefix>/data/*`、 `/<prefix>/site/*`) | このインシデントが触れるすべての設定: 2 つの根本原因のトグル、 salt のバージョン、 不正管理者/居座り目印のフラグ、 改変されたテーマファイルの内容。 すべて **既存の** パラメータ ── 上書きするだけで、 新しく作ることは無い。 |
| **`ParticipantViewerRole`** | 証拠の読み取り。 `/<prefix>/*` パラメータの読み書き。 このスタック自身の WebACL に絞った `wafv2:GetWebACL` + `wafv2:UpdateWebACL`。 `AppFunction` に絞った `lambda:InvokeFunction` (チェックポイントの採点用)。 `cloudformation:DescribeStacks` も `lambda:GetFunction*` も無し ── どの合言葉も直接読めず、 必ず稼いで得る。 |

EC2 も VPC も NAT も ALB も無い。 Lambda + API Gateway + WAFv2 + S3 + SSM のみ ── `x402-paywall` と同じ、 低コスト/ほぼゼロコストの構成。

## チェックポイント (multi-flag)

| チェックポイント | 何を証明するか | 点数 |
| --- | --- | ---: |
| `timeline-iocs` | 証拠一式から事故を再構成できたこと。 | 45 |
| `waf-containment` | WAF のルールが `Block` になっていること (**元の攻撃を実際に再現**して 403 が返ることで確認)。 | 45 |
| `patched-workload` | 2 つの根本原因の設定が両方効いていること (**WAF を経由しない直接再現**で確認 ── コードの修正そのものを封じ込めとは独立に判定)。 | 45 |
| `persistence-removal` | 不正な管理者・居座り用の目印・改変されたファイル、 3 つとも実地で片付いていること。 | 40 |
| `credential-rotation` | 鍵が実際にローテーションされ、 証拠に写っていた古いトークンがもう認証に使えないこと。 | 40 |
| `evidence-preservation` | 最初の証拠オブジェクトが壊されずに残っていること。 | 40 |
| `uptime-and-legit-traffic` | トップページ・通常の投稿一覧・正規の認証済みリクエストが、 すべて引き続き 200 で返ること (実地確認)。 | 45 |

`timeline-iocs` 以外の全チェックポイントは、 `AppFunction` に `{"action":"grade","check":"<id>"}` を invoke することで得られる ── Lambda は、 実際にライブの条件を再検証して初めて、 そのチェックポイントの合言葉を返す (実際のエンドポイントへの再現攻撃、 または現在のパラメータ状態の実地確認)。 見た目だけの修正 (実際の挙動が変わらないままの設定変更や、 URI だけのブロック) では、 ここでは絶対に加点されない ── 採点は常に設定の見た目ではなく実際の経路を叩くからだ。

## 解き方

以下はすべて AWS CloudShell から実行する (スタックの認証情報がすでに入っている)。 `<prefix>` は自分のチームの NamePrefix に置き換える。

1. **調査する。** `aws s3 cp s3://<EvidenceBucketName>/incident-log.json .` ── 時系列・不審なリクエスト・調査結果を読む。 `audit_token` フィールドが `timeline-iocs` の合言葉だ。
2. **今すぐ封じ込める (ダウンタイムなし)。**
   ```bash
   aws wafv2 get-web-acl --scope REGIONAL --name <WebAclName> --id <WebAclId> > acl.json
   # acl.json を編集: 1 つのルールの Action を {"Count":{}} から {"Block":{}} に変える
   aws wafv2 update-web-acl --scope REGIONAL --name <WebAclName> --id <WebAclId> \
     --lock-token <acl.json の LockToken> --default-action Allow={} \
     --rules file://rules.json --visibility-config ...
   ```
3. **根本原因を直す (設定のみ、 ダウンタイムなし)。**
   ```bash
   aws ssm put-parameter --name /<prefix>/config/route-isolation --value true --overwrite
   aws ssm put-parameter --name /<prefix>/config/parameterized-queries --value true --overwrite
   ```
4. **後片付けをする。**
   ```bash
   aws ssm put-parameter --name /<prefix>/data/rogue-admin-present --value false --overwrite
   aws ssm put-parameter --name /<prefix>/data/persistence-marker-present --value false --overwrite
   aws ssm put-parameter --name /<prefix>/site/theme-functions --overwrite \
     --value "$(aws cloudformation describe-stacks ... ThemeFunctionsBaseline)"
   ```
5. **ローテーションする。** `aws ssm put-parameter --name /<prefix>/config/salt-version --value 1 --overwrite`
6. **各チェックポイントを採点する。**
   ```bash
   aws lambda invoke --function-name <AppFunctionName> --cli-binary-format raw-in-base64-out \
     --payload '{"action":"grade","check":"waf-containment"}' out.json && cat out.json
   ```
   `{"ready": true, "flag": "TC{...}"}` ── その合言葉を提出する。 各チェックポイントで繰り返す。

## 順番はなぜ大事か (ただし強制されない)

ローテーションや後片付けを先にやっても構わない ── どのチェックポイントも、 他とは独立に 「今の実際の状態」 だけを見て判定される。 だが **WAF の封じ込めはコストがほぼゼロで数秒で終わる** のに対し、 根本原因の修正や後片付けは 「本当に正しく直っているか」 の確認に時間がかかる ── だから封じ込めを先にやるのは、 現実の勘所としても、 ここでの得点効率としても理にかなっている。

## コスト

Lambda + API Gateway + WAFv2 + S3 + SSM Standard パラメータのみ ── EC2 も RDS も ALB も NAT Gateway も無い。 いずれも従量課金 + 無料枠があり、 通常の約 75 分のセッションなら数セント程度、 リクエストの無い待機時間は課金されない。 `delete-stack` で、 このテンプレートが作った全リソース (WebACL の紐付け・WebACL 本体・API・Lambda・証拠バケット・全 SSM パラメータ) が削除される。

## この問題をデプロイした場合の物理的影響

CREATE のみ: `AWS::ApiGateway::RestApi` + `Resource` + `Method` (2 つ) + `Deployment` + `Stage`、 `AWS::Lambda::Function` + `Permission`、 `AWS::WAFv2::WebACL` + `WebACLAssociation`、 `AWS::S3::Bucket`、 SSM パラメータ 7 つ、 `AWS::IAM::Role` (2 つ)、 `AWS::CloudFormation::CustomResource` 1 つ。 通常のプレイで REPLACE や DELETE が起きるリソースは無い ── どの 「直し」 も、 既存パラメータへの `ssm:PutParameter` か、 既存 WebACL への `wafv2:UpdateWebACL` だ。 `delete-stack` は上記すべてのクリーンな DELETE になる。

## 学習目標

- WAF のルールを `Count` から `Block` に切り替えることは、 ダウンタイムなしの即時封じ込め手段であり、 根本原因の修正とは別物で、 それより速いと理解する。
- 根本原因の是正・封じ込め・後片付けが、 それぞれ緊急度も確認方法も異なる独立した仕事であることを体感する。
- 資格情報のローテーションと証拠の保全が、 必須の手順であり省略可能なおまけではないことを説明できるようになる。
- 「サイトを止めない」 という要求を守りながら、 設定変更 (`ssm put-parameter`、 `wafv2 update-web-acl`) だけでインシデント対応を完結できることを確認する。

## 関連ファイル

- `template.yaml` ── スタック一式: API Gateway・アプリ/グレーダーの Lambda・WAFv2 WebACL・証拠バケット・全 SSM パラメータ・参加者用 IAM ロール。
- `metadata.json` ── カタログエントリ。 7 flag の採点とヒント。
- `scripts/wp2shell-friday-night-patch.test.ts` (リポジトリルート) ── テンプレートの Outputs と `metadata.json` の `flagOutputKey` の突き合わせ、 IAM baseline、 リソースタグ付けの不変条件を検査する。

## 何をオフラインで検証し、 何が一回限りの AWS 実機検証を要するか

Lambda アプリのロジック全体 (バッチ経路のバグ・SQL 構築の欠陥・両方の修正・7 チェックポイント全部の採点ロジック・CloudFormation カスタムリソースによる証拠のシード) は、 実際の AWS 呼び出しの代わりにモックした `boto3` を使って直接実行・検証済みだ ── 各チェックポイントは、 満たされるべきタイミングちょうどで not-ready から ready に切り替わり、 ライブのネットワーク呼び出しが届かない場合は fail-closed になる (PR 本文にトランスクリプトを記載)。 実際の AWS アカウントが無ければ検証できず、 オフラインでは模擬できない部分:

- AWS WAF の `SqliMatchStatement` が、 この問題が仕込む正確なペイロードを本当に SQL インジェクションの形として認識するか (古典的な `UNION SELECT` + 引用符の脱出は WAF の標準的な検知対象のはずだが、 実際の WebACL に対しては未検証)。
- API Gateway の `{proxy+}` + `AWS_PROXY` Lambda 統合が、 実際にエンドツーエンドでデプロイ・ルーティングされるか (よく知られた CFn パターンだが、 実アカウントに対して synth していない)。
- `wafv2:GetWebACL` + このスタック自身の WebACL ARN に絞った `wafv2:UpdateWebACL` だけで (`wafv2:GetWebACLForResource` 無しで)、 参加者ロールから本当に `wafv2:UpdateWebACL` が成功するか (実機で未実行)。

`status` を `ready` に切り替える前に、 AWS アクセスを持つメンテナが `make deploy` 相当の試験デプロイを 1 回行い、 解答の流れを最後まで歩いて確認すること。
