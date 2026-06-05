# soa-trusted-advisor-category

**SOA-C02 · flag · difficulty 2 · $0 free-tier**

## Story

Cloud costs ballooned. CTO Sasaki-san asks which Trusted Advisor check category flags idle/low-utilization EC2 instances for potential savings. The player reads the scenario from the SSM briefing and identifies the correct category name.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — scenario listing all 5 Trusted Advisor categories with descriptions and decoys |
| `AWS::IAM::Role` | `ParticipantViewerRole` with SSM read on `/{NamePrefix}/*`, CloudShell |

No EC2. Cost: **$0**.

## Solution

The flag is **`TC{cost-optimization}`**.

The "Low Utilization Amazon EC2 Instances" Trusted Advisor check belongs to the **Cost Optimization** category because its purpose is to identify spending that can be reduced.

CLI verification:
```bash
aws ssm get-parameter --name "/<NamePrefix>/briefing" --query 'Parameter.Value' --output text
```

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- The 5 Trusted Advisor categories: Cost Optimization, Performance, Security, Fault Tolerance, Service Limits
- Low Utilization EC2 = Cost Optimization (not Performance, not Security)
- SOA-C02: Trusted Advisor category classification is a high-frequency exam topic
