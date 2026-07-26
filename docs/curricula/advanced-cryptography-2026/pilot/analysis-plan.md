# Analysis plan

How the pilot's data will be analysed, and what will count as the track passing
or failing. Written before any data exists, and frozen with the rest of the
instrument set.

## 1. This is a pre-registration

Every rule in this document is fixed **before the first participant is
recruited**. That includes the metric definitions, the denominators, the handling
of outliers and environment failures, and the success thresholds in section 8.

The reason is narrow and practical. An analysis rule chosen after seeing the
numbers is chosen, consciously or not, because of what it does to the numbers. A
threshold set afterwards is a description of the result wearing the costume of a
criterion. With six participants there is enough freedom in "which cases count"
to produce almost any conclusion, so the freedom has to be spent in advance.

**Deviating later is allowed. Editing this document is not.** If the analysis has
to depart from this plan — a metric turns out to be uncomputable, a definition
turns out to be ambiguous, a case arises that no rule covers — the departure is
recorded as a deviation alongside the results: what the plan said, what was done
instead, why, and who decided. The frozen plan plus the deviation list is an
honest account. A plan quietly rewritten to match the analysis is not, because it
can no longer be wrong about anything.

The same rule governs [`protocol.md`](./protocol.md) section 10 and
[`GOVERNANCE.md`](../GOVERNANCE.md) section 1, for the same reason in all three
places.

### Analysis code is written before the data

The scripts that compute every metric below are written and tested at freeze,
against **synthetic** event streams generated to exercise each definition,
including its edge cases. They are then run unchanged on the real streams.

This is not ceremony. Writing the aggregation after seeing the data is where
denominators quietly move, and a script that already passes its tests on
synthetic input cannot be adjusted to taste without the adjustment being a
visible commit.

## 2. What this pilot can and cannot conclude

**It cannot establish that the track teaches.** Six to nine participants, no
control group, no random assignment, one sitting, self-selected volunteers.
Nothing in the design supports a causal claim about learning, and nothing derived
from it will be phrased as one.

**It can establish that specific things are broken.** A problem statement that
three of six participants read the wrong way is broken. A checkpoint that
everybody clears on the first attempt measures nothing. A hint that is followed
immediately by a correct answer is an answer. Those are engineering findings,
they are visible at n = 6, and they are what this pilot is for.

So the success criteria in section 8 are **gates on the catalog**, not findings
about learners. They are phrased as "this problem is not ready to ship until X"
rather than "participants learned Y".

## 3. Statistics that will not be computed

Fixed in advance, so that the temptation is answered before it arrives.

- No p-values, no null hypothesis tests, no significance language. The words
  "significant", "significantly", and "trend" do not appear in any output.
- No confidence intervals and no standard errors.
- No effect sizes, no correlation coefficients, no regression of any kind.
- No inter-rater reliability coefficient. Rater agreement is reported as the raw
  distribution of per-dimension differences (`interview-rubric.md` section 5).
- No cross-cohort comparison stated as a claim. Cohort results are reported side
  by side; "cohort A did worse than cohort C" is not written, because with two or
  three people per cohort it cannot be distinguished from who volunteered.
- No rate, percentage, or mean computed over a denominator below 3. Below that,
  raw counts only: "2 of 2", never "100 %".

Permitted throughout: counts, per-participant listings, ranges, "k of n", and
verbatim quotes with their per-quote opt-in.

## 4. The five lanes

Analysed separately, never merged into one score. They answer different
questions, have different owners, and fail independently.

| Lane | Question | Primary sources |
| --- | --- | --- |
| Learning | Did anything survive the session that was not there before? | Pre-test, both transfer tests, interview |
| Friction | What cost the participant time that was not the problem? | Event stream, observation form B and C4 |
| Assessment quality | Do the checkpoints measure what they claim to? | Event stream, mutation suites, observation form C3 |
| Course alignment | Does the companion sit correctly beside the course? | Observation form C4, interview probe 7 |
| Gamification | Do points, hints, and penalties help or distort? | Event stream, debrief |

**Completion rate is not the learning metric.** It appears only in the friction
lane. A participant who closes every checkpoint by pasting a general solution
from an assistant has completed and may have learned nothing; a participant who
closes four of six and can explain the mechanism has learned something the
completion number cannot see. Any output that reports completion beside a
learning claim puts them in separate tables.

### Learning lane

Reported per participant, then per cohort with n on every cell.

- **Pre-test concept score**, out of 15 across the ten `concept`-section items.
  Screening and self-report items score nothing.
