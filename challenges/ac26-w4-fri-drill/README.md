# Catch an altered polynomial fold

> Independent, unofficial companion to Advanced Cryptography Program 2026. Not affiliated with or endorsed by its operators.

Week 4 / order 425 / difficulty 3 / 200 points / draft / 40–60 minutes.

Use remainders by 5 or 7 to connect even/odd folding, reconstruction from two opposite readings, and blind spots.
The eight answer fields use paper arithmetic. The optional editor has eight functions and supplied arithmetic
helpers, not twelve drill steps plus four empty prerequisites.

## Participant route

1. Start → Inspect. Use your q0 for the first slot of `poly`, then calculate Q(1) and Q(2) from the given formula.
2. Submit `a,b,c` in that field and observe the correct/incorrect verdict. Continue through the eight named fields.
3. Optional: replace the first `return None` with `return (q(qs,0,p), q(qs,1,p), q(qs,2,p))`, then Run public tests.
   Tests check an independently chosen small worked example, then print the learner's own deployment results.
   Unfilled other rows do not block a direct answer. A test PASS does not submit anything.

Every required formula and example is in the statement. Each row's three hints explain the mechanism, calculate
one small example, then walk through the Inspect names to the actual answer field. Each costs 2 points: all hints
cost 48 total, unchanged from the previous eight one-step hints. Wrong answers cost 10 points.

| Field | Values to submit | Points |
|---|---|---:|
| poly | Q(0),Q(1),Q(2) | 20 |
| fold | Q1(0),Q1(1),Q1(2) | 25 |
| fold2 | c+beta2*d, reduced by p | 25 |
| query | Q(x),Q(−x) | 20 |
| recover | recovered even, recovered odd, direct even, direct odd | 25 |
| consistency | reconstructed fold, Q1(x²) | 25 |
| cheat-caught | reconstructed fold, altered Q1(x²) | 30 |
| miss-points | both nonzero positions where the alteration vanishes, increasing | 30 |

## Mathematical scope and inputs

The exercise uses the lecture's even/odd fold and the personal notes' derivation by adding/subtracting two equations.
All coefficients are visible. It is an arithmetic model of the first-fold consistency relation, not a complete FRI
proof, low-degree proximity test or secrecy protocol. The honest second-fold constant is computed but its opening
is not verified by the first-fold comparison. Degree bounds round down: 3→1→0. An alteration can lower actual degree.

Generated records deliberately keep the first fold nonconstant, choose a difference d0+d1*Y with a nonzero square
root position, and display a query outside the two blind spots. They do not simulate uniformly random protocol
execution. For a fixed alteration, a uniform nonzero query misses with probability 2/(p−1); the product rule needs
independent draws with replacement. This is not the soundness bound of the entire FRI protocol.

Sources read for this rewrite:

- Seminar: `advanced-cryptography-2026/week4/acp-2026-week4.pdf`, printed slide 23 (PDF page 27), folding and query.
  The canonical course pin is recorded in `metadata.json.courseAlignment`.
- Author's learning notes: `advanced-cryptography-note/week4/derivations.md`, §2.7 “Why split even and odd terms?”,
  and `week4/index.html`, Drill B. These are a separate input from the seminar; the exercises use independent numbers.
- [Ben-Sasson et al., Fast Reed–Solomon Interactive Oracle Proofs of Proximity](https://doi.org/10.4230/LIPIcs.ICALP.2018.14),
  for the distinction between a folding identity and full proximity testing.

## Runtime boundary

The participant image contains only starter code, public tests, given arithmetic helpers and the Portal API.
The seed, generator, hidden tests and expected answers stay in the unpublished verifier/author images.
Only public inputs are prefetched before learner code runs. The per-deployment submission binding is not authentication.
Linux seccomp blocks network access, parent memory/signals/resource-limit changes and process-group escape for
learner code and its descendants. Residual descendants are terminated. CLI runs use the same restrictions and
fail closed if the filter cannot be installed. The verifier grades pasted values and never runs learner code;
wrong direct answers do not return reasons.

Both services run non-root with read-only roots and bounded resources. Only the workbench publishes
`127.0.0.1:18135`; the verifier has no published port. A person controlling Docker can inspect their own images:
this is a local teaching boundary, not protection from the Docker administrator.

## Run and stop

From this problem directory:

```bash
make inspect
make test                  # expected to fail while starter answers remain None
make test-one ID=poly
make verifier-down
```

The edited file travels over stdin, so no host Python or shared filesystem mount is required. Inspect/test
leave the verifier running; stop it with `make verifier-down`. No cloud account, AWS region or cloud resources
are involved. The local services use CPU and memory until stopped.

Authors run `make reference-test`; at repository root run `make install` and `make agent-gate`.
See `local/tests/hidden/READER.md` for the independent read-through and real participant API evidence.
Live AWS and human event rehearsal are not run and are optional pre-event checks.
