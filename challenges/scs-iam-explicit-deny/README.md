# scs-iam-explicit-deny

**Certification:** Security Specialty (SCS-C02) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Week three at TenkaCloud Inc. CTO Sasaki-san is worried about a mess of IAM policies Kato-san left behind. One role has a broad `s3:*` Allow policy AND an explicit `s3:DeleteObject` Deny policy. Can the role execute DeleteObject or not?

## What gets deployed

One IAM role (`${NamePrefix}-target-role`) with two inline policies:

| Policy | Effect | Action | Resource |
| --- | --- | --- | --- |
| `AllowS3Everything` | Allow | `s3:*` | `*` |
| `DenyDeleteObject` | **Deny** | `s3:DeleteObject` | `*` |

Plus an SSM Parameter `/${NamePrefix}/briefing` with the task description.

All resources are free: no S3 bucket, no EC2, no KMS.

## Solution (operator notes)

IAM evaluation logic: **explicit Deny always overrides Allow**. Even though `AllowS3Everything` grants `s3:*`, the explicit `Deny` on `s3:DeleteObject` in `DenyDeleteObject` wins. The operation is denied.

```bash
aws iam list-role-policies --role-name <NamePrefix>-target-role
aws iam get-role-policy --role-name <NamePrefix>-target-role --policy-name DenyDeleteObject
```

**Flag:** `TC{denied}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Confirm that explicit Deny always wins over Allow in IAM policy evaluation.
- Understand how multiple inline policies on a single role are combined.
- Read a role's inline policies via `aws iam list-role-policies` / `get-role-policy`.
