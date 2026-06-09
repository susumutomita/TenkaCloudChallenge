# History of the Internet Ep04 — The Handshake That Never Finishes

> 日本語版: [README.ja.md](./README.ja.md)
> Part of the **History of the Internet** series — each episode re-lives one moment in how the internet evolved, by making you *operate* the TCP/IP layer rather than recall it.

Day four on the network team at TenkaCloud Inc. Suddenly nobody can connect to the internal HTTPS endpoint Kato-san left behind.

> Sasaki-san, the CTO: "`curl` from the bastion (`relay`) to the app's :443 dies in the TLS handshake. Something about the certificate not matching. Kato swore he wired it to generate the cert automatically. The machinery is running. It still gets rejected."

The **SSL → TLS 1.3** moment was when the handshake stopped merely encrypting the channel and got serious about proving the server is *who it claims to be*. Your job is to make that handshake complete. Find why the certificate's name disagrees, fix one setting, and pull out the flag `app` is holding.

## Why this problem is not a quiz

The flag is **not** a concept name you type from memory. It is a random per-deploy value that **only `app` knows**, served over HTTPS and reachable *only after a TLS handshake completes with a matching certificate name*. You earn it by operating AWS, not by recognizing an answer.

## What gets deployed

A single CloudFormation stack, entirely CFn-managed (so `delete-stack` leaves nothing behind):

```text
                       VPC 10.40.0.0/16  (public subnet 10.40.1.0/24)
┌──────────────────────────────────────────────────────────────────────┐
│  ┌──────────┐                                   ┌────────────────────┐ │
│  │  relay   │  SSM ◄── you                       │        app         │ │
│  │ (bastion │                                    │  HTTPS :443 /flag  │ │
│  │ TLS clnt)│ ── TLS https://core.tenka.internal│  cert SAN ◄─ SSM   │ │
│  └──────────┘ ──────────► :443 ─────► handshake  │  tls_server_name   │ │
│      verifies the FIXED name           FAILS:    └────────────────────┘ │
│      core.tenka.internal           SAN ≠ expected name (wrong SSM value) │
└──────────────────────────────────────────────────────────────────────┘
```

- `relay` — t3.micro, public subnet, reachable via **SSM Session Manager** (no SSH key, no inbound port). It is the TLS client; it always verifies the fixed hostname `core.tenka.internal`.
- `app` — t3.micro, **HTTPS :443**, serves a per-deploy flag at `/flag`. It reads `/${NamePrefix}/config/tls_server_name` from SSM at boot and every 30s, then **(re)generates a self-signed leaf certificate** with that name as the SAN, signed by the stack's own CA. A plaintext bootstrap port (`:8080`) publishes the CA at `/ca.pem` so the client can verify the leaf — it **never** serves the flag.
- 2 Security Groups (correct), 2 SSM config parameters: `tls_server_name` (**the planted fault** — ships the wrong name) and `tls_min_version` (a decoy, already correct at `TLSv1.3`).

No NAT Gateway, no EIP, **no ACM certificate**. Cost ≈ **$0.02** for a 45-minute session.

## How to play

1. **Get into `relay`** via Session Manager:
   ```bash
   aws ec2 describe-instances --filters Name=tag:TenkaCloud:NamePrefix,Values=<NamePrefix> \
     --query 'Reservations[].Instances[].{Name:Tags[?Key==`Name`]|[0].Value,Id:InstanceId,Ip:PrivateIpAddress}'
   aws ssm start-session --target <relay instance id>
   ```
2. **From inside `relay`, try the TLS handshake to `app`:**
   ```bash
   /opt/relay/check_tls.sh <app private ip>
   ```
   It **fails** with something like `curl: (60) SSL: no alternative certificate subject name matches target host name 'core.tenka.internal'`. That is the whole puzzle: the channel encrypts fine, but the certificate's *name* is wrong.
3. **Trace why the names disagree** from the SSM config:
   - `relay` verifies the fixed `core.tenka.internal` (CFn Output `ExpectedTlsServerName`, also in the MOTD).
   - The name `app` bakes into the cert comes from SSM:
     ```bash
     aws ssm get-parameter --name /<NamePrefix>/config/tls_server_name --query Parameter.Value --output text
     # -> legacy.kato.example   (Kato-san's leftover — the wrong name)
     ```
   - `tls_min_version` is already `TLSv1.3` — correct. It is a **decoy**; leave it alone.
4. **Fix the one SSM parameter value** (a settings change on the existing parameter — you create no new resource):
   ```bash
   aws ssm put-parameter --name /<NamePrefix>/config/tls_server_name \
     --value core.tenka.internal --type String --overwrite
   ```
5. **Wait ~30s** for `app`'s refresh loop to re-issue the certificate with the matching SAN.
6. **Re-run the handshake** — now the flag `TC{...}` comes back:
   ```bash
   /opt/relay/check_tls.sh <app private ip>
   ```
   Submit it in the Portal.

The task briefing is also in SSM Parameter `/<NamePrefix>/briefing`.

## Scoring

- Correct: **+300 pt** (once per deploy).
- Wrong submission: **−15 pt** each (score floors at 0).
- Progressive hints carry point penalties (see `metadata.json`).

## Cost

2× t3.micro for ~45 min ≈ **$0.02**. No NAT / EIP / ACM. Tear down with `aws cloudformation delete-stack` — everything was created by CloudFormation, so nothing is orphaned.

## Design notes (for authors)

This episode follows the catalog's three design rules, applied to transport security:

1. **Discovered flag, not a memorized one** — the flag is a random per-deploy value, served over HTTPS and reachable only once the TLS handshake succeeds with a matching certificate name.
2. **Fix-by-settings, never create-by-hand** — the template deploys the resources with one wrong SSM value; the solve is *modifying* that existing parameter (`ssm:PutParameter`). The settings-driven `app` regenerates its certificate on a 30s refresh loop, so the fix takes effect without touching code or creating any resource. `delete-stack` cleans up completely (no orphaned, CFn-unmanaged garbage; no ACM cert).
3. **A real "aha", not a flashcard** — "the channel is encrypted but the certificate name doesn't match the host you asked for, so a correct client refuses" is a genuine production TLS skill, experienced by watching a handshake fail, not by reading the answer.

## Related files

- [`metadata.json`](./metadata.json) — source of truth (catalog + scoring + hints)
- [`template.yaml`](./template.yaml) — one-page CFn template (the deploy body)
