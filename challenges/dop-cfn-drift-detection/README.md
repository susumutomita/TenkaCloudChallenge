# dop-cfn-drift-detection

**DOP-C02 · flag · difficulty 3 · $0**

## Story

Kato-san edited an EC2 security group directly in the console, causing the CloudFormation
stack's expected configuration to diverge from the actual resource state.
CTO Sasaki-san wants to know which CloudFormation feature detects such manual out-of-band changes.

## What gets deployed

- SSM Parameter `/{NamePrefix}/briefing` (scenario question)

Cost: $0.

## Solution

The flag is `TC{drift-detection}`.

CloudFormation Drift Detection compares the actual state of stack-managed resources against
the CFn template's expected values and surfaces any manual changes (drift).

**CLI for drift detection (operator reference):**

```bash
aws cloudformation detect-stack-drift --stack-name <stack-name>
aws cloudformation describe-stack-resource-drifts --stack-name <stack-name>
```

Drift statuses: `MODIFIED` / `DELETED` / `NOT_CHECKED` / `IN_SYNC`.

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

1. Understand CloudFormation Drift Detection purpose and CLI commands
2. Explain why out-of-band changes are problematic from a stack-consistency standpoint
3. Understand drift statuses (MODIFIED / DELETED / NOT_CHECKED)
