# Ask me first and I can pass anything

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 420 · **Chapter:** Week 4 /
Commit–Challenge–Open · **Role:** `transfer` · **Time:** 60–90 minutes · **Points:** 300
· **Required first:** `ac26-w4-arithmetization` · **Status:** draft — see "Week 4 alignment"

## The story

A proof system's skeleton is three steps:

```text
1. the prover commits to data
2. the verifier chooses what to ask about
3. the prover opens that part
```

Swap 1 and 2 and the protocol proves nothing. You will build the honest version, then
demonstrate that attack yourself: the vector the `adaptive` checkpoint has you construct is
wrong in fifteen of sixteen positions, and its opening verifies. Finally, against five of the
setter's own verifiers, each missing a detail, you show which of them lets a forgery through —
with the opening that gets through (the `lenient` checkpoint).

## What has to be in a leaf

| Bound | Or else |
|---|---|
| the **index** | a leaf makes no claim about where it came from |
| **field boundaries** | `(1, 23)` and `(12, 3)` both render as "123" |
| the **direction** at each path step | the verifier can hash two ways and the prover picks |

The weak, separator-free encoding lives in the **fixtures**, not in your file. Breaking code
you deliberately weakened yourself is not a counterexample.

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
| `encoding` | 35 | Index bound, value bound, no two pairs colliding, order-sensitive nodes |
| `root` | 30 | The commitment, and that reordering changes it |
| `opening` | 45 | Honest accepted; value, index, direction, length and range all rejected |
| `order` | 40 | Challenge before commit and open before challenge both refused |
| `adaptive` | 45 | The challenge-first counterexample |
| `ambiguity` | 40 | Two pairs colliding under the weak encoding and not under yours |
| `transcript` | 35 | The challenge depends on commitment, domain and statement |
| `lenient` | 30 | For each of the setter's verifiers A–E, an opening that passes with a claim outside the table, or `None` (scored only when all five are right) |

All eight checkpoints have three hints at two points each (48 points total), within the hint penalty cap.

## The setter's five verifiers

The `lenient` checkpoint attacks verifiers fixed in the fixtures, not the participant's own. All
five accept every honest opening; they differ only in the leaf, the node, and how each sibling's
side is decided.

| verifier | leaf | the sibling's side | a claim outside the table |
|---|---|---|---|
| A | no index (`leaf/v1` + the value as 8 bytes) | trusts the path's flag | passes — position j's leaf and path can be relabelled as a claim about index i |
| B | separator-free string (`weak_leaf`) | trusts the path's flag | passes — another (index, value) rendering to the same text; with 16 cells, index 10–15 re-reads as "1 + the rest" |
| C | the proper leaf (4-byte index + 8-byte value) | trusts the path's flag | rejected — the index is in the leaf |
| D | as A (no index) | the remainder of the index divided by 2 | rejected — the side comes from the index, so a relabelled leaf lands on the other side |
| E | untagged fingerprint of the value's minimal bytes; the node is the untagged `sha256(left + right)` | as D | passes — a value whose bytes are "left child + right child" has an interior node's fingerprint, and that node is presented as a leaf with a shorter path |

The participant returns a passing opening or `None` for each of the five. The hidden message
names the scheme for a rejected opening (the public tests give the same verdict, so that is no
new information) but reports a `None` where a forgery exists without the scheme, once — the
verdict never reveals which verifiers are sound. **Run public tests**
sends the answers to the verifier's `POST /public/lenient`, which reports on the public 16-cell
practice table whether each passed and whether its claim is a table entry — that is the feedback
loop. The participant image carries neither the verifier implementations nor the practice roots.

## A note on equivalent mutants

The index-range and path-length checks in `verify_opening` **cannot be caught if removed**.
`LEAF_TAG` and `NODE_TAG` already mean a leaf hash never equals a node hash, so a path of the
wrong length recomputes to something that is not the root and the comparison rejects it anyway.
They are not in the mutation suite.

The range check in `Session.receive_challenge` is mutated instead — there a negative index
silently wraps and the prover opens a row nobody asked about, which is detectable.

