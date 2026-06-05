# saa-sns-fanout-count

**Certification:** Solutions Architect Associate (SAA-C03) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

Week six at TenkaCloud Inc. Kato-san designed an SNS fanout pattern for the order-processing system. CTO Sasaki-san asks for a configuration check: how many SQS queues is the SNS topic fanning out to? The learner lists the subscriptions and counts them.

## What gets deployed

- `{NamePrefix}-order-events`: SNS Topic (the fanout source).
- `{NamePrefix}-inventory`: SQS Queue (subscriber 1 -- inventory service).
- `{NamePrefix}-billing`: SQS Queue (subscriber 2 -- billing service).
- Two `AWS::SNS::Subscription` resources (SQS type, one per queue).
- `/{NamePrefix}/briefing`: SSM Parameter with task instructions.

No messages are published. SNS + SQS are within the free tier -- $0 cost.

## Solution (operator notes)

The player must list the subscriptions on the SNS topic and count the SQS-type entries. The count is not stored in any SSM parameter or tag -- it must be derived from the live subscription list.

```bash
# Step 1: find the topic ARN
TOPIC_ARN=$(aws sns list-topics --query "Topics[?contains(TopicArn, '${NAMEPREFIX}')].TopicArn" --output text)

# Step 2: list subscriptions and count
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
  --query 'Subscriptions[?Protocol==`sqs`] | length(@)'
# Returns: 2
```

**Flag:** `TC{2-subscriptions}` (stored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt** (once per deploy).
- Wrong answer: **-15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (-20 / -40).

## Learning goals

- SNS fanout: one topic delivers the same message to multiple SQS queues in parallel.
- `aws sns list-subscriptions-by-topic` returns subscriber details including Protocol and Endpoint.
- Fanout width = number of subscriptions on the topic.
