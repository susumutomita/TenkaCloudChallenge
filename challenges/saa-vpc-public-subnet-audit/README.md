# saa-vpc-public-subnet-audit

**Certification:** Solutions Architect Associate (SAA-C03) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

Week one at TenkaCloud Inc. Ahead of an external audit, CTO Sasaki-san needs one number: of the five subnets Kato-san left behind, how many are actually public? The subnet names are unreliable — the learner must reason from routing.

## What gets deployed

One VPC (`10.20.0.0/16`), an Internet Gateway, five subnets, and two route tables. The **public** route table (`0.0.0.0/0 → IGW`) is associated with `web-a` and `web-b`. The **private** route table (local only) is associated with `app-c`, `data-d`, and `dmz-e`. Subnet Name tags are deliberately misleading (`dmz-e` *sounds* internet-facing but routes private).

All resources are free: no EC2, NAT Gateway, or EIP.

## Solution (operator notes)

A subnet is public **iff** its associated route table has a `0.0.0.0/0` route to an Internet Gateway. Two subnets (`web-a`, `web-b`) qualify. Counting by name gives the wrong answer (3) — that's the planted trap.

```
aws ec2 describe-route-tables --filters Name=vpc-id,Values=<vpcId> \
  --query 'RouteTables[].{rt:RouteTableId,routes:Routes[?GatewayId!=`local`],subnets:Associations[].SubnetId}'
```

**Flag:** `TC{2-public-subnets}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Public subnet = route table with a `0.0.0.0/0` route to an IGW (not a name/CIDR property).
- Judge reachability from routing.
- Read `describe-route-tables` `Associations` / `Routes`.
