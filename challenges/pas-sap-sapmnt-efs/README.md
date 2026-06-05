# pas-sap-sapmnt-efs · PAS-C01 · difficulty 4 · $0

## Story

Kato-san's SAP NetWeaver 7.5 design specifies EBS gp3 for `/sapmnt/TEN`, but
the system has 8 instances across two AZs (ASCS/ERS, PAS, 3×AAS, 2×HANA)
that must all concurrently mount the same directory over NFS with full POSIX
semantics. EBS can only attach to one instance at a time (Multi-Attach is
same-AZ-only with no NFS semantics). CTO Sasaki-san asks the new SRE to
identify the correct storage service.

## What gets deployed

- **SSM Parameter** `/{NamePrefix}/briefing` — full SAP NetWeaver system layout
  (8 instances, 2 AZs, instance types, IP ranges), /sapmnt requirements (size,
  consumers, POSIX NFS v4, concurrent access, HA), EBS limitation analysis
  (Multi-Attach restrictions), and four candidate storage services with
  detailed suitability assessments.
- **IAM Role** `ParticipantViewerRole` — SSM read + CloudShell only.

No EC2, no SAP workload, no EFS mount. Cost: $0.

## Solution (operator notes)

The requirement is a POSIX NFS filesystem mountable concurrently by 8 instances
across 2 AZs with multi-AZ HA. **Amazon EFS** is the correct choice:
- Managed NFS v4/v4.1 with full POSIX semantics (uid/gid/permissions/hard links)
- Supports thousands of concurrent mounts across all AZs in a region
- Regional storage class replicates data across ≥3 AZs
- SAP-validated for `/sapmnt` and `/usr/sap/trans`

- EBS: single-instance; Multi-Attach is same-AZ and lacks NFS semantics.
- FSx for Windows: SMB/NTFS only; POSIX not supported on Linux SAP.
- S3: object storage; cannot be POSIX-mounted; not SAP-supported for /sapmnt.

**Exact flag:** `TC{amazon-efs}`

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

Hints: hint-1 (−25 pt) eliminates EBS and prompts toward multi-AZ NFS;
hint-2 (−45 pt) names the answer.

## Learning goals

- Understand that SAP /sapmnt requires a POSIX NFS mount accessible from
  multiple instances across multiple AZs simultaneously.
- Identify Amazon EFS as the AWS-recommended, SAP-validated service for this.
- Apply PAS-C01 SAP storage-selection reasoning (EBS vs EFS vs FSx vs S3).
