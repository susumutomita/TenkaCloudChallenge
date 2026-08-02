# A claim, and the experiment that could refute it

Implement a protocol that gives several parties the sum and nothing else. The hard part is not the protocol: it is measuring privacy by enumerating the whole probability space, and writing a suite that catches breakage it has not seen.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Turn the primitive a design selected into a working toy implementation.
- Take randomness explicitly, so the probability space can be enumerated.
- Measure privacy as agreement between two worlds' view distributions, not as an assertion.
- Explain why every coalition below the threshold has to be swept, not just one.
- State the limit the function itself has, and distinguish it from a defect in the build.
- Write a test suite that catches breakage it has not been shown.
- Map each claim one-to-one onto an experiment that ran, and onto its limitation.

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `scope` | Say what the build does not guarantee |  |
| `correctness` | Produce the sum on parameters you were not shown |  |
| `transcript` | Make the transcript reconstruct its own output |  |
| `privacy` | Measure that what is seen is fixed by the output alone |  |
| `threshold` | Say where it stops being able to hide |  |
| `detect` | Catch breakage you have not seen |  |
| `measure` | Count it off a run that happened |  |
| `evidence` | Tie every claim to an experiment that ran |  |

## Explanation

## A right answer is not evidence of a right protocol

An implementation that returns the correct output can be broken in any number of ways. Close
to half the mutations in this problem compute the sum perfectly.

That is what the `transcript` checkpoint is for. Is each opened value the sum of what that
party actually received? Do the opened values add up to the reported output? Without both, an
implementation that returns the right number while its transcript describes an entirely
different run passes — and that is the most ordinary shape a faked result takes.

## Privacy can be measured

Writing that privacy "holds by design" is an assertion. Here it is measured.

Take two settings with the same sum and different honest inputs. Enumerate every randomness
and collect what the coalition sees in both. If the two multisets agree, the view is a
function of the output alone. That is not an approximation of the definition; it is the
definition.

The enumeration is only possible because the randomness is explicit, which is why the contract
forbids `random`. A sample cannot support a claim about *every* randomness.

## One coalition is not every coalition

This is the failure worth the most.

Consider a protocol that draws no randomness at all. Every party's shares become
`[0, ..., 0, x]`, and the last party receives everybody's input in the clear. From party 0's
seat, every received value is zero and the opened values match across both worlds: **against
party 0 it is perfectly private.** Party 2 knows everything.

An experiment that only asks one coalition reports that protocol as private. So does a
protocol that reuses one party's randomness for everybody. Neither is caught without the
sweep.

## The threshold is not a defect

With `parties - 1` colluding, the remaining input falls out. That is not a hole in the
protocol — it is a limit **the output itself imposes**. Subtract your own inputs from the sum
and one party's worth is left. No protocol computing this function does better.

So the threshold belongs in the scope statement, not in a defect list. Writing an unfixable
limit as though it were fixable is worse than not writing it at all.

## Your suite is what gets graded

`detect` hands you broken protocols you have never seen. A function listing known-bad cases
does not pass.

Breakage comes in three families and no single check finds all three: the output is wrong; the
output is right and the transcript leaks; both look right and the transcript disagrees with
the run that happened. The third is the one most often missed.

## Where this ends

This is the end of seven weeks. From Week 1's constraints to Week 6's stack composition, one
thing has been running underneath: **a claim becomes a claim only when it is paired with an
experiment that could have refuted it.**

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
