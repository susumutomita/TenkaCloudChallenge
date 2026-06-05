# sap-cross-account-externalid

**SAP-C02 · flag · difficulty 4 · $0**

## Story

Kato-san created a cross-account IAM role that allows account `111122223333`
to assume it. CTO Sasaki-san is worried: does the trust policy actually contain
the Confused Deputy protection? The player must read the trust policy and
name the condition key.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `{NamePrefix}-cross-account-role` | IAM Role (REAL trust policy with sts:ExternalId) | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |
| `/{NamePrefix}/briefing` | SSM String Parameter | Free |

No EC2, no NAT, no Route 53 hosted zones. **$0**.

## Solution (operator notes)

The cross-account role's trust policy contains:

```json
{
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::111122223333:root" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {
        "sts:ExternalId": "tenkacloud-audit-external-id-2024"
      }
    }
  }]
}
```

The condition key is `sts:ExternalId`.

**Exact flag:** `TC{sts:ExternalId}`

CLI verification:

```bash
aws iam get-role \
  --role-name "{NamePrefix}-cross-account-role" \
  --query "Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals"
```

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt (anti-brute-force)
- Hint 1 (−20 pt): directs player to use iam:GetRole and look at Condition.StringEquals
- Hint 2 (−40 pt): reveals that the key is sts:ExternalId and gives the submission format

## Learning goals

1. Understand the Confused Deputy problem and why sts:ExternalId prevents it
2. Read a real IAM trust policy via iam:GetRole and identify the condition key
3. See a cross-account AssumeRole trust policy with ExternalId protection
