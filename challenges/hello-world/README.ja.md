# Hello World (Sample)

> English: [README.md](./README.md)

Challenge / flag-submission の最小 sample 問題。SSM Parameter Store の値を読み取り、Participant Portal に貼り付けると +100 pt。deploy → flag 提出 → 加点経路を end-to-end で確認する用途。

| 項目         | 値                                                            |
| ------------ | ------------------------------------------------------------- |
| カテゴリ     | Challenge (個別演習)                                          |
| 難易度       | 1 / 5 (入門)                                                  |
| 想定時間     | 1 分                                                          |
| status       | `ready`                                                       |
| 採点方式     | `flag` (`points`: 100, `wrongAnswerPenalty`: 5)               |

## ストーリー

天下クラウド株式会社へようこそ。 あなたは今日が入社初日。 前任の SRE が先週突然退職し、 production には謎の SSM Parameter が 1 つ残されている。

CTO 曰く、「動作確認のために残したやつ、 たぶん」。 詳細は不明。 Slack の DM 履歴を遡っても何も出てこない。 Notion の引継ぎ書には「SSM の hello 見といて」とだけ書いてある。

あなたのミッション: AWS Console または CLI で SSM Parameter Store にアクセスし、 `/{NamePrefix}/hello` の値を読んで Participant Portal の入力欄に貼り付ける。 一致すれば +100 pt。

## デプロイされるもの

- `AWS::SSM::Parameter` (`/{NamePrefix}/hello`、Standard tier、値は deploy ごとの `TC{…}`)
- `ParticipantViewerRole` — 競技者が AWS Console で読み取り専用 AssumeRole するための IAM Role
  - `ssm:GetParameter` / `GetParameters` / `GetParametersByPath` を自分の prefix だけに scope
  - Parameter 詳細画面に必要な `ssm:DescribeParameters` はチーム専用 AWS account 内でのみ許可

EC2 / VPC / 公開エンドポイントは作らない。 SSM Standard tier は料金ゼロ。

## 解き方

Participant Portal の `ParameterConsoleUrl` Output は deep link になっており、クリックすると AWS Console の SSM Parameter 詳細ページに直接着地する。Value 欄の `TC{…}` がそのまま flag。もしくは CLI:

```bash
aws ssm get-parameter --name /{NamePrefix}/hello --query Parameter.Value --output text
# → "TC{デプロイごとのランダム値}"
```

`TC{…}` の中身は `NamePrefix` から推測できない。Parameter の実値を読み、`TC{` から `}` までをそのまま提出する。

値を Participant Portal の Flag 提出欄に貼り付けて submit → 一致すれば +100 pt。 間違えると -5 pt のペナルティ。

## ヒント (利用すると減点)

| hint   | 内容                                                                                  | 減点  |
| ------ | ------------------------------------------------------------------------------------- | ----- |
| hint-1 | Outputs の `ParameterConsoleUrl` をクリックすると SSM Parameter 詳細ページに直接飛べます。CLI 派は `aws ssm get-parameter --name /{NamePrefix}/hello` | -20   |
| hint-2 | 値は `TC{…}` 形式です。Parameter の実値を読み、最初から最後までそのまま貼り付けます。 | -30   |

## 採点

| 状態                            | 得点  |
| ------------------------------- | ----- |
| 正答 (= 値が一致)               | +100  |
| 誤答                            | -5    |

## 学習目的

- AWS Console / CLI で SSM Parameter Store の値を読み出す経路を体験する
- TenkaCloud の deploy → flag 提出 → 加点経路が end-to-end で動くことを確認する

## 関連ファイル

- [`metadata.json`](./metadata.json) — 問題メタデータ
- [`template.yaml`](./template.yaml) — CFn ペライチ (SSM Parameter + 限定 IAM Role のみ)
