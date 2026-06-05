# mls-binary-classification · MLS-C01 · difficulty 3 · $0

## Story

Kato-san left a half-built churn-prediction ML pipeline. The dataset has
180,000 customer records with a binary label (`churned`: 0=retained, 1=churned).
CTO Sasaki-san asks the new SRE to lock in the ML problem framing before the
data science team starts training.

## What gets deployed

- **SSM Parameter** `/{NamePrefix}/briefing` — full data schema (feature names,
  types, ranges, class distribution 75 / 25 split), business goal, and four
  candidate ML problem types with precise definitions.
- **IAM Role** `ParticipantViewerRole` — SSM read + CloudShell access only.

No EC2, no SageMaker endpoint, no Lambda invocation. Cost: $0.

## Solution (operator notes)

The label `churned` takes only two discrete integer values (0 / 1). A task that
predicts one of exactly two discrete classes from labeled historical data is
**binary classification**.

- Regression: wrong (target is not continuous).
- Multi-class: wrong (only 2 classes, not 3+).
- Clustering: wrong (labels are provided; this is supervised learning).

**Exact flag:** `TC{binary-classification}`

CLI one-liner to verify the briefing is deployed:

```bash
aws ssm get-parameter \
  --name "/${NAME_PREFIX}/briefing" \
  --query Parameter.Value \
  --output text
```

## Scoring

| Event          | Points |
|----------------|--------|
| Correct flag   | +200   |
| Wrong attempt  | −20    |

Hints: hint-1 (−20 pt) nudges toward examining the label cardinality;
hint-2 (−40 pt) reveals the answer.

## Learning goals

- Distinguish binary classification from regression, multi-class, and clustering
  by examining the label structure.
- Apply MLS-C01 problem-type taxonomy to a real churn-prediction scenario.
- Read an SSM Parameter from CloudShell using the AWS CLI.
