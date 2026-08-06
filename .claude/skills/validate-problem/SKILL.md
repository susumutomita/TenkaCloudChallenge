---
name: validate-problem
description: Verify an authored TenkaCloudChallenge problem actually works as a problem before the PR — a solution exists on every seed, the initial participant-visible state does not reveal the answer, and a participant can reach an accepted submission end-to-end using only the participant surface. Invoked as `/validate-problem <problemId>` after authoring or editing a problem. Also triggers on natural-language requests like "validate this problem", "play-test the problem", "is this problem solvable", "check the problem holds up", "問題が成立しているか検証して", "問題をプレイテストして". Runs the deterministic gates (bun run validate, solvability audit, reference tests), then a spoiler-firewalled blind playthrough as a participant. NOT for scaffolding a new problem (use /new-problem) and not a substitute for make agent-gate.
---

# validate-problem — play-test a problem as a participant before shipping it

Use this skill after a problem is authored or edited, before its PR. It answers one
question the author cannot answer alone: **does the problem hold up as a problem, from the
participant's side of the screen?**

## Why this skill exists

A problem shipped green on every author-side check — `bun run validate`, unit tests,
mutation kill — and was still not solvable from the participant portal. The author had
verified "I can solve it in my own shell", which proves none of what a participant needs.
Three properties make a problem *valid* rather than merely *deployed*, and every phase
below serves one of them:

- **E — a solution exists.** On *every* seed the problem can ship with, not the one the
  author tried. (`ac26-bridge-experiment` had a checkpoint with no answer on 47 % of
  seeds; every existing gate passed. AGENT.md §16.)
- **L — the initial state does not reveal the answer.** Nothing the participant can see
  or read before doing the intended work contains, equals, or trivially yields the
  accepted answer. (The same problem's `predict` answer equalled the on-screen `start` on
  164 of 2000 seeds.)
- **R — the goal is reachable from the participant surface alone.** From the problem
  statement to an *accepted submission*, using only what the platform actually puts in
  front of a participant — the portal, the published ports, the granted IAM actions, the
  shipped starter — never the author's shortcuts.

