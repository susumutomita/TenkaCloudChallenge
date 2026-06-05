# saa-sqs-dlq-redrive

**Certification:** Solutions Architect Associate (SAA-C03) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

One month into TenkaCloud Inc. Kato-san's order-processing queue has a DLQ, but CTO Sasaki-san can't remember what `maxReceiveCount` was set to. The learner inspects the deployed SQS queue's RedrivePolicy attribute and reports the value.

## What gets deployed

- `{NamePrefix}-orders`: SQS Standard queue with a `RedrivePolicy` (`maxReceiveCount: 5`) pointing to the DLQ.
- `{NamePrefix}-orders-dlq`: Dead-Letter Queue (target of the redrive).
- `/{NamePrefix}/briefing`: SSM Parameter with task instructions.

No messages are sent. SQS queue definitions are within the free tier -- $0 cost.

## Solution (operator notes)

The player must inspect the main queue's attributes to find `maxReceiveCount`. The value is deliberately not stored in any SSM parameter, tag, or other resource the player can read -- only the RedrivePolicy attribute holds it.

```bash
# Step 1: get the queue URL
QUEUE_URL=$(aws sqs get-queue-url --queue-name {NamePrefix}-orders --query 'QueueUrl' --output text)

# Step 2: read the RedrivePolicy
aws sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names RedrivePolicy \
  --query 'Attributes.RedrivePolicy' --output text | python3 -m json.tool
# Output includes: "maxReceiveCount": 5
```

**Flag:** `TC{5}` (stored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt** (once per deploy).
- Wrong answer: **-15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (-20 / -40).

## Learning goals

- SQS RedrivePolicy `maxReceiveCount` is the threshold: after N receive attempts, the message moves to the DLQ.
- `aws sqs get-queue-attributes --attribute-names RedrivePolicy` returns the policy as a JSON string.
- DLQ purpose: isolate poison-pill messages so the main queue keeps processing healthy messages.
