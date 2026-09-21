# Host Office Link in 60 minutes

The goal is to get colleagues from different offices or disciplines talking and building a result together. This is not an AWS skills examination. Check whether everyone had a role and whether a teammate's information helped.

## First event and preparation

Start with 2–4 teams of four people. This is a facilitation recommendation, not a tested capacity limit. Mix offices and experience. Appoint one host and one environment/support contact; name a deputy. If one person fills both roles, explicitly pause facilitation while resolving incidents.

Provide a browser per participant when possible (minimum one operator device and a second device for cards), one conversation space per team plus a shared announcement channel, and private team login details. Use the platform's existing AWS competitor-account setup. Confirm budget, billing owner and deletion deadline even when someone offers to fund AWS.

| When | Owner / initial estimate | Ready when |
| --- | --- | --- |
| 2–4 weeks before | Host, 30 minutes | Goal, audience, date, size, venue/call and budget are agreed |
| 2 weeks before | Environment owner, 60–120 minutes | Pinned platform/catalog, Lite and two test teams are ready; recruit 2–4 inexperienced rehearsal participants |
| 1 week before | Host, support, volunteers, 60 minutes + 30 cleanup | Rehearsal checks below pass; record time and obstacles |
| Previous day | Host, 30 minutes | Mixed teams, contacts, roles and substitutes confirmed |
| 30 minutes before | Environment owner | Everyone can sign in and open Preparation while Battle remains locked |
| Afterwards | Environment owner, 30 minutes | Results saved; deployments and unnecessary hosting removed; residual resources checked |
| Following week | Host, 30 minutes | One-page retrospective with the next changes and owners |

Replace estimates with measured effort after each event.

An incorrect passphrase in the portal costs 5 points under the standard difficulty-1 rule. Trying inside the workshop is free. Demonstrate copying into the matching numbered A/B field before play.

When rotating devices, share the Preparation handoff code or the last earned Battle passphrase (A or B) within the team. Import it at the same problem's GameUrl. On one device, simply rotate people.

## Configure the Gate and distribute

1. Use the [platform runbook](https://github.com/susumutomita/TenkaCloud/blob/main/docs/operations/event-runbook.md). Add **only office-link-gate and office-link-battle** to the event and deploy both for every team.
2. In event details, open **Progression / Gate**. A TenantAdmin enables **challengePrerequisiteGate** (default OFF). Check other events with saved Gate settings because this flag is tenant-wide.
3. Gate challenge: **office-link-gate**. Unlock target: **office-link-battle only**. Default policy: **required**. Completion bonus: **0**. All team overrides inherit; none bypass. Save, reload and verify. [event-gate.json](event-gate.json) contains the equivalent API payload.
4. Set a **45-minute** official competition window, including about 20 minutes of Preparation and 25 of Battle. Initially only Preparation is playable; the existing Gate blocks Battle connection details and submissions.
5. Preparation issues one scoring passphrase only after all four checks. Submit it for 100 points and refresh the problem list to unlock Battle. No partial preparation points. Battle adds up to 100 more: event total 200, no additional bonus.
6. Privately share portal URL and team login keys. Do not distribute Battle URLs before unlock. Use separate rehearsal events/teams to keep test scores out of competition.

The existing Gate unlocks all configured targets at once. This set configures just one. Battle itself enforces repair → explanation → next mission on the server. Completed content remains reviewable; there is one unfinished task at a time. Adding unrelated problems to this event breaks that design.

### Pin the catalog version being deployed

The Lite launcher default `ProblemsRepoRef` points to the last published release and may not contain this new set. Read `sources.catalog.commit` from `release/tenkacloud-release.json` in the platform checkout selected for rehearsal and supply it as **ProblemsRepoRef**. Pin **RepoRef** to the platform commit being rehearsed too. Until included in a published release, this is a candidate for event preparation.

For local `make deploy`, align `problems` with that checkout's gitlink. Before deploying, confirm both `challenges/office-link-gate/metadata.json` and `challenges/office-link-battle/metadata.json` exist. Updating the version does not automatically register these problems or configure a Gate in an existing event.

## 60-minute facilitation

| Elapsed | What to do |
| --- | --- |
| 0–5 | Introduce names/offices, roles, Preparation → Battle, and portal submissions |
| 5–25 | Four Preparation checks: location, permissions, recovery, verification. Rotate so each teammate explains once. Submit the final passphrase to unlock Battle |
| 25–50 | Deliver → share → recover, one mission at a time. Repairs and explanations score separately. Teams may enter Battle as soon as they finish Preparation; all share one deadline |
| 50–60 | Official scores, tied places and one helpful teammate comment from each person |

Rotate two readers, one operator and one checker. In Preparation, one explains, one reads the example, one operates and one checks. Allow chat participation. Choices can be graded automatically; individual understanding requires listening to explanations. Faster people ask questions rather than take over.

## Rehearsal before committing to an event

- [ ] A newcomer completes the first Preparation check in five minutes (target, not a guarantee).
- [ ] Battle URL and submissions remain locked before and during Preparation, including direct portal API submissions.
- [ ] Completing the four checks without portal submission does not unlock. Submitting the final flag awards 100 and unlocks Battle.
- [ ] Another unfinished team remains locked. Reload confirms the feature flag and required policy.
- [ ] Two teams receive different GameUrls; one team's passphrase cannot score for the other.
- [ ] 1A earns 15 points by itself; 1B adds 15 independently. Duplicate submission adds nothing.
- [ ] All six Battle submissions total 100 (200 including Preparation) and appear in both the portal score and scoreboard after refresh.
- [ ] Wrong choices can be corrected; hints do not deduct points.
- [ ] Language, required devices, role cards and voice/chat work.
- [ ] Each participant operates or explains at least once.
- [ ] Event-end submission rules, deployment deletion and residual checks work.

Code tests do not replace live AWS and multi-person rehearsal. Do not promise that every beginner will finish in 60 minutes or that conversation will increase before observing it.

## Recovery and cleanup

If nobody speaks, ask each reader to relay one code or time. If one person takes over, assign the next explanation to another operator. If score stays at zero after workshop success, check that the passphrase was actually submitted in the matching portal A/B field. The workshop itself never writes scores.

If browser notes disappear, import a teammate’s progress code or last passphrase, or solve again; existing portal scores persist independently. If GameUrl fails, verify the original private link and deployment state. Never paste team keys into shared channels. For a general outage the host announces a pause and a next update time; do not mix simulated local scores into official results.

Save results, delete problem deployments, verify removal of their Lambda, URL, permissions, log group and IAM roles, then follow the platform runbook to remove unnecessary hosting. Record residual resources and a responsible owner instead of declaring teardown complete at the delete request.

## One-page retrospective and coauthoring

Record: date/purpose/format; participants/teams/AWS experience; time to first score and checkpoints completed; whether everyone had a role; one conversation that helped and one obstacle; 1–3 changes with owner/deadline; actual preparation, facilitation, cleanup time and costs. Mark unmeasured values as unmeasured. Keep names and credentials out of public records.

For a community coauthoring session, first play this set, then bring one familiar problem using the same split-clue → action → explanation format. Confirm date, venue, authors, reviewers and AWS budget separately; a proposed month is not a confirmed event.

The public platform and standard problems remain available for self-hosting. Organizations may request paid event design, preparation and facilitation, and separately scoped proprietary problems. This introductory teamwork score is not a validated hiring or certification rubric; those uses need their own competencies, criteria and accommodations.
