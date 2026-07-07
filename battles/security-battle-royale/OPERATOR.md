# Security Battle Royale — Operator runbook

> Operator-facing. Reading this as a player spoils the hidden attack schedule and the planted vulnerabilities.

Security Battle Royale is an `uptime-multi` Battle. Each team inherits "Tenryu.Mart," an acquired e-commerce app with no handover docs, running `mysql + Flask + nginx` co-tenant on one `t3.small` EC2 (docker compose). The brief is triage under fire: keep the frontend and API returning 200 while the operator-side red team sweeps every team with SQL injection and an availability flood. The scoring rewards *uptime under attack*, not elegant fixes — letting a bad request through is cheap, taking the app offline to harden it is expensive. All top-level resources are CloudFormation-owned; participants harden the app in-place over SSM. There is no `flagOutputKey`, no `phases[]`, and no custom portal plugin — scoring is a two-slot uptime probe plus score-engine SQLi probes.

## Before the event

### Smoke test on a single team stack

Deploy a throwaway team stack. Access is SSM-only (SG opens **80** and **8080**, no SSH, and MySQL 3306 is not exposed). Collect the outputs:

```bash
EC2_HOST="<Ec2HostHint output>"
INSTANCE_ID="<InstanceId output>"
```

The app comes up from EC2 UserData (`dnf` installs docker + git, clones the catalog repo, then `docker compose up -d` on mysql + Flask + nginx — the same `local/docker-compose.yaml` used for local play). Give it a few minutes, then verify the two scored endpoints:

```bash
curl -i "http://$EC2_HOST/"                      # nginx frontend → 200 (Tenryu.Mart page)
curl -i "http://$EC2_HOST:8080/api/v1/apistatus" # Flask API → 200 "CAVS APIs are UP"
```

Confirm the planted vulnerability is live, so the battle actually has pressure. On an unpatched box the SQLi auth-bypass returns **200** (this is exactly what score-engine attack probe A checks):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://$EC2_HOST:8080/api/v1/auth" \
  -H 'Content-Type: application/json' \
  -d '{"username":"'"'"' OR '"'"'1'"'"'='"'"'1'"'"' -- ","password":"x"}'   # → 200 unpatched
```

If a service is missing, inspect the host:

```bash
aws ssm start-session --target "$INSTANCE_ID"    # = the SsmStartSessionCommand output
sudo docker compose ps
sudo docker compose logs api
```

You can dry-run the whole scenario without deploying:

```bash
cd battles/security-battle-royale/local
docker compose up
# frontend http://localhost:80, api http://localhost:8080/api/v1/apistatus
```

### Verify scoring wires

In the platform admin console:

1. Confirm both endpoint slots resolve to **empty** effective URLs from `FrontendUrl` / `ApiUrl` (both ship as `""` — the deploy earns nothing until a team registers, per the Battle participant-action gate, AGENT.md invariant #9).
2. Register `http://<Ec2HostHint>` as the `frontend` override and `http://<Ec2HostHint>:8080` as the `api` override, and confirm scoring starts.
3. Confirm the engine probes `frontend /` and `api /api/v1/apistatus` (both must be 200 to score) once per minute, and that the score-engine SQLi attack probes (below) are enabled.
4. This problem ships **no** custom dashboard slot — the only competitor UI is the portal's generic Endpoint Override panel. Do not expect a bespoke scoreboard component.

### Lock down cross-tenant access (required for multi-team events)

The app deliberately ships an unauthenticated RCE (`/backdoor?cmd=`, `subprocess.run(shell=True)`) and serves 80/8080 to `AllowedCidr` (default `0.0.0.0/0`). Left wide open in a multi-team run, **any team can reach and kill another team's app** — e.g. `curl 'http://<victim-host>:8080/backdoor?cmd=pkill%20-f%20python'` — collapsing the victim's `api` slot and denying their uptime points. The scoring gives no reward for attacking peers, so this is pure griefing, and it is contest-breaking.