- **Immediate transfer score**, out of 13 across the seven stage 3 items.
- **Delayed new-surface score**, out of 10 across the four new stage 5 items.
- **Delayed repeat score**, out of 2 across the two verbatim repeats, reported
  **separately and never pooled** with the new-surface score. A repeat measures
  memory of that item; a new surface measures the concept. Pooling them lets
  recall inflate a transfer number, which is precisely what the transfer
  instrument exists to prevent.
- **Per-item response patterns**, which at this sample size are more informative
  than any total. "Four of six chose the distractor that checks only the upper
  bound" is a usable finding; a mean of 8.3 out of 13 is not.
- **Interview dimension scores**, per dimension, per cohort, with totals reported
  beside rather than instead (`interview-rubric.md` section 6).

Paired differences between stages are described, never tested. The permitted
phrasing is "four of six scored higher on the immediate transfer test than on the
pre-test items covering the same concepts"; the forbidden phrasing is any claim
that the difference is attributable to the session.

**Exposure flags.** A participant who answered yes to interview probe 7, or who
reported having started the official Week 1 exercise on
`item.screen.course-enrolment`, has their `ac26-w1-underconstraint` results
flagged. Flagged results are reported, with the flag visible, and are excluded
from any statement about what the problem taught. They are not deleted
(section 7).

### Friction lane

- Minutes from session start to a first successful `make inspect`.
- Count of `failure.environment` events, split by `blocking`.
- **Blocking environment minutes**, subtracted from problem elapsed time wherever
  timing is reported, with the subtraction stated. A participant is not charged
  for our infrastructure.
- Elapsed time per problem against its authored estimate, as a ratio. A ratio
  above 1.5 triggers the stopping condition in `protocol.md` section 5 and is a
  finding about the estimate as much as about the problem.
- `make inspect` and `make reset` usage counts per problem. These two commands
  are the catalog's investment in debuggability, and whether anybody uses them is
  currently unknown.
- Abandonments, with the participant's own words quoted in full.

### Course-alignment lane

- Count and description of every `course-alignment-bug`.
- Terminology conflicts reported by cohort C, who are the only participants
  positioned to notice one.
- **Any report that a companion problem gave away part of the official
  exercise.** This is not a rate. One occurrence is a gate failure under
  section 8 and triggers the `GOVERNANCE.md` section 3 review of that problem
  before anything else proceeds.

### Gamification lane

- **Hint avoidance**: participants stuck on a checkpoint for more than 15 minutes
  with an unopened hint available. The hint penalty is meant to price a hint, not
  to make it unusable, and a participant grinding rather than paying 15 points is
  evidence the price is wrong.
- Hint opens per checkpoint, and what followed each (see AQ6).
- Whether the participant could state, at debrief, what the points were for.
  Points nobody can explain are decoration.

## 5. Assessment-quality metrics

The most interesting numbers in this pilot, because they measure the **catalog**
rather than the learner. [`ASSESSMENT.md`](../ASSESSMENT.md) makes strong claims —
that hidden tests make public tests insufficient, that seed-generated parameters
defeat hard-coding, that labels name the observation and not the answer. These
metrics are how those claims get checked against a real person meeting them.

Every definition below is computable from
[`event-schema.json`](./event-schema.json) alone, except where the definition
explicitly names the observation form or the interview as a confirming source.

### AQ1 — Public-only pass rate

> Over all `checkpoint.submit` events with `publicTestsGreenAtSubmit = true`, the
> fraction whose `verdict` is `incorrect`.

Computed per problem, and per checkpoint where the denominator reaches 3.

This is the single number that says whether the public suite predicts the hidden
one, and it is **two-sided**:

- Near 0 means passing the public tests is equivalent to passing the hidden ones.
  The hidden suite is adding nothing, and `ASSESSMENT.md` section 4's whole
  premise fails for that problem.
- Very high means the participant had no usable signal while iterating: they went
  green, submitted, and were refused, repeatedly. That is a friction failure
  dressed as rigour.

The gate in section 8 is therefore a band, not a floor.

### AQ2 — Hard-coding detected by hidden parameters

> Among participants who closed **every** non-transfer checkpoint of a problem,
> the fraction whose designated transfer checkpoint needed 2 or more attempts or
> was never closed.

Designated transfer checkpoints, fixed here so they cannot be chosen later:
`ac26-bridge-experiment.generalize`, `ac26-w1-constraint-lab.transfer`,
`ac26-w1-underconstraint.mutation-transfer`, `ac26-w2-secret-sharing.transfer`.

