# The same R twice is the key

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 340 · **Chapter:** Week 3 / Nonce Reuse and
Special Soundness · **Role:** `transfer` · **Time:** 60–90 minutes · **Points:** 300
· **Required first:** `ac26-w3-schnorr`

## The story

A signing service kept an audit log. Per signature: the message, the public key, the commitment
`R`, and the response `z`. No secret keys — that was rather the point of keeping a log.

Somewhere in it, one signer used the same commitment twice.

```text
z1 = k + e1*x
z2 = k + e2*x
```

Two equations, two unknowns, and you already have one of them.

## This is not a story about random numbers

Nonce reuse is usually told as "weak random number generators are dangerous". That is the
symptom, not the reason.

The reason is **special soundness**: two accepting transcripts sharing a commitment and differing
in the challenge yield the witness. That *is* the definition of the Sigma protocol being a proof
of knowledge — the property that guarantees the prover really knows `x`. The extractor exists, so
the protocol is sound. The extractor exists, so reuse is fatal. One fact, two consequences.

## Sharing R is necessary, not sufficient

The log is noisy on purpose:

- rows that are **malformed** — a parser that trusts its input dies on the first one;
- a row that **parses cleanly and does not verify** — reuse inside a rejected transcript proves
  nothing;
- a row from a **different signer who used the same R** — different keys means the two
  transcripts are not two equations in one unknown, and attacking them yields a scalar belonging
  to nobody.

Which is why a recovery is always confirmed against `P = xG`. The arithmetic succeeds on the
wrong pair too.

And when `e1 = e2` there is no inverse, because two responses to the same challenge are one
equation written twice.

## How to play

```bash
make inspect            # the log, and which commitments repeat
make test               # public tests
make reset              # restore starter/recover.py
```

You edit one file, `local/starter/recover.py`.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `parse` | 30 | Valid rows read, malformed rows rejected explicitly |
| `detect` | 35 | Only same-signer, both-accepting pairs reported |
| `extract` | 50 | The key, and independence from transcript order |
| `confirm` | 30 | Confirmed against the public key; wrong scalars refused |
| `reject` | 40 | `e1 = e2`, a cross-signer pair, and a log with no reuse |
| `hunt` | 40 | The victim's key out of the noisy log, and whose it is |
| `collision` | 40 | The truncated generator measured, against its actual space |
| `repair` | 35 | A generator that collides on nothing it must not |

Hints on five of the eight, each inside that checkpoint's 50% cap.

## Three nonce generators

| Generator | In the log it looks | Actually |
|---|---|---|
| `fixed_nonce` | obviously wrong | dies immediately |
| `truncated_nonce` | **perfectly random** | collides on the birthday schedule |
| `deterministic_nonce` | alarming | the safe one |

`truncated_nonce` is the interesting one: every `k` differs, every signature verifies, and nothing
is visibly wrong. Looking random is not having entropy.

`deterministic_nonce` has the most worrying name and is correct. The same key and message give the
same nonce — which gives the same signature, leaking nothing new — while two different messages
cannot collide without a hash collision. The key goes into the hash too, or two signers of the
same message would share a nonce.

## Group order, and a test that cannot be written

The repair checkpoint runs on **secp256k1**, and that is not incidental. A toy group has fewer
than fifty scalars, so sixty messages cannot possibly receive sixty distinct nonces — the
pigeonhole says so before any code exists. There is no safe nonce generator in a forty-element
group; the group being small *is* the vulnerability. A test asserting the impossible is a design
failure, not a failing test.

Truncation is likewise not caught by "are the sixty samples distinct". At sixteen bits, sixty
draws are all distinct about 97% of the time — that assertion would let it through on most runs.
The **range** rules it out: against a 256-bit order, every output landing below 2^64 has
probability around 2^-11000. That is evidence, not luck.

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

`make reference-test` runs the mutation suite: nine broken implementations. Three of them found
real holes in the hidden tests while this problem was being written — the log had no
non-accepting duplicate, no cross-signer duplicate, and the nonce-space check was distinctness
rather than range. A fourth, "reports a recovery without confirming it", turned out to be an
equivalent mutant on its own and is now mutated together with the validation it depends on.
