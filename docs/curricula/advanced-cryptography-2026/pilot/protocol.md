# Pilot protocol — Advanced Cryptography 2026 companion track

The study design for a learning-effect pilot of the `advanced-cryptography-2026`
companion track: which problems are studied, at which version, who studies them,
in what order, for how long, and under what conditions a session stops.

This document and the seven instruments beside it are **written before any pilot
runs**. That ordering is the point. A protocol assembled after the first session
is a description of what happened, and a success criterion written after the
numbers exist is not a criterion. Everything here is authored with zero
participants and must be frozen before the first participant is recruited.

## 1. What this document is not

Running the pilot is **out of scope** for the issue that produced this file. A
run needs at least six real participants across three cohorts, and no amount of
authoring produces a participant. Recruitment, scheduling, execution, and the
analysis of results belong to the parent initiative
(susumutomita/TenkaCloud#2780).

Consequently this directory contains no results, no findings, and no numbers
observed from anybody. Where a value must come from a run, the instrument names
the slot and leaves it empty rather than guessing at it.

Companion documents in this directory:

| File | Fixes |
| --- | --- |
| [`consent.md`](./consent.md) | What a participant agrees to, and how they leave |
| [`pre-test.schema.json`](./pre-test.schema.json) | The pre-test instrument and its item bank |
| [`transfer-test.schema.json`](./transfer-test.schema.json) | The immediate and delayed transfer instruments |
| [`observation-form.md`](./observation-form.md) | What the observer writes down during a session |
| [`interview-rubric.md`](./interview-rubric.md) | How an explanation is scored |
| [`event-schema.json`](./event-schema.json) | What the harness records, and what it must never record |
| [`analysis-plan.md`](./analysis-plan.md) | Analysis rules and success gates, fixed before data exists |

Policy that binds the whole track — reuse, attribution, spoilers — is
[`GOVERNANCE.md`](../GOVERNANCE.md). The assessment contract the problems are
built against is [`ASSESSMENT.md`](../ASSESSMENT.md). This protocol adds nothing
to either; it measures whether they held.

## 2. Freeze record

The pilot studies a fixed catalog state. Without a pin, a participant on day one
and a participant on day nine are studying different material, and every
difference between them is uninterpretable.

| Field | Value |
| --- | --- |
| Instrument set version | `ac26-pilot-instruments v1.0.0` |
| Instrument set frozen on | `PENDING-FREEZE` — the date C₁ landed |
| Catalog repository | `susumutomita/TenkaCloudChallenge` |
| Instrument commit C₁ (40-hex) | `PENDING-FREEZE` — the last commit touching the eight instrument files; everything was built and validated against this tree |
| Catalog commit for image builds (40-hex) | `PENDING-FREEZE` — usually C₁, recorded separately so it is never inferred |
| Freeze-record commit C₂ (40-hex) | Recorded in the `ac26-pilot-freeze-v1.0.0` tag message, not here: a commit cannot contain its own SHA |
| Upstream course repository | `zk-tokyo/advanced-cryptography-2026` |
| Upstream course commit | `5e80999306608a45aecf9a0e4e3394a0b62f34d2` |
| Docker image digests | `PENDING-FREEZE`, one `sha256:` digest per studied problem |

The commits cannot be filled in while the instruments are being written, because
they do not exist yet; a self-referential pin is not a pin. §9 defines the exact
order — C₁ finalises the instruments, C₂ writes this table, and the tag names C₂.
C₂'s own SHA lives in the tag message for the same reason: a commit cannot
contain its own hash. Until §9 runs, every such row reads `PENDING-FREEZE`.

**The gate**: a session run against a freeze record that still contains
`PENDING-FREEZE` in any row is not a pilot session. Its data is discarded rather
than analysed, because there is no way to say afterwards what was studied.

The upstream course commit is pinned because the companion's alignment claims are
made against it (`GOVERNANCE.md` §5). If `bun run course:drift` reports movement
during the pilot window, the pilot does **not** re-pin mid-run. The drift is
recorded as a deviation (§10) and handled after the last delayed test.

## 3. The problem set

Four problems, all of which are Docker local-play challenges scoring with
`multi-verify`, so no participant needs an AWS account and no participant incurs
cloud cost.

### Core set — every participant, in this order

| Order | Problem id | Role | Difficulty | Checkpoints | Authored duration |
| --- | --- | --- | --- | --- | --- |
| 1 | `ac26-bridge-experiment` | `diagnostic` | 1 | 4 | 20–30 min |
| 2 | `ac26-w1-constraint-lab` | `mechanism` | 3 | 5 | 45–60 min |
| 3 | `ac26-w1-underconstraint` | `assignment-companion` | 4 | 6 | 60–90 min |

The order is fixed rather than counterbalanced. `ac26-w1-underconstraint`
declares `requires: problem.ac26-w1-constraint-lab`, so the two cannot be
swapped, and `ac26-bridge-experiment` exists precisely so that the first
cryptography problem is not also the first encounter with the tooling. Fixing the
order means **position is confounded with difficulty and with content**: a
problem late in the session is also the hardest and also the one the participant
is most tired for. The pilot accepts that confound and states it, rather than
breaking the prerequisite chain to remove it. Nothing in
[`analysis-plan.md`](./analysis-plan.md) may attribute an effect to position.

These three were chosen because they span the three `courseAlignment` roles whose
failure modes differ most. `diagnostic` tests whether the tooling and the
predict-before-running habit land at all. `mechanism` tests whether an internals
experiment teaches the internals. `assignment-companion` is the role
`GOVERNANCE.md` §3 and `ASSESSMENT.md` §2 both single out as the easiest to turn
accidentally into a walkthrough of the official exercise, so it is the one most
worth watching a real learner meet.

### Extension set — conditional

| Problem id | Role | Difficulty | Offered when |
| --- | --- | --- | --- |
| `ac26-w2-secret-sharing` | `mechanism` | 3 | Core set closed with ≥ 30 min remaining, cohorts B and C only |

The extension exists so that a fast participant is not left idle, not so that
more data is collected. It has no problem-level prerequisite, and it belongs to a
different week and concept family, so offering it cannot contaminate core-set
measurements.

**Extension data is reported separately and is never pooled with core-set data.**
It is collected from a self-selected subset — the participants who were fast
enough to reach it — so pooling it would mean reporting a sample chosen by the
outcome being measured.

### What fixes the problem set

Three things together, all of which must be recorded in the freeze record before
the first session:

1. the four problem **ids** above;
2. the catalog **commit SHA** those ids are read at;
3. the **image digest** each problem's container was built to, one `sha256:` per
   problem.

The image digests matter separately from the commit because a problem's fixtures
are generated from `FLAG_SEED` inside the image at deploy. Pinning the source but
rebuilding the image mid-pilot can change a base-layer dependency underneath a
participant, and the resulting difference would be invisible in the source
history. Images are built once, at freeze, and reused for every session.

### Seeds

`FLAG_SEED` is injected fresh per deployment, so each participant receives
different fixture values from the same problem. That is deliberate and is kept:
it is how the catalog defeats copying between participants, and a shared seed
would make one participant's answer usable by the next.

The consequence is that **absolute answers are not comparable across
participants** — only structure is. Every metric in
[`analysis-plan.md`](./analysis-plan.md) is defined over checkpoint verdicts,
attempt counts, and elapsed times, none of which depend on the fixture values.
The seed for each session is recorded in the session record so a reported failure
can be reproduced.

## 4. Cohorts

Three cohorts, six participants minimum, two per cohort. Nine (three per cohort)
is the target.

| Cohort | Definition | Included when | Excluded when |
| --- | --- | --- | --- |
| A — newcomer to cryptography | Can program, has not studied cryptographic constructions | Writes Python comfortably; has not implemented a signature, proof system, or secret-sharing scheme | Has taken a cryptography course or shipped cryptographic code |
| B — software or security engineer | Professional engineer, uses cryptography as a consumer | ≥ 2 years engineering experience; has used a crypto library in production; has not built a primitive | Has implemented a primitive from a specification |
| C — cryptography learner | Actively studying cryptographic constructions | Currently enrolled in, or has completed, a course covering circuits, Sigma protocols, or FHE | Is an author or reviewer of any `ac26-*` problem |

Cohort assignment is made **before** the challenge session, from the screening
items in [`pre-test.schema.json`](./pre-test.schema.json) (`item.screen.*`) plus a
self-declared cohort. Where the two disagree, the screening items decide and the
disagreement is recorded — a participant's self-description is a claim about
identity, and the screening items are claims about specific prior experience.

### Conflicts of interest

Nobody who authored or reviewed a problem in the core or extension set may
participate as a subject in any cohort. An author may facilitate a session but
may not answer any question about their own problem's content beyond the
intervention ladder in §6; the observation form records who facilitated so that
this is auditable afterwards.

Participants enrolled in the Advanced Cryptography Program 2026 are eligible and
are expected to be a large share of cohort C. They are told, in
[`consent.md`](./consent.md), that this track is unofficial, that participation
has no bearing on their course standing, and that they must not paste
course-private material into anything the pilot collects.

### When six participants cannot be found

The pilot may still run. It may not pretend it did not shrink.

1. The **actual** n per cohort is stated in every artifact that reports a number,
   including every table cell and every summary sentence.
2. A cohort with n = 1 is reported as a case description. No rate, percentage, or
   mean is computed for it, because a rate over one observation is that
   observation with a percent sign attached.
3. A cohort with n = 0 is reported as not studied. Its row is retained and marked
   `not-run`; it is never dropped from a table, because a missing row reads as an
   absent finding rather than an absent cohort.
4. No claim is generalised beyond the participants observed. The permitted form
   is "two of the three cohort B participants did X"; the forbidden form is
   "engineers do X".

## 5. Session sequence

Six stages, numbered 0 to 5. Stage 0 is setup and may happen on its own day;
stages 1 through 4 happen together on one day; stage 5 happens 7 to 10 days
later. The interval is a range rather than a single value because participant
availability is real, and a fixed value would either be missed or would force
scheduling pressure onto the participant; the actual interval in days is recorded
per participant and reported.

**What this actually costs a participant**, because a recruitment message has to
be honest about it and an earlier draft said "roughly four hours":

| | |
| --- | --- |
| Stage 0, setup | 15 min, possibly a separate day |
| Stages 1–4, the main sitting | 4 h 25 min, breaks included |
| Stage 5, follow-up | 30 min, 7–10 days later |
| **Total** | **5 h 10 min** |

`consent.md` §1 and §3 state the same three numbers. If any of them moves, all
three documents move together — a participant who agreed to four hours did not
agree to five.

| Stage | What happens | Duration | Location |
| --- | --- | --- | --- |
| 0 | Consent, pseudonym issue, environment check | 15 min | Remote, may be a separate day |
| 1 | Pre-test | 30 min | Remote or in person, unassisted |
| 2 | Challenge session — core set, in the fixed order | 180 min including two breaks | Observed |
| 3 | Immediate transfer test | 30 min | Unassisted, same day, directly after stage 2 |
| 4 | Explanation interview | 25 min | Recorded with consent, semi-structured |
| 5 | Delayed transfer test | 30 min | Unassisted, 7–10 days later |

The stage order is fixed for a reason that survives scrutiny. The transfer test
comes **before** the interview, because the interview asks the participant to
explain the mechanism, and hearing themselves explain it is itself a learning
event; a transfer test taken afterwards would be measuring the interview. The
pre-test comes before any exposure, obviously, but also before the environment
check is discussed in any depth, so that reading the pre-test's items does not
double as a hint sheet for the tooling.

### Stage detail

**Stage 0 — consent and environment.** The facilitator reads
[`consent.md`](./consent.md) aloud or the participant reads it, questions are
answered, and consent is recorded. The participant is issued a pseudonymous id
(§8). Docker is confirmed working by building one problem image and running
`make inspect` on `ac26-bridge-experiment`. Environment problems found here are
recorded as environment failures but are **not** counted against the pilot's
friction gates, because stage 0 exists to absorb them.

**Stage 1 — pre-test.** Unassisted, no references, no AI assistant, no search.
This is the one stage where tool use is restricted, and the restriction is stated
plainly to the participant with its reason: the pre-test measures the starting
point, and a starting point measured with a research assistant is not the
participant's. Ends at 30 minutes whether or not it is complete; unanswered items
are recorded as unanswered, never as wrong.

**Stage 2 — challenge session.** The participant works the core set in order.
Tool use is unrestricted: search, documentation, and AI assistants are all
allowed, consistent with `ASSESSMENT.md` §1, which takes the position that rules
forbidding tools are unenforceable and that the checkpoints should require
understanding instead. AI use is **declared** by the participant, by category,
when it happens; the declaration is a covariate, never a quality judgement, and
what was typed into the assistant is not collected. Breaks are offered after each
problem and are not deducted from problem timings; break start and end are
recorded.

**Stage 3 — immediate transfer test.** Unassisted, same restriction and reason as
the pre-test. Administered directly after the last core problem, before any
discussion of the session. See §7 for why the transfer test is not the
challenge's hidden test.

**Stage 4 — explanation interview.** Semi-structured, scored later against
[`interview-rubric.md`](./interview-rubric.md). The interviewer asks the
participant to explain the mechanism, not to justify their score. Audio is
recorded only with the separate consent checkbox; without it, the interviewer
takes notes and the recording is never made.

**Stage 5 — delayed transfer test.** Unassisted, 7 to 10 days later, remote. It
mixes new-surface items with two verbatim repeats from stage 3, which are
analysed separately for the reason given in §7.

### Interruption and stopping conditions

A session stops, or a stage ends early, when any of the following holds. The
facilitator does not negotiate these; the observation form has a field for each.

| Condition | Action | Recorded as |
| --- | --- | --- |
| Participant asks to stop, for any reason or none | Stop immediately, no follow-up question about why | `withdrawal-request` |
| Participant shows distress or frustration the facilitator judges to exceed ordinary difficulty | Offer a break; if declined twice, end the stage | `facilitator-ended` |
| Environment failure blocks progress for > 15 min after two remediation attempts | End that problem, move to the next | `environment-blocked` |
| A single problem exceeds 150 % of its authored duration | Offer to move on; the participant may decline once | `time-exceeded` |
| Total session reaches 210 min excluding breaks | End stage 2 wherever it stands | `session-cap` |
| Facilitator discovers the participant is working from a reference solution or the official exercise's answer | Continue the session; mark every subsequent checkpoint `exposure-suspect` | `solution-exposure` |
| Any incident that risks participant identity leaving the pseudonymous record | Stop, contain, record as a deviation | `privacy-incident` |

The 150 % rule exists because the authored durations are estimates written by
authors who knew the answer. Blowing through one is a finding about the estimate
as much as about the participant, and it is recorded as such rather than treated
as failure.

## 6. Facilitator conduct

The facilitator's job is to keep the session running, not to teach. What they may
say is a ladder, and they take the lowest rung that unblocks the participant.

| Rung | Permitted | Example |
| --- | --- | --- |
| 0 | Silence | — |
| 1 | Process prompt | "Take your time." / "You can move on whenever you like." |
| 2 | Tooling help | "`make reset` restores the starter file." |
| 3 | Restate the problem's own text | Reading back what `instructions` already says |
| 4 | Point at the in-problem hint mechanism | "There is a hint available on that checkpoint; opening it costs points." |
| 5 | Environment repair | Fixing Docker, rebuilding an image |

Rungs 6 and above do not exist. The facilitator never explains a concept, never
names the missing constraint, never confirms or denies a hypothesis, and never
says "warm" or "close". Every intervention at rung 2 or above is logged on the
observation form with its rung and timestamp, because an unlogged intervention
turns into an unexplained difference between participants.

If a participant asks a content question, the facilitator says that they cannot
answer it during the session and offers to answer it after stage 4. That offer is
kept: a debrief is owed to anyone who spends three hours on this, and it happens
after all same-day measurement is complete.

## 7. Why the transfer test is not the challenge's hidden test

Every core problem already ships a hidden verifier and, in most cases, a
checkpoint literally named `transfer` — `ac26-bridge-experiment.generalize`,
`ac26-w1-constraint-lab.transfer`, `ac26-w1-underconstraint.mutation-transfer`.
Reusing those as the study's transfer measure would be circular. They ran inside
the session, with the participant's own code, their editor, their tests, and
their assistant available. Passing them says the artifact the participant
produced generalises; it does not say the **participant** generalises, and it
cannot distinguish a participant who understood from one whose code happened to
be general enough.

The transfer instrument is therefore separate, unassisted, on paper, in a
different scenario, with different parameters, and — for the delayed test — at a
distance in time. Its whole job is to separate generalisation from
pattern-matching, so it changes the surface while holding the concept fixed.

What changes, per sampled problem:

### `ac26-bridge-experiment`

| | In the challenge | In the transfer instrument |
| --- | --- | --- |
| Scenario | A counter advancing by a fixed step | A rolling checksum over a ring buffer |
| Recurrence | `x ← x + step (mod m)`, seed-derived `m` | `x ← a·x + c (mod m)` with `a = 5`, `c = −12`, `m = 97`, `x₀ = 4` |
| Failure cause in the broken trace | Reduction applied only at the end | A negative representative left unnormalised at one step |
| Task | Predict the final value; find the first index leaving `[0, m)` | Predict the final value; say which of three printed traces cannot have kept the promised range, and where each first breaks it |
| Held fixed | Predict before running; locate the first broken index | Identical |

A participant who memorised "apply `% m` every round" answers the prediction and
still has to pass the impossibility item, where one candidate trace is
arithmetically consistent and violates only the lower bound. That item needs the
invariant rather than the recipe.

### `ac26-w1-constraint-lab`

| | In the challenge | In the transfer instrument |
| --- | --- | --- |
| Scenario | An access-control policy circuit | A coin selector for a vending machine |
| Field | Seed-derived primes, never enumerated by hand | `F₁₃`, small enough that the whole field can be swept on paper |
| Task | Implement residuals, gadgets, and a trace, in code | Write the residual expressions by hand; evaluate them on a supplied witness |
| Trap | A boolean gadget that only tries `2` | A signal documented as a boolean and assigned `7`, in a field where `7·6 = 3` |
| Held fixed | Constraint kinds, "all residuals must be zero", `−1 = p−1` | Identical |

The under-constrained membership item — a gadget written as `(s − a₀)` alone —
asks what a passing witness proves. A participant who learned the shape answers
"it is satisfied"; a participant who learned the concept answers "it is satisfied
and proves nothing about membership".

### `ac26-w1-underconstraint`

| | In the challenge | In the transfer instrument |
| --- | --- | --- |
| Scenario | Credential revocation, `grant iff counter = 0 and issuer recognised` | Byte range check, `b decomposes into 8 bits` |
| Gadget | Two-constraint is-zero (`v·inv + out − 1`, `v·out`) | Bit decomposition with one boolean constraint removed |
| Signal names | `revoked`, `inv`, `ok`, `issuer_ok`, `granted` | `byte`, `bit0` through `bit7` |
| Task | Build, audit, forge, root-cause, repair, in code | Exhibit a forging witness on paper; predict whether the forgery makes the claim over- or under-permissive **before** constructing it |
| Trap | Public tests pass in the starter state | A proposed "repair" that duplicates an existing constraint |
| Held fixed | Forgery means: satisfies the deployed set, fails the intended claim | Identical |

The duplicate-constraint item is the one that separates the two populations most
sharply. Adding a copy of a constraint that is already present changes nothing
about what the set admits, and a participant who understood underconstraint says
so immediately, while a participant who learned "repair means add a constraint"
accepts it.

### Delayed test surfaces

The delayed instrument changes surface a third time — the counter becomes a
sequence number window, the coin selector becomes a traffic-light state
constraint, the byte decomposition becomes a two-of-three threshold flag — and
additionally repeats **two items verbatim** from the immediate test.

The verbatim repeats are labelled `repeat: true` and analysed separately from the
new-surface items, never pooled with them. Re-answering an identical item
measures memory of that item; answering a third surface measures the concept.
Pooling the two would let recall inflate a transfer number, which is the exact
error this instrument exists to avoid.

### The extension problem has no transfer items

`ac26-w2-secret-sharing` is offered to a self-selected subset, so a transfer
measure over it would be a measure over the participants who were fast. It
contributes friction and assessment-quality observations only, and
[`transfer-test.schema.json`](./transfer-test.schema.json) deliberately contains
no items for it.

## 8. Identity, data flow, and instruments

Each participant is issued a pseudonymous id of the form `p-<cohort>-<nn>`, for
example `p-B-02`. Every artifact the pilot produces — event stream, instrument
responses, observation form, interview transcript, analysis output — carries only
that id.

The mapping from pseudonym to person exists in exactly one place: a single
encrypted file held by the pilot contact named in [`consent.md`](./consent.md).
It is not stored in this repository, not in the event stream, and not in any
analysis artifact. It is destroyed at the retention deadline in `consent.md`
regardless of whether analysis is finished, because a retention period that bends
for convenience is not a retention period.

Instrument responses are stored separately from the event stream. The event
stream records **that** an item was answered and when; the answer text lives in
the instrument response file, keyed by item id. This split exists so the event
stream can be shared with a tooling engineer debugging the harness without
handing over anybody's answers.

## 9. Freeze procedure

Executed once, before the first participant is recruited. Steps are in this order
because each depends on the previous.

Three commits, in this order. Naming them separately is not pedantry: an earlier
draft said "the instruments are no longer being edited" in step 1 and then edited
`protocol.md` in step 4, which made the procedure impossible to follow literally
and left "that commit" in step 2 ambiguous between the catalog and the
instruments.

| | Commit | What it is |
| --- | --- | --- |
| **C₁** | *instruments* | The last commit that touches any of the eight instrument files. Everything below is built and validated against **this** tree |
| **C₂** | *freeze record* | Touches `protocol.md` §2 **only**, filling the `PENDING-FREEZE` cells. Permitted after C₁ because the freeze record is a record *about* the instruments, not one of them |
| **C₃** | = C₂, tagged | `ac26-pilot-freeze-v1.0.0` points at C₂ |

Steps:

1. Land C₁: all eight instrument files are on the default branch and final. Record
   its SHA — this fills the *Instrument commit C₁* row in §2.
2. Build one container image per studied problem **from C₁**, and record each
   image's `sha256:` digest. The catalog commit the images come from is recorded
   in the *Catalog commit for image builds* row; it is usually C₁ but need not be, and writing both
   removes the guesswork.
3. Run `bun run validate` and `make reference-test` for each studied problem
   **against C₁**, and record that the mutation suites pass. This is the pre-run
   value of the `intended_mutation_kill_rate` gate in
   [`analysis-plan.md`](./analysis-plan.md), measured with zero participants,
   which is why it can be a ship-blocking gate rather than a finding.
4. Land C₂: fill every `PENDING-FREEZE` cell in §2 — including the SHAs and
   digests from steps 1 to 3 — in a single commit whose message names this
   protocol version. C₂'s own SHA is knowable only after C₂ exists, so it goes in
   the tag message rather than in the table it would have to modify.
5. Tag C₂ as `ac26-pilot-freeze-v1.0.0`.

**Read-only begins after step 5**, not after step 1. Between C₁ and C₂ the
instruments are already final and only the record is being written. A defect
discovered in an instrument after the tag is handled by §10, not by editing the
instrument.

## 10. Deviations

Anything that departs from this protocol is recorded as a deviation. A deviation
record contains: the date, the participant id if it affected one participant, the
section deviated from, what was done instead, and who decided.

Deviations are **appended, never merged into the protocol text**. The frozen
document plus the deviation log is the honest description of what happened; a
protocol silently edited to match the run describes nothing, because it can no
longer be wrong. This mirrors the rule `GOVERNANCE.md` §1 applies to governance
decisions and the rule [`analysis-plan.md`](./analysis-plan.md) §1 applies to
analysis rules, for the same reason in all three cases.

If a deviation affects a metric, the metric is reported twice: with and without
the affected participant. If the two differ enough to change a gate's verdict,
the gate is reported as indeterminate rather than resolved in the convenient
direction.

## 11. Ethics and scope limits

- Participation is voluntary, uncompensated beyond any stated token, and
  withdrawable at any time without giving a reason.
- No participant is ranked against another, and no artifact names a participant.
- The pilot collects nothing about a participant's employer, their course
  standing, or their performance on the official course exercises.
- The pilot is not human-subjects research submitted to an ethics board. It is
  product evaluation of a learning artifact, and it is scoped accordingly:
  nothing here supports a claim about learning in general, only about whether
  these problems worked for these people on that day.
- Unpublished course material is never requested, accepted, or stored. If a
  participant volunteers it, the facilitator stops them and records a deviation.
