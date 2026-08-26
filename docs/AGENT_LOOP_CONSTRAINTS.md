# Agent loop constraints

An hourly cloud routine works this repository toward zero open Issues and zero open PRs.
Every rule below exists because the failure it names already happened here. Read this
file before doing anything else in a run.

## 1. Do not read the answer, then claim you did not

`docs/PLAYABILITY_GOVERNANCE.md` requires a `blind` play, and
`scripts/check-pr-playability.ts` requires `blind` to be **`true`** — there is no
"partially blind". So the only way to earn it is to not look.

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

Automated checks are source evidence only. `status: draft` → `ready` and the
`playtest-verified` label require a real play. PR #479 promoted without one and was
reverted by PR #481; do not repeat it.

When you do record a play, write the `tester` field honestly:
`Claude — agent play, authorized by @susumutomita 2026-08-26`. The owner authorised an
agent to play; the governance document still says human-only, so a promotion PR must
also amend the relevant paragraph of `docs/PLAYABILITY_GOVERNANCE.md`. Do not leave the
divergence implicit — that gap is what produced the #465 → #476 → rebuild cycle.

## 4. Merging

The owner authorised self-merge on 2026-08-26 **for this goal in this repository only**.
Conditions, all required:

- The **required** check (`playability-gate`) must be green, and **no** check may have
  actually failed. Do not wait for every shard of the ~28-job matrix to report — waiting
  on non-required checks that are merely still running buys nothing and costs ~10 minutes
  a PR (owner's call, 2026-08-26).
- Read the status correctly: an in-progress check reports `conclusion` as the **empty
  string**, not `null`. Treating that as a failure blocks green PRs; treating a real
  failure as "still running" merges broken ones. Filter on
  `select((.conclusion // "") | . != "" and . != "SUCCESS" and . != "SKIPPED" and . != "NEUTRAL")`.
- Never merge with the required `playability-gate` check failing.
- Squash only (the branch ruleset permits nothing else).
- Never pass `--delete-branch` when merging the base of a stacked PR.

### Check the gate before you take a PR out of Draft

`playability-gate` passes unconditionally **while the PR is Draft** — that is the
whole point of the #476 rebuild. It is re-evaluated on `ready_for_review`, and only
then does it decide whether the change needs play evidence. So a Draft PR's green
gate says nothing about whether it can merge, and undrafting to find out leaves a
**red required check you may not be able to clear**. PR #564 was undrafted on this
assumption and went red on the next run.

Before undrafting, diff the PR against its base and check whether it touches, for a
problem whose `metadata.json` says `status: ready`:

- `README.md`, `README.ja.md`, `local/starter/`, `local/workbench/`, `local/portal/`
  (`PARTICIPANT_FACING_SUBPATHS` in `scripts/check-pr-playability.ts`), or
- the participant-facing fields of `metadata.json` (`name`, `shortDescription`,
  `instructions`, `writeup`, any `hints`, any check/flag `label`, the `i18n.en`
  mirrors, and the three `publicHint`-gated blocks).

If it does, the gate demands an evidence block **and** the `playtest-verified`
label, and `docs/PLAYABILITY_GOVERNANCE.md` restricts applying that label to human
maintainers. An agent cannot turn such a PR green on its own: leave it Draft, say on
the PR what is blocking, and hand the decision to the owner.

Note what is *not* on that list: `local/Dockerfile`, `local/docker-compose.yml`,
`local/fixtures/`, `local/participant/`, `local/verifier/`, `local/show.py`,
`local/tests/`, and the problem `Makefile`. A container split confined to those, on a
`status: draft` problem, does not trip the gate — that is why #562 and #563 merged and
#564 did not. Do not reach for the difference by dropping a needed README correction
from a PR: that is evading the gate, not passing it (§2).

## 5. What is and is not reachable

Blocked on an owner decision — **do not start these**:

- PR #564 (`sha256-bytes-padding` container split). The code is complete and every
  check is green, but it rewrites the problem's two READMEs and the problem is
  `status: ready`, so `playability-gate` requires the human-only `playtest-verified`
  label (§4). Do not undraft it again, and do not apply that label yourself.
- The same wall stands in front of the rest of that class. `sha256-schedule-logic` and
  `sha256-compress-digest` carry the last of the detector's `direct-value-comparison`
  findings, and both are `status: ready` — the split cannot be done there without
  correcting their READMEs either, so the outcome is another Draft PR waiting on the
  same decision. Do not start them until #564 is decided.

Not closable by one agent playing alone — say so rather than producing a weaker artifact:

- #486, #430, #470 are **battles**: 120-minute, multi-team competitions.

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

  What is left, with the detector's count each — `ac26-w5-pbs-homnand` (7),
  `ac26-w5-extract-key-switch` (6), `ac26-w5-encoding-noise` (5),
  `ac26-w4-commit-open` (1), `ac26-w3-passkey-assertion` (1),
  `ac26-w3-field-inverse` (1). Landed so far: `cs-auth-claim-audit` and
  `ac26-bridge-experiment` (#562), `ac26-w3-schnorr-drill` (#570), `ac26-w5-lwe-rlwe`
  (#572), `ac26-w5-rgsw-external` (#573), `ac26-w5-cmux-blind-rotation` (#579). Catalog
  count is 31 as of #579, down from 39. Runs have taken the largest count first, so
  `ac26-w5-pbs-homnand` is next.

  The last two entries are new to this list, and neither is new work landing on it —
  #576 only made them **visible** (§2). `ac26-w3-field-inverse` is the `egcd` placeholder
  tuple; `ac26-w5-encoding-noise` went 3 → 5 with `first_failure` and `success_interval`,
  the same class it was already listed for. So the catalog count rose while nothing got
  worse, which is the shape to expect whenever a rule stops being blind: never report a
  rise as a regression, or a fall as a closure.

  **All seven remaining are `status: draft`**, so none of them hits the
  `playtest-verified` wall of §4 — a B2 split there is a PR an agent can carry
  to merge on its own, README correction included. Do not drop a needed README
  correction to stay under the gate (§4); on a `draft` problem it does not fire anyway.

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

## 7. Reporting

Do not describe something as working until you have watched it work. Prefer evidence
that reproduces the original failure and shows it now fails: that is what PR #533,
#546 and #547 did.

Never paste an answer value, a flag, or a reference solution into an Issue, a PR, or a
report. Mechanism, path, and score proportions only.
