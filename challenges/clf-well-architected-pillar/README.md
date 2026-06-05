# clf-well-architected-pillar

**Certification:** Cloud Practitioner (CLF-C02) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

Three weeks in at TenkaCloud Inc. CTO Sasaki-san is organizing architecture review materials and needs to tag Kato-san's design decision (right-sizing instances and deleting idle resources) to the correct Well-Architected pillar.

## What gets deployed

One SSM String parameter (`/{NamePrefix}/briefing`) describing the design decision with four candidate pillars as decoys, plus the ParticipantViewerRole. No EC2, NAT Gateway, or EIP — free tier only.

## Solution (operator notes)

The decision focuses on eliminating waste and right-sizing to reduce AWS spend. This is the **Cost Optimization** pillar — canonical practices include right-sizing, eliminating idle resources, and scheduling non-production shutdowns.

Decoy analysis:
- Reliability: covers fault tolerance and availability — not cost
- Security: covers data protection and IAM — not cost
- Performance Efficiency: covers latency and throughput — not cost

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/briefing" \
  --query Parameter.Value --output text
```

**Flag:** `TC{cost-optimization}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+175 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand the five AWS Well-Architected pillars: Cost Optimization, Reliability, Security, Performance Efficiency, Operational Excellence.
- Confirm that right-sizing and deleting idle resources are canonical Cost Optimization practices.
- Distinguish the primary concerns of each pillar.
