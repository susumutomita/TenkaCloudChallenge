# `expected(seed)` mirrors

One module per problem that ships a **direct-answer checkpoint** — a checkpoint whose
submission is a value the player works out, not a program the verifier runs.

Each module exports:

```python
EXPECTED = {"<checkpoint id>": lambda server, seed: <the correct answer for this seed>}
```

`server` is the problem's own `verifier.server`, already imported with
`FLAG_SEED=seed`, so the mirror can call the same fixture functions the grader calls.

## Why a mirror rather than a search

The audit needs *the* answer for a seed, not merely *an* accepted answer. Brute-force
search over `evaluate()` reaches the small-integer checkpoints (`byte-length`,
`dependency`, `first-broken`) and nothing else: `padded-length` is a list, `length-field`
is eight bytes, `collision` is an arbitrary byte string, `threshold` and `root-cause` are
structured objects. Each grader body already contains the answer expression on its
right-hand side, so mirroring it is three lines.

The mirror is verified rather than trusted: every sweep asserts
`evaluate(cp, expected(seed))` is `True` on every seed. A mirror that drifts from the
grader shows up as an oracle rejection, not as a silent pass.

## Adding one

A new direct-answer checkpoint with no mirror is reported under `notAudited`, and
`scripts/solvability-audit.test.ts` fails on an unexplained `notAudited` entry. That is
deliberate: an unmeasured checkpoint must never read as a measured one.
