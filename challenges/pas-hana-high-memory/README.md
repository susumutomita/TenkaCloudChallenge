# pas-hana-high-memory · PAS-C01 · difficulty 4 · $0

## Story

Kato-san's SAP HANA migration project was left incomplete. The QUICK SIZER
output for the production S/4HANA system shows a 6.2 TB HANA DB memory
requirement (3,200 users, 185,000 SAPS). Standard EC2 memory-optimized
instances top out at ~2 TB; they cannot satisfy this requirement. CTO
Sasaki-san asks the new SRE to identify the SAP-certified EC2 instance family
that can handle multi-terabyte HANA scale-up.

## What gets deployed

- **SSM Parameter** `/{NamePrefix}/briefing` — full QUICK SIZER output
  (workload profile, HANA memory component breakdown totaling 6,144 GB,
  2-node HSR HA design), current standard EC2 instance maximums for comparison,
  and four EC2 instance families with detailed specs and suitability notes.
- **IAM Role** `ParticipantViewerRole` — SSM read + CloudShell only.

No EC2 instance, no SAP workload, no RDS. Cost: $0.

## Solution (operator notes)

The HANA requirement (6.2 TB) exceeds standard EC2 families. AWS provides
**High Memory instances** (`u-6tb1.metal` through `u-24tb1.metal`) that are:
- SAP-certified for HANA scale-up
- Available in 6/9/12/18/24 TB configurations
- Bare metal (no hypervisor overhead for HANA)
- Available on request via AWS Sales (not in standard EC2 catalog)

The `u-6tb1.metal` (6,144 GB = exactly the requirement) is the minimum
suitable choice for this scenario.

**Exact flag:** `TC{high-memory}`

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

Hints: hint-1 (−25 pt) eliminates r/x families by their memory ceiling;
hint-2 (−45 pt) names the answer.

## Learning goals

- Understand that SAP HANA in-memory architecture requires far more RAM than
  standard EC2 families provide.
- Identify AWS High Memory instances (u-xTBx.metal) as the SAP-certified
  HANA instance family.
- Apply PAS-C01 HANA sizing and instance selection reasoning.
