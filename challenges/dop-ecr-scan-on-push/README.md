# dop-ecr-scan-on-push

**DOP-C02 · flag · difficulty 2 · $0**

## Story

Kato-san left an ECR repository whose scan configuration is unknown.
CTO Sasaki-san wants to confirm whether automatic CVE scanning triggers on image push,
and what that setting is called.
The learner reads the repository's imageScanningConfiguration and reports the setting name.

## What gets deployed

- ECR repository `{NamePrefix}-app` with `ImageScanningConfiguration.ScanOnPush: true`
- SSM Parameter `/{NamePrefix}/briefing` (task description)

No images are pushed. Cost: $0.

## Solution

The flag is `TC{scan-on-push}`.

**CLI verification:**

```bash
aws ecr describe-repositories --repository-names <NamePrefix>-app \
  --query 'repositories[0].imageScanningConfiguration'
# Returns: {"scanOnPush": true}
# The setting name: scan-on-push
```

## Scoring

- Correct: +150 pt
- Wrong: -15 pt per attempt

## Learning goals

1. Verify ECR ScanOnPush setting via Console and CLI (`describe-repositories`)
2. Understand how ScanOnPush enables automatic CVE detection without wiring scanning into CI/CD
3. Distinguish ECR Basic scan from Enhanced scan (Amazon Inspector)
