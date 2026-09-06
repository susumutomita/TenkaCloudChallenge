# It passes, but it does not protect

## Before you start

You audit an entry check. **Honest inputs pass, but one required check is missing.** Choose **Start → Inspect evidence**, read `deployedCircuit` (the supplied checks), and compare it with A and B below on paper. Then edit `policy.py`.

- A **signal** is a variable in an expression. A **witness** is a dictionary assigning every signal a value. A **constraint** checks that an expression has remainder zero. A **circuit** is a list of constraints. **Underconstraint** means missing checks allow unintended values. An `id` is a name identifying one check.
- The divisor is the displayed prime `p`. `a % p` means the remainder of a divided by p, also called mod. Example: −1 divided by 7 leaves 6. Use integer signal values from 0 through p−1.
- An **inverse** multiplies a number to remainder 1. With p=7, 3×5=15 leaves 1, so 5 is the inverse of 3. For prime p, `pow(a, -1, p)` works only when `a % p != 0`. Zero has no inverse.

## Translate entry rules into expressions

`revoked` counts revocations (zero means unrevoked). `issuer_ok` is 1 for a recognised issuer, otherwise 0. `ok` marks a zero revocation count; `granted` is 1 for permission. `inv` is a helper value used to express the zero check.

```text
revoked ── zero check A and B ── ok ── × issuer_ok ── granted
A: revoked × inv + ok − 1 = 0
B: revoked × ok          = 0
Entry: ok × issuer_ok − granted = 0
0/1 check: b × (b − 1) = 0  (for ok and issuer_ok)
```

Every `= 0` means **remainder zero after division by p**. Since p is prime, a product has remainder zero only if a factor has remainder zero. Thus the b check allows only 0 or 1.

Why both lines? If revoked=0, A forces ok=1. Otherwise B forces ok=0, and A makes inv the inverse.

Small example with p=7: revoked=3, inv=5, ok=0 gives A=14→0 and B=0. Removing B permits inv=0, ok=1: A=0 even though the credential is revoked. Removing A permits inv=0, ok=0: B=0, but A=−1→6. That is an **invalid helper value; the entry decision need not be wrong**.

## What do you build and submit?

Edit the four functions in `policy.py`. Its opening docstring defines the dictionary formats. Return **expressions as data for the checker**. Python `if` is allowed, but returning a computed truth value does not supply a constraint.

| Checkpoint | Input → return | What to check |
|---|---|---|
| build | `intended_circuit()` → the five intended constraints | A, B, two 0/1 checks, and entry multiplication |
| audit | `audit(circuit)` → sorted list of missing id strings | Empty list for a complete circuit |
| exploit | `forge_witness(circuit, params)` → witness dictionary | Each supplied expression has remainder zero; at least one intended expression does not |
| root-cause | Type diagnosis JSON | Missing id, honest values, changed values |
| repair | `repair(circuit)` → repaired list | Preserve supplied constraints; add only the missing one |
| mutation-transfer | Submit the same `policy.py` again | All four functions handle other values and the other missing line |

In `forge_witness`, preserve revoked and issuer_ok from `params`, the dictionary of input numbers. Construct inv, ok and granted. Use each supplied circuit and parameters instead of hard-coding the displayed case.

**root-cause format** (different names below demonstrate the format, not this task's answer):
```json
{"missingConstraintId":"c-example","manipulatedSignals":[{"signal":"helper","before":3,"after":0}]}
```
`missingConstraintId` names the absent constraint. `manipulatedSignals` lists only changed signals. For each `signal` name, copy `before` from Inspect evidence → `honestWitnesses.revokedCredential`, and use your counterexample value for `after`. Include every change once; values must be integers from 0 through p−1. With A missing, an incorrect inverse is not limited to one canonical value.

For the five code checkpoints, each **Submit** button sends the editor source. Only root-cause takes JSON in its answer field. Checkpoints are graded independently; each wrong answer costs 15 points, with a floor of zero. **Run public tests** checks honest values and return shapes. It tries no counterexample, so green alone does not establish a repair.

## How this model relates to zero-knowledge proofs

A **zero-knowledge proof (ZK)** demonstrates a claim without revealing its secret. This exercise checks **expressions against values**, a prerequisite; it does not generate or verify a ZK proof. An invalid helper passing is different from falsely granting access to an unauthorised holder. Finish all six checkpoints: your counterexample must fail after repair while both kinds of honest values still pass.

## Author verification and runtime

The participant route is Start → Inspect evidence → edit policy.py → public tests → checkpoint Submit. Source goes directly from the editor for five code checks; root-cause alone is a typed JSON diagnosis. This problem keeps its existing two Compose services and public API ports. Only the Workbench is bound to host loopback; the internal verifier derives the per-run exercise inputs. Neither the seed, fixtures, reference nor hidden checks enter the participant image.

The Linux worker executes submitted functions with their inputs and the supplied public evaluator. File opening, network creation and supervisor interference are denied before source executes. The parent checks returned JSON values; successful child exit or printed failure lists cannot declare a verdict. Public tests deliberately check only honest cases and shapes. The operating system restrictions are additional to container limits; Docker owners can still inspect their own environment.

```bash
make test                 # public suite through local Compose
make reference-test       # author-only mutation checks
make verifier-down        # stop this problem's local containers
```

The six checks retain 300 total points and 15-point wrong-answer penalties. Each has three hints; all 18 hints total 80 points. Actual reader, API, isolation and mutation evidence is recorded in `local/tests/hidden/READER.md`. No live AWS event or independent human timing is claimed.

No AWS resources are created by this local runtime. Docker consumes local CPU, memory and storage; stop its containers after use. No cloud pricing estimate is needed. The official Week 1 proof-of-exploit exercise and the owner's Week 1 notes informed the teaching sequence. This companion uses its own policy and signal names; it does not reproduce the official assignment solution.
