# One sign, and everything downstream

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 520 · **Chapter:** Week 5 / LWE and
RLWE · **Role:** `mechanism` · **Time:** 75–105 minutes · **Points:** 300 ·
**Required first:** `ac26-w5-encoding-noise` · **Status:** draft

## The story

Two encryption schemes with the same shape and different arithmetic:

```text
LWE    secret s in {0,1}^n           b = <a, s> + encode(m) + e   (mod q)
RLWE   secret S in R_q, 0/1 coeffs   B = A * S + encode(M) + E    (in R_q)
```

Something times the secret, plus the encoded message, plus noise — both times. What
changes is the operation and the payload. **RLWE is not LWE with longer vectors:** the
product is a different product, and one RLWE ciphertext carries N messages rather than one.

The ring is `R_q = Z_q[X] / (X^N + 1)`, which is one fact:

```text
X^N = -1
```

A coefficient that wraps past degree N comes back **negated**. That single sign is the
difference between a negacyclic product and a cyclic one — and a cyclic ring is a
perfectly good ring. It satisfies every axiom, distributes, commutes, and round-trips your
own tests happily. It is simply not this ring.

## Why your own round trip cannot catch this

A sign-flipped inner product cancels against a sign-flipped phase. A ciphertext that
carries its own plaintext decrypts better than the real one. A cyclic ring is
self-consistent. Each of these passes any test that encrypts and decrypts with the same
code.

So every round trip in the hidden suite is run **crossed**: encrypt here, decrypt against
the fixtures, and the other way round. A scheme that is only self-consistent does not
survive that, and a scheme that is actually right does not notice.

The wrong product is written out for you as `participant.wrong_ring.cyclic_mul`, so the
counterexample is against a **stated** weakness rather than against code you deliberately
broke. `make inspect` also prints both products of the same input, side by side.

## Not sampled — given

`lwe_encrypt` and `rlwe_encrypt` take their mask and their noise as arguments. That makes
every run reproducible without pulling in a CSPRNG this problem is not about. A real
implementation samples both, and reusing a mask across two encryptions under one key is a
break: subtract the two ciphertexts and the mask term cancels, leaving the difference of
the two plaintexts plus a little noise.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read this deployment's fixture and published evidence.
3. Edit the starter source in the Portal editor.
4. Select **Run public tests** and fill any direct-answer fields from the evidence.
5. Submit each checkpoint directly. Portal prepares and sends the current files and answers.

No checkout, terminal, local editor, second screen, or copy-and-paste step is required. Code
checkpoints use the current editor source. Direct answers are bound to the current deployment
seed, so a value copied from another deployment is rejected.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `normalize` | 30 | Fold to degree < N with `X^N = -1`, coefficients into `[0, q)`, idempotence, **two** wraps restoring the sign |
| `ring` | 45 | Add, subtract, negacyclic multiply; `X^(N-1) · X = -1`; distributivity and commutativity |
| `lwe` | 40 | Round trip crossed both ways, phase and noise reported, ciphertext holds only `a` and `b` |
| `rlwe` | 40 | Same, in the ring, and all N coefficients — not just the constant one |
| `correspondence` | 30 | The structured side-by-side, including which operation and which payload size |
| `boundary` | 40 | Which noise survives, and the first sample out of budget **in the order given** |
| `transfer` | 30 | All of it under a degree, modulus, dimension and secret you have not seen |
| `defense` | 45 | Eight malformed ciphertexts rejected, four well-formed ones kept |

Hints on five of the eight, each inside that checkpoint's 50% cap.

## Not in scope

No concrete security parameter selection, no CSPRNG or constant-time work, no NTT or FFT,
and nothing here is a usable LWE/RLWE library. Schoolbook multiplication is deliberate: an
NTT hides the wrap behind a transform that has to be told the same sign convention anyway.

## This is not secure

n, N and q are small enough to enumerate, and the secret falls to linear algebra from a
handful of samples. It is a toy of the mechanism, not of the hardness. Nothing here
supports a claim about real parameters.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as
`lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`. `spoilerPolicy`
is `independent-reimplementation`: the API, the parameter generation, and the scheme
write-up here are original, and no function name, fixture, or skeleton is taken from the
official exercise.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine and the Docker
daemon, so nothing you build is hidden from you: `reference/` and `tests/hidden/` are not
bind-mounted, which keeps them out of your git checkout rather than out of reach.

What the deployment does do is stop handing them to you by accident. It runs two
containers. The Workbench you talk to carries the starter, the public tests,
`participant/wrong_ring.py` and `show.py`; the grading image carries `fixtures/`,
`tests/hidden/` and the verifier, publishes no port, and sits on a Docker network with no
gateway. `show.py` and the public tests read this deployment's parameters, traces and
boundary samples from that verifier's `GET /public`, which serves the question and never a
checkpoint's expected value — `fixtures/generate.py` has to implement all eleven functions
`starter/lwe.py` asks you to write in order to derive them, so it is not in the image you
run ([#543](https://github.com/susumutomita/TenkaCloudChallenge/issues/543)).

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: twenty-two broken implementations. Most
encrypt and decrypt their own ciphertexts perfectly and differ from the reference only
when something else has to agree with them.

### A fixture invariant worth naming

The generated secrets are forced to contain at least one `1`. That is not cosmetic: an
all-zero secret makes the mask term vanish, so `b = encode(m) + e` no matter what the
implementation did with the secret. **Three separate mutations survived on exactly this**
before it was forced — the seed drew `(0, 0, 0, 0, 0)` and the whole scheme degenerated
into "encode the message and add noise", which every wrong sign convention also does.
