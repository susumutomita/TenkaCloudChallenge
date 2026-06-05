# sap-migration-7rs-rehost

**SAP-C02 · flag · difficulty 4 · $0**

## Story

Kato-san's migration plan left the strategy name blank.
CTO Sasaki-san wants the Java app on EC2 with zero code changes, ASAP.
The player reads the scenario + 7 Rs definitions in SSM and identifies Rehost.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `/{NamePrefix}/briefing` | SSM String Parameter (scenario + 7 Rs) | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |

**$0**.

## Solution (operator notes)

The requirement is: no code changes, move OS/middleware/binary as-is to EC2.
This is the textbook definition of **Rehost** (Lift-and-Shift).

**Exact flag:** `TC{rehost}`

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt
- Hint 1 (−20 pt): points to "Lift-and-Shift" alias, distinguishes from Replatform
- Hint 2 (−40 pt): reveals "rehost" and submission format

## Learning goals

1. Distinguish all 7 Rs migration strategies
2. Map "no code change, lift to EC2" → Rehost immediately
3. Practice SAP-level migration scenario analysis
