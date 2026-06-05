# mla-batch-transform — MLA · flag · difficulty 2 · $0

## Story

Kato-san's churn prediction model needs to score 10M records every night with no latency SLA. CTO Sasaki-san wants to avoid paying for a 24/7 real-time endpoint. The player selects Batch Transform as the correct inference mode.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

No SageMaker resources deployed. $0 cost.

## Solution

**Flag:** `TC{batch-transform}`

SageMaker Batch Transform:
- Reads input data from S3 (CSV, JSON, etc.)
- Runs inference at scale using the model
- Writes output predictions to S3
- No persistent endpoint required
- Billed only during the job execution window

Real-time endpoint:
- Always-on HTTPS endpoint for live requests
- Billed 24/7 regardless of traffic
- Suitable for consistent low-latency traffic, not nightly batch jobs

## Scoring

- Correct: +150 pt
- Wrong: -15 pt/attempt (anti-brute-force)
- Hint 1: -15 pt (points to no-persistent-endpoint option)
- Hint 2: -35 pt (reveals answer)

## Learning goals

- Understand SageMaker Batch Transform for offline bulk inference
- Compare Batch Transform vs real-time endpoint costs and use cases
- Know that Batch Transform reads from S3 and writes results to S3
