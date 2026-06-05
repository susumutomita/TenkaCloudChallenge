# clf-pricing-model-pick

**Certification:** Cloud Practitioner (CLF-C02) · **Kind:** `flag` · **Difficulty:** 1 · **Cost:** $0

## Story

Week one at TenkaCloud Inc. CTO Sasaki-san wants to reduce costs on Kato-san's batch pipeline. The job is fault-tolerant, stateless, and has no deadline. The player must identify the cheapest EC2 purchasing option for this workload.

## What gets deployed

One SSM String parameter (`/{NamePrefix}/briefing`) describing the workload and listing four purchasing options (On-Demand, Reserved, Savings Plans, Spot), plus the ParticipantViewerRole. No EC2, NAT Gateway, or EIP — free tier only.

## Solution (operator notes)

The workload is fault-tolerant (checkpoints to S3 after interruption) and has no deadline. Spot Instances are the cheapest option for such workloads — up to 90% cheaper than On-Demand. Reserved and Savings Plans require commitments; On-Demand is full price.

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/briefing" \
  --query Parameter.Value --output text
```

**Flag:** `TC{spot}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+150 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand the four EC2 purchasing options: On-Demand, Reserved, Savings Plans, Spot.
- Learn why Spot Instances are cheapest for fault-tolerant, deadline-free batch workloads.
- Understand the trade-offs: commitment requirements vs. savings potential vs. interruption risk.
