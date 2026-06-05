# scs-s3-deny-insecure-transport

**Certification:** Security Specialty (SCS-C02) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Week five at TenkaCloud Inc. CTO Sasaki-san asks for a security review of Kato-san's S3 bucket. The bucket policy has a Deny rule that blocks HTTP (non-TLS) access — but which condition key makes it work?

## What gets deployed

One S3 bucket (empty, PublicAccessBlock fully enabled) with a bucket policy:

| Statement | Effect | Condition |
| --- | --- | --- |
| `DenyInsecureTransport` | Deny `s3:*` | `aws:SecureTransport == false` |

Plus an SSM Parameter `/${NamePrefix}/briefing` with the task description.

All resources are free: no objects uploaded, no EC2, no KMS.

## Solution (operator notes)

The bucket policy Deny Statement uses `aws:SecureTransport` with value `"false"` under a `Bool` condition operator. Any request arriving over HTTP (where `SecureTransport` evaluates to false) is denied.

```bash
aws s3api get-bucket-policy \
  --bucket <NamePrefix>-tls-audit \
  --query Policy \
  --output text | python3 -m json.tool
```

**Flag:** `TC{aws:SecureTransport}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand how `aws:SecureTransport` enforces TLS on an S3 bucket.
- Read a bucket policy Deny Statement and its Condition block.
- Retrieve a bucket policy JSON using `aws s3api get-bucket-policy`.
