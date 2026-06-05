# soa-ssm-securestring

**SOA-C02 · flag · difficulty 2 · $0 free-tier**

## Story

Kato-san left two SSM Parameters under the same prefix. One is plaintext (String), one is KMS-encrypted (SecureString). A security auditor asks: which Type encrypts the value at rest? The player reads the parameter Type fields and identifies the answer.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::SSM::Parameter` | `/{NamePrefix}/config-plain` — Type: String (plaintext) |
| `AWS::SSM::Parameter` | `/{NamePrefix}/config-secret` — Type: SecureString (KMS default key) |
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — task description |
| `AWS::IAM::Role` | `ParticipantViewerRole` with SSM read on `/{NamePrefix}/*`, CloudShell |

No EC2, no custom KMS key. Cost: **$0**.

## Solution

The flag is **`TC{securestring}`**.

CLI verification:
```bash
aws ssm describe-parameters \
  --filters "Key=Name,Option=BeginsWith,Values=/<NamePrefix>" \
  --query 'Parameters[*].[Name,Type]'
# → [["/<NamePrefix>/config-plain","String"],["/<NamePrefix>/config-secret","SecureString"], ...]
```

Console: Systems Manager > Parameter Store > click each parameter > check the "Type" field.

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- Confirm hands-on the String vs SecureString difference in SSM Parameter Store
- Understand that SecureString encrypts the value with KMS (default key or custom CMK)
- Know that `aws ssm get-parameter --with-decryption` is required to retrieve a SecureString value
