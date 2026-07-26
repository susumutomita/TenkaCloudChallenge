# Explanation interview and scoring rubric

The stage 4 instrument from [`protocol.md`](./protocol.md): a 25-minute
semi-structured interview in which the participant explains what they did, scored
afterwards against the anchors below.

It exists because the thing this track claims to build is not visible to a
verifier. A checkpoint can tell whether an artifact behaves correctly. It cannot
tell whether the person can say what the construction does, where it stops
working, or what their own evidence did and did not establish. That is what the
interview is for, and it is why the interview happens **after** the immediate
transfer test: explaining something out loud teaches it, so a transfer test taken
after the interview would be measuring the interview.

## 1. Conducting it

The interviewer asks about the mechanism, never about the score. "Why did you get
that wrong" is not a question in this instrument; "what does that constraint do"
is.

Ground rules, stated to the participant at the start:

- There is no right answer being fished for, and no score they will be shown.
- They may answer in Japanese or English, and may switch mid-sentence. Language
  is never scored (§3).
- They may say "I do not know". It is a real answer and is scored as such rather
  than pushed at.
- Nothing they say is quoted anywhere without the separate per-quote opt-in in
  [`consent.md`](./consent.md) §8.

Audio is recorded only if the optional consent box was ticked. Without it the
interviewer takes notes and the recording is never made.

### The question set

Five anchor questions, one per dimension, asked in this order. Follow-ups are
free-form but may not supply vocabulary the participant has not used: if they
have not said "constraint", the interviewer does not either.

1. **Mechanism.** "Take the part of today you understood best. Explain how it
   works to someone who writes software but has not seen this."
2. **Causality.** "Pick something that failed today — your code, a check, a
   witness. What was the actual cause, and how did you know?"
3. **Boundary.** "When does what you built stop working? What would have to be
   different about the situation?"
4. **Evidence.** "You decided at some point that something was correct. What
   exactly had you checked at that moment, and what had you not?"
5. **Transfer.** "Suppose the same idea appeared with different numbers and a
   different story. What would you look for first?"

Two closing probes, not scored:

6. "Was there a moment where you felt you understood something you had not
   before? When?"
7. "Did you look at any course material, reference solution, or existing
   implementation today?" — asked flatly, as a fact-finding question. The answer
   changes how the session is read (§4) and is not a judgement.

## 2. Dimensions and anchors

Five dimensions, scored 0 to 3 each, 15 points total. The dimensions are separate
because they fail separately: a participant can describe a mechanism fluently and
have no idea where it stops working, and the two failures need different fixes to
the catalog.

Score what the participant said, not what they seemed to mean. If the transcript
is ambiguous, score the lower anchor and note the ambiguity.

### D1. Mechanism accuracy

*Can they say what the construction actually does?*

| Score | Anchor |
| --- | --- |
| 0 | Restates the task or the story, with no account of the mechanism. |
| 1 | Names the parts, and the relationship between them is absent or wrong. |
| 2 | Gives a correct account of what the parts do and how they connect, with at most one non-load-bearing error. |
| 3 | Correct account, and says which part carries the property the whole thing exists for. |

### D2. Causal explanation

*Can they say why something broke, rather than what they changed to fix it?*

| Score | Anchor |
| --- | --- |
| 0 | Describes what they changed, with no cause. "I added a line and it went green." |
| 1 | Names a cause that is really a symptom: the test that failed, the value that was wrong. |
| 2 | Names the actual cause and can point at the observation that located it. |
| 3 | Also says why the earlier steps looked fine, which is what makes the failure hard to find. |

### D3. Boundary and limits

*Do they know where it stops working?*

| Score | Anchor |
| --- | --- |
| 0 | Asserts it works, with no condition attached. |
| 1 | Gives a limit that is generic: bigger inputs, more time, real-world complexity. |
| 2 | Names a specific condition under which it fails, tied to this construction. |
| 3 | Names the condition and why it is the condition, from the mechanism rather than from a remembered warning. |

