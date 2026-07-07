# security-battle-royale — RedTeam content

> Operator-facing. These scripts are what the platform fires against each team's deployed stack to create the "battle" pressure. **Not for unauthorized use against systems you do not own.**

The problem ships a deliberately vulnerable web app (Tenryu.Mart: nginx + Flask API + MySQL on one EC2). Without external pressure, defenders see a passive deploy and learn nothing about patching under fire. This directory holds the **attack catalog** the platform's operator-side attacker invokes on a schedule.

## Attack surface (what's vulnerable)

| Vulnerability | Endpoint | Class |
| --- | --- | --- |
| SQL injection — auth bypass | `POST /api/v1/auth` (`username` / `password` interpolated unquoted) | OWASP A03 |
| SQL injection — data exfil | `POST /api/v1/auth` (same query, UNION-style extraction) | OWASP A03 |
| Public IMDS exposure | EC2 instance metadata `http://169.254.169.254/latest/meta-data/iam/...` — **mitigated in this deploy**: IMDSv2 is enforced (`HttpTokens: required`, hop-limit 1; see the template `MetadataOptions`), so this surface is largely theoretical | OWASP A05 |
| Privilege escalation via `boto3.session` + `get_secret` | The Flask process holds an IAM role that can call `secretsmanager:GetSecretValue` and similar; if an attacker gets RCE or SSRF, they harvest secrets (largely inert in the `LOCAL_DEV=1` deploy — see OPERATOR.md) | OWASP A01 |
| Availability flood | Single EC2, unthrottled Flask — sustained request volume drops the scored endpoints (`/` and `/api/v1/apistatus`) below 200 | OWASP A04 |

See `../api/api.py` for the actual sinks. Each script in `probes/` exercises one surface.

## Scripts

| Script | Surface | Fires |
| --- | --- | --- |
| `probes/sqli-auth-bypass.sh` | `/api/v1/auth` | One auth-bypass attempt; **HTTP 200 = still vulnerable, 403 = patched** (the endpoint returns only a bool, so it gates on status, not body). |
| `probes/sqli-data-exfil.sh` | `/api/v1/auth` | UNION-payload auth-bypass check (same query; **not** real data extraction — `/api/v1/auth` only returns true/false). 200 = vulnerable, 403 = patched. |
| `probes/availability-flood.sh` | both endpoints | 30-second burst of requests; drops uptime-multi score if Flask saturates. |
| `run-attack-cycle.sh` | all of the above | One full cycle. The platform operator-attacker invokes this against `<frontend-url> <api-url>` per team. |

All scripts take `FRONTEND_URL` and `API_URL` as either positional args or env vars.

## How the platform uses this

The platform's operator-side attacker (= a Lambda / Fargate task running under the **operator** AWS account, NOT a team's participant role) sweeps each registered team on a schedule:

```
for team in teams:
  FRONTEND_URL=team.frontend_url \
  API_URL=team.api_url \
  bash battles/security-battle-royale/redteam/run-attack-cycle.sh
```

A failed attack (= defender has patched) leaves the defender's `uptime-multi` score intact. A successful attack (= app crashes / 500s) drops the defender's score. The attacker does not score points directly; the pressure is the gameplay.

The disruption catalog in `../metadata.json` `disruptions[]` declares which of these are wired to the platform's operator-fire UI.

**SQLi scoring is continuous — the SQLi disruptions are visibility probes.** The score pressure for an unpatched SQLi comes from `scoring.attackProbes` in `../metadata.json`, which the score engine fires every tick from the moment a team registers — *not* from these operator-fired shell probes or the disruption schedule. The `sqli-auth-bypass` / `sqli-data-exfil` disruptions let an operator observe/demonstrate a team's state; firing them (or not) does not change the score. Only `availability-flood` delivers a real scheduled fault (a bounded localhost load over SSM with an auto-revert).

## Adding new probes

1. Add a script under `probes/`. Inputs come from `FRONTEND_URL` / `API_URL`. Output one line per attempt with `OK` / `FAIL` / status code.
2. Add an entry to `../metadata.json` `disruptions[]`:
   ```json
   {
     "id": "<short-id>",
     "name": "<human label, JP>",
     "eventDetailType": "AttackFired",
     "operatorEditable": ["afterMinutes"],
     "parameters": {
       "probe": "probes/<your-script>.sh"
     },
     "description": "<what the attack demonstrates>",
     "publicHint": false
   }
   ```
3. Update `run-attack-cycle.sh` if the new probe should fire as part of the default cycle.
4. Test locally with `local/docker-compose.yaml` before committing.

## Safety

These scripts target endpoints scoped by `FRONTEND_URL` / `API_URL`. They have no host discovery, port scanning, or lateral movement. Run only against stacks you own or operate.
