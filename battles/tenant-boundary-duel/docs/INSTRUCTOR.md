# Instructor guide: outcomes, scoring and assessment

Operator-only material; never include this file or reference answers in participant bundles.

Use approximately 25 minutes of play and 10 minutes of reflection. First separate identity from authorization using action logs and actual dummy changes. Then delegation makes deny-all insufficient. Ask teams to show one failed public test and their improvement. Winning is not a substitute for learning evidence.

## Reference and counterexamples

```text
actor.active && ((actor.tenant == document.tenant &&
  (action == "read" || actor.role == "editor")) ||
  (action == "read" && grant.valid))

event.allowed && event.actorTenant != event.documentTenant &&
  !(event.action == "read" && event.grantValid)
```

Deny-all breaks legitimate work. Comparing client claims with resource ownership admits forged claims. Hardcoding blue fails unseen tenants. Tenant equality alone admits reader edits. An active check on only one permission path admits inactive delegated actors. Read grants do not authorize editing. Always-alert creates false positives; never-alert misses historical successful cross-tenant access.

## Scoring evidence

Authorization checks 64 combinations: active state, tenant relationship, role, action, grant and client claim, each with two values. The server invalidates read grants for editing before evaluating submitted code. There are 16 legitimate cases and 48 required denials. Unseen tenant names derive from the match secret; fixtures and expected values stay server-side. Detection evaluates both historical allowed and denied events for all combinations, totaling 128. A patch that stops every current attack must still detect old unauthorized successes.

Defense = floor(40×denial rate + 40×legitimate-work rate + 20×detection rate) minus retest damage, minimum zero. Partial scores diagnose gaps; only a complete result demonstrates this model's contract. Each unauthorized document/action pair earns 25 attack points once; four tickets cap damage at 100. Repeated actions change dummy counters but do not double-score. Damage occurring after the defender's check still enters final settlement.

Defense requires baseline engagement, deployed expressions, attacker retest completion and an explicit recheck. Waiting and timeouts alone award no points. History stores submitted expressions, check rates, damage, roles and scores. Identical retries do not change state or scores; reusing an ID for changed content is rejected. Companion native-host tests cover authenticated HTTP, runId, SQLite and official score history.

The author read-through checked the first action, feedback, definitions and completion using participant-visible text only. Free clue rungs progress from mechanism to example to named controls. This is not an independent human playtest.

## Pre/post assessment

Score each competency 0–2, total 8: 0 cannot explain; 1 correct conclusion without evidence; 2 cites evidence and a counterexample. Collect no personal information. Keep optional team labels and scores locally. Before play ask the first prompt; after play use replay and renamed data for the second.

| Competency | Pre | Post | Two-point evidence |
| --- | --- | --- | --- |
| Find the boundary | Does successful login permit another organization's notes? | Explain the cause using successful-action logs | Compares server identity with resource ownership |
| Implement a repair | What breaks with deny-all or client claims? | Construct an unseen-tenant/inactive-actor counterexample | Preserves work and applies active checks to both paths |
| Detect | Do denial logs alone measure harm? | Separate legitimate delegation from unauthorized success | Checks allowed, relationship and operation scope together |
| Transfer and limits | When should asynchronous work recheck access? | Explain an export after grant revocation | Identifies execution/result-access checks, races and untested storage boundaries |

Pilot success means improved assessment and the ability to explain deny-all, client-claim trust and inactive-path gaps. Do not advertise measured gains before collecting them. Start with two seats or independent two-seat matches. Record drop-off, revisions after public-test failures and post-assessment. Multi-match administration and learner analytics are not productized here.

This bounded expression exercise does not certify production coding or organizational safety. Grant issuance/signatures/expiry/revocation, asynchronous exports, list APIs, cache isolation and database row authorization remain outside the runtime. Discuss transferring the same identity/resource/action relationship to those paths. Claim no official adoption or affiliation.
