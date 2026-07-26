# Consent — Advanced Cryptography 2026 companion track pilot

The text a participant reads and agrees to before any measurement starts, plus
the handling rules that agreement binds us to. The study design it refers to is
[`protocol.md`](./protocol.md).

Two audiences read this file. A participant reads §1 through §9, which are
written to be read once, out loud if necessary, without a glossary. A maintainer
reads §10 through §12, which say what we must do to keep the promises in §1
through §9.

The participant-facing sections are also maintained in Japanese in the same
wording; where the two disagree, the language the participant actually consented
in governs.

---

## 1. What this is

TenkaCloud is building a set of practice problems that accompany the Advanced
Cryptography Program 2026. We want to know whether they teach anything.

You are being asked to work through three of those problems while somebody
watches, take a short test before and after, explain what you did, and take one
more short test about a week later.

It takes **5 hours 10 minutes** of your time in total, split three ways: a
15-minute setup check that can be its own day, a main sitting of 4 hours 25
minutes with breaks, and a 30-minute follow-up 7 to 10 days later. The same three
numbers are in `protocol.md` §5, and an earlier draft of this page said "roughly
four hours", which was wrong.

**This is unofficial.** TenkaCloud's track is an independent companion built by
people unaffiliated with the Advanced Cryptography Program. Nothing you do here
is seen by, reported to, or counted by the course. If you are enrolled in the
course, your participation and your performance here have no bearing whatsoever
on your standing in it.

## 2. What we are measuring

The problems, not you.

Every number this pilot produces is a claim about whether a problem was clear,
whether its tests measured what they should, and whether the explanation it gave
you was useful. If you get stuck, that is data about the problem. If you finish
in half the estimated time, that is data about our estimate.

You are not being ranked, graded, compared to other participants, or assessed for
suitability for anything. There is no pass mark and there is no score you will be
told about later, because no such score is computed.

## 3. What happens, and when

| Stage | What you do | How long |
| --- | --- | --- |
| 0 | Read this, ask questions, agree or decline. We check your Docker setup works | 15 minutes |
| 1 | A short written test, on your own, no references and no AI assistant | 30 minutes |
| 2 | Work through three practice problems while an observer takes notes | Up to 3 hours with breaks |
| 3 | A short written test, on your own again | 30 minutes |
| 4 | A conversation where you explain what you did | 25 minutes |
| 5 | One more short written test, 7 to 10 days later, remotely | 30 minutes |

You may take a break whenever you like, and breaks are not timed against you. You
may stop any stage, or the whole thing, at any moment.

During stage 2 you may use anything you would normally use: documentation, web
search, an AI assistant. We ask you to tell us **that** you used an assistant and
roughly what for — explaining a concept, explaining an error, generating code,
reviewing code — and we do not ask what you typed and do not record it. Using an
assistant is not counted against you and is not treated as a worse way of
working.

During stages 1, 3, and 5 we ask you to work alone without references or an
assistant. Those three stages exist to see where you were starting from and where
you ended up, and an answer produced with a research assistant is not an answer
about you.

## 4. What we collect

| What | Why it is collected |
| --- | --- |
| Your answers to the three written tests | They are the measurement of what changed |
| Which checkpoints you cleared, in what order, and how many attempts each took | Attempts per checkpoint is how we find a checkpoint that is unclear rather than hard |
| Timestamps: when you started a problem, when each checkpoint closed | A problem that takes twice its estimate has an estimate problem or a clarity problem |
| Which of `make test`, `make inspect`, `make reset` you ran, and when | Whether the inspection tooling we built is used at all, or ignored |
| Which public tests failed, by test name | A public test that never fails for anybody is not doing anything |
| Which hints you opened, and when | A hint opened immediately before a checkpoint closes may be giving away the answer |
| That you used an AI assistant, and the category of use | Context for reading everything else. Never a judgement |
| Environment or interface failures you hit | These are our bugs and we want them |
| If you abandon a problem, the reason in your own words | The most useful sentence in the whole pilot |
| The observer's notes about what you did and said | Behaviour we cannot see in the event log |
| The interview, as notes, or as audio if you separately agree | How you explain the mechanism is the part a test cannot reach |

## 5. What we do not collect

We do not collect these, and the recording tooling is built so that it cannot.

- **Keystrokes.** Nothing records what you type as you type it.
- **What you asked an AI assistant.** The category, yes. The prompt, never.
- **Source code from outside the problem.** Only the files inside the practice
  problem you are working on are ever read, and only when a checkpoint is
  submitted.
- **Credentials, tokens, keys, or anything from your environment variables.**
- **Your screen, unless you are told and agree in the moment.** The default is no
  screen recording.
- **Anything about your employer, your course grades, or your official course
  submissions.**

We ask you not to paste unpublished course material into anything during the
session. If you do it by accident, tell us and we will delete it.

## 6. Who you are, in our records

The moment you agree, you are issued an identifier like `p-B-02`. Everything from
then on carries only that identifier: the event log, your test answers, the
observer's notes, the interview transcript, and anything we publish.

The contact record connecting `p-B-02` to your name and email exists in exactly
one encrypted file, held by the pilot contact in §9, and nowhere else. It is not
in the code repository, not in the event log, and not in any analysis file. How
long it is kept, and why it outlives the 30 days an earlier draft gave it, is §7.