This is the catalog's own hard-coding detector firing. A value of 0 across every
problem is ambiguous on its own — either nobody over-fitted, or the transfer
checkpoint does not detect over-fitting — and the ambiguity is resolved against
the paper transfer instrument: a participant who cleared the in-session transfer
checkpoint and failed the corresponding stage 3 item is the pattern-match
signature, because the checkpoint tested their code and the item tested them.

That cross-reference is stated here, before data, precisely so that it is not
invented afterwards to explain an inconvenient zero.

### AQ3 — Intended mutation kill rate

> For each studied problem: the fraction of the mutations shipped in its
> `local/mutation.py` that the problem's **hidden** suite kills.

Measured at freeze by `make reference-test`, with zero participants. It must be
exactly 1.0; a surviving mutation means the hidden suite has a hole, and
`ASSESSMENT.md` section 4 already says such a challenge is not ready to ship. It
is listed here rather than only in the ship checklist because section 8 makes it
a precondition of the pilot running at all: measuring learning through an
assessment with a known hole measures the hole.

Reported beside it, also at freeze:

> **Public mutation kill rate** — the fraction of the same mutations killed by
> the problem's **public** suite.

This must be strictly below 1.0. If the public suite kills every mutation, the
hidden suite is redundant and AQ1 will read near zero for a reason that has
nothing to do with the participants.

### AQ4 — Mutation-suite coverage of observed failures

> Over the distinct `failureClass` values observed in `checkpoint.submit` events
> for a problem, the fraction that correspond to a mutation already shipped in
> that problem's mutation suite.

This is the pilot's actual contribution to mutation quality, and the reason
`failureClass` is a structured, slug-shaped field rather than free text. A
failure class real participants produced that no shipped mutation represents is a
defect class the suite does not test for. Each uncovered class becomes a proposed
addition to `local/mutation.py`, filed as a content or assessment bug per
section 6.

A low coverage number is not a failure of the pilot. It is the finding.

### AQ5 — Checkpoint label leakage

> Over all `checkpoint.close` events: closures where `attempts = 1`, and
> `secondsSinceCheckpointFirstViewed < 120` (carried on `checkpoint.close` itself, and required there, so this needs no join), and no `command.run` with command in
> {`test`, `test-one`, `inspect`} occurred between the checkpoint first being
> viewed and the submission.

Computed per checkpoint. The signature is a checkpoint answered from its label
alone, without looking at anything. `ASSESSMENT.md` section 3 requires that
labels name the observation rather than the answer, and this is the observable
consequence of that rule being broken.

It is a **flag, not a verdict**. A trivially easy checkpoint produces the same
pattern honestly — `ac26-bridge-experiment.environment` asks for a token printed
by `make inspect` and should close instantly. A flagged checkpoint is confirmed
against two other sources before anything is filed: the observation form C3 entry
for whether the participant understood what was being asked, and the interview D1
score for that participant. A flag confirmed by both is an assessment bug against
that label.

### AQ6 — Hint leakage

> Over all `hint.unlock` events: the fraction followed by a `correct`
> `checkpoint.submit` for the same checkpoint within 180 seconds, with no
> intervening `public-test.run` and no intervening `command.run`.

A hint is supposed to narrow a search, which takes work afterwards. A hint
followed straight by a correct answer, with nothing done in between, gave the
answer. `GOVERNANCE.md` section 3 makes this worse than an ordinary quality
problem for this track: a hint that hands over a mechanism the official exercise
also asks for is a spoiler, not merely a weak hint.

Reported per hint id, because the fix is per hint.

### AQ7 — Checkpoint discrimination

> Per checkpoint: the fraction of participants who closed it on the first
> attempt, and the fraction who never closed it.

Both ends are findings. A checkpoint everybody closes first time distinguishes
nobody and is a candidate for removal or strengthening. A checkpoint nobody
closes is either broken, mis-ordered, or asking for something the problem never
taught — the observation form and the failure classes say which.

### AQ8 — Public test dead weight

> Per problem: public tests that appear in no participant's `failedTestIds`,
> ever.

A public test that never fails for anybody provided no signal during iteration.
It is not necessarily wrong — it may be a smoke test — but a suite where most
tests are dead weight is a suite that is not helping the learner find their
error, which is the only job public tests have.

## 6. Bug categories

Every defect gets exactly one of four categories. They are kept apart because
they have **different owners, different fixes, and different urgency**. A single
undifferentiated bug list is the failure mode this section exists to prevent: it
mixes a typo in a README with a checkpoint that credits a wrong answer, and the
result is a backlog nobody can act on, because every item needs a different kind
of person to look at it.

