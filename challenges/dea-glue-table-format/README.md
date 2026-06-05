# dea-glue-table-format — DEA · flag · difficulty 3 · $0

## Story

Kato-san left a Glue Data Catalog database without documenting the data format. CTO Sasaki-san needs the answer before the external ETL team connects. The player must read the table's `StorageDescriptor.SerdeInfo.SerializationLibrary` to identify the declared format.

## What gets deployed

- 1 Glue Data Catalog database (`{NamePrefix}-db`)
- 1 Glue Data Catalog table (`{NamePrefix}-events`) with Parquet SerDe in its StorageDescriptor
- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the task description

No S3 object uploads, no Glue job or crawler. $0 cost.

## Solution

**Flag:** `TC{parquet}`

**CLI one-liner to verify:**

```bash
aws glue get-table \
  --catalog-id $(aws sts get-caller-identity --query Account --output text) \
  --database-name <NamePrefix>-db \
  --name <NamePrefix>-events \
  --query 'Table.StorageDescriptor.SerdeInfo.SerializationLibrary' \
  --output text
# Returns: org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe  → parquet
```

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (nudge toward SerdeInfo)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Read `StorageDescriptor.SerdeInfo.SerializationLibrary` to identify Glue table data format
- Recognize `ParquetHiveSerDe` as the Parquet serialization library
- Navigate the `aws glue get-table` output structure
