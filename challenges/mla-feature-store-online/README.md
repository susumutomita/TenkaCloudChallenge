# mla-feature-store-online — MLA · flag · difficulty 3 · $0

## Story

Kato-san's real-time fraud detection needs to retrieve customer features in single-digit milliseconds at inference time. CTO Sasaki-san asks which SageMaker Feature Store mode to use. The player distinguishes online store (low-latency serving) from offline store (training data).

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

No SageMaker Feature Store deployed. $0 cost.

## Solution

**Flag:** `TC{online}`

SageMaker Feature Store online store:
- In-memory key-value backend (DynamoDB-backed)
- Stores only the latest feature record per entity ID
- `get_record()` API latency: single-digit milliseconds
- Designed for real-time inference feature serving

Offline store:
- S3-based, stores full feature history
- Queried with Athena for training dataset generation
- Latency: minutes-scale, unsuitable for real-time serving

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (distinguishes offline store from online)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Understand online vs offline Feature Store modes and their use cases
- Know that online store is required for single-digit-ms inference-time retrieval
- Know that offline store is for training dataset generation via Athena
