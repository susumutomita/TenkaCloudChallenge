# scs-permissions-boundary

**Certification:** Security Specialty (SCS-C02) · **Kind:** `flag` · **Difficulty:** 4 · **Cost:** $0

## Story

Three months at TenkaCloud Inc. CTO Sasaki-san wants to delegate IAM role creation to the dev team while preventing privilege escalation. There's a special IAM feature set on a role Kato-san was researching. Which feature is it?

## What gets deployed

One IAM role (`${NamePrefix}-bounded-role`) with:

| Configuration | Value |
| --- | --- |
| PermissionsBoundary | `arn:aws:iam::aws:policy/ReadOnlyAccess` |
| Inline policy | `AllowS3Full` — allows `s3:*` on `*` |

The effective permissions are the **intersection** of the boundary and the inline policy — read-only S3 only.

Plus an SSM Parameter `/${NamePrefix}/briefing` with the task description.

All resources are free: no EC2, no S3 bucket.

## Solution (operator notes)

```bash
aws iam get-role \
  --role-name <NamePrefix>-bounded-role \
  --query 'Role.PermissionsBoundary'
```

The `PermissionsBoundary` field in the `get-role` output confirms the IAM feature. The feature name (in kebab-case) is `permissions-boundary`.

**Flag:** `TC{permissions-boundary}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand how IAM Permissions Boundary caps the maximum permissions an identity can exercise.
- Explain the AND-evaluation between a Permissions Boundary and ordinary attached/inline policies.
- Verify a role's PermissionsBoundary configuration using `aws iam get-role`.
