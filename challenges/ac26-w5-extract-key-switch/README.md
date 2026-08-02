# Say the same number in another key's words

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 550 · **Chapter:** Week 5 / Sample
Extraction and Key Switching · **Role:** `mechanism` · **Time:** 75–105 minutes ·
**Points:** 300 · **Required first:** `ac26-w5-cmux-blind-rotation` · **Status:** draft

## The story

Blind rotation leaves an RLWE ciphertext. Two things still have to happen before it is
useful: one coefficient of it has to come out as an LWE sample, and that sample has to move
to a different key and a different dimension — **without changing what it says**.

You are not rebuilding anything before that. `fixtures.generate` supplies the ring, RLWE,
RGSW, the external product, CMUX and the rotation loop, all correct, and the accumulator you
work on is a real blind-rotation output with all the noise that implies.

## Extraction

The phase polynomial is `b - a*s`. Coefficient `k` of it can be written as an LWE phase over
the ring secret's own coefficients:

```text
phase_k = b_k - sum_j c_j * s_j
```

`(a*s)_k` collects the products `a_i * s_j` whose indices meet at `k` **in the ring**, and
the ring is negacyclic — some of those arrive with their sign flipped. Which ones, and why,
is the whole checkpoint. Nothing is decrypted and no noise is added: the extracted phase
**is** the coefficient, exactly.

Note what the extracted sample's secret turns out to be: `(s_0, ..., s_(N-1))`, the ring
secret read as a vector, at dimension `degree`. That is not the key the rest of the system
uses. Hence the second half.

## Key switching

The switching key holds, for every old index `j` and level `l`:

```text
ksk[j][l] = LWE_(s_new)( B^l * s_old[j] )
```

Decompose the old mask, subtract the matching entries, and `<mask, s_old>` cancels out of
the phase. The decomposition convention is `ac26-w5-rgsw-external`'s, unchanged.

You are given **no secret at either end**. Not the ring secret, not the source key, not the
target key — and the phase still comes through. If key switching looks like a decrypt
followed by a re-encrypt, find the step in that derivation where anything is decrypted.

## The last coefficient is unfairly easy

A mask slot wraps when its secret index is **above** the extracted index. At `degree - 1`
there are none above it, so nothing wraps at all: an implementation that ignores the sign
completely preserves the phase there, and only there. Index 0 is the opposite — every slot
but one wraps.

All four public tests use the last coefficient, on purpose, and say so. The hidden tests run
every index — and grade extraction on the phase rather than on the mask, so the vector can be
built any way that preserves the number.

## Browser workflow

1. Start the problem in Participant Portal and open **Browser Workbench**.
2. Run `inspect` to read this deployment's fixture and published evidence.
3. Edit the starter source in the in-browser editor.
4. Run `test` for the published checks and fill any direct-answer fields from the evidence.
5. Run `prepare`, then paste every prepared checkpoint value into Participant Portal.

No checkout, terminal, or local editor is required. Code checkpoints submit the edited source.
Direct answers are wrapped by `prepare` and bound to the current deployment seed, so a value copied
from another deployment is rejected.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `phase` | 30 | Every coefficient of `b - a*s`, on the accumulator and on a fresh ciphertext, index range refused |
| `extract` | 50 | The phase preserved at **every** index, mask one slot per secret coefficient, body from `b`, result reduced |
| `trace` | 35 | One record per slot, the values are the mask, and the wrap boundary sits exactly at the index |
| `decompose` | 25 | One digit tuple per coefficient, LSB-first, exactly `levels`, digits in `[0, base)` |
| `switch` | 55 | The message survives under the target key at every index, crossed both ways, mismatched keys refused, the result names its key and carries no secret |
| `domains` | 35 | Source, target, dimensions, `compatible` separating a matching key from two mismatched ones, and the noise bound |
| `endtoend` | 40 | The RLWE coefficient, the extracted sample and the switched sample all agree, and the switch moved something |
| `transfer` | 30 | All of it under a degree, dimension, base and modulus you have not seen |

Hints on seven of the eight, each inside that checkpoint's 50% cap.

## Why the switch checks are crossed

Reverse the digit order in `decompose_mask` **and** the read order in `key_switch` and every
test that runs your decomposition through your own switch still passes. So the hidden tests
cross them: fixture-built samples through your switch, and your samples through the
fixtures'.

## `compatible` is decided from metadata, and that is not a shortcut

Neither secret is on hand, so compatibility cannot be settled by trying the switch and
seeing whether the result decrypts — and a system that settled it that way would need the
secrets in the one place they must not be. The noise figure is a bound rather than a
measurement for the same reason: measuring it takes a phase, and a phase takes a key.

## A leak that is structurally impossible

Every function here that produces an artifact — `extract_sample`, `extract_trace`,
`key_switch`, `domain_report` — is handed no secret at either end. `phase_coefficient` is the
only one given a key, and it returns a single integer. So "the raw secret ended up in the
ciphertext metadata" is not a defect this problem can have, which is worth saying plainly
rather than pretending otherwise: **one candidate mutation was dropped because it could not
be written**. The hidden suite still scans the returned artifacts for either secret, so a
future author who threads one through finds out.

A second was dropped as equivalent: skipping a zero digit in the switch's inner loop changes
nothing, because subtracting zero copies of an entry is what the reference already does.

## Not in scope

Production switching-key generation, compressed switching keys, noise-security parameter
analysis, multi-key or proxy re-encryption.

## This is not secure

The parameters are small enough to enumerate and both secrets fall to linear algebra. A toy
of the mechanism, not of the hardness.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as
`lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`. `spoilerPolicy` is
`independent-reimplementation`: the API, the parameter generation, and the write-up here are
original, and no function name, fixture, or skeleton is taken from the official exercise.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker
daemon, and the image, so nothing inside that image is hidden from you: `reference/` and
`tests/hidden/` are not bind-mounted, which keeps them out of your git checkout rather than
out of reach.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: twenty-nine broken implementations. One is
correct at the last coefficient and nowhere else, which is the shape this problem is built
to catch.
