# The gates pass, but the wires are wrong

An independent, unofficial companion to Advanced Cryptography Program 2026. This material is not affiliated with or endorsed by the course. Statements, examples, code and diagrams are independently written.

Track `advanced-cryptography-2026`, Week 4, order 435. Eight checkpoints, 200 points, approximately 40–60 minutes. The public statement and hints assume junior-high mathematics and define additional notation when introduced.

## Participant route

Start the problem in the Participant Portal and select **Inspect**. Add the two displayed inputs, then square the result, taking remainders by 7. Enter the two answers in `outputs` and submit. **Paper and the Portal answer fields are sufficient. No terminal or local Python installation is required.**

The optional Portal editor holds `plonk_drill.py`. Replace the corresponding `return None` with your calculation and run public tests. Helpers implement the supplied formulas. A public-test PASS is feedback, not checkpoint credit: prepare and submit the answer using the Portal. The eight functions match the eight fields.

## One table throughout

| Row | Left | Right | Output |
|---|---|---|---|
| Addition | a0 | b0 | u = a0 + b0 |
| Multiplication | u | u | o = u × u |

All arithmetic uses **the same prime 7**. The three copied cells are O0, L1 and R1. Each row can satisfy its arithmetic while those cells disagree: that is the distinction between a gate constraint and a copy constraint.

Six distinct addresses identify the cells. The three copied cells form a permutation cycle. A fingerprint mixes a value and its address; multiplying six fingerprints compares the original addresses with the wired addresses. The honest table has equal products. A displayed false table is selected to have unequal, nonzero products.

The final task constructs a **different** false multiplication row: both copied inputs must be wrong, multiplication must hold, and the full products must match and be nonzero. Any row satisfying these conditions passes. The legacy checkpoint ID `miss-count` is retained for catalog identity; the answer is three values, not a count.

## Checks and scoring

| Field | Values | Points | Work |
|---|---:|---:|---|
| outputs | 2 | 20 | Addition output and its square |
| bad-row | 3 | 20 | Change one copied input and preserve multiplication |
| addresses | 6 | 25 | Distinct addresses of all cells |
| sigma-addresses | 6 | 25 | Addresses after following the copy cycle |
| marks | 3 | 25 | First-row fingerprints |
| grand-product | 2 | 25 | Two products of the honest table |
| bad-product | 2 | 30 | Two products of the displayed false table |
| miss-count | 3 | 30 | Construct a false row passing the product check |

A wrong answer costs 10 points. Each field has three hints: mechanism, formula with a small example, then actions using the displayed names. Each hint costs 2 points: 24 hints total, maximum penalty 48. All necessary formulas are in the statement before any paid hint.

The final construction is accessible by a supplied linear equation for the second changed input. The statement also connects the table to selector equations, interpolation at Y=1 and Y=6, divisibility by Y²−1, and a product accumulator with a closing boundary. These are mathematical explanations, not additional answer fields.

## What the model establishes

This is a small model of the gate/copy and permutation-product ideas used in PLONK. It does not implement polynomial commitments or a zero-knowledge proof. The learner sees the tiny mixing challenges before constructing a false row; this illustrates why fixing the witness before unpredictable challenges and controlling collision probability matter. It is not an attack on practical PLONK.

The examples adapt two source inputs: the seminar's Week 4 slides (printed slides 27 and 29; PDF pages 31 and 33), and the author's Week 4 `derivations.md` §§3.1–3.2. The lecture uses a larger gate table; this independent two-gate example fits six distinct addresses in one field of size 7. The public text presents both concrete calculations and the associated equations.

## Runtime and trust boundary

Compose builds a participant Workbench and an internal verifier. Only the Workbench is published at `127.0.0.1:18134`; the verifier has no host port. The verifier owns the seed, fixture generation, expected values and construction predicate. The participant image contains supplied formulas, starter and public tests, and fetches only public inputs from the verifier before running learner code. It does not contain the fixture generator, hidden tests, reference answer or seed.

Paper answers and optional editor answers use the same deployment-bound prepared submission envelope. The verifier independently checks the first seven values and the final construction; malformed, wrong-row, wrong-deployment and unprepared submissions fail without revealing expected values.

Both services run non-root with read-only filesystems, dropped capabilities, bounded memory/PIDs and internal networking. Learner execution has Linux syscall restrictions and process/time/output limits. Public tests check a small worked example before printing the learner's values for the current instance. The learner code cannot ask the internal verifier for hidden answers.

Local users who administer Docker can inspect their own containers. This deployment is a self-study environment, not a security boundary against the Docker administrator. A competitive verifier must be operated outside participant control.

## Author verification and lifecycle

No AWS resources are created by this Docker problem. Local Docker consumes host CPU, memory and disk. The verifier can remain running between optional author `make test` calls; `make verifier-down` stops that problem's Compose project. The platform owns deployed-instance teardown.

From this problem directory:

```sh
make reference-test
make test STARTER_FILE=local/reference/plonk_drill.py
```

`reference-test` runs 10 mutants, 8 learning-contract tests and 5 execution-isolation tests. The learning suite checks the two-gate construction across fixtures, all valid final rows against independent predicates, zero-product rejection, the supplied linear equation, interpolation/accumulator identities, first editor action, submission binding and hint/score shape.

From the catalog root, run `make install && make agent-gate`. See [READER.md](READER.md) for the independent hand calculation and actual runtime evidence, including explicit verification limits. A live AWS event or a third-party session is optional rehearsal, not a development merge gate.

Issue #716 participant reread: address bases are distinguished from column indices, and the zero-remainder argument is explained before polynomial divisibility is used. See `local/tests/hidden/READER.md`. Validation passed10 mutation checks,8 learning-contract tests and5 network-isolation tests.
