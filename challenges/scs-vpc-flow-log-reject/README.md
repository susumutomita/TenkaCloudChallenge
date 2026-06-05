# scs-vpc-flow-log-reject

**Certification:** Security Specialty (SCS-C02) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Four months at TenkaCloud Inc. CTO Sasaki-san suspects traffic is being blocked in Kato-san's VPC. VPC flow logs are enabled. What ACTION value appears in flow log records for traffic blocked by a SG or NACL?

## What gets deployed

| Resource | Details |
| --- | --- |
| VPC | `10.40.0.0/16`, tagged with `TenkaCloud:NamePrefix` |
| CloudWatch Log Group | `/aws/vpc/flowlogs/${NamePrefix}`, 7-day retention |
| VPC Flow Log | ALL traffic to CloudWatch Logs |
| IAM role | Flow log delivery service role |

Plus an SSM Parameter `/${NamePrefix}/briefing` with the task description.

No EC2, no NAT, no EIP. All free.

## Solution (operator notes)

VPC flow log ACTION field values:
- `ACCEPT` — traffic was allowed through.
- `REJECT` — traffic was blocked by a security group or NACL.

```bash
aws ec2 describe-flow-logs \
  --filter Name=resource-id,Values=<vpc-id> \
  --query 'FlowLogs[].{LogGroup:LogGroupName,Status:FlowLogStatus}'
```

**Flag:** `TC{reject}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand the two VPC flow log ACTION values: ACCEPT and REJECT.
- Know that REJECT indicates traffic blocked by a security group or NACL.
- Verify VPC flow log configuration using `aws ec2 describe-flow-logs`.
