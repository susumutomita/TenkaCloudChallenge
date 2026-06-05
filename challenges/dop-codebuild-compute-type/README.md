# dop-codebuild-compute-type

**DOP-C02 · flag · difficulty 3 · $0**

## Story

Kato-san left a CodeBuild project whose environment settings are unknown.
CTO Sasaki-san needs to know which compute type it uses before anyone runs a build.
The learner reads the project configuration and reports the compute type.

## What gets deployed

- IAM role (CodeBuild service role)
- CodeBuild project (`{NamePrefix}-build`, source: NO_SOURCE, ComputeType: BUILD_GENERAL1_SMALL) — never run
- SSM Parameter `/{NamePrefix}/briefing` (task description)

No builds are executed. Cost: $0.

## Solution

The flag is `TC{build-general1-small}`.

**CLI verification:**

```bash
aws codebuild batch-get-projects --names <NamePrefix>-build \
  --query 'projects[0].environment.computeType'
# Returns: "BUILD_GENERAL1_SMALL"
```

Convert to lower-case hyphenated: `build-general1-small` → submit `TC{build-general1-small}`.

## Scoring

- Correct: +200 pt
- Wrong: -20 pt per attempt (brute-force deterrent)

## Learning goals

1. Read `environment.computeType` via `aws codebuild batch-get-projects`
2. Understand how CodeBuild compute type selection affects CI cost
3. Grasp CodeBuild project environment structure (ImageId / ComputeType / EnvironmentType)
