# ans-route53-failover

**ANS-C01 · flag · difficulty 4 · $0**

## Story

CTO Sasaki-san discovers that Kato-san's DR design omits the DNS failover policy. The requirement is active-passive: if the primary region's health check fails, Route 53 must automatically redirect DNS to the standby region.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) — full scenario text
- 1 IAM Role (`ParticipantViewerRole`)

No Route 53 hosted zone (~$0.50/month) is created. Cost: **$0**.

## Solution

**Flag:** `TC{failover}`

Route 53 Failover routing policy designates one record as PRIMARY and one as SECONDARY. When the primary health check fails, Route 53 automatically serves the secondary record. This is the standard active-passive DNS DR pattern.

Decoys:
- **Weighted** — splits traffic by a numeric weight ratio, not health-based failover
- **Latency** — routes to the region with lowest measured latency, not a failover pattern
- **Geolocation** — routes based on user's geographic location

## Scoring

- Correct: **+200 pt**
- Wrong: **−15 pt** per attempt

## Learning goals

1. Know that Route 53 Failover routing implements active-passive DNS DR
2. Distinguish Failover from Weighted / Latency / Geolocation routing
3. Explain how health-check-driven DNS switchover works