## 7. How long we keep it

| Data | Kept until |
| --- | --- |
| The contact record — your name, your email, your identifier, and which optional boxes you ticked | As long as any promise in §8 or §9 can still be exercised: until the raw session data is destroyed, and, if you ticked the quote-review box, until that review is finished or declined. Then destroyed |
| Raw session data — event log, your test answers, observer notes | 90 days after the last participant's last session, then destroyed |
| Interview audio, if you agreed to it | Transcribed within 30 days, audio destroyed immediately after |
| Aggregated results and anonymised quotes | Kept indefinitely; they contain nothing that identifies you |

The contact record is the shortest file in the pilot and it is kept apart from
everything else — it is not joined to your answers, and no analysis ever reads it.
It exists for exactly two reasons: so that "email us with your identifier **or
your name**" in §8 actually works, and so the optional quote review in §10 has
somewhere to send.

**An earlier draft destroyed it after 30 days while keeping raw data for 90.**
That would have left a 60-day stretch in which a withdrawal request carrying only
a name could not be matched to anything — the promise would have been unkeepable
for most of the window it covers. Holding a name and an email a little longer is
the lesser cost, and it is stated here rather than buried.

The 90-day clock does not pause because analysis is unfinished. If we did not
finish in 90 days, we lost the raw data, and that is our problem rather than a
reason to keep holding yours. The contact record goes when the raw data goes,
except where the quote review is still open.

## 8. Stopping, and taking it back

**You may stop at any time**, in the middle of a problem, in the middle of a
sentence. You do not have to give a reason and nobody will ask for one. Stopping
does not forfeit anything.

**You may withdraw your data afterwards.** Email the contact in §9 with your
identifier or your name. What happens then depends on timing, and we would rather
be blunt about it now than apologetic later:

- **Before results are published** — everything of yours is deleted: event log,
  answers, observer notes, transcript. Any aggregate already computed is
  recomputed without you.
- **After results are published** — your raw data is still deleted, and you are
  removed from any future analysis. Numbers already published cannot be
  retracted: an aggregate over six people has already been read by people we
  cannot reach. If your data contributed a quote, the quote is removed from the
  current version of the document, but a copy somebody already downloaded is
  beyond our reach.

We will confirm your deletion in writing within 14 days.

Quotes are separate. **Nothing you say is quoted without a separate opt-in**, and
that opt-in is per-quote at review time, not a blanket permission signed today.
You see the exact sentence, in context, and say yes or no to that sentence.

## 9. Questions and contact

| | |
| --- | --- |
| Pilot contact | `PENDING-FREEZE` — name and email, filled in before recruitment |
| Withdrawal requests | The same address |
| Anything about the practice problems themselves | [TenkaCloudChallenge issues](https://github.com/susumutomita/TenkaCloudChallenge/issues) |
| Anything about the Advanced Cryptography Program | The course organizers. Not us — we are unaffiliated |

## 10. What you are agreeing to

Read as a list of separate agreements, because they are separate. The first is
required; the rest are not, and declining any of them does not stop you
participating.

- [ ] **Required.** I have read the above, I have had my questions answered, and
      I agree to take part in the stages described in §3.
- [ ] Optional. The interview may be audio-recorded, transcribed, and the audio
      then destroyed.
- [ ] Optional. I may be contacted once, after the pilot, to review quotes
      attributed to my identifier.
- [ ] Optional. I may be contacted about future pilots. This is unrelated to this
      one and declining changes nothing.

Signature or typed name, date, and the identifier issued: recorded on the consent
sheet, which lives with the name-to-identifier mapping in §6 and is destroyed on
the same schedule.

---

## 11. Maintainer notes — obligations this text creates

The sections above are promises. Each one costs something to keep, and the cost
is listed here so that it is not discovered halfway through a run.

| Promise | What it obliges |
| --- | --- |
| §5, no keystrokes or prompt bodies | [`event-schema.json`](./event-schema.json) rejects `keystrokes`, `promptText`, `sourceCode`, and `credentials` as properties anywhere in an event. The rule is enforced by the schema, not by reviewer attention |
| §5, only in-problem source is read | Checkpoint submission reads only files under the problem's `local/starter/`, which is the only path bind-mounted into the container |
| §6, one contact record | No script may write a participant name into the repository, the event stream, or an analysis artifact. Any such occurrence is a `privacy-incident` deviation under `protocol.md` §5 |
| §7, hard deletion dates | A calendar entry per date, created at freeze. Deletion is executed and recorded even if analysis is incomplete |
| §8, deletion within 14 days | Raw artifacts are stored so that one participant's records can be located and removed without reconstructing the dataset. Identifier-keyed files, not one merged spreadsheet |
| §8, aggregates recomputed | Analysis is scripted and re-runnable from the raw artifacts. A hand-assembled table cannot honour a withdrawal |
| §8, quote-level opt-in | Quotes are collected into a review sheet per participant before publication, and an unanswered review request means the quote is not used |

## 12. What this consent does not cover

It does not authorise using the collected data to evaluate a participant, to
train a model, to publish anything identifiable, or to run an analysis that was
not written down in [`analysis-plan.md`](./analysis-plan.md) before the data
existed. A new purpose needs new consent, from the same people, and the honest
version of "we would also like to" is asking again rather than reading the
existing form generously.
