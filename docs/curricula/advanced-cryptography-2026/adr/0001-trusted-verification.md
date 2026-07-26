# ADR-0001 — Trusted verification for AC26 local mode

| | |
| --- | --- |
| Status | **Proposed** — no option adopted |
| Date | 2026-07-26 |
| Tracked by | [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) |
| Supersedes | — |

This ADR sets out options. It does not choose one. Adopting an option is a
product decision about what TenkaCloud is willing to certify, and it belongs to
the maintainers rather than to whoever wrote this file.

## Context

AC26 local mode runs the grader on hardware the graded party owns. The
participant controls the machine, the Docker daemon, the image, and the process.
Everything below follows from that one fact, and no amount of care inside the
image changes it.

[`TEMPLATE.md`](../TEMPLATE.md) §"Assurance scope" states the resulting boundary
in full, and `scripts/assurance-scope.test.ts` stops it drifting back into
claiming more. In short: the verifier genuinely resists a hostile *submission* —
it cannot be hung, crashed, fork-bombed, shell-injected, or used as an oracle,
and per-deploy `FLAG_SEED` fixtures defeat a memorised answer. It does not
resist a hostile *participant*, because the participant administers it.

Two of the three gaps #271 named have since been closed, and it is worth being
exact about what that did and did not buy:

- **The threat model is written down** rather than implied. That is a
  documentation fix; it changed no behaviour.
- **Author-only artifacts no longer ship in the image a learner runs.** The
  image is now two stages: `make build` produces `participant` (fixtures, tests,
  verifier, starter) and `make reference-test` produces `author`, which adds
  `reference/` and `mutation.py`. This is misdelivery prevention. The answer is
  no longer sitting in `/problem/reference/` by default; it is still in this
  repository, and the participant can still build the author stage.

The third gap is open, and it is the one that matters for certification: the
submission and the trusted checker are loaded into the same Python process, so
the submission can reach the checker's namespace. Fixing that would raise the
cost of tampering. It would not change who owns the machine.

That is the honest framing for everything below. **No arrangement in which the
participant administers the verifier can support a certification claim.** The
options differ in how much they cost and what they make possible, not in whether
they close a boundary that local execution leaves open.

## What a decision has to serve

Local mode is not one use. It is three, and they want different things:

1. **Self-study.** Someone working alone, wanting feedback. Needs the loop to be
   fast and offline. Owns their own result and has no reason to cheat.
2. **Practice before a competition.** Same shape, but a wrong result costs them
   later.
3. **Competition ranking, examination, completion certification.** A third party
   relies on the result, and the participant has an incentive the first two do
   not.

The current arrangement serves 1 and 2 well. It cannot serve 3, and
`TEMPLATE.md` says so in a table.

## Options

### A. Do nothing; keep the boundary documented

Leave local mode as honor-system verification and keep saying so.

- **Cost**: none.
- **Buys**: nothing new. Uses 1 and 2 are already served.
- **Fails**: use 3, permanently.
- **Worth noting**: this is the status quo and it is not obviously wrong. Most
  of the catalog's value is in uses 1 and 2, and a track that never certifies
  anything needs nothing further.

### B. Process separation inside the same image

Run the submission in a child process with no import path to the checker, and
have the checker communicate over a pipe rather than sharing a module graph.

- **Cost**: moderate; changes every `verifier/server.py`, and the mutation suite
  with it.
- **Buys**: a submission can no longer reach the checker's namespace by
  accident or by a one-line trick. Raises the effort of tampering from trivial
  to deliberate.
- **Fails**: use 3 still. The participant can edit the checker, the fixtures, or
  the verifier, because they own the image.
- **Worth noting**: this is the remaining item from #271. It is a real
  improvement to a real weakness, and it must not be described as making local
  results trustworthy. Doing B and then quietly moving the "No" row to "Yes"
  would be the worst outcome available here.

### C. Remote verifier, submission uploaded

The participant sends their submission to a verifier TenkaCloud administers; the
verdict comes back.

- **Cost**: high. Needs hosting, a submission API, sandboxing of untrusted code
  on infrastructure that is not the participant's, rate limiting, abuse
  handling, and an availability commitment. This is the largest of the four by a
  wide margin, and the standing cost is ongoing rather than one-off.
- **Buys**: use 3, genuinely. The graded party no longer administers the grader.
- **Fails**: offline work. Local mode's chief virtue — no account, no network,
  no cost — is exactly what this removes.
- **Worth noting**: the sandboxing problem is the same one every code-execution
  service has, and it is not solved by being careful. It is solved by budget.

### D. Two modes, explicitly separated

Keep local mode as it is for uses 1 and 2, and add a separate, remotely-verified
path for use 3. Local results are never promoted to a certification claim; the
remote path is the only thing that produces one.

- **Cost**: C's cost, plus the discipline of keeping two paths honest about
  which is which.
- **Buys**: use 3, without giving up what local mode is good at.
- **Fails**: nothing structurally, but it doubles the surface that has to stay
  truthful, and the failure mode is a UI that lets the two blur together.
- **Worth noting**: this is C with the honesty requirement made explicit. If C
  is ever adopted, it should probably be adopted as D.

## Recommendation

**B now, and A until someone actually needs use 3.**

B is worth doing on its own merits: sharing a module graph between a submission
and the thing grading it is a weakness with no upside, and closing it is bounded
work. But it must ship with the "No" row unchanged, and this ADR exists partly
to make that hard to forget.

C and D should not be built speculatively. They are the largest ongoing cost in
this track by a wide margin, and nothing in the catalog currently produces a
certification claim that needs them. When something does — a ranked competition,
a completion certificate — that requirement is the trigger, and D is the shape
to build.

## Consequences if B is adopted

- Every `verifier/server.py` changes; the mutation suites change with them.
- `scripts/verifier-spoof-guard.test.ts` already pins the property that makes
  this delicate — the runner takes the *last* parseable line of the child's
  stdout, and an `atexit` handler registered during import used to win that race
  and pass every checkpoint of every problem. Any process-separation work has to
  keep that guard green rather than route around it.
- `TEMPLATE.md`'s "What it does not guarantee" loses its third bullet and keeps
  the other two.
- The "Which claims local results support" table does **not** change.

## Consequences if nothing is adopted

The status quo, which is documented, enforced, and honest. The only thing that
must not happen is a local `multi-verify` result being used for a claim in the
"No" row of that table.
