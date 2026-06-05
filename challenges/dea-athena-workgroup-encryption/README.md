# dea-athena-workgroup-encryption — DEA · flag · difficulty 3 · $0

## Story

Kato-san set up an Athena WorkGroup and configured an encryption option for query results, but documented nothing. CTO Sasaki-san needs the answer before a compliance audit. The player must read `ResultConfiguration.EncryptionConfiguration.EncryptionOption` from the WorkGroup.

## What gets deployed

- 1 S3 bucket (`{NamePrefix}-athena-results`) — empty, no objects uploaded
- 1 Athena WorkGroup (`{NamePrefix}-wg`) with SSE_S3 result encryption
- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the task description

No Athena queries executed. $0 cost.

## Solution

**Flag:** `TC{sse-s3}`

**CLI one-liner to verify:**

```bash
aws athena get-work-group --work-group <NamePrefix>-wg \
  --query 'WorkGroup.Configuration.ResultConfiguration.EncryptionConfiguration.EncryptionOption' \
  --output text
# Returns: SSE_S3  → TC{sse-s3}
```

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (nudge toward EncryptionConfiguration)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Read EncryptionOption from Athena WorkGroup ResultConfiguration
- Distinguish SSE_S3, SSE_KMS, and CSE_KMS encryption options
- Navigate the `aws athena get-work-group` output structure
