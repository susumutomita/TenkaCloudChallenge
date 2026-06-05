# pas-sap-overlay-ip · PAS-C01 · difficulty 4 · $0

## Story

Kato-san's SAP HANA HA design has a critical gap: the primary node is in
AZ-1a, the secondary in AZ-1c, and the virtual IP (10.99.0.1) that SAP
application servers use to connect to HANA is outside the VPC CIDR
(10.0.0.0/16). Normal VPC routing cannot handle cross-AZ virtual IP failover.
CTO Sasaki-san asks the new SRE to name the technique that makes it work.

## What gets deployed

- **SSM Parameter** `/{NamePrefix}/briefing` — full HA architecture (node
  placement, VPC CIDR, virtual IP, replication topology), detailed explanation
  of why standard VPC routing fails for cross-AZ virtual IPs, and four
  candidate techniques with step-by-step mechanics.
- **IAM Role** `ParticipantViewerRole` — SSM read + CloudShell only.

No EC2, no SAP workload, no VPC changes. Cost: $0.

## Solution (operator notes)

The AWS SAP on AWS reference architecture uses **Overlay IP routing**:
1. The virtual IP (e.g., 10.99.0.1/32) is chosen from a range outside all
   VPC subnet CIDRs.
2. A custom route entry is added to the relevant VPC route tables pointing to
   the primary node's ENI.
3. On failover, Linux Pacemaker (using an IAM role + AWS CLI) updates the
   custom route to point to the secondary node's ENI.
4. SAP app servers need no reconfiguration — they still connect to 10.99.0.1.

Takeover completes in under 60 seconds. This is the canonical AWS SAP on AWS
HA design for HANA System Replication across AZs.

- Elastic IPs are public and not suitable for private DB tier failover.
- Route 53 DNS failover is too slow (TTL-based, minutes) for SAP HANA.
- Transit Gateway handles inter-VPC and on-premises routing, not intra-VPC
  virtual IP failover.

**Exact flag:** `TC{overlay-ip}`

CLI one-liner:

```bash
aws ssm get-parameter \
  --name "/${NAME_PREFIX}/briefing" \
  --query Parameter.Value \
  --output text
```

## Scoring

| Event          | Points |
|----------------|--------|
| Correct flag   | +200   |
| Wrong attempt  | −20    |

Hints: hint-1 (−25 pt) highlights the VPC CIDR boundary problem;
hint-2 (−45 pt) names the answer.

## Learning goals

- Understand why cross-AZ virtual IP failover in VPC requires an overlay IP
  (outside subnet CIDRs with a custom route).
- Describe the Pacemaker + AWS CLI route-update mechanism.
- Apply PAS-C01 SAP HANA HA architecture reasoning.
