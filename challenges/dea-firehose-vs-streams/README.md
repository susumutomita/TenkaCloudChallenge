# dea-firehose-vs-streams — DEA · flag · difficulty 2 · $0

## Story

Kato-san's log pipeline needs to deliver data to S3 and Redshift without writing consumer code. CTO Sasaki-san wants fully managed delivery. The player must distinguish Kinesis Data Firehose (no consumer code) from Data Streams (requires consumer application).

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

No Kinesis services deployed (both incur costs). $0 cost.

## Solution

**Flag:** `TC{firehose}`

Kinesis Data Firehose:
- Fully managed, no consumer application code required
- Buffers incoming data and automatically delivers to S3, Redshift, OpenSearch, Splunk
- Buffer size (1–128 MB) or buffer interval (60–900s) configuration

Kinesis Data Streams:
- Requires custom consumer code (KCL application or Lambda)
- Low latency real-time processing
- Custom sharding and retention control

## Scoring

- Correct: +150 pt
- Wrong: -15 pt/attempt (anti-brute-force)
- Hint 1: -15 pt (distinguishes Streams requirement for consumer code)
- Hint 2: -35 pt (reveals answer)

## Learning goals

- Distinguish Kinesis Data Firehose from Data Streams
- Understand Firehose as the codeless delivery option to S3/Redshift
- Know Firehose buffering settings and delivery destinations
