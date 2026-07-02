# Hello Multicloud — Composite Runtime Smoke Test

> TenkaCloud Challenge · `challenges/hello-multicloud` · difficulty 1 · ~10 min · `composite-probe` scoring

Hello Multicloud is the smallest end-to-end sample for TenkaCloud Composite Runtime.
One problem definition fans out to an AWS Lambda Function URL and a Google Cloud Run
service. The scorer awards points only when both endpoints answer HTTP 200.

This problem is currently a **draft**. The platform can normalize and execute composite
targets, but catalog-side staging of `gcp/terraform/` to the GCS URI required by Google
Cloud Infrastructure Manager is not automated yet. Do not schedule this problem in an
event until that staging path is complete and live-deploy tested.

## What gets deployed

| Target | Provider / engine | Resource |
| --- | --- | --- |
| `aws-hello` | AWS / CloudFormation | Lambda Function URL returning a static hello |
| `gcp-hello` | GCP / Infrastructure Manager | Scale-to-zero Cloud Run hello service |

The AWS target stays inside the Lambda free tier. The GCP target caps itself at one
instance and scales to zero, keeping normal smoke-test traffic inside the Cloud Run free
tier.

## Prerequisites

- Per-team GCP WIF configuration: audience, service account email, project ID, and region.
- The platform `nonAwsRuntime` feature flag.
- A GCS-staged copy of `gcp/terraform/`; Infrastructure Manager requires a `gs://` source.
- A GCP project whose organization policy permits public Cloud Run invocation.

## Player flow

1. Deploy `hello-multicloud`.
2. Wait for both `aws-hello` and `gcp-hello` to reach `COMPLETE`.
3. Read each target's namespaced outputs.
4. `curl` both URLs and confirm that each returns HTTP 200.
5. The `composite-probe` scorer awards 100 points only while both targets are healthy.

## Scoring

`scoring.kind` is `composite-probe` with `success: all`. The scorer resolves
`AwsHelloUrl` from the AWS target and `GcpHelloUrl` from the GCP target. A missing,
failed, or unhealthy target prevents the award.

## Cleanup

Composite teardown must remove both the CloudFormation stack and the Infrastructure
Manager deployment. Confirm both target rows reach their terminal deleted state.

## Cost

Expected cost is effectively zero under the Lambda and Cloud Run free tiers. GCP project,
logging, or organization-level charges remain the operator's responsibility.

## Related files

- `metadata.json` — composite runtime and scoring contract
- `template.yaml` — AWS target
- `gcp/terraform/main.tf` — GCP target source pending GCS staging automation
