# ans-peering-nontransitive

**ANS-C01 · flag · difficulty 4 · $0**

## Story

Kato-san designed a three-VPC network with peering A↔B and B↔C, assuming A could reach C. CTO Sasaki-san wants the new SRE to verify whether VPC-A can actually communicate with VPC-C given only those two peering connections.

## What gets deployed

- 3 VPCs: VPC-A (10.40.0.0/16), VPC-B (10.41.0.0/16), VPC-C (10.42.0.0/16)
- 2 VPC peering connections: VPC-A↔VPC-B and VPC-B↔VPC-C (same account, auto-accepted, free)
- 1 SSM Parameter (`/{NamePrefix}/briefing`)

No EC2, NAT Gateway, or EIP. Cost: **$0**.

## Solution

**Flag:** `TC{no}`

VPC peering is non-transitive. Even though A↔B and B↔C peering connections exist, there is no direct peering between VPC-A and VPC-C. Traffic from A cannot pass through B to reach C. To enable A↔C connectivity, either a direct A↔C peering connection or a Transit Gateway is required.

CLI to verify the topology:
```bash
aws ec2 describe-vpc-peering-connections \
  --filters "Name=tag:TenkaCloud:NamePrefix,Values=${NAME_PREFIX}" \
  --query "VpcPeeringConnections[].{Requester:RequesterVpcInfo.CidrBlock,Accepter:AccepterVpcInfo.CidrBlock,Status:Status.Code}"
```

Expected output: two connections (10.40↔10.41 and 10.41↔10.42). No 10.40↔10.42 connection exists, confirming non-transitivity.

## Scoring

- Correct: **+200 pt**
- Wrong: **−15 pt** per attempt

## Learning goals

1. Confirm that VPC peering is non-transitive (A↔B and B↔C ≠ A↔C)
2. Understand when Transit Gateway is needed for transitive routing
3. Read `describe-vpc-peering-connections` AccepterVpcInfo / RequesterVpcInfo
