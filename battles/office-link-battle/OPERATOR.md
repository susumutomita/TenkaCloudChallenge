# Host runbook — AWS Preparation into Recovery Battle

[日本語](OPERATOR.ja.md) · [Runtime and costs](README.md)

The first event assumes engineers from different offices **meet at one venue to learn AWS and get to know each other**. Start with 2–4 teams of four, not a capacity guarantee. Mix offices, departments and AWS experience within each team. Teammates sit together, discuss one task and rotate operating, reading the diagram, explaining and checking. Speaking frequency and individual understanding are not automatically graded.

| When | Owner / estimated effort | Ready when |
| --- | --- | --- |
| 2–4 weeks before | Lead and helpers, 60 minutes | Learning and social goals, audience, date, venue, budget and teardown owner recorded |
| 2 weeks before | Technical owner, half a day | Lite, two rehearsal teams, competitor account per team, pinned versions and support channel ready |
| 1 week before | Host, technical owner, beginner readers, half a day | Real-AWS rehearsal below completed; propagation, recovery and cleanup times measured |
| Day before | Lead, 60 minutes | Teams mixing offices and experience, preferably one PC per person, shared tables with power and Wi-Fi, login details, role rotation, backup staff |
| 60 minutes before | Technical owner, 30–60 minutes | Login, team AWS role, Preparation URL and Battle lock checked; scoring not started |
| Event | Host plus technical owner, reserve 90–120 minutes | Introductions and role assignment 5, Preparation about 40, Battle about 30–45, reflection 10; adjust using rehearsal |
| After | Technical owner, 30–60 minutes | Save scores, delete deployments, check remaining resources and billing; assign cleanup failures |
| Next week | All staff, 30 minutes | Update the template with actual times, blockers, useful conversations and costs |

Arrange a shared table, power and Wi-Fi for each team; one laptop per participant is recommended. Use the five-minute introduction for names, everyday roles, AWS experience and the first role assignment. Before choosing an explanation answer, have a teammate briefly explain the reason. End with each person sharing something they learned from another teammate, creating a reason to talk again.

Confirm funding independently; do not assume free support from a named organization. Use only the core preparation and Battle initially. Select the seven extra Challenges for separate events.

## Gate and version configuration

