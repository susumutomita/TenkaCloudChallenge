# sap-control-tower-guardrails

**SAP-C02 · flag · difficulty 4 · $0**

## Story

TenkaCloud plans to create 100+ accounts. CTO Sasaki-san wants a landing zone
with automated security baselines, preventive guardrails (SCP), detective
guardrails (Config rules), and an Account Factory — all in one service.
The player identifies AWS Control Tower.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `/{NamePrefix}/briefing` | SSM String Parameter (scenario) | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |

Control Tower incurs service costs and is NOT deployed. **$0**.

## Solution (operator notes)

**AWS Control Tower** provides:
- **Landing zone**: automated account provisioning with CloudTrail/GuardDuty/Config baseline
- **Preventive guardrails**: SCP-based (block non-compliant actions)
- **Detective guardrails**: Config rule-based (detect violations)
- **Account Factory**: standardized account vending via Service Catalog

Decoys: Organizations (no landing zone/Account Factory), Config (detective only), Service Catalog (no guardrail framework).

**Exact flag:** `TC{control-tower}`

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt
- Hint 1 (−20 pt): distinguishes Organizations from Control Tower's governance layer
- Hint 2 (−40 pt): reveals "control-tower" and lists the four pillars

## Learning goals

1. Control Tower integrates Organizations + Config + SCP + Account Factory
2. Distinguish Organizations (raw API) from Control Tower (governance layer)
3. Know preventive (SCP) vs detective (Config) guardrail types
