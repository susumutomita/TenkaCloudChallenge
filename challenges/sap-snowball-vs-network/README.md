# sap-snowball-vs-network

**SAP-C02 · flag · difficulty 4 · $0**

## Story

TenkaCloud must close its data center. Kato-san's plan calls for moving 500 TB
to AWS within days, but the only link is 1 Gbps. CTO Sasaki-san needs a solution.
The player calculates that the network transfer would take ~47 days and identifies
AWS Snowball as the correct offline transfer service.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `/{NamePrefix}/briefing` | SSM String Parameter (scenario + calculation) | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |

**$0**.

## Solution (operator notes)

Calculation: 500 TB = 500 × 1024 × 8 Gbit = 4,096,000 Gbit.
At 1 Gbps: 4,096,000 s ≈ 47 days. Way over deadline.

**AWS Snowball Edge**: 80 TB capacity per device, multiple devices in parallel,
returns to AWS in days → correct answer.

**Exact flag:** `TC{snowball}`

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt
- Hint 1 (−20 pt): walks through the math and points to "offline physical device"
- Hint 2 (−40 pt): identifies Snowball Edge and gives submission format

## Learning goals

1. Calculate 500 TB / 1 Gbps ≈ 47 days and conclude network is infeasible
2. Know the Snow family tiers (Snowcone / Snowball Edge / Snowmobile)
3. Practice data-volume / bandwidth calculations at SAP exam speed
