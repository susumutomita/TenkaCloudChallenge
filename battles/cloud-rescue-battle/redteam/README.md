# Cloud Rescue Battle operator guide

> 日本語版: [README.ja.md](./README.ja.md)

This document is for the operator or red team. Participants should not receive it before the Battle.

## Disruption catalog

| ID | Target | Action | Participant symptom | Automatic revert |
| --- | --- | --- | --- | --- |
| `frontend-down` | Target team EC2 | `systemctl stop nginx` | frontend probe fails while API can remain healthy | starts nginx after 600 seconds |
| `api-down` | Target team EC2 | `systemctl stop tenkacloud-api` | API probe fails while frontend can remain healthy | starts the API after 600 seconds |

## Targeting discipline

- Fire a disruption only after the target team has registered both endpoints and received an initial successful score.
- Select exactly one team and verify the resolved `InstanceId` belongs to that team before execution.
- Do not modify Security Groups, IAM, VPC resources, or another team's account.
- Do not fire the same disruption repeatedly while its previous revert is pending.
- Record the team, disruption ID, execution time, command result, and scheduled revert time.

## Recovery path

Participants recover through SSM Session Manager. They should inspect evidence before restarting a service. Typical checks are:

```bash
systemctl status nginx tenkacloud-api
journalctl -u nginx -u tenkacloud-api --no-pager -n 50
```

The intended recovery commands are:

```bash
sudo systemctl start nginx
sudo systemctl start tenkacloud-api
```

The operator verifies recovery from the Participant Portal probes rather than trusting the command exit status alone.

## Safety and abort conditions

Every disruption schedules an automatic revert after ten minutes. Stop further injections and manually run the relevant start command when:

- SSM command execution fails or remains pending
- the wrong team or instance was selected
- both endpoints fail after a single-service disruption
- the automatic revert was not scheduled
- the participant cannot establish an SSM session

All actions must remain inside the selected team's EC2 instance.
