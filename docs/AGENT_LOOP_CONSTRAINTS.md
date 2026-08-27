# Agent loop constraints

An hourly cloud routine works this repository toward zero open Issues and zero open PRs.
Every rule below exists because the failure it names already happened here. Read this
file before doing anything else in a run.

## 1. Do not read the answer, then claim you did not

Nothing machine-checks this any more. The `playability-gate` workflow, its checker and
`docs/PLAYABILITY_GOVERNANCE.md` were deleted on 2026-08-27 (owner's call: waiting on a
human blind play kept Issues open indefinitely). That removes the enforcement, not the
requirement — it is now entirely on you not to look, and nothing will catch you if you do.
There is no "partially blind".

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

Automated checks are source evidence only. They show a problem builds, grades and cleans
up; they never show it is solvable, that the hints hold on every seed, or that a correct
answer is called correct. PR #479 promoted on machine evidence alone and was reverted by
PR #481.

Since 2026-08-27 no gate stops that repeat. So: do not raise `status` to `ready` unless
you actually solved the problem, blind, from the participant surface. If you did, say so
in the PR body in your own words — who played, from what starting state, what the run
produced. If you did not, leave it at `draft` and say why.

## 4. Merging

The owner authorised self-merge on 2026-08-26 **for this goal in this repository only**.
Conditions, all required:

