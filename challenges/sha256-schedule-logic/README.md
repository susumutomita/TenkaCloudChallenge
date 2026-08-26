# SHA-256 part 2: bit operations and the message schedule

**Difficulty:** 3 · **Time:** 60–90 minutes · **Points:** 200 · **Series:** SHA-256, problem 2 of 3

## The story

Part 1 left you with a block: 512 bits, read as sixteen 32-bit words. This problem is everything
that happens to those words before the compression loop starts turning.

That is eight small functions. A rotation, four sigma functions built on it, two logic functions,
and the recurrence that grows sixteen words into sixty-four. None of them is more than three lines.
All eight together are where a hand-written SHA-256 quietly produces the wrong digest, because
every one of them has a plausible near-miss: rotate where the spec shifts, use Σ1's amounts in Σ0,
write Maj as a parity, xor the schedule's four terms instead of adding them.

Five of the eight are shipped wrong on purpose, one line each.

## What gets deployed

Two containers, no cloud account, no network surface beyond the loopback the Workbench answers
on. Everything is local:

```text
local/
├── starter/schedule.py       ← the only file you edit
├── participant/server.py     the Workbench: Portal editor API + a fail-closed /verify proxy
├── tests/public/              the tests you can read
├── fixtures/generate.py      every fixture, derived from your per-deploy seed (verifier only)
├── tests/hidden/              the tests the verifier runs (verifier only, not bind-mounted)
├── reference/                 the answer -- NOT in either image `make build` gives you
├── verifier/server.py         POST /verify, reachable only from the Workbench
└── mutation.py                proves the hidden tests can actually fail a wrong answer
```

`make build` builds the `participant` stage of the Dockerfile, which carries the starter, the
public tests and the Workbench -- and NOT `fixtures/`, `tests/hidden/`, or `verifier/`. Those live
only in a second, unpublished `verifier` image that the Workbench reaches over the compose
network; `show.py` and the public tests fetch this deployment's public evidence from it instead of
importing it directly. `reference/` and `mutation.py` are added only by the `author` stage that
`make reference-test` builds, so the answer is not sitting in either image you were told to run.
That is misdelivery prevention, not confidentiality — see Assurance scope.

Your fixtures come from `FLAG_SEED`, injected fresh at deploy. Same seed, same numbers, so your
session is reproducible and debuggable. Different seed, different numbers, so a value copied from
someone else's run is worthless.

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

Six checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What you submit |
|---|---:|---|
| `rotate` | 20 | One word rotated right and shifted right, two hex words, rotation first |
| `mux` | 25 | Ch(e, f, g) for the fixture triple, as hex |
| `dependency` | 30 | The index of the first schedule word that changes when one input bit flips |
| `sigma` | 45 | Your `schedule.py`, run against `rotr` and all four sigmas |
| `logic` | 30 | Your `schedule.py`, run against Ch and Maj |
| `schedule` | 50 | Your `schedule.py`, run against `expand_schedule` |

Hints are available on every checkpoint. Opening all of them still leaves you 108 of 200.

### The three code checkpoints are genuinely independent

`schedule` checks only the shape of the recurrence — which four words `W[i]` reads, and that the
terms are added rather than xored. It computes what it expects using **your** sigma functions, so a
correct recurrence built on unfinished sigmas passes it. Wrong sigmas are what `sigma` is for.

That is deliberate, and the mutation suite asserts it rather than assuming it: every sigma
mutation has to be killed by `sigma` and has to stay invisible to `schedule`. Otherwise one
mistake would cost you two checkpoints and tell you less about which one it was.

## The four things worth getting wrong once

**A rotation loses nothing; a shift does.** A rotation is a permutation of the 32 positions, so the
population count is fixed. If you cannot tell which one your code did, count the set bits.

**SHA-256 uses both, and it matters which.** σ0 and σ1 are two rotations and one *shift*. Σ0 and Σ1
are three rotations. The shift is not incidental: losing bits is what makes the message schedule
non-invertible, so the sixteen message words cannot be recovered from the sixty-four. The big
sigmas only stir the state inside a round, so they have no reason to lose anything.

**Ch is a multiplexer.** Read `(e & f) ^ (~e & g)` one bit at a time: where e is 1 you get f's bit,
where e is 0 you get g's. Thirty-two selectors side by side. It is not a majority and it is not an
if/else over whole words. Maj is the majority, and on single bits it agrees with the parity
`a ^ b ^ c` on exactly two of the eight inputs — all zeros and all ones — so writing Maj as a
parity is wrong six times out of eight and still survives a careless test.

**The schedule adds; xor is not a substitute.** Xor has no carries, so a bit in one position can
never influence a higher one, and the diffusion the schedule exists for never happens. This is
checkable, not just assertable: rotations, shifts and xor are all GF(2)-linear, so an
xor-everything schedule is linear as a whole — `expand(a ^ b)` comes out exactly equal to
`expand(a) ^ expand(b)`. Addition breaks that. The hidden tests check it directly.

One Python trap on top of the four: `value << (32 - amount)` does not stop at 32 bits. Without a
`& 0xFFFFFFFF` your words grow silently, every sigma goes wrong, and nothing raises.

## Passing the public tests is not the end

The public tests never compare a sigma against its specified amounts, never distinguish Ch from Maj
on a mixed selector, and only ever expand the all-zero block — where xor and addition agree. An
implementation that xors the schedule's four terms passes every single one of them.

The hidden tests sweep boundary words (0, `0xffffffff`, `0x80000000`, `0x55555555`) and seeded
ones, and check relations rather than fixed values: each sigma's linearity over xor, Maj's symmetry
under reordering, Ch's "both choices equal makes the selector irrelevant", and that the expansion
is *not* linear. A relation cannot be satisfied by memorizing one output.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter and the public tests only — no fixtures, no hidden tests,
no reference solution, no verifier. Those live only in a second, unpublished container the
Workbench reaches over the compose network, and in the author-only image `make reference-test`
builds.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it, a
checkpoint can only credit the id it echoes, results do not leak expected values, and the fixtures
come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources. It is a container on your machine.

## For authors

`make reference-test` runs the mutation suite: 21 broken implementations across the three suites,
12 mutations aimed at the verifier itself, and a separation pass asserting that a sigma mutation
does not leak into the `schedule` suite. Every one must be caught.

Five obvious-looking mutations are deliberately **not** in the list, because they are
mathematically identical to the reference — including Maj written with `|` instead of `^`, and Ch
written without masking the complement. Two of those five were in the list until they survived a
run. See the comment at the top of `local/mutation.py`; that comment is the point of the exercise.
