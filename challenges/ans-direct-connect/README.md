# ans-direct-connect

**ANS-C01 · flag · difficulty 4 · $0**

## Story

CTO Sasaki-san presents a financial-sector client requirement: 10 Gbps dedicated bandwidth, no internet traversal (regulatory mandate), and consistent low latency for real-time trading systems. Kato-san's design draft shows Site-to-Site VPN, which is wrong.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) — full scenario text
- 1 IAM Role (`ParticipantViewerRole`)

No Direct Connect connection (requires physical circuit, billable). Cost: **$0**.

## Solution

**Flag:** `TC{direct-connect}`

AWS Direct Connect provides a dedicated private physical connection between an on-premises data center and AWS via a Direct Connect location (colocation facility). It offers:
- Dedicated bandwidth (not shared, not internet-dependent)
- Consistent latency (no internet congestion effects)
- Private path (traffic never traverses the public internet)

Decoy: Site-to-Site VPN tunnels over the public internet with IPSec encryption — bandwidth is best-effort and latency fluctuates with internet conditions.

## Scoring

- Correct: **+200 pt**
- Wrong: **−15 pt** per attempt

## Learning goals

1. Know that Direct Connect uses a physical dedicated line (not internet)
2. Distinguish Direct Connect from Site-to-Site VPN (dedicated vs IPSec over internet)
3. Identify Direct Connect for regulated-industry hybrid connectivity in ANS-C01