Leaving an unkillable mutant in the list teaches that a `SURVIVED` line can be ignored. So it is
not left in.

The situation where the path length and the side flags do matter — a leaf that does not carry
its index, or a tree without tags — is graded on the setter's five verifiers above instead: not by demanding the checks
in the participant's `verify_opening`, but by having them construct what gets through a verifier
that lacks them.

## This is not a polynomial commitment

A Merkle root commits to a **vector**. It proves nothing about a polynomial's evaluation, and one
opening says nothing about the rows nobody asked about. There is a single query here, so a
guessing prover wins with probability `1/length` — soundness amplification is out of scope.

## Binding and hiding are different

A Merkle root gives **binding**. It does not give **hiding**: with a small value space, the
contents can be recovered from the root by brute force. Hiding needs separate randomness per leaf.

## Week 4 alignment

Week 4's material was not published upstream at the pinned commit. `courseAlignment` pins
`week4/README.md` with `kind: "placeholder"` and takes the `transfer` role, one of the two
`GOVERNANCE.md` §6 permits for an unpublished week. It asserts nothing about what the official
exercise will require. #229 reconciles the row when the material appears.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter and the public tests only — no fixtures, no hidden tests,
no reference solution, no verifier. Those live only in a second, unpublished container the
Workbench reaches over the compose network, and in the author-only image `make reference-test`
builds.

What the verifier does guarantee is narrower and real: submitted code has bounded execution time and resource limits,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: twenty broken implementations, eleven of them
wrong answers to `lenient` (None everywhere, a forgery claimed against C or D, E declared sound,
relabelling instead of a node for E, the path with the level under the node kept, the value built
from the tagged node, the honest opening passed off as a forgery, a path built on the wrong leaf,
flipped sides, a leading-zero split). The other nine commit, challenge, open and verify
successfully and differ only in what an adversary can do afterwards. The suite first checks the
five verifiers themselves on five seeds: every honest opening passes, the reference forges exactly
A, B and E, C, D and E reject every relabelling, and a flipped side flag is rejected by A, B and C
and ignored by D and E.


All eight checkpoints now have three two-point hints. Participant-only review caught incorrect hash-collision, position-binding and publication-order claims, plus missing path-length and scheme-E byte conversion steps. The bilingual statement corrects these and gives the required procedures for free. Catalog validation passed. Live Portal play was not run during the instruction review; execution-boundary validation follows below.

## Parent-owned grading boundary (Issue 837)

The trusted parent runs the existing checkpoint checker. Submitted Python runs in a separate,
restricted Linux worker; typed values cross the boundary, not a grading verdict. Output text
or early process exit cannot award points. Tuple/list, integer/boolean, byte and dictionary-key
contracts are preserved where used. The worker has file, network, signal, memory, output and
process limits. A 12-second submission budget is below the Workbench proxy's 15-second timeout.
The images run non-root, and Compose and the author runner use init. These are tested controls,
not a claim that every possible isolation defect or side channel has been eliminated.

The revised Linux Docker run passed 20 logical mutations, plus 8
execution-boundary regression tests. The boundary tests exercise all eight reference checkpoints,
a legal alternative, forged output/exit, private-file and parent-signal refusal, preserved types,
nesting bounds, non-root execution and timeout alignment. The native mutation tests examine
logical grading; the separate boundary tests examine execution isolation.

Actual non-root Workbench HTTP requests fetched config, live Inspect and starter; the unfinished
starter failed its first submission, while the author reference passed the 3 public tests
and all eight checkpoints through prepare and the verifier proxy. Output/exit spoofing failed
through that same route. Catalog validation passed for 116 entries. These are author and route
checks, not evidence of unaided first-time participant comprehension. Browser interaction,
deployed platform score reflection and deployment were not run for this change.

### Supported computation imports / 計算用の標準ライブラリ

Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
Other imports and file/network access are not supported in grading.
採点時は、この一覧以外のimportとファイル・通信操作には対応しません。
