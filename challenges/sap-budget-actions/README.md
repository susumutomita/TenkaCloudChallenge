# sap-budget-actions

**SAP-C02 · flag · difficulty 4 · $0**

## Story

Kato-san's dev environment has developers leaving EC2 instances running overnight,
causing budget overruns. CTO Sasaki-san wants automatic enforcement — apply a
restrictive IAM policy or stop instances when the budget is exceeded.
The player identifies Budget Actions as the correct AWS Budgets feature.

## What gets deployed

| Resource | Type | Cost |
|---|---|---|
| `/{NamePrefix}/briefing` | SSM String Parameter (scenario) | Free |
| `{NamePrefix}-participant-viewer` | IAM Role | Free |

**$0**.

## Solution (operator notes)

**Budget Actions** is the AWS Budgets feature that automatically:
- Applies an IAM policy (e.g. Deny ec2:RunInstances) when a budget threshold is crossed
- Stops EC2 instances
- Stops RDS instances

Decoys: Budget Alerts (notification only, no automation), SCP (preventive, not reactive), Cost Anomaly Detection (ML anomaly alerts, no enforcement).

**Exact flag:** `TC{budget-actions}`

## Scoring

- Correct: +200 pt
- Wrong answer penalty: -20 pt
- Hint 1 (−20 pt): points toward the "Actions" tab in Budgets console, distinguishes from Alerts
- Hint 2 (−40 pt): reveals "budget-actions" and submission format

## Learning goals

1. Understand Budget Actions vs Budget Alerts distinction
2. Know that Budget Actions can enforce IAM policy / stop EC2/RDS automatically
3. Identify when to use Budget Actions vs SCP vs Cost Anomaly Detection
