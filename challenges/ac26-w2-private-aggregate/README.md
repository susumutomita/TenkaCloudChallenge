# Five multiplications, one round

Several organizations want a weighted risk score without handing over their incident counts or severities. Week 2's four problems, assembled into one application — where the number of multiplications and the number of rounds are not the same number.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Decompose an application expression into its linear and multiplicative parts
- Estimate the triple count and round count before implementing
- Explain why rounds track multiplicative depth rather than multiplication count
- Compute a result from secret-shared inputs without revealing anything in between
- Explain why reusing a triple breaks privacy rather than correctness
- Verify correctness, privacy and communication cost separately
- Explain what the published output leaks by definition

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `plan` | Estimate the cost before writing it |  |
| `share-inputs` | Split the secrets |  |
| `linear` | Add a value everyone already knows |  |
| `multiply` | Build the products of two secrets |  |
| `result` | Show the relations hold |  |
| `privacy` | Reveal the masked differences and nothing else |  |
| `cost` | Make the estimate match the measurement |  |
| `transfer` | Hold up in settings you have not seen |  |

## Explanation

## Decomposing the expression

`score = sum_i (count_i * severity_i) + bias`. The summation is linear, adding the bias is linear (with exactly one party folding it in), and only the products of two secrets are not. So `k` organizations means `k` Beaver multiplications and `k` triples.

## Why the round count is one, not k

None of the `k` products' `d` and `e` values depends on any other product's result, so they all fit in a single opening. An implementation that opens per multiplication is correct, is private, and costs `k` times the latency.

That is the demonstration of "rounds equals multiplications": rounds are set by multiplicative **depth**, not count. This expression has depth 1, so the round count stays at one however wide it gets. A circuit of depth `D` costs `D` rounds.

## Why reusing a triple is not caught by correctness

Beaver multiplication works with any valid triple, so reusing one across every product still yields the right score. What breaks is privacy: with the same `a` masking both `x_1` and `x_2`, the opened `d_1 - d_2` is `x_1 - x_2` — a difference of secrets, straight out of the transcript.

The hidden tests match the multiset of opened values exactly against the masked differences the supplied triples imply. Being an exact match rather than a blacklist, it catches "used another product's triple" and "revealed one extra thing" with the same check. This is why each multiplication consumes its own triple, and why the offline cost scales with the number of multiplications.

## Why the three are graded separately

An implementation can be correct and expensive, correct and leaky, or private and wrong. Folded into one verdict, a learner cannot tell which of those they built. Correctness, privacy and cost are separate checkpoints for that reason.

## Relations rather than fixed expectations

The result checkpoint checks three relations: re-sharing with fresh randomness must not move the score, reversing the organizations must not move it, and moving one organization's count by Δ must move it by Δ times their severity. Memorizing one output satisfies none of those.

## What the published output leaks by definition

Once you decide to publish the score, whatever follows from the score is public. At `k = 1`, `score - bias` is that organization's product outright. With small `k` and a narrow severity range, the candidate counts narrow considerably. MPC guarantees that the *process* adds no leakage. It does not guarantee that the output reveals nothing — for that you need a different mechanism, such as perturbing or thresholding the output.

## Where this leads

Decomposing an application expression into linear and multiplicative parts, estimating its cost in advance, and reconciling the estimate against a measurement — all three are used directly in Week 6's co-SNARK work.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
