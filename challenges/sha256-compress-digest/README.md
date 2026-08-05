# SHA-256 part 3: the compression function, the digest, and password storage

**Difficulty:** 4 · **Time:** 90–120 minutes · **Points:** 300 · **Series:** SHA-256, problem 3 of 3

## The story

Parts 1 and 2 built the inputs. This one is the machine: 64 rounds turning eight 32-bit words,
then the addition that turns a reversible mixer into a one-way function, then the digest.

Then two things worth doing after you have written it rather than before. You measure the avalanche
effect on your own implementation instead of reading that it exists. And you answer, with the whole
algorithm fresh in your hands, why the fast hash you just built is the wrong tool for storing a
password.

Padding and the bit operations come pre-written in `local/given/primitives.py`, so this problem
stands on its own. Five functions to write, all five shipped wrong.

## What gets deployed

A single container, no cloud account, no network surface. Everything is local:

```text
local/
├── starter/compress.py   ← the only file you edit
├── given/primitives.py      parts 1 and 2, already correct -- do not edit
├── fixtures/generate.py     every fixture, derived from your per-deploy seed
├── tests/public/            the tests you can read
├── tests/hidden/            the tests the verifier runs (in the image, not bind-mounted)
├── reference/               the answer -- NOT in the image `make build` gives you
├── verifier/server.py       POST /verify on 127.0.0.1:18091
└── mutation.py              proves the hidden tests can actually fail a wrong answer
```

`make build` builds the `participant` stage of the Dockerfile, which carries the fixtures, both
test suites, the verifier, the given primitives and the starter. `reference/` and `mutation.py` are
added only by the `author` stage that `make reference-test` builds, so the answer is not sitting in
the image you were told to run. That is misdelivery prevention, not confidentiality — see Assurance
scope.

Your fixtures come from `FLAG_SEED`, injected fresh at deploy. Same seed, same numbers, so your
session is reproducible and debuggable. Different seed, different numbers — and for the two quizzes,
a different order, so somebody else's answer string is wrong even if their reasoning was right.

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

Seven checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What you submit |
|---|---:|---|
| `round` | 45 | Your `compress.py`, run against `round_step` |
| `compress` | 45 | Your `compress.py`, run against the 64 rounds and the feed-forward |
| `feedforward` | 45 | Your `compress.py`, run against the inverse |
| `digest` | 55 | Your `compress.py`, run against messages of many lengths |
| `avalanche` | 40 | How many of the 256 digest bits differ between two messages one bit apart |
| `properties` | 35 | True or false for ten claims about hash functions |
| `storage` | 35 | True or false for ten claims about storing passwords |

Hints are available on every checkpoint. Opening all of them still leaves you 153 of 300.

## The one that is the point of the problem

`feedforward`.

The 64 rounds discard nothing. Each one computes two words out of eight; the other six shift along.
Nothing discarded means the whole thing is a permutation of the state — for a fixed schedule, a
bijection you can write the inverse of. And you will, because that is the checkpoint.

Which raises the obvious question: if the rounds can be walked backwards, why can a digest not be?

Because of the last line of `compress_block`, the one that adds the incoming state back into the
round output. That is the Davies-Meyer feed-forward. With it, recovering the input state from the
output would require knowing what the rounds did to that state — which requires the input state.
The circularity *is* the construction.

So one-wayness does not come from mixing 64 times. Without the feed-forward, 64 rounds would be
exactly as reversible as one. The checkpoint asserts both halves: your inverse must undo the rounds,
and it must fail to undo a compressed block.

## The two quizzes

`properties` and `storage` are ten true/false claims each. They are not filler.

Every false statement in `properties` is one people say out loud: that a hash can be decrypted, that
no published collision means no collision exists, that a longer input gives a longer digest. Every
false statement in `storage` is one that has shipped: that a salted SHA-256 is a password hash, that
one table-wide salt is enough, that a hand-written loop over SHA-256 is PBKDF2.

The statements are fixed — there is no honest way to generate a claim about hash functions from a
seed — so what the seed varies is the order they are shown in. Submit T and F in that order.

## Passing the public tests is not the end

Every message the public tests use fits in a single block. So an implementation that compresses only
the first block passes all of them — *including* the published `abc` test vector from FIPS 180-4.
That is the starter's defect, and it is the most annoying class of bug in this problem: correct for
short inputs, correct against the vector everyone checks, wrong from 56 bytes on.

The hidden tests sweep 0, 1, 55, 56, 63, 64, 65, 119, 120, 191 and 192 bytes plus a seeded length
and a mixed UTF-8 message. `feedforward` inverts a forward pass the *checker* computed, not yours, so
an inverse that only agrees with your own broken forward pass does not pass.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing here is hidden from you: `tests/hidden/` is not bind-mounted and
`reference/` is not in the participant image at all, which keeps them out of your way rather than
out of reach. The source is in this repository either way, and you can build the `author` stage
yourself.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it, a
checkpoint can only credit the id it echoes, results do not leak expected values, and the fixtures
come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources. It is a container on your machine.

## For authors

`make reference-test` runs the mutation suite: 23 broken implementations across the four suites and
23 mutations aimed at the verifier itself, including one per quiz letter — a verifier that compared
only a prefix of the answer string would pass a single flipped-letter check and fail these.

Five obvious-looking mutations are deliberately **not** in the list because they are mathematically
identical to the reference. One of them earned its place there by surviving a run: passing
`round_step` the schedule word and the round constant the other way round changes nothing, because
T1 only ever adds the two. A learner who swaps them has written correct code, and a test that failed
them would be the wrong test. See the comment at the top of `local/mutation.py`.

`local/given/primitives.py` derives K and the initial state from prime roots instead of pasting the
tables. That is not decoration: a single mistyped digit in a 64-entry constant table produces a
wrong digest with nothing to point at, and deriving them makes that failure impossible.
