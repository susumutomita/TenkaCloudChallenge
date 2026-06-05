# ans-vpn-bgp

**ANS-C01 · flag · difficulty 4 · $0**

## Story

CTO Sasaki-san reviews the Site-to-Site VPN configuration Kato-san set up with static routing. Static routing requires manual route updates when a tunnel fails or when the on-premises network adds new subnets — unacceptable for a production environment.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) — full scenario text
- 1 IAM Role (`ParticipantViewerRole`)

No VPN Gateway or Customer Gateway (both billable). Cost: **$0**.

## Solution

**Flag:** `TC{bgp}`

BGP (Border Gateway Protocol) is the dynamic routing protocol supported by AWS Site-to-Site VPN. When enabled:
1. The Virtual Private Gateway and the on-premises router exchange routes via BGP sessions
2. If tunnel-1 fails, BGP detects it and traffic automatically shifts to tunnel-2
3. New subnets added on-premises are propagated to the AWS route table automatically via BGP route advertisements

Static routing has neither of these properties — failover and route changes both require manual intervention.

## Scoring

- Correct: **+200 pt**
- Wrong: **−15 pt** per attempt

## Learning goals

1. Know that BGP enables dynamic route propagation for AWS Site-to-Site VPN
2. Understand how BGP provides automatic tunnel failover between the two VPN tunnels
3. Distinguish static routing (manual) from BGP (dynamic) in ANS-C01 VPN design
