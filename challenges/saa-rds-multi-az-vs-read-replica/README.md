# saa-rds-multi-az-vs-read-replica

**Certification:** Solutions Architect Associate (SAA-C03) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

Week three at TenkaCloud Inc. A late-night production outage triggers a call from CTO Sasaki-san. Kato-san left the production RDS in a single-AZ configuration. The requirement is clear: automatic failover to a standby in another AZ, no manual intervention -- not read scaling. The learner reads the SSM parameter and identifies the correct RDS feature.

## What gets deployed

One SSM Parameter (`/{NamePrefix}/rds-requirement`) describing the HA requirement: synchronous standby in a different AZ, automatic failover on primary failure, not a read-scaling use case. No RDS instance or EC2 is created.

All resources are free: no RDS, no EC2.

## Solution (operator notes)

Two RDS features to distinguish:

| Feature | Replication | Failover | Purpose |
|---|---|---|---|
| **Multi-AZ** | Synchronous | Automatic | High availability |
| Read Replica | Asynchronous | Manual promotion | Read scaling |

The requirement calls for **automatic failover** → the answer is Multi-AZ.

```bash
aws ssm get-parameter --name /{NamePrefix}/rds-requirement --query 'Parameter.Value' --output text
```

**Flag:** `TC{multi-az}` (stored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt** (once per deploy).
- Wrong answer: **-15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (-20 / -40).

## Learning goals

- RDS Multi-AZ: synchronous replica in another AZ, automatic failover, high-availability purpose.
- Read Replica: asynchronous, manual promotion, read-scaling purpose -- no automatic failover.
- SAA-C03: distinguish HA (Multi-AZ) from read scaling (Read Replica) in scenario questions.
