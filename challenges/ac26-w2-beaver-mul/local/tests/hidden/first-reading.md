# ac26-w2-beaver-mul: independent reading, with an explicit boundary limitation

2026-09-07. Source directory:
`/private/tmp/tenkacloudchallenge-linear-shares-716-20260907/challenges/ac26-w2-beaver-mul`.

## What was read, and what was not

Read the Japanese and English metadata instructions, all 5 × 3 hints joined by
checkpoint/hint ID, both README files, and `local/starter/beaver.py`. The initial
`cat metadata.json` also displayed the `writeup` field. That field was visible
before the reader was complete; this is **not a writeup-blind first reading**.
It must not be combined with the separate secret-sharing/linear-shares reader
evidence or described as their independent reproduction. Later metadata reads
selected only instructions and ID-linked hints.

No hidden, reference, verifier, fixture, prior answer, runtime implementation,
Docker configuration, or live Inspect response was read. No HTTP submission or
repository edit was performed. Source hashes are in `sources.json`; extracted
instructions/hints are `public-ja.md` and `public-en.md`.

The original delegation requested a participant implementation. Before the later
instruction to stop code creation arrived, `reader-beaver.py` was saved and
checked only on the published examples and a newly constructed p=7 example.
No further code creation, edit or submission followed that instruction. This
file is an already-created artifact, **not a fully blind acceptance answer**.
Its SHA256 is `c534d93bccdba05e443926d69c363585de095b1c3c8726b552cb47a524b48e19`.
`public-calculations.log` records the local arithmetic; it is not verifier/API
acceptance evidence.

## What a participant can construct from the specified public text

All five scoring entries have `input: multiline` in the Japanese source metadata.
The English entries use the same five IDs. The stated workflow is Start → problem
editor → Inspect evidence → edit `beaver.py` → Run public tests → Submit each
checkpoint. All five use the same file. There are **no manual JSON checkpoints**.
The text supplies all four function signatures and formulas; no actual Inspect
numbers are required to write argument-based implementations.

| ID | Purpose / participant function | Required formula and shape | Stated completion |
| --- | --- | --- | --- |
| `mask` | Subtract the triple's sharing without opening the input; `mask(value_shares, mask_shares, p)` | Each row `(value_shares[i] - mask_shares[i]) % p`; list length n | Every element in 0..p−1 and reconstructed sum equals `(value − mask) % p` |
| `open` | Reconstruct the masked difference; `open_value(shares, p)` | `sum(shares) % p`; one integer | Canonical residue, not a list |
| `combine` | Assemble the product sharing from public d/e and private triple shares | Each row `(c_i + d*b_i + e*a_i) % p`; put `d*e` into one selected row, modulo p | Length n, canonical elements, reconstructed sum `(x*y) % p` |
| `protocol` | Exercise one's own functions together; also implement `rounds()` | `mask(x,a)` / `mask(y,b)` → `open` both → `combine`; independent openings can share one round | End-to-end product and stated round count; the intended answer is 1 |
| `transfer` | Use the same functions with other parameters | Take p and the list length from arguments; no copied deployment numbers | Same algebra for unseen p/n/triples; no new function or direct answer |

The public instructions contain the scalar identity
`(a+d)(b+e) = c + d*b + e*a + d*e`, where `c = a*b` modulo p.
The difficult implementation decision is placing the public constant once in the
reconstructed sum. The API signatures give the order `c_shares, a_shares,
b_shares, d, e, p`, while the multiplication cross terms use d with b and e with a.
The current high-level p=7 example has d≠e and distinguishes a swap, but the
worked *share-row* example in the hints/starter has d=e=4 and does not.

## Concrete reading gaps and incorrect explanations

1. **The scalar shortcut omits two necessary inputs (both languages).**
   `metadata.instructions` says “ab と d と e が分かっていれば x·y が出せます”; EN:
   “as long as you know ab, d and e.” The displayed formula also needs a and b
   in the cross terms. Counterexample entirely within the public p=7 example:
   c=5, d=3, e=4; a=2,b=6 gives x*y≡1, whereas a=6,b=2 gives x*y≡5. Thus the same
   c,d,e do not determine the product. Say that each party needs its shares of
   a,b,c together with the public d/e to produce a share of the product.

2. **The reason given for canonicalizing `open_value` is mathematically wrong.**
   `open-hint-2` / starter `open_value` say omitting `% p` makes the coefficient
   grow and causes the final product to mismatch. If combine reduces its rows
   modulo p, replacing d by d+kp and e by e+lp leaves the final residue unchanged.
   In the new p=7 example below, using d/e=10/11 instead of 3/4 gives exactly the
   same output rows. `% p` is required by this function's *canonical-output
   contract*; explain that direct checkpoint failure instead of a false later
   arithmetic failure. Both languages repeat this claim.

3. **“Unknown mask” alone does not prove the stated privacy.**
   The introduction says any value a whose contents are unknown leaves every x
   possible. For p=7, if unknown a is limited to {0,1} and d=3, x is only {3,4}.
   The README later names uniformity and one-time use, but the main explanation
   should place independent uniform a/b, fresh use and the observer's limited
   shares before “nothing leaks”. Avoid treating the exercise's explicitly
   nonzero-d/e diagnostic sampling as a real privacy distribution.

