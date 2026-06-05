# dva-dynamodb-conditional-write · DVA · flag · difficulty 3 · $0

## Story

Kato-san's Lambda calls DynamoDB PutItem unconditionally, silently overwriting
existing records. The new SRE (you) must identify the ConditionExpression
function that prevents overwriting an existing item.

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` with scenario text |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with SSM read permissions |

No DynamoDB table deployed (PAY_PER_REQUEST forbidden by platform rules).

## Solution

The correct ConditionExpression function is `attribute_not_exists(pk)`.

**Flag:** `TC{attribute-not-exists}`

```python
# Correct pattern
table.put_item(
    Item={"pk": user_id, "data": payload},
    ConditionExpression="attribute_not_exists(pk)"
)
# Throws ConditionalCheckFailedException if item already exists
```

## Scoring

- Correct: +200 pt
- Wrong: -15 pt each (anti-brute-force)
- Hint 1: -20 pt (attribute_not_exists direction)
- Hint 2: -40 pt (reveals full answer)

## Learning goals

- `attribute_not_exists` is the correct guard for "create-only" PutItem
- PutItem default behavior is upsert (overwrites silently)
- `ConditionalCheckFailedException` is the error thrown when the condition fails
