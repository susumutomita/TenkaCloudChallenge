# clf-iam-user-vs-role

**Certification:** Cloud Practitioner (CLF-C02) · **Kind:** `flag` · **Difficulty:** 1 · **Cost:** $0

## Story

Two weeks in at TenkaCloud Inc. A security review reveals Kato-san embedded an IAM user's access key on an EC2 instance to call S3. CTO Sasaki-san is furious. The player must inspect both an IAM user and an IAM role (with an `ec2.amazonaws.com` trust policy), then identify which identity type EC2 should use.

## What gets deployed

- **IAM User** `{NamePrefix}-svc-user`: the anti-pattern demonstration (long-lived credentials)
- **IAM Role** `{NamePrefix}-ec2-s3-role`: the correct approach — trust policy allows `ec2.amazonaws.com`
- **ParticipantViewerRole**: grants `iam:GetRole`, `iam:GetUser`, `iam:ListAttachedRolePolicies` scoped to `${NamePrefix}*`, plus `iam:ListRoles`/`iam:ListUsers` on `*`

No EC2, S3, NAT Gateway, or EIP — free tier only.

## Solution (operator notes)

Inspect the role's trust policy:

```bash
aws iam get-role --role-name {NamePrefix}-ec2-s3-role \
  --query Role.AssumeRolePolicyDocument
```

The `Principal.Service` is `ec2.amazonaws.com` — EC2 can assume this role via an instance profile and receive automatically-rotated temporary credentials. An IAM user's long-lived access key has none of these protections.

```bash
aws iam get-user --user-name {NamePrefix}-svc-user
```

**Flag:** `TC{iam-role}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+150 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand that EC2 instances should use IAM Roles via instance profiles to call AWS services.
- Explain why embedding long-lived access keys on instances creates a security risk.
- Read an IAM role trust policy and confirm that `ec2.amazonaws.com` as the principal enables EC2 to assume the role.
