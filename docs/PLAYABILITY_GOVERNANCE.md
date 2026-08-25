# Challenge playability merge policy

This is a rebuild of the policy #465 introduced (Issue #463) after #476 deleted
it. Read [History](#history-why-this-was-deleted-once-and-came-back) before
touching this file, the workflow, or the checker — the same mistake has already
happened twice.

## Scope

This policy applies when a pull request does any of the following:

1. adds a new directory under `challenges/` or `battles/` (a new `metadata.json`);
2. promotes an existing problem from a non-`ready` status to `status: ready`;
3. rewrites a participant-facing file (`README.md`, `README.ja.md`,
   `local/starter/**`, `local/workbench/**`, `local/portal/**`) belonging to a
   problem that is **already** `status: ready` — i.e. a problem participants can
   already play, **or** rewrites a participant-facing *field* purely inside
   that problem's `metadata.json` — `name`, `shortDescription`, `instructions`,
   `writeup`, any scoring `hints`, a `checks[]`/`flags[]` `label`/`hints` (all
   of these including their `i18n.en` translation), or — whenever that entry's
   own `publicHint` is `true` on the base side, the head side, or both — a
   `phases[]`/`disruptions[]` entry's `name`/`description`, or
   `interTeamCoordination.name`/`.description` — without touching any of those
   files at all;
4. adds `scripts/<problem-id>.test.ts` under a matching `feat(<problem-id>):` /
   `test(<problem-id>):` title before that problem's `metadata.json` exists (the
   RED-only-commit shape from #459).

Case 3 exists because of PR #473: it rewrote hints and starter material for six
already-shipped problems, and the version of this check running at the time
only looked at cases 1/2/4, so it reported "no new problem or ready promotion"
and let the rewrite through untouched. Issue #523 later found a narrower variant
of the same gap: `hints` lives inside `metadata.json`, which was never on the
file-path list case 3 checks, so a PR that rewrote only `metadata.json`'s
`hints` — touching no README/starter/workbench/portal file — still slipped
through. The fix compares `metadata.json`'s participant-facing *fields* by
value (base vs head), not just whether the file changed; deploy/catalog-only
fields (`status`, `courseAlignment`, `nodes`/`relations`, `runtime`,
`cfnTemplate`, `exposedPorts`, `learningGoals`, `description`) are deliberately
excluded so that e.g. a pure learning-graph addition (PR #520's shape) does not
require a human blind-play. See `scripts/check-pr-playability.ts`'s
`extractParticipantFacingProjection` for the exact field list and the evidence
behind each inclusion/exclusion.

A follow-up review of Issue #523 found this was not yet complete:
`phases[]`/`disruptions[]`/`interTeamCoordination` each carry a `publicHint`
boolean, and SCHEMA.json documents the same policy on all three — `true`
reveals that entry's `name`/`description` on the participant Portal's
StatusPanel, default (`false`/absent) hides it. This is not hypothetical: on
`main` right now, `hello-world-battle`'s `disruptions[0]` and
`microservice-migration-battle`'s `interTeamCoordination` both carry
`publicHint: true` on `status: ready` problems, so that text is already live
on a participant Portal. The comparison is gated per entry by whichever side
(base or head) has `publicHint: true` — this also catches a PR that only flips
`publicHint` itself (`false`/absent → `true`, or the reverse) with the
name/description text left untouched, since that flip alone changes what a
participant can see.

Repository CI, mutation tests, reference runs and runtime tests remain
required, but they are not a substitute for a participant actually solving the
problem. The `playability-gate` check therefore requires all of the following
**once the pull request is no longer Draft**:

1. a human maintainer has applied the `playtest-verified` label after reviewing
   the evidence;
2. the PR body contains exactly one machine-readable evidence block;
3. every affected problem records a blind play, failing starter, passing
   solution, deterministic negative cases, cleanup, and a repository Issue/PR
   comment URL containing the non-secret evidence;
4. none of those fields are left as the placeholder values shown in this
   document's own example (`@github-handle`, the `.../issues/123#issuecomment-456`
   URL, `TODO`/`TBD`/`N/A`, or a `completedAt` in the future).

**While the pull request is still Draft, this check does not fail.** GitHub
already refuses to merge a Draft PR regardless of this check's result, so
failing it during Draft only produces red X on work that is not a merge
candidate yet — see [History](#history-why-this-was-deleted-once-and-came-back).

Use this block in the PR body. Do not include flags, reference solutions, hidden
verifier inputs, credentials, or cloud account identifiers.

```markdown
<!-- tenkacloud-playability-v1
{
  "schemaVersion": 1,
  "problems": [
    {
      "id": "problem-id",
      "tester": "@github-handle",
      "completedAt": "2026-08-12T12:00:00Z",
      "blind": true,
      "starterFailed": true,
      "solutionPassed": true,
      "negativeCasesPassed": true,
      "cleanupPassed": true,
      "evidenceUrl": "https://github.com/susumutomita/TenkaCloudChallenge/issues/123#issuecomment-456"
    }
  ]
}
-->
```

Replace every field above with the real values before opening the PR for
review — `tester: "@github-handle"` and the `.../123#issuecomment-456` URL are
the literal placeholders this document ships with, and the checker rejects them
by name.

The linked comment should state the tested commit, runtime/architecture, clean
start command, time to first score and completion, checks attempted, final
score, cleanup result, and any unresolved observation. It must not publish
solution material.

## Required GitHub ruleset

A repository administrator must configure `main` with all of these settings.
**None of this can be verified or applied from a source-only PR** — it is a
repository-settings trust boundary outside what `scripts/check-pr-playability.ts`
can prove, exactly as it was outside #465's reach.

- require the `playability-gate` status check before merge;
- require the existing aggregate CI, simulator compatibility, course drift, and
  security checks;
- do not allow GitHub Apps, administrators, or merge automation to bypass those
  required checks;
- restrict application/removal of `playtest-verified` to human maintainers;
- require a separate human approval for changes to
  `.github/workflows/playability-gate.yml`, `scripts/check-pr-playability.ts`,
  its tests, and this policy (this repository's `.github/CODEOWNERS` names
  `@susumutomita` for every path — it previously lived at
  `.github/workflows/CODEOWNERS`, a location GitHub does not read as a CODEOWNERS
  file at all, so it was silently inert; this PR moves it to a path GitHub
  recognizes. Moving the file alone does not enforce anything — confirm
  "Require review from Code Owners" is also enabled on the ruleset).

After applying the ruleset, verify it with two disposable PRs:

- a Draft/RED-only new-problem fixture must remain unmergeable;
- a complete fixture must remain unmergeable until evidence is valid, the PR is
  ready for review, and a human applies `playtest-verified`.

Record the ruleset URL and both PR/check URLs on Issue #463. Source changes alone
do not complete that Issue because repository settings are an external trust
boundary.

## History: why this was deleted once, and came back

- **#446** (2026-08-11 audit): five problems were promoted to `status: ready`
  without a complete Docker/Portal solve trail.
- **#459**: a PR whose body said "RED-only, incomplete, do not merge" merged
  anyway while still Draft, before CI had even started, and broke `main`.
  Emergency repair: #460.
- **#465**: introduced this gate to make both of the above a required, fail-
  closed check instead of a comment-review convention.
- **#465 postmortem** (Issue #463 comments, 2026-08-12): #465 itself merged
  while its own required CI run was still queued, and #464 merged mid-run too —
  concrete proof that "required" checks were not actually blocking merges at
  the repository-settings level. The branch-protection/bypass work in
  [Required GitHub ruleset](#required-github-ruleset) was never completed.
- **PR #473** (2026-08-13): rewrote hints/starter for six already-`status: ready`
  problems. The gate at the time only looked for new problems and ready
  promotions, reported "no new problem or ready promotion in this PR", and let
  a rewrite that leaked an answer in a hint through. This is why
  [Scope](#scope) case 3 exists now.
- **#476** (2026-08-14): with the repository owner's explicit sign-off, deleted
  this workflow, the checker, its tests, and this document, stating that future
  new problems could merge without human play. The PR body's own stated reason:
  the gate had been merged that same day and was already failing #472 and #475,
  which were Draft and intentionally red awaiting evidence — i.e. it kept
  legitimate in-progress work permanently red, not just at the point it was
  proposed for merge.
- **Immediately after #476**: PR #475 (`stackstack-first-request`, `status:
  ready`) and PR #472 (`ac26-w3-ntt-roots`, `status: draft`) both merged with no
  playability evidence — #472's evidence block was later found to still hold
  this document's own template values. Source CI on both was fully green. This
  is the concrete proof that green source CI does not imply a problem is
  actually solvable, and that removing the gate reproduced the exact failure it
  was built to prevent.
- **This rebuild**: keeps every check #465 had, and changes exactly one thing —
  the checker no longer fails while `draft` is true (see
  `scripts/check-pr-playability.ts`'s header for the full reasoning). It also
  adds [Scope](#scope) case 3 to close the #473 gap. It does not relax any of
  the field-level evidence validation; if anything that got stricter (see the
  placeholder/template rejection above).
- **Issue #523** (2026-08-25, found before merge while reviewing PR #520):
  case 3's own file-path list (`README.md`/`README.ja.md`/`local/starter/**`/
  `local/workbench/**`/`local/portal/**`) never included `metadata.json`, so a
  PR that rewrote only `metadata.json`'s `hints` on an already-`status: ready`
  problem reported "no participant-facing change" — the same class of gap as
  #473, one directory level narrower. Fixed by comparing `metadata.json`'s
  participant-facing fields by value (base vs head) instead of only checking
  `status` transitions and file paths, while deliberately keeping
  `courseAlignment`/`nodes`/`relations`/`status` and similar deploy-or-catalog-
  only fields out of scope so a learning-graph-only PR (#520's shape) still
  does not require a human blind-play.
- **Issue #523 follow-up** (same day): the first pass at the fix above treated
  `phases[].name`/`.description` as an out-of-scope rare case (gated behind
  `publicHint`, judged to matter only for `phased-polling` Battles). A
  coordinator review found `publicHint` is not rare and not limited to
  `phases[]` — it also gates `disruptions[]` and `interTeamCoordination`, and
  two live `status: ready` problems (`hello-world-battle`'s `disruptions[0]`,
  `microservice-migration-battle`'s `interTeamCoordination`) already carry
  `publicHint: true`, so their `name`/`description` are on a participant
  Portal today. Fixed by projecting all three per-entry, gated by that entry's
  own `publicHint` on whichever side (base or head) has it `true` — which also
  catches a PR that only flips `publicHint` itself, text left untouched.

**Do not delete or weaken this gate to unblock an in-progress PR.** If a
legitimate PR is stuck on this check, the fix is almost always "the PR is not
actually Draft" (mark it Draft) or "the evidence is genuinely missing" (go get
it) — not removing the check. A change that removes or weakens this gate is
itself high-impact governance policy per `AGENTS.md` and needs the same
scrutiny as the incidents above, independently reviewed, not folded into an
unrelated PR.
