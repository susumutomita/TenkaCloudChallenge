# IAM Least Privilege (Draft Example)

> English version: [README.md](./README.md)
>
> **ステータス: DRAFT。** IAM 最小権限ドリル系の 「商用 example」 として公開。 まだ本番イベント投入レベルではない (= 採点が 'スコープダウン完了で flag 生成' ではなく事前埋め込み)。 追跡 Issue: TenkaCloud #1346。

## ストーリー

天下クラウド株式会社、 入社 4 日目。 加藤さんが書き残した IAM Role `legacy-batch` が監査の Access Analyzer で 'over-privileged' フラグを受けた。

佐々木 CTO: 「夜間バッチ用のはず、 たぶん。 でも `*:*` は今どきヤバいので、 必要権限だけに絞ってくれ」。

あなたのミッション: Role が本当に必要としている権限を特定し、 加藤さんが書き残した監査メモ (= 同梱の SSM Parameter) からフラグを抜いて Portal に提出する。

## 何がデプロイされるか

- `AWS::IAM::Role` 名前 `{NamePrefix}-legacy-batch`
  - AssumeRole 元 = `ec2.amazonaws.com` (バッチ用想定)。
  - Inline policy `WildcardWildcardOnEverything` に `Action: "*" / Resource: "*"`。
  - 本来必要な権限は `s3:GetObject` を 1 バケットのみ、 という想定。
  - 外部 trust が無いので、 audit 可視性のみで実 blast radius はゼロ。
- `AWS::SSM::Parameter` 名前 `/{NamePrefix}/audit-flag` (提出 flag)。
- `ParticipantViewerRole` に `iam:Get*` + `iam:Put*` (自 role のみ)、 Console list view 用の `iam:ListRoles`、 そして `ssm:GetParameter` (自 param のみ)。

## 解き方

1. IAM Console を開き、 ロール `{NamePrefix}-legacy-batch` に移動。 Link は Output の `RoleConsoleUrl` から。
2. **Permissions** タブで inline policy `WildcardWildcardOnEverything` を確認 — 特に `Action: "*"` + `Resource: "*"` の Statement。
3. (任意 / 採点対象外) Remediation 手順を練習:
   - Inline policy を削除。
   - 最小権限版 (= バッチが実際に読む 1 バケットへの `s3:GetObject` のみ) を付け直す。
4. SSM Parameter `/{NamePrefix}/audit-flag` の値を取得 (Console SSM > Parameter Store もしくは `aws ssm get-parameter --name /{NamePrefix}/audit-flag --query Parameter.Value --output text`)。
5. Portal の提出欄に貼り付けて submit。 一致で **+200 pt**。

## 採点

- Kind: `flag`
- 報酬: 一致で 200 pt
- 不正解ペナルティ: 1 提出あたり 5 pt 減

## 学習目的

- AWS Console から IAM Role の構造 (AssumeRolePolicy / Inline policy / AttachedPolicies) を読み解く。
- 過剰権限 (`*:*`) を発見し、 想定 workload に対する最小権限まで削る思考プロセスを練習する。
- 監査 1 day 業務として SSM Parameter を 'audit-complete' マーカーに使う運用を観察する。

## コスト

- IAM Role: 無料。
- SSM Standard tier: 無料。
- 1 ドリルあたりは AWS Free Tier 範囲。

## 既知の限界 (DRAFT な理由)

- Remediation 自体は採点されていない。 flag は `t=0` 時点で存在している。 本番版では Access Analyzer の findings を Lambda が読み、 過剰権限 Statement が消えたタイミングで flag を生成する scoring に切り替える計画。
- 実 AWS アカウントでの teardown 確認がまだ未実施。
