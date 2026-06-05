# mls-imbalanced-metric · MLS-C01 · difficulty 3 · $0

## Story

Kato-san's fraud detection model reported 99.9% accuracy and was shipped to
production — where it promptly missed every fraud case. The confusion matrix
reveals TP=0: the model predicts "normal" for every sample. With only 0.1%
positive rate, accuracy is meaningless. CTO Sasaki-san asks what metric should
have been used instead.

## What gets deployed

- **SSM Parameter** `/{NamePrefix}/briefing` — confusion matrix
  (TP=0, TN=9990, FP=0, FN=10), class distribution (99.9% / 0.1%), computed
  accuracy/precision/recall/F1 values, and four candidate metrics with
  definitions.
- **IAM Role** `ParticipantViewerRole` — SSM read + CloudShell only.

No EC2, no SageMaker, no Lambda invocation. Cost: $0.

## Solution (operator notes)

The confusion matrix shows TP=0: the model never predicts fraud. Accuracy
(99.9%) is trivially achieved by the "always-normal" strategy. F1 score —
the harmonic mean of Precision and Recall — evaluates to 0, immediately
flagging the model as useless. F1 is the standard metric for imbalanced binary
classification such as fraud detection.

- MSE and R² are regression metrics, not classification metrics.
- Accuracy is the wrong choice whenever class imbalance is severe (< 5% positive).

**Exact flag:** `TC{f1-score}`

CLI one-liner:

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

Hints: hint-1 (−20 pt) nudges toward Precision/Recall;
hint-2 (−40 pt) names the answer.

## Learning goals

- Recognize why accuracy is misleading under class imbalance.
- Calculate F1 score from a confusion matrix and explain why it beats accuracy
  for fraud / rare-event detection.
- Apply MLS-C01 metric-selection reasoning to imbalanced datasets.
