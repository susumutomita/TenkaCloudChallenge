# dva-sqs-visibility-timeout · DVA · flag · difficulty 2 · $0

## Story

Kato-san's SQS queue has a VisibilityTimeout that is too short, causing workers
to see and double-process messages before the first consumer finishes. The new
SRE (you) must read the current VisibilityTimeout from the queue attributes.

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::SQS::Queue` | `${NamePrefix}-work-queue`, VisibilityTimeout=30 |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with `sqs:GetQueueAttributes` + `sqs:GetQueueUrl` + `sqs:ListQueues` |
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` |

## Solution

```bash
# Get queue URL
QUEUE_URL=$(aws sqs get-queue-url \
  --queue-name <NamePrefix>-work-queue \
  --query 'QueueUrl' --output text)

# Read VisibilityTimeout
aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names VisibilityTimeout \
  --query 'Attributes.VisibilityTimeout'
```

**Flag:** `TC{30}`

## Scoring

- Correct: +150 pt
- Wrong: -15 pt each (anti-brute-force)
- Hint 1: -20 pt (how to read queue attributes)
- Hint 2: -35 pt (reveals 30)

## Learning goals

- SQS Visibility Timeout prevents other consumers from seeing a message while one is processing it
- A too-short timeout causes double-processing; the fix is to set it longer than max processing time
- `aws sqs get-queue-attributes --attribute-names VisibilityTimeout` is the CLI read path
