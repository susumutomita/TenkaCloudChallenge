# saa-dynamodb-gsi-key

**Certification:** Solutions Architect Associate (SAA-C03) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Two and a half months into TenkaCloud Inc. Kato-san set up a DynamoDB users table with a GSI so the team could query by email. CTO Sasaki-san asks for a config check: what attribute is the GSI partition key? The learner describes the table and reads the GSI KeySchema.

## What gets deployed

- `{NamePrefix}-users`: DynamoDB table (partition key: `userId`, PROVISIONED 1 RCU / 1 WCU).
- GSI `email-index`: partition key `email`, PROVISIONED 1 RCU / 1 WCU.
- `/{NamePrefix}/briefing`: SSM Parameter with task instructions.

DynamoDB PROVISIONED 1/1 is within the free tier (25 RCU / 25 WCU permanent). **Never PAY_PER_REQUEST** -- $0 cost.

## Solution (operator notes)

The player must describe the table and read the GSI key schema. The GSI partition key attribute name is not stored in any SSM parameter or tag.

```bash
TABLE_NAME=$(aws dynamodb list-tables \
  --query "TableNames[?contains(@, '${NAMEPREFIX}')]" --output text)

aws dynamodb describe-table --table-name "$TABLE_NAME" \
  --query 'Table.GlobalSecondaryIndexes[0].KeySchema[?KeyType==`HASH`].AttributeName' \
  --output text
# Returns: email
```

**Flag:** `TC{email}` (stored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt** (once per deploy).
- Wrong answer: **-15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (-20 / -40).

## Learning goals

- DynamoDB GSI: a secondary index with a different partition key (and optional sort key) from the base table.
- `describe-table` returns `GlobalSecondaryIndexes[].KeySchema` with `KeyType: HASH` (partition) and `RANGE` (sort).
- GSI use case: query on non-primary attributes (e.g., email lookup in a userId-keyed table).
