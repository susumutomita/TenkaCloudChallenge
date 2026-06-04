# stackstack — RedTeam content

> Operator-facing. Reading this as a player spoils the disruption schedule. **Not for unauthorized use against systems you do not own.**

StackStack's pressure comes from "organizational events" — the kind of thing that lands in a Platform Team's lap mid-sprint. Without them, defenders see a passive migration exercise and never feel the cost of leaving a slot on EC2. This directory documents the **disruption catalog** the operator fires and ships a smoke-test script to verify the real-fault injections before event day.

Unlike `security-battle-royale` (HTTP attack probes run by an operator-side attacker), StackStack's red team is delivered through the **platform's disruption executor** (ADR-031): the operator fires a disruption from the admin console, the executor AssumeRoles into the team's account, and runs the `action` declared in `../metadata.json` via SSM Run Command. There are no standing attack loops.

## Catalog (what fires)

| id | delivery | what actually happens |
| --- | --- | --- |
| `ceo-5000-users` | scoring-side `effect` (ADR-033) | −100 pt per scoring tick for 5 min. No cloud fault. |
| `mfa-mandate` | scoring-side `effect` (ADR-033) | −100 pt per scoring tick for 5 min. No cloud fault. |
| `legal-pii-found` | scoring-side `effect` (ADR-033) | −100 pt per scoring tick for 5 min. No cloud fault. |
| `env-credential-leak` | real fault: `action` (ADR-031, ssm-run-command) | `systemctl stop tenkacloud-slot-auth` on the team's EC2. Probe goes 5xx → zero points + failurePenalty per cycle. Auto-revert after 300 s. |
| `ai-committed-secret` | real fault: `action` (ADR-031, ssm-run-command) | `systemctl stop tenkacloud-slot-network tenkacloud-slot-audit` together. Auto-revert after 180 s. |

Two invariants both delivery models share:

- **Migrated slots are immune.** The red team only touches the EC2; a slot already on Lambda / ECS / App Runner (registered via portal override) takes no damage. That asymmetry *is* the gameplay.
- **Nothing is permanent** (ADR-029). Real faults carry a `revert` the executor schedules at fire time; effects expire after `durationSeconds`.

## Targeting rule for the effect-only events

The scoring engine applies an `effect` penalty unconditionally once fired at a team — it does not check which platform the slot is on. The "only hurts EC2 holdouts" semantics are **operational**: fire `ceo-5000-users` / `mfa-mandate` / `legal-pii-found` only at teams whose target slot (`ux` / `auth` / `audit`) still self-reports `ec2`. Check before firing:

```bash
curl -s "$TEAM_BASE_URL/<slot>/meta" | jq -r .platform   # "ec2" → valid target
```

## Player recovery path (what the defender can do)

For the two real faults, the defender has two outs, both faster than the auto-revert:

1. **Already migrated** — nothing to do; the override URL keeps scoring.
2. **Still on EC2** — `aws ssm start-session --target <InstanceId>` (the `SsmStartSessionCommand` stack output), then `sudo systemctl start tenkacloud-slot-<slot>`.

Brief this in the pre-event walkthrough; the recovery command is also in the player-facing `description`.

## Pre-event smoke test

`smoke-test-attacks.sh` replays both real-fault actions against a throwaway team stack via `aws ssm send-command` — stop, confirm 5xx, restart, confirm 200 — without going through the platform executor. Run it during the single-team smoke test (see `../OPERATOR.md`):

```bash
INSTANCE_ID=<InstanceId output> BASE_URL=<BaseUrl output> bash redteam/smoke-test-attacks.sh
```

Requires operator-side credentials that can `ssm:SendCommand` against the team account instance (same permission the platform executor uses).

## Adding a new disruption

1. Decide the delivery model: scoring-only pressure → `effect`; a fault the defender must notice and fix → `action` (with `revert`, per ADR-029).
2. Add the entry to `../metadata.json` `disruptions[]`. For `action`, `targetRef` must name an existing `Outputs:` key in `../template.yaml` (the validator enforces this).
3. **Never describe a fault the entry doesn't deliver.** "Returns 5xx" requires an `action`; an `effect`-only event may only claim score pressure.
4. Extend `smoke-test-attacks.sh` so the new fault is covered by the pre-event check.
5. `bun run validate` from the repo root.

## Safety

The actions stop/start systemd units on a single stack-owned EC2 instance resolved from CFn Outputs — no host discovery, no lateral movement, no data access. Reverts are mandatory and bounded (≤ 300 s here). Run the smoke test only against stacks you operate.
