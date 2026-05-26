# Public S3 Remediation (Draft Example)

> 日本語版: [README.ja.md](./README.ja.md)
>
> **Status: DRAFT.** Ships as a commercially credible *example* of the S3-misconfig drill family. Not yet hardened for live events (= scoring still uses a pre-baked SSM flag rather than "remediation completion generates the flag"). Tracking issue: TenkaCloud #1346.

## Story

Day three at TenkaCloud Inc. A security scan flagged Kato-san's `kato-onboarding` bucket as "possible public read."

CTO Sasaki-san: *"I think no one is using it, probably. But leaving it public will tank our next audit -- close it today."*

Your mission: inspect the bucket's Public Access Block / Bucket Policy, extract the flag from Kato-san's audit note (= a co-deployed SSM Parameter), and submit it in the Portal.

## What gets deployed

- `AWS::S3::Bucket` named `{NamePrefix}-kato-onboarding`
  - Public Access Block intentionally OFF.
  - Bucket Policy contains a `Principal: "*"` `s3:GetObject` Statement.
  - No objects uploaded by the template (no real data leak risk).
- `AWS::SSM::Parameter` named `/{NamePrefix}/audit-flag` (the submission flag).
- `ParticipantViewerRole` with `s3:Get*` + `s3:Put*` (own bucket only), `s3:ListAllMyBuckets` for the Console list view, and `ssm:GetParameter` (own params only).

## How to play / solve

1. Open the S3 Console and navigate to bucket `{NamePrefix}-kato-onboarding`. The link is in the `BucketConsoleUrl` Output.
2. On the **Permissions** tab, observe:
   - **Block public access**: all four options OFF (this is the misconfig).
   - **Bucket policy**: a Statement with `Principal: "*"` allowing `s3:GetObject`.
3. (Optional, not scored) Practice the remediation flow:
   - Flip Block public access ON via the Console.
   - Delete the Bucket Policy Statement (or the whole policy).
4. Read SSM Parameter `/{NamePrefix}/audit-flag` (Console SSM > Parameter Store, or `aws ssm get-parameter --name /{NamePrefix}/audit-flag --query Parameter.Value --output text`).
5. Paste the value into the Portal submission field. Match earns **+200 pt**.

## Scoring

- Kind: `flag`
- Reward: 200 pt on match
- Wrong-answer penalty: 5 pt per attempt

## Learning goals

- Read the relationship between Public Access Block / Bucket Policy / Ownership from the AWS Console.
- Practice the minimal CCoE one-day flow: detect leftover public exposure, close it with auditable steps.
- Observe the pattern of using an SSM Parameter as an "audit-complete" marker.

## Cost

- S3 Standard pennies/month (no public objects uploaded by this stack).
- SSM Standard tier: free.
- Within AWS Free Tier for one drill.

## Known limitations (why this is DRAFT)

- The remediation itself is not scored. The flag exists from `t=0`. The production form will gate flag generation on the player actually closing the public access (e.g. a Lambda triggered by S3 PAB / policy events, then writes the flag).
- No teardown verification yet in a real account.
