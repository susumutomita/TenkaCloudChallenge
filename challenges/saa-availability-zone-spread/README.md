# saa-availability-zone-spread

**Certification:** Solutions Architect Associate (SAA-C03) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Four months into TenkaCloud Inc. CTO Sasaki-san needs a concrete answer on AZ spread for a capacity planning review. Kato-san's VPC has three subnets -- but how many distinct AZs do they span? The learner lists the subnets, reads each `AvailabilityZone`, deduplicates, and counts.

## What gets deployed

- `{NamePrefix}-vpc`: VPC (`10.50.0.0/16`).
- `{NamePrefix}-subnet-az0`: Subnet in AZ index 0 (`10.50.1.0/24`).
- `{NamePrefix}-subnet-az1`: Subnet in AZ index 1 (`10.50.2.0/24`).
- `{NamePrefix}-subnet-az2`: Subnet in AZ index 2 (`10.50.3.0/24`).
- `{NamePrefix}-rt`: Shared route table (local only, all three subnets).
- `/{NamePrefix}/briefing`: SSM Parameter with task instructions.

`!Select [0/1/2, !GetAZs ""]` guarantees three distinct AZs in any region. No EC2, NAT Gateway, or EIP -- $0 cost.

## Solution (operator notes)

The player must list subnets tagged with the team prefix, extract the `AvailabilityZone` values, deduplicate, and count. The count is not stored in any SSM parameter or tag.

```bash
aws ec2 describe-subnets \
  --filters "Name=tag:TenkaCloud:NamePrefix,Values=${NAMEPREFIX}" \
  --query 'Subnets[*].AvailabilityZone' --output text | tr '\t' '\n' | sort -u | wc -l
# Returns: 3
```

**Flag:** `TC{3-azs}` (stored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt** (once per deploy).
- Wrong answer: **-15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (-20 / -40).

## Learning goals

- Multi-AZ spread: 3 AZs provide better fault tolerance than 2 (33% capacity loss vs 50% on a single-AZ failure).
- Subnet count != AZ count; always deduplicate AvailabilityZone values.
- `describe-subnets --query 'Subnets[*].AvailabilityZone'` returns the AZ of each subnet.
