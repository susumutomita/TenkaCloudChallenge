# saa-vpc-gateway-endpoint-s3

**Certification:** Solutions Architect Associate (SAA-C03) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Three months into TenkaCloud Inc. Kato-san wired a VPC endpoint so the private subnet can reach S3 without a NAT Gateway. CTO Sasaki-san asks: what type of endpoint is it -- Gateway or Interface? The learner inspects the endpoint and reads `VpcEndpointType`.

## What gets deployed

- `{NamePrefix}-vpc`: VPC (`10.40.0.0/16`).
- `{NamePrefix}-private`: Private subnet (no IGW route).
- `{NamePrefix}-rt-private`: Route table associated with the private subnet.
- `{NamePrefix}-s3-endpoint`: S3 Gateway VPC Endpoint (type: Gateway, free).
- `/{NamePrefix}/briefing`: SSM Parameter with task instructions.

Gateway endpoints are free. No NAT Gateway, no EC2, no EIP -- $0 cost.

## Solution (operator notes)

The key SAA distinction:
- **Gateway endpoint** (S3 / DynamoDB only): modifies the route table, no ENI, **$0**.
- **Interface endpoint** (PrivateLink): creates an ENI, incurs hourly charges.

The endpoint `VpcEndpointType` is `Gateway`. The player must inspect the endpoint to find this.

```bash
aws ec2 describe-vpc-endpoints \
  --filters Name=tag:TenkaCloud:NamePrefix,Values={NamePrefix} \
  --query 'VpcEndpoints[0].VpcEndpointType' --output text
# Returns: Gateway
```

**Flag:** `TC{gateway}` (stored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt** (once per deploy).
- Wrong answer: **-15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (-20 / -40).

## Learning goals

- S3 Gateway endpoint: $0, modifies route table, available only for S3 and DynamoDB.
- Interface endpoint (PrivateLink): hourly charge, creates an ENI, available for most AWS services.
- `describe-vpc-endpoints` returns `VpcEndpointType` as `Gateway` or `Interface`.
