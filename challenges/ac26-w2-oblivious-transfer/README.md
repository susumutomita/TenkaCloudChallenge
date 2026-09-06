# Choosing without saying which

## Before you start

Build a tool for receiving a message without telling the other party which one you chose. **Start → Inspect evidence → edit oblivious.py → Run public tests.** Fix `request` first and use its checkpoint's Submit button. All six checkpoints submit the current source; none requires handwritten JSON.

**Oblivious transfer (OT)** aims to give a receiver one selected message from a sender's pair, without telling the sender which was selected or giving the receiver the other message. Here you calculate the matching values, then build a model of AND using two transfers.

```text
Sender: messages m0,m1                  Receiver: choice (0 or 1)
           public A ──────────────────→
                    ←───────────────── request B (not the choice itself)
           ciphertexts C0,C1 ─────────→ open the selected index with a local key
```

**You implement both roles in this learning editor.** Public test data even includes the sender's exponent. This does not demonstrate secrecy inside the screen or a single Python process. Practical OT needs sufficiently large parameters and cryptographic assumptions. These tiny numbers allow exhaustive exponent searches, so both keys can actually be computed.

## 1. Build requests with small numbers

Python `% p` gives the **remainder after division by p**. `pow(g,t,p)` computes the remainder of g raised to power t. In mathematical formulas `g^t` means a power; **Python's `^` means XOR**, defined below.

`grp` is a dictionary containing `p,q,g`. Both p and q are primes, and p=2q+1. Repeatedly multiply by g and take remainders: after q steps the values return to1. Those q values form the **subgroup**, q is its **order** (cycle length), and g is its **generator**.

Example: p=7,q=3,g=2. The remainders of `2^0,2^1,2^2` are **1,2,4**, and `2^3` returns to1. The sender chooses a secret exponent a in1..q−1 and publishes `A=pow(g,a,p)`. With a=2, A=4; A is neither0 nor1.

The receiver's random t is called the `blind`. For choice0 send `B=pow(g,t,p)`; for choice1 send `B=A*pow(g,t,p)%p`.

| t | 0 | 1 | 2 |
|---|---:|---:|---:|
| B for choice0 | 1 | 2 | 4 |
| B for choice1 (A=4) | 4 | 1 | 2 |

**Uniform** means choosing every candidate with equal probability. A **distribution** lists the probability of each observed value. If t is uniform in0..2, both choices produce1,2,4 with probability1/3 each. A sender observing B cannot distinguish the choices: multiplying by A simply rearranges those three values.

More generally, **q consecutive integers** visit every position of the cycle once. `blind_range` returns inclusive bounds `(low,high)` with `high-low+1=q`. The range0..q−1 is simple; q..2q−1 works too. The literal integer0 is not uniquely required.

With only t=1,2, choice0 produces2,4 while choice1 produces1,2. B=4 identifies choice0 and B=1 identifies choice1. Also, **equal possible-value sets need not imply equal distributions**: `[1,1,2]` and `[1,2,2]` have the same set but give1 probabilities2/3 and1/3. Here we also check that q uniform inputs visit q distinct outputs once each.

## 2. Why the selected keys agree

Division uses a multiplicative **inverse**: a number satisfying `A*inverse %p=1`. For prime p and nonzero A it is `pow(A,p-2,p)`. With p=7,A=4, the inverse is2 because4×2 leaves1. Thus `B/A` means `B*2%7`, not subtraction.

`H` is the supplied `derive_key(grp,element)`: it turns the same group value into the same integer key. You do not implement another key-derivation convention.

```text
Sender:   K0 = H(pow(B,a,p))
          K1 = H(pow(B*pow(A,p-2,p)%p, a, p))
Receiver: K  = H(pow(A,t,p))

choice0: B^a = (g^t)^a = g^(at) = A^t
choice1: (B/A)^a = (g^t)^a = g^(at) = A^t
```

With p=7,g=2,a=2,A=4,t=1, the receiver's key input is4.

| choice | B | Sender's key0 input B^a | Key1 input (B/A)^a | Matching side |
|---|---:|---:|---:|---|
| 0 | 2 | 4 | 2 | 0 |
| 1 | 1 | 1 | 4 | 1 |

**XOR** compares corresponding binary digits: equal digits give0, different digits give1. Python uses `^`. Binary places count1,2,4 from right to left: `011=0×4+1×2+1×1=3`. Example:3=`011`,5=`101`, and `3^5=6`=`110`. XOR with5 again recovers3. This is not addition modulo p.

`encrypt` returns `(m0^K0,m1^K1)`; `unwrap` returns `ciphertexts[choice]^K`. The table explains the selected-key agreement. One failed attempt with another key is not a proof that the remaining message is secure. Here trying `2^2%7=4` discovers a; searching for that exponent is the **discrete logarithm problem**.

## 3. Build AND with two transfers

A **bit** is0 or1. **AND** gives1 only when both inputs are1. A **gate** is a small calculation component such as AND or XOR.

