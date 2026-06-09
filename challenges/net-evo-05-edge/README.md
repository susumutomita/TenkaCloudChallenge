# History of the Internet Ep05 — The Wrong Edge

> 日本語版: [README.ja.md](./README.ja.md)
> Part of the **History of the Internet** series (the finale) — each episode re-lives one moment in how the internet evolved, by making you *operate* the network layer rather than recall it. Ep05 covers the **edge / anycast / CDN era**: the layer that decides *where* content is served from.

TenkaCloud Inc. Kato-san is gone, and you — still the new hire — have been handed the last stand.

> Sasaki-san, the CTO: "What we're serving users is stale. Last month's cache. The site is up, every server is running. But go through the edge and everyone gets last year's garbage. The last thing Kato touched was the delivery steering — it's been like this since."

The internet evolved into serving from the nearest edge — CDN, anycast, QUIC — a whole layer that decides *where* content is served from. Your job: work out why the `edge` keeps picking the **wrong origin**, redo the steering, and pull out the flag the real origin is holding.

## Why this problem is not a quiz

The flag is **not** a concept name you type from memory. It is a random per-deploy value that **only `origin-good` knows**, served over HTTP on a private host. The `edge` is steered at the wrong origin, so you cannot read it until you have actually fixed the steering. You earn it by operating AWS, not by recognizing an answer.

## What gets deployed

A single CloudFormation stack, entirely CFn-managed (so `delete-stack` leaves nothing behind):

```text
                          VPC 10.50.0.0/16
┌──────────────────────────────┬──────────────────────────────┐
│  public subnet 10.50.1.0/24   │  private subnet 10.50.2.0/24  │
│  ┌──────────┐   ┌──────────┐  │   ┌────────────┐              │
│  │  relay   │   │   edge   │  │   │ origin-good│  TC{...}      │
│  │ (bastion)│   │  :80     │──┼──►│  :8080     │  (real)      │
│  └────┬─────┘   │ rev-proxy│  │   └────────────┘              │
│   SSM │  curl ─►└────┬─────┘  │   ┌────────────┐              │
│       │             │ picks  │   │origin-stale│  garbage     │
│       ▼          upstream ───┼──►│  :8080     │  (last qtr)  │
│  you steer the edge from SSM │   └────────────┘              │
│  /<prefix>/config/active_origin = "stale"  ◄── the fault     │
└──────────────────────────────┴──────────────────────────────┘
```

- `relay` — t3.micro, public subnet, reachable via **SSM Session Manager** (no SSH key, no inbound port).
- `edge` — t3.micro, public subnet, a tiny **reverse proxy** on `:80`. It re-reads the SSM parameter `/<NamePrefix>/config/active_origin` every 15s and forwards to the selected origin. The proxy is correct; it faithfully serves whichever origin the steering config names.
- `origin-good` — t3.micro, private subnet, **no public IP**, serves the per-deploy flag on `:8080` (`X-Origin: good`).
- `origin-stale` — t3.micro, private subnet, **no public IP**, serves a stale garbage banner on `:8080` (`X-Origin: stale`).
- 3 Security Groups (all correct). The whole network is healthy — **the planted fault is the steering parameter**, set to `stale`.

No CloudFront, no NAT Gateway, no EIP, no ALB. Cost ≈ **$0.10** for a 1-hour session.

## How to play

1. **Get into `relay`** via Session Manager:
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay instance id>
   ```
2. **See the symptom — hit the `edge`:**
   ```bash
   curl -v http://<edge private ip>:80
   ```
   You get the `X-Origin: stale` garbage banner. The response header `X-Edge-Upstream` shows which origin IP the edge is forwarding to.
3. **Verify each origin directly** to find which one is real:
   ```bash
   curl http://<origin-good private ip>:8080    # X-Origin: good  + flag TC{...}
   curl http://<origin-stale private ip>:8080   # X-Origin: stale + garbage
   ```
   The network is healthy and both origins answer. The problem is *which one the edge points at*, not the path.
4. **Read the steering config** (the smoking gun):
   ```bash
   aws ssm get-parameter --name /<NamePrefix>/config/active_origin --query Parameter.Value --output text
   # -> stale
   ```
5. **Rewrite the one setting** (a value change on the existing parameter — you create no new resource):
   ```bash
   aws ssm put-parameter --name /<NamePrefix>/config/active_origin --value good --overwrite
   ```
   Within ~15s the edge refresh loop repoints its upstream to `origin-good`.
6. **Hit the `edge` again** — now it returns `X-Origin: good` and the flag `TC{...}`. Submit it in the Portal.

## Scoring

- Correct: **+300 pt** (once per deploy).
- Wrong submission: **−15 pt** each (score floors at 0).
- Progressive hints carry point penalties (see `metadata.json`).

## Cost

4× t3.micro for ~1h ≈ **$0.10**. No CloudFront / NAT / EIP / ALB. Tear down with `aws cloudformation delete-stack` — everything was created by CloudFormation, so nothing is orphaned.

## Design notes (for authors)

This finale keeps the same three rules as Ep01, applied to the edge layer:

1. **Discovered flag, not a memorized one** — the flag lives only on `origin-good` and is reachable only after you steer the edge correctly.
2. **Fix-by-settings, never create-by-hand** — the template deploys the edge steered at the wrong origin; the solve is *modifying* an existing SSM parameter (`active_origin: stale → good`). Participants never create top-level resources, so `delete-stack` cleans up completely (no orphaned, CFn-unmanaged garbage). No CloudFront / NAT / EIP avoids both cost and orphan risk.
3. **A real "aha", not a flashcard** — "the network is perfectly healthy, but the *origin selection* is wrong" is a genuine CDN-operations skill (origin failback / stale-content triage), experienced by curling each origin and watching `X-Origin` headers, not by reading the answer.

It deliberately does **not** overlap Ep02 (DNS): there is no Route 53, no DNS resolution puzzle. The steering is an explicit reverse-proxy upstream selection driven by a config parameter — the edge/anycast-era analogue.

## Related files

- [`metadata.json`](./metadata.json) — source of truth (catalog + scoring + hints)
- [`template.yaml`](./template.yaml) — one-page CFn template (the deploy body)
