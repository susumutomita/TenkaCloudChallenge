# dva-xray-tracing · DVA · flag · difficulty 2 · $0

## Story

Kato-san left only CloudWatch log-grepping for debugging a 3-tier microservice.
The new SRE (you) must identify the AWS service that provides end-to-end
distributed tracing across API Gateway, Lambda, and DynamoDB.

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` with scenario text |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with SSM read permissions |

No X-Ray, Lambda, or DynamoDB deployed -- spec-knowledge scenario.

## Solution

**AWS X-Ray** provides end-to-end distributed tracing. It instruments API
Gateway, Lambda, and DynamoDB calls, propagates the trace ID
(`_X_AMZN_TRACE_ID`), and renders a service map showing per-segment latency.

**Flag:** `TC{x-ray}`

## Scoring

- Correct: +150 pt
- Wrong: -15 pt each (anti-brute-force)
- Hint 1: -20 pt (points toward X-Ray concept)
- Hint 2: -40 pt (reveals x-ray)

## Learning goals

- AWS X-Ray = distributed tracing; CloudWatch Logs = log aggregation; CloudTrail = API audit
- X-Ray service map shows segment / subsegment breakdown per request
- Enable active tracing on Lambda (`TracingConfig: Active`) to auto-instrument
