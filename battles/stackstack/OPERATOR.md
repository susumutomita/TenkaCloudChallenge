# StackStack — Operator runbook

> Operator-facing. Reading this as a player spoils the disruption schedule.

This runbook covers what an event-day operator needs to know to run StackStack across 6 competing teams.

## Before the event

### Smoke test on a single team stack

Deploy the stack against a throwaway team account, then verify:

```bash
# Replace with stack outputs:
BASE_URL="http://<EC2 public DNS>"

for slot in auth network rate audit ux; do
  echo "=== /$slot/meta ==="
  curl -s "$BASE_URL/$slot/meta" | jq .
  echo "=== /$slot/score ==="
  curl -s "$BASE_URL/$slot/score" | jq .
done
```

Expected for every slot:

```json
{"platform": "ec2", "slot": "<slot-name>"}
{"ok": true, "slot": "<slot-name>"}
```

If any slot returns a 404 / 502 / non-`ec2` platform, the UserData heredoc failed silently — SSM into the instance and inspect `journalctl -u tenkacloud-slot-<slot>`.

### Verify scoring engine wires

In the platform admin console:

1. Register the 6 team stacks under the StackStack problem.
2. Confirm the score engine logs 5 slot probes per team per minute.
3. Confirm the dashboard `StatusPanel.tsx` renders the 5-axis sub-score.

## During the event

### Recommended disruption fire schedule

Default `defaultAfterMinutes` in `metadata.json` is set up for a 90-minute battle. For 120-minute, push each fire 15 minutes later. The catalog (5 disruptions) is intentionally spaced so no two events overlap on the same slot.

| Default fire | id                    | Aligns with phase             | Why this timing                           |
| ------------ | --------------------- | ----------------------------- | ----------------------------------------- |
| 30 min       | `ceo-5000-users`      | production-ramp (30 min)      | Reinforces "you missed the publish window"|
| 35 min       | `mfa-mandate`         | (post production-ramp)        | Punishes leaving `auth` on EC2            |
| 45 min       | `legal-pii-found`     | between phases                | Front-loads audit pressure                |
| 55 min       | `env-credential-leak` | between phases                | Hits the team that has stalled on `auth`  |
| 70 min       | `ai-committed-secret` | post compliance-audit         | Compound hit on `network` + `audit`       |

Phases (`production-ramp` 30 min, `compliance-audit` 60 min, `incident-response` 90 min) fire automatically from the score engine — operator does not control these.

### Watching the room

Adjust fire times if:

- **All teams finished the all-managed split before 60 min**: pull `ai-committed-secret` forward to 55 min for compound pressure on top performers.
- **Half the teams are still 5-slot EC2 at 50 min**: hold `env-credential-leak` and `ai-committed-secret` until at least one slot is off EC2; otherwise everyone is pinned at 0 and the leaderboard stops moving.
- **One team is dominating with > 2x the next team's score**: do not fire disruptions out of order to "balance" the field. The scoring is composite enough that a slow second-place team can still catch up via the +30,000 bonus.

### Smoke-test commands during the event

To check a team's stack health without leaving the operator console:

```bash
TEAM_BASE=<their BaseUrl>
for slot in auth network rate audit ux; do
  curl -s -o /dev/null -w "%{http_code} $slot\n" "$TEAM_BASE/$slot/meta"
done
```

All 200s = stack is up and probable on EC2. Mixed status = at least one slot is being migrated (expected). All 5xx = team's stack is broken — page their captain.

## After the event

- Tear down all 6 team stacks: `aws cloudformation delete-stack --stack-name tc-stackstack-<team>`.
- Sweep any leftover Lambda / ECS clusters / App Runner services / ECR repos / API GW HTTP APIs that teams stood up under their `${NamePrefix}*` namespace; the participant role grants delete on these but teams may have left them running.
- Review the platform score-engine logs for any cycle where probes failed across all 6 teams simultaneously (= scoring engine outage, not team failure).

## Known limitations

- `mfa-mandate` description says "extra penalty per cycle." Actual engine effect is the same `failurePenalty` mechanism as the other slot disruptions — there is no "disqualification" path. Communicate this clearly during the briefing so teams don't assume `auth`-only failure ends their run.
- Phase 1/2 (production-ramp / compliance-audit) both apply the same `switchPlatformToDegraded: ["ec2"]` effect. After 30 min, every EC2-resident slot is degraded; the 60-min fire is narratively a separate "Legal audit" but functionally a no-op for any slot already degraded. Set team expectations: the 30-min mark is the real deadline.

## IAM scope (deliberately broad)

The `ParticipantViewerRole` for this problem grants permissions to actually build the "hardened state" each axis claims:

- `auth` → Cognito user pools + clients + domains (tag-scoped to `NamePrefix`)
- `network` → CloudFront distributions + Origin Access Control + S3 buckets (`NamePrefix`-prefixed)
- `rate` → API Gateway throttle (already in the deploy grants) + Lambda concurrency
- `audit` → CloudTrail trails + Athena workgroups + Glue catalog (all `NamePrefix`-scoped)
- `ux` → elasticloadbalancing v2 + application-autoscaling + ec2 security-group management

ADR-021 (no list-style actions on `Resource: "*"`) is deliberately relaxed for this problem:

- Players use the AWS Console, which opens with list views. Empty list views (= the old ADR-021 stance) break the 90-minute UX.
- The role grants `lambda:ListFunctions`, `ecs:ListClusters`, `apprunner:ListServices`, `cognito-idp:ListUserPools`, `cloudfront:ListDistributions`, `cloudtrail:ListTrails`, `athena:ListWorkGroups`, `s3:ListAllMyBuckets`, `iam:ListRoles`, etc. on `Resource: "*"`.
- Other teams' resource NAMES become visible to a team running these list calls. Cross-tenant resource ACCESS remains blocked (CreateFunction / UpdateFunctionCode / DeleteService / etc. all carry `${NamePrefix}*` ARN scoping).
- Team names are already public on the leaderboard, so name visibility is a small additional disclosure.

## Account quotas to watch

When running 6 teams in one shared account:

- **CloudTrail**: AWS default limit is 5 trails per region. 6 teams creating `audit`-slot trails will exhaust this. Either request a quota bump (`servicequotas` console) before the event, or brief teams that they may need to share trails. The IAM grant is tag-scoped, so quota collisions show up as `CreateTrail` returning `MaximumNumberOfTrailsExceededException`.
- **CloudFront**: 200 distributions per account, plenty for an event.
- **App Runner**: 50 services / region, plenty.
- **Cognito user pools**: 1000 per account, plenty.
