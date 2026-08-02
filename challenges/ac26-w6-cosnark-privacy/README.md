# Eight provers that agree on the answer and disagree on what they say

All eight co-SNARK provers return the same `C = A * B`. What differs is what each one lets out, and through which exit. Find the first privacy violation in the record and close it without changing the answer or the round count.

Week 6's third problem. The co-SNARK prover the previous two built is **supplied** here: the linear layer (`ac26-w6-cosnark-linear`) and the one-round multiplication (`ac26-w6-cosnark-beaver`) are both handed over as answers. This problem does not ask you to compute `C` again.

```text
A = sum_j a_j w_j        B = sum_j b_j w_j        C = A * B        (mod p)
```

What you are handed is eight prover implementations built on top of it, `S1`..`S8`. **All eight reconstruct `C` to `A * B` at every seed and every shape.** Line them up and a correctness test cannot tell them apart. That is the premise of the problem, not a spoiler.

What differs is what each one lets out, and through which exit.

```text
artifact   what the next stage consumes
log        lines a prover writes while working
metrics    named numbers an operator scrapes
error      what a malformed input produces
```

A correctness test reads the first field of the first one. Three of the eight use only the other three. One leaks through none of the four, and one says nothing at all while reading every party's share.

The previous problem's runtime withheld `reconstruct`. This one's `AuditRuntime` **does not**: a real MPC library exposes reconstruction, cross-party debugging hooks and structured logging because real operators need them, and withholding them here would make the whole class of defect unwritable and therefore unauditable. Instead the runtime records every capability reached, with its operand ids and **never with a value**. The record is evidence rather than a transcript.

Specimen ids are opaque (`S1`..`S8`) and two of them reach a capability through a name that does not spell it. `grep("reconstruct")` finds nothing; the capability record finds it. That is what a source-independent behavioural probe means.

On scoring: this problem ships 35 deliberately broken audits, and **29 of them still give all eight specimens the right verdict** -- clean or not clean. `make reference-test` re-measures that count on every run. Noticing that something is wrong and saying what leaked and from where are very different difficulties.

This is a toy and says so. The field is a small enumerable prime, there are two to five parties, the adversary is absent, and a trusted dealer produces the triples. And `Share._value` is one attribute access away: the runtime is an instrument, not a sandbox, and it records what a computation published rather than what its author looked at.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Classify a co-SNARK prover run's values into public input, secret share, allowed open, secret intermediate, artifact and verifier-only
- Detect an implementation that returns the correct relation while its privacy is broken, from the record
- Read the capability record and find a reconstruct reached through an alias that does not spell it
- Tell an authorized d/e opening apart from an unmasked one and from one in an undeclared round
- Detect a read across a party boundary, including in an implementation that discloses nothing
- Check all four channels -- artifact, log, metrics, error -- against the policy
- Detect an allowed name carrying something the policy does not allow
- Submit a counterexample deriving a non-public value from the participant-visible view alone
- Draw out a leak on a malformed-input path that a single run never reaches
- Close the leak while keeping correctness, the open set, the round count and the artifact schema
- Explain why primitive-level safety does not automatically give an application-level privacy contract

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `classify` | Which values belong to whom |  |
| `capability` | What one run tells you, and what it does not |  |
| `open-set` | The values it was allowed to say, and the ones it was not |  |
| `cross-party` | The implementation that says nothing and reads everything |  |
| `leakage` | The three exits a correctness test never looks at |  |
| `evidence` | Build the secret out of what leaked |  |
| `repair` | Same answer, nothing said |  |
| `transfer` | A setting you have not seen, and provers you have not seen |  |

## Explanation

## A correct answer is not evidence of a correct prover

All eight specimens reconstruct `C` to `A * B` at every seed and every shape -- 96 runs out of 96 agree. No amount of correctness testing shows one bit of what seven of them are doing.

The same trap sits on the audit side. This problem ships 35 deliberately broken audits, and **29 of them give all eight specimens the right verdict** -- clean or not clean. `make reference-test` re-measures that count on every run; if it moves, the number moves with it. **Noticing that something is wrong is easy. Saying what leaked and from where is not.** The eight checkpoints demand exact pairs and exact values because that is the difference that matters in practice.

## Of the four exits, a correctness test looks at one

`artifact` is what the next stage consumes, and it is what a test reads. Nobody reads `log`, `metrics` or `error`. Three of the eight use only those three.

The log is **structured**: `emit(event, **values)`, and a record is `{"event", "values"}`. The policy surface is the *field names* inside `values` -- not the event name, and not the prose of a message. That is a deliberate design choice: reducing it to strings first would have made this problem an exercise in regular expressions. The cost is stated rather than hidden -- a prover that writes a secret into a message's prose is not caught by this audit.

## An allowed name is not an allowance