Author-side green proves E for one seed, says nothing about L, and actively misleads on R
(the author's shell has powers the participant never gets). This skill closes that gap.

## Invocation

| Command | Behavior |
| --- | --- |
| `/validate-problem <problemId>` | Validate that one problem directory (`challenges/<id>` or `battles/<id>`). |
| `/validate-problem` (no arg) | Infer the target from problem directories touched in the working tree / branch diff; if none or several, ask. |

## Step 0 — classify the problem; it decides which phases apply

Read `metadata.json` and the directory. Three delivery classes, by observable marker:

| Class | Marker | Participant surface |
| --- | --- | --- |
| **Cloud** | `template.yaml` + `cfnTemplate`-style scoring (`flag`, uptime, phased, attack-detection) | AWS Console / CLI through `ParticipantViewerRole`, portal for statement + submission |
| **Container** | `runtime: { provider: "docker", ... }`, scoring `verify` / `multi-verify` | Portal + published `127.0.0.1` ports; local checkout (`README`, `local/starter/` if shipped) |
| **Course checkpoint** | `local/verifier/server.py` exists (the shared `make` participant contract) | As Container, plus the participant `make` targets (`test`, `test-one`, `inspect`, `reset`) |

| Phase | Cloud | Container | Course checkpoint |
| --- | --- | --- | --- |
| 1 — deterministic gates | ✅ | ✅ | ✅ (+ solvability + reference-test) |
| 2 — blind playthrough | ⚠️ live AWS or Simulator only — see Phase 2C | ✅ | ✅ |
| 3 — leak probe | ✅ (static review) | ✅ | ✅ (audit already measures fixtures) |
| 4 — report | ✅ | ✅ | ✅ |

## Phase 1 — run the deterministic gates; do not reimplement them

These already exist. Run them and read their output — the playthrough in Phase 2 must not
be spent rediscovering what a script catches in seconds.

```bash
bun run validate                                          # schema, cross-refs, IAM baseline, tags, scoring tiers
bun run scripts/solvability-audit.ts --problem <id>       # course-checkpoint problems: E and fixture-level L, per seed
make -C challenges/<id> reference-test                    # course-checkpoint problems: hidden + mutation suites
```

Notes that decide pass/fail here:

- A checkpoint reported **`not-audited` is a failure, not a pass** — it needs a
  three-line `expected(seed)` mirror in `scripts/solvability/expected/` so the sweep can
  know the answer rather than only whether a guess was accepted (AGENT.md §16).
- Statistical findings you judge acceptable go into `scripts/solvability-baseline.json`
  with a reason — never into a weakened detector.
- The catalog-wide structural guards (published port on an internal-only network,
  verifier bound to `127.0.0.1` inside the container, verdict spoofing, rlimits) run as
  part of the repo test suite; `make agent-gate` carries them. They are necessary and not
  sufficient — each one encodes a failure mode that *already happened*; the playthrough
  exists for the ones that haven't yet.

What a green Phase 1 does **not** prove: that the portal renders a usable statement, that
the first move in `instructions` is executable, that the submission survives the portal's
input field, that the intended operations are within the participant's grants. That is
Phase 2.

## Phase 2 — the blind playthrough (the heart of this skill)

Have the problem solved by an agent who **does not know the answer**, through the real
participant surface. The author's context is contaminated — whoever wrote or read the
solution cannot play blind. So spawn a fresh subagent (or, outside Claude Code, a second
agent/session with an empty context) whose brief is *only* the firewall below.

### 2a. Launch the problem the way a participant receives it

Container / course-checkpoint problems — preferred, through the platform screen:

```bash
# in a TenkaCloud platform checkout (problems/ submodule pointing at this tree)
make local PROBLEM=<id>          # scoring API + participant portal
make local-evaluate FLAG=...     # scripted submission path, if driving without a browser
make local-down                  # afterwards: stop + wipe progress
```

Repo-only fallback when no platform checkout is available:

```bash
FLAG_SEED=$(openssl rand -hex 16) docker compose -f <problem>/local/docker-compose.yml up --build -d
```

Always a **random** `FLAG_SEED`, never the `local-dev-seed` default — a problem tuned to
the dev seed must fail here, not at an event. Interact only through the published
`127.0.0.1` ports; if the fallback is used, note in the report that the portal rendering
itself was not exercised.

### 2b. The spoiler firewall — what the blind solver may touch

Rule of thumb: **if the platform would not put it on the participant's screen or in their
checkout, the solver does not open it.**

MAY read / use:

- `metadata.json` player-visible fields only: `name`, `shortDescription`, `instructions`,
  `tags`, `learningGoals`, `endpoints[].label` / `description`, scoring points and
  penalties as the portal shows them.
- `README.md` / `README.ja.md` (shipped in the participant checkout for local play).
- `local/starter/` and the participant `make` targets (`test`, `test-one`, `inspect`,
  `reset`) where the class ships them.
- The running endpoints, over HTTP, on the published ports. The portal UI.
- `scoring.hints[]` — only as an explicit purchase, recorded in the play log with its
  penalty. A problem solvable only after buying every hint is a finding.

MUST NOT read / use:

- `description` (author/admin-only by contract, AGENT.md §10) — this is where spoilers
  legitimately live, so opening it ends the run's validity.
- `local/app/`, `local/verifier/`, `Dockerfile`, `docker-compose.yml`, `tests/hidden/`,
  `reference/`, `mutation.py`, `template.yaml` internals, `scripts/solvability/expected/`,
  `scripts/solvability-baseline.json`, git history of the problem directory.
- `docker exec`, `docker inspect`, reading container env or logs — the participant has no
  daemon access to the platform's containers. (Exception: a class whose rules give the
  player a shell, e.g. a defense CTF — then the *target* container shell is in scope and
  the *grader* container stays out.)
- `make reference-test` (author-only target).

The solver keeps a play log: each step, which surface it used, where it got stuck, hints
purchased, and the final submission + verdict. Stuck > ~30 min with the intended surface
exhausted = stop and report; a dead end is a finding, not something to power through by
peeking.

### 2c. Cloud problems — what can and cannot be played locally

There is no local screen for a CloudFormation problem. Do the static half now, and mark
the rest honestly:

