# SHA-256 part 3: the compression function, the digest, and password storage

T1 and T2 for one round, then 64 of them, then the digest — and a counterexample showing that the 64 rounds are invertible and only the final addition makes SHA-256 one-way. Ends with what you can and cannot claim about a hash, and how to store a password.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Explain and implement a round in which only two of the eight words are computed
- Implement the 64 rounds and the feed-forward separately, and say what each does
- Write the inverse of the 64 rounds, showing they discard nothing
- Show by counterexample that one-wayness comes from the feed-forward addition
- Finish a SHA-256 that chains every block of a message
- Measure that one input bit moves about half the output bits, and say why that is wanted
- Tell apart what can and cannot be claimed about a hash function
- Say why a general-purpose hash is wrong for passwords, and what to use instead

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `round` | Implement one round |  |
| `compress` | Implement the 64 rounds and the feed-forward |  |
| `feedforward` | Walk the 64 rounds backwards |  |
| `digest` | Finish SHA-256 |  |
| `avalanche` | Measure how far one bit reaches |  |
| `properties` | What can be claimed about a hash function |  |
| `storage` | How to store a password |  |

## Explanation

## What this checked

### A round is smaller than it looks

One round computes two of the eight words. The new `a` is T1 + T2 and the new `e` is the old `d` + T1. The other six are the old a, b, c and e, f, g shifted one position along, and the old `d` and `h` are gone.

T1 = h + Σ1(e) + Ch(e, f, g) + K[i] + W[i]; T2 = Σ0(a) + Maj(a, b, c). Five terms and two. Drop one and nothing raises — you simply get a different digest for every input. The starter drops K[i] so that happens to you once, cheaply.

### The 64 rounds are invertible, and that is the point

Nothing is discarded, so the 64 rounds are a permutation of the state: for a fixed schedule, a bijection with a writable inverse. Writable means somebody could walk a digest backwards into an intermediate state.

What stops them is the last line: adding the incoming state back in. That is the Davies-Meyer feed-forward. With it, recovering the input state from the output would require knowing the round output for that state, which requires the input state — the circularity is the construction.

So the thing this checkpoint establishes is that one-wayness does not come from mixing 64 times. It comes from adding the original back to the mixture. Without the feed-forward, more rounds would still be invertible.

### The digest is a chain

Each block's compressed output is the next block's input state. An implementation that compresses only the first block is right for messages up to 55 bytes and passes the published `abc` vector. It breaks at 56.

When you check an implementation against published test vectors, include a multi-block case. This generalizes well past SHA-256: a test suite that never crosses the boundary is the most reassuring kind of insufficient.

### Avalanche

Flip one input bit and roughly half the 256 output bits change. Roughly, not exactly. For an ideal random function the expected count is 128 and measurements scatter, typically somewhere between 100 and 160. Yours will have landed in that band.

Half is the target because it stops an attacker reading the input difference off the output difference. A hash where one input bit moved one output bit would let you walk differences back to the input.

### Do not store passwords with SHA-256

Having implemented it, you know SHA-256 is fast. That is a design goal, and for password storage it is a defect: storing the output of a function a commodity GPU evaluates billions of times per second makes brute force practical the moment the database leaks.

A salt is necessary and not sufficient. What a salt defeats is precomputation — rainbow tables — not brute force at the time of the attack. Per-password salts are also necessary: one salt shared across the table lets a single brute-force run pay off for every user at once.

What you want is a deliberately slow function whose cost you can raise: Argon2 (ideally Argon2id), bcrypt, scrypt, PBKDF2. Argon2id and scrypt demand memory as well as time, which cuts into the parallelism advantage GPUs and ASICs have.

One last thing. "Iterating SHA-256 a few thousand times is what PBKDF2 does" is not right. PBKDF2 is a specified construction over HMAC with defined handling of the salt and the iteration count, and a loop you wrote yourself is most likely missing part of that specification. Not hand-rolling cryptographic constructions is the correct call even after three problems of writing SHA-256 by hand — arguably especially then.

## Passing the public tests is not the end

Every message the public tests use fits in one block, so an implementation that compresses only the first block passes all of them, published `abc` vector included.

The hidden tests sweep lengths 0, 1, 55, 56, 63, 64, 65, 119, 120, 191, 192, a seeded length and a mixed UTF-8 message, and `digest` is the one checkpoint compared against known answers. `feedforward` inverts a forward pass the checker computed itself, so an inverse that only agrees with your own broken forward pass does not pass.

## What you have now

You have written every stage of SHA-256: bytes, padding, word splitting, the message schedule, 64 rounds of compression, the feed-forward, the digest. Whatever your library's `sha256()` is doing, it is no longer a black box.

The same pieces carry directly into HMAC, PBKDF2, Merkle trees and Bitcoin's proof of work. Each of those is a different answer to "what do we apply the compression function to, and how often".

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
