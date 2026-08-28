# Type one line, paste the value — the blind rotation readout that makes bootstrapping programmable

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 563 · **Chapter:** Week 5 / Drill:
Blind rotation readout · **Role:** `mechanism` · **Time:** 40–60 minutes · **Points:** 200
· **Status:** draft — new companions need human play evidence (#465) before leaving draft

## What this is

Not a write-a-function problem. You open your own `python3`, paste the numbers the Portal's
"Inspect evidence" shows you, and then **type one line, paste the value it prints**, twelve
times. The twelve lines produce the core of Programmable Bootstrapping (lecture slides 21–26
and 42): from a noisy ciphertext, without decrypting, rotate a polynomial whose coefficients
spell out the answers by the amount the ciphertext points at, and read the constant term.

```
1  (p, q, n, D)                the deployment's four constants         params
2  ph = (b - a·s) % q          the phase — decryption's halfway point  phase
3  divmod(ph, D)               plaintext and noise, look-only         (no answer field)
4  slot = 2n // p              the width one plaintext owns           (no answer field)
5  v = [f(...)...]; samples    the test polynomial, centred runs       testpoly
6  round(x * 2n / q)           rescaled by 2n/q: D̂, â[0], b̂           rescale
7  (b̂ - â·s) % 2n              the rotation amount — mod 2n, never n   index
8  c(idx)                      rotate and read address zero            readout
9  f(m)                        the cross-check: readout == f(m)       (no answer field)
10 count equal around idx      the width where the answer holds        window
11 first change - 1            positions left before the boundary      edge
12 sweep every usable m        readout == f(m) for all of them        (no answer field)
```

Every line comes with "what this line means"; every matching value unlocks "read after it
matches". Eight of the twelve lines have an answer field — the platform's per-problem maximum;
the other four are a cross-check, a construction constant, or feed the line after them.

Three points the statement carries on purpose, each essential to reading the lecture slides:

- **Only the lower half of the plaintext space is usable.** A rotation past n negates the
  constant term, which can never equal f(m) ∈ [0, p). Slide 26 writing the plaintext space as
  Z_8 and adding "actually using 0–3" is this constraint, not a simplification.
- **The test polynomial lays the same value out in slot-wide runs, centred on each target.**
  The mask and the body are rounded separately, so the index carries accumulated rounding
  error — slide 24's heading "the point is to give it width" is about exactly this.
- **The rotation amount is a residue mod 2n.** Reducing mod n silently deletes the sign story;
  on a clean deployment the number can even coincide, which is why the author-side suite kills
  that mutant with overshoot probes rather than deployment values.

## Why the numbers are small and seed-derived

The ring degree is 32–128, the plaintext modulus 8 or 16, and q = 2n·2^k, so every line is a
one-screen computation and the closing sweep is one `all(...)`. The procedure is the
lecture's; the moduli, the secret, the ciphertext, and the function f come from this
deployment's `FLAG_SEED`. The lecture's own example (p=8, n=16, q=64) is excluded from
generation, so no deployment can be solved by copying the course material. The generator
redraws the mask until the readout equals f(m) for every usable plaintext, so the rounding
story stays honest without any deployment being broken by it. There is one right value per
line per seed; only the value your own Python printed passes.

The secret s is shown on purpose: the learner is inside the bootstrapping machine, retracing
in the clear what blind rotation performs under encryption. What stays hidden is every
expected value — the drill is producing them yourself.

## Participant Portal

1. Start the problem in the Participant Portal. The problem editor appears on the same page.
2. Press **Inspect evidence**: the numbers are printed as Python assignment statements. Paste
   them into `python3` first.
3. Type line 1, paste the value into the first answer field, submit. Read the sentence for
   that value. Continue to line 12. **Each answer field is a single-line input.**
4. If you cannot open Python: fill in the functions of `rotation_drill.py` in the editor
   and press **Run public tests** — it prints your functions' values on this deployment's
   numbers, which is exactly what the REPL would print.

Direct answers are bound to the current deployment seed, so values copied from another
deployment are rejected.

## Scoring

Eight checkpoints, graded independently. A wrong answer costs 10 points.

| Checkpoint | Points | Evidence kind | What it checks |
|---|---:|---|---|
| `params` | 20 | construct | (p, q, n, D) — and q is not 2n here |
| `phase` | 30 | construct | b − a·s mod q, the mask stripped without decrypting |
| `testpoly` | 30 | construct | f(m) in centred slot-wide runs, sampled at four boundaries |
| `rescale` | 25 | construct | round(x·2n/q) on D, a[0], b — three separate roundings |
| `index` | 30 | construct | b̂ − â·s reduced mod 2n, never mod n |
| `readout` | 25 | predict | the constant term after rotating — equal to f(m) |
| `window` | 20 | trace | how many positions around the index return the same value |
| `edge` | 20 | trace | how many more positions the noise may push before it changes |

One hint per checkpoint (penalty 6), naming the usual slip on that line.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon
and every image in the compose stack cannot be prevented from inspecting hidden material.
The boundary here is misdelivery, not confidentiality against that person: the participant
Workbench image contains the Portal editor API, the starter and the public tests only.
Like its sibling ac26-w5-negacyclic-drill, this problem's `fixtures/generate.py` derives the
expected values in the same function as the public numbers, so the module ships only in the
separate, unpublished verifier image (Issue 537/543 option B2); the Workbench fetches this
deployment's public half from the verifier's `GET /public` over the Compose-internal network.
`reference/` and `mutation.py` are added only to the `author` stage.

Only the Workbench is published, at host `127.0.0.1:18138`; the verifier has no host port.
Both services run non-root with a read-only root filesystem, no capabilities, `no-new-
privileges`, and bounded memory/PIDs. A checkpoint can only credit the id it echoes, results
do not leak expected values, and the fixtures come from this deployment's seed so a memorized
answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer at all, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: thirteen broken references (the phase with the
mask added back, the test polynomial without the half-slot centring, the rescaling floored
instead of rounded, the index reduced mod n, the constant term read without the flip, the
sweep run over the whole plaintext space, …) that the hidden suite must kill — the mod-n and
no-flip mutants via crafted overshoot probes, because a clean deployment's own index never
crosses n — plus thirteen verifier-level near-misses (a shown fixture value, another line's
value, the plaintext where f(m) belongs, a truncated tuple, a boolean, another deployment's
answer) that the value grader must refuse. `make test` and `make inspect` run through Compose
because the participant image has no `fixtures/`: the public numbers come from the verifier's
`GET /public`.