- Walk the intended solution against `ParticipantViewerRole` (you, not the blind solver —
  this side of the firewall): **every operation the solve requires must be inside the
  role's grants**, and the Console pages the instructions point at must open (list-action
  carve-outs, deep-link slash rule — AGENT.md §6, §7).
- Confirm the URL-registration gate for Battles (§9) and that `instructions`' first move
  is executable exactly as written.
- The full screen playthrough needs a deployed stack (or a Simulator run where the
  declared capabilities cover the problem). If it did not happen, the report says so as a
  required **one-time verification on live AWS** — never "verified" by extrapolation.

## Phase 3 — the initial-state leak probe

Before (or as the first act of) the blind run, spend a bounded pass trying to **win
without doing the work**, using only the MAY-read surface:

- Submit what is on screen: fixture values, printed parameters, endpoint labels, anything
  `inspect` shows, the empty string, `0`, `-1`. Any acceptance is a finding.
- Check the statement, `instructions`, READMEs, and starter files for the answer or a
  derivation of it (a commented-out solution, a leftover debug print, the flag format
  pre-filled).
- Course-checkpoint problems: the solvability audit already measures fixture-field leaks
  and guessability statistically — read its report for L instead of re-arguing it by hand;
  this probe covers the channels the audit cannot see (prose, starter, endpoints).
- Cloud problems, static review: the flag Output must not be readable — no
  `cloudformation:DescribeStacks` in the role when the flag rides an Output; a flag baked
  into EC2 UserData needs the `ec2:DescribeInstanceAttribute` deny; no list-grant that
  exposes the planted secret (AGENT.md §6, `/new-problem` design bar #1).

## Phase 4 — verdict and report

Produce this table, then the detail. It goes into the PR body's Validation section.

```markdown
## Problem validation — <id>

| Question | Verdict | Evidence |
| --- | --- | --- |
| E — solution exists on every seed | ✅ / ❌ / ⚠️ | solvability report (N seeds), reference-test |
| L — initial state reveals nothing | ✅ / ❌ / ⚠️ | leak probe log, audit fixture rates, IAM review |
| R — solvable from participant surface | ✅ / ❌ / ⚠️ | blind playthrough log (launch mode, hints used, wall time) |
| S — submission path works | ✅ / ❌ / ⚠️ | accepted submission via portal / local-evaluate / POST /verify |

Findings: <numbered, each with severity and the exact reproduction>
Not verified: <e.g. live-AWS playthrough, portal rendering (compose fallback), disruption firing>
```

- **S** is its own row because it has failed on its own: a correct answer destroyed by a
  one-line portal input (`input: "multiline"` missing, #372), a `/verify` that does not
  echo `checkpointId`, a `flagOutputKey` typo. The blind run must end at an *accepted*
  submission through the real path, not at "I found the flag".
- Route each finding: fix in the problem now, or an accepted-baseline entry with a
  reason (statistical, deliberate), or a follow-up issue. Never a weakened validator, and
  never a silent pass.
- ⚠️ means "not established" — a run that could not finish, a surface not exercised.
  ⚠️ on E or R blocks the PR the same as ❌ until resolved or explicitly accepted by the
  user.

## Failure modes this skill exists for — and which phase catches each

| Real incident | Phase |
| --- | --- |
| Checkpoint with no answer on 47 % of seeds (every gate green) | 1 — solvability sweep |
| Answer equals an on-screen fixture field above chance | 1 — audit; 3 — probe for non-fixture channels |
| Published port on an internal-only network — container healthy, screen dead | 1 — guard; 2a — launching through the published port |
| Verifier bound to `127.0.0.1` inside the container — unscorable | 1 — guard; 2 — real submission path |
| Author-green problem not solvable from the portal | 2 — blind playthrough |
| Multiline submission flattened by the portal's one-line input | 2 / S — submitting through the portal field |
| Flag readable off a stack Output / UserData before any work | 3 — cloud leak review |
| First move in `instructions` not executable as written | 2 — the solver starts where the player starts |

## Boundaries

- ✅ Validating one authored/edited problem, producing the verdict table and findings.
- ❌ Scaffolding — that is `/new-problem`.
- ❌ Replacing `make agent-gate` — the gate is the completion contract; this skill is the
  play-test on top of it.
- ❌ Auditing the whole catalog in one run — one problem per invocation, matching the
  one-problem-per-PR rule.
