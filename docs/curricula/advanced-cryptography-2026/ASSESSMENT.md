# Assessment contract — Advanced Cryptography 2026 companion track

What every challenge in this track must evaluate, and how, so that a passing run
is evidence of understanding rather than evidence of a successful copy.

Companion documents: [`curriculum.md`](./curriculum.md) (what each week teaches),
[`GOVERNANCE.md`](./GOVERNANCE.md) (what may be published).

## 1. The problem this contract solves

In a cryptography exercise, all five of these produce the same green test run:

1. the learner understood the construction and implemented the general case;
2. the learner pasted generated code that happened to satisfy the visible tests;
3. the learner hard-coded the fixture values;
4. the learner found and copied a reference implementation;
5. the learner made the happy path work while destroying soundness or privacy.

Only the first is the learning outcome. A challenge that cannot separate the
first from the other four is not assessing anything, however elaborate its tests.

This track's position on generated code is deliberate: **using an AI assistant is
not prohibited and not detected.** Instead, checkpoints are designed so that
producing a passing answer requires knowing what the construction does — whether
the learner arrived at that by reading, by asking, or by experimenting. Rules
that forbid tools are unenforceable; tasks that require understanding are not.

## 2. Evidence kinds

Every learning objective is evaluated by at least **two** distinct kinds. A
concept marked as load-bearing in `curriculum.md` needs at least **three**.

| Kind | The learner can... | Defeats |
| --- | --- | --- |
| `construct` | Implement the definition — an expression, function, or protocol step | Nothing on its own |
| `predict` | State an intermediate value, invariant, round count, or noise change **before** running | Paste-and-run |
| `counterexample` | Produce a concrete input that breaks a stated property | Happy-path-only work |
| `repair` | Reject the attack while keeping the normal and boundary cases working | Over-fitted patches |
| `transfer` | Succeed under a modulus, curve, parameter set, party count, or message that was never shown | Hard-coding, memorization |
| `contrast` | Distinguish two neighbouring concepts by their observed behaviour | Vocabulary without meaning |
| `trace` | Follow a transcript, residual, share, or noise term and name where it first breaks | Black-box guessing |

### The ordering rule

`construct` alone never closes an objective. It must be paired with at least one
of `predict`, `counterexample`, `transfer`, or `trace` — the kinds a copied
solution cannot satisfy without comprehension.

### The `assignment-companion` rule

Any challenge whose `courseAlignment.role` is `assignment-companion` **must**
include at least one `predict` or `counterexample` checkpoint.

This is the rule that keeps the role honest. An `assignment-companion` sits
closest to the official exercise and is the easiest to accidentally turn into a
walkthrough of it. Requiring the learner to state an outcome in advance, or to
construct a breaking case, makes the checkpoint unpassable by transcription — of
the official solution or of anything else.

### Contrast pairs

These pairs are confused often enough to be worth assessing directly. Each must
be distinguished by observed behaviour, not by definition recall.

| A | B | Observable difference |
| --- | --- | --- |
| completeness | soundness | Which direction fails when a constraint is removed |
| soundness | zero-knowledge | Whether the *verifier* or the *transcript* is what leaks |
| encryption | signature | Who can produce it versus who can read it |
| witness | proof | Which one the verifier is allowed to see |
| local linear operation | interactive multiplication | Whether a communication round is consumed |
| ciphertext refresh | ordinary decryption | Whether the secret key is required |
| public input | witness | What appears in the verifier's own view |

## 3. Checkpoint design

Challenges score with `scoring.kind = multi-verify`. Each checkpoint closes on
exactly **one** observable outcome.

Bad — one checkpoint spanning a whole week:

```text
finish-week3   # field + curve + signature + attack, all in one
```

Good — one outcome each:

```text
field-inverse
group-law-edge-cases
valid-transcript
reuse-nonce-recovery
```

Rules:

- **One outcome per checkpoint.** If a checkpoint can fail for two unrelated
  reasons, the learner cannot tell which thing they misunderstood.
- **Checkpoints close independently.** Partial progress is visible and durable; a
  later failure never revokes an earlier checkpoint.
- **Labels name the observation, not the answer.** `reuse-nonce-recovery`
  describes what the learner will observe. A label like
  `submit-the-recovered-private-key-d` gives away the exercise.
- **Labels do not name the vulnerability class before it is found.** Discovery is
  part of the objective for `counterexample` checkpoints.
- **Ordering is a recommendation, not a lock**, unless a later checkpoint is
  genuinely unobservable without an earlier one.

## 4. Hidden test design

Public tests exist so the learner can iterate. Hidden tests exist so that
satisfying the public ones is not sufficient. Every challenge ships both, plus a
mutation suite.

### Parameter generation

- Hidden cases are generated from a **seed**, never fixed in the repository, so
  the visible fixture values cannot be hard-coded into a solution.
- Generated parameters stay small enough to debug by hand — a learner who fails a
  hidden case must be able to reproduce and inspect it.
- Every generated parameter set is **valid**: a prime that is prime, a curve with
  the stated order, a noise bound the construction actually tolerates.
- Toy parameters carry an explicit warning that they are chosen for
  observability, not security, and must never be read as production guidance.

### Metamorphic properties

Properties that must hold across *related* inputs, which a solution over-fitted
to one fixture will violate:

- re-encrypting the same plaintext under fresh randomness still decrypts equal;
- re-ordering constraints does not change satisfiability;
- re-sharing a secret and reconstructing returns the original;
- scalar multiplication is consistent with repeated addition;
- signing the same message twice with *different* nonces yields different, both
  valid, signatures.

### Negative tests

Every challenge asserts that invalid input is **rejected**, not merely that valid
input is accepted. A construction that accepts everything passes every
positive-only suite.

### Mutation suite

Each challenge ships a set of deliberately broken implementations and asserts its
own tests **kill** them. A mutation that survives means the test suite has a hole,
and the challenge is not ready to ship. Recurring mutations:

- apply the field reduction only at the end;
- fail to normalize negative values;
- skip the last constraint;
- treat an unknown signal as zero;
- trust a flag from the witness without constraining it;
- open one share too many;
- ignore the noise bound;
- return success regardless of the underlying result.

The last one is the important one: a verifier that always passes must fail the
challenge's own contract tests.

## 5. Feedback

Feedback is part of the assessment, not decoration. A learner who fails must
learn *where*, without being handed the answer.

| Failure | The learner is told | The learner is not told |
| --- | --- | --- |
| Hidden case fails | Which property broke, and the smallest reproducing input | The expected output |
| Trace diverges | The first index where the invariant broke | Why it broke |
| Counterexample rejected | That the case does not actually violate the property | A working counterexample |
| Transfer case fails | Which parameter changed from the public example | The corrected code |

## 6. Ready-to-ship checklist

A challenge in this track is not ready until every line is true.

- [ ] Each learning objective is evaluated by ≥2 evidence kinds (≥3 if load-bearing)
- [ ] `construct` is never the only kind for an objective
- [ ] If `role = assignment-companion`, at least one `predict` or `counterexample` checkpoint exists
- [ ] Each checkpoint closes on exactly one observable outcome
- [ ] Checkpoint labels leak neither the answer nor the vulnerability name
- [ ] Hidden cases are seed-generated, valid, and small enough to debug
- [ ] Metamorphic and negative tests are present
- [ ] The mutation suite kills every listed mutation
- [ ] A solution hard-coding the public fixture fails
- [ ] The starter state fails for the intended reason, not by crashing on import
- [ ] The writeup explains the mechanism and contains no official-exercise answer
- [ ] Toy parameters carry the not-for-production warning
