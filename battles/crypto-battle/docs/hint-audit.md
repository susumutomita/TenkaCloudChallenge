# Order hint audit — Issue #873

Scope: all 17 registered Order task kinds, all three paid rungs, Japanese and
English. Also inspect protocol and saved-match variants. This is an audit of
Order hints, not a claim that every game screen or HUNT flow is redesigned.

Each ladder is checked against the worksheet and its submission: mechanism,
small worked example, then the player's operands and the destination field.
The last rung leaves the final arithmetic to the player. Needed formulas remain
available in the free worksheet. Hint prices and game scoring are unchanged.

| Task / variant | Review and correction |
| --- | --- |
| reveal-share / disclosure | Explain number/value pair and threshold; check exposure before publishing. |
| reveal-share / Schnorr | Separate challenge × secret, add randomness, take remainder, submit z. |
| reveal-share / saved Sudoku | Refer to the assigned substitution, not a table the player must choose. |
| zk-sudoku | Check substitution, four blank cells and submission wording in both locales. |
| caesar-shift / Caesar | Check zero-based die values, wraparound, three-number submission. |
| caesar-shift / Vigenère | Check per-position keys, wraparound and space-separated submission. |
| homomorphic-sum | Separate left and right totals, repeated remainder reduction and the two fields. |
| masked-total | Define masks and cancellation; separate received/sent totals and final public subtotal. |
| rps-duel | Supplement the worked example with the player's selected hand and randomness. |
| rotor-encrypt | Show positions and four operations for each character, including rotor rollover. |
| rsa-encrypt | Distinguish intermediate paper notes from the single ciphertext input; inspect exponents 3/5/7. |
| rsa-decrypt | Ciphertext cubing and remainder end in the separate plaintext submission. |
| enigma-encrypt | Match forward wiring, reflection, reverse wiring and current position to the worksheet. |
| ecdsa-sign | Name the j/jG table; separate coordinate, inverse, multiplication, addition and remainder. |
| ec-add | Explain inverse lookup; cover ordinary addition, doubling, cancellation and identity. |
| snark-constraints | Map wire/constraint computations to the five displayed fields. |
| stark-trace | Use the worksheet's quotient coefficients and map computations to four fields. |
| io-equivalence | Separate two missing values, function equality and complete probability comparisons. |
| anamorphic-rejection | Inspect encryption, decryption, probability and saved combined task separately. Show current operands without auto-selecting the answer. |
| ssm-decrypt | Use the displayed ciphertext and Parameter Store value; distinguish calculation from receipt copying. |

Independent pre-edit reader review caught real gaps: unexplained inverse lookup,
ambiguous ECDSA table lookup, STARK field mapping, and dense MPC/FHE paragraphs.
The corrections are confined to this battle's hint generators and Portal components.

Verification includes the registry's bilingual three-rung coverage, purchased-hint
projection/visibility, arithmetic branches, real worksheet field names, separate
rendered steps, and the local development harness. Browser samples are recorded
in the PR; automated projection checks are not described as independent human
playtests. AWS deployment and learning effectiveness with new participants are
not verified by these tests.
