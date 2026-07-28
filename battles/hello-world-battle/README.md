# Hello World Battle (Sample)

> 日本語版: [README.ja.md](./README.ja.md)

The minimal sample for Battle uptime scoring. It deploys nginx (frontend) and Python `http.server` (api) on one EC2, but emits empty `FrontendUrl` and `ApiUrl` Outputs. The Health Check Lambda starts probing only after the competitor registers the URLs in the Participant Portal. While both return 200, the team earns +100 pt per minute.

| Field          | Value                                       |
| -------------- | ------------------------------------------- |
| Category       | Battle (real-time PvP)                      |
| Difficulty     | 1 / 5 (beginner)                            |
| Estimated time | 30 min                                      |
| status         | `ready`                                     |
| Scoring        | `uptime-flat` (`pointsPerSuccess`: 100)     |

## First connection (start here if AWS is new to you)

This is TenkaCloud's 1-1: it teaches the whole Battle loop with no setup beyond signing in. You never create resources by hand — you connect, register a URL, and watch scoring start.

1. Get AWS credentials for your stack — any one of:
   - CloudShell (nothing to install) — open CloudShell in the AWS Console; the AWS CLI + Session Manager plugin are already there. Easiest if you have no local tooling.
   - `aws login` / SSO — if the organizer gave you an IAM Identity Center (SSO) sign-in, run `aws sso login` (or `aws login`) locally to get temporary credentials.
   - Access keys — export the participant credentials you were issued as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`.
2. Connect to the app host with the `SsmStartSessionCommand` Stack Output — no SSH, no key pair:
   ```
   aws ssm start-session --target <InstanceId>
   ```
   Local use needs the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html); CloudShell has it built in.
3. Follow the banner. On connect, the shell prints your next step (register the URL). Do that in the portal and scoring starts — that is the success moment.

> `ssm start-session` is the one genuinely new command here. Everything after it is guided in-shell and in-portal, so you are never left wondering "now what?".

## What you do

Day two at TenkaCloud Inc. You inherited the previous SRE's small production web stack (nginx + Python `/healthz` on one EC2). During the round, the organizer's red team can inject an nginx outage into a selected team's instance.

Your job:

1. After deploy, copy the `Ec2HostHint` Output (= the EC2 public DNS name).
2. In the Participant Portal, paste `http://<host>` into the `frontend` slot override and `http://<host>:8080` into the `api` slot override.
3. From that point on, the Health Check Lambda probes every minute; +100 pt accrues per cycle where both endpoints return 200.
4. When the organizer stops nginx, restore it through SSM Session Manager.

Deploying alone earns nothing. The Battle begins when you register the URLs in the portal.

- Organizer: runs `systemctl stop nginx` on the selected team's EC2.
- Participant: connects through SSM Session Manager and runs `systemctl start nginx`.
- Safety net: a scheduled revert starts nginx again after 10 minutes.

The disruption and recovery stay inside the selected team's EC2.

## What gets deployed

```
┌─────── EC2 t3.micro (Amazon Linux 2023, public IP) ───────┐
│  nginx          :80   → /                                 │
│  python3 http.server :8080 → /healthz                     │
└────────────────────────────────────────────────────────────┘
       ▲
       │ FrontendUrl / ApiUrl Outputs are EMPTY
       │ Competitor overrides URL in portal → probe starts
       │ Both 200 → +100 pt / cycle
```

- Dedicated VPC (`10.99.0.0/16`) + public subnet + IGW
- InstanceRole for SSM Session Manager (`AmazonSSMManagedInstanceCore`)
- `ParticipantViewerRole` (read-only role competitors AssumeRole into for AWS Console)

## Scoring

| State                                                | Per cycle (1 min) |
| ---------------------------------------------------- | ----------------- |
| `FrontendUrl /` and `ApiUrl /healthz` both return 200 | +100 pt           |
| Either is non-200 / times out                        | -100 pt           |

See the `scoring` field in [`metadata.json`](./metadata.json) for the full spec.

## Cost

- EC2 t3.micro charges accrue for the time the instance runs.
- Review current regional pricing for public IPv4 and data transfer.
- Delete the CloudFormation stack after the event.

## Learning goals

- Confirm that TenkaCloud's Battle uptime scoring engine works against real endpoints.
- Experience a minimal EC2 + nginx + Python web stack receiving health-check probes.
- Practice connecting via SSM Session Manager without SSH to start / stop services.

## Related files

- [`metadata.json`](./metadata.json) — problem metadata (source of truth for UI / scoring engine)
- [`template.yaml`](./template.yaml) — one-page CFn template deployed into the competitor account