| Category | Definition | Owner | Fix venue | Urgency |
| --- | --- | --- | --- | --- |
| **content-bug** | The problem's own words are wrong, ambiguous, or missing: README, `instructions`, a hint's explanation, the writeup, a fixture that does not illustrate what it claims | Problem author | That problem's directory | Normal; batch per problem |
| **platform-bug** | The machinery misbehaved: container build, Makefile target, verifier response, checkpoint echo, port binding, harness | Catalog or platform maintainer | Catalog `scripts/` or the platform repository | High; it blocks every problem, not one |
| **assessment-bug** | The checkpoint credited what it should not, refused what it should have credited, leaked the answer through a label or hint, or failed to discriminate at all | Problem author, reviewed against `ASSESSMENT.md` | That problem's checkpoints, hidden tests, and mutation suite | Highest; every measurement taken through it is suspect |
| **course-alignment-bug** | The companion sits wrongly beside the course: assumes an unpublished week, contradicts the course's terminology, or approaches the official exercise's answer | Track maintainer, under `GOVERNANCE.md` | `curriculum.md`, `alignment.md`, or the problem's `courseAlignment` | Highest for the spoiler case; a spoiler is a governance breach, not a quality issue |

Worked discriminations, because the boundaries are where triage goes wrong:

- The verifier returns an internal error on a submission → **platform-bug**. The
  participant's answer might have been right; nobody can tell.
- The verifier returns "incorrect" for a correct answer → **assessment-bug**. The
  machinery worked and the judgement was wrong.
- A hint says something true but useless → **content-bug**. A hint that says
  something true and sufficient → **assessment-bug**, via AQ6.
- A participant cannot tell what a checkpoint is asking for → **content-bug** if
  the problem's own text is unclear, **assessment-bug** if the checkpoint's label
  is what misled them. The observation form C3 entry decides which.
- A problem needs Beaver triples and the participant has not met MPC →
  **course-alignment-bug**, not a difficulty complaint.

One rule binds all four: **a defect is filed under the category of its fix, not
the category of its symptom.** A confusing README that causes a wrong submission
is a content bug even though it surfaced as a failed checkpoint.

## 7. Outliers, environment failures, and other awkward cases

Nothing is deleted. Everything is classified.

Deleting an inconvenient participant is the most effective way to produce a clean
result from a messy pilot, and at n = 6 removing one observation moves every
number by about seventeen percent. So the rule is absolute: **no participant, no
session, and no problem attempt is excluded from the dataset.** What varies is
which analyses a case is eligible for, and the classification is recorded per
case.

| Classification | Definition | Eligible for |
| --- | --- | --- |
| `complete` | Ran to plan, no blocking failure, no deviation | Everything |
| `environment-affected` | One or more blocking `failure.environment` events | Everything; blocking minutes subtracted from timing, and the subtraction stated |
| `protocol-deviated` | A recorded deviation touching this participant | Everything, reported twice (section 1) |
| `exposure-flagged` | Prior exposure to the official exercise or a reference solution | Friction and assessment lanes; excluded from statements about what the problem taught |
| `partial` | Session stopped early for any reason | Every metric whose inputs exist; never imputed |
| `withdrawn` | Participant withdrew their data | Nothing. Removed entirely, per `consent.md` section 8 |

Additional rules:

- **A time far from the others is a finding, not an outlier to trim.** The
  observation form is read to find out what happened during it, and the case is
  described.
- **Missing values are never imputed.** An unanswered item is unanswered; a
  checkpoint never reached is not a failure to close it. Denominators state what
  they are over.
- **A deviation that changes a gate's verdict makes the gate indeterminate.** If
  a metric passes with a participant included and fails without them, the gate is
  reported as indeterminate rather than resolved in the convenient direction.
- Withdrawal is the single exception to "nothing is deleted", because it is a
  promise made in `consent.md` and a promise outranks a dataset.

## 8. Success criteria

These are **engineering gates on the catalog**, fixed here before any data
exists. They are not hypotheses and they are not findings. Each says what happens
when it fails, because a criterion with no consequence is decoration.

Gates G0 and G1 are measured with zero participants and must pass **before** the
pilot runs.

