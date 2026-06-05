# dva-lambda-reserved-concurrency · DVA · flag · difficulty 3 · $0

## Story

Kato-san set a concurrency limit on a Lambda function to protect other workloads
in the account. The new SRE (you) must read the ReservedConcurrentExecutions
value from the function configuration.

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::Lambda::Function` | `${NamePrefix}-concurrency-fn`, ReservedConcurrentExecutions=10, **never invoked** |
| `AWS::IAM::Role` (exec) | Minimal: CloudWatch Logs only |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with `lambda:GetFunction*` + `lambda:GetFunctionConcurrency` |
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` |

## Solution

```bash
aws lambda get-function-concurrency \
  --function-name <NamePrefix>-concurrency-fn \
  --query 'ReservedConcurrentExecutions'
```

**Flag:** `TC{10}`

## Scoring

- Correct: +200 pt
- Wrong: -20 pt each (anti-brute-force)
- Hint 1: -25 pt (which API to call)
- Hint 2: -50 pt (reveals 10)

## Learning goals

- `ReservedConcurrentExecutions` reserves concurrency from the account pool for one function
- Setting to 0 throttles all invocations (useful for emergency off-switch)
- Provisioned Concurrency (warm instances) is different from Reserved Concurrency (cap)