1. Follow the platform [event runbook](https://github.com/susumutomita/TenkaCloud/blob/main/docs/operations/event-runbook.md). Add **only office-link-gate and office-link-battle**; deploy both for each team.
2. A TenantAdmin enables the Gate feature (default OFF). Set Preparation as Gate, only Battle as unlock target, required policy, zero completion bonus, inherited team policies. Save, reload, and verify. [event-gate.json](event-gate.json) is an API payload example, not an automatically applied file.
3. Verify unfinished teams cannot access Battle URLs, submissions or endpoint registration. Preparation issues no interim scoring flags: five real operations plus explanations yield one 100-point flag and unlock the Battle.
4. Align the parent gitlink with `sources.catalog.commit` in `release/tenkacloud-release.json`. Pin launcher RepoRef and ProblemsRepoRef. Local deployments use the parent’s `make deploy`. Call an unreleased revision a candidate, not a published release.
5. Confirm `challenges/office-link-gate/metadata.json` and `battles/office-link-battle/metadata.json` exist. Do not use the former browser model under `challenges/office-link-battle`. Version changes do not register event problems or Gates automatically.

Preparation saves progress on the device; use its visible handoff code when swapping devices. Battle state reloads from the same GameUrl. URLs, codes and flags stay within the team.

## Distribute private role cards

After deployment, invoke the private FaultController with `{"operation":"cards"}`. It returns four A–D URLs. Keep the response private, give one URL to each person, and delete the local response after distribution. Never publish the whole list in shared chat or on the projector. The common GameUrl has no card and cannot confirm another member's action.

Use the existing operator invocation below with payload `{"operation":"cards"}` and a private output file (`umask 077`). For an absent member, `{"operation":"assist","members":[2]}` marks card C's confirmation as host-assisted (A=0 through D=3). Reassign C's card to a present teammate when C is the operator or explainer. Assistance does not change health or score. It works only in an active/review round; normal AWS recovery still applies.

For partner exchange, have teams meet another team and each enter the other's displayed code in the portal. Both confirmations are required; +20 each, up to three partners. A late/odd team can connect with an already rewarded team; the latter receives no additional reward after its cap. No waiting penalty. Check the official score increases by 20 without erasing uptime points.

Host-prepared AWS environments may be distributed through the platform's [participant self-registration](https://github.com/susumutomita/TenkaCloud/blob/main/docs/operations/participant-self-registration.en.md). One representative reserves once per team; AWS accounts are still prepared in advance.

## Starting and operating faults

Normally wait for all teams to finish Preparation before Battle endpoint registration and fault introduction. Early finishers explain their architecture. Preparation contributes a common 100-point base; compete over the same Battle window. Agree on assistance for slower teams in advance; do not silently disable the Gate.

Registration makes a team eligible for scoring inside the platform event window. Record registration/start differences; never replace official scores with preview scores. First verify one healthy tick for every team.

The **host**, using authorized competitor-account credentials, invokes the function named by **FaultControllerName**. Do not grant Invoke to participant roles. Run the CLI on the host’s computer, never from catalog CI. The operator needs `lambda:InvokeFunction` on that function ARN and `cloudformation:DescribeStacks` for the target stack’s outputs. Use the existing operator role for cross-account access.

```bash
# Resolve TEAM_FAULT_FUNCTION from the intended team's stack outputs.
aws lambda invoke --region ap-northeast-1 --function-name "$TEAM_FAULT_FUNCTION"   --cli-binary-format raw-in-base64-out --payload '{"operation":"state"}' /tmp/office-state.json
cat /tmp/office-state.json
aws lambda invoke --region ap-northeast-1 --function-name "$TEAM_FAULT_FUNCTION"   --cli-binary-format raw-in-base64-out --payload '{"operation":"start","kind":"gateway"}' /tmp/office-start.json
cat /tmp/office-start.json
```

Do not treat CLI HTTP200 alone as success: check for no FunctionError and phase=active in the result. Continue in order **gateway → route → role → http**, only after the preceding explanation returns phase=idle. Faults cannot overlap. Prefer starting each round together across teams; announce delays and rotate operators.

After ten unrecovered minutes the watchdog starts recovery. It checks each minute; failed restores retry after a lease of at least three minutes. For emergency recovery invoke `{"operation":"restore"}`. Duplicate calls during restoration return the waiting state. AWS errors remain visible as restoring; inspect logs, permissions and resources, then retry after the lease. Only successful recovery reaches review. Lost points are not refunded.

The role exercise checks the attached profile and a new session after the round begins; it does not promise immediate disconnection of an existing session. Before hosting, inspect [Default Host Management Configuration](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-permissions.html), which can manage EC2 without its own profile, and rehearse with the intended instance-role path. The problem never changes shared account settings. Allow for credential/permission propagation; an immediate connection attempt alone is not the evidence.

## Optional real-AWS rehearsal — not yet performed

- A newcomer finds the first AWS action; test hints, device handoff and English.
- Gate stays closed during Preparation and opens only for the team’s final 100-point flag; wrong flags cost 5, repeated submissions do not duplicate points.
- No Battle points before registration; healthy/unhealthy ticks match scoreboard, header score and rank.
- Each fault changes the intended resource; repairs restore HTTP and a new Session Manager connection. Healthy endpoint replies within the scorer’s eight-second timeout.
- Automatic/manual restore, duplicate starts and mid-fault stack deletion work without changing another team.
- Team SSO opens required consoles but cannot read grading secrets/functions or mutate other teams.
- Every member operates or explains; record AWS propagation and task durations.
- Delete both stacks and verify no remaining resources. Preparation and Battle use separate servers and public addresses, both billable.

Rehearse before event day. Keep AWS rehearsal evidence separate from local code checks.

## Optional Challenges and feedback

Choose S3 save, S3 restore, Lambda execution, log investigation, DynamoDB handover, SQS handover, or CloudWatch alarm in separate events. Each is difficulty1, 100 points, 5-point wrong-flag penalty. Adding them all to the core event breaks its one-unfinished-task route.

Record audience, first-action time, each step’s duration, useful conversations, blockers, cost, cleanup and next owners. Public OSS/standard problems remain available for self-hosting; design/preparation/operation support is paid, custom enterprise problems separately quoted. Do not use these social-event scores alone for hiring or certification.
