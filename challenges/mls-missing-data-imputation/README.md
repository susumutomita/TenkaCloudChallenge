# mls-missing-data-imputation · MLS-C01 · difficulty 2 · $0

## Story

Kato-san's medical-diagnosis ML pipeline feeds a 45,231-row dataset into
SageMaker XGBoost, but the `age` column has 3.2% MCAR missing values that
cause training to error. CTO Sasaki-san asks the new SRE to name the
preprocessing technique that fills NaN values with statistics rather than
dropping rows.

## What gets deployed

- **SSM Parameter** `/{NamePrefix}/briefing` — dataset profile (domain,
  record count, four columns with missing percentages and missingness
  mechanisms), descriptive statistics for the `age` column, and four candidate
  preprocessing strategies with precise definitions including when each is
  appropriate.
- **IAM Role** `ParticipantViewerRole` — SSM read + CloudShell only.

No EC2, no SageMaker, no Lambda invocation. Cost: $0.

## Solution (operator notes)

The task asks to **fill** missing values rather than drop rows or columns.
This operation is called **imputation**. Specific strategies include mean
(fill with 51.3), median (fill with 52), KNN imputation, or MICE/multiple
imputation. scikit-learn exposes `SimpleImputer` and `IterativeImputer`; AWS
SageMaker Data Wrangler has a dedicated "Handle missing values" transform.

- Listwise deletion drops rows — reduces dataset size and can introduce bias.
- Adding an is-missing indicator column is a complement to imputation, not a
  replacement.
- Feature removal drops the whole column — only for >80% missing or redundant
  features.

**Exact flag:** `TC{imputation}`

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

Hints: hint-1 (−20 pt) points toward the scikit-learn class name;
hint-2 (−35 pt) names the answer.

## Learning goals

- Name the preprocessing technique that fills missing values as 'imputation'.
- Understand mean, median, KNN, and MICE imputation strategies.
- Know when listwise deletion vs imputation is appropriate (MCAR vs MNAR).
