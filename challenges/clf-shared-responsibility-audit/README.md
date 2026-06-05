# clf-shared-responsibility-audit

**Certification:** Cloud Practitioner (CLF-C02) · **Kind:** `flag` · **Difficulty:** 1 · **Cost:** $0

## Story

Day three at TenkaCloud Inc. CTO Sasaki-san needs a compliance audit answer: of the six security tasks Kato-san left behind, how many are the customer's responsibility under the AWS Shared Responsibility Model?

## What gets deployed

One SSM String parameter (`/{NamePrefix}/briefing`) listing six security tasks to classify, plus the ParticipantViewerRole. No EC2, NAT Gateway, or EIP — free tier only.

## Solution (operator notes)

The AWS Shared Responsibility Model splits duties as follows:

| Task | Responsibility |
|------|---------------|
| Patch the guest OS on EC2 instances | **Customer** |
| Configure security group inbound rules | **Customer** |
| Manage the underlying hypervisor | AWS |
| Encrypt data client-side before uploading to S3 | **Customer** |
| Ensure physical security of AWS data centers | AWS |
| Write and attach IAM user policies | **Customer** |

Customer-responsibility tasks: 4 (guest OS patching, SG rules, client-side encryption, IAM policies).

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/briefing" \
  --query Parameter.Value --output text
```

**Flag:** `TC{4-customer-tasks}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+150 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand the boundary between "security OF the cloud" (AWS) and "security IN the cloud" (customer).
- Confirm guest OS patching, SG config, client-side encryption, and IAM policies are always customer tasks.
- Confirm hypervisor management and physical data-center security are always AWS tasks.
