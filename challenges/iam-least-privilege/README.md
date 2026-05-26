# IAM Least Privilege (Draft Example)

> 日本語版: [README.ja.md](./README.ja.md)
>
> **Status: DRAFT.** Ships as a commercially credible *example* of the IAM-least-privilege drill family. Not yet hardened for live events (= scoring still uses a pre-baked SSM flag rather than "scope-down completion generates the flag"). Tracking issue: TenkaCloud #1346.

## Story

Day four at TenkaCloud Inc. Access Analyzer flagged Kato-san's `legacy-batch` IAM Role as "over-privileged."

CTO Sasaki-san: *"I think it was for the nightly batch, probably. But `*:*` is reckless these days -- scope it down to what it actually needs."*

Your mission: identify what the Role really needs, extract the flag from Kato-san's audit note (= a co-deployed SSM Parameter), and submit it in the Portal.

## What gets deployed

- `AWS::IAM::Role` named `{NamePrefix}-legacy-batch`
  - AssumeRole principal = `ec2.amazonaws.com` (batch use case).
  - Inline policy `WildcardWildcardOnEverything` with `Action: "*" / Resource: "*"`.
  - Intended minimum: `s3:GetObject` on one bucket.
  - No external trust, so the misconfig has audit-finding visibility but no live blast radius.
- `AWS::SSM::Parameter` named `/{NamePrefix}/audit-flag` (the submission flag).
- `ParticipantViewerRole` with `iam:Get*` + `iam:Put*` (own role only), `iam:ListRoles` for the Console list view, and `ssm:GetParameter` (own params only).

## How to play / solve

1. Open the IAM Console and navigate to role `{NamePrefix}-legacy-batch`. The link is in the `RoleConsoleUrl` Output.
2. On the **Permissions** tab, observe the inline policy `WildcardWildcardOnEverything` -- specifically the `Action: "*"` + `Resource: "*"` Statement.
3. (Optional, not scored) Practice the remediation flow:
   - Delete the inline policy.
   - Attach a least-privilege replacement (e.g. `s3:GetObject` on the one bucket the batch actually reads).
4. Read SSM Parameter `/{NamePrefix}/audit-flag` (Console SSM > Parameter Store, or `aws ssm get-parameter --name /{NamePrefix}/audit-flag --query Parameter.Value --output text`).
5. Paste the value into the Portal submission field. Match earns **+200 pt**.

## Scoring

- Kind: `flag`
- Reward: 200 pt on match
- Wrong-answer penalty: 5 pt per attempt

## Learning goals

- Read the IAM Role structure (AssumeRolePolicy / Inline policy / AttachedPolicies) from the AWS Console.
- Spot an over-privileged `*:*` Statement and reason about the minimum a real workload needs.
- Observe the audit one-day pattern of using an SSM Parameter as an "audit-complete" marker.

## Cost

- IAM Role: free.
- SSM Standard tier: free.
- Within AWS Free Tier for one drill.

## Known limitations (why this is DRAFT)

- The remediation itself is not scored. The flag exists from `t=0`. The production form will watch Access Analyzer findings via Lambda and generate the flag only when the over-privileged Statement is gone.
- No teardown verification yet in a real account.
