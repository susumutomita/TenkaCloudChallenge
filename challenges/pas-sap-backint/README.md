# pas-sap-backint · PAS-C01 · difficulty 4 · $0

## Story

Kato-san's production S/4HANA 2023 system (u-12tb1.metal, 12 TB) has a backup
design that says "direct to S3 via BACKINT," but the agent configuration file
(`backintConfig.yaml`) is missing, causing every backup job to fail. CTO
Sasaki-san calls at 3 AM to ask what the AWS-certified BACKINT agent is called.

## What gets deployed

- **SSM Parameter** `/{NamePrefix}/briefing` — BACKINT protocol failure log
  with exact timestamps and error messages, explanation of the BACKINT
  Interface, and four candidate AWS backup components with detailed descriptions
  of what each does and why only one qualifies.
- **IAM Role** `ParticipantViewerRole` — SSM read + CloudShell only.

No EC2, no SAP workload, no S3 objects created. Cost: $0.

## Solution (operator notes)

The BACKINT Interface is an SAP standard API for streaming HANA backup data to
external agents. **AWS Backint Agent for SAP HANA** is the SAP-and-AWS
co-certified implementation that:
- Implements BACKINT Interface v2
- Is installed on the HANA host and configured via `backintConfig.yaml`
- Streams data/log/catalog backups directly to an S3 bucket with multipart
  upload, SSE-KMS, and lifecycle support

- AWS Backup: orchestrates EBS snapshots; no HANA BACKINT protocol support.
- Storage Gateway: NFS mount, not a BACKINT agent.
- Amazon Data Provider for SAP: CloudWatch observability only, not backup.

**Exact flag:** `TC{backint}`

CLI one-liner:

```bash
aws ssm get-parameter \
  --name "/${NAME_PREFIX}/briefing" \
  --query Parameter.Value \
  --output text
```

## Scoring

| Event          | Points |
|----------------|--------|
| Correct flag   | +200   |
| Wrong attempt  | −20    |

Hints: hint-1 (−25 pt) points to the BACKINT Interface concept;
hint-2 (−45 pt) names the answer.

## Learning goals

- Understand the SAP HANA BACKINT Interface and how AWS Backint Agent
  implements it for S3-backed backups.
- Distinguish Backint Agent from AWS Backup, Storage Gateway, and Data Provider
  for SAP.
- Apply PAS-C01 SAP HANA backup and recovery architecture reasoning.