- **No** check may have actually failed. `main` has no required status check since
  2026-08-27, so nothing blocks a merge for you — read the checks yourself. Do not wait
  for every shard of the ~28-job matrix to report: waiting on checks that are merely
  still running buys nothing and costs ~10 minutes a PR (owner's call, 2026-08-26).
- Read the status correctly: an in-progress check reports `conclusion` as the **empty
  string**, not `null`. Treating that as a failure blocks green PRs; treating a real
  failure as "still running" merges broken ones. Filter on
  `select((.conclusion // "") | . != "" and . != "SUCCESS" and . != "SKIPPED" and . != "NEUTRAL")`.
- Squash only (the branch ruleset permits nothing else).
- Never pass `--delete-branch` when merging the base of a stacked PR.

## 5. What is and is not reachable

Blocked on an owner decision — **do not start these**:

- **PR #604 (`chore/prune-extra-ci`, "reduce catalog to problem payloads").** Open since
  2026-08-27 06:00, `+36 / -90063` over 275 files. It deletes every root script, every
  validator, the whole `.github/workflows` CI, the root `Makefile` — and with it
  `make agent-gate`, which `AGENTS.md` names as the completion contract — plus the
  authoring docs and skills. It is a proposal to move validation out of this repository
  and onto the platform's publish path. That is the owner's call about what this
  repository *is*, not a PR an agent may self-merge under §4, and its
  `mergeable_state: dirty` conflict must not be resolved by an agent either: every merge
  since it was opened adds scripts and tests it deletes, so resolving the conflict *is*
  deciding whether that new work survives. It also carries no CI signal to read (it
  removes the workflows, so only GitGuardian reports). Leave it open; do not count it
  against the zero-PR goal and do not re-derive this every run.

Previously blocked by `playability-gate`, now unblocked: PR #564 (`sha256-bytes-padding`)
and PR #578 (`sha256-schedule-logic`) were held because they rewrite a `status: ready`
problem's READMEs and the gate demanded a human `playtest-verified` label. The gate was
deleted on 2026-08-27, so both are ordinary PRs again. **Both have since merged** — #564
(`e007a5c`) and #578 (`c981e44`) — and `sha256-compress-digest` followed in #596
(`55635df`). That wall is gone from the whole class.

What the gate's removal does **not** change: §1 and §3 still hold. Nothing machine-checks
them now, so a PR that rewrites a `ready` problem's participant surface should say, in its
own body, whether anyone actually played it and from what starting state. "The gate is
gone" is not the same as "it is verified".

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

  **Nothing is left in this class.** Landed: `cs-auth-claim-audit` and
  `ac26-bridge-experiment` (#562), `ac26-w3-schnorr-drill` (#570), `ac26-w5-lwe-rlwe`
  (#572), `ac26-w5-rgsw-external` (#573), `ac26-w5-cmux-blind-rotation` (#579),
  `ac26-w5-pbs-homnand` (#581), `ac26-w4-commit-open` (#582, split out of #578),
  `ac26-w5-extract-key-switch` (#584), `ac26-w5-encoding-noise` (#586),
  `ac26-w3-passkey-assertion` (#590), `ac26-w3-field-inverse` (#594).
  **The catalog count is 0 and `scripts/answer-reachability-baseline.json` is `{"known": []}`**,
  down from 39: the last six were `sha256-schedule-logic`'s and `sha256-compress-digest`'s
  `direct-value-comparison` findings, a different class, closed by #578 and #596
  (`sha256-bytes-padding`'s four closed with #564). Do not read the empty baseline as
  "nothing is reachable" — §2's lower-bound caveat still holds. Runs took
  the largest count first, so the last two here were singletons — and a single finding
  said nothing about its own points until measured (see #582, #584 and #594 below).

  #594 is the first in this class whose **public half takes arguments**. `make inspect
  A=17 P=101` traces any pair the learner names, and `starter/field.py`'s own docstring
  points at it, so the trace is participant surface by design and had to survive the
  split: `GET /public` there takes the same optional `a`/`modulus`, and the default the
  learner gets when they name neither (`p // 3 + 1`, `p`) moved into `fixtures/` beside
  it rather than staying in `show.py`, which no longer has a prime to compute it from.
  Copy it, not #586, for any problem whose `make inspect` accepts arguments.

  #594 is also the first to measure **both** probes and act on the second. Its
  participant-image free score needed two probes to state honestly: the shipped fixtures
  module handed straight to the hidden suite passes **0 of 7**, because it defines no
  `Field` or `FieldElement` at all; the starter with its three stubs delegated to that
  module — the cheapest real use of the leak — passes **1 of 7, 35 of 200 points**, the
  `egcd-trace` checkpoint. That is lower than the 70–145 the baseline entry carried from
  #537's estimate: report the measurement, not the estimate you inherited. And the
  submission-side probe (§ below, Issue #591) still scored that same **35 of 200** after
  the split, so #594 ported #590's `sys.path`/`sys.modules` guard into its runner and
  re-measured at 0. A split that closes only the participant image is half a fix on a
  problem where the two probes disagree — measure both before claiming a leak is closed.

  Check `git ls-remote --heads origin` before starting anything here: two sessions
  work this list with no claim mechanism, and #583 was thrown away for duplicating #584.
  Pushing the branch before doing the work is what #590 did to claim it.

  **What a B2 split does not close, measured.** The split takes the material out of the
  *participant image*. It does not take it out of the image the *submission runs in*:
  every verifier's runner does `sys.path.insert(0, {root!r})` before importing the
  submitted file, and `fixtures/` and `tests/hidden/` are on that path because grading
  needs them. So a one-line submission — `from fixtures.generate import *`, nothing
  implemented — still scores, after the split, on merged problems: **8/8 checkpoints
  (300/300) on #584**, **4/7 (115/200) on #586**, 0/8 on #582 — in each case exactly the
  free score that was measured *before* the split. `ac26-w3-passkey-assertion` was
  3/3 (200/200) the same way until #590 added the guard `cs-transaction-visibility-audit`
  already uses: drop the `fixtures`/`tests` modules and the problem root from `sys.path`
  and `sys.modules` before importing the submission. #594 ported that guard, and re-measured
  at 0.

  **#597 (`d46b8b9`) closed that path catalog-wide and Issue #591 with it.** 52 verifiers
  have the root-on-`sys.path` pattern; 41 needed the guard (40 unguarded plus the
  `cs-transaction-visibility-audit` precedent, which evicted `tests` but not `fixtures` —
  so the leak stayed open there). 31 got it, and `scripts/verifier-fixtures-guard.test.ts`
  pins the shape. The 10 left out are deliberate and now **measured**, not asserted:
  `ac26-bridge-properties`, `ac26-w2-oblivious-transfer`, `ac26-w6-cosnark-{beaver,linear,privacy}`,
  `ac26-w6-stack-design`, `ac26-w6-zkvm-{exploit-predicate,witness-binding}` and
  `ac26-w7-capstone-{demo,design}` all pre-date the B2 split and their reference solutions
  import `fixtures.generate` for a legitimate supplied helper, so the guard would break
  correct grading rather than close anything. A `from fixtures.generate import *`
  submission scores **0** on every one of the ten. Do not re-measure these; do not add the
  guard to them.

  **How to measure a probe without Docker** (§6 says there may be no daemon). Import the
  problem's `verifier/server.py` as a module with `FLAG_SEED` set and call its own
  `evaluate(checkpoint_id, submission)` for each id in `CODE_CHECKPOINTS`. That is the real
  grading path — the same `RUNNER`, the same subprocess, the same guard — so no separate
  harness has to be trusted. Two probes, per §5: **submission-side**, whose submission is
  `from fixtures.generate import *`; and **participant-image**, whose submission is the
  *inlined source* of whatever that problem's participant stage actually ships (its
  `fixtures/generate.py` where the stage still carries it, its `participant/*.py` where B2
  has split it). Inlining is what makes the second probe answer the right question: the
  participant reads the file in their own container and pastes it, so the guard — which only
  blocks `import` — is not in the path.

  **Always run a positive control**, or a probe that is silently broken reports the same 0 as
  a problem that is closed. Delete the `_hidden_modules` guard from one verifier, re-run, and
  show the score come back. On `ac26-w5-extract-key-switch` that is **8/8 without the guard,
  0/8 with it**, which is the #584 free score reappearing exactly. A guard-removal control
  that stays 0 proves nothing about the probe: `sha256-compress-digest` reads 0/4 either way,
  because its hidden checker imports its entry point before the submission.

  **Measured 2026-08-27, catalog-wide — do not repeat this sweep.** 35 problems still carry
  `fixtures/` in their participant stage. One (`acm-validation-migration`) has no
  `verifier/server.py` and is out of scope for this probe, and three drills
  (`ac26-w4-fri-drill`, `ac26-w4-plonk-drill`, `ac26-w4-sumcheck-drill`) declare **no code
  checkpoints at all**, so the probe is vacuous there and says nothing — count them as
  unmeasured, not as closed. The remaining **31 score 0**, as do both probes on all four of
  Issue #538's problems (`ac26-w3-passkey-assertion`, `sha256-bytes-padding`,
  `sha256-compress-digest`, `ac26-w2-linear-shares`, split by #590, #564, #596 and #563).
  #538 was closed on that evidence.

  What the sweep does **not** settle, and what keeps #543 open: **7 problems still
  `COPY verifier/` into their participant stage** — **3** as of #617: the `ac26-w6`/`w7`
  ones above, less the three cosnark problems and both capstones
  (`ac26-w4-proof-pipeline` came off in #611, `ac26-w6-cosnark-beaver` in #613,
  `ac26-w6-cosnark-linear` in #614, `ac26-w6-cosnark-privacy` in #615,
  `ac26-w7-capstone-demo` in #616, `ac26-w7-capstone-design` in #617). The three left,
  scanned on `5a28f53`, are
  `ac26-w6-stack-design`, `ac26-w6-zkvm-exploit-predicate` and
  `ac26-w6-zkvm-witness-binding`
  — count them yourself rather than trusting this sentence; the one-line check is
  a per-stage scan of each `local/Dockerfile`'s `COPY` list, not a `grep` over the whole
  file, because every problem's `verifier` and `author` stages copy `verifier/` legitimately.
  That is the structural shape #543 was opened on,
  and the owner chose B (separate verifier container) over A (accept and document).
  Grep for the shape rather than trusting a plain `^COPY verifier/`:
  `ac26-w2-oblivious-transfer` writes `COPY --chown=lab:lab verifier/`, and a scan that
  misses it will report this list as shorter than it is.
  Measuring 0 says no graded answer is reachable *today*; it does not convert those 17 to
  option A. Closing #543 needs either the split or the owner writing the narrower boundary
  into `TEMPLATE.md` — so it is reachable work, not an owner block.
  **Update this list when you land one.** `ac26-w2-secret-sharing` came off it in #599 —
  the first B2 split driven by the `COPY verifier/` shape rather than by a detector
  finding, and the first whose measured free score was **zero on both probes before the
  split as well as after**. `fixtures/generate.py` there defines none of the four names
  `starter/sharing.py` asks for, so the name-based detector reported it zero times and
  still does: the reachability count is unchanged at 0 across that whole PR, which is §2's
  lower-bound caveat showing up as a number. What the single stage actually handed over was
  `tests/hidden/check_sharing.py`'s assertions for four of the five checkpoints, plus
  `_check_threshold` — the acceptance rule for the fifth — and a `reference_shares` that
  builds a correct split of the deployment's secret. Do not expect a points figure from
  every problem on this list; report the one you measure, including when it is 0.
  #599 is also the first in the class with a **direct-answer checkpoint** (`threshold`), so
  the `tcw1.` seal check had to be duplicated into the verifier the way ac26-w4-commit-open
  does it — copy that pair for any of the 17 whose scoring has a non-code checkpoint.

  `ac26-w2-oblivious-transfer` came off the list next, and is the first one that also
  **came off Issue #591's ten-verifier exception list** (`scripts/verifier-fixtures-guard.test.ts`).
  Those ten were left unguarded because each one's reference imports `fixtures.generate`
  for a legitimate supplied helper, so evicting `fixtures` would fail the reference. The
  B2 split is what removes that objection: the supplied half — here `derive_key` — moves
  into `participant/ot.py`, which the guard does not evict, so the guard goes in and the
  submission-side probe is closed structurally rather than by measurement alone. **Check
  this before deciding a split is done on any of the other nine**: if the split moves the
  supplied helper out of `fixtures/`, the guard becomes applicable in the same PR, and
  leaving it out is the "half a fix" §5 already warns about. Verify it with the reference,
  not by inspection — the guard drops the problem root from `sys.path` during the
  submission import, so the supplied module resolves only through the module cache the
  hidden checker's own import populated.

  Its measured free score was **0 on both probes before the split as well as after**,
  with the reference at 6/6 (200/200) as the positive control both times — the
  guard-removal control is flat here, so the reference is the only usable one, as with
  #600. `fixtures/generate.py` defines none of the seven names `starter/oblivious.py`
  asks for, so the name-based detector reported it zero times and the reachability count
  is unchanged at 0 across the PR. What the single stage actually handed over was
  `tests/hidden/check_oblivious.py`, whose assertions decide all six checkpoints —
  including `check_receiver_privacy` and `check_gate_privacy`, which between them state
  the two properties the problem exists to make a learner derive. A points figure is the
  wrong measure of that leak; say what was readable instead.

  `ac26-w2-beaver-mul` came off the list in #600, on the same `COPY verifier/` shape and
  with the same measured result: **0 on both probes before the split as well as after**,
  and the reachability count unchanged at 0 throughout, because `fixtures/generate.py`
  defines none of the four names `starter/beaver.py` asks for. Two things it adds to the
  worked examples. First, its positive control had to be the **reference solution**
  (5/5 checkpoints, 200/200) rather than a guard removal: deleting the `_hidden_modules`
  guard leaves the score at 0 here, which §5 already says proves nothing — reach for the
  reference whenever the removal control is flat. Second, its public payload is the first
  that had to **withhold half of a symmetric pair**: `show.py` prints the shares of `x` and
  of the triple, so `x`, `a`, `b` and `c` are already a plain sum away and travel as values,
  while `y` never appears in either and stays out of `GET /public` — without it the product
  cannot be named without running the protocol, which is what keeps `combine` worth its
  points. Copy it for any problem whose `make inspect` prints one side of a two-input
  computation.

  `ac26-w2-privacy-audit` came off the list in #603, and is the one to copy when the
  material at risk is the **hidden checker rather than the fixtures**. Both of §5's
  probes read **0 of 300 before the split as well as after**, with the reference at 7/7
  (300/300) as the positive control both times and the guard-removal control flat, so
  a report that stopped at those two numbers would have said nothing was leaked. What
  the single stage actually handed over was the decision rule itself: the hidden
  checker's own `_expected_index` and `_leaks` state, event kind by event kind, the rule
  `first_violation` is graded on; `check_repair` states `repair`'s acceptance rule; and
  `fixtures/generate.py`'s `TRUTH` names the verdict for each of the seven programs by
  id. An auditor **transcribed from those two shipped files** — no reasoning past
  copying them — scored **7 of 7 checkpoints, 300 of 300 points**, which is the #584 pole
  reached by a path neither standard probe walks. So: when a problem grades by running a
  hidden suite whose assertions *are* the rule, add a third probe that transcribes what
  the participant stage ships, and report that number. `public_payload` there is the
  spec, the one clean run's trace and the health token — the six leaking programs and
  the `bravo` transcript stay in the verifier, because either would answer a checkpoint
  outright.

  `ac26-w2-private-aggregate` came off the list in #605, on the same shape as #603 and
  with the same numbers: both standard probes **0 of 300 before the split as well as
  after**, the reference at 8/8 (300/300) as the positive control, the guard-removal
  control flat, and the reachability count unchanged at 0 throughout — the detector is
  blind to this problem in **both** directions, which the restore-the-leak run shows.
  The third probe is the one that says what was leaked: a submission **transcribed from
  the two shipped files**, with no reasoning past copying them, scored **8 of 8
  checkpoints, 300 of 300 points**. `tests/hidden/check_aggregate.py`'s `check_plan`
  states the three numbers `plan()` must return — the numbers the starter deliberately
  withholds, because estimating them *is* the problem — while `check_cost` states the
  round count and the opening count it accepts and `check_privacy` states the exact
  multiset a run may reveal.

  Two things it adds to the worked examples. First, its `GET /public` carries the
  **whole** input rather than a withheld half like #600's: the public tests hand exactly
  these shares to `aggregate` as its arguments, so a submission holds every one of them
  at runtime by construction and withholding them here would hide them from the tests and
  from nobody else. What stays behind is the seed derivation — the hidden `h0`/`h1`/`h2`
  labels every checkpoint is actually graded on derive a different modulus, a different
  organization count and different secrets from the same seed. Reach for that reading
  whenever a problem's public label is not the graded one. Second, the supplied half was
  the **opening handle itself** (`Protocol`, `ForbiddenOpen`), which the public tests
  construct and the hidden checker grades through; it moved to `participant/protocol.py`
  and `fixtures/generate.py` imports it, so the round counting a learner sees is the
  round counting they are graded by. The verifier stage copies that one file, not
  `participant/`.

  `ac26-w3-ec-group` came off the list in #606, and it is the **cleanest measurement
  of what this class leaks** so far — the one to point at when somebody asks whether a
  `COPY verifier/` problem is really giving anything away. Both standard probes read
  **0 of 300 before the split as well as after**, the reference is 8/8 (300/300) as the
  positive control, the guard-removal control is flat (the verifier already carried
  #597's guard), and the reachability count is unchanged at 0 throughout. #603's third
  probe is what speaks: `tests/hidden/check_curve.py` carries `_ReferenceCurve`, a
  complete and correct group law — the identity kept distinct from every affine point,
  the inverse, the chord formula, the tangent formula, the vertical-tangent case at
  y = 0, and double-and-add including a negative scalar. Those are, verbatim, the five
  things `starter/curve.py` tells the learner the problem will not let them skip. A
  submission that copies that class and wires it to the starter's own declared API,
  with no reasoning past copying, scores **8 of 8 checkpoints, 300 of 300 points** — the
  #584 pole again, reached by transcription rather than by import. When a problem's
  hidden checker holds its own ground-truth implementation, that class *is* the answer;
  do not let two zero probes talk you out of measuring the third.

  It is also the first in this class with **no supplied half and an argument-taking
  `make inspect`** at once: `fixtures/generate.py` is seed derivation and point
  enumeration only, so nothing had to move to `participant/` and the verifier stage
  copies no participant file at all — while `make inspect K=13` still has to work, which
  it does without a payload change, because the scalar is the learner's and only the
  curve comes from `GET /public`. Copy #586 for the stage layout and #594 only if the
  *payload* has to vary with the argument.

  `ac26-w3-fft-domain` came off the list in #607, and it is the sharpest case yet of the
  #603/#606 reading — *the starter's own text names the leak*. `starter/fftdomain.py`
  tells the learner that whatever establishes "order exactly n" has to be added by them
  because "nothing else in the image decides it for you", and that sentence was false:
  the single stage also carried `tests/hidden/check_fftdomain.py`, whose `has_order` is
  that decision written out from the definition, beside `naive_omega` (the rule the
  shipped starter trusts) and `real_omega` (an element of each kind for any p, n). When
  a starter makes a claim about what the image does not contain, check the claim before
  measuring anything — it points straight at the file to look in.

  Both standard probes read **0 of 200 before the split as well as after**, the
  guard-removal control is flat, and the reference at 5/5 (200/200) is the positive
  control. The third probe: the starter with that predicate copied into its own
  `_domain_ok`, no reasoning past copying, scores **5 of 5 checkpoints, 200 of 200
  points**. The reachability count is unchanged at 0 throughout — the detector is blind
  to this problem in both directions, which the restore-the-leak run shows: put
  `COPY fixtures/ tests/ verifier/` back into the participant stage and the count stays
  0 while two of the new tests go red.

  Two things it adds to the worked examples. Its **public tests need no payload at all**
  — every domain in `tests/public/test_fftdomain.py` is written out in that file — so
  only `show.py` reads `GET /public`, and `PUBLIC_EVIDENCE_JSON` is what makes that path
  testable without a daemon (the test drives `show.main()` through both branches and
  diffs them across 30 seeds). And its `fixtures/generate.py` is **orientation only**: it
  deliberately computes no order, so unlike #606 nothing in it was ever the answer — the
  payload is the field family, the legal orders in each (divisibility, the necessary
  half, always printed), and the two fixed example domains. Reach for that reading when
  the fixtures module is innocent and the hidden checker is not.

  `ac26-w3-nonce-reuse` came off the list in #608, and it is the first in this class
  whose leaked material was an **answer as a value in `fixtures/`**, not a rule in the
  hidden checker. Both standard probes read **0 of 300 before the split as well as
  after** — `fixtures/generate.py` defines none of the eight names `starter/recover.py`
  asks for, so the name-based detector reported it zero times and the reachability count
  is unchanged at 0 across the PR, in both directions (the restore-the-leak run puts
  `COPY fixtures/ tests/ verifier/` back and the count stays 0 while the two new tests go
  red). The guard-removal control is flat, so the reference at 8/8 (300/300) is the
  positive control. #603's third probe is what speaks: a submission transcribed from the
  two shipped files — `deterministic_nonce` copied verbatim as `safe_nonce`, and the
  hidden checker's `_really_accepts` copied verbatim beside the three conditions
  `check_detect`'s own failure branches state — scores **2 of 8 checkpoints, 70 of 300
  points** (`detect` and `repair`), with no reasoning past copying. Worse than the points:
  `audit_log` returns `victim_secret` and `victim_public`, and `secret_key` derives every
  key in the deployment from the `FLAG_SEED` the participant container carries in its
  environment — so the hidden labels' keys were computable in the learner's own container
  and hard-codable into a submission. That path is not measurable by any of the three
  probes (the grading subprocess gets `PATH` only, no seed), which is why the file list,
  not a score, is the evidence for it.

  It also adds one thing to the worked examples that every later split on this list needs
  to check: **a supplied half the submission itself must import**. `collision` grades a
  measurement of `truncated_nonce`, so `starter/recover.py` names the module by name.
  #597's guard takes the problem root off `sys.path` for the submission's import, so after
  the move a learner's natural top-level `from participant.schnorr import ...` resolves to
  nothing and *every* checkpoint fails on an import error — the reference only survives
  because it imports inside function bodies. The fix is one line in the RUNNER: preload
  `participant.schnorr` before the guard and leave it in `sys.modules`, which the guard
  never evicts. Measured: a submission that writes only `collision_experiment` with that
  top-level import scores 1 of 8, and `from fixtures.generate import *` still scores 0.
  Check this whenever the split moves something the *starter* tells the learner to call.

  `ac26-w3-ntt-roots` came off the list in #609, and it is the **twin of #607**: same
  week, same family, same leaked predicate, and the same reading — the starter's own text
  names the file to look in. `starter/ntt.py` tells the learner that whatever establishes
  the order has to be added by them because "nothing else in the image computes it for
  you", and the single stage also carried `tests/hidden/check_ntt.py`, whose `has_order`
  is that decision written out from the definition, beside `naive_omega` (labelled there
  "the rule the broken starter uses") and the `invalid_omega` rejection
  `inverse_transform` is graded on. Both standard probes read **0 of 200 before the split
  as well as after**, the guard-removal control is flat (the verifier already carried
  #597's guard), and the reference at 6/6 (200/200) is the positive control. The third
  probe: the starter with that predicate copied in and scanned over — no reasoning past
  copying and a `range` — scores **6 of 6 checkpoints, 200 of 200 points**. The
  reachability count is unchanged at 0 throughout, in both directions (the restore-the-leak
  run puts `COPY fixtures/ tests/ verifier/` back and the count stays 0 while two of the
  new tests go red).

  What it adds to the worked examples is the *pairing rule*: when two problems in a week
  are built on the same misconception, the second split is #607's diff with names changed,
  and reading the first one's PR is cheaper than re-deriving the shape. It is otherwise
  #607 exactly — no supplied half, so the verifier stage copies no participant file, and
  the public tests need no payload because every parameter set is written out in
  `tests/public/test_ntt.py`. One thing to copy regardless of shape: with no Docker daemon
  (§6), build one directory tree per stage from that stage's own `COPY` list, start
  `verifier/server.py` and `participant/server.py` from them as real processes, and drive
  `GET /public` and `/verify` between them. That showed the participant tree at five files
  with the order test in none of them, the reference at 6/6 through the Workbench proxy
  and the shipped starter at 0/6 — which no file-list assertion on its own establishes.

  `ac26-w4-arithmetization` came off the list in #610, and it is the first in this class
  whose third probe scored **part** of the problem rather than all or nothing — which is
  the reading to take from it. Both standard probes read **0 of 300 before the split as
  well as after** (`fixtures/generate.py` defines none of the eight names
  `starter/air.py` asks for), the guard-removal control is flat, and the reference at 8/8
  (300/300) is the positive control; the reachability count is unchanged at 0 throughout,
  in both directions — the restore-the-leak run puts `COPY fixtures/ tests/ verifier/`
  back and the count stays 0 while the two new boundary tests go red. #603's third probe
  is what speaks: a submission transcribed from the two shipped files, with no reasoning
  past copying, scores **5 of 8 checkpoints, 185 of 300 points**. `fixtures/generate.py`'s
  `honest_trace` is, by its own docstring there, "the reference answer for the trace
  checkpoint"; `tests/hidden/check_air.py`'s `check_transition` requires `steps - 1`
  residuals, which is exactly the count `starter/air.py` tells the learner to work out
  ("it is not the number of rows"); that checker's module docstring says "the transition
  out of row i breaks row i+1", which is the whole of what `first_violation` is graded on;
  and `check_underconstrained` writes out all four conditions a witness is accepted on,
  down to naming the constraint that had to be missing. It stops at five because neither
  shipped file contains an interpolation, so `interpolate`, `compose` and `transfer` were
  never reachable by copying. **Report the fraction, not a verdict**: "the transcription
  scored" and "the transcription scored everything" are different findings, and only the
  measurement separates them.

  Its public payload is the first in this class to carry the **answer to a graded
  checkpoint as values, deliberately**. `make inspect` has always printed the rows the
  machine produces, so withholding them would have changed the participant surface; what
  makes that safe is that every checkpoint is graded on the `h0`/`h1`/`h2` labels, each a
  different prime, trace length, weight and starting state, and the recurrence that
  produces the rows is public in `starter/air.py` and the README anyway. Reach for #605's
  reading — the public label is not the graded one — before withholding a value the
  learner already sees. There is no supplied half (every graded function is handed its
  setting, its trace and its domain), so the verifier stage copies no participant file.

  Two consequences for reporting. `scripts/check-answer-reachability.ts` only ever sees
  the participant image, so a finding count says nothing about this path — never write
  "N fewer findings" as if it were the closure (§2 already says this; here is why it
  bites). And measure **two** probes per split, not one: the participant image's
  reachability *and* a submission that imports the material at grading time. A PR body
  that reports only the first, as the merged ones above do, overstates what landed.

  `ac26-w4-proof-pipeline` came off the list in #611, and it is the one to read for a
  leak that is **not in the image at all**. It is otherwise #603/#606 exactly: both
  standard probes read **0 of 300 before the split as well as after**, the guard-removal
  control is flat (the verifier already carried #597's guard), the reference at 8/8
  (300/300) is the positive control, and the reachability count is unchanged at 0
  throughout, in both directions — the restore-the-leak run puts `COPY fixtures/ tests/
  verifier/` back and the count stays 0 while two of the new tests go red. #603's third
  probe is what speaks: `tests/hidden/check_pipeline.py`'s `_reference_first_fault` is a
  complete and correct implementation of every layer contract `starter/pipeline.py` asks
  the learner to write, and `check_graph`, `check_assumptions` and `check_diagnose` write
  out the graph construction, the assumption matrix and the layer order beside it, while
  `fixtures/generate.py` carries `UNSUPPORTED_CLAIMS` (the `cost` checkpoint's ground
  truth) and `FAULTS` (the layer `first_fault` must report, and the single field `repair`
  may touch, per fault). A submission transcribed from the two, with no reasoning past
  copying, scores **7 of 8 checkpoints, 270 of 300 points**. It stops at seven because
  the hidden checker probes `cost` with synthetic claims, so copying the ground-truth id
  list does not survive.

  What it adds to the worked examples is a **fourth place to look, which no probe finds
  and no Docker split closes: the record the submission is handed**. `faulted_run` labels
  a faulted run `"<label>:<fault>"` and that label travelled as a field of the run, so
  `first_fault` and `repair` were passed the name of the fault they were being asked to
  diagnose — on the graded `h0`/`h1`/`h2` labels as much as on the public one. Dropping
  that one field takes the transcription probe from 7/8 to 6/8; `diagnose` is 50 of the
  300 points. Nothing else read it. **Check the arguments a graded function receives, not
  only the files the stage ships**: a split that closes the image while the record still
  names its own answer is the "half a fix" this section already warns about, and the two
  standard probes report the same 0 either way.

  It is otherwise the plain move — no supplied half (every graded function is handed its
  definition and its run), so the verifier stage copies no participant file; the public
  tests do need the payload, so copy #605's wiring for those rather than #607's.

  `ac26-w6-cosnark-beaver` came off the list in #613, and it is the first one in this class
  to come off **Issue #591's ten-verifier exception list as well** since
  `ac26-w2-oblivious-transfer` — check that pairing on every remaining one, because the
  guard test's own canary is what signals it: the exception entry asserts the reference
  still imports `fixtures`, so the moment the split moves the supplied helper it goes red,
  and the fix is to add the guard and drop the entry, never to relax the check. Here the
  helper was `field_id`, and the whole supplied sharing layer moved with it into
  `participant/mpc.py`. Verify the pairing with the reference, not by inspection: the guard
  drops the problem root from `sys.path` during the submission import, so the reference's
  own top-level `from participant.mpc import field_id` resolves only because the runner
  preloads that module before the guard (#608's rule), and the reference measured 8/8
  (300/300) with the guard in place.

  It is also the sharpest **transcription** measurement on this list so far: both standard
  probes read **0 of 300 before the split as well as after** (`fixtures/generate.py` defines
  none of the eight names `starter/prover.py` asks for, so the name-based detector reported
  it zero times), the guard-removal control is flat, and the reachability count is unchanged
  at 0 throughout in both directions — the restore-the-leak run puts `COPY fixtures/ tests/
  verifier/` back into the participant stage and the count stays 0 while the new stage test
  goes red. #603's third probe is what speaks: a submission transcribed from the two shipped
  files, with no reasoning past copying, scored **8 of 8 checkpoints, 300 of 300 points** —
  the #584 pole. `tests/hidden/check_prover.py` writes out `check_plan`'s whole expected
  table, `check_masks`'s `A - x` and `B - y`, `check_artifact`'s key list and `check_audit`'s
  six values, and `check_product`'s two *named* failure messages ("every party folded the
  public d\*e into its own share", "the public d\*e term is missing") between them state the
  correct fold; the Beaver identity itself was written out in prose in the shipped
  `fixtures/generate.py` docstring. **A failure message that names the defect names the
  answer** — read a hidden checker's error strings, not only its assertions, before
  concluding a problem leaks nothing.

  What it adds to the worked examples: the supplied half here is a whole *layer*, not a
  helper — `Share`, `Triple`, `Runtime`, `ParticipantRuntime` and `linear_halves`, plus the
  `_stream`/`_pick` seed helpers they need — and the hidden checker builds its scenarios on
  the same objects, so the verifier stage copies `participant/mpc.py` in and
  `fixtures/generate.py` re-exports it. One implementation, graded and inspected, rather than
  two that can drift. Its `GET /public` carries the setting, the four coefficient shapes and
  the public label's witness, on #605's reading (the public tests hand the sharings built
  from that witness straight to the graded functions, so a submission holds them at runtime
  by construction); what stays behind is the derivation, which is what makes `h0`..`h3`
  unreachable rather than merely unnamed.

  `ac26-w6-cosnark-linear` came off the list in #614, and it is the **#609 pairing rule
  applied to a whole-file split**: same week, same `fixtures/generate.py` layout, same
  supplied layer, and #613's diff with names changed. Reading that PR first was cheaper than
  re-deriving the shape, and this one is the cheapest confirmation the rule holds — the two
  problems' `Share`, `Runtime` and `ParticipantRuntime` are the same classes, so the carve
  line was already drawn. It also came off Issue #591's ten-verifier exception list in the
  same PR, on #613's pairing: `field_id` moved with the layer, so the guard became
  applicable and leaving it out would have been the half a fix this section warns about.
  Verified against the reference, not by inspection — **8/8 (300/300) with the guard in
  place**, which is the only way to see that the runner's `import participant.mpc` preload
  is what keeps `reference/prover.py`'s own top-level import resolvable.

  Both standard probes read **0 of 300 before the split as well as after**
  (`fixtures/generate.py` defines none of the six names `starter/prover.py` asks for, so the
  name-based detector reported it zero times), the guard-removal control is flat, and the
  reachability count is unchanged at 0 throughout in both directions — the restore-the-leak
  run puts `COPY fixtures/ tests/ verifier/` back into the participant stage and the count
  stays 0 while the new stage test goes red. #603's third probe is what speaks: a submission
  transcribed from the two shipped files, with no reasoning past copying, scored **8 of 8
  checkpoints, 300 of 300 points** — the #584 pole. `_Scenario.canonical` *is*
  `parse_relation`'s answer and the `malformed` list beside it enumerates all eight refusals;
  `check_witness` writes out the four reported keys and the five tamperings; `_trace_failures`
  computes `operations`, `rounds`, `messages`, `parties` and `localOnly` in the report's own
  terms, so the trace stage — the one the problem's own docstring says is worth no points if
  asserted rather than measured — was copyable line for line; and `check_audit` gives the five
  values an honest run reports beside `_GhostRuntime`, `_LeakyRuntime` and `_OpenRuntime`,
  each **named for the property it catches**. #613's rule generalizes past error strings: a
  hidden checker's *class and helper names* name the answer too.

  One thing it adds to the worked examples. Its `mutation.py` pinned the reference's import
  as a **literal string** (`_IMPORT = "from fixtures.generate import field_id"`) and rewrote
  it to widen it for the reshare mutant, which needs `Share`. A split that moves the import
  and leaves that string alone does not fail loudly: `str.replace` finds nothing, so the
  mutant keeps the reference's own import, `Share` is undefined in it, and it dies on a
  `NameError` instead of on the reshare defect it exists to demonstrate. Measured both ways
  here — the suite prints **All 25 mutations killed** with the stale string and with the
  updated one, so its summary line cannot tell you which happened. Grep the whole problem
  directory for the moved import **as a string literal**, not only as an import statement.

  `ac26-w6-cosnark-privacy` came off the list in #615, closing the Week 6 co-SNARK trio, and
  it is the one to read when **the participant has to keep running the very things the
  problem is about**. Its eight specimens are runnable objects a learner audits — `make
  inspect P=S3` runs one, the public tests run several — so unlike every earlier split here
  the material could not all move behind the verifier. Three modules moved to the
  participant side (`participant/mpc.py`, `participant/lab.py`, `participant/specimens.py`),
  and what stayed behind is the **table of answers about** those objects rather than the
  objects: `fixtures/specimens.py` now holds only `GROUND_TRUTH` and `MALFORMED_TRUTH`, which
  name per specimen the capabilities reached, the unauthorized openings, the disclosed
  `(channel, name)` pairs and the recoverable secret. Reach for that carve line whenever a
  problem's subject is a thing the learner must execute.

  Both standard probes read **0 of 300 before the split as well as after**
  (`fixtures/generate.py` defines none of the seven names `starter/prover.py` asks for, so the
  name-based detector reported it zero times), the guard-removal control is flat, and the
  reachability count is unchanged at 0 throughout in both directions — the restore-the-leak
  run puts `COPY fixtures/ tests/ verifier/` back into the participant stage and the count
  stays 0 while the new stage test goes red. #603's third probe is what speaks, and this is
  the first one on this list where it scored a **majority but not all** of the problem: a
  submission transcribed from the two shipped files, with no reasoning past copying, scored
  **6 of 8 checkpoints, 230 of 300 points**. `tests/hidden/check_prover.py`'s
  `_expected_class` is `classify`'s answer written out, `_authorized` is `open-set`'s, and
  `_expected_leakage` is `leakage`'s; `fixtures/specimens.py`'s two tables answer
  `capability`; `show.py`'s own clean prover answers `repair`; and `check_prover.py`'s
  `_HIDDEN_TRUTH` extends the tables to the four provers `transfer` was supposed to hold
  back. It stops at six because `evidence` is handed a **serialized** disclosure, so its
  value has to be derived rather than looked up, and `transfer` re-runs `evidence`. **Report
  the fraction** (#610's rule) — and note where the two survivors were: both are the
  checkpoints whose answer is not a value in either file.

  One thing it adds to the worked examples. `classify` had to raise on an out-of-vocabulary
  entry, which the *starter* asks for and neither shipped file states; the transcription
  scored 5 of 8 until that one refusal was copied from the starter's own docstring. When a
  transcription probe stalls at a checkpoint whose rule you did copy, check the starter
  before concluding the material was not reachable — the participant surface is part of what
  a transcriber reads.

  `ac26-w7-capstone-demo` came off the list in #616, and it is the one to read when the
  supplied half is **named by the starter's own stubs**. `starter/capstone.py` tells the
  learner that `experiment_privacy` is written against `tiny_settings()` and
  `randomness_space`, and every stub is typed on `Setting`, so the submission itself imports
  the supplied module at grading time — #608's rule, and the reason the runner preloads
  `participant.lab` ahead of #597's guard. That pairing is also what took this problem off
  Issue #591's ten-verifier exception list, verified against the reference rather than by
  inspection: **8/8 (300/300) with the guard in place**.

  Both standard probes read **0 of 300 before the split as well as after**
  (`fixtures/generate.py` defines none of the ten names `starter/capstone.py` asks for, so
  the name-based detector reported it zero times), the guard-removal control is flat — so the
  reference is the usable positive control, as with #600 — and the reachability count is
  unchanged at 0 throughout in both directions: the restore-the-leak run puts
  `COPY fixtures/ tests/ verifier/` back into the participant stage and the count stays 0
  while the new stage test **and** `scripts/verify-course-workbenches.py` both go red.
  #603's third probe is what speaks: a submission transcribed from the two shipped files,
  with no reasoning past copying, scored **8 of 8 checkpoints, 300 of 300 points** — the
  #584 pole. `_spec_well_formed` is the whole transcript rule `check_transcript` applies and
  therefore the spec `run` is built from; `_spec_view` is `view`'s answer verbatim; `_leaks`
  is `experiment_privacy` verbatim, down to the coalition sweep the problem exists to make a
  learner discover; `check_threshold` states the threshold; `check_scope` names the two
  property sets; and `_mutants` enumerates the nine defects `detects` is graded against, so
  the suite could be written to exactly the shape it is scored on.

  Two things it adds to the worked examples. Its `GET /public` carries a **vocabulary that is
  already an answer** — `scope`'s `claims` and `non_goals` are `PROVIDED` and `NOT_PROVIDED`,
  and `make inspect` has always printed both, because the problem asks the learner to work out
  *why* the missing pair is missing rather than which pair it is. #605's reading applies:
  withholding it would hide it from `show.py` and from nobody else. What stays behind is
  `hidden_settings`, the six settings every checkpoint is actually graded on. And with no
  Docker daemon (§6), the two-tree probe showed the participant tree at five modules with none
  of the hidden material in it, the reference at 8/8 through the Workbench proxy into the
  verifier, and the shipped starter at 0/8 — which no file-list assertion establishes on its own.

  `ac26-w7-capstone-design` came off the list in #617, and it is the one to read when the
  question is **how much of a problem transcription actually buys**. It is #616's twin —
  same week, same `COPY verifier/` shape, same supplied-half-named-by-the-starter pairing —
  so #609's rule held again and the split was that PR's diff with names changed, down to
  `participant/lab.py` and the runner's preload. It came off Issue #591's exception list in
  the same PR on #613's pairing, verified against the reference rather than by inspection:
  **8/8 (300/300) with the guard in place**.

  Both standard probes read **0 of 300 before the split as well as after**
  (`fixtures/generate.py` defines none of the eight names `starter/design.py` asks for, so the
  name-based detector reported it zero times), the guard-removal control is flat — so the
  reference is the usable positive control, as with #600 — and the reachability count is
  unchanged at 0 throughout in both directions: the restore-the-leak run puts
  `COPY fixtures/ tests/ verifier/` back into the participant stage and the count stays 0
  while the new stage test goes red.

  #603's third probe is what speaks, and here it is worth running **twice**, because the two
  runs disagree and the gap is the finding. `tests/hidden/check_design.py` writes out the rule
  for every checkpoint — `_spec_requirements` is `required_properties`' answer,
  `_spec_admissible` is the `admissible` column of `compare_alternatives`,
  `_selection_failures` is `select_primitive`'s four acceptance conditions, `_graph_failures`
  and `_matrix_failures` state every condition an architecture and a matrix row must meet. A
  submission that copies only the *stated rules*, with no reasoning past copying, scores
  **4 of 8 checkpoints, 155 of 300 points** — exactly the four whose answer is a rule. Building
  the remaining four artifacts to satisfy the conditions the same file writes out takes it to
  **8 of 8, 300 of 300**, the #584 pole. #610 says report the fraction; this problem says
  report *which* fraction you measured, because "a rule is stated" and "an artifact is
  constructible from the stated conditions" are two different leaks and only the second reaches
  the pole.

  Two things it adds to the worked examples. Its `GET /public` carries the **question, not an
  answer**: the public brief and its review variant, which are what `make inspect` has always
  printed and which the public tests hand straight to the learner's own functions as their
  argument. What stays behind is the rest of the population — the other seventeen variants and
  the twelve synthetic briefs, which exist in no file at all. Reach for that reading whenever
  the material at risk is a *problem statement* rather than a value. And both READMEs named
  `local/fixtures/generate.py` as where the six briefs live without saying that file is not in
  the image a participant builds — the #585 shape, a participant surface naming a repository
  file the cloud participant does not have. **Check the READMEs for that sentence on every
  remaining split**: the Docker change is what makes an already-loose sentence false.

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

  Both of the last two were `status: draft`. Since the gate's removal that no longer
  changes what an agent may merge, but it still changes what the PR body has to say: a
  `draft` problem carries no claim that anyone played it, so a split there needs no play
  evidence — only an honest note that none was gathered. Never drop a needed README
  correction to make a PR look smaller.

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
- **`bun run validate` takes ~40 minutes here and ends red on a test that is green in
  CI.** Measured on `dde79a5` (2026-08-27): 5715 pass, 1 fail, 2308s. The one failure is
  `scripts/stackstack-ship.test.ts` — `startInstance`, "the pass instance never became
  healthy" — and the same commit's `main` run passed all thirteen CI jobs, `suite (1..4/4)`
  included. So it is this container, not a regression: do not "fix" it, and do not read a
  local red `validate` as a reason to hold a PR. Run the individual validators plus
  `bun test scripts/<the files you touched>.test.ts`, which is what actually covers a
  catalog change and finishes in seconds.
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
    `converted_to_draft` → `ready_for_review` toggle did **not** re-fire it even though
    the workflow listed both events. What recovers such a PR is a new commit
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
