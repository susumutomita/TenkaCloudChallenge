# scs-sg-open-port-audit

**Certification:** Security Specialty (SCS-C02) / SAA-C03 · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

Day ten at TenkaCloud Inc. GuardDuty fires a High `UnauthorizedAccess` finding at midnight. One of four security groups has a remote-admin port wide open to the internet — Kato-san opened it to test and forgot to close it. Which port?

## What gets deployed

One VPC and four security groups modeling a 3-tier app:

| SG | Ingress | Verdict |
| --- | --- | --- |
| `sg-alb` | 80, 443 from `0.0.0.0/0` | fine (public web) |
| `sg-app` | 8080 from `10.30.0.0/16` | fine (VPC-internal) |
| `sg-bastion` | 22 from `203.0.113.0/24` | fine (corp CIDR) |
| `sg-db` | 5432 from VPC + **3389 from `0.0.0.0/0`** | **the planted misconfig** |

All resources are free: no EC2, NAT, or EIP.

## Solution (operator notes)

Exactly one remote-administration port (RDP `3389`) faces the whole internet. `80`/`443` are public-web ports and are expected — discriminating them is the lesson.

```
aws ec2 describe-security-groups \
  --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
  --query 'SecurityGroups[].IpPermissions[?contains(IpRanges[].CidrIp, `0.0.0.0/0`)].[FromPort]'
```

**Flag:** `TC{port-3389}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Extract ports open to `0.0.0.0/0` from security-group ingress.
- Distinguish acceptable public ports (80/443) from admin ports that must never face the internet (22/3389).
- Read `describe-security-groups` `IpPermissions` / `IpRanges`.
