# The total changed when nobody changed the numbers

`cs-foundations` chapter 7. The same line items go through the same code twice and come
out with different totals — because the rows arrived in a different order.

## The gap this problem is built on

The starter passes every public test. Each of them totals amounts of a similar size in
one order, and a float only visibly loses when the magnitudes are far apart. The shares
only visibly fail to add up when the ratio does not divide cleanly.

## Layout

```
local/starter/aggregate.py    the one file a participant edits
local/reference/aggregate.py  the answer (author image only)
local/tests/public/           tests the broken starter passes
local/tests/hidden/           the properties that actually decide the checkpoints
local/mutants/                author-only mutant read by the mutation suite
local/mutation.py             breaks the reference nine ways and requires each to be caught
local/fixtures/generate.py    seed-derived reconciliation log and allocation sheet
local/verifier/server.py      hidden grading, separate image and network
local/workbench/server.py     participant editor and evidence, the only published port
```

## How the hidden properties decide

Every figure is compared against decimal arithmetic done independently in the checker,
and every input is derived from the verifier seed, so a submission cannot special-case
the numbers it saw in the public tests.

Two wrong answers are deliberately separated. Accumulating in `float` is both
order-dependent and inexact. `math.fsum`, or sorting first, removes the order dependence
and is still inexact — the loss happened when the decimal string became a float, before
any addition. Only exact arithmetic passes. The allocation is checked the same way: the
shares must add to exactly `100.00` *and* no row may sit more than a cent from its real
percentage, which is what separates distributing the remainder from dumping it.

## Author commands

```bash
make build           # participant + verifier images
make test            # public tests against local/starter
make inspect         # print the participant-visible evidence
make reference-test  # reference passes its hidden suite, all nine mutations die
make up / make down  # run the Compose lab locally
```

## Assurance scope

Local mode is self-paced, honor-system verification. The participant owns the machine, the Docker
daemon, and the image. The normal participant image does not
contain hidden tests, the reference, or mutations; the hidden verifier is a separate image. A
person who controls Docker can still build author stages and inspect them. The separation prevents
accidental delivery, not a malicious host owner. Submissions run with time, memory, process, and
output caps; containers run non-root, read-only, without privileges, and without a masqueraded
outbound network.

It does **not** support competition ranking, examination, or completion certification. Those uses
need a verifier the participant does not administer, tracked in
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## What you proved

You did not make arbitrary real arithmetic exact. Within one domain — amounts with two
decimals — you made the total exact and independent of row order, and made every share
land within a cent of its real percentage while the parts still add to the whole. That is
a precise, useful guarantee—and no larger than the evidence supports.
