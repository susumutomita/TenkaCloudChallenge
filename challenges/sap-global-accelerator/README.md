# sap-global-accelerator

**SAP-C02 · flag · difficulty 4 · $0**

## Story

Kato-san's global gaming service needs static Anycast IPs for TCP/UDP traffic
with sub-second regional failover. CTO Sasaki-san knows CloudFront can't handle
UDP. The player must identify AWS Global Accelerator.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `/{NamePrefix}/briefing` | SSM String Parameter (scenario) | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |

Global Accelerator (~$18/month) is NOT deployed. **$0**.

## Solution (operator notes)

**AWS Global Accelerator** provides:
- 2 static Anycast IPv4 addresses (never change)
- Layer 4 TCP + UDP support
- Routes traffic over AWS global private backbone
- Regional endpoint failover in seconds

CloudFront is the main decoy — it uses edge locations but only handles HTTP/HTTPS
(Layer 7) and provides no static IPs.

**Exact flag:** `TC{global-accelerator}`

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt
- Hint 1 (−20 pt): points to the need for UDP support and static IPs, ruling out CloudFront
- Hint 2 (−40 pt): reveals "global-accelerator" and explains Layer 4 vs Layer 7 distinction

## Learning goals

1. Know Global Accelerator: static Anycast IPs + TCP/UDP + fast failover
2. Distinguish CloudFront (Layer 7 HTTP/HTTPS cache) from Global Accelerator (Layer 4)
3. Choose Global Accelerator for gaming/IoT UDP workloads
