# sap-aurora-global-database

**SAP-C02 · flag · difficulty 4 · $0**

## Story

Kato-san's Aurora MySQL DR design needs sub-second RPO and under-1-minute RTO
to failover to another region. CTO Sasaki-san knows RDS Multi-AZ only covers
the same region. The player identifies Aurora Global Database.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `/{NamePrefix}/briefing` | SSM String Parameter (scenario) | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |

Aurora clusters are expensive and NOT deployed. **$0**.

## Solution (operator notes)

**Aurora Global Database** uses dedicated storage-level replication infrastructure:
- RPO: < 1 second
- RTO: < 1 minute for managed failover
- Supports 1 primary + up to 5 secondary regions

Decoys: RDS Multi-AZ (same-region only), Aurora Read Replica (async, minutes for promotion).

**Exact flag:** `TC{aurora-global-database}`

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt
- Hint 1 (−20 pt): distinguishes RDS Multi-AZ from cross-region, points to Aurora "Global" feature
- Hint 2 (−40 pt): reveals "aurora-global-database" and sub-second RPO / 1-minute RTO figures

## Learning goals

1. Aurora Global Database: sub-second RPO + under-1-minute RTO cross-region
2. RDS Multi-AZ vs Aurora Global Database (same-region vs cross-region)
3. Aurora Read Replica vs Aurora Global Database (async vs storage-level)