### D4. Evidence discipline

*Does the claim stay inside the check?*

This is the dimension `ASSESSMENT.md` is built around, and it is the one most
worth reading carefully. It is the difference between "it passes the tests" and
"it passes these tests, which cover this and not that".

| Score | Anchor |
| --- | --- |
| 0 | Claims correctness from a passing run, with no distinction between the claim and the check. |
| 1 | Acknowledges that tests can be incomplete, as a general statement, without applying it to their own work. |
| 2 | States precisely what their check established. |
| 3 | Also names something a listener might wrongly assume it established, and the two are genuinely distinct. |

### D5. Transfer articulation

*Can they say what would carry over?*

| Score | Anchor |
| --- | --- |
| 0 | Answers in terms of the specific fixture: the same numbers, the same file. |
| 1 | Says the idea would carry, with no account of what stays and what changes. |
| 2 | Separates the invariant part from the incidental part correctly. |
| 3 | Also names what would have to be re-checked in the new setting rather than assumed. |

## 3. What is not scored

Explicitly, so that a rater who is tempted has a rule to point at.

- **Language, fluency, accent, or vocabulary.** A participant answering in their
  second language is not thereby a worse explainer. If a rater cannot separate
  fluency from content, the item is marked unscorable rather than guessed at.
- **Confidence.** Hedged accuracy scores above assured error, every time.
- **Speed** during the session, and whether the participant finished.
- **Whether an AI assistant was used**, and for what. `ASSESSMENT.md` §1 takes the
  position that a task requiring understanding is the enforcement mechanism, and
  the interview is exactly such a task: an explanation produced without
  understanding does not survive follow-up questions, whoever wrote the code.
- **Agreement with the interviewer.** A participant who correctly contradicts the
  interviewer scores at the anchor their answer earns.

## 4. Reading the exposure probe

Question 7 asks whether the participant consulted course material, a reference
solution, or an existing implementation.

A "yes" does not reduce any score. It changes the interpretation: a participant
who read a reference implementation of the same construction is expected to score
well on D1 and is uninformative about D5, so their D5 score is reported and their
D1 score is flagged. The flag lives in the analysis, not in the rubric, and
[`analysis-plan.md`](./analysis-plan.md) §4 says how flagged scores are handled.

Asking flatly is deliberate. A probe that sounds like an accusation gets an
unreliable answer, and an unreliable answer here corrupts the interpretation of
everything else.

## 5. Rating procedure

1. **Two raters, independently**, from the transcript or notes. Neither rater
   sees the other's scores, the participant's checkpoint results, or their
   transfer-test answers before scoring. A rater who knows the participant closed
   every checkpoint will find the explanation better.
2. Raters record a one-line justification per dimension, quoting the phrase they
   scored on. A score without a quotable basis is not defensible a month later.
3. **Disagreement of 1 point** on a dimension: take the mean, no discussion.
4. **Disagreement of 2 or more points**: the two raters discuss, with the
   transcript open, and either converge or record the dimension as unresolved.
   An unresolved dimension is reported as unresolved rather than averaged, because
   averaging a real disagreement produces a number nobody holds.
5. Inter-rater agreement is reported as the raw distribution of per-dimension
   differences: how many dimensions agreed exactly, differed by 1, differed by 2
   or more. With six participants and five dimensions there are thirty
   comparisons, which is enough to describe and nowhere near enough for a
   reliability coefficient. `analysis-plan.md` §3 forbids computing one.

## 6. Reporting

Per-dimension scores are reported per cohort, with n stated on every cell.
Totals out of 15 are reported alongside, never instead: a total hides the case
this instrument most wants to surface, which is a high D1 with a low D4 — a
participant who can explain the mechanism beautifully and does not distinguish
their claim from their evidence.

No participant is named or ranked, and no quote is published without its
per-quote opt-in.
