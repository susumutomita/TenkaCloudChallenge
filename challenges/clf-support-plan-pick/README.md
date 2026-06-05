# clf-support-plan-pick

**Certification:** Cloud Practitioner (CLF-C02) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

One month in at TenkaCloud Inc. CTO Sasaki-san wants to review the AWS Support plan. Production workloads require a sub-1-hour response when impaired, but Infrastructure Event Management and a dedicated TAM are not needed. Find the cheapest plan that qualifies.

## What gets deployed

One SSM String parameter (`/{NamePrefix}/briefing`) with requirements and a comparison table of all four AWS Support plans, plus the ParticipantViewerRole. No EC2, NAT Gateway, or EIP — free tier only.

## Solution (operator notes)

Requirements filter:
- Production use required → Basic and Developer eliminated (no production SLA)
- Sub-1-hour impaired response → Business (1h) and Enterprise (15 min) qualify
- No dedicated TAM, no IEM included → Enterprise's premium features are unnecessary

**Business** is the cheapest plan that meets all requirements.

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/briefing" \
  --query Parameter.Value --output text
```

**Flag:** `TC{business}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+175 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand the four AWS Support plans (Basic, Developer, Business, Enterprise) and their response-time SLAs.
- Confirm that Business is the cheapest plan with a 1-hour response guarantee for impaired production systems.
- Understand when Enterprise's premium features justify its higher cost.
