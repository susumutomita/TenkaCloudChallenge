# Hello Multicloud — Four-provider Composite Runtime smoke test

> TenkaCloud Challenge · `challenges/hello-multicloud` · difficulty 1 · ~10 min ·
> `composite-probe` scoring

Hello Multicloud is the smallest four-provider sample for TenkaCloud Composite Runtime.
One problem definition fans out to AWS, Google Cloud, Azure, and Sakura Cloud. The scorer
awards points only when all four endpoints return HTTP 200.

This problem is a **draft**. Do not schedule it for an event until the non-AWS credentials,
GCP source staging, and one-time live deployment checks are complete.

## What gets deployed

| Target | Provider / engine | Resource | Scored route |
| --- | --- | --- | --- |
| `aws-hello` | AWS / CloudFormation | Lambda Function URL | `AwsHelloUrl` + `/` |
| `gcp-hello` | GCP / Infrastructure Manager | Scale-to-zero Cloud Run service | `GcpHelloUrl` + `/` |
| `azure-hello` | Azure / Bicep | Scale-to-zero Container App | `AzureHelloUrl` + `/healthz` |
| `sakura-hello` | Sakura Cloud / AppRun | Scale-to-zero AppRun application | `BaseUrl` + `/healthz` |

The Azure and Sakura targets run the same digest-pinned workload. That workload's public
readiness contract is `GET /healthz`; the challenge does not claim that its root route
returns the AWS/GCP hello payload.

## Prerequisites

- Per-team GCP WIF, Azure, and Sakura Cloud deployment credentials.
- Platform-side support for the non-AWS composite runtime adapters.
- A GCS-staged copy of `gcp/terraform/`; Infrastructure Manager requires a `gs://` source.
- Cloud policies that permit the anonymous HTTPS probes declared by this sample.

## Player flow

1. Deploy `hello-multicloud`.
2. Wait for `aws-hello`, `gcp-hello`, `azure-hello`, and `sakura-hello` to reach `COMPLETE`.
3. Read the namespaced output for each target.
4. Probe `/` on the AWS and GCP URLs, and `/healthz` on the Azure and Sakura URLs.
5. Confirm that every request returns HTTP 200.

## Scoring

`scoring.kind` is `composite-probe` with `success: all`. The metadata binds each target to
its real output key and HTTP path. A missing, failed, or unhealthy target prevents the
100-point award.

## Simulator overlay

`simulation.json` adds only the Sakura data-plane behavior that cannot be derived from
`sakura/application.json`: HTTP `Request` and scoring `Probe`, plus the digest-pinned
workload bound to `BaseUrl`. The AWS, GCP, and Azure requirements remain derived from IaC.

## Cleanup and cost

Composite teardown must remove all four target deployments. The resources scale to zero
or use request-based billing, but cloud account, logging, and organization-level charges
remain the operator's responsibility.

## Related files

- `metadata.json` — composite runtime and scoring contract
- `template.yaml` — AWS target
- `gcp/terraform/main.tf` — GCP target
- `azure/main.bicep` — Azure target
- `sakura/application.json` — Sakura AppRun target
- `simulation.json` — minimal Sakura-only simulation overlay