| u | v | XOR `u^v` | AND `u&v` |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 0 | 1 | 1 | 0 |
| 1 | 0 | 1 | 0 |
| 1 | 1 | 0 | 1 |

A **share** is one party's portion of a secret. **XOR shares** reconstruct as `x=x0^x1` and `y=y0^y1`. Party0 holds x0,y0; party1 holds x1,y1. For XOR, combining each party's local `xi^yi` suffices.

For AND, expanding bit products gives
`(x0^x1)&(y0^y1) = (x0&y0)^(x1&y1)^(x0&y1)^(x1&y0)`.
The last two **cross terms** use another party's share. Sharing these terms using OT is a component of the method called GMW.

A **mask** is a random bit XORed onto a value to hide it. Here `randomness` supplies two independent uniform bits r0,r1. `gate_masks` uses them as separate masks m0,m1.

```text
Party0: offer(x0,m0)=(m0,m0^x0) ── party1 selects y1 ─→ v1=m0^(x0&y1)
Party1: offer(x1,m1)=(m1,m1^x1) ── party0 selects y0 ─→ v0=m1^(x1&y0)

Party0 output: z0=(x0&y0)^m0^v0
Party1 output: z1=(x1&y1)^m1^v1
Combine:       z0^z1=x&y (each mask occurs twice and cancels)
```

Example: x0=1,x1=0,y0=1,y1=1,m0=0,m1=1.
Party1 receives `(0,1)[1]=1`; party0 receives `(1,1)[1]=1`.
Then z0=`1^0^1=0`, z1=`0^1^1=0`; combining with XOR gives0, as does `(1^0)&(1^1)`.

## 4. Correct results can still leak

Reusing m0=m1=m still reconstructs correctly. But inside party0 alone,
`z0=(x0&y0)^m^m^(x1&y0)=(x0^x1)&y0`.
Whenever y0=1, party0 recovers the other's share as `x1=z0^x0`.

For `gate-privacy`, hold your own inputs fixed, vary the other's inputs, and count the four equally likely randomness pairs. The specified **observation** is `(received value,own output)`. Check whether its occurrence counts change with the other party's inputs, in both directions.

This is a finite check of that selected observation, not a secrecy proof for every communication or arbitrary Python execution. The GMW explanation assumes **semi-honest parties**: they follow the steps but try to infer secrets from what they see, using an OT that meets its promises. Malicious deviations require additional defenses. The learning screen displays both parties' shares.

## Where to write and when you are done

Return pairs as Python tuples `(u,v)` or lists `[u,v]`. Numbers are integers; bits are integer0 or1, not booleans. Only `needs_transfer` returns a bool.

| Checkpoint | Functions and return values | What to check |
|---|---|---|
| request | `request` → integer B | Choice formula, range0..p−1, subgroup membership |
| choice-privacy | `blind_range` → inclusive integer pair; `request` | q uniform inputs give identical request distributions |
| transfer | `encrypt` → integer pair; `unwrap` → integer | Declared two-key formulas and recovery of the selected message |
| and-gate | `gate_masks` → bit pair; `offer` → bit pair; `output_share` → bit; `needs_transfer` → bool | AND reconstructs for64 combinations of four input and two random bits; `"xor"` returnsFalse and `"and"` returnsTrue |
| gate-privacy | Mask, offer and output functions | Each party's specified observation has unchanged occurrence counts as the other's input changes |
| unseen | The same eight functions | Both constructions survive different p,q,g and messages |

`unseen` does not count numeric literals in the source. Apply the same argument-based method to other inputs. Public tests check small calculations and formats; they do not replace all privacy checks. Once all six fields pass, use your tables to explain the difference between reconstructing correctly and having indistinguishable observations.

## Local author verification

The participant route is the Portal editor; no new endpoint or command-line submission contract is added. This problem's own Compose pair exposes the Workbench on localhost18310 and keeps verifier18311 on its internal network. Both run as non-root with init for descendant reaping. The scoring parent validates values from a restricted worker; a printed success message is not a grade.

```sh
FLAG_SEED=local-dev-seed docker compose -p ac26-w2-oblivious-transfer -f local/docker-compose.yml up -d --build --wait
make runtime-test FLAG_SEED=local-dev-seed
make reference-test FLAG_SEED=local-dev-seed
# Public CLI uses your edited starter, so the unfinished shipped starter is expected to fail.
make test FLAG_SEED=local-dev-seed
# From repository root: make install && make agent-gate
FLAG_SEED=local-dev-seed docker compose -p ac26-w2-oblivious-transfer -f local/docker-compose.yml down
```

Local Docker consumes host CPU, memory and disk; this lesson declares no standalone AWS resources. A platform event may bill for its runtime host, logs and networking until stopped. Tear down the Compose project above when done. Exact teaching inputs, frozen reader results and reproducible component/API checks are recorded in `local/tests/hidden/READER.md`; that is author-only evidence, not part of the participant image.
