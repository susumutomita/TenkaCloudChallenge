# ans-cidr-subnet-sizing

**ANS-C01 · flag · difficulty 3 · $0**

## Story

CTO Sasaki-san asks the new SRE to determine the correct subnet size for an application tier that needs at least 500 usable IP addresses, given AWS's 5-IP reservation per subnet.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) — scenario with calculation guidance
- 1 IAM Role (`ParticipantViewerRole`)

No VPC, subnet, or EC2. Cost: **$0**.

## Solution

**Flag:** `TC{/23}`

AWS reserves 5 IPs per subnet: network address (.0), VPC router (.1), DNS (.2), future use (.3), and broadcast (last address).

| Prefix | Total addresses | Usable (−5) | Satisfies ≥500? |
|--------|-----------------|-------------|-----------------|
| /22    | 1 024           | 1 019       | ✅ (but larger than needed) |
| /23    | 512             | 507         | ✅ |
| /24    | 256             | 251         | ❌ |
| /25    | 128             | 123         | ❌ |

The **largest prefix (smallest subnet) that still gives ≥500 usable IPs** is **/23**.

## Scoring

- Correct: **+150 pt**
- Wrong: **−15 pt** per attempt

## Learning goals

1. Apply the AWS 5-IP-per-subnet reservation rule to CIDR calculations
2. Derive the correct prefix length (/23) for a ≥500 usable IP requirement
3. Quickly perform subnet sizing arithmetic in ANS-C01 / SAA design questions
