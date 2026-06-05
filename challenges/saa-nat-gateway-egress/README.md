# saa-nat-gateway-egress — SAA · flag · difficulty 3 · $0

## Story

Kato-san's private-subnet EC2 instances can't run OS updates because there is
no outbound internet path. CTO Sasaki-san needs outbound access with zero
inbound connections from the internet. A colleague says "just use an IGW."

## What gets deployed

- SSM Parameter `/{NamePrefix}/briefing` — exam-accurate scenario with
  IGW (bidirectional) and Egress-Only IGW (IPv6-only) as decoys.

No NAT Gateway (hourly billing), EC2, or EIP deployed. Cost: **$0**.

## Solution (operator notes)

The requirement is outbound-only IPv4 internet from a private subnet. That is
**NAT Gateway** — placed in a public subnet, private route table points
`0.0.0.0/0` at it. The internet cannot initiate inbound connections through it.

- Internet Gateway: bidirectional — not suitable for private-subnet isolation
- Egress-Only IGW: IPv6 only — wrong address family
- **NAT Gateway**: outbound-only IPv4, placed in public subnet ✓

**Flag:** `TC{nat-gateway}`

CLI verify:
```bash
aws ssm get-parameter --name "/${NAME_PREFIX}/briefing" --query Parameter.Value --output text
```

## Scoring

- Correct: +200 pt (once per deploy)
- Wrong answer: -15 pt (anti-brute-force)

## Learning goals

- NAT Gateway provides outbound-only IPv4 internet for private-subnet instances
- Internet Gateway allows bidirectional traffic (wrong for private subnets)
- Egress-Only Internet Gateway is IPv6-only
