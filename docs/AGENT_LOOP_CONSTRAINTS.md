# Agent loop constraints

An hourly cloud routine works this repository toward zero open Issues and zero open PRs.
Every rule below exists because the failure it names already happened here. Read this
file before doing anything else in a run.

## 1. Do not read the answer, then claim you did not

A play is either blind or it is not; there is no "partially blind". Nothing in CI
checks this any more (the gate was retired), so the only thing keeping it true is that
you do not look.

**Issue bodies contain solutions.** Issue #448 states the intended fix in prose
(the technique, the ordering, and the seven mutations). #449, #450, #451, #466 and
#467 come from the same template. **Do not open the issue body of a problem you intend
to play.** Work from the problem id and the running container.

While playing, these are off limits:

- `local/reference/**`, `local/tests/hidden/**`, `local/verifier/**`
- `local/mutation.py`, `local/mutants/**`
- `metadata.json` → `writeup` and `description` (`description` is an operator field and
  deliberately contains spoilers; `shortDescription` is the participant one)

These are the participant surface and are fair game:

- `README.md` / `README.ja.md`
- `metadata.json` → `name`, `shortDescription`, `instructions`, `hints`, checkpoint `label`
- `local/starter/**`, `local/tests/public/**`
- the running container's `/api/config`, `/api/inspect`, `/api/starter`
- `local/workbench/**` or `local/participant/**` (these ship in the participant image;
  the public tests import them, so a participant can read them too)

If you are contaminated on a problem, write `blind: false` and accept that it cannot be
promoted by you. Say which problems you are contaminated on and why. A truthful
`blind: false` is worth more than a `true` that the transcript can refute.

## 2. Do not silence the detector

`scripts/answer-reachability-baseline.json` is a **shrink-only** allowlist, enforced in
both directions by `scripts/check-answer-reachability.test.ts`: every flagged problem
must have an entry, and every entry must still be flagged.

**Never add an entry.** An entry means "known and unresolved", not "handled". If a new
finding appears, fix the problem — do not widen the rule, rename a function so the
name-matching misses it, or relax a threshold.

The reported count is a **lower bound**, not the real number: the rules are name-based
and miss semantically-equivalent implementations under a different name.

