# History of the Internet Ep01 — The Packet That Never Arrives

> 日本語版: [README.ja.md](./README.ja.md)
> Part of the **History of the Internet** series — each episode re-lives one moment in how the internet evolved, by making you *operate* the TCP/IP layer rather than recall it.

Day one on the network team at TenkaCloud Inc. The internal tool the previous SRE left behind ran across two subnets — supposedly.

> the CTO, the CTO: "You can get into the bastion (`relay`). But nobody can reach the management node (`core`) behind it. The previous SRE swore the firewall was open. It still won't connect. No error — it just hangs, silent."

The word *internet* comes from *inter-network*: connecting separate networks. That's your job. Find why packets vanish one-way, restore the path, and pull out the flag `core` is holding.

## Why this problem is not a quiz

The flag is **not** a concept name you type from memory. It is a random per-deploy value that **only `core` knows**, served over HTTP on a private host you cannot reach until you have actually fixed the network. You earn it by operating AWS, not by recognizing an answer.

## What gets deployed

A single CloudFormation stack, entirely CFn-managed (so `delete-stack` leaves nothing behind):

```text
            VPC 10.20.0.0/16
┌───────────────────────────┬───────────────────────────┐
│  public subnet 10.20.1.0/24│  private subnet 10.20.2.0/24│
│  ┌──────────┐              │            ┌──────────┐    │
│  │  relay   │  SSM ◄───────┼── you      │   core   │    │
│  │ (bastion)│  ── curl ───►│  :8080 ────► (flag)   │    │
│  └──────────┘              │      ▲     └──────────┘    │
│   IGW route                │      │  Network ACL drops  │
│                            │      │  the RETURN packet  │
└───────────────────────────┴──────┴────────────────────┘
```

- `relay` — t3.micro, public subnet, reachable via **SSM Session Manager** (no SSH key, no inbound port).
- `core` — t3.micro, private subnet, **no public IP**, serves a per-deploy flag on `:8080`.
- 2 Security Groups (correct), 1 Network ACL on the private subnet (**the planted fault**).

No NAT Gateway, no EIP. Cost ≈ **$0.02** for a 45-minute session.

## How to play

1. **Get into `relay`** via Session Manager:
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay instance id>
   ```
2. **From inside `relay`, try to reach `core`:**
   ```bash
   curl -v --max-time 5 http://<core private ip>:8080
   ```
   It **hangs** (timeout) — not "connection refused". That distinction is the whole puzzle: the request is arriving, the reply is not.
3. **Bisect the four reachability layers** with `describe-*`:
   - Security Group on `core` → allows 8080 from `relay`, and is **stateful** (reply auto-allowed). Not the fault.
   - Route table → same VPC, local route delivers it. Not the fault.
   - Subnet → same VPC. Not the fault.
   - **Network ACL** on the private subnet → read it. A NACL is **stateless**: inbound and outbound are separate, and return traffic is *not* auto-allowed.
4. **Add the one missing rule** (a settings change on the existing NACL — you create no new resource):
   ```bash
   aws ec2 create-network-acl-entry --network-acl-id <PrivateNaclId> \
     --rule-number 110 --protocol 6 --egress \
     --cidr-block 10.20.1.0/24 --port-range From=1024,To=65535 --rule-action allow
   ```
5. **Reach `core` again** — now the flag `TC{...}` comes back. Submit it in the Portal.

## Scoring

- Correct: **+300 pt** (once per deploy).
- Wrong submission: **−15 pt** each (score floors at 0).
- Progressive hints carry point penalties (see `metadata.json`).

## Cost

2× t3.micro for ~45 min ≈ **$0.02**. No NAT / EIP. Tear down with `aws cloudformation delete-stack` — everything was created by CloudFormation, so nothing is orphaned.

## Design notes (for authors)

This problem is the reference implementation for three rules the catalog is moving toward:

1. **Discovered flag, not a memorized one** — the flag is a random per-deploy value reachable only by performing the intended AWS operation.
2. **Fix-by-settings, never create-by-hand** — the template deploys the resources in a broken state; the solve is *modifying* an existing resource (one NACL entry). Participants never create top-level resources, so `delete-stack` cleans up completely (no orphaned, CFn-unmanaged garbage).
3. **A real "aha", not a flashcard** — the stateful-SG / stateless-NACL / hang-vs-refused distinction is a genuine production skill, experienced by watching packets, not by reading the answer.

## Related files

- [`metadata.json`](./metadata.json) — source of truth (catalog + scoring + hints)
- [`template.yaml`](./template.yaml) — one-page CFn template (the deploy body)
