# Hello World (Sample)

> 日本語版: [README.ja.md](./README.ja.md)

The minimal sample for Challenge / flag submission. Read a value from SSM Parameter Store, paste it into the Participant Portal, and earn +100 pt. Use it as a sanity check for the deploy → flag-submit → score path end-to-end.

| Field          | Value                                                       |
| -------------- | ----------------------------------------------------------- |
| Category       | Challenge (self-paced)                                      |
| Difficulty     | 1 / 5 (beginner)                                            |
| Estimated time | 1 min                                                       |
| status         | `ready`                                                     |
| Scoring        | `flag` (`points`: 100, `wrongAnswerPenalty`: 5)             |

## Story

Welcome to TenkaCloud Inc. Today is your first day. Your predecessor abruptly resigned last week and left a single mysterious SSM Parameter in production.

The CTO says: "I think it was for smoke testing... probably." Details are unknown. Searching Slack DMs turns up nothing. The Notion handover note just says: "look at SSM `hello`."

Your mission: open AWS Console or CLI, read the value at `/{NamePrefix}/hello`, and paste it into the Participant Portal flag-submission box. Correct match → +100 pt.

## What gets deployed

- `AWS::SSM::Parameter` (`/{NamePrefix}/hello`, Standard tier, per-deploy value `TC{…}`)
- `ParticipantViewerRole` — IAM Role competitors AssumeRole into for read-only AWS Console access
  - `ssm:GetParameter` / `GetParameters` / `GetParametersByPath` scoped only to their own prefix
  - `ssm:DescribeParameters` allowed only inside the team's dedicated AWS account so the Console detail view works

No EC2 / VPC / public endpoint is created. SSM Standard tier is free.

## How to solve

Open the `ParameterConsoleUrl` output from the Participant Portal. It lands directly on this stack's SSM Parameter detail page in the AWS Console. The `TC{…}` string in the Value field is the flag. Or use the CLI:

```bash
aws ssm get-parameter --name /{NamePrefix}/hello --query Parameter.Value --output text
# → "TC{per-deploy-random-value}"
```

The value cannot be derived from `NamePrefix`. Read the actual Parameter value and submit everything from `TC{` through `}`.

Paste the value into the Participant Portal flag submission box and submit. Correct → +100 pt. Wrong → -5 pt.

## Hints (cost score if used)

| hint   | Content                                                                                                            | Penalty |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ------- |
| hint-1 | Click the `ParameterConsoleUrl` Output for a deep link to the parameter detail page, or run `aws ssm get-parameter --name /{NamePrefix}/hello`. | -20     |
| hint-2 | The value follows the form `TC{…}`. Read the actual Parameter value and paste the complete string. | -30     |

## Scoring

| State                         | Score |
| ----------------------------- | ----- |
| Correct (= value matches)     | +100  |
| Wrong                         | -5    |

## Learning goals

- Experience reading a value from SSM Parameter Store via AWS Console / CLI.
- Verify that TenkaCloud's deploy → flag-submit → score pipeline works end-to-end.

## Related files

- [`metadata.json`](./metadata.json) — problem metadata
- [`template.yaml`](./template.yaml) — one-page CFn template (SSM Parameter + a scoped IAM Role only)
