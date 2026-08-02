# The answer is right. That is all it is

Seven implementations all return the correct total. Four of them leak something on the way. Every correctness test passes. Write the auditor that finds the first violation.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Confirm in code that correctness tests cannot establish privacy
- Derive the set of values a protocol may reveal from its specification
- Tell opened secrets, cross-party reads, and log or error leaks apart
- Avoid reporting a violation on a value the specification publishes
- Recover a secret from a transcript to show the leak did harm
- Remove the violation while keeping every legitimate observation
- Explain how the same view yields a different verdict under a different threat model

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `allowed-opens` | Name what the specification allows to be revealed |  |
| `opened-secret` | Find a value that should not have been revealed |  |
| `cross-party` | Find where somebody looked at another's slot |  |
| `log-leak` | Find what escaped through a log or a failure |  |
| `transcript` | Recover a secret from the leaking transcript |  |
| `repair` | Take out the leak and nothing else |  |
| `mutation` | Hold the same verdict when the names change |  |

## Explanation

## What correctness tests cannot catch

All seven implementations return the right total. No number of correctness tests tells you which of them is safe, because privacy is not a property of the output — it is a property of what became observable along the way.

## The four violations

- **opened-a-secret**: an intermediate value (a partial sum) is opened. Nothing masks it, so anyone reading the transcript learns it.
- **cross-party-read**: one party reads another party's raw share slot. Nothing is opened and the transcript is spotless; only the access trace shows it.
- **leaked-in-log**: a log line carries a raw private value. Logs are not outside the threat model.
- **leaked-in-error**: the error path carries a secret. The happy path is perfectly clean, which is exactly why a correctness review passes it.

## The two false positives

An auditor that flags everything suspicious finds every real violation and still fails. One clean implementation logs a weight that is public by specification; another has a party read its own slot. Neither is a violation. What may be revealed is decided by the specification, not by the kind of operation.

## Why the programs are data, not code

An auditor that greps for the word `reconstruct` is defeated by a rename, a wrapper, or a call through a helper. Here a program is an operation list, and what gets audited is the operations a run actually performed. The mutation checkpoint renames every label, moves the independent openings, and runs under a seed you have never seen. The protocol is unchanged, so the verdict must be unchanged. An auditor keyed on label text, or on where a violation sat last time, contradicts itself there.

## Why a counterexample is required

Pointing at an extra opening does not show that it hurt. The transcript holds both the partial sum and the total; the difference is the last party's weighted contribution, and the weight is public and invertible. One subtraction and one inverse hand you that party's private input. A leak claim becomes a claim when you recover the value.

## What counts as a repair

Deleting every observable operation also stops the leak, and still returns the total. So the grading checks that everything the specification permits to be observed is still observed afterwards. A repair removes the violation and nothing else.

## Threat model

This assumes honest-but-curious parties and no collusion. The same view, judged under a model that permits collusion, yields a different verdict. A safety judgement is made against assumptions, not against code.

## Where this leads

This separation — a correct output, and what was observable while producing it — is used directly in Week 6's co-SNARK privacy audit.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
