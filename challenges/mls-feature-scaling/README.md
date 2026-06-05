# mls-feature-scaling · MLS-C01 · difficulty 2 · $0

## Story

Kato-san's mortgage-approval model (logistic regression + neural network
ensemble) fails to converge: SGD diverges after epoch 10 with NaN weights. The
feature table reveals a ~16,000× scale gap (`loan_amount` max 1,200,000 vs
`age` max 75). CTO Sasaki-san asks the new SRE to name the preprocessing
technique that fixes scale-driven divergence.

## What gets deployed

- **SSM Parameter** `/{NamePrefix}/briefing` — full feature schema (7 numeric
  features with min/max/mean/units), scale gap analysis (16,000× ratio),
  SGD convergence log showing divergence, and four candidate preprocessing
  techniques with precise definitions.
- **IAM Role** `ParticipantViewerRole` — SSM read + CloudShell only.

No EC2, no SageMaker, no Lambda invocation. Cost: $0.

## Solution (operator notes)

The root cause is numeric features on vastly different scales causing gradient
magnitudes to be dominated by `loan_amount`. The fix is **normalization** —
rescaling all numeric features to comparable ranges via MinMax scaling
([0,1]), Z-score standardization (mean=0, std=1), or Robust scaling (median
+ IQR). All gradient-descent algorithms benefit.

The planted decoy is one-hot encoding, which addresses categorical cardinality
and does nothing for numeric scale differences.

**Exact flag:** `TC{normalization}`

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
| Wrong attempt  | −15    |

Hints: hint-1 (−20 pt) eliminates one-hot encoding as a scale fix;
hint-2 (−35 pt) names the answer.

## Learning goals

- Recognize that scale gaps between numeric features cause gradient-descent
  divergence.
- Identify the normalization family (MinMax, Z-score, Robust) as the fix.
- Distinguish normalization (numeric scale) from one-hot encoding (categorical
  cardinality) for MLS-C01 preprocessing questions.