The `${NamePrefix}` / IAM isolation only covers the AWS **control plane** (AssumeRole, tag-scoped resource access); it does **not** gate the app's network **data plane**. So before a multi-team event, deploy each team stack with `AllowedCidr` scoped to the platform's **score-engine + operator-attacker egress CIDRs only** (the source IPs that must reach the app to probe/attack). Never run a multi-team event with `AllowedCidr: 0.0.0.0/0`.

## During the event

### Participant path to brief

Participants edit no CloudFormation resources during play; they harden the running app in-place over SSM (and may redeploy with a tighter `AllowedCidr`). The expected path:

1. Grab `Ec2HostHint`, register both slots — scoring is 0 until registered.
2. Keep both endpoints at 200. +100 accrues only on cycles where **both** the frontend and the API answer 200.
3. Patch under fire in the suggested read order (`auth → setdbpwd → dragons → proxy → backdoor`, revealed by scoring hint-3):
   - **Parameterize the SQLi in `POST /api/v1/auth`** (username/password are interpolated unquoted). This is the primary graded fix — patching it stops the two score-engine attack probes from landing their −20 penalties, while `/api/v1/apistatus` stays 200.
   - **Add nginx `limit_req` or scale out** to survive the flood — a single unthrottled Flask process saturates.
   - Optionally tighten `AllowedCidr` (redeploy) to shrink the public surface, and harden the box over SSM.

Design philosophy (from the README): graceful hardening beats perfect hardening. Staying at 200 beats a "correct" fix that causes downtime.

### How the red team fires