| Gate | Definition | Threshold | If it fails |
| --- | --- | --- | --- |
| **G0** | AQ3, intended mutation kill rate, per studied problem | Exactly 1.0 | The pilot does not start. Fix the hidden suite first; measuring through a known hole measures the hole |
| **G1** | AQ3 companion, public mutation kill rate, per studied problem | Strictly below 1.0 | The problem's hidden suite is redundant. Fix before the pilot starts |
| **G2** | Blocking environment failures per participant across the whole session | At most 1 | Platform bug, highest priority. The track cannot be evaluated through a broken container |
| **G3** | Participants reaching a first successful `make inspect` within 15 minutes | All of them | Setup friction is the first thing a learner meets; fix before recruiting more participants |
| **G4** | AQ1, public-only pass rate, per problem | Between 0.15 and 0.60 | Below: hidden tests add nothing, so strengthen them. Above: the public suite gives no usable iteration signal, so add public coverage |
| **G5** | AQ5 flags confirmed by both the observation form and the interview | Zero confirmed | Assessment bug against that label. Rewrite it under `ASSESSMENT.md` section 3 |
| **G6** | AQ6, hint-leak rate, per hint | Zero hints leaking | Rewrite the hint. If it revealed a mechanism the official exercise also requires, it is a `GOVERNANCE.md` section 3 breach and the problem is pulled pending review |
| **G7** | AQ7, checkpoints closed first-attempt by every participant | At most 1 per problem, and it must be a deliberate warm-up | Strengthen or remove; a checkpoint that separates nobody is scoring participation |
| **G8** | AQ7, checkpoints closed by nobody | Zero, excluding participants who never reached them | Triage as content, assessment, or alignment bug before the next run |
| **G9** | Reports that a companion gave away part of the official exercise | Zero, at any count | Immediate `GOVERNANCE.md` section 3 review of that problem. This gate has no rate because one occurrence is the failure |
| **G10** | Participants who can, at interview D4, distinguish their claim from their check (score 2 or 3) | At least half of those interviewed | Not a catalog failure by itself. It is the signal that the evidence-discipline framing is not reaching learners, and it opens a redesign issue rather than a bug |
| **G11** | AQ4, mutation-suite coverage of observed failure classes | Reported, no threshold | Every uncovered class becomes a proposed mutation |

G11 has no threshold on purpose. Inventing one before seeing a single real
failure class would be exactly the pre-registration error this document exists to
avoid, in the opposite direction: a number chosen from nothing is not more
rigorous than an honest blank.

## 9. AI assistant use

Declared use is a **covariate reported descriptively**, and nothing else.

- It is never treated as a quality axis, never used to discount a result, and
  never used to explain a participant's outcome after the fact.
- Reported as counts per purpose category, per cohort. No comparison of outcomes
  between declared users and non-users is computed; at n = 6 such a comparison is
  a description of two or three individuals with a percent sign attached.
- **A known and unfixable limitation**: because prompt bodies are not collected
  (`consent.md` section 5), declarations cannot be verified. A participant who
  used an assistant and did not say so is invisible. This is a deliberate trade —
  the alternative is surveillance the participants did not agree to — and every
  output that mentions AI use states the limitation beside the number.

This follows `ASSESSMENT.md` section 1: the position is that rules forbidding
tools are unenforceable and tasks requiring understanding are not, so the design
response to assistant use is the interview and the paper transfer test, not
detection.

## 10. Reporting rules

- Every table cell that reports a rate carries its n. A rate with no denominator
  is removed rather than annotated.
- Every cohort row appears in every table, including cohorts that were not run,
  marked `not-run`. A dropped row reads as an absent finding rather than an
  absent cohort.
- Results are aggregate. No participant is named, ranked, or identifiable by a
  combination of reported fields — if a cell would identify someone by their
  cohort and one other attribute, it is suppressed.
- Quotes are anonymised and used only with the per-quote opt-in from
  `consent.md` section 8.
- The deviation list is published with the results, in the same document. A
  results report that omits its deviations is not this pilot's report.
- The report states its own n, its lack of a control group, and its lack of
  randomisation in the first paragraph, not in a limitations section at the end.


## 11. Gates whose denominator is too small to report

§3 forbids stating a rate over a denominator below 3. Some gates are rates, so
that rule can collide with a gate rather than only with a sentence.

When a gate's denominator falls below 3, the gate is **indeterminate**: report
the raw counts, do not compute the rate, and do not record a pass or a fail.

An indeterminate gate is not a pass. It is the pilot saying it did not gather
enough to answer, which is the honest outcome of running a study this small and
is the reason recruitment shortfalls are reported rather than absorbed. Reading
it as a pass would let a shortfall manufacture the result the gate exists to
test.

## 12. What is out of scope here

Running the pilot and analysing its results belong to the parent initiative
(susumutomita/TenkaCloud#2780). This document is the rulebook, written and frozen
first; it contains no results, and it will not be edited to contain any.

Also out of scope, permanently: causal inference about learning, comparison
against any other course or platform, any claim about the Advanced Cryptography
Program's own materials, and any analysis of participant behaviour beyond the
five lanes in section 4.
