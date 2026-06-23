# History of the Internet Ep03 — The Room That Can't Phone Home

> 日本語版: [README.ja.md](./README.ja.md)
> Part of the **History of the Internet** series — each episode re-lives one moment in how the internet evolved, by making you *operate* the TCP/IP layer rather than recall it.

Day three on the network team at TenkaCloud Inc. The monitoring job the previous SRE left behind was supposed to have the management node `core`, deep in a private subnet, reach *out* and bring results back.

> the CTO, the CTO: "core can't get out. License checks, updates — it can't fetch anything. The previous SRE said that once IPv4 ran dry he'd route it out through NAT. The bastion (`relay`) gets out fine. Only `core`, in the back, sits silent."

When IPv4 addresses ran out, the world evolved to **private addresses + NAT** to reach the outside — hiding many hosts behind a single global IP. That's your job: fix the exit. Find why only `core` can't get out, restore egress, and pull out the flag `core` is holding.

## Why this problem is not a quiz

The flag is **not** a concept name you type from memory. It is a random per-deploy value `core` can only obtain by *reaching out through the NAT to the internet and back*. Until you actually restore egress, `core` serves `NO EGRESS` and there is nothing to copy. You earn the flag by operating AWS, not by recognizing an answer.

## What gets deployed

A single CloudFormation stack, entirely CFn-managed (so `delete-stack` leaves nothing behind):

```text
                         VPC 10.30.0.0/16
┌─────────────────────────────────────┬─────────────────────────────┐
│  public subnet 10.30.1.0/24          │  private subnet 10.30.2.0/24 │
│  ┌──────────┐   ┌──────────┐         │           ┌──────────┐       │
│  │  relay   │   │   nat    │── IGW ──┼──► internet│   core   │       │
│  │ (bastion)│   │MASQUERADE│◄────────┼── flag ────│ (no pub) │       │
│  └────┬─────┘   └────▲─────┘         │     ▲      └────┬─────┘       │
│   SSM │ you          │  default route │     │  curl :8080 (NO EGRESS)│
│       └── curl :8080 ─────────────────┼─────┘           │            │
│                      ╳ MISSING: 0.0.0.0/0 → nat on the private RT     │
└─────────────────────────────────────┴─────────────────────────────┘
```

- `nat` — t3.micro, public subnet, **SourceDestCheck disabled** + `iptables` **MASQUERADE** in UserData. A home-grown NAT (no NAT Gateway, no EIP — it just uses its auto-assigned public IP). It also serves the flag on `:80`, reachable only from a host that has working egress.
- `relay` — t3.micro, public subnet, reachable via **SSM Session Manager** (no SSH key, no inbound port).
- `core` — t3.micro, private subnet, **no public IP**. A loop tries to fetch the flag from the NAT's public IP every 15s; it serves the result on `:8080` (`NO EGRESS` until egress is restored).
- 3 Security Groups (all correct), and a private route table **missing its default route** (**the planted fault**).

No NAT Gateway, no EIP. Cost ≈ **$0.04** for a 1-hour session (3× t3.micro).

## How to play

1. **Get into `relay`** via Session Manager:
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay instance id>
   ```
2. **From inside `relay`, try to reach `core`:**
   ```bash
   curl --max-time 5 http://<core private ip>:8080
   ```
   It returns **`NO EGRESS`** — `core` is up and answering, but it cannot reach the outside, so it has no flag to serve. That's the puzzle: the SG is open, the NAT is healthy, yet `core` can't get out.
3. **Bisect the layers** with `describe-*` to see why `relay` gets out but `core` doesn't:
   - Security Group on `core` → egress is open. Not the fault.
   - NAT instance → `nat` runs with **SourceDestCheck disabled** and `iptables` MASQUERADE. Healthy. Not the fault.
   - **Route table** → compare the two:
     ```bash
     aws ec2 describe-route-tables \
       --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
       --query 'RouteTables[].{Id:RouteTableId,Routes:Routes}'
     ```
     The **public** table has `0.0.0.0/0 → igw-…`. The **private** table has only the `local` route — **no default route**. A private host with no default route has nowhere to send outbound packets.
4. **Add the one missing route** (a settings change on the existing route table — you create no new resource):
   ```bash
   aws ec2 create-route --route-table-id <PrivateRouteTableId> \
     --destination-cidr-block 0.0.0.0/0 \
     --instance-id <NatInstanceId>
   ```
   `NatInstanceId` is a CFn Output (or find `${NamePrefix}-nat` via `describe-instances`). You can also target the NAT's ENI with `--network-interface-id <eni-…>`.
5. **Reach `core` again** — `core`'s loop retries egress every 15s, so wait ~10–20s, then:
   ```bash
   curl http://<core private ip>:8080
   ```
   This time `core` has phoned home through the NAT and the flag `TC{...}` comes back. Submit it in the Portal.

## Scoring

- Correct: **+300 pt** (once per deploy).
- Wrong submission: **−15 pt** each (score floors at 0).
- Progressive hints carry point penalties (see `metadata.json`).

## Cost

3× t3.micro for ~1h ≈ **$0.04**. **No NAT Gateway, no EIP** — the NAT is a plain EC2 using its auto-assigned public IP, which is what keeps this in the cents range. Tear down with `aws cloudformation delete-stack` — everything was created by CloudFormation, so nothing is orphaned.

## Design notes (for authors)

This problem follows the same three rules as Ep01, applied to the egress / routing layer:

1. **Discovered flag, not a memorized one** — the flag lives on the NAT's internet-facing side and is reachable only *through* a working NAT path. `core` cannot fetch it (and therefore cannot serve it) until the default route exists.
2. **Fix-by-settings, never create-by-hand** — the template deploys the private route table in a broken state (default route omitted); the solve is *adding one route* to that existing table via `ec2:CreateRoute`. Participants never create top-level resources, so `delete-stack` cleans up completely (no orphaned, CFn-unmanaged garbage).
3. **A real "aha", not a flashcard** — the IPv4-exhaustion → NAT story is the reason private subnets need a default route to a NAT at all. Experiencing a private host that *can't phone home*, and fixing it with one route, is a genuine production skill.

The flag literal transits each instance's UserData, so the participant role explicitly **Denies `ec2:DescribeInstanceAttribute`** — the only path to the flag is restoring egress and reading it off `core`.

## Related files

- [`metadata.json`](./metadata.json) — source of truth (catalog + scoring + hints)
- [`template.yaml`](./template.yaml) — one-page CFn template (the deploy body)
