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
- The `stub-vs-implementation` class (~45 of the detector's findings, including every
  `ac26-w5-*`). A container split does not reach it, because `fixtures/generate.py` must
  stay in the participant image to derive the deployment's public values at runtime. The
  options are recorded on Issue #543; the owner has not chosen.

Not closable by one agent playing alone — say so rather than producing a weaker artifact:

- #486, #430, #470 are **battles**: 120-minute, multi-team competitions.

## 6. Environment traps

- `make agent-gate` does not finish here — its solvability sweep over all 108 problems
  exceeds the timeout. Use the individual commands instead
  (`bun run check:problem`, `scripts/validate-problems.ts`,
  `scripts/solvability-audit.ts --problem <id>`).
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
