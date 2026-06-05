# saa-route53-latency-routing — SAA · flag · difficulty 2 · $0

## Story

Kato-san's service is being expanded globally to three regions. CTO Sasaki-san
needs each user automatically routed to the region with the lowest latency for
them — not by geography, not by weight.

## What gets deployed

- SSM Parameter `/{NamePrefix}/briefing` — exam-accurate scenario with the
  latency-routing requirement and geolocation/weighted decoys.

No Route 53 hosted zone ($0.50/mo) or EC2 deployed. Cost: **$0**.

## Solution (operator notes)

The requirement is "route each user to the region with the lowest network
latency." That is **Latency-based routing**, not Geolocation (which routes by
IP geography) or Weighted (which routes by a fixed ratio).

**Flag:** `TC{latency}`

CLI verify:
```bash
aws ssm get-parameter --name "/${NAME_PREFIX}/briefing" --query Parameter.Value --output text
```

## Scoring

- Correct: +200 pt (once per deploy)
- Wrong answer: -15 pt (anti-brute-force)

## Learning goals

- Latency-based routing uses AWS-measured regional latency, not user geography
- Geolocation routing is a common distractor (routes by IP location, not speed)
- SAA-C03 Route 53 routing-policy selection pattern
