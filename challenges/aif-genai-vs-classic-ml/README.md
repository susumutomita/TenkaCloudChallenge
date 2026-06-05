# aif-genai-vs-classic-ml

**Certification:** AI Practitioner (AIF-C01) · **Kind:** `flag` · **Difficulty:** 1 · **Cost:** $0

## Story

Two months into TenkaCloud Inc.'s AI team. Four product proposals land on the desk: demand forecasting, churn classification, customer clustering, and drafting marketing copy. CTO Sasaki-san asks the player to classify which is best for generative AI vs. classic ML, and identify the one generative AI task.

## What gets deployed

One SSM String parameter (`/{NamePrefix}/briefing`) with detailed descriptions of all four tasks plus the classification axis, plus the ParticipantViewerRole. No EC2, NAT Gateway, or actual ML models — free tier only.

## Solution (operator notes)

| Task | Type | Why |
|------|------|-----|
| forecast-demand | Classic ML | Structured time-series → regression/forecasting model |
| classify-churn | Classic ML | Labeled tabular data → binary classification model |
| cluster-customers | Classic ML | Unlabeled structured data → unsupervised clustering |
| **draft-marketing-copy** | **Generative AI** | Natural language generation from a text brief |

The key distinction: tasks A/B/C all produce structured outputs (numbers, labels, cluster IDs) from structured inputs using labeled/unlabeled data. Task D produces natural language content from a text brief — the hallmark of generative AI.

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/briefing" \
  --query Parameter.Value --output text
```

**Flag:** `TC{draft-marketing-copy}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+150 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand the different strengths of generative AI (text/image/code generation) vs. classic ML (prediction, classification, clustering).
- Confirm that drafting marketing copy is a canonical generative AI use case.
- Distinguish why demand forecasting, churn classification, and customer clustering are better suited for classic ML.