Widening the *rule* to catch a shape it was blind to is the opposite of silencing it, and
is expected work — but only together with whatever it newly flags. Rule 1 no longer
treats a leading underscore inside a shipping `verifier/server.py` as a boundary (that
blind spot is what hid `ac26-w1-underconstraint` after #533; Issue #525 condition 3), and
`topLevelFunctions` now reads past a wrapped `def` signature instead of truncating the
body at its column-0 closing line. Neither added a finding to the catalog.

#576 is the first widening that did. `isStubBody` enumerated trivial placeholders
literally, so `return 0` was a stub but `return (0, 0, 0)` was not — which is why
`ac26-w3-field-inverse` read as implemented and this detector reported it **zero times**
while #537 recorded it as a confirmed leak of 70–145 of its 200 points. Deciding
structurally (a lone `return` of a flat display whose every element is a trivial literal)
took the catalog from 36 to 39 findings and lost none of the previous 36.

Those three findings went into the baseline as entries, which is the one narrow exception
to "never add an entry" — and it is narrow on purpose:

- the widening must *only* add findings, never remove one (diff the two finding lists and
  show the `comm` result, as #576 did),
- every new entry must already belong to a class with a decided, ordered rollout — here
  `stub-vs-implementation` under #543 B2 — and say so in its `reason`, and
- the entry must be added to the §5 work list in the same breath, so it is queued work
  and not a permission.

Anything outside that is the thing §2 forbids. A finding you cannot place in a queued
class is a finding you fix, not baseline.

## 3. Do not promote a problem on machine evidence alone

Automated checks are source evidence only (Issue #448). `status: draft` → `ready`
still needs a real play. PR #479 promoted without one and was reverted by PR #481; do
not repeat it.

**This is now a judgement rule, not a machine-enforced one.** The `playability-gate`
required check was retired on the owner's instruction, so nothing will stop a promotion
that skips the play. That makes the rule weaker to violate and no less true. Say plainly
in the PR body what evidence you actually have and what you did not do, and leave the
promotion decision to the owner when you have not played.

## 4. Merging

The owner authorised self-merge on 2026-08-26 **for this goal in this repository only**.
Conditions, all required:

- **No** check may have actually failed. Do not wait for every shard of the ~28-job
  matrix to report — waiting on non-required checks that are merely still running buys
  nothing and costs ~10 minutes a PR (owner's call, 2026-08-26).
- Read the status correctly: an in-progress check reports `conclusion` as the **empty
  string**, not `null`. Treating that as a failure blocks green PRs; treating a real
  failure as "still running" merges broken ones. Filter on
  `select((.conclusion // "") | . != "" and . != "SUCCESS" and . != "SKIPPED" and . != "NEUTRAL")`.
- Squash only (the branch ruleset permits nothing else).
- Never pass `--delete-branch` when merging the base of a stacked PR.

## 5. What is and is not reachable

Blocked on an owner decision — **do not start these**:

- PR #564 (`sha256-bytes-padding` container split). The code is complete and every
  check is green. It was blocked behind the retired `playability-gate`; with the gate
  gone it merges on its own checks. Its own body still records one real gap: nobody has
  built the split images on a Docker daemon.
- The same wall stands in front of the rest of that class. `sha256-schedule-logic` and
  `sha256-compress-digest` carry the last of the detector's `direct-value-comparison`
  findings, and both are `status: ready` — the split cannot be done there without
  correcting their READMEs either, so the outcome is another Draft PR waiting on the
  same decision. Do not start them until #564 is decided.
- PR #578 is that outcome, and it arrived before this paragraph was read: it carries a
  finished `sha256-schedule-logic` split **bundled with** a finished
  `ac26-w4-commit-open` one. It hit the same retired gate on 2026-08-26 and was put
  back to Draft. With the gate gone it merges on its own checks; unlike #564 its author
  did build and run both split stacks on a real Docker daemon.

  That split-out has since been done: PR #582 carries #578's `ac26-w4-commit-open` half
  on its own, and it is a `draft`-only change an agent can take to merge. What is left in
  #578 is the `sha256-schedule-logic` half, still waiting on the same owner decision as
  #564 — do not re-derive `ac26-w4-commit-open` from the work list below, and do not
  undraft #578. The general rule the bundling taught: a bundled PR inherits the strictest
  problem in it, so keep one problem per PR when their `status` differs, or the reachable
  half is held hostage by the blocked one.

Not closable by one agent playing alone — say so rather than producing a weaker artifact:

- #486, #430, #470 are **battles**: 120-minute, multi-team competitions.

  That is not the same as "nothing in them is reachable". #585 landed against #486 and
  merged: playing the deployed portal as a participant showed two of the four moves were
  impossible to perform, because the participant surface named a repository file the cloud
  participant does not have and `HelpDrawer` carried none of the construction. Making a
  move *performable* is a participant-surface repair an agent can do and verify — there,
  by reimplementing the construction from the panel text alone and matching it against the
  shipped prover. **Do not close #486 on it**: the issue asks for a 120-minute competition
  actually being run, the engine-side half is a separate TenkaCloud PR (#3077), and no
  live match has been played. So: take the reachable repair, leave the issue open, and say
  which half is still missing.

Reachable, and the largest block of work left — **do not skip these as "owner's call"**:

- The `stub-vs-implementation` class: originally 47 of the detector's findings across 8
  problems; 26 across 6 problems as of #573.
  An earlier version of this file said the owner had not chosen and told you not to
  start. That is out of date, and it cost at least one run: the owner picked **option
  B2** on Issue #543 (2026-08-26), and named the order — `cs-auth-claim-audit`, then
  `ac26-bridge-experiment`, then the rest. The first two landed in #562 before that
  paragraph was written.

  B2 is: take `fixtures/` out of the participant Docker stage too, add `GET /public` to
  the verifier, and have `show.py` and the public tests read the deployment's public
  half over the Compose-internal network (`PUBLIC_EVIDENCE_JSON` →
  `VERIFIER_PUBLIC_URL` → a function-scoped `fixtures` fallback that only ever resolves
  in a checkout or the `author` stage). `make test` / `test-one` / `inspect` then run
  through Compose, and `verifier-up` / `verifier-down` are added to the problem
  Makefile. `ac26-w5-lwe-rlwe` (#572) and `ac26-w5-rgsw-external` (#573) are the closest
  worked examples: both had the two-leaks-at-once shape, and both carried a *supplied*
  half — the part the problem deliberately does not grade — that had to survive the split
  as its own participant module (`participant/wrong_ring.py`, `participant/ring.py`).
  Copy one of them rather than designing another one.

  **Update the list below when you land one.** An earlier version of this paragraph still
  named `ac26-w5-lwe-rlwe` as outstanding after #572 had merged it — the same staleness
  that this section already records as having cost a run.

  What is left, with the detector's count each — `ac26-w3-passkey-assertion` (1),
  `ac26-w3-field-inverse` (1). Landed so far: `cs-auth-claim-audit` and
  `ac26-bridge-experiment` (#562), `ac26-w3-schnorr-drill` (#570), `ac26-w5-lwe-rlwe`
  (#572), `ac26-w5-rgsw-external` (#573), `ac26-w5-cmux-blind-rotation` (#579),
  `ac26-w5-pbs-homnand` (#581), `ac26-w4-commit-open` (#582, split out of #578),
  `ac26-w5-extract-key-switch` (#584), `ac26-w5-encoding-noise` (#586).
  Catalog count is 12 as of #586, down from 39. Runs have taken the largest count first,
  so the two singletons are what is left — and both are single findings, so neither
  says much about its own points until measured (see #582 and #584 below).

  #586 is the last of the Week 5 chain and the first in this class with **no supplied
  half at all**: `fixtures/generate.py` there is entirely seed derivation plus the graded
  arithmetic, so unlike #581 and #584 nothing had to be carved out into a
  `participant/*.py`. B2 was the plain move — `fixtures/`, `tests/hidden/` and
  `verifier/` out of the participant stage, `GET /public` in, `show.py` and the public
  tests reading the deployment's public half over the network. Its free score is the
  middle of the range: handing the shipped fixtures module to the hidden suite passed 4
  of 7 checkpoints, **115 of 200 points**, because that module implements five of the
  seven names the starter asks for but not `add_noise` or `validate_params` — which is
  what held `noise`, `transfer` and `validate` shut. Copy #582 for a problem with no
  supplied half and #581/#584 for one that has.

  #584 is the opposite pole from #582 on the measurement below: its free score was the
  whole problem. All six names `starter/extract.py` asks for are implemented complete in
  `fixtures/generate.py` under those exact names, so handing that module straight to the
  hidden suite passed **all eight checkpoints, 300 of 300 points**, for nothing written —
  and what the participant image ships after the split (`participant/fhe.py`) defines none
  of the six, so the same probe scores 0. That is the range this class spans: 0/300 at
  #582, 70/300 at #581, 300/300 here. It is why the rule is to measure per problem rather
  than to infer from the finding count.

  #582 is also the first in this class whose measured free score was **zero**. Handing
  the shipped fixtures module straight to the hidden suite scored 0 of 8 checkpoints, and
  so did the starter with only its `node_hash` stub delegated to the shipped same-named
  implementation — every checkpoint still needed the rest of the file. What the single
  stage actually handed over there was the hidden checker's own assertions, plus one of
  the three functions the starter asks for. The finding count (1) does not scale with the
  points at risk in either direction: measure it per problem, and do not describe a split
  as recovering points you have not measured.

  `ac26-w3-field-inverse` and `ac26-w5-encoding-noise`'s last two findings were not new
  work landing on this list — #576 only made them **visible** (§2).
  `ac26-w3-field-inverse` is the `egcd` placeholder tuple; `ac26-w5-encoding-noise` went
  3 → 5 with `first_failure` and `success_interval`, the same class it was already listed
  for. So the catalog count rose while nothing got worse, which is the shape to expect
  whenever a rule stops being blind: never report a rise as a regression, or a fall as a
  closure.

  Both remaining are `status: draft`. No check gates a README correction any more, so
  never drop one to keep a diff small — §3 still holds even though nothing enforces it.

  `ac26-w5-pbs-homnand` (#581) is worth reading before the next one, because it is the
  first in this class whose supplied half was not already a separate file. Five earlier
  Week 5 problems' machinery lived inside `fixtures/generate.py` alongside the graded
  pipeline, so B2 there meant splitting that file along the line the problem already drew
  (`participant/fhe.py` supplied, `fixtures/generate.py` graded and re-exporting it) rather
  than moving an existing module. #584 copied that shape verbatim for
  `ac26-w5-extract-key-switch`, down to the file name, and `ac26-w5-encoding-noise` is the
  same again — copy #581 or #584 rather than designing a third one. It is also the first
  where handing
  `fixtures.generate` straight to the hidden suite does **not** pass everything — the
  artifacts carry an envelope the bare functions do not attach, so the measured free score
  was 2 of 8 checkpoints, not all of them. Measure it per problem; do not carry #573's
  "the whole problem for one import" sentence forward without checking it.

  Two things that stay true regardless: the count is a **lower bound** (§2), so never
  report "N fewer findings" as if it were the closure; and prove the boundary per
  problem, by showing the path that reached the answer before no longer reaching it.
  #570's regression test does both — it fails, and the catalog count goes back up, the
  moment `COPY fixtures/` returns to the participant stage. #573 ran that revert both
  ways to check it: 36 → 46 findings, and the new test red.

## 6. Environment traps

- `make agent-gate` does not finish here — its solvability sweep over all 108 problems
  exceeds the timeout. Use the individual commands instead
  (`bun run check:problem`, `scripts/validate-problems.ts`,
  `scripts/solvability-audit.ts --problem <id>`).
- **There may be no Docker daemon at all.** The hourly cloud routine's container has run
  without one (`/var/run/docker.sock` absent), so `make build`, `make test` and
  `docker compose` cannot run there — a container split cannot be validated by starting
  the deployment. What does work, and is what #573 used: build two directory trees whose
  contents are exactly each Dockerfile stage's `COPY` list, start `verifier/server.py`
  and `participant/server.py` from them as real processes, and drive the actual
  `VERIFIER_PUBLIC_URL` / `/verify` paths between them. That reproduces the boundary
  without an image. Say plainly in the PR that `docker compose` itself is unverified and
  that CI is what decides it — do not describe the deployment as working (§7).
- Always pass `docker compose -p <unique-name>`. **Never use `--remove-orphans`**: every
  problem's directory is named `local`, so the default project name collides and a `down`
  in one problem deletes another's running containers. This has already happened once.
- Piping a gate into `tail` or `head` masks its exit code. Run gates unpiped when the
  pass/fail matters.
- A `git worktree` checkout leaves the `problems` submodule uninitialised, which makes
  unrelated tests fail for reasons that have nothing to do with your change.
- `dl-cdn.alpinelinux.org` (all `db-*`) and `snapshot.debian.org`
  (`asm-worst-case-latency`) may be blocked by network policy. That is not a defect in
  the problem — the same job succeeds in CI. If you substitute a host-side service, say
  so explicitly in the report.
- **Actions itself can be the failure.** Between 15:01 and ~16:35 on 2026-08-26 no job in
  this repository was picked up by a runner. Two things that looked like defects were not:
  - A run whose jobs never started is reported `conclusion: failure` while **every job
    says `cancelled`** — they wait ~15 minutes for a runner and are then killed. Read the
    jobs, never the run's conclusion, before calling a red run a test failure. `main`'s
    run for the #579 merge looked like a broken merge and was thirteen cancelled jobs.
  - A required check can land in `startup_failure`, and that state is a dead end: the
    API refuses `rerun` (`403 This workflow run cannot be retried`), a companion run
    stuck in `queued` refuses both `cancel` (`409 Cannot cancel a workflow run that has
    not been queued yet`) and `rerun` (`403 This workflow is already running`), and a
    `converted_to_draft` → `ready_for_review` toggle did **not** re-fire a workflow that
    listed both events. What recovers such a PR is a new commit
    (`synchronize`). Do not reach for an empty one — §4 forbids it and it is not needed:
    an incident worth recording here is itself the commit, which is how this entry got
    written.

  Wait for the outage to pass rather than working around it. Nothing merges while it
  lasts, and a green check obtained during it says nothing.

## 7. Reporting

Do not describe something as working until you have watched it work. Prefer evidence
that reproduces the original failure and shows it now fails: that is what PR #533,
#546 and #547 did.

Never paste an answer value, a flag, or a reference solution into an Issue, a PR, or a
report. Mechanism, path, and score proportions only.
