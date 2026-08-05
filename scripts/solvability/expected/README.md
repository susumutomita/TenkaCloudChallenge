# `expected(seed)` mirrors

One module per problem that ships a **direct-answer checkpoint** — a checkpoint whose
submission is a value the player works out, not a program the verifier runs.

Each module exports two tables:

```python
EXPECTED = {"<checkpoint id>": lambda server, seed: <the correct answer for this seed>}
VISIBLE  = {"<checkpoint id>": lambda server, seed: {"<label>": <a value the player is shown>}}
```

`server` is the problem's own `verifier.server`, already imported with
`FLAG_SEED=seed`, so a mirror can call the same fixture functions the grader calls.

`VISIBLE` is what makes the answer-on-screen probe mean anything. The coarse version of
that probe — is the answer one of the numbers printed by `show.py` — was measured against
the `predict` defect it exists to catch and came out at its own chance level (73.6 %
against 72.4 %): with a modulus of 23 and a ten-entry trace on screen, a correct answer is
visible most of the time no matter what. Naming the fields turns it into "the answer
equals the printed `start`", which is the thing that was actually wrong, and each rate is
reported against a control drawn from another seed's answer.

**Declaring `VISIBLE` is not optional.** A checkpoint without one is reported as
`not-audited`, which fails the gate. When nothing on screen could equal the answer — the
answer is a true/false verdict, a table, or a constraint id the player picks from a
printed list — declare an empty mapping and say why in a comment. Empty means *looked and
there is nothing to compare*; missing means *nobody looked*.

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
