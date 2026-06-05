# sap-hybrid-dns-resolver

**SAP-C02 · flag · difficulty 4 · $0**

## Story

TenkaCloud is building a hybrid environment over Direct Connect.
Kato-san's migration plan left the DNS design blank.
CTO Sasaki-san needs both directions covered:
on-prem DNS resolving VPC private names, and VPC EC2s resolving on-prem names.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `/{NamePrefix}/briefing` | SSM String Parameter (scenario) | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |

Route 53 Hosted Zones (~$0.50/mo) are NOT deployed. **$0**.

## Solution (operator notes)

The answer is **Route 53 Resolver**, which provides:
- **Inbound endpoints**: ENIs in the VPC that accept DNS queries from on-prem DNS servers
- **Outbound resolver rules**: forward specific domains from the VPC resolver to on-prem DNS servers

**Exact flag:** `TC{route53-resolver}`

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt
- Hint 1 (−20 pt): nudges player toward a "Resolver" component distinct from Hosted Zones
- Hint 2 (−40 pt): reveals route53-resolver and inbound/outbound endpoint concepts

## Learning goals

1. Understand when Route 53 Resolver inbound/outbound endpoints are required
2. Grasp bidirectional DNS resolution between on-premises and VPC
3. Distinguish Route 53 Hosted Zones from Route 53 Resolver
