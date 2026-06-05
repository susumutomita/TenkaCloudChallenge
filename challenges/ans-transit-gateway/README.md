# ans-transit-gateway

**ANS-C01 · flag · difficulty 4 · $0**

## Story

CTO Sasaki-san tasks the new SRE with finding the right service to connect 20 VPCs and one on-prem site. Kato-san's unfinished design assumed VPC peering could handle it, but VPC peering is non-transitive and scales as O(N²) connections — neither property works at this scale.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) — full scenario text
- 1 IAM Role (`ParticipantViewerRole`)

No Transit Gateway, VPC, or EC2 instance is created. Cost: **$0**.

## Solution

**Flag:** `TC{transit-gateway}`

AWS Transit Gateway is a managed hub-and-spoke router that allows transitive routing between attached VPCs and on-premises networks. It replaces the O(N²) peering mesh with O(N) attachments and provides centralized route management via Transit Gateway route tables.

CLI to verify after stack deploy:
```bash
aws ssm get-parameter --name "/${NAME_PREFIX}/briefing" --query Parameter.Value --output text
```

## Scoring

- Correct: **+200 pt**
- Wrong: **−15 pt** per attempt (brute-force guard)

## Learning goals

1. Understand why VPC peering (non-transitive, O(N²)) fails at scale
2. Know that Transit Gateway provides transitive, hub-and-spoke routing
3. Identify Transit Gateway in ANS-C01 network design scenarios
