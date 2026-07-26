# Session observation form

The sheet the observer fills in during stage 2 of the pilot described in
[`protocol.md`](./protocol.md). It exists because the event stream records what
the participant's machine did, and almost nothing about what the participant did
before touching it: the ten minutes of reading, the sentence said out loud, the
moment they scrolled back to the README and did not find what they were looking
for.

Everything on this form is also representable as an `observation.note`,
`failure.interface`, `abandonment`, or `deviation` event in
[`event-schema.json`](./event-schema.json). The paper form is the capture
surface; the event stream is the record. Transcribe within 24 hours, while the
session is still recoverable from memory.

## How to observe

Four rules. They are short because a rule an observer cannot hold in their head
during a live session is not a rule.

1. **Record behaviour, not diagnosis.** Write "scrolled back to the README twice,
   then opened the hint" rather than "confused by the README". The first can be
   re-read later by someone who disagrees with you; the second cannot be
   separated from your reading of it. The form gives interpretation its own
   column so that you can still write down what you think, without it
   contaminating what you saw.
2. **Timestamp everything.** A note without a time cannot be aligned with the
   event stream, and alignment is what turns "seemed stuck" into "seven minutes
   between the last test run and the next submission".
3. **Do not help.** Interventions follow the ladder in `protocol.md` §6, and
   every one at rung 2 or above is logged here with its rung. If you find
   yourself about to explain something, that impulse is itself an observation:
   log it as friction rather than acting on it.
4. **Write the participant's words as the participant's words.** Quote or do not
   quote. A paraphrase of why somebody gave up is your hypothesis about why they
   gave up.

## A. Session header

| Field | Value |
| --- | --- |
| Participant id | `p-_-__` |
| Cohort | A / B / C |
| Session id | `s-________-____` |
| Date and start time, with offset | |
| Facilitator id | |
| Observer id | |
| Facilitator authored any studied problem? | No / Yes → which |
| Catalog ref from the freeze record | |
| Setting | In person / Remote screen-share / Remote audio only |
| Participant's declared language for the session | Japanese / English / Either |

If the facilitator authored a studied problem, note it here and re-read
`protocol.md` §4: they may run the session and may not answer content questions
about their own problem.

## B. Environment readiness (stage 0)

| Field | Value |
| --- | --- |
| Docker available at first attempt? | Yes / No |
| Time from "start" to a successful `make inspect` | ______ min |
| Remediation attempts needed | 0 / 1 / 2 / more |
| Anything the participant had to install or change | |

Stage 0 failures are recorded and are excluded from the friction gates in
[`analysis-plan.md`](./analysis-plan.md), because stage 0 exists to absorb them.
They are still reported, because a track that needs three remediation steps
before it starts has a friction problem regardless of which stage absorbed it.

## C. Per-problem block

One block per problem. Photocopy or repeat for `ac26-bridge-experiment`,
`ac26-w1-constraint-lab`, `ac26-w1-underconstraint`, and the extension problem if
it was offered.

| Field | Value |
| --- | --- |
| Problem id | |
| Set | core / extension |
| Start time | |
| End time | |
| End reason | all checkpoints closed / moved on / time exceeded / environment blocked / abandoned / session cap |
| Checkpoints closed | ___ of ___ |

### C1. Orientation — the first ten minutes

The opening is where a problem statement either works or does not, and it is
almost invisible in the event stream because nothing is being run yet.

| Question | Note |
| --- | --- |
| What did they read first, and for how long? | |
| Did they run `make inspect` before or after reading? | |
| First thing they said out loud, verbatim | |
| Did they state a plan before editing? | Yes / No / Partly |
| Anything they looked for and did not find | |

### C2. Timeline

One row whenever something changes. Aim for a row every few minutes rather than a
narrative afterwards.

| Time | What the participant did (observable) | What they said (verbatim, if anything) | Your interpretation (optional, separate) |
| --- | --- | --- | --- |
| | | | |

### C3. Per-checkpoint notes

| Checkpoint id | Read the label at | Understood what was being asked? | Notes |
| --- | --- | --- | --- |
| | | immediately / after re-reading / never clearly | |

