# SHA-256 part 2: bit operations and the message schedule

Rotation versus shift, four different sigma amounts, Ch as a selector circuit, Maj as a majority rather than a parity, and the recurrence that grows sixteen words into sixty-four. All of SHA-256's wiring, written by hand.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Tell rotation from shift, and say which one loses bits
- Implement all four sigma functions with their specified amounts
- Explain why the small sigmas include a shift, from the schedule's non-invertibility
- Explain and implement Ch as a bitwise selector
- Show with a truth table that Maj is a majority and not a parity
- Implement the schedule recurrence with addition, and say why xor loses the diffusion
- Derive where a one-word change first reaches in the sixty-four-word schedule

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `rotate` | Tell a rotation from a shift by hand |  |
| `mux` | Use the fact that Ch is a selector |  |
| `dependency` | Derive where a single flipped bit first arrives |  |
| `sigma` | Implement rotr and the four sigmas |  |
| `logic` | Implement Ch and Maj |  |
| `schedule` | Grow sixteen words into sixty-four |  |

## Explanation

## What this checked

### Rotation and shift are different, and both are needed

A rotation is a permutation of the 32 positions: no bit is lost and the population count is unchanged. A shift loses bits.

SHA-256 uses both, and which one it uses changes the meaning. σ0 and σ1 are two rotations and one *shift*; Σ0 and Σ1 are three rotations. The shift in the small sigmas is not incidental — losing bits is what makes the message schedule non-injective, so the sixteen message words cannot be recovered from the sixty-four. The big sigmas only stir the state inside the compression function, so they have no reason to lose anything.

Four sets of amounts invite a misremembering: σ0 is (7, 18, 3), σ1 is (17, 19, 10), Σ0 is (2, 13, 22), Σ1 is (6, 11, 25). This is a place to read the spec table rather than trust your memory.

One more Python trap: `value << (32 - amount)` overflows past 32 bits, so the result needs `& 0xFFFFFFFF` to come back to a word. Forget it and values grow silently — every sigma and the whole schedule go wrong, with no exception raised anywhere.

### Ch is a selector, Maj is a majority

Ch(e, f, g) = (e AND f) XOR (NOT e AND g) teaches nothing as a formula. Write out a single bit and it appears: where e's bit is 1 you get f's bit, where it is 0 you get g's. It is thirty-two multiplexers side by side, with e as the selector and f and g as the choices.

Maj(a, b, c) = (a AND b) XOR (a AND c) XOR (b AND c) is a per-position majority. With three inputs there is always a two-to-one, and the reason it can be written with XOR is the reason Maj works at all: at most one of the three pairwise terms is ever the odd one out, so nothing cancels. Writing it with OR gives the same value.

The usual mistake is confusing Maj with the parity `a ^ b ^ c`. On single bits they agree on exactly two of the eight inputs — all zeros and all ones — and disagree on the other six. Close enough to look right, wrong often enough to matter, and still the kind of thing one lucky fixture waves through, which is why the hidden tests run the whole eight-row truth table.

### The message schedule adds; it does not xor

W[i] = W[i-16] + σ0(W[i-15]) + W[i-7] + σ1(W[i-2]), modulo 2^32. Xor is the cheap-looking substitute and it is wrong for a nameable reason: xor has no carries, so information in one bit position can never reach a higher one, and the diffusion the schedule exists to provide never happens.

That is testable. Rotations, shifts and xor are all GF(2)-linear, so a schedule that xors its four terms is linear as a whole — expanding `a ^ b` gives exactly the xor of the two expansions. Addition has carries and breaks that. The hidden tests check the property directly. It is a relation, not a fixed expected value, so it cannot be memorized.

### How far does one bit reach

The dependency checkpoint's answer is not one formula. W[i] reads i-16, i-15, i-7 and i-2, but W[0] through W[15] are inputs, so only indices 16 and above are computed. The first computed word to read input index k is therefore the smallest of k+16, k+15, k+7 and k+2 that reaches 16: 16 for k=0, k+15 for k in 1..8, k+7 for k in 9..13, and k+2 for k=14 and 15.

The difference cannot cancel on the way, because each sigma sends a one-bit difference to two or three distinct positions whose xor is never zero.

## Passing the public tests is not the end

The public tests here never compare a sigma against its specified amounts, never distinguish Ch from Maj on a mixed selector, and only ever expand the all-zero block — where xor and addition give the same answer. An implementation that xors its four terms passes every one of them.

The hidden tests sweep boundary words (0, 0xffffffff, 0x80000000, 0x55555555) and seeded ones, and check the sigmas' linearity, Maj's symmetry, Ch's "both choices equal means the selector is irrelevant" property, and that the expansion is not linear over xor.

## What to learn next

Every part of the compression function is now in place. The next problem assembles T1 and T2, runs the eight working words a through h for 64 rounds, and adds the result back into the incoming state to produce a digest. Then it changes one input bit and measures why half the output moves.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
