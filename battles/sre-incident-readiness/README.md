# You Can Only Defend What You Can See (`sre-incident-readiness`)

**Battle · difficulty 4 · 90-120 min · runs entirely in Docker · USD 0**

SRE Battle #1 (Issue 470). A toy order service is running fine. Your team builds
monitoring and resilience into it first. Then an incident with a hidden root cause
hits. How much you could actually *see*, and how well the service degraded instead of
breaking, decides how fast you notice and how much damage it does.

> Not the team that studied SRE — the team that studied it and actually built it.

## The four phases

| Phase | What is happening |
| --- | --- |
| **Build** | The service is healthy. Add metrics, logs, alerts, timeouts/retries/circuit breaker. |
| **Calibrate** | Harmless traffic wobbles (a spike, a one-off dependency blip, a deploy marker) arrive. Tune alerts so they stay quiet. |
| **Incident** | The dependency gets stuck for real, at a seed-random time you are not told. |
| **Stabilize** | Confirm the SLO actually recovered before resolving. |

## The mechanism (Variant A: slow dependency -> retry storm)

A downstream dependency ("payment-gateway", or another seed-chosen name) becomes
completely stuck for the whole incident window. Every checkout that calls it ties up a
slot in a shared capacity pool for `(1 + maxRetries) * timeoutTicks`. At the starter's
defaults (`timeoutMs: 15000`, `maxRetries: 6`, circuit breaker disabled) that is long
enough that the pool of 30 slots empties within a handful of ticks — and once it is
full, **every** route is rejected, including `order-status`, which never calls the
dependency at all. A short timeout, a small retry budget and an enabled circuit breaker
keep the pool from ever saturating; the difference is deterministic given the config, so
it reproduces on every seed.

There is no participant code execution: every editable surface (`local/app/config-
store.mjs`) is a small, typed, in-memory config behind the Workbench — resilience
parameters (which really do change system dynamics), observability toggles (which gate
*visibility* into ground truth that is always computed), and alert rules (evaluated
against real per-tick metrics, never a static analyzer's guess at "is this a good
rule"). See that file's header for the full reasoning.

## No retroactive observability

Evidence is only ever recorded for a tick where the relevant capability
(`dependencyMetrics` or structured logs) was already on **at that tick**. There is no
code path that walks history backwards to backfill it. Turning a capability on after the
incident starts gets you the rest of the incident, never the part you missed.

## Incident Command

An alert firing does not start the clock. The team declares explicitly (`POST
/incident/declare`), assigns roles (`ic`/`ops`/`comms`/`scribe` — a 3-person team may
combine `comms` and `scribe`), and backs every fact and hypothesis with real evidence
ids. `gradeHypothesis` (`local/app/incident.mjs`) never reads free text — it checks the
named dependency, the named mechanism, and that at least one cited evidence id is real.

## Scoring — 1000 points, mapped 1:1 onto the issue's own table

| Checkpoint | Points | Cleared when |
| --- | ---: | --- |
| `readiness-efficacy` | 150 | A rule you built caught the real onset without ever firing on Build/Calibrate traffic |
| `detection-declaration` | 150 | Explicit declare at/after the real onset, with 2+ roles staffed |
| `evidence-based-diagnosis` | 150 | An accepted hypothesis: right dependency, right mechanism, real evidence |
| `customer-impact` | 250 | The cumulative impact budget stayed above 700/1000 |
| `safe-containment` | 200 | `order-status` stayed healthy and the pool spent under 10% of the window saturated, with no stop-service/injector-reachability attempt |
| `incident-command-closure` | 100 | Resolved only after: declared, override reverted, a structured update posted, and the SLO actually holding |

Battle category, so `SCORING.md`'s tier-points regulation does not apply
(`checkScoringRegulation` only checks `category === "Challenge"`).

## Fast local verification

Compressing 90-120 minutes into a few seconds for manual Docker verification:

```bash
SRE_TICK_MS=50 SRE_BUILD_TICKS=5 SRE_CALIBRATE_TICKS=5 SRE_INCIDENT_TICKS=40 \
  SRE_STABILIZE_TICKS=10 FLAG_SEED=demo docker compose -p sre-incident-readiness -f local/docker-compose.yml up --build
```

Production (and the portal-launched default) uses `SRE_TICK_MS=1000` with the real
90/120-minute schedule; only override these for a manual demo run.

## Cost and safety

Zero. One container, loopback only, non-root, read-only root filesystem, all
capabilities dropped. No participant code is ever executed — every editable surface is a
typed, validated JSON config, so there is no code-injection surface to sandbox against.
No model API key, AWS credential or GitHub token is requested.

## Known limitations (see the PR for the full list)

This ships Milestone 1 from the issue's own implementation order: a working vertical
slice for Variant A end to end. Variant B (bad revision / partial failure), OTel trace
propagation, a Runbook execution engine, real Prometheus/Alertmanager, and TenkaCloud
portal integration are follow-up work, not implemented here.

## Related

- `challenges/stackstack-observability` (#288) — the single-team Challenge this Battle
  is the destination for
- `battles/agent-approval-gameday` — the incident-response Battle this borrows its
  Workbench/gateway/verify shape from
