# ans-privatelink

**ANS-C01 · flag · difficulty 4 · $0**

## Story

CTO Sasaki-san reviews a B2B SaaS architecture where a provider VPC must expose an internal API to customer (consumer) VPCs. Kato-san's draft says "no peering, no internet" but left the technology blank.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) — full scenario text
- 1 IAM Role (`ParticipantViewerRole`)

No Interface VPC endpoints (billable per-hour) or NLB. Cost: **$0**.

## Solution

**Flag:** `TC{privatelink}`

AWS PrivateLink allows a provider to expose a service (backed by an NLB) as a VPC endpoint service. Consumers create interface endpoints in their VPC, which appear as private ENIs. Traffic flows through AWS's internal network — never the public internet. CIDR overlap between VPCs is allowed (unlike VPC peering).

Decoys:
- **VPC peering** — bidirectional, symmetric routing; CIDR overlap not permitted
- **Transit Gateway** — hub-and-spoke transitive routing, not a service-exposure model

## Scoring

- Correct: **+200 pt**
- Wrong: **−15 pt** per attempt

## Learning goals

1. Understand the PrivateLink endpoint-service model (NLB + interface endpoint)
2. Distinguish PrivateLink from VPC peering (unidirectional, CIDR-overlap-safe)
3. Select PrivateLink for private cross-VPC service exposure in ANS-C01
