# stackstack — RedTeam content

> Operator-facing. Reading this as a player spoils the disruption schedule. **Not for unauthorized use against systems you do not own.**

StackStack's pressure comes from reversible operational drift against a single stack-owned app host. Most disruptions are fired from the admin console: the platform executor AssumeRoles into the team account and runs the `action` declared in `../metadata.json` through SSM Run Command. One disruption (`anonymous-spam`) is instead an operator-run **HTTP attack probe** (`redteam/probes/anon-spam.sh`) — it is repelled by the `auth_enabled` gate, so a hardened team is immune and keeps scoring (robustness is rewarded). No participant-created resources to discover.

## Catalog

| id | delivery | what actually happens |
| --- | --- | --- |
| `anonymous-spam` | operator HTTP probe (`redteam/probes/anon-spam.sh`) | POSTs marker spam (author `redteam-spam`) to `/submit` with no token. **Blocked when `auth_enabled`** (401 → nothing lands → `posture.board_clean` holds → production safe). If auth is off, spam lands, `board_clean` goes false, and the team drops out of production. Recovery: enable auth (the defense) + delete the spam (`DELETE FROM posts WHERE author='redteam-spam'`). No auto-revert — the player's hardening is the fix, and the operator simply stops running the probe. |
| `ai-wipes-database` | real fault: `action` (ADR-031, ssm-run-command) | Runs `/opt/tenkacloud/vibe/wipe_database.sh`, clearing SQLite and RDS posts where reachable. Auto-revert restores the DB from the backup bucket via inlined commands (`aws s3 cp` + `sqlite3`/`psql`) after 300 s. |
| `auth-setting-removed` | real fault: `action` (ADR-031, ssm-run-command) | Backs up `/etc/tenkacloud-vibe/config.json`, disables auth, restarts the app. Auto-revert restores the backup after 300 s. |
| `vibe-app-stopped` | real fault: `action` (ADR-031, ssm-run-command) | Stops `tenkacloud-vibe`. Probe goes 5xx, causing failurePenalty. Auto-revert starts it after 180 s. |
| `site-defaced` | real fault: `action` (ADR-031, ssm-run-command) | Runs `/opt/tenkacloud/vibe/deface_site.sh` (touch `DEFACED` marker). App serves a PWNED banner and `posture.site_intact` goes false, dropping out of production. Auto-revert runs `restore_site.sh` after 300 s. |
| `supply-chain-backdoor` | real fault: `action` (ADR-031, ssm-run-command) | Runs `/opt/tenkacloud/vibe/install_backdoor.sh` (drops `BACKDOOR` artifact). `posture.no_backdoor` goes false, dropping out of production. Auto-revert runs `remove_backdoor.sh` after 300 s. |

Shared invariants:

- **All faults target stack-owned resources.** No Lambda / ECS / App Runner / API Gateway / CloudFront discovery is needed.
- **Nothing is permanent** (ADR-029). Every `action`-delivered fault has `action.revert`; the `anonymous-spam` HTTP probe leaves no standing damage once auth is on (and the spam rows are deleted).
- **Score damage comes from probe failure or measured posture regression.** Do not add an `effect` to the same disruption; it would double-charge.
- **Asymmetry rewards robustness.** `anonymous-spam` only damages teams that skipped `auth_enabled`; a hardened team is immune. Target it at teams sitting in production to test that their auth actually holds.

## Player recovery path

For every fault, the defender can recover faster than the auto-revert:

```bash
aws ssm start-session --target <InstanceId>
vibe-status                      # shows which gate regressed + the objective
# then run the matching real operation, e.g. DB restore:
source /etc/tenkacloud-vibe/runtime.env
aws s3 cp s3://$BACKUP_BUCKET/seed-sqlite.sql /tmp/ && sqlite3 $SQLITE_DB < /tmp/seed-sqlite.sql
sudo systemctl restart tenkacloud-vibe
```

The exact command depends on which posture key regressed. Brief participants to trust `vibe-status` / `/posture` over guesses (exact commands are in the portal hints).

## Pre-event smoke test

`smoke-test-attacks.sh` replays all three action/revert pairs against a throwaway team stack through `aws ssm send-command`, then checks the app-visible result:

```bash
INSTANCE_ID=<InstanceId output> BASE_URL=<AppUrlHint output> bash redteam/smoke-test-attacks.sh
```

Requires operator-side credentials that can `ssm:SendCommand` against the team account instance.

## Adding a new disruption

1. Decide the delivery model. StackStack should prefer `action` with `revert`.
2. Add the entry to `../metadata.json` `disruptions[]`.
3. Ensure `action.targetRef` names an existing `Outputs:` key in `../template.yaml`.
4. Never describe a fault the action does not deliver.
5. Extend `smoke-test-attacks.sh`.
6. Run `bun run validate`.

## Safety

The actions only mutate app data/config or the `tenkacloud-vibe` service on one stack-owned EC2 instance. There is no host discovery, lateral movement, or unmanaged resource cleanup path.
