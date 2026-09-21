# Host Office Link in 60 minutes

The goal is to get colleagues from different offices or disciplines talking and building a result together. This is not an AWS skills examination. Check whether everyone had a role and whether a teammate's information helped.

## First event and preparation

Start with 2–4 teams of 3–4 people. This is a facilitation recommendation, not a tested capacity limit. Mix offices and experience. Appoint one host and one environment/support contact; name a deputy. If one person fills both roles, explicitly pause facilitation while resolving incidents.

Provide a browser per participant when possible (minimum one operator device and a second device for cards), one conversation space per team plus a shared announcement channel, and private team login details. Use the platform's existing AWS competitor-account setup. Confirm budget, billing owner and deletion deadline even when someone offers to fund AWS.

| When | Owner / initial estimate | Ready when |
| --- | --- | --- |
| 2–4 weeks before | Host, 30 minutes | Goal, audience, date, size, venue/call and budget are agreed |
| 2 weeks before | Environment owner, 60–120 minutes | Pinned platform/catalog, Lite and two test teams are ready; recruit 2–4 inexperienced rehearsal participants |
| 1 week before | Host, support, volunteers, 60 minutes + 30 cleanup | Rehearsal checks below pass; record time and obstacles |
| Previous day | Host, 30 minutes | Mixed teams, contacts, roles and substitutes confirmed |
| 30 minutes before | Environment owner | Everyone can sign in and open their team's GameUrl before competition starts |
| Afterwards | Environment owner, 30 minutes | Results saved; deployments and unnecessary hosting removed; residual resources checked |
| Following week | Host, 30 minutes | One-page retrospective with the next changes and owners |

Replace estimates with measured effort after each event.

An incorrect passphrase in the portal costs 5 points under the standard difficulty-1 rule. Trying inside the workshop is free. Demonstrate copying into the matching numbered A/B field before play.

When rotating devices, the previous operator shares the repair passphrase (A) within the team. The new operator opens the same mission at the same GameUrl and uses **Take over the explanation from a teammate’s device**. Passphrases from another team or mission are rejected. When sharing one device, rotate the person and continue directly.

## Deploy and distribute

1. Follow the [platform event runbook](https://github.com/susumutomita/TenkaCloud/blob/main/docs/operations/event-runbook.md). Pin a catalog commit containing `office-link-gameday` and register competitor accounts through the existing bootstrap path.
2. Create the event and teams in Application Admin Console. Select **Office Link / office-link-gameday** and deploy per team. Set the official competition window to 40 minutes; the workshop has no separate timer.
3. Privately distribute the portal URL and team login key. Participants open GameUrl from their authenticated portal. No AWS console operations are required.
4. Use separate rehearsal teams/event so test scores never enter the real competition.
5. Open individual role-card links and send them only to teammates. Those links are workshop access capabilities, not public links or platform login keys.

## Facilitation script

| Elapsed | What to do |
| --- | --- |
| 0–5 minutes | Explain: “This is a team puzzle, not a knowledge test.” Each person shares their name, office and preferred name in 20 seconds |
| 5–10 | Assign readers, operator and checker. Explain cards and portal submissions. Start the competition once all teams can open GameUrl |
| 10–20 | Mission 1. Readers relay the code and map; the operator delivers. Submit repair A first if desired, then swap operator for explanation B |
| 20–35 | Mission 2. Rotate readers/checker. Say who needs which document, check the result, then answer the next request |
| 35–45 | Mission 3. Split timeline and backup clues. The checker reads the recovered venue; then complete the explanation |
| 45–50 | Check submissions. Faster teams teach a difficult step to a new operator in 60 seconds. Everyone shares the same deadline |
| 50–60 | Confirm official scores. Celebrate tied scores as ties. Each person says what a teammate said that helped and what they would check at work |

Mission timing is guidance: teams may switch missions at any time. There are no automatic faults or timeout deductions. Use **repair → explain for 30 seconds → apply to another situation**, not a long lecture. The software checks choices, not whether a spoken explanation proves understanding.

With three people use two readers and an operator who also checks. With four, split out the checker. Allow chat instead of speech. Do not rank people by how much they talk. Experienced participants should help with questions rather than take over the controls.

## Rehearsal before committing to an event

- [ ] A newcomer gets checkpoint 1A within five minutes, without commands or code. This is a target, not a measured guarantee; revise the route if missed.
- [ ] Two teams receive different GameUrls; one team's passphrase cannot score for the other.
- [ ] 1A earns 15 points by itself; 1B adds 15 independently. Duplicate submission adds nothing.
- [ ] All six submissions total 100 and appear in both the portal score and scoreboard after refresh.
- [ ] Wrong choices can be corrected; hints do not deduct points.
- [ ] Language, required devices, role cards and voice/chat work.
- [ ] Each participant operates or explains at least once.
- [ ] Event-end submission rules, deployment deletion and residual checks work.

Code tests do not replace live AWS and multi-person rehearsal. Do not promise that every beginner will finish in 60 minutes or that conversation will increase before observing it.

## Recovery and cleanup

If nobody speaks, ask each reader to relay one code or time. If one person takes over, assign the next explanation to another operator. If score stays at zero after workshop success, check that the passphrase was actually submitted in the matching portal A/B field. The workshop itself never writes scores.

If browser notes disappear, solve again to recover the same passphrase; existing portal scores persist independently. If GameUrl fails, verify the original private link and deployment state. Never paste team keys into shared channels. For a general outage the host announces a pause and a next update time; do not mix simulated local scores into official results.

Save results, delete problem deployments, verify removal of their Lambda, URL, permissions, log group and IAM roles, then follow the platform runbook to remove unnecessary hosting. Record residual resources and a responsible owner instead of declaring teardown complete at the delete request.

## One-page retrospective and coauthoring

Record: date/purpose/format; participants/teams/AWS experience; time to first score and checkpoints completed; whether everyone had a role; one conversation that helped and one obstacle; 1–3 changes with owner/deadline; actual preparation, facilitation, cleanup time and costs. Mark unmeasured values as unmeasured. Keep names and credentials out of public records.

For a community coauthoring session, first play this set, then bring one familiar problem using the same split-clue → action → explanation format. Confirm date, venue, authors, reviewers and AWS budget separately; a proposed month is not a confirmed event.

The public platform and standard problems remain available for self-hosting. Organizations may request paid event design, preparation and facilitation, and separately scoped proprietary problems. This introductory teamwork score is not a validated hiring or certification rubric; those uses need their own competencies, criteria and accommodations.
