# History of the Internet Ep02 — Where the Name Points

> 日本語版: [README.ja.md](./README.ja.md)
> Part of the **History of the Internet** series — each episode re-lives one moment in how the internet evolved, by making you *operate* the TCP/IP layer rather than recall it.

A few weeks into the network team at TenkaCloud Inc. Before Kato-san left, they said: "No more hard-coded IPs. From now on we connect by name." This morning, the internal service that was rebuilt that way stopped connecting.

> Sasaki-san, the CTO: "The monitoring dashboard lost `core`. The bastion (`relay`) calls it by name — `core.internal.tenka.test`, I think. The name resolves, an IP comes back. And still it won't connect. Is Kato's parting gift broken, or was the name lying all along? Figure it out."

The internet evolved from a hand-maintained `hosts.txt` to **DNS** — separating *names* from *addresses*, so an address could change without breaking the name. But what if the name points at the *wrong* address? Your job is to repoint the name at the real `core` and pull out the flag it is holding.

## Why this problem is not a quiz

The flag is **not** a concept name you type from memory. It is a random per-deploy value that **only `core` knows**, served over HTTP on a private host you cannot reach until the name actually resolves to it. You earn it by operating AWS, not by recognizing an answer.

## What gets deployed

A single CloudFormation stack, entirely CFn-managed (so `delete-stack` leaves nothing behind):

```text
            VPC 10.30.0.0/16   ── private hosted zone: internal.tenka.test
┌───────────────────────────┬─────────────────────────────┐
│  public subnet 10.30.1.0/24│  private subnet 10.30.2.0/24 │
│  ┌──────────┐              │            ┌──────────┐     │
│  │  relay   │  SSM ◄───────┼── you      │   core   │     │
│  │ (bastion)│  curl core.internal… ───► │  :8080   │     │
│  └────┬─────┘              │      ▲     └──────────┘     │
│       │ asks DNS:          │      │  but core's A record │
│       │ "core.internal…?"  │      │  answers a BOGUS IP  │
│       └──► 192.0.2.10 (dead)│     │  (192.0.2.10)         │
└───────────────────────────┴──────┴─────────────────────┘
```

- `relay` — t3.micro, public subnet, reachable via **SSM Session Manager** (no SSH key, no inbound port).
- `core` — t3.micro, private subnet, **no public IP**, serves a per-deploy flag on `:8080`.
- private **Route 53 Hosted Zone** `internal.tenka.test` associated to the VPC, with two A records:
  - `relay.internal.tenka.test` → relay's *correct* private IP (a decoy — proves the zone is alive and answering).
  - `core.internal.tenka.test` → **the wrong IP** (`192.0.2.10`, an RFC 5737 test address that is never a live host) — **the planted fault**.
- 2 Security Groups and the network path are **correct**. The fault is purely in DNS.

No NAT Gateway, no EIP. Cost ≈ **$0.02** for a 45–60 minute session (a private hosted zone is $0.50/mo, a few cents prorated).

## How to play

1. **Get into `relay`** via Session Manager:
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay instance id>
   ```
2. **From inside `relay`, call `core` by name:**
   ```bash
   curl -v --max-time 5 http://core.internal.tenka.test:8080
   ```
   The **name resolves** (curl prints an IP it is connecting to) **but it hangs** — not "could not resolve host" (NXDOMAIN) and not "connection refused". That distinction is the whole puzzle: the answer comes back, but it points at the wrong host.
3. **Cross-check what the name returns vs. where `core` really is:**
   ```bash
   dig core.internal.tenka.test +short          # or: getent hosts core.internal.tenka.test
   # -> 192.0.2.10   (a dead RFC 5737 test IP)
   ```
   Then find `core`'s **real** private IP and notice the mismatch:
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     "Name=tag:Name,Values=<NamePrefix>-core" \
     --query 'Reservations[].Instances[].PrivateIpAddress'
   ```
4. **Read the hosted zone** and confirm the bogus record:
   ```bash
   aws route53 list-hosted-zones --query "HostedZones[?Name=='internal.tenka.test.'].Id"
   aws route53 list-resource-record-sets --hosted-zone-id <PrivateHostedZoneId>
   ```
5. **UPSERT the one record** to repoint the name at the real `core` (a settings change on the existing zone — you create no new resource):
   ```bash
   aws route53 change-resource-record-sets --hosted-zone-id <PrivateHostedZoneId> \
     --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{
       "Name":"core.internal.tenka.test","Type":"A","TTL":60,
       "ResourceRecords":[{"Value":"<core real private IP>"}]}}]}'
   ```
6. **Wait out the TTL** (≤ 60 s for the resolver cache) and **call `core` again** — now the name points at the real host and the flag `TC{...}` comes back. Submit it in the Portal.

## Scoring

- Correct: **+300 pt** (once per deploy).
- Wrong submission: **−15 pt** each (score floors at 0).
- Progressive hints carry point penalties (see `metadata.json`).

## Cost

2× t3.micro for ~45–60 min ≈ **$0.02**; a private hosted zone is $0.50/mo (a few cents for one session). No NAT / EIP. Tear down with `aws cloudformation delete-stack` — everything was created by CloudFormation, so nothing is orphaned.

## Design notes (for authors)

This episode keeps the three catalog rules the series is built on:

1. **Discovered flag, not a memorized one** — the flag is a random per-deploy value reachable only after the name resolves to the real `core`.
2. **Fix-by-settings, never create-by-hand** — the template deploys the zone with a wrong A record; the solve is *UPSERT*ing that existing record (`route53:ChangeResourceRecordSets`). Participants never create top-level resources (no `CreateHostedZone`), so `delete-stack` cleans up completely.
3. **A real "aha", not a flashcard** — the NXDOMAIN / refused / *resolves-to-the-wrong-IP* distinction, and cross-checking `dig` output against the real instance IP, is a genuine production DNS skill, experienced by operating Route 53, not by reading the answer.

## Related files

- [`metadata.json`](./metadata.json) — source of truth (catalog + scoring + hints)
- [`template.yaml`](./template.yaml) — one-page CFn template (the deploy body)