The middle column is the one that feeds the assessment-quality lane. A checkpoint
whose label had to be re-read three times has a label problem; a checkpoint that
was closed correctly on the first attempt seconds after the label was read may
have a label that gave the answer away. Both are recorded here and both are
tested against the event stream in [`analysis-plan.md`](./analysis-plan.md) §5.

### C4. Friction and defects

Every entry gets a category. The four bug categories are defined in
[`analysis-plan.md`](./analysis-plan.md) §6 and are kept apart because they have
different owners and different fixes; `friction` and `insight` are not bugs and
are separated from them for the same reason.

| Time | Category | What happened (observable) | Blocking? |
| --- | --- | --- | --- |
| | content-bug / platform-bug / assessment-bug / course-alignment-bug / friction / insight | | Yes / No |

Quick discrimination, for use in the moment. Do not agonise over it live; a
mis-categorised entry is fixed in triage, an uncategorised one is not.

- The problem statement, README, hint, or writeup said something wrong, unclear,
  or missing → **content-bug**.
- The container, Makefile, verifier, or harness misbehaved → **platform-bug**.
- The checkpoint accepted something it should not have, refused something it
  should have accepted, or its label or hint gave the answer → **assessment-bug**.
- The problem assumed knowledge from a course week the participant has not had,
  or contradicted the course's own terminology, or came close to the official
  exercise's answer → **course-alignment-bug**.

### C5. Interventions

| Time | Rung (0–5) | Exactly what the facilitator said | Why it was needed |
| --- | --- | --- | --- |
| | | | |

Rungs 6 and above do not exist. If something was said that does not fit a rung,
it is a deviation: record it in §E and mark it as affecting this participant's
data.

### C6. AI assistant use

Only the declaration, never the content. If the participant used an assistant and
did not declare it, the observer may ask once, neutrally: "was that an assistant?"
Nothing further is asked and nothing on screen is transcribed.

| Time | Purpose | Target | Declared spontaneously? |
| --- | --- | --- | --- |
| | explain-concept / explain-error / explain-problem-statement / generate-code / review-code / translate / other | problem-statement / own-code / test-output / error-message / external-concept | Yes / after being asked |

### C7. Abandonment

Only if the problem ended without all checkpoints closed.

| Field | Value |
| --- | --- |
| Checkpoint they were on | |
| Category | did-not-understand-the-task / understood-but-could-not-proceed / tooling-or-environment / lost-interest / out-of-time / declined-to-say |
| Their own words, verbatim | |

The verbatim sentence is the single most useful thing this form collects. Ask
once, do not press, and accept "I would rather not say" as a complete answer.

## D. End of stage 2

| Field | Value |
| --- | --- |
| Total elapsed, excluding breaks | |
| Number and length of breaks | |
| Extension problem offered? | Not offered / Offered and declined / Offered and attempted |
| Anything the participant asked that the facilitator could not answer during the session | |
| Anything you noticed but could not categorise | |

The last row is deliberate. An observation that fits no category is more likely to
be the interesting one than the noise, and a form with nowhere to put it loses it.

## E. Deviations

| Time | Protocol section | What was done instead | Who decided | Affects this participant's metrics? |
| --- | --- | --- | --- | --- |
| | | | | Yes / No |

Deviations are appended, never used to amend the protocol. `protocol.md` §10 says
why: a protocol edited to match the run can no longer be wrong about it.

## F. Observer's own debrief

Written after the participant leaves, before reading anybody else's form. Three
sentences is enough; the purpose is to separate your fresh impression from the
consensus that forms once observers talk to each other.

1. The moment in this session I most want to look at again, and its time.
2. The thing I expected to happen that did not.
3. Anything I did that may have changed what the participant did.

## Transcription checklist

Within 24 hours, and before the next session:

- [ ] Every timeline row with a defect category is an `observation.note` event.
- [ ] Every intervention at rung 2 or above is an `observation.note` event with
      `interventionRung` set.
- [ ] Abandonment, if any, is an `abandonment` event with the participant's own
      words in `participantWords`.
- [ ] Interface defects are `failure.interface` events.
- [ ] Deviations are `deviation` events with `affectsMetrics` set.
- [ ] No name, employer, email, or screen content has been transcribed anywhere.
- [ ] The paper form is stored with the session record and destroyed on the
      `consent.md` §7 schedule with everything else.
