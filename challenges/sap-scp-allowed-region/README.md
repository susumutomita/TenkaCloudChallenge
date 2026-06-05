# sap-scp-allowed-region

**SAP-C02 · flag · difficulty 4 · $0**

## Story

Kato-san wrote an SCP before quitting. Nobody knows which region it actually permits.
CTO Sasaki-san escalates the night before an external audit. The SCP JSON is stored
in SSM; the player must parse the `Deny + StringNotEquals + aws:RequestedRegion`
condition to identify the one allowed region.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `/{NamePrefix}/scp-policy` | SSM String Parameter (SCP JSON) | Free |
| `/{NamePrefix}/briefing` | SSM String Parameter | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |

No EC2, no NAT, no Route 53 hosted zones. **$0**.

## Solution (operator notes)

The SCP JSON in the SSM parameter contains:

```json
{
  "Statement": [{
    "Effect": "Deny",
    "Action": "*",
    "Resource": "*",
    "Condition": {
      "StringNotEquals": {
        "aws:RequestedRegion": ["ap-northeast-1"]
      }
    }
  }]
}
```

Logic: Deny when `aws:RequestedRegion` is NOT in `["ap-northeast-1"]`.
Therefore `ap-northeast-1` is the **only allowed region**.

**Exact flag:** `TC{ap-northeast-1}`

CLI verification:

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/scp-policy" \
  --query "Parameter.Value" \
  --output text | python3 -c "import json,sys; p=json.load(sys.stdin); print(p['Statement'][0]['Condition']['StringNotEquals']['aws:RequestedRegion'])"
```

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt (anti-brute-force)
- Hint 1 (−20 pt): directs player to read the SSM parameter and find StringNotEquals
- Hint 2 (−40 pt): explains that the list inside StringNotEquals IS the allowlist

## Learning goals

1. Parse SCP Deny + StringNotEquals + aws:RequestedRegion to find the allowed region
2. Understand the double-negative: "regions not denied = allowed"
3. See a real Organizations SCP JSON structure
