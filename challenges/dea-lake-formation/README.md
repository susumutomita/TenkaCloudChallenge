# dea-lake-formation — DEA · flag · difficulty 3 · $0

## Story

Kato-san's S3 data lake relies on IAM and bucket policies alone — no column or row filtering. CTO Sasaki-san needs centralized fine-grained access control over the Glue Catalog. The player identifies AWS Lake Formation as the answer.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

$0 cost.

## Solution

**Flag:** `TC{lake-formation}`

AWS Lake Formation provides:
- Column-level security via Grants (hide specific columns from principals)
- Row-level security via DataFilters (filter rows by condition)
- Centralized governance over S3 data lakes and Glue Data Catalog

IAM and S3 bucket policies operate at the object level and cannot filter columns or rows within a dataset.

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (eliminates IAM/S3 policies)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Understand Lake Formation's column-level and row-level access control capabilities
- Explain why IAM and S3 policies cannot implement column or row filtering
- Know Lake Formation DataFilters (row-level) and Grant permissions (column-level)
