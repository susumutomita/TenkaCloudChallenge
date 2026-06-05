# saa-dr-strategy-pick — SAA · flag · difficulty 3 · $0

## Story

Kato-san started evaluating DR strategies and quit. CTO Sasaki-san needs a
DR plan with RTO ~10 min, RPO ~1 min, cost-sensitive, using a scaled-down
but fully functional standby always running in a second region.

## What gets deployed

- SSM Parameter `/{NamePrefix}/briefing` — exam-accurate DR scenario with
  RTO/RPO requirements and Backup-Restore/Pilot-Light/Multi-Site decoys.

No EC2, RDS, or DR environment deployed. Cost: **$0**.

## Solution (operator notes)

The scenario describes a **scaled-down but fully functional** standby always
running — scale up to full on failure. That is **Warm Standby**.

- Backup & Restore: RTO hours, not minutes
- Pilot Light: minimal core only (not fully functional)
- Multi-Site/Active-Active: full scale, maximum cost
- **Warm Standby**: scaled-down full copy, RTO ~10 min, RPO ~minutes ✓

**Flag:** `TC{warm-standby}`

CLI verify:
```bash
aws ssm get-parameter --name "/${NAME_PREFIX}/briefing" --query Parameter.Value --output text
```

## Scoring

- Correct: +200 pt (once per deploy)
- Wrong answer: -15 pt (anti-brute-force)

## Learning goals

- Four DR strategies ranked by cost and RTO/RPO
- Warm Standby vs Pilot Light: fully functional copy vs minimal core only
- SAA-C03 DR strategy selection pattern