4. **Sending one share is not invariably immediate recovery.**
   The introduction says sending a piece of x or y leaks it immediately. In a
   three-party additive sharing, a recipient with only two of the three shares
   can still be missing the secret. For p=7, known shares 3 and 4 leave an unknown
   third share t, and their sum modulo 7 can be any t. Specify the dangerous act
   as collecting enough shares to reconstruct the input, with the threat model
   stated, instead of claiming every individual share discloses the input.

5. **The described Inspect view and “nobody knows the contents” need distinct roles.**
   The instructions say Inspect shows every a/b/c share and every x share, but
   not their clear values. If that described layout is accurate, the learner
   can calculate a,b,c,x simply by summing those lists modulo p. The participant
   implementation likewise receives whole lists to simulate all parties. Define
   this as a central teaching/simulation view, distinct from a real party holding
   only its own row. The actual Inspect response was not obtained in this reading;
   this finding concerns the public description, not an observed runtime leak.

6. **`protocol` failure is overdiagnosed as a shape mismatch.**
   Instructions and `protocol-hint-1/3` say green mask/open/combine but red protocol
   means lists and integers are handed off incorrectly, and that a list-valued
   open would not be detected individually. The `open` checkpoint explicitly
   requires one integer, so it should already reject that result. Also, correct
   first three functions plus `rounds() == 0` is the text's own example of a red
   protocol without any shape mismatch. Present these as possible causes, include
   the round-count check, and do not claim they are invisible to individual tests.

7. **The share-level walkthrough is not a one-digit example and hides a swap.**
   All mask/open/combine hint-3 examples and the corresponding starter docs use
   p=101, multi-digit shares and d=e=4. The p=7 scalar example in the statement
   does not show which party's row receives the public term. A single p=7 table
   spanning the three functions (below) supplies the missing bridge, including
   a negative subtraction, d≠e, and correct/missing/repeated d*e totals.
   Also define `[v]` as the whole list of shares, not a Python one-element list;
   then v_i is one party's integer. The bracket expression is mathematical
   notation, not directly executable Python list subtraction.

8. **The later hints overpromise an acceptance rule.**
   `transfer-hint-3`: “0 と 1 以外に[数値リテラルが]残っていなければ transfer は通ります.”
   Absence of other literals does not imply correctness: returning the unchanged
   input or a zero list uses only those literals and is wrong. Say this is a
   hard-coding check after verifying the formulas. Similarly the published
   `rounds()` contract alternates “needed number / one” and “at least 1”: clarify
   whether the checkpoint is asking for the minimal modeled count, not merely
   detecting zero. The actual grader has not been read, so no implementation
   claim about accepting 2 is made here.

9. **Opening-copy and alignment claims need confirmation/cleanup.**
   “p and n change on every start” is stated repeatedly but was not verified;
   restarting the same deployment and generating a new deployment are distinct
   actions. Japanese instructions call the button “証拠を確認”, while README uses
   “証拠を調べる”; choose the real displayed label. README workflow boilerplate
   mentions direct answers although this problem has none. The metadata's
   description and both README alignment sections say Week 2 has no material /
   placeholder sources, while this same metadata has concrete pinned lecture
   and assignment sources. These are internally inconsistent public texts;
   no upstream repository was opened during the reader task.

10. **The introduction delays the first action and relies on unintroduced words.**
    A beginner reaches “First move” only after motivation, privacy and expansion
    sections. A short opening can say that the learner is completing four Python
    functions to make a shared multiplication, then Start → editor → first mask
    checkpoint. Define party=one participant/process, mask=an independently random
    value added/subtracted to hide another value, and round=one layer of messages
    that can be sent together. “Modulus”, “canonical field element”, “scalar”,
    “SPDZ” and “dark pool” appear across the READMEs/introduction before definition;
    the prerequisite exercises can be linked without making those unexplained
    words the first action. The closing reuse/security question is useful, while
    the transfer checkpoint should keep its general-p/general-n programming goal.

## A constructed one-digit walkthrough from the public identity

This is not a deployment fixture or a recovered hidden answer. Use the statement's
p=7, x=5, y=3, a=2, b=6, c=5, and construct additive share lists as follows:

| Value | Three party rows | Sum modulo 7 |
| --- | --- | --- |
| x | [3,4,5] | 5 |
| y | [1,5,4] | 3 |
| a | [1,2,6] | 2 |
| b | [2,3,1] | 6 |
| c | [4,2,6] | 5 = a*b mod 7 |
| d shares = x shares − a shares | [2,2,6] | 3 |
| e shares = y shares − b shares | [6,2,3] | 4 |
| c_i + d*b_i + e*a_i (mod 7) | [0,5,5] | 3 |
| add d*e≡5 to party 0 only | [5,5,5] | 1 = x*y mod 7 |
| add d*e≡5 to every party | [5,3,3] | 4 (wrong) |

Here all input numbers are one digit. Party 0's y−b is 1−2=−1≡6. The public
constant is added once because its contribution to the *sum* must be 5, not
three copies of 5. Omitting the term leaves 3; swapping d and e produces 5
rather than 1. This distinguishes the errors that the d=e=4 row example hides.

A smaller edge-condition note: the general “nonzero d/e ensures the repeated
term is distinguishable” statement also assumes `(n−1) % p != 0`. With p=3,
n=4 and d=e=1, repeating it changes the integer sum by 3, which vanishes modulo
3. This may be ruled out by the actual generated p/n bounds; those were not read.
State those bounds when relying on the condition, rather than asserting it for
arbitrary n. This is a public-domain qualification, not a confirmed grader defect.
