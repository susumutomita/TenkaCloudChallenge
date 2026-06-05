# saa-efs-shared-filesystem — SAA · flag · difficulty 2 · $0

## Story

Kato-san's on-prem NFS server needs to migrate to AWS. CTO Sasaki-san needs
multiple EC2 instances across AZs to concurrently mount and read/write the
same filesystem. A colleague suggests EBS for multiple instances.

## What gets deployed

- SSM Parameter `/{NamePrefix}/briefing` — exam-accurate scenario with POSIX
  shared-filesystem requirement and EBS/S3/FSx-Windows decoys.

No EFS, EC2, or EBS deployed. Cost: **$0**.

## Solution (operator notes)

The requirement is "POSIX-compatible, concurrent mount from multiple EC2 across
AZs." That is **EFS (Elastic File System)** — NFSv4 compatible, auto-scaling,
multi-AZ. EBS is single-attach (with limited Multi-Attach exceptions); S3 is
object storage; FSx for Windows requires SMB.

**Flag:** `TC{efs}`

CLI verify:
```bash
aws ssm get-parameter --name "/${NAME_PREFIX}/briefing" --query Parameter.Value --output text
```

## Scoring

- Correct: +200 pt (once per deploy)
- Wrong answer: -15 pt (anti-brute-force)

## Learning goals

- EFS supports concurrent NFS mount from many EC2s across AZs
- EBS is single-attach (not a shared filesystem in the general case)
- S3 is object storage, not a POSIX filesystem
