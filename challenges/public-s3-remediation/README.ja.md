# Public S3 Remediation (Draft Example)

> English version: [README.md](./README.md)
>
> **ステータス: DRAFT。** S3 誤設定ドリル系の 「商用 example」 として公開。 まだ本番イベント投入レベルではない (= 採点が 'remediation 完了で flag 生成' ではなく事前埋め込み)。 追跡 Issue: TenkaCloud #1346。

## ストーリー

天下クラウド株式会社、 入社 3 日目。 セキュリティチームのスキャンが、 加藤さんが残した `kato-onboarding` バケットに 「public read 疑い」 のフラグを立てた。

佐々木 CTO: 「中身は使ってないらしい、 たぶん。 ただ public のままだと監査で詰むので、 今日中に締めてくれ」。

あなたのミッション: バケットの Public Access Block / Bucket Policy を点検し、 加藤さんが書き残した監査メモ (= 同梱の SSM Parameter) からフラグを抜いて Portal に提出する。

## 何がデプロイされるか

- `AWS::S3::Bucket` 名前 `{NamePrefix}-kato-onboarding`
  - Public Access Block は意図的に OFF。
  - Bucket Policy に `Principal: "*"` で `s3:GetObject` を許す Statement あり。
  - テンプレートはオブジェクトを upload しない (= 実データの漏洩リスクなし)。
- `AWS::SSM::Parameter` 名前 `/{NamePrefix}/audit-flag` (提出 flag)。
- `ParticipantViewerRole` に `s3:Get*` + `s3:Put*` (自バケットのみ)、 Console list view 用の `s3:ListAllMyBuckets`、 そして `ssm:GetParameter` (自 param のみ)。

## 解き方

1. S3 Console を開き、 バケット `{NamePrefix}-kato-onboarding` に移動。 Link は Output の `BucketConsoleUrl` から。
2. **Permissions** タブで確認:
   - **Block public access**: 4 つすべて OFF (これが misconfig)。
   - **Bucket policy**: `Principal: "*"` で `s3:GetObject` を許す Statement あり。
3. (任意 / 採点対象外) Remediation 手順を練習:
   - Block public access を ON に切替。
   - Bucket Policy の Statement を削除 (または policy 全体を削除)。
4. SSM Parameter `/{NamePrefix}/audit-flag` の値を取得 (Console SSM > Parameter Store もしくは `aws ssm get-parameter --name /{NamePrefix}/audit-flag --query Parameter.Value --output text`)。
5. Portal の提出欄に貼り付けて submit。 一致で **+200 pt**。

## 採点

- Kind: `flag`
- 報酬: 一致で 200 pt
- 不正解ペナルティ: 1 提出あたり 5 pt 減

## 学習目的

- AWS Console から Public Access Block / Bucket Policy / Ownership の関係を読み解く。
- 公開設定が残った状態を検知し、 監査ログに残る形で締める CCoE 1 day 業務の最小手順を体験する。
- SSM Parameter Store を 「監査完了マーカー」 として使うパターンを観察する。

## コスト

- S3 Standard: 月数 cents 以内 (テンプレが公開オブジェクトを upload しないため)。
- SSM Standard tier: 無料。
- 1 ドリルあたりは AWS Free Tier 範囲。

## 既知の限界 (DRAFT な理由)

- Remediation 自体は採点されていない。 flag は `t=0` 時点で存在している。 本番版では player が public access を実際に閉じた時に Lambda が trigger され、 そこで flag を生成する scoring に切り替える計画。
- 実 AWS アカウントでの teardown 確認がまだ未実施。
