# saa-s3-default-encryption-algo — SAA · flag · difficulty 2 · $0

## Story

Kato-san configured an S3 bucket with default encryption. CTO Sasaki-san must
fill in the SSEAlgorithm value on a compliance audit form. The player reads the
bucket's encryption configuration and reports the value.

## What gets deployed

- S3 bucket `{NamePrefix}-data` — SSE-S3 (AES256) default encryption, no objects
- SSM Parameter `/{NamePrefix}/briefing` — task with bucket name and CLI hint

Cost: **$0** (empty bucket + SSE-S3 has no KMS API cost).

## Solution (operator notes)

The bucket is configured with `SSEAlgorithm: AES256` (SSE-S3). The player runs
`aws s3api get-bucket-encryption` and reads the `SSEAlgorithm` field.

**Flag:** `TC{aes256}`

CLI verify:
```bash
aws s3api get-bucket-encryption --bucket "${NAME_PREFIX}-data" \
  --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
  --output text
# Expected output: AES256
```

## Scoring

- Correct: +200 pt (once per deploy)
- Wrong answer: -15 pt (anti-brute-force)

## Learning goals

- SSE-S3 (AES256) is the free, default S3 server-side encryption
- SSE-KMS uses KMS keys and incurs KMS API call costs
- `aws s3api get-bucket-encryption` output structure
