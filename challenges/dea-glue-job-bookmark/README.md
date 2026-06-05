# dea-glue-job-bookmark — DEA · flag · difficulty 3 · $0

## Story

Kato-san's Glue job full-scans S3 every run, wasting compute on already-processed files. CTO Sasaki-san wants to enable incremental ETL. The player identifies Glue Job Bookmarks as the mechanism that tracks processing state.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

No Glue job deployed (DPU charges $0.44/DPU-hour). $0 cost.

## Solution

**Flag:** `TC{job-bookmark}`

Glue Job Bookmarks record how far a job has processed S3 data. On subsequent runs, the job skips already-processed files and handles only new records. Enable with `--job-bookmark-option job-bookmark-enable`.

Decoys:
- Glue Workflows: dependency orchestration between jobs/crawlers
- Glue Crawlers: schema discovery and Data Catalog population

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (eliminates workflows and crawlers)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Understand how Glue Job Bookmarks enable incremental ETL
- Distinguish bookmarks from workflows (orchestration) and crawlers (schema discovery)
- Know the `job-bookmark-option` setting
