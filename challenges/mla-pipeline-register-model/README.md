# mla-pipeline-register-model — MLA · flag · difficulty 3 · $0

## Story

Kato-san's SageMaker Pipelines workflow is missing the step that versions a trained model into the Model Registry after evaluation. CTO Sasaki-san needs this for CI/CD-triggered deployments. The player identifies the RegisterModel step type.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

No SageMaker resources deployed. $0 cost.

## Solution

**Flag:** `TC{registermodel}`

SageMaker Pipelines RegisterModel step:
- Creates a versioned model package in the SageMaker Model Registry
- Accepts model artifacts from a TrainingStep
- Sets `ModelApprovalStatus` (Approved or PendingManualApproval)
- When approved, EventBridge triggers downstream deployment pipelines (e.g., CodePipeline)

Common pipeline step sequence:
1. `ProcessingStep` -- feature engineering
2. `TrainingStep` -- model training
3. `ProcessingStep` -- model evaluation
4. `ConditionStep` -- check evaluation metrics
5. `RegisterModel` -- register approved model in registry

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (points toward model registry registration, not training)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Understand the SageMaker Pipelines RegisterModel step and its role in MLOps
- Distinguish RegisterModel from TrainingStep, ProcessingStep, ConditionStep
- Know the approval workflow and EventBridge → CI/CD deployment integration
