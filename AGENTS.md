# AGENTS.md

This repository is the public problem catalog for TenkaCloud. It owns problem metadata and payloads. TenkaCloud owns deployment, scoring dispatch, runtime support and the participant/admin applications.

## Commands

```bash
make install     # bun install --frozen-lockfile --ignore-scripts
make agent-gate  # what CI runs: metadata, bilingual READMEs, cross-references, root tests
```

`make agent-gate` does not prove that a stack deploys, a container becomes reachable, or a verifier rejects shortcuts. Also run the problem's own tests from its README, Makefile or package.json. A real AWS event or a third-party playtest is an optional rehearsal, not a merge gate.

## Repository boundary

- `challenges/<id>/` and `battles/<id>/` each own one problem: metadata, runtime, bilingual READMEs, fixtures and tests. The directory name matches the `id` in `metadata.json`.
- `runtimes/<family>/` holds only a runtime that two or more problems use unchanged. A change there must be tested against every consumer.
- Root `scripts/` holds catalog validation only. Problem-specific tests live with the problem.
- `SCHEMA.json` defines the metadata shape, not what TenkaCloud can run. A new scoring kind, runtime adapter or Portal slot needs a matching TenkaCloud change.
- Keep credentials, flags, hidden checks, fixture seeds and reference answers out of participant-visible surfaces and participant images.
- Never run deploy, destroy, release or production cloud commands from this repository.

## How to add or change a problem

1. Define the participant outcome: role, initial symptom, first useful action and observable success.
2. Copy the closest problem with the same runtime and scoring: `challenges/hello-world` (AWS flag), `battles/hello-world-battle` (uptime Battle), `challenges/sqli-demo` (local `verify`) or `challenges/wp-exposed-backup` (local `multi-verify`).
3. Change every identity and contract field: directory, `id`, Japanese text, `i18n.en`, runtime, endpoints, scoring and hints. Leave no starter answers behind.
4. Write `README.md` and `README.ja.md` as regular files: story, components, participant route, scoring evidence, safety boundary, cost-bearing resources, teardown and local verification. Claim only behavior you ran.
5. Run the problem's tests and `make agent-gate`. Keep one problem per PR. A shared-runtime change may cover its affected consumers in one PR if it lists each consumer's evidence.

## Rules

### §7 AWS Console deep links

Keep literal `/` characters in Console deep-link fragments, and open the link in the participant role.

### §9 Battle participant-action gate

A Battle earns uptime points only after participants register or configure the target. Score-target endpoints have empty defaults and `overridable: true`. When participants cannot otherwise find the target, expose a non-scoring host hint. `battles/hello-world-battle` is the reference (`Ec2HostHint`).

### §10 Participant-visible content

`shortDescription`, `instructions`, endpoint labels and descriptions, hints, `scoring.checks[].label` and public phase or disruption text name the symptom, asset, first action and goal. They never reveal vulnerability names, hidden predicates, hardened state, surprise timing or answers. The top-level `description` is for authors and operators.

### §11 Disruptions

`effect` is scoring pressure only. `action` is a real, reversible platform fault. Never declare both. A disruption with neither, driven by an operator probe in `parameters.probe`, is also valid and belongs in the operator runbook. A problem with more than one disruption needs `redteam/README.md` covering targeting, recovery, revert and a pre-event smoke test.

### §12 Participant instructions

Every problem has Japanese `instructions` and `i18n.en.instructions`: framing, first action and observable goal.

### §12b Target reader

Write participant-visible text for a reader with junior-high mathematics and one beginner Python book. Define every term beyond that before first use. Put every formula the solution needs in the statement, with a worked example on small numbers.

### §12c Low floor, high ceiling

The first checkpoint is earnable from the visible surfaces. The last checkpoints are worth an experienced engineer's time. Playability evidence uses only what a participant can see.

### §12d Hints are a staircase

Hints climb from the mechanism, to a formula or example on small numbers, to steps on the reader's own values. A formula the solution needs never sits behind a paid hint.

### §13 Local-play containers

Declare `runtime.provider: "docker"`, `runtime.engine: "compose"` and a real `runtime.entry`, and score with `verify` or `multi-verify`. A `multi-verify` `/verify` echoes the submitted `checkpointId`. Derive answers from injected per-run secrets. Never commit them or copy hidden or reference material into the participant image. Bind published ports to `127.0.0.1`, add a real health check, run as non-root, and keep the participant surface apart from verifier authority.

### §14 Challenge scoring

Points and penalties follow [SCORING.md](SCORING.md). The validator enforces the tiers.

### §15 Verify failure feedback

A failed `kind: "code"` checkpoint may return `message`, naming the stated property that broke, truncated to 1900 characters. It never carries hidden fixtures, expected values, seeds, flags or paid-hint content. Other checkpoints never return a reason, because a reason narrows the expected value.

## Course placement

Order problems with `track.id`, `track.order` and `track.chapter`. Use `courseAlignment` only for a pinned external-course mapping. Do not add a second prerequisite graph.

## Skill evidence

Optional `skillEvidence` claims only the team-level observation its `rule` proves. It never claims an individual's ability, sustained availability or every learning goal, and its labels carry no answers or hidden checks.

## Cost claims

Each README lists cost-bearing resources, Region, session length and teardown. Do not keep a dollar table in this repository.
