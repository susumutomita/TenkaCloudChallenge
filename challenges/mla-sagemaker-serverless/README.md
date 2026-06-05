# mla-sagemaker-serverless-endpoint — MLA · flag · difficulty 3 · $0

## Story

Kato-san's fraud detection model has intermittent traffic (daytime only). CTO Sasaki-san wants to eliminate idle instance costs by choosing an endpoint type that scales to zero and charges per inference.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

No SageMaker endpoint deployed. $0 cost.

## Solution

**Flag:** `TC{serverless}`

SageMaker Serverless Inference:
- Scales to zero between bursts (no idle instance charges)
- Pay-per-inference billing model
- Accepts small cold-start latency when traffic resumes
- Max memory: 1–6 GB; max concurrency configurable

Other options for reference:
- Real-time: always-on instance, constant billing, best for consistent low-latency traffic
- Async: queue-based, for inferences taking minutes
- Batch Transform: offline bulk processing, no live endpoint

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (eliminates real-time, async, batch)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Understand the four SageMaker endpoint types and their trade-offs
- Explain when Serverless Inference is preferred over Real-time
- Know Serverless Inference cold start and pay-per-inference billing
