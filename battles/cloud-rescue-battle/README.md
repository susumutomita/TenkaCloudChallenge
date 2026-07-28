# Cloud Rescue Battle

> 日本語版: [README.ja.md](./README.ja.md)

A team-based incident-response Battle. Register the nginx frontend and Python API in the Participant Portal to start continuous scoring. The operator can inject a frontend or API outage into one team at a time.

## Learning goals

- Narrow an outage to the frontend or API from external probe results
- Connect through SSM Session Manager and inspect systemd and journal evidence
- Restore the failed service and confirm recovery externally
- Reuse the investigation process when the incident recurs

## Flow

1. Read `Ec2HostHint` from the stack outputs.
2. Register `http://<host>` as the frontend and `http://<host>:8080` as the API.
3. Confirm both probes return HTTP 200 and scoring starts.
4. After an injected outage, connect with `SsmStartSessionCommand`.
5. Identify and restore the stopped service.
6. Confirm the Portal probe succeeds again.

## Fault injection

- `frontend-down`: stops nginx and automatically reverts after ten minutes.
- `api-down`: stops `tenkacloud-api` and automatically reverts after ten minutes.

Every action stays inside one EC2 in the target team account. SSH is not exposed.