The attacker runs under the **operator AWS account** (a Lambda / Fargate task, never any team's participant role) and sweeps each registered team on a schedule with `redteam/run-attack-cycle.sh`. It scores no points; the pressure is the gameplay. The scripts only hit the two supplied URLs — no host discovery, port scan, or lateral movement. All three disruptions are `publicHint: false` (`eventDetailType: AttackFired`) — do not disclose the timings.

| Default fire | id | Delivery | What actually happens | Revert |
| ------------ | -- | -------- | --------------------- | ------ |
| 15 min | `sqli-auth-bypass` | external HTTP probe (`redteam/probes/sqli-auth-bypass.sh`) | `POST /api/v1/auth` with `admin' OR '1'='1' --` | n/a |
| 35 min | `sqli-data-exfil` | external HTTP probe (`redteam/probes/sqli-data-exfil.sh`) | `POST /api/v1/auth` with a UNION-select payload | n/a |
| 55 min | `availability-flood` | SSM `AWS-RunShellScript` on the team's own EC2 (`targetRef: InstanceId`) | bounded `concurrency`-wide × `durationSeconds` curl flood against `localhost:8080/api/v1/apistatus` + `localhost/` | auto `pkill -f 'curl -s -o /dev/null'` after 90 s (ADR-029) |

- `afterMinutes` is operator-editable on all three; `concurrency` (default 50) and `durationSeconds` (default 30) are editable on the flood — tune concurrency to the instance size.
- The two SQLi disruptions realize as *external* HTTP probes; the flood realizes as *localhost* load driven over SSM on the instance itself (not an external flood).
- **Player recovery:** parameterizing the auth query neutralizes both SQLi probes; nginx `limit_req` or scale-out survives the flood; the flood reverts itself after 90 s.

### Score-engine attack probes (separate from the red team schedule)

Independent of the scheduled disruptions, the scoring engine fires two SQLi probes against the registered `api` slot every tick. If the endpoint answers `200` (the injection matched a row), the penalty applies:

| Probe | Request | Vulnerable status | Penalty |
| ----- | ------- | ----------------- | ------- |
| A | `POST /api/v1/auth` `{"username":"' OR '1'='1' -- ","password":"x"}` | 200 | −20 |
| B | `POST /api/v1/auth` `{"username":"admin' UNION SELECT username FROM username -- ","password":"x"}` | 200 | −20 |

These are the **authoritative** measure of whether the SQLi is patched. Note the operator caveat below about the shell probes.

### Watching the room

```bash
TEAM_HOST=<team's registered host>
curl -s -o /dev/null -w '%{http_code}\n' "http://$TEAM_HOST/"                       # frontend
curl -s -o /dev/null -w '%{http_code}\n' "http://$TEAM_HOST:8080/api/v1/apistatus"  # api
```

Run the full operator attack cycle against one team:

```bash
FRONTEND_URL=http://<host> API_URL=http://<host>:8080 \
  bash battles/security-battle-royale/redteam/run-attack-cycle.sh
```

It prints one `OK` / `FAIL` / `ERR` line per probe (auth-bypass → data-exfil → flood) and always exits 0.

**Operator caveat — the SQLi shell probes can mis-report.** `sqli-auth-bypass.sh` / `sqli-data-exfil.sh` gate `FAIL` on the response body containing `username`, but `/api/v1/auth` returns `true` / `false` (200 when a row matches, 403 otherwise) — it never echoes a username. So the shell scripts can print `OK` ("patched") against a still-vulnerable box. Trust the `scoring.attackProbes` verdict (status-200 on the SQLi payload) and the raw `curl … /api/v1/auth` status check from the smoke test, not the shell probe's OK/FAIL line, when deciding whether a team's SQLi is actually fixed.

## Scoring

`kind: uptime-multi`, probed every **1 minute**.

- **+100** per cycle, awarded only when **both** slots return their expected status (`frontend /` → 200, `api /api/v1/apistatus` → 200). `failurePenalty` is **0** (a failed cycle simply pays nothing — no negative for downtime itself).
- **Attack-probe penalties:** each of the two score-engine SQLi probes that lands costs **−20**/cycle until the SQLi is patched (both land off the same fix, so an unpatched box loses −40/cycle but a green cycle still nets +60, not 0 — patching restores the full +100).
- **Scoring hints** cost 0 / 20 / 40 progressively. Hint-3 gives the read order `auth → setdbpwd → dragons → proxy → backdoor`.

## After the event

Delete each team stack:

```bash
aws cloudformation delete-stack --stack-name <team stack name>
```

Everything (VPC / EC2 / IAM roles / SG) is template-owned — participants create no top-level AWS resources in this problem, so `delete-stack` is a clean teardown. There is no auto-teardown; if any resource remains, treat it as a CloudFormation deletion failure and debug the stack events rather than deleting resources by hand.

## Known limitations

- **Prod runs with `LOCAL_DEV=1`.** UserData deploys the same `local/docker-compose.yaml`, which hardcodes `LOCAL_DEV=1` and `DB_HOST=mysql`. As a result `detect_region()` never touches IMDS, the `ssm` client is `None`, and Secrets Manager access is inert — so the "IMDS exposure / secrets priv-esc" surface described in `redteam/README.md` is largely theoretical in this deployment. IMDSv2 is enforced (`HttpTokens: required`, hop limit 1) and the instance role carries only `AmazonSSMManagedInstanceCore`, further capping it. The live, gradeable pressure is the SQLi in `/api/v1/auth` plus the availability flood.
- The app image intentionally ships extra latent sinks for defenders who go deeper: `/backdoor?cmd=` (unauthenticated RCE via `subprocess.run(shell=True)`), `/api/v1/proxy?url=` (SSRF), `/api/v1/setdbpwd` (DB password change), and Flask `DEBUG=True` (Werkzeug debugger / traceback info-leak). None of these are directly probed by the graders — they are optional hardening, not scored gates. Do not surface them to players.
- The `@app.errorhandler` handlers are defined after `app.run(...)`, so they never register; routes that `raise` surface Flask's default 500 debug page. The scored `/api/v1/apistatus` route does not touch the DB, so a DB hiccup does not by itself drop the uptime score.
- MySQL 3306 is not in the security group — the DB is reachable only from inside the box (container network).
- UserData git-clones the catalog repo (`RepoUrl`@`RepoRef`, default `main`) at boot; a repo/network outage at deploy time breaks provisioning. Pin `RepoRef` for reproducibility.
- Cost is small: EC2 `t3.small` over ~90 min is roughly $0.04 (VPC / SG / IGW are free; no ALB / WAF / NAT is deployed). Operator probe egress is negligible. Delete stacks promptly all the same.
