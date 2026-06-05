# dea-kinesis-shard-count — DEA · flag · difficulty 3 · $0

## Story

Kato-san designed a Kinesis Data Streams pipeline for 2 MB/s ingest. CTO Sasaki-san is worried about throttling. The player must apply the shard capacity formula to calculate the minimum number of shards.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario and calculation problem

No Kinesis stream deployed (costs $0.015/shard-hour). $0 cost.

## Solution

**Flag:** `TC{2-shards}`

**Formula:** `required_shards = CEIL(ingest_rate_MBps / 1 MB/s per shard) = CEIL(2 / 1) = 2`

Each Kinesis Data Streams shard supports 1 MB/s ingest throughput. For 2 MB/s, 2 shards are required.

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (reminds of 1 MB/s per shard limit)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Master the Kinesis shard count formula: `CEIL(ingest MB/s ÷ 1 MB/s per shard)`
- Understand Kinesis throughput limits per shard (1 MB/s ingest, 2 MB/s read)
- Know when throttling occurs and how additional shards prevent it
