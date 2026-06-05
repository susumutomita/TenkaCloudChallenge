# mla-automatic-model-tuning — MLA · flag · difficulty 2 · $0

## Story

Kato-san is manually trying hundreds of hyperparameter combinations for an XGBoost model. CTO Sasaki-san wants automated search. The player identifies SageMaker Automatic Model Tuning (AMT) as the answer.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

No SageMaker resources deployed. $0 cost.

## Solution

**Flag:** `TC{automatic-model-tuning}`

SageMaker Automatic Model Tuning:
- Creates a `HyperParameterTuningJob` with a defined search space
- Uses Bayesian optimization (default), random search, or grid search
- Runs parallel training jobs and uses results to guide next trial selection
- Converges to optimal hyperparameters faster than manual grid/random search
- Objective metric (e.g., `validation:auc`) specified at job creation

## Scoring

- Correct: +150 pt
- Wrong: -15 pt/attempt (anti-brute-force)
- Hint 1: -15 pt (points to Bayesian optimization, not grid search)
- Hint 2: -35 pt (reveals answer)

## Learning goals

- Understand SageMaker AMT Bayesian optimization for hyperparameter search
- Compare AMT efficiency vs manual grid/random search
- Know AMT configuration: search space, objective metric, max training jobs
