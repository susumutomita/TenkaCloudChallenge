# mla-model-monitor-drift — MLA · flag · difficulty 3 · $0

## Story

Kato-san's demand forecasting model accuracy has declined 6 months after deployment. CTO Sasaki-san wants automated drift detection. The player identifies SageMaker Model Monitor as the capability.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

No SageMaker resources deployed. $0 cost.

## Solution

**Flag:** `TC{model-monitor}`

SageMaker Model Monitor:
1. Enables data capture on the endpoint to record production inference inputs/outputs
2. Runs a baseline job on the training dataset to compute baseline statistics
3. Schedules periodic monitoring jobs that compare current production data statistics against the baseline
4. Raises CloudWatch alarms when drift is detected (mean shift, missing rate change, etc.)

Four monitoring types: data quality, model quality, bias drift, feature attribution drift.

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (points toward Model Monitor vs other SageMaker features)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Understand how SageMaker Model Monitor detects data drift in production
- Explain the baseline → capture → compare → alert workflow
- Know the four Model Monitor monitoring types
