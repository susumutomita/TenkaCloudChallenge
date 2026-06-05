# saa-elb-type-pick — SAA · flag · difficulty 2 · $0

## Story

Kato-san left an architecture document with the load-balancer type blank.
CTO Sasaki-san needs the right ELB for URL-path routing, WebSocket support,
and HTTP/HTTPS — and a colleague is suggesting the wrong one.

## What gets deployed

- SSM Parameter `/{NamePrefix}/briefing` — exam-accurate scenario describing
  the layer-7 routing and WebSocket requirements.

No EC2, ELB, or NAT Gateway deployed. Cost: **$0**.

## Solution (operator notes)

The briefing requires layer-7 (HTTP/HTTPS) routing with path-based rules and
WebSocket. That maps unambiguously to **Application Load Balancer (ALB)**.

**Flag:** `TC{application-load-balancer}`

CLI verify:
```bash
aws ssm get-parameter --name "/${NAME_PREFIX}/briefing" --query Parameter.Value --output text
```

## Scoring

- Correct: +200 pt (once per deploy)
- Wrong answer: -15 pt (anti-brute-force)

## Learning goals

- ALB operates at layer 7; NLB at layer 4 (TCP/UDP)
- Path-based routing and WebSocket support require ALB
- SAA-C03 ELB-type selection pattern