`A`, `B` and `C` are on `ALLOWED_NAMES`. **As sharings.** One implementation publishes a name squarely in the middle of the allowlist, `C`, carrying an integer where a sharing belongs. A scan that only looks at names finds nothing. `SHARING_ONLY_NAMES` is the second rule that exists for it, and `is_sharing(value, parties)` is the tool for asking what a value *is* without reaching into `Share._value`.

## Published is not the same as allowed to be published

One Beaver multiplication authorizes exactly two openings -- the masked `d` and `e`, both under the multiplication's own round id. An opening is authorized only when **both** hold:

- a reserved triple mask is in its ancestry (`maskedBy` is not empty), and
- its `roundId` is the round the relation declared

An opening that fails the first published something nothing was hiding. One that fails the second published a masked value in a round the relation never declared -- a mask spent on a value it was not drawn for, which is triple reuse in a disguise. An audit that checks only `maskedBy` passes the second; one that checks only the round passes the first.

The same predicate is needed by the `classify` checkpoint and by `open-set`. That is not an economy; it is the claim that those are the same question. Measured: breaking `_authorized` down to either half alone fails both checkpoints at once.

## The implementation that leaks without saying anything

One specimen puts nothing into any of the four channels. Its disclosure is byte-for-byte a clean prover's. It also peeks every party's share. Nothing leaves the process, so **an audit of disclosure cannot see it, even in principle.** An audit of capability can.

That is what "the secret-sharing primitive makes the whole prover private" actually looks like. The primitive is working exactly as specified. The application on top of it simply has no privacy contract.

A `peek` record stamps the id of the party that **owns** the share, not the one that read it. That is enough: no single party holds shares belonging to two parties, so the moment two owners appear somebody crossed a boundary. And a run that read its own share twice did not -- the number of peeks and the number of owners are different numbers.

## What one run tells you, and what it does not

One specimen is flawless on the happy path. Hand it a row whose declared width disagrees with its coefficient vector and an exception handler packs the failing state into the error. An audit that runs it once reports it clean. It *is* clean -- right up until it is not.

That is why only the `capability` checkpoint is handed a `probe` and left to decide how many runs there are. The other seven hand you one run and ask what it says.

## Building the secret out of what leaked

A leak is not "a number you recognize". It is **a number you can derive something secret from, using only what is in front of you**, and these disclosures need three different derivations:

1. the secret itself, under a name nobody would flag as sensitive (`prover.left_half` is a number an operator wanted to alert on)
2. a whole sharing in the clear -- additive shares sum to what they were hiding
3. **a value that is not secret-looking at all, published in the same record as a value the policy explicitly allows**

The third is the point. The flagged field is `x`, which looks like nothing. The secret comes out of combining it with `d`, which the policy permits. The previous problem's `d = A - x` is simply read the other way: `A = d + x`. Finding the leak and deriving the secret are two different skills, so they are two different checkpoints.

That checkpoint is handed a `serialized` disclosure: sharings have already become lists of opaque share ids, so neither `Share._value` nor `reconstruct` is on the table. The checker watches the runtime, and a submission that reaches a capability to answer has answered a different question.

## Repairing all of it at once

`private_prover` is written on top of the supplied `beaver_product`, and everything has to hold simultaneously: `C` reconstructs to `A * B`, there are exactly two openings and both are authorized, the schedule is one round, no capability beyond `open` is reached, and none of the four channels carries anything outside the policy.

Publishing nothing satisfies four of those and fails the first, which is the point. **A prover that says nothing is not private. It is useless.**

One more thing is graded, and it is easy to get wrong precisely because it only happens when something else has already gone wrong. The call is made on a runtime whose triple has already been spent, so `reserve_triple` refuses and the call fails. Let it fail. A handler that puts the failing state in front of someone so the failure can be debugged is the single most common way a prover that is private on Tuesday stops being private on Wednesday.

## What the audit proves, and what it does not

It proves that every value published on this runtime went out under a reserved mask, that no capability beyond the protocol's own was reached, and that no name outside the policy appeared in any of the four channels.

It does **not** prove that nobody ever saw `A`. `Share._value` is one attribute access away, and the participant owns the machine and the image. The runtime is an instrument, not a sandbox: what the record proves is exactly what `reached()`, `openings()` and the `Disclosure` say, and no more.

## Toy versus production

The field is a small enumerable prime, there are two to five parties, the adversary is absent, and a trusted dealer produces the triples. In a real co-SNARK, what is called "the policy" here is implemented as a serialization schema, a log schema and a metric cardinality limit, all of which are review artifacts. The claim this problem makes is that such a review can be reduced to something a machine runs -- not that what it reduces to is complete.

## Not in scope

Formal simulation-based proofs, timing and cache side channels, malicious-secure MPC compilers, and the privacy analysis of an actual SNARK proof.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
